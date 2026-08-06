import {
  consentStates, ingestStatuses, journeyEventCalls, journeyEventLimits, JOURNEY_EVENT_PROTOCOL_VERSION
} from './constants.js';
import type {
  BatchIngestResult, ConsentSnapshot, EventIngestResult, JourneyEventBatch, JourneyEventEnvelope,
  JourneyProtocolError, ProtocolValidationIssue, ProtocolValidationResult
} from './types.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const eventNamePattern = /^[a-z][a-z0-9_]*$/;
const errorCodePattern = /^[A-Z][A-Z0-9_]{1,63}$/;
const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);
const envelopeKeys = new Set([
  'protocolVersion', 'eventId', 'call', 'occurredAt', 'sentAt', 'anonymousId', 'userId', 'accountId',
  'sessionId', 'event', 'eventVersion', 'properties', 'traits', 'context', 'consent', 'metric'
]);

function issue(path: string, code: string, message: string): ProtocolValidationIssue {
  return { path, code, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validDateTime(value: unknown) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function byteLength(value: unknown) {
  try {
    const encoded = JSON.stringify(value);
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(encoded).byteLength;
    let bytes = 0;
    for (let index = 0; index < encoded.length; index += 1) {
      const code = encoded.charCodeAt(index);
      if (code < 0x80) bytes += 1;
      else if (code < 0x800) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff && index + 1 < encoded.length
        && encoded.charCodeAt(index + 1) >= 0xdc00 && encoded.charCodeAt(index + 1) <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
    }
    return bytes;
  }
  catch { return Number.POSITIVE_INFINITY; }
}

function pushRequired(record: Record<string, unknown>, key: string, path: string, errors: ProtocolValidationIssue[]) {
  if (!(key in record)) errors.push(issue(`${path}.${key}`, 'REQUIRED', `${key} is required.`));
}

function pushString(
  record: Record<string, unknown>, key: string, path: string, errors: ProtocolValidationIssue[],
  options: { required?: boolean; max?: number; allowEmpty?: boolean } = {}
) {
  const value = record[key];
  if (value === undefined) {
    if (options.required) errors.push(issue(`${path}.${key}`, 'REQUIRED', `${key} is required.`));
    return;
  }
  if (typeof value !== 'string') {
    errors.push(issue(`${path}.${key}`, 'TYPE', `${key} must be a string.`));
    return;
  }
  if (!options.allowEmpty && value.length === 0) errors.push(issue(`${path}.${key}`, 'MIN_LENGTH', `${key} cannot be empty.`));
  if (value.length > (options.max ?? journeyEventLimits.stringChars)) {
    errors.push(issue(`${path}.${key}`, 'MAX_LENGTH', `${key} exceeds its maximum length.`));
  }
}

function validateJsonShape(value: unknown, path: string, depth: number, errors: ProtocolValidationIssue[]) {
  if (depth > journeyEventLimits.nestingDepth) {
    errors.push(issue(path, 'MAX_DEPTH', `JSON nesting exceeds ${journeyEventLimits.nestingDepth}.`));
    return;
  }
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) errors.push(issue(path, 'NUMBER', 'Numbers must be finite.'));
    return;
  }
  if (typeof value === 'string') {
    if (value.length > journeyEventLimits.stringChars) {
      errors.push(issue(path, 'MAX_LENGTH', `Strings cannot exceed ${journeyEventLimits.stringChars} characters.`));
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > journeyEventLimits.arrayItems) {
      errors.push(issue(path, 'MAX_ITEMS', `Arrays cannot exceed ${journeyEventLimits.arrayItems} items.`));
    }
    value.forEach((entry, index) => validateJsonShape(entry, `${path}[${index}]`, depth + 1, errors));
    return;
  }
  if (!isRecord(value)) {
    errors.push(issue(path, 'JSON_TYPE', 'Values must be JSON-compatible.'));
    return;
  }
  const keys = Object.keys(value).sort();
  if (keys.length > journeyEventLimits.objectProperties) {
    errors.push(issue(path, 'MAX_PROPERTIES', `Objects cannot exceed ${journeyEventLimits.objectProperties} properties.`));
  }
  for (const key of keys) {
    const childPath = `${path}.${key}`;
    if (unsafeKeys.has(key)) errors.push(issue(childPath, 'UNSAFE_KEY', `${key} is prohibited.`));
    if (key.length > journeyEventLimits.propertyNameChars) {
      errors.push(issue(childPath, 'PROPERTY_NAME_LENGTH', 'Property name is too long.'));
    }
    validateJsonShape(value[key], childPath, depth + 1, errors);
  }
}

