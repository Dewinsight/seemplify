import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  JourneyHierarchyError, journeyHierarchyBreadcrumbTrails, journeyHierarchyBreadcrumbs,
  rollUpJourneyHierarchyHealth, traverseJourneyHierarchy, validateJourneyHierarchy,
  type JourneyHierarchyHealthObservation, type JourneyHierarchyHealthPolicy,
  type JourneyHierarchyLimits, type JourneyHierarchyLink, type JourneyHierarchyLinkType,
  type JourneyHierarchyNode
} from '../src/journeyHierarchy.js';

const nodes: JourneyHierarchyNode[] = [
  { definitionId: 'activation', spaceId: 'space-a' },
  { definitionId: 'onboarding', spaceId: 'space-a' },
  { definitionId: 'support', spaceId: 'space-a' },
  { definitionId: 'verification', spaceId: 'space-a' }
];

function link(input: Partial<JourneyHierarchyLink> & Pick<JourneyHierarchyLink, 'id' | 'type' | 'fromDefinitionId' | 'toDefinitionId'>): JourneyHierarchyLink {
  return { spaceId: 'space-a', fromStageKey: null, toStageKey: null, ...input };
}

function node(definitionId: string, extra: Partial<JourneyHierarchyNode> = {}): JourneyHierarchyNode {
  return { definitionId, spaceId: 'space-a', ...extra };
}

const policy: JourneyHierarchyHealthPolicy = {
  version: 'policy-v1', ownWeight: 0.5, missingChild: 'exclude', healthyAt: 80, watchAt: 50
};

function observation(
  definitionId: string, score: number | null, sourceRevision: string
): JourneyHierarchyHealthObservation {
  return { definitionId, score, observedAt: '2026-08-05T00:00:00.000Z', sourceRevision };
}

/** Feeds a value the compile-time contract forbids, so the runtime guard itself is what gets tested. */
function unexpected<T>(value: string) {
  return value as unknown as T;
}

function codeOf(run: () => unknown) {
  try {
    run();
  } catch (error) {
    if (error instanceof JourneyHierarchyError) return error.code;
    throw error;
  }
  return 'NO_ERROR';
}

test('builds deterministic containment roots, order, children, and depth', () => {
  const result = validateJourneyHierarchy(nodes, [
    link({ id: '2', type: 'stage_subjourney', fromDefinitionId: 'onboarding', toDefinitionId: 'verification', fromStageKey: 'verify' }),
    link({ id: '1', type: 'parent_child', fromDefinitionId: 'activation', toDefinitionId: 'onboarding' }),
    link({ id: '3', type: 'parent_child', fromDefinitionId: 'activation', toDefinitionId: 'support' }),
    link({ id: '4', type: 'handoff', fromDefinitionId: 'onboarding', toDefinitionId: 'support', fromStageKey: 'finish', toStageKey: 'start' })
  ]);
  assert.equal(result.spaceId, 'space-a');
  assert.deepEqual(result.roots, ['activation']);
  assert.deepEqual(result.topologicalOrder, ['activation', 'onboarding', 'support', 'verification']);
  assert.equal(result.maximumDepth, 2);
  assert.deepEqual(result.childIdsByParent, Object.assign(Object.create(null), {
    activation: ['onboarding', 'support'], onboarding: ['verification']
  }));
  assert.deepEqual(result.childEntries, [
    { parentDefinitionId: 'activation', childDefinitionIds: ['onboarding', 'support'] },
    { parentDefinitionId: 'onboarding', childDefinitionIds: ['verification'] }
  ]);
});

test('rejects cross-space, missing, self, duplicate, and incomplete stage links', () => {
  const cases: Array<{ expected: JourneyHierarchyError['code']; graph: JourneyHierarchyNode[]; links: JourneyHierarchyLink[] }> = [
    { expected: 'JOURNEY_HIERARCHY_CROSS_SPACE', graph: [...nodes, { definitionId: 'foreign', spaceId: 'space-b' }],
      links: [link({ id: 'foreign', type: 'related', fromDefinitionId: 'activation', toDefinitionId: 'foreign' })] },
    { expected: 'JOURNEY_HIERARCHY_NODE_NOT_FOUND', graph: nodes,
      links: [link({ id: 'missing', type: 'related', fromDefinitionId: 'activation', toDefinitionId: 'unknown' })] },
    { expected: 'JOURNEY_HIERARCHY_SELF_LINK', graph: nodes,
      links: [link({ id: 'self', type: 'related', fromDefinitionId: 'activation', toDefinitionId: 'activation' })] },
    { expected: 'JOURNEY_HIERARCHY_DUPLICATE_LINK', graph: nodes,
      links: [link({ id: 'd1', type: 'related', fromDefinitionId: 'activation', toDefinitionId: 'support' }),
        link({ id: 'd2', type: 'related', fromDefinitionId: 'activation', toDefinitionId: 'support' })] },
    { expected: 'JOURNEY_HIERARCHY_STAGE_REQUIRED', graph: nodes,
      links: [link({ id: 'stage', type: 'stage_subjourney', fromDefinitionId: 'activation', toDefinitionId: 'support' })] },
    { expected: 'JOURNEY_HIERARCHY_STAGE_REQUIRED', graph: nodes,
      links: [link({ id: 'handoff', type: 'handoff', fromDefinitionId: 'activation', toDefinitionId: 'support', fromStageKey: 'end' })] }
  ];
  for (const scenario of cases) {
    assert.throws(() => validateJourneyHierarchy(scenario.graph, scenario.links),
      (error) => error instanceof JourneyHierarchyError && error.code === scenario.expected);
  }
});

test('rejects containment cycles without treating related links as containment', () => {
  const allowed = validateJourneyHierarchy(nodes.slice(0, 2), [
    link({ id: 'a', type: 'related', fromDefinitionId: 'activation', toDefinitionId: 'onboarding' }),
    link({ id: 'b', type: 'related', fromDefinitionId: 'onboarding', toDefinitionId: 'activation' })
  ]);
  assert.deepEqual(allowed.roots, ['activation', 'onboarding']);

  assert.throws(() => validateJourneyHierarchy(nodes.slice(0, 2), [
    link({ id: 'a', type: 'parent_child', fromDefinitionId: 'activation', toDefinitionId: 'onboarding' }),
    link({ id: 'b', type: 'parent_child', fromDefinitionId: 'onboarding', toDefinitionId: 'activation' })
  ]), (error) => error instanceof JourneyHierarchyError && error.code === 'JOURNEY_HIERARCHY_CYCLE');
});

