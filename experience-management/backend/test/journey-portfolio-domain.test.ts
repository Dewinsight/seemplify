import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyseJourneyInitiativeDependencies,
  assessJourneyPortfolioPriority,
  compareJourneyInitiativeOutcome,
  createJourneyInitiativeBaseline,
  validateJourneyPortfolioGraph,
  validateJourneyPortfolioLifecycleTransition,
  verifyJourneyInitiativeBaseline,
  JourneyPortfolioDomainError,
  type JourneyInitiative,
  type JourneyMetricObservationSnapshot,
  type JourneyOpportunity,
  type JourneyPainPoint,
  type JourneyPortfolioGraph,
  type JourneyPortfolioItem,
  type JourneyPortfolioLifecycleContext,
  type JourneyPortfolioRelationship,
  type JourneySolution
} from '../src/journeyPortfolioDomain.js';

const createdAt = '2026-07-01T00:00:00.000Z';
const updatedAt = '2026-08-01T00:00:00.000Z';

const base = (id: string) => ({
  id,
  spaceId: 'space-one',
  revision: 1,
  title: id,
  description: `${id} description`,
  ownerUserId: 'owner-one',
  ownerTeamId: null,
  evidenceLinkIds: ['evidence-one'],
  tags: ['checkout'],
  createdAt,
  updatedAt
});

function pain(overrides: Partial<JourneyPainPoint> = {}): JourneyPainPoint {
  return {
    ...base('pain-one'),
    kind: 'pain_point',
    lifecycle: 'approved',
    severity: 4,
    frequency: 'frequent',
    ...overrides
  };
}

function opportunity(overrides: Partial<JourneyOpportunity> = {}): JourneyOpportunity {
  return {
    ...base('opportunity-one'),
    kind: 'opportunity',
    lifecycle: 'approved',
    desiredOutcome: 'Reduce avoidable checkout abandonment.',
    ...overrides
  };
}

function solution(overrides: Partial<JourneySolution> = {}): JourneySolution {
  return {
    ...base('solution-one'),
    kind: 'solution',
    lifecycle: 'approved',
    hypothesis: 'Showing delivery cost earlier will reduce avoidable abandonment.',
    constraints: ['Do not change tax calculation.'],
    estimatedEffort: 8,
    estimatedCost: 10_000,
    risk: 'medium',
    ...overrides
  };
}

function initiative(id: string, overrides: Partial<JourneyInitiative> = {}): JourneyInitiative {
  return {
    ...base(id),
    kind: 'initiative',
    lifecycle: 'planned',
    priority: 'high',
    risk: 'medium',
    expectedOutcome: 'Increase completed checkouts without increasing support contacts.',
    plannedStart: '2026-08-10',
    plannedEnd: '2026-09-10',
    actualStart: null,
    actualEnd: null,
    reviewCadenceDays: 7,
    targetMetrics: [{
      metricId: 'checkout-csat',
      metricDefinitionVersion: 'metric/v2',
      direction: 'higher_is_better',
      targetValue: 4.5,
      unit: 'points'
    }],
    ...overrides
  };
}

function relationships(): JourneyPortfolioRelationship[] {
  return [
    {
      id: 'rel-pain-opportunity', spaceId: 'space-one', type: 'pain_point_to_opportunity',
      fromKind: 'pain_point', fromId: 'pain-one', toKind: 'opportunity', toId: 'opportunity-one', createdAt
    },
    {
      id: 'rel-opportunity-solution', spaceId: 'space-one', type: 'opportunity_to_solution',
      fromKind: 'opportunity', fromId: 'opportunity-one', toKind: 'solution', toId: 'solution-one', createdAt
    },
    {
      id: 'rel-solution-initiative-a', spaceId: 'space-one', type: 'solution_to_initiative',
      fromKind: 'solution', fromId: 'solution-one', toKind: 'initiative', toId: 'initiative-a', createdAt
    },
    {
      id: 'rel-solution-initiative-b', spaceId: 'space-one', type: 'solution_to_initiative',
      fromKind: 'solution', fromId: 'solution-one', toKind: 'initiative', toId: 'initiative-b', createdAt
    }
  ];
}

