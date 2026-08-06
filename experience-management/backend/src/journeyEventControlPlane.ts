import crypto from 'node:crypto';

export const JOURNEY_EVENT_CONTROL_PLANE_VERSION = 'journey-event-control-plane/v1' as const;

export type JourneyEventEnvironment = 'development' | 'staging' | 'production';
export type JourneyEventCredentialKind = 'public_write' | 'server_secret';
export type JourneyEventValidationMode = 'observe' | 'warn' | 'enforce';
export type JourneyEventSourceStatus = 'active' | 'paused' | 'revoked';

export interface JourneyEventSourcePolicy {
  sourceId: string;
  spaceId: string;
  environment: JourneyEventEnvironment;
  status: JourneyEventSourceStatus;
  validationMode: JourneyEventValidationMode;
  allowedOrigins: string[];
  allowedBundleIds: string[];
  eventsPerMinute: number;
  bytesPerMinute: number;
}

export interface JourneyEventCredentialRecord {
  id: string;
  sourceId: string;
  spaceId: string;
  environment: JourneyEventEnvironment;
  kind: JourneyEventCredentialKind;
  scope: 'events:write';
  displayPrefix: string;
  algorithm: 'scrypt-v1';
  salt: string;
  digest: string;
  status: 'active' | 'overlap' | 'revoked';
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface JourneyIssuedCredential {
  secret: string;
  record: JourneyEventCredentialRecord;
}

export type JourneyEventPropertyType = 'string' | 'number' | 'boolean' | 'object' | 'array';
export type JourneyEventDataClass = 'operational' | 'personal' | 'sensitive' | 'prohibited_content';

export interface JourneyEventPropertyDefinition {
  name: string;
  type: JourneyEventPropertyType;
  required: boolean;
  dataClass: JourneyEventDataClass;
  description: string;
  maximumLength?: number | null;
  maximumItems?: number | null;
  enumValues?: Array<string | number | boolean>;
}

export interface JourneyEventSchemaVersion {
  schemaId: string;
  eventName: string;
  version: string;
  state: 'draft' | 'published' | 'deprecated' | 'retired';
  properties: JourneyEventPropertyDefinition[];
}

export interface JourneyControlPlaneIssue {
  severity: 'error' | 'warning';
  code: string;
  path: string;
  message: string;
}

export interface JourneySchemaCompatibilityResult {
  compatible: boolean;
  issues: JourneyControlPlaneIssue[];
}

export interface JourneyEventPropertyValidationResult {
  accepted: boolean;
  mode: JourneyEventValidationMode;
  issues: JourneyControlPlaneIssue[];
  acceptedPropertyNames: string[];
  ignoredPropertyNames: string[];
}

export class JourneyEventControlPlaneError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'JourneyEventControlPlaneError';
  }
}

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const credentialKeyIdPattern = /^[A-Za-z0-9][A-Za-z0-9_:-]{0,127}$/u;
// Keep the tracking-plan grammar identical to protocol v1. Dotted names were
// used in an early planning draft, but the shipped SDK validators intentionally
// accept lower snake_case only.
const eventNamePattern = /^[a-z][a-z0-9_]{0,127}$/u;
const propertyNamePattern = /^[a-z][a-z0-9_]{0,63}$/u;
const prohibitedContentName = /(?:^|_)(?:prompt|body|content|document|transcript|password|secret|token|access_token|refresh_token|email_body|survey_response|raw_payload)(?:_|$)/u;
const maximumProperties = 100;
const maximumPropertyBytes = 16_384;

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function instant(value: string, field: string) {
  const parsed = Date.parse(value);
  if (!value || !Number.isFinite(parsed)) {
    throw new JourneyEventControlPlaneError('JOURNEY_EVENT_TIME_INVALID', `${field} must be a valid timestamp.`);
  }
  return parsed;
}

function canonicalStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort(compareText);
}