function validateTimestamp(record: Record<string, unknown>, key: string, required: boolean, path: string, errors: ProtocolValidationIssue[]) {
  if (record[key] === undefined && !required) return;
  if (!validDateTime(record[key])) errors.push(issue(`${path}.${key}`, 'DATE_TIME', `${key} must be an RFC 3339 UTC timestamp.`));
}

function validateUuid(record: Record<string, unknown>, key: string, required: boolean, path: string, errors: ProtocolValidationIssue[]) {
  if (record[key] === undefined && !required) return;
  if (typeof record[key] !== 'string' || !uuidPattern.test(record[key] as string)) {
    errors.push(issue(`${path}.${key}`, 'UUID', `${key} must be a canonical UUID.`));
  }
}

function validateConsent(value: unknown, path: string, errors: ProtocolValidationIssue[]) {
  if (!isRecord(value)) {
    errors.push(issue(path, 'TYPE', 'consent must be an object.'));
    return;
  }
  const allowed = new Set(['analytics', 'personalisation', 'researchContact', 'marketing', 'source', 'updatedAt']);
  for (const key of Object.keys(value).sort()) {
    if (!allowed.has(key)) errors.push(issue(`${path}.${key}`, 'UNEXPECTED_PROPERTY', `${key} is not a consent field.`));
  }
  pushString(value, 'source', path, errors, { required: true, max: 128 });
  validateTimestamp(value, 'updatedAt', true, path, errors);
  const purposes = ['analytics', 'personalisation', 'researchContact', 'marketing'];
  if (!purposes.some((key) => value[key] !== undefined)) {
    errors.push(issue(path, 'PURPOSE_REQUIRED', 'At least one purpose-specific consent state is required.'));
  }
  for (const key of purposes) {
    if (value[key] !== undefined && !consentStates.includes(value[key] as never)) {
      errors.push(issue(`${path}.${key}`, 'ENUM', `${key} must be granted, denied, or unknown.`));
    }
  }
}

function validateMetric(value: unknown, path: string, errors: ProtocolValidationIssue[]) {
  if (!isRecord(value)) {
    errors.push(issue(path, 'TYPE', 'metric must be an object.'));
    return;
  }
  const allowed = new Set(['name', 'value', 'unit', 'dimensions']);
  for (const key of Object.keys(value).sort()) {
    if (!allowed.has(key)) errors.push(issue(`${path}.${key}`, 'UNEXPECTED_PROPERTY', `${key} is not a metric field.`));
  }
  pushString(value, 'name', path, errors, { required: true, max: 128 });
  if (typeof value.value !== 'number' || !Number.isFinite(value.value)) {
    errors.push(issue(`${path}.value`, 'NUMBER', 'metric.value must be a finite number.'));
  }
  pushString(value, 'unit', path, errors, { max: 64 });
  if (value.dimensions !== undefined && !isRecord(value.dimensions)) {
    errors.push(issue(`${path}.dimensions`, 'TYPE', 'metric.dimensions must be an object.'));
  }
}

function finish<T>(value: unknown, errors: ProtocolValidationIssue[]): ProtocolValidationResult<T> {
  const unique = new Map<string, ProtocolValidationIssue>();
  for (const entry of errors) unique.set(`${entry.path}\u0000${entry.code}\u0000${entry.message}`, entry);
  const sorted = [...unique.values()].sort((left, right) =>
    left.path.localeCompare(right.path) || left.code.localeCompare(right.code) || left.message.localeCompare(right.message));
  return sorted.length ? { ok: false, errors: sorted } : { ok: true, value: value as T };
}

