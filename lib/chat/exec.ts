// The chat tools (SPEC §8.2): each reads the session or proposes a change, and produces a template answer
// straight from the engine's own records. The AI never sees a tool run until after it has finished, and only
// phrases it. State changes only through apply_fact, apply_territory_fact, withdraw, override_decision and
// lock_decision, and only with values validated against the allowed values (G4.4).

import type { DiffSummary } from "@/lib/chat/diff";
import { applyFacts } from "@/lib/engine/facts";
import { REASON_TEXT } from "@/lib/engine/reasons";
import type { FactPatch } from "@/lib/engine/types";
import { parseCity, parseFloor, parseLanguage, parseSpaceAvailable } from "@/lib/ingest/normalise";
import { KIND_LABEL, buildActionQueue } from "@/lib/insights/actions";
import { matchesFilters } from "@/lib/insights/filter";
import type { FieldChangeT, ToolCall, WhatIfChangeT } from "@/lib/llm/tools";
import { formatDate } from "@/lib/planner/dates";
import { CITY_NAMES } from "@/lib/policy/allowedValues";
import {
  effective,
  effectiveData,
  previewChange,
  shownResult,
  type ChangeSpec,
  type CommitOutcome,
  type Session,
} from "@/lib/state/session";
import type { Application, DecisionRecord, Status } from "@/lib/types";
import { checkFactValue } from "@/lib/workspace/schemas";
import { redactNames, resolveApp, resolveTerritory, type Directory, type Ref, type Resolution } from "./resolve";
import type { EngineResult } from "@/lib/engine/types";

export interface ChatCtx {
  session: Session;
  result: EngineResult;
  /** Applications as the engine sees them now (facts applied), by key. */
  apps: Map<string, Application>;
  dir: Directory;
  brand: string;
  today: string;
  languages: Record<string, string | null>;
}

export function buildChatCtx(session: Session): ChatCtx {
  const shown = shownResult(session);
  const eff = effective(session);
  const data = effectiveData(session, eff.settings.includeExample);
  const applied = applyFacts(data.applications, data.territories, eff.facts).applications;
  const result = shown.result;
  return {
    session,
    result,
    apps: new Map(applied.map((a) => [a.key, a])),
    dir: {
      apps: data.applications.map((a) => ({ key: a.key, id: a.id, name: a.name })),
      withdrawn: new Set(result?.withdrawn ?? []),
      territories: (result?.territories ?? []).map((t) => ({ key: t.key, id: t.id })),
    },
    brand: session.policy.id === eff.settings.profileId ? session.policy.label : eff.settings.profileId,
    today: eff.settings.today,
    languages: Object.fromEntries(applied.map((a) => [a.key, a.language.value])),
  };
}

export interface ToolRun {
  kind: "answer" | "commit" | "simulation" | "needs_confirmation" | "clarify" | "error";
  /** The answer in 120 words or fewer. */
  short: string;
  /** Everything the engine says about it, for "Show details". */
  long: string;
  /** What the AI may phrase from: IDs only, no names. Empty means there is nothing to phrase. */
  facts: string;
  /** Reason codes, shown as small chips. */
  chips: string[];
  /** The application the answer is about (its drawer opens after a change; follow-ups refer to it). */
  appKey: string | null;
  diff: DiffSummary | null;
  entryId: string | null;
  assumptions: string[];
  /** A human override waiting for "confirm". */
  pending: ChangeSpec | null;
}

const base = (): ToolRun => ({ kind: "answer", short: "", long: "", facts: "", chips: [], appKey: null, diff: null, entryId: null, assumptions: [], pending: null });
const fail = (kind: "error" | "clarify", text: string, appKey: string | null = null): ToolRun => ({ ...base(), kind, short: text, long: text, appKey });

const stripLabel = (s: string) => s.replace(/^(On hold|Not approved|Waitlisted[^:]*|Offered[^:]*|Approved[^:]*):\s*/, "");
const words = (s: string, max: number) => {
  const w = s.split(/\s+/);
  return w.length <= max ? s : `${w.slice(0, max).join(" ")}…`;
};
const KIND_FOCUS: [RegExp, "training" | "onboarding" | "conditions"][] = [
  [/\btrain(ing|ed)?|cohort|shadow\b/i, "training"],
  [/\bonboard|timeline|launch|open(ing)?\b/i, "onboarding"],
  [/\bcondition|deadline|proof|need(s)? to do\b/i, "conditions"],
];

