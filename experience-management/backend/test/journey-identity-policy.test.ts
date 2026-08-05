import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyJourneyIdentityCommand,
  createJourneyIdentityStateV1,
  JOURNEY_IDENTITY_POLICY_VERSION,
  JOURNEY_IDENTITY_STATE_VERSION,
  resolveJourneyIdentity,
  type JourneyIdentityActor,
  type JourneyIdentityCommand,
  type JourneyIdentityIdentifier,
  type JourneyIdentityPermission,
  type JourneyIdentityStateV1
} from '../src/journeyIdentityPolicy.js';

const allPermissions: JourneyIdentityPermission[] = [
  'identity:observe', 'identity:identify', 'identity:alias', 'identity:merge',
  'identity:split', 'identity:membership', 'identity:delete'
];

function actor(spaceId: string, permissions: JourneyIdentityPermission[] = allPermissions): JourneyIdentityActor {
  return { actorId: `actor:${spaceId}`, spaceId, authenticated: true, permissions };
}

function exact(kind: 'anonymous_id' | 'authenticated_user_id' | 'external_user_id', value: string): JourneyIdentityIdentifier {
  return { kind, namespace: 'golden-fixture', value };
}

function apply(state: JourneyIdentityStateV1, command: JourneyIdentityCommand) {
  return applyJourneyIdentityCommand(state, command);
}

function observe(
  state: JourneyIdentityStateV1,
  spaceId: string,
  commandId: string,
  profileId: string,
  profileKind: 'anonymous' | 'known',
  identifier: JourneyIdentityIdentifier
) {
  return apply(state, {
    policyVersion: JOURNEY_IDENTITY_POLICY_VERSION,
    type: 'observe', commandId, spaceId, occurredAt: `2026-08-04T10:${commandId.slice(-2).padStart(2, '0')}:00.000Z`,
    actor: actor(spaceId), profileId, profileKind, identifier,
    sourceFact: { factId: `fact:${spaceId}:${commandId}`, source: 'golden-test', sourceRef: `event:${commandId}`,
      occurredAt: '2026-08-04T10:00:00.000Z' }
  });
}

test('golden: anonymous and known bindings are exact and isolated by space', () => {
  let state = createJourneyIdentityStateV1();
  state = observe(state, 'space-a', 'observe-01', 'anon-a', 'anonymous', exact('anonymous_id', 'same-value')).state;
  state = observe(state, 'space-b', 'observe-02', 'anon-b', 'anonymous', exact('anonymous_id', 'same-value')).state;
  state = observe(state, 'space-a', 'observe-03', 'known-a', 'known', exact('external_user_id', 'crm-41')).state;

  assert.deepEqual(resolveJourneyIdentity(state, 'space-a', exact('anonymous_id', 'same-value')), {
    policyVersion: 'journey.identity-policy.v1', stateVersion: 'journey.identity-state.v1',
    status: 'resolved', code: 'exact_match',
    explanation: 'Resolved one exact, space-scoped anonymous_id; no heuristic matching was used.',
    spaceId: 'space-a', boundProfileId: 'anon-a', canonicalProfileId: 'anon-a'
  });
  assert.equal(resolveJourneyIdentity(state, 'space-b', exact('anonymous_id', 'same-value')).canonicalProfileId, 'anon-b');
  assert.equal(resolveJourneyIdentity(state, 'space-b', exact('external_user_id', 'crm-41')).status, 'not_found');
  assert.equal(state.profiles[JSON.stringify(['space-a', 'known-a'])].kind, 'known');
});

