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
  type JourneyEventEnvelope,
  type JourneyEventEnvelopeBase,
  type JsonObject
} from '@seemplify/journey-event-protocol';
import { createUuid } from './id.js';
import { automaticContext, sanitiseContext, sanitiseObject } from './privacy.js';
import type {
  EnqueueResult,
  EventOptions,
  FlushResult,
  MobileAbortController,
  MobileAppState,
  MobileFetch,
  MobileSdkDiagnostic,
  MobileSdkOutcome,
  QueueOverflowBehaviour,
  ReactNativeJourneyRuntime,
  ReactNativeJourneySdk,
  ReactNativeJourneySdkConfig,
  SecureJourneyStorage,
  ConsentInput
} from './types.js';

const SDK_NAME = '@seemplify/journey-react-native';
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
  protocolVersion: typeof JOURNEY_EVENT_PROTOCOL_VERSION;
  anonymousId?: string;
  entries: StoredQueueEntry[];
}

interface ResolvedRuntime {
  source: ReactNativeJourneyRuntime;
  fetch?: MobileFetch;
  now: () => number;
  random: () => number;
  byteLength: (value: string) => number;
  setTimeout?: (callback: () => void, delayMs: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  createAbortController?: () => MobileAbortController;
}

interface ResolvedLimits {
  queueEvents: number;
  queueBytes: number;
  queueAgeMs: number;
  overflow: QueueOverflowBehaviour;
  batchEvents: number;
  batchBytes: number;
  retryAttempts: number;
  retryBaseMs: number;
  retryMaxMs: number;
  retryJitter: number;
  requestTimeoutMs: number;
  flushIntervalMs: number;
  flushOnBackground: boolean;
  flushOnForeground: boolean;
  flushOnNetworkReconnect: boolean;
  backgroundBatchBytes: number;
  minimumBatteryLevel: number;
  pauseInLowPowerMode: boolean;
}

function clampInteger(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? Math.floor(value as number) : fallback));
}

function clampNumber(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? Number(value) : fallback));
}

function resolveLimits(config: ReactNativeJourneySdkConfig): ResolvedLimits {
  return {
    queueEvents: clampInteger(config.queue?.maxEvents, 2_000, 1, 20_000),
    queueBytes: clampInteger(config.queue?.maxBytes, 2 * 1024 * 1024, 1024, 20 * 1024 * 1024),
    queueAgeMs: clampInteger(config.queue?.maxAgeMs, 24 * 60 * 60 * 1_000, 1_000, 30 * 24 * 60 * 60 * 1_000),
    overflow: config.queue?.overflow === 'drop-newest' ? 'drop-newest' : 'drop-oldest',
    batchEvents: clampInteger(config.batch?.maxEvents, 50, 1, journeyEventLimits.batchEvents),
    batchBytes: clampInteger(config.batch?.maxBytes, 256 * 1024, 1024, journeyEventLimits.batchBytes),
    retryAttempts: clampInteger(config.retry?.maxAttempts, 5, 1, 20),
    retryBaseMs: clampInteger(config.retry?.baseDelayMs, 1_000, 10, 60_000),
    retryMaxMs: clampInteger(config.retry?.maxDelayMs, 60_000, 100, 60 * 60 * 1_000),
    retryJitter: clampNumber(config.retry?.jitterRatio, 0.2, 0, 1),
    requestTimeoutMs: clampInteger(config.requestTimeoutMs, 10_000, 100, 120_000),
    flushIntervalMs: clampInteger(config.delivery?.flushIntervalMs, 30_000, 1_000, 30 * 60 * 1_000),
    flushOnBackground: config.delivery?.flushOnBackground !== false,
    flushOnForeground: config.delivery?.flushOnForeground !== false,
    flushOnNetworkReconnect: config.delivery?.flushOnNetworkReconnect !== false,
    backgroundBatchBytes: clampInteger(config.delivery?.backgroundBatchBytes, 60_000, 1024, journeyEventLimits.batchBytes),
    minimumBatteryLevel: clampNumber(config.delivery?.minimumBatteryLevel, 0.15, 0, 1),
    pauseInLowPowerMode: config.delivery?.pauseAutomaticFlushInLowPowerMode !== false
  };
}

