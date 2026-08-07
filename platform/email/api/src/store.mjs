import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Durable operational state for the mail platform, with no third-party
 * dependency.
 *
 * Layout inside the data directory (a Docker named volume):
 *   events.jsonl          append-only delivery/bounce events, size-rotated
 *   events.1.jsonl ...     rotated generations, oldest pruned
 *   suppressions.jsonl    append-only suppression log, compacted on open
 *   idempotency.jsonl     append-only idempotency records, TTL-compacted
 *   counters.json         atomic snapshot of aggregate counters
 *
 * Design notes:
 * - Recipient addresses are never stored in plaintext. Callers pass a salted
 *   hash plus a masked display form.
 * - All writes go through a single serialised queue so concurrent requests
 *   cannot interleave partial JSON lines.
 * - Snapshots are written to a temp file and renamed, so a crash mid-write
 *   leaves the previous snapshot intact.
 *
 * Scale note: this is sized for a single-host sender doing thousands of
 * messages per day. See docs/05-operations.md for the migration path to
 * MariaDB if volume outgrows it.
 */

const EVENT_TYPES = new Set([
  'accepted', 'queued', 'sent', 'delivered', 'deferred', 'bounced',
  'complained', 'suppressed', 'rejected', 'failed', 'held', 'unsubscribed',
]);

const BOUNCE_TYPES = new Set(['hard', 'soft', 'complaint', 'unknown']);

const SUPPRESSION_REASONS = new Set([
  'hard_bounce', 'complaint', 'unsubscribe', 'manual', 'repeated_soft_bounce', 'invalid_address',
]);

function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
}

function safeParse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

async function readTail(file, maxBytes) {
  let handle;
  try {
    handle = await fs.promises.open(file, 'r');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
  try {
    const stat = await handle.stat();
    if (!stat.size) return '';
    const bytes = Math.min(stat.size, maxBytes);
    const offset = stat.size - bytes;
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, offset);
    let content = buffer.subarray(0, bytesRead).toString('utf8');
    // Drop a partial first line when we did not start at a record boundary.
    if (offset > 0) content = content.slice(content.indexOf('\n') + 1);
    return content;
  } finally {
    await handle.close();
  }
}

export class Store {
  #dataDir;
  #limits;
  #writeQueue = Promise.resolve();
  #recentEvents = [];
  #suppressions = new Map();
  #idempotency = new Map();
  #counters;
  #suppressionTombstones = 0;
  #closed = false;

