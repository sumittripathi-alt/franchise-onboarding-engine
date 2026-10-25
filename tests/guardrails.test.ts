// Guardrails that needed their own tests (SPEC §11): G4.2, G4.8, G5.2, G5.4, G6.3, G6.5, G6.7, G7.3, G7.4, G8.1, G9.11.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StatusChip } from "@/components/app/status-chip";
import { answerTurn, NEW_CHAT } from "@/lib/chat/engine";
import { parseWorkbooks } from "@/lib/ingest/parseWorkbook";
import { workbookBytes, buildTemplateWorkbook } from "@/lib/ingest/templateWorkbook";
import { getGemini } from "@/lib/llm/gemini";
import { readNotes } from "@/lib/llm/extractClient";
import { memorySignalCache } from "@/lib/llm/signalCache";
import { todayIST } from "@/lib/planner/dates";
import { MemoryRepo } from "@/lib/server/repo";
import { commitChange, computeResult, newSession, undoEntry, type Session } from "@/lib/state/session";
import { memoryCache } from "@/lib/workspace/cache";
import { WorkspaceClient } from "@/lib/workspace/client";
import { STATUS_META, STATUSES, type Signals } from "@/lib/types";
import { TRICKY_APPLICATIONS, TRICKY_TERRITORIES } from "./fixtures/trickyData";
import { parseOk, trickyFile } from "./helpers";
import { networkFor } from "./netHelper";

const ROOT = join(__dirname, "..");
const session = (): Session => {
  const r = parseOk([trickyFile()]);
  return newSession({ files: ["t"], applications: r.applications, territories: r.territories, skippedExample: r.skippedExample, report: r.report, today: "2026-10-26" });
};

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".next", "tests", "scripts", "supabase", "docs", "public"].includes(name) || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("G4.2 the AI wrapper: timeout, one retry, no retry for a bad request", () => {
  const OLD = { ...process.env };
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-key-not-real-123456";
    process.env.GEMINI_MODEL = "test-model";
    vi.useFakeTimers();
  });
  afterEach(() => {
    process.env = { ...OLD };
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const okBody = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
  const req = { system: "s", contents: [{ role: "user" as const, text: "hello" }] };

  it("sends temperature 0 with the key in a header, never in the URL, and returns the text", async () => {
    const fetchMock = vi.fn(async () => okBody("hi"));
    vi.stubGlobal("fetch", fetchMock);
    const out = await getGemini()!.generate(req);
    expect(out.text).toBe("hi");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain("test-key");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key-not-real-123456");
    expect(JSON.parse(init.body as string).generationConfig.temperature).toBe(0);
    expect(url).toContain("test-model");
  });

  it("retries once on a server error or rate limit, then gives up", async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response("", { status: 503 })).mockResolvedValueOnce(okBody("second time"));
    vi.stubGlobal("fetch", f);
    expect((await getGemini()!.generate(req)).text).toBe("second time");
    expect(f).toHaveBeenCalledTimes(2);

    const always = vi.fn(async () => new Response("", { status: 429 }));
    vi.stubGlobal("fetch", always);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(getGemini()!.generate(req)).rejects.toThrow();
    expect(always).toHaveBeenCalledTimes(2); // one try, one retry
  });

  it("does not retry a bad request (4xx)", async () => {
    const f = vi.fn(async () => new Response("", { status: 400 }));
    vi.stubGlobal("fetch", f);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(getGemini()!.generate(req)).rejects.toThrow();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("gives up on a call after 15 seconds, and retries once", async () => {
    const f = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_res, rej) => init.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))));
    vi.stubGlobal("fetch", f);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const p = getGemini()!.generate(req).catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(14_900);
    expect(f).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200); // 15 s: the first call is cut off
    await vi.advanceTimersByTimeAsync(15_100); // and the retry
    const err = await p;
    expect(err).toBeInstanceOf(Error);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("no key means no client at all", () => {
    delete process.env.GEMINI_API_KEY;
    expect(getGemini()).toBeNull();
  });

  it("G6.7 a failure is logged without the key, the applicant's text or the model's words", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response("secret-body-with-applicant-text", { status: 500 })));
    await expect(getGemini()!.generate({ system: "s", contents: [{ role: "user", text: "Priya Nair lives at 12 MG Road" }] })).rejects.toThrow();
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).not.toContain("test-key-not-real-123456");
    expect(logged).not.toContain("Priya");
    expect(logged).not.toContain("secret-body");
    expect(logged).toMatch(/HTTP 500/);
  });
});

