class BoundedFixedWindowRateLimiter {
  constructor({ windowMs, requests, maxKeys, pruneIntervalMs } = {}) {
    this.windowMs = Math.max(1, Number(windowMs) || 60_000);
    this.requests = Math.max(1, Number(requests) || 1);
    this.maxKeys = Math.max(1, Number(maxKeys) || 10_000);
    this.pruneIntervalMs = Math.max(
      1,
      Number(pruneIntervalMs) || Math.min(this.windowMs, 10_000)
    );
    this.windows = new Map();
    this.lastPrunedAt = 0;
  }

  prune(now = Date.now(), force = false) {
    if (!force && now - this.lastPrunedAt < this.pruneIntervalMs) return 0;
    let removed = 0;
    for (const [key, window] of this.windows) {
      if (now - window.startedAt < this.windowMs) continue;
      this.windows.delete(key);
      removed += 1;
    }
    this.lastPrunedAt = now;
    return removed;
  }

  consume(key, now = Date.now()) {
    const normalizedKey = String(key || 'unknown').slice(0, 128);
    let window = this.windows.get(normalizedKey);
    if (window && now - window.startedAt >= this.windowMs) {
      this.windows.delete(normalizedKey);
      window = null;
    }
    if (!window) {
      this.prune(now);
      if (this.windows.size >= this.maxKeys) return false;
      this.windows.set(normalizedKey, { startedAt: now, count: 1 });
      return true;
    }
    window.count += 1;
    return window.count <= this.requests;
  }

  /** Milliseconds until this key's window resets, so a caller that was turned
   * away can be told when to come back instead of guessing. Zero when the key
   * is not currently limited. */
  retryAfterMs(key, now = Date.now()) {
    const window = this.windows.get(String(key || 'unknown').slice(0, 128));
    if (!window) return 0;
    return Math.max(0, this.windowMs - (now - window.startedAt));
  }

  get size() {
    return this.windows.size;
  }
}

module.exports = { BoundedFixedWindowRateLimiter };
