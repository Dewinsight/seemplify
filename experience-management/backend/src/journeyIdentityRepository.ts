import crypto from 'node:crypto';
import fs from 'node:fs';
import { db } from './database.js';
import { config } from './config.js';
import { journeyEventDataTables } from './journeyEventIngestionRepository.js';
import {
  applyJourneyIdentityCommand,
  createJourneyIdentityStateV1,
  resolveJourneyIdentity,
  type JourneyIdentityActor,
  type JourneyIdentityAuditFact,
  type JourneyIdentityCommand,
  type JourneyIdentityIdentifier,
  type JourneyIdentityMembership,
  type JourneyIdentityMerge,
  type JourneyIdentityPermission,
  type JourneyIdentityProfile,
  type JourneyIdentitySourceFact,
  type JourneyIdentityStateV1,
  type JourneyIdentityTombstone
} from './journeyIdentityPolicy.js';
import { assertSubscriptionFeature } from './subscriptionEntitlements.js';
import type { SpaceRole } from './spaces.js';
import { journeyOperationalStageFeedRepository } from './journeyOperationalStageFeedRepository.js';

export class JourneyIdentityRepositoryError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = 'JOURNEY_IDENTITY_INVALID',
    public details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'JourneyIdentityRepositoryError';
  }
}

type JourneyIdentityGroup = {
  id: string;
  spaceId: string;
  groupType: 'account' | 'group';
  name: string;
  externalRef: string | null;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
  createdByUserId: string | null;
};

type JourneyProfileTimelineEvent = {
  id: string;
  profileId: string;
  canonicalProfileId: string;
  eventKind: string;
  occurredAt: string;
  title: string;
  summary: string;
  sourceType: string;
  sourceId: string;
  detail: Record<string, unknown>;
  createdAt: string;
};

type JourneyIdentitySession = {
  id: string;
  spaceId: string;
  profileId: string;
  canonicalProfileId: string;
  identifierNamespace: string;
  identifierValue: string;
  startedAt: string;
  lastSeenAt: string;
  endedAt: string | null;
  eventCount: number;
  sourceFactCount: number;
  createdAt: string;
  updatedAt: string;
};

type JourneyIdentitySegmentClauseField =
  | 'profile.kind'
  | 'membership.accountId'
  | 'membership.groupId';

type JourneyIdentitySegmentRuleClause = {
  field: JourneyIdentitySegmentClauseField;
  op: 'eq';
  value: string;
};

type JourneyIdentitySegmentRule = {
  match: 'all' | 'any';
  clauses: JourneyIdentitySegmentRuleClause[];
};