function credentialPrefix(kind: JourneyEventCredentialKind, environment: JourneyEventEnvironment) {
  const kindPrefix = kind === 'public_write' ? 'jpk' : 'jsk';
  const environmentPrefix = environment === 'production' ? 'live' : environment === 'staging' ? 'stg' : 'dev';
  return `${kindPrefix}_${environmentPrefix}`;
}

function randomUrlSafe(bytes: number) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function credentialDigest(secret: string, salt: string) {
  return crypto.scryptSync(secret, salt, 32, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex');
}

function issueWithEntropy(input: {
  source: JourneyEventSourcePolicy;
  kind: JourneyEventCredentialKind;
  now: string;
  keyId: string;
  secretPart: string;
  salt: string;
}): JourneyIssuedCredential {
  validateJourneyEventSourcePolicy(input.source);
  if (input.source.status !== 'active') {
    throw new JourneyEventControlPlaneError('JOURNEY_EVENT_SOURCE_INACTIVE', 'Credentials can only be issued for an active event source.');
  }
  instant(input.now, 'now');
  if (!credentialKeyIdPattern.test(input.keyId)) {
    throw new JourneyEventControlPlaneError('JOURNEY_EVENT_KEY_ID_INVALID', 'Credential ID is invalid.');
  }
  if (input.secretPart.length < 32 || input.salt.length < 16) {
    throw new JourneyEventControlPlaneError('JOURNEY_EVENT_KEY_ENTROPY_INVALID', 'Credential entropy is insufficient.');
  }
  const prefix = credentialPrefix(input.kind, input.source.environment);
  const secret = `${prefix}.${input.keyId}.${input.secretPart}`;
  return {
    secret,
    record: {
      id: input.keyId,
      sourceId: input.source.sourceId,
      spaceId: input.source.spaceId,
      environment: input.source.environment,
      kind: input.kind,
      scope: 'events:write',
      displayPrefix: `${prefix}.${input.keyId}`,
      algorithm: 'scrypt-v1',
      salt: input.salt,
      digest: credentialDigest(secret, input.salt),
      status: 'active',
      createdAt: input.now,
      expiresAt: null,
      revokedAt: null
    }
  };
}

export function issueJourneyEventCredential(input: {
  source: JourneyEventSourcePolicy;
  kind: JourneyEventCredentialKind;
  now: string;
  entropy?: { keyId: string; secretPart: string; salt: string };
}): JourneyIssuedCredential {
  const entropy = input.entropy || {
    // Prefix the random component so generated identifiers always satisfy the
    // protocol's leading-alphanumeric credential grammar.
    keyId: `key_${randomUrlSafe(12)}`,
    secretPart: randomUrlSafe(32),
    salt: randomUrlSafe(24)
  };
  return issueWithEntropy({ ...input, ...entropy });
}

export function verifyJourneyEventCredential(input: {
  record: JourneyEventCredentialRecord;
  candidate: string;
  now: string;
  source: JourneyEventSourcePolicy;
}): boolean {
  const nowMs = instant(input.now, 'now');
  if (input.source.status !== 'active'
    || input.record.status === 'revoked'
    || input.record.sourceId !== input.source.sourceId
    || input.record.spaceId !== input.source.spaceId
    || input.record.environment !== input.source.environment
    || input.record.scope !== 'events:write') return false;
  if (input.record.expiresAt && nowMs >= instant(input.record.expiresAt, 'record.expiresAt')) return false;
  const expectedPrefix = `${credentialPrefix(input.record.kind, input.record.environment)}.${input.record.id}`;
  if (input.candidate.length > 512
    || input.candidate.split('.').length !== 3
    || !input.candidate.startsWith(`${expectedPrefix}.`)
    || !/^[a-f0-9]{64}$/u.test(input.record.digest)) return false;
  const candidateDigest = credentialDigest(input.candidate, input.record.salt);
  const expected = Buffer.from(input.record.digest, 'hex');
  const candidate = Buffer.from(candidateDigest, 'hex');
  return expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate);
}

