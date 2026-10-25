// The device's copy of a workspace: localStorage stays a local cache (SPEC §16.3). It lets a workspace open
// instantly, survive a refresh, and keep unsent changes until they can be sent.

import { z } from "zod";
import { FeedbackSchema } from "@/lib/state/sessionSchema";
import { safeGetItem, safeRemoveItem, safeSetItem } from "@/lib/state/storage";
import { BaseDataSchema, EVENT_TYPES, type BaseData } from "./schemas";
import type { LogEvent } from "./replay";

export const WS_KEY_PREFIX = "fpe.ws.";
export const LAST_WORKSPACE_KEY = "fpe.lastWorkspace";
export const CACHE_VERSION = 1;

const LogEventSchema = z.object({
  seq: z.number().int().nullable(),
  createdAt: z.string(),
  type: z.enum(EVENT_TYPES),
  // Re-checked when replayed: the engine ignores facts about keys it doesn't have, and changes were validated when made.
  payload: z.record(z.string(), z.unknown()),
  clientId: z.string().nullable(),
  clientEventId: z.string().nullable(),
  undoOf: z.string().optional(),
});

export const CacheSchema = z.object({
  version: z.literal(CACHE_VERSION),
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
  base: BaseDataSchema,
  confirmed: z.array(LogEventSchema),
  pending: z.array(LogEventSchema),
  polledSeq: z.number().int().min(0),
  createdOnServer: z.boolean(),
  feedback: z.array(FeedbackSchema),
  reviewed: z.boolean(),
});

export interface CacheData {
  version: typeof CACHE_VERSION;
  id: string;
  name: string;
  parentId: string | null;
  base: BaseData;
  confirmed: LogEvent[];
  pending: LogEvent[];
  polledSeq: number;
  createdOnServer: boolean;
  feedback: z.infer<typeof FeedbackSchema>[];
  reviewed: boolean;
}

export interface CacheStore {
  load(id: string): CacheData | null;
  /** False when the device couldn't keep it (storage unavailable or full). */
  save(id: string, data: CacheData): boolean;
  remove(id: string): void;
}

export const localCache: CacheStore = {
  load(id) {
    const text = safeGetItem(WS_KEY_PREFIX + id);
    if (!text) return null;
    try {
      const parsed = CacheSchema.safeParse(JSON.parse(text));
      if (parsed.success) return parsed.data as unknown as CacheData;
    } catch {
      /* damaged: dropped below */
    }
    safeRemoveItem(WS_KEY_PREFIX + id);
    return null;
  },
  save: (id, data) => safeSetItem(WS_KEY_PREFIX + id, JSON.stringify(data)),
  remove: (id) => safeRemoveItem(WS_KEY_PREFIX + id),
};

export function memoryCache(): CacheStore & { data: Map<string, CacheData> } {
  const data = new Map<string, CacheData>();
  return {
    data,
    load: (id) => (data.has(id) ? structuredClone(data.get(id)!) : null),
    save: (id, d) => (data.set(id, structuredClone(d)), true),
    remove: (id) => void data.delete(id),
  };
}
