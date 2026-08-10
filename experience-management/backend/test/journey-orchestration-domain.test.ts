import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createContentSafeSimulationAudit,
  decideWorkflowCapability,
  deriveActionIdempotencyKey,
  evaluateWorkflow,
  JourneyOrchestrationDomainError,
  publishWorkflowDraft,
  retireWorkflowDefinition,
  reviseWorkflowDraft,
  simulateWorkflow,
  validateWorkflowDraft,
  type GateDecision,
  type SafetyGate,
  type WorkflowDraft
} from '../src/journeyOrchestrationDomain.js';

const at = '2026-08-07T10:00:00.000Z';
function draft(overrides: Partial<WorkflowDraft> = {}): WorkflowDraft {
  return {
    id: 'workflow.checkout-recovery', spaceId: 'space-a', name: 'Checkout recovery', state: 'draft', revision: 1,
    trigger: { type: 'event', eventName: 'checkout.abandoned', sourceId: 'web-prod' },
    conditions: [{ key: 'high-value', fact: 'basket.value', operator: 'greater_than', value: 100 }],
    actions: [{ key: 'open-ticket', adapter: 'service_recovery_ticket', purpose: 'Recover failed checkout',
      recipientScope: 'support-team', consequential: true,
      payload: { surveyId: 'survey-checkout', title: 'Recover failed checkout', priority: 'high' } }],
    automationPolicy: { mode: 'human_approval' }, createdAt: at, updatedAt: at, ...overrides
  };
}

const allowGates = Object.fromEntries([
  'consent', 'suppression', 'entitlement', 'quota', 'quiet_hours', 'frequency_cap', 'source_state',
  'platform_kill_switch', 'space_kill_switch', 'workflow_kill_switch', 'adapter_kill_switch', 'profile_kill_switch'
].map((gate) => [gate, 'allow'])) as Record<SafetyGate, GateDecision>;

function publish(source = draft()) {
  return publishWorkflowDraft(source, { actorUserId: 'manager-1', capabilities: ['orchestration.publish'],
    versionId: 'workflow-version-1', versionNumber: 1, publishedAt: at });
}

test('validates typed definitions and bounded automation limits deterministically', () => {
  const invalid = draft({ automationPolicy: { mode: 'bounded_automatic', maximumActionsPerRun: 1001,
    maximumActionsPerSubjectPerDay: 0, allowedAdapters: ['signed_webhook'], recipientScopes: ['customers'],
    purpose: '', authorisedByUserId: 'admin-1' } });
  assert.deepEqual(validateWorkflowDraft(invalid), [
    'AUTOMATION_RUN_CAP_INVALID', 'AUTOMATION_SUBJECT_CAP_INVALID', 'AUTOMATION_PURPOSE_INVALID',
    'ACTION_ADAPTER_OUTSIDE_AUTOMATION_SCOPE', 'ACTION_RECIPIENT_OUTSIDE_AUTOMATION_SCOPE'
  ]);
});

test('revises drafts optimistically and reports a stable conflict', () => {
  const revised = reviseWorkflowDraft(draft(), 1, { name: 'Reviewed checkout recovery' },
    '2026-08-07T10:01:00.000Z');
  assert.equal(revised.revision, 2);
  assert.throws(() => reviseWorkflowDraft(revised, 1, { name: 'Stale edit' }, at), (error) => {
    assert.ok(error instanceof JourneyOrchestrationDomainError);
    assert.equal(error.code, 'WORKFLOW_REVISION_CONFLICT');
    return true;
  });
});

test('publishes an immutable exact version and retires only the mutable definition lifecycle', () => {
  const { definition, version } = publish();
  assert.ok(Object.isFrozen(version));
  assert.ok(Object.isFrozen(version.actions));
  assert.match(version.contentSha256, /^[a-f0-9]{64}$/u);
  assert.throws(() => { (version.actions[0] as { purpose: string }).purpose = 'mutated'; }, TypeError);
  const retired = retireWorkflowDefinition(definition, { actorUserId: 'manager-1',
    capabilities: ['orchestration.publish'], expectedRevision: definition.revision,
    retiredAt: '2026-08-08T10:00:00.000Z' });
  assert.equal(retired.state, 'retired');
  assert.equal(version.publishedAt, at);
});

test('requires separate capability to publish bounded automatic actions', () => {
  const automatic = draft({ automationPolicy: { mode: 'bounded_automatic', maximumActionsPerRun: 10,
    maximumActionsPerSubjectPerDay: 1, allowedAdapters: ['service_recovery_ticket'],
    recipientScopes: ['support-team'], purpose: 'Bounded recovery', authorisedByUserId: 'admin-1' } });
  assert.throws(() => publish(automatic), (error) => {
    assert.ok(error instanceof JourneyOrchestrationDomainError);
    assert.equal(error.code, 'AUTOMATION_AUTHORISATION_REQUIRED');
    return true;
  });
  assert.equal(publishWorkflowDraft(automatic, { actorUserId: 'admin-1',
    capabilities: ['orchestration.publish', 'orchestration.authorise_bounded_automation'],
    versionId: 'automatic-v1', versionNumber: 1, publishedAt: at }).version.automationPolicy.mode,
  'bounded_automatic');
});