test('enforces bounded nodes, links, and containment depth', () => {
  assert.throws(() => validateJourneyHierarchy(nodes, [], { nodes: 3, links: 10, depth: 10 }),
    (error) => error instanceof JourneyHierarchyError && error.code === 'JOURNEY_HIERARCHY_LIMIT');

  const chainNodes = Array.from({ length: 5 }, (_, index) => ({ definitionId: `n${index}`, spaceId: 'space-a' }));
  const chainLinks = chainNodes.slice(0, -1).map((entry, index) => link({
    id: `link${index}`, type: 'parent_child', fromDefinitionId: entry.definitionId,
    toDefinitionId: chainNodes[index + 1].definitionId
  }));
  assert.throws(() => validateJourneyHierarchy(chainNodes, chainLinks, { nodes: 10, links: 10, depth: 3 }),
    (error) => error instanceof JourneyHierarchyError && error.code === 'JOURNEY_HIERARCHY_DEPTH');
});

test('budgets links against the active count, the way runtime-29 counts them', () => {
  const graph = [node('a'), node('b'), node('c')];
  // runtime-29 counts only `lifecycle='active'` rows against `maximum_links`, so a graph that
  // Postgres accepts must not be rejected here purely because it carries retired history.
  const mostlyRetired = validateJourneyHierarchy(graph, [
    link({ id: 'r1', type: 'related', fromDefinitionId: 'a', toDefinitionId: 'b', lifecycle: 'retired' }),
    link({ id: 'r2', type: 'related', fromDefinitionId: 'a', toDefinitionId: 'c', lifecycle: 'retired' }),
    link({ id: 'a1', type: 'related', fromDefinitionId: 'b', toDefinitionId: 'c' })
  ], { nodes: 10, links: 1, depth: 3 });
  assert.deepEqual(mostlyRetired.roots, ['a', 'b', 'c']);

  assert.equal(codeOf(() => validateJourneyHierarchy(graph, [
    link({ id: 'a1', type: 'related', fromDefinitionId: 'a', toDefinitionId: 'b' }),
    link({ id: 'a2', type: 'related', fromDefinitionId: 'a', toDefinitionId: 'c' })
  ], { nodes: 10, links: 1, depth: 3 })), 'JOURNEY_HIERARCHY_LIMIT');
});

test('isolates tenants at the node set, not only at each link', () => {
  assert.throws(() => validateJourneyHierarchy([node('a'), { definitionId: 'b', spaceId: 'space-b' }], []),
    (error) => error instanceof JourneyHierarchyError && error.code === 'JOURNEY_HIERARCHY_CROSS_SPACE'
      && Array.isArray(error.details.spaceIds) && error.details.spaceIds.length === 2);
  assert.equal(validateJourneyHierarchy([], []).spaceId, null);
});

test('rejects duplicate journey definitions and duplicate link IDs distinctly', () => {
  assert.equal(codeOf(() => validateJourneyHierarchy([node('a'), node('a')], [])), 'JOURNEY_HIERARCHY_DUPLICATE_NODE');
  assert.equal(codeOf(() => validateJourneyHierarchy([node('a'), node('b'), node('c')], [
    link({ id: 'same', type: 'related', fromDefinitionId: 'a', toDefinitionId: 'b' }),
    link({ id: 'same', type: 'related', fromDefinitionId: 'a', toDefinitionId: 'c' })
  ])), 'JOURNEY_HIERARCHY_DUPLICATE_LINK');
});

test('mirrors the runtime-29 link shape contract, including variant identity', () => {
  const graph = [node('a'), node('b')];
  const shapeCases: Array<{ expected: JourneyHierarchyError['code']; link: JourneyHierarchyLink }> = [
    { expected: 'JOURNEY_HIERARCHY_LINK_SHAPE',
      link: link({ id: 'l', type: 'parent_child', fromDefinitionId: 'a', toDefinitionId: 'b', fromStageKey: 'x' }) },
    { expected: 'JOURNEY_HIERARCHY_LINK_SHAPE',
      link: link({ id: 'l', type: 'related', fromDefinitionId: 'a', toDefinitionId: 'b', toStageKey: 'x' }) },
    { expected: 'JOURNEY_HIERARCHY_LINK_SHAPE',
      link: link({ id: 'l', type: 'stage_subjourney', fromDefinitionId: 'a', toDefinitionId: 'b', fromStageKey: 'x', toStageKey: 'y' }) },
    { expected: 'JOURNEY_HIERARCHY_LINK_SHAPE',
      link: link({ id: 'l', type: 'variant', fromDefinitionId: 'a', toDefinitionId: 'b' }) },
    { expected: 'JOURNEY_HIERARCHY_LINK_SHAPE',
      link: link({ id: 'l', type: 'variant', fromDefinitionId: 'a', toDefinitionId: 'b', variantDimension: 'persona' }) },
    { expected: 'JOURNEY_HIERARCHY_LINK_SHAPE',
      link: link({ id: 'l', type: 'variant', fromDefinitionId: 'a', toDefinitionId: 'b', variantDimension: 'persona', variantValueId: 'enterprise', fromStageKey: 'x' }) },
    { expected: 'JOURNEY_HIERARCHY_LINK_SHAPE',
      link: link({ id: 'l', type: 'handoff', fromDefinitionId: 'a', toDefinitionId: 'b', fromStageKey: 'x', toStageKey: 'y', variantDimension: 'persona' }) }
  ];
  for (const scenario of shapeCases) {
    assert.equal(codeOf(() => validateJourneyHierarchy(graph, [scenario.link])), scenario.expected);
  }

  const twoDimensions = validateJourneyHierarchy(graph, [
    link({ id: 'v1', type: 'variant', fromDefinitionId: 'a', toDefinitionId: 'b', variantDimension: 'persona', variantValueId: 'enterprise' }),
    link({ id: 'v2', type: 'variant', fromDefinitionId: 'a', toDefinitionId: 'b', variantDimension: 'geography', variantValueId: 'emea' })
  ]);
  assert.deepEqual(twoDimensions.roots, ['a', 'b']);

  assert.equal(codeOf(() => validateJourneyHierarchy(graph, [
    link({ id: 'v1', type: 'variant', fromDefinitionId: 'a', toDefinitionId: 'b', variantDimension: 'persona', variantValueId: 'enterprise' }),
    link({ id: 'v2', type: 'variant', fromDefinitionId: 'a', toDefinitionId: 'b', variantDimension: 'persona', variantValueId: 'enterprise' })
  ])), 'JOURNEY_HIERARCHY_DUPLICATE_LINK');
});

