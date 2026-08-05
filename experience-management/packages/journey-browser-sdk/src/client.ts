import {
  JOURNEY_EVENT_PROTOCOL_VERSION,
  journeyEventLimits,
  parseJourneyPublicWriteKey,
  validateBatchResult,
  validateEventBatch,
  validateEventEnvelope,
  type BatchIngestResult,
  type ConsentSnapshot,
  type JourneyEventBatch,
  type JourneyEventCall,
  type JourneyEventContext,
  type JourneyEventEnvelopeBase,
  type JourneyEventEnvelope,
  type JsonObject
} from '@seemplify/journey-event-protocol';
import { createUuid } from './id.js';
import { automaticContext, sanitiseContext, sanitiseObject } from './privacy.js';
import type {
  BrowserFetch,
  BrowserJourneyRuntime,
  BrowserJourneySdk,
  BrowserJourneySdkConfig,
  ConsentInput,
  EnqueueResult,
  EventOptions,
  EventTargetLike,
  FlushResult,
  JourneyQueueStorage,
  QueueOverflowBehaviour,
  SdkDiagnostic,
  SdkOutcome
} from './types.js';

const SDK_NAME = '@seemplify/journey-browser-sdk';
const SDK_VERSION = '0.1.0';
const STORED_STATE_VERSION = 1;

interface QueueEntry {
  event: JourneyEventEnvelope;
  enqueuedAt: number;
  attempts: number;
  nextAttemptAt: number;
  purpose: 'analytics' | 'control';
  persistable: boolean;
  bytes: number;
}

interface StoredQueueEntry {
  event: JourneyEventEnvelope;
  enqueuedAt: number;
  attempts: number;
  nextAttemptAt: number;
  purpose: 'analytics' | 'control';
}

interface StoredState {
  version: 1;
  anonymousId?: string;
  entries: StoredQueueEntry[];
}

interface ResolvedRuntime {
  source: BrowserJourneyRuntime;
  fetch?: BrowserFetch;
  now: () => number;
  random: () => number;
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
  retryAttempts: number;
  retryBaseMs: number;
  retryMaxMs: number;
  retryJitter: number;
  requestTimeoutMs: number;
}

function clampInteger(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? Math.floor(value as number) : fallback));
}

function clampNumber(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? Number(value) : fallback));
}

function resolveLimits(config: BrowserJourneySdkConfig): ResolvedLimits {
  return {
    queueEvents: clampInteger(config.queue?.maxEvents, 1_000, 1, 10_000),
    queueBytes: clampInteger(config.queue?.maxBytes, 1024 * 1024, 1024, 10 * 1024 * 1024),
    queueAgeMs: clampInteger(config.queue?.maxAgeMs, 24 * 60 * 60 * 1_000, 1_000, 30 * 24 * 60 * 60 * 1_000),
    overflow: config.queue?.overflow === 'drop-newest' ? 'drop-newest' : 'drop-oldest',
    batchEvents: clampInteger(config.batch?.maxEvents, 20, 1, journeyEventLimits.batchEvents),
    batchBytes: clampInteger(config.batch?.maxBytes, 256 * 1024, 1024, journeyEventLimits.batchBytes),
    flushIntervalMs: clampInteger(config.batch?.flushIntervalMs, 10_000, 250, 10 * 60 * 1_000),
    retryAttempts: clampInteger(config.retry?.maxAttempts, 5, 1, 20),
    retryBaseMs: clampInteger(config.retry?.baseDelayMs, 1_000, 10, 60_000),
    retryMaxMs: clampInteger(config.retry?.maxDelayMs, 60_000, 100, 60 * 60 * 1_000),
    retryJitter: clampNumber(config.retry?.jitterRatio, 0.2, 0, 1),
    requestTimeoutMs: clampInteger(config.requestTimeoutMs, 10_000, 100, 120_000)
  };
}

function fallbackByteLength(value: string) {
  try {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).byteLength;
  } catch { /* Fall through to a conservative UTF-16 bound. */ }
  return value.length * 2;
}

