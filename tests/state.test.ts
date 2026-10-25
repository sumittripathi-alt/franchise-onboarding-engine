// G7.8 storage fallback, G7.9 save/resume, and the change log (SPEC §9).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultPolicy } from "@/lib/policy/brandProfiles";
import {
  commitChange,
  computeResult,
  effective,
  newSession,
  parseSessionFile,
  previewChange,
  serialiseSession,
  undoEntry,
  type Session,
} from "@/lib/state/session";
import { MEMORY_NOTICE, STORAGE_KEY, safeGetItem, safeRemoveItem, safeSetItem, storageWorks } from "@/lib/state/storage";
import { parseOk, trickyFile } from "./helpers";

const NOW = "2026-10-26T09:00:00.000Z";

function trickySession(): Session {
  const r = parseOk([trickyFile()]);
  return newSession({
    files: ["tricky.xlsx"],
    applications: r.applications,
    territories: r.territories,
    skippedExample: r.skippedExample,
    report: r.report,
    today: "2026-10-25",
  });
}

const foundSpace = {
  source: "manual" as const,
  description: "APP-012 found a ground-floor space",
  directKeys: ["APP-012"],
  facts: [
    { target: "application" as const, key: "APP-012", field: "spaceAvailable" as const, value: "Rented" },
    { target: "application" as const, key: "APP-012", field: "floor" as const, value: "Ground" },
  ],
};

function decisionsJson(s: Session) {
  return JSON.stringify(computeResult(s).decisions);
}