test('golden: authenticated identify promotes one profile but never implicitly merges a conflict', () => {
  let state = createJourneyIdentityStateV1();
  state = observe(state, 'space-a', 'observe-11', 'anon-1', 'anonymous', exact('anonymous_id', 'session-1')).state;
  state = observe(state, 'space-a', 'observe-12', 'anon-2', 'anonymous', exact('anonymous_id', 'session-2')).state;

  const first = apply(state, {
    policyVersion: JOURNEY_IDENTITY_POLICY_VERSION,
    type: 'identify', commandId: 'identify-1', spaceId: 'space-a', occurredAt: '2026-08-04T11:00:00.000Z',
    actor: actor('space-a', ['identity:identify']), profile: { spaceId: 'space-a', profileId: 'anon-1' },
    identifier: exact('authenticated_user_id', 'auth-91'),
    sourceFact: { factId: 'fact:identify-1', source: 'auth-service', sourceRef: 'login:91',
      occurredAt: '2026-08-04T10:59:58.000Z' }
  });
  state = first.state;
  assert.deepEqual({
    status: first.result.status, code: first.result.code, profile: first.result.resolvedProfileId,
    canonical: first.result.canonicalProfileId, sourceFact: first.result.sourceFactId,
    explanation: first.result.explanation
  }, {
    status: 'accepted', code: 'profile_identified', profile: 'anon-1', canonical: 'anon-1',
    sourceFact: 'fact:identify-1',
    explanation: 'Authenticated identify promoted profile anon-1 to known; no implicit profile merge was performed.'
  });
  assert.equal(state.profiles[JSON.stringify(['space-a', 'anon-1'])].kind, 'known');

  const conflict = apply(state, {
    policyVersion: JOURNEY_IDENTITY_POLICY_VERSION,
    type: 'identify', commandId: 'identify-2', spaceId: 'space-a', occurredAt: '2026-08-04T11:01:00.000Z',
    actor: actor('space-a', ['identity:identify']), profile: { spaceId: 'space-a', profileId: 'anon-2' },
    identifier: exact('authenticated_user_id', 'auth-91'),
    sourceFact: { factId: 'fact:identify-2', source: 'auth-service', sourceRef: 'login:92',
      occurredAt: '2026-08-04T11:00:58.000Z' }
  });
  assert.deepEqual({ status: conflict.result.status, code: conflict.result.code, outcome: conflict.result.audit.outcome },
    { status: 'rejected', code: 'identifier_conflict', outcome: 'rejected' });
  assert.match(conflict.result.explanation, /fails closed and does not merge/u);
  assert.equal(resolveJourneyIdentity(conflict.state, 'space-a', exact('anonymous_id', 'session-2')).canonicalProfileId, 'anon-2');
  assert.equal(conflict.state.sourceFacts.some((fact) => fact.factId === 'fact:identify-2'), false);
});

