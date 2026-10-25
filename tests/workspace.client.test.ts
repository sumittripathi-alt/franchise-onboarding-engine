// Shared workspaces, client side (SPEC §16.3): sync, offline, recovery, and two viewers on one workspace
// (G10.1 to G10.3), with a fake network wired straight to the route handlers and an in-memory database.

import { beforeEach, describe, expect, it } from "vitest";
import { MemoryRepo } from "@/lib/server/repo";
import { appendEvent, createWorkspace, getWorkspace, listWorkspaces } from "@/lib/server/handlers";
import { computeResult, newSession, type ChangeSpec, type Session } from "@/lib/state/session";
import { memoryCache, type CacheStore } from "@/lib/workspace/cache";
import { OFFLINE_MESSAGE, WorkspaceClient } from "@/lib/workspace/client";
import type { BaseData, NewEvent } from "@/lib/workspace/schemas";
import type { Res, Transport } from "@/lib/workspace/transport";
import { parseOk, trickyFile } from "./helpers";

const ID = "55555555-5555-4555-8555-555555555555";

function trickySession(): Session {
  const r = parseOk([trickyFile()]);
  return newSession({ files: ["tricky.xlsx"], applications: r.applications, territories: r.territories, skippedExample: r.skippedExample, report: r.report, today: "2026-10-25" });
}
const baseOf = (s: Session): BaseData => ({ files: s.files, parsed: s.parsed, base: s.base, policy: s.policy, signals: s.signals });

function reply<T>(r: { status: number; body: unknown }): Res<T> {
  if (r.status >= 200 && r.status < 300) return { ok: true, data: r.body as T };
  const message = (r.body as { error?: string }).error ?? "";
  if (r.status === 404) return { ok: false, kind: "not_found", message };
  if (r.status === 409) return { ok: false, kind: "limit", message };
  if (r.status === 400 || r.status === 413) return { ok: false, kind: "rejected", message };
  return { ok: false, kind: "network", message };
}

/** A network that calls the handlers directly. Throwing repositories look like an unreachable server. */
function network(repo: MemoryRepo, hooks: { dropReplies?: () => boolean; refuse?: (ev: NewEvent) => boolean } = {}): Transport & { posts: string[] } {
  const guard = async <T>(f: () => Promise<{ status: number; body: unknown }>): Promise<Res<T>> => {
    try {
      return reply<T>(await f());
    } catch {
      return { ok: false, kind: "network", message: "down" };
    }
  };
  const posts: string[] = [];
  return {
    posts,
    create: (body) => guard(() => createWorkspace(repo, JSON.stringify(body))),
    get: (id, since, withBase = true) => guard(() => getWorkspace(repo, id, String(since), withBase ? null : "0")),
    list: () => guard(() => listWorkspaces(repo)),
    post: async (id, ev) => {
      posts.push(ev.type === "undo" ? `undo ${ev.payload.targetSeq}` : (ev.payload.description as string));
      if (hooks.refuse?.(ev)) return { ok: false, kind: "rejected", message: "refused for the test" };
      const res = await guard<{ seq: number; createdAt: string; duplicate: boolean }>(() => appendEvent(repo, id, JSON.stringify(ev)));
      // The server stored it, but the reply never arrived.
      if (res.ok && hooks.dropReplies?.()) return { ok: false, kind: "network", message: "lost" };
      return res;
    },
  };
}

function client(repo: MemoryRepo, cache: CacheStore = memoryCache(), hooks?: Parameters<typeof network>[1]) {
  const t = network(repo, hooks);
  return { t, cache, make: (clientId: string) => new WorkspaceClient({ id: ID, transport: t, cache, clientId }) };
}

const found = (key: string, field: "spaceAvailable" | "floor", value: string, text: string): ChangeSpec => ({
  source: "manual",
  description: text,
  directKeys: [key],
  facts: [{ target: "application", key, field, value }],
});
const spaceFound: ChangeSpec = {
  source: "manual",
  description: "APP-012 found a ground-floor space",
  directKeys: ["APP-012"],
  facts: [
    { target: "application", key: "APP-012", field: "spaceAvailable", value: "Rented" },
    { target: "application", key: "APP-012", field: "floor", value: "Ground" },
  ],
};
const withdrew: ChangeSpec = { source: "manual", description: "APP-003 withdrew", directKeys: ["APP-003"], facts: [{ target: "application", key: "APP-003", field: "withdrawn", value: true }] };
const slots: ChangeSpec = { source: "manual", description: "TER-02 now has 2 slots", facts: [{ target: "territory", key: "TER-02", field: "openSlots", value: 2 }] };

const decisionsOf = (c: WorkspaceClient) => JSON.stringify(computeResult(c.session!).decisions);

