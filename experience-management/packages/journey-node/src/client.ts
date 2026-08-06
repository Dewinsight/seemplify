import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import {
  JOURNEY_EVENT_PROTOCOL_VERSION,
  journeyEventLimits,
  parseJourneyServerSecret,
  validateBatchResult,
  validateEventBatch,
  validateEventEnvelope,
  type BatchIngestResult,
  type ConsentSnapshot,
  type JourneyEventBatch,
  type JourneyEventCall,
  type JourneyEventContext,
  type JourneyEventEnvelope,
  type JourneyEventEnvelopeBase,
  type JsonObject
} from '@seemplify/journey-event-protocol';
import { sanitiseContext, sanitiseObject } from './privacy.js';
import type {
  ConsentInput,
  EnqueueResult,
  EventOptions,
  FlushResult,
  ImportBatchResult,
  JourneyEnvironment,
  MetricInput,
  NodeFetch,
  NodeJourneyRuntime,
  NodeJourneySdk,
  NodeJourneySdkConfig,
  NodeSdkDiagnostic,
  NodeSdkOutcome,
  QueueOverflowBehaviour
} from './types.js';

const SDK_NAME = '@seemplify/journey-node';
const SDK_VERSION = '0.1.0';

interface QueueEntry {
  event: JourneyEventEnvelope;
  enqueuedAt: number;
  attempts: number;
  nextAttemptAt: number;
  bytes: number;
}

interface ResolvedRuntime {
  fetch?: NodeFetch;
  now: () => number;
  random: () => number;
  randomUuid: () => string;
  byteLength: (value: string) => number;
  setTimeout: (callback: () => void, delayMs: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  createAbortController?: () => AbortController;
}

interface ResolvedLimits {
  queueEvents: number;
  queueBytes: number;
  queueAgeMs: number;
  overflow: QueueOverflowBehaviour;
  batchEvents: number;
  batchBytes: number;
  flushIntervalMs: number;
  maxBatchesPerFlush: number;
  retryAttempts: number;
  retryBaseMs: number;
  retryMaxMs: number;
  retryJitter: number;
  requestTimeoutMs: number;
}

interface BatchSendResult {
  accepted: number;
  dropped: number;
  retryScheduled: boolean;
}

function clampInteger(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? Math.floor(value as number) : fallback));
}

function clampNumber(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? Number(value) : fallback));
}

function resolveLimits(config: NodeJourneySdkConfig): ResolvedLimits {
  return {
    queueEvents: clampInteger(config.queue?.maxEvents, 10_000, 1, 100_000),
    queueBytes: clampInteger(config.queue?.maxBytes, 8 * 1024 * 1024, 1024, 100 * 1024 * 1024),
    queueAgeMs: clampInteger(config.queue?.maxAgeMs, 24 * 60 * 60 * 1_000, 1_000, 30 * 24 * 60 * 60 * 1_000),
    overflow: config.queue?.overflow === 'drop-newest' ? 'drop-newest' : 'drop-oldest',
    batchEvents: clampInteger(config.batch?.maxEvents, 100, 1, journeyEventLimits.batchEvents),
    batchBytes: clampInteger(config.batch?.maxBytes, journeyEventLimits.batchBytes, 1024, journeyEventLimits.batchBytes),
    flushIntervalMs: clampInteger(config.batch?.flushIntervalMs, 5_000, 10, 10 * 60 * 1_000),
    maxBatchesPerFlush: clampInteger(config.batch?.maxBatchesPerFlush, 100, 1, 1_000),
    retryAttempts: clampInteger(config.retry?.maxAttempts, 5, 1, 20),
    retryBaseMs: clampInteger(config.retry?.baseDelayMs, 500, 10, 60_000),
    retryMaxMs: clampInteger(config.retry?.maxDelayMs, 60_000, 100, 60 * 60 * 1_000),
    retryJitter: clampNumber(config.retry?.jitterRatio, 0.2, 0, 1),
    requestTimeoutMs: clampInteger(config.requestTimeoutMs, 10_000, 10, 120_000)
  };
}