export function validateEventEnvelope(input: unknown): ProtocolValidationResult<JourneyEventEnvelope> {
  const errors: ProtocolValidationIssue[] = [];
  if (!isRecord(input)) return finish(input, [issue('$', 'TYPE', 'Event envelope must be an object.')]);
  if (byteLength(input) > journeyEventLimits.envelopeBytes) {
    errors.push(issue('$', 'MAX_BYTES', `Event envelope cannot exceed ${journeyEventLimits.envelopeBytes} bytes.`));
  }
  validateJsonShape(input, '$', 0, errors);
  for (const key of Object.keys(input).sort()) {
    if (!envelopeKeys.has(key)) errors.push(issue(`$.${key}`, 'UNEXPECTED_PROPERTY', `${key} is not an envelope field.`));
  }
  if (input.protocolVersion !== JOURNEY_EVENT_PROTOCOL_VERSION) {
    errors.push(issue('$.protocolVersion', 'UNSUPPORTED_VERSION', `protocolVersion must be ${JOURNEY_EVENT_PROTOCOL_VERSION}.`));
  }
  validateUuid(input, 'eventId', true, '$', errors);
  validateTimestamp(input, 'occurredAt', true, '$', errors);
  validateTimestamp(input, 'sentAt', false, '$', errors);
  if (!journeyEventCalls.includes(input.call as never)) {
    errors.push(issue('$.call', 'ENUM', `call must be one of: ${journeyEventCalls.join(', ')}.`));
  }
  for (const key of ['anonymousId', 'userId', 'accountId', 'sessionId']) {
    pushString(input, key, '$', errors, { max: journeyEventLimits.identifierChars });
  }
  if (!['anonymousId', 'userId', 'accountId', 'sessionId'].some((key) => typeof input[key] === 'string' && input[key] !== '')) {
    errors.push(issue('$', 'SUBJECT_REQUIRED', 'At least one permitted subject or session identifier is required.'));
  }
  if (input.event !== undefined) {
    pushString(input, 'event', '$', errors, { max: journeyEventLimits.eventNameChars });
    if (typeof input.event === 'string' && !eventNamePattern.test(input.event)) {
      errors.push(issue('$.event', 'EVENT_NAME', 'event must use lower snake_case.'));
    }
  }
  if (input.eventVersion !== undefined && (!Number.isInteger(input.eventVersion) || Number(input.eventVersion) < 1)) {
    errors.push(issue('$.eventVersion', 'INTEGER', 'eventVersion must be a positive integer.'));
  }
  for (const key of ['properties', 'traits', 'context']) {
    if (input[key] !== undefined && !isRecord(input[key])) errors.push(issue(`$.${key}`, 'TYPE', `${key} must be an object.`));
  }
  if (input.consent !== undefined) validateConsent(input.consent, '$.consent', errors);
  if (input.metric !== undefined) validateMetric(input.metric, '$.metric', errors);

  if (input.call === 'track' || input.call === 'metric') {
    pushRequired(input, 'event', '$', errors);
    pushRequired(input, 'eventVersion', '$', errors);
  }
  if (input.call === 'identify') pushRequired(input, 'userId', '$', errors);
  if (input.call === 'alias') {
    pushRequired(input, 'anonymousId', '$', errors);
    pushRequired(input, 'userId', '$', errors);
  }
  if (input.call === 'group') {
    pushRequired(input, 'accountId', '$', errors);
    if (!input.userId && !input.anonymousId) {
      errors.push(issue('$', 'GROUP_MEMBER_REQUIRED', 'group requires userId or anonymousId.'));
    }
  }
  if (input.call === 'consent') pushRequired(input, 'consent', '$', errors);
  if (input.call === 'metric') pushRequired(input, 'metric', '$', errors);
  return finish(input, errors);
}

