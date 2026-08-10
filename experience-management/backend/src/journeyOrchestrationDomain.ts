import crypto from 'node:crypto';
import { workflowActionSchema, type ReviewedWorkflowAction } from './journeyAdapterContracts.js';

export type WorkflowCapability =
  | 'orchestration.read' | 'orchestration.edit' | 'orchestration.publish'
  | 'orchestration.simulate' | 'orchestration.authorise_bounded_automation';
export type WorkflowAdapter =
  | 'survey_invitation' | 'service_recovery_ticket' | 'assistant_action'
  | 'internal_notification' | 'signed_webhook';
export type WorkflowScalar = string | number | boolean | null;

export type WorkflowTrigger =
  | { type: 'event'; eventName: string; sourceId: string }
  | { type: 'metric_threshold'; metricDefinitionId: string; operator: 'gt' | 'gte' | 'lt' | 'lte'; value: number }
  | { type: 'schedule'; scheduleKey: string; timezone: string };

export type WorkflowCondition = {
  key: string;
  fact: string;
  operator: 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'in' | 'exists';
  value?: WorkflowScalar | WorkflowScalar[];
};

export type WorkflowAction = ReviewedWorkflowAction;

export type WorkflowAutomationPolicy =
  | { mode: 'human_approval' }
  | {
      mode: 'bounded_automatic';
      maximumActionsPerRun: number;
      maximumActionsPerSubjectPerDay: number;
      allowedAdapters: WorkflowAdapter[];
      recipientScopes: string[];
      purpose: string;
      authorisedByUserId: string;
    };

export type WorkflowDraft = {
  id: string;
  spaceId: string;
  name: string;
  state: 'draft';
  revision: number;
  trigger: WorkflowTrigger;
  conditions: WorkflowCondition[];
  actions: WorkflowAction[];
  automationPolicy: WorkflowAutomationPolicy;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowVersion = Readonly<{
  id: string;
  workflowId: string;
  spaceId: string;
  versionNumber: number;
  name: string;
  trigger: WorkflowTrigger;
  conditions: WorkflowCondition[];
  actions: WorkflowAction[];
  automationPolicy: WorkflowAutomationPolicy;
  contentSha256: string;
  publishedByUserId: string;
  publishedAt: string;
}>;

export type WorkflowDefinition = Readonly<{
  id: string;
  spaceId: string;
  state: 'published' | 'retired';
  revision: number;
  currentVersionId: string;
  currentVersionNumber: number;
  retiredAt: string | null;
  retiredByUserId: string | null;
}>;

export class JourneyOrchestrationDomainError extends Error {
  constructor(message: string, public readonly code: string, public readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'JourneyOrchestrationDomainError';
  }
}

const adapters = new Set<WorkflowAdapter>([
  'survey_invitation', 'service_recovery_ticket', 'assistant_action', 'internal_notification', 'signed_webhook'
]);
const keyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const factPattern = /^[A-Za-z][A-Za-z0-9_.]{0,127}$/u;
const iso = (value: string) => Number.isFinite(Date.parse(value));
const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>)
    // Persisted workflow and idempotency hashes must not depend on the host's
    // locale or ICU build. UTF-16 code-unit order is stable across runtimes.
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`).join(',')}}`;
  return JSON.stringify(value);
}

function clone<T>(value: T): T { return structuredClone(value); }
function immutable<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value as Record<string, unknown>)) immutable(entry);
  return Object.freeze(value);
}

