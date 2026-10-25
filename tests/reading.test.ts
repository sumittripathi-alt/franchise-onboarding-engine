// Reading applicants' notes with the AI, once per upload (SPEC §8.1, G4.1, G4.8), and what happens to the result.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtractBatch, ExtractItem } from "@/lib/llm/clientApi";
import { chunkSignals, readNotes } from "@/lib/llm/extractClient";
import { vetSignals, type AiSignal } from "@/lib/llm/vet";
import { MemoryRepo } from "@/lib/server/repo";
import { appendEvent, createWorkspace, getWorkspace, health } from "@/lib/server/handlers";
import { chat, extract, message } from "@/lib/llm/handlers";
import { computeResult, newSession } from "@/lib/state/session";
import { memoryCache } from "@/lib/workspace/cache";
import { WorkspaceClient } from "@/lib/workspace/client";
import type { Res, Transport } from "@/lib/workspace/transport";
import type { Application, Signals } from "@/lib/types";
import { parseOk, trickyFile } from "./helpers";

const META = { model: "fake", at: "2026-10-25T10:00:00.000Z" };
const blankAi = (over: Partial<AiSignal> = {}, ev: Partial<AiSignal["evidence"]> = {}): AiSignal => ({
  relevant_sector: null, years_running_shop_mentioned: null, notes_floor_claim: null, notes_space_claim: null, festival_deadline: null,
  absentee_owner: false, competitor_conflict: false, funding_dependency: false, injection_attempt: false, confidence: 0.95,
  evidence: { relevant_sector: null, years_running_shop_mentioned: null, notes_floor_claim: null, notes_space_claim: null, festival_deadline: null, absentee_owner: null, competitor_conflict: null, funding_dependency: null, injection_attempt: null, ...ev },
  ...over,
});

const apps = (n: number, text = "Runs a shop"): Pick<Application, "key" | "business" | "notes">[] =>
  Array.from({ length: n }, (_, i) => ({ key: `APP-${i + 1}`, business: `${text} number ${i + 1}`, notes: i % 2 ? "some notes" : "" }));

const ok = (items: ExtractItem[]): ExtractBatch => ({
  ok: true,
  model: "fake",
  results: Object.fromEntries(items.map((i) => [i.id, vetSignals(blankAi(), { business: i.business, notes: i.notes }, META)])),
});

describe("readNotes", () => {
  it("sends batches of 10, four at a time, and only the key, business text and notes", async () => {
    let running = 0;
    let peak = 0;
    const seen: ExtractItem[][] = [];
    const extractFn = async (items: ExtractItem[]) => {
      seen.push(items);
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return ok(items);
    };
    const r = await readNotes(apps(170), { extract: extractFn });
    expect(seen.map((b) => b.length)).toEqual(Array(17).fill(10));
    expect(peak).toBe(4);
    expect(r.complete).toBe(true);
    expect(r.read).toBe(170);
    for (const batch of seen) for (const item of batch) expect(Object.keys(item).sort()).toEqual(["business", "id", "notes"]);
  });

  it("skips applications with no text, and reports nothing to read as complete only when there was something", async () => {
    const r = await readNotes([{ key: "A", business: "", notes: "  " }], { extract: async () => { throw new Error("must not be called"); } });
    expect(r.total).toBe(0);
    expect(r.unavailable).toBe(false);
  });

  it("is 'unavailable' when no batch is answered (AI off or unreachable), and never throws", async () => {
    const r = await readNotes(apps(45), { extract: async () => ({ ok: false, results: {}, model: null }) });
    expect(r.unavailable).toBe(true);
    expect(r.complete).toBe(false);
    expect(r.signals).toEqual({});
    const thrown = await readNotes(apps(5), { extract: async () => { throw new Error("boom"); } });
    expect(thrown.read).toBe(0);
  });

  it("keeps what finished when some batches fail", async () => {
    let n = 0;
    const r = await readNotes(apps(60), { extract: async (items) => (n++ === 1 ? { ok: false, results: {}, model: null } : ok(items)) });
    expect(r.read).toBe(50);
    expect(r.complete).toBe(false);
    expect(r.unavailable).toBe(false);
  });

  describe("the 25-second cap", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());
    it("stops waiting at the cap and uses what it has", async () => {
      let calls = 0;
      const slow = (items: ExtractItem[], signal?: AbortSignal) =>
        new Promise<ExtractBatch>((resolve) => {
          calls++;
          if (calls === 1) return resolve(ok(items)); // the first batch is quick
          signal?.addEventListener("abort", () => resolve({ ok: false, results: {}, model: null }));
        });
      const p = readNotes(apps(100), { extract: slow, parallel: 2 });
      await vi.advanceTimersByTimeAsync(25_001);
      const r = await p;
      expect(r.read).toBe(10);
      expect(r.complete).toBe(false);
    });
  });
});

