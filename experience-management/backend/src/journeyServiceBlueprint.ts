/**
 * Pure in-memory service-blueprint contract for master-plan P4-04..P4-07.
 *
 * Shapes, enumerations, and bounds mirror runtime-29
 * (`migrations/postgres/0029_journey_hierarchy_blueprints.sql`) so a repository can persist an
 * analysed blueprint without a second, divergent rule set. Nothing here touches storage: the module
 * is dependency-free and every export is a pure function over caller-owned data.
 *
 * Runtime-29 is now in the supported runtime window, so these rules align with
 * the durable schema. This module is still only an in-memory contract: it is
 * not by itself evidence that the complete blueprint product surface is
 * shipped or release-qualified.
 */

export const JOURNEY_SERVICE_BLUEPRINT_VERSION = 'journey-service-blueprint/v1' as const;

export const journeyBlueprintStates = ['current', 'future'] as const;

export type JourneyBlueprintState = typeof journeyBlueprintStates[number];

export const journeyBlueprintLanes = [
  'customer',
  'frontstage',
  'backstage',
  'supporting_system',
  'policy_control'
] as const;

export type JourneyBlueprintLane = typeof journeyBlueprintLanes[number];

export const journeyBlueprintLineKinds = [
  'interaction',
  'visibility',
  'internal_interaction'
] as const;

export type JourneyBlueprintLineKind = typeof journeyBlueprintLineKinds[number];

/** Mirrors the runtime-29 `journey_blueprint_elements.kind` check. */
export const journeyBlueprintElementKinds = [
  'action',
  'touchpoint',
  'process',
  'system',
  'policy',
  'control',
  'handoff',
  'failure_point'
] as const;

export type JourneyBlueprintElementKind = typeof journeyBlueprintElementKinds[number];

/** Mirrors the runtime-29 `journey_blueprint_relationships.kind` check. */
export const journeyBlueprintRelationshipKinds = [
  'supports',
  'depends_on',
  'handoff_to',
  'causes',
  'mitigates',
  'governed_by'
] as const;

export type JourneyBlueprintRelationshipKind = typeof journeyBlueprintRelationshipKinds[number];

/** Mirrors the runtime-29 `journey_blueprint_resources.kind` check. */
export const journeyBlueprintResourceKinds = ['team', 'actor', 'system', 'vendor', 'policy', 'control'] as const;

export type JourneyBlueprintResourceKind = typeof journeyBlueprintResourceKinds[number];

export const journeyBlueprintResourceLifecycles = ['active', 'retired'] as const;

export type JourneyBlueprintResourceLifecycle = typeof journeyBlueprintResourceLifecycles[number];

/** Mirrors the runtime-29 `journey_blueprint_versions.review_state` check. */
export const journeyBlueprintReviewStates = ['draft', 'in_review', 'approved', 'changes_requested'] as const;

export type JourneyBlueprintReviewState = typeof journeyBlueprintReviewStates[number];

/** Mirrors the runtime-29 `journey_blueprint_portfolio_links.relationship` check. */
export const journeyBlueprintPortfolioRelationships = ['causes', 'affected_by', 'mitigated_by', 'improved_by'] as const;

export type JourneyBlueprintPortfolioRelationship = typeof journeyBlueprintPortfolioRelationships[number];

/**
 * Must stay identical to `JourneyPortfolioItemKind` in `journeyPortfolioDomain.ts`. It is restated
 * here rather than imported so this contract keeps zero module dependencies; runtime validation
 * needs the values, not just the type.
 */
export const journeyBlueprintPortfolioItemKinds = ['pain_point', 'opportunity', 'solution', 'initiative'] as const;

export type JourneyBlueprintPortfolioItemKind = typeof journeyBlueprintPortfolioItemKinds[number];

/** Mirrors the runtime-29 `journey_blueprint_gap_assessments.gap_type` check. */
export const journeyBlueprintGapTypes = [
  'owner_missing',
  'handoff_missing',
  'support_missing',
  'control_missing',
  'sla_missing',
  'failure_unmitigated'
] as const;

export type JourneyBlueprintGapType = typeof journeyBlueprintGapTypes[number];

/** Mirrors the runtime-29 `journey_blueprint_gap_assessments.severity` check. */
export const journeyBlueprintGapSeverities = ['info', 'warning', 'critical'] as const;

export type JourneyBlueprintGapSeverity = typeof journeyBlueprintGapSeverities[number];

export type JourneyServiceBlueprintErrorCode =
  | 'BLUEPRINT_INVALID_INPUT'
  | 'BLUEPRINT_LIMIT'
  | 'BLUEPRINT_COMPARISON_CROSS_SPACE'
  | 'BLUEPRINT_COMPARISON_CROSS_JOURNEY'
  | 'BLUEPRINT_COMPARISON_SCHEMA_MISMATCH'
  | 'BLUEPRINT_COMPARISON_STATE'
  | 'BLUEPRINT_COMPARISON_SELF'
  | 'BLUEPRINT_COMPARISON_DUPLICATE_ID';

export class JourneyServiceBlueprintError extends Error {
  constructor(
    message: string,
    public code: JourneyServiceBlueprintErrorCode,
    public details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'JourneyServiceBlueprintError';
  }
}

export interface JourneyBlueprintLimits {
  stages: number;
  elements: number;
  relationships: number;
  resources: number;
  portfolioLinks: number;
}

/**
 * Collection ceilings. Elements sit well above the 50-stage x 20-lane editor budget while staying
 * far below the point where the O(V+E) passes below become the caller's latency problem.
 */
export const journeyBlueprintLimits: Readonly<JourneyBlueprintLimits> = Object.freeze({
  stages: 200,
  elements: 5_000,
  relationships: 20_000,
  resources: 2_000,
  portfolioLinks: 5_000
});

/** Text bounds copied from the runtime-29 CHECK constraints. */
const ID_MAXIMUM = 128;
const STAGE_KEY_MAXIMUM = 80;
const TITLE_MAXIMUM = 200;
const DESCRIPTION_MAXIMUM = 10_000;
const RESOURCE_DESCRIPTION_MAXIMUM = 5_000;
const LABEL_MAXIMUM = 500;
const REF_JSON_MAXIMUM_BYTES = 65_536;

export interface JourneyBlueprintStage {
  stageKey: string;
  name: string;
  ordinal: number;
}

export interface JourneyBlueprintElement {
  id: string;
  stageKey: string;
  lane: JourneyBlueprintLane;
  kind: JourneyBlueprintElementKind;
  title: string;
  description?: string;
  ownerTeamId?: string | null;
  actorId?: string | null;
  systemId?: string | null;
  vendorId?: string | null;
  controlId?: string | null;
  slaMinutes?: number | null;
  unitCost?: number | null;
  riskProbability?: number | null;
  riskImpact?: number | null;
  /**
   * Within-lane render position. Runtime-29 makes this NOT NULL with
   * `UNIQUE(version_id, stage_key, lane, ordinal)`; it stays optional here so a caller can analyse
   * a blueprint before laying it out, but uniqueness is enforced whenever it is supplied.
   */
  ordinal?: number | null;
  evidenceRefs?: string[];
  metricRefs?: string[];
}