function resolveOrFail(ctx: ChatCtx, text: string): { ok: true; ref: Ref; withdrawn: boolean } | { ok: false; run: ToolRun } {
  const r: Resolution = resolveApp(text, ctx.dir);
  if (r.kind === "ok") return { ok: true, ref: r.ref, withdrawn: false };
  if (r.kind === "withdrawn") return { ok: true, ref: r.ref, withdrawn: true };
  if (r.kind === "ambiguous") {
    const list = r.options.slice(0, 5).map((o) => `${o.id} (${o.name})`).join(", ");
    return { ok: false, run: fail("clarify", `Which one do you mean: ${list}?`) };
  }
  return { ok: false, run: fail("error", r.message) };
}

const decisionOf = (ctx: ChatCtx, key: string): DecisionRecord | undefined => ctx.result.decisions.find((d) => d.appKey === key);
const chipsOf = (d: DecisionRecord) => [...new Set([...d.reasonCodes, ...d.flags.map((f) => f.code)])].slice(0, 6) as string[];

// ---------- Reading tools ----------

function describe(ctx: ChatCtx, d: DecisionRecord, message: string): ToolRun {
  const focus = KIND_FOCUS.find(([re]) => re.test(message))?.[1] ?? null;
  const why = stripLabel(d.headline).replace(/\.$/, "");
  const premise = /\b(?:is|was|been|got)\s+(?:\S+\s+){0,2}?(approved|on hold|rejected|waitlisted|offered|not approved)\b/i.exec(message)?.[1]?.toLowerCase();
  const claimed: Status | null = !premise ? null : /not approved|rejected/.test(premise) ? "REJECT" : premise === "approved" ? "APPROVED" : premise === "on hold" ? "HOLD" : premise === "waitlisted" ? "WAITLIST" : premise === "offered" ? "REDIRECT" : null;
  const correction =
    claimed && claimed !== d.status && !(claimed === "APPROVED" && d.status === "CONDITIONAL")
      ? `Quick correction: ${d.appId} is ${d.label}, not ${premise}. `
      : "";

  const parts: string[] = [`${d.appId} (${d.name}) is ${d.label}. ${why}.`];
  if (d.status === "WAITLIST" && d.waitlistRank) parts.push(`Waitlist rank ${d.waitlistRank} in ${d.city}.`);
  if (focus === "training") {
    parts.push(
      d.training
        ? d.training.summary
        : `There is no training plan yet because ${d.appId} is ${d.label.toLowerCase()}. Training is planned once there is a slot${d.waitlist?.preOnboarding ? "; they are in the pre-onboarding group, so documents and preparation start early" : ""}.`,
    );
  }
  else if (focus === "onboarding" && d.onboarding) parts.push(`Earliest opening: ${formatDate(d.onboarding.earliestLaunch)}.`);
  else if (focus === "conditions" && d.conditions.length) parts.push(`Conditions: ${d.conditions.map((c) => `${c.text} (by ${formatDate(c.deadline)})`).join("; ")}.`);
  else {
    parts.push(`What would change it: ${d.counterfactual}`);
    parts.push(`Next step for the partner: ${d.partnerNextStep}`);
  }
  const short = words(correction + parts.join(" "), 120);

  const long = [
    `${d.appId} (${d.name}): ${d.label}. ${d.explanation}`,
    d.conditions.length ? `Conditions: ${d.conditions.map((c) => `${c.text} (by ${formatDate(c.deadline)}, ${c.owner})`).join("; ")}.` : "",
    d.flags.length ? `Flags: ${d.flags.map((f) => f.text).join(" ")}` : "",
    `What would change it: ${d.counterfactual}`,
    `Partner next step: ${d.partnerNextStep}`,
    `Team next step: ${d.teamNextStep}`,
    d.training ? `Training: ${d.training.summary}` : "",
    d.onboarding ? `Earliest opening: ${formatDate(d.onboarding.earliestLaunch)}.` : "",
    d.evidence.length ? `From the applicant's own words: ${d.evidence.map((e) => `"${e.quote}"`).join("; ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const factLines = [
    `${d.appId} status: ${d.label}.`,
    `Reason: ${why}.`,
    d.reasonCodes.length ? `Key factors: ${d.reasonCodes.map((c) => REASON_TEXT[c] ?? c).join("; ")}.` : "",
    d.status === "WAITLIST" && d.waitlistRank ? `Waitlist rank ${d.waitlistRank} in ${d.city}.` : "",
    d.conditions.length ? `Conditions: ${d.conditions.map((c) => `${c.text} by ${formatDate(c.deadline)}`).join("; ")}.` : "",
    `What would change it: ${d.counterfactual}`,
    `Next step for the partner: ${d.partnerNextStep}`,
    `Next step for the team: ${d.teamNextStep}`,
    focus === "training" && d.training ? `Training: ${d.training.summary}` : "",
    focus === "onboarding" && d.onboarding ? `Earliest opening: ${formatDate(d.onboarding.earliestLaunch)}.` : "",
    correction ? `Correct the question's premise: ${d.appId} is ${d.label}.` : "",
  ].filter(Boolean);

  return { ...base(), short, long, facts: redactNames(factLines.join("\n"), ctx.dir.apps), chips: chipsOf(d), appKey: d.appKey };
}

