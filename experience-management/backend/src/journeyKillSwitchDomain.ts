import crypto from 'node:crypto';

/**
 * Pure kill-switch domain for the runtime-40 foundation (P5D-04).
 *
 * Nothing here reads a database, a request or a clock. It exists so the two
 * decisions that must never drift - what the five levels resolve to, and what may
 * leave a hold once a switch is re-enabled - can be proved without a tenant, and so
 * the repository cannot quietly become the only description of precedence.
 *
 * Two rules are deliberate and load-bearing:
 *   - precedence is the fixed order of `journeyKillSwitchLevels`, so the blocking
 *     level for a given input is the same on every host and in every replay;
 *   - anything unknown denies. An unrecognised stored state, an unrecognised
 *     adapter, a missing scope reference and a duplicated record all resolve to a
 *     non-allow decision rather than being skipped.
 */

export const journeyKillSwitchLevels = ['platform', 'space', 'workflow', 'adapter', 'profile'] as const;
export type JourneyKillSwitchLevel = (typeof journeyKillSwitchLevels)[number];

export const journeyKillSwitchStates = ['enabled', 'disabled'] as const;
export type JourneyKillSwitchState = (typeof journeyKillSwitchStates)[number];

/** The reviewed adapters of runtime 38. An adapter outside this set is an unknown value and denies. */
export const journeyKillSwitchAdapters = ['survey_invitation', 'service_recovery_ticket', 'assistant_action',
  'internal_notification', 'signed_webhook'] as const;
export type JourneyKillSwitchAdapter = (typeof journeyKillSwitchAdapters)[number];

/** Bounded codes only: a kill switch never stores an operator's free-text explanation. */
export const journeyKillSwitchReasonCodes = ['operational_incident', 'safety_incident', 'compliance_hold',
  'maintenance', 'cost_control', 'governance_review', 'recovery_verified'] as const;
export type JourneyKillSwitchReasonCode = (typeof journeyKillSwitchReasonCodes)[number];

export const journeyKillSwitchAuthorities = ['platform_admin', 'space_manager'] as const;
export type JourneyKillSwitchAuthority = (typeof journeyKillSwitchAuthorities)[number];

/** The runtime-36 gate keys this foundation is the durable source for. */
export const journeyKillSwitchGateKeys = Object.freeze({
  platform: 'platform_kill_switch', space: 'space_kill_switch', workflow: 'workflow_kill_switch',
  adapter: 'adapter_kill_switch', profile: 'profile_kill_switch'
} as const);
export type JourneyKillSwitchGateKey = (typeof journeyKillSwitchGateKeys)[JourneyKillSwitchLevel];

/** The runtime-36 `journey_action_queue.hold_reason_code` written when a level pauses work. */
export const journeyKillSwitchHoldReasonCodes = Object.freeze({
  platform: 'PLATFORM_KILL_SWITCH', space: 'SPACE_KILL_SWITCH', workflow: 'WORKFLOW_KILL_SWITCH',
  adapter: 'ADAPTER_KILL_SWITCH', profile: 'PROFILE_KILL_SWITCH'
} as const);
export const journeyKillSwitchHoldReasonCodeList: readonly string[] = Object.freeze(
  journeyKillSwitchLevels.map((level) => journeyKillSwitchHoldReasonCodes[level]));

export class JourneyKillSwitchDomainError extends Error {
  constructor(message: string, public code = 'JOURNEY_KILL_SWITCH_DOMAIN_INVALID') {
    super(message);
    this.name = 'JourneyKillSwitchDomainError';
  }
}

const tokenPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const immutable = <T>(value: T): Readonly<T> => Object.freeze(value);

export const isJourneyKillSwitchLevel = (value: unknown): value is JourneyKillSwitchLevel =>
  typeof value === 'string' && (journeyKillSwitchLevels as readonly string[]).includes(value);
export const isJourneyKillSwitchState = (value: unknown): value is JourneyKillSwitchState =>
  typeof value === 'string' && (journeyKillSwitchStates as readonly string[]).includes(value);
export const isJourneyKillSwitchAdapter = (value: unknown): value is JourneyKillSwitchAdapter =>
  typeof value === 'string' && (journeyKillSwitchAdapters as readonly string[]).includes(value);