function resolveRuntime(source: NodeJourneyRuntime = {}): ResolvedRuntime {
  let globalFetch: NodeFetch | undefined;
  try {
    if (typeof globalThis.fetch === 'function') {
      globalFetch = ((url, init) => globalThis.fetch(url, init as RequestInit) as Promise<Response>) as NodeFetch;
    }
  } catch { /* A missing transport disables the SDK instead of breaking its host. */ }
  let createAbortController = source.createAbortController;
  if (!createAbortController) {
    try {
      if (typeof AbortController !== 'undefined') createAbortController = () => new AbortController();
    } catch { /* The resolved transport remains failure-isolated. */ }
  }
  const fetchValue = source.fetch ?? globalFetch;
  return {
    ...(fetchValue ? { fetch: fetchValue } : {}),
    now: source.now ?? Date.now,
    random: source.random ?? Math.random,
    randomUuid: source.randomUuid ?? randomUUID,
    byteLength: source.byteLength ?? ((value) => Buffer.byteLength(value, 'utf8')),
    setTimeout: source.setTimeout ?? ((callback, delayMs) => globalThis.setTimeout(callback, delayMs)),
    clearTimeout: source.clearTimeout ?? ((handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>)),
    ...(createAbortController ? { createAbortController } : {})
  };
}

function resolveBatchEndpoint(raw: string) {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return undefined;
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !loopback) return undefined;
    const path = url.pathname.replace(/\/+$/, '');
    url.pathname = path.endsWith('/v1/batch') ? path : `${path}/v1/batch`.replace(/^\/\//, '/');
    return url.toString();
  } catch {
    return undefined;
  }
}

function isoTime(now: number) {
  return new Date(now).toISOString();
}

function safeJson(value: unknown) {
  try { return JSON.stringify(value); }
  catch { return undefined; }
}

function stableJson(value: unknown) {
  const seen = new WeakSet<object>();
  const encode = (entry: unknown): string => {
    if (entry === null || typeof entry === 'string' || typeof entry === 'boolean') return JSON.stringify(entry);
    if (typeof entry === 'number' && Number.isFinite(entry)) return JSON.stringify(entry);
    if (Array.isArray(entry)) return `[${entry.map(encode).join(',')}]`;
    if (typeof entry !== 'object') throw new Error('NON_JSON_VALUE');
    if (seen.has(entry)) throw new Error('CYCLIC_VALUE');
    seen.add(entry);
    const result = `{${Object.keys(entry as Record<string, unknown>).sort().map((key) =>
      `${JSON.stringify(key)}:${encode((entry as Record<string, unknown>)[key])}`).join(',')}}`;
    seen.delete(entry);
    return result;
  };
  try { return encode(value); }
  catch { return undefined; }
}

function safeCallback(callback: (() => void) | undefined) {
  try { callback?.(); } catch { /* Host callbacks never break delivery or the process. */ }
}

function mergeProperties(name: string | undefined, properties: JsonObject | undefined) {
  if (!name) return properties;
  return { ...(properties ?? {}), name } satisfies JsonObject;
}

function retryAfterMs(value: string | null, now: number, maximum: number) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(maximum, seconds * 1_000);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.min(maximum, Math.max(0, timestamp - now)) : 0;
}

function emptyResult(status: FlushResult['status'], retained: number, dropped = 0): FlushResult {
  return { status, accepted: 0, dropped, retained };
}

function combineFlushResults(left: FlushResult, right: FlushResult): FlushResult {
  const status = right.status === 'empty' && left.status !== 'empty' ? left.status : right.status;
  return {
    status,
    accepted: left.accepted + right.accepted,
    dropped: left.dropped + right.dropped,
    retained: right.retained
  };
}

class NodeJourneyClient implements NodeJourneySdk {
  readonly ready = Promise.resolve();
  private readonly runtime: ResolvedRuntime;
  private readonly limits: ResolvedLimits;
  private readonly endpoint: string | undefined;
  private readonly credentialEnvironment: JourneyEnvironment | undefined;
  private readonly configured: boolean;
  private queue: QueueEntry[] = [];
  private timer: unknown | undefined;
  private timerDueAt = Number.POSITIVE_INFINITY;
  private flushPromise: Promise<FlushResult> | undefined;
  private closePromise: Promise<FlushResult> | undefined;
  private closing = false;
  private closed = false;