test('retired links leave the active containment graph but keep their logical identity', () => {
  const graph = [node('a'), node('b')];
  const withRetiredBackEdge = validateJourneyHierarchy(graph, [
    link({ id: 'l1', type: 'parent_child', fromDefinitionId: 'a', toDefinitionId: 'b' }),
    link({ id: 'l2', type: 'parent_child', fromDefinitionId: 'b', toDefinitionId: 'a', lifecycle: 'retired' })
  ]);
  assert.deepEqual(withRetiredBackEdge.roots, ['a']);
  assert.deepEqual(withRetiredBackEdge.childIdsByParent, Object.assign(Object.create(null), { a: ['b'] }));

  assert.equal(codeOf(() => validateJourneyHierarchy(graph, [
    link({ id: 'l1', type: 'parent_child', fromDefinitionId: 'a', toDefinitionId: 'b', lifecycle: 'retired' }),
    link({ id: 'l2', type: 'parent_child', fromDefinitionId: 'a', toDefinitionId: 'b', lifecycle: 'retired' })
  ])), 'JOURNEY_HIERARCHY_DUPLICATE_LINK');
});

test('checks stage membership only when a journey declares its stage keys', () => {
  const declared = [node('parent', { stageKeys: ['verify', 'finish'] }), node('child')];
  assert.deepEqual(validateJourneyHierarchy(declared, [
    link({ id: 'l1', type: 'stage_subjourney', fromDefinitionId: 'parent', toDefinitionId: 'child', fromStageKey: 'verify' })
  ]).roots, ['parent']);

  assert.equal(codeOf(() => validateJourneyHierarchy(declared, [
    link({ id: 'l1', type: 'stage_subjourney', fromDefinitionId: 'parent', toDefinitionId: 'child', fromStageKey: 'ghost' })
  ])), 'JOURNEY_HIERARCHY_STAGE_NOT_FOUND');

  assert.deepEqual(validateJourneyHierarchy([node('parent'), node('child')], [
    link({ id: 'l1', type: 'stage_subjourney', fromDefinitionId: 'parent', toDefinitionId: 'child', fromStageKey: 'ghost' })
  ]).roots, ['parent']);
});

test('rejects malformed identifiers, limits, enums, and metadata', () => {
  const pair = [node('a'), node('b')];
  const relate = (extra: Partial<JourneyHierarchyLink>) => [
    link({ id: 'l1', type: 'related', fromDefinitionId: 'a', toDefinitionId: 'b', ...extra })
  ];
  const badLimits: JourneyHierarchyLimits[] = [
    { nodes: Number.NaN, links: Number.NaN, depth: Number.NaN },
    { nodes: 0, links: 10, depth: 3 },
    { nodes: 10, links: 10, depth: 0 },
    { nodes: 10, links: 10, depth: 33 },
    { nodes: 1.5, links: 10, depth: 3 }
  ];
  for (const limits of badLimits) {
    assert.equal(codeOf(() => validateJourneyHierarchy(pair, [], limits)), 'JOURNEY_HIERARCHY_INVALID_INPUT');
  }

  assert.equal(codeOf(() => validateJourneyHierarchy([node('')], [])), 'JOURNEY_HIERARCHY_INVALID_INPUT');
  assert.equal(codeOf(() => validateJourneyHierarchy([node('has space')], [])), 'JOURNEY_HIERARCHY_INVALID_INPUT');
  assert.equal(codeOf(() => validateJourneyHierarchy([{ definitionId: 'a', spaceId: '-bad' }], [])), 'JOURNEY_HIERARCHY_INVALID_INPUT');
  assert.equal(codeOf(() => validateJourneyHierarchy([node('a', { stageKeys: ['x'.repeat(81)] })], [])), 'JOURNEY_HIERARCHY_INVALID_INPUT');
  assert.equal(codeOf(() => validateJourneyHierarchy([node('a', { stageKeys: ['x', 'x'] })], [])), 'JOURNEY_HIERARCHY_INVALID_INPUT');
  assert.equal(codeOf(() => validateJourneyHierarchy([node('a', { taxonomyTermIds: ['bad term'] })], [])), 'JOURNEY_HIERARCHY_INVALID_INPUT');
  assert.equal(codeOf(() => validateJourneyHierarchy([node('a', { ownerUserId: 'bad owner' })], [])), 'JOURNEY_HIERARCHY_INVALID_INPUT');
  assert.equal(codeOf(() => validateJourneyHierarchy(pair, relate({ id: '' }))), 'JOURNEY_HIERARCHY_INVALID_INPUT');
  assert.equal(codeOf(() => validateJourneyHierarchy(pair, relate({ type: unexpected<JourneyHierarchyLinkType>('sideways') }))), 'JOURNEY_HIERARCHY_INVALID_INPUT');
  assert.equal(codeOf(() => validateJourneyHierarchy(pair, relate({ lifecycle: unexpected<'active'>('paused') }))), 'JOURNEY_HIERARCHY_INVALID_INPUT');
  assert.equal(codeOf(() => validateJourneyHierarchy(pair, relate({ reviewState: unexpected<'draft'>('maybe') }))), 'JOURNEY_HIERARCHY_INVALID_INPUT');
  assert.equal(codeOf(() => validateJourneyHierarchy(pair, relate({ handoffOwnerUserId: 'bad owner' }))), 'JOURNEY_HIERARCHY_INVALID_INPUT');
  assert.equal(codeOf(() => validateJourneyHierarchy(pair, [
    link({ id: 'l1', type: 'variant', fromDefinitionId: 'a', toDefinitionId: 'b', variantDimension: unexpected<'persona'>('galaxy'), variantValueId: 'x' })
  ])), 'JOURNEY_HIERARCHY_INVALID_INPUT');
  assert.equal(codeOf(() => validateJourneyHierarchy(pair, [
    link({ id: 'l1', type: 'handoff', fromDefinitionId: 'a', toDefinitionId: 'b', fromStageKey: 'x'.repeat(81), toStageKey: 'y' })
  ])), 'JOURNEY_HIERARCHY_INVALID_INPUT');
});

