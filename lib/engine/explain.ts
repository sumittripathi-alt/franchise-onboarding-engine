// Deterministic explanations (SPEC §6.8, G9.12). Every decision gets a one-line "why", a fuller
// explanation naming the first differing factor against competitors, "what would change this", and
// at least one next step. Users always see status labels, never codes.

import { capitalThresholds, type Assessment } from "./readiness";
import type { Outcome } from "./allocate";
import type { BrandProfile } from "@/lib/policy/types";
import { OFFER_HOLD_DAYS, PROVISIONAL_DAYS } from "@/lib/policy/brandProfiles";
import { addDays, formatDate } from "@/lib/planner/dates";
import { STATUS_META, type CannibalisationInfo, type Condition, type PaybackInfo, type Status } from "@/lib/types";

export interface ExplainContext {
  profile: BrandProfile;
  today: string;
  idOf: (key: string) => string;
  nameOf: (key: string) => string;
  territoryId: (key: string | null) => string;
  slotsOf: (territoryKey: string) => number;
  /** Top of the waitlist that would get this slot if it were released. */
  nextInLine: (territoryKey: string | null, city: string | null) => string | null;
  storeAt: (pin: string) => string | null;
}

export interface Explained {
  headline: string;
  explanation: string;
  counterfactual: string;
  nextSteps: string[];
  questions: string[];
}

