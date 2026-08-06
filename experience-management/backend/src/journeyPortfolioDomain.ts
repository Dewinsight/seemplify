import crypto from 'node:crypto';
import {
  calculateJourneyPortfolioScore,
  type JourneyScoreInput,
  type JourneyScoreMethod,
  type JourneyScoreResult,
  type JourneyWeightedScoreDimension
} from './journeyPortfolioScoring.js';

export const JOURNEY_PORTFOLIO_DOMAIN_VERSION = 'journey-portfolio-domain/v1' as const;
export const JOURNEY_INITIATIVE_OUTCOME_VERSION = 'journey-initiative-outcome/v1' as const;

export type JourneyPortfolioItemKind = 'pain_point' | 'opportunity' | 'solution' | 'initiative';
export type JourneyInsightLifecycle = 'draft' | 'validated' | 'approved' | 'archived';
export type JourneyInitiativeLifecycle =
  | 'draft'
  | 'planned'
  | 'active'
  | 'blocked'
  | 'completed'
  | 'cancelled'
  | 'archived';

interface JourneyPortfolioItemBase {
  id: string;
  spaceId: string;
  revision: number;
  title: string;
  description: string;
  ownerUserId: string | null;
  ownerTeamId: string | null;
  evidenceLinkIds: string[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface JourneyPainPoint extends JourneyPortfolioItemBase {
  kind: 'pain_point';
  lifecycle: JourneyInsightLifecycle;
  severity: 1 | 2 | 3 | 4 | 5;
  frequency: 'rare' | 'occasional' | 'frequent' | 'pervasive' | 'unknown';
}

export interface JourneyOpportunity extends JourneyPortfolioItemBase {
  kind: 'opportunity';
  lifecycle: JourneyInsightLifecycle;
  desiredOutcome: string;
}

export interface JourneySolution extends JourneyPortfolioItemBase {
  kind: 'solution';
  lifecycle: JourneyInsightLifecycle;
  hypothesis: string;
  constraints: string[];
  estimatedEffort: number | null;
  estimatedCost: number | null;
  risk: 'low' | 'medium' | 'high' | 'unknown';
}

export interface JourneyInitiativeMetricTarget {
  metricId: string;
  metricDefinitionVersion: string;
  direction: 'higher_is_better' | 'lower_is_better';
  targetValue: number;
  unit: string;
}

export interface JourneyInitiative extends JourneyPortfolioItemBase {
  kind: 'initiative';
  lifecycle: JourneyInitiativeLifecycle;
  priority: 'low' | 'medium' | 'high' | 'critical';
  risk: 'low' | 'medium' | 'high' | 'unknown';
  expectedOutcome: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  reviewCadenceDays: number | null;
  targetMetrics: JourneyInitiativeMetricTarget[];
}

export type JourneyPortfolioItem = JourneyPainPoint | JourneyOpportunity | JourneySolution | JourneyInitiative;

export type JourneyPortfolioRelationship =
  | {
      id: string;
      spaceId: string;
      type: 'pain_point_to_opportunity';
      fromKind: 'pain_point';
      fromId: string;
      toKind: 'opportunity';
      toId: string;
      createdAt: string;
    }
  | {
      id: string;
      spaceId: string;
      type: 'opportunity_to_solution';
      fromKind: 'opportunity';
      fromId: string;
      toKind: 'solution';
      toId: string;
      createdAt: string;
    }
  | {
      id: string;
      spaceId: string;
      type: 'solution_to_initiative';
      fromKind: 'solution';
      fromId: string;
      toKind: 'initiative';
      toId: string;
      createdAt: string;
    };

export type JourneyPortfolioJourneyTarget = 'journey' | 'stage' | 'touchpoint' | 'persona';
export type JourneyPortfolioJourneyRelationship = 'occurs_at' | 'affects' | 'improves' | 'changes' | 'delivers';

export interface JourneyPortfolioItemSnapshot {
  kind: JourneyPortfolioItemKind;
  itemId: string;
  itemRevision: number;
  title: string;
  description: string;
  lifecycle: JourneyInsightLifecycle | JourneyInitiativeLifecycle;
}

export interface JourneyPortfolioJourneyLink {
  id: string;
  spaceId: string;
  itemKind: JourneyPortfolioItemKind;
  itemId: string;
  canonicalItemRevision: number;
  journeyId: string;
  journeyVersion: string | null;
  targetType: JourneyPortfolioJourneyTarget;
  targetId: string;
  relationship: JourneyPortfolioJourneyRelationship;
  validFrom: string | null;
  validUntil: string | null;
  itemSnapshot: JourneyPortfolioItemSnapshot | null;
  createdAt: string;
}

export interface JourneyInitiativeDependency {
  id: string;
  spaceId: string;
  initiativeId: string;
  dependsOnInitiativeId: string;
  type: 'finish_to_start' | 'blocks';
  createdAt: string;
}

export interface JourneyPortfolioDomainIssue {
  code: string;
  path: string;
  message: string;
}

export interface JourneyInitiativeDependencyAnalysis {
  valid: boolean;
  topologicalOrder: string[];
  cycles: string[][];
}

export interface JourneyPortfolioGraphValidation {
  domainVersion: typeof JOURNEY_PORTFOLIO_DOMAIN_VERSION;
  valid: boolean;
  issues: JourneyPortfolioDomainIssue[];
  dependencies: JourneyInitiativeDependencyAnalysis;
  usageByItem: Array<{
    itemKind: JourneyPortfolioItemKind;
    itemId: string;
    journeyIds: string[];
    linkCount: number;
  }>;
}

export interface JourneyPortfolioGraph {
  items: JourneyPortfolioItem[];
  relationships: JourneyPortfolioRelationship[];
  journeyLinks: JourneyPortfolioJourneyLink[];
  dependencies: JourneyInitiativeDependency[];
}

export interface JourneyPortfolioLifecycleContext {
  relationships: JourneyPortfolioRelationship[];
  dependencies: JourneyInitiativeDependency[];
  initiatives: JourneyInitiative[];
  outcomeComparisonIds: string[];
}

export interface JourneyPortfolioLifecycleValidation {
  valid: boolean;
  itemKind: JourneyPortfolioItemKind;
  itemId: string;
  from: JourneyInsightLifecycle | JourneyInitiativeLifecycle;
  to: JourneyInsightLifecycle | JourneyInitiativeLifecycle;
  issues: JourneyPortfolioDomainIssue[];
}

export interface JourneyPortfolioPriorityAssessment {
  domainVersion: typeof JOURNEY_PORTFOLIO_DOMAIN_VERSION;
  assessmentId: string;
  itemKind: 'opportunity' | 'initiative';
  itemId: string;
  itemRevision: number;
  policyVersion: string;
  assessedAt: string;
  score: JourneyScoreResult;
}

export interface JourneyMetricObservationSnapshot {
  observationId: string;
  metricId: string;
  metricDefinitionVersion: string;
  calculationVersion: string;
  value: number;
  unit: string;
  numerator: number | null;
  denominator: number;
  sampleSize: number;
  period: { start: string; end: string; timezone: string };
  populationKey: string;
  filterKey: string;
  sourceRefs: string[];
}

export interface JourneyInitiativeBaseline {
  baselineVersion: 'journey-initiative-baseline/v1';
  baselineId: string;
  initiativeId: string;
  initiativeRevision: number;
  capturedAt: string;
  capturedByUserId: string;
  target: JourneyInitiativeMetricTarget;
  observation: JourneyMetricObservationSnapshot;
  checksum: string;
}

export interface JourneyInitiativeOutcomeComparison {
  outcomeVersion: typeof JOURNEY_INITIATIVE_OUTCOME_VERSION;
  comparisonId: string;
  initiativeId: string;
  baselineId: string;
  baselineChecksum: string;
  before: JourneyMetricObservationSnapshot;
  after: JourneyMetricObservationSnapshot;
  absoluteChange: number;
  relativeChangePercentage: number | null;
  directionalResult: 'improved' | 'unchanged' | 'deteriorated';
  targetResult: 'met' | 'not_met';
  comparedAt: string;
  interpretation: {
    mode: 'descriptive_before_after';
    statement: string;
  };
}

export class JourneyPortfolioDomainError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'JourneyPortfolioDomainError';
  }
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const INSIGHT_TRANSITIONS: Record<JourneyInsightLifecycle, JourneyInsightLifecycle[]> = {
  draft: ['validated', 'archived'],
  validated: ['draft', 'approved', 'archived'],
  approved: ['validated', 'archived'],
  archived: []
};
const INITIATIVE_TRANSITIONS: Record<JourneyInitiativeLifecycle, JourneyInitiativeLifecycle[]> = {
  draft: ['planned', 'cancelled'],
  planned: ['draft', 'active', 'cancelled'],
  active: ['blocked', 'completed', 'cancelled'],
  blocked: ['active', 'cancelled'],
  completed: ['archived'],
  cancelled: ['archived'],
  archived: []
};
const RELATIONSHIP_BY_ITEM: Record<JourneyPortfolioItemKind, JourneyPortfolioJourneyRelationship[]> = {
  pain_point: ['occurs_at', 'affects'],
  opportunity: ['improves'],
  solution: ['changes'],
  initiative: ['delivers']
};

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseInstant(value: string) {
  if (typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDate(value: string | null) {
  if (value === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

function itemKey(kind: JourneyPortfolioItemKind, id: string) {
  return `${kind}:${id}`;
}

function issue(code: string, path: string, message: string): JourneyPortfolioDomainIssue {
  return { code, path, message };
}

function sortIssues(issues: JourneyPortfolioDomainIssue[]) {
  return issues.sort((left, right) => compareText(left.path, right.path)
    || compareText(left.code, right.code)
    || compareText(left.message, right.message));
}

function isNonEmpty(value: string) {
  return typeof value === 'string' && Boolean(value.trim());
}

function validateItem(item: JourneyPortfolioItem, path: string) {
  const issues: JourneyPortfolioDomainIssue[] = [];
  if (!ID_PATTERN.test(item.id)) issues.push(issue('ITEM_ID_INVALID', `${path}.id`, 'Item ID must be a stable identifier.'));
  if (!ID_PATTERN.test(item.spaceId)) issues.push(issue('SPACE_ID_INVALID', `${path}.spaceId`, 'Space ID must be a stable identifier.'));
  if (!Number.isInteger(item.revision) || item.revision < 1) issues.push(issue('ITEM_REVISION_INVALID', `${path}.revision`, 'Revision must be a positive integer.'));
  if (!isNonEmpty(item.title)) issues.push(issue('ITEM_TITLE_REQUIRED', `${path}.title`, 'Title is required.'));
  if (!isNonEmpty(item.description)) issues.push(issue('ITEM_DESCRIPTION_REQUIRED', `${path}.description`, 'Description is required.'));
  if ((item.ownerUserId !== null && !ID_PATTERN.test(item.ownerUserId))
    || (item.ownerTeamId !== null && !ID_PATTERN.test(item.ownerTeamId))) {
    issues.push(issue('ITEM_OWNER_INVALID', `${path}.owner`, 'Owner IDs must be null or stable identifiers.'));
  }
  const createdAt = parseInstant(item.createdAt);
  const updatedAt = parseInstant(item.updatedAt);
  if (createdAt === null || updatedAt === null || createdAt > updatedAt) {
    issues.push(issue('ITEM_TIME_INVALID', `${path}.updatedAt`, 'Created and updated times must be valid and monotonic.'));
  }
  if (!Array.isArray(item.evidenceLinkIds) || item.evidenceLinkIds.some((id) => !ID_PATTERN.test(id))) {
    issues.push(issue('ITEM_EVIDENCE_INVALID', `${path}.evidenceLinkIds`, 'Evidence link IDs must be stable identifiers.'));
  }
  if (item.kind === 'opportunity' && !isNonEmpty(item.desiredOutcome)) {
    issues.push(issue('OPPORTUNITY_OUTCOME_REQUIRED', `${path}.desiredOutcome`, 'An opportunity needs a desired outcome.'));
  }
  if (item.kind === 'solution') {
    if (!isNonEmpty(item.hypothesis)) issues.push(issue('SOLUTION_HYPOTHESIS_REQUIRED', `${path}.hypothesis`, 'A solution needs a falsifiable hypothesis.'));
    if (item.estimatedEffort !== null && (!Number.isFinite(item.estimatedEffort) || item.estimatedEffort < 0)) {
      issues.push(issue('SOLUTION_EFFORT_INVALID', `${path}.estimatedEffort`, 'Estimated effort must be null or non-negative.'));
    }
    if (item.estimatedCost !== null && (!Number.isFinite(item.estimatedCost) || item.estimatedCost < 0)) {
      issues.push(issue('SOLUTION_COST_INVALID', `${path}.estimatedCost`, 'Estimated cost must be null or non-negative.'));
    }
  }
  if (item.kind === 'initiative') {
    if (!isNonEmpty(item.expectedOutcome)) issues.push(issue('INITIATIVE_OUTCOME_REQUIRED', `${path}.expectedOutcome`, 'An initiative needs an expected outcome.'));
    const plannedStart = parseDate(item.plannedStart);
    const plannedEnd = parseDate(item.plannedEnd);
    const actualStart = parseDate(item.actualStart);
    const actualEnd = parseDate(item.actualEnd);
    if ((item.plannedStart !== null && plannedStart === null) || (item.plannedEnd !== null && plannedEnd === null)
      || (plannedStart !== null && plannedEnd !== null && plannedStart > plannedEnd)) {
      issues.push(issue('INITIATIVE_PLANNED_DATES_INVALID', `${path}.plannedEnd`, 'Planned dates must be valid and ordered.'));
    }
    if ((item.actualStart !== null && actualStart === null) || (item.actualEnd !== null && actualEnd === null)
      || (actualStart !== null && actualEnd !== null && actualStart > actualEnd)) {
      issues.push(issue('INITIATIVE_ACTUAL_DATES_INVALID', `${path}.actualEnd`, 'Actual dates must be valid and ordered.'));
    }
    if (item.reviewCadenceDays !== null && (!Number.isInteger(item.reviewCadenceDays) || item.reviewCadenceDays < 1)) {
      issues.push(issue('INITIATIVE_CADENCE_INVALID', `${path}.reviewCadenceDays`, 'Review cadence must be null or a positive whole number of days.'));
    }
    for (const [index, target] of item.targetMetrics.entries()) {
      if (!ID_PATTERN.test(target.metricId) || !isNonEmpty(target.metricDefinitionVersion)
        || !isNonEmpty(target.unit) || !Number.isFinite(target.targetValue)
        || !['higher_is_better', 'lower_is_better'].includes(target.direction)) {
        issues.push(issue('INITIATIVE_TARGET_INVALID', `${path}.targetMetrics[${index}]`, 'Metric targets require stable IDs, exact versions, units, and finite values.'));
      }
    }
    const targetKeys = item.targetMetrics.map((target) => `${target.metricId}\u0000${target.metricDefinitionVersion}`);
    if (new Set(targetKeys).size !== targetKeys.length) {
      issues.push(issue('INITIATIVE_TARGET_DUPLICATE', `${path}.targetMetrics`, 'An initiative cannot repeat the same metric definition target.'));
    }
  }
  return issues;
}

function validateStateReadiness(
  item: JourneyPortfolioItem,
  state: JourneyInsightLifecycle | JourneyInitiativeLifecycle,
  context: JourneyPortfolioLifecycleContext,
  path: string
) {
  const issues: JourneyPortfolioDomainIssue[] = [];
  if (item.kind !== 'initiative') {
    if ((state === 'validated' || state === 'approved') && item.kind === 'pain_point' && item.evidenceLinkIds.length === 0) {
      issues.push(issue('PAIN_POINT_EVIDENCE_REQUIRED', path, 'A pain point must cite evidence before validation.'));
    }
    if ((state === 'validated' || state === 'approved') && item.kind === 'opportunity'
      && !context.relationships.some((link) => link.type === 'pain_point_to_opportunity' && link.toId === item.id)) {
      issues.push(issue('OPPORTUNITY_PAIN_POINT_REQUIRED', path, 'An opportunity must link to a pain point before validation.'));
    }
    if ((state === 'validated' || state === 'approved') && item.kind === 'solution'
      && !context.relationships.some((link) => link.type === 'opportunity_to_solution' && link.toId === item.id)) {
      issues.push(issue('SOLUTION_OPPORTUNITY_REQUIRED', path, 'A solution must link to an opportunity before validation.'));
    }
    if (state === 'approved' && !item.ownerUserId && !item.ownerTeamId) {
      issues.push(issue('ITEM_OWNER_REQUIRED', path, 'Approved items require a user or team owner.'));
    }
    return issues;
  }
  if (['planned', 'active', 'blocked', 'completed'].includes(state)) {
    if (!item.ownerUserId && !item.ownerTeamId) issues.push(issue('INITIATIVE_OWNER_REQUIRED', path, 'A planned initiative requires an owner.'));
    if (!item.plannedStart || !item.plannedEnd) issues.push(issue('INITIATIVE_PLAN_REQUIRED', path, 'A planned initiative requires start and end dates.'));
    if (!item.reviewCadenceDays) issues.push(issue('INITIATIVE_CADENCE_REQUIRED', path, 'A planned initiative requires a review cadence.'));
    if (!item.targetMetrics.length) issues.push(issue('INITIATIVE_TARGET_REQUIRED', path, 'A planned initiative requires at least one target metric.'));
    if (!context.relationships.some((link) => link.type === 'solution_to_initiative' && link.toId === item.id)) {
      issues.push(issue('INITIATIVE_SOLUTION_REQUIRED', path, 'A planned initiative must implement a solution.'));
    }
  }
  if (state === 'active' || state === 'completed') {
    if (!item.actualStart) issues.push(issue('INITIATIVE_START_REQUIRED', path, 'An active initiative requires an actual start date.'));
    const initiativeById = new Map(context.initiatives.map((initiative) => [initiative.id, initiative]));
    for (const dependency of context.dependencies.filter((candidate) => candidate.initiativeId === item.id)) {
      if (initiativeById.get(dependency.dependsOnInitiativeId)?.lifecycle !== 'completed') {
        issues.push(issue('INITIATIVE_DEPENDENCY_INCOMPLETE', `${path}.dependencies`, `Dependency ${dependency.dependsOnInitiativeId} is not completed.`));
      }
    }
  }
  if (state === 'completed') {
    if (!item.actualEnd) issues.push(issue('INITIATIVE_END_REQUIRED', path, 'A completed initiative requires an actual end date.'));
    if (!context.outcomeComparisonIds.length) issues.push(issue('INITIATIVE_OUTCOME_COMPARISON_REQUIRED', path, 'A completed initiative requires a recorded before/after comparison.'));
  }
  return issues;
}

export function analyseJourneyInitiativeDependencies(
  initiatives: JourneyInitiative[],
  dependencies: JourneyInitiativeDependency[]
): JourneyInitiativeDependencyAnalysis {
  const ids = [...new Set(initiatives.map((initiative) => initiative.id))].sort(compareText);
  const idSet = new Set(ids);
  const outgoing = new Map(ids.map((id) => [id, new Set<string>()]));
  const indegree = new Map(ids.map((id) => [id, 0]));
  for (const dependency of [...dependencies].sort((left, right) => compareText(left.id, right.id))) {
    if (!idSet.has(dependency.initiativeId) || !idSet.has(dependency.dependsOnInitiativeId)
      || dependency.initiativeId === dependency.dependsOnInitiativeId) continue;
    const prerequisites = outgoing.get(dependency.dependsOnInitiativeId) as Set<string>;
    if (prerequisites.has(dependency.initiativeId)) continue;
    prerequisites.add(dependency.initiativeId);
    indegree.set(dependency.initiativeId, (indegree.get(dependency.initiativeId) || 0) + 1);
  }
  const queue = ids.filter((id) => indegree.get(id) === 0);
  const topologicalOrder: string[] = [];
  while (queue.length) {
    queue.sort(compareText);
    const current = queue.shift() as string;
    topologicalOrder.push(current);
    for (const dependent of [...(outgoing.get(current) || [])].sort(compareText)) {
      const next = (indegree.get(dependent) || 0) - 1;
      indegree.set(dependent, next);
      if (next === 0) queue.push(dependent);
    }
  }

  const cycles: string[][] = [];
  const state = new Map<string, 'visiting' | 'visited'>();
  const stack: string[] = [];
  const seenCycles = new Set<string>();
  const canonicalCycle = (cycle: string[]) => {
    const body = cycle.slice(0, -1);
    const rotations = body.map((_, index) => [...body.slice(index), ...body.slice(0, index)]);
    rotations.sort((left, right) => compareText(JSON.stringify(left), JSON.stringify(right)));
    return [...rotations[0], rotations[0][0]];
  };
  const visit = (id: string) => {
    state.set(id, 'visiting');
    stack.push(id);
    for (const dependent of [...(outgoing.get(id) || [])].sort(compareText)) {
      if (state.get(dependent) === 'visiting') {
        const start = stack.indexOf(dependent);
        const cycle = canonicalCycle([...stack.slice(start), dependent]);
        const key = JSON.stringify(cycle);
        if (!seenCycles.has(key)) {
          seenCycles.add(key);
          cycles.push(cycle);
        }
      } else if (!state.has(dependent)) visit(dependent);
    }
    stack.pop();
    state.set(id, 'visited');
  };
  ids.forEach((id) => { if (!state.has(id)) visit(id); });
  cycles.sort((left, right) => compareText(JSON.stringify(left), JSON.stringify(right)));
  return { valid: cycles.length === 0 && topologicalOrder.length === ids.length, topologicalOrder, cycles };
}

export function validateJourneyPortfolioGraph(graph: JourneyPortfolioGraph): JourneyPortfolioGraphValidation {
  const issues: JourneyPortfolioDomainIssue[] = [];
  const items = new Map<string, JourneyPortfolioItem>();
  for (const item of [...graph.items].sort((left, right) => compareText(itemKey(left.kind, left.id), itemKey(right.kind, right.id)))) {
    const path = `items[${itemKey(item.kind, item.id)}]`;
    issues.push(...validateItem(item, path));
    const key = itemKey(item.kind, item.id);
    if (items.has(key)) issues.push(issue('ITEM_DUPLICATE', path, `Duplicate portfolio item ${key}.`));
    else items.set(key, item);
  }

  const relationshipIds = new Set<string>();
  for (const relationship of [...graph.relationships].sort((left, right) => compareText(left.id, right.id))) {
    const path = `relationships[${relationship.id}]`;
    if (relationshipIds.has(relationship.id)) issues.push(issue('RELATIONSHIP_DUPLICATE', path, `Duplicate relationship ${relationship.id}.`));
    relationshipIds.add(relationship.id);
    const from = items.get(itemKey(relationship.fromKind, relationship.fromId));
    const to = items.get(itemKey(relationship.toKind, relationship.toId));
    if (!from || !to) issues.push(issue('RELATIONSHIP_ENDPOINT_MISSING', path, 'Both typed relationship endpoints must exist.'));
    else if (from.spaceId !== relationship.spaceId || to.spaceId !== relationship.spaceId) {
      issues.push(issue('RELATIONSHIP_SPACE_MISMATCH', path, 'Relationship endpoints must belong to the same space.'));
    }
  }

  const journeyLinkIds = new Set<string>();
  for (const link of [...graph.journeyLinks].sort((left, right) => compareText(left.id, right.id))) {
    const path = `journeyLinks[${link.id}]`;
    if (journeyLinkIds.has(link.id)) issues.push(issue('JOURNEY_LINK_DUPLICATE', path, `Duplicate journey link ${link.id}.`));
    journeyLinkIds.add(link.id);
    const item = items.get(itemKey(link.itemKind, link.itemId));
    if (!item) issues.push(issue('JOURNEY_LINK_ITEM_MISSING', path, 'The linked portfolio item does not exist.'));
    else {
      if (item.spaceId !== link.spaceId) issues.push(issue('JOURNEY_LINK_SPACE_MISMATCH', path, 'Journey link and item must belong to the same space.'));
      if (!Number.isInteger(link.canonicalItemRevision) || link.canonicalItemRevision < 1
        || (link.journeyVersion === null && item.revision !== link.canonicalItemRevision)
        || (link.journeyVersion !== null && link.canonicalItemRevision > item.revision)) {
        issues.push(issue('JOURNEY_LINK_REVISION_MISMATCH', path, 'Working links require the current item revision; published links may pin an existing earlier revision.'));
      }
      if (!RELATIONSHIP_BY_ITEM[item.kind].includes(link.relationship)) {
        issues.push(issue('JOURNEY_LINK_RELATIONSHIP_INVALID', path, `${link.relationship} is not valid for ${item.kind}.`));
      }
    }
    if (!ID_PATTERN.test(link.journeyId) || !ID_PATTERN.test(link.targetId)) {
      issues.push(issue('JOURNEY_LINK_TARGET_INVALID', path, 'Journey and target IDs must be stable identifiers.'));
    }
    if (link.targetType === 'journey' && link.targetId !== link.journeyId) {
      issues.push(issue('JOURNEY_LINK_TARGET_INVALID', path, 'A journey-level target ID must equal journeyId.'));
    }
    if (link.journeyVersion === null && link.itemSnapshot !== null) {
      issues.push(issue('WORKING_LINK_SNAPSHOT_FORBIDDEN', path, 'Working journey links resolve the current canonical item and must not embed a snapshot.'));
    }
    if (link.journeyVersion !== null) {
      if (!isNonEmpty(link.journeyVersion) || !link.itemSnapshot) {
        issues.push(issue('PUBLISHED_LINK_SNAPSHOT_REQUIRED', path, 'Published journey links require an exact journey version and item snapshot.'));
      } else if (link.itemSnapshot.itemId !== link.itemId || link.itemSnapshot.kind !== link.itemKind
        || link.itemSnapshot.itemRevision !== link.canonicalItemRevision
        || !isNonEmpty(link.itemSnapshot.title) || !isNonEmpty(link.itemSnapshot.description)
        || !isNonEmpty(link.itemSnapshot.lifecycle)) {
        issues.push(issue('PUBLISHED_LINK_SNAPSHOT_MISMATCH', path, 'Published snapshot identity and revision must match the link.'));
      }
    }
    const validFrom = link.validFrom === null ? null : parseInstant(link.validFrom);
    const validUntil = link.validUntil === null ? null : parseInstant(link.validUntil);
    if ((link.validFrom !== null && validFrom === null) || (link.validUntil !== null && validUntil === null)
      || (validFrom !== null && validUntil !== null && validFrom >= validUntil)) {
      issues.push(issue('JOURNEY_LINK_WINDOW_INVALID', path, 'Applicability instants must be valid and ordered.'));
    }
  }

  const initiatives = graph.items.filter((item): item is JourneyInitiative => item.kind === 'initiative');
  const initiativeById = new Map(initiatives.map((initiative) => [initiative.id, initiative]));
  const dependencyIds = new Set<string>();
  const dependencyPairs = new Set<string>();
  for (const dependency of [...graph.dependencies].sort((left, right) => compareText(left.id, right.id))) {
    const path = `dependencies[${dependency.id}]`;
    if (dependencyIds.has(dependency.id)) issues.push(issue('DEPENDENCY_DUPLICATE', path, `Duplicate dependency ${dependency.id}.`));
    dependencyIds.add(dependency.id);
    if (!initiativeById.has(dependency.initiativeId) || !initiativeById.has(dependency.dependsOnInitiativeId)) {
      issues.push(issue('DEPENDENCY_ENDPOINT_MISSING', path, 'Both dependency endpoints must be initiatives.'));
    } else if (initiativeById.get(dependency.initiativeId)?.spaceId !== dependency.spaceId
      || initiativeById.get(dependency.dependsOnInitiativeId)?.spaceId !== dependency.spaceId) {
      issues.push(issue('DEPENDENCY_SPACE_MISMATCH', path, 'Dependencies cannot cross spaces.'));
    }
    if (dependency.initiativeId === dependency.dependsOnInitiativeId) {
      issues.push(issue('DEPENDENCY_SELF_REFERENCE', path, 'An initiative cannot depend on itself.'));
    }
    const pair = `${dependency.initiativeId}\u0000${dependency.dependsOnInitiativeId}`;
    if (dependencyPairs.has(pair)) issues.push(issue('DEPENDENCY_PAIR_DUPLICATE', path, 'The directed dependency already exists.'));
    dependencyPairs.add(pair);
  }
  const dependencies = analyseJourneyInitiativeDependencies(initiatives, graph.dependencies);
  dependencies.cycles.forEach((cycle, index) => {
    issues.push(issue('DEPENDENCY_CYCLE', `dependencyCycles[${index}]`, `Initiative dependency cycle: ${cycle.join(' -> ')}.`));
  });

  const usage = new Map<string, { itemKind: JourneyPortfolioItemKind; itemId: string; journeyIds: Set<string>; linkCount: number }>();
  for (const link of graph.journeyLinks) {
    const key = itemKey(link.itemKind, link.itemId);
    const row = usage.get(key) || { itemKind: link.itemKind, itemId: link.itemId, journeyIds: new Set<string>(), linkCount: 0 };
    row.journeyIds.add(link.journeyId);
    row.linkCount += 1;
    usage.set(key, row);
  }
  const usageByItem = [...usage.values()].sort((left, right) => compareText(itemKey(left.itemKind, left.itemId), itemKey(right.itemKind, right.itemId)))
    .map((row) => ({ ...row, journeyIds: [...row.journeyIds].sort(compareText) }));
  return {
    domainVersion: JOURNEY_PORTFOLIO_DOMAIN_VERSION,
    valid: issues.length === 0,
    issues: sortIssues(issues),
    dependencies,
    usageByItem
  };
}

export function validateJourneyPortfolioLifecycleTransition(
  item: JourneyPortfolioItem,
  to: JourneyInsightLifecycle | JourneyInitiativeLifecycle,
  context: JourneyPortfolioLifecycleContext
): JourneyPortfolioLifecycleValidation {
  const issues: JourneyPortfolioDomainIssue[] = [];
  const allowed = item.kind === 'initiative'
    ? INITIATIVE_TRANSITIONS[item.lifecycle].includes(to as JourneyInitiativeLifecycle)
    : INSIGHT_TRANSITIONS[item.lifecycle].includes(to as JourneyInsightLifecycle);
  if (!allowed) issues.push(issue('LIFECYCLE_TRANSITION_INVALID', 'lifecycle', `${item.kind} cannot transition from ${item.lifecycle} to ${to}.`));
  issues.push(...validateStateReadiness(item, to, context, 'lifecycle'));
  return {
    valid: issues.length === 0,
    itemKind: item.kind,
    itemId: item.id,
    from: item.lifecycle,
    to,
    issues: sortIssues(issues)
  };
}

export function assessJourneyPortfolioPriority(
  item: JourneyOpportunity | JourneyInitiative,
  assessment: {
    assessmentId: string;
    policyVersion: string;
    assessedAt: string;
    method: JourneyScoreMethod;
    input: JourneyScoreInput;
    weightedDimensions?: readonly JourneyWeightedScoreDimension[];
  }
): JourneyPortfolioPriorityAssessment {
  if (!ID_PATTERN.test(assessment.assessmentId) || !isNonEmpty(assessment.policyVersion) || parseInstant(assessment.assessedAt) === null) {
    throw new JourneyPortfolioDomainError('PORTFOLIO_ASSESSMENT_INVALID', 'Assessment ID, policy version, and assessed time are required.');
  }
  return {
    domainVersion: JOURNEY_PORTFOLIO_DOMAIN_VERSION,
    assessmentId: assessment.assessmentId,
    itemKind: item.kind,
    itemId: item.id,
    itemRevision: item.revision,
    policyVersion: assessment.policyVersion,
    assessedAt: assessment.assessedAt,
    score: calculateJourneyPortfolioScore(assessment.method, assessment.input, assessment.weightedDimensions)
  };
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, entry]) => [key, stableValue(entry)]));
  }
  return value;
}