export interface JourneyBlueprintRelationship {
  id: string;
  kind: JourneyBlueprintRelationshipKind;
  fromElementId: string;
  toElementId: string;
  label?: string;
}

/**
 * Optional catalogue backing the element role references. Runtime-29 enforces existence, kind, and
 * active lifecycle with triggers; supplying this array reproduces that check in memory. Omitting it
 * means the role references are NOT validated, which `analysis.resourceValidation` reports.
 */
export interface JourneyBlueprintResource {
  id: string;
  kind: JourneyBlueprintResourceKind;
  name?: string;
  description?: string;
  lifecycle?: JourneyBlueprintResourceLifecycle;
  spaceId?: string;
}

/** Typed element-to-portfolio causality; mirrors runtime-29 `journey_blueprint_portfolio_links`. */
export interface JourneyBlueprintPortfolioLink {
  id: string;
  elementId: string;
  portfolioItemId: string;
  portfolioItemKind: JourneyBlueprintPortfolioItemKind;
  /** Pinned so a link cannot silently re-point at a later portfolio revision. */
  portfolioItemRevision: number;
  relationship: JourneyBlueprintPortfolioRelationship;
  spaceId?: string;
}

export interface JourneyServiceBlueprint {
  schemaVersion: typeof JOURNEY_SERVICE_BLUEPRINT_VERSION;
  blueprintId: string;
  spaceId: string;
  journeyDefinitionId: string;
  journeyVersionId: string;
  state: JourneyBlueprintState;
  /** Runtime-29 `journey_blueprint_versions.id`; comparisons key on it when both sides supply one. */
  versionId?: string | null;
  versionNumber?: number | null;
  reviewState?: JourneyBlueprintReviewState | null;
  stages: JourneyBlueprintStage[];
  elements: JourneyBlueprintElement[];
  relationships: JourneyBlueprintRelationship[];
  resources?: JourneyBlueprintResource[];
  portfolioLinks?: JourneyBlueprintPortfolioLink[];
}

export type JourneyBlueprintIssueSeverity = 'error' | 'warning';

export interface JourneyBlueprintIssue {
  severity: JourneyBlueprintIssueSeverity;
  code: string;
  message: string;
  elementId?: string;
  relationshipId?: string;
  stageKey?: string;
  /** Names the offending field so a caller never has to parse `message`. */
  field?: string;
  portfolioLinkId?: string;
  /** Set on review warnings that map onto a runtime-29 gap-assessment row. */
  gapType?: JourneyBlueprintGapType;
  gapSeverity?: JourneyBlueprintGapSeverity;
}

export interface JourneyBlueprintLineCrossing {
  relationshipId: string;
  lines: JourneyBlueprintLineKind[];
}

export type JourneyBlueprintTraceGap =
  | 'causing_element'
  | 'backstage_process'
  | 'supporting_system'
  | 'owner'
  | 'sla'
  | 'improvement_initiative';

export interface JourneyBlueprintPainPointTrace {
  portfolioItemId: string;
  causingElementIds: string[];
  traceElementIds: string[];
  hasBackstageProcess: boolean;
  hasSupportingSystem: boolean;
  hasOwner: boolean;
  hasSla: boolean;
  hasImprovementInitiative: boolean;
  /** Absent links are reported, never inferred. */
  missing: JourneyBlueprintTraceGap[];
}

export interface JourneyBlueprintCausality {
  linkedPortfolioItems: number;
  painPointTraces: JourneyBlueprintPainPointTrace[];
  fullyTracedPainPoints: number;
}

export interface JourneyBlueprintAnalysis {
  valid: boolean;
  issues: JourneyBlueprintIssue[];
  crossings: JourneyBlueprintLineCrossing[];
  risk: Array<{
    elementId: string;
    score: number;
    probability: number;
    impact: number;
  }>;
  coverage: {
    frontstageElements: number;
    supportedFrontstageElements: number;
    backstageElements: number;
    systemSupportedBackstageElements: number;
    failurePoints: number;
    mitigatedFailurePoints: number;
  };
  causality: JourneyBlueprintCausality;
  /** `enforced` is false when no resource catalogue was supplied, so role refs went unchecked. */
  resourceValidation: {
    enforced: boolean;
    catalogueSize: number;
  };
}

export interface JourneyBlueprintComparison {
  spaceId: string;
  journeyDefinitionId: string;
  fromBlueprintId: string;
  toBlueprintId: string;
  fromVersionId: string | null;
  toVersionId: string | null;
  fromJourneyVersionId: string;
  toJourneyVersionId: string;
  fromState: JourneyBlueprintState;
  toState: JourneyBlueprintState;
  addedStageKeys: string[];
  removedStageKeys: string[];
  changedStages: Array<{
    stageKey: string;
    fields: string[];
  }>;
  addedElementIds: string[];
  removedElementIds: string[];
  changed: Array<{
    elementId: string;
    fields: string[];
  }>;
  addedRelationshipIds: string[];
  removedRelationshipIds: string[];
  changedRelationshipIds: string[];
  addedPortfolioLinkIds: string[];
  removedPortfolioLinkIds: string[];
  changedPortfolioLinkIds: string[];
}

const laneRank: Record<JourneyBlueprintLane, number> = {
  customer: 0,
  frontstage: 1,
  backstage: 2,
  supporting_system: 3,
  policy_control: 4
};

/**
 * Only the three industry-standard lines exist. Rank 3 (supporting system to policy/control) is
 * deliberately absent: `docs/journey-management/SERVICE-BLUEPRINT-CONTRACT-V1.md` records that no
 * fourth line is invented, so such a relationship legitimately crosses nothing.
 */
const boundaryAfterRank: Record<number, JourneyBlueprintLineKind> = {
  0: 'interaction',
  1: 'visibility',
  2: 'internal_interaction'
};

/** Which portfolio item kinds each causal relationship may point at. */
const portfolioRelationshipTargets: Record<JourneyBlueprintPortfolioRelationship, readonly JourneyBlueprintPortfolioItemKind[]> = {
  causes: ['pain_point'],
  affected_by: ['pain_point', 'opportunity'],
  mitigated_by: ['solution', 'initiative'],
  improved_by: ['solution', 'initiative']
};

const laneSet = new Set<string>(journeyBlueprintLanes);
const stateSet = new Set<string>(journeyBlueprintStates);
const elementKindSet = new Set<string>(journeyBlueprintElementKinds);
const relationshipKindSet = new Set<string>(journeyBlueprintRelationshipKinds);
const resourceKindSet = new Set<string>(journeyBlueprintResourceKinds);
const resourceLifecycleSet = new Set<string>(journeyBlueprintResourceLifecycles);
const reviewStateSet = new Set<string>(journeyBlueprintReviewStates);
const portfolioItemKindSet = new Set<string>(journeyBlueprintPortfolioItemKinds);
const portfolioRelationshipSet = new Set<string>(journeyBlueprintPortfolioRelationships);
const operationalLanes = new Set<JourneyBlueprintLane>(['frontstage', 'backstage', 'supporting_system', 'policy_control']);

