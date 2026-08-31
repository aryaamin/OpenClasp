export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, { startedAt: number; count: number }>();

  consume(key: string, limit: number, windowMs: number, now = Date.now()) {
    const current = this.buckets.get(key);
    if (!current || now - current.startedAt >= windowMs) {
      this.buckets.set(key, { startedAt: now, count: 1 });
      return { allowed: true, remaining: Math.max(0, limit - 1), retryAfterSeconds: 0 };
    }
    current.count += 1;
    const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (now - current.startedAt)) / 1000));
    return {
      allowed: current.count <= limit,
      remaining: Math.max(0, limit - current.count),
      retryAfterSeconds,
    };
  }
}
