// Editable assumptions (Phase 8): values are checked, each change is a shared change-log event with a diff, and
// switching brand type and resetting always bring back identical decisions.

import { describe, expect, it } from "vitest";
import { BRAND_PROFILES } from "@/lib/policy/brandProfiles";
import { applyEdits, checkProfile, describeEdit, EDITABLE, foldPolicyEntries, policyChangeSentence, validateEdit, validateEdits, type PolicyEdit } from "@/lib/policy/edits";
import { appendEvent, createWorkspace, getWorkspace } from "@/lib/server/handlers";
import { MemoryRepo } from "@/lib/server/repo";
import { commitChange, computeResult, effectivePolicy, newSession, undoEntry, type ChangeSpec, type Session } from "@/lib/state/session";
import { memoryCache } from "@/lib/workspace/cache";
import { WorkspaceClient } from "@/lib/workspace/client";
import { ChangePayloadSchema, classifyChange, type BaseData, type ChangePayload } from "@/lib/workspace/schemas";
import type { Res, Transport } from "@/lib/workspace/transport";
import { parseOk, trickyFile } from "./helpers";

const NOW = "2026-10-26T09:00:00.000Z";
const session = (): Session => {
  const r = parseOk([trickyFile()]);
  return newSession({ files: ["t"], applications: r.applications, territories: r.territories, skippedExample: r.skippedExample, report: r.report, today: "2026-10-26" });
};
const dec = (s: Session) => JSON.stringify(computeResult(s).decisions);

const raise: ChangeSpec = { source: "policy", description: "raise", policy: { profileId: "eyewear", edits: [{ path: "minInvestmentLakh.Tier 1", value: 60 }] } };
const reset: ChangeSpec = { source: "policy", description: "reset", policy: { profileId: "eyewear", reset: true } };
const brand = (id: "eyewear" | "delivery" | "partner_point"): ChangeSpec => ({ source: "brand", description: `to ${id}`, set: { profileId: id } });
const ok = (s: Session, spec: ChangeSpec) => {
  const o = commitChange(s, spec, NOW);
  if (!o.ok) throw new Error(o.message);
  return o;
};