export const isJourneyKillSwitchReasonCode = (value: unknown): value is JourneyKillSwitchReasonCode =>
  typeof value === 'string' && (journeyKillSwitchReasonCodes as readonly string[]).includes(value);

/**
 * Audit correlation only, and level-prefixed so the same reference under two levels
 * cannot collide. The level names contain no colon, so the separator is unambiguous.
 */
export const journeyKillSwitchScopeRefSha256 = (level: JourneyKillSwitchLevel, scopeRef: string) =>
  sha256(level + ':' + scopeRef);

/**
 * The runtime-35 `journey_workflow_runs.subject_ref_sha256` convention: a plain SHA-256
 * of the subject reference. Profile-level pausing matches on this, so a profile switch
 * can find its pending work without the queue ever storing a subject.
 */
export const journeySubjectRefSha256 = (subjectRef: string) => sha256(subjectRef);

/** A stored row as the resolver sees it. `state` is deliberately `string`: an unknown one must still resolve. */
export type JourneyKillSwitchRecord = Readonly<{
  level: string;
  scopeRef: string;
  state: string;
  reasonCode: string;
  revision: number;
  updatedAt: string;
}>;

/** The subject of a resolution. A null member means the caller could not name that scope. */
export type JourneyKillSwitchScope = Readonly<{
  spaceId: string | null;
  workflowId: string | null;
  adapter: string | null;
  profileId: string | null;
}>;

export type JourneyKillSwitchDecision = 'allow' | 'deny' | 'unknown';

export type JourneyKillSwitchLevelResolution = Readonly<{
  level: JourneyKillSwitchLevel;
  gateKey: JourneyKillSwitchGateKey;
  scopeRefSha256: string | null;
  state: JourneyKillSwitchState | 'unknown';
  decision: JourneyKillSwitchDecision;
  reasonCode: string;
  source: 'record' | 'default' | 'missing_scope';
}>;

export type JourneyKillSwitchEffectiveResolution = Readonly<{
  decision: 'allow' | 'deny';
  blockedLevel: JourneyKillSwitchLevel | null;
  reasonCode: string;
  levels: readonly JourneyKillSwitchLevelResolution[];
  gates: Readonly<Record<JourneyKillSwitchGateKey, JourneyKillSwitchDecision>>;
}>;

function scopeRefForLevel(level: JourneyKillSwitchLevel, scope: JourneyKillSwitchScope): string | null {
  if (level === 'platform') return 'platform';
  if (level === 'space') return scope.spaceId;
  if (level === 'workflow') return scope.workflowId;
  if (level === 'adapter') return scope.adapter;
  return scope.profileId;
}

function resolveLevel(level: JourneyKillSwitchLevel, scope: JourneyKillSwitchScope,
  records: readonly JourneyKillSwitchRecord[]): JourneyKillSwitchLevelResolution {
  const gateKey = journeyKillSwitchGateKeys[level];
  const scopeRef = scopeRefForLevel(level, scope);
  // A scope nobody named cannot be proved safe, so it denies rather than being skipped.
  if (typeof scopeRef !== 'string' || !tokenPattern.test(scopeRef)) return immutable({ level, gateKey,
    scopeRefSha256: null, state: 'unknown' as const, decision: 'unknown' as const,
    reasonCode: 'KILL_SWITCH_SCOPE_UNKNOWN', source: 'missing_scope' as const });
  if (level === 'adapter' && !isJourneyKillSwitchAdapter(scopeRef)) return immutable({ level, gateKey,
    scopeRefSha256: journeyKillSwitchScopeRefSha256(level, scopeRef), state: 'unknown' as const,
    decision: 'unknown' as const, reasonCode: 'KILL_SWITCH_ADAPTER_UNKNOWN', source: 'missing_scope' as const });

  const scopeRefSha256 = journeyKillSwitchScopeRefSha256(level, scopeRef);
  const matches = records.filter((record) => record.level === level && record.scopeRef === scopeRef);
  if (matches.length > 1) return immutable({ level, gateKey, scopeRefSha256, state: 'unknown' as const,
    decision: 'unknown' as const, reasonCode: 'KILL_SWITCH_RECORD_AMBIGUOUS', source: 'record' as const });
  const record = matches[0];
  if (!record) return immutable({ level, gateKey, scopeRefSha256, state: 'enabled' as const,
    decision: 'allow' as const, reasonCode: 'KILL_SWITCH_DEFAULT_ENABLED', source: 'default' as const });
  if (!isJourneyKillSwitchState(record.state)) return immutable({ level, gateKey, scopeRefSha256,
    state: 'unknown' as const, decision: 'unknown' as const, reasonCode: 'KILL_SWITCH_STATE_UNKNOWN',
    source: 'record' as const });
  if (record.state === 'disabled') return immutable({ level, gateKey, scopeRefSha256, state: 'disabled' as const,
    decision: 'deny' as const, reasonCode: level.toUpperCase() + '_KILL_SWITCH_ENGAGED', source: 'record' as const });
  return immutable({ level, gateKey, scopeRefSha256, state: 'enabled' as const, decision: 'allow' as const,
    reasonCode: 'KILL_SWITCH_ENABLED', source: 'record' as const });
}