export function validateAutomationPolicy(policy: WorkflowAutomationPolicy, actions: WorkflowAction[]): string[] {
  if (policy.mode === 'human_approval') return [];
  const issues: string[] = [];
  if (!Number.isSafeInteger(policy.maximumActionsPerRun) || policy.maximumActionsPerRun < 1
      || policy.maximumActionsPerRun > 1_000) issues.push('AUTOMATION_RUN_CAP_INVALID');
  if (!Number.isSafeInteger(policy.maximumActionsPerSubjectPerDay)
      || policy.maximumActionsPerSubjectPerDay < 1 || policy.maximumActionsPerSubjectPerDay > 100) {
    issues.push('AUTOMATION_SUBJECT_CAP_INVALID');
  }
  if (!policy.purpose.trim() || policy.purpose.length > 500) issues.push('AUTOMATION_PURPOSE_INVALID');
  if (!keyPattern.test(policy.authorisedByUserId)) issues.push('AUTOMATION_AUTHORISER_INVALID');
  if (!policy.allowedAdapters.length || new Set(policy.allowedAdapters).size !== policy.allowedAdapters.length
      || policy.allowedAdapters.some((adapter) => !adapters.has(adapter))) issues.push('AUTOMATION_ADAPTER_SCOPE_INVALID');
  if (!policy.recipientScopes.length || new Set(policy.recipientScopes).size !== policy.recipientScopes.length
      || policy.recipientScopes.some((scope) => !keyPattern.test(scope))) issues.push('AUTOMATION_RECIPIENT_SCOPE_INVALID');
  if (actions.some((action) => !policy.allowedAdapters.includes(action.adapter))) issues.push('ACTION_ADAPTER_OUTSIDE_AUTOMATION_SCOPE');
  if (actions.some((action) => !policy.recipientScopes.includes(action.recipientScope))) {
    issues.push('ACTION_RECIPIENT_OUTSIDE_AUTOMATION_SCOPE');
  }
  return issues;
}

export function validateWorkflowDraft(draft: WorkflowDraft): string[] {
  const issues: string[] = [];
  if (!keyPattern.test(draft.id) || !keyPattern.test(draft.spaceId)) issues.push('WORKFLOW_IDENTITY_INVALID');
  if (!draft.name.trim() || draft.name.length > 160) issues.push('WORKFLOW_NAME_INVALID');
  if (!Number.isSafeInteger(draft.revision) || draft.revision < 1) issues.push('WORKFLOW_REVISION_INVALID');
  if (!iso(draft.createdAt) || !iso(draft.updatedAt) || Date.parse(draft.updatedAt) < Date.parse(draft.createdAt)) {
    issues.push('WORKFLOW_TIME_INVALID');
  }
  if (draft.trigger.type === 'event' && (!keyPattern.test(draft.trigger.eventName) || !keyPattern.test(draft.trigger.sourceId))) {
    issues.push('TRIGGER_EVENT_INVALID');
  } else if (draft.trigger.type === 'metric_threshold'
      && (!keyPattern.test(draft.trigger.metricDefinitionId) || !Number.isFinite(draft.trigger.value))) {
    issues.push('TRIGGER_METRIC_INVALID');
  } else if (draft.trigger.type === 'schedule'
      && (!keyPattern.test(draft.trigger.scheduleKey) || !draft.trigger.timezone.trim())) issues.push('TRIGGER_SCHEDULE_INVALID');
  if (draft.conditions.length > 64) issues.push('CONDITION_LIMIT_EXCEEDED');
  const conditionKeys = new Set<string>();
  for (const condition of draft.conditions) {
    if (!keyPattern.test(condition.key) || conditionKeys.has(condition.key) || !factPattern.test(condition.fact)) {
      issues.push('CONDITION_IDENTITY_INVALID');
    }
    conditionKeys.add(condition.key);
    if (condition.operator === 'exists' && condition.value !== undefined) issues.push('CONDITION_EXISTS_VALUE_FORBIDDEN');
    if (condition.operator === 'in' && (!Array.isArray(condition.value) || !condition.value.length)) issues.push('CONDITION_IN_VALUE_INVALID');
    if (condition.operator !== 'exists' && condition.value === undefined) issues.push('CONDITION_VALUE_REQUIRED');
    if ((condition.operator === 'greater_than' || condition.operator === 'less_than')
        && (typeof condition.value !== 'number' || !Number.isFinite(condition.value))) {
      issues.push('CONDITION_NUMERIC_VALUE_INVALID');
    }
    if (!['in', 'exists'].includes(condition.operator) && Array.isArray(condition.value)) {
      issues.push('CONDITION_SCALAR_VALUE_REQUIRED');
    }
  }
  if (!draft.actions.length || draft.actions.length > 32) issues.push('ACTION_LIMIT_INVALID');
  const actionKeys = new Set<string>();
  for (const action of draft.actions) {
    if (!keyPattern.test(action.key) || actionKeys.has(action.key)) issues.push('ACTION_KEY_INVALID');
    actionKeys.add(action.key);
    if (!adapters.has(action.adapter)) issues.push('ACTION_ADAPTER_INVALID');
    if (!action.purpose.trim() || action.purpose.length > 500) issues.push('ACTION_PURPOSE_INVALID');
    if (!keyPattern.test(action.recipientScope)) issues.push('ACTION_RECIPIENT_SCOPE_INVALID');
    if (!workflowActionSchema.safeParse(action).success) issues.push('ACTION_PAYLOAD_INVALID');
  }
  issues.push(...validateAutomationPolicy(draft.automationPolicy, draft.actions));
  return [...new Set(issues)];
}