function fallbackByteLength(value: string) {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length
      && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

function resolveRuntime(source: ReactNativeJourneyRuntime = {}): ResolvedRuntime {
  const host = globalThis as unknown as {
    fetch?: MobileFetch;
    setTimeout?: (callback: () => void, delayMs: number) => unknown;
    clearTimeout?: (handle: unknown) => void;
    AbortController?: new () => MobileAbortController;
  };
  let globalFetch: MobileFetch | undefined;
  let globalSetTimeout: ResolvedRuntime['setTimeout'];
  let globalClearTimeout: ResolvedRuntime['clearTimeout'];
  let globalAbort: ResolvedRuntime['createAbortController'];
  try { if (typeof host.fetch === 'function') globalFetch = host.fetch.bind(globalThis); } catch { /* Optional. */ }
  try { if (typeof host.setTimeout === 'function') globalSetTimeout = host.setTimeout.bind(globalThis); } catch { /* Optional. */ }
  try { if (typeof host.clearTimeout === 'function') globalClearTimeout = host.clearTimeout.bind(globalThis); } catch { /* Optional. */ }
  try {
    if (typeof host.AbortController === 'function') {
      const AbortControllerValue = host.AbortController;
      globalAbort = () => new AbortControllerValue();
    }
  } catch { /* Optional. */ }
  const fetchValue = source.fetch ?? globalFetch;
  const setTimeoutValue = source.setTimeout ?? globalSetTimeout;
  const clearTimeoutValue = source.clearTimeout ?? globalClearTimeout;
  const abortValue = source.createAbortController ?? globalAbort;
  return {
    source,
    ...(fetchValue ? { fetch: fetchValue } : {}),
    now: source.now ?? Date.now,
    random: source.random ?? Math.random,
    byteLength: source.byteLength ?? fallbackByteLength,
    ...(setTimeoutValue ? { setTimeout: setTimeoutValue } : {}),
    ...(clearTimeoutValue ? { clearTimeout: clearTimeoutValue } : {}),
    ...(abortValue ? { createAbortController: abortValue } : {})
  };
}

function resolveBatchEndpoint(raw: string) {
  if (typeof raw !== 'string' || raw.length > 2_048 || /[?#\r\n]/u.test(raw)) return undefined;
  const match = /^(https?):\/\/([^/]+)(\/.*)?$/iu.exec(raw);
  if (!match || match[2]?.includes('@')) return undefined;
  const authority = match[2] ?? '';
  const host = authority.startsWith('[')
    ? authority.slice(0, authority.indexOf(']') + 1)
    : authority.split(':', 1)[0] ?? '';
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(host.toLocaleLowerCase('en-US'));
  if (match[1]?.toLocaleLowerCase('en-US') !== 'https' && !loopback) return undefined;
  const path = (match[3] ?? '').replace(/\/+$/u, '');
  const batchPath = path.endsWith('/v1/batch') ? path : `${path}/v1/batch`;
  return `${match[1]?.toLocaleLowerCase('en-US')}://${authority}${batchPath.startsWith('/') ? batchPath : `/${batchPath}`}`;
}

function validSecureStorage(value: SecureJourneyStorage | false | undefined): value is SecureJourneyStorage {
  try {
    return Boolean(value
      && value.security?.encryptedAtRest === true
      && value.security?.atomicCommit === true
      && typeof value.read === 'function'
      && typeof value.commit === 'function'
      && typeof value.remove === 'function');
  } catch {
    return false;
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
  try { callback?.(); } catch { /* Host callbacks never break the app. */ }
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

class ReactNativeJourneyClient implements ReactNativeJourneySdk {
  readonly ready: Promise<void>;
  private readonly runtime: ResolvedRuntime;
  private readonly limits: ResolvedLimits;
  private readonly endpoint: string | undefined;
  private readonly storage: SecureJourneyStorage | undefined;
  private readonly storageWasRequested: boolean;
  private readonly storageKey: string;
  private readonly configured: boolean;
  private readonly debugEnabled: boolean;
  private queue: QueueEntry[] = [];
  private pendingConsent: QueueEntry[] = [];
  private consentState: ConsentSnapshot | undefined;
  private anonymousId: string | undefined;
  private persistedAnonymousId: string | undefined;
  private userId: string | undefined;
  private accountId: string | undefined;
  private sessionId: string | undefined;
  private storageHealthy = true;
  private storageSerial: Promise<void> = Promise.resolve();
  private flushPromise: Promise<FlushResult> | undefined;
  private timer: unknown | undefined;
  private appState: MobileAppState = 'active';
  private online = true;
  private destroyed = false;
  private unsubscribers: Array<() => void> = [];

  constructor(private readonly config: ReactNativeJourneySdkConfig) {
    this.runtime = resolveRuntime(config.runtime);
    this.limits = resolveLimits(config);
    this.endpoint = resolveBatchEndpoint(config.endpoint);
    this.storageWasRequested = config.storage !== undefined && config.storage !== false;
    this.storage = validSecureStorage(config.storage) ? config.storage : undefined;
    this.storageHealthy = !this.storageWasRequested || Boolean(this.storage);
    this.storageKey = config.storageKey?.slice(0, 200) || 'seemplify.journey.react-native.queue.v1';
    const credential = parseJourneyPublicWriteKey(config.writeKey);
    const environmentMatches = !config.environment || config.environment === credential?.environment;
    this.debugEnabled = (config.environment ?? credential?.environment ?? 'production') !== 'production'
      && config.debug === true;
    this.consentState = config.consent;
    this.configured = Boolean(
      this.endpoint
      && this.runtime.fetch
      && this.runtime.setTimeout
      && this.runtime.clearTimeout
      && credential
      && environmentMatches
    );
    if (!this.endpoint) this.diagnostic({ code: 'ENDPOINT_INVALID' });
    if (!credential) this.diagnostic({ code: 'PUBLIC_WRITE_KEY_INVALID' });
    if (credential && !environmentMatches) this.diagnostic({ code: 'CREDENTIAL_ENVIRONMENT_MISMATCH' });
    if (!this.runtime.fetch) this.diagnostic({ code: 'TRANSPORT_UNAVAILABLE' });
    if (!this.runtime.setTimeout || !this.runtime.clearTimeout) this.diagnostic({ code: 'TIMER_UNAVAILABLE' });
    if (this.storageWasRequested && !this.storage) this.diagnostic({ code: 'SECURE_STORAGE_CONTRACT_INVALID' });
    this.ready = this.initialise().catch(() => {
      this.failSecureStorage('INITIALISATION_FAILED');
    });
  }

  get enabled() {
    return !this.destroyed && this.configured && this.storageHealthy;
  }

  status() {
    return Object.freeze({
      enabled: this.enabled,
      queued: this.queue.length,
      buffered: this.pendingConsent.length,
      online: this.online,
      appState: this.appState,
      persistence: this.storageWasRequested
        ? this.storageHealthy ? 'secure' as const : 'unavailable' as const
        : 'memory' as const
    });
  }

  private diagnostic(value: MobileSdkDiagnostic) {
    if (!this.debugEnabled) return;
    safeCallback(this.config.callbacks?.onDiagnostic
      ? () => this.config.callbacks?.onDiagnostic?.(Object.freeze({ ...value })) : undefined);
  }

  private outcome(value: MobileSdkOutcome) {
    safeCallback(this.config.callbacks?.onOutcome
      ? () => this.config.callbacks?.onOutcome?.(Object.freeze({ ...value })) : undefined);
  }

  private failSecureStorage(code: string) {
    const removed = this.queue.length + this.pendingConsent.length;
    this.storageHealthy = false;
    this.queue = [];
    this.pendingConsent = [];
    this.anonymousId = undefined;
    this.persistedAnonymousId = undefined;
    this.userId = undefined;
    this.accountId = undefined;
    this.sessionId = undefined;
    if (removed) this.outcome({ kind: 'dropped', code: 'SECURE_STORAGE_FAIL_CLOSED', count: removed });
    this.diagnostic({ code });
  }

  private async initialise() {
    if (!this.configured || !this.storageHealthy) return;
    this.readHostState();
    if (this.storage) await this.loadStoredState();
    if (this.analyticsConsent() === 'denied') await this.purgeForDeniedConsent();
    if (!this.storageHealthy) return;
    this.bindHostTransitions();
    this.scheduleFlush(this.limits.flushIntervalMs);
  }

  private readHostState() {
    try { this.appState = this.runtime.source.lifecycle?.currentState() ?? 'active'; }
    catch { this.appState = 'active'; this.diagnostic({ code: 'LIFECYCLE_STATE_FAILED' }); }
    try { this.online = this.runtime.source.network?.isOnline() ?? true; }
    catch { this.online = false; this.diagnostic({ code: 'NETWORK_STATE_FAILED' }); }
  }

  private bindHostTransitions() {
    const lifecycle = this.runtime.source.lifecycle;
    if (lifecycle) {
      try {
        const unsubscribe = lifecycle.subscribe((state) => {
          const prior = this.appState;
          this.appState = ['active', 'inactive', 'background'].includes(state) ? state : 'inactive';
          if (this.appState === 'background') {
            this.clearTimer();
            if (this.limits.flushOnBackground) void this.flushInternal('background', false);
          } else if (this.appState === 'active') {
            this.scheduleFlush(this.limits.flushIntervalMs);
            if (prior !== 'active' && this.limits.flushOnForeground) void this.flushInternal('foreground', false);
          }
        });
        if (typeof unsubscribe === 'function') this.unsubscribers.push(unsubscribe);
      } catch { this.diagnostic({ code: 'LIFECYCLE_SUBSCRIBE_FAILED' }); }
    }
    const network = this.runtime.source.network;
    if (network) {
      try {
        const unsubscribe = network.subscribe((online) => {
          const reconnected = !this.online && online === true;
          this.online = online === true;
          if (reconnected && this.limits.flushOnNetworkReconnect) {
            void this.flushInternal('network_reconnect', false);
          }
        });
        if (typeof unsubscribe === 'function') this.unsubscribers.push(unsubscribe);
      } catch { this.diagnostic({ code: 'NETWORK_SUBSCRIBE_FAILED' }); }
    }
  }

  private analyticsConsent() {
    return this.consentState?.analytics ?? 'unknown';
  }

  private clearTimer() {
    if (this.timer === undefined) return;
    try { this.runtime.clearTimeout?.(this.timer); } catch { /* Best effort. */ }
    this.timer = undefined;
  }

  private scheduleFlush(delayMs: number) {
    if (!this.enabled || this.appState !== 'active' || !this.runtime.setTimeout) return;
    this.clearTimer();
    try {
      this.timer = this.runtime.setTimeout(() => {
        this.timer = undefined;
        void this.flushInternal('interval', false).finally(() => this.scheduleFlush(this.limits.flushIntervalMs));
      }, Math.max(0, delayMs));
    } catch { this.diagnostic({ code: 'TIMER_SCHEDULE_FAILED' }); }
  }

  private ensureAnonymousId() {
    this.anonymousId ??= this.persistedAnonymousId ?? `anon_${createUuid(this.runtime.random)}`;
    return this.anonymousId;
  }

  private eventBytes(event: JourneyEventEnvelope) {
    const encoded = safeJson(event);
    return encoded ? this.runtime.byteLength(encoded) : Number.POSITIVE_INFINITY;
  }

  private async removeStoredState(code: string) {
    if (!this.storage) return true;
    try {
      await this.storage.remove(this.storageKey);
      return true;
    } catch {
      this.failSecureStorage(code);
      return false;
    }
  }

  private async loadStoredState() {
    if (!this.storage) return;
    let raw: string | null;
    try { raw = await this.storage.read(this.storageKey); }
    catch { this.failSecureStorage('SECURE_STORAGE_READ_FAILED'); return; }
    if (!raw) return;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch {
      await this.removeStoredState('SECURE_STORAGE_CORRUPT_CLEAR_FAILED');
      this.diagnostic({ code: 'SECURE_STORAGE_CORRUPT' });
      return;
    }
    if (!isRecord(parsed) || parsed.version !== STORED_STATE_VERSION
      || parsed.protocolVersion !== JOURNEY_EVENT_PROTOCOL_VERSION) {
      await this.removeStoredState('SECURE_STORAGE_VERSION_CLEAR_FAILED');
      this.diagnostic({ code: 'SECURE_STORAGE_VERSION_UNSUPPORTED' });
      return;
    }
    if (!Array.isArray(parsed.entries) || !parsed.entries.every(isStoredEntry)
      || (parsed.anonymousId !== undefined
        && (typeof parsed.anonymousId !== 'string'
          || parsed.anonymousId.length === 0
          || parsed.anonymousId.length > journeyEventLimits.identifierChars))) {
      await this.removeStoredState('SECURE_STORAGE_CORRUPT_CLEAR_FAILED');
      this.diagnostic({ code: 'SECURE_STORAGE_CORRUPT' });
      return;
    }
    const state = parsed as unknown as StoredState;
    this.persistedAnonymousId = state.anonymousId;
    if (this.analyticsConsent() === 'granted') this.anonymousId = state.anonymousId;
    const now = this.runtime.now();
    const seen = new Set<string>();
    let discarded = false;
    for (const stored of state.entries) {
      if (now - stored.enqueuedAt >= this.limits.queueAgeMs || seen.has(stored.event.eventId)) {
        discarded = true;
        continue;
      }
      const bytes = this.eventBytes(stored.event);
      if (!Number.isFinite(bytes) || bytes > this.limits.queueBytes) {
        discarded = true;
        continue;
      }
      seen.add(stored.event.eventId);
      this.queue.push({ ...stored, persistable: true, bytes });
    }
    const overflow = this.enforceBounds('SECURE_STORAGE_LOAD_OVERFLOW');
    if (discarded || overflow) await this.persist();
  }

  private async persist() {
    if (!this.storage) return true;
    if (!this.storageHealthy) return false;
    let succeeded = true;
    this.storageSerial = this.storageSerial.then(async () => {
      if (!this.storage || !this.storageHealthy) { succeeded = false; return; }
      try {
        if (this.analyticsConsent() === 'denied') {
          await this.storage.remove(this.storageKey);
          return;
        }
        const entries = this.queue.filter((entry) => entry.persistable).map<StoredQueueEntry>((entry) => ({
          event: entry.event,
          enqueuedAt: entry.enqueuedAt,
          attempts: entry.attempts,
          nextAttemptAt: entry.nextAttemptAt,
          purpose: entry.purpose
        }));
        const anonymousId = this.analyticsConsent() === 'granted'
          ? this.anonymousId ?? this.persistedAnonymousId : this.persistedAnonymousId;
        if (!entries.length && !anonymousId) {
          await this.storage.remove(this.storageKey);
          return;
        }
        const state: StoredState = {
          version: STORED_STATE_VERSION,
          protocolVersion: JOURNEY_EVENT_PROTOCOL_VERSION,
          ...(anonymousId ? { anonymousId } : {}),
          entries
        };
        await this.storage.commit(this.storageKey, JSON.stringify(state));
        this.persistedAnonymousId = anonymousId;
      } catch {
        succeeded = false;
        this.failSecureStorage('SECURE_STORAGE_COMMIT_FAILED');
      }
    });
    await this.storageSerial;
    return succeeded && this.storageHealthy;
  }

  private expireOldEntries() {
    const cutoff = this.runtime.now() - this.limits.queueAgeMs;
    let dropped = 0;
    this.queue = this.queue.filter((entry) => {
      if (entry.enqueuedAt > cutoff) return true;
      dropped += 1;
      this.outcome({ kind: 'dropped', eventId: entry.event.eventId, code: 'QUEUE_EXPIRED' });
      return false;
    });
    this.pendingConsent = this.pendingConsent.filter((entry) => {
      if (entry.enqueuedAt > cutoff) return true;
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
    const auto = automaticContext(this.config.automaticContext, this.runtime.source.context);
    const context = sanitiseContext(options?.context, auto, this.config.privacy);
    const anonymousId = options?.anonymousId ?? this.anonymousId ?? this.ensureAnonymousId();
    const userId = options?.userId ?? this.userId;
    const accountId = options?.accountId ?? this.accountId;
    const sessionId = options?.sessionId ?? this.sessionId;
    return {
      protocolVersion: JOURNEY_EVENT_PROTOCOL_VERSION,
      eventId: options?.eventId ?? createUuid(this.runtime.random),
      call,
      occurredAt: options?.occurredAt ?? isoTime(this.runtime.now()),
      anonymousId,
      ...(userId ? { userId } : {}),
      ...(accountId ? { accountId } : {}),
      ...(sessionId ? { sessionId } : {}),
      context: {
        ...(context ?? {}),
        library: { name: SDK_NAME, version: SDK_VERSION }
      },
      ...(this.consentState ? { consent: this.consentState } : {})
    };
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
      if (stableJson(existing.event) !== stableJson(checked.value)) {
        this.outcome({ kind: 'invalid', eventId: event.eventId, code: 'EVENT_ID_CONFLICT' });
        return this.result('invalid', 'EVENT_ID_CONFLICT', event.eventId);
      }
      return this.result(this.pendingConsent.includes(existing) ? 'buffered' : 'queued', 'ALREADY_QUEUED', event.eventId);
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
            || this.pendingBytes() + bytes > this.limits.queueBytes)) {
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
    if (!this.queue.includes(entry)) return this.result('dropped', 'QUEUE_OVERFLOW_OLDEST', event.eventId);
    if (!await this.persist()) return this.result('dropped', 'SECURE_STORAGE_COMMIT_FAILED', event.eventId);
    this.outcome({ kind: 'queued', eventId: event.eventId, code: 'QUEUED' });
    if (this.queue.length >= this.limits.batchEvents) this.scheduleFlush(0);
    return this.result('queued', 'QUEUED', event.eventId);
  }

  private async invoke(builder: () => JourneyEventEnvelope, after?: (result: EnqueueResult) => void) {
    try {
      await this.ready;
      if (this.destroyed) return this.result('destroyed', 'SDK_DESTROYED');
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
    }, (result) => { if (result.status === 'queued') this.userId = userId; });
  }

  alias(userId: string, anonymousId?: string, options?: EventOptions) {
    return this.invoke(() => {
      const prior = anonymousId ?? options?.anonymousId ?? this.ensureAnonymousId();
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
        anonymousId: base.anonymousId ?? this.ensureAnonymousId(),
        ...(safeTraits ? { traits: safeTraits } : {})
      };
    }, (result) => { if (result.status === 'queued') this.accountId = accountId; });
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
      if (this.destroyed) return this.result('destroyed', 'SDK_DESTROYED');
      if (!this.enabled) return this.result('disabled', 'SDK_DISABLED');
      const previous = this.consentState;
      const snapshot: ConsentSnapshot = {
        ...(input.analytics ?? previous?.analytics ? { analytics: input.analytics ?? previous?.analytics! } : {}),
        ...(input.personalisation ?? previous?.personalisation
          ? { personalisation: input.personalisation ?? previous?.personalisation! } : {}),
        ...(input.researchContact ?? previous?.researchContact
          ? { researchContact: input.researchContact ?? previous?.researchContact! } : {}),
        ...(input.marketing ?? previous?.marketing ? { marketing: input.marketing ?? previous?.marketing! } : {}),
        source: input.source,
        updatedAt: input.updatedAt ?? isoTime(this.runtime.now())
      };
      if (!snapshot.analytics && !snapshot.personalisation && !snapshot.researchContact && !snapshot.marketing) {
        return this.result('invalid', 'CONSENT_PURPOSE_REQUIRED');
      }
      const envelope = {
        ...this.baseEnvelope('consent', options),
        call: 'consent' as const,
        consent: snapshot
      };
      const checked = validateEventEnvelope(envelope);
      if (!checked.ok) return this.result('invalid', 'PROTOCOL_VALIDATION_FAILED', envelope.eventId);
      this.consentState = snapshot;
      if (snapshot.analytics === 'denied') {
        if (!await this.purgeForDeniedConsent()) return this.result('dropped', 'SECURE_STORAGE_REMOVE_FAILED', envelope.eventId);
        const result = await this.enqueue(checked.value, 'control', false);
        this.userId = undefined;
        this.accountId = undefined;
        this.sessionId = undefined;
        this.anonymousId = undefined;
        this.persistedAnonymousId = undefined;
        this.scheduleFlush(0);
        return result;
      }
      const result = await this.enqueue(checked.value, 'control', snapshot.analytics === 'granted');
      if (result.status !== 'queued') return result;
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
        if (!await this.persist()) return this.result('dropped', 'SECURE_STORAGE_COMMIT_FAILED', envelope.eventId);
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
    this.anonymousId = undefined;
    this.persistedAnonymousId = undefined;
    if (removed) this.outcome({ kind: 'dropped', code: 'CONSENT_WITHDRAWN_PURGE', count: removed });
    return this.persist();
  }

  flush() {
    return this.flushInternal('explicit', true);
  }

  private flushInternal(reason: string, explicit: boolean): Promise<FlushResult> {
    if (this.flushPromise) return this.flushPromise;
    this.flushPromise = this.performFlush(reason, explicit).finally(() => { this.flushPromise = undefined; });
    return this.flushPromise;
  }

  private emptyFlush(status: FlushResult['status'], dropped = 0): FlushResult {
    return { status, accepted: 0, dropped, retained: this.queue.length };
  }

  private async automaticFlushDeferred() {
    const battery = this.runtime.source.battery;
    if (!battery) return false;
    try {
      if (this.limits.pauseInLowPowerMode && await battery.lowPowerMode?.() === true) return true;
      const level = await battery.level();
      return level !== undefined && Number.isFinite(level) && level < this.limits.minimumBatteryLevel;
    } catch {
      this.diagnostic({ code: 'BATTERY_STATE_FAILED' });
      return true;
    }
  }

  private eligibleEntries(now: number, maximumBytes: number) {
    const result: QueueEntry[] = [];
    let bytes = 256;
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

  private async performFlush(reason: string, explicit: boolean): Promise<FlushResult> {
    try {
      await this.ready;
      if (this.destroyed) return this.emptyFlush('destroyed');
      if (!this.enabled || !this.runtime.fetch || !this.endpoint) return this.emptyFlush('disabled');
      if (!explicit && await this.automaticFlushDeferred()) {
        this.outcome({ kind: 'deferred', code: 'BATTERY_POLICY_DEFERRED', count: this.queue.length });
        return this.emptyFlush('deferred');
      }
      const expired = this.expireOldEntries();
      if (expired && !await this.persist()) return this.emptyFlush('disabled', expired);
      if (!this.online) return this.emptyFlush('offline', expired);
      const now = this.runtime.now();
      const maximumBytes = reason === 'background'
        ? Math.min(this.limits.batchBytes, this.limits.backgroundBatchBytes)
        : this.limits.batchBytes;
      let entries = this.eligibleEntries(now, maximumBytes);
      if (!entries.length) {
        const waiting = this.queue.some((entry) => entry.nextAttemptAt > now);
        return this.emptyFlush(waiting ? 'retry_scheduled' : 'empty', expired);
      }
      const sentAt = isoTime(now);
      const batchId = createUuid(this.runtime.random);
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
        if (checked.ok && body && this.runtime.byteLength(body) <= maximumBytes) break;
        if (entries.length > 1) { entries = entries.slice(0, -1); continue; }
        this.removeEntry(entries[0]!, 'rejected', 'LOCAL_BATCH_VALIDATION_FAILED');
        await this.persist();
        return this.emptyFlush('sent', expired + 1);
      }
      const controller = this.runtime.createAbortController?.();
      let timeout: unknown;
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeout = this.runtime.setTimeout?.(() => {
          try { controller?.abort(); } catch { /* Best effort. */ }
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
          ...(controller ? { signal: controller.signal } : {})
        });
        response = await Promise.race([request, timeoutPromise]);
      } catch {
        if (timeout !== undefined) this.runtime.clearTimeout?.(timeout);
        const dropped = await this.retryEntries(entries, 0, 0);
        this.diagnostic({ code: 'TRANSPORT_UNAVAILABLE' });
        return {
          status: dropped === entries.length ? 'sent' : 'retry_scheduled',
          accepted: 0,
          dropped: dropped + expired,
          retained: this.queue.length
        };
      }
      if (timeout !== undefined) this.runtime.clearTimeout?.(timeout);
      const retryAfter = retryAfterMs(response.headers.get('retry-after'), this.runtime.now(), this.limits.retryMaxMs);
      if ([408, 425, 429].includes(response.status) || response.status >= 500) {
        const dropped = await this.retryEntries(entries, response.status, retryAfter);
        return {
          status: dropped === entries.length ? 'sent' : 'retry_scheduled',
          accepted: 0,
          dropped: dropped + expired,
          retained: this.queue.length
        };
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
        return {
          status: dropped === entries.length ? 'sent' : 'retry_scheduled',
          accepted: 0,
          dropped: dropped + expired,
          retained: this.queue.length
        };
      }
      const result = validateBatchResult(parsed);
      if (!result.ok || result.value.batchId !== batch.batchId) {
        const dropped = await this.retryEntries(entries, response.status, retryAfter);
        this.diagnostic({ code: 'INVALID_INGEST_RESPONSE', status: response.status });
        return {
          status: dropped === entries.length ? 'sent' : 'retry_scheduled',
          accepted: 0,
          dropped: dropped + expired,
          retained: this.queue.length
        };
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

  private async applyBatchResult(
    entries: QueueEntry[],
    result: BatchIngestResult,
    alreadyDropped: number
  ): Promise<FlushResult> {
    let accepted = 0;
    let dropped = alreadyDropped;
    const retry: QueueEntry[] = [];
    const byId = new Map(result.results.map((entry) => [entry.eventId, entry]));
    for (const entry of entries) {
      const eventResult = byId.get(entry.event.eventId);
      if (!eventResult) retry.push(entry);
      else if (eventResult.status === 'accepted' || eventResult.status === 'duplicate'
        || eventResult.status === 'quarantined') {
        this.removeEntry(entry, 'accepted', eventResult.status === 'duplicate'
          ? 'DUPLICATE_ACCEPTED' : eventResult.status.toUpperCase());
        accepted += 1;
      } else if (eventResult.retryable) retry.push(entry);
      else {
        this.removeEntry(entry, 'rejected', eventResult.code ?? 'INGEST_REJECTED');
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
      const exponential = Math.min(
        this.limits.retryMaxMs,
        this.limits.retryBaseMs * 2 ** Math.max(0, entry.attempts - 1)
      );
      const jitter = 1 - this.limits.retryJitter + this.runtime.random() * 2 * this.limits.retryJitter;
      const delay = Math.min(
        this.limits.retryMaxMs,
        Math.max(serverDelayMs, Math.round(exponential * jitter))
      );
      entry.nextAttemptAt = this.runtime.now() + delay;
      shortestDelay = Math.min(shortestDelay, delay);
      this.outcome({ kind: 'retried', eventId: entry.event.eventId, code: 'RETRY_SCHEDULED' });
      this.diagnostic({ code: 'RETRY_SCHEDULED', delayMs: delay, ...(status ? { status } : {}) });
    }
    if (!await this.persist()) return entries.length;
    if (entries.length > dropped) this.scheduleFlush(shortestDelay);
    return dropped;
  }

  async reset() {
    try {
      await this.ready;
      const removed = this.queue.length + this.pendingConsent.length;
      this.queue = [];
      this.pendingConsent = [];
      this.anonymousId = undefined;
      this.persistedAnonymousId = undefined;
      this.userId = undefined;
      this.accountId = undefined;
      this.sessionId = undefined;
      this.consentState = undefined;
      if (this.storage) {
        try {
          await this.storage.remove(this.storageKey);
          this.storageHealthy = true;
        } catch { this.failSecureStorage('SECURE_STORAGE_RESET_FAILED'); }
      }
      if (removed) this.outcome({ kind: 'dropped', code: 'RESET_PURGE', count: removed });
    } catch { this.diagnostic({ code: 'RESET_ISOLATED' }); }
  }

  async destroy() {
    if (this.destroyed) return;
    try { await this.flushInternal('destroy', true); } catch { /* Failure-isolated. */ }
    this.destroyed = true;
    this.clearTimer();
    for (const unsubscribe of this.unsubscribers) {
      try { unsubscribe(); } catch { /* Best effort. */ }
    }
    this.unsubscribers = [];
  }
}

/** Creates a React Native client without importing React Native or any native module. */
export function createReactNativeJourneySdk(config: ReactNativeJourneySdkConfig): ReactNativeJourneySdk {
  return new ReactNativeJourneyClient(config);
}