/**
 * Server-derived resolution of all five levels. Callers pass the rows they read; no
 * caller-supplied state is trusted, and every level is reported so the outcome stays
 * explainable rather than collapsing to a single boolean.
 */
export function resolveEffectiveJourneyKillSwitch(input: {
  scope: JourneyKillSwitchScope;
  records: readonly JourneyKillSwitchRecord[];
}): JourneyKillSwitchEffectiveResolution {
  const levels = journeyKillSwitchLevels.map((level) => resolveLevel(level, input.scope, input.records));
  const blocking = levels.find((resolution) => resolution.decision !== 'allow') || null;
  const gates = Object.fromEntries(levels.map((resolution) => [resolution.gateKey, resolution.decision])) as
    Record<JourneyKillSwitchGateKey, JourneyKillSwitchDecision>;
  return immutable({
    decision: blocking ? 'deny' as const : 'allow' as const,
    blockedLevel: blocking ? blocking.level : null,
    reasonCode: blocking ? blocking.reasonCode : 'KILL_SWITCH_ALL_LEVELS_ENABLED',
    levels: immutable(levels),
    gates: immutable(gates)
  });
}

export type JourneyKillSwitchPendingState = 'ready' | 'retry_scheduled' | 'leased' | 'held';
export const journeyKillSwitchPausableStates: readonly JourneyKillSwitchPendingState[] =
  Object.freeze(['ready', 'retry_scheduled', 'leased']);

export type JourneyKillSwitchRecoveryPlan = Readonly<{
  transition: 'resumed' | 'retained_held';
  nextState: 'ready' | 'retry_scheduled' | 'held';
  holdReasonCode: string | null;
  reasonCode: string;
}>;

/**
 * What may leave a hold when a switch is re-enabled. Recovery is a re-evaluation, not
 * an undo: a row is only released when every level allows it now, its recorded gate
 * evidence is complete and allowed, and its workflow is runnable. Anything else stays
 * held and is re-labelled with the reason that currently holds it, so a row paused by
 * one level cannot escape while another still blocks it.
 */