function checksum(value: unknown) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach((entry) => deepFreeze(entry));
  }
  return value;
}

function canonicalObservation(observation: JourneyMetricObservationSnapshot): JourneyMetricObservationSnapshot {
  if (!ID_PATTERN.test(observation.observationId) || !ID_PATTERN.test(observation.metricId)
    || !isNonEmpty(observation.metricDefinitionVersion) || !isNonEmpty(observation.calculationVersion)
    || !isNonEmpty(observation.unit) || !Number.isFinite(observation.value)
    || (observation.numerator !== null && !Number.isFinite(observation.numerator))
    || !Number.isInteger(observation.denominator) || observation.denominator < 0
    || !Number.isInteger(observation.sampleSize) || observation.sampleSize < 0
    || !isNonEmpty(observation.populationKey) || !isNonEmpty(observation.filterKey)
    || observation.sourceRefs.length === 0 || observation.sourceRefs.some((sourceRef) => !isNonEmpty(sourceRef))) {
    throw new JourneyPortfolioDomainError('METRIC_OBSERVATION_INVALID', 'Metric observation lineage and sample fields are invalid.');
  }
  const start = parseInstant(observation.period.start);
  const end = parseInstant(observation.period.end);
  if (start === null || end === null || start >= end || !isNonEmpty(observation.period.timezone)) {
    throw new JourneyPortfolioDomainError('METRIC_OBSERVATION_PERIOD_INVALID', 'Metric observation period must be valid and ordered.');
  }
  return {
    ...observation,
    period: { ...observation.period },
    sourceRefs: [...new Set(observation.sourceRefs)].sort(compareText)
  };
}

