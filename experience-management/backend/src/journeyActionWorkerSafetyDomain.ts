import crypto from 'node:crypto';
import type { JourneyKillSwitchRecord, JourneyKillSwitchScope } from './journeyKillSwitchDomain.js';
import type { WorkerLiveFacts } from './journeyActionWorkerDomain.js';

/**
 * Pure safety rules for runtime-42. Nothing here touches a database, a clock, or
 * a network: the repository owns durability and this module owns the decisions,
 * so the invariants can be argued about and tested without a live engine.
 */

export const workerPrincipalStates = Object.freeze(['active', 'draining', 'revoked'] as const);
export type WorkerPrincipalState = typeof workerPrincipalStates[number];
export const workerKeyAuditActions = Object.freeze(['provisioned', 'rotated', 'draining', 'revoked'] as const);
export type WorkerKeyAuditAction = typeof workerKeyAuditActions[number];
export const workerKeyResolverKinds = Object.freeze(['external_kms', 'external_vault', 'external_file'] as const);
export type WorkerKeyResolverKind = typeof workerKeyResolverKinds[number];
export type ReservationSettlement = 'consumed' | 'released' | 'expired';

/** Shared with the repository so the stored CHECK and the runtime guard cannot drift. */
export const workerServiceTokenPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
export const workerServiceKeyRefPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$/u;

export class JourneyActionWorkerSafetyError extends Error {
  constructor(message: string, public readonly code: string, public readonly status = 400) {
    super(message); this.name = 'JourneyActionWorkerSafetyError';
  }
}

const digest = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const hex64 = /^[a-f0-9]{64}$/u;
const reasonCodePattern = /^[A-Z][A-Z0-9_]{2,63}$/u;
const instant = (value: unknown): number => typeof value === 'string' ? Date.parse(value) : Number.NaN;
const fail = (message: string, code: string, status = 400): never => {
  throw new JourneyActionWorkerSafetyError(message, code, status);
};

/**
 * Deliberately blunt. Key metadata has no legitimate reason to carry a long
 * high-entropy token, so a false positive costs an operator a rename while a
 * false negative costs a secret sitting in a durable table forever.
 */
export function looksLikeSecretMaterial(value: string): boolean {
  if (/-----BEGIN [A-Z ]+-----/u.test(value)) return true;
  const compact = value.trim();
  if (compact.length < 32) return false;
  return /^[A-Fa-f0-9]{32,}$/u.test(compact) || /^[A-Za-z0-9+/_-]{32,}={0,2}$/u.test(compact);
}

export type ServicePrincipalKeyMetadata = Readonly<{
  principalId: string; keyId: string; keyRef: string; resolverKind: WorkerKeyResolverKind;
  state: WorkerPrincipalState; notBefore: string; expiresAt: string; revision: number;
}>;

const resolverKindByScheme: Readonly<Record<string, WorkerKeyResolverKind>> = Object.freeze({
  'kms://': 'external_kms', 'awskms://': 'external_kms', 'gcpkms://': 'external_kms',
  'vault://': 'external_vault', 'secret://': 'external_vault', 'file://': 'external_file'
});

/**
 * A key reference must name an external resolver by scheme. A bare string is
 * refused rather than guessed at, because "wherever the operator meant" is not a
 * place the runtime can fail closed against.
 */
export function resolverKindForKeyRef(keyRef: string): WorkerKeyResolverKind {
  const scheme = Object.keys(resolverKindByScheme).find((prefix) => keyRef.toLowerCase().startsWith(prefix));
  if (!scheme) {
    fail('A worker key reference must name an external KMS, vault, or operator secret file.',
      'WORKER_KEY_RESOLVER_KIND_INVALID');
  }
  return resolverKindByScheme[scheme!];
}

/**
 * Validates provisioning input and reduces it to content-free metadata. The
 * reference survives only as a pointer an operator approved; nothing derived
 * from the material itself is ever accepted here.
 */
