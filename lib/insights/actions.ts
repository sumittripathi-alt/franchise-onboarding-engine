// The expansion team's action queue (SPEC §15.2): a rules-generated list, ordered by urgency, with an owner,
// a due date and a draft message for each item.

import type { EngineResult } from "@/lib/engine/types";
import { addDays, daysBetween, formatDate } from "@/lib/planner/dates";
import type { DecisionRecord } from "@/lib/types";
import { draftPartnerMessage } from "./messages";

export type ActionKind = "call" | "chase" | "offer" | "condition" | "signoff" | "cohort" | "recruit";

export interface ActionItem {
  id: string;
  kind: ActionKind;
  title: string;
  detail: string;
  owner: string;
  /** ISO date. */
  due: string;
  appKeys: string[];
  /** The partner's preferred language, for calls and messages. */
  language: string | null;
  /** A draft message the team can copy, or null where there is nobody to message. */
  draft: string | null;
}

const KIND_ORDER: Record<ActionKind, number> = { call: 0, chase: 1, offer: 2, condition: 3, signoff: 4, cohort: 5, recruit: 6 };
const idOrder = new Intl.Collator("en", { numeric: true });

export const CONDITION_WINDOW_DAYS = 7;

export const KIND_LABEL: Record<ActionKind, string> = {
  call: "Call",
  chase: "Chase",
  offer: "Offer",
  condition: "Condition due",
  signoff: "Sign-off",
  cohort: "Training",
  recruit: "Recruit",
};

export function buildActionQueue(result: EngineResult, languages: Record<string, string | null>, today: string): ActionItem[] {
  const items: ActionItem[] = [];
  const byId = new Map(result.decisions.map((d) => [d.appId, d]));
  const lang = (d: DecisionRecord) => languages[d.appKey] ?? "English";
  const push = (i: ActionItem) => items.push(i);

  for (const d of result.decisions) {
    // 1. Calls to make: on-hold partners, with the exact questions, in the partner's language.
    if (d.status === "HOLD") {
      const wins = d.ifClarified?.winsPin;
      push({
        id: `call-${d.appKey}`,
        kind: "call",
        title: `Call ${d.appId} (${d.name}) in ${lang(d)}`,
        detail: `${d.questions.join(" ")}${wins ? ` If confirmed, they would win pin ${d.ifClarified!.pin}, so the partner now holding it is only provisional.` : ""}`,
        owner: "Expansion team",
        due: wins ? addDays(today, 3) : addDays(today, 5),
        appKeys: [d.appKey],
        language: lang(d),
        draft: draftPartnerMessage(d),
      });
    }

    // Provisional wins: chase the on-hold applicant who might outrank the current winner (SPEC §15.4).
    if (d.provisional) {
      const challenger = byId.get(d.provisional.byAppId);
      push({
        id: `chase-${d.appKey}`,
        kind: "chase",
        title: `Chase ${d.provisional.byAppId}: ${d.appId}'s slot is provisional`,
        detail: `${d.appId} holds pin ${d.pin} only until ${formatDate(d.provisional.until)}. ${d.provisional.byAppId} is on hold and would rank higher if their details are confirmed.`,
        owner: "Expansion team",
        due: d.provisional.until,
        appKeys: [d.appKey, ...(challenger ? [challenger.appKey] : [])],
        language: challenger ? lang(challenger) : null,
        draft: challenger ? draftPartnerMessage(challenger) : null,
      });
    }

    // 3. Location offers awaiting an answer (7-day expiry).
    if (d.status === "REDIRECT" && d.offer) {
      push({
        id: `offer-${d.appKey}`,
        kind: "offer",
        title: `Chase an answer: ${d.appId} was offered pin ${d.offer.pin} in ${d.offer.territoryId}`,
        detail: `The offer is held until ${formatDate(d.offer.expires)}. If declined, the slot goes to the next in line.`,
        owner: "Expansion team",
        due: d.offer.expires,
        appKeys: [d.appKey],
        language: lang(d),
        draft: draftPartnerMessage(d),
      });
    }

    // 2 and 4. Conditions due within 7 days; sign-offs and existing partners to inform (always).
    for (const c of d.conditions) {
      if (c.source === "EXPANSION_SIGNOFF") {
        push({
          id: `signoff-${c.id}`,
          kind: "signoff",
          title: `Expansion-head sign-off for ${d.appId}`,
          detail: `${c.text}. ${d.cannibalisation?.note ?? ""}`.trim(),
          owner: "Expansion head",
          due: c.deadline,
          appKeys: [d.appKey],
          language: null,
          draft: null,
        });
      } else if (daysBetween(today, c.deadline) <= CONDITION_WINDOW_DAYS && d.status !== "REDIRECT") {
        push({
          id: `cond-${c.id}`,
          kind: "condition",
          title: `${d.appId}: ${c.text.replace(/\s+within \d+ days$/, "")}`,
          detail: `Due ${formatDate(c.deadline)}. ${c.ifMissed}`,
          owner: c.owner === "team" ? "Expansion team" : `${d.name} (partner)`,
          due: c.deadline,
          appKeys: [d.appKey],
          language: lang(d),
          draft: c.owner === "team" ? null : draftPartnerMessage(d),
        });
      }
    }
  }

  // 5. Recruit here: High-priority territories with free slots and no applicants (white-space pins).
  for (const t of result.territories) {
    if (t.blocked || t.priority !== "High") continue;
    const free = t.slots - t.reserved.length;
    if (free > 0 && t.whiteSpacePins.length > 0) {
      push({
        id: `recruit-${t.id}`,
        kind: "recruit",
        title: `Recruit in ${t.id}: ${free} free slot${free === 1 ? "" : "s"}, no applicants`,
        detail: `Pins with no applicant: ${t.whiteSpacePins.join(", ")}.`,
        owner: "Expansion team",
        due: addDays(today, 14),
        appKeys: [],
        language: null,
        draft: null,
      });
    }
  }

  // 6. Training cohorts to schedule.
  for (const c of result.cohorts) {
    const due = addDays(c.start, -14) > today ? addDays(c.start, -14) : today;
    push({
      id: `cohort-${c.id}`,
      kind: "cohort",
      title: `Schedule the ${c.language} cohort in ${c.city}`,
      detail: c.label + ".",
      owner: "Training team",
      due,
      appKeys: c.members.map((m) => m.appKey),
      language: c.language,
      draft: null,
    });
  }

  items.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || idOrder.compare(a.id, b.id));
  return items;
}