type JourneyIdentitySegment = {
  id: string;
  spaceId: string;
  name: string;
  description: string;
  state: 'active' | 'retired';
  activeVersionId: string;
  activeVersionNumber: number;
  materializedMemberCount: number;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

type JourneyIdentitySegmentVersion = {
  id: string;
  segmentId: string;
  versionNumber: number;
  rule: JourneyIdentitySegmentRule;
  state: 'active' | 'superseded';
  validationState: 'valid';
  createdByUserId: string | null;
  createdAt: string;
};

type JourneyCustomer360Purpose = 'analytics' | 'personalisation' | 'research_contact' | 'marketing';

type JourneyProfilePrivacyState = {
  profileId: string;
  purpose: JourneyCustomer360Purpose;
  state: 'unknown' | 'granted' | 'denied' | 'suppressed';
  lawfulBasis: string | null;
  policyReference: string | null;
  updatedAt: string;
  updatedByUserId: string | null;
};

type JourneyProfileExportJob = {
  id: string;
  spaceId: string;
  profileId: string;
  purpose: JourneyCustomer360Purpose;
  format: 'json';
  state: 'completed';
  requestedByUserId: string | null;
  createdAt: string;
  completedAt: string;
};

type JourneyProfilePrivacyJobOperation = 'suppress' | 'erasure';

type JourneyProfilePrivacyJobState = 'queued' | 'completed';

type JourneyProfilePrivacyJob = {
  id: string;
  spaceId: string;
  profileId: string;
  operation: JourneyProfilePrivacyJobOperation;
  purpose: JourneyCustomer360Purpose | null;
  state: JourneyProfilePrivacyJobState;
  requestedByUserId: string | null;
  createdAt: string;
  completedAt: string | null;
};

type JourneyIdentityCorrectionRun = {
  id: string;
  spaceId: string;
  reason: 'merge_command' | 'late_source_fact' | 'identity_command';
  commandId: string;
  profileIds: string[];
  state: 'completed';
  requestedByUserId: string | null;
  createdAt: string;
  completedAt: string;
};

type JsonRow = { details_json?: string | null; decision_json?: string | null };

function parseJson<T>(row: JsonRow, key: keyof JsonRow, fallback: T): T {
  const raw = row[key];
  if (!raw) return fallback;
  return JSON.parse(raw) as T;
}

function profileKey(spaceId: string, profileId: string) {
  return JSON.stringify([spaceId, profileId]);
}

function identifierKey(spaceId: string, identifier: JourneyIdentityIdentifier) {
  return JSON.stringify([spaceId, identifier.kind, identifier.namespace, identifier.value]);
}

function sessionIdForBinding(spaceId: string, profileId: string, namespace: string, value: string) {
  return crypto.createHash('sha256')
    .update(JSON.stringify([spaceId, profileId, namespace, value]))
    .digest('hex')
    .slice(0, 40);
}

let journeyIdentityHashKeyCache: Buffer | null = null;

function journeyIdentityHashKey() {
  if (journeyIdentityHashKeyCache) return journeyIdentityHashKeyCache;
  journeyIdentityHashKeyCache = fs.readFileSync(config.journeyIdentityHashKeyFile);
  return journeyIdentityHashKeyCache;
}

function hashedAnonymousId(value: string) {
  return crypto.createHmac('sha256', journeyIdentityHashKey()).update(value, 'utf8').digest('hex');
}

export function resolveKnownJourneySubjectsForAnonymousHashes(input: {
  spaceId: string;
  anonymousHashes: string[];
}) {
  const hashes = [...new Set(input.anonymousHashes.filter(Boolean))];
  if (!hashes.length) return new Map<string, {
    profileId: string;
    canonicalProfileId: string;
    accountId: string | null;
  }>();
  const state = loadJourneyIdentityState(input.spaceId);
  const byHash = new Map<string, {
    profileId: string;
    canonicalProfileId: string;
    accountId: string | null;
  }>();
  for (const binding of Object.values(state.bindings)) {
    if (binding.spaceId !== input.spaceId || binding.identifier.kind !== 'anonymous_id') continue;
    const hash = hashedAnonymousId(binding.identifier.value);
    if (!hashes.includes(hash) || byHash.has(hash)) continue;
    byHash.set(hash, {
      profileId: binding.profileId,
      canonicalProfileId: resolveCanonicalProfileId(state, input.spaceId, binding.profileId),
      accountId: currentGroupTypeForProfile(state, input.spaceId, binding.profileId, 'account')[0]?.groupId || null
    });
  }
  return byHash;
}

function parseSegmentRule(input: unknown): JourneyIdentitySegmentRule {
  const rule = (input && typeof input === 'object') ? input as Record<string, unknown> : {};
  const match = rule.match === 'any' ? 'any' : 'all';
  const rawClauses = Array.isArray(rule.clauses) ? rule.clauses : [];
  const clauses = rawClauses.map((clause) => {
    const row = clause && typeof clause === 'object' ? clause as Record<string, unknown> : {};
    const field = String(row.field || '');
    const op = String(row.op || '');
    const value = String(row.value || '');
    if (!['profile.kind', 'membership.accountId', 'membership.groupId'].includes(field)) {
      throw new JourneyIdentityRepositoryError('Journey identity segment rule contains an unsupported field.', 400,
        'JOURNEY_SEGMENT_RULE_INVALID', { field });
    }
    if (op !== 'eq') {
      throw new JourneyIdentityRepositoryError('Journey identity segment rule contains an unsupported operator.', 400,
        'JOURNEY_SEGMENT_RULE_INVALID', { op });
    }
    if (!value.trim()) {
      throw new JourneyIdentityRepositoryError('Journey identity segment rule values must be non-empty.', 400,
        'JOURNEY_SEGMENT_RULE_INVALID');
    }
    return { field: field as JourneyIdentitySegmentClauseField, op: 'eq' as const, value };
  });
  if (!clauses.length) {
    throw new JourneyIdentityRepositoryError('Journey identity segment rules require at least one clause.', 400,
      'JOURNEY_SEGMENT_RULE_INVALID');
  }
  return { match, clauses };
}

function commandKey(spaceId: string, commandId: string) {
  return JSON.stringify([spaceId, commandId]);
}

function permissionsForRole(role: SpaceRole): JourneyIdentityPermission[] {
  return role === 'member'
    ? ['identity:observe']
    : ['identity:observe', 'identity:identify', 'identity:alias', 'identity:merge',
      'identity:split', 'identity:membership', 'identity:delete'];
}

export function journeyIdentityActor(input: {
  actorUserId: string;
  spaceId: string;
  role: SpaceRole;
}): JourneyIdentityActor {
  return {
    actorId: input.actorUserId,
    spaceId: input.spaceId,
    authenticated: true,
    permissions: permissionsForRole(input.role)
  };
}

export function loadJourneyIdentityState(spaceId: string): JourneyIdentityStateV1 {
  assertSubscriptionFeature(spaceId, 'journeyConnected');
  assertSubscriptionFeature(spaceId, 'journeyProfiles');
  const state = createJourneyIdentityStateV1();
  for (const row of db.prepare(`SELECT * FROM journey_identity_profiles WHERE space_id=? ORDER BY created_at,id`)
    .all(spaceId) as Array<any>) {
    state.profiles[profileKey(spaceId, row.id)] = {
      spaceId,
      profileId: row.id,
      kind: row.kind,
      status: row.status,
      createdAt: row.created_at,
      createdByCommandId: row.created_by_command_id,
      ...(row.known_at ? { knownAt: row.known_at } : {}),
      ...(row.deleted_at ? { deletedAt: row.deleted_at } : {})
    } satisfies JourneyIdentityProfile;
  }
  for (const row of db.prepare(`SELECT * FROM journey_identity_bindings WHERE space_id=? ORDER BY bound_at,id`)
    .all(spaceId) as Array<any>) {
    const identifier = {
      kind: row.identifier_kind,
      namespace: row.identifier_namespace,
      value: row.identifier_value
    } satisfies JourneyIdentityIdentifier;
    state.bindings[identifierKey(spaceId, identifier)] = {
      spaceId,
      identifier: identifier as any,
      profileId: row.profile_id,
      boundAt: row.bound_at,
      boundByCommandId: row.bound_by_command_id
    };
  }
  for (const row of db.prepare(`SELECT * FROM journey_identity_merges WHERE space_id=? ORDER BY merged_at,merge_audit_id`)
    .all(spaceId) as Array<any>) {
    state.merges[row.merge_audit_id] = {
      mergeAuditId: row.merge_audit_id,
      spaceId,
      sourceProfileId: row.source_profile_id,
      targetProfileId: row.target_profile_id,
      canonicalTargetProfileId: row.canonical_target_profile_id,
      reason: row.reason,
      active: Boolean(row.active),
      mergedAt: row.merged_at,
      mergedByCommandId: row.merged_by_command_id,
      ...(row.split_at ? { splitAt: row.split_at } : {}),
      ...(row.split_by_command_id ? { splitByCommandId: row.split_by_command_id } : {})
    } satisfies JourneyIdentityMerge;
  }
  for (const row of db.prepare(`SELECT * FROM journey_identity_memberships WHERE space_id=? ORDER BY added_at,membership_id`)
    .all(spaceId) as Array<any>) {
    state.memberships[row.membership_id] = {
      membershipId: row.membership_id,
      spaceId,
      profileId: row.profile_id,
      groupType: row.group_type,
      groupId: row.group_id,
      active: Boolean(row.active),
      addedAt: row.added_at,
      addedByCommandId: row.added_by_command_id,
      ...(row.removed_at ? { removedAt: row.removed_at } : {}),
      ...(row.removed_by_command_id ? { removedByCommandId: row.removed_by_command_id } : {})
    } satisfies JourneyIdentityMembership;
  }
  state.sourceFacts.push(...db.prepare(`SELECT * FROM journey_identity_source_facts WHERE space_id=? ORDER BY occurred_at,fact_id`)
    .all(spaceId).map((row: any) => ({
      factId: row.fact_id,
      source: row.source,
      sourceRef: row.source_ref,
      occurredAt: row.occurred_at,
      spaceId,
      profileId: row.profile_id,
      recordedByCommandId: row.recorded_by_command_id
    } satisfies JourneyIdentitySourceFact)));
  state.auditFacts.push(...db.prepare(`SELECT * FROM journey_identity_audit_facts WHERE space_id=? ORDER BY occurred_at,audit_id`)
    .all(spaceId).map((row: any) => ({
      auditId: row.audit_id,
      policyVersion: row.policy_version,
      commandId: row.command_id,
      spaceId,
      actorId: row.actor_user_id,
      action: row.action,
      outcome: row.outcome,
      code: row.code,
      explanation: row.explanation,
      occurredAt: row.occurred_at,
      details: parseJson<Record<string, string | number | boolean | string[]>>(row, 'details_json', {})
    } satisfies JourneyIdentityAuditFact)));
  for (const row of db.prepare(`SELECT * FROM journey_identity_profile_tombstones WHERE space_id=? ORDER BY deleted_at,profile_id`)
    .all(spaceId) as Array<any>) {
    state.profileTombstones[profileKey(spaceId, row.profile_id)] = {
      spaceId,
      profileId: row.profile_id,
      deletedAt: row.deleted_at,
      deletedByCommandId: row.deleted_by_command_id,
      reason: row.reason
    } satisfies JourneyIdentityTombstone;
  }
  for (const row of db.prepare(`SELECT * FROM journey_identity_identifier_tombstones WHERE space_id=? ORDER BY deleted_at,id`)
    .all(spaceId) as Array<any>) {
    const identifier = {
      kind: row.identifier_kind,
      namespace: row.identifier_namespace,
      value: row.identifier_value
    } satisfies JourneyIdentityIdentifier;
    state.identifierTombstones[identifierKey(spaceId, identifier)] = {
      spaceId,
      profileId: row.profile_id,
      deletedAt: row.deleted_at,
      deletedByCommandId: row.deleted_by_command_id,
      reason: row.reason
    } satisfies JourneyIdentityTombstone;
  }
  for (const row of db.prepare(`SELECT * FROM journey_identity_processed_commands WHERE space_id=? ORDER BY processed_at,id`)
    .all(spaceId) as Array<any>) {
    state.processedCommands[commandKey(spaceId, row.command_id)] = {
      fingerprint: row.command_fingerprint,
      decision: parseJson(row, 'decision_json', null as never)
    };
  }
  return state;
}

function rewriteState(spaceId: string, state: JourneyIdentityStateV1) {
  db.prepare('DELETE FROM journey_identity_processed_commands WHERE space_id=?').run(spaceId);
  db.prepare('DELETE FROM journey_identity_identifier_tombstones WHERE space_id=?').run(spaceId);
  db.prepare('DELETE FROM journey_identity_profile_tombstones WHERE space_id=?').run(spaceId);
  db.prepare('DELETE FROM journey_identity_audit_facts WHERE space_id=?').run(spaceId);
  db.prepare('DELETE FROM journey_identity_source_facts WHERE space_id=?').run(spaceId);
  db.prepare('DELETE FROM journey_identity_memberships WHERE space_id=?').run(spaceId);
  db.prepare('DELETE FROM journey_identity_merges WHERE space_id=?').run(spaceId);
  db.prepare('DELETE FROM journey_identity_bindings WHERE space_id=?').run(spaceId);
  db.prepare('DELETE FROM journey_identity_profiles WHERE space_id=?').run(spaceId);

  const insertProfile = db.prepare(`INSERT INTO journey_identity_profiles
    (id,space_id,kind,status,created_at,created_by_command_id,known_at,deleted_at)
    VALUES (?,?,?,?,?,?,?,?)`);
  const insertBinding = db.prepare(`INSERT INTO journey_identity_bindings
    (id,space_id,identifier_kind,identifier_namespace,identifier_value,profile_id,bound_at,bound_by_command_id)
    VALUES (?,?,?,?,?,?,?,?)`);
  const insertMerge = db.prepare(`INSERT INTO journey_identity_merges
    (merge_audit_id,space_id,source_profile_id,target_profile_id,canonical_target_profile_id,reason,active,
      merged_at,merged_by_command_id,split_at,split_by_command_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const insertMembership = db.prepare(`INSERT INTO journey_identity_memberships
    (membership_id,space_id,profile_id,group_type,group_id,active,added_at,added_by_command_id,removed_at,removed_by_command_id)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const insertSourceFact = db.prepare(`INSERT INTO journey_identity_source_facts
    (id,space_id,fact_id,profile_id,source,source_ref,occurred_at,recorded_by_command_id)
    VALUES (?,?,?,?,?,?,?,?)`);
  const insertAudit = db.prepare(`INSERT INTO journey_identity_audit_facts
    (audit_id,space_id,command_id,policy_version,actor_user_id,action,outcome,code,explanation,occurred_at,details_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const insertProfileTombstone = db.prepare(`INSERT INTO journey_identity_profile_tombstones
    (id,space_id,profile_id,deleted_at,deleted_by_command_id,reason)
    VALUES (?,?,?,?,?,?)`);
  const insertIdentifierTombstone = db.prepare(`INSERT INTO journey_identity_identifier_tombstones
    (id,space_id,identifier_kind,identifier_namespace,identifier_value,profile_id,deleted_at,deleted_by_command_id,reason)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  const insertProcessed = db.prepare(`INSERT INTO journey_identity_processed_commands
    (id,space_id,command_id,command_fingerprint,decision_json,processed_at)
    VALUES (?,?,?,?,?,?)`);

  for (const profile of Object.values(state.profiles).filter((row) => row.spaceId === spaceId)) {
    insertProfile.run(profile.profileId, spaceId, profile.kind, profile.status, profile.createdAt, profile.createdByCommandId,
      profile.knownAt || null, profile.deletedAt || null);
  }
  for (const binding of Object.values(state.bindings).filter((row) => row.spaceId === spaceId)) {
    insertBinding.run(JSON.stringify([binding.identifier.kind, binding.identifier.namespace, binding.identifier.value]), spaceId,
      binding.identifier.kind, binding.identifier.namespace, binding.identifier.value, binding.profileId, binding.boundAt, binding.boundByCommandId);
  }
  for (const merge of Object.values(state.merges).filter((row) => row.spaceId === spaceId)) {
    insertMerge.run(merge.mergeAuditId, spaceId, merge.sourceProfileId, merge.targetProfileId, merge.canonicalTargetProfileId,
      merge.reason, merge.active ? 1 : 0, merge.mergedAt, merge.mergedByCommandId, merge.splitAt || null, merge.splitByCommandId || null);
  }
  for (const membership of Object.values(state.memberships).filter((row) => row.spaceId === spaceId)) {
    insertMembership.run(membership.membershipId, spaceId, membership.profileId, membership.groupType, membership.groupId,
      membership.active ? 1 : 0, membership.addedAt, membership.addedByCommandId, membership.removedAt || null, membership.removedByCommandId || null);
  }
  for (const fact of state.sourceFacts.filter((row) => row.spaceId === spaceId)) {
    insertSourceFact.run(`${fact.factId}:${fact.profileId}`, spaceId, fact.factId, fact.profileId, fact.source, fact.sourceRef,
      fact.occurredAt, fact.recordedByCommandId);
  }
  for (const audit of state.auditFacts.filter((row) => row.spaceId === spaceId)) {
    insertAudit.run(audit.auditId, spaceId, audit.commandId, audit.policyVersion, audit.actorId, audit.action, audit.outcome,
      audit.code, audit.explanation, audit.occurredAt, JSON.stringify(audit.details));
  }
  for (const tombstone of Object.values(state.profileTombstones).filter((row) => row.spaceId === spaceId)) {
    insertProfileTombstone.run(`profile:${tombstone.profileId}`, spaceId, tombstone.profileId, tombstone.deletedAt,
      tombstone.deletedByCommandId, tombstone.reason);
  }
  for (const [key, tombstone] of Object.entries(state.identifierTombstones).filter(([, row]) => row.spaceId === spaceId)) {
    const [, kind, namespace, value] = JSON.parse(key) as [string, string, string, string];
    insertIdentifierTombstone.run(key, spaceId, kind, namespace, value, tombstone.profileId, tombstone.deletedAt,
      tombstone.deletedByCommandId, tombstone.reason);
  }
  for (const [key, processed] of Object.entries(state.processedCommands).filter(([entry]) => JSON.parse(entry)[0] === spaceId)) {
    const [, commandId] = JSON.parse(key) as [string, string];
    insertProcessed.run(key, spaceId, commandId, processed.fingerprint, JSON.stringify(processed.decision), processed.decision.audit.occurredAt);
  }
}

export function applyJourneyIdentityCommandPersisted(input: {
  spaceId: string;
  command: JourneyIdentityCommand;
}) {
  assertSubscriptionFeature(input.spaceId, 'journeyConnected');
  assertSubscriptionFeature(input.spaceId, 'journeyProfiles');
  return db.transaction(() => {
    const current = loadJourneyIdentityState(input.spaceId);
    const transition = applyJourneyIdentityCommand(current, input.command);
    if (transition.result.status !== 'replayed') rewriteState(input.spaceId, transition.state);
    return transition;
  })();
}

export function listJourneyIdentityProfiles(input: {
  spaceId: string;
  kind?: 'anonymous' | 'known';
  status?: 'active' | 'deleted';
  limit: number;
  offset: number;
}) {
  const state = loadJourneyIdentityState(input.spaceId);
  const profiles = Object.values(state.profiles)
    .filter((profile) => profile.spaceId === input.spaceId)
    .filter((profile) => !profileSuppressedForAnyPurpose(input.spaceId, profile.profileId))
    .filter((profile) => !input.kind || profile.kind === input.kind)
    .filter((profile) => !input.status || profile.status === input.status)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.profileId.localeCompare(right.profileId));
  return profiles.slice(input.offset, input.offset + input.limit).map((profile) => {
    const canonicalProfileId = resolveCanonicalProfileId(state, input.spaceId, profile.profileId);
    const bindings = Object.values(state.bindings).filter((binding) => binding.spaceId === input.spaceId && binding.profileId === profile.profileId);
    const memberships = Object.values(state.memberships).filter((membership) =>
      membership.spaceId === input.spaceId && membership.profileId === profile.profileId && membership.active);
    return {
      ...profile,
      canonicalProfileId,
      identifierCount: bindings.length,
      activeMembershipCount: memberships.length,
      mergedIntoProfileId: canonicalProfileId !== profile.profileId ? canonicalProfileId : null
    };
  });
}

function resolveCanonicalProfileId(state: JourneyIdentityStateV1, spaceId: string, profileId: string) {
  const syntheticIdentifier = Object.values(state.bindings).find((binding) => binding.spaceId === spaceId && binding.profileId === profileId)?.identifier;
  if (syntheticIdentifier) return resolveJourneyIdentity(state, spaceId, syntheticIdentifier).canonicalProfileId || profileId;
  return Object.values(state.merges).find((merge) => merge.spaceId === spaceId && merge.active && merge.sourceProfileId === profileId)
    ?.canonicalTargetProfileId || profileId;
}

export function getJourneyIdentityProfileDetail(input: {
  spaceId: string;
  profileId: string;
}) {
  const state = loadJourneyIdentityState(input.spaceId);
  const profile = state.profiles[profileKey(input.spaceId, input.profileId)];
  if (!profile) throw new JourneyIdentityRepositoryError('Journey profile not found.', 404, 'JOURNEY_PROFILE_NOT_FOUND');
  return {
    profile: {
      ...profile,
      canonicalProfileId: resolveCanonicalProfileId(state, input.spaceId, profile.profileId)
    },
    bindings: Object.values(state.bindings).filter((binding) => binding.spaceId === input.spaceId && binding.profileId === profile.profileId),
    sourceFacts: state.sourceFacts.filter((fact) => fact.spaceId === input.spaceId && fact.profileId === profile.profileId),
    memberships: Object.values(state.memberships).filter((membership) => membership.spaceId === input.spaceId && membership.profileId === profile.profileId),
    merges: Object.values(state.merges).filter((merge) =>
      merge.spaceId === input.spaceId && (merge.sourceProfileId === profile.profileId || merge.targetProfileId === profile.profileId)),
    tombstone: state.profileTombstones[profileKey(input.spaceId, profile.profileId)] || null
  };
}

export function resolveJourneyIdentityForSpace(input: {
  spaceId: string;
  identifier: JourneyIdentityIdentifier;
}) {
  return resolveJourneyIdentity(loadJourneyIdentityState(input.spaceId), input.spaceId, input.identifier);
}

function auditFactTouchesSuppressedProfile(spaceId: string, fact: any) {
  const details = (fact?.details && typeof fact.details === 'object') ? fact.details as Record<string, unknown> : {};
  const profileIds = new Set<string>();
  for (const key of ['profileId', 'resolvedProfileId', 'sourceProfileId', 'targetProfileId', 'canonicalProfileId']) {
    const value = details[key];
    if (typeof value === 'string' && value) profileIds.add(value);
  }
  if (Array.isArray(details.profileIds)) {
    for (const value of details.profileIds) if (typeof value === 'string' && value) profileIds.add(value);
  }
  for (const profileId of profileIds) {
    if (profileSuppressedForAnyPurpose(spaceId, profileId)) return true;
  }
  return false;
}

export function listJourneyIdentityAudit(input: {
  spaceId: string;
  limit: number;
  offset: number;
}) {
  const rows = loadJourneyIdentityState(input.spaceId).auditFacts
    .filter((fact) => fact.spaceId === input.spaceId)
    .filter((fact) => !auditFactTouchesSuppressedProfile(input.spaceId, fact))
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || left.auditId.localeCompare(right.auditId));
  return rows.slice(input.offset, input.offset + input.limit);
}

export function createJourneyIdentityGroup(input: {
  spaceId: string;
  actorUserId: string;
  groupType: 'account' | 'group';
  id: string;
  name: string;
  externalRef?: string | null;
}) {
  assertSubscriptionFeature(input.spaceId, 'journeyConnected');
  assertSubscriptionFeature(input.spaceId, 'journeyProfiles');
  const existing = db.prepare(`SELECT * FROM journey_identity_groups WHERE id=? AND space_id=?`)
    .get(input.id, input.spaceId) as any;
  if (existing) {
    return { group: rowToGroup(existing), replayed: true as const };
  }
  const createdAt = new Date().toISOString();
  db.prepare(`INSERT INTO journey_identity_groups
    (id,space_id,group_type,name,external_ref,status,created_at,updated_at,created_by_user_id)
    VALUES (?,?,?,?,?,'active',?,?,?)`)
    .run(input.id, input.spaceId, input.groupType, input.name, input.externalRef || null, createdAt, createdAt, input.actorUserId);
  return {
    group: {
      id: input.id,
      spaceId: input.spaceId,
      groupType: input.groupType,
      name: input.name,
      externalRef: input.externalRef || null,
      status: 'active',
      createdAt,
      updatedAt: createdAt,
      createdByUserId: input.actorUserId
    } satisfies JourneyIdentityGroup,
    replayed: false as const
  };
}

function rowToGroup(row: any): JourneyIdentityGroup {
  return {
    id: row.id,
    spaceId: row.space_id,
    groupType: row.group_type,
    name: row.name,
    externalRef: row.external_ref || null,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdByUserId: row.created_by_user_id || null
  };
}

export function listJourneyIdentityGroups(input: {
  spaceId: string;
  groupType?: 'account' | 'group';
  status?: 'active' | 'archived';
  limit: number;
  offset: number;
}) {
  assertSubscriptionFeature(input.spaceId, 'journeyConnected');
  assertSubscriptionFeature(input.spaceId, 'journeyProfiles');
  const state = loadJourneyIdentityState(input.spaceId);
  const rows = db.prepare(`SELECT * FROM journey_identity_groups WHERE space_id=?
    ORDER BY updated_at DESC,id`).all(input.spaceId) as any[];
  return rows
    .map(rowToGroup)
    .filter((row) => !input.groupType || row.groupType === input.groupType)
    .filter((row) => !input.status || row.status === input.status)
    .slice(input.offset, input.offset + input.limit)
    .map((group) => ({
      ...group,
      activeMemberCount: Object.values(state.memberships)
        .filter((membership) =>
          membership.spaceId === input.spaceId
          && membership.groupType === group.groupType
          && membership.groupId === group.id
          && membership.active
          && !profileSuppressedForAnyPurpose(input.spaceId, membership.profileId))
        .length
    }));
}

export function getJourneyIdentityGroupDetail(input: {
  spaceId: string;
  groupId: string;
}) {
  assertSubscriptionFeature(input.spaceId, 'journeyConnected');
  assertSubscriptionFeature(input.spaceId, 'journeyProfiles');
  const row = db.prepare(`SELECT * FROM journey_identity_groups WHERE id=? AND space_id=?`)
    .get(input.groupId, input.spaceId) as any;
  if (!row) throw new JourneyIdentityRepositoryError('Journey account or group not found.', 404, 'JOURNEY_GROUP_NOT_FOUND');
  const group = rowToGroup(row);
  const state = loadJourneyIdentityState(input.spaceId);
  const memberships = Object.values(state.memberships)
    .filter((membership) =>
      membership.spaceId === input.spaceId
      && membership.groupId === input.groupId
      && membership.groupType === group.groupType
      && !profileSuppressedForAnyPurpose(input.spaceId, membership.profileId));
  return {
    group,
    memberships,
    members: memberships.map((membership) => {
      const profile = state.profiles[profileKey(input.spaceId, membership.profileId)];
      return profile ? {
        ...profile,
        canonicalProfileId: resolveCanonicalProfileId(state, input.spaceId, profile.profileId),
        membership
      } : null;
    }).filter(Boolean)
  };
}

function insertTimelineEvent(input: {
  spaceId: string;
  profileId: string;
  canonicalProfileId: string;
  eventKind: string;
  occurredAt: string;
  title: string;
  summary: string;
  sourceType: string;
  sourceId: string;
  detail: Record<string, unknown>;
}) {
  db.prepare(`INSERT OR REPLACE INTO journey_profile_timeline_events
    (id,space_id,profile_id,canonical_profile_id,event_kind,occurred_at,title,summary,source_type,source_id,detail_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      `${input.profileId}:${input.eventKind}:${input.sourceType}:${input.sourceId}`,
      input.spaceId,
      input.profileId,
      input.canonicalProfileId,
      input.eventKind,
      input.occurredAt,
      input.title,
      input.summary,
      input.sourceType,
      input.sourceId,
      JSON.stringify(input.detail),
      new Date().toISOString()
    );
}

function rebuildProfileTimeline(spaceId: string, state: JourneyIdentityStateV1) {
  db.prepare('DELETE FROM journey_profile_timeline_events WHERE space_id=?').run(spaceId);
  for (const fact of state.sourceFacts.filter((row) => row.spaceId === spaceId)) {
    insertTimelineEvent({
      spaceId,
      profileId: fact.profileId,
      canonicalProfileId: resolveCanonicalProfileId(state, spaceId, fact.profileId),
      eventKind: 'identity_source_fact',
      occurredAt: fact.occurredAt,
      title: 'Observed identity fact',
      summary: `${fact.source} recorded ${fact.sourceRef}.`,
      sourceType: 'source_fact',
      sourceId: fact.factId,
      detail: { source: fact.source, sourceRef: fact.sourceRef, recordedByCommandId: fact.recordedByCommandId }
    });
  }
  for (const membership of Object.values(state.memberships).filter((row) => row.spaceId === spaceId)) {
    insertTimelineEvent({
      spaceId,
      profileId: membership.profileId,
      canonicalProfileId: resolveCanonicalProfileId(state, spaceId, membership.profileId),
      eventKind: membership.active ? 'membership_active' : 'membership_removed',
      occurredAt: membership.active ? membership.addedAt : membership.removedAt || membership.addedAt,
      title: membership.active ? 'Joined account/group' : 'Left account/group',
      summary: `${membership.groupType} ${membership.groupId} ${membership.active ? 'was linked' : 'was unlinked'}.`,
      sourceType: 'membership',
      sourceId: membership.membershipId,
      detail: { groupType: membership.groupType, groupId: membership.groupId, active: membership.active }
    });
  }
  for (const merge of Object.values(state.merges).filter((row) => row.spaceId === spaceId)) {
    insertTimelineEvent({
      spaceId,
      profileId: merge.sourceProfileId,
      canonicalProfileId: resolveCanonicalProfileId(state, spaceId, merge.sourceProfileId),
      eventKind: merge.active ? 'profile_merged' : 'profile_split',
      occurredAt: merge.active ? merge.mergedAt : merge.splitAt || merge.mergedAt,
      title: merge.active ? 'Profile merged' : 'Profile split',
      summary: merge.active
        ? `Merged into ${merge.canonicalTargetProfileId}.`
        : `Split back from ${merge.targetProfileId}.`,
      sourceType: 'merge',
      sourceId: merge.mergeAuditId,
      detail: {
        sourceProfileId: merge.sourceProfileId,
        targetProfileId: merge.targetProfileId,
        canonicalTargetProfileId: merge.canonicalTargetProfileId,
        reason: merge.reason
      }
    });
  }
}

function insertSession(input: JourneyIdentitySession) {
  db.prepare(`INSERT OR REPLACE INTO journey_identity_sessions
    (id,space_id,profile_id,canonical_profile_id,identifier_namespace,identifier_value,started_at,last_seen_at,ended_at,
      event_count,source_fact_count,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      input.id,
      input.spaceId,
      input.profileId,
      input.canonicalProfileId,
      input.identifierNamespace,
      input.identifierValue,
      input.startedAt,
      input.lastSeenAt,
      input.endedAt,
      input.eventCount,
      input.sourceFactCount,
      input.createdAt,
      input.updatedAt
    );
}

function rebuildIdentitySessions(spaceId: string, state: JourneyIdentityStateV1) {
  db.prepare('DELETE FROM journey_identity_sessions WHERE space_id=?').run(spaceId);
  const factsByProfile = new Map<string, JourneyIdentitySourceFact[]>();
  for (const fact of state.sourceFacts.filter((row) => row.spaceId === spaceId)) {
    const list = factsByProfile.get(fact.profileId) || [];
    list.push(fact);
    factsByProfile.set(fact.profileId, list);
  }
  for (const binding of Object.values(state.bindings).filter((row) =>
    row.spaceId === spaceId && row.identifier.kind === 'anonymous_id')) {
    const profileFacts = (factsByProfile.get(binding.profileId) || [])
      .slice()
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.factId.localeCompare(right.factId));
    const startedAt = profileFacts[0]?.occurredAt || binding.boundAt;
    const lastSeenAt = profileFacts.at(-1)?.occurredAt || binding.boundAt;
    insertSession({
      id: sessionIdForBinding(spaceId, binding.profileId, binding.identifier.namespace, binding.identifier.value),
      spaceId,
      profileId: binding.profileId,
      canonicalProfileId: resolveCanonicalProfileId(state, spaceId, binding.profileId),
      identifierNamespace: binding.identifier.namespace,
      identifierValue: binding.identifier.value,
      startedAt,
      lastSeenAt,
      endedAt: null,
      eventCount: profileFacts.length,
      sourceFactCount: profileFacts.length,
      createdAt: binding.boundAt,
      updatedAt: new Date().toISOString()
    });
  }
}

function rowToSegment(row: any): JourneyIdentitySegment {
  return {
    id: row.id,
    spaceId: row.space_id,
    name: row.name,
    description: row.description || '',
    state: row.state,
    activeVersionId: row.active_version_id,
    activeVersionNumber: Number(row.active_version_number),
    materializedMemberCount: Number(row.materialized_member_count),
    createdByUserId: row.created_by_user_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToSegmentVersion(row: any): JourneyIdentitySegmentVersion {
  return {
    id: row.id,
    segmentId: row.segment_id,
    versionNumber: Number(row.version_number),
    rule: JSON.parse(row.rule_json || '{"match":"all","clauses":[]}'),
    state: row.state,
    validationState: row.validation_state,
    createdByUserId: row.created_by_user_id || null,
    createdAt: row.created_at
  };
}

function rowToPrivacyState(row: any): JourneyProfilePrivacyState {
  return {
    profileId: row.profile_id,
    purpose: row.purpose,
    state: row.state,
    lawfulBasis: row.lawful_basis || null,
    policyReference: row.policy_reference || null,
    updatedAt: row.updated_at,
    updatedByUserId: row.updated_by_user_id || null
  };
}

function effectiveProfilePrivacyState(spaceId: string, profileId: string, purpose: JourneyCustomer360Purpose) {
  const row = db.prepare(`SELECT * FROM journey_profile_privacy_states WHERE space_id=? AND profile_id=? AND purpose=?`)
    .get(spaceId, profileId, purpose) as any;
  if (!row) {
    return {
      profileId,
      purpose,
      state: 'unknown',
      lawfulBasis: null,
      policyReference: null,
      updatedAt: '',
      updatedByUserId: null
    } satisfies JourneyProfilePrivacyState;
  }
  return rowToPrivacyState(row);
}

function currentGroupTypeForProfile(state: JourneyIdentityStateV1, spaceId: string, profileId: string, groupType: 'account' | 'group') {
  return Object.values(state.memberships)
    .filter((membership) => membership.spaceId === spaceId && membership.profileId === profileId && membership.active && membership.groupType === groupType);
}

function profileSuppressedForAnyPurpose(spaceId: string, profileId: string) {
  const count = Number((db.prepare(`SELECT COUNT(*) count FROM journey_profile_privacy_states
    WHERE space_id=? AND profile_id=? AND state IN ('denied','suppressed')`).get(spaceId, profileId) as any).count);
  return count > 0;
}

export function isJourneyProfileSuppressedForAnyPurpose(input: {
  spaceId: string;
  profileId: string;
}) {
  return profileSuppressedForAnyPurpose(input.spaceId, input.profileId);
}

function segmentClauseMatches(input: {
  state: JourneyIdentityStateV1;
  profile: JourneyIdentityProfile;
  canonicalProfileId: string;
  clause: JourneyIdentitySegmentRuleClause;
}) {
  switch (input.clause.field) {
    case 'profile.kind':
      return input.profile.kind === input.clause.value;
    case 'membership.accountId':
      return Object.values(input.state.memberships).some((membership) =>
        membership.spaceId === input.profile.spaceId
        && membership.profileId === input.profile.profileId
        && membership.active
        && membership.groupType === 'account'
        && membership.groupId === input.clause.value);
    case 'membership.groupId':
      return Object.values(input.state.memberships).some((membership) =>
        membership.spaceId === input.profile.spaceId
        && membership.profileId === input.profile.profileId
        && membership.active
        && membership.groupType === 'group'
        && membership.groupId === input.clause.value);
  }
}

function segmentRuleMatches(input: {
  state: JourneyIdentityStateV1;
  profile: JourneyIdentityProfile;
  canonicalProfileId: string;
  rule: JourneyIdentitySegmentRule;
}) {
  const results = input.rule.clauses.map((clause) => segmentClauseMatches({
    state: input.state,
    profile: input.profile,
    canonicalProfileId: input.canonicalProfileId,
    clause
  }));
  return input.rule.match === 'all' ? results.every(Boolean) : results.some(Boolean);
}

function rebuildIdentitySegments(spaceId: string, state: JourneyIdentityStateV1) {
  db.prepare('DELETE FROM journey_identity_segment_memberships WHERE space_id=?').run(spaceId);
  const segments = db.prepare(`SELECT * FROM journey_identity_segments WHERE space_id=? AND state='active'`)
    .all(spaceId) as any[];
  const insert = db.prepare(`INSERT INTO journey_identity_segment_memberships
    (id,space_id,segment_id,segment_version_id,profile_id,canonical_profile_id,matched_at)
    VALUES (?,?,?,?,?,?,?)`);
  const update = db.prepare(`UPDATE journey_identity_segments SET materialized_member_count=?,updated_at=? WHERE id=? AND space_id=?`);
  const now = new Date().toISOString();
  for (const row of segments) {
    const version = db.prepare(`SELECT * FROM journey_identity_segment_versions WHERE id=? AND space_id=?`)
      .get(row.active_version_id, spaceId) as any;
    if (!version) continue;
    const parsedRule = parseSegmentRule(JSON.parse(version.rule_json || '{}'));
    let count = 0;
    for (const profile of Object.values(state.profiles).filter((entry) => entry.spaceId === spaceId && entry.status === 'active')) {
      if (profileSuppressedForAnyPurpose(spaceId, profile.profileId)) continue;
      const canonicalProfileId = resolveCanonicalProfileId(state, spaceId, profile.profileId);
      if (!segmentRuleMatches({ state, profile, canonicalProfileId, rule: parsedRule })) continue;
      insert.run(
        `${row.id}:${profile.profileId}`,
        spaceId,
        row.id,
        version.id,
        profile.profileId,
        canonicalProfileId,
        now
      );
      count += 1;
    }
    update.run(count, now, row.id, spaceId);
  }
}

function refreshSegmentMemberCounts(spaceId: string) {
  const segments = db.prepare(`SELECT id FROM journey_identity_segments WHERE space_id=?`).all(spaceId) as Array<{ id: string }>;
  const update = db.prepare(`UPDATE journey_identity_segments SET materialized_member_count=?,updated_at=? WHERE id=? AND space_id=?`);
  const at = new Date().toISOString();
  for (const segment of segments) {
    const count = Number((db.prepare(`SELECT COUNT(*) count FROM journey_identity_segment_memberships
      WHERE space_id=? AND segment_id=?`).get(spaceId, segment.id) as any).count);
    update.run(count, at, segment.id, spaceId);
  }
}

function executeJourneyProfilePrivacyPropagation(input: {
  spaceId: string;
  profileId: string;
}) {
  const state = loadJourneyIdentityState(input.spaceId);
  const anonymousHashes = Object.values(state.bindings)
    .filter((binding) => binding.spaceId === input.spaceId && binding.profileId === input.profileId && binding.identifier.kind === 'anonymous_id')
    .map((binding) => hashedAnonymousId(binding.identifier.value));
  const removedExportJobs = db.prepare(`DELETE FROM journey_profile_export_jobs WHERE space_id=? AND profile_id=?`)
    .run(input.spaceId, input.profileId).changes;
  const removedSegmentMemberships = db.prepare(`DELETE FROM journey_identity_segment_memberships
    WHERE space_id=? AND (profile_id=? OR canonical_profile_id=?)`)
    .run(input.spaceId, input.profileId, input.profileId).changes;
  const removedTimelineEvents = db.prepare(`DELETE FROM journey_profile_timeline_events
    WHERE space_id=? AND (profile_id=? OR canonical_profile_id=?)`)
    .run(input.spaceId, input.profileId, input.profileId).changes;
  const removedSessions = db.prepare(`DELETE FROM journey_identity_sessions
    WHERE space_id=? AND (profile_id=? OR canonical_profile_id=?)`)
    .run(input.spaceId, input.profileId, input.profileId).changes;
  let linkedAnonymousStageVisits = 0;
  let removedAnonymousInstances = 0;
  if (anonymousHashes.length) {
    linkedAnonymousStageVisits = Number((db.prepare(`SELECT COUNT(*) count
      FROM journey_anonymous_stage_visits visit
      JOIN journey_anonymous_instances instance
        ON instance.id=visit.instance_id
        AND instance.space_id=visit.space_id
        AND instance.source_id=visit.source_id
        AND instance.environment=visit.environment
        AND instance.journey_definition_id=visit.journey_definition_id
      WHERE instance.space_id=? AND instance.anonymous_id_hash IN (${anonymousHashes.map(() => '?').join(',')})`)
      .get(input.spaceId, ...anonymousHashes) as any).count);
    if (linkedAnonymousStageVisits === 0) {
      removedAnonymousInstances = db.prepare(`DELETE FROM journey_anonymous_instances
        WHERE space_id=? AND anonymous_id_hash IN (${anonymousHashes.map(() => '?').join(',')})`)
        .run(input.spaceId, ...anonymousHashes).changes;
    }
  }
  if (removedSegmentMemberships) refreshSegmentMemberCounts(input.spaceId);
  const executedTargets = [
    'journey_profile_export_jobs',
    'journey_identity_segment_memberships',
    'journey_profile_timeline_events',
    'journey_identity_sessions',
    ...(anonymousHashes.length && linkedAnonymousStageVisits === 0 ? ['journey_anonymous_instances'] : [])
  ];
  return {
    executedTargets,
    removedExportJobs,
    removedSegmentMemberships,
    removedTimelineEvents,
    removedSessions,
    removedAnonymousInstances,
    linkedAnonymousStageVisits,
    anonymousInstanceDeletionBlocked: anonymousHashes.length > 0 && linkedAnonymousStageVisits > 0
  };
}

function correctionRunReason(command: JourneyIdentityCommand): JourneyIdentityCorrectionRun['reason'] {
  if (command.type === 'merge' || command.type === 'split') return 'merge_command';
  if ('sourceFact' in command && command.sourceFact && command.sourceFact.occurredAt < command.occurredAt) return 'late_source_fact';
  return 'identity_command';
}

function correctionRunProfiles(command: JourneyIdentityCommand) {
  switch (command.type) {
    case 'observe':
      return [command.profileId];
    case 'identify':
    case 'alias':
    case 'delete':
      return [command.profile.profileId];
    case 'merge':
      return [command.source.profileId, command.target.profileId];
    case 'add_membership':
      return [command.profile.profileId];
    case 'split':
    case 'remove_membership':
      return [];
  }
}

function recordJourneyIdentityCorrectionRun(input: {
  spaceId: string;
  actorUserId: string | null;
  command: JourneyIdentityCommand;
  state: JourneyIdentityStateV1;
}) {
  const at = new Date().toISOString();
  const runId = crypto.randomUUID();
  const profileIds = correctionRunProfiles(input.command);
  const timelineEventCount = Number((db.prepare(`SELECT COUNT(*) count FROM journey_profile_timeline_events WHERE space_id=?`)
    .get(input.spaceId) as any).count);
  const sessionCount = Number((db.prepare(`SELECT COUNT(*) count FROM journey_identity_sessions WHERE space_id=?`)
    .get(input.spaceId) as any).count);
  const segmentMembershipCount = Number((db.prepare(`SELECT COUNT(*) count FROM journey_identity_segment_memberships WHERE space_id=?`)
    .get(input.spaceId) as any).count);
  db.prepare(`INSERT INTO journey_identity_correction_runs
    (id,space_id,reason,command_id,profile_ids_json,state,result_json,requested_by_user_id,created_at,completed_at)
    VALUES (?,?,?,?,?,'completed',?,?,?,?)`)
    .run(
      runId,
      input.spaceId,
      correctionRunReason(input.command),
      input.command.commandId,
      JSON.stringify(profileIds),
      JSON.stringify({
        timelineEventCount,
        sessionCount,
        segmentMembershipCount,
        activeProfileCount: Object.values(input.state.profiles)
          .filter((profile) => profile.spaceId === input.spaceId && profile.status === 'active').length
      }),
      input.actorUserId,
      at,
      at
    );
}

export function applyJourneyIdentityCommandAndTimeline(input: {
  spaceId: string;
  command: JourneyIdentityCommand;
}) {
  const transition = applyJourneyIdentityCommandPersisted(input);
  if (transition.result.status !== 'replayed') {
    const state = loadJourneyIdentityState(input.spaceId);
    rebuildProfileTimeline(input.spaceId, state);
    rebuildIdentitySessions(input.spaceId, state);
    rebuildIdentitySegments(input.spaceId, state);
    recordJourneyIdentityCorrectionRun({
      spaceId: input.spaceId,
      actorUserId: null,
      command: input.command,
      state
    });
  }
  return transition;
}

function rowToTimelineEvent(row: any): JourneyProfileTimelineEvent {
  return {
    id: row.id,
    profileId: row.profile_id,
    canonicalProfileId: row.canonical_profile_id,
    eventKind: row.event_kind,
    occurredAt: row.occurred_at,
    title: row.title,
    summary: row.summary,
    sourceType: row.source_type,
    sourceId: row.source_id,
    detail: JSON.parse(row.detail_json || '{}'),
    createdAt: row.created_at
  };
}

export function listJourneyProfileTimeline(input: {
  spaceId: string;
  profileId: string;
  limit: number;
  offset: number;
}) {
  assertSubscriptionFeature(input.spaceId, 'journeyConnected');
  assertSubscriptionFeature(input.spaceId, 'journeyProfiles');
  const rows = (db.prepare(`SELECT * FROM journey_profile_timeline_events WHERE space_id=? AND profile_id=?`)
    .all(input.spaceId, input.profileId) as any[]).map(rowToTimelineEvent);
  return [...rows, ...journeyOperationalStageFeedRepository.listProfileTimeline(input.spaceId, input.profileId)]
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || right.id.localeCompare(left.id))
    .slice(input.offset, input.offset + input.limit);
}

export function listJourneyGroupTimeline(input: {
  spaceId: string;
  groupId: string;
  groupType: 'account' | 'group';
  limit: number;
  offset: number;
}) {
  assertSubscriptionFeature(input.spaceId, 'journeyConnected');
  assertSubscriptionFeature(input.spaceId, 'journeyProfiles');
  const state = loadJourneyIdentityState(input.spaceId);
  const memberIds = new Set(Object.values(state.memberships)
    .filter((membership) =>
      membership.spaceId === input.spaceId
      && membership.groupId === input.groupId
      && membership.groupType === input.groupType
      && !profileSuppressedForAnyPurpose(input.spaceId, membership.profileId))
    .map((membership) => membership.profileId));
  const rows = db.prepare(`SELECT * FROM journey_profile_timeline_events WHERE space_id=?`).all(input.spaceId) as any[];
  const operational = [...memberIds].flatMap((profileId) =>
    journeyOperationalStageFeedRepository.listProfileTimeline(input.spaceId, profileId));
  return [...rows.map(rowToTimelineEvent), ...operational]
    .filter((row) => memberIds.has(row.profileId))
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || right.id.localeCompare(left.id))
    .slice(input.offset, input.offset + input.limit);
}

function rowToSession(row: any): JourneyIdentitySession {
  return {
    id: row.id,
    spaceId: row.space_id,
    profileId: row.profile_id,
    canonicalProfileId: row.canonical_profile_id,
    identifierNamespace: row.identifier_namespace,
    identifierValue: row.identifier_value,
    startedAt: row.started_at,
    lastSeenAt: row.last_seen_at,
    endedAt: row.ended_at || null,
    eventCount: Number(row.event_count),
    sourceFactCount: Number(row.source_fact_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function listJourneyProfileSessions(input: {
  spaceId: string;
  profileId: string;
  limit: number;
  offset: number;
}) {
  assertSubscriptionFeature(input.spaceId, 'journeyConnected');
  assertSubscriptionFeature(input.spaceId, 'journeyProfiles');
  const rows = db.prepare(`SELECT * FROM journey_identity_sessions WHERE space_id=? AND profile_id=?
    ORDER BY last_seen_at DESC,id`).all(input.spaceId, input.profileId) as any[];
  return rows.slice(input.offset, input.offset + input.limit).map(rowToSession);
}

export function getJourneyIdentitySessionDetail(input: {
  spaceId: string;
  sessionId: string;
}) {
  assertSubscriptionFeature(input.spaceId, 'journeyConnected');
  assertSubscriptionFeature(input.spaceId, 'journeyProfiles');
  const row = db.prepare(`SELECT * FROM journey_identity_sessions WHERE space_id=? AND id=?`)
    .get(input.spaceId, input.sessionId) as any;
  if (!row) throw new JourneyIdentityRepositoryError('Journey session not found.', 404, 'JOURNEY_SESSION_NOT_FOUND');
  const session = rowToSession(row);
  const state = loadJourneyIdentityState(input.spaceId);
  const facts = state.sourceFacts
    .filter((fact) => fact.spaceId === input.spaceId && fact.profileId === session.profileId)
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || left.factId.localeCompare(right.factId));
  const profile = state.profiles[profileKey(input.spaceId, session.profileId)] || null;
  return {
    session,
    profile: profile ? {
      ...profile,
      canonicalProfileId: resolveCanonicalProfileId(state, input.spaceId, profile.profileId)
    } : null,
    sourceFacts: facts
  };
}

export function createJourneyIdentitySegment(input: {
  spaceId: string;
  actorUserId: string;
  name: string;
  description?: string;
  rule: unknown;
}) {
  assertSubscriptionFeature(input.spaceId, 'journeyConnected');
  assertSubscriptionFeature(input.spaceId, 'journeyProfiles');
  const rule = parseSegmentRule(input.rule);
  const now = new Date().toISOString();
  const segmentId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  db.transaction(() => {
    db.prepare(`INSERT INTO journey_identity_segments
      (id,space_id,name,description,state,active_version_id,active_version_number,materialized_member_count,created_by_user_id,created_at,updated_at)
      VALUES (?,?,?,?, 'active', ?,1,0,?,?,?)`)
      .run(segmentId, input.spaceId, input.name.trim(), String(input.description || '').trim(), versionId, input.actorUserId, now, now);
    db.prepare(`INSERT INTO journey_identity_segment_versions
      (id,space_id,segment_id,version_number,rule_json,state,validation_state,created_by_user_id,created_at)
      VALUES (?,?,?,?,?,'active','valid',?,?)`)
      .run(versionId, input.spaceId, segmentId, 1, JSON.stringify(rule), input.actorUserId, now);
    rebuildIdentitySegments(input.spaceId, loadJourneyIdentityState(input.spaceId));
  })();
  return getJourneyIdentitySegmentDetail({ spaceId: input.spaceId, segmentId });
}

export function createJourneyIdentitySegmentVersion(input: {
  spaceId: string;
  actorUserId: string;
  segmentId: string;
  rule: unknown;
}) {
  assertSubscriptionFeature(input.spaceId, 'journeyConnected');
  assertSubscriptionFeature(input.spaceId, 'journeyProfiles');
  const segment = db.prepare(`SELECT * FROM journey_identity_segments WHERE id=? AND space_id=?`)
    .get(input.segmentId, input.spaceId) as any;
  if (!segment) throw new JourneyIdentityRepositoryError('Journey segment not found.', 404, 'JOURNEY_SEGMENT_NOT_FOUND');
  const current = db.prepare(`SELECT COALESCE(MAX(version_number),0) value FROM journey_identity_segment_versions WHERE segment_id=? AND space_id=?`)
    .get(input.segmentId, input.spaceId) as any;
  const versionNumber = Number(current.value) + 1;
  const versionId = crypto.randomUUID();
  const rule = parseSegmentRule(input.rule);
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`UPDATE journey_identity_segment_versions SET state='superseded' WHERE segment_id=? AND space_id=? AND state='active'`)
      .run(input.segmentId, input.spaceId);
    db.prepare(`INSERT INTO journey_identity_segment_versions
      (id,space_id,segment_id,version_number,rule_json,state,validation_state,created_by_user_id,created_at)
      VALUES (?,?,?,?,?,'active','valid',?,?)`)
      .run(versionId, input.spaceId, input.segmentId, versionNumber, JSON.stringify(rule), input.actorUserId, now);
    db.prepare(`UPDATE journey_identity_segments
      SET active_version_id=?,active_version_number=?,updated_at=? WHERE id=? AND space_id=?`)
      .run(versionId, versionNumber, now, input.segmentId, input.spaceId);
    rebuildIdentitySegments(input.spaceId, loadJourneyIdentityState(input.spaceId));
  })();
  return getJourneyIdentitySegmentDetail({ spaceId: input.spaceId, segmentId: input.segmentId });
}