export function assertContentFreeKeyMetadata(input: { principalId: string; keyId: string; keyRef: string;
  state?: WorkerPrincipalState; notBefore: string; expiresAt: string; revision?: number }): ServicePrincipalKeyMetadata {
  if (!workerServiceTokenPattern.test(input.principalId) || looksLikeSecretMaterial(input.principalId)) {
    fail('A service principal identifier must be a content-free token.', 'WORKER_PRINCIPAL_ID_INVALID');
  }
  if (!workerServiceTokenPattern.test(input.keyId) || looksLikeSecretMaterial(input.keyId)) {
    fail('A worker key identifier must be a content-free token.', 'WORKER_KEY_ID_INVALID');
  }
  if (!workerServiceKeyRefPattern.test(input.keyRef) || looksLikeSecretMaterial(input.keyRef)) {
    fail('A worker key reference must be a content-free external pointer.', 'WORKER_KEY_REF_INVALID');
  }
  const resolverKind = resolverKindForKeyRef(input.keyRef);
  const state = input.state ?? 'active';
  if (!workerPrincipalStates.includes(state)) {
    fail('An unrecognised service principal state cannot be trusted.', 'WORKER_PRINCIPAL_STATE_INVALID');
  }
  const notBefore = instant(input.notBefore); const expiresAt = instant(input.expiresAt);
  if (!Number.isFinite(notBefore) || !Number.isFinite(expiresAt) || expiresAt <= notBefore) {
    fail('A service principal validity window must start before it ends.', 'WORKER_PRINCIPAL_VALIDITY_INVALID');
  }
  const revision = input.revision ?? 1;
  if (!Number.isSafeInteger(revision) || revision < 1) {
    fail('A service principal revision must be a positive integer.', 'WORKER_PRINCIPAL_REVISION_INVALID');
  }
  return Object.freeze({ principalId: input.principalId, keyId: input.keyId, keyRef: input.keyRef, resolverKind,
    state, notBefore: input.notBefore, expiresAt: input.expiresAt, revision });
}

const allowedPrincipalTransitions: Readonly<Record<WorkerPrincipalState, readonly WorkerPrincipalState[]>> =
  Object.freeze({
    active: Object.freeze(['draining', 'revoked'] as const),
    draining: Object.freeze(['revoked'] as const),
    revoked: Object.freeze([] as const)
  });

/** Mirrors journey_worker_service_principal_lifecycle_guard so the two cannot drift. */
export function assertPrincipalTransition(from: WorkerPrincipalState, to: WorkerPrincipalState): void {
  if (!allowedPrincipalTransitions[from]?.includes(to)) {
    fail(`A service principal cannot move from ${from} to ${to}.`, 'WORKER_PRINCIPAL_TRANSITION_FORBIDDEN', 409);
  }
}

export type PrincipalTransition = Readonly<{ principalId: string; fromState: WorkerPrincipalState;
  toState: WorkerPrincipalState; action: WorkerKeyAuditAction }>;

/**
 * Rotation is two-phase on purpose. The outgoing principal drains rather than
 * dying, so a worker holding a fenced lease can still settle it, while the
 * replacement is the only identity allowed to claim new work.
 */
export function planPrincipalRotation(input: { outgoing: { principalId: string; state: WorkerPrincipalState };
  replacement: { principalId: string } }): readonly PrincipalTransition[] {
  assertPrincipalTransition(input.outgoing.state, 'draining');
  return Object.freeze([
    Object.freeze({ principalId: input.outgoing.principalId, fromState: input.outgoing.state,
      toState: 'draining' as const, action: 'draining' as const }),
    Object.freeze({ principalId: input.replacement.principalId, fromState: 'active' as const,
      toState: 'active' as const, action: 'rotated' as const })
  ]);
}

export function planPrincipalRevocation(input: { principalId: string; state: WorkerPrincipalState }):
PrincipalTransition {
  assertPrincipalTransition(input.state, 'revoked');
  return Object.freeze({ principalId: input.principalId, fromState: input.state, toState: 'revoked' as const,
    action: 'revoked' as const });
}

export interface WorkerKeySecretResolver {
  resolve(request: Readonly<{ keyId: string; keyRef: string; resolverKind: WorkerKeyResolverKind }>):
    Promise<Readonly<{ reference: string; secret: string }> | null>;
}

/**
 * The only path from stored metadata to usable material. A draining principal
 * still resolves, because revoking a key mid-lease would strand settled work;
 * everything else fails closed, including a resolver that answers for a
 * reference no operator ever approved.
 */
export async function resolveServicePrincipalSecret(input: { metadata: ServicePrincipalKeyMetadata;
  resolver: WorkerKeySecretResolver; now: string }): Promise<string> {
  if (input.metadata.state === 'revoked') {
    fail('A revoked service principal cannot resolve key material.', 'WORKER_PRINCIPAL_REVOKED', 403);
  }
  const at = instant(input.now);
  if (!Number.isFinite(at) || at < instant(input.metadata.notBefore) || at >= instant(input.metadata.expiresAt)) {
    fail('The service principal is outside its validity window.', 'WORKER_PRINCIPAL_OUTSIDE_VALIDITY', 403);
  }
  let answer: Readonly<{ reference: string; secret: string }> | null = null;
  try {
    answer = await input.resolver.resolve({ keyId: input.metadata.keyId, keyRef: input.metadata.keyRef,
      resolverKind: input.metadata.resolverKind });
  } catch { answer = null; }
  if (!answer || typeof answer.reference !== 'string' || typeof answer.secret !== 'string') {
    fail('The external key resolver did not return usable material.', 'WORKER_KEY_RESOLVER_UNAVAILABLE', 503);
  }
  const expected = Buffer.from(digest(input.metadata.keyRef), 'hex');
  const actual = Buffer.from(digest(answer!.reference.trim()), 'hex');
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    fail('The external key resolver answered for an unapproved reference.',
      'WORKER_KEY_RESOLVER_REFERENCE_MISMATCH', 403);
  }
  if (answer!.secret.length < 32) {
    fail('The resolved worker key material is too weak to verify a credential.',
      'WORKER_KEY_RESOLVER_SECRET_TOO_WEAK', 403);
  }
  return answer!.secret;
}