function validGraph(): JourneyPortfolioGraph {
  const canonicalPain = pain({ revision: 2, title: 'Delivery cost appears too late' });
  return {
    items: [canonicalPain, opportunity(), solution(), initiative('initiative-a'), initiative('initiative-b')],
    relationships: relationships(),
    journeyLinks: [
      {
        id: 'usage-current', spaceId: 'space-one', itemKind: 'pain_point', itemId: 'pain-one',
        canonicalItemRevision: 2, journeyId: 'journey-checkout', journeyVersion: null,
        targetType: 'stage', targetId: 'stage-payment', relationship: 'occurs_at',
        validFrom: null, validUntil: null, itemSnapshot: null, createdAt
      },
      {
        id: 'usage-published', spaceId: 'space-one', itemKind: 'pain_point', itemId: 'pain-one',
        canonicalItemRevision: 1, journeyId: 'journey-renewal', journeyVersion: 'journey/v4',
        targetType: 'touchpoint', targetId: 'touchpoint-invoice', relationship: 'affects',
        validFrom: '2026-07-01T00:00:00.000Z', validUntil: null,
        itemSnapshot: {
          kind: 'pain_point', itemId: 'pain-one', itemRevision: 1,
          title: 'Unexpected delivery cost', description: 'Earlier canonical wording.', lifecycle: 'approved'
        },
        createdAt
      }
    ],
    dependencies: [{
      id: 'dependency-b-on-a', spaceId: 'space-one', initiativeId: 'initiative-b',
      dependsOnInitiativeId: 'initiative-a', type: 'finish_to_start', createdAt
    }]
  };
}

const context = (
  itemRelationships = relationships(),
  initiatives = [initiative('initiative-a'), initiative('initiative-b')],
  outcomeComparisonIds: string[] = []
): JourneyPortfolioLifecycleContext => ({
  relationships: itemRelationships,
  dependencies: [{
    id: 'dependency-b-on-a', spaceId: 'space-one', initiativeId: 'initiative-b',
    dependsOnInitiativeId: 'initiative-a', type: 'finish_to_start', createdAt
  }],
  initiatives,
  outcomeComparisonIds
});

test('validates a reusable typed graph and preserves published snapshots across canonical edits', () => {
  const graph = validGraph();
  const result = validateJourneyPortfolioGraph(graph);
  assert.equal(result.valid, true);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.dependencies, {
    valid: true,
    topologicalOrder: ['initiative-a', 'initiative-b'],
    cycles: []
  });
  assert.deepEqual(result.usageByItem, [{
    itemKind: 'pain_point', itemId: 'pain-one',
    journeyIds: ['journey-checkout', 'journey-renewal'], linkCount: 2
  }]);
  assert.equal(graph.journeyLinks[1].itemSnapshot?.title, 'Unexpected delivery cost');
  assert.equal((graph.items[0] as JourneyPainPoint).title, 'Delivery cost appears too late');
});

test('reports cross-space, typed-link, snapshot, and dependency defects in stable order', () => {
  const graph = validGraph();
  graph.journeyLinks[0] = {
    ...graph.journeyLinks[0],
    relationship: 'delivers',
    canonicalItemRevision: 1,
    itemSnapshot: {
      kind: 'pain_point', itemId: 'pain-one', itemRevision: 1,
      title: 'Forbidden working snapshot', description: 'Not valid.', lifecycle: 'draft'
    }
  };
  graph.relationships[0] = { ...graph.relationships[0], spaceId: 'other-space' };
  graph.dependencies.push({
    id: 'dependency-a-on-b', spaceId: 'space-one', initiativeId: 'initiative-a',
    dependsOnInitiativeId: 'initiative-b', type: 'blocks', createdAt
  });
  const first = validateJourneyPortfolioGraph(graph);
  const second = validateJourneyPortfolioGraph({
    ...graph,
    items: [...graph.items].reverse(),
    relationships: [...graph.relationships].reverse(),
    dependencies: [...graph.dependencies].reverse()
  });
  assert.equal(first.valid, false);
  assert.deepEqual(first.issues.map((entry) => entry.code), [
    'DEPENDENCY_CYCLE',
    'JOURNEY_LINK_RELATIONSHIP_INVALID',
    'JOURNEY_LINK_REVISION_MISMATCH',
    'WORKING_LINK_SNAPSHOT_FORBIDDEN',
    'RELATIONSHIP_SPACE_MISMATCH'
  ]);
  assert.deepEqual(first.dependencies.cycles, [['initiative-a', 'initiative-b', 'initiative-a']]);
  assert.deepEqual(second, first);
});

