// In-memory IP-based rate limiter.
// Per-CF-node isolation is sufficient for C-wallet abuse protection.

const buckets = new Map<string, { count: number; windowStart: number }>();

export const DEFAULT_LIMIT = 100;
export const DEFAULT_WINDOW_MS = 1000;

export function checkRateLimit(
  ip: string,
  limit = DEFAULT_LIMIT,
  windowMs = DEFAULT_WINDOW_MS,
): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const key = `${ip}:${Math.floor(now / windowMs)}`;
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart > windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: limit - 1 };
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    return { allowed: false, remaining: 0 };
  }

  return { allowed: true, remaining: limit - bucket.count };
}

// Cleanup old entries to avoid unbounded growth.
export function cleanupBuckets(): void {
  const now = Date.now();
  for (const [key, bucket] of buckets.entries()) {
    if (now - bucket.windowStart > DEFAULT_WINDOW_MS * 2) {
      buckets.delete(key);
    }
  }
}