  constructor({ dataDir, limits }) {
    this.#dataDir = dataDir;
    this.#limits = {
      recentEventLimit: 500,
      eventFileMaxBytes: 8 * 1024 * 1024,
      eventFileKeep: 3,
      idempotencyTtlMs: 24 * 60 * 60 * 1000,
      ...limits,
    };
    this.#counters = Store.#emptyCounters();
  }

  static #emptyCounters() {
    return {
      events: {},
      bounces: { hard: 0, soft: 0, complaint: 0, unknown: 0 },
      sendAttempts: 0,
      sendAccepted: 0,
      sendRejected: 0,
      sendSuppressed: 0,
      webhooksAccepted: 0,
      webhooksRejected: 0,
      startedAt: null,
    };
  }

  static async open(options) {
    const store = new Store(options);
    await store.#load();
    return store;
  }

  get paths() {
    return {
      events: path.join(this.#dataDir, 'events.jsonl'),
      suppressions: path.join(this.#dataDir, 'suppressions.jsonl'),
      idempotency: path.join(this.#dataDir, 'idempotency.jsonl'),
      counters: path.join(this.#dataDir, 'counters.json'),
    };
  }

  async #load() {
    await fs.promises.mkdir(this.#dataDir, { recursive: true });
    const { events, suppressions, idempotency, counters } = this.paths;

    const snapshot = safeParse(await fs.promises.readFile(counters, 'utf8').catch(() => ''));
    if (snapshot && typeof snapshot === 'object') {
      this.#counters = { ...Store.#emptyCounters(), ...snapshot };
      this.#counters.bounces = { ...Store.#emptyCounters().bounces, ...(snapshot.bounces || {}) };
      this.#counters.events = { ...(snapshot.events || {}) };
    }
    this.#counters.startedAt = nowIso();

    for (const line of (await readTail(events, 2 * 1024 * 1024)).split('\n')) {
      const record = line.trim() && safeParse(line);
      if (record) this.#pushRecent(record);
    }

    const suppressionLines = (await fs.promises.readFile(suppressions, 'utf8').catch(() => '')).split('\n');
    for (const line of suppressionLines) {
      const record = line.trim() && safeParse(line);
      if (!record?.hash) continue;
      if (record.op === 'remove') {
        this.#suppressions.delete(record.hash);
        this.#suppressionTombstones += 1;
      } else {
        this.#suppressions.set(record.hash, record);
      }
    }

    const cutoff = Date.now() - this.#limits.idempotencyTtlMs;
    const idempotencyLines = (await fs.promises.readFile(idempotency, 'utf8').catch(() => '')).split('\n');
    for (const line of idempotencyLines) {
      const record = line.trim() && safeParse(line);
      if (!record?.key) continue;
      if (Date.parse(record.storedAt) < cutoff) continue;
      this.#idempotency.set(record.key, record);
    }

    // Compact on open so restarts bound the on-disk size of both logs.
    await this.#compactSuppressions();
    await this.#compactIdempotency();
  }

  #enqueue(task) {
    const run = this.#writeQueue.then(task, task);
    // Keep the chain alive even when a write fails; the error is returned to
    // the caller through `run`.
    this.#writeQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  async #appendLine(file, record) {
    await fs.promises.appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
  }

  async #writeAtomic(file, content) {
    const temp = `${file}.${randomUUID().slice(0, 8)}.tmp`;
    await fs.promises.writeFile(temp, content, 'utf8');
    await fs.promises.rename(temp, file);
  }

  #pushRecent(record) {
    this.#recentEvents.push(record);
    if (this.#recentEvents.length > this.#limits.recentEventLimit) {
      this.#recentEvents.splice(0, this.#recentEvents.length - this.#limits.recentEventLimit);
    }
  }

  async #rotateEventsIfNeeded() {
    const { events } = this.paths;
    const stat = await fs.promises.stat(events).catch(() => null);
    if (!stat || stat.size < this.#limits.eventFileMaxBytes) return;
    const keep = this.#limits.eventFileKeep;
    const oldest = `${events}.${keep}`;
    await fs.promises.rm(oldest, { force: true });
    for (let index = keep - 1; index >= 1; index -= 1) {
      const from = `${events}.${index}`;
      if (await fs.promises.stat(from).then(() => true, () => false)) {
        await fs.promises.rename(from, `${events}.${index + 1}`);
      }
    }
    await fs.promises.rename(events, `${events}.1`);
  }

  /**
   * Records a delivery event. `recipient` must already be hashed/masked by the
   * caller; this method rejects anything that looks like a plaintext address so
   * a future change cannot quietly start persisting recipients.
   */
  async appendEvent(input) {
    const type = String(input.type || '').toLowerCase();
    if (!EVENT_TYPES.has(type)) throw new Error(`Unknown event type: ${type}`);
    if (input.recipientMasked && /^[^\s@*]+@/.test(String(input.recipientMasked))) {
      throw new Error('recipientMasked must be masked before it reaches the store.');
    }

    const record = {
      id: randomUUID(),
      at: input.at || nowIso(),
      type,
      source: String(input.source || 'mail-api').slice(0, 32),
      messageId: input.messageId ? String(input.messageId).slice(0, 128) : null,
      recipientHash: input.recipientHash ? String(input.recipientHash).slice(0, 64) : null,
      recipientMasked: input.recipientMasked ? String(input.recipientMasked).slice(0, 128) : null,
      recipientDomain: input.recipientDomain ? String(input.recipientDomain).slice(0, 253) : null,
      bounceType: BOUNCE_TYPES.has(input.bounceType) ? input.bounceType : null,
      statusCode: input.statusCode ? String(input.statusCode).slice(0, 16) : null,
      diagnosticCode: input.diagnosticCode ? String(input.diagnosticCode).slice(0, 240) : null,
      keyId: input.keyId ? String(input.keyId).slice(0, 64) : null,
      detail: input.detail ? String(input.detail).slice(0, 240) : null,
    };

    this.#counters.events[type] = (this.#counters.events[type] || 0) + 1;
    if (record.bounceType) {
      this.#counters.bounces[record.bounceType] = (this.#counters.bounces[record.bounceType] || 0) + 1;
    }
    this.#pushRecent(record);

    await this.#enqueue(async () => {
      await this.#rotateEventsIfNeeded();
      await this.#appendLine(this.paths.events, record);
    });
    return record;
  }

  recentEvents({ limit = 50, type = null, domain = null, bounceOnly = false } = {}) {
    const bounded = Math.min(Math.max(Number(limit) || 50, 1), this.#limits.recentEventLimit);
    const filtered = this.#recentEvents.filter((event) => {
      if (type && event.type !== type) return false;
      if (domain && event.recipientDomain !== domain) return false;
      if (bounceOnly && !['bounced', 'complained'].includes(event.type)) return false;
      return true;
    });
    return filtered.slice(-bounded).reverse();
  }

  // ------------------------------------------------------------ suppressions
  isSuppressed(hash) {
    const record = this.#suppressions.get(hash);
    if (!record) return false;
    if (record.expiresAt && Date.parse(record.expiresAt) < Date.now()) return false;
    return true;
  }

  getSuppression(hash) {
    return this.#suppressions.get(hash) || null;
  }

  async addSuppression({ hash, masked, domain, reason, source = 'mail-api', expiresAt = null }) {
    if (!/^[a-f0-9]{64}$/i.test(String(hash || ''))) throw new Error('Suppression requires a salted address hash.');
    if (!SUPPRESSION_REASONS.has(reason)) throw new Error(`Unknown suppression reason: ${reason}`);
    const existing = this.#suppressions.get(hash);
    const record = {
      op: 'add',
      hash,
      masked: masked ? String(masked).slice(0, 128) : null,
      domain: domain ? String(domain).slice(0, 253) : null,
      reason,
      source: String(source).slice(0, 32),
      createdAt: existing?.createdAt || nowIso(),
      updatedAt: nowIso(),
      expiresAt,
      hits: (existing?.hits || 0),
    };
    this.#suppressions.set(hash, record);
    await this.#enqueue(() => this.#appendLine(this.paths.suppressions, record));
    return record;
  }

  async removeSuppression(hash) {
    if (!this.#suppressions.has(hash)) return false;
    this.#suppressions.delete(hash);
    this.#suppressionTombstones += 1;
    await this.#enqueue(() => this.#appendLine(this.paths.suppressions, { op: 'remove', hash, at: nowIso() }));
    if (this.#suppressionTombstones > 512) await this.#compactSuppressions();
    return true;
  }

  /** Increments the hit counter when a send is blocked by a suppression. */
  noteSuppressionHit(hash) {
    const record = this.#suppressions.get(hash);
    if (record) record.hits = (record.hits || 0) + 1;
  }

  listSuppressions({ limit = 100, offset = 0, reason = null, domain = null } = {}) {
    const all = [...this.#suppressions.values()]
      .filter((record) => (!reason || record.reason === reason) && (!domain || record.domain === domain))
      .sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0));
    const start = Math.max(0, Number(offset) || 0);
    const bounded = Math.min(Math.max(Number(limit) || 100, 1), 1000);
    return { total: all.length, items: all.slice(start, start + bounded) };
  }

  suppressionSummary() {
    const byReason = {};
    const byDomain = {};
    for (const record of this.#suppressions.values()) {
      byReason[record.reason] = (byReason[record.reason] || 0) + 1;
      if (record.domain) byDomain[record.domain] = (byDomain[record.domain] || 0) + 1;
    }
    const topDomains = Object.entries(byDomain)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([domain, count]) => ({ domain, count }));
    return { total: this.#suppressions.size, byReason, topDomains };
  }

  async #compactSuppressions() {
    const lines = [...this.#suppressions.values()].map((record) => JSON.stringify(record)).join('\n');
    await this.#enqueue(() => this.#writeAtomic(this.paths.suppressions, lines ? `${lines}\n` : ''));
    this.#suppressionTombstones = 0;
  }

  // ------------------------------------------------------------ idempotency
  /**
   * Returns a live idempotency record, or null when the key is unused or its
   * retention window has passed.
   */
  getIdempotency(key) {
    const existing = this.#idempotency.get(key);
    if (!existing) return null;
    if (Date.parse(existing.storedAt) < Date.now() - this.#limits.idempotencyTtlMs) {
      this.#idempotency.delete(key);
      return null;
    }
    return existing;
  }

  /**
   * Stores the response to replay for a future request carrying the same key.
   * Written only after the underlying send succeeded, so a failed attempt can
   * be retried with the same key instead of being permanently poisoned.
   */
  async putIdempotency(key, value) {
    const record = { key, storedAt: nowIso(), value };
    this.#idempotency.set(key, record);
    await this.#enqueue(() => this.#appendLine(this.paths.idempotency, record));
    return record;
  }

  async #compactIdempotency() {
    const cutoff = Date.now() - this.#limits.idempotencyTtlMs;
    for (const [key, record] of this.#idempotency) {
      if (Date.parse(record.storedAt) < cutoff) this.#idempotency.delete(key);
    }
    const lines = [...this.#idempotency.values()].map((record) => JSON.stringify(record)).join('\n');
    await this.#enqueue(() => this.#writeAtomic(this.paths.idempotency, lines ? `${lines}\n` : ''));
  }

  // ---------------------------------------------------------------- counters
  increment(counter, amount = 1) {
    if (!(counter in this.#counters)) return;
    if (typeof this.#counters[counter] !== 'number') return;
    this.#counters[counter] += amount;
  }

  counters() {
    return {
      ...this.#counters,
      events: { ...this.#counters.events },
      bounces: { ...this.#counters.bounces },
      suppressions: this.#suppressions.size,
      recentEventsHeld: this.#recentEvents.length,
      idempotencyKeysHeld: this.#idempotency.size,
    };
  }

  /**
   * Bounce and complaint rates over the retained event window. Reported
   * alongside the sample size so a small window is never mistaken for a
   * statistically meaningful rate.
   */
  deliveryRates() {
    const window = this.#recentEvents;
    const counted = window.filter((event) => ['sent', 'delivered', 'bounced', 'complained', 'deferred', 'failed'].includes(event.type));
    const total = counted.length;
    const tally = (type) => counted.filter((event) => event.type === type).length;
    const rate = (value) => (total ? Number((value / total).toFixed(4)) : 0);
    return {
      sampleSize: total,
      windowLimit: this.#limits.recentEventLimit,
      delivered: tally('delivered'),
      sent: tally('sent'),
      bounced: tally('bounced'),
      complained: tally('complained'),
      deferred: tally('deferred'),
      failed: tally('failed'),
      bounceRate: rate(tally('bounced')),
      complaintRate: rate(tally('complained')),
      deferralRate: rate(tally('deferred')),
    };
  }

  async flush() {
    await this.#enqueue(() => this.#writeAtomic(this.paths.counters, JSON.stringify(this.#counters, null, 2)));
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    await this.flush();
    await this.#writeQueue;
  }
}

export { EVENT_TYPES, BOUNCE_TYPES, SUPPRESSION_REASONS };
