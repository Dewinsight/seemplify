import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { resolveJourneyWorkerGates } from '../src/journeyActionWorkerDomain.js';
import {
  assertContentFreeKeyMetadata, assertFenceAdvances, assertPrincipalTransition, assertReservationSettlement,
  buildSafetyAuditDetail, JourneyActionWorkerSafetyError, looksLikeSecretMaterial, planCounterReservation,
  planCounterSettlement, planPrincipalRevocation, planPrincipalRotation, resolveCanonicalWorkerFacts,
  resolverKindForKeyRef, resolveServicePrincipalSecret, safetyWindowBounds,
  type CanonicalFactsInput, type WorkerKeySecretResolver
} from '../src/journeyActionWorkerSafetyDomain.js';

const now = '2026-08-08T12:00:00.000Z';
const material = 'worker-key-material-that-is-long-enough';
const metadata = (overrides: Partial<Parameters<typeof assertContentFreeKeyMetadata>[0]> = {}) =>
  assertContentFreeKeyMetadata({ principalId: 'principal-a', keyId: 'key-a', keyRef: 'kms://workers/key-a',
    notBefore: '2026-08-08T00:00:00.000Z', expiresAt: '2026-08-09T00:00:00.000Z', ...overrides });
const resolver = (answer: { reference: string; secret: string } | null): WorkerKeySecretResolver =>
  ({ resolve: async () => answer });
const code = async (run: () => unknown): Promise<string> => {
  try { await run(); return 'NO_ERROR'; } catch (error) {
    return error instanceof JourneyActionWorkerSafetyError ? error.code : `UNEXPECTED_${String(error)}`;
  }
};

test('key metadata stays content-free and must name an external resolver', () => {
  const key = metadata();
  assert.equal(key.resolverKind, 'external_kms');
  assert.equal(resolverKindForKeyRef('vault://team/worker'), 'external_vault');
  assert.equal(resolverKindForKeyRef('file:///run/secrets/worker'), 'external_file');
  assert.deepEqual(Object.keys(key).sort(),
    ['expiresAt', 'keyId', 'keyRef', 'notBefore', 'principalId', 'resolverKind', 'revision', 'state']);
  assert.equal(looksLikeSecretMaterial('a'.repeat(64)), true);
  assert.equal(looksLikeSecretMaterial('-----BEGIN PRIVATE KEY-----'), true);
  assert.equal(looksLikeSecretMaterial('kms://workers/key-a'), false);
});

test('key metadata refuses smuggled material, bare references, and inverted validity', async () => {
  assert.equal(await code(() => metadata({ keyId: 'f'.repeat(64) })), 'WORKER_KEY_ID_INVALID');
  assert.equal(await code(() => metadata({ keyRef: 'workers-key-a' })), 'WORKER_KEY_RESOLVER_KIND_INVALID');
  assert.equal(await code(() => metadata({ keyRef: 'a'.repeat(64) })), 'WORKER_KEY_REF_INVALID');
  assert.equal(await code(() => metadata({ expiresAt: '2026-08-07T00:00:00.000Z' })),
    'WORKER_PRINCIPAL_VALIDITY_INVALID');
});

test('key material resolves only from an approved external reference and never persists', async () => {
  const secret = await resolveServicePrincipalSecret({ metadata: metadata(),
    resolver: resolver({ reference: 'kms://workers/key-a', secret: material }), now });
  assert.equal(secret, material);
  assert.equal(await code(() => resolveServicePrincipalSecret({ metadata: metadata(),
    resolver: resolver({ reference: 'kms://workers/attacker', secret: material }), now })),
  'WORKER_KEY_RESOLVER_REFERENCE_MISMATCH');
  assert.equal(await code(() => resolveServicePrincipalSecret({ metadata: metadata(),
    resolver: resolver(null), now })), 'WORKER_KEY_RESOLVER_UNAVAILABLE');
  assert.equal(await code(() => resolveServicePrincipalSecret({ metadata: metadata(),
    resolver: resolver({ reference: 'kms://workers/key-a', secret: 'short' }), now })),
  'WORKER_KEY_RESOLVER_SECRET_TOO_WEAK');
  assert.equal(await code(() => resolveServicePrincipalSecret({ metadata: metadata({ state: 'revoked' }),
    resolver: resolver({ reference: 'kms://workers/key-a', secret: material }), now })),
  'WORKER_PRINCIPAL_REVOKED');
  assert.equal(await code(() => resolveServicePrincipalSecret({ metadata: metadata(),
    resolver: resolver({ reference: 'kms://workers/key-a', secret: material }),
    now: '2026-08-10T00:00:00.000Z' })), 'WORKER_PRINCIPAL_OUTSIDE_VALIDITY');
  assert.equal(await code(() => resolveServicePrincipalSecret({ metadata: metadata(),
    resolver: { resolve: async () => { throw new Error('kms unreachable'); } }, now })),
  'WORKER_KEY_RESOLVER_UNAVAILABLE');
});