function baselinePayload(baseline: Omit<JourneyInitiativeBaseline, 'checksum'>) {
  return baseline;
}

export function createJourneyInitiativeBaseline(input: Omit<JourneyInitiativeBaseline, 'baselineVersion' | 'checksum'>): Readonly<JourneyInitiativeBaseline> {
  if (!ID_PATTERN.test(input.baselineId) || !ID_PATTERN.test(input.initiativeId)
    || !Number.isInteger(input.initiativeRevision) || input.initiativeRevision < 1
    || parseInstant(input.capturedAt) === null || !ID_PATTERN.test(input.capturedByUserId)) {
    throw new JourneyPortfolioDomainError('INITIATIVE_BASELINE_INVALID', 'Baseline identity, initiative revision, capture time, and author are required.');
  }
  const observation = canonicalObservation(input.observation);
  if (input.target.metricId !== observation.metricId
    || input.target.metricDefinitionVersion !== observation.metricDefinitionVersion
    || input.target.unit !== observation.unit || !Number.isFinite(input.target.targetValue)
    || !['higher_is_better', 'lower_is_better'].includes(input.target.direction)) {
    throw new JourneyPortfolioDomainError('INITIATIVE_BASELINE_TARGET_MISMATCH', 'Target and baseline observation must use the same exact metric definition and unit.');
  }
  const withoutChecksum: Omit<JourneyInitiativeBaseline, 'checksum'> = {
    baselineVersion: 'journey-initiative-baseline/v1',
    ...input,
    target: { ...input.target },
    observation
  };
  if ((parseInstant(input.capturedAt) as number) < (parseInstant(observation.period.end) as number)) {
    throw new JourneyPortfolioDomainError('INITIATIVE_BASELINE_CAPTURE_INVALID', 'Baseline must be captured at or after the observation period ends.');
  }
  return deepFreeze({ ...withoutChecksum, checksum: checksum(baselinePayload(withoutChecksum)) });
}

