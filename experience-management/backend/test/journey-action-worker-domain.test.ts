import assert from 'node:assert/strict';
import test from 'node:test';
import { authenticateJourneyWorker, mintJourneyWorkerCredential, resolveJourneyWorkerGates,
  type WorkerLiveFacts } from '../src/journeyActionWorkerDomain.js';

const secret = 'worker-test-secret-that-is-at-least-32-bytes';
const now = '2026-08-08T12:00:00.000Z';
const allowFacts = (): WorkerLiveFacts => ({ consent: 'granted', suppressed: false, entitled: true,
  quota: { used: 1, reserved: 0, limit: 10 }, quietHours: { timezone: 'UTC', startMinute: 60, endMinute: 120 },
  frequency: { observed: 1, maximum: 3, windowEndsAt: '2026-08-09T00:00:00.000Z' }, sourceState: 'active',
  killSwitchScope: { spaceId: 'space-a', workflowId: 'workflow-a', adapter: 'assistant_action', profileId: 'profile-a' },
  killSwitchRecords: [] });

test('authenticates only signed, current, non-human worker credentials with scopes', () => {
  const token = mintJourneyWorkerCredential({ workerId: 'worker-a', allowedSpaceIds: ['space-a'],
    allowedAdapters: ['assistant_action'], issuedAt: '2026-08-08T11:00:00.000Z',
    expiresAt: '2026-08-08T13:00:00.000Z', keyId: 'key-a', secret });
  const authority = authenticateJourneyWorker({ credential: token, secretForKey: (key) => key === 'key-a' ? secret : null, now });
  assert.equal(authority.kind, 'journey_action_worker');
  assert.equal(authority.workerIdSha256.length, 64);
  assert.throws(() => authenticateJourneyWorker({ credential: token.slice(0, -1) + 'x', secretForKey: () => secret, now }),
    /authentication failed/i);
  assert.throws(() => authenticateJourneyWorker({ credential: token, secretForKey: () => secret,
    now: '2026-08-08T13:00:00.000Z' }), /not currently valid/i);
});

test('resolves every live gate in fixed precedence and fails closed on unknown evidence', () => {
  const allowed = resolveJourneyWorkerGates(allowFacts(), now);
  assert.equal(allowed.decision, 'allow'); assert.equal(allowed.gates.length, 12);
  const facts = { ...allowFacts(), consent: 'unknown' as const, suppressed: true,
    killSwitchRecords: [{ level: 'platform', scopeRef: 'platform', state: 'disabled', reasonCode: 'maintenance',
      revision: 1, updatedAt: now }] };
  const denied = resolveJourneyWorkerGates(facts, now);
  assert.equal(denied.decision, 'deny'); assert.equal(denied.blockedGate, 'consent');
  assert.equal(denied.reasonCode, 'CONSENT_UNKNOWN');
});

test('enforces overnight quiet hours and hard quota/frequency caps', () => {
  const quiet = resolveJourneyWorkerGates({ ...allowFacts(), quietHours: { timezone: 'UTC', startMinute: 22 * 60,
    endMinute: 6 * 60 } }, '2026-08-08T23:00:00.000Z');
  assert.equal(quiet.blockedGate, 'quiet_hours');
  const quota = resolveJourneyWorkerGates({ ...allowFacts(), quota: { used: 9, reserved: 1, limit: 10 } }, now);
  assert.equal(quota.blockedGate, 'quota');
  const frequency = resolveJourneyWorkerGates({ ...allowFacts(), frequency: { observed: 3, maximum: 3,
    windowEndsAt: '2026-08-09T00:00:00.000Z' } }, now);
  assert.equal(frequency.blockedGate, 'frequency_cap');
});
