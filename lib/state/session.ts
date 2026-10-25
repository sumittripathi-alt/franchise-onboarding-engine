// The session: everything needed to reproduce every decision (G7.9). Pure functions only; the store and the
// UI call these. A session is the parsed upload, the starting settings, and a change log. The change log is
// folded into the effective settings, facts, locks and overrides, so every entry can be undone on its own.

import { diffResults, EMPTY_DIFF, type DiffSummary } from "@/lib/chat/diff";
import { BRAND_PROFILES, defaultPolicy } from "@/lib/policy/brandProfiles";
import { applyEdits, foldPolicyEntries, type PolicyEdit } from "@/lib/policy/edits";
import type { BrandProfile, BrandProfileId, Policy } from "@/lib/policy/types";
import { runEngineChecked } from "@/lib/engine/run";
import type { EngineInput, EngineResult, FactPatch, HumanOverride, Lock } from "@/lib/engine/types";
import { buildDataQualityReport, type DataQualityReport } from "@/lib/ingest/report";
import { heuristicSignals, runDataChecks, type DataCheckResult } from "@/lib/ingest/validate";
import type { ParseReport } from "@/lib/ingest/parseWorkbook";
import type { Application, Signals, Territory } from "@/lib/types";
import { z } from "zod";
import {
  ChangeEntrySchema,
  FeedbackSchema,
  SESSION_KIND,
  SESSION_VERSION,
  SessionFileSchema,
  SettingsSchema,
  type SessionFileData,
} from "./sessionSchema";

export type Settings = z.infer<typeof SettingsSchema>;
export type ChangeEntry = z.infer<typeof ChangeEntrySchema>;
export type Feedback = z.infer<typeof FeedbackSchema>;
export type ChangeSource = ChangeEntry["source"];

export interface Session {
  files: string[];
  parsed: {
    applications: Application[];
    territories: Territory[];
    skippedExample: { application: Application | null; territory: Territory | null };
    report: ParseReport;
  };
  base: Settings;
  policy: BrandProfile;
  entries: ChangeEntry[];
  feedback: Feedback[];
  reviewed: boolean;
  signals?: EngineInput["signals"];
}

export function newSession(args: {
  files: string[];
  applications: Application[];
  territories: Territory[];
  skippedExample: Session["parsed"]["skippedExample"];
  report: ParseReport;
  today: string;
  profileId?: BrandProfileId;
}): Session {
  const profileId = args.profileId ?? "eyewear";
  return {
    files: args.files,
    parsed: { applications: args.applications, territories: args.territories, skippedExample: args.skippedExample, report: args.report },
    base: { profileId, today: args.today, includeExample: false },
    policy: structuredClone(BRAND_PROFILES[profileId]),
    entries: [],
    feedback: [],
    reviewed: false,
  };
}

// ---------- Effective state ----------

export interface Effective {
  /** Edited assumptions by brand type (after any resets). */
  policyEdits: Partial<Record<BrandProfileId, PolicyEdit[]>>;
  /** Signals read from notes after the upload, which replace the uploaded ones for those applications. */
  signals: Record<string, Signals>;
  settings: Settings;
  facts: FactPatch[];
  locks: Lock[];
  overrides: HumanOverride[];
}

/** Fold the change log (skipping undone entries) into the effective settings and inputs. */
export function effective(session: Session): Effective {
  const settings: Settings = { ...session.base };
  const facts: FactPatch[] = [];
  const locks: Lock[] = [];
  const overrides: HumanOverride[] = [];
  const signals: Record<string, Signals> = {};
  for (const e of session.entries) {
    if (e.undone) continue;
    if (e.signals) Object.assign(signals, e.signals);
    if (e.set) Object.assign(settings, e.set);
    if (e.facts) facts.push(...(e.facts as FactPatch[]));
    if (e.locks) locks.push(...(e.locks as Lock[]));
    if (e.overrides) overrides.push(...(e.overrides as HumanOverride[]));
  }
  return { signals, policyEdits: foldPolicyEntries(session.entries as Parameters<typeof foldPolicyEntries>[0]), settings, facts, locks, overrides };
}

/** The brand profile in force: the session's stored profile (with edits), or the defaults of another brand type. */
export function effectivePolicy(session: Session, profileId: BrandProfileId): Policy {
  const base = profileId === session.policy.id ? structuredClone(session.policy) : defaultPolicy(profileId).profile;
  const edits = foldPolicyEntries(session.entries as Parameters<typeof foldPolicyEntries>[0])[profileId];
  return { profileId, profile: applyEdits(base, edits) };
}