describe("chunkSignals", () => {
  it("splits so each event stays under the size limit", () => {
    const sig: Record<string, Signals> = {};
    for (let i = 0; i < 40; i++) sig[`APP-${i}`] = vetSignals(blankAi({ absentee_owner: true }, { absentee_owner: "my nephew is going to be the one running things" }), { business: "Shop", notes: "my nephew is going to be the one running things" }, META);
    const groups = chunkSignals(sig);
    expect(groups.length).toBeGreaterThan(1);
    for (const g of groups) expect(JSON.stringify({ signals: g }).length).toBeLessThan(9500);
    expect(groups.reduce((n, g) => n + Object.keys(g).length, 0)).toBe(40);
  });
});

// ---------- The AI's reading becomes part of the workspace ----------

function network(repo: MemoryRepo): Transport {
  const call = async <T,>(f: () => Promise<{ status: number; body: unknown }>): Promise<Res<T>> => {
    try {
      const r = await f();
      if (r.status < 300) return { ok: true, data: r.body as T };
      const message = (r.body as { error?: string }).error ?? "";
      return { ok: false, kind: r.status === 404 ? "not_found" : r.status === 400 || r.status === 413 ? "rejected" : "network", message };
    } catch {
      return { ok: false, kind: "network", message: "down" };
    }
  };
  return {
    create: (b) => call(() => createWorkspace(repo, JSON.stringify(b))),
    get: (id, since, withBase = true) => call(() => getWorkspace(repo, id, String(since), withBase ? null : "0")),
    post: (id, e) => call(() => appendEvent(repo, id, JSON.stringify(e))),
    list: async () => ({ ok: true, data: { workspaces: [] } }),
  };
}
const ID = "66666666-6666-4666-8666-666666666666";

function setup() {
  const r = parseOk([trickyFile()]);
  const s = newSession({ files: ["t"], applications: r.applications, territories: r.territories, skippedExample: r.skippedExample, report: r.report, today: "2026-10-25" });
  const repo = new MemoryRepo();
  const t = network(repo);
  const quote = "my cousin is going to be the one running things";
  const target = s.parsed.applications.find((a) => a.id === "APP-005")!;
  const parsed = { ...s.parsed, applications: s.parsed.applications.map((a) => (a.key === target.key ? { ...a, notes: `${a.notes} ${quote}`.trim() } : a)) };
  const base = { files: s.files, parsed, base: s.base, policy: s.policy };
  const reading = vetSignals(blankAi({ absentee_owner: true }, { absentee_owner: quote }), { business: target.business, notes: `${target.notes} ${quote}` }, META);
  const mk = (cid: string) => new WorkspaceClient({ id: ID, transport: t, cache: memoryCache(), clientId: cid });
  return { repo, t, base, target, reading, quote, mk };
}

const decision = (c: WorkspaceClient, id: string) => computeResult(c.session!).decisions.find((d) => d.appId === id)!;

