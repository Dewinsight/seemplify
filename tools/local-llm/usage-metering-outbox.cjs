const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DELIVERY_PATH = '/api/internal/ai/v1/local-usage/events';
const TOKEN_FIELDS = [
  'inputTokens',
  'cachedInputTokens',
  'outputTokens',
  'reasoningTokens',
  'totalTokens'
];

function safeText(value, maximumLength) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, maximumLength);
}

function tokenCount(value) {
  const parsed = Math.floor(Number(value) || 0);
  return Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, parsed));
}

function sanitizeUsageEvent(input = {}) {
  const eventId = safeText(input.eventId, 200);
  const gatewayExecutionId = safeText(input.gatewayExecutionId, 200);
  if (!/^usage_[a-f0-9]{48}$/.test(eventId)) {
    throw new TypeError('Local usage eventId is invalid');
  }
  if (!/^localexec_[a-f0-9]{48}$/.test(gatewayExecutionId)) {
    throw new TypeError('Local gateway execution ID is invalid');
  }
  const occurredAt = new Date(input.occurredAt || Date.now());
  if (!Number.isFinite(occurredAt.getTime())) {
    throw new TypeError('Local usage event timestamp is invalid');
  }
  const event = {
    eventId,
    gatewayExecutionId,
    requestId: safeText(input.requestId, 200),
    sourceApp: safeText(input.sourceApp || 'recruiter', 64),
    activity: safeText(input.activity, 100),
    provider: safeText(input.provider, 80),
    model: safeText(input.model, 200),
    providerRequestId: safeText(input.providerRequestId, 200) || undefined,
    status: input.status === 'failed' ? 'failed' : 'success',
    httpStatus: Math.max(0, Math.min(599, Math.floor(Number(input.httpStatus) || 0))) || undefined,
    errorCode: safeText(input.errorCode, 100) || undefined,
    latencyMs: Math.max(0, Math.floor(Number(input.latencyMs) || 0)),
    usageReported: input.usageReported === true,
    usageSource: safeText(input.usageSource || (input.usageReported ? 'local-gateway' : 'unreported'), 100),
    occurredAt: occurredAt.toISOString()
  };
  for (const field of TOKEN_FIELDS) event[field] = tokenCount(input[field]);
  event.cachedInputTokens = Math.min(event.cachedInputTokens, event.inputTokens);
  event.reasoningTokens = Math.min(event.reasoningTokens, event.outputTokens);
  event.totalTokens = Math.max(event.totalTokens, event.inputTokens + event.outputTokens);
  if (!event.requestId || !event.activity || !event.provider || !event.model) {
    throw new TypeError('Local usage event is missing required non-PII metadata');
  }
  return event;
}

function usageEventFingerprint(input = {}) {
  const event = sanitizeUsageEvent(input);
  return crypto.createHash('sha256').update(JSON.stringify(event)).digest('hex');
}

function identityConflictError(eventId) {
  const error = new Error(`Local usage outbox identity conflict for ${eventId}`);
  error.code = 'LOCAL_USAGE_IDENTITY_CONFLICT';
  return error;
}

function signUsageRequest(secret, rawBody, {
  now = Date.now(),
  nonce = crypto.randomBytes(24).toString('base64url'),
  method = 'POST',
  requestPath = DELIVERY_PATH
} = {}) {
  const timestamp = String(now);
  const signature = crypto.createHmac('sha256', String(secret || ''))
    .update(`${timestamp}\n${nonce}\n${String(method).toUpperCase()}\n${requestPath}\n${rawBody}`)
    .digest('base64url');
  return { timestamp, nonce, signature };
}

async function atomicWrite(file, value) {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.promises.writeFile(temporary, value, { encoding: 'utf8', mode: 0o600 });
  await fs.promises.rename(temporary, file);
}