  constructor(private readonly config: NodeJourneySdkConfig) {
    this.runtime = resolveRuntime(config.runtime);
    this.limits = resolveLimits(config);
    this.endpoint = resolveBatchEndpoint(config.endpoint);
    this.credentialEnvironment = parseJourneyServerSecret(config.serverSecret)?.environment;
    this.configured = Boolean(
      this.endpoint
      && this.runtime.fetch
      && this.credentialEnvironment
      && (!config.environment || config.environment === this.credentialEnvironment)
    );
    if (!this.credentialEnvironment) this.diagnostic({ code: 'SERVER_SECRET_INVALID' });
    if (!this.endpoint) this.diagnostic({ code: 'ENDPOINT_INVALID' });
    if (!this.runtime.fetch) this.diagnostic({ code: 'TRANSPORT_UNAVAILABLE' });
    if (this.credentialEnvironment && config.environment && config.environment !== this.credentialEnvironment) {
      this.diagnostic({ code: 'CREDENTIAL_ENVIRONMENT_MISMATCH' });
    }
  }

  get enabled() {
    return this.configured && !this.closing && !this.closed;
  }

  private result(status: EnqueueResult['status'], code: string, eventId?: string): EnqueueResult {
    return { status, code, ...(eventId ? { eventId } : {}) };
  }

  private outcome(value: NodeSdkOutcome) {
    safeCallback(this.config.callbacks?.onOutcome ? () => this.config.callbacks?.onOutcome?.(Object.freeze({ ...value })) : undefined);
  }

  private diagnostic(value: NodeSdkDiagnostic) {
    safeCallback(this.config.callbacks?.onDiagnostic
      ? () => this.config.callbacks?.onDiagnostic?.(Object.freeze({ ...value }))
      : undefined);
  }

  private now() {
    return this.runtime.now();
  }

  private context(input: JourneyEventContext | undefined): JourneyEventContext {
    const safe = sanitiseContext(input, this.config.privacy) ?? {};
    return {
      ...safe,
      device: safe.device ?? { type: 'server' },
      library: { name: SDK_NAME, version: SDK_VERSION }
    };
  }

  private baseEnvelope(call: JourneyEventCall, options: EventOptions | undefined): JourneyEventEnvelopeBase {
    return {
      protocolVersion: JOURNEY_EVENT_PROTOCOL_VERSION,
      eventId: options?.eventId ?? this.runtime.randomUuid(),
      call,
      occurredAt: options?.occurredAt ?? isoTime(this.now()),
      ...(options?.anonymousId ? { anonymousId: options.anonymousId } : {}),
      ...(options?.userId ? { userId: options.userId } : {}),
      ...(options?.accountId ? { accountId: options.accountId } : {}),
      ...(options?.sessionId ? { sessionId: options.sessionId } : {}),
      context: this.context(options?.context)
    };
  }

  private async invoke(builder: () => JourneyEventEnvelope): Promise<EnqueueResult> {
    try {
      if (this.closed || this.closing) return this.result('closed', 'SDK_CLOSED');
      if (!this.configured) return this.result('disabled', 'SDK_DISABLED');
      return this.enqueue(builder());
    } catch {
      this.diagnostic({ code: 'PUBLIC_CALL_ISOLATED' });
      return this.result('invalid', 'SDK_INTERNAL_ERROR');
    }
  }

  track(event: string, properties?: JsonObject, options?: EventOptions) {
    return this.invoke(() => {
      const safeProperties = sanitiseObject(properties, this.config.privacy);
      return {
        ...this.baseEnvelope('track', options),
        call: 'track',
        event,
        eventVersion: options?.eventVersion ?? 1,
        ...(safeProperties ? { properties: safeProperties } : {})
      };
    });
  }

  identify(userId: string, traits?: JsonObject, options?: EventOptions) {
    return this.invoke(() => {
      const safeTraits = sanitiseObject(traits, this.config.privacy);
      return {
        ...this.baseEnvelope('identify', { ...(options ?? {}), userId }),
        call: 'identify',
        userId,
        ...(safeTraits ? { traits: safeTraits } : {})
      };
    });
  }

  alias(userId: string, anonymousId: string, options?: EventOptions) {
    return this.invoke(() => ({
      ...this.baseEnvelope('alias', { ...(options ?? {}), userId, anonymousId }),
      call: 'alias',
      userId,
      anonymousId
    }));
  }