test('golden: privileged alias, merge, replay, and split are explicit and reversible without rewriting facts', () => {
  let state = createJourneyIdentityStateV1();
  state = observe(state, 'space-a', 'observe-21', 'profile-left', 'known', exact('external_user_id', 'crm-left')).state;
  state = observe(state, 'space-a', 'observe-22', 'profile-right', 'known', exact('external_user_id', 'crm-right')).state;

  const alias = apply(state, {
    policyVersion: JOURNEY_IDENTITY_POLICY_VERSION,
    type: 'alias', commandId: 'alias-1', spaceId: 'space-a', occurredAt: '2026-08-04T12:00:00.000Z',
    actor: actor('space-a', ['identity:alias']), profile: { spaceId: 'space-a', profileId: 'profile-left' },
    identifier: exact('external_user_id', 'billing-left'), reason: 'Verified billing-system migration ticket ID-41.'
  });
  state = alias.state;
  assert.equal(alias.result.code, 'identifier_aliased');

  const mergeCommand: JourneyIdentityCommand = {
    policyVersion: JOURNEY_IDENTITY_POLICY_VERSION,
    type: 'merge', commandId: 'merge-1', spaceId: 'space-a', occurredAt: '2026-08-04T12:01:00.000Z',
    actor: actor('space-a', ['identity:merge']),
    source: { spaceId: 'space-a', profileId: 'profile-left' },
    target: { spaceId: 'space-a', profileId: 'profile-right' },
    reason: 'Support verified both account records with the customer.'
  };
  const beforeFacts = structuredClone(state.sourceFacts);
  const merged = apply(state, mergeCommand);
  state = merged.state;
  assert.deepEqual({
    code: merged.result.code, source: merged.result.resolvedProfileId,
    canonical: merged.result.canonicalProfileId, mergeAuditId: merged.result.mergeAuditId,
    mergeExplanation: merged.result.explanation
  }, {
    code: 'profiles_merged', source: 'profile-left', canonical: 'profile-right',
    mergeAuditId: 'identity-merge:space-a:merge-1',
    mergeExplanation: 'Privileged merge now resolves profile-left to profile-right. Original profiles, bindings, and source facts remain unchanged.'
  });
  assert.deepEqual(state.sourceFacts, beforeFacts);
  assert.equal(resolveJourneyIdentity(state, 'space-a', exact('external_user_id', 'crm-left')).boundProfileId, 'profile-left');
  assert.equal(resolveJourneyIdentity(state, 'space-a', exact('external_user_id', 'crm-left')).canonicalProfileId, 'profile-right');

  const auditCount = state.auditFacts.length;
  const replayed = apply(state, mergeCommand);
  assert.strictEqual(replayed.state, state);
  assert.deepEqual({ status: replayed.result.status, code: replayed.result.code,
    replayedOutcome: replayed.result.replayedOutcome, replayedCode: replayed.result.replayedCode }, {
    status: 'replayed', code: 'idempotent_replay', replayedOutcome: 'accepted', replayedCode: 'profiles_merged'
  });
  assert.equal(replayed.state.auditFacts.length, auditCount);

  const split = apply(state, {
    policyVersion: JOURNEY_IDENTITY_POLICY_VERSION,
    type: 'split', commandId: 'split-1', spaceId: 'space-a', occurredAt: '2026-08-04T12:02:00.000Z',
    actor: actor('space-a', ['identity:split']), mergeAuditId: merged.result.mergeAuditId!,
    reason: 'Customer supplied evidence that the records belong to different people.'
  });
  assert.equal(split.result.code, 'merge_split');
  assert.equal(resolveJourneyIdentity(split.state, 'space-a', exact('external_user_id', 'crm-left')).canonicalProfileId, 'profile-left');
  assert.deepEqual(split.state.merges[merged.result.mergeAuditId!], {
    mergeAuditId: 'identity-merge:space-a:merge-1', spaceId: 'space-a',
    sourceProfileId: 'profile-left', targetProfileId: 'profile-right', canonicalTargetProfileId: 'profile-right',
    reason: 'Support verified both account records with the customer.', active: false,
    mergedAt: '2026-08-04T12:01:00.000Z', mergedByCommandId: 'merge-1',
    splitAt: '2026-08-04T12:02:00.000Z', splitByCommandId: 'split-1'
  });
  assert.equal(split.state.auditFacts.some((fact) => fact.code === 'profiles_merged'), true);
  assert.equal(split.state.auditFacts.some((fact) => fact.code === 'merge_split'), true);
});

