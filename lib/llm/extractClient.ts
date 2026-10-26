// Reading applicants' free text with the AI, once per upload (SPEC §8.1, G4.8): up to 4 batches of 20 at a time,
// 25 seconds overall. Whatever finished is used; whatever didn't is read by the keyword reader. Never throws.

import type { Application, Signals } from "@/lib/types";
import { extractBatch as realExtract, type ExtractBatch, type ExtractItem } from "./clientApi";
import { textHash, type SignalCache } from "./signalCache";

// Spec says 20; ten per call keeps one call to about ten seconds, so four in parallel fit the 25-second cap for a typical file.
export const BATCH_SIZE = 10;
export const PARALLEL = 4;
export const CAP_MS = 25_000;

export interface ReadingResult {
  /** Signals the AI read and the evidence rule vetted, by application key. */
  signals: Record<string, Signals>;
  /** Every application with text was read. */
  complete: boolean;
  /** No batch got an answer: the AI is off, busy or unreachable. */
  unavailable: boolean;
  read: number;
  total: number;
  /** How many of those came from this device's cache (the same text was read before). */
  cached: number;
  model: string | null;
}

export interface ReadingOptions {
  capMs?: number;
  parallel?: number;
  batchSize?: number;
  extract?: (items: ExtractItem[], signal?: AbortSignal) => Promise<ExtractBatch>;
  /** Readings by text hash. The same text is read once, then reused. */
  cache?: SignalCache;
}

export function hasText(a: Pick<Application, "business" | "notes">): boolean {
  return Boolean(a.business?.trim() || a.notes?.trim());
}

export async function readNotes(apps: Pick<Application, "key" | "business" | "notes">[], opts: ReadingOptions = {}): Promise<ReadingResult> {
  const { capMs = CAP_MS, parallel = PARALLEL, batchSize = BATCH_SIZE, extract = realExtract, cache } = opts;
  const withText = apps.filter(hasText);
  const signals: Record<string, Signals> = {};
  let cached = 0;

  // Group applications by their exact text: each distinct text is read once, and the reading is shared.
  const keysByHash = new Map<string, string[]>();
  const sample = new Map<string, { business: string; notes: string }>();
  for (const a of withText) {
    const h = textHash(a.business, a.notes);
    keysByHash.set(h, [...(keysByHash.get(h) ?? []), a.key]);
    sample.set(h, { business: a.business.slice(0, 1000), notes: a.notes.slice(0, 2000) });
  }
  const todo: { hash: string; item: ExtractItem }[] = [];
  for (const [hash, keys] of keysByHash) {
    const hit = cache?.get(hash);
    if (hit) {
      for (const k of keys) signals[k] = hit;
      cached += keys.length;
    } else {
      // Only a key, the business text and the notes leave the browser.
      todo.push({ hash, item: { id: keys[0], ...sample.get(hash)! } });
    }
  }
  const hashOfKey = new Map(todo.map((t) => [t.item.id, t.hash]));

  const batches: ExtractItem[][] = [];
  for (let i = 0; i < todo.length; i += batchSize) batches.push(todo.slice(i, i + batchSize).map((t) => t.item));

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), capMs);
  let answered = 0;
  let model: string | null = null;
  let next = 0;
  const worker = async () => {
    while (next < batches.length && !ctl.signal.aborted) {
      const batch = batches[next++];
      let r = await extract(batch, ctl.signal);
      // One more try for a batch that failed, if there is time: a single hiccup shouldn't cost a whole reading.
      if (!r.ok && !ctl.signal.aborted) r = await extract(batch, ctl.signal);
      if (r.ok) {
        answered++;
        model = r.model ?? model;
        for (const [id, sig] of Object.entries(r.results)) {
          const hash = hashOfKey.get(id);
          if (!hash) continue;
          cache?.set(hash, sig);
          for (const k of keysByHash.get(hash) ?? [id]) signals[k] = sig;
        }
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(parallel, batches.length) }, worker));
  } catch {
    /* a failed worker leaves its batch to the keyword reader */
  } finally {
    clearTimeout(timer);
  }
  const read = Object.keys(signals).length;
  return { signals, complete: withText.length > 0 && read >= withText.length, unavailable: batches.length > 0 && answered === 0 && cached === 0, read, total: withText.length, cached, model };
}

/** Split signals into groups that each fit a workspace event (10 KB). */
export function chunkSignals(signals: Record<string, Signals>, maxBytes = 8000): Record<string, Signals>[] {
  const out: Record<string, Signals>[] = [];
  let cur: Record<string, Signals> = {};
  let size = 0;
  for (const [k, v] of Object.entries(signals)) {
    const n = JSON.stringify(v).length + k.length + 8;
    if (size + n > maxBytes && Object.keys(cur).length) {
      out.push(cur);
      cur = {};
      size = 0;
    }
    cur[k] = v;
    size += n;
  }
  if (Object.keys(cur).length) out.push(cur);
  return out;
}
