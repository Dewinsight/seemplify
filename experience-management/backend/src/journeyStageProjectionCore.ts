import crypto from 'node:crypto';
import { evaluateJourneyStageRules, journeyStageRuleLimits, type JourneyRuleEvent } from './journeyStageRules.js';
import type { PublishedJourneyStageRule } from './journeyStageRuleRepository.js';

export const journeyStageLateThresholdMs = 24 * 60 * 60 * 1_000;

export type JourneyStageProjectionRawEvent = {
  received_at: string;
  id: string;
  space_id: string;
  source_id: string;
  environment: JourneyRuleEvent['environment'];
  event_id: string;
  event_name: string | null;
  occurred_at: string;
  schema_version_id: string | null;
  anonymous_id_hash: string | null;
  payload_json: string | Record<string, unknown>;
  envelope_sha256: string;
  retention_expires_at: string;
};

export type JourneyStageProjectionClaim = {
  leaseGeneration: number;
};

export type JourneyStageProjectionErrorFactory = (message: string, code: string) => Error;

type JourneyStageRuleRoleLike = 'entry' | 'progress' | 'success' | 'failure' | 'exit';

function parseObject(value: unknown) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function iso(value: unknown) {
  return new Date(String(value)).toISOString();
}

function sha(parts: string[]) {
  return crypto.createHash('sha256').update(parts.join('\u0000')).digest('hex');
}

export function groupPublishedJourneyStageRules(rules: PublishedJourneyStageRule[]) {
  const groups = new Map<string, PublishedJourneyStageRule[]>();
  for (const rule of rules) {
    groups.set(rule.journeyDefinitionId, [...(groups.get(rule.journeyDefinitionId) || []), rule]);
  }
  return groups;
}

export function buildJourneyStageRuleHistory(rows: Array<Record<string, unknown>>) {
  return rows.reverse().map((row): JourneyRuleEvent => ({
    messageId: String(row.event_id),
    eventName: String(row.event_name),
    timestamp: iso(row.occurred_at),
    subjectId: String(row.anonymous_id_hash),
    sourceId: String(row.source_id),
    environment: row.environment as JourneyRuleEvent['environment'],
    properties: parseObject(parseObject(row.payload_json).properties)
  }));
}

export function evaluatePublishedJourneyStageRuleGroup(input: {
  raw: JourneyStageProjectionRawEvent;
  claim: JourneyStageProjectionClaim;
  rules: PublishedJourneyStageRule[];
  history: JourneyRuleEvent[];
  evaluatedAt: string;
  journeyStageProcessor: string;
  journeyStageProcessorVersion: string;
  errorFactory: JourneyStageProjectionErrorFactory;
  evaluator?: typeof evaluateJourneyStageRules;
}) {
  const mapVersionId = input.rules[0]!.journeyMapVersionId;
  if (input.rules.some((rule) => rule.journeyMapVersionId !== mapVersionId)) {
    throw input.errorFactory('Published rules span more than one governed map version.', 'EVENT_STAGE_RULE_VERSION_MIXED');
  }
  const journeyDefinitionId = input.rules[0]!.journeyDefinitionId;
  const event: JourneyRuleEvent = {
    messageId: input.raw.event_id,
    eventName: String(input.raw.event_name),
    timestamp: input.raw.occurred_at,
    subjectId: input.raw.anonymous_id_hash || 'missing-anonymous-subject',
    sourceId: input.raw.source_id,
    environment: input.raw.environment,
    properties: parseObject(parseObject(input.raw.payload_json).properties)
  };
  const evaluation = input.raw.anonymous_id_hash
    ? (input.evaluator || evaluateJourneyStageRules)(input.rules.map((rule) => rule.evaluator), event, input.history)
    : {
      eventMessageId: event.messageId,
      matches: [],
      traces: input.rules.map((rule) => ({
        ruleId: rule.ruleDefinitionId,
        ruleVersion: rule.versionNumber,
        definitionId: rule.journeyDefinitionId,
        stageKey: rule.stageKey,
        role: rule.role,
        matched: false,
        assignmentKey: null,
        reasons: ['anonymous_subject_missing'],
        specificity: 0,
        priority: rule.priority
      }))
    };
  const matched = evaluation.matches[0] || null;
  const matchedVersion = matched
    ? input.rules.find((rule) => rule.ruleDefinitionId === matched.ruleId && rule.versionNumber === matched.ruleVersion)
    : undefined;
  if (matched && !matchedVersion) {
    throw input.errorFactory('A matched rule version was not present in the published snapshot.', 'EVENT_STAGE_RULE_SNAPSHOT_INVALID');
  }
  const ruleSetSha256 = sha(input.rules.map((rule) => `${rule.id}:${rule.contentSha256}`).sort());
  const decisionKey = sha([input.raw.received_at, input.raw.id, journeyDefinitionId, input.journeyStageProcessor]);
  const isLate = Date.parse(input.raw.occurred_at) < Date.parse(input.raw.received_at) - journeyStageLateThresholdMs;
  const outcome = !input.raw.anonymous_id_hash ? 'skipped_no_anonymous_subject' : matched ? 'matched' : 'no_match';
  const provenance = {
    rawEvent: {
      receivedAt: input.raw.received_at,
      id: input.raw.id,
      eventId: input.raw.event_id,
      envelopeSha256: input.raw.envelope_sha256,
      schemaVersionId: input.raw.schema_version_id
    },
    source: { id: input.raw.source_id, environment: input.raw.environment },
    journey: { definitionId: journeyDefinitionId, mapVersionId },
    ruleSetSha256,
    processor: input.journeyStageProcessor,
    processorVersion: input.journeyStageProcessorVersion,
    leaseGeneration: input.claim.leaseGeneration,
    subjectKind: input.raw.anonymous_id_hash ? 'anonymous' : null,
    eventOccurredAt: input.raw.occurred_at,
    evaluatedAt: input.evaluatedAt
  };
  return { mapVersionId, journeyDefinitionId, event, evaluation, matched, matchedVersion, ruleSetSha256, decisionKey, isLate, outcome, provenance };
}

export function tupleBefore(eventAt: string, eventId: string, latestAt: string, latestEventId: string) {
  return eventAt < latestAt || (eventAt === latestAt && eventId < latestEventId);
}

export function stageInstanceState(role: JourneyStageRuleRoleLike) {
  if (role === 'success') return 'succeeded';
  if (role === 'failure') return 'failed';
  if (role === 'exit') return 'exited';
  return 'active';
}

export function deriveAnonymousVisitApplication(input: {
  instance: { state: string; currentStageKey: string | null; latestEventAt: string; latestEventId: string };
  eventOccurredAt: string;
  eventId: string;
}) {
  const outOfOrder = Boolean(input.instance.currentStageKey)
    && tupleBefore(input.eventOccurredAt, input.eventId, input.instance.latestEventAt, input.instance.latestEventId);
  const chronologicallyNewer = !input.instance.currentStageKey
    || tupleBefore(input.instance.latestEventAt, input.instance.latestEventId, input.eventOccurredAt, input.eventId);
  const terminalAbsorbing = ['succeeded', 'failed', 'exited'].includes(String(input.instance.state));
  const applies = !outOfOrder && chronologicallyNewer && !terminalAbsorbing;
  const nonApplicationReason = applies ? null : outOfOrder ? 'out_of_order' : 'terminal_absorbing';
  return { outOfOrder, chronologicallyNewer, terminalAbsorbing, applies, nonApplicationReason };
}

export { journeyStageRuleLimits };
