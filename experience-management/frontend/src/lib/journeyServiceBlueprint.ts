import { z } from 'zod';
import { api, json, spaceScopedApiUrl } from '@/lib/api';

export const journeyBlueprintStates = ['current', 'future'] as const;
export const journeyBlueprintLanes = ['customer', 'frontstage', 'backstage', 'supporting_system', 'policy_control'] as const;
export const journeyBlueprintElementKinds = ['action', 'touchpoint', 'process', 'system', 'policy', 'control', 'handoff', 'failure_point'] as const;
export const journeyBlueprintRelationshipKinds = ['supports', 'depends_on', 'handoff_to', 'causes', 'mitigates', 'governed_by'] as const;
export const journeyBlueprintResourceKinds = ['team', 'actor', 'system', 'vendor', 'policy', 'control'] as const;
export const journeyBlueprintReviewStates = ['draft', 'in_review', 'approved', 'changes_requested'] as const;
export const journeyBlueprintLifecycles = ['draft', 'in_review', 'approved', 'retired'] as const;
export const journeyBlueprintGapReviewStates = ['accepted', 'resolved', 'dismissed'] as const;

const id = z.string().min(1).max(128);
const instant = z.string().datetime({ offset: true });
const nullableId = id.nullable();
const stageSchema = z.object({ stageKey: z.string().min(1).max(80), name: z.string().min(1).max(200), ordinal: z.number().int().nonnegative() }).strict();
const elementSchema = z.object({
  id, stageKey: z.string().min(1).max(80), lane: z.enum(journeyBlueprintLanes), kind: z.enum(journeyBlueprintElementKinds),
  title: z.string().min(1).max(200), description: z.string().max(10_000).optional(), ownerTeamId: nullableId.optional(),
  actorId: nullableId.optional(), systemId: nullableId.optional(), vendorId: nullableId.optional(), controlId: nullableId.optional(),
  slaMinutes: z.number().positive().nullable().optional(), unitCost: z.number().nonnegative().nullable().optional(),
  riskProbability: z.number().min(0).max(1).nullable().optional(), riskImpact: z.number().min(0).max(1).nullable().optional(),
  ordinal: z.number().int().nonnegative().nullable().optional(), evidenceRefs: z.array(id).optional(), metricRefs: z.array(id).optional()
}).strict();
const relationshipSchema = z.object({ id, kind: z.enum(journeyBlueprintRelationshipKinds), fromElementId: id, toElementId: id, label: z.string().max(500).optional() }).strict();
const resourceSchema = z.object({
  id, spaceId: id, kind: z.enum(journeyBlueprintResourceKinds), name: z.string(), description: z.string(),
  lifecycle: z.enum(['active', 'retired']), ownerUserId: nullableId, revision: z.number().int().positive(), createdAt: instant, updatedAt: instant
}).strict();
const blueprintSchema = z.object({
  id, spaceId: id, journeyDefinitionId: id, name: z.string(), lifecycle: z.enum(journeyBlueprintLifecycles),
  ownerUserId: nullableId, ownerTeamId: nullableId, currentVersionId: nullableId, revision: z.number().int().positive(),
  createdAt: instant, updatedAt: instant
}).strict();
const gapSchema = z.object({
  id, blueprintVersionId: id, gapType: z.string(), targetElementId: nullableId, targetRelationshipId: nullableId,
  severity: z.enum(['info', 'warning', 'critical']), state: z.enum(['open', ...journeyBlueprintGapReviewStates]), reasonCode: z.string(),
  detail: z.record(z.string(), z.unknown()), reviewerUserId: nullableId, reviewedAt: instant.nullable(), createdAt: instant
}).strict();
const portfolioLinkSchema = z.object({
  id, elementId: id, portfolioItemId: id, portfolioItemKind: z.enum(['pain_point', 'opportunity', 'solution', 'initiative']),
  portfolioItemRevision: z.number().int().positive(), relationship: z.enum(['causes', 'affected_by', 'mitigated_by', 'improved_by']), spaceId: id.optional()
}).strict();
const versionSchema = z.object({
  schemaVersion: z.literal('journey-service-blueprint/v1'), blueprintId: id, spaceId: id, journeyDefinitionId: id,
  journeyVersionId: id, state: z.enum(journeyBlueprintStates), versionId: nullableId.optional(), versionNumber: z.number().int().positive().nullable().optional(),
  reviewState: z.enum(journeyBlueprintReviewStates).nullable().optional(), stages: z.array(stageSchema), elements: z.array(elementSchema),
  relationships: z.array(relationshipSchema), resources: z.array(resourceSchema).optional(), portfolioLinks: z.array(portfolioLinkSchema).optional(),
  changeReason: z.string().nullable(), createdAt: instant, gaps: z.array(gapSchema)
}).strict();
const versionSummarySchema = z.object({
  id, blueprint_id: id, journey_definition_id: id, journey_version_id: id, version_number: z.number().int().positive(),
  blueprint_state: z.enum(journeyBlueprintStates), review_state: z.enum(journeyBlueprintReviewStates),
  schema_version: z.literal('journey-service-blueprint/v1'), change_reason: z.string().nullable(), created_at: instant,
  approved_by_user_id: nullableId, approved_at: instant.nullable()
}).strict();
const issueSchema = z.object({
  severity: z.enum(['error', 'warning']), code: z.string(), message: z.string(), elementId: id.optional(), relationshipId: id.optional(),
  stageKey: z.string().optional(), field: z.string().optional(), portfolioLinkId: id.optional(), gapType: z.string().optional(),
  gapSeverity: z.enum(['info', 'warning', 'critical']).optional()
}).strict();
const analysisSchema = z.object({
  valid: z.boolean(), issues: z.array(issueSchema), crossings: z.array(z.object({ relationshipId: id, lines: z.array(z.enum(['interaction', 'visibility', 'internal_interaction'])) }).strict()),
  risk: z.array(z.object({ elementId: id, score: z.number(), probability: z.number(), impact: z.number() }).strict()),
  coverage: z.object({ frontstageElements: z.number().int().nonnegative(), supportedFrontstageElements: z.number().int().nonnegative(), backstageElements: z.number().int().nonnegative(), systemSupportedBackstageElements: z.number().int().nonnegative(), failurePoints: z.number().int().nonnegative(), mitigatedFailurePoints: z.number().int().nonnegative() }).strict(),
  causality: z.object({ linkedPortfolioItems: z.number().int().nonnegative(), painPointTraces: z.array(z.object({ portfolioItemId: id, causingElementIds: z.array(id), traceElementIds: z.array(id), hasBackstageProcess: z.boolean(), hasSupportingSystem: z.boolean(), hasOwner: z.boolean(), hasSla: z.boolean(), hasImprovementInitiative: z.boolean(), missing: z.array(z.enum(['causing_element', 'backstage_process', 'supporting_system', 'owner', 'sla', 'improvement_initiative'])) }).strict()), fullyTracedPainPoints: z.number().int().nonnegative() }).strict(),
  resourceValidation: z.object({ enforced: z.boolean(), catalogueSize: z.number().int().nonnegative() }).strict()
}).strict();
const comparisonSchema = z.object({
  spaceId: id, journeyDefinitionId: id, fromBlueprintId: id, toBlueprintId: id, fromVersionId: nullableId, toVersionId: nullableId,
  fromJourneyVersionId: id, toJourneyVersionId: id, fromState: z.enum(journeyBlueprintStates), toState: z.enum(journeyBlueprintStates),
  addedStageKeys: z.array(z.string()), removedStageKeys: z.array(z.string()), changedStages: z.array(z.object({ stageKey: z.string(), fields: z.array(z.string()) }).strict()),
  addedElementIds: z.array(id), removedElementIds: z.array(id), changed: z.array(z.object({ elementId: id, fields: z.array(z.string()) }).strict()),
  addedRelationshipIds: z.array(id), removedRelationshipIds: z.array(id), changedRelationshipIds: z.array(id),
  addedPortfolioLinkIds: z.array(id), removedPortfolioLinkIds: z.array(id), changedPortfolioLinkIds: z.array(id)
}).strict();