test('reports malformed link endpoints as input errors, not as missing journeys', () => {
  const pair = [node('a'), node('b')];
  // A malformed endpoint is a shape problem; reporting it as NODE_NOT_FOUND invents a journey
  // that was never named and hands the redactor a value it cannot classify.
  assert.equal(codeOf(() => validateJourneyHierarchy(pair, [
    link({ id: 'l1', type: 'related', fromDefinitionId: 'a', toDefinitionId: '' })
  ])), 'JOURNEY_HIERARCHY_INVALID_INPUT');
  assert.equal(codeOf(() => validateJourneyHierarchy(pair, [
    link({ id: 'l1', type: 'related', fromDefinitionId: 'has space', toDefinitionId: 'b' })
  ])), 'JOURNEY_HIERARCHY_INVALID_INPUT');
  // A well-formed identifier that simply is not in the graph stays a missing-journey error.
  assert.equal(codeOf(() => validateJourneyHierarchy(pair, [
    link({ id: 'l1', type: 'related', fromDefinitionId: 'a', toDefinitionId: 'absent' })
  ])), 'JOURNEY_HIERARCHY_NODE_NOT_FOUND');
});

test('orders parent keys by code unit and exposes an order-stable child projection', () => {
  const cased = validateJourneyHierarchy(
    [node('B'), node('a'), node('B-child'), node('a-child')],
    [link({ id: 'l1', type: 'parent_child', fromDefinitionId: 'B', toDefinitionId: 'B-child' }),
      link({ id: 'l2', type: 'parent_child', fromDefinitionId: 'a', toDefinitionId: 'a-child' })]
  );
  assert.deepEqual(cased.childEntries.map((entry) => entry.parentDefinitionId), ['B', 'a']);

  const numeric = validateJourneyHierarchy(
    [node('10'), node('2'), node('10-child'), node('2-child')],
    [link({ id: 'l1', type: 'parent_child', fromDefinitionId: '10', toDefinitionId: '10-child' }),
      link({ id: 'l2', type: 'parent_child', fromDefinitionId: '2', toDefinitionId: '2-child' })]
  );
  assert.deepEqual(numeric.childEntries.map((entry) => entry.parentDefinitionId), ['10', '2']);
  // Plain-object keys are re-ordered numerically by the engine, which is why childEntries exists.
  assert.deepEqual(Object.keys(numeric.childIdsByParent), ['2', '10']);
});

test('exposes a child projection that cannot inherit Object.prototype members', () => {
  const result = validateJourneyHierarchy([node('toString'), node('valueOf')], [
    link({ id: 'l1', type: 'parent_child', fromDefinitionId: 'toString', toDefinitionId: 'valueOf' })
  ]);
  assert.equal(Object.getPrototypeOf(result.childIdsByParent), null);
  assert.deepEqual(result.childIdsByParent['toString'], ['valueOf']);
  // A caller writing `childIdsByParent[id] ?? []` must not be handed a Function for an unrelated journey.
  for (const inherited of ['constructor', 'hasOwnProperty', 'valueOf', 'isPrototypeOf']) {
    assert.equal(result.childIdsByParent[inherited], undefined, `${inherited} must not be inherited`);
  }
});

test('rolls health up with an explanation that names the branch that produced the score', () => {
  const results = rollUpJourneyHierarchyHealth(nodes, [
    link({ id: '1', type: 'parent_child', fromDefinitionId: 'activation', toDefinitionId: 'onboarding' }),
    link({ id: '3', type: 'parent_child', fromDefinitionId: 'activation', toDefinitionId: 'support' }),
    link({ id: '2', type: 'stage_subjourney', fromDefinitionId: 'onboarding', toDefinitionId: 'verification', fromStageKey: 'verify' })
  ], [
    observation('onboarding', 60, 'rev-2'),
    observation('support', 90, 'rev-3'),
    observation('verification', 40, 'rev-4')
  ], policy);

  assert.deepEqual(results.map((entry) => entry.definitionId), ['activation', 'onboarding', 'support', 'verification']);
  const byId = new Map(results.map((entry) => [entry.definitionId, entry]));

  const activation = byId.get('activation')!;
  assert.equal(activation.own, null);
  assert.equal(activation.score, 70);
  assert.equal(activation.status, 'watch');
  assert.equal(activation.explanation, 'Score 70 is the equal-weight mean of 2 scored direct children.');
  assert.deepEqual(activation.children, [
    { definitionId: 'onboarding', score: 50, effectiveWeight: 0.5 },
    { definitionId: 'support', score: 90, effectiveWeight: 0.5 }
  ]);
  assert.deepEqual(activation.lineage, ['onboarding@rev-2', 'support@rev-3', 'verification@rev-4']);
  assert.equal(activation.policyVersion, 'policy-v1');

  const onboarding = byId.get('onboarding')!;
  assert.equal(onboarding.score, 50);
  assert.equal(onboarding.status, 'watch');
  assert.equal(onboarding.explanation,
    'Score 50 combines this journey at weight 0.5 and 1 scored direct child at total weight 0.5.');

  const support = byId.get('support')!;
  assert.equal(support.explanation, "Score 90 comes from this journey's exact observation.");
  assert.equal(support.status, 'healthy');
  assert.equal(byId.get('verification')!.status, 'at_risk');
});