test('lifecycle validation blocks unsupported or unready transitions deterministically', () => {
  const unevidenced = pain({ lifecycle: 'draft', evidenceLinkIds: [] });
  const painResult = validateJourneyPortfolioLifecycleTransition(unevidenced, 'validated', context());
  assert.equal(painResult.valid, false);
  assert.deepEqual(painResult.issues.map((entry) => entry.code), ['PAIN_POINT_EVIDENCE_REQUIRED']);

  const unlinkedOpportunity = opportunity({ lifecycle: 'draft' });
  const opportunityResult = validateJourneyPortfolioLifecycleTransition(unlinkedOpportunity, 'validated', context([]));
  assert.deepEqual(opportunityResult.issues.map((entry) => entry.code), ['OPPORTUNITY_PAIN_POINT_REQUIRED']);

  const invalidJump = validateJourneyPortfolioLifecycleTransition(opportunity({ lifecycle: 'draft' }), 'approved', context());
  assert.deepEqual(invalidJump.issues.map((entry) => entry.code), ['LIFECYCLE_TRANSITION_INVALID']);

  const inProgress = initiative('initiative-b', { lifecycle: 'planned', actualStart: '2026-08-10' });
  const blockedByDependency = validateJourneyPortfolioLifecycleTransition(inProgress, 'active', context());
  assert.equal(blockedByDependency.issues[0].code, 'INITIATIVE_DEPENDENCY_INCOMPLETE');
  const completedPrerequisite = initiative('initiative-a', {
    lifecycle: 'completed', actualStart: '2026-08-01', actualEnd: '2026-08-09'
  });
  const ready = validateJourneyPortfolioLifecycleTransition(inProgress, 'active', context(
    relationships(),
    [completedPrerequisite, inProgress]
  ));
  assert.equal(ready.valid, true);

  const completing = initiative('initiative-b', {
    lifecycle: 'active', actualStart: '2026-08-10', actualEnd: '2026-09-05'
  });
  const withoutOutcome = validateJourneyPortfolioLifecycleTransition(completing, 'completed', context(
    relationships(), [completedPrerequisite, completing]
  ));
  assert.deepEqual(withoutOutcome.issues.map((entry) => entry.code), ['INITIATIVE_OUTCOME_COMPARISON_REQUIRED']);
  assert.equal(validateJourneyPortfolioLifecycleTransition(completing, 'completed', context(
    relationships(), [completedPrerequisite, completing], ['comparison-one']
  )).valid, true);
});

test('dependency analysis returns stable topological order and canonical directed cycles', () => {
  const initiatives = [initiative('initiative-c'), initiative('initiative-a'), initiative('initiative-b')];
  const dependencies = [
    { id: 'dep-a-c', spaceId: 'space-one', initiativeId: 'initiative-a', dependsOnInitiativeId: 'initiative-c', type: 'finish_to_start' as const, createdAt },
    { id: 'dep-b-a', spaceId: 'space-one', initiativeId: 'initiative-b', dependsOnInitiativeId: 'initiative-a', type: 'finish_to_start' as const, createdAt },
    { id: 'dep-c-b', spaceId: 'space-one', initiativeId: 'initiative-c', dependsOnInitiativeId: 'initiative-b', type: 'blocks' as const, createdAt }
  ];
  const first = analyseJourneyInitiativeDependencies(initiatives, dependencies);
  const second = analyseJourneyInitiativeDependencies([...initiatives].reverse(), [...dependencies].reverse());
  assert.deepEqual(first, {
    valid: false,
    topologicalOrder: [],
    cycles: [['initiative-a', 'initiative-b', 'initiative-c', 'initiative-a']]
  });
  assert.deepEqual(second, first);
});

