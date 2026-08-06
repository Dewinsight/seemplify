export const JOURNEY_EVENT_PROTOCOL_VERSION = '1.0' as const;

export const journeyEventCalls = [
  'track', 'identify', 'alias', 'group', 'page', 'screen', 'consent', 'metric'
] as const;

export const consentStates = ['granted', 'denied', 'unknown'] as const;

export const ingestStatuses = ['accepted', 'duplicate', 'quarantined', 'rejected'] as const;

/** Phase 0 defaults are deliberately conservative. An ingest service may
 * impose lower plan/source-specific limits, never higher ones without a
 * versioned protocol change. */
export const journeyEventLimits = Object.freeze({
  envelopeBytes: 64 * 1024,
  batchBytes: 512 * 1024,
  batchEvents: 100,
  objectProperties: 100,
  arrayItems: 64,
  nestingDepth: 8,
  propertyNameChars: 128,
  stringChars: 4_096,
  identifierChars: 256,
  eventNameChars: 128
});

export const journeyEventSchemaFiles = Object.freeze([
  'event-envelope.schema.json',
  'event-batch.schema.json',
  'event-result.schema.json',
  'batch-result.schema.json',
  'protocol-error.schema.json'
] as const);
