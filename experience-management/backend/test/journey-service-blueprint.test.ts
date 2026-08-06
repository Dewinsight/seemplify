import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyseServiceBlueprint,
  blueprintLineCrossings,
  compareServiceBlueprints,
  journeyBlueprintLanes,
  journeyBlueprintLimits,
  JOURNEY_SERVICE_BLUEPRINT_VERSION,
  JourneyServiceBlueprintError,
  type JourneyBlueprintElement,
  type JourneyBlueprintElementKind,
  type JourneyBlueprintLane,
  type JourneyBlueprintPortfolioLink,
  type JourneyBlueprintRelationship,
  type JourneyBlueprintReviewState,
  type JourneyBlueprintStage,
  type JourneyBlueprintState,
  type JourneyServiceBlueprint
} from '../src/journeyServiceBlueprint.js';

function blueprint(overrides: Partial<JourneyServiceBlueprint> = {}): JourneyServiceBlueprint {
  return {
    schemaVersion: JOURNEY_SERVICE_BLUEPRINT_VERSION,
    blueprintId: 'blueprint-current',
    spaceId: 'space-a',
    journeyDefinitionId: 'journey-a',
    journeyVersionId: 'journey-version-a',
    state: 'current',
    stages: [
      { stageKey: 'discover', name: 'Discover', ordinal: 0 },
      { stageKey: 'resolve', name: 'Resolve', ordinal: 1 }
    ],
    elements: [
      { id: 'customer-request', stageKey: 'discover', lane: 'customer', kind: 'action', title: 'Ask for help' },
      { id: 'agent-intake', stageKey: 'discover', lane: 'frontstage', kind: 'touchpoint', title: 'Receive request', ownerTeamId: 'support' },
      { id: 'triage', stageKey: 'discover', lane: 'backstage', kind: 'process', title: 'Triage request', ownerTeamId: 'operations', slaMinutes: 30, unitCost: 2.5 },
      { id: 'case-system', stageKey: 'discover', lane: 'supporting_system', kind: 'system', title: 'Case platform', ownerTeamId: 'technology', systemId: 'system-case' },
      { id: 'service-policy', stageKey: 'discover', lane: 'policy_control', kind: 'policy', title: 'Priority policy', ownerTeamId: 'risk', controlId: 'control-priority' },
      { id: 'handoff-failure', stageKey: 'resolve', lane: 'backstage', kind: 'failure_point', title: 'Case handoff stalls', ownerTeamId: 'operations', riskProbability: 0.4, riskImpact: 0.8 },
      { id: 'handoff-monitor', stageKey: 'resolve', lane: 'supporting_system', kind: 'control', title: 'Handoff monitor', ownerTeamId: 'technology' }
    ],
    relationships: [
      { id: 'customer-to-agent', kind: 'handoff_to', fromElementId: 'customer-request', toElementId: 'agent-intake' },
      { id: 'triage-supports-agent', kind: 'supports', fromElementId: 'triage', toElementId: 'agent-intake' },
      { id: 'system-supports-triage', kind: 'supports', fromElementId: 'case-system', toElementId: 'triage' },
      { id: 'policy-governs-system', kind: 'governed_by', fromElementId: 'case-system', toElementId: 'service-policy' },
      { id: 'monitor-supports-failure', kind: 'supports', fromElementId: 'handoff-monitor', toElementId: 'handoff-failure' },
      { id: 'monitor-mitigates-failure', kind: 'mitigates', fromElementId: 'handoff-monitor', toElementId: 'handoff-failure' }
    ],
    ...overrides
  };
}

function thrownCode(run: () => unknown) {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof JourneyServiceBlueprintError ? error.code : 'UNTYPED_ERROR';
  }
}

test('a complete blueprint exposes structured lines, coverage, risk, SLA, ownership, and causality', () => {
  const result = analyseServiceBlueprint(blueprint());
  assert.equal(result.valid, true);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.coverage, {
    frontstageElements: 1,
    supportedFrontstageElements: 1,
    backstageElements: 2,
    systemSupportedBackstageElements: 2,
    failurePoints: 1,
    mitigatedFailurePoints: 1
  });
  assert.deepEqual(result.risk, [{ elementId: 'handoff-failure', score: 0.32, probability: 0.4, impact: 0.8 }]);
  assert.deepEqual(result.crossings.find((entry) => entry.relationshipId === 'customer-to-agent')?.lines, ['interaction']);
  assert.deepEqual(result.crossings.find((entry) => entry.relationshipId === 'triage-supports-agent')?.lines, ['visibility']);
  assert.deepEqual(result.crossings.find((entry) => entry.relationshipId === 'system-supports-triage')?.lines, ['internal_interaction']);
});