export function rotateJourneyEventCredential(input: {
  current: JourneyEventCredentialRecord;
  source: JourneyEventSourcePolicy;
  now: string;
  overlapSeconds: number;
  entropy?: { keyId: string; secretPart: string; salt: string };
}): { previous: JourneyEventCredentialRecord; issued: JourneyIssuedCredential } {
  const nowMs = instant(input.now, 'now');
  if (input.current.status !== 'active'
    || input.current.sourceId !== input.source.sourceId
    || input.current.spaceId !== input.source.spaceId
    || input.current.environment !== input.source.environment) {
    throw new JourneyEventControlPlaneError('JOURNEY_EVENT_KEY_ROTATION_INVALID', 'Only the active credential for this source can be rotated.');
  }
  if (!Number.isInteger(input.overlapSeconds) || input.overlapSeconds < 0 || input.overlapSeconds > 604_800) {
    throw new JourneyEventControlPlaneError('JOURNEY_EVENT_KEY_OVERLAP_INVALID', 'Credential overlap must be between 0 and 604800 seconds.');
  }
  const issued = issueJourneyEventCredential({
    source: input.source,
    kind: input.current.kind,
    now: input.now,
    entropy: input.entropy
  });
  const previous: JourneyEventCredentialRecord = input.overlapSeconds === 0
    ? { ...input.current, status: 'revoked', expiresAt: input.now, revokedAt: input.now }
    : {
      ...input.current,
      status: 'overlap',
      expiresAt: new Date(nowMs + input.overlapSeconds * 1_000).toISOString(),
      revokedAt: null
    };
  return { previous, issued };
}

export function revokeJourneyEventCredential(record: JourneyEventCredentialRecord, revokedAt: string) {
  instant(revokedAt, 'revokedAt');
  return { ...record, status: 'revoked' as const, expiresAt: revokedAt, revokedAt };
}

export function validateJourneyEventSourcePolicy(source: JourneyEventSourcePolicy) {
  if (!identifierPattern.test(source.sourceId) || !identifierPattern.test(source.spaceId)) {
    throw new JourneyEventControlPlaneError('JOURNEY_EVENT_SOURCE_ID_INVALID', 'Source and space IDs must be stable identifiers.');
  }
  if (!Number.isInteger(source.eventsPerMinute) || source.eventsPerMinute < 1 || source.eventsPerMinute > 10_000_000
    || !Number.isInteger(source.bytesPerMinute) || source.bytesPerMinute < 1 || source.bytesPerMinute > 10_000_000_000) {
    throw new JourneyEventControlPlaneError('JOURNEY_EVENT_SOURCE_LIMIT_INVALID', 'Source event and byte limits must be positive bounded integers.');
  }
  const origins = canonicalStrings(source.allowedOrigins);
  if (origins.length !== source.allowedOrigins.length) {
    throw new JourneyEventControlPlaneError('JOURNEY_EVENT_SOURCE_ORIGIN_DUPLICATE', 'Allowed origins must be unique and non-empty.');
  }
  for (const origin of origins) {
    let parsed: URL;
    try { parsed = new URL(origin); }
    catch { throw new JourneyEventControlPlaneError('JOURNEY_EVENT_SOURCE_ORIGIN_INVALID', `Allowed origin ${origin} is invalid.`); }
    if (parsed.origin !== origin || !['https:', 'http:'].includes(parsed.protocol)
      || (parsed.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))) {
      throw new JourneyEventControlPlaneError('JOURNEY_EVENT_SOURCE_ORIGIN_INVALID', `Allowed origin ${origin} must be an HTTPS origin or loopback HTTP origin.`);
    }
  }
  if (canonicalStrings(source.allowedBundleIds).length !== source.allowedBundleIds.length
    || source.allowedBundleIds.some((bundleId) => !/^[A-Za-z0-9][A-Za-z0-9.-]{1,199}$/u.test(bundleId))) {
    throw new JourneyEventControlPlaneError('JOURNEY_EVENT_SOURCE_BUNDLE_INVALID', 'Allowed application bundle IDs are invalid or duplicated.');
  }
  return { ...source, allowedOrigins: origins, allowedBundleIds: canonicalStrings(source.allowedBundleIds) };
}

