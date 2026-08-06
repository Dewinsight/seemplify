import type { consentStates, ingestStatuses, journeyEventCalls, JOURNEY_EVENT_PROTOCOL_VERSION } from './constants.js';

export type JourneyEventProtocolVersion = typeof JOURNEY_EVENT_PROTOCOL_VERSION;
export type JourneyEventCall = typeof journeyEventCalls[number];
export type ConsentState = typeof consentStates[number];
export type EventIngestStatus = typeof ingestStatuses[number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface ConsentSnapshot {
  analytics?: ConsentState;
  personalisation?: ConsentState;
  researchContact?: ConsentState;
  marketing?: ConsentState;
  source: string;
  updatedAt: string;
}

export interface EventPageContext {
  url?: string;
  referrer?: string;
  title?: string;
}

export interface EventDeviceContext {
  type?: 'desktop' | 'mobile' | 'tablet' | 'server' | 'other';
  operatingSystem?: string;
}

export interface EventLibraryContext {
  name: string;
  version: string;
}

export interface JourneyEventContext extends JsonObject {
  locale?: string;
  timezone?: string;
  page?: EventPageContext & JsonObject;
  device?: EventDeviceContext & JsonObject;
  library?: EventLibraryContext & JsonObject;
}

export interface OperationalMetric {
  name: string;
  value: number;
  unit?: string;
  dimensions?: JsonObject;
}

export interface JourneyEventEnvelopeBase {
  protocolVersion: JourneyEventProtocolVersion;
  eventId: string;
  call: JourneyEventCall;
  occurredAt: string;
  sentAt?: string;
  anonymousId?: string;
  userId?: string;
  accountId?: string;
  sessionId?: string;
  event?: string;
  eventVersion?: number;
  properties?: JsonObject;
  traits?: JsonObject;
  context?: JourneyEventContext;
  consent?: ConsentSnapshot;
  metric?: OperationalMetric;
}

type EnvelopeFor<Call extends JourneyEventCall> = Omit<JourneyEventEnvelopeBase, 'call'> & { call: Call };

export interface TrackEnvelope extends EnvelopeFor<'track'> {
  event: string;
  eventVersion: number;
}

export interface IdentifyEnvelope extends EnvelopeFor<'identify'> {
  userId: string;
}

export interface AliasEnvelope extends EnvelopeFor<'alias'> {
  anonymousId: string;
  userId: string;
}

export type GroupEnvelope = EnvelopeFor<'group'> & { accountId: string }
  & ({ userId: string } | { anonymousId: string });

export type PageEnvelope = EnvelopeFor<'page'>;
export type ScreenEnvelope = EnvelopeFor<'screen'>;

export interface ConsentEnvelope extends EnvelopeFor<'consent'> {
  consent: ConsentSnapshot;
}

export interface MetricEnvelope extends EnvelopeFor<'metric'> {
  event: string;
  eventVersion: number;
  metric: OperationalMetric;
}

export type JourneyEventEnvelope = TrackEnvelope | IdentifyEnvelope | AliasEnvelope | GroupEnvelope
  | PageEnvelope | ScreenEnvelope | ConsentEnvelope | MetricEnvelope;

export interface JourneyEventBatch {
  protocolVersion: JourneyEventProtocolVersion;
  batchId: string;
  sentAt: string;
  events: JourneyEventEnvelope[];
}

export interface EventIngestResult {
  eventId: string;
  index?: number;
  status: EventIngestStatus;
  duplicate: boolean;
  retryable: boolean;
  receivedAt: string;
  code?: string;
  message?: string;
}

export interface BatchIngestResult {
  protocolVersion: JourneyEventProtocolVersion;
  batchId: string;
  results: EventIngestResult[];
}

export interface ProtocolErrorBody {
  code: string;
  message: string;
  retryable: boolean;
  requestId?: string;
  eventId?: string;
  index?: number;
  details?: JsonValue;
}

export interface JourneyProtocolError {
  protocolVersion: JourneyEventProtocolVersion;
  error: ProtocolErrorBody;
}

export interface ProtocolValidationIssue {
  path: string;
  code: string;
  message: string;
}

export type ProtocolValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: ProtocolValidationIssue[] };