test('projects weights and explanations without floating-point artefacts', () => {
  // 1 - 0.7 is 0.30000000000000004 in IEEE-754; neither the weight nor the prose may show that.
  const single = rollUpJourneyHierarchyHealth(nodes.slice(0, 2), [
    link({ id: 'l1', type: 'parent_child', fromDefinitionId: 'activation', toDefinitionId: 'onboarding' })
  ], [observation('activation', 80, 'rev-1'), observation('onboarding', 60, 'rev-2')],
  { ...policy, ownWeight: 0.7 });
  const singleParent = single.find((entry) => entry.definitionId === 'activation')!;
  assert.equal(singleParent.children[0].effectiveWeight, 0.3);
  assert.equal(singleParent.score, 74);
  assert.equal(singleParent.explanation,
    'Score 74 combines this journey at weight 0.7 and 1 scored direct child at total weight 0.3.');

  // 0.3 / 3 is 0.09999999999999999; the shown weights must still total the shown total weight.
  const spread = rollUpJourneyHierarchyHealth(
    [node('p'), node('c1'), node('c2'), node('c3')],
    ['c1', 'c2', 'c3'].map((child, index) => link({
      id: `l${index}`, type: 'parent_child', fromDefinitionId: 'p', toDefinitionId: child
    })),
    [observation('p', 80, 'rev-1'), observation('c1', 60, 'rev-2'),
      observation('c2', 60, 'rev-3'), observation('c3', 60, 'rev-4')],
    { ...policy, ownWeight: 0.7 }
  );
  const spreadParent = spread.find((entry) => entry.definitionId === 'p')!;
  assert.deepEqual(spreadParent.children.map((child) => child.effectiveWeight), [0.1, 0.1, 0.1]);
  assert.equal(spreadParent.explanation,
    'Score 74 combines this journey at weight 0.7 and 3 scored direct children at total weight 0.3.');

  for (const entry of [...single, ...spread]) {
    assert.ok(!/\d\.\d{7,}/u.test(entry.explanation), `explanation leaks raw float: ${entry.explanation}`);
    for (const child of entry.children) {
      assert.ok(!/\d\.\d{7,}/u.test(String(child.effectiveWeight)), `weight leaks raw float: ${child.effectiveWeight}`);
    }
  }
});

test('never coerces a missing health value to zero and honours the missing-child policy', () => {
  const links = [
    link({ id: 'l1', type: 'parent_child', fromDefinitionId: 'activation', toDefinitionId: 'onboarding' }),
    link({ id: 'l2', type: 'parent_child', fromDefinitionId: 'activation', toDefinitionId: 'support' })
  ];
  const partial = [observation('onboarding', 40, 'rev-2')];

  const excluded = rollUpJourneyHierarchyHealth(nodes.slice(0, 3), links, partial, policy);
  const excludedParent = excluded.find((entry) => entry.definitionId === 'activation')!;
  assert.equal(excludedParent.score, 40);
  assert.equal(excludedParent.explanation, 'Score 40 is the equal-weight mean of 1 scored direct child.');
  assert.deepEqual(excludedParent.children, [
    { definitionId: 'onboarding', score: 40, effectiveWeight: 1 },
    { definitionId: 'support', score: null, effectiveWeight: 0 }
  ]);

  const strict = rollUpJourneyHierarchyHealth(nodes.slice(0, 3), links, partial, { ...policy, missingChild: 'unknown' });
  const strictParent = strict.find((entry) => entry.definitionId === 'activation')!;
  assert.equal(strictParent.score, null);
  assert.equal(strictParent.status, 'unknown');
  assert.equal(strictParent.explanation, 'Health is unknown because the policy requires every direct child to have a score.');

  const unscored = rollUpJourneyHierarchyHealth(nodes.slice(0, 2), [links[0]],
    [observation('activation', null, 'rev-1'), observation('onboarding', 80, 'rev-2')], policy);
  const unscoredParent = unscored.find((entry) => entry.definitionId === 'activation')!;
  assert.equal(unscoredParent.score, 80);
  assert.equal(unscoredParent.explanation, 'Score 80 is the equal-weight mean of 1 scored direct child.');

  const silent = rollUpJourneyHierarchyHealth(nodes.slice(0, 2), [links[0]], [], policy);
  assert.equal(silent.find((entry) => entry.definitionId === 'activation')!.explanation,
    'Health is unknown because neither this journey nor its scored direct children have a value.');
});

test('rolls up graphs whose journey IDs collide with Object.prototype members', () => {
  const results = rollUpJourneyHierarchyHealth(
    [node('constructor'), node('toString'), node('valueOf')],
    [link({ id: 'l1', type: 'parent_child', fromDefinitionId: 'constructor', toDefinitionId: 'toString' }),
      link({ id: 'l2', type: 'parent_child', fromDefinitionId: 'constructor', toDefinitionId: 'valueOf' })],
    [observation('toString', 60, 'rev-1'), observation('valueOf', 80, 'rev-2')],
    policy
  );
  const parent = results.find((entry) => entry.definitionId === 'constructor')!;
  assert.equal(parent.score, 70);
  assert.equal(parent.explanation, 'Score 70 is the equal-weight mean of 2 scored direct children.');
});

test('rejects malformed health policies and observations as typed input errors', () => {
  const graph = nodes.slice(0, 2);
  const badPolicies: JourneyHierarchyHealthPolicy[] = [
    { ...policy, version: '  ' },
    { ...policy, ownWeight: 1.5 },
    { ...policy, ownWeight: Number.NaN },
    { ...policy, missingChild: unexpected<'exclude'>('sometimes') },
    { ...policy, healthyAt: 40, watchAt: 60 }
  ];
  for (const badPolicy of badPolicies) {
    assert.equal(codeOf(() => rollUpJourneyHierarchyHealth(graph, [], [], badPolicy)), 'JOURNEY_HIERARCHY_INVALID_INPUT');
  }

  assert.equal(codeOf(() => rollUpJourneyHierarchyHealth(graph, [], [observation('activation', 150, 'rev-1')], policy)),
    'JOURNEY_HIERARCHY_INVALID_INPUT');
  assert.equal(codeOf(() => rollUpJourneyHierarchyHealth(graph, [],
    [{ definitionId: 'activation', score: 50, observedAt: 'not-a-date', sourceRevision: 'rev-1' }], policy)),
  'JOURNEY_HIERARCHY_INVALID_INPUT');
  assert.equal(codeOf(() => rollUpJourneyHierarchyHealth(graph, [], [observation('activation', 50, ' ')], policy)),
    'JOURNEY_HIERARCHY_INVALID_INPUT');
  assert.equal(codeOf(() => rollUpJourneyHierarchyHealth(graph, [], [observation('ghost', 50, 'rev-1')], policy)),
    'JOURNEY_HIERARCHY_NODE_NOT_FOUND');
  assert.equal(codeOf(() => rollUpJourneyHierarchyHealth(graph, [],
    [observation('activation', 50, 'rev-1'), observation('activation', 60, 'rev-2')], policy)),
  'JOURNEY_HIERARCHY_DUPLICATE_OBSERVATION');
});