test('golden: email, name, IP, and device signals are rejected rather than heuristically merged', () => {
  let state = createJourneyIdentityStateV1();
  state = observe(state, 'space-a', 'observe-31', 'known-1', 'known', exact('external_user_id', 'known-1')).state;
  for (const [index, identifier] of ([
    { kind: 'email', namespace: 'crm', value: 'person@example.test' },
    { kind: 'name', namespace: 'crm', value: 'Sam Example' },
    { kind: 'ip_address', namespace: 'web', value: '192.0.2.2' },
    { kind: 'device_id', namespace: 'mobile', value: 'device-1' },
    { kind: 'device_fingerprint', namespace: 'fraud', value: 'fingerprint-1' }
  ] satisfies JourneyIdentityIdentifier[]).entries()) {
    const transition = apply(state, {
      policyVersion: JOURNEY_IDENTITY_POLICY_VERSION,
      type: 'alias', commandId: `heuristic-${index}`, spaceId: 'space-a',
      occurredAt: `2026-08-04T13:0${index}:00.000Z`, actor: actor('space-a', ['identity:alias']),
      profile: { spaceId: 'space-a', profileId: 'known-1' }, identifier,
      reason: 'Attempted fuzzy match.'
    });
    assert.deepEqual({ status: transition.result.status, code: transition.result.code,
      kind: transition.result.audit.details.identifierKind }, {
      status: 'rejected', code: 'heuristic_identifier_forbidden', kind: identifier.kind
    });
    assert.match(transition.result.explanation, /cannot be used to resolve, alias, or merge profiles/u);
    state = transition.state;
  }
  assert.equal(Object.keys(state.bindings).length, 1);
  assert.equal(resolveJourneyIdentity(state, 'space-a', {
    kind: 'email', namespace: 'crm', value: 'person@example.test'
  }).status, 'rejected');
});

test('golden: profile and group references cannot cross spaces and unprivileged merges are denied', () => {
  let state = createJourneyIdentityStateV1();
  state = observe(state, 'space-a', 'observe-41', 'profile-a', 'known', exact('external_user_id', 'a')).state;
  state = observe(state, 'space-b', 'observe-42', 'profile-b', 'known', exact('external_user_id', 'b')).state;

  const crossSpace = apply(state, {
    policyVersion: JOURNEY_IDENTITY_POLICY_VERSION,
    type: 'merge', commandId: 'merge-cross-space', spaceId: 'space-a', occurredAt: '2026-08-04T14:00:00.000Z',
    actor: actor('space-a', ['identity:merge']), source: { spaceId: 'space-a', profileId: 'profile-a' },
    target: { spaceId: 'space-b', profileId: 'profile-b' }, reason: 'Invalid cross-space attempt.'
  });
  assert.deepEqual({ status: crossSpace.result.status, code: crossSpace.result.code,
    referencedSpaceId: crossSpace.result.audit.details.referencedSpaceId }, {
    status: 'rejected', code: 'cross_space_reference', referencedSpaceId: 'space-b'
  });

  const denied = apply(crossSpace.state, {
    policyVersion: JOURNEY_IDENTITY_POLICY_VERSION,
    type: 'merge', commandId: 'merge-denied', spaceId: 'space-a', occurredAt: '2026-08-04T14:01:00.000Z',
    actor: actor('space-a', []), source: { spaceId: 'space-a', profileId: 'profile-a' },
    target: { spaceId: 'space-a', profileId: 'profile-a' }, reason: 'No privilege.'
  });
  assert.equal(denied.result.code, 'permission_denied');
  assert.equal(Object.keys(denied.state.merges).length, 0);

  const groupCrossSpace = apply(denied.state, {
    policyVersion: JOURNEY_IDENTITY_POLICY_VERSION,
    type: 'add_membership', commandId: 'membership-cross', spaceId: 'space-a', occurredAt: '2026-08-04T14:02:00.000Z',
    actor: actor('space-a', ['identity:membership']), profile: { spaceId: 'space-a', profileId: 'profile-a' },
    group: { spaceId: 'space-b', groupType: 'account', groupId: 'account-b' },
    sourceFact: { factId: 'fact:membership-cross', source: 'crm', sourceRef: 'account:b',
      occurredAt: '2026-08-04T14:01:59.000Z' }
  });
  assert.equal(groupCrossSpace.result.code, 'cross_space_reference');
});