const lakh = (x: number) => `₹${Number.isInteger(x) ? x : x.toFixed(1)} lakh`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const sentence = (s: string) => {
  const t = s.trim();
  return t ? t[0].toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? "" : ".") : "";
};
const lcFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);
/** Issue messages start "Row N: APP-x: …" or "Row N: APP-x is …"; keep the substance. */
const issueText = (m: string, id: string) =>
  m.replace(/^Row \d+:\s*/, "").replace(new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:?\\s*`), "");

function profileText(a: Assessment): string {
  if (!a.bands) return "";
  return `${a.spaceText}; ${lakh(a.investment ?? 0)} to invest; ${a.experienceText}`;
}

function slotPhrase(slots: number, tid: string): string {
  return slots === 1 ? `${tid}'s only slot` : `one of ${tid}'s ${slots} slots`;
}

/** What the applicant could change to outrank a competitor, given the factor they lost on. */
function improvement(factor: string, a: Assessment, profile: BrandProfile): string | null {
  switch (factor) {
    case "space":
      return `a ready ground-floor space of at least ${profile.space.minSqft} sq ft would improve its position`;
    case "capital": {
      if (!a.tier || !a.bands) return null;
      const th = capitalThresholds(profile, a.tier);
      const next = a.bands.capital === 1 ? th.min : th.band3;
      return `investment capacity of ${lakh(next)} or more would improve its position`;
    }
    default:
      return null;
  }
}

function factorOf(text: string): string {
  if (text.startsWith("location offers")) return "spaceType";
  if (/better space/.test(text)) return "space";
  if (/investment capacity/.test(text)) return "capital";
  if (/experience/.test(text)) return "experience";
  if (/further from existing/.test(text)) return "distance";
  if (/open sooner/.test(text)) return "launch";
  return "id";
}

/** "Find a suitable space within 45 days" + deadline → "Find a suitable space by 9 Dec 2026". */
function conditionLines(conds: Condition[]): string[] {
  return conds.map((c) => `${c.text.replace(/\s+within \d+ days$/, "")} by ${formatDate(c.deadline)}`);
}

export function explain(
  a: Assessment,
  o: Outcome,
  status: Status,
  conditions: Condition[],
  cann: CannibalisationInfo | null,
  payback: PaybackInfo | null,
  ctx: ExplainContext,
): Explained {
  const id = a.id || a.key;
  const label = STATUS_META[status].label;
  const lines: string[] = [];
  const questions: string[] = [];
  let headline = "";
  let counterfactual = "";
  const next: string[] = [];
  const loi = `Sign the letter of intent and pay the brand fee by ${formatDate(addDays(ctx.today, 7))}`;

  const competitorLines = () => {
    for (const c of o.competitors) {
      if (c.relation === "pin") {
        lines.push(
          c.won
            ? `${c.appId} also wanted pin ${a.app.pin.value}; ${id} ranks higher because ${c.firstDifferingFactor}.`
            : `${c.appId} also wanted pin ${a.app.pin.value} and ranks higher because ${c.firstDifferingFactor}.`,
        );
      } else if (c.relation === "slot") {
        lines.push(
          c.won
            ? `It ranks above ${c.appId} (waitlisted) because ${c.firstDifferingFactor}.`
            : `To get a slot it would need to outrank ${c.appId}, the last applicant with a slot; ${c.firstDifferingFactor}.`,
        );
      } else {
        lines.push(`${c.appId} was offered the last free location ahead of it because ${c.firstDifferingFactor}.`);
      }
    }
  };
  const commonTail = () => {
    if (cann) lines.push(cann.note);
    if (o.provisional) {
      const until = formatDate(addDays(ctx.today, PROVISIONAL_DAYS));
      lines.push(
        `Provisional for ${PROVISIONAL_DAYS} days (until ${until}): ${ctx.idOf(o.provisional.byKey)} is on hold but ranks higher for this pin if their details are confirmed.`,
      );
    }
    if (payback) {
      lines.push(
        `Estimated payback: about ${Math.round(payback.months)} months on the standard ${lakh(payback.basisLakh)} investment${payback.warning ? `, slower than the ${ctx.profile.paybackWarningMonths}-month threshold` : ""}.`,
      );
    }
    for (const f of a.flags) if (f.code === "TARGET_NOT_FEASIBLE" || f.code === "NOTES_TARGET_DISAGREE") lines.push(f.text);
  };

  // ---- Human override (any status) ----
  if (o.override) {
    headline = `Human override: ${label}. Reason: ${o.override.reason}`;
    lines.push(`This decision was set by a person, not the rules, on ${o.override.time.slice(0, 10)}. Reason given: "${o.override.reason}".`);
    if (o.pin) lines.push(`It holds pin ${o.pin} in ${ctx.territoryId(o.slotTerritoryKey)}.`);
    counterfactual = "Removing the override returns this application to the rule-based decision.";
    if (status === "HOLD") {
      for (const i of a.blocking) if (i.question) questions.push(i.question);
      next.push(...(questions.length ? questions.map((q) => `Call the partner and ask: ${q}`) : ["Follow up with the partner on the reason for the hold"]));
    } else if (status === "REJECT") next.push("Tell the partner the decision and the reason given");
    else if (status === "WAITLIST") next.push("Keep the partner on the waitlist and tell them why");
    else next.push(...conditionLines(conditions), loi);
    commonTail();
    return { headline, explanation: lines.join(" "), counterfactual, nextSteps: next, questions };
  }

  switch (status) {
    case "APPROVED":
    case "CONDITIONAL": {
      const tid = ctx.territoryId(o.slotTerritoryKey);
      const slots = o.slotTerritoryKey ? ctx.slotsOf(o.slotTerritoryKey) : 0;
      if (o.locked) {
        headline = `${label}: sent to the partner on ${formatDate(o.locked.date)}; pin ${o.pin} in ${tid} is committed.`;
        lines.push(`This decision was sent to the partner on ${formatDate(o.locked.date)}, so later changes can't take the slot away.`);
      } else {
        const rank = o.slotRank && o.slotContestSize ? ` (ranked #${o.slotRank} of ${o.slotContestSize} for ${plural(slots, "slot")})` : "";
        headline =
          status === "APPROVED"
            ? `Wins pin ${o.pin} and ${slotPhrase(slots, tid)}${rank}, with no conditions.`
            : `Wins pin ${o.pin} and ${slotPhrase(slots, tid)}${rank}, if ${conditions.length === 1 ? "one condition is" : `${conditions.length} conditions are`} met: ${lcFirst(conditions[0].text)}${conditions.length > 1 ? `; plus ${plural(conditions.length - 1, "more")}` : ""}.`;
        lines.push(`${id} has ${profileText(a)}.`);
      }
      competitorLines();
      if (status === "CONDITIONAL") {
        lines.push(`Conditions: ${conditionLines(conditions).join("; ")}. Missing ${conditions.length === 1 ? "it" : "one"} releases the slot.`);
      }
      commonTail();
      if (o.provisional) {
        counterfactual = `If ${ctx.idOf(o.provisional.byKey)}'s details are confirmed within ${PROVISIONAL_DAYS} days, ${ctx.idOf(o.provisional.byKey)} takes pin ${o.pin} and this decision changes.${status === "CONDITIONAL" ? ` Otherwise, meeting the conditions moves ${id} to Approved.` : ""}`;
      } else if (status === "CONDITIONAL") {
        counterfactual = `If ${id} ${conditions.length === 1 ? "meets this condition" : "meets all the conditions"} (${conditions.map((c) => lcFirst(c.text)).join("; ")}), it moves to Approved. Missing a deadline releases the slot${ctx.nextInLine(o.slotTerritoryKey, null) ? ` to ${ctx.nextInLine(o.slotTerritoryKey, null)}` : ""}.`;
      } else {
        counterfactual = "Nothing more is needed. It would change only if the details change or onboarding deadlines are missed.";
      }
      next.push(...conditionLines(conditions), loi);
      if (a.launch) next.push(`Plan for an earliest realistic launch of ${formatDate(a.launch.earliest)}`);
      break;
    }

    case "HOLD": {
      const issues = a.blocking.length ? a.blocking : a.issues.filter((i) => i.severity === "blocking");
      const first = issues[0] ? issueText(issues[0].message, id) : "some details are missing";
      headline = `On hold: ${lcFirst(first).replace(/\.$/, "")}${issues.length > 1 ? ` (plus ${plural(issues.length - 1, "more issue")})` : ""}.`;
      for (const i of issues) {
        lines.push(sentence(issueText(i.message, id)));
        if (i.evidence) lines.push(`The applicant wrote: "${i.evidence}".`);
        if (i.question && !questions.includes(i.question)) questions.push(i.question);
      }
      lines.push("An on-hold application doesn't take a slot.");
      if (o.ifClarified) {
        const tid = ctx.territoryId(o.ifClarified.territoryKey);
        const slots = ctx.slotsOf(o.ifClarified.territoryKey);
        const within = o.ifClarified.rank <= slots;
        lines.push(
          `If the questions are resolved and the form details stand, it would rank #${o.ifClarified.rank} in ${tid} (${plural(slots, "slot")})${o.ifClarified.winsPin ? ` and win pin ${o.ifClarified.pin}` : ""}.`,
        );
        counterfactual = `Answering the question${questions.length === 1 ? "" : "s"} lets it be decided. If the form details stand, it would rank #${o.ifClarified.rank} in ${tid}, ${within ? "within the slots, so it would be approved (possibly with conditions)" : "outside the slots, so it would be waitlisted"}.`;
      } else {
        counterfactual = `Answering the question${questions.length === 1 ? "" : "s"} lets it be decided on its merits.`;
      }
      next.push(...(questions.length ? questions.map((q) => `Call the partner and ask: ${q}`) : ["Call the partner to clarify the details listed"]));
      break;
    }

    case "REJECT": {
      const gate = a.gate!;
      headline = `Not approved: ${gate.text}.`;
      lines.push(sentence(`${id} fails a hard requirement for the ${ctx.profile.label.toLowerCase()} model: ${gate.text}`));
      counterfactual = `${sentence(gate.fix)}`;
      next.push(`Tell the partner what would need to change: ${lcFirst(gate.fix)}`);
      break;
    }

    case "REDIRECT": {
      const offer = o.offer!;
      const tid = ctx.territoryId(offer.territoryKey);
      const home = a.app.pin.value;
      const why =
        offer.homeReason === "store"
          ? `pin ${home} already has existing store ${ctx.storeAt(home!) ?? ""}`.trim()
          : offer.homeReason === "notInTerritory"
            ? `pin ${home} isn't in any of our territories`
            : `${ctx.idOf(o.lostTo!.key)} ranks higher for pin ${home} (${o.lostTo!.text})`;
      const expires = formatDate(addDays(ctx.today, OFFER_HOLD_DAYS));
      headline = `Offered pin ${offer.pin} in ${tid} instead, because ${why}. Held until ${expires}.`;
      lines.push(`${id} is a good partner (${profileText(a)}), but ${why}.`);
      lines.push(
        `Location offers go first to applicants with no space yet, then rented space, then owned space; then by the usual ranking. Pin ${offer.pin} is ${offer.distanceKm !== null ? `${offer.distanceKm.toFixed(1)} km from pin ${home}` : `in ${tid}`}.`,
      );
      if (a.spaceType === "Owned") {
        const cause =
          offer.homeReason === "store"
            ? `${ctx.storeAt(home!) ?? "an existing store"} is already there`
            : offer.homeReason === "notInTerritory"
              ? "it is outside our planned territories"
              : `${ctx.idOf(o.lostTo!.key)} was chosen for that pin`;
        lines.push(`This needs a new space. The owned space in ${home} can't host a store because ${cause}.`);
      } else if (a.spaceType === "Rented") {
        lines.push(`This needs a new space; the current lease in ${home} would need to move.`);
      }
      competitorLines();
      commonTail();
      const nextUp = ctx.nextInLine(null, a.app.city.value);
      counterfactual = `Accepting by ${expires} reserves pin ${offer.pin}. ${id}'s own pin isn't possible because ${why}.${nextUp ? ` If it declines, the offer goes to ${nextUp}.` : ""}`;
      next.push(`Accept or decline the offer of pin ${offer.pin} by ${expires}`, ...conditionLines(conditions));
      break;
    }

    case "WAITLIST": {
      const city = a.app.city.value ?? "this city";
      if (o.committedTo) {
        headline = `Waitlisted: slot already committed to ${ctx.idOf(o.committedTo.key)} on ${formatDate(o.committedTo.date)}.`;
        lines.push(
          `${id} would rank higher, but ${ctx.idOf(o.committedTo.key)} was already sent a decision, and a yes already given isn't taken back.`,
        );
        counterfactual = `It would get a slot if ${ctx.idOf(o.committedTo.key)} withdraws or another slot opens.`;
        next.push(o.waitlist ? `Tell the partner they are #${o.waitlist.rank} on the waitlist; they move up if a slot frees` : "Keep the partner on the waitlist");
      } else if (o.duplicateOf) {
        headline = `Waitlisted: ${ctx.nameOf(a.key)} already holds a slot through ${ctx.idOf(o.duplicateOf)}; one slot per person.`;
        lines.push(`${id} and ${ctx.idOf(o.duplicateOf)} have the same applicant name. A person can hold at most one slot.`);
        counterfactual = `If ${ctx.idOf(o.duplicateOf)} is withdrawn, or the two turn out to be different people, ${id} would be considered on its own merits.`;
        next.push(`Confirm with the applicant whether ${id} and ${ctx.idOf(o.duplicateOf)} are the same person`);
      } else if (o.codes.includes("OUTSIDE_PLAN")) {
        headline = `Waitlisted: ${city} has no territory in the current plan, so ${id} is kept in the talent pool.`;
        lines.push(`${id} has ${profileText(a)}. ${city} isn't covered by any territory with slots right now.`);
        counterfactual = `It would be considered if a territory covering ${city} (pin ${a.app.pin.value}) is added.`;
        next.push(`Keep ${id} in the ${city} talent pool and contact them when a territory opens`);
      } else if (o.waitlist?.scope === "territory") {
        const tid = ctx.territoryId(o.waitlist.territoryKey);
        const slots = ctx.slotsOf(o.waitlist.territoryKey);
        headline =
          slots === 0
            ? `Waitlisted #${o.waitlist.rank} for ${tid}: it has no open slots right now.`
            : `Waitlisted #${o.waitlist.rank} for ${tid}: it has ${plural(slots, "slot")}, and ${plural(slots, "applicant")} rank${slots === 1 ? "s" : ""} higher.`;
        lines.push(`${id} wins pin ${a.app.pin.value} but not a slot. It has ${profileText(a)}.`);
        competitorLines();
        const bar = o.competitors.find((c) => c.relation === "slot" && !c.won);
        const imp = bar ? improvement(factorOf(bar.firstDifferingFactor), a, ctx.profile) : null;
        counterfactual = `It moves up if a slot frees in ${tid} (a withdrawal, a missed condition or an extra slot).${imp ? ` Also, ${imp}.` : ""}`;
        next.push(`Tell the partner they are #${o.waitlist.rank} on the ${tid} waitlist`, imp ? sentence(imp) : `They move up automatically if a slot frees in ${tid}`);
      } else {
        // Lost its own pin (or pin unavailable) and no free slot anywhere in the city.
        const home = a.app.pin.value;
        const why = o.codes.includes("PIN_HAS_EXISTING_STORE")
          ? `pin ${home} already has existing store ${ctx.storeAt(home!) ?? ""}`.trim()
          : o.codes.includes("PIN_NOT_IN_TERRITORY")
            ? `pin ${home} isn't in any of our territories`
            : o.lostTo
              ? `${ctx.idOf(o.lostTo.key)} ranks higher for pin ${home} (${o.lostTo.text})`
              : `pin ${home} isn't available`;
        const rank = o.waitlist?.scope === "city" ? `#${o.waitlist.rank} ` : "";
        headline = `Waitlisted ${rank}for ${city}: ${why}, and no ${city} territory has a free slot to offer.`;
        lines.push(`${id} has ${profileText(a)}.`);
        competitorLines();
        counterfactual = `It would be offered another ${city} location if a slot frees in any ${city} territory.`;
        next.push(`Tell the partner they are ${rank ? `${rank}in the ${city} queue` : "on the waitlist"} for another location`, "Ask whether they would move to another pin in the city if one opens");
      }
      break;
    }
  }

  return { headline, explanation: lines.filter(Boolean).join(" "), counterfactual, nextSteps: next.filter(Boolean), questions };
}