export function listJourneyIdentitySegments(input: {
  spaceId: string;
  state?: 'active' | 'retired';
  limit: number;
  offset: number;
}) {
  assertSubscriptionFeature(input.spaceId, 'journeyConnected');
  assertSubscriptionFeature(input.spaceId, 'journeyProfiles');
  const rows = db.prepare(`SELECT * FROM journey_identity_segments WHERE space_id=? ORDER BY updated_at DESC,id`)
    .all(input.spaceId) as any[];
  return rows.map(rowToSegment)
    .filter((row) => !input.state || row.state === input.state)
    .slice(input.offset, input.offset + input.limit);
}

export function getJourneyIdentitySegmentDetail(input: {
  spaceId: string;
  segmentId: string;
}) {
  assertSubscriptionFeature(input.spaceId, 'journeyConnected');
  assertSubscriptionFeature(input.spaceId, 'journeyProfiles');
  const row = db.prepare(`SELECT * FROM journey_identity_segments WHERE id=? AND space_id=?`)
    .get(input.segmentId, input.spaceId) as any;
  if (!row) throw new JourneyIdentityRepositoryError('Journey segment not found.', 404, 'JOURNEY_SEGMENT_NOT_FOUND');
  const segment = rowToSegment(row);
  const activeVersion = db.prepare(`SELECT * FROM journey_identity_segment_versions WHERE id=? AND space_id=?`)
    .get(segment.activeVersionId, input.spaceId) as any;
  const memberships = db.prepare(`SELECT * FROM journey_identity_segment_memberships WHERE segment_id=? AND space_id=?
    ORDER BY matched_at DESC,id`).all(input.segmentId, input.spaceId) as any[];
  return {
    segment,
    activeVersion: activeVersion ? rowToSegmentVersion(activeVersion) : null,
    memberships: memberships
      .filter((membership) => !profileSuppressedForAnyPurpose(input.spaceId, membership.profile_id))
      .map((membership) => ({
      id: membership.id,
      segmentId: membership.segment_id,
      segmentVersionId: membership.segment_version_id,
      profileId: membership.profile_id,
      canonicalProfileId: membership.canonical_profile_id,
      matchedAt: membership.matched_at
      }))
  };
}

