// Guards around everything the AI says or is told (G4.3, G4.5, G4.7).

/** Input limits (G4.7). */
export const MAX_CHAT_CHARS = 2000;
export const MAX_HISTORY = 12;

export function clip(text: string, max = MAX_CHAT_CHARS): string {
  return text.length > max ? text.slice(0, max) : text;
}

/** Chat messages or notes that try to instruct the system rather than ask about the data. */
const INJECTION =
  /\bignore\s+(all\s+|any\s+|the\s+|your\s+)?(previous|prior|above|earlier)?\s*(instructions?|rules?|prompts?|polic(y|ies)|guidelines?)\b|\bdisregard\b[^.]{0,30}\b(rules?|instructions?|polic(y|ies))\b|\b(approve|accept|pass)\s+(every(one|body)|all(\s+of)?(\s+the)?(\s+applications?|\s+applicants?)?)\b|\bsystem\s+prompt\b|\breveal\b[^.]{0,30}\b(prompt|instructions?|key|secret)\b|\byou\s+are\s+now\b|\bpretend\s+(to\s+be|you)\b|\bjailbreak\b|\bdeveloper\s+mode\b|\bact\s+as\b[^.]{0,20}\b(admin|root|developer)\b|\bapi[\s_-]?key\b/iu;

export function looksLikeInjection(text: string): boolean {
  return INJECTION.test(text);
}

const ID_RE = /\b(APP|TER)[\s-]?0*(\d+)\b/gi;
const PIN_RE = /\b\d{6}\b/g;
const NUM_RE = /\d+(?:[.,]\d+)*/g;

const idKey = (kind: string, n: string) => `${kind.toUpperCase()}-${Number(n)}`;

/** Every ID, pin and number in `text`, normalised, so two texts can be compared. */
export function claimsIn(text: string): { ids: Set<string>; pins: Set<string>; numbers: Set<string> } {
  const ids = new Set<string>();
  for (const m of text.matchAll(ID_RE)) ids.add(idKey(m[1], m[2]));
  // "1. Status" list markers are layout, not claims.
  const withoutIds = text.replace(/^\s*\d+[.)]\s+/gm, "").replace(ID_RE, " ");
  const pins = new Set(withoutIds.match(PIN_RE) ?? []);
  const withoutPins = withoutIds.replace(PIN_RE, " ");
  const numbers = new Set((withoutPins.match(NUM_RE) ?? []).map((n) => String(parseFloat(n.replace(/,/g, "")))));
  return { ids, pins, numbers };
}

/**
 * Hallucination check (G4.5): every APP ID, TER ID, pin and number in an answer must appear in what the tool
 * returned (or in the question). Returns what didn't, so the template answer can be used instead.
 */
export function ungroundedClaims(answer: string, allowed: string): string[] {
  const a = claimsIn(answer);
  const ok = claimsIn(allowed);
  const bad: string[] = [];
  for (const id of a.ids) if (!ok.ids.has(id)) bad.push(id);
  for (const p of a.pins) if (!ok.pins.has(p)) bad.push(p);
  for (const n of a.numbers) if (!ok.numbers.has(n) && !ok.pins.has(n)) bad.push(n);
  return bad;
}

export function isGrounded(answer: string, allowed: string): boolean {
  return ungroundedClaims(answer, allowed).length === 0;
}