function upload(repo: MemoryRepo, name = "me") {
  const k = client(repo);
  const c = WorkspaceClient.fromUpload({ id: ID, transport: k.t, cache: k.cache, clientId: name, base: baseOf(trickySession()), name: "tricky.xlsx", parentId: null });
  return { ...k, c };
}

let repo: MemoryRepo;
beforeEach(() => {
  repo = new MemoryRepo();
});

describe("an upload becomes a shared workspace", () => {
  it("is on the server after the first round, and a second viewer sees the same decisions", async () => {
    const a = upload(repo);
    expect(a.c.status).toBe("syncing");
    await a.c.round();
    expect(a.c.status).toBe("synced");
    expect(repo.workspaces.has(ID)).toBe(true);
    const b = client(repo).make("viewer2");
    await b.open();
    expect(b.session).not.toBeNull();
    expect(decisionsOf(b)).toBe(decisionsOf(a.c));
  });

  it("opening an unknown workspace says so; an unreachable server says that instead, then recovers", async () => {
    const b = client(repo).make("v");
    await b.open();
    expect(b.loadError?.kind).toBe("not_found");

    const a = upload(repo);
    await a.c.round();
    repo.failing = true;
    const c2 = client(repo).make("v3");
    await c2.open();
    expect(c2.loadError?.kind).toBe("unreachable");
    expect(c2.status).toBe("offline");
    repo.failing = false;
    await c2.round();
    expect(c2.loadError).toBeNull();
    expect(c2.session).not.toBeNull();
  });
});

