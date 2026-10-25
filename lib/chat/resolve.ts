// Turning what people type into the file's own IDs (SPEC §15.6): "APP-7", "app 07", "APP007", "application 7" and
// "#7" all find APP-007; names are matched loosely, and several matches are asked about, never guessed.

export interface Ref {
  key: string;
  id: string;
  name: string;
}

export type Resolution =
  | { kind: "ok"; ref: Ref }
  | { kind: "withdrawn"; ref: Ref }
  | { kind: "ambiguous"; options: Ref[] }
  | { kind: "unknown"; message: string };

const numOf = (id: string): number | null => {
  const m = /(\d+)/.exec(id);
  return m ? Number(m[1]) : null;
};

/** Application numbers mentioned in a message, in order: "APP-7", "app 07", "APP007", "application 7", "#7". */
export function appNumbers(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\b(?:app(?:lication)?s?[\s-]*#?\s*|#\s*)0*(\d{1,5})\b/gi)) out.push(Number(m[1]));
  return out;
}

export function territoryNumbers(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\b(?:ter(?:ritory)?[\s-]*#?\s*)0*(\d{1,4})\b/gi)) out.push(Number(m[1]));
  return out;
}

export function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

const words = (s: string) => s.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);

export interface Directory {
  apps: Ref[];
  withdrawn: Set<string>;
  territories: { key: string; id: string }[];
}

const pad = (n: number, w: number) => String(n).padStart(w, "0");

function nearest(n: number, others: { id: string }[]): string | null {
  let best: { id: string; d: number } | null = null;
  const w = Math.max(3, String(n).length);
  for (const o of others) {
    const m = numOf(o.id);
    if (m === null) continue;
    const d = levenshtein(pad(n, w), pad(m, w));
    if (!best || d < best.d || (d === best.d && Math.abs(m - n) < Math.abs((numOf(best.id) ?? 0) - n))) best = { id: o.id, d };
  }
  return best && best.d <= 1 ? best.id : null;
}

function byNumber(dir: Directory, n: number, label: string): Resolution {
  const found = dir.apps.filter((a) => numOf(a.id) === n);
  if (found.length === 1) return dir.withdrawn.has(found[0].key) ? { kind: "withdrawn", ref: found[0] } : { kind: "ok", ref: found[0] };
  if (found.length > 1) return { kind: "ambiguous", options: found };
  const guess = nearest(n, dir.apps);
  return { kind: "unknown", message: `I can't find ${label}.${guess ? ` Did you mean ${guess}?` : ""}` };
}

/** An application from what the user wrote: an ID in any common form, or a (partial) name. */
export function resolveApp(text: string, dir: Directory): Resolution {
  const nums = appNumbers(text);
  if (nums.length) return byNumber(dir, nums[0], `APP-${pad(nums[0], 3)}`);
  const bare = /^\s*#?\s*0*(\d{1,5})\s*$/.exec(text);
  if (bare) return byNumber(dir, Number(bare[1]), `APP-${pad(Number(bare[1]), 3)}`);

  const q = words(text).filter((w) => w.length >= 3 && !STOP.has(w));
  if (!q.length) return { kind: "unknown", message: "Which application do you mean? Give me an ID like APP-007 or a name." };
  const full = dir.apps.filter((a) => words(a.name).join(" ") === q.join(" "));
  const pool = full.length ? full : dir.apps.filter((a) => q.every((w) => words(a.name).some((t) => t.startsWith(w) || (w.length >= 4 && levenshtein(t, w) <= 1))));
  if (pool.length === 1) return dir.withdrawn.has(pool[0].key) ? { kind: "withdrawn", ref: pool[0] } : { kind: "ok", ref: pool[0] };
  if (pool.length > 1) return { kind: "ambiguous", options: pool };
  return { kind: "unknown", message: `I can't find an application for "${text.trim().slice(0, 40)}". Try an ID like APP-007.` };
}

const STOP = new Set(["the", "and", "for", "why", "what", "about", "app", "application", "applicant", "partner", "his", "her", "their", "with", "from", "that"]);

export function resolveTerritory(text: string, dir: Directory): { kind: "ok"; id: string; key: string } | { kind: "unknown"; message: string } {
  const nums = territoryNumbers(text);
  const bare = /^\s*#?\s*0*(\d{1,4})\s*$/.exec(text);
  const n = nums[0] ?? (bare ? Number(bare[1]) : null);
  if (n === null) {
    const hit = dir.territories.find((t) => t.id.toLowerCase() === text.trim().toLowerCase());
    return hit ? { kind: "ok", id: hit.id, key: hit.key } : { kind: "unknown", message: "Which territory? Give me an ID like TER-02." };
  }
  const hit = dir.territories.find((t) => numOf(t.id) === n);
  if (hit) return { kind: "ok", id: hit.id, key: hit.key };
  const guess = nearest(n, dir.territories);
  return { kind: "unknown", message: `I can't find TER-${pad(n, 2)}.${guess ? ` Did you mean ${guess}?` : ""}` };
}

/** Replace applicants' names with their IDs, so names never go to the AI service. */
export function redactNames(text: string, apps: Ref[]): string {
  let out = text;
  for (const a of apps) {
    const parts = a.name.trim().split(/\s+/).filter((p) => p.length >= 3);
    if (a.name.trim().length >= 3) out = out.split(a.name.trim()).join(a.id);
    for (const p of parts) out = out.replace(new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), a.id);
  }
  return out;
}
