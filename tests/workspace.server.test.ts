// Shared workspaces, server side (SPEC §16): G10.1, G10.2, G10.5 and G10.6, against the in-memory repository.

import { beforeEach, describe, expect, it } from "vitest";
import { MemoryRepo } from "@/lib/server/repo";
import { appendEvent, createWorkspace, getWorkspace, listWorkspaces } from "@/lib/server/handlers";
import { checkRate, resetRateLimits } from "@/lib/server/rateLimit";
import { commitChange, computeResult, newSession, undoEntry, type Session } from "@/lib/state/session";
import { classifyChange, type BaseData, type ChangePayload, type NewEvent, type StoredEvent } from "@/lib/workspace/schemas";
import { orderLog, replayEntries, sessionFrom, type LogEvent } from "@/lib/workspace/replay";
import { parseOk, trickyFile } from "./helpers";

const NOW = "2026-10-26T09:00:00.000Z";

function trickySession(): Session {
  const r = parseOk([trickyFile()]);
  return newSession({ files: ["tricky.xlsx"], applications: r.applications, territories: r.territories, skippedExample: r.skippedExample, report: r.report, today: "2026-10-25" });
}
const baseOf = (s: Session): BaseData => ({ files: s.files, parsed: s.parsed, base: s.base, policy: s.policy, signals: s.signals });

const foundSpace: ChangePayload = {
  source: "manual",
  description: "APP-012 found a ground-floor space",
  directKeys: ["APP-012"],
  facts: [
    { target: "application", key: "APP-012", field: "spaceAvailable", value: "Rented" },
    { target: "application", key: "APP-012", field: "floor", value: "Ground" },
  ],
};
const withdrawn: ChangePayload = {
  source: "manual",
  description: "APP-003 withdrew",
  directKeys: ["APP-003"],
  facts: [{ target: "application", key: "APP-003", field: "withdrawn", value: true }],
};
const moreSlots: ChangePayload = {
  source: "manual",
  description: "TER-02 now has 2 slots",
  facts: [{ target: "territory", key: "TER-02", field: "openSlots", value: 2 }],
};

const ID = "11111111-1111-4111-8111-111111111111";

function ev(payload: ChangePayload, clientId: string, clientEventId: string): NewEvent {
  return { type: classifyChange(payload), payload, clientId, clientEventId } as NewEvent;
}
const body = (e: unknown) => JSON.stringify(e);

async function makeWorkspace(repo: MemoryRepo, id = ID, extra: Record<string, unknown> = {}) {
  const s = trickySession();
  return createWorkspace(
    repo,
    body({ id, name: "tricky.xlsx", brandProfile: "eyewear", sourceFilename: "tricky.xlsx", rowCounts: { applications: 38, territories: 6 }, baseData: baseOf(s), ...extra }),
  );
}

function toLog(events: StoredEvent[]): LogEvent[] {
  return events.map((e) => ({ ...e }));
}
async function load(repo: MemoryRepo, id = ID) {
  const r = await getWorkspace(repo, id, "0");
  const b = r.body as { baseData: BaseData; events: StoredEvent[] };
  const entries = replayEntries(b.baseData, orderLog(toLog(b.events), []));
  const session = sessionFrom(b.baseData, entries, { feedback: [], reviewed: true });
  return { session, events: b.events, decisions: JSON.stringify(computeResult(session).decisions) };
}

let repo: MemoryRepo;
beforeEach(() => {
  repo = new MemoryRepo();
  resetRateLimits();
});