/** Element role reference to the resource kind runtime-29 requires it to point at. */
const roleResourceKinds = [
  { field: 'ownerTeamId', kind: 'team' },
  { field: 'actorId', kind: 'actor' },
  { field: 'systemId', kind: 'system' },
  { field: 'vendorId', kind: 'vendor' },
  { field: 'controlId', kind: 'control' }
] as const;

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requiredText(value: unknown) {
  return typeof value === 'string' && Boolean(value.trim());
}

/**
 * Runtime-29 bounds identifiers by length alone. No character class is imposed: a stricter pattern
 * would reject IDs the durable store accepts, which would fail closed against valid data.
 */
function isId(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim()) && value.length <= ID_MAXIMUM;
}

function finiteWithin(value: unknown, minimum: number, maximum: number) {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Runtime-29 bounds the serialised ref arrays by octet length, not element count. */
function refBytes(value: string[]) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/**
 * Composite keys are built by serialising the parts as an array. Concatenating with a separator
 * would let two different ID pairs collide whenever an ID contains the separator, and IDs are
 * caller-supplied text. Mirrors the `logicalKey` idiom in `journeyHierarchy.ts`.
 */
function compositeKey(parts: readonly unknown[]) {
  return JSON.stringify(parts);
}

function canonicalStrings(value: unknown) {
  if (!Array.isArray(value)) return [];
  const text = value.filter((item): item is string => typeof item === 'string');
  return [...new Set(text.map((item) => item.trim()).filter(Boolean))].sort(compareText);
}

function canonicalStage(stage: JourneyBlueprintStage) {
  return {
    name: typeof stage.name === 'string' ? stage.name.trim() : stage.name,
    ordinal: stage.ordinal ?? null
  };
}

function canonicalElement(element: JourneyBlueprintElement) {
  return {
    stageKey: element.stageKey,
    lane: element.lane,
    kind: element.kind,
    title: typeof element.title === 'string' ? element.title.trim() : element.title,
    description: (typeof element.description === 'string' ? element.description.trim() : '') || '',
    ownerTeamId: element.ownerTeamId || null,
    actorId: element.actorId || null,
    systemId: element.systemId || null,
    vendorId: element.vendorId || null,
    controlId: element.controlId || null,
    slaMinutes: element.slaMinutes ?? null,
    unitCost: element.unitCost ?? null,
    riskProbability: element.riskProbability ?? null,
    riskImpact: element.riskImpact ?? null,
    ordinal: element.ordinal ?? null,
    evidenceRefs: canonicalStrings(element.evidenceRefs),
    metricRefs: canonicalStrings(element.metricRefs)
  };
}

function canonicalRelationship(relationship: JourneyBlueprintRelationship) {
  return {
    kind: relationship.kind,
    fromElementId: relationship.fromElementId,
    toElementId: relationship.toElementId,
    label: (typeof relationship.label === 'string' ? relationship.label.trim() : '') || ''
  };
}

function canonicalPortfolioLink(link: JourneyBlueprintPortfolioLink) {
  return {
    elementId: link.elementId,
    portfolioItemId: link.portfolioItemId,
    portfolioItemKind: link.portfolioItemKind,
    portfolioItemRevision: link.portfolioItemRevision ?? null,
    relationship: link.relationship
  };
}

/**
 * `JSON.stringify` collapses NaN and +/-Infinity to `null`, which would report an invalid number as
 * equal to an absent one. Tagging them keeps a malformed value distinguishable from a missing value.
 */
function stableJson(value: unknown) {
  return JSON.stringify(value, (_key, item: unknown) => (
    typeof item === 'number' && !Number.isFinite(item) ? `#${String(item)}` : item
  ));
}

function changedFields<T extends Record<string, unknown>>(left: T, right: T) {
  const fields = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...fields].filter((field) => stableJson(left[field]) !== stableJson(right[field])).sort(compareText);
}

function invalidInput(message: string, details: Record<string, unknown> = {}): never {
  throw new JourneyServiceBlueprintError(message, 'BLUEPRINT_INVALID_INPUT', details);
}

/**
 * Structural gate. Malformed shapes and limit breaches throw a typed error because they cannot
 * produce a meaningful analysis; field-level problems become issues so a caller sees every one.
 */
function assertBlueprintShape(blueprint: JourneyServiceBlueprint, label: string) {
  if (!blueprint || typeof blueprint !== 'object' || Array.isArray(blueprint)) {
    invalidInput('A service blueprint must be an object.', { field: label });
  }
  const collections = [
    { field: 'stages', value: blueprint.stages, limit: journeyBlueprintLimits.stages, required: true },
    { field: 'elements', value: blueprint.elements, limit: journeyBlueprintLimits.elements, required: true },
    { field: 'relationships', value: blueprint.relationships, limit: journeyBlueprintLimits.relationships, required: true },
    { field: 'resources', value: blueprint.resources, limit: journeyBlueprintLimits.resources, required: false },
    { field: 'portfolioLinks', value: blueprint.portfolioLinks, limit: journeyBlueprintLimits.portfolioLinks, required: false }
  ];
  for (const collection of collections) {
    if (!collection.required && (collection.value === undefined || collection.value === null)) continue;
    if (!Array.isArray(collection.value)) {
      invalidInput(`Service blueprint ${collection.field} must be an array.`, { field: `${label}.${collection.field}` });
    }
    if (collection.value.length > collection.limit) {
      throw new JourneyServiceBlueprintError(
        `Service blueprint ${collection.field} exceed the supported limit.`,
        'BLUEPRINT_LIMIT',
        { field: `${label}.${collection.field}`, value: collection.value.length, maximum: collection.limit }
      );
    }
    for (const entry of collection.value) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        invalidInput(`Every service blueprint ${collection.field} entry must be an object.`, {
          field: `${label}.${collection.field}`
        });
      }
    }
  }
}

/**
 * Tarjan's strongly-connected components over `depends_on` edges, driven by an explicit frame stack.
 * The recursive walk this replaces copied the whole path per edge, which is quadratic in allocation
 * and overflows the call stack well inside the `elements` limit.
 */
function dependencyCycles(elementIds: ReadonlySet<string>, relationships: readonly JourneyBlueprintRelationship[]) {
  const edges = new Map<string, string[]>();
  const cyclic = new Set<string>();
  for (const relationship of relationships) {
    if (relationship.kind !== 'depends_on') continue;
    const from = relationship.fromElementId;
    const to = relationship.toElementId;
    if (!elementIds.has(from) || !elementIds.has(to)) continue;
    if (from === to) {
      cyclic.add(from);
      continue;
    }
    const targets = edges.get(from);
    if (targets) targets.push(to);
    else edges.set(from, [to]);
  }
  for (const targets of edges.values()) targets.sort(compareText);

  const index = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const onStack = new Set<string>();
  const componentStack: string[] = [];
  let counter = 0;

  for (const root of [...elementIds].sort(compareText)) {
    if (index.has(root)) continue;
    index.set(root, counter);
    lowLink.set(root, counter);
    counter += 1;
    componentStack.push(root);
    onStack.add(root);
    const frames: Array<{ id: string; cursor: number }> = [{ id: root, cursor: 0 }];
    while (frames.length) {
      const frame = frames[frames.length - 1]!;
      const targets = edges.get(frame.id) || [];
      if (frame.cursor < targets.length) {
        const target = targets[frame.cursor]!;
        frame.cursor += 1;
        if (!index.has(target)) {
          index.set(target, counter);
          lowLink.set(target, counter);
          counter += 1;
          componentStack.push(target);
          onStack.add(target);
          frames.push({ id: target, cursor: 0 });
        } else if (onStack.has(target)) {
          lowLink.set(frame.id, Math.min(lowLink.get(frame.id)!, index.get(target)!));
        }
        continue;
      }
      frames.pop();
      const parent = frames[frames.length - 1];
      if (parent) lowLink.set(parent.id, Math.min(lowLink.get(parent.id)!, lowLink.get(frame.id)!));
      if (lowLink.get(frame.id) === index.get(frame.id)) {
        const component: string[] = [];
        for (;;) {
          const member = componentStack.pop()!;
          onStack.delete(member);
          component.push(member);
          if (member === frame.id) break;
        }
        if (component.length > 1) for (const member of component) cyclic.add(member);
      }
    }
  }
  return [...cyclic].sort(compareText);
}