const BAND_NAMES = ["space", "capital", "experience"] as const;

function compare(ctx: ChatCtx, a: DecisionRecord, b: DecisionRecord): ToolRun {
  const bandText = (d: DecisionRecord) => (d.bands ? `space ${d.bands.space}, capital ${d.bands.capital}, experience ${d.bands.experience}` : "not ranked");
  let first = "";
  if (a.bands && b.bands) {
    const diff = BAND_NAMES.find((k) => a.bands![k] !== b.bands![k]);
    if (diff) {
      const winner = a.bands[diff] > b.bands[diff] ? a : b;
      first = `The first difference is ${diff}: ${winner.appId} is in band ${winner.bands![diff]} against ${winner === a ? b.bands[diff] : a.bands[diff]}.`;
    } else first = "Their bands are the same, so the earlier application ranks first (first come, first served).";
  } else first = "At least one of them isn't ranked against the other, for example because it is on hold or in a different city.";
  const sameTer = a.territoryId && a.territoryId === b.territoryId ? "" : " They want different territories, so they don't compete for the same slot.";
  const short = words(`${a.appId} (${a.name}) is ${a.label}; ${b.appId} (${b.name}) is ${b.label}. Bands: ${a.appId} ${bandText(a)}; ${b.appId} ${bandText(b)}. ${first}${sameTer}`, 120);
  const facts = redactNames(
    `${a.appId} status: ${a.label}. ${b.appId} status: ${b.label}. ${a.appId} bands: ${bandText(a)}. ${b.appId} bands: ${bandText(b)}. ${first}${sameTer}`,
    ctx.dir.apps,
  );
  return { ...base(), short, long: `${short}\n${a.appId}: ${a.explanation}\n${b.appId}: ${b.explanation}`, facts, chips: [...new Set([...chipsOf(a), ...chipsOf(b)])].slice(0, 6), appKey: a.appKey };
}

function listApplications(ctx: ChatCtx, a: Extract<ToolCall, { name: "list_applications" }>["args"]): ToolRun {
  let city: string | "all" = "all";
  if (a.city) {
    const c = parseCity(a.city).value;
    if (!c) return fail("error", `${a.city} isn't one of our ${CITY_NAMES.length} cities (${CITY_NAMES.join(", ")}).`);
    city = c;
  }
  let territory: string | "all" = "all";
  if (a.territory) {
    const t = resolveTerritory(a.territory, ctx.dir);
    if (t.kind === "unknown") return fail("error", t.message);
    territory = t.id;
  }
  const rows = ctx.result.decisions.filter((d) => matchesFilters(d, { query: "", status: a.status ?? "all", territory, city, flag: a.flag ?? "all" }));
  const what = [a.status ? ctx.result.decisions.find((d) => d.status === a.status)?.label ?? a.status : "", city !== "all" ? `in ${city}` : "", territory !== "all" ? `in ${territory}` : ""].filter(Boolean).join(" ");
  if (!rows.length) return { ...base(), short: `No applications${what ? ` (${what})` : ""}.`, long: `No applications${what ? ` (${what})` : ""}.`, facts: `No applications${what ? ` (${what})` : ""}.` };
  const line = (d: DecisionRecord) => `${d.appId} (${d.name}): ${d.label}`;
  const shown = rows.slice(0, 12).map(line).join("; ");
  const more = rows.length > 12 ? ` and ${rows.length - 12} more` : "";
  const short = `${rows.length} application${rows.length === 1 ? "" : "s"}${what ? ` ${what}` : ""}: ${shown}${more}.`;
  return {
    ...base(),
    short,
    long: `${rows.length} application${rows.length === 1 ? "" : "s"}${what ? ` ${what}` : ""}:\n${rows.map((d) => `${line(d)}. ${stripLabel(d.headline)}`).join("\n")}`,
    facts: redactNames(`${rows.length} applications${what ? ` ${what}` : ""}: ${rows.slice(0, 12).map((d) => `${d.appId}: ${d.label}`).join("; ")}${more}.`, ctx.dir.apps),
  };
}

