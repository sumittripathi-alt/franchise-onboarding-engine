// Per-IP rate limit (SPEC §16.4). In memory, so each server instance counts for itself: it stops a loop or
// a careless script, not a determined attacker. Fixed one-minute windows.

export type Bucket = "read" | "write" | "create" | "ai";

export const LIMITS: Record<Bucket, number> = { read: 300, write: 60, create: 20, ai: 60 };
const WINDOW_MS = 60_000;

const hits = new Map<string, { start: number; count: number }>();

export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}

/** Returns the seconds to wait when over the limit, or 0 when the request may go ahead. */
export function checkRate(ip: string, bucket: Bucket, now = Date.now(), limits = LIMITS): number {
  const key = `${bucket}:${ip}`;
  const cur = hits.get(key);
  if (!cur || now - cur.start >= WINDOW_MS) {
    hits.set(key, { start: now, count: 1 });
    if (hits.size > 5000) for (const [k, v] of hits) if (now - v.start >= WINDOW_MS) hits.delete(k);
    return 0;
  }
  cur.count++;
  return cur.count > limits[bucket] ? Math.max(1, Math.ceil((cur.start + WINDOW_MS - now) / 1000)) : 0;
}

export function resetRateLimits() {
  hits.clear();
}