test('a draining principal still resolves so a held lease can settle', async () => {
  assert.equal(await resolveServicePrincipalSecret({ metadata: metadata({ state: 'draining' }),
    resolver: resolver({ reference: 'kms://workers/key-a', secret: material }), now }), material);
});

test('rotation drains rather than kills, and revocation is terminal', async () => {
  const plan = planPrincipalRotation({ outgoing: { principalId: 'principal-a', state: 'active' },
    replacement: { principalId: 'principal-b' } });
  assert.deepEqual(plan.map((step) => [step.principalId, step.toState, step.action]),
    [['principal-a', 'draining', 'draining'], ['principal-b', 'active', 'rotated']]);
  assert.equal(planPrincipalRevocation({ principalId: 'principal-a', state: 'draining' }).toState, 'revoked');
  assert.equal(await code(() => assertPrincipalTransition('revoked', 'active')),
    'WORKER_PRINCIPAL_TRANSITION_FORBIDDEN');
  assert.equal(await code(() => assertPrincipalTransition('draining', 'active')),
    'WORKER_PRINCIPAL_TRANSITION_FORBIDDEN');
  assert.equal(await code(() => planPrincipalRotation({ outgoing: { principalId: 'principal-a', state: 'revoked' },
    replacement: { principalId: 'principal-b' } })), 'WORKER_PRINCIPAL_TRANSITION_FORBIDDEN');
});

test('windows are epoch-aligned so disagreeing clocks contend on one counter row', async () => {
  const early = safetyWindowBounds({ at: '2026-08-08T12:34:56.789Z', windowSeconds: 86_400 });
  const late = safetyWindowBounds({ at: '2026-08-08T12:34:56.790Z', windowSeconds: 86_400 });
  assert.deepEqual({ ...early }, { periodStart: '2026-08-08T00:00:00.000Z', periodEnd: '2026-08-09T00:00:00.000Z' });
  assert.deepEqual({ ...late }, { ...early });
  assert.equal(safetyWindowBounds({ at: now, windowSeconds: 3600 }).periodStart, '2026-08-08T12:00:00.000Z');
  assert.equal(await code(() => safetyWindowBounds({ at: now, windowSeconds: 30 })),
    'WORKER_SAFETY_WINDOW_SECONDS_INVALID');
  assert.equal(await code(() => safetyWindowBounds({ at: 'not-a-time', windowSeconds: 3600 })),
    'WORKER_SAFETY_WINDOW_INSTANT_INVALID');
});

test('counters admit exactly the cap and never rewind settled consumption', async () => {
  const empty = { limit: 2, reservedQuantity: 0, consumedQuantity: 0 };
  const held = planCounterReservation(empty);
  assert.deepEqual({ ...held }, { limit: 2, reservedQuantity: 1, consumedQuantity: 0 });
  assert.deepEqual({ ...planCounterSettlement(held, 'consumed') },
    { limit: 2, reservedQuantity: 0, consumedQuantity: 1 });
  for (const outcome of ['released', 'expired'] as const) {
    assert.deepEqual({ ...planCounterSettlement(held, outcome) },
      { limit: 2, reservedQuantity: 0, consumedQuantity: 0 });
  }
  assert.equal(await code(() => planCounterReservation({ limit: 1, reservedQuantity: 0, consumedQuantity: 1 })),
    'WORKER_SAFETY_CAPACITY_EXHAUSTED');
  assert.equal(await code(() => planCounterReservation({ limit: 2, reservedQuantity: 1, consumedQuantity: 1 })),
    'WORKER_SAFETY_CAPACITY_EXHAUSTED');
  assert.equal(await code(() => planCounterSettlement(empty, 'consumed')), 'WORKER_SAFETY_RESERVATION_MISSING');
  assert.equal(await code(() => planCounterReservation({ limit: 2, reservedQuantity: -1, consumedQuantity: 0 })),
    'WORKER_SAFETY_COUNTERS_INVALID');
});

test('fences only climb and a reservation settles exactly once', async () => {
  assertFenceAdvances({ highestSeen: null, proposed: 1 });
  assertFenceAdvances({ highestSeen: 1, proposed: 2 });
  assert.equal(await code(() => assertFenceAdvances({ highestSeen: 2, proposed: 2 })),
    'WORKER_RESERVATION_FENCE_REWOUND');
  assert.equal(await code(() => assertFenceAdvances({ highestSeen: 2, proposed: 1 })),
    'WORKER_RESERVATION_FENCE_REWOUND');
  assert.equal(await code(() => assertFenceAdvances({ highestSeen: null, proposed: 0 })),
    'WORKER_RESERVATION_FENCE_INVALID');
  for (const outcome of ['consumed', 'released', 'expired']) assertReservationSettlement('reserved', outcome);
  assert.equal(await code(() => assertReservationSettlement('consumed', 'released')),
    'WORKER_RESERVATION_TRANSITION_FORBIDDEN');
  assert.equal(await code(() => assertReservationSettlement('reserved', 'reserved')),
    'WORKER_RESERVATION_TRANSITION_FORBIDDEN');
});

