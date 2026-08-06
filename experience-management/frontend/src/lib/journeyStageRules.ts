import { api, json } from '@/lib/api';
import type {
  JourneyEventEnvironment, JourneyEventPropertyDefinition, JourneyEventSchema
} from '@/lib/journeyEventControlPlane';

export const JOURNEY_STAGE_RULES_BASE = '/api/journey-stage-rules' as const;

export type JourneyStageRuleRole = 'entry' | 'progress' | 'success' | 'failure' | 'exit';
export type JourneyStageRuleState = 'draft' | 'published' | 'retired';
export type JourneyStagePredicateOperator =
  | 'equals' | 'not_equals' | 'in' | 'exists'
  | 'greater_than' | 'at_least' | 'less_than' | 'at_most';
export type JourneyRuleScalar = string | number | boolean | null;

export interface JourneyStagePredicate {
  path: string;
  operator: JourneyStagePredicateOperator;
  value?: JourneyRuleScalar | JourneyRuleScalar[];
}

export interface JourneyRequiredPriorEvent {
  eventName: string;
  withinSeconds?: number | null;
}

export interface JourneyStageRuleDraftInput {
  name: string;
  journeyMapVersionId: string;
  stageKey: string;
  role: JourneyStageRuleRole;
  priority: number;
  eventName: string;
  sourceIds: string[];
  environments: JourneyEventEnvironment[];
  predicates: JourneyStagePredicate[];
  requiredPriorEvents: JourneyRequiredPriorEvent[];
  excludedEventNames: string[];
  effectiveAt: string | null;
  expiresAt: string | null;
}