test('bounds revision and policy version strings so lineage cannot grow without limit', () => {
  const graph = nodes.slice(0, 1);
  // Every revision is concatenated into `lineage` for each ancestor, and runtime-29 caps the
  // persisted lineage at 131072 bytes, so an unbounded revision is not round-trippable.
  assert.equal(codeOf(() => rollUpJourneyHierarchyHealth(graph, [],
    [observation('activation', 50, 'r'.repeat(129))], policy)), 'JOURNEY_HIERARCHY_INVALID_INPUT');
  assert.equal(codeOf(() => rollUpJourneyHierarchyHealth(graph, [], [],
    { ...policy, version: 'v'.repeat(129) })), 'JOURNEY_HIERARCHY_INVALID_INPUT');

  const atLimit = rollUpJourneyHierarchyHealth(graph, [],
    [observation('activation', 50, 'r'.repeat(128))], { ...policy, version: 'v'.repeat(128) });
  assert.equal(atLimit[0].score, 50);
  assert.equal(atLimit[0].lineage[0].length, 'activation@'.length + 128);
});

test('returns health observations the caller cannot mutate through the result', () => {
  const source = observation('activation', 90, 'rev-1');
  const results = rollUpJourneyHierarchyHealth(nodes.slice(0, 1), [], [source], policy);
  assert.notEqual(results[0].own, source);
  assert.deepEqual(results[0].own, source);
  source.score = 10;
  assert.equal(results[0].own!.score, 90);
});

test('traverses impact deterministically in every direction and link-type filter', () => {
  const graph = [node('a'), node('b'), node('c'), node('d')];
  const links = [
    link({ id: 'l1', type: 'parent_child', fromDefinitionId: 'a', toDefinitionId: 'b' }),
    link({ id: 'l2', type: 'parent_child', fromDefinitionId: 'b', toDefinitionId: 'c' }),
    link({ id: 'l3', type: 'related', fromDefinitionId: 'a', toDefinitionId: 'd' })
  ];
  const permitted = new Set(['a', 'b', 'c', 'd']);

  const downstream = traverseJourneyHierarchy({ nodes: graph, links, startDefinitionId: 'a', direction: 'downstream', permittedDefinitionIds: permitted });
  assert.deepEqual(downstream.definitionIds, ['a', 'b', 'c', 'd']);
  assert.deepEqual(downstream.linkIds, ['l1', 'l2', 'l3']);
  assert.equal(downstream.inaccessibleLinkCount, 0);
  assert.equal(downstream.truncated, false);

  const upstream = traverseJourneyHierarchy({ nodes: graph, links, startDefinitionId: 'c', direction: 'upstream', permittedDefinitionIds: permitted });
  assert.deepEqual(upstream.definitionIds, ['a', 'b', 'c']);
  assert.deepEqual(upstream.linkIds, ['l1', 'l2']);

  const containmentOnly = traverseJourneyHierarchy({
    nodes: graph, links, startDefinitionId: 'a', direction: 'downstream',
    permittedDefinitionIds: permitted, linkTypes: ['parent_child']
  });
  assert.deepEqual(containmentOnly.definitionIds, ['a', 'b', 'c']);
  assert.deepEqual(containmentOnly.linkIds, ['l1', 'l2']);

  const retired = traverseJourneyHierarchy({
    nodes: graph, startDefinitionId: 'a', direction: 'downstream', permittedDefinitionIds: permitted,
    links: [links[0], links[1], { ...links[2], lifecycle: 'retired' as const }]
  });
  assert.deepEqual(retired.definitionIds, ['a', 'b', 'c']);
  assert.deepEqual(retired.linkIds, ['l1', 'l2']);
});

test('keeps hidden journeys out of traversal results, counts, and validation details', () => {
  const graph = [node('a'), node('b'), node('c'), node('d')];
  const links = [
    link({ id: 'l1', type: 'parent_child', fromDefinitionId: 'a', toDefinitionId: 'b' }),
    link({ id: 'l2', type: 'parent_child', fromDefinitionId: 'b', toDefinitionId: 'c' }),
    link({ id: 'l3', type: 'related', fromDefinitionId: 'a', toDefinitionId: 'd' })
  ];
  const filtered = traverseJourneyHierarchy({
    nodes: graph, links, startDefinitionId: 'a', direction: 'downstream',
    permittedDefinitionIds: new Set(['a', 'b', 'c'])
  });
  assert.deepEqual(filtered.definitionIds, ['a', 'b', 'c']);
  assert.deepEqual(filtered.linkIds, ['l1', 'l2']);
  assert.equal(filtered.inaccessibleLinkCount, 1);

  assert.throws(() => traverseJourneyHierarchy({
    nodes: graph, startDefinitionId: 'a', direction: 'downstream', permittedDefinitionIds: new Set(['a']),
    links: [link({ id: 'c1', type: 'parent_child', fromDefinitionId: 'c', toDefinitionId: 'd' }),
      link({ id: 'c2', type: 'parent_child', fromDefinitionId: 'd', toDefinitionId: 'c' })]
  }), (error) => error instanceof JourneyHierarchyError && error.code === 'JOURNEY_HIERARCHY_CYCLE'
    && Array.isArray(error.details.cycleDefinitionIds) && error.details.cycleDefinitionIds.length === 0
    && error.details.hiddenDefinitionIdCount === 2);
});