function collectProfileSegmentMemberships(spaceId: string, profileId: string) {
  const rows = db.prepare(`SELECT membership.*,segment.name segment_name,segment.description segment_description
    FROM journey_identity_segment_memberships membership
    JOIN journey_identity_segments segment ON segment.id=membership.segment_id AND segment.space_id=membership.space_id
    WHERE membership.space_id=? AND membership.profile_id=?
    ORDER BY membership.matched_at DESC,membership.id`).all(spaceId, profileId) as any[];
  return rows.map((row) => ({
    id: row.id,
    segmentId: row.segment_id,
    segmentVersionId: row.segment_version_id,
    segmentName: row.segment_name,
    segmentDescription: row.segment_description || '',
    profileId: row.profile_id,
    canonicalProfileId: row.canonical_profile_id,
    matchedAt: row.matched_at
  }));
}

function consentSummaryForSessionHashes(input: {
  spaceId: string;
  anonymousHashes: string[];
  purpose: JourneyCustomer360Purpose;
}) {
  if (!input.anonymousHashes.length) {
    return { purpose: input.purpose, states: [] as Array<{ state: string; count: number }>, latestObservedAt: null };
  }
  const rows = db.prepare(`SELECT consent_state state,COUNT(*) count,MAX(received_at) latest
    FROM ${journeyEventDataTables.rawEvents}
    WHERE space_id=? AND anonymous_id_hash IN (${input.anonymousHashes.map(() => '?').join(',')})
    GROUP BY consent_state ORDER BY count DESC,consent_state`)
    .all(input.spaceId, ...input.anonymousHashes) as any[];
  return {
    purpose: input.purpose,
    states: rows.map((row) => ({ state: row.state, count: Number(row.count) })),
    latestObservedAt: rows.reduce<string | null>((latest, row) =>
      !latest || String(row.latest) > latest ? String(row.latest) : latest, null)
  };
}

