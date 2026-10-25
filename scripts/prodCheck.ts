// Two clients on one workspace against a deployed URL (default: production). Creates a workspace named
// "e2e-check", exercises it, prints a short report. Delete the row afterwards (the script prints its id).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseWorkbooks } from "@/lib/ingest/parseWorkbook";
import { computeResult, newSession } from "@/lib/state/session";
import { memoryCache } from "@/lib/workspace/cache";
import { WorkspaceClient } from "@/lib/workspace/client";
import type { Transport } from "@/lib/workspace/transport";

const BASE = process.argv[2] ?? "https://onboarding-engine-dun.vercel.app";
const call = async (path: string, init?: RequestInit) => {
  try {
    const res = await fetch(BASE + path, { ...init, cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true as const, data: body };
    const m = body.error ?? String(res.status);
    return { ok: false as const, kind: res.status === 404 ? ("not_found" as const) : res.status < 500 && res.status !== 429 ? ("rejected" as const) : ("network" as const), message: m };
  } catch {
    return { ok: false as const, kind: "network" as const, message: "unreachable" };
  }
};
const t: Transport = {
  create: (b) => call("/api/workspaces", { method: "POST", body: JSON.stringify(b) }),
  get: (id, s, base = true) => call(`/api/workspaces/${id}?since=${s}${base ? "" : "&base=0"}`),
  post: (id, e) => call(`/api/workspaces/${id}/events`, { method: "POST", body: JSON.stringify(e) }),
  list: () => call("/api/workspaces"),
};

async function main() {
const bytes = new Uint8Array(readFileSync(join("tests", "fixtures", "tricky.xlsx")));
const r = parseWorkbooks([{ name: "tricky.xlsx", size: bytes.length, data: bytes }]);
if (!r.ok) throw new Error("fixture");
const s = newSession({ files: ["e2e-check"], applications: r.applications, territories: r.territories, skippedExample: r.skippedExample, report: r.report, today: "2026-10-25" });
const id = crypto.randomUUID();
const mk = (cid: string) => new WorkspaceClient({ id, transport: t, cache: memoryCache(), clientId: cid });
const a = WorkspaceClient.fromUpload({ id, transport: t, cache: memoryCache(), clientId: "alice", base: { files: s.files, parsed: s.parsed, base: s.base, policy: s.policy }, name: "e2e-check", parentId: null });
await a.round();
const b = mk("bob");
await b.open();
a.commit({ source: "manual", description: "APP-012 found a ground-floor space", directKeys: ["APP-012"], facts: [{ target: "application", key: "APP-012", field: "spaceAvailable", value: "Rented" }, { target: "application", key: "APP-012", field: "floor", value: "Ground" }] });
b.commit({ source: "manual", description: "APP-003 withdrew", directKeys: ["APP-003"], facts: [{ target: "application", key: "APP-003", field: "withdrawn", value: true }] });
await Promise.all([a.round(), b.round()]);
await Promise.all([a.round(), b.round()]);
const late = mk("late");
await late.open();
const dec = (c: WorkspaceClient) => JSON.stringify(computeResult(c.session!).decisions);
const events = ((await t.get(id, 0)) as { data: { events: { seq: number }[] } }).data.events;
console.log(JSON.stringify({ id, seqs: events.map((e) => e.seq), sameDecisions: dec(a) === dec(b) && dec(b) === dec(late), bothChangesKept: a.entries.length === 2, toastForAlice: a.toasts.map((x) => x.text.slice(0, 70)), status: [a.status, b.status] }, null, 1));
}
void main();