export function validateEventBatch(input: unknown): ProtocolValidationResult<JourneyEventBatch> {
  const errors: ProtocolValidationIssue[] = [];
  if (!isRecord(input)) return finish(input, [issue('$', 'TYPE', 'Event batch must be an object.')]);
  const allowed = new Set(['protocolVersion', 'batchId', 'sentAt', 'events']);
  for (const key of Object.keys(input).sort()) {
    if (!allowed.has(key)) errors.push(issue(`$.${key}`, 'UNEXPECTED_PROPERTY', `${key} is not a batch field.`));
  }
  if (byteLength(input) > journeyEventLimits.batchBytes) {
    errors.push(issue('$', 'MAX_BYTES', `Event batch cannot exceed ${journeyEventLimits.batchBytes} bytes.`));
  }
  if (input.protocolVersion !== JOURNEY_EVENT_PROTOCOL_VERSION) {
    errors.push(issue('$.protocolVersion', 'UNSUPPORTED_VERSION', `protocolVersion must be ${JOURNEY_EVENT_PROTOCOL_VERSION}.`));
  }
  validateUuid(input, 'batchId', true, '$', errors);
  validateTimestamp(input, 'sentAt', true, '$', errors);
  if (!Array.isArray(input.events)) {
    errors.push(issue('$.events', 'TYPE', 'events must be an array.'));
  } else {
    if (input.events.length < 1) errors.push(issue('$.events', 'MIN_ITEMS', 'A batch must contain at least one event.'));
    if (input.events.length > journeyEventLimits.batchEvents) {
      errors.push(issue('$.events', 'MAX_ITEMS', `A batch cannot exceed ${journeyEventLimits.batchEvents} events.`));
    }
    const seen = new Set<string>();
    input.events.forEach((event, index) => {
      const result = validateEventEnvelope(event);
      if (!result.ok) {
        for (const entry of result.errors) {
          errors.push({ ...entry, path: `$.events[${index}]${entry.path === '$' ? '' : entry.path.slice(1)}` });
        }
      }
      if (isRecord(event) && typeof event.eventId === 'string') {
        if (seen.has(event.eventId)) errors.push(issue(`$.events[${index}].eventId`, 'DUPLICATE_EVENT_ID', 'eventId must be unique within a batch.'));
        seen.add(event.eventId);
      }
    });
  }
  return finish(input, errors);
}

export function validateEventResult(input: unknown): ProtocolValidationResult<EventIngestResult> {
  const errors: ProtocolValidationIssue[] = [];
  if (!isRecord(input)) return finish(input, [issue('$', 'TYPE', 'Event result must be an object.')]);
  const allowed = new Set(['eventId', 'index', 'status', 'duplicate', 'retryable', 'receivedAt', 'code', 'message']);
  for (const key of Object.keys(input).sort()) {
    if (!allowed.has(key)) errors.push(issue(`$.${key}`, 'UNEXPECTED_PROPERTY', `${key} is not a result field.`));
  }
  validateUuid(input, 'eventId', true, '$', errors);
  if (input.index !== undefined && (!Number.isInteger(input.index) || Number(input.index) < 0)) {
    errors.push(issue('$.index', 'INTEGER', 'index must be a non-negative integer.'));
  }
  if (!ingestStatuses.includes(input.status as never)) errors.push(issue('$.status', 'ENUM', 'status is not recognised.'));
  if (typeof input.duplicate !== 'boolean') errors.push(issue('$.duplicate', 'TYPE', 'duplicate must be a boolean.'));
  if (typeof input.retryable !== 'boolean') errors.push(issue('$.retryable', 'TYPE', 'retryable must be a boolean.'));
  validateTimestamp(input, 'receivedAt', true, '$', errors);
  pushString(input, 'code', '$', errors, { max: 64 });
  pushString(input, 'message', '$', errors, { max: 500 });
  if (input.status === 'duplicate' && input.duplicate !== true) errors.push(issue('$.duplicate', 'STATUS_MISMATCH', 'duplicate status requires duplicate=true.'));
  if (input.status !== 'duplicate' && input.duplicate === true) errors.push(issue('$.duplicate', 'STATUS_MISMATCH', 'duplicate=true requires duplicate status.'));
  if ((input.status === 'rejected' || input.status === 'quarantined') && typeof input.code !== 'string') {
    errors.push(issue('$.code', 'REQUIRED', 'Rejected and quarantined results require a stable code.'));
  }
  return finish(input, errors);
}