function anonymousJourneyInstancesForSessionHashes(input: {
  spaceId: string;
  anonymousHashes: string[];
}) {
  if (!input.anonymousHashes.length) return [];
  const rows = db.prepare(`SELECT instance.id,instance.journey_definition_id,definition.name journey_name,instance.state,
      instance.current_stage_key,instance.first_event_at,instance.latest_event_at,instance.source_id,instance.environment
    FROM journey_anonymous_instances instance
    JOIN journey_definitions definition ON definition.id=instance.journey_definition_id AND definition.space_id=instance.space_id
    WHERE instance.space_id=? AND instance.anonymous_id_hash IN (${input.anonymousHashes.map(() => '?').join(',')})
    ORDER BY instance.latest_event_at DESC,instance.id`)
    .all(input.spaceId, ...input.anonymousHashes) as any[];
  return rows.map((row) => ({
    instanceId: row.id,
    journeyDefinitionId: row.journey_definition_id,
    journeyName: row.journey_name,
    state: row.state,
    currentStageKey: row.current_stage_key || null,
    firstEventAt: row.first_event_at,
    latestEventAt: row.latest_event_at,
    sourceId: row.source_id,
    environment: row.environment
  }));
}

export function getJourneyProfileCustomer360(input: {
  spaceId: string;
  profileId: string;
  purpose: JourneyCustomer360Purpose;
}) {
  assertSubscriptionFeature(input.spaceId, 'journeyConnected');
  assertSubscriptionFeature(input.spaceId, 'journeyProfiles');
  const state = loadJourneyIdentityState(input.spaceId);
  const profile = state.profiles[profileKey(input.spaceId, input.profileId)];
  if (!profile) throw new JourneyIdentityRepositoryError('Journey profile not found.', 404, 'JOURNEY_PROFILE_NOT_FOUND');
  const privacyState = effectiveProfilePrivacyState(input.spaceId, input.profileId, input.purpose);
  if (privacyState.state === 'denied' || privacyState.state === 'suppressed') {
    throw new JourneyIdentityRepositoryError('Customer 360 access is blocked for this purpose by the profile privacy state.', 403,
      'JOURNEY_PROFILE_PRIVACY_BLOCKED', { purpose: input.purpose, state: privacyState.state });
  }
  const canonicalProfileId = resolveCanonicalProfileId(state, input.spaceId, input.profileId);
  const bindings = Object.values(state.bindings).filter((binding) => binding.spaceId === input.spaceId && binding.profileId === input.profileId);
  const sessions = listJourneyProfileSessions({ spaceId: input.spaceId, profileId: input.profileId, limit: 100, offset: 0 });
  const sessionHashes = bindings
    .filter((binding) => binding.identifier.kind === 'anonymous_id')
    .map((binding) => hashedAnonymousId(binding.identifier.value));
  return {
    profile: {
      ...profile,
      canonicalProfileId
    },
    purpose: input.purpose,
    privacyState,
    identitySummary: {
      identifierCount: bindings.length,
      anonymousIdentifierCount: bindings.filter((binding) => binding.identifier.kind === 'anonymous_id').length,
      knownIdentifierCount: bindings.filter((binding) => binding.identifier.kind !== 'anonymous_id').length
    },
    consentSummary: consentSummaryForSessionHashes({ spaceId: input.spaceId, anonymousHashes: sessionHashes, purpose: input.purpose }),
    memberships: {
      accounts: currentGroupTypeForProfile(state, input.spaceId, input.profileId, 'account'),
      groups: currentGroupTypeForProfile(state, input.spaceId, input.profileId, 'group')
    },
    segmentMemberships: collectProfileSegmentMemberships(input.spaceId, input.profileId),
    sessions,
    journeyInstances: anonymousJourneyInstancesForSessionHashes({ spaceId: input.spaceId, anonymousHashes: sessionHashes }),
    timeline: listJourneyProfileTimeline({ spaceId: input.spaceId, profileId: input.profileId, limit: 100, offset: 0 })
  };
}