test('line crossing derivation is deterministic in either relationship direction', () => {
  const map = blueprint();
  const elements = new Map(map.elements.map((element) => [element.id, element]));
  assert.deepEqual(blueprintLineCrossings({
    id: 'deep', kind: 'supports', fromElementId: 'service-policy', toElementId: 'customer-request'
  }, elements), ['interaction', 'visibility', 'internal_interaction']);
  assert.deepEqual(blueprintLineCrossings({
    id: 'deep-reverse', kind: 'supports', fromElementId: 'customer-request', toElementId: 'service-policy'
  }, elements), ['interaction', 'visibility', 'internal_interaction']);
});

test('invalid topology, economics, risk, ownership, and dependency cycles fail closed with stable codes', () => {
  const map = blueprint();
  map.elements = [
    ...map.elements,
    { id: 'invalid', stageKey: 'missing', lane: 'backstage', kind: 'process', title: 'Invalid process', slaMinutes: 0, unitCost: -1, riskProbability: 1.1 },
    { id: 'cycle-a', stageKey: 'resolve', lane: 'backstage', kind: 'process', title: 'Cycle A', ownerTeamId: 'ops' },
    { id: 'cycle-b', stageKey: 'resolve', lane: 'backstage', kind: 'process', title: 'Cycle B', ownerTeamId: 'ops' }
  ];
  map.relationships = [
    ...map.relationships,
    { id: 'cycle-a-b', kind: 'depends_on', fromElementId: 'cycle-a', toElementId: 'cycle-b' },
    { id: 'cycle-b-a', kind: 'depends_on', fromElementId: 'cycle-b', toElementId: 'cycle-a' },
    { id: 'missing-target', kind: 'supports', fromElementId: 'cycle-a', toElementId: 'not-there' }
  ];
  const result = analyseServiceBlueprint(map);
  const codes = result.issues.map((issue) => issue.code);
  assert.equal(result.valid, false);
  assert.ok(codes.includes('BLUEPRINT_ELEMENT_STAGE_MISSING'));
  assert.ok(codes.includes('BLUEPRINT_OWNER_MISSING'));
  assert.ok(codes.includes('BLUEPRINT_SLA_INVALID'));
  assert.ok(codes.includes('BLUEPRINT_COST_INVALID'));
  assert.ok(codes.includes('BLUEPRINT_RISK_INVALID'));
  assert.ok(codes.includes('BLUEPRINT_RISK_INCOMPLETE'));
  assert.equal(codes.filter((code) => code === 'BLUEPRINT_DEPENDENCY_CYCLE').length, 2);
  assert.ok(codes.includes('BLUEPRINT_RELATIONSHIP_TARGET_MISSING'));
});

test('gap analysis warns about unowned, unsupported, and unmitigated operational work without inventing evidence', () => {
  const map = blueprint({
    elements: [
      { id: 'front', stageKey: 'discover', lane: 'frontstage', kind: 'touchpoint', title: 'Frontstage' },
      { id: 'back', stageKey: 'discover', lane: 'backstage', kind: 'failure_point', title: 'Failure', ownerTeamId: 'ops' }
    ],
    relationships: []
  });
  const result = analyseServiceBlueprint(map);
  assert.equal(result.valid, true);
  assert.deepEqual(result.coverage, {
    frontstageElements: 1,
    supportedFrontstageElements: 0,
    backstageElements: 1,
    systemSupportedBackstageElements: 0,
    failurePoints: 1,
    mitigatedFailurePoints: 0
  });
  assert.deepEqual(result.issues.map((issue) => issue.code), [
    'BLUEPRINT_BACKSTAGE_SYSTEM_MISSING',
    'BLUEPRINT_FAILURE_UNMITIGATED',
    'BLUEPRINT_FRONTSTAGE_UNSUPPORTED',
    'BLUEPRINT_OWNER_MISSING'
  ]);
  // Every review warning carries the runtime-29 gap taxonomy so it can become a gap-assessment row.
  assert.deepEqual(result.issues.map((issue) => issue.gapType), [
    'support_missing', 'failure_unmitigated', 'support_missing', 'owner_missing'
  ]);
});

test('current-to-future comparison reports stable additions, removals, and changed fields', () => {
  const current = blueprint();
  const future = blueprint({
    blueprintId: 'blueprint-future',
    journeyVersionId: 'journey-version-b',
    state: 'future',
    elements: current.elements
      .filter((element) => element.id !== 'service-policy')
      .map((element) => element.id === 'triage' ? { ...element, slaMinutes: 10, ownerTeamId: 'service-ops' } : element)
      .concat({ id: 'auto-route', stageKey: 'discover', lane: 'supporting_system', kind: 'system', title: 'Auto route', ownerTeamId: 'technology' }),
    relationships: current.relationships
      .filter((relationship) => relationship.id !== 'policy-governs-system')
      .map((relationship) => relationship.id === 'system-supports-triage' ? { ...relationship, label: 'Automated routing' } : relationship)
      .concat({ id: 'auto-supports-triage', kind: 'supports', fromElementId: 'auto-route', toElementId: 'triage' })
  });
  assert.deepEqual(compareServiceBlueprints(current, future), {
    spaceId: 'space-a',
    journeyDefinitionId: 'journey-a',
    fromBlueprintId: 'blueprint-current',
    toBlueprintId: 'blueprint-future',
    fromVersionId: null,
    toVersionId: null,
    fromJourneyVersionId: 'journey-version-a',
    toJourneyVersionId: 'journey-version-b',
    fromState: 'current',
    toState: 'future',
    addedStageKeys: [],
    removedStageKeys: [],
    changedStages: [],
    addedElementIds: ['auto-route'],
    removedElementIds: ['service-policy'],
    changed: [{ elementId: 'triage', fields: ['ownerTeamId', 'slaMinutes'] }],
    addedRelationshipIds: ['auto-supports-triage'],
    removedRelationshipIds: ['policy-governs-system'],
    changedRelationshipIds: ['system-supports-triage'],
    addedPortfolioLinkIds: [],
    removedPortfolioLinkIds: [],
    changedPortfolioLinkIds: []
  });
  assert.throws(() => compareServiceBlueprints(current, { ...future, spaceId: 'space-b' }), /same space and journey definition/u);
});