export function blueprintLineCrossings(
  relationship: JourneyBlueprintRelationship,
  elementById: ReadonlyMap<string, JourneyBlueprintElement>
): JourneyBlueprintLineKind[] {
  const from = elementById.get(relationship.fromElementId);
  const to = elementById.get(relationship.toElementId);
  if (!from || !to || from.lane === to.lane) return [];
  const fromRank = laneRank[from.lane];
  const toRank = laneRank[to.lane];
  if (fromRank === undefined || toRank === undefined) return [];
  const minimum = Math.min(fromRank, toRank);
  const maximum = Math.max(fromRank, toRank);
  const lines: JourneyBlueprintLineKind[] = [];
  for (let rank = minimum; rank < maximum; rank += 1) {
    const line = boundaryAfterRank[rank];
    if (line) lines.push(line);
  }
  return lines;
}

export function analyseServiceBlueprint(blueprint: JourneyServiceBlueprint): JourneyBlueprintAnalysis {
  assertBlueprintShape(blueprint, 'blueprint');
  const issues: JourneyBlueprintIssue[] = [];
  const issue = (entry: JourneyBlueprintIssue) => issues.push(entry);

  if (blueprint.schemaVersion !== JOURNEY_SERVICE_BLUEPRINT_VERSION) {
    issue({ severity: 'error', code: 'BLUEPRINT_SCHEMA_UNSUPPORTED', message: 'The service blueprint schema version is unsupported.', field: 'schemaVersion' });
  }
  for (const [field, value] of Object.entries({
    blueprintId: blueprint.blueprintId,
    spaceId: blueprint.spaceId,
    journeyDefinitionId: blueprint.journeyDefinitionId,
    journeyVersionId: blueprint.journeyVersionId
  })) {
    if (!isId(value)) {
      issue({ severity: 'error', code: 'BLUEPRINT_IDENTITY_REQUIRED', message: `${field} is required.`, field });
    }
  }
  if (!stateSet.has(blueprint.state)) {
    issue({ severity: 'error', code: 'BLUEPRINT_STATE_INVALID', message: 'Blueprint state must be current or future.', field: 'state' });
  }
  if (blueprint.versionId !== undefined && blueprint.versionId !== null && !isId(blueprint.versionId)) {
    issue({ severity: 'error', code: 'BLUEPRINT_VERSION_IDENTITY_INVALID', message: 'versionId must be a valid identifier when supplied.', field: 'versionId' });
  }
  if (blueprint.versionNumber !== undefined && blueprint.versionNumber !== null
    && (!Number.isSafeInteger(blueprint.versionNumber) || blueprint.versionNumber < 1)) {
    issue({ severity: 'error', code: 'BLUEPRINT_VERSION_NUMBER_INVALID', message: 'versionNumber must be a positive whole number when supplied.', field: 'versionNumber' });
  }
  if (blueprint.reviewState !== undefined && blueprint.reviewState !== null && !reviewStateSet.has(blueprint.reviewState)) {
    issue({ severity: 'error', code: 'BLUEPRINT_REVIEW_STATE_INVALID', message: 'reviewState is unsupported.', field: 'reviewState' });
  }

  const stageByKey = new Map<string, JourneyBlueprintStage>();
  const stageOrdinals = new Set<number>();
  for (const stage of blueprint.stages) {
    const validKey = requiredText(stage.stageKey) && stage.stageKey.length <= STAGE_KEY_MAXIMUM;
    const validName = requiredText(stage.name) && stage.name.length <= TITLE_MAXIMUM;
    if (!validKey || !validName || !Number.isInteger(stage.ordinal) || stage.ordinal < 0) {
      issue({ severity: 'error', code: 'BLUEPRINT_STAGE_INVALID', message: 'Stages require a key, name, and non-negative integer ordinal.', stageKey: typeof stage.stageKey === 'string' ? stage.stageKey : undefined });
      continue;
    }
    if (stageByKey.has(stage.stageKey)) {
      issue({ severity: 'error', code: 'BLUEPRINT_STAGE_DUPLICATE', message: `Stage key ${stage.stageKey} is duplicated.`, stageKey: stage.stageKey });
      continue;
    }
    if (stageOrdinals.has(stage.ordinal)) {
      issue({ severity: 'error', code: 'BLUEPRINT_STAGE_ORDINAL_DUPLICATE', message: `Stage ordinal ${stage.ordinal} is duplicated.`, stageKey: stage.stageKey });
    }
    stageByKey.set(stage.stageKey, stage);
    stageOrdinals.add(stage.ordinal);
  }
  if (!blueprint.stages.length) {
    issue({ severity: 'error', code: 'BLUEPRINT_STAGE_REQUIRED', message: 'A service blueprint requires at least one stage.' });
  }

  const resourceById = new Map<string, JourneyBlueprintResource>();
  const resourcesSupplied = Array.isArray(blueprint.resources);
  if (resourcesSupplied) {
    for (const resource of blueprint.resources!) {
      if (!isId(resource.id) || !resourceKindSet.has(resource.kind)) {
        issue({ severity: 'error', code: 'BLUEPRINT_RESOURCE_INVALID', message: 'Blueprint resources require an identifier and a supported kind.', field: 'resources' });
        continue;
      }
      if (resource.lifecycle !== undefined && resource.lifecycle !== null && !resourceLifecycleSet.has(resource.lifecycle)) {
        issue({ severity: 'error', code: 'BLUEPRINT_RESOURCE_INVALID', message: `Resource ${resource.id} has an unsupported lifecycle.`, field: 'resources.lifecycle' });
        continue;
      }
      if (typeof resource.description === 'string' && resource.description.length > RESOURCE_DESCRIPTION_MAXIMUM) {
        issue({ severity: 'error', code: 'BLUEPRINT_RESOURCE_INVALID', message: `Resource ${resource.id} description is too long.`, field: 'resources.description' });
        continue;
      }
      if (resourceById.has(resource.id)) {
        issue({ severity: 'error', code: 'BLUEPRINT_RESOURCE_DUPLICATE', message: `Resource ${resource.id} is duplicated.`, field: 'resources' });
        continue;
      }
      if (resource.spaceId !== undefined && resource.spaceId !== null && resource.spaceId !== blueprint.spaceId) {
        issue({ severity: 'error', code: 'BLUEPRINT_RESOURCE_CROSS_SPACE', message: `Resource ${resource.id} belongs to another space.`, field: 'resources.spaceId' });
        continue;
      }
      resourceById.set(resource.id, resource);
    }
  }

  const elementById = new Map<string, JourneyBlueprintElement>();
  const elementPositions = new Set<string>();
  for (const element of blueprint.elements) {
    const validId = isId(element.id);
    const validTitle = requiredText(element.title) && element.title.length <= TITLE_MAXIMUM;
    if (!validId || !validTitle) {
      issue({ severity: 'error', code: 'BLUEPRINT_ELEMENT_INVALID', message: 'Blueprint elements require an ID and title.', elementId: typeof element.id === 'string' ? element.id : undefined });
      // A malformed identifier must not become a resolvable relationship target.
      if (!validId) continue;
    }
    if (elementById.has(element.id)) {
      issue({ severity: 'error', code: 'BLUEPRINT_ELEMENT_DUPLICATE', message: `Element ${element.id} is duplicated.`, elementId: element.id });
      // The first declaration wins so lane derivation and coverage agree on one element per ID.
      continue;
    }
    elementById.set(element.id, element);
    if (!stageByKey.has(element.stageKey)) {
      issue({ severity: 'error', code: 'BLUEPRINT_ELEMENT_STAGE_MISSING', message: `Element ${element.id} references an unknown stage.`, elementId: element.id, stageKey: element.stageKey });
    }
    if (!laneSet.has(element.lane)) {
      issue({ severity: 'error', code: 'BLUEPRINT_LANE_INVALID', message: `Element ${element.id} has an unsupported lane.`, elementId: element.id, field: 'lane' });
    }
    if (!elementKindSet.has(element.kind)) {
      issue({ severity: 'error', code: 'BLUEPRINT_ELEMENT_KIND_INVALID', message: `Element ${element.id} has an unsupported kind.`, elementId: element.id, field: 'kind' });
    }
    if (typeof element.description === 'string' && element.description.length > DESCRIPTION_MAXIMUM) {
      issue({ severity: 'error', code: 'BLUEPRINT_ELEMENT_TEXT_TOO_LONG', message: `Element ${element.id} description is too long.`, elementId: element.id, field: 'description' });
    }
    if (element.ordinal !== undefined && element.ordinal !== null) {
      if (!Number.isInteger(element.ordinal) || element.ordinal < 0) {
        issue({ severity: 'error', code: 'BLUEPRINT_ELEMENT_ORDINAL_INVALID', message: `Element ${element.id} ordinal must be a non-negative integer.`, elementId: element.id, field: 'ordinal' });
      } else {
        const position = compositeKey([element.stageKey, element.lane, element.ordinal]);
        if (elementPositions.has(position)) {
          issue({ severity: 'error', code: 'BLUEPRINT_ELEMENT_POSITION_DUPLICATE', message: `Element ${element.id} repeats a stage, lane, and ordinal position.`, elementId: element.id, field: 'ordinal' });
        }
        elementPositions.add(position);
      }
    }
    for (const ref of ['evidenceRefs', 'metricRefs'] as const) {
      const value = element[ref];
      if (value === undefined || value === null) continue;
      if (!isStringArray(value)) {
        issue({ severity: 'error', code: 'BLUEPRINT_ELEMENT_REFS_INVALID', message: `Element ${element.id} ${ref} must be an array of strings.`, elementId: element.id, field: ref });
        continue;
      }
      if (refBytes(value) > REF_JSON_MAXIMUM_BYTES) {
        issue({ severity: 'error', code: 'BLUEPRINT_ELEMENT_REFS_TOO_LARGE', message: `Element ${element.id} ${ref} exceed the supported size.`, elementId: element.id, field: ref });
      }
    }
    if (operationalLanes.has(element.lane) && !requiredText(element.ownerTeamId)) {
      issue({ severity: 'warning', code: 'BLUEPRINT_OWNER_MISSING', message: `Operational element ${element.id} has no owner team.`, elementId: element.id, gapType: 'owner_missing', gapSeverity: 'warning' });
    }
    if (element.slaMinutes !== null && element.slaMinutes !== undefined && (!Number.isFinite(element.slaMinutes) || element.slaMinutes <= 0)) {
      issue({ severity: 'error', code: 'BLUEPRINT_SLA_INVALID', message: `Element ${element.id} has an invalid SLA.`, elementId: element.id, field: 'slaMinutes' });
    }
    if (element.unitCost !== null && element.unitCost !== undefined && (!Number.isFinite(element.unitCost) || element.unitCost < 0)) {
      issue({ severity: 'error', code: 'BLUEPRINT_COST_INVALID', message: `Element ${element.id} has an invalid unit cost.`, elementId: element.id, field: 'unitCost' });
    }
    const riskValues = [element.riskProbability, element.riskImpact].filter((value) => value !== null && value !== undefined);
    if (riskValues.some((value) => !finiteWithin(value, 0, 1))) {
      issue({ severity: 'error', code: 'BLUEPRINT_RISK_INVALID', message: `Element ${element.id} risk probability and impact must be between 0 and 1.`, elementId: element.id, field: 'riskProbability' });
    }
    if ((element.riskProbability === null || element.riskProbability === undefined)
      !== (element.riskImpact === null || element.riskImpact === undefined)) {
      issue({ severity: 'error', code: 'BLUEPRINT_RISK_INCOMPLETE', message: `Element ${element.id} needs both risk probability and impact.`, elementId: element.id, field: 'riskImpact' });
    }
    // Runtime-29 enforces these with triggers; without a catalogue there is nothing to check against.
    if (resourcesSupplied) {
      for (const role of roleResourceKinds) {
        const reference = element[role.field];
        if (reference === undefined || reference === null || reference === '') continue;
        const resource = typeof reference === 'string' ? resourceById.get(reference) : undefined;
        if (!resource) {
          issue({ severity: 'error', code: 'BLUEPRINT_RESOURCE_MISSING', message: `Element ${element.id} ${role.field} references an unknown resource.`, elementId: element.id, field: role.field });
          continue;
        }
        if (resource.kind !== role.kind) {
          issue({ severity: 'error', code: 'BLUEPRINT_RESOURCE_KIND_MISMATCH', message: `Element ${element.id} ${role.field} must reference a ${role.kind} resource.`, elementId: element.id, field: role.field });
          continue;
        }
        if ((resource.lifecycle ?? 'active') !== 'active') {
          issue({ severity: 'error', code: 'BLUEPRINT_RESOURCE_RETIRED', message: `Element ${element.id} ${role.field} references a retired resource.`, elementId: element.id, field: role.field });
        }
      }
    }
  }

  const relationshipIds = new Set<string>();
  const relationshipFingerprints = new Set<string>();
  const resolvedRelationships: JourneyBlueprintRelationship[] = [];
  for (const relationship of blueprint.relationships) {
    if (!isId(relationship.id)) {
      issue({ severity: 'error', code: 'BLUEPRINT_RELATIONSHIP_ID_REQUIRED', message: 'Blueprint relationships require an ID.', field: 'id' });
      continue;
    }
    if (relationshipIds.has(relationship.id)) {
      issue({ severity: 'error', code: 'BLUEPRINT_RELATIONSHIP_ID_DUPLICATE', message: `Relationship ${relationship.id} is duplicated.`, relationshipId: relationship.id });
      continue;
    }
    relationshipIds.add(relationship.id);
    if (!relationshipKindSet.has(relationship.kind)) {
      issue({ severity: 'error', code: 'BLUEPRINT_RELATIONSHIP_KIND_INVALID', message: `Relationship ${relationship.id} has an unsupported kind.`, relationshipId: relationship.id, field: 'kind' });
      continue;
    }
    if (typeof relationship.label === 'string' && relationship.label.length > LABEL_MAXIMUM) {
      issue({ severity: 'error', code: 'BLUEPRINT_RELATIONSHIP_LABEL_TOO_LONG', message: `Relationship ${relationship.id} label is too long.`, relationshipId: relationship.id, field: 'label' });
    }
    if (!elementById.has(relationship.fromElementId) || !elementById.has(relationship.toElementId)) {
      issue({ severity: 'error', code: 'BLUEPRINT_RELATIONSHIP_TARGET_MISSING', message: `Relationship ${relationship.id} references a missing element.`, relationshipId: relationship.id });
      continue;
    }
    if (relationship.fromElementId === relationship.toElementId) {
      issue({ severity: 'error', code: 'BLUEPRINT_RELATIONSHIP_SELF', message: `Relationship ${relationship.id} cannot target the same element.`, relationshipId: relationship.id });
    }
    const fingerprint = compositeKey([relationship.kind, relationship.fromElementId, relationship.toElementId]);
    if (relationshipFingerprints.has(fingerprint)) {
      issue({ severity: 'error', code: 'BLUEPRINT_RELATIONSHIP_DUPLICATE', message: `Relationship ${relationship.id} duplicates an existing relationship.`, relationshipId: relationship.id });
      continue;
    }
    relationshipFingerprints.add(fingerprint);
    resolvedRelationships.push(relationship);
    if (relationship.kind === 'handoff_to') {
      const from = elementById.get(relationship.fromElementId)!;
      const to = elementById.get(relationship.toElementId)!;
      if (from.ownerTeamId && to.ownerTeamId && from.ownerTeamId === to.ownerTeamId) {
        issue({ severity: 'warning', code: 'BLUEPRINT_HANDOFF_SAME_OWNER', message: `Handoff ${relationship.id} does not cross owner teams.`, relationshipId: relationship.id, gapType: 'handoff_missing', gapSeverity: 'warning' });
      }
    }
  }

  for (const elementId of dependencyCycles(new Set(elementById.keys()), resolvedRelationships)) {
    issue({ severity: 'error', code: 'BLUEPRINT_DEPENDENCY_CYCLE', message: `Element ${elementId} participates in a dependency cycle.`, elementId });
  }

  /**
   * Support is lane-directed. A frontstage element is supported by backstage work and a backstage
   * element by a supporting system; counting any `supports` edge regardless of its source lane
   * reported elements as covered when nothing below them supported anything. Only relationships with
   * both endpoints resolved participate, so a dangling edge can no longer silence a gap warning.
   */
  const supportedFromLane = (lane: JourneyBlueprintLane) => {
    const targets = new Set<string>();
    for (const relationship of resolvedRelationships) {
      if (relationship.kind !== 'supports') continue;
      if (elementById.get(relationship.fromElementId)?.lane !== lane) continue;
      targets.add(relationship.toElementId);
    }
    return targets;
  };
  const backstageSupported = supportedFromLane('backstage');
  const systemSupported = supportedFromLane('supporting_system');
  const mitigationTargets = new Set(resolvedRelationships
    .filter((relationship) => relationship.kind === 'mitigates')
    .map((relationship) => relationship.toElementId));

  const uniqueElements = [...elementById.values()];
  const frontstage = uniqueElements.filter((element) => element.lane === 'frontstage');
  const backstage = uniqueElements.filter((element) => element.lane === 'backstage');
  const failures = uniqueElements.filter((element) => element.kind === 'failure_point');
  for (const element of frontstage.filter((candidate) => !backstageSupported.has(candidate.id))) {
    issue({ severity: 'warning', code: 'BLUEPRINT_FRONTSTAGE_UNSUPPORTED', message: `Frontstage element ${element.id} has no supporting backstage relationship.`, elementId: element.id, stageKey: element.stageKey, gapType: 'support_missing', gapSeverity: 'warning' });
  }
  for (const element of backstage.filter((candidate) => !systemSupported.has(candidate.id))) {
    issue({ severity: 'warning', code: 'BLUEPRINT_BACKSTAGE_SYSTEM_MISSING', message: `Backstage element ${element.id} has no supporting-system relationship.`, elementId: element.id, stageKey: element.stageKey, gapType: 'support_missing', gapSeverity: 'warning' });
  }
  for (const element of failures.filter((candidate) => !mitigationTargets.has(candidate.id))) {
    issue({ severity: 'warning', code: 'BLUEPRINT_FAILURE_UNMITIGATED', message: `Failure point ${element.id} has no mitigation.`, elementId: element.id, stageKey: element.stageKey, gapType: 'failure_unmitigated', gapSeverity: 'warning' });
  }

  const causality = analysePortfolioCausality(blueprint, elementById, resolvedRelationships, issue);

  const crossings = blueprint.relationships
    .filter((relationship) => relationshipIds.has(relationship.id))
    .map((relationship) => ({
      relationshipId: relationship.id,
      lines: blueprintLineCrossings(relationship, elementById)
    }))
    .filter((entry) => entry.lines.length > 0)
    .sort((left, right) => compareText(left.relationshipId, right.relationshipId));
  const risk = uniqueElements
    .filter((element) => element.riskProbability !== null && element.riskProbability !== undefined
      && element.riskImpact !== null && element.riskImpact !== undefined
      && finiteWithin(element.riskProbability, 0, 1) && finiteWithin(element.riskImpact, 0, 1))
    .map((element) => ({
      elementId: element.id,
      score: Math.round(element.riskProbability! * element.riskImpact! * 10_000) / 10_000,
      probability: element.riskProbability!,
      impact: element.riskImpact!
    }))
    .sort((left, right) => right.score - left.score || compareText(left.elementId, right.elementId));
  // `message` is the final tiebreaker so repeated codes without an anchoring ID still order totally.
  issues.sort((left, right) => compareText(left.severity, right.severity)
    || compareText(left.code, right.code)
    || compareText(
      left.elementId || left.relationshipId || left.stageKey || left.portfolioLinkId || '',
      right.elementId || right.relationshipId || right.stageKey || right.portfolioLinkId || ''
    )
    || compareText(left.field || '', right.field || '')
    || compareText(left.message, right.message));
  return {
    valid: !issues.some((entry) => entry.severity === 'error'),
    issues,
    crossings,
    risk,
    coverage: {
      frontstageElements: frontstage.length,
      supportedFrontstageElements: frontstage.filter((element) => backstageSupported.has(element.id)).length,
      backstageElements: backstage.length,
      systemSupportedBackstageElements: backstage.filter((element) => systemSupported.has(element.id)).length,
      failurePoints: failures.length,
      mitigatedFailurePoints: failures.filter((element) => mitigationTargets.has(element.id)).length
    },
    causality,
    resourceValidation: { enforced: resourcesSupplied, catalogueSize: resourceById.size }
  };
}