export function getJourneyAccountCustomer360(input: {
  spaceId: string;
  accountId: string;
  purpose: JourneyCustomer360Purpose;
}) {
  assertSubscriptionFeature(input.spaceId, 'journeyConnected');
  assertSubscriptionFeature(input.spaceId, 'journeyProfiles');
  const detail = getJourneyIdentityGroupDetail({ spaceId: input.spaceId, groupId: input.accountId });
  if (detail.group.groupType !== 'account') {
    throw new JourneyIdentityRepositoryError('Journey account not found.', 404, 'JOURNEY_GROUP_NOT_FOUND');
  }
  const memberProfiles = (detail.members as Array<any>).filter((member) => {
    const privacyState = effectiveProfilePrivacyState(input.spaceId, member.profileId, input.purpose);
    return privacyState.state !== 'denied' && privacyState.state !== 'suppressed';
  });
  const segmentMemberships = memberProfiles.flatMap((member) => collectProfileSegmentMemberships(input.spaceId, member.profileId));
  const dedupedSegmentIds = new Set<string>();
  const accountSegments = segmentMemberships.filter((row) => {
    if (dedupedSegmentIds.has(row.segmentId)) return false;
    dedupedSegmentIds.add(row.segmentId);
    return true;
  });
  const journeyInstances = memberProfiles.flatMap((member) => {
    const state = loadJourneyIdentityState(input.spaceId);
    const bindings = Object.values(state.bindings).filter((binding) =>
      binding.spaceId === input.spaceId && binding.profileId === member.profileId && binding.identifier.kind === 'anonymous_id');
    const hashes = bindings.map((binding) => hashedAnonymousId(binding.identifier.value));
    return anonymousJourneyInstancesForSessionHashes({ spaceId: input.spaceId, anonymousHashes: hashes });
  });
  const allowedMemberIds = new Set(memberProfiles.map((member) => member.profileId));
  const timeline = listJourneyGroupTimeline({
    spaceId: input.spaceId,
    groupId: input.accountId,
    groupType: 'account',
    limit: 100,
    offset: 0
  }).filter((event) => allowedMemberIds.has(event.profileId));
  return {
    account: detail.group,
    purpose: input.purpose,
    memberCount: memberProfiles.length,
    members: memberProfiles,
    segmentMemberships: accountSegments,
    journeyInstances,
    timeline
  };
}