export function reviseWorkflowDraft(draft: WorkflowDraft, expectedRevision: number,
  patch: Partial<Pick<WorkflowDraft, 'name' | 'trigger' | 'conditions' | 'actions' | 'automationPolicy'>>,
  updatedAt: string): WorkflowDraft {
  if (draft.state !== 'draft') throw new JourneyOrchestrationDomainError('Only a draft can be revised.', 'WORKFLOW_NOT_DRAFT');
  if (draft.revision !== expectedRevision) throw new JourneyOrchestrationDomainError(
    'Workflow draft revision conflict.', 'WORKFLOW_REVISION_CONFLICT', { expectedRevision, actualRevision: draft.revision });
  const next = clone({ ...draft, ...patch, revision: draft.revision + 1, updatedAt });
  const issues = validateWorkflowDraft(next);
  if (issues.length) throw new JourneyOrchestrationDomainError('Workflow draft is invalid.', 'WORKFLOW_INVALID', { issues });
  return next;
}

export function decideWorkflowCapability(required: WorkflowCapability, granted: readonly WorkflowCapability[]) {
  const allowed = granted.includes(required);
  return immutable({ allowed, required, reason: allowed ? 'CAPABILITY_GRANTED' : 'CAPABILITY_MISSING' });
}

export function publishWorkflowDraft(draft: WorkflowDraft, input: { actorUserId: string;
  capabilities: readonly WorkflowCapability[]; versionId: string; versionNumber: number; publishedAt: string }) {
  const permission = decideWorkflowCapability('orchestration.publish', input.capabilities);
  if (!permission.allowed) throw new JourneyOrchestrationDomainError('Publishing capability is required.', 'WORKFLOW_PUBLISH_FORBIDDEN');
  const issues = validateWorkflowDraft(draft);
  if (issues.length) throw new JourneyOrchestrationDomainError('Workflow draft is invalid.', 'WORKFLOW_INVALID', { issues });
  if (draft.automationPolicy.mode === 'bounded_automatic'
      && !input.capabilities.includes('orchestration.authorise_bounded_automation')) {
    throw new JourneyOrchestrationDomainError('Bounded automation requires separate authorisation.', 'AUTOMATION_AUTHORISATION_REQUIRED');
  }
  if (draft.automationPolicy.mode === 'bounded_automatic'
      && draft.automationPolicy.authorisedByUserId !== input.actorUserId) {
    throw new JourneyOrchestrationDomainError('The recorded automation authoriser must publish the version.',
      'AUTOMATION_AUTHORISER_MISMATCH');
  }
  if (!keyPattern.test(input.actorUserId) || !keyPattern.test(input.versionId)
      || !Number.isSafeInteger(input.versionNumber) || input.versionNumber < 1
      || !iso(input.publishedAt)) throw new JourneyOrchestrationDomainError('Version identity is invalid.', 'WORKFLOW_VERSION_INVALID');
  const content = { name: draft.name, trigger: draft.trigger, conditions: draft.conditions,
    actions: draft.actions, automationPolicy: draft.automationPolicy };
  const version = immutable(clone({ id: input.versionId, workflowId: draft.id, spaceId: draft.spaceId,
    versionNumber: input.versionNumber, ...content, contentSha256: sha256(stable(content)),
    publishedByUserId: input.actorUserId, publishedAt: input.publishedAt })) as WorkflowVersion;
  const definition = immutable({ id: draft.id, spaceId: draft.spaceId, state: 'published' as const,
    revision: draft.revision + 1, currentVersionId: version.id, currentVersionNumber: version.versionNumber,
    retiredAt: null, retiredByUserId: null });
  return immutable({ definition, version });
}

