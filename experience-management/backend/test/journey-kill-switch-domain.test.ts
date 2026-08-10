import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertKillSwitchScope, buildKillSwitchAuditDetail, planKillSwitchPause, resolveEffectiveJourneyKillSwitch,
  resolveKillSwitchForWork
} from '../src/journeyKillSwitchDomain.js';

const scope = { spaceId: 'space-1', workflowId: 'workflow-1', adapter: 'assistant_action',
  profileId: 'a'.repeat(64) };
const record = (level: string, scopeRef: string, state: string) => ({ level, scopeRef, state,
  reasonCode: 'operational_incident', revision: 1, updatedAt: '2026-08-07T00:00:00.000Z' });

test('resolves all five levels in strongest-to-narrowest precedence', () => {
  const effective = resolveEffectiveJourneyKillSwitch({ scope, records: [
    record('profile', scope.profileId, 'disabled'), record('adapter', scope.adapter, 'disabled'),
    record('space', scope.spaceId, 'disabled')
  ] });
  assert.equal(effective.decision, 'deny');
  assert.equal(effective.blockedLevel, 'space');
  assert.deepEqual(effective.levels.map((level) => level.level),
    ['platform', 'space', 'workflow', 'adapter', 'profile']);
});

test('fails closed for missing scope, unknown adapter, unknown state and ambiguous records', () => {
  assert.equal(resolveEffectiveJourneyKillSwitch({ scope: { ...scope, workflowId: null }, records: [] }).decision, 'deny');
  assert.equal(resolveEffectiveJourneyKillSwitch({ scope: { ...scope, adapter: 'unreviewed' }, records: [] })
    .reasonCode, 'KILL_SWITCH_ADAPTER_UNKNOWN');
  assert.equal(resolveEffectiveJourneyKillSwitch({ scope, records: [record('platform', 'platform', 'corrupt')] })
    .reasonCode, 'KILL_SWITCH_STATE_UNKNOWN');
  const ambiguous = resolveEffectiveJourneyKillSwitch({ scope, records: [
    record('space', scope.spaceId, 'enabled'), record('space', scope.spaceId, 'disabled')
  ] });
  assert.equal(ambiguous.reasonCode, 'KILL_SWITCH_RECORD_AMBIGUOUS');
});

test('repository work resolver requires complete context and enforces reviewed adapter/profile scope', () => {
  const allow = resolveKillSwitchForWork({ ...scope, profileRefSha256: scope.profileId, records: {} });
  assert.equal(allow.decision, 'allow');
  assert.equal(resolveKillSwitchForWork({ spaceId: scope.spaceId, workflowId: scope.workflowId,
    adapter: null, profileRefSha256: scope.profileId, records: {} }).decision, 'deny');
  assert.throws(() => assertKillSwitchScope('adapter', 'email_reply', scope.spaceId), /not reviewed/u);
  assert.throws(() => assertKillSwitchScope('profile', 'raw-person-id', scope.spaceId), /SHA-256/u);
});

test('lease pause advances fencing and audit detail is immutable and content-safe', () => {
  const plan = planKillSwitchPause({ id: 'queue-1', state: 'leased', fencingToken: 8 });
  assert.deepEqual(plan, { action: 'release_and_pause', queueId: 'queue-1', previousState: 'leased',
    leaseReleased: true, nextFencingToken: 9 });
  const audit = buildKillSwitchAuditDetail({ level: 'profile', scopeKey: 'b'.repeat(64), state: 'disabled',
    reasonCode: 'safety_incident', revision: 1, pausedCount: 2, releasedLeaseCount: 1,
    resumedCount: 0, stillDisabledCount: 0 });
  assert.match(audit.detailSha256, /^[a-f0-9]{64}$/u);
  assert.equal(audit.serialized.includes('b'.repeat(64)), false);
  assert.throws(() => { (audit.detail as any).state = 'enabled'; }, TypeError);
});