/** The applications and territories the engine sees: the example rows are included on request. */
export function effectiveData(session: Session, includeExample: boolean): { applications: Application[]; territories: Territory[] } {
  const { applications, territories, skippedExample } = session.parsed;
  return {
    applications: includeExample && skippedExample.application ? [skippedExample.application, ...applications] : applications,
    territories: includeExample && skippedExample.territory ? [skippedExample.territory, ...territories] : territories,
  };
}

export function buildEngineInput(session: Session): EngineInput {
  const eff = effective(session);
  const data = effectiveData(session, eff.settings.includeExample);
  return {
    applications: data.applications,
    territories: data.territories,
    signals: { ...session.signals, ...eff.signals },
    policy: effectivePolicy(session, eff.settings.profileId),
    facts: eff.facts,
    locks: eff.locks,
    overrides: eff.overrides,
    today: eff.settings.today,
  };
}

const resultCache = new WeakMap<Session, EngineResult>();
const checksCache = new WeakMap<Session, DataCheckResult>();

/** Run the engine for a session. Cached by session identity, so every component shares one run. */
export function computeResult(session: Session): EngineResult {
  const hit = resultCache.get(session);
  if (hit) return hit;
  const result = runEngineChecked(buildEngineInput(session));
  resultCache.set(session, result);
  return result;
}

export interface ShownResult {
  /** The result to show. */
  result: EngineResult;
  /** Invariant failures of the latest run (empty when all is well). */
  violations: string[];
  /** Set when the engine could not produce any valid result at all. */
  error: string | null;
}

/**
 * The result to show (G3.6): the latest run if it passed every check, otherwise the most recent state of the
 * change log that did (changes are dropped from the end one at a time). Pure, so it needs no memory of earlier renders.
 */
export function shownResult(session: Session): ShownResult {
  let violations: string[] = [];
  let firstError: string | null = null;
  for (let keep = session.entries.length; keep >= 0; keep--) {
    const candidate = keep === session.entries.length ? session : { ...session, entries: session.entries.slice(0, keep) };
    try {
      const result = computeResult(candidate);
      if (result.invariantViolations.length === 0) return { result, violations, error: null };
      if (keep === session.entries.length) violations = result.invariantViolations;
    } catch (e) {
      firstError ??= e instanceof Error ? e.message : "The decision engine failed.";
    }
  }
  try {
    // Even the uploaded data fails the checks: show it, with the red banner, rather than a blank screen.
    return { result: computeResult({ ...session, entries: [] }), violations, error: null };
  } catch (e) {
    return { result: null as never, violations, error: firstError ?? (e instanceof Error ? e.message : "The decision engine failed.") };
  }
}

export function computeChecks(session: Session): DataCheckResult {
  const hit = checksCache.get(session);
  if (hit) return hit;
  const eff = effective(session);
  const { applications, territories } = effectiveData(session, eff.settings.includeExample);
  const checks = runDataChecks(applications, territories, { ...heuristicSignals(applications), ...session.signals, ...eff.signals });
  checksCache.set(session, checks);
  return checks;
}

/** The data-quality report as of the current settings (example rows included or skipped). */
export function effectiveReport(session: Session): DataQualityReport {
  const eff = effective(session);
  const { applications } = effectiveData(session, eff.settings.includeExample);
  const r = session.parsed.report;
  const parse: ParseReport = {
    ...r,
    exampleRows: r.exampleRows.map((x) => ({ ...x, skipped: !eff.settings.includeExample })),
    skippedExampleTerritory: eff.settings.includeExample ? null : r.skippedExampleTerritory,
    applicationRowsRead: applications.length,
    territoryRowsRead: effectiveData(session, eff.settings.includeExample).territories.length,
  };
  return buildDataQualityReport(parse, applications, computeChecks(session));
}

// ---------- Committing changes ----------

export interface ChangeSpec {
  source: ChangeSource;
  description: string;
  facts?: FactPatch[];
  locks?: Lock[];
  overrides?: HumanOverride[];
  set?: Partial<Settings>;
  /** AI reading of notes, by application key (source "ai_notes"). */
  signals?: Record<string, Signals>;
  /** Edited assumptions for one brand type, or a reset of them. */
  policy?: { profileId: BrandProfileId; edits: PolicyEdit[] } | { profileId: BrandProfileId; reset: true };
  /** Applications the change is about; everything else that moves is a knock-on effect. */
  directKeys?: string[];
}