test('support coverage is lane-directed, so a customer-lane or same-lane supports edge cannot claim it', () => {
  const map = blueprint({
    elements: [
      { id: 'cust', stageKey: 'discover', lane: 'customer', kind: 'action', title: 'Ask' },
      { id: 'front', stageKey: 'discover', lane: 'frontstage', kind: 'touchpoint', title: 'Desk', ownerTeamId: 'support' },
      { id: 'back-one', stageKey: 'discover', lane: 'backstage', kind: 'process', title: 'Triage', ownerTeamId: 'ops' },
      { id: 'back-two', stageKey: 'discover', lane: 'backstage', kind: 'process', title: 'Review', ownerTeamId: 'ops' }
    ],
    relationships: [
      { id: 'cust-supports-front', kind: 'supports', fromElementId: 'cust', toElementId: 'front' },
      { id: 'back-supports-back', kind: 'supports', fromElementId: 'back-one', toElementId: 'back-two' }
    ]
  });
  const result = analyseServiceBlueprint(map);
  // A customer action does not supply backstage support, and backstage does not supply a system.
  assert.deepEqual(result.coverage, {
    frontstageElements: 1,
    supportedFrontstageElements: 0,
    backstageElements: 2,
    systemSupportedBackstageElements: 0,
    failurePoints: 0,
    mitigatedFailurePoints: 0
  });
  assert.deepEqual(result.issues.map((issue) => issue.code), [
    'BLUEPRINT_BACKSTAGE_SYSTEM_MISSING',
    'BLUEPRINT_BACKSTAGE_SYSTEM_MISSING',
    'BLUEPRINT_FRONTSTAGE_UNSUPPORTED'
  ]);
});

test('a supports edge with an unresolved endpoint cannot silence a gap warning', () => {
  const map = blueprint({
    elements: [
      { id: 'front', stageKey: 'discover', lane: 'frontstage', kind: 'touchpoint', title: 'Desk', ownerTeamId: 'support' },
      { id: 'fail', stageKey: 'discover', lane: 'backstage', kind: 'failure_point', title: 'Stall', ownerTeamId: 'ops' }
    ],
    relationships: [
      { id: 'ghost-supports-front', kind: 'supports', fromElementId: 'ghost', toElementId: 'front' },
      { id: 'ghost-mitigates-fail', kind: 'mitigates', fromElementId: 'ghost', toElementId: 'fail' }
    ]
  });
  const result = analyseServiceBlueprint(map);
  const codes = result.issues.map((issue) => issue.code);
  assert.equal(result.valid, false);
  assert.equal(codes.filter((code) => code === 'BLUEPRINT_RELATIONSHIP_TARGET_MISSING').length, 2);
  assert.ok(codes.includes('BLUEPRINT_FRONTSTAGE_UNSUPPORTED'));
  assert.ok(codes.includes('BLUEPRINT_FAILURE_UNMITIGATED'));
  assert.equal(result.coverage.supportedFrontstageElements, 0);
  assert.equal(result.coverage.mitigatedFailurePoints, 0);
});

test('element kind, relationship kind, blueprint state, and review state are rejected at runtime', () => {
  const map = blueprint({
    state: 'draft' as unknown as JourneyBlueprintState,
    reviewState: 'signed_off' as unknown as JourneyBlueprintReviewState,
    versionNumber: 0,
    elements: [
      { id: 'odd', stageKey: 'discover', lane: 'sideways' as unknown as JourneyBlueprintLane, kind: 'wat' as unknown as JourneyBlueprintElementKind, title: 'Odd', ownerTeamId: 'ops' }
    ],
    relationships: [
      { id: 'odd-edge', kind: 'nope' as unknown as JourneyBlueprintRelationship['kind'], fromElementId: 'odd', toElementId: 'odd' }
    ]
  });
  const codes = analyseServiceBlueprint(map).issues.map((issue) => issue.code);
  assert.ok(codes.includes('BLUEPRINT_STATE_INVALID'));
  assert.ok(codes.includes('BLUEPRINT_REVIEW_STATE_INVALID'));
  assert.ok(codes.includes('BLUEPRINT_VERSION_NUMBER_INVALID'));
  assert.ok(codes.includes('BLUEPRINT_LANE_INVALID'));
  assert.ok(codes.includes('BLUEPRINT_ELEMENT_KIND_INVALID'));
  assert.ok(codes.includes('BLUEPRINT_RELATIONSHIP_KIND_INVALID'));
});