function issue(severity: JourneyControlPlaneIssue['severity'], code: string, path: string, message: string): JourneyControlPlaneIssue {
  return { severity, code, path, message };
}

function validatePropertyDefinition(property: JourneyEventPropertyDefinition, index: number) {
  const issues: JourneyControlPlaneIssue[] = [];
  const path = `properties[${index}]`;
  if (!propertyNamePattern.test(property.name)) {
    issues.push(issue('error', 'EVENT_PROPERTY_NAME_INVALID', `${path}.name`, 'Property names must use lower_snake_case and contain at most 64 characters.'));
  }
  if (!property.description.trim()) {
    issues.push(issue('error', 'EVENT_PROPERTY_DESCRIPTION_REQUIRED', `${path}.description`, 'Every tracked property requires a purpose description.'));
  }
  if (property.dataClass === 'prohibited_content' || prohibitedContentName.test(property.name)) {
    issues.push(issue('error', 'EVENT_PROPERTY_CONTENT_PROHIBITED', path, 'Content-bearing or credential fields cannot be added to a tracking plan.'));
  }
  if (property.maximumLength !== undefined && property.maximumLength !== null
    && (!Number.isInteger(property.maximumLength) || property.maximumLength < 1 || property.maximumLength > maximumPropertyBytes)) {
    issues.push(issue('error', 'EVENT_PROPERTY_LENGTH_INVALID', `${path}.maximumLength`, `maximumLength must be between 1 and ${maximumPropertyBytes}.`));
  }
  if (property.maximumLength !== undefined && property.maximumLength !== null && property.type !== 'string') {
    issues.push(issue('error', 'EVENT_PROPERTY_LENGTH_TYPE_INVALID', `${path}.maximumLength`, 'maximumLength is only valid for string properties.'));
  }
  if (property.maximumItems !== undefined && property.maximumItems !== null
    && (!Number.isInteger(property.maximumItems) || property.maximumItems < 1 || property.maximumItems > 100)) {
    issues.push(issue('error', 'EVENT_PROPERTY_ITEMS_INVALID', `${path}.maximumItems`, 'maximumItems must be between 1 and 100.'));
  }
  if (property.maximumItems !== undefined && property.maximumItems !== null && property.type !== 'array') {
    issues.push(issue('error', 'EVENT_PROPERTY_ITEMS_TYPE_INVALID', `${path}.maximumItems`, 'maximumItems is only valid for array properties.'));
  }
  if (property.enumValues && (!property.enumValues.length || property.enumValues.length > 100
    || new Set(property.enumValues.map((value) => JSON.stringify(value))).size !== property.enumValues.length)) {
    issues.push(issue('error', 'EVENT_PROPERTY_ENUM_INVALID', `${path}.enumValues`, 'Enum values must be unique and contain between 1 and 100 entries.'));
  }
  if (property.enumValues && (property.type === 'object' || property.type === 'array'
    || property.enumValues.some((value) => typeof value !== property.type))) {
    issues.push(issue('error', 'EVENT_PROPERTY_ENUM_TYPE_INVALID', `${path}.enumValues`, 'Enum values must match a scalar property type.'));
  }
  return issues;
}