describe("G10.3 database down, then back", () => {
  it("keeps working on the device, says it isn't syncing, and re-sends everything in order afterwards", async () => {
    const a = upload(repo);
    repo.failing = true; // down from the start: even the workspace itself hasn't been sent
    await a.c.round();
    expect(a.c.status).toBe("offline");
    expect(a.c.statusMessage).toBe(OFFLINE_MESSAGE);

    const before = decisionsOf(a.c);
    expect(a.c.commit(spaceFound).ok).toBe(true);
    expect(a.c.commit(withdrew).ok).toBe(true);
    expect(a.c.commit(slots).ok).toBe(true);
    expect(a.c.pendingCount).toBe(3);
    expect(decisionsOf(a.c)).not.toBe(before); // the decisions moved on the device
    await a.c.round();
    expect(a.c.status).toBe("offline"); // still down

    // The tab is closed and reopened while it's still down: nothing is lost.
    const reopened = client(repo, a.cache).make("me");
    await reopened.open();
    expect(reopened.pendingCount).toBe(3);
    expect(decisionsOf(reopened)).toBe(decisionsOf(a.c));

    repo.failing = false;
    await reopened.round();
    expect(reopened.status).toBe("synced");
    expect(reopened.pendingCount).toBe(0);
    const stored = repo.workspaces.get(ID)!.events;
    expect(stored.map((e) => (e.payload as { description: string }).description)).toEqual([spaceFound.description, withdrew.description, slots.description]);
    expect(stored.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(repo.writes.filter((w) => w.startsWith("create"))).toHaveLength(1);

    // Another round changes nothing: no duplicates.
    await reopened.round();
    expect(repo.workspaces.get(ID)!.events).toHaveLength(3);
  });

  it("a reply that gets lost doesn't make a change twice (the retry carries the same id)", async () => {
    let drop = true;
    const a = client(repo, memoryCache(), { dropReplies: () => drop });
    const c = WorkspaceClient.fromUpload({ id: ID, transport: a.t, cache: a.cache, clientId: "me", base: baseOf(trickySession()), name: "t", parentId: null });
    await c.round();
    c.commit(spaceFound);
    await c.round(); // stored on the server, reply lost
    expect(c.status).toBe("offline");
    expect(c.pendingCount).toBe(1);
    drop = false;
    await c.round();
    expect(c.pendingCount).toBe(0);
    expect(repo.workspaces.get(ID)!.events).toHaveLength(1);
    expect(c.entries).toHaveLength(1);
  });

  it("drops a change the server refuses, says so, and carries on with the rest", async () => {
    const a = client(repo, memoryCache(), { refuse: (ev) => ev.type === "withdraw" });
    const c = WorkspaceClient.fromUpload({ id: ID, transport: a.t, cache: a.cache, clientId: "me", base: baseOf(trickySession()), name: "t", parentId: null });
    await c.round();
    c.commit(spaceFound);
    c.commit(withdrew);
    c.commit(slots);
    await c.round();
    expect(c.pendingCount).toBe(0);
    expect(c.entries.map((e) => e.description)).toEqual([spaceFound.description, slots.description]);
    expect(c.toasts.some((t) => t.kind === "problem" && /couldn't be saved/.test(t.text))).toBe(true);
  });
});

describe("two viewers on one workspace (G10.1, G10.2)", () => {
  it("both changes survive, both end with the same decisions, and each is told about the other's", async () => {
    const a = upload(repo, "alice");
    await a.c.round();
    const b = client(repo).make("bob");
    await b.open();
    b.start();
    b.stop();

    a.c.commit(spaceFound);
    b.commit(withdrew);
    await Promise.all([a.c.round(), b.round()]);
    await Promise.all([a.c.round(), b.round()]);

    expect(repo.workspaces.get(ID)!.events).toHaveLength(2);
    expect(decisionsOf(a.c)).toBe(decisionsOf(b));
    expect(a.c.entries.map((e) => e.description).sort()).toEqual([spaceFound.description, withdrew.description].sort());
    expect(b.entries).toHaveLength(2);
    const toastA = a.c.toasts.find((t) => t.kind === "other");
    const toastB = b.toasts.find((t) => t.kind === "other");
    expect(toastA?.text).toContain("Updated by another viewer: APP-003 withdrew");
    expect(toastB?.text).toContain("Updated by another viewer: APP-012 found a ground-floor space");
    // Nobody is told about their own change.
    expect(a.c.toasts.filter((t) => t.kind === "other")).toHaveLength(1);
    // And a viewer who joins now replays to the same decisions.
    const late = client(repo).make("late");
    await late.open();
    expect(decisionsOf(late)).toBe(decisionsOf(a.c));
  });

  it("a change made before another viewer's event arrives still ends up in seq order everywhere", async () => {
    const a = upload(repo, "alice");
    await a.c.round();
    const b = client(repo).make("bob");
    await b.open();
    // Bob's change is stored first, but Alice sends hers before she has seen it.
    b.commit(slots);
    await b.round();
    a.c.commit(found("APP-012", "spaceAvailable", "Rented", "APP-012 found space"));
    await a.c.round();
    await b.round();
    expect(a.c.entries.map((e) => e.description)).toEqual(b.entries.map((e) => e.description));
    expect(decisionsOf(a.c)).toBe(decisionsOf(b));
    expect(repo.workspaces.get(ID)!.events.map((e) => e.seq)).toEqual([1, 2]);
  });

  it("an undo reaches the other viewer, who is told, and the change stays in the log as undone", async () => {
    const a = upload(repo, "alice");
    await a.c.round();
    const b = client(repo).make("bob");
    await b.open();
    const before = decisionsOf(a.c);
    a.c.commit(spaceFound);
    await a.c.round();
    await b.round();
    expect(decisionsOf(b)).not.toBe(before);
    a.c.undo(a.c.entries[0].id);
    expect(a.c.entries[0].undone).toBe(true);
    await a.c.round();
    await b.round();
    expect(b.entries).toHaveLength(1);
    expect(b.entries[0].undone).toBe(true);
    expect(decisionsOf(b)).toBe(before);
    expect(b.toasts.map((t) => t.text).join(" ")).toContain("undid");
  });

  it("undoing a change that hasn't been sent yet works, and so does undoing it after a restart", async () => {
    const a = upload(repo);
    repo.failing = true;
    const before = decisionsOf(a.c);
    a.c.commit(spaceFound);
    a.c.undo(a.c.entries[0].id);
    expect(decisionsOf(a.c)).toBe(before);
    repo.failing = false;
    await a.c.round();
    expect(repo.workspaces.get(ID)!.events.map((e) => e.type)).toEqual(["fact", "undo"]);
    const late = client(repo).make("late");
    await late.open();
    expect(late.entries[0].undone).toBe(true);
    expect(decisionsOf(late)).toBe(before);
  });

  it("replay equals live: the device's own view matches a fresh client that replays the server's events", async () => {
    const a = upload(repo);
    await a.c.round();
    for (const spec of [spaceFound, withdrew, slots]) expect(a.c.commit(spec).ok).toBe(true);
    a.c.undo(a.c.entries[1].id);
    await a.c.round();
    const fresh = client(repo).make("fresh");
    await fresh.open();
    expect(decisionsOf(fresh)).toBe(decisionsOf(a.c));
    expect(fresh.entries.map((e) => [e.description, e.undone])).toEqual(a.c.entries.map((e) => [e.description, e.undone]));
  });
});

describe("the data check and the change check", () => {
  it("refuses a change that would break a rule, as before, and sends nothing", async () => {
    const a = upload(repo);
    await a.c.round();
    const out = a.c.commit({ source: "manual", description: "bad", facts: [{ target: "application", key: "APP-001", field: "city", value: "Atlantis" }] });
    expect(out.ok).toBe(false);
    expect(a.c.pendingCount).toBe(0);
    expect(repo.workspaces.get(ID)!.events).toHaveLength(0);
  });
});