export type SafetyCounterState = Readonly<{ limit: number; reservedQuantity: number; consumedQuantity: number }>;

const counterIsSane = (counters: SafetyCounterState) =>
  Number.isSafeInteger(counters.limit) && Number.isSafeInteger(counters.reservedQuantity)
  && Number.isSafeInteger(counters.consumedQuantity) && counters.limit >= 0 && counters.reservedQuantity >= 0
  && counters.consumedQuantity >= 0;

/**
 * Windows are fixed and epoch-aligned rather than sliding, so two workers whose
 * clocks disagree by milliseconds still land on the same counter row and contend
 * on it instead of quietly opening a second budget each.
 */
export function safetyWindowBounds(input: { at: string; windowSeconds: number }):
Readonly<{ periodStart: string; periodEnd: string }> {
  const at = instant(input.at);
  if (!Number.isFinite(at)) fail('A safety window needs a valid instant.', 'WORKER_SAFETY_WINDOW_INSTANT_INVALID');
  if (!Number.isSafeInteger(input.windowSeconds) || input.windowSeconds < 60 || input.windowSeconds > 2_678_400) {
    fail('A safety window must span between one minute and 31 days.', 'WORKER_SAFETY_WINDOW_SECONDS_INVALID');
  }
  const span = input.windowSeconds * 1000;
  const start = Math.floor(at / span) * span;
  return Object.freeze({ periodStart: new Date(start).toISOString(),
    periodEnd: new Date(start + span).toISOString() });
}

export function planCounterReservation(counters: SafetyCounterState): SafetyCounterState {
  if (!counterIsSane(counters)) {
    fail('The safety counters are not in a usable state.', 'WORKER_SAFETY_COUNTERS_INVALID', 409);
  }
  if (counters.reservedQuantity + counters.consumedQuantity >= counters.limit) {
    fail('The safety window has no capacity left to reserve.', 'WORKER_SAFETY_CAPACITY_EXHAUSTED', 409);
  }
  return Object.freeze({ ...counters, reservedQuantity: counters.reservedQuantity + 1 });
}

/**
 * Settlement never rewinds a consumed count. A release or an expiry hands the
 * held capacity back, so a crashed worker costs the tenant nothing but still
 * leaves a trace that it happened.
 */
export function planCounterSettlement(counters: SafetyCounterState,
  outcome: ReservationSettlement): SafetyCounterState {
  if (!counterIsSane(counters)) {
    fail('The safety counters are not in a usable state.', 'WORKER_SAFETY_COUNTERS_INVALID', 409);
  }
  if (counters.reservedQuantity < 1) {
    fail('There is no held safety capacity to settle.', 'WORKER_SAFETY_RESERVATION_MISSING', 409);
  }
  return Object.freeze({ ...counters, reservedQuantity: counters.reservedQuantity - 1,
    consumedQuantity: counters.consumedQuantity + (outcome === 'consumed' ? 1 : 0) });
}

const allowedReservationSettlements = Object.freeze(['consumed', 'released', 'expired'] as const);

/** Mirrors journey_action_worker_reservation_fence_guard. */
export function assertReservationSettlement(from: string, to: string): void {
  if (from !== 'reserved' || !allowedReservationSettlements.includes(to as ReservationSettlement)) {
    fail(`A reservation cannot move from ${from} to ${to}.`, 'WORKER_RESERVATION_TRANSITION_FORBIDDEN', 409);
  }
}

/** Mirrors the fence half of the same guard: a queue's tokens only ever climb. */
export function assertFenceAdvances(input: { highestSeen: number | null; proposed: number }): void {
  if (!Number.isSafeInteger(input.proposed) || input.proposed < 1) {
    fail('A fencing token must be a positive integer.', 'WORKER_RESERVATION_FENCE_INVALID');
  }
  if (input.highestSeen !== null && input.proposed <= input.highestSeen) {
    fail('A reservation cannot reuse or rewind a fencing token.', 'WORKER_RESERVATION_FENCE_REWOUND', 409);
  }
}