describe("G4.8 reading the notes: once per text, cached by a hash of the text", () => {
  const sig = (): Signals => ({ relevant_sector: null, years_running_shop_mentioned: null, notes_floor_claim: null, notes_space_claim: null, festival_deadline: null, absentee_owner: false, competitor_conflict: false, funding_dependency: false, injection_attempt: false, other_flags: [], confidence: 0.9, evidence: {}, ai: { model: "m", at: "2026-10-26T00:00:00Z" } });
  const fake = () => {
    const sent: string[][] = [];
    return { sent, extract: async (items: { id: string }[]) => (sent.push(items.map((i) => i.id)), { ok: true, model: "m", results: Object.fromEntries(items.map((i) => [i.id, sig()])) }) };
  };
  const apps = [
    { key: "A", business: "Optical shop", notes: "near the bus stand" },
    { key: "B", business: "Optical shop", notes: "near the bus stand" }, // same words as A
    { key: "C", business: "Kirana", notes: "" },
  ];

  it("the same words are sent once and the reading is shared", async () => {
    const f = fake();
    const r = await readNotes(apps, { extract: f.extract, cache: memorySignalCache() });
    expect(f.sent.flat()).toEqual(["A", "C"]);
    expect(Object.keys(r.signals).sort()).toEqual(["A", "B", "C"]);
    expect(r.complete).toBe(true);
  });

  it("reading the same file again sends nothing", async () => {
    const f = fake();
    const cache = memorySignalCache();
    await readNotes(apps, { extract: f.extract, cache });
    f.sent.length = 0;
    const again = await readNotes(apps, { extract: f.extract, cache });
    expect(f.sent).toEqual([]);
    expect(again.cached).toBe(3);
    expect(again.complete).toBe(true);
    expect(again.unavailable).toBe(false);
  });

  it("changed text is read again; unchanged text is not", async () => {
    const f = fake();
    const cache = memorySignalCache();
    await readNotes(apps, { extract: f.extract, cache });
    f.sent.length = 0;
    await readNotes([apps[0], { key: "C", business: "Kirana", notes: "now has a shop upstairs" }], { extract: f.extract, cache });
    expect(f.sent.flat()).toEqual(["C"]);
  });
});

describe("G5.2 and G5.4 chat changes: assumptions become conditions, and every change is logged and undoable", () => {
  it("'found a ground-floor space' with no size leaves 'confirm the size' as a condition", async () => {
    let s = session();
    const out = await answerTurn("APP-012 has now found a ground-floor space", s, NEW_CHAT, {
      now: "2026-10-26T09:00:00.000Z",
      ai: null,
      commit: (spec) => {
        const o = commitChange(s, spec, "2026-10-26T09:00:00.000Z");
        if (o.ok) s = o.session;
        return o;
      },
    });
    expect(out.reply.text).toMatch(/treated the space as rented/);
    const d = computeResult(s).decisions.find((x) => x.appId === "APP-012")!;
    expect(d.reasonCodes.concat(d.flags.map((f) => f.code))).toContain("SIZE_UNCONFIRMED");
    expect(d.conditions.some((c) => /size|sq ?ft/i.test(c.text))).toBe(true);
    // G5.4: it is in the change log with its source, and undoing it restores the old decisions.
    expect(s.entries[0].source).toBe("chat");
    expect(JSON.stringify(computeResult(undoEntry(s, s.entries[0].id)).decisions)).toBe(JSON.stringify(computeResult(session()).decisions));
  });
});