test('priority assessment delegates to versioned RICE/ICE arithmetic with item lineage', () => {
  const assessment = assessJourneyPortfolioPriority(opportunity(), {
    assessmentId: 'assessment-one',
    policyVersion: 'portfolio-policy/v2',
    assessedAt: '2026-08-04T12:00:00.000Z',
    method: 'rice',
    input: { reach: 2_000, impact: 3, confidence: 0.8, effort: 12 }
  });
  assert.equal(assessment.itemKind, 'opportunity');
  assert.equal(assessment.itemRevision, 1);
  assert.equal(assessment.score.formulaVersion, 'rice.v1');
  assert.equal(assessment.score.value, 400);
});

function observation(overrides: Partial<JourneyMetricObservationSnapshot> = {}): JourneyMetricObservationSnapshot {
  return {
    observationId: 'observation-before',
    metricId: 'checkout-csat',
    metricDefinitionVersion: 'metric/v2',
    calculationVersion: 'journey-metric-calculation/v1',
    value: 4,
    unit: 'points',
    numerator: 400,
    denominator: 100,
    sampleSize: 100,
    period: {
      start: '2026-07-01T00:00:00.000Z',
      end: '2026-08-01T00:00:00.000Z',
      timezone: 'UTC'
    },
    populationKey: 'paid-customers',
    filterKey: 'country=GB',
    sourceRefs: ['survey:checkout/question:csat'],
    ...overrides
  };
}

test('baseline is immutable and before/after outcomes retain samples without claiming causation', () => {
  const baseline = createJourneyInitiativeBaseline({
    baselineId: 'baseline-one',
    initiativeId: 'initiative-a',
    initiativeRevision: 3,
    capturedAt: '2026-08-01T01:00:00.000Z',
    capturedByUserId: 'owner-one',
    target: {
      metricId: 'checkout-csat', metricDefinitionVersion: 'metric/v2',
      direction: 'higher_is_better', targetValue: 4.5, unit: 'points'
    },
    observation: observation()
  });
  assert.equal(Object.isFrozen(baseline), true);
  assert.equal(Object.isFrozen(baseline.observation), true);
  assert.equal(verifyJourneyInitiativeBaseline(baseline), true);

  const after = observation({
    observationId: 'observation-after',
    value: 4.6,
    numerator: 460,
    period: {
      start: '2026-08-01T00:00:00.000Z',
      end: '2026-09-01T00:00:00.000Z',
      timezone: 'UTC'
    }
  });
  const result = compareJourneyInitiativeOutcome({
    comparisonId: 'comparison-one',
    baseline,
    after,
    comparedAt: '2026-09-01T01:00:00.000Z'
  });
  assert.equal(result.absoluteChange, 0.6);
  assert.equal(result.relativeChangePercentage, 15);
  assert.equal(result.directionalResult, 'improved');
  assert.equal(result.targetResult, 'met');
  assert.equal(result.before.denominator, 100);
  assert.equal(result.after.sampleSize, 100);
  assert.equal(result.baselineChecksum, baseline.checksum);
  assert.equal(result.interpretation.mode, 'descriptive_before_after');
  assert.match(result.interpretation.statement, /does not establish.*caused.*statistically significant/u);
  assert.equal(Object.isFrozen(result), true);

  const tampered = JSON.parse(JSON.stringify(baseline)) as typeof baseline;
  (tampered.observation as JourneyMetricObservationSnapshot).value = 5;
  assert.throws(() => verifyJourneyInitiativeBaseline(tampered),
    (error) => error instanceof JourneyPortfolioDomainError && error.code === 'INITIATIVE_BASELINE_TAMPERED');
  assert.throws(() => compareJourneyInitiativeOutcome({
    comparisonId: 'comparison-two', baseline,
    after: { ...after, filterKey: 'country=US' }, comparedAt: '2026-09-01T01:00:00.000Z'
  }), (error) => error instanceof JourneyPortfolioDomainError && error.code === 'INITIATIVE_OBSERVATIONS_NOT_COMPARABLE');
});

test('record validation remains deterministic for reordered collections', () => {
  const graph = validGraph();
  graph.items.push({ ...(graph.items[0] as JourneyPortfolioItem), id: 'bad id', title: '' } as JourneyPortfolioItem);
  const first = validateJourneyPortfolioGraph(graph);
  const second = validateJourneyPortfolioGraph({ ...graph, items: [...graph.items].reverse() });
  assert.deepEqual(first, second);
});