export function validateJourneyEventSchema(schema: JourneyEventSchemaVersion): JourneyControlPlaneIssue[] {
  const issues: JourneyControlPlaneIssue[] = [];
  if (!identifierPattern.test(schema.schemaId)) {
    issues.push(issue('error', 'EVENT_SCHEMA_ID_INVALID', 'schemaId', 'schemaId must be a stable identifier.'));
  }
  if (!eventNamePattern.test(schema.eventName)) {
    issues.push(issue('error', 'EVENT_NAME_INVALID', 'eventName', 'Event names must use lower snake_case and contain at most 128 characters.'));
  }
  if (!/^\d+\.\d+$/u.test(schema.version)) {
    issues.push(issue('error', 'EVENT_SCHEMA_VERSION_INVALID', 'version', 'Schema version must use major.minor format.'));
  }
  if (!Array.isArray(schema.properties) || schema.properties.length > maximumProperties) {
    issues.push(issue('error', 'EVENT_SCHEMA_PROPERTIES_INVALID', 'properties', `A schema can define at most ${maximumProperties} properties.`));
    return issues;
  }
  const names = new Set<string>();
  schema.properties.forEach((property, index) => {
    issues.push(...validatePropertyDefinition(property, index));
    if (names.has(property.name)) issues.push(issue('error', 'EVENT_PROPERTY_DUPLICATE', `properties[${index}].name`, `Property ${property.name} is duplicated.`));
    names.add(property.name);
  });
  return issues.sort((left, right) => compareText(left.path, right.path) || compareText(left.code, right.code));
}

export function compareJourneyEventSchemas(previous: JourneyEventSchemaVersion, next: JourneyEventSchemaVersion): JourneySchemaCompatibilityResult {
  const issues = validateJourneyEventSchema(next);
  if (previous.schemaId !== next.schemaId || previous.eventName !== next.eventName) {
    issues.push(issue('error', 'EVENT_SCHEMA_IDENTITY_CHANGED', 'schemaId', 'A schema version cannot change schema ID or event name.'));
  }
  const [previousMajor, previousMinor] = previous.version.split('.').map(Number);
  const [nextMajor, nextMinor] = next.version.split('.').map(Number);
  if (![previousMajor, previousMinor, nextMajor, nextMinor].every(Number.isInteger)
    || nextMajor < previousMajor || (nextMajor === previousMajor && nextMinor <= previousMinor)) {
    issues.push(issue('error', 'EVENT_SCHEMA_VERSION_NOT_INCREMENTED', 'version', 'A new schema version must be greater than the prior major.minor version.'));
  }
  const previousByName = new Map(previous.properties.map((property) => [property.name, property]));
  const nextByName = new Map(next.properties.map((property) => [property.name, property]));
  for (const [name, prior] of previousByName) {
    const current = nextByName.get(name);
    if (!current) {
      issues.push(issue('error', 'EVENT_PROPERTY_REMOVED', `properties.${name}`, 'Published properties cannot be removed in a compatible version.'));
      continue;
    }
    if (current.type !== prior.type) issues.push(issue('error', 'EVENT_PROPERTY_TYPE_CHANGED', `properties.${name}.type`, 'Published property types cannot change compatibly.'));
    if (!prior.required && current.required) issues.push(issue('error', 'EVENT_PROPERTY_BECAME_REQUIRED', `properties.${name}.required`, 'An optional property cannot become required compatibly.'));
    if (prior.dataClass !== current.dataClass) issues.push(issue('warning', 'EVENT_PROPERTY_CLASSIFICATION_CHANGED', `properties.${name}.dataClass`, 'Data-class changes require privacy review.'));
  }
  for (const [name, current] of nextByName) {
    if (!previousByName.has(name) && current.required) {
      issues.push(issue('error', 'EVENT_REQUIRED_PROPERTY_ADDED', `properties.${name}.required`, 'A newly added property must be optional in a compatible version.'));
    }
  }
  issues.sort((left, right) => compareText(left.path, right.path) || compareText(left.code, right.code));
  return { compatible: !issues.some((entry) => entry.severity === 'error'), issues };
}