test('malformed input and oversized collections fail closed with typed errors', () => {
  assert.equal(thrownCode(() => analyseServiceBlueprint(undefined as unknown as JourneyServiceBlueprint)), 'BLUEPRINT_INVALID_INPUT');
  assert.equal(thrownCode(() => analyseServiceBlueprint({} as unknown as JourneyServiceBlueprint)), 'BLUEPRINT_INVALID_INPUT');
  assert.equal(thrownCode(() => analyseServiceBlueprint(blueprint({ stages: 'nope' as unknown as JourneyBlueprintStage[] }))), 'BLUEPRINT_INVALID_INPUT');
  assert.equal(thrownCode(() => analyseServiceBlueprint(blueprint({ elements: [null as unknown as JourneyBlueprintElement] }))), 'BLUEPRINT_INVALID_INPUT');
  assert.equal(thrownCode(() => analyseServiceBlueprint(blueprint({
    stages: Array.from({ length: journeyBlueprintLimits.stages + 1 }, (_, index) => ({
      stageKey: `stage-${index}`, name: `Stage ${index}`, ordinal: index
    }))
  }))), 'BLUEPRINT_LIMIT');
  assert.equal(thrownCode(() => analyseServiceBlueprint(blueprint({
    elements: Array.from({ length: journeyBlueprintLimits.elements + 1 }, (_, index) => ({
      id: `e-${index}`, stageKey: 'discover', lane: 'backstage' as const, kind: 'process' as const, title: `E${index}`, ownerTeamId: 'ops'
    })),
    relationships: []
  }))), 'BLUEPRINT_LIMIT');
});

test('reference arrays and text fields are bounded like the durable contract', () => {
  const map = blueprint({
    elements: [
      { id: 'bad-refs', stageKey: 'discover', lane: 'backstage', kind: 'process', title: 'Bad refs', ownerTeamId: 'ops', evidenceRefs: [42 as unknown as string] },
      { id: 'long-text', stageKey: 'discover', lane: 'backstage', kind: 'process', title: 'Long', ownerTeamId: 'ops', description: 'x'.repeat(10_001) },
      { id: 'huge-refs', stageKey: 'discover', lane: 'backstage', kind: 'process', title: 'Huge', ownerTeamId: 'ops', metricRefs: Array.from({ length: 4_000 }, (_, index) => `metric-${index}-${'z'.repeat(20)}`) }
    ],
    relationships: [
      { id: 'long-label', kind: 'supports', fromElementId: 'bad-refs', toElementId: 'long-text', label: 'y'.repeat(501) }
    ]
  });
  const codes = analyseServiceBlueprint(map).issues.map((issue) => issue.code);
  assert.ok(codes.includes('BLUEPRINT_ELEMENT_REFS_INVALID'));
  assert.ok(codes.includes('BLUEPRINT_ELEMENT_TEXT_TOO_LONG'));
  assert.ok(codes.includes('BLUEPRINT_ELEMENT_REFS_TOO_LARGE'));
  assert.ok(codes.includes('BLUEPRINT_RELATIONSHIP_LABEL_TOO_LONG'));
});

test('blank identifiers and duplicate elements cannot create resolvable phantom targets', () => {
  const map = blueprint({
    elements: [
      { id: '', stageKey: 'discover', lane: 'frontstage', kind: 'touchpoint', title: 'Blank', ownerTeamId: 'support' },
      { id: 'dup', stageKey: 'discover', lane: 'frontstage', kind: 'touchpoint', title: 'First', ownerTeamId: 'support' },
      { id: 'dup', stageKey: 'discover', lane: 'backstage', kind: 'process', title: 'Second', ownerTeamId: 'ops' }
    ],
    relationships: [
      { id: 'from-blank', kind: 'supports', fromElementId: '', toElementId: 'dup' }
    ]
  });
  const result = analyseServiceBlueprint(map);
  const codes = result.issues.map((issue) => issue.code);
  assert.equal(result.valid, false);
  assert.ok(codes.includes('BLUEPRINT_ELEMENT_INVALID'));
  assert.ok(codes.includes('BLUEPRINT_ELEMENT_DUPLICATE'));
  // The blank ID never entered the element map, so the edge is unresolved rather than satisfied.
  assert.ok(codes.includes('BLUEPRINT_RELATIONSHIP_TARGET_MISSING'));
  // The first declaration wins, so the duplicate is counted once and only in its first lane.
  assert.equal(result.coverage.frontstageElements, 1);
  assert.equal(result.coverage.backstageElements, 0);
});

