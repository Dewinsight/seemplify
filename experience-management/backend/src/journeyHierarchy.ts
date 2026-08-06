export const journeyHierarchyLinkTypes = [
  'parent_child', 'stage_subjourney', 'variant', 'handoff', 'related'
] as const;

export type JourneyHierarchyLinkType = typeof journeyHierarchyLinkTypes[number];

/** Mirrors runtime-29 `journey_hierarchy_links.variant_dimension`. */
export const journeyHierarchyVariantDimensions = ['persona', 'segment', 'product', 'geography', 'channel'] as const;

export type JourneyHierarchyVariantDimension = typeof journeyHierarchyVariantDimensions[number];

/** Mirrors runtime-29 `journey_hierarchy_links.review_state`. */
export const journeyHierarchyReviewStates = ['draft', 'in_review', 'approved', 'changes_requested'] as const;

export type JourneyHierarchyReviewState = typeof journeyHierarchyReviewStates[number];

/** Mirrors runtime-29 `journey_hierarchy_links.lifecycle`. */
export const journeyHierarchyLifecycles = ['active', 'retired'] as const;

export type JourneyHierarchyLifecycle = typeof journeyHierarchyLifecycles[number];

export type JourneyHierarchyNode = {
  definitionId: string;
  spaceId: string;
  name?: string;
  /** Stage keys this journey publishes. When present, stage-bearing links are checked against them. */
  stageKeys?: readonly string[];
  /** Taxonomy/tag term IDs assigned to this journey. Validated for shape and uniqueness only. */
  taxonomyTermIds?: readonly string[];
  ownerUserId?: string | null;
};

export type JourneyHierarchyLink = {
  id: string;
  spaceId: string;
  type: JourneyHierarchyLinkType;
  fromDefinitionId: string;
  toDefinitionId: string;
  fromStageKey?: string | null;
  toStageKey?: string | null;
  variantDimension?: JourneyHierarchyVariantDimension | null;
  variantValueId?: string | null;
  handoffOwnerUserId?: string | null;
  handoffOwnerTeamId?: string | null;
  reviewState?: JourneyHierarchyReviewState;
  /** Retired links keep their logical identity but leave the active containment graph. Defaults to `active`. */
  lifecycle?: JourneyHierarchyLifecycle;
};

export type JourneyHierarchyValidation = {
  /** The single space every node and link belongs to; `null` only for an empty graph. */
  spaceId: string | null;
  roots: string[];
  topologicalOrder: string[];
  maximumDepth: number;
  childIdsByParent: Record<string, string[]>;
  /** Deterministically ordered view of `childIdsByParent`; plain-object key order is not order-stable. */
  childEntries: Array<{ parentDefinitionId: string; childDefinitionIds: string[] }>;
};

export type JourneyHierarchyHealthObservation = {
  definitionId: string;
  score: number | null;
  observedAt: string;
  sourceRevision: string;
};

export type JourneyHierarchyHealthPolicy = {
  version: string;
  ownWeight: number;
  missingChild: 'exclude' | 'unknown';
  healthyAt: number;
  watchAt: number;
};

export type JourneyHierarchyHealthResult = {
  definitionId: string;
  score: number | null;
  status: 'healthy' | 'watch' | 'at_risk' | 'unknown';
  own: JourneyHierarchyHealthObservation | null;
  children: Array<{
    definitionId: string;
    score: number | null;
    effectiveWeight: number;
  }>;
  lineage: string[];
  policyVersion: string;
  explanation: string;
};

export type JourneyHierarchyTraversal = {
  startDefinitionId: string;
  direction: 'upstream' | 'downstream' | 'both';
  definitionIds: string[];
  linkIds: string[];
  inaccessibleLinkCount: number;
  truncated: boolean;
};

export type JourneyHierarchyBreadcrumbTrail = {
  definitionIds: string[];
  /**
   * True when this trail's own topmost journey has containment parents and none of them are
   * visible, so the trail stops short of a real root. A hidden parent elsewhere in the graph
   * does not set this; see `inaccessibleParentCount`.
   */
  hasInaccessibleAncestor: boolean;
};

export type JourneyHierarchyBreadcrumbs = {
  targetDefinitionId: string;
  trails: JourneyHierarchyBreadcrumbTrail[];
  truncated: boolean;
  /** Distinct containment edges reached during the walk whose parent the caller cannot see. */
  inaccessibleParentCount: number;
};

export class JourneyHierarchyError extends Error {
  constructor(
    message: string,
    public code:
      | 'JOURNEY_HIERARCHY_LIMIT'
      | 'JOURNEY_HIERARCHY_INVALID_INPUT'
      | 'JOURNEY_HIERARCHY_NODE_NOT_FOUND'
      | 'JOURNEY_HIERARCHY_CROSS_SPACE'
      | 'JOURNEY_HIERARCHY_SELF_LINK'
      | 'JOURNEY_HIERARCHY_DUPLICATE_NODE'
      | 'JOURNEY_HIERARCHY_DUPLICATE_LINK'
      | 'JOURNEY_HIERARCHY_DUPLICATE_OBSERVATION'
      | 'JOURNEY_HIERARCHY_LINK_SHAPE'
      | 'JOURNEY_HIERARCHY_STAGE_REQUIRED'
      | 'JOURNEY_HIERARCHY_STAGE_NOT_FOUND'
      | 'JOURNEY_HIERARCHY_CYCLE'
      | 'JOURNEY_HIERARCHY_DEPTH',
    public details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'JourneyHierarchyError';
  }
}