function resolveRuntime(source: BrowserJourneyRuntime = {}): ResolvedRuntime {
  const resolvedSource: BrowserJourneyRuntime = { ...source };
  try {
    if (!resolvedSource.lifecycleTarget && typeof window !== 'undefined') {
      resolvedSource.lifecycleTarget = window as unknown as EventTargetLike;
    }
    if (!resolvedSource.document && typeof document !== 'undefined') {
      resolvedSource.document = document as unknown as NonNullable<BrowserJourneyRuntime['document']>;
    }
    if (!resolvedSource.navigator && typeof navigator !== 'undefined') {
      resolvedSource.navigator = navigator;
    }
    if (!resolvedSource.location && typeof location !== 'undefined') {
      resolvedSource.location = location;
    }
  } catch { /* Browser globals are optional for SSR and restricted realms. */ }
  let globalFetch: BrowserFetch | undefined;
  try {
    if (typeof globalThis.fetch === 'function') {
      globalFetch = ((url, init) => globalThis.fetch(url, init as RequestInit) as Promise<Response>) as BrowserFetch;
    }
  } catch { /* Browser globals are optional for SSR. */ }
  const setTimeoutValue = resolvedSource.setTimeout ?? ((callback: () => void, delayMs: number) => globalThis.setTimeout(callback, delayMs));
  const clearTimeoutValue = resolvedSource.clearTimeout ?? ((handle: unknown) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));
  let createAbortController = resolvedSource.createAbortController;
  if (!createAbortController) {
    try {
      if (typeof AbortController !== 'undefined') createAbortController = () => new AbortController();
    } catch { /* Timeouts remain best-effort in older browsers. */ }
  }
  let randomValue = resolvedSource.random;
  if (!randomValue) {
    try {
      if (typeof globalThis.crypto?.getRandomValues === 'function') {
        randomValue = () => {
          const value = new Uint32Array(1);
          globalThis.crypto.getRandomValues(value);
          return (value[0] ?? 0) / 0x1_0000_0000;
        };
      }
    } catch { /* A non-cryptographic fallback still preserves host availability. */ }
  }
  const fetchValue = resolvedSource.fetch ?? globalFetch;
  return {
    source: resolvedSource,
    ...(fetchValue ? { fetch: fetchValue } : {}),
    now: resolvedSource.now ?? Date.now,
    random: randomValue ?? Math.random,
    byteLength: resolvedSource.byteLength ?? fallbackByteLength,
    setTimeout: setTimeoutValue,
    clearTimeout: clearTimeoutValue,
    ...(createAbortController ? { createAbortController } : {})
  };
}

function resolveBatchEndpoint(raw: string) {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return undefined;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStoredEntry(value: unknown): value is StoredQueueEntry {
  return isRecord(value)
    && Number.isFinite(value.enqueuedAt)
    && Number.isInteger(value.attempts) && Number(value.attempts) >= 0
    && Number.isFinite(value.nextAttemptAt)
    && (value.purpose === 'analytics' || value.purpose === 'control')
    && validateEventEnvelope(value.event).ok;
}

function safeCallback(callback: (() => void) | undefined) {
  try { callback?.(); } catch { /* Host callbacks cannot break the SDK or app. */ }
}

function mergeProperties(name: string | undefined, properties: JsonObject | undefined) {
  if (!name) return properties;
  return { ...(properties ?? {}), name } satisfies JsonObject;
}

function retryAfterMs(value: string | null, now: number) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : 0;
}

class BrowserJourneyClient implements BrowserJourneySdk {
  readonly ready: Promise<void>;
  private readonly runtime: ResolvedRuntime;
  private readonly limits: ResolvedLimits;
  private readonly endpoint: string | undefined;
  private readonly storage: JourneyQueueStorage | undefined;
  private readonly storageKey: string;
  private readonly debugEnabled: boolean;
  private readonly configured: boolean;
  private queue: QueueEntry[] = [];
  private pendingConsent: QueueEntry[] = [];
  private consentState: ConsentSnapshot | undefined;
  private anonymousId: string | undefined;
  private userId: string | undefined;
  private accountId: string | undefined;
  private sessionId: string | undefined;
  private flushPromise: Promise<FlushResult> | undefined;
  private persistPromise: Promise<void> = Promise.resolve();
  private timer: unknown | undefined;
  private destroyed = false;
  private listeners: Array<{ target: EventTargetLike; type: string; listener: () => void }> = [];

  constructor(private readonly config: BrowserJourneySdkConfig) {
    this.runtime = resolveRuntime(config.runtime);
    this.limits = resolveLimits(config);
    this.endpoint = resolveBatchEndpoint(config.endpoint);
    this.storage = config.storage || undefined;
    this.storageKey = config.storageKey?.slice(0, 200) || 'seemplify.journey.queue.v1';
    const credential = parseJourneyPublicWriteKey(config.writeKey);
    const environmentMatches = !config.environment || config.environment === credential?.environment;
    this.debugEnabled = (config.environment ?? credential?.environment ?? 'production') !== 'production'
      && config.debug === true;
    this.configured = Boolean(credential && environmentMatches);
    this.consentState = config.consent;
    this.ready = this.initialise().catch(() => { this.diagnostic({ code: 'INITIALISATION_FAILED' }); });
  }

