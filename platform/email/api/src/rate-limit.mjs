/**
 * Token-bucket rate limiter.
 *
 * Buckets are keyed by `<class>:<identity>` where identity is the API key id
 * when the caller is authenticated and the client address otherwise, so a
 * single noisy application cannot consume another application's budget and an
 * unauthenticated flood cannot consume an authenticated caller's budget.
 *
 * Idle buckets are swept so long-running processes do not accumulate one entry
 * per source address forever.
 */
export class RateLimiter {
  #buckets = new Map();
  #classes;
  #maxBuckets;
  #idleMs;

  constructor(classes, { maxBuckets = 10_000, idleMs = 10 * 60 * 1000 } = {}) {
    this.#classes = classes;
    this.#maxBuckets = maxBuckets;
    this.#idleMs = idleMs;
  }

  /**
   * @returns {{allowed: boolean, remaining: number, retryAfterMs: number, limit: number}}
   */
  consume(className, identity, now = Date.now(), cost = 1) {
    const settings = this.#classes[className];
    if (!settings) return { allowed: true, remaining: Number.POSITIVE_INFINITY, retryAfterMs: 0, limit: 0 };

    const key = `${className}:${identity}`;
    let bucket = this.#buckets.get(key);
    if (!bucket) {
      this.#sweep(now);
      bucket = { tokens: settings.capacity, updatedAt: now };
      this.#buckets.set(key, bucket);
    }

    const elapsedSeconds = Math.max(0, (now - bucket.updatedAt) / 1000);
    bucket.tokens = Math.min(settings.capacity, bucket.tokens + elapsedSeconds * settings.refillPerSecond);
    bucket.updatedAt = now;

    if (bucket.tokens < cost) {
      const deficit = cost - bucket.tokens;
      const retryAfterMs = settings.refillPerSecond > 0
        ? Math.ceil((deficit / settings.refillPerSecond) * 1000)
        : 60_000;
      return { allowed: false, remaining: 0, retryAfterMs, limit: settings.capacity };
    }

    bucket.tokens -= cost;
    return {
      allowed: true,
      remaining: Math.floor(bucket.tokens),
      retryAfterMs: 0,
      limit: settings.capacity,
    };
  }

  get size() {
    return this.#buckets.size;
  }

  #sweep(now) {
    if (this.#buckets.size < this.#maxBuckets) {
      // Cheap opportunistic sweep: only walk when the map is getting large.
      if (this.#buckets.size < this.#maxBuckets / 2) return;
    }
    for (const [key, bucket] of this.#buckets) {
      if (now - bucket.updatedAt > this.#idleMs) this.#buckets.delete(key);
    }
    if (this.#buckets.size >= this.#maxBuckets) {
      // Still full of active buckets: drop the least recently touched entries.
      const entries = [...this.#buckets.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
      for (const [key] of entries.slice(0, Math.ceil(this.#maxBuckets / 10))) this.#buckets.delete(key);
    }
  }
}

/**
 * Resolves the client address, honouring only as many X-Forwarded-For hops as
 * the operator explicitly declared. With 0 trusted hops the header is ignored
 * entirely, so a client cannot spoof its own rate-limit identity.
 */
export function clientIdentity(request, trustedProxyHops = 0) {
  if (trustedProxyHops > 0) {
    const forwarded = String(request.headers['x-forwarded-for'] || '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    if (forwarded.length) {
      const index = Math.max(0, forwarded.length - trustedProxyHops);
      const candidate = forwarded[index];
      if (candidate) return candidate;
    }
  }
  return request.socket?.remoteAddress || 'unknown';
}