  group(accountId: string, traits?: JsonObject, options?: EventOptions) {
    return this.invoke(() => {
      const safeTraits = sanitiseObject(traits, this.config.privacy);
      return {
        ...this.baseEnvelope('group', { ...(options ?? {}), accountId }),
        call: 'group',
        accountId,
        ...(safeTraits ? { traits: safeTraits } : {})
      } as JourneyEventEnvelope;
    });
  }

  page(name?: string, properties?: JsonObject, options?: EventOptions) {
    return this.invoke(() => {
      const safeProperties = sanitiseObject(mergeProperties(name, properties), this.config.privacy);
      return {
        ...this.baseEnvelope('page', options),
        call: 'page',
        ...(safeProperties ? { properties: safeProperties } : {})
      };
    });
  }

  screen(name?: string, properties?: JsonObject, options?: EventOptions) {
    return this.invoke(() => {
      const safeProperties = sanitiseObject(mergeProperties(name, properties), this.config.privacy);
      return {
        ...this.baseEnvelope('screen', options),
        call: 'screen',
        ...(safeProperties ? { properties: safeProperties } : {})
      };
    });
  }

  consent(input: ConsentInput, options?: EventOptions) {
    return this.invoke(() => {
      const snapshot: ConsentSnapshot = {
        ...(input.analytics !== undefined ? { analytics: input.analytics } : {}),
        ...(input.personalisation !== undefined ? { personalisation: input.personalisation } : {}),
        ...(input.researchContact !== undefined ? { researchContact: input.researchContact } : {}),
        ...(input.marketing !== undefined ? { marketing: input.marketing } : {}),
        source: input.source,
        updatedAt: input.updatedAt ?? isoTime(this.now())
      };
      return {
        ...this.baseEnvelope('consent', options),
        call: 'consent',
        consent: snapshot
      };
    });
  }

  metric(event: string, metric: MetricInput, options?: EventOptions) {
    return this.invoke(() => {
      const safeDimensions = sanitiseObject(metric.dimensions, this.config.privacy);
      return {
        ...this.baseEnvelope('metric', options),
        call: 'metric',
        event,
        eventVersion: options?.eventVersion ?? 1,
        metric: {
          name: metric.name,
          value: metric.value,
          ...(metric.unit !== undefined ? { unit: metric.unit } : {}),
          ...(safeDimensions ? { dimensions: safeDimensions } : {})
        }
      };
    });
  }

  private sanitiseImportedEnvelope(event: JourneyEventEnvelope): JourneyEventEnvelope {
    const {
      sentAt: _sentAt,
      properties: _properties,
      traits: _traits,
      context: _context,
      metric: _metric,
      ...base
    } = event;
    const safeProperties = sanitiseObject(event.properties, this.config.privacy);
    const safeTraits = sanitiseObject(event.traits, this.config.privacy);
    const safeDimensions = sanitiseObject(event.metric?.dimensions, this.config.privacy);
    return {
      ...base,
      ...(safeProperties ? { properties: safeProperties } : {}),
      ...(safeTraits ? { traits: safeTraits } : {}),
      context: this.context(event.context),
      ...(event.metric ? {
        metric: {
          name: event.metric.name,
          value: event.metric.value,
          ...(event.metric.unit !== undefined ? { unit: event.metric.unit } : {}),
          ...(safeDimensions ? { dimensions: safeDimensions } : {})
        }
      } : {})
    } as JourneyEventEnvelope;
  }