  get enabled() {
    return !this.destroyed && this.configured && Boolean(this.endpoint && this.runtime.fetch);
  }

  status() {
    return Object.freeze({
      enabled: this.enabled,
      queued: this.queue.length,
      buffered: this.pendingConsent.length,
      online: this.isOnline()
    });
  }

  private diagnostic(value: SdkDiagnostic) {
    if (!this.debugEnabled) return;
    safeCallback(this.config.callbacks?.onDiagnostic ? () => this.config.callbacks?.onDiagnostic?.(Object.freeze({ ...value })) : undefined);
  }

  private outcome(value: SdkOutcome) {
    safeCallback(this.config.callbacks?.onOutcome ? () => this.config.callbacks?.onOutcome?.(Object.freeze({ ...value })) : undefined);
  }

  private async initialise() {
    if (!this.enabled) {
      this.diagnostic({ code: 'SDK_DISABLED_INVALID_CONFIG' });
      return;
    }
    if (this.storage) await this.loadStoredState();
    if (this.analyticsConsent() === 'denied') await this.purgeForDeniedConsent();
    this.bindLifecycle();
    this.scheduleFlush(this.limits.flushIntervalMs);
  }

  private analyticsConsent() {
    return this.consentState?.analytics ?? 'unknown';
  }

  private isOnline() {
    return this.runtime.source.navigator?.onLine !== false;
  }

  private bind(target: EventTargetLike | undefined, type: string, listener: () => void) {
    if (!target) return;
    try {
      target.addEventListener(type, listener);
      this.listeners.push({ target, type, listener });
    } catch { this.diagnostic({ code: 'LIFECYCLE_BIND_FAILED' }); }
  }

  private bindLifecycle() {
    const lifecycle = this.runtime.source.lifecycleTarget;
    this.bind(lifecycle, 'online', () => { void this.flushInternal(false); });
    this.bind(lifecycle, 'pagehide', () => { void this.flushInternal(true); });
    this.bind(this.runtime.source.document, 'visibilitychange', () => {
      if (this.runtime.source.document?.visibilityState === 'hidden') void this.flushInternal(true);
    });
  }

  private scheduleFlush(delayMs: number) {
    if (this.destroyed) return;
    if (this.timer !== undefined) this.runtime.clearTimeout(this.timer);
    this.timer = this.runtime.setTimeout(() => {
      this.timer = undefined;
      void this.flushInternal(false).finally(() => this.scheduleFlush(this.limits.flushIntervalMs));
    }, Math.max(0, delayMs));
  }

  private ensureAnonymousId() {
    this.anonymousId ??= `anon_${createUuid(this.runtime.random)}`;
    return this.anonymousId;
  }

  private eventBytes(event: JourneyEventEnvelope) {
    const encoded = safeJson(event);
    return encoded ? this.runtime.byteLength(encoded) : Number.POSITIVE_INFINITY;
  }