function territoryStatus(ctx: ChatCtx, text: string): ToolRun {
  const r = resolveTerritory(text, ctx.dir);
  if (r.kind === "unknown") return fail("error", r.message);
  const t = ctx.result.territories.find((x) => x.key === r.key)!;
  const idOf = (key: string) => ctx.result.decisions.find((d) => d.appKey === key)?.appId ?? key;
  const holding = t.reserved.map((x) => `${x.appId} (${x.pin})`).join(", ") || "nobody yet";
  const wait = t.waitlist.map(idOf).join(", ") || "none";
  const free = t.whiteSpacePins.slice(0, 4).join(", ");
  const short = `${t.id} (${t.city ?? "city unknown"}, ${t.tier ?? "tier unknown"}, ${t.priority} priority) has ${t.slots} open slot${t.slots === 1 ? "" : "s"}. Holding or offered: ${holding}. City waitlist: ${wait}.${free ? ` Pins to recruit for: ${free}.` : ""}${t.blocked ? " It is blocked by an existing store." : ""}`;
  return { ...base(), short, long: short, facts: short };
}

function explainPolicy(ctx: ChatCtx, topic: string): ToolRun {
  const p = ctx.session.policy;
  const t = topic.toLowerCase();
  const tier = (v: Record<string, number>, unit: string) => `Tier 1 ${v["Tier 1"]}${unit}, Tier 2 ${v["Tier 2"]}${unit}, Tier 3 ${v["Tier 3"]}${unit}`;
  const rows: { re: RegExp; text: string }[] = [
    { re: /invest|capital|money|fund|minimum|\bmin\b/, text: `${p.label}: minimum investment is ₹${tier(p.minInvestmentLakh, " lakh").replace(/ lakh/g, "").replace(/(\d+)(,|$)/g, "$1 lakh$2")}. Below ${Math.round(p.hardFloorPct * 100)}% of that an application is not approved; between ${Math.round(p.hardFloorPct * 100)}% and 100% it needs proof of funds. ${p.rationale.minInvestmentLakh ?? ""}` },
    { re: /radius|cannibal|distance|nearby|existing store/, text: `${p.label}: a new store keeps its distance from existing stores. Radius by tier: ${tier(p.cannibalisationRadiusKm, " km")}. ${p.rationale.cannibalisationRadiusKm ?? ""}` },
    { re: /space|floor|sq|size/, text: `${p.label}: space must be at least ${p.space.minSqft} sq ft, ideally ${p.space.idealMinSqft} to ${p.space.idealMaxSqft}. ${p.rationale.space ?? ""} ${p.rationale.floorRules ?? ""}` },
    { re: /payback|revenue|margin|return/, text: `${p.label}: payback is estimated from indicative monthly revenue (${tier(p.monthlyRevenueLakh, " lakh")}) and a ${Math.round(p.partnerMargin * 100)}% partner margin; beyond ${p.paybackWarningMonths} months it is flagged. ${p.rationale.paybackWarningMonths ?? ""}` },
    { re: /train|shadow|cohort|induction/, text: `${p.label}: ${p.baseTrainingDays} base training days (format: ${p.trainingFormat}), adjusted by track, plus shadowing of ${p.shadowDays.Standard} days for the standard track. ${p.rationale.baseTrainingDays ?? ""}` },
    { re: /deadline|condition|days|due/, text: `${p.label}: conditions are due in ${p.conditionDays.confirmDetails} days (confirm details), ${p.conditionDays.proofOfFunds} days (proof of funds), ${p.conditionDays.storeManager} days (store manager) and ${p.conditionDays.expansionSignOff} days (internal sign-off). ${p.rationale.conditionDays ?? ""}` },
    { re: /wait|pre-?onboard|queue/, text: `${p.label}: the top ${p.preOnboarding.topN} on each city's waitlist start pre-onboarding early; the waitlist is reviewed every ${p.waitlistReviewDays} days. ${p.rationale.preOnboarding ?? ""}` },
    { re: /lead|fit-?out|licen[cs]e|hiring|launch/, text: `${p.label}: fit-out takes ${p.leadTimes.fitOutDays} days, licences ${p.leadTimes.licencesDays} days and hiring ${p.leadTimes.hiringDays} days. ${p.rationale.leadTimes ?? ""}` },
  ];
  const hit = rows.find((r) => r.re.test(t));
  const text = hit ? hit.text.replace(/\s+/g, " ").trim() : `I can explain these assumptions for the ${p.label} profile: minimum investment, distance from existing stores, space and floor, payback, training, condition deadlines, the waitlist and lead times. Which one?`;
  return { ...base(), kind: hit ? "answer" : "clarify", short: words(text, 120), long: text, facts: hit ? text : "" };
}