test('rejects unattributable publishers before creating an immutable version', () => {
  assert.throws(() => publishWorkflowDraft(draft(), { actorUserId: 'invalid actor',
    capabilities: ['orchestration.publish'], versionId: 'workflow-version-1', versionNumber: 1,
    publishedAt: at }), (error) => {
    assert.ok(error instanceof JourneyOrchestrationDomainError);
    assert.equal(error.code, 'WORKFLOW_VERSION_INVALID');
    return true;
  });
});

test('uses one evaluator for dry-run and historical simulation with complete allow traces', () => {
  const { version } = publish();
  const input = { workflowVersion: version, triggerFingerprint: 'trigger-42', triggerMatched: true,
    subjectId: 'profile-7', facts: { 'basket.value': 150 }, gates: allowGates,
    approvedActionKeys: ['open-ticket'] } as const;
  const dry = evaluateWorkflow({ ...input, mode: 'dry_run' });
  const historical = simulateWorkflow({ ...input, mode: 'historical' });
  assert.equal(dry.actions[0]!.allowed, true);
  assert.deepEqual(dry.actions[0]!.trace, historical.actions[0]!.trace);
  assert.equal(dry.actions[0]!.trace.filter((step) => step.kind === 'gate').length, 12);
  assert.equal(dry.actions[0]!.dispatchAttempted, false);
});

test('explains every denial and treats missing safety evidence as unknown, never allow', () => {
  const { version } = publish();
  const result = evaluateWorkflow({ mode: 'dry_run', workflowVersion: version, triggerFingerprint: 'trigger-43',
    triggerMatched: true, subjectId: 'profile-8', facts: {}, gates: { ...allowGates, consent: 'deny' },
    approvedActionKeys: [] });
  const trace = result.actions[0]!.trace;
  assert.equal(result.actions[0]!.allowed, false);
  assert.ok(trace.some((step) => step.reason === 'FACT_UNKNOWN'));
  assert.ok(trace.some((step) => step.key === 'consent' && step.reason === 'GATE_DENIED'));
  assert.ok(trace.some((step) => step.reason === 'HUMAN_APPROVAL_REQUIRED'));
  const incomplete = evaluateWorkflow({ mode: 'historical', workflowVersion: version,
    triggerFingerprint: 'trigger-44', triggerMatched: true, subjectId: 'profile-9',
    facts: { 'basket.value': 150 }, gates: {} as Record<SafetyGate, GateDecision>, approvedActionKeys: ['open-ticket'] });
  assert.equal(incomplete.actions[0]!.allowed, false);
  assert.equal(incomplete.actions[0]!.trace.filter((step) => step.reason === 'GATE_UNKNOWN').length, 12);
});

test('requires approval by default for consequential or external effects', () => {
  const { version } = publish(draft({ actions: [
    { key: 'notify', adapter: 'internal_notification', purpose: 'Inform operators', recipientScope: 'operators',
      payload: { targetUserId: 'operator-1', title: 'Checkout needs review', body: 'Review the approved recovery.', severity: 'warning' } },
    { key: 'webhook', adapter: 'signed_webhook', purpose: 'Notify approved system', recipientScope: 'crm',
      payload: { destinationId: 'crm-prod', destinationRevision: 1, eventType: 'checkout.recovery', data: { status: 'approved' } } }
  ] }));
  const result = evaluateWorkflow({ mode: 'dry_run', workflowVersion: version, triggerFingerprint: 'trigger-45',
    triggerMatched: true, subjectId: 'profile-10', facts: { 'basket.value': 150 }, gates: allowGates });
  assert.equal(result.actions.find((action) => action.actionKey === 'notify')!.approvalRequired, false);
  assert.equal(result.actions.find((action) => action.actionKey === 'webhook')!.approvalRequired, true);
});

test('derives stable scoped action idempotency keys', () => {
  const input = { workflowVersionId: 'version-1', triggerFingerprint: 'trigger-1',
    subjectId: 'subject-1', actionKey: 'action-1' };
  assert.equal(deriveActionIdempotencyKey(input), deriveActionIdempotencyKey({ ...input }));
  assert.notEqual(deriveActionIdempotencyKey(input), deriveActionIdempotencyKey({ ...input, actionKey: 'action-2' }));
  assert.match(deriveActionIdempotencyKey(input), /^orch_[a-f0-9]{64}$/u);
});

test('returns explicit capability decisions and content-safe immutable audit facts', () => {
  assert.deepEqual(decideWorkflowCapability('orchestration.publish', ['orchestration.read']), {
    allowed: false, required: 'orchestration.publish', reason: 'CAPABILITY_MISSING'
  });
  const { version } = publish();
  const result = evaluateWorkflow({ mode: 'dry_run', workflowVersion: version, triggerFingerprint: 'raw-trigger',
    triggerMatched: false, subjectId: 'private-profile-reference', facts: { 'basket.value': 250 }, gates: allowGates });
  const audit = createContentSafeSimulationAudit(result, { auditId: 'audit-1', spaceId: 'space-a',
    actorUserId: 'manager-1', createdAt: at });
  const serialized = JSON.stringify(audit);
  assert.ok(Object.isFrozen(audit));
  assert.doesNotMatch(serialized, /private-profile-reference|raw-trigger|basket|250/u);
  assert.match(audit.subjectRefSha256, /^[a-f0-9]{64}$/u);
  assert.ok(audit.decisions[0]!.reasonCodes.includes('TRIGGER_NOT_MATCHED'));
});