export function planJourneyKillSwitchRecovery(input: {
  previousState: string;
  effective: JourneyKillSwitchEffectiveResolution;
  gatesAllowed: boolean;
  orchestrationRunnable: boolean;
}): JourneyKillSwitchRecoveryPlan {
  if (input.effective.decision !== 'allow') {
    const level = input.effective.blockedLevel;
    return immutable({ transition: 'retained_held' as const, nextState: 'held' as const,
      // A deny without a named level would be a resolver defect; hold at the strongest level rather than guess.
      holdReasonCode: level ? journeyKillSwitchHoldReasonCodes[level] : journeyKillSwitchHoldReasonCodes.platform,
      reasonCode: input.effective.reasonCode });
  }
  if (!input.gatesAllowed) return immutable({ transition: 'retained_held' as const, nextState: 'held' as const,
    holdReasonCode: 'SAFETY_GATE_NOT_ALLOWED', reasonCode: 'KILL_SWITCH_GATE_EVIDENCE_NOT_ALLOWED' });
  if (!input.orchestrationRunnable) return immutable({ transition: 'retained_held' as const,
    nextState: 'held' as const, holdReasonCode: 'ORCHESTRATION_PAUSED',
    reasonCode: 'KILL_SWITCH_ORCHESTRATION_NOT_RUNNABLE' });
  if (input.previousState !== 'ready' && input.previousState !== 'retry_scheduled'
    && input.previousState !== 'leased') {
    return immutable({ transition: 'retained_held' as const, nextState: 'held' as const,
      holdReasonCode: 'ORCHESTRATION_PAUSED', reasonCode: 'KILL_SWITCH_PREVIOUS_STATE_UNKNOWN' });
  }
  // A released lease never returns to `leased`: the lease was destroyed and its fencing
  // token advanced, so the row must be claimed again before any worker may act on it.
  return immutable({ transition: 'resumed' as const,
    nextState: input.previousState === 'retry_scheduled' ? 'retry_scheduled' as const : 'ready' as const,
    holdReasonCode: null, reasonCode: 'KILL_SWITCH_RECOVERED' });
}

/** Keys the audit fact may never carry, mirroring the runtime-40 content-safety CHECK. */
export const journeyKillSwitchForbiddenAuditKeys: readonly string[] = Object.freeze(['payload', 'payloadJson',
  'content', 'subjectId', 'profileId', 'scopeRef', 'email', 'recipient', 'body', 'note', 'reason', 'message']);

export type JourneyKillSwitchAuditFact = Readonly<{
  action: 'journey.kill_switch.disabled' | 'journey.kill_switch.enabled' | 'journey.kill_switch.unchanged';
  scopeRefSha256: string;
  detail: Readonly<Record<string, string | number>>;
  detailSha256: string;
}>;

/**
 * Builds the content-safe audit fact. The scope reference is hashed rather than
 * stored, which matters most at profile level where the reference identifies a person.
 */
export function createJourneyKillSwitchAuditFact(input: {
  level: JourneyKillSwitchLevel;
  scopeRef: string;
  state: JourneyKillSwitchState;
  previousState: JourneyKillSwitchState | null;
  reasonCode: JourneyKillSwitchReasonCode;
  authority: JourneyKillSwitchAuthority;
  revision: number;
  pausedActionCount: number;
  releasedLeaseCount: number;
  resumedActionCount: number;
  retainedHoldCount: number;
}): JourneyKillSwitchAuditFact {
  if (!isJourneyKillSwitchLevel(input.level) || typeof input.scopeRef !== 'string'
    || !tokenPattern.test(input.scopeRef) || !isJourneyKillSwitchState(input.state)
    || !isJourneyKillSwitchReasonCode(input.reasonCode)
    || !(journeyKillSwitchAuthorities as readonly string[]).includes(input.authority)) {
    throw new JourneyKillSwitchDomainError('Kill switch audit attribution is invalid.',
      'JOURNEY_KILL_SWITCH_AUDIT_INVALID');
  }
  if (!Number.isInteger(input.revision) || input.revision < 1) throw new JourneyKillSwitchDomainError(
    'Kill switch audit revision is invalid.', 'JOURNEY_KILL_SWITCH_AUDIT_INVALID');
  const counts = [input.pausedActionCount, input.releasedLeaseCount, input.resumedActionCount,
    input.retainedHoldCount];
  if (!counts.every((count) => Number.isInteger(count) && count >= 0)) throw new JourneyKillSwitchDomainError(
    'Kill switch audit counts are invalid.', 'JOURNEY_KILL_SWITCH_AUDIT_INVALID');

  const scopeRefSha256 = journeyKillSwitchScopeRefSha256(input.level, input.scopeRef);
  const action = input.previousState === input.state ? 'journey.kill_switch.unchanged' as const
    : input.state === 'disabled' ? 'journey.kill_switch.disabled' as const
      : 'journey.kill_switch.enabled' as const;
  const detail: Record<string, string | number> = { level: input.level, scopeRefSha256, state: input.state,
    previousState: input.previousState || 'absent', reasonCode: input.reasonCode, authority: input.authority,
    revision: input.revision, pausedActionCount: input.pausedActionCount,
    releasedLeaseCount: input.releasedLeaseCount, resumedActionCount: input.resumedActionCount,
    retainedHoldCount: input.retainedHoldCount };
  // Guards a later edit rather than this construction: runtime 40 CHECKs the same list.
  const unsafe = Object.keys(detail).filter((key) => journeyKillSwitchForbiddenAuditKeys.includes(key));
  if (unsafe.length) throw new JourneyKillSwitchDomainError('Kill switch audit detail is unsafe.',
    'JOURNEY_KILL_SWITCH_AUDIT_UNSAFE');
  return immutable({ action, scopeRefSha256, detail: immutable(detail),
    detailSha256: sha256(JSON.stringify(detail)) });
}

