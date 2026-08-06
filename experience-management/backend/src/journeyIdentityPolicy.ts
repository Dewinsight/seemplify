/**
 * Pure identity-resolution policy for connected journeys.
 *
 * This module deliberately has no database, HTTP, consent, or Customer 360
 * dependencies. Callers must persist the returned state atomically and must
 * supply opaque/pseudonymous identifiers rather than raw personal data.
 */

export const JOURNEY_IDENTITY_POLICY_VERSION = 'journey.identity-policy.v1' as const;
export const JOURNEY_IDENTITY_STATE_VERSION = 'journey.identity-state.v1' as const;

export type JourneyIdentityPolicyVersion = typeof JOURNEY_IDENTITY_POLICY_VERSION;
export type JourneyIdentityStateVersion = typeof JOURNEY_IDENTITY_STATE_VERSION;

export type ExactIdentityIdentifierKind =
  | 'anonymous_id'
  | 'authenticated_user_id'
  | 'external_user_id';

/** These signals must never be used as identity joins by this policy. */
export type ForbiddenHeuristicIdentifierKind =
  | 'email'
  | 'name'
  | 'ip_address'
  | 'device_id'
  | 'device_fingerprint';

export type IdentityIdentifierKind = ExactIdentityIdentifierKind | ForbiddenHeuristicIdentifierKind;

export type JourneyIdentityIdentifier = {
  kind: IdentityIdentifierKind;
  /** Issuer/source namespace. Values only compare inside this namespace. */
  namespace: string;
  /** Opaque, case-sensitive value. The policy never normalises it. */
  value: string;
};

export type JourneyIdentityPermission =
  | 'identity:observe'
  | 'identity:identify'
  | 'identity:alias'
  | 'identity:merge'
  | 'identity:split'
  | 'identity:membership'
  | 'identity:delete';

export type JourneyIdentityActor = {
  actorId: string;
  spaceId: string;
  authenticated: boolean;
  permissions: JourneyIdentityPermission[];
};

export type JourneyIdentityProfileRef = {
  spaceId: string;
  profileId: string;
};

export type JourneyIdentitySourceFactInput = {
  factId: string;
  source: string;
  sourceRef: string;
  occurredAt: string;
};

export type JourneyIdentitySourceFact = JourneyIdentitySourceFactInput & {
  spaceId: string;
  profileId: string;
  recordedByCommandId: string;
};

export type JourneyIdentityProfile = {
  spaceId: string;
  profileId: string;
  kind: 'anonymous' | 'known';
  status: 'active' | 'deleted';
  createdAt: string;
  createdByCommandId: string;
  knownAt?: string;
  deletedAt?: string;
};

export type JourneyIdentityBinding = {
  spaceId: string;
  identifier: JourneyIdentityIdentifier & { kind: ExactIdentityIdentifierKind };
  profileId: string;
  boundAt: string;
  boundByCommandId: string;
};

export type JourneyIdentityMerge = {
  mergeAuditId: string;
  spaceId: string;
  sourceProfileId: string;
  targetProfileId: string;
  canonicalTargetProfileId: string;
  reason: string;
  active: boolean;
  mergedAt: string;
  mergedByCommandId: string;
  splitAt?: string;
  splitByCommandId?: string;
};

export type JourneyIdentityMembership = {
  membershipId: string;
  spaceId: string;
  profileId: string;
  groupType: 'account' | 'group';
  groupId: string;
  active: boolean;
  addedAt: string;
  addedByCommandId: string;
  removedAt?: string;
  removedByCommandId?: string;
};

export type JourneyIdentityTombstone = {
  spaceId: string;
  profileId: string;
  deletedAt: string;
  deletedByCommandId: string;
  reason: string;
};

export type JourneyIdentityAuditFact = {
  auditId: string;
  policyVersion: JourneyIdentityPolicyVersion;
  commandId: string;
  spaceId: string;
  actorId: string;
  action: JourneyIdentityCommand['type'];
  outcome: 'accepted' | 'rejected';
  code: JourneyIdentityDecisionCode;
  explanation: string;
  occurredAt: string;
  details: Record<string, string | number | boolean | string[]>;
};

export type JourneyIdentityDecisionCode =
  | 'profile_observed'
  | 'profile_identified'
  | 'identifier_aliased'
  | 'profiles_merged'
  | 'merge_split'
  | 'membership_added'
  | 'membership_removed'
  | 'profile_deleted'
  | 'idempotent_replay'
  | 'unsupported_policy_version'
  | 'actor_not_authenticated'
  | 'permission_denied'
  | 'cross_space_reference'
  | 'invalid_identifier'
  | 'heuristic_identifier_forbidden'
  | 'identifier_kind_not_allowed'
  | 'profile_not_found'
  | 'profile_already_exists'
  | 'profile_kind_conflict'
  | 'identifier_conflict'
  | 'source_fact_conflict'
  | 'profile_deleted_tombstone'
  | 'merge_cycle'
  | 'already_merged'
  | 'merge_not_found'
  | 'merge_already_split'
  | 'anonymous_membership_forbidden'
  | 'membership_not_found'
  | 'membership_already_active'
  | 'membership_already_removed'
  | 'command_id_conflict'
  | 'invalid_command';

export type JourneyIdentityDecision = {
  policyVersion: JourneyIdentityPolicyVersion;
  stateVersion: JourneyIdentityStateVersion;
  commandId: string;
  status: 'accepted' | 'rejected' | 'replayed';
  code: JourneyIdentityDecisionCode;
  explanation: string;
  audit: JourneyIdentityAuditFact;
  resolvedProfileId?: string;
  canonicalProfileId?: string;
  mergeAuditId?: string;
  membershipId?: string;
  sourceFactId?: string;
  replayedOutcome?: 'accepted' | 'rejected';
  replayedCode?: JourneyIdentityDecisionCode;
};