function todaysActions(ctx: ChatCtx): ToolRun {
  const items = buildActionQueue(ctx.result, ctx.languages, ctx.today);
  if (!items.length) return { ...base(), short: "Nothing needs doing today.", long: "Nothing needs doing today.", facts: "Nothing needs doing today." };
  const line = (i: (typeof items)[number]) => `${formatDate(i.due)}: ${KIND_LABEL[i.kind]}. ${i.title}`;
  const top = items.slice(0, 6);
  const short = `${items.length} action${items.length === 1 ? "" : "s"} for the team, most urgent first. ${top.map(line).join(" ")}${items.length > 6 ? ` And ${items.length - 6} more in the Overview.` : ""}`;
  return { ...base(), short: words(short, 120), long: items.map((i) => `${line(i)}\n   ${i.detail}`).join("\n"), facts: redactNames(short, ctx.dir.apps), chips: [] };
}

// ---------- Tools that change things ----------

const FIELD_LABEL: Record<string, string> = {
  spaceAvailable: "space",
  spaceSqft: "space size (sq ft)",
  floor: "floor",
  investmentLakh: "investment (₹ lakh)",
  experienceYears: "experience (years)",
  targetLaunchMonths: "target launch (months)",
  language: "preferred language",
  city: "city",
  pin: "pin",
  notes: "notes",
};

const SPACE_FIELDS = ["floor", "spaceSqft"];

/** Facts from chat, checked against the allowed values, with any assumption stated (SPEC §8.2, G5.2). */
export function buildFacts(ctx: ChatCtx, ref: Ref, changes: FieldChangeT[]): { ok: true; facts: FactPatch[]; parts: string[]; assumptions: string[] } | { ok: false; run: ToolRun } {
  const app = ctx.apps.get(ref.key);
  if (!app) return { ok: false, run: fail("error", `I can't find ${ref.id}.`) };
  const facts: FactPatch[] = [];
  const parts: string[] = [];
  const assumptions: string[] = [];
  const list = [...changes];

  for (const c of list) {
    let value: string | number = c.value;
    if (c.relative) {
      const cur = c.field === "investmentLakh" ? app.investmentLakh.value : c.field === "experienceYears" ? app.experienceYears.value : c.field === "spaceSqft" ? app.spaceSqft.value : c.field === "targetLaunchMonths" ? app.targetLaunchMonths.value : null;
      if (cur === null || typeof c.value !== "number") return { ok: false, run: fail("clarify", `I don't have ${ref.id}'s current ${FIELD_LABEL[c.field]}, so I can't add to it. What is the new total?`, ref.key) };
      value = cur + c.value;
      assumptions.push(`Taking "${c.value} more" as ${cur} + ${c.value} = ${value} for ${FIELD_LABEL[c.field]}.`);
    }
    const problem = checkFactValue({ target: "application", key: ref.key, field: c.field, value } as never);
    if (problem) {
      const text = c.field === "city" ? `${String(value)} isn't one of our ${CITY_NAMES.length} cities (${CITY_NAMES.join(", ")}), so I didn't change anything.` : `I couldn't use that: ${problem}. Nothing was changed.`;
      return { ok: false, run: fail("error", text, ref.key) };
    }
    facts.push({ target: "application", key: ref.key, field: c.field, value } as FactPatch);
    if (c.assumed && c.field === "spaceAvailable") assumptions.push("You didn't say owned or rented, so I treated the space as rented.");
    const shown = c.field === "spaceAvailable" ? parseSpaceAvailable(value).value : c.field === "floor" ? parseFloor(value).value : c.field === "language" ? parseLanguage(value).value : c.field === "city" ? parseCity(value).value : value;
    parts.push(`${FIELD_LABEL[c.field]} → ${shown}`);
  }

  const has = (f: string) => facts.some((x) => x.target === "application" && x.field === f);
  if (has("city") && !has("pin")) {
    return { ok: false, run: fail("clarify", `To move ${ref.id} to ${String(facts.find((x) => x.target === "application" && x.field === "city")!.value)} I also need the new 6-digit pin, because decisions depend on it. What is it?`, ref.key) };
  }
  // "Found a ground-floor shop" with no word on owned or rented: treat it as rented, and say so.
  if (SPACE_FIELDS.some(has) && !has("spaceAvailable") && (app.spaceAvailable.value === null || app.spaceAvailable.value === "Not yet identified")) {
    facts.unshift({ target: "application", key: ref.key, field: "spaceAvailable", value: "Rented" });
    parts.unshift("space → Rented");
    assumptions.push("You didn't say owned or rented, so I treated the space as rented.");
  }
  if (has("spaceAvailable") && !has("spaceSqft") && app.spaceSqft.value === null) assumptions.push("The size isn't known, so the decision will ask the partner to confirm it.");
  if (has("spaceAvailable") && !has("floor") && (app.floor.value === null || app.floor.value === "Not known")) assumptions.push("The floor isn't known, so the decision will ask the partner to confirm it.");
  return { ok: true, facts, parts, assumptions };
}