test('element ordinals mirror the durable stage, lane, and ordinal uniqueness', () => {
  const positioned = (id: string, ordinal: number): JourneyBlueprintElement => ({
    id, stageKey: 'discover', lane: 'backstage', kind: 'process', title: id, ownerTeamId: 'ops', ordinal
  });
  const spaced = analyseServiceBlueprint(blueprint({ elements: [positioned('a', 0), positioned('b', 1)], relationships: [] }));
  assert.ok(spaced.issues.every((issue) => issue.code !== 'BLUEPRINT_ELEMENT_POSITION_DUPLICATE'));
  const clash = analyseServiceBlueprint(blueprint({ elements: [positioned('a', 0), positioned('b', 0)], relationships: [] }));
  assert.equal(clash.valid, false);
  assert.ok(clash.issues.some((issue) => issue.code === 'BLUEPRINT_ELEMENT_POSITION_DUPLICATE'));
  const negative = analyseServiceBlueprint(blueprint({ elements: [positioned('a', -1)], relationships: [] }));
  assert.ok(negative.issues.some((issue) => issue.code === 'BLUEPRINT_ELEMENT_ORDINAL_INVALID'));
});

test('role references are validated against an active same-space catalogue, and a skipped check is reported', () => {
  const elements: JourneyBlueprintElement[] = [
    { id: 'proc', stageKey: 'discover', lane: 'backstage', kind: 'process', title: 'Process', ownerTeamId: 'team-ops', systemId: 'sys-legacy' },
    { id: 'other', stageKey: 'discover', lane: 'backstage', kind: 'process', title: 'Other', ownerTeamId: 'sys-legacy', vendorId: 'nobody' }
  ];
  const withoutCatalogue = analyseServiceBlueprint(blueprint({ elements, relationships: [] }));
  // Honest reporting: with no catalogue the role references are simply not checked.
  assert.deepEqual(withoutCatalogue.resourceValidation, { enforced: false, catalogueSize: 0 });
  assert.ok(withoutCatalogue.issues.every((issue) => !issue.code.startsWith('BLUEPRINT_RESOURCE_')));

  const withCatalogue = analyseServiceBlueprint(blueprint({
    elements,
    relationships: [],
    resources: [
      { id: 'team-ops', kind: 'team' },
      { id: 'sys-legacy', kind: 'system', lifecycle: 'retired' },
      { id: 'foreign', kind: 'team', spaceId: 'space-z' }
    ]
  }));
  const codes = withCatalogue.issues.map((issue) => issue.code);
  assert.equal(withCatalogue.valid, false);
  assert.deepEqual(withCatalogue.resourceValidation, { enforced: true, catalogueSize: 2 });
  assert.ok(codes.includes('BLUEPRINT_RESOURCE_RETIRED'));
  assert.ok(codes.includes('BLUEPRINT_RESOURCE_KIND_MISMATCH'));
  assert.ok(codes.includes('BLUEPRINT_RESOURCE_MISSING'));
  assert.ok(codes.includes('BLUEPRINT_RESOURCE_CROSS_SPACE'));
});

test('a pain point traces to a backstage process, supporting system, owner, SLA, and improvement initiative', () => {
  const map = blueprint({
    elements: [
      { id: 'touchpoint', stageKey: 'discover', lane: 'frontstage', kind: 'touchpoint', title: 'Desk', ownerTeamId: 'support' },
      { id: 'slow-process', stageKey: 'discover', lane: 'backstage', kind: 'process', title: 'Manual triage', ownerTeamId: 'ops', slaMinutes: 60 },
      { id: 'legacy-system', stageKey: 'discover', lane: 'supporting_system', kind: 'system', title: 'Legacy core', ownerTeamId: 'tech' }
    ],
    relationships: [
      { id: 'system-supports-process', kind: 'supports', fromElementId: 'legacy-system', toElementId: 'slow-process' },
      { id: 'process-supports-touchpoint', kind: 'supports', fromElementId: 'slow-process', toElementId: 'touchpoint' }
    ],
    portfolioLinks: [
      { id: 'link-cause', elementId: 'slow-process', portfolioItemId: 'pain-wait', portfolioItemKind: 'pain_point', portfolioItemRevision: 3, relationship: 'causes' },
      { id: 'link-fix', elementId: 'slow-process', portfolioItemId: 'init-automate', portfolioItemKind: 'initiative', portfolioItemRevision: 2, relationship: 'improved_by' }
    ]
  });
  const result = analyseServiceBlueprint(map);
  assert.deepEqual(result.issues, []);
  assert.equal(result.causality.linkedPortfolioItems, 2);
  assert.deepEqual(result.causality.painPointTraces, [{
    portfolioItemId: 'pain-wait',
    causingElementIds: ['slow-process'],
    traceElementIds: ['legacy-system', 'slow-process'],
    hasBackstageProcess: true,
    hasSupportingSystem: true,
    hasOwner: true,
    hasSla: true,
    hasImprovementInitiative: true,
    missing: []
  }]);
  assert.equal(result.causality.fullyTracedPainPoints, 1);
});