test('golden: memberships require a known profile and retain their source fact after removal', () => {
  let state = createJourneyIdentityStateV1();
  state = observe(state, 'space-a', 'observe-51', 'anonymous', 'anonymous', exact('anonymous_id', 'anon-51')).state;
  state = observe(state, 'space-a', 'observe-52', 'known', 'known', exact('external_user_id', 'known-52')).state;

  const anonymous = apply(state, {
    policyVersion: JOURNEY_IDENTITY_POLICY_VERSION,
    type: 'add_membership', commandId: 'membership-anon', spaceId: 'space-a', occurredAt: '2026-08-04T15:00:00.000Z',
    actor: actor('space-a', ['identity:membership']), profile: { spaceId: 'space-a', profileId: 'anonymous' },
    group: { spaceId: 'space-a', groupType: 'account', groupId: 'account-1' },
    sourceFact: { factId: 'fact:membership-anon', source: 'crm', sourceRef: 'account:1',
      occurredAt: '2026-08-04T14:59:59.000Z' }
  });
  assert.equal(anonymous.result.code, 'anonymous_membership_forbidden');

  const added = apply(anonymous.state, {
    policyVersion: JOURNEY_IDENTITY_POLICY_VERSION,
    type: 'add_membership', commandId: 'membership-known', spaceId: 'space-a', occurredAt: '2026-08-04T15:01:00.000Z',
    actor: actor('space-a', ['identity:membership']), profile: { spaceId: 'space-a', profileId: 'known' },
    group: { spaceId: 'space-a', groupType: 'account', groupId: 'account-1' },
    sourceFact: { factId: 'fact:membership-known', source: 'crm', sourceRef: 'account:1/member:known',
      occurredAt: '2026-08-04T15:00:59.000Z' }
  });
  assert.deepEqual({ code: added.result.code, membershipId: added.result.membershipId,
    sourceFactId: added.result.sourceFactId }, {
    code: 'membership_added', membershipId: 'identity-membership:space-a:membership-known',
    sourceFactId: 'fact:membership-known'
  });
  const factBefore = structuredClone(added.state.sourceFacts.find((fact) => fact.factId === 'fact:membership-known'));

  const removed = apply(added.state, {
    policyVersion: JOURNEY_IDENTITY_POLICY_VERSION,
    type: 'remove_membership', commandId: 'membership-remove', spaceId: 'space-a',
    occurredAt: '2026-08-04T15:02:00.000Z', actor: actor('space-a', ['identity:membership']),
    membershipId: added.result.membershipId!, reason: 'CRM membership ended.'
  });
  assert.equal(removed.result.code, 'membership_removed');
  assert.equal(Object.values(removed.state.memberships)[0].active, false);
  assert.deepEqual(removed.state.sourceFacts.find((fact) => fact.factId === 'fact:membership-known'), factBefore);
});

test('golden: deletion tombstones a merged identity and prevents delayed resurrection', () => {
  let state = createJourneyIdentityStateV1();
  state = observe(state, 'space-a', 'observe-61', 'old-session', 'anonymous', exact('anonymous_id', 'old-session-id')).state;
  state = observe(state, 'space-a', 'observe-62', 'known-user', 'known', exact('external_user_id', 'customer-62')).state;
  state = apply(state, {
    policyVersion: JOURNEY_IDENTITY_POLICY_VERSION,
    type: 'merge', commandId: 'merge-61', spaceId: 'space-a', occurredAt: '2026-08-04T16:00:00.000Z',
    actor: actor('space-a', ['identity:merge']), source: { spaceId: 'space-a', profileId: 'old-session' },
    target: { spaceId: 'space-a', profileId: 'known-user' }, reason: 'Authenticated ownership was manually verified.'
  }).state;
  const sourceFactsBeforeDelete = structuredClone(state.sourceFacts);

  const deleted = apply(state, {
    policyVersion: JOURNEY_IDENTITY_POLICY_VERSION,
    type: 'delete', commandId: 'delete-61', spaceId: 'space-a', occurredAt: '2026-08-04T16:01:00.000Z',
    actor: actor('space-a', ['identity:delete']), profile: { spaceId: 'space-a', profileId: 'known-user' },
    reason: 'Verified data-subject deletion request DSR-61.'
  });
  assert.deepEqual(deleted.result.audit.details.profileIds, ['known-user', 'old-session']);
  assert.equal(Object.keys(deleted.state.profileTombstones).length, 2);
  assert.equal(Object.keys(deleted.state.identifierTombstones).length, 2);
  assert.deepEqual(deleted.state.sourceFacts, sourceFactsBeforeDelete);

  assert.deepEqual(resolveJourneyIdentity(deleted.state, 'space-a', exact('anonymous_id', 'old-session-id')), {
    policyVersion: 'journey.identity-policy.v1', stateVersion: 'journey.identity-state.v1',
    status: 'deleted', code: 'profile_deleted_tombstone',
    explanation: 'Exact identifier is tombstoned; delayed records cannot recreate the identity.',
    spaceId: 'space-a', boundProfileId: 'old-session'
  });

  const delayed = observe(deleted.state, 'space-a', 'observe-63', 'old-session', 'anonymous',
    exact('anonymous_id', 'old-session-id'));
  assert.equal(delayed.result.code, 'profile_deleted_tombstone');
  assert.match(delayed.result.explanation, /delayed data cannot resurrect/u);
  assert.deepEqual(delayed.state.sourceFacts, sourceFactsBeforeDelete);
});