export function verifyJourneyInitiativeBaseline(baseline: JourneyInitiativeBaseline) {
  const { checksum: supplied, ...payload } = baseline;
  if (checksum(baselinePayload(payload)) !== supplied) {
    throw new JourneyPortfolioDomainError('INITIATIVE_BASELINE_TAMPERED', 'Baseline checksum does not match its immutable payload.');
  }
  return true;
}

function round(value: number, places = 2) {
  const factor = 10 ** places;
  const rounded = Math.round((value + Number.EPSILON) * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function compareJourneyInitiativeOutcome(input: {
  comparisonId: string;
  baseline: JourneyInitiativeBaseline;
  after: JourneyMetricObservationSnapshot;
  comparedAt: string;
}): Readonly<JourneyInitiativeOutcomeComparison> {
  if (!ID_PATTERN.test(input.comparisonId) || parseInstant(input.comparedAt) === null) {
    throw new JourneyPortfolioDomainError('INITIATIVE_COMPARISON_INVALID', 'Comparison ID and compared time are required.');
  }
  verifyJourneyInitiativeBaseline(input.baseline);
  const before = canonicalObservation(input.baseline.observation);
  const after = canonicalObservation(input.after);
  const sameSources = JSON.stringify(before.sourceRefs) === JSON.stringify(after.sourceRefs);
  const beforeDuration = (parseInstant(before.period.end) as number) - (parseInstant(before.period.start) as number);
  const afterDuration = (parseInstant(after.period.end) as number) - (parseInstant(after.period.start) as number);
  if (before.metricId !== after.metricId
    || before.metricDefinitionVersion !== after.metricDefinitionVersion
    || before.calculationVersion !== after.calculationVersion
    || before.unit !== after.unit
    || before.populationKey !== after.populationKey
    || before.filterKey !== after.filterKey
    || before.period.timezone !== after.period.timezone
    || beforeDuration !== afterDuration
    || !sameSources) {
    throw new JourneyPortfolioDomainError('INITIATIVE_OBSERVATIONS_NOT_COMPARABLE', 'Before and after observations must retain metric, calculation, population, filter, source, timezone, and window-length lineage.');
  }
  if ((parseInstant(after.period.start) as number) < (parseInstant(before.period.end) as number)) {
    throw new JourneyPortfolioDomainError('INITIATIVE_PERIODS_OVERLAP', 'After period must not overlap the immutable baseline period.');
  }
  if ((parseInstant(input.comparedAt) as number) < (parseInstant(after.period.end) as number)) {
    throw new JourneyPortfolioDomainError('INITIATIVE_COMPARISON_TIME_INVALID', 'Comparison time must be at or after the after period ends.');
  }
  const absoluteChange = round(after.value - before.value, 6);
  const relativeChangePercentage = before.value === 0 ? null : round((absoluteChange / Math.abs(before.value)) * 100, 2);
  const direction = input.baseline.target.direction;
  const directionalResult = absoluteChange === 0 ? 'unchanged' as const
    : (direction === 'higher_is_better' ? absoluteChange > 0 : absoluteChange < 0) ? 'improved' as const : 'deteriorated' as const;
  const targetResult = (direction === 'higher_is_better'
    ? after.value >= input.baseline.target.targetValue
    : after.value <= input.baseline.target.targetValue) ? 'met' as const : 'not_met' as const;
  return deepFreeze({
    outcomeVersion: JOURNEY_INITIATIVE_OUTCOME_VERSION,
    comparisonId: input.comparisonId,
    initiativeId: input.baseline.initiativeId,
    baselineId: input.baseline.baselineId,
    baselineChecksum: input.baseline.checksum,
    before,
    after,
    absoluteChange,
    relativeChangePercentage,
    directionalResult,
    targetResult,
    comparedAt: input.comparedAt,
    interpretation: {
      mode: 'descriptive_before_after',
      statement: `The observed metric changed from ${before.value} to ${after.value} ${after.unit} for comparable periods. This descriptive before/after result does not establish that initiative ${input.baseline.initiativeId} caused the change or that it is statistically significant.`
    }
  });
}