export function validateBatchResult(input: unknown): ProtocolValidationResult<BatchIngestResult> {
  const errors: ProtocolValidationIssue[] = [];
  if (!isRecord(input)) return finish(input, [issue('$', 'TYPE', 'Batch result must be an object.')]);
  const allowed = new Set(['protocolVersion', 'batchId', 'results']);
  for (const key of Object.keys(input).sort()) {
    if (!allowed.has(key)) errors.push(issue(`$.${key}`, 'UNEXPECTED_PROPERTY', `${key} is not a batch-result field.`));
  }
  if (input.protocolVersion !== JOURNEY_EVENT_PROTOCOL_VERSION) {
    errors.push(issue('$.protocolVersion', 'UNSUPPORTED_VERSION', `protocolVersion must be ${JOURNEY_EVENT_PROTOCOL_VERSION}.`));
  }
  validateUuid(input, 'batchId', true, '$', errors);
  if (!Array.isArray(input.results)) {
    errors.push(issue('$.results', 'TYPE', 'results must be an array.'));
  } else {
    if (input.results.length > journeyEventLimits.batchEvents) errors.push(issue('$.results', 'MAX_ITEMS', 'Too many event results.'));
    input.results.forEach((result, index) => {
      const checked = validateEventResult(result);
      if (!checked.ok) {
        for (const entry of checked.errors) errors.push({ ...entry, path: `$.results[${index}]${entry.path === '$' ? '' : entry.path.slice(1)}` });
      }
    });
  }
  return finish(input, errors);
}

export function validateProtocolError(input: unknown): ProtocolValidationResult<JourneyProtocolError> {
  const errors: ProtocolValidationIssue[] = [];
  if (!isRecord(input)) return finish(input, [issue('$', 'TYPE', 'Protocol error must be an object.')]);
  for (const key of Object.keys(input).sort()) {
    if (!['protocolVersion', 'error'].includes(key)) errors.push(issue(`$.${key}`, 'UNEXPECTED_PROPERTY', `${key} is not an error-envelope field.`));
  }
  if (input.protocolVersion !== JOURNEY_EVENT_PROTOCOL_VERSION) {
    errors.push(issue('$.protocolVersion', 'UNSUPPORTED_VERSION', `protocolVersion must be ${JOURNEY_EVENT_PROTOCOL_VERSION}.`));
  }
  if (!isRecord(input.error)) {
    errors.push(issue('$.error', 'TYPE', 'error must be an object.'));
    return finish(input, errors);
  }
  const body = input.error;
  const allowed = new Set(['code', 'message', 'retryable', 'requestId', 'eventId', 'index', 'details']);
  for (const key of Object.keys(body).sort()) {
    if (!allowed.has(key)) errors.push(issue(`$.error.${key}`, 'UNEXPECTED_PROPERTY', `${key} is not an error field.`));
  }
  pushString(body, 'code', '$.error', errors, { required: true, max: 64 });
  if (typeof body.code === 'string' && !errorCodePattern.test(body.code)) {
    errors.push(issue('$.error.code', 'ERROR_CODE', 'code must be stable upper snake case.'));
  }
  pushString(body, 'message', '$.error', errors, { required: true, max: 500 });
  if (typeof body.retryable !== 'boolean') errors.push(issue('$.error.retryable', 'TYPE', 'retryable must be a boolean.'));
  pushString(body, 'requestId', '$.error', errors, { max: 128 });
  validateUuid(body, 'eventId', false, '$.error', errors);
  if (body.index !== undefined && (!Number.isInteger(body.index) || Number(body.index) < 0)) {
    errors.push(issue('$.error.index', 'INTEGER', 'index must be a non-negative integer.'));
  }
  if (body.details !== undefined) validateJsonShape(body.details, '$.error.details', 0, errors);
  return finish(input, errors);
}

/** Useful to SDK conformance runners that need a stable, serialisable outcome. */
export function validationFingerprint(result: ProtocolValidationResult<unknown>) {
  return result.ok ? 'ok' : result.errors.map((entry) => `${entry.path}|${entry.code}|${entry.message}`).join('\n');
}

/** Compile-time assertion that the runtime consent validator and public type use
 * the same shape. It has no emitted runtime effect. */
const _consentShape: ConsentSnapshot | undefined = undefined;
void _consentShape;
