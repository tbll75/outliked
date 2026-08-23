const WINDOW_MS = 60_000;

type Bucket = { count: number; windowStart: number };

const buckets = new Map<string, Bucket>();

/** Per-instance in-memory limiter. Serverless instances each get their own
 *  window, so this is a tripwire against tight loops, not a hard guarantee. */
export function rateLimit(key: string, maxPerMinute: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    buckets.set(key, { count: 1, windowStart: now });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= maxPerMinute;
}

export function clientIp(req: Request): string {
  return (
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}