export type JourneyBlueprint = z.infer<typeof blueprintSchema>;
export type JourneyBlueprintResource = z.infer<typeof resourceSchema>;
export type JourneyBlueprintStage = z.infer<typeof stageSchema>;
export type JourneyBlueprintElement = z.infer<typeof elementSchema>;
export type JourneyBlueprintRelationship = z.infer<typeof relationshipSchema>;
export type JourneyBlueprintPortfolioLink = z.infer<typeof portfolioLinkSchema>;
export type JourneyBlueprintVersion = z.infer<typeof versionSchema>;
export type JourneyBlueprintVersionSummary = z.infer<typeof versionSummarySchema>;
export type JourneyBlueprintAnalysis = z.infer<typeof analysisSchema>;
export type JourneyBlueprintComparison = z.infer<typeof comparisonSchema>;
export type JourneyBlueprintLane = typeof journeyBlueprintLanes[number];
export type JourneyBlueprintElementKind = typeof journeyBlueprintElementKinds[number];
export type JourneyBlueprintRelationshipKind = typeof journeyBlueprintRelationshipKinds[number];
export type JourneyBlueprintResourceKind = typeof journeyBlueprintResourceKinds[number];
export type JourneyBlueprintExportFormat = 'json' | 'csv';

function parse<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(`Invalid ${label} response: ${result.error.issues[0]?.message || 'contract mismatch'}`);
  return result.data;
}