  async importBatch(events: readonly JourneyEventEnvelope[]): Promise<ImportBatchResult> {
    try {
      if (!Array.isArray(events) || events.length === 0) {
        return { status: 'invalid', code: 'IMPORT_BATCH_EMPTY', enqueued: 0, duplicate: 0, rejected: 0, results: [] };
      }
      if (events.length > journeyEventLimits.batchEvents) {
        return {
          status: 'invalid', code: 'IMPORT_BATCH_LIMIT_EXCEEDED', enqueued: 0,
          duplicate: 0, rejected: events.length, results: []
        };
      }
      const unavailable = this.closed || this.closing
        ? { status: 'closed' as const, code: 'SDK_CLOSED' }
        : !this.configured
          ? { status: 'disabled' as const, code: 'SDK_DISABLED' }
          : undefined;
      if (unavailable) {
        const results = events.map((event) => this.result(unavailable.status, unavailable.code, event?.eventId));
        return {
          status: unavailable.status,
          code: unavailable.code,
          enqueued: 0,
          duplicate: 0,
          rejected: results.length,
          results: Object.freeze(results)
        };
      }
      const results: EnqueueResult[] = [];
      for (const event of events) {
        const checked = validateEventEnvelope(event);
        if (!checked.ok) {
          const eventId = event && typeof event === 'object' && 'eventId' in event
            && typeof event.eventId === 'string' ? event.eventId : undefined;
          this.outcome({ kind: 'invalid', ...(eventId ? { eventId } : {}), code: 'PROTOCOL_VALIDATION_FAILED' });
          results.push(this.result('invalid', 'PROTOCOL_VALIDATION_FAILED', eventId));
          continue;
        }
        results.push(this.enqueue(this.sanitiseImportedEnvelope(checked.value)));
      }
      const enqueued = results.filter((result) => result.code === 'QUEUED').length;
      const duplicate = results.filter((result) => result.code === 'ALREADY_QUEUED').length;
      const rejected = results.length - enqueued - duplicate;
      return {
        status: rejected === 0 ? 'queued' : enqueued + duplicate > 0 ? 'partial' : 'invalid',
        code: rejected === 0 ? 'IMPORT_BATCH_QUEUED' : enqueued + duplicate > 0
          ? 'IMPORT_BATCH_PARTIAL' : 'IMPORT_BATCH_REJECTED',
        enqueued,
        duplicate,
        rejected,
        results: Object.freeze(results)
      };
    } catch {
      this.diagnostic({ code: 'IMPORT_BATCH_ISOLATED' });
      return { status: 'invalid', code: 'SDK_INTERNAL_ERROR', enqueued: 0, duplicate: 0, rejected: 0, results: [] };
    }
  }

  private enqueue(event: JourneyEventEnvelope): EnqueueResult {
    const checked = validateEventEnvelope(event);
    if (!checked.ok) {
      this.outcome({ kind: 'invalid', eventId: event.eventId, code: 'PROTOCOL_VALIDATION_FAILED' });
      return this.result('invalid', 'PROTOCOL_VALIDATION_FAILED', event.eventId);
    }
    const encoded = safeJson(checked.value);
    if (!encoded) {
      this.outcome({ kind: 'invalid', eventId: event.eventId, code: 'EVENT_ENCODING_FAILED' });
      return this.result('invalid', 'EVENT_ENCODING_FAILED', event.eventId);
    }
    const bytes = this.runtime.byteLength(encoded);
    if (!Number.isFinite(bytes) || bytes > this.limits.queueBytes) {
      this.outcome({ kind: 'dropped', eventId: event.eventId, code: 'EVENT_EXCEEDS_QUEUE_LIMIT' });
      return this.result('dropped', 'EVENT_EXCEEDS_QUEUE_LIMIT', event.eventId);
    }
    this.expireOldEntries();
    const existing = this.queue.find((entry) => entry.event.eventId === event.eventId);
    if (existing) {
      if (stableJson(existing.event) !== stableJson(checked.value)) {
        this.outcome({ kind: 'invalid', eventId: event.eventId, code: 'EVENT_ID_CONFLICT' });
        return this.result('invalid', 'EVENT_ID_CONFLICT', event.eventId);
      }
      return this.result('queued', 'ALREADY_QUEUED', event.eventId);
    }
    if (this.limits.overflow === 'drop-newest'
      && (this.queue.length >= this.limits.queueEvents || this.queueBytes() + bytes > this.limits.queueBytes)) {
      this.outcome({ kind: 'dropped', eventId: event.eventId, code: 'QUEUE_OVERFLOW_NEWEST' });
      return this.result('dropped', 'QUEUE_OVERFLOW_NEWEST', event.eventId);
    }
    this.queue.push({ event: checked.value, enqueuedAt: this.now(), attempts: 0, nextAttemptAt: 0, bytes });
    while (this.queue.length > this.limits.queueEvents || this.queueBytes() > this.limits.queueBytes) {
      const removed = this.queue.shift();
      if (removed) this.outcome({ kind: 'dropped', eventId: removed.event.eventId, code: 'QUEUE_OVERFLOW_OLDEST' });
    }
    this.outcome({ kind: 'queued', eventId: event.eventId, code: 'QUEUED' });
    this.scheduleFlush(this.queue.length >= this.limits.batchEvents ? 0 : this.limits.flushIntervalMs);
    return this.result('queued', 'QUEUED', event.eventId);
  }