export interface JourneyStageRuleVersion extends Omit<JourneyStageRuleDraftInput, 'name'> {
  id: string;
  ruleDefinitionId: string;
  journeyDefinitionId: string;
  versionNumber: number;
  state: JourneyStageRuleState;
  revision: number;
  contentSha256: string;
  createdByUserId: string | null;
  publishedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface JourneyStageRuleDefinition {
  id: string;
  journeyDefinitionId: string;
  name: string;
  revision: number;
  draftVersionId: string | null;
  publishedVersionId: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  versions: JourneyStageRuleVersion[];
}

export interface JourneyStageRuleLimits {
  rules: number;
  predicates: number;
  priorEvents: number;
  history: number;
}

export interface JourneyRuleEvent {
  messageId: string;
  eventName: string;
  timestamp: string;
  subjectId: string;
  sourceId: string;
  environment: JourneyEventEnvironment;
  properties: Record<string, unknown>;
}

export interface JourneyStageRuleTrace {
  ruleId: string;
  ruleVersion: number;
  definitionId: string;
  stageKey: string;
  role: JourneyStageRuleRole;
  matched: boolean;
  assignmentKey: string | null;
  reasons: string[];
  specificity: number;
  priority: number;
}

export interface JourneyStageRuleSimulation {
  eventMessageId: string;
  matches: JourneyStageRuleTrace[];
  traces: JourneyStageRuleTrace[];
}

export interface JourneyAnonymousInstance {
  id: string;
  sourceId: string;
  environment: JourneyEventEnvironment;
  subjectKind: 'anonymous';
  state: string;
  currentStageKey: string | null;
  firstEventAt: string;
  latestEventAt: string;
  latestEventId: string;
  latestVisitId: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface JourneyAnonymousVisit {
  id: string;
  decisionId: string;
  eventId: string;
  journeyMapVersionId: string;
  stageKey: string;
  role: JourneyStageRuleRole;
  ruleDefinitionId: string;
  ruleVersionId: string;
  ruleVersionNumber: number;
  eventOccurredAt: string;
  visitedAt: string;
  isLate: boolean;
  isOutOfOrder: boolean;
  appliedToCurrent: boolean;
  nonApplicationReason: 'out_of_order' | 'terminal_absorbing' | null;
  priorStageKey: string | null;
}

export interface JourneyStageDecision {
  id: string;
  eventId: string;
  journeyDefinitionId: string;
  journeyMapVersionId: string;
  outcome: string;
  matchedRuleDefinitionId: string | null;
  matchedRuleVersionId: string | null;
  matchedRuleVersionNumber: number | null;
  stageKey: string | null;
  role: JourneyStageRuleRole | null;
  eventOccurredAt: string;
  evaluatedAt: string;
  isLate: boolean;
  isOutOfOrder: boolean;
  ruleSetSha256: string;
  trace: unknown;
  provenance: {
    schemaVersionId: string | null;
    sourceId: string | null;
    environment: JourneyEventEnvironment | null;
    journeyDefinitionId: string | null;
    journeyMapVersionId: string | null;
    ruleSetSha256: string | null;
    processor: string | null;
    processorVersion: string | null;
    subjectKind: string | null;
    eventOccurredAt: string | null;
    evaluatedAt: string | null;
  };
  processor: string;
  processorVersion: string;
}

export interface JourneyStageAggregates {
  total: number;
  byState: Record<string, number>;
  byStage: Record<string, number>;
}

export const journeyStageRuleRoles: JourneyStageRuleRole[] = ['entry', 'progress', 'success', 'failure', 'exit'];
export const journeyStagePredicateOperators: JourneyStagePredicateOperator[] = [
  'equals', 'not_equals', 'in', 'exists', 'greater_than', 'at_least', 'less_than', 'at_most'
];

const unsafeOperationalName = /(?:^|_)(?:prompt|body|content|document|transcript|password|secret|token|credential|access_token|refresh_token|email|phone|name|address|survey_response|raw_payload)(?:_|$)/u;

export function publishedSchemaVersion(schema: JourneyEventSchema) {
  return schema.versions.find((version) => version.state === 'published') || null;
}

/** Returns only properties that the server can safely evaluate across every
 * explicitly selected source. This is intentionally an intersection: a rule
 * must never gain a predicate from an unrelated or unpublished schema. */
export function compatibleOperationalProperties(
  sourceIds: readonly string[], eventName: string, schemasBySource: Readonly<Record<string, JourneyEventSchema[]>>
): JourneyEventPropertyDefinition[] {
  if (!sourceIds.length || !eventName) return [];
  const versions = sourceIds.map((sourceId) => {
    const schema = (schemasBySource[sourceId] || []).find((candidate) => candidate.eventName === eventName);
    return schema ? publishedSchemaVersion(schema) : null;
  });
  if (versions.some((version) => !version)) return [];
  const properties = versions.map((version) => version!.properties);
  return properties[0]!.filter((candidate) => {
    if (candidate.dataClass !== 'operational' || unsafeOperationalName.test(candidate.name)) return false;
    return properties.every((list) => list.some((property) => property.name === candidate.name
      && property.type === candidate.type && property.dataClass === candidate.dataClass));
  }).map((candidate) => {
    const matching = properties.map((list) => list.find((property) => property.name === candidate.name)!);
    const enumLists = matching.map((property) => property.enumValues).filter((values): values is Array<string | number | boolean> =>
      Boolean(values?.length));
    const enumValues = enumLists.length ? enumLists[0]!.filter((value) => enumLists.every((values) =>
      values.some((item) => Object.is(item, value)))) : undefined;
    const lengths = matching.map((property) => property.maximumLength).filter((value): value is number => typeof value === 'number');
    return { ...candidate, enumValues, maximumLength: lengths.length ? Math.min(...lengths) : candidate.maximumLength };
  });
}

export function compatibleEventNames(
  sourceIds: readonly string[], schemasBySource: Readonly<Record<string, JourneyEventSchema[]>>
) {
  if (!sourceIds.length) return [];
  const published = sourceIds.map((sourceId) => new Set((schemasBySource[sourceId] || [])
    .filter((schema) => Boolean(publishedSchemaVersion(schema))).map((schema) => schema.eventName)));
  if (published.some((events) => !events.size)) return [];
  return [...published[0]!].filter((eventName) => published.every((events) => events.has(eventName))).sort();
}

function resource(definitionId: string, suffix = '') {
  return `${JOURNEY_STAGE_RULES_BASE}/${encodeURIComponent(definitionId)}${suffix}`;
}

export function listJourneyStageRules(definitionId: string) {
  return api<{ rules: JourneyStageRuleDefinition[]; limits: JourneyStageRuleLimits }>(resource(definitionId));
}

export function createJourneyStageRule(definitionId: string, draft: JourneyStageRuleDraftInput) {
  return api<{ rule: JourneyStageRuleDefinition }>(resource(definitionId, '/rules'), json('POST', draft));
}

export function updateJourneyStageRuleDraft(
  definitionId: string, ruleDefinitionId: string, expectedRevision: number, draft: JourneyStageRuleDraftInput
) {
  return api<{ rule: JourneyStageRuleDefinition }>(
    resource(definitionId, `/rules/${encodeURIComponent(ruleDefinitionId)}/draft`),
    json('PUT', { expectedRevision, draft })
  );
}

export function publishJourneyStageRule(definitionId: string, ruleDefinitionId: string, expectedRevision: number) {
  return api<{ rule: JourneyStageRuleDefinition; replayed: boolean }>(
    resource(definitionId, `/rules/${encodeURIComponent(ruleDefinitionId)}/publish`),
    json('POST', { expectedRevision })
  );
}

export function retireJourneyStageRule(definitionId: string, ruleDefinitionId: string, expectedRevision: number) {
  return api<{ rule: JourneyStageRuleDefinition; replayed: boolean }>(
    resource(definitionId, `/rules/${encodeURIComponent(ruleDefinitionId)}/retire`),
    json('POST', { expectedRevision })
  );
}

export function simulateJourneyStageRules(
  definitionId: string, useDrafts: boolean, event: JourneyRuleEvent, history: JourneyRuleEvent[]
) {
  return api<JourneyStageRuleSimulation>(resource(definitionId, '/simulate'),
    json('POST', { useDrafts, event, history }));
}

export function readJourneyStageDecision(definitionId: string, decisionId: string) {
  return api<{ decision: JourneyStageDecision }>(
    resource(definitionId, `/decisions/${encodeURIComponent(decisionId)}`)
  );
}

export function readJourneyStageAggregates(definitionId: string) {
  return api<JourneyStageAggregates>(resource(definitionId, '/aggregates'));
}

export function listJourneyAnonymousInstances(definitionId: string, limit = 50) {
  return api<{ instances: JourneyAnonymousInstance[] }>(resource(definitionId, `/instances?limit=${limit}`));
}

export function readJourneyAnonymousInstance(definitionId: string, instanceId: string) {
  return api<{ instance: JourneyAnonymousInstance; visits: JourneyAnonymousVisit[] }>(
    resource(definitionId, `/instances/${encodeURIComponent(instanceId)}`)
  );
}
