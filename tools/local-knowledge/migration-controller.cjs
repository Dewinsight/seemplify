const crypto = require('node:crypto');

function boundedPercentage(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : fallback;
}

function deterministicPercentage(seed) {
  const digest = crypto.createHash('sha256').update(String(seed)).digest();
  return digest.readUInt32BE(0) / 0x1_0000_0000 * 100;
}

function percentile(values, quantile) {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.min(ordered.length - 1, Math.ceil(quantile * ordered.length) - 1));
  return ordered[index];
}

class EmbeddingMigrationController {
  constructor({
    provider = 'qwen-tei', rolloutPercent = 0, shadowPercent = 0, windowMs = 5 * 60_000,
    minGateSamples = 20, errorRateLimit = 0.01, p95LimitMs = 500, p99LimitMs = 1_000,
    now = Date.now,
  } = {}) {
    this.provider = provider === 'gte-node' ? 'gte-node' : 'qwen-tei';
    this.rolloutPercent = boundedPercentage(rolloutPercent);
    this.shadowPercent = boundedPercentage(shadowPercent);
    this.windowMs = windowMs;
    this.minGateSamples = minGateSamples;
    this.errorRateLimit = errorRateLimit;
    this.p95LimitMs = p95LimitMs;
    this.p99LimitMs = p99LimitMs;
    this.now = now;
    this.samples = [];
    this.paused = false;
    this.pauseReason = null;
    this.pausedAt = null;
  }

  prune() {
    const cutoff = this.now() - this.windowMs;
    this.samples = this.samples.filter((sample) => sample.at >= cutoff);
  }

  choose(requestId, { gteReady = false } = {}) {
    if (this.provider !== 'gte-node' || this.paused || !gteReady) return 'qwen-tei';
    return deterministicPercentage(`rollout:${requestId}`) < this.rolloutPercent ? 'gte-node' : 'qwen-tei';
  }

  shouldShadow(requestId, { gteReady = false, servedProvider = 'qwen-tei' } = {}) {
    return !this.paused && gteReady && servedProvider === 'qwen-tei'
      && deterministicPercentage(`shadow:${requestId}`) < this.shadowPercent;
  }

  record({ provider, durationMs, failed = false, queueDepth = 0, rssBytes = process.memoryUsage().rss } = {}) {
    if (provider !== 'gte-node') return this.status();
    this.samples.push({ at: this.now(), durationMs: Math.max(0, Number(durationMs) || 0), failed: failed === true, queueDepth: Math.max(0, Number(queueDepth) || 0), rssBytes: Math.max(0, Number(rssBytes) || 0) });
    this.prune();
    this.evaluate();
    return this.status();
  }

  evaluate() {
    if (this.paused || this.samples.length < this.minGateSamples) return;
    const failureRate = this.samples.filter((sample) => sample.failed).length / this.samples.length;
    const durations = this.samples.map((sample) => sample.durationMs);
    const p95 = percentile(durations, 0.95);
    const p99 = percentile(durations, 0.99);
    const recent = this.samples.slice(-8);
    const sustainedQueue = recent.length === 8 && recent.every((sample) => sample.queueDepth > 0)
      && recent.every((sample, index) => index === 0 || sample.queueDepth >= recent[index - 1].queueDepth);
    const memoryGrowth = recent.length === 8 && recent[recent.length - 1].rssBytes - recent[0].rssBytes > 256 * 1024 * 1024
      && recent.every((sample, index) => index === 0 || sample.rssBytes >= recent[index - 1].rssBytes);
    let reason = null;
    if (failureRate > this.errorRateLimit) reason = `error-rate:${failureRate.toFixed(4)}`;
    else if (p95 > this.p95LimitMs) reason = `p95-latency:${p95}`;
    else if (p99 > this.p99LimitMs) reason = `p99-latency:${p99}`;
    else if (sustainedQueue) reason = 'sustained-queue-growth';
    else if (memoryGrowth) reason = 'progressive-memory-growth';
    if (reason) {
      this.paused = true;
      this.pauseReason = reason;
      this.pausedAt = new Date(this.now()).toISOString();
    }
  }

  resume() {
    this.paused = false;
    this.pauseReason = null;
    this.pausedAt = null;
    this.samples = [];
  }

  pause(reason = 'manual-pause') {
    this.paused = true;
    this.pauseReason = String(reason || 'manual-pause').slice(0, 200);
    this.pausedAt = new Date(this.now()).toISOString();
    return this.status();
  }

  status() {
    this.prune();
    const durations = this.samples.map((sample) => sample.durationMs);
    const failures = this.samples.filter((sample) => sample.failed).length;
    return {
      configuredProvider: this.provider,
      rolloutPercent: this.rolloutPercent,
      shadowPercent: this.shadowPercent,
      paused: this.paused,
      pauseReason: this.pauseReason,
      pausedAt: this.pausedAt,
      gates: { errorRateLimit: this.errorRateLimit, p95LimitMs: this.p95LimitMs, p99LimitMs: this.p99LimitMs, minSamples: this.minGateSamples },
      window: {
        samples: this.samples.length,
        failures,
        errorRate: this.samples.length ? failures / this.samples.length : 0,
        p50Ms: percentile(durations, 0.5),
        p95Ms: percentile(durations, 0.95),
        p99Ms: percentile(durations, 0.99),
      },
    };
  }
}

module.exports = { EmbeddingMigrationController, boundedPercentage, deterministicPercentage, percentile };
