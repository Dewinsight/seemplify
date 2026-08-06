import type {
  ConsentSnapshot,
  JourneyEventContext,
  JourneyEventEnvelope,
  JsonObject,
  OperationalMetric
} from '@seemplify/journey-event-protocol';

export type JourneyEnvironment = 'development' | 'staging' | 'production';
export type QueueOverflowBehaviour = 'drop-oldest' | 'drop-newest';

export interface NodeResponseLike {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}

export interface NodeFetchInit {
  method: 'POST';
  headers: Readonly<Record<string, string>>;
  body: string;
  signal?: AbortSignal;
}

export type NodeFetch = (url: string, init: NodeFetchInit) => Promise<NodeResponseLike>;

/** Injectable platform functions make delivery and failure behaviour deterministic in tests. */
export interface NodeJourneyRuntime {
  fetch?: NodeFetch;
  now?: () => number;
  random?: () => number;
  randomUuid?: () => string;
  byteLength?: (value: string) => number;
  setTimeout?: (callback: () => void, delayMs: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  createAbortController?: () => AbortController;
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
  flushIntervalMs?: number;
  /** Bounds work performed by one explicit flush call. */
  maxBatchesPerFlush?: number;
}

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
}

export interface PrivacyOptions {
  /** Additional property names removed recursively, matched case-insensitively. */
  denyPropertyNames?: readonly string[];
  /** Query parameters retained in explicit page URLs. The default is none. */
  allowUrlQueryParameters?: readonly string[];
}

export type NodeSdkOutcomeKind = 'accepted' | 'dropped' | 'invalid' | 'queued' | 'rejected' | 'retried';

export interface NodeSdkOutcome {
  kind: NodeSdkOutcomeKind;
  eventId?: string;
  code: string;
  count?: number;
}

export interface NodeSdkDiagnostic {
  code: string;
  count?: number;
  delayMs?: number;
  status?: number;
}

export interface NodeJourneyCallbacks {
  onOutcome?: (outcome: Readonly<NodeSdkOutcome>) => void;
  /** Sanitised operational metadata only. Credentials, event bodies, and identities are excluded. */
  onDiagnostic?: (diagnostic: Readonly<NodeSdkDiagnostic>) => void;
}

export interface NodeJourneySdkConfig {
  /** A scoped server credential issued with a jsk_dev, jsk_stg, or jsk_live prefix. */
  serverSecret: string;
  /** Base ingest URL or an explicit /v1/batch URL. HTTPS is required except on loopback. */
  endpoint: string;
  /** When supplied, this must match the environment encoded into the server secret. */
  environment?: JourneyEnvironment;
  queue?: QueueOptions;
  batch?: BatchOptions;
  retry?: RetryOptions;
  requestTimeoutMs?: number;
  privacy?: PrivacyOptions;
  callbacks?: NodeJourneyCallbacks;
  runtime?: NodeJourneyRuntime;
}

export interface EventOptions {
  /** Canonical idempotency key. It is preserved unchanged across every retry. */
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

export interface MetricInput extends Omit<OperationalMetric, 'dimensions'> {
  dimensions?: JsonObject;
}

export interface EnqueueResult {
  status: 'queued' | 'dropped' | 'invalid' | 'disabled' | 'closed';
  eventId?: string;
  code: string;
}

export interface FlushResult {
  status: 'sent' | 'empty' | 'retry_scheduled' | 'disabled' | 'closed';
  accepted: number;
  dropped: number;
  retained: number;
}

export interface ImportBatchResult {
  status: 'queued' | 'partial' | 'invalid' | 'disabled' | 'closed';
  code: string;
  enqueued: number;
  duplicate: number;
  rejected: number;
  /** One stable result per envelope, in input order, when the input is within the canonical bound. */
  results: readonly EnqueueResult[];
}

export interface NodeJourneySdk {
  /** Synchronous initialisation represented as a stable, never-rejecting compatibility checkpoint. */
  readonly ready: Promise<void>;
  readonly enabled: boolean;
  track(event: string, properties?: JsonObject, options?: EventOptions): Promise<EnqueueResult>;
  identify(userId: string, traits?: JsonObject, options?: EventOptions): Promise<EnqueueResult>;
  alias(userId: string, anonymousId: string, options?: EventOptions): Promise<EnqueueResult>;
  group(accountId: string, traits?: JsonObject, options?: EventOptions): Promise<EnqueueResult>;
  page(name?: string, properties?: JsonObject, options?: EventOptions): Promise<EnqueueResult>;
  screen(name?: string, properties?: JsonObject, options?: EventOptions): Promise<EnqueueResult>;
  consent(consent: ConsentInput, options?: EventOptions): Promise<EnqueueResult>;
  /** Server-only submission of a schema-approved operational measure. */
  metric(event: string, metric: MetricInput, options?: EventOptions): Promise<EnqueueResult>;
  /**
   * Validates and queues a bounded set of canonical envelopes. It preserves
   * every caller-supplied eventId and never implies durable import.
   */
  importBatch(events: readonly NodeSdkEventEnvelope[]): Promise<ImportBatchResult>;
  flush(): Promise<FlushResult>;
  /** Stops accepting events, attempts a final bounded flush, and releases timers. */
  close(): Promise<FlushResult>;
  /** Contains no credentials, identities, or event bodies. */
  status(): Readonly<{ enabled: boolean; closed: boolean; queued: number; inFlight: boolean }>;
}

export type NodeSdkEventEnvelope = JourneyEventEnvelope;

declare const verifiedJourneyIdentityBrand: unique symbol;

/**
 * An opaque marker created only after the host has authenticated a request.
 * Creating the marker does not itself authenticate a user.
 */
export interface VerifiedJourneyIdentity {
  readonly userId: string;
  readonly verificationMethod: string;
  readonly [verifiedJourneyIdentityBrand]: true;
}

export interface JourneyResolvedRequestContext {
  /** Only identities created by createVerifiedJourneyIdentity are accepted. */
  identity?: VerifiedJourneyIdentity;
  anonymousId?: string;
  accountId?: string;
  sessionId?: string;
  context?: JourneyEventContext;
}

export type JourneyMiddlewareNext = (error?: unknown) => void;

export interface JourneyRequestContextMiddlewareConfig<Request extends object> {
  resolve(request: Request): JourneyResolvedRequestContext | undefined
    | Promise<JourneyResolvedRequestContext | undefined>;
  privacy?: PrivacyOptions;
  /** Receives stable codes only; request data and exception text are excluded. */
  onDiagnostic?: (diagnostic: Readonly<NodeSdkDiagnostic>) => void;
}

/** A framework-neutral Connect/Express-shaped middleware with WeakMap storage. */
export interface JourneyRequestContextMiddleware<Request extends object> {
  (request: Request, response: unknown, next: JourneyMiddlewareNext): void;
  eventOptions(request: Request): Readonly<EventOptions> | undefined;
  clear(request: Request): void;
}