function valueMatchesType(value: unknown, type: JourneyEventPropertyType) {
  if (type === 'string') return typeof value === 'string';
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'array') return Array.isArray(value);
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function validateJourneyEventProperties(input: {
  schema: JourneyEventSchemaVersion;
  properties: unknown;
  mode: JourneyEventValidationMode;
}): JourneyEventPropertyValidationResult {
  const issues = validateJourneyEventSchema(input.schema);
  if (!input.properties || typeof input.properties !== 'object' || Array.isArray(input.properties)) {
    issues.push(issue('error', 'EVENT_PROPERTIES_OBJECT_REQUIRED', 'properties', 'Event properties must be an object.'));
    return { accepted: false, mode: input.mode, issues, acceptedPropertyNames: [], ignoredPropertyNames: [] };
  }
  const values = input.properties as Record<string, unknown>;
  const names = Object.keys(values).sort(compareText);
  if (names.length > maximumProperties || names.some((name) => ['__proto__', 'prototype', 'constructor'].includes(name))) {
    issues.push(issue('error', 'EVENT_PROPERTIES_UNSAFE', 'properties', 'Event properties exceed the limit or contain an unsafe key.'));
    return { accepted: false, mode: input.mode, issues, acceptedPropertyNames: [], ignoredPropertyNames: names };
  }
  const schemaByName = new Map(input.schema.properties.map((property) => [property.name, property]));
  const acceptedNames: string[] = [];
  const ignoredNames: string[] = [];
  for (const definition of input.schema.properties) {
    if (definition.required && !(definition.name in values)) {
      issues.push(issue('error', 'EVENT_REQUIRED_PROPERTY_MISSING', `properties.${definition.name}`, 'A required property is missing.'));
    }
  }
  for (const name of names) {
    const definition = schemaByName.get(name);
    if (!definition) {
      issues.push(issue(input.mode === 'observe' ? 'warning' : 'error', 'EVENT_PROPERTY_UNKNOWN', `properties.${name}`, 'This property is not in the published tracking plan.'));
      ignoredNames.push(name);
      continue;
    }
    const value = values[name];
    if (!valueMatchesType(value, definition.type)) {
      issues.push(issue('error', 'EVENT_PROPERTY_TYPE_INVALID', `properties.${name}`, `Expected ${definition.type}.`));
      ignoredNames.push(name);
      continue;
    }
    if (typeof value === 'string' && definition.maximumLength && Buffer.byteLength(value, 'utf8') > definition.maximumLength) {
      issues.push(issue('error', 'EVENT_PROPERTY_LENGTH_EXCEEDED', `properties.${name}`, 'String value exceeds its UTF-8 byte limit.'));
      ignoredNames.push(name);
      continue;
    }
    if (Array.isArray(value) && definition.maximumItems && value.length > definition.maximumItems) {
      issues.push(issue('error', 'EVENT_PROPERTY_ITEMS_EXCEEDED', `properties.${name}`, 'Array value exceeds its item limit.'));
      ignoredNames.push(name);
      continue;
    }
    if (definition.enumValues && !definition.enumValues.some((allowed) => allowed === value)) {
      issues.push(issue('error', 'EVENT_PROPERTY_ENUM_INVALID', `properties.${name}`, 'Value is not in the allowed enum.'));
      ignoredNames.push(name);
      continue;
    }
    acceptedNames.push(name);
  }
  issues.sort((left, right) => compareText(left.path, right.path) || compareText(left.code, right.code));
  const hardFailure = issues.some((entry) => ['EVENT_SCHEMA_PROPERTIES_INVALID', 'EVENT_PROPERTIES_UNSAFE', 'EVENT_PROPERTIES_OBJECT_REQUIRED'].includes(entry.code));
  const accepted = !hardFailure && (input.mode !== 'enforce' || !issues.some((entry) => entry.severity === 'error'));
  return { accepted, mode: input.mode, issues, acceptedPropertyNames: acceptedNames, ignoredPropertyNames: ignoredNames };
}
