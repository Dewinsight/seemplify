import type {
  ConsentSnapshot,
  JourneyEventContext,
  JourneyEventEnvelope,
  JsonObject
} from '@seemplify/journey-event-protocol';

export type MaybePromise<T> = T | Promise<T>;

/** A deliberately tiny persistence contract. Adapters may wrap localStorage,
 * IndexedDB, an encrypted host store, or a test double. */
export interface JourneyQueueStorage {
  getItem(key: string): MaybePromise<string | null>;
  setItem(key: string, value: string): MaybePromise<void>;
  removeItem(key: string): MaybePromise<void>;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface BrowserResponseLike {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}

export interface BrowserFetchInit {
  method: 'POST';
  headers: Readonly<Record<string, string>>;
  body: string;
  signal?: AbortSignal;
  keepalive?: boolean;
  credentials: 'omit';
  cache: 'no-store';
}

export type BrowserFetch = (url: string, init: BrowserFetchInit) => Promise<BrowserResponseLike>;

export interface EventTargetLike {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface DocumentLike extends EventTargetLike {
  visibilityState?: string;
  title?: string;
  referrer?: string;
}

export interface NavigatorLike {
  onLine?: boolean;
  language?: string;
  userAgent?: string;
}

export interface LocationLike {
  href: string;
}

export interface BrowserJourneyRuntime {
  fetch?: BrowserFetch;
  now?: () => number;
  random?: () => number;
  byteLength?: (value: string) => number;
  setTimeout?: (callback: () => void, delayMs: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  createAbortController?: () => AbortController;
  lifecycleTarget?: EventTargetLike;
  document?: DocumentLike;
  navigator?: NavigatorLike;
  location?: LocationLike;
}

export type PreConsentBehaviour = 'drop' | 'buffer-memory';
export type QueueOverflowBehaviour = 'drop-oldest' | 'drop-newest';

export interface QueueOptions {
  maxEvents?: number;
  maxBytes?: number;
  maxAgeMs?: number;
  overflow?: QueueOverflowBehaviour;
}

export interface BatchOptions {
  maxEvents?: number;
  maxBytes?: number;
  flushIntervalMs?: number;
}

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
}

export interface AutomaticContextOptions {
  page?: boolean;
  locale?: boolean;
  timezone?: boolean;
  device?: boolean;
  /** Page title is often sensitive and remains independently opt-in. */
  pageTitle?: boolean;
}

export interface PrivacyOptions {
  /** Additional property names to remove recursively, matched case-insensitively. */
  denyPropertyNames?: readonly string[];
  /** Query parameters allowed in collected URLs. The default is none. */
  allowUrlQueryParameters?: readonly string[];
}

export type SdkOutcomeKind =
  | 'accepted'
  | 'buffered'
  | 'dropped'
  | 'invalid'
  | 'queued'
  | 'rejected'
  | 'retried';

export interface SdkOutcome {
  kind: SdkOutcomeKind;
  eventId?: string;
  code: string;
  count?: number;
}

export interface SdkDiagnostic {
  code: string;
  count?: number;
  delayMs?: number;
  status?: number;
}

export interface BrowserJourneyCallbacks {
  onOutcome?: (outcome: Readonly<SdkOutcome>) => void;
  /** Sanitised metadata only. Event bodies, identities, URLs, and keys are never included. */
  onDiagnostic?: (diagnostic: Readonly<SdkDiagnostic>) => void;
}

export interface BrowserJourneySdkConfig {
  /** Public, write-only source key. Never pass a server secret to a browser build. */
  writeKey: string;
  /** Base ingest URL or an explicit /v1/batch URL. */
  endpoint: string;
  /** Must match the environment encoded in the issued public write key. */
  environment?: 'production' | 'development' | 'staging';
  consent?: ConsentSnapshot;
  beforeConsent?: PreConsentBehaviour;
  storage?: JourneyQueueStorage | false;
  storageKey?: string;
  queue?: QueueOptions;
  batch?: BatchOptions;
  retry?: RetryOptions;
  requestTimeoutMs?: number;
  automaticContext?: false | AutomaticContextOptions;
  privacy?: PrivacyOptions;
  callbacks?: BrowserJourneyCallbacks;
  /** Enables sanitised diagnostics outside production only. */
  debug?: boolean;
  runtime?: BrowserJourneyRuntime;
}

export interface EventOptions {
  eventId?: string;
  occurredAt?: string;
  anonymousId?: string;
  userId?: string;
  accountId?: string;
  sessionId?: string;
  context?: JourneyEventContext;
}

export interface ConsentInput {
  analytics?: ConsentSnapshot['analytics'];
  personalisation?: ConsentSnapshot['personalisation'];
  researchContact?: ConsentSnapshot['researchContact'];
  marketing?: ConsentSnapshot['marketing'];
  source: string;
  updatedAt?: string;
}

export interface EnqueueResult {
  status: 'queued' | 'buffered' | 'dropped' | 'invalid' | 'disabled';
  eventId?: string;
  code: string;
}

export interface FlushResult {
  status: 'sent' | 'empty' | 'offline' | 'retry_scheduled' | 'disabled';
  accepted: number;
  dropped: number;
  retained: number;
}

export interface BrowserJourneySdk {
  readonly ready: Promise<void>;
  readonly enabled: boolean;
  track(event: string, properties?: JsonObject, options?: EventOptions): Promise<EnqueueResult>;
  identify(userId: string, traits?: JsonObject, options?: EventOptions): Promise<EnqueueResult>;
  alias(userId: string, anonymousId?: string, options?: EventOptions): Promise<EnqueueResult>;
  group(accountId: string, traits?: JsonObject, options?: EventOptions): Promise<EnqueueResult>;
  page(name?: string, properties?: JsonObject, options?: EventOptions): Promise<EnqueueResult>;
  screen(name?: string, properties?: JsonObject, options?: EventOptions): Promise<EnqueueResult>;
  consent(consent: ConsentInput, options?: EventOptions): Promise<EnqueueResult>;
  flush(): Promise<FlushResult>;
  reset(): Promise<void>;
  destroy(): Promise<void>;
  /** A safe snapshot for support and tests; it contains no event bodies or credentials. */
  status(): Readonly<{ enabled: boolean; queued: number; buffered: number; online: boolean }>;
}

export type SdkEventEnvelope = JourneyEventEnvelope;