describe("the reading becomes the workspace's starting data", () => {
  it("a new upload isn't sent until the reading arrives; then everyone starts from it", async () => {
    const { repo, t, base, target, reading, quote, mk } = setup();
    const a = WorkspaceClient.fromUpload({ id: ID, transport: t, cache: memoryCache(), clientId: "alice", base, name: "t", parentId: null, holdSync: true });
    await a.round();
    expect(repo.workspaces.size).toBe(0); // held back
    expect(a.isHeld).toBe(true);

    a.setSignals({ [target.key]: reading });
    expect(a.isHeld).toBe(false);
    await a.round();
    expect(repo.workspaces.get(ID)!.baseData.signals?.[target.key]?.ai?.model).toBe("fake");

    const b = mk("bob");
    await b.open();
    expect(decision(b, "APP-005").aiReading).toEqual(META);
    expect(decision(b, "APP-005").evidence.some((e) => e.code === "A17" && e.quote.toLowerCase() === quote)).toBe(true);
    expect(JSON.stringify(computeResult(b.session!).decisions)).toBe(JSON.stringify(computeResult(a.session!).decisions));
  });

  it("releasing the hold with nothing read (AI off) sends the workspace on keywords alone", async () => {
    const { repo, t, base } = setup();
    const a = WorkspaceClient.fromUpload({ id: ID, transport: t, cache: memoryCache(), clientId: "alice", base, name: "t", parentId: null, holdSync: true });
    a.setSignals({});
    await a.round();
    expect(repo.workspaces.has(ID)).toBe(true);
    expect(repo.workspaces.get(ID)!.baseData.signals).toBeUndefined();
    expect(decision(a, "APP-005").aiReading).toBeNull();
  });

  it("a retry is a change-log event: shared, replayed the same everywhere, and undoable", async () => {
    const { repo, t, base, target, reading, mk } = setup();
    const a = WorkspaceClient.fromUpload({ id: ID, transport: t, cache: memoryCache(), clientId: "alice", base, name: "t", parentId: null });
    await a.round();
    const before = JSON.stringify(computeResult(a.session!).decisions);
    expect(decision(a, "APP-005").aiReading).toBeNull();

    const out = a.commit({ source: "ai_notes", description: "AI reading of notes (1 application)", signals: { [target.key]: reading } });
    expect(out.ok).toBe(true);
    expect(decision(a, "APP-005").aiReading).toEqual(META);
    await a.round();
    expect(repo.workspaces.get(ID)!.events[0].type).toBe("fact");

    const b = mk("bob");
    await b.open();
    expect(b.entries[0]).toMatchObject({ source: "ai_notes", description: "AI reading of notes (1 application)" });
    expect(JSON.stringify(computeResult(b.session!).decisions)).toBe(JSON.stringify(computeResult(a.session!).decisions));

    a.undo(a.entries[0].id);
    await a.round();
    expect(JSON.stringify(computeResult(a.session!).decisions)).toBe(before);
  });
});

describe("G4.1 the app works fully with the AI off", () => {
  it("every AI route answers 503 with no key, and the health check says so", async () => {
    expect((await extract(null, JSON.stringify({ items: [{ id: "A", business: "x", notes: "y" }] }))).status).toBe(503);
    expect((await chat(null, JSON.stringify({ mode: "route", message: "why APP-1?" }))).status).toBe(503);
    expect((await chat(null, JSON.stringify({ mode: "phrase", question: "q", facts: "f" }))).status).toBe(503);
    expect((await message(null, JSON.stringify({ appId: "A", language: "English", status: "HOLD", label: "On hold", headline: "h", steps: [] }))).status).toBe(503);
    const saved = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    expect((await health(null, false)).geminiConfigured).toBe(false);
    if (saved !== undefined) process.env.GEMINI_API_KEY = saved;
  });

  it("decisions don't depend on the AI: with nothing read, they are exactly the keyword-reader decisions", async () => {
    const { base } = setup();
    const withNone = computeResult({ ...base, entries: [], feedback: [], reviewed: true } as never);
    const r = await readNotes(base.parsed.applications, { extract: async () => ({ ok: false, results: {}, model: null }) });
    const after = computeResult({ ...base, signals: r.signals, entries: [], feedback: [], reviewed: true } as never);
    expect(JSON.stringify(after.decisions)).toBe(JSON.stringify(withNone.decisions));
  });
});