export async function listJourneyServiceBlueprints(includeRetired = false) { return parse(z.object({ blueprints: z.array(blueprintSchema) }).strict(), await api<unknown>(`/api/journey-blueprints?includeRetired=${includeRetired}`), 'blueprint list').blueprints; }
export async function createJourneyServiceBlueprint(input: { journeyDefinitionId: string; name: string; ownerUserId?: string | null; ownerTeamId?: string | null }) { return parse(z.object({ blueprint: blueprintSchema }).strict(), await api<unknown>('/api/journey-blueprints', json('POST', input)), 'blueprint').blueprint; }
export async function updateJourneyServiceBlueprint(blueprint: JourneyBlueprint, input: { name?: string; lifecycle?: typeof journeyBlueprintLifecycles[number]; ownerUserId?: string | null; ownerTeamId?: string | null }) { return parse(z.object({ blueprint: blueprintSchema }).strict(), await api<unknown>(`/api/journey-blueprints/${encodeURIComponent(blueprint.id)}`, json('PATCH', { expectedRevision: blueprint.revision, ...input })), 'blueprint').blueprint; }
export async function listJourneyServiceBlueprintVersions(blueprintId: string) { return parse(z.object({ versions: z.array(versionSummarySchema) }).strict(), await api<unknown>(`/api/journey-blueprints/${encodeURIComponent(blueprintId)}/versions`), 'blueprint version list').versions; }
export async function readJourneyServiceBlueprintVersion(versionId: string) { return parse(z.object({ version: versionSchema }).strict(), await api<unknown>(`/api/journey-blueprints/versions/${encodeURIComponent(versionId)}`), 'blueprint version').version; }
export async function createJourneyServiceBlueprintVersion(blueprintId: string, input: { journeyVersionId: string; state: typeof journeyBlueprintStates[number]; changeReason?: string | null; stages: JourneyBlueprintStage[]; elements: JourneyBlueprintElement[]; relationships: JourneyBlueprintRelationship[]; portfolioLinks?: JourneyBlueprintPortfolioLink[] }) { return parse(z.object({ version: versionSchema, analysis: analysisSchema }).strict(), await api<unknown>(`/api/journey-blueprints/${encodeURIComponent(blueprintId)}/versions`, json('POST', input)), 'created blueprint version'); }
export async function reviewJourneyServiceBlueprintVersion(version: JourneyBlueprintVersion, reviewState: typeof journeyBlueprintReviewStates[number]) { return parse(z.object({ version: versionSchema }).strict(), await api<unknown>(`/api/journey-blueprints/versions/${encodeURIComponent(version.versionId || '')}/review`, json('PATCH', { expectedReviewState: version.reviewState, reviewState })), 'reviewed blueprint version').version; }
export async function analyseJourneyServiceBlueprint(versionId: string) { return parse(z.object({ analysis: analysisSchema }).strict(), await api<unknown>(`/api/journey-blueprints/versions/${encodeURIComponent(versionId)}/analysis`), 'blueprint analysis').analysis; }
export async function compareJourneyServiceBlueprintVersions(fromVersionId: string, toVersionId: string) { return parse(z.object({ id, createdAt: instant, comparison: comparisonSchema }).strict(), await api<unknown>('/api/journey-blueprints/comparisons', json('POST', { fromVersionId, toVersionId })), 'blueprint comparison').comparison; }
export async function listJourneyBlueprintResources(includeRetired = false) { return parse(z.object({ resources: z.array(resourceSchema) }).strict(), await api<unknown>(`/api/journey-blueprints/resources/catalogue?includeRetired=${includeRetired}`), 'blueprint resource list').resources; }
export async function createJourneyBlueprintResource(input: { kind: JourneyBlueprintResourceKind; name: string; description?: string; ownerUserId?: string | null }) { return parse(z.object({ resource: resourceSchema }).strict(), await api<unknown>('/api/journey-blueprints/resources/catalogue', json('POST', input)), 'blueprint resource').resource; }
export async function updateJourneyBlueprintResource(resource: JourneyBlueprintResource, input: { name?: string; description?: string; lifecycle?: 'active' | 'retired'; ownerUserId?: string | null }) { return parse(z.object({ resource: resourceSchema }).strict(), await api<unknown>(`/api/journey-blueprints/resources/catalogue/${encodeURIComponent(resource.id)}`, json('PATCH', { expectedRevision: resource.revision, ...input })), 'blueprint resource').resource; }
export async function reviewJourneyBlueprintGap(gapId: string, state: typeof journeyBlueprintGapReviewStates[number]) { return parse(z.object({ gap: gapSchema }).strict(), await api<unknown>(`/api/journey-blueprints/gaps/${encodeURIComponent(gapId)}`, json('PATCH', { state })), 'blueprint gap').gap; }

export async function downloadJourneyServiceBlueprintVersion(versionId: string, format: JourneyBlueprintExportFormat) {
  const response = await fetch(spaceScopedApiUrl(
    `/api/journey-blueprints/versions/${encodeURIComponent(versionId)}/export.${format}`
  ), { credentials: 'include', headers: { 'X-Request-Id': crypto.randomUUID() } });
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(detail?.error || 'The service blueprint export failed.');
  }
  const disposition = response.headers.get('Content-Disposition') || '';
  const match = /filename="([^"]+)"/u.exec(disposition);
  return {
    blob: await response.blob(),
    filename: match?.[1] || `journey-service-blueprint.${format}`,
    contentSha256: response.headers.get('X-Content-SHA256') || ''
  };
}
