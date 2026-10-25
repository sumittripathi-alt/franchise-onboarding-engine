// The evidence rule (SPEC §15.3). A signal from the AI that can create a hold or a condition counts only if it
// carries an exact quote from the applicant's own text and the model was at least 0.8 confident. Anything else is
// downgraded to an information note ("AI noticed a possible X. Please verify.") and the decision is unchanged.
// The keyword reader is the safety net: where it found something with its own matched text, that stands.

import { z } from "zod";
import { extractSignalsHeuristic } from "@/lib/ingest/heuristics";
import type { EvidenceKey, Signals } from "@/lib/types";

export const MIN_CONFIDENCE = 0.8;

/** What we ask the model for: the signals plus a quote for each one it claims. */
export const AiSignalSchema = z.object({
  relevant_sector: z.string().max(60).nullable(),
  years_running_shop_mentioned: z.number().min(0).max(80).nullable(),
  notes_floor_claim: z.enum(["Ground", "Upper", "Mall unit"]).nullable(),
  notes_space_claim: z.enum(["has_space", "searching"]).nullable(),
  festival_deadline: z.string().max(40).nullable(),
  absentee_owner: z.boolean(),
  competitor_conflict: z.boolean(),
  funding_dependency: z.boolean(),
  injection_attempt: z.boolean(),
  confidence: z.number().min(0).max(1),
  evidence: z.object({
    relevant_sector: z.string().nullable(),
    years_running_shop_mentioned: z.string().nullable(),
    notes_floor_claim: z.string().nullable(),
    notes_space_claim: z.string().nullable(),
    festival_deadline: z.string().nullable(),
    absentee_owner: z.string().nullable(),
    competitor_conflict: z.string().nullable(),
    funding_dependency: z.string().nullable(),
    injection_attempt: z.string().nullable(),
  }),
});
export type AiSignal = z.infer<typeof AiSignalSchema>;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** The exact text from `texts` that `quote` points at (ignoring case and extra spaces), or null if it isn't there. */
export function findQuote(quote: string | null | undefined, ...texts: string[]): string | null {
  if (!quote) return null;
  const q = norm(quote);
  if (q.length < 3) return null;
  for (const t of texts) {
    if (norm(t).includes(q)) {
      // Return the applicant's own spelling, not the model's.
      const squashed = t.replace(/\s+/g, " ");
      const at = squashed.toLowerCase().indexOf(q);
      return at >= 0 ? squashed.slice(at, at + q.length) : quote;
    }
  }
  return null;
}

const KEYS: EvidenceKey[] = [
  "relevant_sector",
  "years_running_shop_mentioned",
  "notes_floor_claim",
  "notes_space_claim",
  "festival_deadline",
  "absentee_owner",
  "competitor_conflict",
  "funding_dependency",
  "injection_attempt",
];

const present = (v: unknown) => v !== null && v !== false && v !== undefined;

/**
 * Combine the model's reading with the keyword reader's, under the evidence rule.
 * Where the model's claim is verified it is used (with the applicant's own words as the quote); where it isn't, the
 * keyword reader's answer stands and, if the model claimed something the keywords didn't see, an information note is added.
 */
export function vetSignals(raw: AiSignal, texts: { business: string; notes: string }, meta: { model: string; at: string }): Signals {
  const heuristic = extractSignalsHeuristic(texts);
  const out: Signals = { ...heuristic, evidence: { ...heuristic.evidence }, other_flags: [...heuristic.other_flags], ai: meta };
  const trusted = raw.confidence >= MIN_CONFIDENCE;
  const confidentFlags: string[] = [];

  for (const key of KEYS) {
    const claim = raw[key];
    if (!present(claim)) continue;
    // A floor or space claim can only come from the notes; the business column describes past work.
    const quote = findQuote(raw.evidence[key], ...(key === "notes_floor_claim" || key === "notes_space_claim" ? [texts.notes] : [texts.business, texts.notes]));
    if (trusted && quote) {
      (out as unknown as Record<string, unknown>)[key] = claim;
      out.evidence[key] = quote;
      out.confidence = Math.max(out.confidence, raw.confidence);
    } else if (!present(heuristic[key])) {
      confidentFlags.push(`ai_possible:${key}`);
    }
  }
  out.other_flags.push(...confidentFlags);
  return out;
}

/**
 * What the model returns: the same signals, with evidence as a short list of {signal, quote} (only for the signals it
 * claims) instead of nine mostly-empty fields. Shorter output is faster, and speed matters (SPEC §15.10).
 */
export const EVIDENCE_KEYS = [
  "relevant_sector",
  "years_running_shop_mentioned",
  "notes_floor_claim",
  "notes_space_claim",
  "festival_deadline",
  "absentee_owner",
  "competitor_conflict",
  "funding_dependency",
  "injection_attempt",
] as const;

export const AiWireSchema = AiSignalSchema.omit({ evidence: true }).extend({
  evidence: z.array(z.object({ signal: z.enum(EVIDENCE_KEYS), quote: z.string().max(400) })).max(12),
});
export type AiWire = z.infer<typeof AiWireSchema>;

export function fromWire(w: AiWire): AiSignal {
  const evidence: AiSignal["evidence"] = { relevant_sector: null, years_running_shop_mentioned: null, notes_floor_claim: null, notes_space_claim: null, festival_deadline: null, absentee_owner: null, competitor_conflict: null, funding_dependency: null, injection_attempt: null };
  for (const e of w.evidence) if (evidence[e.signal] === null) evidence[e.signal] = e.quote;
  const { evidence: _drop, ...rest } = w;
  void _drop;
  return { ...rest, evidence };
}

export function toWire(a: AiSignal): AiWire {
  const { evidence, ...rest } = a;
  return { ...rest, evidence: EVIDENCE_KEYS.flatMap((k) => (evidence[k] ? [{ signal: k, quote: evidence[k] as string }] : [])) };
}