test('an incomplete causal trace reports each absent leg instead of inferring it', () => {
  const map = blueprint({
    elements: [
      { id: 'orphan-process', stageKey: 'discover', lane: 'backstage', kind: 'process', title: 'Unowned step' }
    ],
    relationships: [],
    portfolioLinks: [
      { id: 'link-cause', elementId: 'orphan-process', portfolioItemId: 'pain-wait', portfolioItemKind: 'pain_point', portfolioItemRevision: 1, relationship: 'causes' }
    ]
  });
  const causality = analyseServiceBlueprint(map).causality;
  assert.equal(causality.fullyTracedPainPoints, 0);
  assert.deepEqual(causality.painPointTraces[0]?.missing, ['supporting_system', 'owner', 'sla', 'improvement_initiative']);
  assert.equal(causality.painPointTraces[0]?.hasBackstageProcess, true);
});

test('portfolio causality rejects incompatible kinds, customer-lane causes, bad revisions, duplicates, and foreign spaces', () => {
  const links: JourneyBlueprintPortfolioLink[] = [
    { id: 'bad-kind', elementId: 'proc', portfolioItemId: 'init-a', portfolioItemKind: 'initiative', portfolioItemRevision: 1, relationship: 'causes' },
    { id: 'bad-lane', elementId: 'cust', portfolioItemId: 'pain-a', portfolioItemKind: 'pain_point', portfolioItemRevision: 1, relationship: 'causes' },
    { id: 'bad-revision', elementId: 'proc', portfolioItemId: 'pain-b', portfolioItemKind: 'pain_point', portfolioItemRevision: 0, relationship: 'causes' },
    { id: 'missing-element', elementId: 'nope', portfolioItemId: 'pain-c', portfolioItemKind: 'pain_point', portfolioItemRevision: 1, relationship: 'causes' },
    { id: 'foreign', elementId: 'proc', portfolioItemId: 'pain-d', portfolioItemKind: 'pain_point', portfolioItemRevision: 1, relationship: 'causes', spaceId: 'space-z' },
    { id: 'first', elementId: 'proc', portfolioItemId: 'pain-e', portfolioItemKind: 'pain_point', portfolioItemRevision: 1, relationship: 'causes' },
    { id: 'second', elementId: 'proc', portfolioItemId: 'pain-e', portfolioItemKind: 'pain_point', portfolioItemRevision: 1, relationship: 'causes' }
  ];
  const result = analyseServiceBlueprint(blueprint({
    elements: [
      { id: 'cust', stageKey: 'discover', lane: 'customer', kind: 'action', title: 'Wait' },
      { id: 'proc', stageKey: 'discover', lane: 'backstage', kind: 'process', title: 'Step', ownerTeamId: 'ops' }
    ],
    relationships: [],
    portfolioLinks: links
  }));
  const codes = result.issues.map((issue) => issue.code);
  assert.equal(result.valid, false);
  assert.ok(codes.includes('BLUEPRINT_CAUSALITY_KIND_INCOMPATIBLE'));
  assert.ok(codes.includes('BLUEPRINT_CAUSALITY_LANE_INVALID'));
  assert.ok(codes.includes('BLUEPRINT_CAUSALITY_REVISION_INVALID'));
  assert.ok(codes.includes('BLUEPRINT_CAUSALITY_ELEMENT_MISSING'));
  assert.ok(codes.includes('BLUEPRINT_CAUSALITY_CROSS_SPACE'));
  assert.ok(codes.includes('BLUEPRINT_CAUSALITY_LINK_DUPLICATE'));
  // Only the single well-formed link reaches the trace.
  assert.deepEqual(result.causality.painPointTraces.map((trace) => trace.portfolioItemId), ['pain-e']);
});

test('comparison guards space, journey, schema, state, self-comparison, and duplicate identifiers', () => {
  const current = blueprint();
  const future = blueprint({ blueprintId: 'blueprint-future', journeyVersionId: 'journey-version-b', state: 'future' });
  assert.equal(thrownCode(() => compareServiceBlueprints(current, { ...future, spaceId: 'space-b' })), 'BLUEPRINT_COMPARISON_CROSS_SPACE');
  assert.equal(thrownCode(() => compareServiceBlueprints(current, { ...future, journeyDefinitionId: 'journey-b' })), 'BLUEPRINT_COMPARISON_CROSS_JOURNEY');
  assert.equal(thrownCode(() => compareServiceBlueprints(current, {
    ...future, schemaVersion: 'journey-service-blueprint/v2' as typeof JOURNEY_SERVICE_BLUEPRINT_VERSION
  })), 'BLUEPRINT_COMPARISON_SCHEMA_MISMATCH');
  assert.equal(thrownCode(() => compareServiceBlueprints(current, { ...future, state: 'current' })), 'BLUEPRINT_COMPARISON_STATE');
  assert.equal(thrownCode(() => compareServiceBlueprints({ ...current, state: 'future' }, future)), 'BLUEPRINT_COMPARISON_STATE');
  assert.equal(thrownCode(() => compareServiceBlueprints(current, { ...current, state: 'future' })), 'BLUEPRINT_COMPARISON_SELF');
  assert.equal(thrownCode(() => compareServiceBlueprints(
    { ...current, versionId: 'version-1' },
    { ...future, versionId: 'version-1' }
  )), 'BLUEPRINT_COMPARISON_SELF');
  assert.equal(thrownCode(() => compareServiceBlueprints(current, {
    ...future, elements: [...future.elements, future.elements[0]!]
  })), 'BLUEPRINT_COMPARISON_DUPLICATE_ID');
});

