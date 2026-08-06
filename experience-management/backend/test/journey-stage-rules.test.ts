import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  evaluateJourneyStageRules, JourneyStageRuleError, type JourneyRuleEvent, type JourneyStageRule
} from '../src/journeyStageRules.js';

const event: JourneyRuleEvent = {
  messageId: 'message-1', eventName: 'survey_published', timestamp: '2026-08-04T12:00:00.000Z',
  subjectId: 'profile-1', sourceId: 'source-production', environment: 'production',
  properties: { purpose: 'customer_experience', questionCount: 12, template: { used: true } }
};

function rule(input: Partial<JourneyStageRule> = {}): JourneyStageRule {
  return {
    id: 'rule-1', definitionId: 'activation', stageKey: 'first-value', version: 1,
    state: 'published', role: 'success', priority: 100, eventName: 'survey_published', ...input
  };
}

test('matches bounded properties and same-subject prior events with an explainable idempotency key', () => {
  const history: JourneyRuleEvent[] = [{
    ...event, messageId: 'prior-1', eventName: 'survey_created', timestamp: '2026-08-04T11:58:00.000Z'
  }];
  const mapping = rule({
    sourceIds: ['source-production'], environments: ['production'],
    predicates: [
      { path: 'purpose', operator: 'equals', value: 'customer_experience' },
      { path: 'questionCount', operator: 'at_least', value: 10 },
      { path: 'template.used', operator: 'exists' }
    ],
    requiredPriorEvents: [{ eventName: 'survey_created', withinSeconds: 300 }]
  });

  const first = evaluateJourneyStageRules([mapping], event, history);
  const second = evaluateJourneyStageRules([mapping], event, [...history].reverse());
  assert.equal(first.matches.length, 1);
  assert.equal(first.matches[0].assignmentKey?.length, 64);
  assert.deepEqual(first, second);
  assert.deepEqual(first.matches[0].reasons, [
    'predicate_matched:purpose:equals', 'predicate_matched:questionCount:at_least',
    'predicate_matched:template.used:exists', 'prior_event_matched:survey_created', 'rule_matched'
  ]);
});

test('does not satisfy prior-event conditions across subjects, from the future, or outside the window', () => {
  for (const prior of [
    { ...event, subjectId: 'someone-else', eventName: 'survey_created', timestamp: '2026-08-04T11:59:00.000Z' },
    { ...event, eventName: 'survey_created', timestamp: '2026-08-04T12:01:00.000Z' },
    { ...event, eventName: 'survey_created', timestamp: '2026-08-04T11:40:00.000Z' }
  ]) {
    const result = evaluateJourneyStageRules([
      rule({ requiredPriorEvents: [{ eventName: 'survey_created', withinSeconds: 300 }] })
    ], event, [prior]);
    assert.equal(result.matches.length, 0);
    assert.ok(result.traces[0].reasons.includes('prior_event_missing:survey_created'));
  }
});

test('excluded prior events block only the same subject and never a future fact', () => {
  const blocked = evaluateJourneyStageRules([
    rule({ excludedEventNames: ['account_cancelled'] })
  ], event, [{ ...event, eventName: 'account_cancelled', timestamp: '2026-08-04T11:00:00.000Z' }]);
  assert.equal(blocked.matches.length, 0);
  assert.deepEqual(blocked.traces[0].reasons, ['excluded_prior_event:account_cancelled']);

  for (const prior of [
    { ...event, subjectId: 'someone-else', eventName: 'account_cancelled', timestamp: '2026-08-04T11:00:00.000Z' },
    { ...event, eventName: 'account_cancelled', timestamp: '2026-08-05T11:00:00.000Z' }
  ]) assert.equal(evaluateJourneyStageRules([
    rule({ excludedEventNames: ['account_cancelled'] })
  ], event, [prior]).matches.length, 1);
});

test('orders simultaneous journey matches deterministically by priority and specificity', () => {
  const result = evaluateJourneyStageRules([
    rule({ id: 'z-low', definitionId: 'renewal', priority: 10 }),
    rule({ id: 'a-general', priority: 100 }),
    rule({ id: 'b-specific', priority: 100, predicates: [{ path: 'purpose', operator: 'equals', value: 'customer_experience' }] })
  ], event);
  assert.deepEqual(result.matches.map((match) => match.ruleId), ['b-specific', 'a-general', 'z-low']);
});

test('explains state, source, environment, effective-time, expiry, and predicate non-matches without payload values', () => {
  const result = evaluateJourneyStageRules([
    rule({ id: 'draft', state: 'draft' }),
    rule({ id: 'source', sourceIds: ['another-source'] }),
    rule({ id: 'environment', environments: ['staging'] }),
    rule({ id: 'future', effectiveAt: '2026-08-05T00:00:00.000Z' }),
    rule({ id: 'expired', expiresAt: '2026-08-04T00:00:00.000Z' }),
    rule({ id: 'predicate', predicates: [{ path: 'purpose', operator: 'equals', value: 'employee_experience' }] })
  ], event);
  assert.equal(result.matches.length, 0);
  assert.deepEqual(new Set(result.traces.flatMap((trace) => trace.reasons)), new Set([
    'rule_draft', 'source_mismatch', 'environment_mismatch', 'before_effective_time',
    'after_expiry_time', 'predicate_failed:purpose:equals'
  ]));
  assert.doesNotMatch(JSON.stringify(result), /customer_experience|employee_experience/u);
});

test('rejects prototype paths, duplicate versions, unsafe bounds, and invalid timestamps', () => {
  assert.throws(() => evaluateJourneyStageRules([
    rule({ predicates: [{ path: '__proto__.polluted', operator: 'exists' }] })
  ], event), (error) => error instanceof JourneyStageRuleError && error.code === 'JOURNEY_RULE_UNSAFE_PATH');
  assert.throws(() => evaluateJourneyStageRules([rule(), rule()], event),
    (error) => error instanceof JourneyStageRuleError && error.code === 'JOURNEY_RULE_INVALID');
  assert.throws(() => evaluateJourneyStageRules([
    rule({ requiredPriorEvents: [{ eventName: 'survey_created', withinSeconds: 400 * 24 * 60 * 60 }] })
  ], event), (error) => error instanceof JourneyStageRuleError && error.code === 'JOURNEY_RULE_INVALID');
  assert.throws(() => evaluateJourneyStageRules([rule()], { ...event, timestamp: 'not-a-date' }),
    (error) => error instanceof JourneyStageRuleError && error.code === 'JOURNEY_RULE_INVALID');
});