export type CanonicalSubjectControls = Readonly<{ consentState: string; suppressed: boolean;
  quietTimezone: string; quietStartMinute: number; quietEndMinute: number }> | null;
export type CanonicalSourceControls = Readonly<{ state: string }> | null;

export type CanonicalFactsInput = Readonly<{
  subject: CanonicalSubjectControls; source: CanonicalSourceControls; entitled: boolean | null;
  quota: SafetyCounterState; frequency: SafetyCounterState; frequencyPeriodEnd: string;
  killSwitchScope: JourneyKillSwitchScope; killSwitchRecords: readonly JourneyKillSwitchRecord[];
}>;

/**
 * Turns the canonical purpose-scoped rows into the live-fact shape the existing
 * worker gates consume. A missing binding becomes null or 'unknown' rather than a
 * permissive default: the gates read that as unknown and deny, which is the point.
 */
export function resolveCanonicalWorkerFacts(input: CanonicalFactsInput): WorkerLiveFacts {
  const consent: WorkerLiveFacts['consent'] = input.subject?.consentState === 'granted' ? 'granted'
    : input.subject?.consentState === 'denied' ? 'denied' : 'unknown';
  const sourceState: WorkerLiveFacts['sourceState'] = input.source?.state === 'active' ? 'active'
    : input.source?.state === 'paused' ? 'paused' : input.source?.state === 'retired' ? 'retired' : 'unknown';
  const quietHours = input.subject && Number.isInteger(input.subject.quietStartMinute)
    && Number.isInteger(input.subject.quietEndMinute)
    ? Object.freeze({ timezone: input.subject.quietTimezone, startMinute: input.subject.quietStartMinute,
      endMinute: input.subject.quietEndMinute })
    : null;
  return Object.freeze({
    consent, suppressed: input.subject ? Boolean(input.subject.suppressed) : null, entitled: input.entitled,
    quota: Object.freeze({ used: input.quota.consumedQuantity, reserved: input.quota.reservedQuantity,
      limit: input.quota.limit }),
    quietHours,
    frequency: Object.freeze({ observed: input.frequency.consumedQuantity + input.frequency.reservedQuantity,
      maximum: input.frequency.limit, windowEndsAt: input.frequencyPeriodEnd }),
    sourceState, killSwitchScope: input.killSwitchScope, killSwitchRecords: input.killSwitchRecords
  });
}

export function assertPurposeKey(purposeKey: string): string {
  if (typeof purposeKey !== 'string' || purposeKey.length < 1 || purposeKey.length > 128
    || looksLikeSecretMaterial(purposeKey)) {
    fail('A purpose key must be a short content-free label.', 'WORKER_SAFETY_PURPOSE_KEY_INVALID');
  }
  return purposeKey;
}

export function assertPseudonymousReference(value: string, code: string): string {
  if (typeof value !== 'string' || !hex64.test(value)) {
    fail('A pseudonymous reference digest is required.', code);
  }
  return value;
}

export function assertSafetyReasonCode(reasonCode: string): string {
  if (!reasonCodePattern.test(reasonCode)) {
    fail('A safety reason code must be a content-free upper-case token.', 'WORKER_SAFETY_REASON_CODE_INVALID');
  }
  return reasonCode;
}

/**
 * Content-free audit detail. Reserved keys and anything that reads as material
 * are refused outright rather than silently redacted, so a caller learns at the
 * boundary that it tried to write something it should never have held.
 */
export function buildSafetyAuditDetail(detail: Record<string, unknown>): Readonly<{ json: string; sha256: string }> {
  const forbidden = new Set(['secret', 'secretValue', 'secret_value', 'credential', 'token', 'password',
    'privateKey', 'private_key', 'apiKey', 'api_key', 'material', 'keyMaterial', 'key_material', 'keyRef',
    'key_ref', 'reference', 'payload', 'content', 'body', 'message', 'subject', 'subjectId', 'email',
    'identifier', 'recipient']);
  const entries = Object.entries(detail).sort(([left], [right]) => left.localeCompare(right));
  for (const [key, value] of entries) {
    if (forbidden.has(key) || (typeof value === 'string' && looksLikeSecretMaterial(value))) {
      fail('Safety audit detail cannot carry content or key material.', 'WORKER_SAFETY_AUDIT_DETAIL_FORBIDDEN');
    }
  }
  const json = JSON.stringify(Object.fromEntries(entries));
  if (Buffer.byteLength(json, 'utf8') > 2048) {
    fail('Safety audit detail is too large to be a summary.', 'WORKER_SAFETY_AUDIT_DETAIL_TOO_LARGE');
  }
  return Object.freeze({ json, sha256: digest(json) });
}

export const safetyDigest = digest;