test('redacts link and space identifiers from permission-filtered validation failures', () => {
  // The caller may see only 'a'; the failing link joins two journeys it cannot see, so neither
  // the link ID nor the endpoints may appear in the error it receives.
  assert.throws(() => traverseJourneyHierarchy({
    nodes: [node('a'), node('c'), node('d')],
    links: [link({ id: 'secret-link', type: 'variant', fromDefinitionId: 'c', toDefinitionId: 'd' })],
    startDefinitionId: 'a', direction: 'downstream', permittedDefinitionIds: new Set(['a'])
  }), (error) => error instanceof JourneyHierarchyError
    && error.code === 'JOURNEY_HIERARCHY_LINK_SHAPE'
    && error.details.linkId === undefined
    && error.details.hiddenLinkIdCount === 1
    && error.details.field === 'variantDimension'
    && !JSON.stringify(error.details).includes('secret-link'));

  // A cross-space node set must not disclose the other tenant's space ID.
  assert.throws(() => traverseJourneyHierarchy({
    nodes: [node('a'), { definitionId: 'b', spaceId: 'space-secret' }], links: [],
    startDefinitionId: 'a', direction: 'downstream', permittedDefinitionIds: new Set(['a'])
  }), (error) => error instanceof JourneyHierarchyError
    && error.code === 'JOURNEY_HIERARCHY_CROSS_SPACE'
    && error.details.spaceIds === undefined
    && !JSON.stringify(error.details).includes('space-secret'));

  // The unfiltered entry point keeps full detail for operators.
  assert.throws(() => validateJourneyHierarchy(
    [node('a'), node('c'), node('d')],
    [link({ id: 'secret-link', type: 'variant', fromDefinitionId: 'c', toDefinitionId: 'd' })]
  ), (error) => error instanceof JourneyHierarchyError && error.details.linkId === 'secret-link');
});

test('truncated traversal never returns a link ID whose endpoint was dropped', () => {
  const graph = [node('a'), node('b'), node('c'), node('d')];
  const links = [
    link({ id: 'l1', type: 'parent_child', fromDefinitionId: 'a', toDefinitionId: 'b' }),
    link({ id: 'l2', type: 'parent_child', fromDefinitionId: 'b', toDefinitionId: 'c' }),
    link({ id: 'l3', type: 'related', fromDefinitionId: 'a', toDefinitionId: 'd' })
  ];
  const result = traverseJourneyHierarchy({
    nodes: graph, links, startDefinitionId: 'a', direction: 'downstream',
    permittedDefinitionIds: new Set(['a', 'b', 'c', 'd']), maximumNodes: 2
  });
  assert.equal(result.truncated, true);
  assert.deepEqual(result.definitionIds, ['a', 'b']);
  assert.deepEqual(result.linkIds, ['l1']);

  const byId = new Map(links.map((entry) => [entry.id, entry]));
  const returned = new Set(result.definitionIds);
  for (const linkId of result.linkIds) {
    const edge = byId.get(linkId)!;
    assert.ok(returned.has(edge.fromDefinitionId) && returned.has(edge.toDefinitionId), `${linkId} dangles`);
  }
});

test('rejects unavailable, unknown, and malformed traversal inputs', () => {
  const graph = [node('a'), node('b')];
  const links = [link({ id: 'l1', type: 'parent_child', fromDefinitionId: 'a', toDefinitionId: 'b' })];
  const base = { nodes: graph, links, direction: 'both' as const, permittedDefinitionIds: new Set(['a', 'b', 'ghost']) };

  assert.equal(codeOf(() => traverseJourneyHierarchy({ ...base, startDefinitionId: 'ghost' })), 'JOURNEY_HIERARCHY_NODE_NOT_FOUND');
  assert.equal(codeOf(() => traverseJourneyHierarchy({
    ...base, startDefinitionId: 'b', permittedDefinitionIds: new Set(['a'])
  })), 'JOURNEY_HIERARCHY_NODE_NOT_FOUND');
  assert.equal(codeOf(() => traverseJourneyHierarchy({
    ...base, startDefinitionId: 'a', direction: unexpected<'both'>('sideways')
  })), 'JOURNEY_HIERARCHY_INVALID_INPUT');
  assert.equal(codeOf(() => traverseJourneyHierarchy({ ...base, startDefinitionId: 'a', linkTypes: [] })), 'JOURNEY_HIERARCHY_INVALID_INPUT');
  assert.equal(codeOf(() => traverseJourneyHierarchy({
    ...base, startDefinitionId: 'a', linkTypes: [unexpected<JourneyHierarchyLinkType>('nope')]
  })), 'JOURNEY_HIERARCHY_INVALID_INPUT');
  for (const maximumNodes of [0, -1, 1.5, Number.NaN, 501]) {
    assert.equal(codeOf(() => traverseJourneyHierarchy({ ...base, startDefinitionId: 'a', maximumNodes })),
      'JOURNEY_HIERARCHY_INVALID_INPUT');
  }
});