type JourneyIdentityCommandBase = {
  policyVersion: JourneyIdentityPolicyVersion;
  commandId: string;
  spaceId: string;
  occurredAt: string;
  actor: JourneyIdentityActor;
};

export type JourneyIdentityObserveCommand = JourneyIdentityCommandBase & {
  type: 'observe';
  profileId: string;
  profileKind: 'anonymous' | 'known';
  identifier: JourneyIdentityIdentifier;
  sourceFact: JourneyIdentitySourceFactInput;
};

export type JourneyIdentityIdentifyCommand = JourneyIdentityCommandBase & {
  type: 'identify';
  profile: JourneyIdentityProfileRef;
  identifier: JourneyIdentityIdentifier;
  sourceFact: JourneyIdentitySourceFactInput;
};

export type JourneyIdentityAliasCommand = JourneyIdentityCommandBase & {
  type: 'alias';
  profile: JourneyIdentityProfileRef;
  identifier: JourneyIdentityIdentifier;
  reason: string;
};

export type JourneyIdentityMergeCommand = JourneyIdentityCommandBase & {
  type: 'merge';
  source: JourneyIdentityProfileRef;
  target: JourneyIdentityProfileRef;
  reason: string;
};

export type JourneyIdentitySplitCommand = JourneyIdentityCommandBase & {
  type: 'split';
  mergeAuditId: string;
  reason: string;
};

export type JourneyIdentityAddMembershipCommand = JourneyIdentityCommandBase & {
  type: 'add_membership';
  profile: JourneyIdentityProfileRef;
  group: { spaceId: string; groupType: 'account' | 'group'; groupId: string };
  sourceFact: JourneyIdentitySourceFactInput;
};

export type JourneyIdentityRemoveMembershipCommand = JourneyIdentityCommandBase & {
  type: 'remove_membership';
  membershipId: string;
  reason: string;
};

export type JourneyIdentityDeleteCommand = JourneyIdentityCommandBase & {
  type: 'delete';
  profile: JourneyIdentityProfileRef;
  reason: string;
};

export type JourneyIdentityCommand =
  | JourneyIdentityObserveCommand
  | JourneyIdentityIdentifyCommand
  | JourneyIdentityAliasCommand
  | JourneyIdentityMergeCommand
  | JourneyIdentitySplitCommand
  | JourneyIdentityAddMembershipCommand
  | JourneyIdentityRemoveMembershipCommand
  | JourneyIdentityDeleteCommand;

type ProcessedIdentityCommand = {
  fingerprint: string;
  decision: JourneyIdentityDecision;
};

export type JourneyIdentityStateV1 = {
  stateVersion: JourneyIdentityStateVersion;
  policyVersion: JourneyIdentityPolicyVersion;
  profiles: Record<string, JourneyIdentityProfile>;
  bindings: Record<string, JourneyIdentityBinding>;
  merges: Record<string, JourneyIdentityMerge>;
  memberships: Record<string, JourneyIdentityMembership>;
  sourceFacts: JourneyIdentitySourceFact[];
  auditFacts: JourneyIdentityAuditFact[];
  profileTombstones: Record<string, JourneyIdentityTombstone>;
  identifierTombstones: Record<string, JourneyIdentityTombstone>;
  processedCommands: Record<string, ProcessedIdentityCommand>;
};

export type JourneyIdentityTransition = {
  state: JourneyIdentityStateV1;
  result: JourneyIdentityDecision;
};

export type JourneyIdentityLookupResult = {
  policyVersion: JourneyIdentityPolicyVersion;
  stateVersion: JourneyIdentityStateVersion;
  status: 'resolved' | 'not_found' | 'deleted' | 'rejected';
  code: 'exact_match' | 'identifier_not_found' | 'profile_deleted_tombstone'
    | 'heuristic_identifier_forbidden' | 'invalid_identifier';
  explanation: string;
  spaceId: string;
  boundProfileId?: string;
  canonicalProfileId?: string;
};

export class JourneyIdentityStateVersionError extends Error {
  constructor(public readonly receivedVersion: string) {
    super(`Unsupported journey identity state version: ${receivedVersion}`);
    this.name = 'JourneyIdentityStateVersionError';
  }
}

const forbiddenKinds = new Set<IdentityIdentifierKind>([
  'email', 'name', 'ip_address', 'device_id', 'device_fingerprint'
]);

const exactKinds = new Set<IdentityIdentifierKind>([
  'anonymous_id', 'authenticated_user_id', 'external_user_id'
]);

function tupleKey(...parts: string[]): string {
  return JSON.stringify(parts);
}

function profileKey(spaceId: string, profileId: string): string {
  return tupleKey(spaceId, profileId);
}

function identifierKey(spaceId: string, identifier: JourneyIdentityIdentifier): string {
  return tupleKey(spaceId, identifier.kind, identifier.namespace, identifier.value);
}

function processedCommandKey(command: JourneyIdentityCommand): string {
  return tupleKey(command.spaceId, command.commandId);
}

