// Replay (SPEC §16): the change log is rebuilt from the workspace's events in seq order, on every client, the
// same way. The engine then decides from base data plus that log, so every client shows the same decisions.
// Decisions are never stored; diffs are recomputed here, for the most recent events only (older ones are summarised by their description).

import { diffResults, EMPTY_DIFF } from "@/lib/chat/diff";
import { computeResult, type ChangeEntry, type Session } from "@/lib/state/session";
import type { BaseData, ChangePayload, EventType, UndoPayload } from "./schemas";

/** An event in a client's log: confirmed by the server (has a seq) or still waiting to be sent. */
export interface LogEvent {
  seq: number | null;
  createdAt: string;
  type: EventType;
  payload: ChangePayload | UndoPayload;
  clientId: string | null;
  clientEventId: string | null;
  /** For a pending undo: the entry it undoes (a pending event has no seq yet). */
  undoOf?: string;
}

export const DIFF_WINDOW = 15;

export function entryIdOf(ev: LogEvent): string {
  return ev.clientEventId ?? `s${ev.seq}`;
}

export function isUndo(ev: LogEvent): ev is LogEvent & { type: "undo"; payload: UndoPayload } {
  return ev.type === "undo";
}

/** The session a log produces on top of base data. */
export function sessionFrom(base: BaseData, entries: ChangeEntry[], extra: Pick<Session, "feedback" | "reviewed">): Session {
  return { ...base, entries, feedback: extra.feedback, reviewed: extra.reviewed } as Session;
}

/** Confirmed events by seq, then pending events in the order they were made. */
export function orderLog(confirmed: LogEvent[], pending: LogEvent[]): LogEvent[] {
  return [...[...confirmed].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)), ...pending];
}

export function replayEntries(base: BaseData, log: LogEvent[], window = DIFF_WINDOW): ChangeEntry[] {
  let entries: ChangeEntry[] = [];
  const bySeq = new Map<number, string>();
  const probe = (list: ChangeEntry[]): Session => ({ ...base, entries: list, feedback: [], reviewed: true }) as Session;
  const run = (list: ChangeEntry[]) => {
    try {
      return computeResult(probe(list));
    } catch {
      return null;
    }
  };

  log.forEach((ev, i) => {
    if (isUndo(ev)) {
      const target = ev.undoOf ?? bySeq.get(ev.payload.targetSeq);
      if (target) entries = entries.map((e) => (e.id === target ? { ...e, undone: true } : e));
      return;
    }
    const p = ev.payload as ChangePayload;
    const entry: ChangeEntry = {
      id: entryIdOf(ev),
      time: ev.createdAt,
      source: p.source,
      description: p.description,
      undone: false,
      diff: EMPTY_DIFF,
      ...(p.facts ? { facts: p.facts } : {}),
      ...(p.locks ? { locks: p.locks } : {}),
      ...(p.overrides ? { overrides: p.overrides } : {}),
      ...(p.set ? { set: p.set } : {}),
    };
    if (i >= log.length - window) {
      const before = run(entries);
      const after = run([...entries, entry]);
      if (before && after) entry.diff = diffResults(before, after, p.directKeys ?? []);
    }
    if (ev.seq !== null) bySeq.set(ev.seq, entry.id);
    entries = [...entries, entry];
  });
  return entries;
}