/** Repository-facing aliases backed by the single fail-closed domain above. */
export const KILL_SWITCH_LEVELS = journeyKillSwitchLevels;
export const KILL_SWITCH_GATE_KEYS = journeyKillSwitchGateKeys;
export type KillSwitchLevel = JourneyKillSwitchLevel;
export type KillSwitchState = JourneyKillSwitchState;
export type KillSwitchRecord = Readonly<{ scopeKey: string; state: unknown; revision: number }>;
export type KillSwitchRecordSet = Readonly<Partial<Record<KillSwitchLevel, KillSwitchRecord | null>>>;

const profileHashPattern = /^[a-f0-9]{64}$/u;

export function assertKillSwitchReasonCode(value: unknown): JourneyKillSwitchReasonCode {
  if (!isJourneyKillSwitchReasonCode(value)) throw new JourneyKillSwitchDomainError(
    'A recognised kill-switch reason code is required.', 'JOURNEY_KILL_SWITCH_REASON_UNKNOWN');
  return value;
}

export function assertKillSwitchScope(level: unknown, scopeKey: unknown, spaceId: string | null) {
  if (!isJourneyKillSwitchLevel(level)) throw new JourneyKillSwitchDomainError(
    'The kill-switch level is unknown.', 'JOURNEY_KILL_SWITCH_LEVEL_UNKNOWN');
  if (typeof scopeKey !== 'string' || !tokenPattern.test(scopeKey)) throw new JourneyKillSwitchDomainError(
    'The kill-switch scope is invalid.', 'JOURNEY_KILL_SWITCH_SCOPE_UNKNOWN');
  if (level === 'platform' && (spaceId !== null || scopeKey !== 'platform')) throw new JourneyKillSwitchDomainError(
    'The platform scope must be global.', 'JOURNEY_KILL_SWITCH_SCOPE_INVALID');
  if (level !== 'platform' && (typeof spaceId !== 'string' || !tokenPattern.test(spaceId))) {
    throw new JourneyKillSwitchDomainError(
      'A tenant-bound scope requires a valid space.', 'JOURNEY_KILL_SWITCH_TENANT_REQUIRED');
  }
  if (level === 'space' && scopeKey !== spaceId) throw new JourneyKillSwitchDomainError(
    'The space switch must target the request-derived space.', 'JOURNEY_KILL_SWITCH_SCOPE_INVALID');
  if (level === 'adapter' && !isJourneyKillSwitchAdapter(scopeKey)) throw new JourneyKillSwitchDomainError(
    'The adapter scope is not reviewed.', 'JOURNEY_KILL_SWITCH_ADAPTER_UNKNOWN');
  if (level === 'profile' && !profileHashPattern.test(scopeKey)) throw new JourneyKillSwitchDomainError(
    'The profile scope must be a SHA-256 reference.', 'JOURNEY_KILL_SWITCH_PROFILE_SCOPE_INVALID');
  return immutable({ level, scopeKey, spaceId, gateKey: journeyKillSwitchGateKeys[level] });
}

function repositoryRecord(level: KillSwitchLevel, scopeKey: string,
  record: KillSwitchRecord | null | undefined): JourneyKillSwitchRecord | null {
  if (!record) return null;
  return immutable({ level, scopeRef: scopeKey,
    state: typeof record.state === 'string' ? record.state : 'unknown', reasonCode: 'KILL_SWITCH_STORED_STATE',
    revision: record.revision, updatedAt: '' });
}