function membershipKey(spaceId: string, groupType: 'account' | 'group', groupId: string, profileId: string): string {
  return tupleKey(spaceId, groupType, groupId, profileId);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function auditId(command: JourneyIdentityCommand): string {
  return `identity-audit:${encodeURIComponent(command.spaceId)}:${encodeURIComponent(command.commandId)}`;
}

function mergeAuditId(command: JourneyIdentityMergeCommand): string {
  return `identity-merge:${encodeURIComponent(command.spaceId)}:${encodeURIComponent(command.commandId)}`;
}

function membershipId(command: JourneyIdentityAddMembershipCommand): string {
  return `identity-membership:${encodeURIComponent(command.spaceId)}:${encodeURIComponent(command.commandId)}`;
}

function assertStateVersion(state: JourneyIdentityStateV1): void {
  if (state.stateVersion !== JOURNEY_IDENTITY_STATE_VERSION || state.policyVersion !== JOURNEY_IDENTITY_POLICY_VERSION) {
    throw new JourneyIdentityStateVersionError(String(state.stateVersion));
  }
}

function cloneState(state: JourneyIdentityStateV1): JourneyIdentityStateV1 {
  return {
    ...state,
    profiles: { ...state.profiles },
    bindings: { ...state.bindings },
    merges: { ...state.merges },
    memberships: { ...state.memberships },
    sourceFacts: [...state.sourceFacts],
    auditFacts: [...state.auditFacts],
    profileTombstones: { ...state.profileTombstones },
    identifierTombstones: { ...state.identifierTombstones },
    processedCommands: { ...state.processedCommands }
  };
}

export function createJourneyIdentityStateV1(): JourneyIdentityStateV1 {
  return {
    stateVersion: JOURNEY_IDENTITY_STATE_VERSION,
    policyVersion: JOURNEY_IDENTITY_POLICY_VERSION,
    profiles: {},
    bindings: {},
    merges: {},
    memberships: {},
    sourceFacts: [],
    auditFacts: [],
    profileTombstones: {},
    identifierTombstones: {},
    processedCommands: {}
  };
}

function validateIdentifier(identifier: JourneyIdentityIdentifier): {
  ok: true;
  identifier: JourneyIdentityIdentifier & { kind: ExactIdentityIdentifierKind };
} | {
  ok: false;
  code: 'invalid_identifier' | 'heuristic_identifier_forbidden';
  explanation: string;
} {
  if (!identifier || !exactKinds.has(identifier.kind)) {
    if (identifier && forbiddenKinds.has(identifier.kind)) {
      return {
        ok: false,
        code: 'heuristic_identifier_forbidden',
        explanation: `${identifier.kind} is a heuristic or personal signal and cannot be used to resolve, alias, or merge profiles.`
      };
    }
    return { ok: false, code: 'invalid_identifier', explanation: 'Identifier kind is not recognised by policy v1.' };
  }
  if (!identifier.namespace || identifier.namespace.trim() !== identifier.namespace
      || !identifier.value || identifier.value.trim() !== identifier.value
      || identifier.namespace.length > 160 || identifier.value.length > 512) {
    return {
      ok: false,
      code: 'invalid_identifier',
      explanation: 'Exact identifiers require non-empty, unmodified namespace and value fields within policy limits.'
    };
  }
  return { ok: true, identifier: identifier as JourneyIdentityIdentifier & { kind: ExactIdentityIdentifierKind } };
}

function getProfile(state: JourneyIdentityStateV1, ref: JourneyIdentityProfileRef): JourneyIdentityProfile | undefined {
  return state.profiles[profileKey(ref.spaceId, ref.profileId)];
}

function isReferenceCrossSpace(commandSpaceId: string, ref: JourneyIdentityProfileRef): boolean {
  return ref.spaceId !== commandSpaceId;
}

function canonicalProfileId(state: JourneyIdentityStateV1, spaceId: string, initialProfileId: string): string {
  let current = initialProfileId;
  const visited = new Set<string>();
  for (;;) {
    if (visited.has(current)) return current;
    visited.add(current);
    const active = Object.values(state.merges).find((merge) => (
      merge.spaceId === spaceId && merge.active && merge.sourceProfileId === current
    ));
    if (!active) return current;
    current = active.canonicalTargetProfileId;
  }
}

function findSourceFact(state: JourneyIdentityStateV1, spaceId: string, factId: string): JourneyIdentitySourceFact | undefined {
  return state.sourceFacts.find((fact) => fact.spaceId === spaceId && fact.factId === factId);
}

function addSourceFact(
  state: JourneyIdentityStateV1,
  command: JourneyIdentityCommand,
  profileId: string,
  input: JourneyIdentitySourceFactInput
): void {
  state.sourceFacts.push({
    ...input,
    spaceId: command.spaceId,
    profileId,
    recordedByCommandId: command.commandId
  });
}

function hasPermission(command: JourneyIdentityCommand, permission: JourneyIdentityPermission): boolean {
  return command.actor.authenticated && command.actor.permissions.includes(permission);
}

function baseDetails(command: JourneyIdentityCommand): Record<string, string | number | boolean | string[]> {
  return { policyVersion: JOURNEY_IDENTITY_POLICY_VERSION, stateVersion: JOURNEY_IDENTITY_STATE_VERSION };
}

function finish(
  state: JourneyIdentityStateV1,
  command: JourneyIdentityCommand,
  status: 'accepted' | 'rejected',
  code: JourneyIdentityDecisionCode,
  explanation: string,
  details: Record<string, string | number | boolean | string[]> = {},
  resultFields: Partial<Pick<JourneyIdentityDecision,
    'resolvedProfileId' | 'canonicalProfileId' | 'mergeAuditId' | 'membershipId' | 'sourceFactId'>> = {}
): JourneyIdentityTransition {
  const next = cloneState(state);
  const audit: JourneyIdentityAuditFact = {
    auditId: auditId(command),
    policyVersion: JOURNEY_IDENTITY_POLICY_VERSION,
    commandId: command.commandId,
    spaceId: command.spaceId,
    actorId: command.actor.actorId,
    action: command.type,
    outcome: status,
    code,
    explanation,
    occurredAt: command.occurredAt,
    details: { ...baseDetails(command), ...details }
  };
  const result: JourneyIdentityDecision = {
    policyVersion: JOURNEY_IDENTITY_POLICY_VERSION,
    stateVersion: JOURNEY_IDENTITY_STATE_VERSION,
    commandId: command.commandId,
    status,
    code,
    explanation,
    audit,
    ...resultFields
  };
  next.auditFacts.push(audit);
  next.processedCommands[processedCommandKey(command)] = {
    fingerprint: canonicalJson(command),
    decision: result
  };
  return { state: next, result };
}

function reject(
  state: JourneyIdentityStateV1,
  command: JourneyIdentityCommand,
  code: JourneyIdentityDecisionCode,
  explanation: string,
  details: Record<string, string | number | boolean | string[]> = {}
): JourneyIdentityTransition {
  return finish(state, command, 'rejected', code, explanation, details);
}

function rejectMissingOrDeletedProfile(
  state: JourneyIdentityStateV1,
  command: JourneyIdentityCommand,
  ref: JourneyIdentityProfileRef
): JourneyIdentityTransition | undefined {
  if (isReferenceCrossSpace(command.spaceId, ref)) {
    return reject(state, command, 'cross_space_reference',
      `Profile ${ref.profileId} belongs to space ${ref.spaceId}; identity operations cannot cross ${command.spaceId}.`,
      { referencedSpaceId: ref.spaceId, profileId: ref.profileId });
  }
  const profile = getProfile(state, ref);
  if (!profile) {
    return reject(state, command, 'profile_not_found', `Profile ${ref.profileId} was not found in space ${command.spaceId}.`,
      { profileId: ref.profileId });
  }
  if (profile.status === 'deleted' || state.profileTombstones[profileKey(ref.spaceId, ref.profileId)]) {
    return reject(state, command, 'profile_deleted_tombstone',
      `Profile ${ref.profileId} has a deletion tombstone and cannot be resolved or resurrected.`,
      { profileId: ref.profileId });
  }
  return undefined;
}

function validateCommon(state: JourneyIdentityStateV1, command: JourneyIdentityCommand): JourneyIdentityTransition | undefined {
  if ((command.policyVersion as string) !== JOURNEY_IDENTITY_POLICY_VERSION) {
    return reject(state, command, 'unsupported_policy_version',
      `Command requested ${String(command.policyVersion)}; this reducer only implements ${JOURNEY_IDENTITY_POLICY_VERSION}.`);
  }
  if (!command.commandId || !command.spaceId || !command.occurredAt || !command.actor.actorId) {
    return reject(state, command, 'invalid_command', 'Command id, space, timestamp, and actor id are required.');
  }
  if (!command.actor.authenticated) {
    return reject(state, command, 'actor_not_authenticated', 'Identity changes require an authenticated actor.');
  }
  if (command.actor.spaceId !== command.spaceId) {
    return reject(state, command, 'cross_space_reference',
      `Actor is scoped to ${command.actor.spaceId} and cannot operate in ${command.spaceId}.`,
      { actorSpaceId: command.actor.spaceId });
  }
  return undefined;
}

function requirePermission(
  state: JourneyIdentityStateV1,
  command: JourneyIdentityCommand,
  permission: JourneyIdentityPermission
): JourneyIdentityTransition | undefined {
  if (hasPermission(command, permission)) return undefined;
  return reject(state, command, 'permission_denied', `Actor lacks the required ${permission} permission.`, { permission });
}

function applyObserve(state: JourneyIdentityStateV1, command: JourneyIdentityObserveCommand): JourneyIdentityTransition {
  const denied = requirePermission(state, command, 'identity:observe');
  if (denied) return denied;
  const validated = validateIdentifier(command.identifier);
  if (!validated.ok) return reject(state, command, validated.code, validated.explanation, { identifierKind: command.identifier.kind });
  if ((command.profileKind === 'anonymous' && validated.identifier.kind !== 'anonymous_id')
      || (command.profileKind === 'known' && validated.identifier.kind !== 'external_user_id')) {
    return reject(state, command, 'identifier_kind_not_allowed',
      `${command.profileKind} observations require ${command.profileKind === 'anonymous' ? 'anonymous_id' : 'external_user_id'} identifiers.`,
      { identifierKind: validated.identifier.kind, profileKind: command.profileKind });
  }
  if (!command.profileId || !command.sourceFact.factId || !command.sourceFact.source || !command.sourceFact.sourceRef) {
    return reject(state, command, 'invalid_command', 'Observation requires a profile id and complete source-fact reference.');
  }
  const pKey = profileKey(command.spaceId, command.profileId);
  const iKey = identifierKey(command.spaceId, validated.identifier);
  if (state.profileTombstones[pKey] || state.identifierTombstones[iKey]) {
    return reject(state, command, 'profile_deleted_tombstone',
      'A profile or exact identifier in this observation has a deletion tombstone; delayed data cannot resurrect it.',
      { profileId: command.profileId, identifierKind: validated.identifier.kind });
  }
  const existingFact = findSourceFact(state, command.spaceId, command.sourceFact.factId);
  if (existingFact) {
    return reject(state, command, 'source_fact_conflict',
      `Source fact ${command.sourceFact.factId} is already recorded by ${existingFact.recordedByCommandId}.`,
      { factId: command.sourceFact.factId });
  }
  const profile = state.profiles[pKey];
  if (profile && profile.kind !== command.profileKind) {
    return reject(state, command, 'profile_kind_conflict',
      `Profile ${command.profileId} is already ${profile.kind}; observation cannot reinterpret it as ${command.profileKind}.`,
      { profileId: command.profileId, existingKind: profile.kind, requestedKind: command.profileKind });
  }
  const binding = state.bindings[iKey];
  if (binding && canonicalProfileId(state, command.spaceId, binding.profileId)
      !== canonicalProfileId(state, command.spaceId, command.profileId)) {
    return reject(state, command, 'identifier_conflict',
      'The exact identifier is already bound to a different profile. Profiles remain separate until an authorised explicit merge.',
      { existingProfileId: binding.profileId, requestedProfileId: command.profileId });
  }

  const next = cloneState(state);
  if (!profile) {
    next.profiles[pKey] = {
      spaceId: command.spaceId,
      profileId: command.profileId,
      kind: command.profileKind,
      status: 'active',
      createdAt: command.occurredAt,
      createdByCommandId: command.commandId
    };
  }
  if (!binding) {
    next.bindings[iKey] = {
      spaceId: command.spaceId,
      identifier: validated.identifier,
      profileId: command.profileId,
      boundAt: command.occurredAt,
      boundByCommandId: command.commandId
    };
  }
  addSourceFact(next, command, command.profileId, command.sourceFact);
  const canonical = canonicalProfileId(next, command.spaceId, command.profileId);
  return finish(next, command, 'accepted', 'profile_observed',
    `Recorded ${command.profileKind} profile ${command.profileId} from an exact, space-scoped identifier without heuristic matching.`,
    { profileId: command.profileId, profileKind: command.profileKind, identifierKind: validated.identifier.kind },
    { resolvedProfileId: command.profileId, canonicalProfileId: canonical, sourceFactId: command.sourceFact.factId });
}

function applyIdentify(state: JourneyIdentityStateV1, command: JourneyIdentityIdentifyCommand): JourneyIdentityTransition {
  const denied = requirePermission(state, command, 'identity:identify');
  if (denied) return denied;
  const unavailable = rejectMissingOrDeletedProfile(state, command, command.profile);
  if (unavailable) return unavailable;
  const validated = validateIdentifier(command.identifier);
  if (!validated.ok) return reject(state, command, validated.code, validated.explanation, { identifierKind: command.identifier.kind });
  if (validated.identifier.kind !== 'authenticated_user_id') {
    return reject(state, command, 'identifier_kind_not_allowed',
      'Authenticated identify requires an authenticated_user_id issued by the sign-in authority.',
      { identifierKind: validated.identifier.kind });
  }
  if (!command.sourceFact.factId || !command.sourceFact.source || !command.sourceFact.sourceRef) {
    return reject(state, command, 'invalid_command', 'Identify requires a complete source-fact reference.');
  }
  if (findSourceFact(state, command.spaceId, command.sourceFact.factId)) {
    return reject(state, command, 'source_fact_conflict', `Source fact ${command.sourceFact.factId} is already recorded.`,
      { factId: command.sourceFact.factId });
  }
  const iKey = identifierKey(command.spaceId, validated.identifier);
  if (state.identifierTombstones[iKey]) {
    return reject(state, command, 'profile_deleted_tombstone',
      'The authenticated identifier is tombstoned and cannot resurrect a deleted profile.',
      { identifierKind: validated.identifier.kind });
  }
  const binding = state.bindings[iKey];
  const requestedCanonical = canonicalProfileId(state, command.spaceId, command.profile.profileId);
  if (binding && canonicalProfileId(state, command.spaceId, binding.profileId) !== requestedCanonical) {
    return reject(state, command, 'identifier_conflict',
      'The authenticated identifier is already bound to a different profile; identify fails closed and does not merge them.',
      { existingProfileId: binding.profileId, requestedProfileId: command.profile.profileId });
  }

  const next = cloneState(state);
  if (!binding) {
    next.bindings[iKey] = {
      spaceId: command.spaceId,
      identifier: validated.identifier,
      profileId: command.profile.profileId,
      boundAt: command.occurredAt,
      boundByCommandId: command.commandId
    };
  }
  const pKey = profileKey(command.spaceId, command.profile.profileId);
  next.profiles[pKey] = {
    ...next.profiles[pKey],
    kind: 'known',
    knownAt: next.profiles[pKey].knownAt ?? command.occurredAt
  };
  addSourceFact(next, command, command.profile.profileId, command.sourceFact);
  const canonical = canonicalProfileId(next, command.spaceId, command.profile.profileId);
  return finish(next, command, 'accepted', 'profile_identified',
    `Authenticated identify promoted profile ${command.profile.profileId} to known; no implicit profile merge was performed.`,
    { profileId: command.profile.profileId, identifierKind: validated.identifier.kind },
    { resolvedProfileId: command.profile.profileId, canonicalProfileId: canonical, sourceFactId: command.sourceFact.factId });
}

function applyAlias(state: JourneyIdentityStateV1, command: JourneyIdentityAliasCommand): JourneyIdentityTransition {
  const denied = requirePermission(state, command, 'identity:alias');
  if (denied) return denied;
  const unavailable = rejectMissingOrDeletedProfile(state, command, command.profile);
  if (unavailable) return unavailable;
  const validated = validateIdentifier(command.identifier);
  if (!validated.ok) return reject(state, command, validated.code, validated.explanation, { identifierKind: command.identifier.kind });
  if (!command.reason.trim()) return reject(state, command, 'invalid_command', 'Alias requires an explicit audit reason.');
  const iKey = identifierKey(command.spaceId, validated.identifier);
  if (state.identifierTombstones[iKey]) {
    return reject(state, command, 'profile_deleted_tombstone', 'The alias identifier is tombstoned and cannot be rebound.');
  }
  const binding = state.bindings[iKey];
  const canonical = canonicalProfileId(state, command.spaceId, command.profile.profileId);
  if (binding && canonicalProfileId(state, command.spaceId, binding.profileId) !== canonical) {
    return reject(state, command, 'identifier_conflict',
      'Alias conflicts with an existing profile binding. The policy will not guess which profile is correct.',
      { existingProfileId: binding.profileId, requestedProfileId: command.profile.profileId });
  }
  const next = cloneState(state);
  if (!binding) {
    next.bindings[iKey] = {
      spaceId: command.spaceId,
      identifier: validated.identifier,
      profileId: command.profile.profileId,
      boundAt: command.occurredAt,
      boundByCommandId: command.commandId
    };
  }
  return finish(next, command, 'accepted', 'identifier_aliased',
    `Privileged alias bound an exact ${validated.identifier.kind} to profile ${command.profile.profileId}; reason: ${command.reason}.`,
    { profileId: command.profile.profileId, identifierKind: validated.identifier.kind, reason: command.reason },
    { resolvedProfileId: command.profile.profileId, canonicalProfileId: canonical });
}

function applyMerge(state: JourneyIdentityStateV1, command: JourneyIdentityMergeCommand): JourneyIdentityTransition {
  const denied = requirePermission(state, command, 'identity:merge');
  if (denied) return denied;
  const sourceUnavailable = rejectMissingOrDeletedProfile(state, command, command.source);
  if (sourceUnavailable) return sourceUnavailable;
  const targetUnavailable = rejectMissingOrDeletedProfile(state, command, command.target);
  if (targetUnavailable) return targetUnavailable;
  if (!command.reason.trim()) return reject(state, command, 'invalid_command', 'Merge requires an explicit audit reason.');
  const sourceCanonical = canonicalProfileId(state, command.spaceId, command.source.profileId);
  const targetCanonical = canonicalProfileId(state, command.spaceId, command.target.profileId);
  if (sourceCanonical === targetCanonical) {
    return reject(state, command, 'already_merged',
      `Profiles already resolve to canonical profile ${targetCanonical}.`,
      { sourceProfileId: command.source.profileId, targetProfileId: command.target.profileId, canonicalProfileId: targetCanonical });
  }
  if (Object.values(state.merges).some((merge) => (
    merge.spaceId === command.spaceId && merge.active && merge.sourceProfileId === command.source.profileId
  ))) {
    return reject(state, command, 'already_merged',
      `Source profile ${command.source.profileId} already has an active merge. Split it before another merge.`,
      { sourceProfileId: command.source.profileId });
  }
  if (targetCanonical === command.source.profileId) {
    return reject(state, command, 'merge_cycle', 'Merge would create a resolution cycle and was rejected.',
      { sourceProfileId: command.source.profileId, targetProfileId: command.target.profileId });
  }

  const next = cloneState(state);
  const id = mergeAuditId(command);
  next.merges[id] = {
    mergeAuditId: id,
    spaceId: command.spaceId,
    sourceProfileId: command.source.profileId,
    targetProfileId: command.target.profileId,
    canonicalTargetProfileId: targetCanonical,
    reason: command.reason,
    active: true,
    mergedAt: command.occurredAt,
    mergedByCommandId: command.commandId
  };
  return finish(next, command, 'accepted', 'profiles_merged',
    `Privileged merge now resolves ${command.source.profileId} to ${targetCanonical}. Original profiles, bindings, and source facts remain unchanged.`,
    { sourceProfileId: command.source.profileId, targetProfileId: command.target.profileId,
      canonicalProfileId: targetCanonical, reason: command.reason },
    { resolvedProfileId: command.source.profileId, canonicalProfileId: targetCanonical, mergeAuditId: id });
}

function applySplit(state: JourneyIdentityStateV1, command: JourneyIdentitySplitCommand): JourneyIdentityTransition {
  const denied = requirePermission(state, command, 'identity:split');
  if (denied) return denied;
  const merge = state.merges[command.mergeAuditId];
  if (!merge || merge.spaceId !== command.spaceId) {
    const inOtherSpace = merge && merge.spaceId !== command.spaceId;
    return reject(state, command, inOtherSpace ? 'cross_space_reference' : 'merge_not_found',
      inOtherSpace ? 'Merge belongs to another space and cannot be split here.' : `Merge ${command.mergeAuditId} was not found.`,
      { mergeAuditId: command.mergeAuditId });
  }
  if (!merge.active) {
    return reject(state, command, 'merge_already_split', `Merge ${command.mergeAuditId} has already been split.`,
      { mergeAuditId: command.mergeAuditId });
  }
  if (!command.reason.trim()) return reject(state, command, 'invalid_command', 'Split requires an explicit audit reason.');
  const sourceUnavailable = rejectMissingOrDeletedProfile(state, command, {
    spaceId: merge.spaceId, profileId: merge.sourceProfileId
  });
  if (sourceUnavailable) return sourceUnavailable;
  const next = cloneState(state);
  next.merges[command.mergeAuditId] = {
    ...merge,
    active: false,
    splitAt: command.occurredAt,
    splitByCommandId: command.commandId
  };
  return finish(next, command, 'accepted', 'merge_split',
    `Split reversed merge ${command.mergeAuditId}; ${merge.sourceProfileId} again resolves independently. The original merge audit remains.`,
    { mergeAuditId: command.mergeAuditId, sourceProfileId: merge.sourceProfileId, reason: command.reason },
    { resolvedProfileId: merge.sourceProfileId, canonicalProfileId: merge.sourceProfileId, mergeAuditId: command.mergeAuditId });
}

function applyAddMembership(
  state: JourneyIdentityStateV1,
  command: JourneyIdentityAddMembershipCommand
): JourneyIdentityTransition {
  const denied = requirePermission(state, command, 'identity:membership');
  if (denied) return denied;
  const unavailable = rejectMissingOrDeletedProfile(state, command, command.profile);
  if (unavailable) return unavailable;
  if (command.group.spaceId !== command.spaceId) {
    return reject(state, command, 'cross_space_reference',
      `Group ${command.group.groupId} belongs to ${command.group.spaceId}; memberships cannot cross spaces.`,
      { groupSpaceId: command.group.spaceId, groupId: command.group.groupId });
  }
  if (!command.group.groupId || !command.sourceFact.factId || !command.sourceFact.source || !command.sourceFact.sourceRef) {
    return reject(state, command, 'invalid_command', 'Membership requires a group id and complete source-fact reference.');
  }
  const profile = getProfile(state, command.profile)!;
  if (profile.kind !== 'known') {
    return reject(state, command, 'anonymous_membership_forbidden',
      'Anonymous profiles cannot be assigned to accounts or groups until authenticated identify makes them known.',
      { profileId: command.profile.profileId });
  }
  if (findSourceFact(state, command.spaceId, command.sourceFact.factId)) {
    return reject(state, command, 'source_fact_conflict', `Source fact ${command.sourceFact.factId} is already recorded.`,
      { factId: command.sourceFact.factId });
  }
  const key = membershipKey(command.spaceId, command.group.groupType, command.group.groupId, command.profile.profileId);
  const existing = state.memberships[key];
  if (existing?.active) {
    return reject(state, command, 'membership_already_active', 'This exact group membership is already active.',
      { membershipId: existing.membershipId });
  }
  const next = cloneState(state);
  const id = membershipId(command);
  next.memberships[key] = {
    membershipId: id,
    spaceId: command.spaceId,
    profileId: command.profile.profileId,
    groupType: command.group.groupType,
    groupId: command.group.groupId,
    active: true,
    addedAt: command.occurredAt,
    addedByCommandId: command.commandId
  };
  addSourceFact(next, command, command.profile.profileId, command.sourceFact);
  return finish(next, command, 'accepted', 'membership_added',
    `Added known profile ${command.profile.profileId} to ${command.group.groupType} ${command.group.groupId} in the same space.`,
    { profileId: command.profile.profileId, groupType: command.group.groupType, groupId: command.group.groupId },
    { resolvedProfileId: command.profile.profileId,
      canonicalProfileId: canonicalProfileId(next, command.spaceId, command.profile.profileId),
      membershipId: id, sourceFactId: command.sourceFact.factId });
}

function applyRemoveMembership(
  state: JourneyIdentityStateV1,
  command: JourneyIdentityRemoveMembershipCommand
): JourneyIdentityTransition {
  const denied = requirePermission(state, command, 'identity:membership');
  if (denied) return denied;
  const entry = Object.entries(state.memberships).find(([, membership]) => membership.membershipId === command.membershipId);
  if (!entry) return reject(state, command, 'membership_not_found', `Membership ${command.membershipId} was not found.`);
  const [key, membership] = entry;
  if (membership.spaceId !== command.spaceId) {
    return reject(state, command, 'cross_space_reference', 'Membership belongs to another space and cannot be changed here.');
  }
  if (!membership.active) {
    return reject(state, command, 'membership_already_removed', `Membership ${command.membershipId} is already inactive.`);
  }
  if (!command.reason.trim()) return reject(state, command, 'invalid_command', 'Membership removal requires an audit reason.');
  const next = cloneState(state);
  next.memberships[key] = {
    ...membership,
    active: false,
    removedAt: command.occurredAt,
    removedByCommandId: command.commandId
  };
  return finish(next, command, 'accepted', 'membership_removed',
    `Removed membership ${command.membershipId}; its original source fact and add audit remain available.`,
    { membershipId: command.membershipId, reason: command.reason },
    { resolvedProfileId: membership.profileId,
      canonicalProfileId: canonicalProfileId(next, command.spaceId, membership.profileId),
      membershipId: command.membershipId });
}

function applyDelete(state: JourneyIdentityStateV1, command: JourneyIdentityDeleteCommand): JourneyIdentityTransition {
  const denied = requirePermission(state, command, 'identity:delete');
  if (denied) return denied;
  const unavailable = rejectMissingOrDeletedProfile(state, command, command.profile);
  if (unavailable) return unavailable;
  if (!command.reason.trim()) return reject(state, command, 'invalid_command', 'Deletion requires an explicit audit reason.');
  const canonical = canonicalProfileId(state, command.spaceId, command.profile.profileId);
  const memberProfileIds = Object.values(state.profiles)
    .filter((profile) => profile.spaceId === command.spaceId && profile.status === 'active'
      && canonicalProfileId(state, command.spaceId, profile.profileId) === canonical)
    .map((profile) => profile.profileId)
    .sort();
  const memberSet = new Set(memberProfileIds);
  const next = cloneState(state);
  for (const profileId of memberProfileIds) {
    const key = profileKey(command.spaceId, profileId);
    const profile = next.profiles[key];
    next.profiles[key] = { ...profile, status: 'deleted', deletedAt: command.occurredAt };
    next.profileTombstones[key] = {
      spaceId: command.spaceId,
      profileId,
      deletedAt: command.occurredAt,
      deletedByCommandId: command.commandId,
      reason: command.reason
    };
  }
  for (const [key, binding] of Object.entries(next.bindings)) {
    if (binding.spaceId === command.spaceId && memberSet.has(binding.profileId)) {
      next.identifierTombstones[key] = {
        spaceId: command.spaceId,
        profileId: binding.profileId,
        deletedAt: command.occurredAt,
        deletedByCommandId: command.commandId,
        reason: command.reason
      };
    }
  }
  for (const [key, membership] of Object.entries(next.memberships)) {
    if (membership.spaceId === command.spaceId && memberSet.has(membership.profileId) && membership.active) {
      next.memberships[key] = {
        ...membership,
        active: false,
        removedAt: command.occurredAt,
        removedByCommandId: command.commandId
      };
    }
  }
  return finish(next, command, 'accepted', 'profile_deleted',
    `Deleted canonical identity ${canonical} and tombstoned ${memberProfileIds.length} linked profile(s); source and audit facts were retained.`,
    { canonicalProfileId: canonical, profileIds: memberProfileIds, reason: command.reason },
    { resolvedProfileId: command.profile.profileId, canonicalProfileId: canonical });
}

/**
 * Applies one identity command without mutating the supplied state. Replaying
 * the same command id and payload returns the original decision without adding
 * another source or audit fact. Reusing an id with different data fails closed.
 */
export function applyJourneyIdentityCommand(
  state: JourneyIdentityStateV1,
  command: JourneyIdentityCommand
): JourneyIdentityTransition {
  assertStateVersion(state);
  const commandKey = processedCommandKey(command);
  const fingerprint = canonicalJson(command);
  const processed = state.processedCommands[commandKey];
  if (processed) {
    if (processed.fingerprint === fingerprint) {
      return {
        state,
        result: {
          ...processed.decision,
          status: 'replayed',
          code: 'idempotent_replay',
          explanation: `Idempotent replay of ${command.commandId}; original ${processed.decision.status} decision ${processed.decision.code} was reused.`,
          replayedOutcome: processed.decision.status as 'accepted' | 'rejected',
          replayedCode: processed.decision.code
        }
      };
    }
    const conflictAudit: JourneyIdentityAuditFact = {
      auditId: `${auditId(command)}:command-id-conflict`,
      policyVersion: JOURNEY_IDENTITY_POLICY_VERSION,
      commandId: command.commandId,
      spaceId: command.spaceId,
      actorId: command.actor.actorId,
      action: command.type,
      outcome: 'rejected',
      code: 'command_id_conflict',
      explanation: 'Command id was already used with a different payload; no state change was made.',
      occurredAt: command.occurredAt,
      details: baseDetails(command)
    };
    return {
      state,
      result: {
        policyVersion: JOURNEY_IDENTITY_POLICY_VERSION,
        stateVersion: JOURNEY_IDENTITY_STATE_VERSION,
        commandId: command.commandId,
        status: 'rejected',
        code: 'command_id_conflict',
        explanation: conflictAudit.explanation,
        audit: conflictAudit
      }
    };
  }

  const commonFailure = validateCommon(state, command);
  if (commonFailure) return commonFailure;
  switch (command.type) {
    case 'observe': return applyObserve(state, command);
    case 'identify': return applyIdentify(state, command);
    case 'alias': return applyAlias(state, command);
    case 'merge': return applyMerge(state, command);
    case 'split': return applySplit(state, command);
    case 'add_membership': return applyAddMembership(state, command);
    case 'remove_membership': return applyRemoveMembership(state, command);
    case 'delete': return applyDelete(state, command);
  }
}

/** Exact lookup only. It never searches another space and never uses heuristics. */
export function resolveJourneyIdentity(
  state: JourneyIdentityStateV1,
  spaceId: string,
  identifier: JourneyIdentityIdentifier
): JourneyIdentityLookupResult {
  assertStateVersion(state);
  const validated = validateIdentifier(identifier);
  if (!validated.ok) {
    return {
      policyVersion: JOURNEY_IDENTITY_POLICY_VERSION,
      stateVersion: JOURNEY_IDENTITY_STATE_VERSION,
      status: 'rejected',
      code: validated.code,
      explanation: validated.explanation,
      spaceId
    };
  }
  const key = identifierKey(spaceId, validated.identifier);
  if (state.identifierTombstones[key]) {
    return {
      policyVersion: JOURNEY_IDENTITY_POLICY_VERSION,
      stateVersion: JOURNEY_IDENTITY_STATE_VERSION,
      status: 'deleted',
      code: 'profile_deleted_tombstone',
      explanation: 'Exact identifier is tombstoned; delayed records cannot recreate the identity.',
      spaceId,
      boundProfileId: state.identifierTombstones[key].profileId
    };
  }
  const binding = state.bindings[key];
  if (!binding) {
    return {
      policyVersion: JOURNEY_IDENTITY_POLICY_VERSION,
      stateVersion: JOURNEY_IDENTITY_STATE_VERSION,
      status: 'not_found',
      code: 'identifier_not_found',
      explanation: 'No exact binding exists for this identifier in this space.',
      spaceId
    };
  }
  const canonical = canonicalProfileId(state, spaceId, binding.profileId);
  if (state.profileTombstones[profileKey(spaceId, canonical)]) {
    return {
      policyVersion: JOURNEY_IDENTITY_POLICY_VERSION,
      stateVersion: JOURNEY_IDENTITY_STATE_VERSION,
      status: 'deleted',
      code: 'profile_deleted_tombstone',
      explanation: 'The exact binding resolves to a deleted identity tombstone.',
      spaceId,
      boundProfileId: binding.profileId,
      canonicalProfileId: canonical
    };
  }
  return {
    policyVersion: JOURNEY_IDENTITY_POLICY_VERSION,
    stateVersion: JOURNEY_IDENTITY_STATE_VERSION,
    status: 'resolved',
    code: 'exact_match',
    explanation: `Resolved one exact, space-scoped ${validated.identifier.kind}; no heuristic matching was used.`,
    spaceId,
    boundProfileId: binding.profileId,
    canonicalProfileId: canonical
  };
}