export function listJourneyProfilePrivacyStates(input: {
  spaceId: string;
  profileId: string;
}) {
  assertSubscriptionFeature(input.spaceId, 'journeyConnected');
  assertSubscriptionFeature(input.spaceId, 'journeyProfiles');
  const profile = loadJourneyIdentityState(input.spaceId).profiles[profileKey(input.spaceId, input.profileId)];
  if (!profile) throw new JourneyIdentityRepositoryError('Journey profile not found.', 404, 'JOURNEY_PROFILE_NOT_FOUND');
  const rows = db.prepare(`SELECT * FROM journey_profile_privacy_states WHERE space_id=? AND profile_id=? ORDER BY purpose`)
    .all(input.spaceId, input.profileId) as any[];
  const map = new Map(rows.map((row) => [row.purpose, rowToPrivacyState(row)]));
  return (['analytics', 'personalisation', 'research_contact', 'marketing'] as JourneyCustomer360Purpose[])
    .map((purpose) => map.get(purpose) || {
      profileId: input.profileId,
      purpose,
      state: 'unknown',
      lawfulBasis: null,
      policyReference: null,
      updatedAt: '',
      updatedByUserId: null
    });
}

export function upsertJourneyProfilePrivacyState(input: {
  spaceId: string;
  actorUserId: string;
  profileId: string;
  purpose: JourneyCustomer360Purpose;
  state: JourneyProfilePrivacyState['state'];
  lawfulBasis?: string | null;
  policyReference?: string | null;
}) {
  assertSubscriptionFeature(input.spaceId, 'journeyConnected');
  assertSubscriptionFeature(input.spaceId, 'journeyProfiles');
  const profile = loadJourneyIdentityState(input.spaceId).profiles[profileKey(input.spaceId, input.profileId)];
  if (!profile) throw new JourneyIdentityRepositoryError('Journey profile not found.', 404, 'JOURNEY_PROFILE_NOT_FOUND');
  const at = new Date().toISOString();
  db.prepare(`INSERT INTO journey_profile_privacy_states
    (space_id,profile_id,purpose,state,lawful_basis,policy_reference,updated_at,updated_by_user_id)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(space_id,profile_id,purpose) DO UPDATE SET
      state=excluded.state,
      lawful_basis=excluded.lawful_basis,
      policy_reference=excluded.policy_reference,
      updated_at=excluded.updated_at,
      updated_by_user_id=excluded.updated_by_user_id`).run(
        input.spaceId,
        input.profileId,
        input.purpose,
        input.state,
        input.lawfulBasis || null,
        input.policyReference || null,
        at,
        input.actorUserId
      );
  return effectiveProfilePrivacyState(input.spaceId, input.profileId, input.purpose);
}