export type JourneyHierarchyLimits = { nodes: number; links: number; depth: number };

export const journeyHierarchyLimits: Readonly<JourneyHierarchyLimits> = Object.freeze({
  nodes: 500, links: 2_000, depth: 12
});

/** Hard ceilings for caller-supplied limits; depth mirrors runtime-29 `journey_hierarchy_settings`. */
const limitCeilings: Readonly<JourneyHierarchyLimits> = Object.freeze({ nodes: 100_000, links: 100_000, depth: 32 });
const maximumStageKeysPerNode = 500;
const maximumTaxonomyTermsPerNode = 200;
const maximumBreadcrumbVisits = 10_000;
/** Revisions fan out into every ancestor's lineage, which runtime-29 caps at 131072 bytes. */
const maximumRevisionLength = 128;

const containmentTypes = new Set<JourneyHierarchyLinkType>(['parent_child', 'stage_subjourney']);
const linkTypeSet = new Set<string>(journeyHierarchyLinkTypes);
const variantDimensionSet = new Set<string>(journeyHierarchyVariantDimensions);
const reviewStateSet = new Set<string>(journeyHierarchyReviewStates);
const lifecycleSet = new Set<string>(journeyHierarchyLifecycles);
const directionSet = new Set<string>(['upstream', 'downstream', 'both']);
const missingChildSet = new Set<string>(['exclude', 'unknown']);
/** Error-detail keys holding journey IDs, filtered against what the caller may already see. */
const permittedIdDetailKeys = new Set(['definitionId', 'missingDefinitionId', 'cycleDefinitionIds']);
/**
 * Error-detail keys that carry no identifier and may cross a permission boundary intact.
 * Redaction is allow-listed rather than deny-listed so a detail key added later fails closed.
 */
const nonIdentifyingDetailKeys = new Set([
  'field', 'type', 'value', 'maximum', 'nodes', 'links', 'limits', 'depth', 'policyVersion'
]);

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;