test('comparison detects stage and portfolio-link changes and never equates NaN with an absent value', () => {
  const current = blueprint({
    elements: [{ id: 'proc', stageKey: 'discover', lane: 'backstage', kind: 'process', title: 'Step', ownerTeamId: 'ops', slaMinutes: Number.NaN, evidenceRefs: [7 as unknown as string] }],
    relationships: [],
    portfolioLinks: [
      { id: 'keep', elementId: 'proc', portfolioItemId: 'pain-a', portfolioItemKind: 'pain_point', portfolioItemRevision: 1, relationship: 'causes' },
      { id: 'drop', elementId: 'proc', portfolioItemId: 'pain-b', portfolioItemKind: 'pain_point', portfolioItemRevision: 1, relationship: 'affected_by' }
    ]
  });
  const future = blueprint({
    blueprintId: 'blueprint-future',
    journeyVersionId: 'journey-version-b',
    state: 'future',
    versionId: 'version-2',
    stages: [
      { stageKey: 'discover', name: 'Discovery', ordinal: 0 },
      { stageKey: 'deliver', name: 'Deliver', ordinal: 2 }
    ],
    elements: [{ id: 'proc', stageKey: 'discover', lane: 'backstage', kind: 'process', title: 'Step', ownerTeamId: 'ops', slaMinutes: null, evidenceRefs: [] }],
    relationships: [],
    portfolioLinks: [
      { id: 'keep', elementId: 'proc', portfolioItemId: 'pain-a', portfolioItemKind: 'pain_point', portfolioItemRevision: 4, relationship: 'causes' },
      { id: 'add', elementId: 'proc', portfolioItemId: 'pain-c', portfolioItemKind: 'pain_point', portfolioItemRevision: 1, relationship: 'affected_by' }
    ]
  });
  const result = compareServiceBlueprints(current, future);
  assert.deepEqual(result.addedStageKeys, ['deliver']);
  assert.deepEqual(result.removedStageKeys, ['resolve']);
  assert.deepEqual(result.changedStages, [{ stageKey: 'discover', fields: ['name'] }]);
  // NaN must not serialise to the same value as an absent SLA.
  assert.deepEqual(result.changed, [{ elementId: 'proc', fields: ['slaMinutes'] }]);
  assert.deepEqual(result.addedPortfolioLinkIds, ['add']);
  assert.deepEqual(result.removedPortfolioLinkIds, ['drop']);
  assert.deepEqual(result.changedPortfolioLinkIds, ['keep']);
  assert.equal(result.fromVersionId, null);
  assert.equal(result.toVersionId, 'version-2');
  assert.equal(result.spaceId, 'space-a');
  assert.equal(result.journeyDefinitionId, 'journey-a');
});

test('issue ordering is total even when a code repeats without an anchoring identifier', () => {
  const map = blueprint({ blueprintId: '', spaceId: '', journeyDefinitionId: '', journeyVersionId: '' });
  const identity = analyseServiceBlueprint(map).issues.filter((issue) => issue.code === 'BLUEPRINT_IDENTITY_REQUIRED');
  assert.deepEqual(identity.map((issue) => issue.field), [
    'blueprintId', 'journeyDefinitionId', 'journeyVersionId', 'spaceId'
  ]);
  assert.equal(
    JSON.stringify(analyseServiceBlueprint(blueprint()).issues),
    JSON.stringify(analyseServiceBlueprint(blueprint()).issues)
  );
});

test('dependency cycles are detected on a deep chain without recursing', () => {
  const depth = 5_000;
  const elements: JourneyBlueprintElement[] = Array.from({ length: depth }, (_, index) => ({
    id: `n${String(index).padStart(6, '0')}`,
    stageKey: 'discover',
    lane: 'backstage',
    kind: 'process',
    title: `Node ${index}`,
    ownerTeamId: 'ops'
  }));
  const chain: JourneyBlueprintRelationship[] = elements.slice(0, -1).map((element, index) => ({
    id: `d${String(index).padStart(6, '0')}`,
    kind: 'depends_on',
    fromElementId: element.id,
    toElementId: elements[index + 1]!.id
  }));
  const acyclic = analyseServiceBlueprint(blueprint({ elements, relationships: chain }));
  assert.equal(acyclic.issues.filter((issue) => issue.code === 'BLUEPRINT_DEPENDENCY_CYCLE').length, 0);

  const closed = analyseServiceBlueprint(blueprint({
    elements,
    relationships: [...chain, {
      id: 'close-the-loop', kind: 'depends_on', fromElementId: elements[depth - 1]!.id, toElementId: elements[0]!.id
    }]
  }));
  assert.equal(closed.issues.filter((issue) => issue.code === 'BLUEPRINT_DEPENDENCY_CYCLE').length, depth);
});

