import type {
  ConsentSnapshot,
  JourneyEventContext,
  JourneyEventEnvelope,
  JsonObject
} from '@seemplify/journey-event-protocol';

export type MaybePromise<T> = T | Promise<T>;
export type MobileEnvironment = 'development' | 'staging' | 'production';
export type MobileAppState = 'active' | 'inactive' | 'background';
export type PreConsentBehaviour = 'drop' | 'buffer-memory';
export type QueueOverflowBehaviour = 'drop-oldest' | 'drop-newest';

export interface MobileAbortSignal {
  readonly aborted?: boolean;
  addEventListener?(type: 'abort', listener: () => void): void;
}

export interface MobileAbortController {
  readonly signal: MobileAbortSignal;
  abort(): void;
}

export interface MobileResponseLike {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}

export interface MobileFetchInit {
  method: 'POST';
  headers: Readonly<Record<string, string>>;
  body: string;
  signal?: MobileAbortSignal;
}

export type MobileFetch = (url: string, init: MobileFetchInit) => Promise<MobileResponseLike>;

/**
 * The host adapter must encrypt values at rest and replace each value
 * atomically. The SDK deliberately provides no plaintext storage adapter.
 */
export interface SecureJourneyStorage {
  readonly security: Readonly<{
    encryptedAtRest: true;
    atomicCommit: true;
  }>;
  read(key: string): MaybePromise<string | null>;
  commit(key: string, value: string): MaybePromise<void>;
  remove(key: string): MaybePromise<void>;
}

export interface MobileLifecycleAdapter {
  currentState(): MobileAppState;
  subscribe(listener: (state: MobileAppState) => void): () => void;
}

export interface MobileNetworkAdapter {
  isOnline(): boolean;
  subscribe(listener: (online: boolean) => void): () => void;
}

export interface MobileBatteryAdapter {
  level(): MaybePromise<number | undefined>;
  lowPowerMode?(): MaybePromise<boolean | undefined>;
}

export interface MobileContextMetadata {
  app?: Readonly<{
    name?: string;
    version?: string;
    build?: string;
  }>;
  device?: Readonly<{
    type?: 'mobile' | 'tablet' | 'other';
    operatingSystem?: string;
    operatingSystemVersion?: string;
    model?: string;
  }>;
  locale?: string;
  timezone?: string;
}

/** Injectable host functions keep the runtime independent of React Native modules. */
export interface ReactNativeJourneyRuntime {
  fetch?: MobileFetch;
  now?: () => number;
  random?: () => number;
  byteLength?: (value: string) => number;
  setTimeout?: (callback: () => void, delayMs: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  createAbortController?: () => MobileAbortController;
  lifecycle?: MobileLifecycleAdapter;
  network?: MobileNetworkAdapter;
  battery?: MobileBatteryAdapter;
  context?: MobileContextMetadata;
}

export interface QueueOptions {
  maxEvents?: number;
  maxBytes?: number;
  maxAgeMs?: number;
  overflow?: QueueOverflowBehaviour;
}

export interface BatchOptions {
  maxEvents?: number;
  maxBytes?: number;
}

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
}

export interface MobileDeliveryOptions {
  /** Foreground periodic flush interval. */
  flushIntervalMs?: number;
  flushOnBackground?: boolean;
  flushOnForeground?: boolean;
  flushOnNetworkReconnect?: boolean;
  /** Bounds the bytes attempted during an automatic background transition. */
  backgroundBatchBytes?: number;
  /** Automatic flushes defer below this normalised battery level. */
  minimumBatteryLevel?: number;
  pauseAutomaticFlushInLowPowerMode?: boolean;
}

export interface AutomaticContextOptions {
  app?: boolean;
  device?: boolean;
  locale?: boolean;
  timezone?: boolean;
}

export interface PrivacyOptions {
  denyPropertyNames?: readonly string[];
  allowUrlQueryParameters?: readonly string[];
}

export type MobileSdkOutcomeKind =
  | 'accepted'
  | 'buffered'
  | 'deferred'
  | 'dropped'
  | 'invalid'
  | 'queued'
  | 'rejected'
  | 'retried';

export interface MobileSdkOutcome {
  kind: MobileSdkOutcomeKind;
  eventId?: string;
  code: string;
  count?: number;
}

export interface MobileSdkDiagnostic {
  code: string;
  count?: number;
  delayMs?: number;
  status?: number;
}

export interface ReactNativeJourneyCallbacks {
  onOutcome?: (outcome: Readonly<MobileSdkOutcome>) => void;
  /** Sanitised operational metadata only; never payloads, identities, URLs, or keys. */
  onDiagnostic?: (diagnostic: Readonly<MobileSdkDiagnostic>) => void;
}

export interface ReactNativeJourneySdkConfig {
  /** Public, write-only source key. Server secrets are rejected. */
  writeKey: string;
  endpoint: string;
  /** Must match the environment encoded in the issued public write key. */
  environment?: MobileEnvironment;
  consent?: ConsentSnapshot;
  beforeConsent?: PreConsentBehaviour;
  /** Omit or set false for an explicit process-memory-only queue. */
  storage?: SecureJourneyStorage | false;
  storageKey?: string;
  queue?: QueueOptions;
  batch?: BatchOptions;
  retry?: RetryOptions;
  delivery?: MobileDeliveryOptions;
  requestTimeoutMs?: number;
  automaticContext?: false | AutomaticContextOptions;
  privacy?: PrivacyOptions;
  callbacks?: ReactNativeJourneyCallbacks;
  debug?: boolean;
  runtime?: ReactNativeJourneyRuntime;
}

export interface EventOptions {
  eventId?: string;
  occurredAt?: string;
  anonymousId?: string;
  userId?: string;
  accountId?: string;
  sessionId?: string;
  context?: JourneyEventContext;
  eventVersion?: number;
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
  status: 'queued' | 'buffered' | 'dropped' | 'invalid' | 'disabled' | 'destroyed';
  eventId?: string;
  code: string;
}

export interface FlushResult {
  status: 'sent' | 'empty' | 'offline' | 'deferred' | 'retry_scheduled' | 'disabled' | 'destroyed';
  accepted: number;
  dropped: number;
  retained: number;
}

export interface ReactNativeJourneySdk {
  readonly ready: Promise<void>;
  readonly enabled: boolean;
  track(event: string, properties?: JsonObject, options?: EventOptions): Promise<EnqueueResult>;
  identify(userId: string, traits?: JsonObject, options?: EventOptions): Promise<EnqueueResult>;
  alias(userId: string, anonymousId?: string, options?: EventOptions): Promise<EnqueueResult>;
  group(accountId: string, traits?: JsonObject, options?: EventOptions): Promise<EnqueueResult>;
  screen(name?: string, properties?: JsonObject, options?: EventOptions): Promise<EnqueueResult>;
  consent(consent: ConsentInput, options?: EventOptions): Promise<EnqueueResult>;
  flush(): Promise<FlushResult>;
  reset(): Promise<void>;
  destroy(): Promise<void>;
  status(): Readonly<{
    enabled: boolean;
    queued: number;
    buffered: number;
    online: boolean;
    appState: MobileAppState;
    persistence: 'secure' | 'memory' | 'unavailable';
  }>;
}

export type ReactNativeSdkEventEnvelope = JourneyEventEnvelope;