test('golden: command ids are idempotent but cannot be reused with a changed payload', () => {
  const initial = createJourneyIdentityStateV1();
  const command: JourneyIdentityCommand = {
    policyVersion: JOURNEY_IDENTITY_POLICY_VERSION,
    type: 'observe', commandId: 'stable-command', spaceId: 'space-a', occurredAt: '2026-08-04T17:00:00.000Z',
    actor: actor('space-a', ['identity:observe']), profileId: 'stable-profile', profileKind: 'anonymous',
    identifier: exact('anonymous_id', 'stable-id'),
    sourceFact: { factId: 'fact:stable', source: 'sdk', sourceRef: 'event:stable',
      occurredAt: '2026-08-04T16:59:59.000Z' }
  };
  const first = apply(initial, command);
  const replay = apply(first.state, command);
  assert.strictEqual(replay.state, first.state);
  assert.equal(replay.result.code, 'idempotent_replay');

  const conflict = apply(first.state, { ...command, profileId: 'changed-profile' });
  assert.strictEqual(conflict.state, first.state);
  assert.deepEqual({ status: conflict.result.status, code: conflict.result.code,
    auditStored: conflict.state.auditFacts.some((fact) => fact.auditId.endsWith(':command-id-conflict')) }, {
    status: 'rejected', code: 'command_id_conflict', auditStored: false
  });
  assert.equal(Object.keys(conflict.state.profiles).length, 1);
});

test('golden: state and policy versions are explicit in every accepted and rejected result', () => {
  const initial = createJourneyIdentityStateV1();
  assert.equal(initial.stateVersion, JOURNEY_IDENTITY_STATE_VERSION);
  assert.equal(initial.policyVersion, JOURNEY_IDENTITY_POLICY_VERSION);
  const rejected = apply(initial, {
    policyVersion: 'journey.identity-policy.v0' as typeof JOURNEY_IDENTITY_POLICY_VERSION,
    type: 'observe', commandId: 'old-policy', spaceId: 'space-a', occurredAt: '2026-08-04T18:00:00.000Z',
    actor: actor('space-a'), profileId: 'old', profileKind: 'anonymous', identifier: exact('anonymous_id', 'old'),
    sourceFact: { factId: 'fact:old', source: 'old-sdk', sourceRef: 'event:old',
      occurredAt: '2026-08-04T17:59:59.000Z' }
  });
  assert.deepEqual({ policyVersion: rejected.result.policyVersion, stateVersion: rejected.result.stateVersion,
    status: rejected.result.status, code: rejected.result.code,
    auditPolicyVersion: rejected.result.audit.policyVersion }, {
    policyVersion: 'journey.identity-policy.v1', stateVersion: 'journey.identity-state.v1',
    status: 'rejected', code: 'unsupported_policy_version', auditPolicyVersion: 'journey.identity-policy.v1'
  });
});