  private async loadStoredState() {
    if (!this.storage) return;
    let raw: string | null;
    try { raw = await this.storage.getItem(this.storageKey); }
    catch {
      this.diagnostic({ code: 'STORAGE_READ_FAILED' });
      return;
    }
    if (!raw) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed) || parsed.version !== STORED_STATE_VERSION || !Array.isArray(parsed.entries)
        || !parsed.entries.every(isStoredEntry)
        || (parsed.anonymousId !== undefined && typeof parsed.anonymousId !== 'string')) {
        throw new Error('invalid stored state');
      }
      const state = parsed as unknown as StoredState;
      if (this.analyticsConsent() === 'granted' && state.anonymousId) this.anonymousId = state.anonymousId;
      const now = this.runtime.now();
      const seen = new Set<string>();
      for (const stored of state.entries) {
        if (now - stored.enqueuedAt > this.limits.queueAgeMs) continue;
        if (seen.has(stored.event.eventId)) continue;
        const bytes = this.eventBytes(stored.event);
        if (!Number.isFinite(bytes) || bytes > this.limits.queueBytes) continue;
        seen.add(stored.event.eventId);
        this.queue.push({ ...stored, persistable: true, bytes });
      }
      this.enforceBounds('STORAGE_LOAD_OVERFLOW');
    } catch {
      this.queue = [];
      this.anonymousId = undefined;
      try { await this.storage.removeItem(this.storageKey); } catch { /* Corrupt storage is already isolated. */ }
      this.diagnostic({ code: 'STORAGE_CORRUPT' });
    }
  }

  private persist() {
    if (!this.storage) return this.persistPromise;
    this.persistPromise = this.persistPromise.then(async () => {
      try {
        if (this.analyticsConsent() === 'denied') {
          await this.storage?.removeItem(this.storageKey);
          return;
        }
        const entries = this.queue.filter((entry) => entry.persistable).map<StoredQueueEntry>((entry) => ({
          event: entry.event,
          enqueuedAt: entry.enqueuedAt,
          attempts: entry.attempts,
          nextAttemptAt: entry.nextAttemptAt,
          purpose: entry.purpose
        }));
        if (!entries.length && !(this.analyticsConsent() === 'granted' && this.anonymousId)) {
          await this.storage?.removeItem(this.storageKey);
          return;
        }
        const state: StoredState = {
          version: STORED_STATE_VERSION,
          ...(this.analyticsConsent() === 'granted' && this.anonymousId ? { anonymousId: this.anonymousId } : {}),
          entries
        };
        await this.storage?.setItem(this.storageKey, JSON.stringify(state));
      } catch { this.diagnostic({ code: 'STORAGE_WRITE_FAILED' }); }
    });
    return this.persistPromise;
  }

  private expireOldEntries() {
    const cutoff = this.runtime.now() - this.limits.queueAgeMs;
    let dropped = 0;
    this.queue = this.queue.filter((entry) => {
      if (entry.enqueuedAt >= cutoff) return true;
      dropped += 1;
      this.outcome({ kind: 'dropped', eventId: entry.event.eventId, code: 'QUEUE_EXPIRED' });
      return false;
    });
    this.pendingConsent = this.pendingConsent.filter((entry) => {
      if (entry.enqueuedAt >= cutoff) return true;
      dropped += 1;
      this.outcome({ kind: 'dropped', eventId: entry.event.eventId, code: 'CONSENT_BUFFER_EXPIRED' });
      return false;
    });
    return dropped;
  }

  private queueBytes() {
    return this.queue.reduce((total, entry) => total + entry.bytes, 0);
  }

  private pendingBytes() {
    return this.pendingConsent.reduce((total, entry) => total + entry.bytes, 0);
  }

  private enforceBounds(code: string) {
    let dropped = 0;
    while (this.queue.length > this.limits.queueEvents || this.queueBytes() > this.limits.queueBytes) {
      const entry = this.limits.overflow === 'drop-newest' ? this.queue.pop() : this.queue.shift();
      if (!entry) break;
      dropped += 1;
      this.outcome({ kind: 'dropped', eventId: entry.event.eventId, code });
    }
    return dropped;
  }

  private baseEnvelope(call: JourneyEventCall, options: EventOptions | undefined): JourneyEventEnvelopeBase {
    const eventId = options?.eventId || createUuid(this.runtime.random);
    const occurredAt = options?.occurredAt || isoTime(this.runtime.now());
    const auto = automaticContext(this.config.automaticContext, this.runtime.source, this.config.privacy);
    const context = sanitiseContext(options?.context, auto, this.config.privacy);
    const libraryContext: JourneyEventContext = {
      ...(context ?? {}),
      library: { name: SDK_NAME, version: SDK_VERSION }
    };
    const anonymousId = options?.anonymousId || this.anonymousId || this.ensureAnonymousId();
    const userId = options?.userId || this.userId;
    const accountId = options?.accountId || this.accountId;
    const sessionId = options?.sessionId || this.sessionId;
    const base: JourneyEventEnvelopeBase = {
      protocolVersion: JOURNEY_EVENT_PROTOCOL_VERSION,
      eventId,
      call,
      occurredAt,
      anonymousId,
      ...(userId ? { userId } : {}),
      ...(accountId ? { accountId } : {}),
      ...(sessionId ? { sessionId } : {}),
      context: libraryContext,
      ...(this.consentState ? { consent: this.consentState } : {})
    };
    return base;
  }

  private result(status: EnqueueResult['status'], code: string, eventId?: string): EnqueueResult {
    return { status, code, ...(eventId ? { eventId } : {}) };
  }

  private async enqueue(event: JourneyEventEnvelope, purpose: QueueEntry['purpose'], persistable: boolean) {
    const checked = validateEventEnvelope(event);
    if (!checked.ok) {
      this.outcome({ kind: 'invalid', eventId: event.eventId, code: 'PROTOCOL_VALIDATION_FAILED' });
      return this.result('invalid', 'PROTOCOL_VALIDATION_FAILED', event.eventId);
    }
    const bytes = this.eventBytes(checked.value);
    if (!Number.isFinite(bytes) || bytes > this.limits.queueBytes) {
      this.outcome({ kind: 'dropped', eventId: event.eventId, code: 'EVENT_EXCEEDS_QUEUE_BYTES' });
      return this.result('dropped', 'EVENT_EXCEEDS_QUEUE_BYTES', event.eventId);
    }
    const existing = [...this.queue, ...this.pendingConsent].find((entry) => entry.event.eventId === event.eventId);
    if (existing) {
      if (safeJson(existing.event) !== safeJson(checked.value)) {
        this.outcome({ kind: 'invalid', eventId: event.eventId, code: 'EVENT_ID_CONFLICT' });
        return this.result('invalid', 'EVENT_ID_CONFLICT', event.eventId);
      }
      const status = this.pendingConsent.includes(existing) ? 'buffered' : 'queued';
      return this.result(status, 'ALREADY_QUEUED', event.eventId);
    }
    const entry: QueueEntry = {
      event: checked.value,
      enqueuedAt: this.runtime.now(),
      attempts: 0,
      nextAttemptAt: 0,
      purpose,
      persistable,
      bytes
    };
    if (purpose === 'analytics' && this.analyticsConsent() !== 'granted') {
      if (this.analyticsConsent() === 'unknown' && this.config.beforeConsent === 'buffer-memory') {
        if (this.limits.overflow === 'drop-newest'
          && (this.pendingConsent.length >= this.limits.queueEvents
            || this.pendingBytes() + entry.bytes > this.limits.queueBytes)) {
          this.outcome({ kind: 'dropped', eventId: event.eventId, code: 'CONSENT_BUFFER_OVERFLOW' });
          return this.result('dropped', 'CONSENT_BUFFER_OVERFLOW', event.eventId);
        }
        this.pendingConsent.push(entry);
        while (this.pendingConsent.length > this.limits.queueEvents || this.pendingBytes() > this.limits.queueBytes) {
          const removed = this.limits.overflow === 'drop-newest' ? this.pendingConsent.pop() : this.pendingConsent.shift();
          if (removed) this.outcome({ kind: 'dropped', eventId: removed.event.eventId, code: 'CONSENT_BUFFER_OVERFLOW' });
        }
        this.outcome({ kind: 'buffered', eventId: event.eventId, code: 'WAITING_FOR_CONSENT' });
        return this.result('buffered', 'WAITING_FOR_CONSENT', event.eventId);
      }
      this.outcome({ kind: 'dropped', eventId: event.eventId, code: 'ANALYTICS_CONSENT_NOT_GRANTED' });
      return this.result('dropped', 'ANALYTICS_CONSENT_NOT_GRANTED', event.eventId);
    }
    if (this.limits.overflow === 'drop-newest'
      && (this.queue.length >= this.limits.queueEvents || this.queueBytes() + bytes > this.limits.queueBytes)) {
      this.outcome({ kind: 'dropped', eventId: event.eventId, code: 'QUEUE_OVERFLOW_NEWEST' });
      return this.result('dropped', 'QUEUE_OVERFLOW_NEWEST', event.eventId);
    }
    this.queue.push(entry);
    this.expireOldEntries();
    this.enforceBounds('QUEUE_OVERFLOW_OLDEST');
    await this.persist();
    this.outcome({ kind: 'queued', eventId: event.eventId, code: 'QUEUED' });
    if (this.queue.length >= this.limits.batchEvents) this.scheduleFlush(0);
    return this.result('queued', 'QUEUED', event.eventId);
  }

  private async invoke(builder: () => JourneyEventEnvelope, after?: (result: EnqueueResult) => void) {
    try {
      await this.ready;
      if (!this.enabled) return this.result('disabled', 'SDK_DISABLED');
      const result = await this.enqueue(builder(), 'analytics', true);
      safeCallback(after ? () => after(result) : undefined);
      return result;
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
        eventVersion: 1,
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
    }, (result) => { if (result.status === 'queued') this.userId = userId; });
  }

  alias(userId: string, anonymousId?: string, options?: EventOptions) {
    return this.invoke(() => {
      const prior = anonymousId || options?.anonymousId || this.ensureAnonymousId();
      return {
        ...this.baseEnvelope('alias', { ...(options ?? {}), anonymousId: prior, userId }),
        call: 'alias',
        anonymousId: prior,
        userId
      };
    }, (result) => { if (result.status === 'queued') this.userId = userId; });
  }

  group(accountId: string, traits?: JsonObject, options?: EventOptions) {
    return this.invoke(() => {
      const safeTraits = sanitiseObject(traits, this.config.privacy);
      const base = this.baseEnvelope('group', { ...(options ?? {}), accountId });
      return {
        ...base,
        call: 'group',
        accountId,
        anonymousId: base.anonymousId || this.ensureAnonymousId(),
        ...(safeTraits ? { traits: safeTraits } : {})
      };
    }, (result) => { if (result.status === 'queued') this.accountId = accountId; });
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

  async consent(input: ConsentInput, options?: EventOptions): Promise<EnqueueResult> {
    try {
      await this.ready;
      if (!this.enabled) return this.result('disabled', 'SDK_DISABLED');
      const snapshot: ConsentSnapshot = {
        ...(input.analytics ? { analytics: input.analytics } : {}),
        ...(input.personalisation ? { personalisation: input.personalisation } : {}),
        ...(input.researchContact ? { researchContact: input.researchContact } : {}),
        ...(input.marketing ? { marketing: input.marketing } : {}),
        source: input.source,
        updatedAt: input.updatedAt || isoTime(this.runtime.now())
      };
      if (!snapshot.analytics && !snapshot.personalisation && !snapshot.researchContact && !snapshot.marketing) {
        return this.result('invalid', 'CONSENT_PURPOSE_REQUIRED');
      }
      const previous = this.consentState;
      const envelope = {
        ...this.baseEnvelope('consent', options),
        call: 'consent' as const,
        consent: snapshot
      };
      const envelopeCheck = validateEventEnvelope(envelope);
      if (!envelopeCheck.ok) {
        this.outcome({ kind: 'invalid', eventId: envelope.eventId, code: 'PROTOCOL_VALIDATION_FAILED' });
        return this.result('invalid', 'PROTOCOL_VALIDATION_FAILED', envelope.eventId);
      }
      this.consentState = snapshot;
      if (snapshot.analytics === 'denied') {
        await this.purgeForDeniedConsent();
        const result = await this.enqueue(envelopeCheck.value, 'control', false);
        this.userId = undefined;
        this.accountId = undefined;
        this.sessionId = undefined;
        this.anonymousId = undefined;
        this.scheduleFlush(0);
        return result;
      }
      const result = await this.enqueue(envelopeCheck.value, 'control', snapshot.analytics === 'granted');
      if (snapshot.analytics === 'granted') {
        this.ensureAnonymousId();
        const buffered = this.pendingConsent;
        this.pendingConsent = [];
        for (const entry of buffered) {
          entry.persistable = true;
          entry.event = { ...entry.event, consent: snapshot } as JourneyEventEnvelope;
          entry.bytes = this.eventBytes(entry.event);
          this.queue.push(entry);
        }
        this.enforceBounds('CONSENT_PROMOTION_OVERFLOW');
        await this.persist();
      } else if (previous?.analytics === 'granted') {
        await this.persist();
      }
      return result;
    } catch {
      this.diagnostic({ code: 'CONSENT_CALL_ISOLATED' });
      return this.result('invalid', 'SDK_INTERNAL_ERROR');
    }
  }

  private async purgeForDeniedConsent() {
    const removed = this.queue.filter((entry) => entry.purpose === 'analytics').length + this.pendingConsent.length;
    this.queue = this.queue.filter((entry) => entry.purpose !== 'analytics');
    this.pendingConsent = [];
    if (removed) this.outcome({ kind: 'dropped', code: 'CONSENT_WITHDRAWN_PURGE', count: removed });
    await this.persist();
  }

  flush() {
    return this.flushInternal(false);
  }

  private flushInternal(keepalive: boolean): Promise<FlushResult> {
    if (this.flushPromise) return this.flushPromise;
    this.flushPromise = this.performFlush(keepalive).finally(() => { this.flushPromise = undefined; });
    return this.flushPromise;
  }

  private emptyFlush(status: FlushResult['status'], dropped = 0): FlushResult {
    return { status, accepted: 0, dropped, retained: this.queue.length };
  }

  private eligibleEntries(now: number, maximumBytes = this.limits.batchBytes) {
    const result: QueueEntry[] = [];
    let bytes = 200;
    for (const entry of this.queue) {
      if (entry.nextAttemptAt > now) continue;
      if (entry.purpose === 'analytics' && this.analyticsConsent() !== 'granted') continue;
      if (result.length >= this.limits.batchEvents) break;
      if (result.length && bytes + entry.bytes > maximumBytes) break;
      if (!result.length && bytes + entry.bytes > maximumBytes) continue;
      result.push(entry);
      bytes += entry.bytes;
    }
    return result;
  }

  private async performFlush(keepalive: boolean): Promise<FlushResult> {
    try {
      await this.ready;
      if (!this.enabled || !this.runtime.fetch || !this.endpoint) return this.emptyFlush('disabled');
      const expired = this.expireOldEntries();
      if (expired) await this.persist();
      if (!this.isOnline()) return this.emptyFlush('offline', expired);
      const now = this.runtime.now();
      let entries = this.eligibleEntries(now, keepalive ? Math.min(this.limits.batchBytes, 60_000) : this.limits.batchBytes);
      if (!entries.length) {
        const waiting = this.queue.some((entry) => entry.nextAttemptAt > now);
        return this.emptyFlush(waiting ? 'retry_scheduled' : 'empty', expired);
      }
      const sentAt = isoTime(now);
      const batchId = createUuid(this.runtime.random);
      let batch: JourneyEventBatch;
      let checked: ReturnType<typeof validateEventBatch>;
      let body: string | undefined;
      while (true) {
        batch = {
          protocolVersion: JOURNEY_EVENT_PROTOCOL_VERSION,
          batchId,
          sentAt,
          events: entries.map((entry) => ({ ...entry.event, sentAt } as JourneyEventEnvelope))
        };
        checked = validateEventBatch(batch);
        body = safeJson(batch);
        const transportLimit = keepalive ? Math.min(this.limits.batchBytes, 60_000) : this.limits.batchBytes;
        if (checked.ok && body && this.runtime.byteLength(body) <= transportLimit) break;
        if (entries.length > 1) {
          entries = entries.slice(0, -1);
          continue;
        }
        this.removeEntry(entries[0]!, 'rejected', 'LOCAL_BATCH_VALIDATION_FAILED');
        await this.persist();
        return this.emptyFlush('sent', 1 + expired);
      }
      const controller = this.runtime.createAbortController?.();
      let timeout: unknown;
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeout = this.runtime.setTimeout(() => {
          try { controller?.abort(); } catch { /* Non-fatal. */ }
          reject(new Error('SDK_REQUEST_TIMEOUT'));
        }, this.limits.requestTimeoutMs);
      });
      let response;
      try {
        const request = this.runtime.fetch(this.endpoint, {
          method: 'POST',
          headers: Object.freeze({
            authorization: `Bearer ${this.config.writeKey}`,
            'content-type': 'application/json'
          }),
          body,
          ...(controller ? { signal: controller.signal } : {}),
          ...(keepalive ? { keepalive: true } : {}),
          credentials: 'omit',
          cache: 'no-store'
        });
        response = await Promise.race([request, timeoutPromise]);
      } catch {
        this.runtime.clearTimeout(timeout);
        const dropped = await this.retryEntries(entries, 0, 0);
        this.diagnostic({ code: 'TRANSPORT_UNAVAILABLE' });
        return { status: dropped === entries.length ? 'sent' : 'retry_scheduled', accepted: 0, dropped: dropped + expired, retained: this.queue.length };
      }
      this.runtime.clearTimeout(timeout);
      const retryAfter = retryAfterMs(response.headers.get('retry-after'), this.runtime.now());
      if ([408, 425, 429].includes(response.status) || response.status >= 500) {
        const dropped = await this.retryEntries(entries, response.status, retryAfter);
        return { status: dropped === entries.length ? 'sent' : 'retry_scheduled', accepted: 0, dropped: dropped + expired, retained: this.queue.length };
      }
      if (!response.ok && response.status !== 207) {
        for (const entry of entries) this.removeEntry(entry, 'rejected', `HTTP_${response.status}`);
        await this.persist();
        return { status: 'sent', accepted: 0, dropped: entries.length + expired, retained: this.queue.length };
      }
      let parsed: unknown;
      try { parsed = await response.json(); }
      catch {
        const dropped = await this.retryEntries(entries, response.status, retryAfter);
        return { status: dropped === entries.length ? 'sent' : 'retry_scheduled', accepted: 0, dropped: dropped + expired, retained: this.queue.length };
      }
      const result = validateBatchResult(parsed);
      if (!result.ok || result.value.batchId !== batch.batchId) {
        const dropped = await this.retryEntries(entries, response.status, retryAfter);
        this.diagnostic({ code: 'INVALID_INGEST_RESPONSE', status: response.status });
        return { status: dropped === entries.length ? 'sent' : 'retry_scheduled', accepted: 0, dropped: dropped + expired, retained: this.queue.length };
      }
      return this.applyBatchResult(entries, result.value, expired);
    } catch {
      this.diagnostic({ code: 'FLUSH_ISOLATED' });
      return this.emptyFlush('retry_scheduled');
    }
  }

  private removeEntry(entry: QueueEntry, kind: 'accepted' | 'rejected', code: string) {
    const index = this.queue.indexOf(entry);
    if (index >= 0) this.queue.splice(index, 1);
    this.outcome({ kind, eventId: entry.event.eventId, code });
  }

  private async applyBatchResult(entries: QueueEntry[], result: BatchIngestResult, alreadyDropped: number): Promise<FlushResult> {
    let accepted = 0;
    let dropped = alreadyDropped;
    const retry: QueueEntry[] = [];
    const byId = new Map(result.results.map((entry) => [entry.eventId, entry]));
    for (const entry of entries) {
      const eventResult = byId.get(entry.event.eventId);
      if (!eventResult) {
        retry.push(entry);
      } else if (eventResult.status === 'accepted' || eventResult.status === 'duplicate' || eventResult.status === 'quarantined') {
        this.removeEntry(entry, 'accepted', eventResult.status === 'duplicate' ? 'DUPLICATE_ACCEPTED' : eventResult.status.toUpperCase());
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
    if (!retry.length) await this.persist();
    return {
      status: retry.length > retryDropped ? 'retry_scheduled' : 'sent',
      accepted,
      dropped,
      retained: this.queue.length
    };
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
      const exponential = Math.min(this.limits.retryMaxMs, this.limits.retryBaseMs * 2 ** Math.max(0, entry.attempts - 1));
      const jitter = 1 - this.limits.retryJitter + this.runtime.random() * 2 * this.limits.retryJitter;
      const delay = Math.min(this.limits.retryMaxMs, Math.max(serverDelayMs, Math.round(exponential * jitter)));
      entry.nextAttemptAt = this.runtime.now() + delay;
      shortestDelay = Math.min(shortestDelay, delay);
      this.outcome({ kind: 'retried', eventId: entry.event.eventId, code: 'RETRY_SCHEDULED' });
      this.diagnostic({ code: 'RETRY_SCHEDULED', delayMs: delay, ...(status ? { status } : {}) });
    }
    await this.persist();
    if (entries.length > dropped) this.scheduleFlush(shortestDelay);
    return dropped;
  }

  async reset() {
    try {
      await this.ready;
      this.queue = [];
      this.pendingConsent = [];
      this.anonymousId = undefined;
      this.userId = undefined;
      this.accountId = undefined;
      this.sessionId = undefined;
      this.consentState = undefined;
      if (this.storage) await this.storage.removeItem(this.storageKey);
      this.outcome({ kind: 'dropped', code: 'RESET_PURGE' });
    } catch { this.diagnostic({ code: 'RESET_ISOLATED' }); }
  }

  async destroy() {
    if (this.destroyed) return;
    try { await this.flushInternal(true); } catch { /* Explicitly failure-isolated. */ }
    this.destroyed = true;
    if (this.timer !== undefined) this.runtime.clearTimeout(this.timer);
    this.timer = undefined;
    for (const { target, type, listener } of this.listeners) {
      try { target.removeEventListener(type, listener); } catch { /* Non-fatal cleanup. */ }
    }
    this.listeners = [];
  }
}

/**
 * Creates a browser-safe SDK client. Initialisation is asynchronous and starts
 * without blocking the host application; await `client.ready` only when a test
 * or integration needs storage hydration to have completed.
 */
export function createBrowserJourneySdk(config: BrowserJourneySdkConfig): BrowserJourneySdk {
  return new BrowserJourneyClient(config);
}