function rowToExportJob(row: any): JourneyProfileExportJob {
  return {
    id: row.id,
    spaceId: row.space_id,
    profileId: row.profile_id,
    purpose: row.purpose,
    format: row.format,
    state: row.state,
    requestedByUserId: row.requested_by_user_id || null,
    createdAt: row.created_at,
    completedAt: row.completed_at
  };
}

function rowToPrivacyJob(row: any): JourneyProfilePrivacyJob {
  return {
    id: row.id,
    spaceId: row.space_id,
    profileId: row.profile_id,
    operation: row.operation,
    purpose: row.purpose || null,
    state: row.state,
    requestedByUserId: row.requested_by_user_id || null,
    createdAt: row.created_at,
    completedAt: row.completed_at || null
  };
}

function rowToCorrectionRun(row: any): JourneyIdentityCorrectionRun {
  return {
    id: row.id,
    spaceId: row.space_id,
    reason: row.reason,
    commandId: row.command_id,
    profileIds: JSON.parse(row.profile_ids_json || '[]'),
    state: row.state,
    requestedByUserId: row.requested_by_user_id || null,
    createdAt: row.created_at,
    completedAt: row.completed_at
  };
}

export function createJourneyProfileExportJob(input: {
  spaceId: string;
  actorUserId: string;
  profileId: string;
  purpose: JourneyCustomer360Purpose;
}) {
  assertSubscriptionFeature(input.spaceId, 'journeyConnected');
  assertSubscriptionFeature(input.spaceId, 'journeyProfiles');
  assertSubscriptionFeature(input.spaceId, 'journeyExports');
  const privacyState = effectiveProfilePrivacyState(input.spaceId, input.profileId, input.purpose);
  if (privacyState.state === 'denied' || privacyState.state === 'suppressed') {
    throw new JourneyIdentityRepositoryError('Profile export is blocked for this purpose by the profile privacy state.', 403,
      'JOURNEY_PROFILE_PRIVACY_BLOCKED', { purpose: input.purpose, state: privacyState.state });
  }
  const exportBody = {
    schema: 'seemplify.journey-profile-export/v1',
    exportedAt: new Date().toISOString(),
    profile360: getJourneyProfileCustomer360({ spaceId: input.spaceId, profileId: input.profileId, purpose: input.purpose }),
    profileDetail: getJourneyIdentityProfileDetail({ spaceId: input.spaceId, profileId: input.profileId }),
    privacyStates: listJourneyProfilePrivacyStates({ spaceId: input.spaceId, profileId: input.profileId })
  };
  const jobId = crypto.randomUUID();
  const at = new Date().toISOString();
  db.prepare(`INSERT INTO journey_profile_export_jobs
    (id,space_id,profile_id,purpose,format,state,export_json,requested_by_user_id,created_at,completed_at)
    VALUES (?,?,?,?,'json','completed',?,?,?,?)`)
    .run(jobId, input.spaceId, input.profileId, input.purpose, JSON.stringify(exportBody), input.actorUserId, at, at);
  return {
    job: rowToExportJob(db.prepare(`SELECT * FROM journey_profile_export_jobs WHERE id=? AND space_id=?`)
      .get(jobId, input.spaceId)),
    export: exportBody
  };
}

export function getJourneyProfileExportJob(input: {
  spaceId: string;
  jobId: string;
}) {
  assertSubscriptionFeature(input.spaceId, 'journeyConnected');
  assertSubscriptionFeature(input.spaceId, 'journeyProfiles');
  assertSubscriptionFeature(input.spaceId, 'journeyExports');
  const row = db.prepare(`SELECT * FROM journey_profile_export_jobs WHERE id=? AND space_id=?`)
    .get(input.jobId, input.spaceId) as any;
  if (!row) throw new JourneyIdentityRepositoryError('Journey profile export job not found.', 404, 'JOURNEY_PROFILE_EXPORT_NOT_FOUND');
  return {
    job: rowToExportJob(row),
    export: JSON.parse(row.export_json || '{}')
  };
}

export function createJourneyProfilePrivacyJob(input: {
  spaceId: string;
  actorUserId: string;
  profileId: string;
  operation: JourneyProfilePrivacyJobOperation;
  purpose?: JourneyCustomer360Purpose | null;
  lawfulBasis?: string | null;
  policyReference?: string | null;
  reason?: string | null;
}) {
  assertSubscriptionFeature(input.spaceId, 'journeyConnected');
  assertSubscriptionFeature(input.spaceId, 'journeyProfiles');
  getJourneyIdentityProfileDetail({ spaceId: input.spaceId, profileId: input.profileId });
  const purposes = input.purpose ? [input.purpose] : (['analytics', 'personalisation', 'research_contact', 'marketing'] as const);
  const jobId = crypto.randomUUID();
  const at = new Date().toISOString();
  const propagated = executeJourneyProfilePrivacyPropagation({ spaceId: input.spaceId, profileId: input.profileId });
  const pendingTargets = [
    'journey_raw_events',
    'journey_metric_observations',
    'journey_research_hub',
    'journey_actions'
  ];
  if (propagated.linkedAnonymousStageVisits > 0) {
    pendingTargets.push('journey_anonymous_instances', 'journey_anonymous_stage_visits', 'journey_stage_rule_decisions',
      'journey_actual_path_snapshots');
  }
  const remainingPendingTargets = pendingTargets.filter((target) => !propagated.executedTargets.includes(target));
  let state: JourneyProfilePrivacyJobState = 'queued';
  let completedAt: string | null = null;
  let result: Record<string, unknown>;
  if (input.operation === 'suppress') {
    for (const purpose of purposes) {
      upsertJourneyProfilePrivacyState({
        spaceId: input.spaceId,
        actorUserId: input.actorUserId,
        profileId: input.profileId,
        purpose,
        state: 'suppressed',
        lawfulBasis: input.lawfulBasis || 'privacy_request',
        policyReference: input.policyReference || null
      });
    }
    state = 'completed';
    completedAt = at;
    result = {
      appliedPurposes: purposes,
      ...propagated,
      pendingPropagationTargets: remainingPendingTargets,
      propagationState: remainingPendingTargets.length ? 'partially_completed_pending_downstream_execution' : 'completed',
      reason: input.reason || null
    };
  } else {
    for (const purpose of ['analytics', 'personalisation', 'research_contact', 'marketing'] as const) {
      upsertJourneyProfilePrivacyState({
        spaceId: input.spaceId,
        actorUserId: input.actorUserId,
        profileId: input.profileId,
        purpose,
        state: 'suppressed',
        lawfulBasis: input.lawfulBasis || 'erasure_requested',
        policyReference: input.policyReference || null
      });
    }
    result = {
      requestedPurposes: ['analytics', 'personalisation', 'research_contact', 'marketing'],
      ...propagated,
      pendingPropagationTargets: remainingPendingTargets,
      propagationState: remainingPendingTargets.length ? 'queued_for_downstream_execution' : 'completed',
      reason: input.reason || null
    };
  }
  db.prepare(`INSERT INTO journey_profile_privacy_jobs
    (id,space_id,profile_id,operation,purpose,state,request_json,result_json,requested_by_user_id,created_at,completed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(jobId, input.spaceId, input.profileId, input.operation, input.purpose || null, state,
      JSON.stringify({
        operation: input.operation,
        purpose: input.purpose || null,
        lawfulBasis: input.lawfulBasis || null,
        policyReference: input.policyReference || null,
        reason: input.reason || null
      }),
      JSON.stringify(result),
      input.actorUserId,
      at,
      completedAt);
  return {
    job: rowToPrivacyJob(db.prepare(`SELECT * FROM journey_profile_privacy_jobs WHERE id=? AND space_id=?`).get(jobId, input.spaceId)),
    result
  };
}

export function getJourneyProfilePrivacyJob(input: {
  spaceId: string;
  jobId: string;
}) {
  assertSubscriptionFeature(input.spaceId, 'journeyConnected');
  assertSubscriptionFeature(input.spaceId, 'journeyProfiles');
  const row = db.prepare(`SELECT * FROM journey_profile_privacy_jobs WHERE id=? AND space_id=?`)
    .get(input.jobId, input.spaceId) as any;
  if (!row) throw new JourneyIdentityRepositoryError('Journey profile privacy job not found.', 404, 'JOURNEY_PROFILE_PRIVACY_JOB_NOT_FOUND');
  return {
    job: rowToPrivacyJob(row),
    request: JSON.parse(row.request_json || '{}'),
    result: JSON.parse(row.result_json || '{}')
  };
}

export function listJourneyIdentityCorrectionRuns(input: {
  spaceId: string;
  profileId?: string;
  limit: number;
  offset: number;
}) {
  assertSubscriptionFeature(input.spaceId, 'journeyConnected');
  assertSubscriptionFeature(input.spaceId, 'journeyProfiles');
  const rows = db.prepare(`SELECT * FROM journey_identity_correction_runs WHERE space_id=?
    ORDER BY created_at DESC,id DESC`).all(input.spaceId) as any[];
  const filtered = rows
    .map((row) => ({ run: rowToCorrectionRun(row), result: JSON.parse(row.result_json || '{}') }))
    .filter((entry) => !input.profileId || entry.run.profileIds.includes(input.profileId));
  return filtered.slice(input.offset, input.offset + input.limit);
}