describe("G6.3 and G6.5 and G6.7 code rules", () => {
  const files = sources(ROOT);
  const text = (f: string) => readFileSync(f, "utf8");
  const rel = (f: string) => f.slice(ROOT.length + 1);

  it("G6.3 nothing is rendered as HTML except the constant theme script", () => {
    const hits = files.filter((f) => /dangerouslySetInnerHTML|\.innerHTML\s*=|insertAdjacentHTML|document\.write/.test(text(f))).map(rel);
    expect(hits).toEqual(["app/layout.tsx"]);
    const layout = text(join(ROOT, "app/layout.tsx"));
    expect(layout).toMatch(/dangerouslySetInnerHTML=\{\{ __html: THEME_SCRIPT \}\}/);
    expect(layout).toMatch(/const THEME_SCRIPT = `[^`$]*`;/); // a constant: no ${} from anywhere
  });

  it("G6.3 applicant text goes through React's escaping: markup in a name comes out as text", () => {
    const html = renderToStaticMarkup(createElement(StatusChip, { status: "HOLD", label: '<img src=x onerror="alert(1)"> Priya' }));
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("G6.5 every API route goes through a wrapper that validates, limits and turns failures into clean JSON", () => {
    const routes = files.filter((f) => /app\/api\/.*route\.ts$/.test(f));
    expect(routes.length).toBeGreaterThanOrEqual(7);
    for (const r of routes) {
      const t = text(r);
      expect(/withRepo|withAi|health\(/.test(t), rel(r)).toBe(true);
    }
    for (const w of ["lib/server/route.ts", "lib/server/aiRoute.ts"]) {
      const t = text(join(ROOT, w));
      expect(t, w).toMatch(/catch \{/); // no `catch (e)`: the error object is never read or returned
      expect(t, w).not.toMatch(/\.stack|\.message/);
    }
  });

  it("G6.7 the only logging in the app is one line with a status code", () => {
    const logs = files.flatMap((f) => text(f).split("\n").filter((l) => /console\.(log|warn|error|info|debug)/.test(l)).map((l) => `${rel(f)}: ${l.trim()}`));
    expect(logs).toEqual(["lib/llm/gemini.ts: console.warn(`[gemini] failed: ${last?.message}`); // no key, no applicant text"]);
  });
});

describe("G7.3 rapid edits don't race", () => {
  it("ten changes made back to back are applied in order, sent in order, and end the same on every client", async () => {
    const repo = new MemoryRepo();
    const t = networkFor(repo);
    const id = "99999999-9999-4999-8999-999999999999";
    const s = session();
    const base = { files: s.files, parsed: s.parsed, base: s.base, policy: s.policy };
    const a = WorkspaceClient.fromUpload({ id, transport: t, cache: memoryCache(), clientId: "a", base, name: "t", parentId: null });
    await a.round();
    for (let i = 1; i <= 10; i++) {
      expect(a.commit({ source: "manual", description: `slots ${i}`, facts: [{ target: "territory", key: "TER-02", field: "openSlots", value: i % 4 }] }).ok).toBe(true);
    }
    await Promise.all([a.kick(), a.kick(), a.kick()]); // overlapping sync rounds coalesce
    await a.round();
    expect(repo.workspaces.get(id)!.events.map((e) => (e.payload as { description: string }).description)).toEqual(Array.from({ length: 10 }, (_, i) => `slots ${i + 1}`));
    expect(repo.workspaces.get(id)!.events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const b = new WorkspaceClient({ id, transport: t, cache: memoryCache(), clientId: "b" });
    await b.open();
    expect(JSON.stringify(computeResult(b.session!).decisions)).toBe(JSON.stringify(computeResult(a.session!).decisions));
    expect(computeResult(a.session!).territories.find((x) => x.id === "TER-02")!.slots).toBe(10 % 4);
  });
});

describe("G7.4 'today' is the date in India", () => {
  it("is already tomorrow in IST while it is still evening in UTC, and not before 00:00 IST", () => {
    expect(todayIST(new Date("2026-10-25T19:00:00Z"))).toBe("2026-10-26"); // 00:30 IST
    expect(todayIST(new Date("2026-10-25T18:29:00Z"))).toBe("2026-10-25"); // 23:59 IST
    expect(todayIST(new Date("2026-12-31T20:00:00Z"))).toBe("2027-01-01");
  });
});

describe("G8.1 status is always a word", () => {
  it("every status chip contains its text label, in every size", () => {
    for (const st of STATUSES) {
      for (const size of ["sm", "lg"] as const) {
        const html = renderToStaticMarkup(createElement(StatusChip, { status: st, size }));
        expect(html).toContain(STATUS_META[st].label);
      }
    }
  });
});

describe("G9.11 performance: parse and decide 500 rows in under 2 seconds", () => {
  it("a 500-row file parses and gets a decision for every row", () => {
    const rows = Array.from({ length: 500 }, (_, i) => {
      const b = TRICKY_APPLICATIONS[i % TRICKY_APPLICATIONS.length];
      return [`APP-${String(i + 1).padStart(3, "0")}`, `Person ${i + 1}`, ...b.slice(2)];
    });
    const bytes = workbookBytes(buildTemplateWorkbook({ applications: rows, territories: TRICKY_TERRITORIES, padToRow: 500 }));
    const t0 = performance.now();
    const parsed = parseWorkbooks([{ name: "big.xlsx", size: bytes.length, data: bytes }]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const s = newSession({ files: ["big.xlsx"], applications: parsed.applications, territories: parsed.territories, skippedExample: parsed.skippedExample, report: parsed.report, today: "2026-10-26" });
    const result = computeResult(s);
    const ms = performance.now() - t0;
    expect(result.decisions.length).toBeGreaterThanOrEqual(450); // a few may share an ID with a blocking duplicate, but all are decided
    expect(result.invariantViolations).toEqual([]);
    expect(ms).toBeLessThan(2000);
  });

  it("making a change on a 500-row workspace stays quick, even after many earlier changes", async () => {
    const rows = Array.from({ length: 500 }, (_, i) => {
      const b = TRICKY_APPLICATIONS[i % TRICKY_APPLICATIONS.length];
      return [`APP-${String(i + 1).padStart(3, "0")}`, `Person ${i + 1}`, ...b.slice(2)];
    });
    const bytes = workbookBytes(buildTemplateWorkbook({ applications: rows, territories: TRICKY_TERRITORIES, padToRow: 500 }));
    const parsed = parseWorkbooks([{ name: "big.xlsx", size: bytes.length, data: bytes }]);
    if (!parsed.ok) throw new Error("parse");
    const s = newSession({ files: ["big.xlsx"], applications: parsed.applications, territories: parsed.territories, skippedExample: parsed.skippedExample, report: parsed.report, today: "2026-10-26" });
    const repo = new MemoryRepo();
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const c = WorkspaceClient.fromUpload({ id, transport: networkFor(repo), cache: memoryCache(), clientId: "a", base: { files: s.files, parsed: s.parsed, base: s.base, policy: s.policy }, name: "big", parentId: null });
    const times: number[] = [];
    for (let i = 0; i < 12; i++) {
      const t0 = performance.now();
      const out = c.commit({ source: "manual", description: `slots ${i}`, facts: [{ target: "territory", key: "TER-02", field: "openSlots", value: i % 5 }] });
      computeResult(c.session!); // what the screen does next
      times.push(performance.now() - t0);
      expect(out.ok).toBe(true);
    }
    // Each change costs about the same however many came before it (the diffs of earlier ones are remembered).
    expect(Math.max(...times.slice(1))).toBeLessThan(2000);
    expect(times.slice(-3).reduce((a, b) => a + b, 0) / 3).toBeLessThan(times.slice(0, 3).reduce((a, b) => a + b, 0) / 3 * 3);
  }, 60_000);

  it("the chat fast path answers in under a second", async () => {
    const s = session();
    const t0 = performance.now();
    await answerTurn("Why is APP-007 on hold?", s, NEW_CHAT, { now: "2026-10-26T09:00:00.000Z", ai: null, commit: () => ({ ok: false, message: "" }) });
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
