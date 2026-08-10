import crypto from 'node:crypto';
import {
  journeyHierarchyLimits,
  type JourneyHierarchyLink,
  type JourneyHierarchyNode
} from '../backend/src/journeyHierarchy.js';
import {
  JOURNEY_SERVICE_BLUEPRINT_VERSION,
  journeyBlueprintLanes,
  journeyBlueprintLimits,
  type JourneyBlueprintElement,
  type JourneyBlueprintElementKind,
  type JourneyBlueprintLane,
  type JourneyBlueprintRelationship,
  type JourneyBlueprintStage,
  type JourneyServiceBlueprint
} from '../backend/src/journeyServiceBlueprint.js';

export const phase4CandidateProfile = Object.freeze({
  id: 'phase4-enterprise-candidate/v1',
  hierarchy: {
    nodes: journeyHierarchyLimits.nodes,
    links: journeyHierarchyLimits.links,
    depth: journeyHierarchyLimits.depth
  },
  blueprint: {
    stages: 50,
    elementsPerLanePerStage: 10,
    elements: 50 * journeyBlueprintLanes.length * 10,
    relationships: 50 * (10 + 10 + 9),
    collectionCeilings: journeyBlueprintLimits
  }
});

export const phase4CandidateBudgetsMs = Object.freeze({
  hierarchyValidate: 1_000,
  hierarchyTraverse: 1_000,
  hierarchyBreadcrumbs: 1_000,
  hierarchyHealth: 1_500,
  hierarchyRepositoryRead: 2_000,
  hierarchyRepositoryTraverse: 2_000,
  hierarchyRepositoryBreadcrumbs: 2_000,
  hierarchyJsonExport: 4_000,
  hierarchyCsvExport: 4_000,
  blueprintAnalyse: 2_000,
  blueprintCompare: 3_000,
  blueprintRepositoryPersist: 20_000,
  blueprintRepositoryRead: 4_000,
  blueprintJsonExport: 8_000,
  blueprintCsvExport: 8_000,
  backendProjectionSerialise: 3_000
});

const padded = (value: number, width = 4) => String(value).padStart(width, '0');

export function buildPhase4HierarchyFixture(spaceId = 'phase4-space') {
  const nodes: JourneyHierarchyNode[] = Array.from({ length: phase4CandidateProfile.hierarchy.nodes }, (_, index) => ({
    definitionId: `journey-${padded(index)}`,
    spaceId,
    name: `Enterprise journey ${padded(index)}`,
    ownerUserId: null,
    stageKeys: index === 0 ? ['entry'] : [],
    taxonomyTermIds: []
  }));
  const links: JourneyHierarchyLink[] = nodes.slice(1).map((node, index) => ({
    id: `parent-${padded(index + 1)}`,
    spaceId,
    type: 'parent_child',
    fromDefinitionId: nodes[0]!.definitionId,
    toDefinitionId: node.definitionId,
    reviewState: 'approved',
    lifecycle: 'active'
  }));
  outer: for (let from = 1; from < nodes.length; from += 1) {
    for (let to = 1; to < nodes.length; to += 1) {
      if (from === to) continue;
      links.push({
        id: `related-${padded(from)}-${padded(to)}`,
        spaceId,
        type: 'related',
        fromDefinitionId: nodes[from]!.definitionId,
        toDefinitionId: nodes[to]!.definitionId,
        reviewState: 'approved',
        lifecycle: 'active'
      });
      if (links.length === phase4CandidateProfile.hierarchy.links) break outer;
    }
  }
  if (links.length !== phase4CandidateProfile.hierarchy.links) throw new Error('Hierarchy fixture could not reach its candidate link count.');
  return { nodes, links };
}

const kindByLane: Record<JourneyBlueprintLane, JourneyBlueprintElementKind> = {
  customer: 'action', frontstage: 'touchpoint', backstage: 'process',
  supporting_system: 'system', policy_control: 'policy'
};

export function buildPhase4BlueprintFixture(input: {
  spaceId?: string; blueprintId?: string; journeyDefinitionId?: string; journeyVersionId?: string;
  versionId?: string | null; versionNumber?: number; state?: 'current' | 'future'; titleSuffix?: string;
} = {}): JourneyServiceBlueprint {
  const stages: JourneyBlueprintStage[] = Array.from({ length: phase4CandidateProfile.blueprint.stages }, (_, index) => ({
    stageKey: `stage-${padded(index, 3)}`, name: `Stage ${padded(index, 3)}`, ordinal: index
  }));
  const elements: JourneyBlueprintElement[] = [];
  const relationships: JourneyBlueprintRelationship[] = [];
  const elementId = (stage: number, lane: number, slot: number) => `e-${padded(stage, 3)}-${lane}-${padded(slot, 2)}`;
  stages.forEach((stage, stageIndex) => {
    journeyBlueprintLanes.forEach((lane, laneIndex) => {
      for (let slot = 0; slot < phase4CandidateProfile.blueprint.elementsPerLanePerStage; slot += 1) {
        elements.push({
          id: elementId(stageIndex, laneIndex, slot), stageKey: stage.stageKey, lane,
          kind: kindByLane[lane], title: `Element ${stageIndex}.${laneIndex}.${slot}${input.titleSuffix || ''}`, ordinal: slot
        });
      }
    });
    for (let slot = 0; slot < phase4CandidateProfile.blueprint.elementsPerLanePerStage; slot += 1) {
      relationships.push({ id: `r-system-${padded(stageIndex, 3)}-${padded(slot, 2)}`, kind: 'supports',
        fromElementId: elementId(stageIndex, 3, slot), toElementId: elementId(stageIndex, 2, slot) });
      relationships.push({ id: `r-backstage-${padded(stageIndex, 3)}-${padded(slot, 2)}`, kind: 'supports',
        fromElementId: elementId(stageIndex, 2, slot), toElementId: elementId(stageIndex, 1, slot) });
      if (slot + 1 < phase4CandidateProfile.blueprint.elementsPerLanePerStage) relationships.push({
        id: `r-dependency-${padded(stageIndex, 3)}-${padded(slot, 2)}`, kind: 'depends_on',
        fromElementId: elementId(stageIndex, 2, slot), toElementId: elementId(stageIndex, 2, slot + 1)
      });
    }
  });
  return {
    schemaVersion: JOURNEY_SERVICE_BLUEPRINT_VERSION,
    blueprintId: input.blueprintId || 'phase4-blueprint', spaceId: input.spaceId || 'phase4-space',
    journeyDefinitionId: input.journeyDefinitionId || 'journey-0000', journeyVersionId: input.journeyVersionId || 'journey-version-0000',
    state: input.state || 'current', versionId: input.versionId === undefined ? 'phase4-blueprint-version' : input.versionId,
    versionNumber: input.versionNumber || 1, reviewState: 'draft', stages, elements, relationships,
    resources: [], portfolioLinks: []
  };
}

export function phase4FixtureFingerprint() {
  const hierarchy = buildPhase4HierarchyFixture();
  const blueprint = buildPhase4BlueprintFixture();
  return crypto.createHash('sha256').update(JSON.stringify({ hierarchy, blueprint })).digest('hex');
}