export function retireWorkflowDefinition(definition: WorkflowDefinition, input: { actorUserId: string;
  capabilities: readonly WorkflowCapability[]; expectedRevision: number; retiredAt: string }): WorkflowDefinition {
  if (!decideWorkflowCapability('orchestration.publish', input.capabilities).allowed) {
    throw new JourneyOrchestrationDomainError('Publishing capability is required.', 'WORKFLOW_RETIRE_FORBIDDEN');
  }
  if (definition.revision !== input.expectedRevision) throw new JourneyOrchestrationDomainError(
    'Workflow revision conflict.', 'WORKFLOW_REVISION_CONFLICT');
  if (definition.state === 'retired') throw new JourneyOrchestrationDomainError('Workflow is already retired.', 'WORKFLOW_ALREADY_RETIRED');
  if (!iso(input.retiredAt) || !keyPattern.test(input.actorUserId)) throw new JourneyOrchestrationDomainError(
    'Retirement attribution is invalid.', 'WORKFLOW_RETIREMENT_INVALID');
  return immutable({ ...definition, state: 'retired', revision: definition.revision + 1,
    retiredAt: input.retiredAt, retiredByUserId: input.actorUserId });
}

export type SafetyGate = 'consent' | 'suppression' | 'entitlement' | 'quota' | 'quiet_hours'
  | 'frequency_cap' | 'source_state' | 'platform_kill_switch' | 'space_kill_switch'
  | 'workflow_kill_switch' | 'adapter_kill_switch' | 'profile_kill_switch';
export type GateDecision = 'allow' | 'deny' | 'unknown';
const safetyGates: readonly SafetyGate[] = [
  'consent', 'suppression', 'entitlement', 'quota', 'quiet_hours', 'frequency_cap', 'source_state',
  'platform_kill_switch', 'space_kill_switch', 'workflow_kill_switch', 'adapter_kill_switch',
  'profile_kill_switch'
];
export type ExplainStep = Readonly<{ kind: 'trigger' | 'condition' | 'gate' | 'approval' | 'decision';
  key: string; decision: 'allow' | 'deny' | 'unknown'; reason: string }>;

export type WorkflowEvaluationInput = {
  mode: 'dry_run' | 'historical';
  workflowVersion: WorkflowVersion;
  triggerFingerprint: string;
  triggerMatched: boolean;
  subjectId: string;
  facts: Record<string, WorkflowScalar>;
  gates: Record<SafetyGate, GateDecision>;
  approvedActionKeys?: readonly string[];
};

function evaluateCondition(condition: WorkflowCondition, facts: Record<string, WorkflowScalar>): ExplainStep {
  if (!Object.hasOwn(facts, condition.fact)) return immutable({ kind: 'condition', key: condition.key,
    decision: 'unknown', reason: 'FACT_UNKNOWN' });
  const actual = facts[condition.fact];
  let matched = false;
  if (condition.operator === 'exists') matched = actual !== null;
  else if (condition.operator === 'equals') matched = actual === condition.value;
  else if (condition.operator === 'not_equals') matched = actual !== condition.value;
  else if (condition.operator === 'greater_than') matched = typeof actual === 'number'
    && typeof condition.value === 'number' && actual > condition.value;
  else if (condition.operator === 'less_than') matched = typeof actual === 'number'
    && typeof condition.value === 'number' && actual < condition.value;
  else if (condition.operator === 'in') matched = Array.isArray(condition.value) && condition.value.includes(actual);
  return immutable({ kind: 'condition', key: condition.key, decision: matched ? 'allow' : 'deny',
    reason: matched ? 'CONDITION_MATCHED' : 'CONDITION_NOT_MATCHED' });
}