  private queueBytes() {
    return this.queue.reduce((total, entry) => total + entry.bytes, 0);
  }

  private expireOldEntries() {
    let dropped = 0;
    const cutoff = this.now() - this.limits.queueAgeMs;
    this.queue = this.queue.filter((entry) => {
      if (entry.enqueuedAt > cutoff) return true;
      dropped += 1;
      this.outcome({ kind: 'dropped', eventId: entry.event.eventId, code: 'QUEUE_ENTRY_EXPIRED' });
      return false;
    });
    return dropped;
  }

  private clearTimer() {
    if (this.timer === undefined) return;
    try { this.runtime.clearTimeout(this.timer); } catch { /* Timer cleanup is best-effort. */ }
    this.timer = undefined;
    this.timerDueAt = Number.POSITIVE_INFINITY;
  }

  private scheduleFlush(delayMs: number) {
    if (!this.configured || this.closing || this.closed) return;
    try {
      const delay = Math.max(0, delayMs);
      const dueAt = this.now() + delay;
      if (this.timer !== undefined && dueAt >= this.timerDueAt) return;
      this.clearTimer();
      const handle = this.runtime.setTimeout(() => {
        this.timer = undefined;
        this.timerDueAt = Number.POSITIVE_INFINITY;
        void this.flush();
      }, delay);
      this.timer = handle;
      this.timerDueAt = dueAt;
      if (typeof handle === 'object' && handle !== null && 'unref' in handle
        && typeof (handle as { unref?: unknown }).unref === 'function') {
        (handle as { unref(): void }).unref();
      }
    } catch {
      this.timer = undefined;
      this.timerDueAt = Number.POSITIVE_INFINITY;
      this.diagnostic({ code: 'TIMER_UNAVAILABLE' });
    }
  }

  private eligibleEntries(forceReady: boolean) {
    const now = this.now();
    const entries: QueueEntry[] = [];
    let bytes = 256;
    for (const entry of this.queue) {
      if (!forceReady && entry.nextAttemptAt > now) continue;
      if (entries.length >= this.limits.batchEvents) break;
      if (entries.length && bytes + entry.bytes > this.limits.batchBytes) break;
      entries.push(entry);
      bytes += entry.bytes;
      if (bytes > this.limits.batchBytes) break;
    }
    return entries;
  }

  private removeEntry(entry: QueueEntry, kind: 'accepted' | 'rejected', code: string) {
    const index = this.queue.indexOf(entry);
    if (index >= 0) this.queue.splice(index, 1);
    this.outcome({ kind, eventId: entry.event.eventId, code });
  }

  private async retryEntries(entries: QueueEntry[], status: number, serverDelayMs: number) {
    let dropped = 0;
    let shortestDelay = this.limits.retryMaxMs;
    for (const entry of entries) {
      entry.attempts += 1;
      if (entry.attempts >= this.limits.retryAttempts) {
        this.removeEntry(entry, 'rejected', 'RETRY_LIMIT_REACHED');
        dropped += 1;
        continue;
      }
      const exponential = Math.min(
        this.limits.retryMaxMs,
        this.limits.retryBaseMs * 2 ** Math.max(0, entry.attempts - 1)
      );
      const jitter = 1 - this.limits.retryJitter + this.runtime.random() * 2 * this.limits.retryJitter;
      const delay = Math.min(
        this.limits.retryMaxMs,
        Math.max(serverDelayMs, Math.round(exponential * jitter))
      );
      entry.nextAttemptAt = this.now() + delay;
      shortestDelay = Math.min(shortestDelay, delay);
      this.outcome({ kind: 'retried', eventId: entry.event.eventId, code: 'RETRY_SCHEDULED' });
      this.diagnostic({ code: 'RETRY_SCHEDULED', delayMs: delay, ...(status ? { status } : {}) });
    }
    if (entries.length > dropped) this.scheduleFlush(shortestDelay);
    return dropped;
  }