describe("G7.9 save and resume", () => {
  it("a resumed session gives identical decisions, including its change log, locks and overrides", () => {
    let s = trickySession();
    const a = commitChange(s, foundSpace, NOW);
    expect(a.ok).toBe(true);
    s = (a as { session: Session }).session;
    const result = computeResult(s);
    const d19 = result.decisions.find((d) => d.appKey === "APP-019")!;
    const lock = commitChange(
      s,
      { source: "lock", description: "Sent APP-001 to the partner", locks: [{ appKey: "APP-001", status: "APPROVED", pin: "560041", territoryKey: "TER-01", date: "2026-10-26" }], directKeys: ["APP-001"] },
      NOW,
    );
    expect(lock.ok).toBe(true);
    s = (lock as { session: Session }).session;
    const ov = commitChange(
      s,
      { source: "override", description: "Override APP-009", overrides: [{ appKey: "APP-009", status: "WAITLIST", reason: "Ops decision", time: NOW }], directKeys: ["APP-009"] },
      NOW,
    );
    expect(ov.ok).toBe(true);
    s = (ov as { session: Session }).session;
    s = { ...s, feedback: [{ id: "f1", time: NOW, appKey: "APP-019", appId: d19.appId, status: d19.status, reason: "Floor is fine" }], reviewed: true };

    const text = serialiseSession(s, NOW);
    const back = parseSessionFile(text);
    expect(back.ok).toBe(true);
    const resumed = (back as { session: Session }).session;
    expect(decisionsJson(resumed)).toBe(decisionsJson(s));
    expect(resumed.entries.map((e) => e.description)).toEqual(s.entries.map((e) => e.description));
    expect(resumed.feedback).toEqual(s.feedback);
    // Saving again is stable.
    expect(JSON.parse(serialiseSession(resumed, NOW))).toEqual(JSON.parse(text));
  });

  it("carries the brand profile and today, so a different default can't change a resumed session", () => {
    const s = trickySession();
    const changed = { ...s, policy: { ...s.policy, minInvestmentLakh: { "Tier 1": 99, "Tier 2": 20, "Tier 3": 15 } } };
    const back = parseSessionFile(serialiseSession(changed, NOW));
    expect((back as { session: Session }).session.policy.minInvestmentLakh["Tier 1"]).toBe(99);
    expect(effective(changed).settings.today).toBe("2026-10-25");
  });

  it("rejects malformed files with a clear message", () => {
    const good = JSON.parse(serialiseSession(trickySession(), NOW));
    const bad = (m: (x: any) => void) => {
      const x = structuredClone(good);
      m(x);
      return parseSessionFile(JSON.stringify(x));
    };
    const msg = (r: ReturnType<typeof parseSessionFile>) => (r.ok ? "" : r.message);

    expect(msg(parseSessionFile("not json at all"))).toMatch(/isn't valid JSON/);
    expect(msg(parseSessionFile(JSON.stringify({ hello: "world" })))).toMatch(/isn't a session saved by this app/);
    expect(msg(parseSessionFile("[]"))).toMatch(/isn't a session saved by this app/);
    expect(msg(bad((x) => (x.version = 2)))).toMatch(/newer version/);
    expect(msg(bad((x) => (x.session.parsed.applications[0].pin.value = "12")))).toMatch(/damaged or has been edited. Problem at session\.parsed\.applications\.0\.pin\.value/);
    expect(msg(bad((x) => delete x.session.base))).toMatch(/Problem at session\.base/);
    expect(msg(bad((x) => (x.session.base.today = "yesterday")))).toMatch(/Problem at session\.base\.today/);
    expect(msg(bad((x) => x.session.entries.push({ id: "c1" })))).toMatch(/Problem at session\.entries\.0/);
    const many = bad((x) => {
      x.session.parsed.applications[0].pin.value = "12";
      x.session.base.today = "nope";
    });
    expect(msg(many)).toMatch(/\(and \d+ more problems?\)\.$/);
  });
});

describe("change log: entries fold into the effective state and can each be undone", () => {
  it("a fact changes decisions, with knock-on effects in the diff", () => {
    const s = trickySession();
    const out = commitChange(s, foundSpace, NOW);
    if (!out.ok) throw new Error(out.message);
    const direct = out.diff.changes.filter((c) => c.direct).map((c) => c.appId);
    const knock = out.diff.changes.filter((c) => !c.direct).map((c) => c.appId);
    expect(direct).toEqual(["APP-012"]);
    expect(out.diff.changes.find((c) => c.appId === "APP-012")).toMatchObject({ from: "WAITLIST", to: "CONDITIONAL" });
    expect(knock).toContain("APP-019");
    expect(out.diff.changes.find((c) => c.appId === "APP-019")).toMatchObject({ from: "CONDITIONAL", to: "WAITLIST" });
    expect(out.diff.text).toMatch(/^\d+ decisions changed: APP-012 Waitlisted → Approved with conditions;/);
    expect(out.entry.diff).toEqual(out.diff);
  });

  it("undo removes just that entry, and later entries stay", () => {
    let s = trickySession();
    const base = decisionsJson(s);
    const a = commitChange(s, foundSpace, NOW) as { ok: true; session: Session };
    s = a.session;
    const b = commitChange(s, { source: "settings", description: "Today set to 28 Oct", set: { today: "2026-10-28" } }, NOW) as { ok: true; session: Session };
    s = b.session;
    expect(effective(s).settings.today).toBe("2026-10-28");
    const withoutFirst = undoEntry(s, "c1");
    expect(withoutFirst.entries[0].undone).toBe(true);
    expect(effective(withoutFirst).facts).toEqual([]);
    expect(effective(withoutFirst).settings.today).toBe("2026-10-28");
    const withoutBoth = undoEntry(withoutFirst, "c2");
    expect(decisionsJson(withoutBoth)).toBe(base);
  });

  it("switching the brand type is an entry and reruns the engine with that profile's numbers", () => {
    const s = trickySession();
    const out = commitChange(s, { source: "brand", description: "Switched to Delivery centre", set: { profileId: "delivery" } }, NOW);
    if (!out.ok) throw new Error(out.message);
    expect(computeResult(out.session).profileId).toBe("delivery");
    expect(out.diff.changes.length).toBeGreaterThan(3);
    expect(computeResult(undoEntry(out.session, out.entry.id)).profileId).toBe("eyewear");
  });

  it("including the template example rows is an entry that adds them with their own IDs", () => {
    const s = trickySession();
    const out = commitChange(s, { source: "settings", description: "Included the template example rows", set: { includeExample: true } }, NOW);
    if (!out.ok) throw new Error(out.message);
    const r = computeResult(out.session);
    expect(r.decisions.some((d) => d.appId === "APP-001 (template example)")).toBe(true);
    expect(r.territories.some((t) => t.id === "TER-01 (template example)")).toBe(true);
    expect(r.invariantViolations).toEqual([]);
  });

  it("an override that would bump someone is held for confirmation, not committed", () => {
    const s = trickySession();
    const spec = {
      source: "override" as const,
      description: "Override APP-013",
      overrides: [{ appKey: "APP-013", status: "APPROVED" as const, reason: "Site visit", time: NOW }],
      directKeys: ["APP-013"],
    };
    const p = previewChange(s, spec, NOW);
    expect(p.pending[0].wouldBump).toEqual(["APP-003", "APP-004"]);
    const out = commitChange(s, spec, NOW);
    expect(out.ok).toBe(false);
    expect((out as { message: string }).message).toMatch(/Confirm to go ahead/);
    const confirmed = commitChange(s, { ...spec, overrides: [{ ...spec.overrides[0], confirmedBumps: ["APP-003", "APP-004"] }] }, NOW);
    expect(confirmed.ok).toBe(true);
  });
});

describe("G7.8 storage fallback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("works with no storage at all (server, or storage removed)", () => {
    expect(storageWorks()).toBe(false);
    expect(safeSetItem("k", "v")).toBe(false);
    expect(safeGetItem("k")).toBeNull();
    expect(() => safeRemoveItem("k")).not.toThrow();
  });

  it("works when every storage call throws (private mode, blocked site data)", () => {
    vi.stubGlobal("window", {
      get localStorage(): never {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    expect(storageWorks()).toBe(false);
    expect(safeSetItem("k", "v")).toBe(false);
    expect(safeGetItem("k")).toBeNull();
    expect(() => safeRemoveItem("k")).not.toThrow();
  });

  describe("the store keeps working in memory and says so", () => {
    beforeEach(() => {
      vi.resetModules();
      vi.useFakeTimers();
    });

    async function freshStore() {
      const { useStore } = await import("@/lib/state/store");
      return useStore;
    }
    const parsed = () => parseOk([trickyFile()]);

    it("blocked storage: the session works fully and the notice applies", async () => {
      vi.stubGlobal("window", {
        get localStorage(): never {
          throw new DOMException("blocked", "SecurityError");
        },
      });
      const store = await freshStore();
      store.getState().hydrate();
      expect(store.getState().persistence).toBe("memory");
      expect(MEMORY_NOTICE).toBe("Your session won't be saved if you close this tab.");

      store.getState().startFromParse(parsed(), ["tricky.xlsx"]);
      expect(store.getState().session).not.toBeNull();
      const out = store.getState().commit(foundSpace);
      expect(out.ok).toBe(true);
      vi.advanceTimersByTime(1000); // the save attempt must not throw or lose the session
      expect(store.getState().session!.entries).toHaveLength(1);
      expect(computeResult(store.getState().session!).decisions.find((d) => d.appKey === "APP-012")!.status).toBe("CONDITIONAL");
      store.getState().undo("c1");
      expect(store.getState().session!.entries[0].undone).toBe(true);
    });

    it("storage fills up mid-session: the session stays in memory and the notice appears", async () => {
      const data = new Map<string, string>();
      let full = false;
      vi.stubGlobal("window", {
        localStorage: {
          getItem: (k: string) => data.get(k) ?? null,
          setItem: (k: string, v: string) => {
            if (full && k === STORAGE_KEY) throw new DOMException("full", "QuotaExceededError");
            data.set(k, v);
          },
          removeItem: (k: string) => void data.delete(k),
        },
      });
      const store = await freshStore();
      store.getState().hydrate();
      expect(store.getState().persistence).toBe("saved");
      store.getState().startFromParse(parsed(), ["tricky.xlsx"]);
      vi.advanceTimersByTime(1000);
      expect(data.has(STORAGE_KEY)).toBe(true);

      full = true;
      store.getState().commit(foundSpace);
      vi.advanceTimersByTime(1000);
      expect(store.getState().persistence).toBe("memory");
      expect(store.getState().session!.entries).toHaveLength(1);
    });

    it("with working storage, a refresh restores the session, and a damaged saved session is dropped", async () => {
      const data = new Map<string, string>();
      vi.stubGlobal("window", {
        localStorage: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) },
      });
      const first = await freshStore();
      first.getState().hydrate();
      first.getState().startFromParse(parsed(), ["tricky.xlsx"]);
      first.getState().commit(foundSpace);
      vi.advanceTimersByTime(1000);
      const before = decisionsJson(first.getState().session!);

      vi.resetModules();
      const second = await freshStore();
      second.getState().hydrate();
      expect(second.getState().session).not.toBeNull();
      expect(decisionsJson(second.getState().session!)).toBe(before);

      data.set(STORAGE_KEY, "{damaged");
      vi.resetModules();
      const third = await freshStore();
      third.getState().hydrate();
      expect(third.getState().session).toBeNull();
      expect(data.has(STORAGE_KEY)).toBe(false);
      third.getState().reset();
      expect(third.getState().session).toBeNull();
    });
  });
});

describe("policy", () => {
  it("defaults are cloned per session, not shared", () => {
    const s = trickySession();
    s.policy.minInvestmentLakh["Tier 1"] = 1;
    expect(defaultPolicy("eyewear").profile.minInvestmentLakh["Tier 1"]).toBe(30);
  });
});