const facts = (overrides: Partial<CanonicalFactsInput> = {}): CanonicalFactsInput => ({
  subject: { consentState: 'granted', suppressed: false, quietTimezone: 'UTC', quietStartMinute: 60,
    quietEndMinute: 120 },
  source: { state: 'active' }, entitled: true,
  quota: { limit: 10, reservedQuantity: 0, consumedQuantity: 1 },
  frequency: { limit: 3, reservedQuantity: 0, consumedQuantity: 1 },
  frequencyPeriodEnd: '2026-08-09T00:00:00.000Z',
  killSwitchScope: { spaceId: 'space-a', workflowId: 'workflow-a', adapter: 'assistant_action',
    profileId: 'profile-a' },
  killSwitchRecords: [], ...overrides
});

test('canonical purpose-scoped bindings resolve every live gate', () => {
  const resolved = resolveJourneyWorkerGates(resolveCanonicalWorkerFacts(facts()), now);
  assert.equal(resolved.decision, 'allow');
  assert.equal(resolved.gates.length, 12);
});

test('a missing canonical binding is unknown evidence and denies', () => {
  assert.equal(resolveJourneyWorkerGates(resolveCanonicalWorkerFacts(facts({ subject: null })), now).blockedGate,
    'consent');
  assert.equal(resolveJourneyWorkerGates(resolveCanonicalWorkerFacts(facts({ source: null })), now).blockedGate,
    'source_state');
  assert.equal(resolveJourneyWorkerGates(resolveCanonicalWorkerFacts(facts({ entitled: null })), now).blockedGate,
    'entitlement');
  const unknownConsent = resolveCanonicalWorkerFacts(facts({
    subject: { consentState: 'unknown', suppressed: false, quietTimezone: 'UTC', quietStartMinute: 60,
      quietEndMinute: 120 } }));
  assert.equal(unknownConsent.consent, 'unknown');
  assert.equal(resolveJourneyWorkerGates(unknownConsent, now).reasonCode, 'CONSENT_UNKNOWN');
});

test('suppression, quiet hours, quota and per-profile frequency each block on their own', () => {
  const suppressed = facts({ subject: { consentState: 'granted', suppressed: true, quietTimezone: 'UTC',
    quietStartMinute: 60, quietEndMinute: 120 } });
  assert.equal(resolveJourneyWorkerGates(resolveCanonicalWorkerFacts(suppressed), now).blockedGate, 'suppression');
  const quiet = facts({ subject: { consentState: 'granted', suppressed: false, quietTimezone: 'UTC',
    quietStartMinute: 22 * 60, quietEndMinute: 6 * 60 } });
  assert.equal(resolveJourneyWorkerGates(resolveCanonicalWorkerFacts(quiet), '2026-08-08T23:00:00.000Z').blockedGate,
    'quiet_hours');
  const exhausted = facts({ quota: { limit: 2, reservedQuantity: 1, consumedQuantity: 1 } });
  assert.equal(resolveJourneyWorkerGates(resolveCanonicalWorkerFacts(exhausted), now).blockedGate, 'quota');
  const capped = facts({ frequency: { limit: 2, reservedQuantity: 1, consumedQuantity: 1 } });
  assert.equal(resolveJourneyWorkerGates(resolveCanonicalWorkerFacts(capped), now).blockedGate, 'frequency_cap');
});

test('held frequency capacity counts against the cap before it is consumed', () => {
  const resolved = resolveCanonicalWorkerFacts(facts({
    frequency: { limit: 3, reservedQuantity: 2, consumedQuantity: 0 } }));
  assert.equal(resolved.frequency?.observed, 2);
  assert.equal(resolved.quota?.used, 1);
  assert.equal(resolved.quota?.reserved, 0);
});

test('audit detail refuses content and key material and digests deterministically', async () => {
  const detail = buildSafetyAuditDetail({ revision: 2, action: 'rotated' });
  assert.equal(detail.json, '{"action":"rotated","revision":2}');
  assert.equal(detail.sha256, crypto.createHash('sha256').update(detail.json).digest('hex'));
  assert.deepEqual({ ...buildSafetyAuditDetail({ action: 'rotated', revision: 2 }) }, { ...detail });
  for (const forbidden of ['secret', 'credential', 'token', 'keyRef', 'recipient', 'email', 'payload']) {
    assert.equal(await code(() => buildSafetyAuditDetail({ [forbidden]: 'x' })),
      'WORKER_SAFETY_AUDIT_DETAIL_FORBIDDEN');
  }
  assert.equal(await code(() => buildSafetyAuditDetail({ note: 'a'.repeat(64) })),
    'WORKER_SAFETY_AUDIT_DETAIL_FORBIDDEN');
  assert.equal(await code(() => buildSafetyAuditDetail({ note: 'note '.repeat(600) })),
    'WORKER_SAFETY_AUDIT_DETAIL_TOO_LARGE');
});
