// Reading applicants' free text with the AI, once per upload (SPEC §8.1, G4.8): up to 4 batches of 20 at a time,
// 25 seconds overall. Whatever finished is used; whatever didn't is read by the keyword reader. Never throws.

import type { Application, Signals } from "@/lib/types";
import { extractBatch as realExtract, type ExtractBatch, type ExtractItem } from "./clientApi";

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
  model: string | null;
}

export interface ReadingOptions {
  capMs?: number;
  parallel?: number;
  batchSize?: number;
  extract?: (items: ExtractItem[], signal?: AbortSignal) => Promise<ExtractBatch>;
}

export function hasText(a: Pick<Application, "business" | "notes">): boolean {
  return Boolean(a.business?.trim() || a.notes?.trim());
}

export async function readNotes(apps: Pick<Application, "key" | "business" | "notes">[], opts: ReadingOptions = {}): Promise<ReadingResult> {
  const { capMs = CAP_MS, parallel = PARALLEL, batchSize = BATCH_SIZE, extract = realExtract } = opts;
  // Only the application's key, its business text and its notes leave the browser.
  const items: ExtractItem[] = apps.filter(hasText).map((a) => ({ id: a.key, business: a.business.slice(0, 1000), notes: a.notes.slice(0, 2000) }));
  const batches: ExtractItem[][] = [];
  for (let i = 0; i < items.length; i += batchSize) batches.push(items.slice(i, i + batchSize));

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), capMs);
  const signals: Record<string, Signals> = {};
  let answered = 0;
  let model: string | null = null;
  let next = 0;
  const worker = async () => {
    while (next < batches.length && !ctl.signal.aborted) {
      const batch = batches[next++];
      const r = await extract(batch, ctl.signal);
      if (r.ok) {
        answered++;
        model = r.model ?? model;
        Object.assign(signals, r.results);
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
  return { signals, complete: items.length > 0 && read >= items.length, unavailable: batches.length > 0 && answered === 0, read, total: items.length, model };
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