export interface Preview {
  result: EngineResult;
  diff: DiffSummary;
  /** Overrides waiting for the user to confirm who gets bumped. */
  pending: EngineResult["pendingOverrides"];
  rejected: EngineResult["rejectedOverrides"];
  session: Session;
}

function entryFrom(session: Session, spec: ChangeSpec, now: string): ChangeEntry {
  const entry: ChangeEntry = {
    id: `c${session.entries.length + 1}`,
    time: now,
    source: spec.source,
    description: spec.description,
    undone: false,
    diff: EMPTY_DIFF,
  };
  if (spec.facts?.length) entry.facts = spec.facts;
  if (spec.locks?.length) entry.locks = spec.locks;
  if (spec.overrides?.length) entry.overrides = spec.overrides;
  if (spec.set && Object.keys(spec.set).length) entry.set = spec.set;
  if (spec.signals && Object.keys(spec.signals).length) entry.signals = spec.signals;
  if (spec.policy) entry.policy = spec.policy;
  return entry;
}

/** What a change would do, without committing it. */
export function previewChange(session: Session, spec: ChangeSpec, now: string): Preview {
  const before = computeResult(session);
  const draft: Session = { ...session, entries: [...session.entries, entryFrom(session, spec, now)] };
  const after = computeResult(draft);
  const diff = diffResults(before, after, spec.directKeys ?? []);
  draft.entries[draft.entries.length - 1] = { ...draft.entries[draft.entries.length - 1], diff };
  return { result: after, diff, pending: after.pendingOverrides, rejected: after.rejectedOverrides, session: draft };
}

export type CommitOutcome = { ok: true; session: Session; diff: DiffSummary; entry: ChangeEntry } | { ok: false; message: string };

/** Commit a change if it keeps every invariant and isn't waiting on a confirmation (SPEC §6.7, §15.4). */
export function commitChange(session: Session, spec: ChangeSpec, now: string): CommitOutcome {
  const p = previewChange(session, spec, now);
  if (p.result.invariantViolations.length) {
    return { ok: false, message: `That change would break a rule (${p.result.invariantViolations[0]}), so it wasn't applied.` };
  }
  const blocked = p.rejected[0] ?? p.pending[0];
  if (blocked) return { ok: false, message: blocked.message };
  const entry = p.session.entries[p.session.entries.length - 1];
  return { ok: true, session: p.session, diff: p.diff, entry };
}

export function undoEntry(session: Session, id: string): Session {
  return { ...session, entries: session.entries.map((e) => (e.id === id ? { ...e, undone: true } : e)) };
}

// ---------- Save and resume (G7.9) ----------

export function toSessionFile(session: Session, now: string): SessionFileData {
  return { kind: SESSION_KIND, version: SESSION_VERSION, savedAt: now, session: session as SessionFileData["session"] };
}

export function serialiseSession(session: Session, now: string): string {
  return JSON.stringify(toSessionFile(session, now));
}

export type ParsedSession = { ok: true; session: Session } | { ok: false; message: string };

/** Validate a session file's text. Malformed files are rejected with a message the user can act on. */
export function parseSessionFile(text: string): ParsedSession {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, message: "That file isn't a session file: it isn't valid JSON. Use a file saved with \"Download session\"." };
  }
  if (typeof raw !== "object" || raw === null || (raw as { kind?: unknown }).kind !== SESSION_KIND) {
    return { ok: false, message: "That file isn't a session saved by this app. Use a file saved with \"Download session\"." };
  }
  const version = (raw as { version?: unknown }).version;
  if (typeof version === "number" && version > SESSION_VERSION) {
    return { ok: false, message: `This session was saved by a newer version of the app (format ${version}). This version reads format ${SESSION_VERSION}.` };
  }
  const parsed = SessionFileSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue.path.length ? issue.path.join(".") : "the file";
    const more = parsed.error.issues.length > 1 ? ` (and ${parsed.error.issues.length - 1} more problem${parsed.error.issues.length === 2 ? "" : "s"})` : "";
    return { ok: false, message: `That session file is damaged or has been edited. Problem at ${path}: ${issue.message}${more}.` };
  }
  return { ok: true, session: parsed.data.session as Session };
}
