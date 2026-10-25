// Deterministic explanations (SPEC §6.8, G9.12). Every decision gets a short one-line "why" (about
// 25 words, no nested brackets), a fuller explanation naming the first differing factor against
// competitors, "what would change this", and next steps for both the partner and the team.
// Users always see status labels, never codes.

import type { Assessment } from "./readiness";
import { capitalThresholds } from "./readiness";
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
  /** IDs holding a slot in the territory. */
  slotHolders: (territoryKey: string) => string[];
  /** Who gets a slot freed in this territory: first waitlisted with a pin in it, else the city's top. */
  nextInLine: (territoryKey: string | null, city: string | null) => string | null;
  /** 1-based position among the city's waitlisted applicants whose pin is in the territory, or null. */
  lineFor: (key: string, territoryKey: string) => number | null;
  cityHasTerritory: (city: string) => boolean;
  storeAt: (pin: string) => string | null;
}

export interface Explained {
  headline: string;
  explanation: string;
  counterfactual: string;
  partnerSteps: string[];
  teamSteps: string[];
  questions: string[];
}

const lakh = (x: number) => `₹${Number.isInteger(x) ? x : x.toFixed(1)} lakh`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const sentence = (s: string) => {
  const t = s.trim();
  return t ? t[0].toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? "" : ".") : "";
};
/** Lowercase the first letter, unless it starts an ID or acronym ("APP-031", "ST-06"). */
const lcFirst = (s: string) => (s && !/^[A-Z]{2}/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
/** "9 Dec 2026" → "9 Dec", for the one-line why. */
const dShort = (iso: string) => formatDate(iso).replace(/ \d{4}$/, "");
const listIds = (ids: string[]) => (ids.length <= 1 ? (ids[0] ?? "") : `${ids.slice(0, -1).join(", ")} and ${ids[ids.length - 1]}`);

/** Issue messages start "Row N: APP-x: …"; keep the substance. */
function issueText(m: string, id: string): string {
  return m.replace(/^Row \d+:\s*/, "").replace(new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*`), "");
}
const firstSentence = (s: string) => s.match(/^.*?[.!?](\s|$)/)?.[0].trim() ?? s;

/** The deciding factor, as a short phrase for the one-line why. */
const FACTOR_SHORT: Record<string, string> = {
  spaceType: "offer order",
  territoryPriority: "territory priority",
  space: "better space",
  capital: "more investment",
  experience: "more experience",
  distance: "further from stores",
  launch: "can open sooner",
  id: "applied earlier",
  override: "human override",
};

function profileText(a: Assessment): string {
  if (!a.bands) return "";
  return `${a.spaceText}; ${lakh(a.investment ?? 0)} to invest; ${a.experienceText}`;
}

function slotPhrase(slots: number, tid: string): string {
  return slots === 1 ? `${tid}'s only slot` : `a ${tid} slot`;
}

/** What the applicant could change to outrank a competitor, given the factor they lost on. */
function improvement(factor: string, a: Assessment, profile: BrandProfile): string | null {
  switch (factor) {
    case "space":
      return (a.bands?.space ?? 3) < 3 ? `a ready ground-floor space of at least ${profile.space.minSqft} sq ft would move it up` : null;
    case "capital": {
      if (!a.tier || !a.bands) return null;
      const th = capitalThresholds(profile, a.tier);
      return `investment capacity of ${lakh(a.bands.capital === 1 ? th.min : th.band3)} or more would move it up`;
    }
    default:
      return null;
  }
}

/** "Find a suitable space within 45 days" + deadline → "Find a suitable space by 9 Dec 2026". */
function conditionLine(c: Condition): string {
  return `${c.text.replace(/\s+within \d+ days$/, "")} by ${formatDate(c.deadline)}`;
}

/** When notes name a festival that can't be met: the clause for the one-line why. */
function festivalClause(a: Assessment): string | null {
  const l = a.launch;
  if (!l.festival || l.testDate !== l.festival.date || !a.flags.some((f) => f.code === "TARGET_NOT_FEASIBLE")) return null;
  return `Opening before ${l.festival.name} (${dShort(l.festival.date)}) isn't possible${a.spaceType === "none" ? " without a space" : ""}; earliest realistic opening is ${formatDate(l.earliest)}`;
}

/** Info flags that belong in every explanation, whatever the status. */
const NOTE_FLAGS = new Set([
  "INTEGRITY_CONCERN",
  "TARGET_NOT_FEASIBLE",
  "TIGHT_TIMELINE",
  "NOTES_TARGET_DISAGREE",
  "EXPERIENCE_UNDER_REPORTED",
  "RENT_BURDEN_RISK",
]);

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
  const partner: string[] = [];
  const team: string[] = [];
  let headline = "";
  let counterfactual = "";
  const city = a.app.city.value ?? "this city";
  const loi = `Sign the letter of intent and pay the brand fee by ${formatDate(addDays(ctx.today, 7))}`;
  const partnerConds = conditions.filter((c) => c.owner === "partner");
  const teamConds = conditions.filter((c) => c.owner === "team");
  const fest = festivalClause(a);

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
            ? `It ranks above ${c.appId}, who is waitlisted, because ${c.firstDifferingFactor}.`
            : `To get a slot it would need to outrank ${c.appId}, the last applicant with a slot here: ${c.firstDifferingFactor}.`,
        );
      } else {
        lines.push(`The last free location in ${city} went to ${c.appId}, who ranks higher because ${c.firstDifferingFactor}.`);
      }
    }
  };
  const tail = () => {
    if (cann) lines.push(cann.note);
    if (o.provisional) {
      lines.push(
        `Provisional for ${PROVISIONAL_DAYS} days (until ${formatDate(addDays(ctx.today, PROVISIONAL_DAYS))}): ${ctx.idOf(o.provisional.byKey)} is on hold but ranks higher for this pin if their details are confirmed.`,
      );
    }
    if (payback) {
      lines.push(
        `Estimated payback: about ${Math.round(payback.months)} months on the standard ${lakh(payback.basisLakh)} investment${payback.warning ? `, slower than the ${ctx.profile.paybackWarningMonths}-month threshold` : ""}.`,
      );
    }
    for (const f of a.flags) if (NOTE_FLAGS.has(f.code)) lines.push(f.text);
    for (const s of a.suggestions) lines.push(s);
  };

  // ---- Human override (any status) ----
  if (o.override) {
    headline = `Human override: ${label}. Reason: ${o.override.reason}`;
    lines.push(`This decision was set by a person, not the rules, on ${o.override.time.slice(0, 10)}. Reason given: "${o.override.reason}".`);
    if (o.pin) lines.push(`It holds pin ${o.pin} in ${ctx.territoryId(o.slotTerritoryKey)}.`);
    counterfactual = "Removing the override returns this application to the rule-based decision.";
    if (status === "HOLD") {
      for (const i of a.blocking) if (i.question) questions.push(i.question);
      partner.push(...(questions.length ? questions.map((q) => `Answer: ${q}`) : ["Wait for us to get in touch"]));
      team.push(...(questions.length ? questions.map((q) => `Call the partner and ask: ${q}`) : ["Follow up with the partner on the reason for the hold"]));
    } else if (status === "REJECT") {
      partner.push("Read the decision and the reason given");
      team.push("Tell the partner the decision and the reason given");
    } else if (status === "WAITLIST") {
      partner.push("No action needed; we'll contact you if a slot frees");
      team.push("Tell the partner they are waitlisted, and why");
    } else {
      partner.push(...partnerConds.map(conditionLine), loi);
      team.push(...teamConds.map(conditionLine), "Send the decision to the partner and mark it as sent");
    }
    tail();
    return { headline, explanation: lines.join(" "), counterfactual, partnerSteps: partner, teamSteps: team, questions };
  }

  switch (status) {
    case "APPROVED":
    case "CONDITIONAL": {
      const tid = ctx.territoryId(o.slotTerritoryKey);
      const slots = o.slotTerritoryKey ? ctx.slotsOf(o.slotTerritoryKey) : 0;
      const wins = `Wins pin ${o.pin} and ${slotPhrase(slots, tid)}`;
      if (o.locked) {
        headline = `${label}: sent to the partner on ${formatDate(o.locked.date)}; pin ${o.pin} in ${tid} is committed.`;
        lines.push(`This decision was sent to the partner on ${formatDate(o.locked.date)}, so later changes can't take the slot away.`);
      } else if (status === "APPROVED") {
        const provisional = o.provisional ? `; provisional until ${ctx.idOf(o.provisional.byKey)} is checked` : "";
        headline = fest
          ? `${fest}. ${wins}, no conditions.`
          : `${wins}, ranked #${o.slotRank} of ${o.slotContestSize}, with no conditions${provisional}.`;
      } else if (partnerConds.length) {
        const c = partnerConds[0];
        const more = partnerConds.length > 1 ? `, plus ${plural(partnerConds.length - 1, "more condition")}` : "";
        const internal = teamConds.length ? "; internal sign-off also needed" : "";
        const provisional = o.provisional ? `; provisional until ${ctx.idOf(o.provisional.byKey)} is checked` : "";
        headline = fest
          ? `${fest}. Slot held if it ${c.short} by ${dShort(c.deadline)}.`
          : `${wins} if it ${c.short} by ${dShort(c.deadline)}${more}${internal}${provisional}.`;
      } else {
        const near =
          cann?.nearestStore && cann.nearestStore.km <= cann.radiusKm
            ? `${cann.nearestStore.km.toFixed(1)} km from ${cann.nearestStore.id}`
            : cann?.nearbyReserved[0]
              ? `${cann.nearbyReserved[0].km.toFixed(1)} km from ${cann.nearbyReserved[0].appId}'s location`
              : "close to another store";
        headline = `${wins}, pending expansion-head sign-off: it is ${near}.`;
      }
      if (!o.locked) lines.push(`${id} has ${profileText(a)}. It ranks #${o.slotRank} of ${o.slotContestSize} for ${tid}'s ${plural(slots, "slot")}.`);
      competitorLines();
      if (partnerConds.length) {
        lines.push(`Conditions for the partner: ${partnerConds.map(conditionLine).join("; ")}. Missing ${partnerConds.length === 1 ? "it" : "one"} releases the slot.`);
      }
      if (teamConds.length) lines.push(`Internal: ${teamConds.map(conditionLine).join("; ")}.`);
      tail();

      const next = ctx.nextInLine(o.slotTerritoryKey, a.app.city.value);
      if (o.provisional) {
        const by = ctx.idOf(o.provisional.byKey);
        counterfactual = `If ${by}'s details are confirmed within ${PROVISIONAL_DAYS} days, ${by} takes pin ${o.pin} and this decision changes.${status === "CONDITIONAL" ? ` Otherwise, meeting the conditions moves ${id} to Approved.` : ""}`;
      } else if (status === "CONDITIONAL") {
        const doing = partnerConds.length ? `${id} ${partnerConds.map((c) => c.short).join(" and ")}` : "the internal sign-off is given";
        counterfactual = `When ${doing}${partnerConds.length && teamConds.length ? ", and the internal sign-off is given" : ""}, it moves to Approved. A missed deadline releases the slot${next ? ` to ${next}` : ""}.`;
      } else {
        counterfactual = "Nothing more is needed. It would change only if the details change or onboarding deadlines are missed.";
      }

      if (partnerConds.length) {
        partner.push(...partnerConds.map(conditionLine), loi);
      } else if (teamConds.length) {
        partner.push(
          `Nothing yet: we'll confirm after an internal check by ${formatDate(teamConds[0].deadline)}`,
          "Then sign the letter of intent and pay the brand fee within 7 days of our confirmation",
        );
      } else {
        partner.push(loi);
      }
      partner.push(`Plan for an earliest realistic opening of ${formatDate(a.launch.earliest)}`);
      if (o.provisional) {
        team.push(
          `Chase ${ctx.idOf(o.provisional.byKey)}'s answer before sending this decision; it's provisional until ${formatDate(addDays(ctx.today, PROVISIONAL_DAYS))}`,
        );
      }
      team.push(...teamConds.map(conditionLine));
      team.push(
        o.locked
          ? "Track onboarding milestones"
          : status === "APPROVED"
            ? "Send the approval and letter of intent, then mark the decision as sent"
            : `Send the conditional approval and track ${plural(conditions.length, "condition")}`,
      );
      break;
    }

    case "HOLD": {
      const issues = a.blocking.length ? a.blocking : a.issues.filter((i) => i.severity === "blocking");
      const first = issues[0] ? firstSentence(issueText(issues[0].message, id)) : "some details are missing";
      const quote = issues[0]?.evidence && issues[0].evidence.length <= 30 ? `, quoting "${issues[0].evidence}"` : "";
      headline = `On hold: ${lcFirst(first).replace(/\.$/, "")}${quote}${issues.length > 1 ? `, plus ${plural(issues.length - 1, "more issue")}` : ""}.`;
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
          `If the questions are resolved and the form details stand, it would rank #${o.ifClarified.rank} in ${tid}, which has ${plural(slots, "slot")}${o.ifClarified.winsPin ? `, and win pin ${o.ifClarified.pin}` : ""}.`,
        );
        counterfactual = `Answering the question${questions.length === 1 ? "" : "s"} lets it be decided. If the form details stand, it would rank #${o.ifClarified.rank} in ${tid}, ${within ? "within the slots, so it would be approved, possibly with conditions" : "outside the slots, so it would be waitlisted"}.`;
      } else {
        counterfactual = `Answering the question${questions.length === 1 ? "" : "s"} lets it be decided on its merits.`;
      }
      tail();
      partner.push(...(questions.length ? questions.map((q) => `Answer: ${q}`) : ["Send the missing details"]));
      team.push(...(questions.length ? questions.map((q) => `Call the partner and ask: ${q}`) : ["Call the partner to get the missing details"]));
      if (o.ifClarified?.winsPin) team.push(`Chase this within ${PROVISIONAL_DAYS} days: ${id} would win pin ${o.ifClarified.pin} once clarified`);
      break;
    }

    case "REJECT": {
      const gate = a.gate!;
      headline = `Not approved: ${gate.text}.`;
      lines.push(sentence(`${id} fails a hard requirement for the ${ctx.profile.label.toLowerCase()} model: ${gate.text}`));
      tail();
      counterfactual = sentence(gate.fix);
      partner.push(sentence(gate.fix).replace(/\.$/, ""), ...a.suggestions);
      team.push("Send the decision with what would need to change", ...a.suggestions.map((s) => `Offer the suggestion: "${s}"`));
      break;
    }

    case "REDIRECT": {
      const offer = o.offer!;
      const tid = ctx.territoryId(offer.territoryKey);
      const home = a.app.pin.value;
      const store = home ? ctx.storeAt(home) : null;
      const shortWhy =
        offer.homeReason === "store"
          ? `pin ${home} already has store ${store}`
          : offer.homeReason === "notInTerritory"
            ? `pin ${home} isn't in any territory`
            : `${ctx.idOf(o.lostTo!.key)} won pin ${home} (${FACTOR_SHORT[o.lostTo!.factor] ?? "ranked higher"})`;
      const expires = addDays(ctx.today, OFFER_HOLD_DAYS);
      headline = `Offered pin ${offer.pin} in ${tid} because ${shortWhy}. Offer held until ${dShort(expires)}.`;
      lines.push(`${id} is a good partner: ${profileText(a)}.`);
      if (offer.homeReason === "lostPin") lines.push(`${ctx.idOf(o.lostTo!.key)} ranks higher for pin ${home} because ${o.lostTo!.text}.`);
      lines.push(
        `Location offers go first to applicants with no space yet, then rented space, then owned space, then by the usual ranking. Pin ${offer.pin} is ${offer.distanceKm !== null ? `${offer.distanceKm.toFixed(1)} km from pin ${home}` : `in ${tid}`}.`,
      );
      if (a.spaceType === "Owned") {
        const cause =
          offer.homeReason === "store"
            ? `${store ?? "an existing store"} is already there`
            : offer.homeReason === "notInTerritory"
              ? "it is outside our planned territories"
              : `${ctx.idOf(o.lostTo!.key)} was chosen for that pin`;
        lines.push(`This needs a new space. The owned space in ${home} can't host a store because ${cause}.`);
      } else if (a.spaceType === "Rented") {
        lines.push(`This needs a new space; the current lease in ${home} would need to move.`);
      }
      competitorLines();
      if (teamConds.length) lines.push(`Internal: ${teamConds.map(conditionLine).join("; ")}.`);
      tail();
      const nextUp = ctx.nextInLine(offer.territoryKey, a.app.city.value);
      counterfactual = `Accepting by ${formatDate(expires)} reserves pin ${offer.pin}. ${id}'s own pin isn't possible because ${shortWhy}.${nextUp ? ` If it declines, the slot goes to ${nextUp}.` : ""}`;
      partner.push(`Accept or decline the offer of pin ${offer.pin} by ${formatDate(expires)}`, ...partnerConds.map(conditionLine));
      team.push(`Send the location offer for pin ${offer.pin}; it lapses on ${formatDate(expires)}`, ...teamConds.map(conditionLine));
      break;
    }

    case "WAITLIST": {
      const rank = o.waitlist?.rank ?? 1;
      const at = `#${rank} in ${city}`;
      const home = a.app.pin.value;
      const wantedKey = o.homeTerritoryKey;
      const wanted = wantedKey ? ctx.territoryId(wantedKey) : null;
      const plannedCity = a.app.city.value ? ctx.cityHasTerritory(a.app.city.value) : false;
      const lostPin = o.lostTo ? `lost pin ${home} to ${ctx.idOf(o.lostTo.key)} (${FACTOR_SHORT[o.lostTo.factor] ?? "ranked higher"})` : null;
      const passed = o.passedOverBy
        ? `the last free location went to ${ctx.idOf(o.passedOverBy.key)} (${FACTOR_SHORT[o.passedOverBy.factor] ?? "ranked higher"})`
        : `no ${city} territory had a free slot to offer`;

      if (o.committedTo) {
        headline = `Waitlisted ${at}: slot already committed to ${ctx.idOf(o.committedTo.key)} on ${formatDate(o.committedTo.date)}.`;
        lines.push(`${id} would rank higher, but ${ctx.idOf(o.committedTo.key)} was already sent a decision, and a yes already given isn't taken back.`);
        counterfactual = `It would get a slot if ${ctx.idOf(o.committedTo.key)} withdraws or another slot opens.`;
      } else if (o.duplicateOf) {
        headline = `Waitlisted: ${ctx.nameOf(a.key)} already holds a slot through ${ctx.idOf(o.duplicateOf)}; one slot per person.`;
        lines.push(`${id} and ${ctx.idOf(o.duplicateOf)} look like the same person, who can hold at most one slot.`);
        counterfactual = `If they turn out to be different people, ${id} would be considered on its own merits.`;
      } else if (o.codes.includes("OUTSIDE_PLAN")) {
        headline = `Waitlisted ${at}: no territory covers ${city} in the current plan, so it stays in the talent pool.`;
        lines.push(`${id} has ${profileText(a)}. ${city} isn't covered by any territory with slots right now.`);
        counterfactual = `It would be considered if a territory covering ${city}, pin ${home}, is added.`;
      } else if (o.codes.includes("NO_SLOT") && wantedKey) {
        const slots = ctx.slotsOf(wantedKey);
        const holders = ctx.slotHolders(wantedKey);
        headline =
          slots === 0
            ? `Waitlisted ${at}, wanted ${wanted}: it has no open slots right now.`
            : holders.length && holders.length <= 2
              ? `Waitlisted ${at}, wanted ${wanted}: ${slots === 1 ? "its only slot" : `its ${slots} slots`} went to higher-ranked ${listIds(holders)}.`
              : `Waitlisted ${at}, wanted ${wanted}: its ${plural(slots, "slot")} went to higher-ranked applicants.`;
        lines.push(`${id} wins pin ${home} but not a slot. It has ${profileText(a)}.`);
        competitorLines();
      } else {
        const why =
          lostPin ??
          (o.codes.includes("PIN_HAS_EXISTING_STORE") ? `pin ${home} already has store ${home ? ctx.storeAt(home) : ""}` : `pin ${home} isn't in any territory`);
        headline = `Waitlisted ${at}: ${why}, and ${passed}.`;
        lines.push(`${id} has ${profileText(a)}.`);
        competitorLines();
        if (!o.passedOverBy) lines.push(`No ${city} territory had a free slot left to offer.`);
      }
      tail();

      if (!counterfactual) {
        const line = wantedKey ? ctx.lineFor(a.key, wantedKey) : null;
        const bar = o.competitors.find((c) => !c.won);
        const imp = bar ? improvement(bar.factor, a, ctx.profile) : null;
        counterfactual =
          (line
            ? `A slot freed in ${wanted} goes first to waitlisted applicants whose pin is in ${wanted}; ${id} is ${line === 1 ? "first" : `#${line}`} in line for it.`
            : `A freed slot goes first to waitlisted applicants whose pin is in that territory, then to the highest-ranked in ${city}; ${id} is ${at}.`) +
          (imp ? ` Also, ${imp}.` : "");
      }

      const preOnboard = plannedCity && rank <= ctx.profile.preOnboarding.topN && !o.duplicateOf && !o.codes.includes("OUTSIDE_PLAN");
      if (preOnboard) partner.push(ctx.profile.preOnboarding.step);
      partner.push(
        o.codes.includes("OUTSIDE_PLAN")
          ? `No action needed; we'll contact you if a territory opens in ${city}`
          : `${preOnboard ? "Otherwise no action needed" : "No action needed"}; you're ${at} and we'll call you if a slot frees`,
      );
      team.push(
        o.codes.includes("OUTSIDE_PLAN")
          ? `Keep ${id} in the ${city} talent pool and contact them when a territory opens`
          : `Tell the partner they're #${rank} on the ${city} waitlist${wanted ? `, wanting ${wanted}` : ""}`,
      );
      if (preOnboard) team.push("Start their pre-onboarding so they can open quickly if a slot frees");
      break;
    }
  }

  return {
    headline,
    explanation: lines.filter(Boolean).join(" "),
    counterfactual,
    partnerSteps: partner.filter(Boolean),
    teamSteps: team.filter(Boolean),
    questions,
  };
}