/** Summary for configured records. Absent configuration defaults enabled. */
export function resolveEffectiveKillSwitch(records: KillSwitchRecordSet) {
  const levels = journeyKillSwitchLevels.map((level) => {
    const record = records[level];
    if (!record) return immutable({ level, decision: 'allow' as const, state: 'enabled' as const,
      reasonCode: 'KILL_SWITCH_DEFAULT_ENABLED', source: 'default' as const });
    if (!isJourneyKillSwitchState(record.state)) return immutable({ level, decision: 'deny' as const,
      state: 'unknown' as const, reasonCode: 'KILL_SWITCH_STATE_UNKNOWN', source: 'record' as const });
    return immutable({ level, decision: record.state === 'disabled' ? 'deny' as const : 'allow' as const,
      state: record.state, reasonCode: record.state === 'disabled'
        ? `${level.toUpperCase()}_KILL_SWITCH_ENGAGED` : 'KILL_SWITCH_ENABLED', source: 'record' as const });
  });
  const blocked = levels.find((entry) => entry.decision === 'deny') || null;
  return immutable({ decision: blocked ? 'deny' as const : 'allow' as const,
    blockedLevel: blocked?.level ?? null, reasonCode: blocked?.reasonCode ?? 'KILL_SWITCH_ALL_LEVELS_ENABLED',
    levels: immutable(levels) });
}

/** Full work resolver. Missing or malformed workflow/adapter/profile context denies. */
export function resolveKillSwitchForWork(input: {
  spaceId: string; workflowId?: string | null; adapter?: string | null; profileRefSha256?: string | null;
  records: KillSwitchRecordSet;
}) {
  const records = [
    repositoryRecord('platform', 'platform', input.records.platform),
    repositoryRecord('space', input.spaceId, input.records.space),
    repositoryRecord('workflow', input.workflowId || '', input.records.workflow),
    repositoryRecord('adapter', input.adapter || '', input.records.adapter),
    repositoryRecord('profile', input.profileRefSha256 || '', input.records.profile)
  ].filter((record): record is JourneyKillSwitchRecord => Boolean(record));
  return resolveEffectiveJourneyKillSwitch({
    scope: { spaceId: input.spaceId, workflowId: input.workflowId ?? null,
      adapter: input.adapter ?? null, profileId: input.profileRefSha256 ?? null }, records
  });
}

export function planKillSwitchPause(input: { id: string; state: unknown; fencingToken: number }): Readonly<{
  action: 'ignore' | 'pause' | 'release_and_pause'; queueId: string;
  previousState: 'ready' | 'retry_scheduled' | 'leased' | null;
  leaseReleased: boolean; nextFencingToken: number;
}> {
  const validToken = Number.isSafeInteger(input.fencingToken) && input.fencingToken >= 0 ? input.fencingToken : 0;
  if (input.state !== 'ready' && input.state !== 'retry_scheduled' && input.state !== 'leased') {
    return immutable({ action: 'ignore' as const, queueId: input.id, previousState: null,
      leaseReleased: false, nextFencingToken: validToken });
  }
  const leased = input.state === 'leased';
  return immutable({ action: leased ? 'release_and_pause' as const : 'pause' as const, queueId: input.id,
    previousState: input.state, leaseReleased: leased, nextFencingToken: validToken + (leased ? 1 : 0) });
}

export function buildKillSwitchAuditDetail(input: {
  level: KillSwitchLevel; scopeKey: string; state: KillSwitchState; reasonCode: string; revision: number;
  pausedCount: number; releasedLeaseCount: number; resumedCount: number; stillDisabledCount: number;
}) {
  assertKillSwitchReasonCode(input.reasonCode);
  const detail = immutable({ level: input.level,
    scopeRefSha256: journeyKillSwitchScopeRefSha256(input.level, input.scopeKey), state: input.state,
    reasonCode: input.reasonCode, revision: input.revision, pausedCount: input.pausedCount,
    releasedLeaseCount: input.releasedLeaseCount, resumedCount: input.resumedCount,
    stillDisabledCount: input.stillDisabledCount });
  const serialized = JSON.stringify(detail);
  return immutable({ detail, serialized, detailSha256: sha256(serialized) });
}