class LocalUsageMeteringOutbox {
  constructor({
    directory,
    endpointUrl,
    secret,
    fetchImpl = globalThis.fetch,
    initialDelayMs = 15_000,
    retryBaseMs = 1_000,
    retryMaxMs = 5 * 60_000,
    deadMaxJobs = 1_000,
    deadRetentionMs = 30 * 24 * 60 * 60_000,
    now = () => Date.now(),
    log = () => {}
  }) {
    if (!directory || !endpointUrl || !secret || typeof fetchImpl !== 'function') {
      throw new TypeError('Local usage metering outbox is not fully configured');
    }
    this.directory = path.resolve(directory);
    this.deadDirectory = path.join(this.directory, 'dead');
    this.endpointUrl = String(endpointUrl);
    this.secret = String(secret);
    this.fetch = fetchImpl;
    this.initialDelayMs = Math.max(0, Number(initialDelayMs) || 0);
    this.retryBaseMs = Math.max(50, Number(retryBaseMs) || 1_000);
    this.retryMaxMs = Math.max(this.retryBaseMs, Number(retryMaxMs) || 5 * 60_000);
    this.deadMaxJobs = Math.max(1, Math.floor(Number(deadMaxJobs) || 1_000));
    this.deadRetentionMs = Math.max(1, Number(deadRetentionMs) || 30 * 24 * 60 * 60_000);
    this.now = now;
    this.log = log;
    this.timer = null;
    this.timerDueAt = null;
    this.started = false;
    this.flushPromise = null;
    this.lastAttemptAt = null;
    this.lastDeliveryAt = null;
    this.lastErrorAt = null;
    this.lastError = null;
  }

  async ensureDirectories() {
    await fs.promises.mkdir(this.deadDirectory, { recursive: true });
    await this.pruneDeadLetters();
  }