interface Deps {
  commit: (spec: ChangeSpec) => CommitOutcome;
  now: string;
  message: string;
}

function committed(ctx: ChatCtx, spec: ChangeSpec, deps: Deps, assumptions: string[], appKey: string | null, doneText: string): ToolRun {
  const out = deps.commit(spec);
  if (!out.ok) return fail("error", out.message, appKey);
  const note = assumptions.length ? ` ${assumptions.join(" ")}` : "";
  const d = appKey ? decisionOf({ ...ctx, result: shownResult(out.session).result }, appKey) : undefined;
  // The assumption and the Undo hint always fit; a long list of knock-on changes is shortened to make room.
  const lead = `${doneText}${note}`;
  const budget = Math.max(25, 112 - lead.split(/\s+/).length);
  const short = `${lead} ${words(out.diff.text, budget)} You can undo this.`;
  return {
    ...base(),
    kind: "commit",
    short,
    long: `${doneText}\n${out.diff.text}${out.diff.slots.length ? `\nSlots: ${out.diff.slots.map((s) => `${s.territoryId} ${s.slotsFrom}→${s.slotsTo} free, ${s.reservedFrom}→${s.reservedTo} reserved`).join("; ")}.` : ""}${note}`,
    facts: redactNames(`${doneText} ${out.diff.text}${note}`, ctx.dir.apps),
    chips: d ? chipsOf(d) : [],
    appKey,
    diff: out.diff,
    entryId: out.entry.id,
    assumptions,
  };
}

function simulated(ctx: ChatCtx, spec: ChangeSpec, deps: Deps, assumptions: string[], appKey: string | null, what: string): ToolRun {
  const p = previewChange(ctx.session, spec, deps.now);
  if (p.result.invariantViolations.length) return fail("error", "I can't simulate that: it would break one of the engine's own checks.", appKey);
  const blocked = p.rejected[0];
  if (blocked) return fail("error", blocked.message, appKey);
  const note = assumptions.length ? ` ${assumptions.join(" ")}` : "";
  const short = words(`If ${what}: ${p.diff.text}${note} This was only a simulation; nothing was saved.`, 120);
  return { ...base(), kind: "simulation", short, long: short, facts: redactNames(`If ${what}: ${p.diff.text}${note} This was only a simulation; nothing was saved.`, ctx.dir.apps), diff: p.diff, appKey, assumptions };
}