/**
 * Validates typed element-to-portfolio links and traces each linked pain point back to the backstage
 * process, supporting system, owner, SLA, and improvement initiative that master-plan scenario 928
 * calls for. Every leg is reported as present or absent; nothing is inferred from adjacency.
 */
function analysePortfolioCausality(
  blueprint: JourneyServiceBlueprint,
  elementById: ReadonlyMap<string, JourneyBlueprintElement>,
  resolvedRelationships: readonly JourneyBlueprintRelationship[],
  issue: (entry: JourneyBlueprintIssue) => void
): JourneyBlueprintCausality {
  const links = Array.isArray(blueprint.portfolioLinks) ? blueprint.portfolioLinks : [];
  const linkIds = new Set<string>();
  const linkFingerprints = new Set<string>();
  const valid: JourneyBlueprintPortfolioLink[] = [];
  for (const link of links) {
    if (!isId(link.id)) {
      issue({ severity: 'error', code: 'BLUEPRINT_CAUSALITY_LINK_INVALID', message: 'Portfolio links require an identifier.', field: 'portfolioLinks.id' });
      continue;
    }
    if (linkIds.has(link.id)) {
      issue({ severity: 'error', code: 'BLUEPRINT_CAUSALITY_LINK_ID_DUPLICATE', message: `Portfolio link ${link.id} is duplicated.`, portfolioLinkId: link.id });
      continue;
    }
    linkIds.add(link.id);
    if (!portfolioRelationshipSet.has(link.relationship)) {
      issue({ severity: 'error', code: 'BLUEPRINT_CAUSALITY_RELATIONSHIP_INVALID', message: `Portfolio link ${link.id} has an unsupported relationship.`, portfolioLinkId: link.id, field: 'relationship' });
      continue;
    }
    if (!portfolioItemKindSet.has(link.portfolioItemKind)) {
      issue({ severity: 'error', code: 'BLUEPRINT_CAUSALITY_ITEM_KIND_INVALID', message: `Portfolio link ${link.id} has an unsupported portfolio item kind.`, portfolioLinkId: link.id, field: 'portfolioItemKind' });
      continue;
    }
    if (!isId(link.portfolioItemId)) {
      issue({ severity: 'error', code: 'BLUEPRINT_CAUSALITY_LINK_INVALID', message: `Portfolio link ${link.id} references an invalid portfolio item.`, portfolioLinkId: link.id, field: 'portfolioItemId' });
      continue;
    }
    if (!Number.isSafeInteger(link.portfolioItemRevision) || link.portfolioItemRevision < 1) {
      issue({ severity: 'error', code: 'BLUEPRINT_CAUSALITY_REVISION_INVALID', message: `Portfolio link ${link.id} must pin a positive portfolio item revision.`, portfolioLinkId: link.id, field: 'portfolioItemRevision' });
      continue;
    }
    if (link.spaceId !== undefined && link.spaceId !== null && link.spaceId !== blueprint.spaceId) {
      issue({ severity: 'error', code: 'BLUEPRINT_CAUSALITY_CROSS_SPACE', message: `Portfolio link ${link.id} belongs to another space.`, portfolioLinkId: link.id, field: 'spaceId' });
      continue;
    }
    const element = elementById.get(link.elementId);
    if (!element) {
      issue({ severity: 'error', code: 'BLUEPRINT_CAUSALITY_ELEMENT_MISSING', message: `Portfolio link ${link.id} references a missing element.`, portfolioLinkId: link.id, field: 'elementId' });
      continue;
    }
    if (!portfolioRelationshipTargets[link.relationship].includes(link.portfolioItemKind)) {
      issue({ severity: 'error', code: 'BLUEPRINT_CAUSALITY_KIND_INCOMPATIBLE', message: `Portfolio link ${link.id} cannot relate a ${link.portfolioItemKind} by ${link.relationship}.`, portfolioLinkId: link.id, field: 'portfolioItemKind' });
      continue;
    }
    // Service design attributes customer-facing pain to the service, not to the customer's own action.
    if (link.relationship === 'causes' && element.lane === 'customer') {
      issue({ severity: 'error', code: 'BLUEPRINT_CAUSALITY_LANE_INVALID', message: `Portfolio link ${link.id} cannot make a customer-lane element the cause.`, portfolioLinkId: link.id, elementId: link.elementId, field: 'elementId' });
      continue;
    }
    const fingerprint = compositeKey([link.elementId, link.portfolioItemId, link.relationship]);
    if (linkFingerprints.has(fingerprint)) {
      issue({ severity: 'error', code: 'BLUEPRINT_CAUSALITY_LINK_DUPLICATE', message: `Portfolio link ${link.id} duplicates an existing link.`, portfolioLinkId: link.id });
      continue;
    }
    linkFingerprints.add(fingerprint);
    valid.push(link);
  }

  const supportersOf = new Map<string, string[]>();
  const dependenciesOf = new Map<string, string[]>();
  for (const relationship of resolvedRelationships) {
    if (relationship.kind === 'supports') {
      const existing = supportersOf.get(relationship.toElementId);
      if (existing) existing.push(relationship.fromElementId);
      else supportersOf.set(relationship.toElementId, [relationship.fromElementId]);
    } else if (relationship.kind === 'depends_on') {
      const existing = dependenciesOf.get(relationship.fromElementId);
      if (existing) existing.push(relationship.toElementId);
      else dependenciesOf.set(relationship.fromElementId, [relationship.toElementId]);
    }
  }

  const improvedElements = new Set(valid
    .filter((link) => link.portfolioItemKind === 'initiative'
      && (link.relationship === 'mitigated_by' || link.relationship === 'improved_by'))
    .map((link) => link.elementId));

  const causesByItem = new Map<string, Set<string>>();
  for (const link of valid) {
    if (link.relationship !== 'causes') continue;
    const existing = causesByItem.get(link.portfolioItemId);
    if (existing) existing.add(link.elementId);
    else causesByItem.set(link.portfolioItemId, new Set([link.elementId]));
  }

  const painPointTraces: JourneyBlueprintPainPointTrace[] = [...causesByItem.entries()]
    .sort((left, right) => compareText(left[0], right[0]))
    .map(([portfolioItemId, causeIds]) => {
      const causingElementIds = [...causeIds].sort(compareText);
      // One hop only: the elements that support a cause, and the elements a cause depends on.
      const traceIds = new Set(causingElementIds);
      for (const causeId of causingElementIds) {
        for (const supporter of supportersOf.get(causeId) || []) traceIds.add(supporter);
        for (const dependency of dependenciesOf.get(causeId) || []) traceIds.add(dependency);
      }
      const traceElementIds = [...traceIds].sort(compareText);
      const traceElements = traceElementIds
        .map((id) => elementById.get(id))
        .filter((element): element is JourneyBlueprintElement => Boolean(element));
      const causingElements = causingElementIds
        .map((id) => elementById.get(id))
        .filter((element): element is JourneyBlueprintElement => Boolean(element));
      const hasBackstageProcess = traceElements.some((element) => element.lane === 'backstage');
      const hasSupportingSystem = traceElements.some((element) => element.lane === 'supporting_system');
      const hasOwner = causingElements.length > 0 && causingElements.every((element) => requiredText(element.ownerTeamId));
      const hasSla = traceElements.some((element) => typeof element.slaMinutes === 'number'
        && Number.isFinite(element.slaMinutes) && element.slaMinutes > 0);
      const hasImprovementInitiative = traceElementIds.some((id) => improvedElements.has(id));
      const missing: JourneyBlueprintTraceGap[] = [];
      if (!causingElements.length) missing.push('causing_element');
      if (!hasBackstageProcess) missing.push('backstage_process');
      if (!hasSupportingSystem) missing.push('supporting_system');
      if (!hasOwner) missing.push('owner');
      if (!hasSla) missing.push('sla');
      if (!hasImprovementInitiative) missing.push('improvement_initiative');
      return {
        portfolioItemId,
        causingElementIds,
        traceElementIds,
        hasBackstageProcess,
        hasSupportingSystem,
        hasOwner,
        hasSla,
        hasImprovementInitiative,
        missing
      };
    });

  return {
    linkedPortfolioItems: new Set(valid.map((link) => link.portfolioItemId)).size,
    painPointTraces,
    fullyTracedPainPoints: painPointTraces.filter((trace) => trace.missing.length === 0).length
  };
}

