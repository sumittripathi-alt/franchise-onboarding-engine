// A cache of what the AI read, by a hash of the text it read (SPEC §8.1, G4.8). The same words are never sent twice:
// two applicants with identical text share one reading, and uploading the same file again (or the same notes in
// another file) reuses what this device already has. It lives in this browser only.

import { SignalsSchema } from "@/lib/ingest/schemas";
import { safeGetItem, safeSetItem } from "@/lib/state/storage";
import type { Signals } from "@/lib/types";

export interface SignalCache {
  get(hash: string): Signals | null;
  set(hash: string, signals: Signals): void;
}

/** FNV-1a over the business text and the notes, twice with different seeds: short, stable, and not a secret. */
export function textHash(business: string, notes: string): string {
  const s = `${business.trim()}\u0000${notes.trim()}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

const PREFIX = "fpe.sig.";
const INDEX = "fpe.sig.index";
const MAX_ENTRIES = 400;

export const localSignalCache: SignalCache = {
  get(hash) {
    const text = safeGetItem(PREFIX + hash);
    if (!text) return null;
    try {
      const parsed = SignalsSchema.safeParse(JSON.parse(text));
      return parsed.success ? (parsed.data as Signals) : null;
    } catch {
      return null;
    }
  },
  set(hash, signals) {
    if (!safeSetItem(PREFIX + hash, JSON.stringify(signals))) return;
    try {
      const index: string[] = JSON.parse(safeGetItem(INDEX) ?? "[]");
      const next = [...index.filter((h) => h !== hash), hash];
      // Keep the newest entries only, so this never fills the device's storage.
      for (const old of next.splice(0, Math.max(0, next.length - MAX_ENTRIES))) safeSetItem(PREFIX + old, "");
      safeSetItem(INDEX, JSON.stringify(next));
    } catch {
      /* the entry is saved; the index just isn't updated */
    }
  },
};

export function memorySignalCache(): SignalCache & { size: () => number } {
  const m = new Map<string, Signals>();
  return { get: (h) => (m.has(h) ? structuredClone(m.get(h)!) : null), set: (h, s) => void m.set(h, structuredClone(s)), size: () => m.size };
}