  private async sendBatch(initialEntries: QueueEntry[]): Promise<BatchSendResult> {
    let entries = initialEntries;
    const sentAt = isoTime(this.now());
    const batchId = this.runtime.randomUuid();
    let batch: JourneyEventBatch;
    let body: string | undefined;
    while (true) {
      batch = {
        protocolVersion: JOURNEY_EVENT_PROTOCOL_VERSION,
        batchId,
        sentAt,
        events: entries.map((entry) => ({ ...entry.event, sentAt } as JourneyEventEnvelope))
      };
      const checked = validateEventBatch(batch);
      body = safeJson(batch);
      if (checked.ok && body && this.runtime.byteLength(body) <= this.limits.batchBytes) break;
      if (entries.length > 1) {
        entries = entries.slice(0, -1);
        continue;
      }
      const entry = entries[0];
      if (entry) this.removeEntry(entry, 'rejected', 'LOCAL_BATCH_VALIDATION_FAILED');
      return { accepted: 0, dropped: entry ? 1 : 0, retryScheduled: false };
    }

    const controller = this.runtime.createAbortController?.();
    let timeout: unknown;
    let response;
    try {
      const request = this.runtime.fetch!(this.endpoint!, {
        method: 'POST',
        headers: Object.freeze({
          accept: 'application/json',
          authorization: `Bearer ${this.config.serverSecret}`,
          'content-type': 'application/json',
          'user-agent': `${SDK_NAME}/${SDK_VERSION}`
        }),
        body,
        ...(controller ? { signal: controller.signal } : {})
      });
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeout = this.runtime.setTimeout(() => {
          try { controller?.abort(); } catch { /* Abort remains best-effort. */ }
          reject(new Error('SDK_REQUEST_TIMEOUT'));
        }, this.limits.requestTimeoutMs);
      });
      response = await Promise.race([request, timeoutPromise]);
    } catch {
      if (timeout !== undefined) {
        try { this.runtime.clearTimeout(timeout); } catch { /* Non-fatal. */ }
      }
      const dropped = await this.retryEntries(entries, 0, 0);
      this.diagnostic({ code: 'TRANSPORT_UNAVAILABLE' });
      return { accepted: 0, dropped, retryScheduled: dropped < entries.length };
    }
    if (timeout !== undefined) {
      try { this.runtime.clearTimeout(timeout); } catch { /* Non-fatal. */ }
    }

    const retryAfter = retryAfterMs(response.headers.get('retry-after'), this.now(), this.limits.retryMaxMs);
    if ([408, 425, 429].includes(response.status) || response.status >= 500) {
      const dropped = await this.retryEntries(entries, response.status, retryAfter);
      return { accepted: 0, dropped, retryScheduled: dropped < entries.length };
    }
    if (!response.ok && response.status !== 207) {
      for (const entry of entries) this.removeEntry(entry, 'rejected', `HTTP_${response.status}`);
      return { accepted: 0, dropped: entries.length, retryScheduled: false };
    }

    let parsed: unknown;
    try { parsed = await response.json(); }
    catch {
      const dropped = await this.retryEntries(entries, response.status, retryAfter);
      this.diagnostic({ code: 'INVALID_INGEST_RESPONSE', status: response.status });
      return { accepted: 0, dropped, retryScheduled: dropped < entries.length };
    }
    const result = validateBatchResult(parsed);
    if (!result.ok || result.value.batchId !== batch.batchId) {
      const dropped = await this.retryEntries(entries, response.status, retryAfter);
      this.diagnostic({ code: 'INVALID_INGEST_RESPONSE', status: response.status });
      return { accepted: 0, dropped, retryScheduled: dropped < entries.length };
    }
    return this.applyBatchResult(entries, result.value);
  }

  private async applyBatchResult(entries: QueueEntry[], result: BatchIngestResult): Promise<BatchSendResult> {
    let accepted = 0;
    let dropped = 0;
    const retry: QueueEntry[] = [];
    const byId = new Map(result.results.map((entry) => [entry.eventId, entry]));
    for (const entry of entries) {
      const eventResult = byId.get(entry.event.eventId);
      if (!eventResult) {
        retry.push(entry);
      } else if (eventResult.status === 'accepted' || eventResult.status === 'duplicate' || eventResult.status === 'quarantined') {
        this.removeEntry(
          entry,
          'accepted',
          eventResult.status === 'duplicate' ? 'DUPLICATE_ACCEPTED' : eventResult.status.toUpperCase()
        );
        accepted += 1;
      } else if (eventResult.retryable) {
        retry.push(entry);
      } else {
        this.removeEntry(entry, 'rejected', eventResult.code || 'INGEST_REJECTED');
        dropped += 1;
      }
    }
    const retryDropped = retry.length ? await this.retryEntries(retry, 207, 0) : 0;
    dropped += retryDropped;
    return { accepted, dropped, retryScheduled: retry.length > retryDropped };
  }

  private async performFlush(forceReady: boolean): Promise<FlushResult> {
    try {
      if (this.closed) return emptyResult('closed', this.queue.length);
      if (!this.configured) return emptyResult('disabled', this.queue.length);
      this.clearTimer();
      const expired = this.expireOldEntries();
      if (!this.queue.length) return emptyResult(expired ? 'sent' : 'empty', 0, expired);
      let accepted = 0;
      let dropped = expired;
      let retryScheduled = false;
      let batches = 0;
      while (batches < this.limits.maxBatchesPerFlush) {
        const entries = this.eligibleEntries(forceReady);
        if (!entries.length) break;
        const result = await this.sendBatch(entries);
        accepted += result.accepted;
        dropped += result.dropped;
        batches += 1;
        if (result.retryScheduled) {
          retryScheduled = true;
          break;
        }
        if (!this.queue.length) break;
      }
      const eligibleRemain = this.eligibleEntries(false).length > 0;
      if (eligibleRemain && batches >= this.limits.maxBatchesPerFlush) {
        this.diagnostic({ code: 'FLUSH_BATCH_LIMIT_REACHED', count: batches });
        this.scheduleFlush(0);
      } else if (!retryScheduled && this.queue.length) {
        const next = Math.min(...this.queue.map((entry) => Math.max(0, entry.nextAttemptAt - this.now())));
        this.scheduleFlush(Number.isFinite(next) ? next : this.limits.flushIntervalMs);
      }
      return {
        status: retryScheduled ? 'retry_scheduled' : accepted || dropped ? 'sent' : 'empty',
        accepted,
        dropped,
        retained: this.queue.length
      };
    } catch {
      this.diagnostic({ code: 'FLUSH_ISOLATED' });
      return emptyResult('retry_scheduled', this.queue.length);
    }
  }

  private flushInternal(forceReady: boolean) {
    if (this.flushPromise) return this.flushPromise;
    this.flushPromise = this.performFlush(forceReady).finally(() => { this.flushPromise = undefined; });
    return this.flushPromise;
  }

  flush(): Promise<FlushResult> {
    try { return this.flushInternal(false); }
    catch {
      this.diagnostic({ code: 'FLUSH_ISOLATED' });
      return Promise.resolve(emptyResult('retry_scheduled', this.queue.length));
    }
  }

  close(): Promise<FlushResult> {
    if (this.closePromise) return this.closePromise;
    if (this.closed) return Promise.resolve(emptyResult('closed', this.queue.length));
    this.closing = true;
    this.clearTimer();
    this.closePromise = (async () => {
      let result = emptyResult('empty', this.queue.length);
      try {
        result = await this.flushInternal(false);
        if (this.queue.length && result.status !== 'retry_scheduled') {
          result = combineFlushResults(result, await this.flushInternal(true));
        }
      } catch {
        this.diagnostic({ code: 'CLOSE_FLUSH_ISOLATED' });
        result = emptyResult('retry_scheduled', this.queue.length);
      } finally {
        this.closed = true;
        this.closing = false;
        this.clearTimer();
      }
      return { ...result, retained: this.queue.length };
    })();
    return this.closePromise;
  }

  status() {
    try {
      return Object.freeze({
        enabled: this.enabled,
        closed: this.closed,
        queued: this.queue.length,
        inFlight: Boolean(this.flushPromise)
      });
    } catch {
      return Object.freeze({ enabled: false, closed: this.closed, queued: 0, inFlight: false });
    }
  }
}

/**
 * Creates a server-only, in-memory Node SDK client. Invalid credentials or
 * configuration produce a disabled client instead of throwing into the host.
 */
export function createNodeJourneySdk(config: NodeJourneySdkConfig): NodeJourneySdk {
  try { return new NodeJourneyClient(config); }
  catch {
    return new NodeJourneyClient({
      serverSecret: '',
      endpoint: '',
      ...(config?.callbacks ? { callbacks: config.callbacks } : {}),
      ...(config?.runtime ? { runtime: config.runtime } : {})
    });
  }
}