function comparisonIdentity(blueprint: JourneyServiceBlueprint, label: string) {
  assertBlueprintShape(blueprint, label);
  if (blueprint.schemaVersion !== JOURNEY_SERVICE_BLUEPRINT_VERSION) {
    throw new JourneyServiceBlueprintError(
      'Service blueprint comparisons require the supported schema version.',
      'BLUEPRINT_COMPARISON_SCHEMA_MISMATCH',
      { field: `${label}.schemaVersion` }
    );
  }
}

function uniqueById<T extends { id: string }>(entries: readonly T[], label: string, collection: string) {
  const byId = new Map<string, T>();
  for (const entry of entries) {
    if (byId.has(entry.id)) {
      throw new JourneyServiceBlueprintError(
        `Service blueprint ${collection} must have unique identifiers before comparison.`,
        'BLUEPRINT_COMPARISON_DUPLICATE_ID',
        { field: `${label}.${collection}` }
      );
    }
    byId.set(entry.id, entry);
  }
  return byId;
}

export function compareServiceBlueprints(
  current: JourneyServiceBlueprint,
  future: JourneyServiceBlueprint
): JourneyBlueprintComparison {
  comparisonIdentity(current, 'current');
  comparisonIdentity(future, 'future');
  if (current.spaceId !== future.spaceId || current.journeyDefinitionId !== future.journeyDefinitionId) {
    throw new JourneyServiceBlueprintError(
      'Service blueprint comparisons must belong to the same space and journey definition.',
      current.spaceId !== future.spaceId ? 'BLUEPRINT_COMPARISON_CROSS_SPACE' : 'BLUEPRINT_COMPARISON_CROSS_JOURNEY'
    );
  }
  if (current.state !== 'current' || future.state !== 'future') {
    throw new JourneyServiceBlueprintError(
      'Service blueprint comparisons run from a current blueprint to a future blueprint.',
      'BLUEPRINT_COMPARISON_STATE',
      { fromState: current.state, toState: future.state }
    );
  }
  const sameVersionId = Boolean(current.versionId) && current.versionId === future.versionId;
  if (sameVersionId || (current.blueprintId === future.blueprintId && current.journeyVersionId === future.journeyVersionId)) {
    throw new JourneyServiceBlueprintError(
      'Service blueprint comparisons require two distinct versions.',
      'BLUEPRINT_COMPARISON_SELF'
    );
  }

  const currentStages = new Map(current.stages.map((stage) => [stage.stageKey, stage]));
  const futureStages = new Map(future.stages.map((stage) => [stage.stageKey, stage]));
  const currentElements = uniqueById(current.elements, 'current', 'elements');
  const futureElements = uniqueById(future.elements, 'future', 'elements');
  const currentRelationships = uniqueById(current.relationships, 'current', 'relationships');
  const futureRelationships = uniqueById(future.relationships, 'future', 'relationships');
  const currentLinks = uniqueById(current.portfolioLinks || [], 'current', 'portfolioLinks');
  const futureLinks = uniqueById(future.portfolioLinks || [], 'future', 'portfolioLinks');

  const sharedStages = [...currentStages.keys()].filter((key) => futureStages.has(key)).sort(compareText);
  const sharedElements = [...currentElements.keys()].filter((id) => futureElements.has(id)).sort(compareText);
  const sharedRelationships = [...currentRelationships.keys()].filter((id) => futureRelationships.has(id)).sort(compareText);
  const sharedLinks = [...currentLinks.keys()].filter((id) => futureLinks.has(id)).sort(compareText);

  return {
    spaceId: current.spaceId,
    journeyDefinitionId: current.journeyDefinitionId,
    fromBlueprintId: current.blueprintId,
    toBlueprintId: future.blueprintId,
    fromVersionId: current.versionId ?? null,
    toVersionId: future.versionId ?? null,
    fromJourneyVersionId: current.journeyVersionId,
    toJourneyVersionId: future.journeyVersionId,
    fromState: current.state,
    toState: future.state,
    addedStageKeys: [...futureStages.keys()].filter((key) => !currentStages.has(key)).sort(compareText),
    removedStageKeys: [...currentStages.keys()].filter((key) => !futureStages.has(key)).sort(compareText),
    changedStages: sharedStages.map((stageKey) => ({
      stageKey,
      fields: changedFields(canonicalStage(currentStages.get(stageKey)!), canonicalStage(futureStages.get(stageKey)!))
    })).filter((entry) => entry.fields.length > 0),
    addedElementIds: [...futureElements.keys()].filter((id) => !currentElements.has(id)).sort(compareText),
    removedElementIds: [...currentElements.keys()].filter((id) => !futureElements.has(id)).sort(compareText),
    changed: sharedElements.map((elementId) => ({
      elementId,
      fields: changedFields(canonicalElement(currentElements.get(elementId)!), canonicalElement(futureElements.get(elementId)!))
    })).filter((entry) => entry.fields.length > 0),
    addedRelationshipIds: [...futureRelationships.keys()].filter((id) => !currentRelationships.has(id)).sort(compareText),
    removedRelationshipIds: [...currentRelationships.keys()].filter((id) => !futureRelationships.has(id)).sort(compareText),
    changedRelationshipIds: sharedRelationships.filter((id) => changedFields(
      canonicalRelationship(currentRelationships.get(id)!),
      canonicalRelationship(futureRelationships.get(id)!)
    ).length > 0),
    addedPortfolioLinkIds: [...futureLinks.keys()].filter((id) => !currentLinks.has(id)).sort(compareText),
    removedPortfolioLinkIds: [...currentLinks.keys()].filter((id) => !futureLinks.has(id)).sort(compareText),
    changedPortfolioLinkIds: sharedLinks.filter((id) => changedFields(
      canonicalPortfolioLink(currentLinks.get(id)!),
      canonicalPortfolioLink(futureLinks.get(id)!)
    ).length > 0)
  };
}
