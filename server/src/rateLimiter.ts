export type RateLimitConfig = {
  maxAttempts: number;
  windowMs: number;
};

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

type RateLimitBucket = {
  attempts: number;
  expiresAt: number;
};

export class InMemoryRateLimiter {
  private readonly buckets = new Map<string, RateLimitBucket>();
  private readonly config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  consume(key: string, now = Date.now()): RateLimitResult {
    for (const [bucketKey, bucket] of this.buckets) {
      if (bucket.expiresAt <= now) this.buckets.delete(bucketKey);
    }

    const current = this.buckets.get(key);
    if (!current) {
      this.buckets.set(key, {
        attempts: 1,
        expiresAt: now + this.config.windowMs,
      });
      return { allowed: true };
    }

    if (current.attempts >= this.config.maxAttempts) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((current.expiresAt - now) / 1000),
        ),
      };
    }

    current.attempts += 1;
    return { allowed: true };
  }
}