function overrideFlow(ctx: ChatCtx, ref: Ref, status: Exclude<Status, "REDIRECT">, reason: string, deps: Deps, confirmedBumps?: string[]): ToolRun {
  const d = decisionOf(ctx, ref.key);
  if (!d) return fail("error", `${ref.id} has withdrawn, so there is no decision to override.`);
  const spec: ChangeSpec = {
    source: "override",
    description: `Override: ${ref.id} set to ${status}. Reason: ${reason}`,
    overrides: [{ appKey: ref.key, status, reason, time: deps.now, ...(confirmedBumps ? { confirmedBumps } : {}) }],
    directKeys: [ref.key],
  };
  const p = previewChange(ctx.session, spec, deps.now);
  if (p.rejected[0]) return fail("error", p.rejected[0].message, ref.key);
  if (p.pending[0] && !confirmedBumps) {
    const need = p.pending[0];
    return { ...base(), kind: "needs_confirmation", short: `${need.message} Say "confirm" to go ahead, or ignore this to leave things as they are.`, long: need.message, appKey: ref.key, pending: { ...spec, overrides: [{ ...spec.overrides![0], confirmedBumps: need.wouldBump }] } };
  }
  return committed(ctx, spec, deps, [], ref.key, `Human override recorded: ${ref.id} is now ${status.toLowerCase().replace("conditional", "approved with conditions")}.`);
}

/** Commit an override the user has now confirmed. */
export function confirmPending(ctx: ChatCtx, pending: ChangeSpec, deps: Pick<Deps, "commit" | "now">): ToolRun {
  const o = pending.overrides?.[0];
  const ref = o ? ctx.dir.apps.find((a) => a.key === o.appKey) : undefined;
  if (!o || !ref) return fail("error", "There is nothing waiting for confirmation.");
  return overrideFlow(ctx, ref, o.status as Exclude<Status, "REDIRECT">, o.reason, { ...deps, message: "" }, o.confirmedBumps ?? []);
}

const whatIfSpec = (ctx: ChatCtx, changes: WhatIfChangeT[]): { spec: ChangeSpec; what: string; assumptions: string[]; direct: string[] } | ToolRun => {
  const facts: FactPatch[] = [];
  const bits: string[] = [];
  const assumptions: string[] = [];
  const direct: string[] = [];
  for (const c of changes) {
    if ("territory" in c) {
      const t = resolveTerritory(c.territory, ctx.dir);
      if (t.kind === "unknown") return fail("error", t.message);
      const problem = checkFactValue({ target: "territory", key: t.key, field: c.field, value: c.value } as never);
      if (problem) return fail("error", `I couldn't use that: ${problem}.`);
      facts.push({ target: "territory", key: t.key, field: c.field, value: c.value } as FactPatch);
      bits.push(`${t.id} ${c.field === "openSlots" ? `had ${c.value} open slots` : `were ${c.value} priority`}`);
      continue;
    }
    const r = resolveOrFail(ctx, c.app);
    if (!r.ok) return r.run;
    direct.push(r.ref.key);
    if ("withdraw" in c) {
      facts.push({ target: "application", key: r.ref.key, field: "withdrawn", value: true });
      bits.push(`${r.ref.id} withdrew`);
      continue;
    }
    const b = buildFacts(ctx, r.ref, [{ field: c.field, value: c.value, relative: c.relative }]);
    if (!b.ok) return b.run;
    facts.push(...b.facts);
    assumptions.push(...b.assumptions);
    bits.push(`${r.ref.id}: ${b.parts.join(", ")}`);
  }
  return { spec: { source: "chat", description: `What if ${bits.join("; ")}`, facts, directKeys: direct }, what: bits.join("; "), assumptions, direct };
};