test('never mutates the caller-owned blueprint', () => {
  const current = blueprint({
    resources: [{ id: 'team-ops', kind: 'team' }],
    portfolioLinks: [
      { id: 'link-cause', elementId: 'triage', portfolioItemId: 'pain-wait', portfolioItemKind: 'pain_point', portfolioItemRevision: 1, relationship: 'causes' }
    ]
  });
  const future = blueprint({ blueprintId: 'blueprint-future', journeyVersionId: 'journey-version-b', state: 'future' });
  const expectedCurrent = structuredClone(current);
  const expectedFuture = structuredClone(future);

  analyseServiceBlueprint(current);
  analyseServiceBlueprint(future);
  compareServiceBlueprints(current, future);

  assert.deepEqual(current, expectedCurrent);
  assert.deepEqual(future, expectedFuture);
});

test('analyses a production-shaped blueprint in sub-quadratic time with byte-identical output', () => {
  // 50 stages x 5 lanes x 10 elements is the editor budget shape: 2,500 elements and ~1,450 edges.
  const stageCount = 50;
  const perLane = 10;
  const kindByLane: Record<JourneyBlueprintLane, JourneyBlueprintElementKind> = {
    customer: 'action',
    frontstage: 'touchpoint',
    backstage: 'process',
    supporting_system: 'system',
    policy_control: 'policy'
  };
  const stages: JourneyBlueprintStage[] = Array.from({ length: stageCount }, (_, index) => ({
    stageKey: `stage-${String(index).padStart(3, '0')}`, name: `Stage ${index}`, ordinal: index
  }));
  const elements: JourneyBlueprintElement[] = [];
  const relationships: JourneyBlueprintRelationship[] = [];
  const elementId = (stage: number, lane: number, slot: number) =>
    `e-${String(stage).padStart(3, '0')}-${lane}-${String(slot).padStart(2, '0')}`;
  stages.forEach((stage, stageIndex) => {
    journeyBlueprintLanes.forEach((lane, laneIndex) => {
      for (let slot = 0; slot < perLane; slot += 1) {
        elements.push({
          id: elementId(stageIndex, laneIndex, slot),
          stageKey: stage.stageKey,
          lane,
          kind: kindByLane[lane],
          title: `Element ${stageIndex}.${laneIndex}.${slot}`,
          ownerTeamId: `team-${laneIndex}`,
          ordinal: slot
        });
      }
    });
    for (let slot = 0; slot < perLane; slot += 1) {
      relationships.push({
        id: `r-sys-${String(stageIndex).padStart(3, '0')}-${String(slot).padStart(2, '0')}`,
        kind: 'supports',
        fromElementId: elementId(stageIndex, 3, slot),
        toElementId: elementId(stageIndex, 2, slot)
      });
      relationships.push({
        id: `r-back-${String(stageIndex).padStart(3, '0')}-${String(slot).padStart(2, '0')}`,
        kind: 'supports',
        fromElementId: elementId(stageIndex, 2, slot),
        toElementId: elementId(stageIndex, 1, slot)
      });
      if (slot + 1 < perLane) {
        relationships.push({
          id: `r-dep-${String(stageIndex).padStart(3, '0')}-${String(slot).padStart(2, '0')}`,
          kind: 'depends_on',
          fromElementId: elementId(stageIndex, 2, slot),
          toElementId: elementId(stageIndex, 2, slot + 1)
        });
      }
    }
  });
  const map = blueprint({ stages, elements, relationships });

  const startedAt = process.hrtime.bigint();
  const first = analyseServiceBlueprint(map);
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  const second = analyseServiceBlueprint(map);

  assert.equal(first.valid, true);
  assert.deepEqual(first.issues, []);
  assert.equal(elements.length, stageCount * journeyBlueprintLanes.length * perLane);
  assert.equal(first.coverage.frontstageElements, stageCount * perLane);
  assert.equal(first.coverage.supportedFrontstageElements, stageCount * perLane);
  assert.equal(first.coverage.systemSupportedBackstageElements, stageCount * perLane);
  // Determinism is a contract, not an accident of iteration order.
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  // Guards against a return to quadratic behaviour, not a benchmark; the ceiling leaves ample
  // headroom for a slow CI machine while still discriminating an accidental O(n^2) regression.
  assert.ok(elapsedMs < 1_000, `blueprint analysis took ${elapsedMs.toFixed(0)}ms`);
});