describe("create, list, read", () => {
  it("creates a workspace, lists it, and returns its base data only when since is 0", async () => {
    expect((await makeWorkspace(repo)).status).toBe(201);
    const list = (await listWorkspaces(repo)).body as { workspaces: { id: string; name: string }[] };
    expect(list.workspaces.map((w) => w.id)).toEqual([ID]);
    expect(JSON.stringify(list)).not.toContain("baseData");
    const first = (await getWorkspace(repo, ID, "0")).body as { baseData: unknown };
    expect(first.baseData).not.toBeNull();
    const later = (await getWorkspace(repo, ID, "3")).body as { baseData: unknown };
    expect(later.baseData).toBeNull();
    // A poll with nothing new yet (since=0) can still ask not to be sent the data again.
    const poll = (await getWorkspace(repo, ID, "0", "0")).body as { baseData: unknown };
    expect(poll.baseData).toBeNull();
  });

  it("lists only the 20 most recent", async () => {
    for (let i = 0; i < 25; i++) await makeWorkspace(repo, `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(((await listWorkspaces(repo)).body as { workspaces: unknown[] }).workspaces).toHaveLength(20);
  });

  it("answers 404 for an unknown workspace and 400 for a malformed id", async () => {
    expect((await getWorkspace(repo, "22222222-2222-4222-8222-222222222222", "0")).status).toBe(404);
    expect((await getWorkspace(repo, "not-an-id", "0")).status).toBe(400);
  });
});

describe("G10.1 two clients appending at once", () => {
  it("keeps both changes, gives different seqs, and both end with the same decisions", async () => {
    await makeWorkspace(repo);
    const before = (await load(repo)).decisions;
    const [a, b] = await Promise.all([
      appendEvent(repo, ID, body(ev(foundSpace, "clientA", "a1"))),
      appendEvent(repo, ID, body(ev(withdrawn, "clientB", "b1"))),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    const seqs = [(a.body as { seq: number }).seq, (b.body as { seq: number }).seq];
    expect(new Set(seqs).size).toBe(2);
    const { events, decisions, session } = await load(repo);
    expect(events).toHaveLength(2);
    expect(decisions).not.toBe(before);
    const keys = computeResult(session).decisions.map((d) => d.appKey);
    expect(keys).not.toContain("APP-003"); // B's withdrawal is in
    expect(session.entries.map((e) => e.description)).toEqual(expect.arrayContaining([foundSpace.description, withdrawn.description])); // and so is A's
    // A client that joined late, and one that has followed along, replay to the same thing.
    const again = await load(repo);
    expect(again.decisions).toBe(decisions);
  });

  it("gives many simultaneous appends gap-free, distinct seqs", async () => {
    await makeWorkspace(repo);
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => appendEvent(repo, ID, body(ev(moreSlots, `c${i}`, `e${i}`)))));
    const seqs = results.map((r) => (r.body as { seq: number }).seq).sort((x, y) => x - y);
    expect(seqs).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  });

  it("stores a retried event once (the same client event id)", async () => {
    await makeWorkspace(repo);
    const e = body(ev(foundSpace, "clientA", "a1"));
    const first = await appendEvent(repo, ID, e);
    const second = await appendEvent(repo, ID, e);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect((second.body as { duplicate: boolean }).duplicate).toBe(true);
    expect((second.body as { seq: number }).seq).toBe((first.body as { seq: number }).seq);
    expect((await load(repo)).events).toHaveLength(1);
  });
});

describe("G10.2 replay equals live", () => {
  it("a client that replays the stored events shows exactly the decisions the live session showed", async () => {
    await makeWorkspace(repo);
    let live = trickySession();
    const steps: ChangePayload[] = [foundSpace, withdrawn, moreSlots];
    const sent: string[] = [];
    for (const [i, p] of steps.entries()) {
      const out = commitChange(live, { ...p }, NOW);
      expect(out.ok).toBe(true);
      if (out.ok) live = out.session;
      const r = await appendEvent(repo, ID, body(ev(p, "me", `m${i}`)));
      sent.push(`m${i}`);
      expect(r.status).toBe(201);
    }
    // Undo the first change: live marks it undone; the server gets an undo event for seq 1.
    live = undoEntry(live, live.entries[0].id);
    expect((await appendEvent(repo, ID, body({ type: "undo", payload: { targetSeq: 1 }, clientId: "me", clientEventId: "m3" }))).status).toBe(201);

    const replayed = await load(repo);
    expect(replayed.decisions).toBe(JSON.stringify(computeResult(live).decisions));
    expect(replayed.session.entries.filter((e) => e.undone).map((e) => e.description)).toEqual([foundSpace.description]);
  });

  it("is the same whatever order the events were typed in: replay is by seq", async () => {
    await makeWorkspace(repo);
    await appendEvent(repo, ID, body(ev(moreSlots, "x", "1")));
    await appendEvent(repo, ID, body(ev(foundSpace, "y", "2")));
    const { events } = await load(repo);
    const b = ((await getWorkspace(repo, ID, "0")).body as { baseData: BaseData }).baseData;
    const forward = JSON.stringify(computeResult(sessionFrom(b, replayEntries(b, orderLog(toLog(events), [])), { feedback: [], reviewed: true })).decisions);
    const shuffled = JSON.stringify(computeResult(sessionFrom(b, replayEntries(b, orderLog(toLog([...events].reverse()), [])), { feedback: [], reviewed: true })).decisions);
    expect(shuffled).toBe(forward);
  });
});

describe("G10.5 malformed and oversized input is rejected", () => {
  beforeEach(async () => {
    await makeWorkspace(repo);
  });
  const post = (e: unknown) => appendEvent(repo, ID, typeof e === "string" ? e : body(e));
  const good = () => ev(foundSpace, "a", "a1");

  it("rejects text that isn't JSON", async () => {
    const r = await post("{nope");
    expect(r.status).toBe(400);
  });
  it("rejects a missing or unknown type, missing payload, and missing client ids", async () => {
    expect((await post({ ...good(), type: "explode" })).status).toBe(400);
    expect((await post({ type: "fact", clientId: "a", clientEventId: "a1" })).status).toBe(400);
    expect((await post({ ...good(), clientId: undefined })).status).toBe(400);
  });
  it("rejects an event whose label doesn't match what it contains", async () => {
    const r = await post({ ...good(), type: "lock" });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toMatch(/labelled/);
  });
  it("rejects extra, unknown fields", async () => {
    expect((await post({ ...good(), payload: { ...foundSpace, sneaky: 1 } })).status).toBe(400);
  });
  it("rejects fact values the engine doesn't allow", async () => {
    for (const [field, value] of [["city", "Atlantis"], ["floor", "Penthouse"], ["language", "Klingon"], ["spaceAvailable", "maybe"], ["pin", "12"], ["investmentLakh", "lots"], ["experienceYears", -3]] as const) {
      const p: ChangePayload = { source: "manual", description: "x", facts: [{ target: "application", key: "APP-001", field, value }] };
      const r = await post(ev(p, "a", `bad-${field}`));
      expect(r.status, `${field}=${value}`).toBe(400);
    }
    const slots: ChangePayload = { source: "manual", description: "x", facts: [{ target: "territory", key: "TER-02", field: "openSlots", value: -1 }] };
    expect((await post(ev(slots, "a", "bad-slots"))).status).toBe(400);
  });
  it("rejects a payload over 10 KB", async () => {
    const huge: ChangePayload = { ...foundSpace, description: "x".repeat(200), facts: Array.from({ length: 50 }, () => ({ target: "application" as const, key: "A".repeat(100), field: "notes" as const, value: "n".repeat(300) })) };
    const r = await post(ev(huge, "a", "huge"));
    expect(r.status).toBe(413);
  });
  it("rejects an empty change", async () => {
    expect((await post(ev({ source: "manual", description: "nothing" } as ChangePayload, "a", "empty"))).status).toBe(400);
  });
  it("rejects an undo of an unknown event, and an undo of an undo", async () => {
    expect((await post({ type: "undo", payload: { targetSeq: 99 }, clientId: "a", clientEventId: "u0" })).status).toBe(400);
    await post(good());
    expect((await post({ type: "undo", payload: { targetSeq: 1 }, clientId: "a", clientEventId: "u1" })).status).toBe(201);
    expect((await post({ type: "undo", payload: { targetSeq: 2 }, clientId: "a", clientEventId: "u2" })).status).toBe(400);
  });
  it("answers 404 for events to a workspace that doesn't exist, and 400 for a bad link", async () => {
    expect((await appendEvent(repo, "33333333-3333-4333-8333-333333333333", body(good()))).status).toBe(404);
    expect((await appendEvent(repo, "nope", body(good()))).status).toBe(400);
  });
  it("rejects bad workspace data: not JSON, wrong shape, over 2 MB", async () => {
    expect((await createWorkspace(repo, "<html>")).status).toBe(400);
    expect((await createWorkspace(repo, body({ name: "x" }))).status).toBe(400);
    const s = trickySession();
    const bloated = { name: "big", brandProfile: "eyewear", rowCounts: { applications: 1, territories: 1 }, baseData: { ...baseOf(s), files: ["x".repeat(2.2 * 1024 * 1024)] } };
    expect((await createWorkspace(repo, body(bloated))).status).toBe(413);
    expect(repo.workspaces.size).toBe(1);
  });
  it("rejects a bad since", async () => {
    expect((await getWorkspace(repo, ID, "-1")).status).toBe(400);
    expect((await getWorkspace(repo, ID, "abc")).status).toBe(400);
  });
  it("stops at 5,000 events", async () => {
    repo.workspaces.get(ID)!.nextSeq = 5001;
    const r = await post(good());
    expect(r.status).toBe(409);
  });
});

describe("G10.6 opening and re-uploading never modify an existing workspace", () => {
  it("reading and listing write nothing", async () => {
    await makeWorkspace(repo);
    await appendEvent(repo, ID, body(ev(foundSpace, "a", "a1")));
    const writes = [...repo.writes];
    await getWorkspace(repo, ID, "0");
    await getWorkspace(repo, ID, "1");
    await listWorkspaces(repo);
    expect(repo.writes).toEqual(writes);
  });
  it("creating with an id that already exists leaves it exactly as it was", async () => {
    await makeWorkspace(repo);
    await appendEvent(repo, ID, body(ev(foundSpace, "a", "a1")));
    const snapshot = JSON.stringify(repo.workspaces.get(ID));
    const again = await makeWorkspace(repo, ID, { name: "someone else's replacement" });
    expect(again.status).toBe(200);
    expect((again.body as { existed: boolean }).existed).toBe(true);
    expect(JSON.stringify(repo.workspaces.get(ID))).toBe(snapshot);
  });
  it("a re-upload is a new workspace that links back to the old one", async () => {
    await makeWorkspace(repo);
    const snapshot = JSON.stringify(repo.workspaces.get(ID));
    const r = await makeWorkspace(repo, "44444444-4444-4444-8444-444444444444", { parentId: ID });
    expect(r.status).toBe(201);
    expect(repo.workspaces.get("44444444-4444-4444-8444-444444444444")!.summary.parentId).toBe(ID);
    expect(JSON.stringify(repo.workspaces.get(ID))).toBe(snapshot);
  });
});

describe("rate limit", () => {
  it("allows up to the limit in a minute, then asks the caller to wait, per bucket and per address", () => {
    const limits = { read: 3, write: 2, create: 1 };
    const t = 1_000_000;
    expect([1, 2, 3].map(() => checkRate("1.1.1.1", "read", t, limits))).toEqual([0, 0, 0]);
    expect(checkRate("1.1.1.1", "read", t + 1000, limits)).toBeGreaterThan(0);
    expect(checkRate("2.2.2.2", "read", t + 1000, limits)).toBe(0);
    expect(checkRate("1.1.1.1", "write", t + 1000, limits)).toBe(0);
    expect(checkRate("1.1.1.1", "read", t + 61_000, limits)).toBe(0);
  });
});