test('builds every breadcrumb trail and reports hidden ancestry instead of a false root', () => {
  const graph = [node('root'), node('left'), node('right'), node('shared')];
  const links = [
    link({ id: 'l1', type: 'parent_child', fromDefinitionId: 'root', toDefinitionId: 'left' }),
    link({ id: 'l2', type: 'parent_child', fromDefinitionId: 'root', toDefinitionId: 'right' }),
    link({ id: 'l3', type: 'parent_child', fromDefinitionId: 'left', toDefinitionId: 'shared' }),
    link({ id: 'l4', type: 'parent_child', fromDefinitionId: 'right', toDefinitionId: 'shared' })
  ];
  const everything = new Set(['root', 'left', 'right', 'shared']);

  const full = journeyHierarchyBreadcrumbTrails({ nodes: graph, links, targetDefinitionId: 'shared', permittedDefinitionIds: everything });
  assert.equal(full.targetDefinitionId, 'shared');
  assert.equal(full.truncated, false);
  assert.deepEqual(full.trails, [
    { definitionIds: ['root', 'left', 'shared'], hasInaccessibleAncestor: false },
    { definitionIds: ['root', 'right', 'shared'], hasInaccessibleAncestor: false }
  ]);
  assert.deepEqual(journeyHierarchyBreadcrumbs({ nodes: graph, links, targetDefinitionId: 'shared', permittedDefinitionIds: everything }),
    [['root', 'left', 'shared'], ['root', 'right', 'shared']]);

  const partial = journeyHierarchyBreadcrumbTrails({
    nodes: graph, links, targetDefinitionId: 'shared', permittedDefinitionIds: new Set(['shared', 'left'])
  });
  assert.deepEqual(partial.trails, [{ definitionIds: ['left', 'shared'], hasInaccessibleAncestor: true }]);

  const clipped = journeyHierarchyBreadcrumbTrails({
    nodes: graph, links, targetDefinitionId: 'shared', permittedDefinitionIds: everything, maximumPaths: 1
  });
  assert.equal(clipped.trails.length, 1);
  assert.equal(clipped.truncated, true);

  assert.equal(codeOf(() => journeyHierarchyBreadcrumbTrails({
    nodes: graph, links, targetDefinitionId: 'ghost', permittedDefinitionIds: new Set(['ghost'])
  })), 'JOURNEY_HIERARCHY_NODE_NOT_FOUND');
  assert.equal(codeOf(() => journeyHierarchyBreadcrumbTrails({
    nodes: graph, links, targetDefinitionId: 'shared', permittedDefinitionIds: everything, maximumPaths: 101
  })), 'JOURNEY_HIERARCHY_INVALID_INPUT');
  assert.equal(full.inaccessibleParentCount, 0);
  assert.equal(partial.inaccessibleParentCount, 2);
});

test('flags hidden ancestry per trail rather than across visible siblings', () => {
  const graph = [node('root'), node('left'), node('right'), node('shared')];
  const links = [
    link({ id: 'l1', type: 'parent_child', fromDefinitionId: 'root', toDefinitionId: 'left' }),
    link({ id: 'l2', type: 'parent_child', fromDefinitionId: 'root', toDefinitionId: 'right' }),
    link({ id: 'l3', type: 'parent_child', fromDefinitionId: 'left', toDefinitionId: 'shared' }),
    link({ id: 'l4', type: 'parent_child', fromDefinitionId: 'right', toDefinitionId: 'shared' })
  ];
  // 'shared' has a hidden parent ('right'), but the surviving trail reaches a genuine root
  // through 'left'. Flagging that complete trail as having hidden ancestry misreports it.
  const result = journeyHierarchyBreadcrumbTrails({
    nodes: graph, links, targetDefinitionId: 'shared',
    permittedDefinitionIds: new Set(['root', 'left', 'shared'])
  });
  assert.deepEqual(result.trails, [
    { definitionIds: ['root', 'left', 'shared'], hasInaccessibleAncestor: false }
  ]);
  // The hidden parent is still reported, just as its own signal rather than by mislabelling a trail.
  assert.equal(result.inaccessibleParentCount, 1);
});

test('never mutates caller-owned nodes, links, or observations', () => {
  const graph = [node('root'), node('left'), node('right'), node('shared')];
  const links = [
    link({ id: 'l1', type: 'parent_child', fromDefinitionId: 'root', toDefinitionId: 'left' }),
    link({ id: 'l2', type: 'parent_child', fromDefinitionId: 'root', toDefinitionId: 'right' }),
    link({ id: 'l3', type: 'parent_child', fromDefinitionId: 'left', toDefinitionId: 'shared' }),
    link({ id: 'l4', type: 'parent_child', fromDefinitionId: 'right', toDefinitionId: 'shared' })
  ];
  const observations = [observation('shared', 55, 'rev-1'), observation('left', 95, 'rev-2')];
  const expectedNodes = structuredClone(graph);
  const expectedLinks = structuredClone(links);
  const expectedObservations = structuredClone(observations);
  const permitted = new Set(['root', 'left', 'right', 'shared']);

  validateJourneyHierarchy(graph, links);
  rollUpJourneyHierarchyHealth(graph, links, observations, policy);
  traverseJourneyHierarchy({ nodes: graph, links, startDefinitionId: 'root', direction: 'both', permittedDefinitionIds: permitted });
  journeyHierarchyBreadcrumbTrails({ nodes: graph, links, targetDefinitionId: 'shared', permittedDefinitionIds: permitted });

  assert.deepEqual(graph, expectedNodes);
  assert.deepEqual(links, expectedLinks);
  assert.deepEqual(observations, expectedObservations);
});

test('validates a large hierarchy in sub-quadratic time and keeps its ordering exact', () => {
  // `limitCeilings` admits 100k nodes, so the ready-queue drain has to stay near-linear. A
  // wide fan-out is the worst case: every child becomes ready at once.
  const width = 20_000;
  const wideLimits: JourneyHierarchyLimits = { nodes: 100_000, links: 100_000, depth: 32 };
  const wideNodes = [node('root'), ...Array.from({ length: width }, (_, index) => (
    node(`n${String(index).padStart(6, '0')}`)
  ))];
  const wideLinks = wideNodes.slice(1).map((child, index) => link({
    id: `k${String(index).padStart(6, '0')}`, type: 'parent_child',
    fromDefinitionId: 'root', toDefinitionId: child.definitionId
  }));

  const startedAt = process.hrtime.bigint();
  const result = validateJourneyHierarchy(wideNodes, wideLinks, wideLimits);
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

  assert.deepEqual(result.roots, ['root']);
  assert.equal(result.maximumDepth, 1);
  assert.equal(result.topologicalOrder.length, width + 1);
  assert.equal(result.topologicalOrder[0], 'root');
  // Ordering must stay byte-identical to the sorted drain it replaces.
  assert.deepEqual(result.topologicalOrder.slice(1),
    wideNodes.slice(1).map((entry) => entry.definitionId).sort());
  assert.equal(result.childIdsByParent['root']!.length, width);
  // Guard against a return to quadratic behaviour, not a benchmark. The sorted-array drain this
  // replaced took ~3400ms here against ~54ms for the heap, so the ceiling discriminates the two
  // by several multiples while leaving ample headroom for a slow CI machine.
  assert.ok(elapsedMs < 1_000, `wide-hierarchy validation took ${elapsedMs.toFixed(0)}ms`);
});