export function runTool(ctx: ChatCtx, call: ToolCall, deps: Deps): ToolRun {
  switch (call.name) {
    case "get_decision": {
      const r = resolveOrFail(ctx, call.args.app);
      if (!r.ok) return r.run;
      if (r.withdrawn) return { ...base(), short: `${r.ref.id} (${r.ref.name}) has withdrawn, so there is no decision any more.`, long: `${r.ref.id} (${r.ref.name}) has withdrawn, so there is no decision any more. Undo the withdrawal in the Change log to bring them back.`, facts: redactNames(`${r.ref.id} has withdrawn, so there is no decision any more.`, ctx.dir.apps), appKey: r.ref.key };
      const d = decisionOf(ctx, r.ref.key);
      return d ? describe(ctx, d, deps.message) : fail("error", `I can't find ${r.ref.id}.`);
    }
    case "compare": {
      const a = resolveOrFail(ctx, call.args.a);
      if (!a.ok) return a.run;
      const b = resolveOrFail(ctx, call.args.b);
      if (!b.ok) return b.run;
      const da = decisionOf(ctx, a.ref.key);
      const db = decisionOf(ctx, b.ref.key);
      if (!da || !db) return fail("error", "One of them has withdrawn, so there is nothing to compare.");
      return compare(ctx, da, db);
    }
    case "list_applications":
      return listApplications(ctx, call.args);
    case "territory_status":
      return territoryStatus(ctx, call.args.territory);
    case "explain_policy":
      return explainPolicy(ctx, call.args.topic);
    case "todays_actions":
      return todaysActions(ctx);
    case "apply_fact": {
      const r = resolveOrFail(ctx, call.args.app);
      if (!r.ok) return r.run;
      if (r.withdrawn) return fail("error", `${r.ref.id} has withdrawn. Undo the withdrawal first if that was a mistake.`, r.ref.key);
      const b = buildFacts(ctx, r.ref, call.args.changes);
      if (!b.ok) return b.run;
      return committed(ctx, { source: "chat", description: `Chat: ${r.ref.id}: ${b.parts.join(", ")}`, facts: b.facts, directKeys: [r.ref.key] }, deps, b.assumptions, r.ref.key, `Updated ${r.ref.id}: ${b.parts.join(", ")}.`);
    }
    case "apply_territory_fact": {
      const t = resolveTerritory(call.args.territory, ctx.dir);
      if (t.kind === "unknown") return fail("error", t.message);
      const priority = typeof call.args.value === "string" ? call.args.value[0].toUpperCase() + call.args.value.slice(1).toLowerCase() : call.args.value;
      const value = call.args.field === "priority" ? priority : call.args.value;
      const problem = checkFactValue({ target: "territory", key: t.key, field: call.args.field, value } as never);
      if (problem) return fail("error", `I couldn't use that: ${problem}. Nothing was changed.`);
      const label = call.args.field === "openSlots" ? `${t.id} now has ${value} open slot${value === 1 ? "" : "s"}` : `${t.id} priority is now ${value}`;
      return committed(ctx, { source: "chat", description: `Chat: ${label}`, facts: [{ target: "territory", key: t.key, field: call.args.field, value } as FactPatch] }, deps, [], null, `${label}.`);
    }
    case "withdraw": {
      const r = resolveOrFail(ctx, call.args.app);
      if (!r.ok) return r.run;
      if (r.withdrawn) return { ...base(), short: `${r.ref.id} has already withdrawn.`, long: `${r.ref.id} has already withdrawn.`, appKey: r.ref.key };
      return committed(ctx, { source: "chat", description: `${r.ref.id} withdrew`, facts: [{ target: "application", key: r.ref.key, field: "withdrawn", value: true }], directKeys: [r.ref.key] }, deps, [], r.ref.key, `${r.ref.id} (${r.ref.name}) is marked as withdrawn.`);
    }
    case "what_if": {
      const built = whatIfSpec(ctx, call.args.changes);
      if ("kind" in built) return built;
      return simulated(ctx, built.spec, deps, built.assumptions, built.direct[0] ?? null, built.what);
    }
    case "override_decision": {
      const r = resolveOrFail(ctx, call.args.app);
      if (!r.ok) return r.run;
      return overrideFlow(ctx, r.ref, call.args.status, call.args.reason, deps);
    }
    case "lock_decision": {
      const r = resolveOrFail(ctx, call.args.app);
      if (!r.ok) return r.run;
      const d = decisionOf(ctx, r.ref.key);
      if (!d) return fail("error", `${r.ref.id} has withdrawn.`);
      if (d.locked) return { ...base(), short: `${d.appId} was already marked as sent on ${formatDate(d.locked.date)}.`, long: `${d.appId} was already marked as sent on ${formatDate(d.locked.date)}.`, appKey: d.appKey };
      const t = ctx.result.territories.find((x) => x.id === d.slotTerritoryId);
      if ((d.status !== "APPROVED" && d.status !== "CONDITIONAL") || !d.pin || !t) return fail("error", `Only an approved decision with a pin can be marked as sent. ${d.appId} is ${d.label}.`, d.appKey);
      return committed(ctx, { source: "lock", description: `Marked ${d.appId} as sent to the partner`, locks: [{ appKey: d.appKey, status: d.status, pin: d.pin, territoryKey: t.key, date: ctx.today }], directKeys: [d.appKey] }, deps, [], d.appKey, `${d.appId} is marked as sent to the partner. It is now protected from being displaced.`);
    }
    case "out_of_scope":
      return fail("error", "I can only help with these applications and territories: why a decision was made, comparisons, new facts, what-ifs and the team's actions.");
  }
}