function invalid(message: string, details: Record<string, unknown> = {}): never {
  throw new JourneyHierarchyError(message, 'JOURNEY_HIERARCHY_INVALID_INPUT', details);
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

/** Mirrors the runtime-29 stage-key length check. */
function isStageKey(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 80;
}

/** Deliberately not a type predicate: narrowing `readonly T[]` to `any[]` would erase element types. */
function isArrayInput(value: unknown) {
  return Array.isArray(value);
}

function parseInstant(value: unknown) {
  if (typeof value !== 'string' || !INSTANT_PATTERN.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Weights are projected at fixed precision so IEEE-754 artefacts never reach a caller. */
function roundWeight(value: number) {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Binary min-heap over journey IDs. Kahn's ready set has to pop in code-unit order to keep the
 * topological order deterministic; re-sorting an array queue on every push is quadratic, which
 * the 100k-node ceiling in `limitCeilings` makes reachable.
 */
class JourneyIdMinHeap {
  private readonly items: string[] = [];

  get size() {
    return this.items.length;
  }

  push(value: string) {
    const items = this.items;
    items.push(value);
    let index = items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (compareText(items[parent]!, items[index]!) <= 0) break;
      [items[parent], items[index]] = [items[index]!, items[parent]!];
      index = parent;
    }
  }

  pop() {
    const items = this.items;
    const top = items[0];
    const last = items.pop()!;
    if (items.length) {
      items[0] = last;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        let smallest = index;
        if (left < items.length && compareText(items[left]!, items[smallest]!) < 0) smallest = left;
        if (left + 1 < items.length && compareText(items[left + 1]!, items[smallest]!) < 0) smallest = left + 1;
        if (smallest === index) break;
        [items[smallest], items[index]] = [items[index]!, items[smallest]!];
        index = smallest;
      }
    }
    return top;
  }
}

function logicalKey(link: JourneyHierarchyLink) {
  return JSON.stringify([
    link.type, link.fromDefinitionId, link.toDefinitionId,
    link.fromStageKey ?? null, link.toStageKey ?? null,
    link.variantDimension ?? null, link.variantValueId ?? null
  ]);
}

function assertLimits(limits: Readonly<JourneyHierarchyLimits>) {
  if (!limits || typeof limits !== 'object') invalid('Journey hierarchy limits are required.', { field: 'limits' });
  for (const field of ['nodes', 'links', 'depth'] as const) {
    const value = limits[field];
    if (!Number.isSafeInteger(value) || value < 1 || value > limitCeilings[field]) {
      invalid('Journey hierarchy limits must be positive whole numbers within their ceilings.', {
        field: `limits.${field}`, value, maximum: limitCeilings[field]
      });
    }
  }
}

function assertNodeMetadata(node: JourneyHierarchyNode) {
  if (!isId(node.definitionId)) invalid('A journey definition ID must be a stable identifier.', { field: 'definitionId' });
  if (!isId(node.spaceId)) {
    invalid('A journey space ID must be a stable identifier.', { field: 'spaceId', definitionId: node.definitionId });
  }
  if (node.name !== undefined && (typeof node.name !== 'string' || node.name.length > 200)) {
    invalid('A journey name must be a string of at most 200 characters.', { field: 'name', definitionId: node.definitionId });
  }
  if (node.ownerUserId !== undefined && node.ownerUserId !== null && !isId(node.ownerUserId)) {
    invalid('A journey owner must be null or a stable identifier.', { field: 'ownerUserId', definitionId: node.definitionId });
  }
  if (node.stageKeys !== undefined
    && (!isArrayInput(node.stageKeys) || node.stageKeys.length > maximumStageKeysPerNode
      || node.stageKeys.some((stageKey) => !isStageKey(stageKey))
      || new Set(node.stageKeys).size !== node.stageKeys.length)) {
    invalid('Journey stage keys must be a bounded set of unique 1-80 character keys.', {
      field: 'stageKeys', definitionId: node.definitionId
    });
  }
  if (node.taxonomyTermIds !== undefined
    && (!isArrayInput(node.taxonomyTermIds) || node.taxonomyTermIds.length > maximumTaxonomyTermsPerNode
      || node.taxonomyTermIds.some((termId) => !isId(termId))
      || new Set(node.taxonomyTermIds).size !== node.taxonomyTermIds.length)) {
    invalid('Journey taxonomy term IDs must be a bounded set of unique stable identifiers.', {
      field: 'taxonomyTermIds', definitionId: node.definitionId
    });
  }
}

function assertLinkMetadata(link: JourneyHierarchyLink) {
  if (!isId(link.id)) invalid('A journey link ID must be a stable identifier.', { field: 'id' });
  if (!isId(link.spaceId)) invalid('A journey link space ID must be a stable identifier.', { field: 'spaceId', linkId: link.id });
  if (!linkTypeSet.has(link.type)) invalid('Unknown journey link type.', { field: 'type', linkId: link.id });
  for (const field of ['fromDefinitionId', 'toDefinitionId'] as const) {
    // Without this a malformed endpoint reaches the node lookup and is reported as a missing
    // journey, naming a definition the caller never supplied.
    if (!isId(link[field])) invalid('A journey link endpoint must be a stable identifier.', { field, linkId: link.id });
  }
  if (link.lifecycle !== undefined && !lifecycleSet.has(link.lifecycle)) {
    invalid('Unknown journey link lifecycle.', { field: 'lifecycle', linkId: link.id });
  }
  if (link.reviewState !== undefined && !reviewStateSet.has(link.reviewState)) {
    invalid('Unknown journey link review state.', { field: 'reviewState', linkId: link.id });
  }
  for (const field of ['handoffOwnerUserId', 'handoffOwnerTeamId'] as const) {
    const value = link[field];
    if (value !== undefined && value !== null && !isId(value)) {
      invalid('A journey link owner must be null or a stable identifier.', { field, linkId: link.id });
    }
  }
  for (const field of ['fromStageKey', 'toStageKey'] as const) {
    const value = link[field];
    if (value !== undefined && value !== null && !isStageKey(value)) {
      invalid('A journey link stage key must be 1-80 characters.', { field, linkId: link.id });
    }
  }
  if (link.variantValueId !== undefined && link.variantValueId !== null && !isId(link.variantValueId)) {
    invalid('A variant value ID must be a stable identifier.', { field: 'variantValueId', linkId: link.id });
  }
  if (link.variantDimension !== undefined && link.variantDimension !== null && !variantDimensionSet.has(link.variantDimension)) {
    invalid('Unknown journey variant dimension.', { field: 'variantDimension', linkId: link.id });
  }
}

/**
 * Enforces the runtime-29 `journey_hierarchy_links_shape` contract in memory so a link Postgres
 * would reject fails as a typed domain error instead of a persistence error. This covers link
 * shape only: it is a necessary, not a sufficient, condition for insertability. Stage membership
 * is unchecked when a journey does not declare `stageKeys`, and handoff-owner space membership
 * and the version foreign keys are enforced only by the database.
 */
function assertLinkShape(link: JourneyHierarchyLink) {
  const hasVariant = Boolean(link.variantDimension) || Boolean(link.variantValueId);
  if (link.type === 'stage_subjourney') {
    if (!link.fromStageKey) {
      throw new JourneyHierarchyError('A stage-to-subjourney link requires its parent stage key.', 'JOURNEY_HIERARCHY_STAGE_REQUIRED', {
        linkId: link.id, field: 'fromStageKey'
      });
    }
    if (link.toStageKey || hasVariant) {
      throw new JourneyHierarchyError('A stage-to-subjourney link carries only its parent stage key.', 'JOURNEY_HIERARCHY_LINK_SHAPE', {
        linkId: link.id, type: link.type
      });
    }
    return;
  }
  if (link.type === 'handoff') {
    if (!link.fromStageKey || !link.toStageKey) {
      throw new JourneyHierarchyError('A handoff requires source and destination stage keys.', 'JOURNEY_HIERARCHY_STAGE_REQUIRED', {
        linkId: link.id
      });
    }
    if (hasVariant) {
      throw new JourneyHierarchyError('A handoff cannot carry variant fields.', 'JOURNEY_HIERARCHY_LINK_SHAPE', {
        linkId: link.id, type: link.type
      });
    }
    return;
  }
  if (link.type === 'variant') {
    if (!link.variantDimension || !link.variantValueId) {
      throw new JourneyHierarchyError('A variant link requires its dimension and value.', 'JOURNEY_HIERARCHY_LINK_SHAPE', {
        linkId: link.id, field: link.variantDimension ? 'variantValueId' : 'variantDimension'
      });
    }
    if (link.fromStageKey || link.toStageKey) {
      throw new JourneyHierarchyError('A variant link cannot carry stage keys.', 'JOURNEY_HIERARCHY_LINK_SHAPE', {
        linkId: link.id, type: link.type
      });
    }
    return;
  }
  if (link.fromStageKey || link.toStageKey || hasVariant) {
    throw new JourneyHierarchyError('This journey link type carries neither stage keys nor variant fields.', 'JOURNEY_HIERARCHY_LINK_SHAPE', {
      linkId: link.id, type: link.type
    });
  }
}

function assertStageExists(node: JourneyHierarchyNode, stageKey: string | null | undefined, linkId: string, field: string) {
  if (!stageKey || node.stageKeys === undefined || node.stageKeys.includes(stageKey)) return;
  throw new JourneyHierarchyError('A journey link references a stage its journey does not publish.', 'JOURNEY_HIERARCHY_STAGE_NOT_FOUND', {
    linkId, field, definitionId: node.definitionId
  });
}

/**
 * Validates one space's journey-link graph. Only active containment links participate in
 * cycle/depth semantics; variants, handoffs, and related links can connect branches without
 * falsely turning the hierarchy cyclic. Links carry no version reference, so this is a graph
 * over current definitions rather than a version-pinned snapshot.
 */
export function validateJourneyHierarchy(
  nodes: readonly JourneyHierarchyNode[],
  links: readonly JourneyHierarchyLink[],
  limits: Readonly<JourneyHierarchyLimits> = journeyHierarchyLimits
): JourneyHierarchyValidation {
  assertLimits(limits);
  if (!isArrayInput(nodes) || !isArrayInput(links)) {
    invalid('Journey hierarchy nodes and links must be arrays.', { field: isArrayInput(nodes) ? 'links' : 'nodes' });
  }
  // The caller-configured link budget mirrors runtime-29, which counts only active links; the
  // raw array is still bounded by the hard ceiling so retired history cannot grow without limit.
  if (nodes.length > limits.nodes || links.length > limitCeilings.links) {
    throw new JourneyHierarchyError('Journey hierarchy exceeds its bounded graph limits.', 'JOURNEY_HIERARCHY_LIMIT', {
      nodes: nodes.length, links: links.length, limits
    });
  }

  const nodeById = new Map<string, JourneyHierarchyNode>();
  const spaceIds = new Set<string>();
  for (const node of nodes) {
    if (!node || typeof node !== 'object') invalid('A journey hierarchy node must be an object.', { field: 'nodes' });
    assertNodeMetadata(node);
    if (nodeById.has(node.definitionId)) {
      throw new JourneyHierarchyError('A journey definition appears more than once.', 'JOURNEY_HIERARCHY_DUPLICATE_NODE', {
        definitionId: node.definitionId
      });
    }
    nodeById.set(node.definitionId, node);
    spaceIds.add(node.spaceId);
  }
  if (spaceIds.size > 1) {
    throw new JourneyHierarchyError('A journey hierarchy cannot span more than one space.', 'JOURNEY_HIERARCHY_CROSS_SPACE', {
      spaceIds: [...spaceIds].sort(compareText)
    });
  }
  const spaceId = spaceIds.size ? [...spaceIds][0]! : null;

  const seenLinkIds = new Set<string>();
  const seenLinks = new Set<string>();
  const children = new Map<string, Set<string>>();
  const indegree = new Map(nodes.map((node) => [node.definitionId, 0]));
  let activeLinkCount = 0;

  for (const link of links) {
    if (!link || typeof link !== 'object') invalid('A journey hierarchy link must be an object.', { field: 'links' });
    assertLinkMetadata(link);
    if ((link.lifecycle ?? 'active') === 'active' && ++activeLinkCount > limits.links) {
      throw new JourneyHierarchyError('Journey hierarchy exceeds its bounded graph limits.', 'JOURNEY_HIERARCHY_LIMIT', {
        nodes: nodes.length, links: activeLinkCount, limits
      });
    }
    if (seenLinkIds.has(link.id)) {
      throw new JourneyHierarchyError('A journey link ID appears more than once.', 'JOURNEY_HIERARCHY_DUPLICATE_LINK', {
        linkId: link.id
      });
    }
    seenLinkIds.add(link.id);

    const from = nodeById.get(link.fromDefinitionId);
    const to = nodeById.get(link.toDefinitionId);
    if (!from || !to) {
      throw new JourneyHierarchyError('Both linked journey definitions must exist in the graph.', 'JOURNEY_HIERARCHY_NODE_NOT_FOUND', {
        linkId: link.id, missingDefinitionId: !from ? link.fromDefinitionId : link.toDefinitionId
      });
    }
    if (from.spaceId !== to.spaceId || from.spaceId !== link.spaceId) {
      throw new JourneyHierarchyError('Journey links cannot cross a space boundary.', 'JOURNEY_HIERARCHY_CROSS_SPACE', {
        linkId: link.id
      });
    }
    if (from.definitionId === to.definitionId) {
      throw new JourneyHierarchyError('A journey cannot link to itself.', 'JOURNEY_HIERARCHY_SELF_LINK', { linkId: link.id });
    }
    assertLinkShape(link);
    assertStageExists(from, link.fromStageKey, link.id, 'fromStageKey');
    assertStageExists(to, link.toStageKey, link.id, 'toStageKey');

    const key = logicalKey(link);
    if (seenLinks.has(key)) {
      throw new JourneyHierarchyError('The same logical journey link already exists.', 'JOURNEY_HIERARCHY_DUPLICATE_LINK', {
        linkId: link.id
      });
    }
    seenLinks.add(key);

    if ((link.lifecycle ?? 'active') !== 'active') continue;
    if (!containmentTypes.has(link.type)) continue;
    const targets = children.get(from.definitionId) || new Set<string>();
    if (!targets.has(to.definitionId)) {
      targets.add(to.definitionId);
      children.set(from.definitionId, targets);
      indegree.set(to.definitionId, (indegree.get(to.definitionId) || 0) + 1);
    }
  }

  const roots = [...indegree.entries()].filter(([, value]) => value === 0).map(([id]) => id).sort(compareText);
  const ready = new JourneyIdMinHeap();
  for (const id of roots) ready.push(id);
  const topologicalOrder: string[] = [];
  while (ready.size) {
    const id = ready.pop()!;
    topologicalOrder.push(id);
    // The heap already orders the ready set, so the child iteration order cannot affect the result.
    for (const child of children.get(id) || []) {
      const next = (indegree.get(child) || 0) - 1;
      indegree.set(child, next);
      if (next === 0) ready.push(child);
    }
  }
  if (topologicalOrder.length !== nodes.length) {
    const cycleDefinitionIds = [...indegree.entries()].filter(([, value]) => value > 0).map(([id]) => id).sort(compareText);
    throw new JourneyHierarchyError('Containment links form a cycle.', 'JOURNEY_HIERARCHY_CYCLE', { cycleDefinitionIds });
  }

  const depth = new Map(nodes.map((node) => [node.definitionId, 0]));
  let maximumDepth = 0;
  for (const id of topologicalOrder) {
    const parentDepth = depth.get(id) || 0;
    maximumDepth = Math.max(maximumDepth, parentDepth);
    for (const child of children.get(id) || []) {
      const childDepth = Math.max(depth.get(child) || 0, parentDepth + 1);
      if (childDepth > limits.depth) {
        throw new JourneyHierarchyError('Journey hierarchy exceeds its maximum containment depth.', 'JOURNEY_HIERARCHY_DEPTH', {
          definitionId: child, depth: childDepth, maximum: limits.depth
        });
      }
      depth.set(child, childDepth);
      maximumDepth = Math.max(maximumDepth, childDepth);
    }
  }

  const childEntries = [...children.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([parentDefinitionId, childIds]) => ({
      parentDefinitionId, childDefinitionIds: [...childIds].sort(compareText)
    }));

  // Null-prototype: journey IDs are caller data, and `toString`/`constructor` are valid IDs, so an
  // ordinary object would hand `childIdsByParent[id] ?? []` an inherited Function.
  const childIdsByParent = Object.create(null) as Record<string, string[]>;
  for (const entry of childEntries) childIdsByParent[entry.parentDefinitionId] = [...entry.childDefinitionIds];

  return { spaceId, roots, topologicalOrder, maximumDepth, childIdsByParent, childEntries };
}

function healthStatus(score: number | null, policy: JourneyHierarchyHealthPolicy): JourneyHierarchyHealthResult['status'] {
  if (score === null) return 'unknown';
  if (score >= policy.healthyAt) return 'healthy';
  if (score >= policy.watchAt) return 'watch';
  return 'at_risk';
}

function assertHealthPolicy(policy: JourneyHierarchyHealthPolicy) {
  if (!policy || typeof policy !== 'object' || typeof policy.version !== 'string' || !policy.version.trim()
    || policy.version.length > maximumRevisionLength
    || !missingChildSet.has(policy.missingChild)
    || !Number.isFinite(policy.ownWeight) || policy.ownWeight < 0 || policy.ownWeight > 1
    || !Number.isFinite(policy.healthyAt) || !Number.isFinite(policy.watchAt)
    || policy.healthyAt < 0 || policy.healthyAt > 100 || policy.watchAt < 0 || policy.watchAt > 100
    || policy.watchAt > policy.healthyAt) {
    invalid('Journey health policy is invalid.', {
      policyVersion: policy && typeof policy.version === 'string' ? policy.version : null
    });
  }
}

function scoredChildPhrase(count: number) {
  return `${count} scored direct child${count === 1 ? '' : 'ren'}`;
}

/**
 * Rolls direct-child health into every parent using an explicit versioned
 * policy. Shared subjourneys are intentionally evaluated once per direct parent
 * edge; the exact child score/weight and transitive lineage remain inspectable.
 * Missing values are never coerced to zero, the explanation always names the
 * branch that actually produced the score, and `own` is a copy so a later caller
 * mutation cannot rewrite an already-returned roll-up.
 */
export function rollUpJourneyHierarchyHealth(
  nodes: readonly JourneyHierarchyNode[],
  links: readonly JourneyHierarchyLink[],
  observations: readonly JourneyHierarchyHealthObservation[],
  policy: JourneyHierarchyHealthPolicy,
  limits: Readonly<JourneyHierarchyLimits> = journeyHierarchyLimits
): JourneyHierarchyHealthResult[] {
  assertHealthPolicy(policy);
  const validation = validateJourneyHierarchy(nodes, links, limits);
  if (!isArrayInput(observations) || observations.length > limits.nodes) {
    invalid('Journey health observations must be a bounded array.', { field: 'observations' });
  }
  const childIdsByParent = new Map(validation.childEntries.map((entry) => [entry.parentDefinitionId, entry.childDefinitionIds]));
  const definitionIds = new Set(nodes.map((node) => node.definitionId));
  const observationByDefinition = new Map<string, JourneyHierarchyHealthObservation>();
  for (const observation of observations) {
    if (!observation || typeof observation !== 'object') invalid('A health observation must be an object.', { field: 'observations' });
    if (!definitionIds.has(observation.definitionId)) {
      throw new JourneyHierarchyError('A health observation references an unknown journey.', 'JOURNEY_HIERARCHY_NODE_NOT_FOUND', {
        definitionId: observation.definitionId
      });
    }
    if (observationByDefinition.has(observation.definitionId)) {
      throw new JourneyHierarchyError('A journey has more than one health observation in the same roll-up.',
        'JOURNEY_HIERARCHY_DUPLICATE_OBSERVATION', { definitionId: observation.definitionId });
    }
    if (observation.score !== null
      && (typeof observation.score !== 'number' || !Number.isFinite(observation.score)
        || observation.score < 0 || observation.score > 100)) {
      invalid('A journey health score must be null or between 0 and 100.', {
        definitionId: observation.definitionId, field: 'score'
      });
    }
    if (parseInstant(observation.observedAt) === null) {
      invalid('A journey health observation needs an exact observation time.', {
        definitionId: observation.definitionId, field: 'observedAt'
      });
    }
    if (typeof observation.sourceRevision !== 'string' || !observation.sourceRevision.trim()
      || observation.sourceRevision.length > maximumRevisionLength) {
      invalid('A journey health observation needs a bounded source revision.', {
        definitionId: observation.definitionId, field: 'sourceRevision'
      });
    }
    observationByDefinition.set(observation.definitionId, observation);
  }

  const resultByDefinition = new Map<string, JourneyHierarchyHealthResult>();
  for (const definitionId of [...validation.topologicalOrder].reverse()) {
    const source = observationByDefinition.get(definitionId) || null;
    const own = source === null ? null : {
      definitionId: source.definitionId, score: source.score,
      observedAt: source.observedAt, sourceRevision: source.sourceRevision
    };
    const childIds = childIdsByParent.get(definitionId) || [];
    const childResults = childIds.map((childId) => resultByDefinition.get(childId)!).filter(Boolean);
    const knownChildren = childResults.filter((child) => child.score !== null);
    const missingChild = childResults.length !== knownChildren.length;
    const ownKnown = own !== null && own.score !== null;
    let score: number | null = null;
    // Projected weights are rounded, the score is not: `1 - 0.7` is 0.30000000000000004, and that
    // artefact must never reach a caller-facing weight or explanation. The stated total is the sum
    // of the shown weights, so the explanation stays arithmetically verifiable against `children`.
    let totalChildWeight = 0;
    const weightedChildren: JourneyHierarchyHealthResult['children'] = childResults.map((child) => ({
      definitionId: child.definitionId,
      score: child.score,
      effectiveWeight: 0
    }));
    if (!(policy.missingChild === 'unknown' && missingChild)) {
      if (ownKnown && knownChildren.length) {
        const exactChildWeight = (1 - policy.ownWeight) / knownChildren.length;
        const childWeight = roundWeight(exactChildWeight);
        for (const child of weightedChildren) if (child.score !== null) child.effectiveWeight = childWeight;
        totalChildWeight = roundWeight(childWeight * knownChildren.length);
        score = own!.score! * policy.ownWeight
          + knownChildren.reduce((total, child) => total + child.score! * exactChildWeight, 0);
      } else if (ownKnown) score = own!.score;
      else if (knownChildren.length) {
        const exactChildWeight = 1 / knownChildren.length;
        const childWeight = roundWeight(exactChildWeight);
        for (const child of weightedChildren) if (child.score !== null) child.effectiveWeight = childWeight;
        totalChildWeight = roundWeight(childWeight * knownChildren.length);
        score = knownChildren.reduce((total, child) => total + child.score! * exactChildWeight, 0);
      }
    }
    score = score === null ? null : Math.round(score * 100) / 100;
    const lineage = [...new Set([
      ...(own ? [`${definitionId}@${own.sourceRevision}`] : []),
      ...childResults.flatMap((child) => child.lineage)
    ])].sort(compareText);
    const explanation = score === null
      ? policy.missingChild === 'unknown' && missingChild
        ? 'Health is unknown because the policy requires every direct child to have a score.'
        : 'Health is unknown because neither this journey nor its scored direct children have a value.'
      : ownKnown && knownChildren.length
        ? `Score ${score} combines this journey at weight ${roundWeight(policy.ownWeight)} and ${scoredChildPhrase(knownChildren.length)} at total weight ${totalChildWeight}.`
        : ownKnown ? `Score ${score} comes from this journey's exact observation.`
          : `Score ${score} is the equal-weight mean of ${scoredChildPhrase(knownChildren.length)}.`;
    resultByDefinition.set(definitionId, {
      definitionId, score, status: healthStatus(score, policy), own,
      children: weightedChildren, lineage, policyVersion: policy.version, explanation
    });
  }
  return nodes.map((node) => resultByDefinition.get(node.definitionId)!).sort((left, right) => (
    compareText(left.definitionId, right.definitionId)
  ));
}

/**
 * Rebuilds a validation failure so a permission-filtered caller never learns an identifier it
 * cannot already see: not a journey ID, not a link ID, and not another tenant's space ID. Only
 * allow-listed non-identifying keys survive verbatim, so a detail key added later fails closed.
 * The unfiltered {@link validateJourneyHierarchy} still reports full detail for operators.
 */
function redactHierarchyError(error: unknown, permittedDefinitionIds: ReadonlySet<string>) {
  if (!(error instanceof JourneyHierarchyError)) return error;
  const details: Record<string, unknown> = {};
  let hiddenDefinitionIdCount = 0;
  let hiddenLinkIdCount = 0;
  for (const [key, value] of Object.entries(error.details)) {
    if (nonIdentifyingDetailKeys.has(key)) { details[key] = value; continue; }
    if (!permittedIdDetailKeys.has(key)) {
      // A link ID identifies an edge between two journeys the caller may not see; report only
      // that one was withheld. Anything else unrecognised is dropped rather than guessed at.
      if (key === 'linkId') hiddenLinkIdCount += 1;
      continue;
    }
    if (Array.isArray(value)) {
      const visible = value.filter((entry) => typeof entry === 'string' && permittedDefinitionIds.has(entry));
      hiddenDefinitionIdCount += value.length - visible.length;
      details[key] = visible;
      continue;
    }
    if (typeof value !== 'string' || !permittedDefinitionIds.has(value)) { hiddenDefinitionIdCount += 1; continue; }
    details[key] = value;
  }
  if (hiddenDefinitionIdCount) details.hiddenDefinitionIdCount = hiddenDefinitionIdCount;
  if (hiddenLinkIdCount) details.hiddenLinkIdCount = hiddenLinkIdCount;
  return new JourneyHierarchyError(error.message, error.code, details);
}

function validateForPermittedCaller(
  nodes: readonly JourneyHierarchyNode[],
  links: readonly JourneyHierarchyLink[],
  limits: Readonly<JourneyHierarchyLimits>,
  permittedDefinitionIds: ReadonlySet<string>
) {
  try {
    return validateJourneyHierarchy(nodes, links, limits);
  } catch (error) {
    throw redactHierarchyError(error, permittedDefinitionIds);
  }
}

function assertPermittedSet(permittedDefinitionIds: ReadonlySet<string>) {
  if (!permittedDefinitionIds || typeof permittedDefinitionIds.has !== 'function') {
    invalid('A permitted journey ID set is required.', { field: 'permittedDefinitionIds' });
  }
}

/**
 * Permission-filtered graph traversal for impact analysis. Hidden node IDs are
 * never returned - not in the result, and not in validation error details, which
 * are redacted to the permitted set. Every returned link ID connects two returned
 * journey IDs even when the traversal is truncated; retired links are excluded.
 */
export function traverseJourneyHierarchy(input: {
  nodes: readonly JourneyHierarchyNode[];
  links: readonly JourneyHierarchyLink[];
  startDefinitionId: string;
  direction: JourneyHierarchyTraversal['direction'];
  permittedDefinitionIds: ReadonlySet<string>;
  linkTypes?: readonly JourneyHierarchyLinkType[];
  maximumNodes?: number;
  limits?: Readonly<JourneyHierarchyLimits>;
}): JourneyHierarchyTraversal {
  assertPermittedSet(input.permittedDefinitionIds);
  if (!directionSet.has(input.direction)) invalid('Unknown traversal direction.', { field: 'direction' });
  if (input.linkTypes !== undefined
    && (!isArrayInput(input.linkTypes) || !input.linkTypes.length
      || input.linkTypes.some((type) => !linkTypeSet.has(type)))) {
    invalid('Traversal link types must be a non-empty set of known journey link types.', { field: 'linkTypes' });
  }
  const limits = input.limits ?? journeyHierarchyLimits;
  validateForPermittedCaller(input.nodes, input.links, limits, input.permittedDefinitionIds);
  const definitionIds = new Set(input.nodes.map((node) => node.definitionId));
  if (!definitionIds.has(input.startDefinitionId) || !input.permittedDefinitionIds.has(input.startDefinitionId)) {
    throw new JourneyHierarchyError('The starting journey is unavailable.', 'JOURNEY_HIERARCHY_NODE_NOT_FOUND');
  }
  const allowedTypes = new Set<string>(input.linkTypes || journeyHierarchyLinkTypes);
  const maximumNodes = input.maximumNodes ?? limits.nodes;
  if (!Number.isSafeInteger(maximumNodes) || maximumNodes < 1 || maximumNodes > limits.nodes) {
    invalid('Traversal limit is invalid.', { field: 'maximumNodes', value: maximumNodes, maximum: limits.nodes });
  }

  const adjacency = new Map<string, Array<{ definitionId: string; linkId: string }>>();
  const addEdge = (from: string, to: string, linkId: string) => {
    const edges = adjacency.get(from) || [];
    edges.push({ definitionId: to, linkId });
    adjacency.set(from, edges);
  };
  for (const link of input.links) {
    if (!allowedTypes.has(link.type) || (link.lifecycle ?? 'active') !== 'active') continue;
    if (input.direction !== 'upstream') addEdge(link.fromDefinitionId, link.toDefinitionId, link.id);
    if (input.direction !== 'downstream') addEdge(link.toDefinitionId, link.fromDefinitionId, link.id);
  }
  for (const edges of adjacency.values()) {
    edges.sort((left, right) => compareText(left.definitionId, right.definitionId) || compareText(left.linkId, right.linkId));
  }

  const visited = new Set([input.startDefinitionId]);
  const includedLinks = new Set<string>();
  const queue = [input.startDefinitionId];
  // Cursor rather than shift(): repeatedly shifting an array is quadratic in the node budget.
  let cursor = 0;
  let inaccessibleLinkCount = 0;
  let truncated = false;
  while (cursor < queue.length) {
    const current = queue[cursor++]!;
    for (const edge of adjacency.get(current) || []) {
      if (!input.permittedDefinitionIds.has(edge.definitionId)) {
        inaccessibleLinkCount += 1;
        continue;
      }
      if (visited.has(edge.definitionId)) { includedLinks.add(edge.linkId); continue; }
      if (visited.size >= maximumNodes) { truncated = true; continue; }
      visited.add(edge.definitionId);
      includedLinks.add(edge.linkId);
      queue.push(edge.definitionId);
    }
  }
  return {
    startDefinitionId: input.startDefinitionId,
    direction: input.direction,
    definitionIds: [...visited].sort(compareText),
    linkIds: [...includedLinks].sort(compareText),
    inaccessibleLinkCount,
    truncated
  };
}

export type JourneyHierarchyBreadcrumbInput = {
  nodes: readonly JourneyHierarchyNode[];
  links: readonly JourneyHierarchyLink[];
  targetDefinitionId: string;
  permittedDefinitionIds: ReadonlySet<string>;
  maximumPaths?: number;
  limits?: Readonly<JourneyHierarchyLimits>;
};

/**
 * Composite-key separator for hidden parent edges. A NUL cannot occur inside a definition id, so
 * `child + separator + parent` stays unambiguous. Constructed rather than written literally: an
 * inline NUL byte makes this file read as binary to grep, ripgrep and most diff viewers, which
 * silently skip it. The key is only ever counted, never parsed back, so the value is opaque.
 */
const hiddenParentEdgeSeparator = String.fromCharCode(0);

/**
 * Returns every bounded active-containment breadcrumb for a shared subjourney. A trail that
 * stops because an ancestor is invisible is flagged rather than presented as a root, hidden
 * parents elsewhere in the walk are counted separately so a complete trail is not mislabelled,
 * and clipping at `maximumPaths` is reported, not silent.
 */
export function journeyHierarchyBreadcrumbTrails(input: JourneyHierarchyBreadcrumbInput): JourneyHierarchyBreadcrumbs {
  assertPermittedSet(input.permittedDefinitionIds);
  const limits = input.limits ?? journeyHierarchyLimits;
  const validation = validateForPermittedCaller(input.nodes, input.links, limits, input.permittedDefinitionIds);
  const definitionIds = new Set(input.nodes.map((node) => node.definitionId));
  if (!definitionIds.has(input.targetDefinitionId) || !input.permittedDefinitionIds.has(input.targetDefinitionId)) {
    throw new JourneyHierarchyError('The breadcrumb target is unavailable.', 'JOURNEY_HIERARCHY_NODE_NOT_FOUND');
  }
  const maximumPaths = input.maximumPaths ?? 20;
  if (!Number.isSafeInteger(maximumPaths) || maximumPaths < 1 || maximumPaths > 100) {
    invalid('Breadcrumb path limit is invalid.', { field: 'maximumPaths', value: maximumPaths, maximum: 100 });
  }
  const parents = new Map<string, string[]>();
  for (const entry of validation.childEntries) {
    for (const child of entry.childDefinitionIds) {
      const existing = parents.get(child);
      if (existing) existing.push(entry.parentDefinitionId);
      else parents.set(child, [entry.parentDefinitionId]);
    }
  }
  for (const parentIds of parents.values()) parentIds.sort(compareText);

  const trails: JourneyHierarchyBreadcrumbTrail[] = [];
  // Keyed by edge so a node reached along several trails is counted once, not once per visit.
  const hiddenParentEdges = new Set<string>();
  let truncated = false;
  let visits = 0;
  const visit = (id: string, suffix: string[]) => {
    if (trails.length >= maximumPaths || visits >= maximumBreadcrumbVisits) { truncated = true; return; }
    visits += 1;
    const allParents = parents.get(id) || [];
    const permittedParents = allParents.filter((parent) => input.permittedDefinitionIds.has(parent));
    for (const parent of allParents) {
      if (!input.permittedDefinitionIds.has(parent)) hiddenParentEdges.add(`${id}${hiddenParentEdgeSeparator}${parent}`);
    }
    if (!permittedParents.length) {
      // Only a trail that actually stops short of a root carries the flag; a hidden parent of an
      // interior node says nothing about the visible branch this trail took.
      trails.push({ definitionIds: [id, ...suffix], hasInaccessibleAncestor: allParents.length > 0 });
      return;
    }
    for (const parent of permittedParents) visit(parent, [id, ...suffix]);
  };
  visit(input.targetDefinitionId, []);
  trails.sort((left, right) => compareText(left.definitionIds.join(' '), right.definitionIds.join(' ')));
  return {
    targetDefinitionId: input.targetDefinitionId, trails, truncated,
    inaccessibleParentCount: hiddenParentEdges.size
  };
}

/**
 * Backward-compatible breadcrumb projection. Prefer
 * {@link journeyHierarchyBreadcrumbTrails}, which also reports hidden ancestry
 * and truncation instead of presenting a clipped trail as complete.
 */
export function journeyHierarchyBreadcrumbs(input: JourneyHierarchyBreadcrumbInput): string[][] {
  return journeyHierarchyBreadcrumbTrails(input).trails.map((trail) => trail.definitionIds);
}