  async pruneDeadLetters() {
    let names;
    try {
      names = (await fs.promises.readdir(this.deadDirectory))
        .filter((name) => /^[a-f0-9]{64}\.json$/.test(name));
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    const entries = [];
    for (const name of names) {
      const file = path.join(this.deadDirectory, name);
      try {
        const [contents, stats] = await Promise.all([
          fs.promises.readFile(file, 'utf8').catch(() => ''),
          fs.promises.stat(file)
        ]);
        let terminalAt = stats.mtimeMs;
        try {
          const parsed = JSON.parse(contents);
          const declared = new Date(parsed.terminalAt || parsed.quarantinedAt).getTime();
          if (Number.isFinite(declared)) terminalAt = declared;
        } catch {}
        entries.push({ file, name, terminalAt });
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    entries.sort((left, right) => left.terminalAt - right.terminalAt || left.name.localeCompare(right.name));
    const expiredBefore = this.now() - this.deadRetentionMs;
    const expired = entries.filter((entry) => entry.terminalAt < expiredBefore);
    const remaining = entries.filter((entry) => entry.terminalAt >= expiredBefore);
    const overflow = remaining.slice(0, Math.max(0, remaining.length - this.deadMaxJobs));
    for (const entry of [...expired, ...overflow]) {
      await fs.promises.unlink(entry.file).catch((error) => {
        if (error?.code !== 'ENOENT') throw error;
      });
    }
  }

  jobFile(eventId) {
    const digest = crypto.createHash('sha256').update(eventId).digest('hex');
    return path.join(this.directory, `${digest}.json`);
  }

  async enqueue(input) {
    const event = sanitizeUsageEvent(input);
    const eventFingerprint = usageEventFingerprint(event);
    await this.ensureDirectories();
    const file = this.jobFile(event.eventId);
    let existing = null;
    try {
      existing = JSON.parse(await fs.promises.readFile(file, 'utf8'));
    } catch (error) {
      if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      if (error instanceof SyntaxError) await this.quarantineCorruptJob(file, error);
    }
    if (existing) {
      let existingFingerprint;
      try {
        existingFingerprint = usageEventFingerprint(existing.event);
      } catch (error) {
        await this.quarantineCorruptJob(file, error);
        existing = null;
      }
      if (existing) {
        if (
          (existing.eventFingerprint && existing.eventFingerprint !== existingFingerprint)
          || existingFingerprint !== eventFingerprint
        ) {
          await this.quarantineIdentityConflict({
            event,
            existingFingerprint,
            conflictingFingerprint: eventFingerprint
          });
          throw identityConflictError(event.eventId);
        }
        this.schedule(0);
        return { eventId: event.eventId, duplicate: true, file };
      }
    }
    const createdAt = new Date(this.now()).toISOString();
    const job = {
      schemaVersion: 1,
      event,
      eventFingerprint,
      attempts: 0,
      createdAt,
      nextAttemptAt: new Date(this.now() + this.initialDelayMs).toISOString()
    };
    await atomicWrite(file, JSON.stringify(job));
    this.schedule(this.initialDelayMs);
    return { eventId: event.eventId, duplicate: false, file };
  }

  start() {
    this.started = true;
    this.schedule(250);
  }

  stop() {
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.timerDueAt = null;
  }

  status() {
    const countJobs = (directory) => {
      try {
        return fs.readdirSync(directory).filter((name) => /^[a-f0-9]{64}\.json$/.test(name)).length;
      } catch {
        return 0;
      }
    };
    const pending = countJobs(this.directory);
    const dead = countJobs(this.deadDirectory);
    return {
      configured: true,
      running: this.started,
      delivering: Boolean(this.flushPromise),
      health: dead > 0 ? 'degraded' : this.lastError && pending > 0 ? 'retrying' : 'healthy',
      pending,
      dead,
      lastAttemptAt: this.lastAttemptAt,
      lastDeliveryAt: this.lastDeliveryAt,
      lastErrorAt: this.lastErrorAt,
      lastError: this.lastError
    };
  }

  schedule(delayMs = 0) {
    if (!this.started) return;
    const dueAt = this.now() + Math.max(0, delayMs);
    if (this.timer && this.timerDueAt <= dueAt) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.timerDueAt = null;
      void this.flush().catch((error) => {
        this.log('error', 'Local usage metering outbox flush failed', { error: error.message });
        this.schedule(this.retryBaseMs);
      });
    }, Math.max(0, delayMs));
    this.timerDueAt = dueAt;
    this.timer.unref?.();
  }

  async readJobs() {
    await this.ensureDirectories();
    const names = (await fs.promises.readdir(this.directory))
      .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
      .sort();
    const jobs = [];
    for (const name of names) {
      const file = path.join(this.directory, name);
      try {
        const job = JSON.parse(await fs.promises.readFile(file, 'utf8'));
        const event = sanitizeUsageEvent(job.event);
        const eventFingerprint = usageEventFingerprint(event);
        if (job.eventFingerprint && job.eventFingerprint !== eventFingerprint) {
          throw new Error('Local usage outbox job fingerprint does not match its event');
        }
        jobs.push({
          file,
          job: {
            ...job,
            event,
            eventFingerprint
          }
        });
      } catch (error) {
        await this.quarantineCorruptJob(file, error);
        this.log('error', 'Local usage metering outbox job could not be read', {
          file: name,
          error: error.message
        });
      }
    }
    return jobs;
  }

  async quarantineIdentityConflict({
    event,
    existingFingerprint,
    conflictingFingerprint
  }) {
    const digest = crypto.createHash('sha256')
      .update(`identity-conflict\0${event.eventId}\0${conflictingFingerprint}`)
      .digest('hex');
    const target = path.join(this.deadDirectory, `${digest}.json`);
    await atomicWrite(target, JSON.stringify({
      schemaVersion: 1,
      identityConflict: true,
      eventId: event.eventId,
      gatewayExecutionId: event.gatewayExecutionId,
      existingFingerprint,
      conflictingFingerprint,
      quarantinedAt: new Date(this.now()).toISOString(),
      error: 'A conflicting payload reused an existing local usage event ID'
    }));
    this.lastErrorAt = new Date(this.now()).toISOString();
    this.lastError = `A conflicting payload reused local usage event ${event.eventId}`;
    await this.pruneDeadLetters();
  }

  async quarantineCorruptJob(file, error) {
    const target = path.join(this.deadDirectory, path.basename(file));
    await atomicWrite(target, JSON.stringify({
      schemaVersion: 1,
      corrupt: true,
      quarantinedAt: new Date(this.now()).toISOString(),
      error: safeText(error?.message || error, 300)
    }));
    await fs.promises.unlink(file).catch((unlinkError) => {
      if (unlinkError?.code !== 'ENOENT') throw unlinkError;
    });
    this.lastErrorAt = new Date(this.now()).toISOString();
    this.lastError = 'A corrupt local usage outbox job was quarantined';
    await this.pruneDeadLetters();
  }

  async defer(file, job, error) {
    const attempts = Math.max(0, Number(job.attempts) || 0) + 1;
    const delayMs = Math.min(this.retryMaxMs, this.retryBaseMs * (2 ** Math.min(16, attempts - 1)));
    const next = {
      ...job,
      attempts,
      lastError: safeText(error?.message || error, 300),
      lastAttemptAt: new Date(this.now()).toISOString(),
      nextAttemptAt: new Date(this.now() + delayMs).toISOString()
    };
    await atomicWrite(file, JSON.stringify(next));
    return delayMs;
  }

  async deadLetter(file, job, status) {
    const target = path.join(this.deadDirectory, path.basename(file));
    await atomicWrite(target, JSON.stringify({
      ...job,
      terminalStatus: status,
      terminalAt: new Date(this.now()).toISOString()
    }));
    await fs.promises.unlink(file).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
    await this.pruneDeadLetters();
  }

  async deliver(file, job) {
    this.lastAttemptAt = new Date(this.now()).toISOString();
    const rawBody = JSON.stringify({ schemaVersion: 1, event: sanitizeUsageEvent(job.event) });
    const requestPath = new URL(this.endpointUrl).pathname;
    const signed = signUsageRequest(this.secret, rawBody, { now: this.now(), requestPath });
    let response;
    try {
      response = await this.fetch(this.endpointUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-seemplify-timestamp': signed.timestamp,
          'x-seemplify-nonce': signed.nonce,
          'x-seemplify-signature': signed.signature
        },
        body: rawBody,
        signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(10_000) : undefined
      });
    } catch (error) {
      this.lastErrorAt = new Date(this.now()).toISOString();
      this.lastError = safeText(error?.message || error, 300);
      return { delivered: false, delayMs: await this.defer(file, job, error) };
    }
    await response.arrayBuffer().catch(() => null);
    if (response.ok) {
      await fs.promises.unlink(file).catch((error) => {
        if (error?.code !== 'ENOENT') throw error;
      });
      this.lastDeliveryAt = new Date(this.now()).toISOString();
      this.lastError = null;
      this.log('info', 'Local usage event delivered', { eventId: job.event.eventId });
      return { delivered: true, delayMs: 0 };
    }
    if ([400, 409, 422].includes(response.status)) {
      await this.deadLetter(file, job, response.status);
      this.lastErrorAt = new Date(this.now()).toISOString();
      this.lastError = `Hosted usage ingestion rejected the event with HTTP ${response.status}`;
      this.log('error', 'Local usage event was rejected permanently', {
        eventId: job.event.eventId,
        status: response.status
      });
      return { delivered: false, terminal: true, delayMs: 0 };
    }
    const error = new Error(`Hosted usage ingestion returned HTTP ${response.status}`);
    this.lastErrorAt = new Date(this.now()).toISOString();
    this.lastError = error.message;
    return { delivered: false, delayMs: await this.defer(file, job, error) };
  }

  async flush({ force = false } = {}) {
    if (this.flushPromise) return this.flushPromise;
    this.flushPromise = (async () => {
      const jobs = await this.readJobs();
      let nextDelayMs = this.retryMaxMs;
      const results = [];
      for (const entry of jobs) {
        const dueAt = new Date(entry.job.nextAttemptAt || 0).getTime();
        if (!force && dueAt > this.now()) {
          nextDelayMs = Math.min(nextDelayMs, dueAt - this.now());
          continue;
        }
        const result = await this.deliver(entry.file, entry.job);
        results.push(result);
        if (result.delayMs > 0) nextDelayMs = Math.min(nextDelayMs, result.delayMs);
      }
      if (this.started) this.schedule(jobs.length ? nextDelayMs : this.retryMaxMs);
      return results;
    })().finally(() => {
      this.flushPromise = null;
    });
    return this.flushPromise;
  }
}

module.exports = {
  DELIVERY_PATH,
  LocalUsageMeteringOutbox,
  sanitizeUsageEvent,
  signUsageRequest,
  usageEventFingerprint
};