export function deriveActionIdempotencyKey(input: { workflowVersionId: string; triggerFingerprint: string;
  subjectId: string; actionKey: string }): string {
  for (const value of Object.values(input)) if (!String(value).length) throw new JourneyOrchestrationDomainError(
    'Idempotency inputs must be non-empty.', 'ACTION_IDEMPOTENCY_INPUT_INVALID');
  return `orch_${sha256(stable(input))}`;
}

export function evaluateWorkflow(input: WorkflowEvaluationInput) {
  const commonTrace: ExplainStep[] = [immutable({ kind: 'trigger', key: input.workflowVersion.trigger.type,
    decision: input.triggerMatched ? 'allow' : 'deny', reason: input.triggerMatched ? 'TRIGGER_MATCHED' : 'TRIGGER_NOT_MATCHED' })];
  commonTrace.push(...input.workflowVersion.conditions.map((condition) => evaluateCondition(condition, input.facts)));
  const approved = new Set(input.approvedActionKeys || []);
  const actions = input.workflowVersion.actions.map((action) => {
    const trace = [...commonTrace];
    for (const gate of safetyGates) {
      const decision = input.gates[gate] || 'unknown';
      trace.push(immutable({ kind: 'gate', key: gate, decision, reason: decision === 'allow' ? 'GATE_ALLOWED'
        : decision === 'deny' ? 'GATE_DENIED' : 'GATE_UNKNOWN' }));
    }
    const policy = input.workflowVersion.automationPolicy;
    const consequential = Boolean(action.consequential || action.externallyVisible || action.adapter !== 'internal_notification');
    const bounded = policy.mode === 'bounded_automatic' && policy.allowedAdapters.includes(action.adapter)
      && policy.recipientScopes.includes(action.recipientScope);
    const approvalRequired = consequential && !bounded;
    const approvalDecision = !approvalRequired || approved.has(action.key) ? 'allow' : 'deny';
    trace.push(immutable({ kind: 'approval', key: action.key, decision: approvalDecision,
      reason: approvalRequired ? (approvalDecision === 'allow' ? 'HUMAN_APPROVAL_PRESENT' : 'HUMAN_APPROVAL_REQUIRED')
        : bounded ? 'BOUNDED_AUTOMATION_AUTHORISED' : 'APPROVAL_NOT_REQUIRED' }));
    const allowed = trace.every((step) => step.decision === 'allow');
    trace.push(immutable({ kind: 'decision', key: action.key, decision: allowed ? 'allow' : 'deny',
      reason: allowed ? 'ACTION_ELIGIBLE' : 'ACTION_SUPPRESSED' }));
    return immutable({ actionKey: action.key, adapter: action.adapter, allowed,
      approvalRequired, dispatchAttempted: false,
      idempotencyKey: deriveActionIdempotencyKey({ workflowVersionId: input.workflowVersion.id,
        triggerFingerprint: input.triggerFingerprint, subjectId: input.subjectId, actionKey: action.key }), trace });
  });
  return immutable({ mode: input.mode, workflowVersionId: input.workflowVersion.id,
    workflowContentSha256: input.workflowVersion.contentSha256, triggerFingerprint: input.triggerFingerprint,
    subjectId: input.subjectId, actions });
}

export const simulateWorkflow = evaluateWorkflow;

export function createContentSafeSimulationAudit(result: ReturnType<typeof evaluateWorkflow>, input: {
  auditId: string; spaceId: string; actorUserId: string; createdAt: string }) {
  return immutable({ id: input.auditId, spaceId: input.spaceId, actorUserId: input.actorUserId,
    action: 'workflow.simulated' as const, mode: result.mode, workflowVersionId: result.workflowVersionId,
    workflowContentSha256: result.workflowContentSha256, triggerFingerprintSha256: sha256(result.triggerFingerprint),
    subjectRefSha256: sha256(result.subjectId), decisions: result.actions.map((action) => ({
      actionKey: action.actionKey, adapter: action.adapter, allowed: action.allowed,
      reasonCodes: action.trace.map((step) => step.reason)
    })), createdAt: input.createdAt });
}