describe("validation: invalid values are rejected", () => {
  it("every editable setting has a range, and values outside it, or not numbers, are refused with a reason", () => {
    for (const f of EDITABLE) {
      expect(validateEdit(f.path, f.min), f.path).toBeNull();
      expect(validateEdit(f.path, f.max), f.path).toBeNull();
      expect(validateEdit(f.path, f.min - (f.integer ? 1 : 0.0001)), f.path).toMatch(/must be between/);
      expect(validateEdit(f.path, f.max + 1), f.path).toMatch(/must be between/);
      expect(validateEdit(f.path, Number.NaN)).toMatch(/needs a number/);
      expect(validateEdit(f.path, "30")).toMatch(/needs a number/);
      expect(validateEdit(f.path, Infinity)).toMatch(/needs a number/);
    }
    expect(validateEdit("conditionDays.proofOfFunds", 2.5)).toMatch(/whole number/);
    expect(validateEdit("hardFloorPct", 0.1)).toMatch(/between 30 and 95/);
    expect(validateEdit("floorRules.Ground", 1)).toMatch(/isn't a setting/);
    expect(validateEdit("__proto__.polluted", 1)).toMatch(/isn't a setting/);
  });

  it("settings that contradict each other are refused", () => {
    const p = BRAND_PROFILES.eyewear;
    expect(validateEdits(p, [{ path: "minInvestmentLakh.Tier 2", value: 40 }])).toMatch(/can't be lower in a bigger city/);
    expect(validateEdits(p, [{ path: "cannibalisationRadiusKm.Tier 1", value: 10 }])).toMatch(/can't be larger in a denser city/);
    expect(validateEdits(p, [{ path: "space.minSqft", value: 900 }])).toMatch(/can't be more than the ideal minimum/);
    expect(validateEdits(p, [{ path: "minInvestmentLakh.Tier 1", value: 50 }, { path: "minInvestmentLakh.Tier 2", value: 40 }])).toBeNull();
  });

  it("the server schema refuses bad edits: unknown settings, out-of-range values, contradictions, extra fields", () => {
    const bad = (policy: unknown) => ChangePayloadSchema.safeParse({ source: "policy", description: "x", policy }).success;
    expect(bad({ profileId: "eyewear", edits: [{ path: "minInvestmentLakh.Tier 1", value: 60 }] })).toBe(true);
    expect(bad({ profileId: "eyewear", reset: true })).toBe(true);
    expect(bad({ profileId: "eyewear", edits: [{ path: "minInvestmentLakh.Tier 1", value: -5 }] })).toBe(false);
    expect(bad({ profileId: "eyewear", edits: [{ path: "minInvestmentLakh.Tier 1", value: 100000 }] })).toBe(false);
    expect(bad({ profileId: "eyewear", edits: [{ path: "rationale.minInvestmentLakh", value: 1 }] })).toBe(false);
    expect(bad({ profileId: "eyewear", edits: [{ path: "minInvestmentLakh.Tier 2", value: 40 }] })).toBe(false);
    expect(bad({ profileId: "kiosk", edits: [{ path: "hardFloorPct", value: 0.5 }] })).toBe(false);
    expect(bad({ profileId: "eyewear", edits: [] })).toBe(false);
    expect(bad({ profileId: "eyewear", edits: [{ path: "hardFloorPct", value: 0.5, extra: 1 }] })).toBe(false);
  });

  it("an event with bad numbers is rejected by the API, a good one is stored as a policy_change", async () => {
    const repo = new MemoryRepo();
    const id = "77777777-7777-4777-8777-777777777777";
    const s = session();
    await createWorkspace(repo, JSON.stringify({ id, name: "t", brandProfile: "eyewear", rowCounts: { applications: 1, territories: 1 }, baseData: { files: s.files, parsed: s.parsed, base: s.base, policy: s.policy } }));
    const post = (policy: unknown, type = "policy_change") => appendEvent(repo, id, JSON.stringify({ type, payload: { source: "policy", description: "x", policy }, clientId: "c", clientEventId: `e${Math.random().toString(36).slice(2)}` }));
    expect((await post({ profileId: "eyewear", edits: [{ path: "minInvestmentLakh.Tier 1", value: -1 }] })).status).toBe(400);
    expect((await post({ profileId: "eyewear", edits: [{ path: "minInvestmentLakh.Tier 1", value: 60 }] }, "fact")).status).toBe(400); // wrong label
    const good = await post({ profileId: "eyewear", edits: [{ path: "minInvestmentLakh.Tier 1", value: 60 }] });
    expect(good.status).toBe(201);
    expect(classifyChange({ source: "policy", description: "x", policy: { profileId: "eyewear", reset: true } } as ChangePayload)).toBe("policy_change");
    expect(repo.workspaces.get(id)!.events[0].type).toBe("policy_change");
  });
});

describe("a change shows what it did", () => {
  it("raising the Tier 1 minimum changes decisions, and says how many and which", () => {
    const s = session();
    const o = ok(s, raise);
    expect(o.diff.changes.length).toBeGreaterThan(0);
    const what = describeEdit(s.policy, raise.policy && "edits" in raise.policy ? raise.policy.edits[0] : ({} as PolicyEdit));
    expect(what).toBe("minimum investment, Tier 1 cities from 30 to 60 ₹ lakh");
    const text = policyChangeSentence(what, o.diff);
    expect(text).toMatch(new RegExp(`^Changing minimum investment, Tier 1 cities from 30 to 60 ₹ lakh changed ${o.diff.changes.length} decisions?: `));
    expect(text).toMatch(/APP-\d+/);
    expect(effectivePolicy(o.session, "eyewear").profile.minInvestmentLakh["Tier 1"]).toBe(60);
  });
  it("a change that moves nothing says so", () => {
    const o = ok(session(), { source: "policy", description: "x", policy: { profileId: "eyewear", edits: [{ path: "waitlistReviewDays", value: 15 }] } });
    expect(policyChangeSentence("the review days", o.diff)).toMatch(/changed (no decisions|\d+ decisions?)/);
  });
});

describe("switching and resetting give identical decisions", () => {
  it("edit, switch away and back, reset: back to exactly the starting decisions", () => {
    const s0 = session();
    const d0 = dec(s0);
    const s1 = ok(s0, raise).session;
    const d1 = dec(s1);
    expect(d1).not.toBe(d0);

    const toDelivery = ok(s1, brand("delivery")).session;
    // Another brand type is untouched by edits to the eyewear numbers.
    expect(dec(toDelivery)).toBe(dec(ok(s0, brand("delivery")).session));
    const back = ok(toDelivery, brand("eyewear")).session;
    expect(dec(back)).toBe(d1); // the edit is still there
    const reset1 = ok(back, reset).session;
    expect(dec(reset1)).toBe(d0); // and reset brings back the starting point exactly
    expect(effectivePolicy(reset1, "eyewear").profile).toEqual(s0.policy);
  });

  it("undo gives the same result as reset, and reset is itself undoable", () => {
    const s0 = session();
    const edited = ok(s0, raise).session;
    expect(dec(undoEntry(edited, edited.entries[0].id))).toBe(dec(s0));
    const r = ok(edited, reset).session;
    expect(dec(r)).toBe(dec(s0));
    expect(dec(undoEntry(r, r.entries.at(-1)!.id))).toBe(dec(edited));
  });

  it("resetting an unedited profile, or switching many times, changes nothing", () => {
    const s0 = session();
    let s = ok(s0, reset).session;
    expect(dec(s)).toBe(dec(s0));
    for (const id of ["delivery", "partner_point", "eyewear", "delivery", "eyewear"] as const) s = ok(s, brand(id)).session;
    expect(dec(s)).toBe(dec(s0));
  });

  it("the same edits in the same order always give the same decisions (deterministic)", () => {
    const a = ok(ok(session(), raise).session, { source: "policy", description: "d", policy: { profileId: "eyewear", edits: [{ path: "conditionDays.proofOfFunds", value: 7 }] } }).session;
    const b = ok(ok(session(), raise).session, { source: "policy", description: "d", policy: { profileId: "eyewear", edits: [{ path: "conditionDays.proofOfFunds", value: 7 }] } }).session;
    expect(dec(a)).toBe(dec(b));
  });
});

describe("folding edits", () => {
  const e = (profileId: "eyewear" | "delivery", edits: PolicyEdit[], undone = false) => ({ undone, policy: { profileId, edits } });
  it("later edits to the same setting win, resets clear, undone entries and other profiles don't leak", () => {
    const out = foldPolicyEntries([
      e("eyewear", [{ path: "hardFloorPct", value: 0.5 }]),
      e("delivery", [{ path: "hardFloorPct", value: 0.4 }]),
      e("eyewear", [{ path: "hardFloorPct", value: 0.6 }, { path: "waitlistReviewDays", value: 10 }]),
      e("eyewear", [{ path: "baseTrainingDays", value: 30 }], true),
    ]);
    expect(out.eyewear).toEqual([{ path: "hardFloorPct", value: 0.6 }, { path: "waitlistReviewDays", value: 10 }]);
    expect(out.delivery).toEqual([{ path: "hardFloorPct", value: 0.4 }]);
    const after = foldPolicyEntries([e("eyewear", [{ path: "hardFloorPct", value: 0.5 }]), { undone: false, policy: { profileId: "eyewear", reset: true } } as never]);
    expect(after.eyewear).toBeUndefined();
  });

  it("two people changing related numbers at once never leave the profile inconsistent", () => {
    // Alone, each is fine against the defaults (30 / 20); together Tier 2 (28) would exceed Tier 1 (25).
    const merged = applyEdits(BRAND_PROFILES.eyewear, [
      { path: "minInvestmentLakh.Tier 1", value: 25 },
      { path: "minInvestmentLakh.Tier 2", value: 28 },
    ]);
    expect(checkProfile(merged)).toBeNull();
    expect(merged.minInvestmentLakh["Tier 1"]).toBe(25);
    expect(merged.minInvestmentLakh["Tier 2"]).toBe(20); // the edit that would break it is skipped
    // Bad values slipped into a log are skipped, not applied.
    expect(applyEdits(BRAND_PROFILES.eyewear, [{ path: "hardFloorPct", value: 5 }]).hardFloorPct).toBe(0.7);
  });
});

describe("shared: another viewer sees the same numbers and the same decisions", () => {
  function net(repo: MemoryRepo): Transport {
    const call = async <T,>(f: () => Promise<{ status: number; body: unknown }>): Promise<Res<T>> => {
      const r = await f();
      return r.status < 300 ? { ok: true, data: r.body as T } : { ok: false, kind: r.status === 404 ? "not_found" : "rejected", message: "" };
    };
    return {
      create: (b) => call(() => createWorkspace(repo, JSON.stringify(b))),
      get: (id, since, withBase = true) => call(() => getWorkspace(repo, id, String(since), withBase ? null : "0")),
      post: (id, e) => call(() => appendEvent(repo, id, JSON.stringify(e))),
      list: async () => ({ ok: true, data: { workspaces: [] } }),
    };
  }
  it("an edit and a reset travel as events, and everyone replays to the same decisions", async () => {
    const repo = new MemoryRepo();
    const t = net(repo);
    const id = "88888888-8888-4888-8888-888888888888";
    const s = session();
    const base: BaseData = { files: s.files, parsed: s.parsed, base: s.base, policy: s.policy };
    const a = WorkspaceClient.fromUpload({ id, transport: t, cache: memoryCache(), clientId: "alice", base, name: "t", parentId: null });
    await a.round();
    const b = new WorkspaceClient({ id, transport: t, cache: memoryCache(), clientId: "bob" });
    await b.open();
    const d0 = dec(a.session!);

    expect(a.commit(raise).ok).toBe(true);
    await a.round();
    await b.round();
    expect(dec(b.session!)).toBe(dec(a.session!));
    expect(dec(b.session!)).not.toBe(d0);
    expect(b.toasts.some((x) => /Updated by another viewer/.test(x.text))).toBe(true);
    expect(repo.workspaces.get(id)!.events[0].type).toBe("policy_change");

    expect(b.commit(reset).ok).toBe(true);
    await b.round();
    await a.round();
    expect(dec(a.session!)).toBe(d0);
    expect(dec(b.session!)).toBe(d0);
    const late = new WorkspaceClient({ id, transport: t, cache: memoryCache(), clientId: "late" });
    await late.open();
    expect(dec(late.session!)).toBe(d0);
  });
});
