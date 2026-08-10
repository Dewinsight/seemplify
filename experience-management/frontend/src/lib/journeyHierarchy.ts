import { z } from 'zod';
import { api, json, spaceScopedApiUrl } from '@/lib/api';

export const journeyHierarchyLinkTypes = ['parent_child', 'stage_subjourney', 'variant', 'handoff', 'related'] as const;
export const journeyHierarchyReviewStates = ['draft', 'in_review', 'approved', 'changes_requested'] as const;
export const journeyHierarchyLifecycles = ['active', 'retired'] as const;
export const journeyHierarchyVariantDimensions = ['persona', 'segment', 'product', 'geography', 'channel'] as const;
export const journeyTaxonomyKinds = ['product', 'geography', 'channel', 'segment', 'tag', 'business_unit'] as const;

export type JourneyHierarchyLinkType = typeof journeyHierarchyLinkTypes[number];
export type JourneyHierarchyReviewState = typeof journeyHierarchyReviewStates[number];
export type JourneyHierarchyLifecycle = typeof journeyHierarchyLifecycles[number];
export type JourneyHierarchyVariantDimension = typeof journeyHierarchyVariantDimensions[number];
export type JourneyTaxonomyKind = typeof journeyTaxonomyKinds[number];

const id = z.string().min(1).max(128);
const instant = z.string().datetime({ offset: true });
const nodeSchema = z.object({
  definitionId: id, spaceId: id, name: z.string().optional(), ownerUserId: id.nullable().optional(),
  stageKeys: z.array(z.string().min(1).max(80)).optional(), taxonomyTermIds: z.array(id).optional()
}).strict();
const linkSchema = z.object({
  id, spaceId: id, type: z.enum(journeyHierarchyLinkTypes), fromDefinitionId: id, toDefinitionId: id,
  fromVersionId: id.nullable(), toVersionId: id.nullable(), fromStageKey: z.string().max(80).nullable().optional(),
  toStageKey: z.string().max(80).nullable().optional(), variantDimension: z.enum(journeyHierarchyVariantDimensions).nullable().optional(),
  variantValueId: id.nullable().optional(), handoffOwnerUserId: id.nullable().optional(),
  handoffOwnerTeamId: id.nullable().optional(), reviewState: z.enum(journeyHierarchyReviewStates),
  reviewedByUserId: id.nullable(), reviewedAt: instant.nullable(), lifecycle: z.enum(journeyHierarchyLifecycles),
  revision: z.number().int().positive(), createdAt: instant, updatedAt: instant
}).strict();
const validationSchema = z.object({
  spaceId: id.nullable(), roots: z.array(id), topologicalOrder: z.array(id), maximumDepth: z.number().int().nonnegative(),
  childIdsByParent: z.record(z.string(), z.array(id)),
  childEntries: z.array(z.object({ parentDefinitionId: id, childDefinitionIds: z.array(id) }).strict())
}).strict();
const settingsSchema = z.object({
  enabled: z.boolean(), hierarchyEnabled: z.boolean(), blueprintsEnabled: z.boolean(),
  maximumDepth: z.number().int().positive(), maximumLinks: z.number().int().positive(),
  revision: z.number().int().nonnegative(), updatedAt: instant.nullable()
}).strict();
const hierarchySchema = z.object({
  nodes: z.array(nodeSchema), links: z.array(linkSchema), validation: validationSchema, settings: settingsSchema
}).strict();
const traversalSchema = z.object({
  startDefinitionId: id, direction: z.enum(['upstream', 'downstream', 'both']), definitionIds: z.array(id),
  linkIds: z.array(id), inaccessibleLinkCount: z.number().int().nonnegative(), truncated: z.boolean()
}).strict();
const breadcrumbsSchema = z.object({
  targetDefinitionId: id,
  trails: z.array(z.object({ definitionIds: z.array(id), hasInaccessibleAncestor: z.boolean() }).strict()),
  truncated: z.boolean(), inaccessibleParentCount: z.number().int().nonnegative()
}).strict();
const taxonomyTermSchema = z.object({
  id, kind: z.enum(journeyTaxonomyKinds), name: z.string().min(1).max(160), parentTermId: id.nullable(),
  lifecycle: z.enum(['active', 'retired']), revision: z.number().int().positive(), createdAt: instant, updatedAt: instant
}).strict();
const healthPolicyConfigurationSchema = z.object({
  version: id, ownWeight: z.number().min(0).max(1), missingChild: z.enum(['exclude', 'unknown']),
  healthyAt: z.number().min(0).max(100), watchAt: z.number().min(0).max(100)
}).strict();
const healthPolicySchema = z.object({
  id, name: z.string().min(1).max(160), lifecycle: z.enum(['draft', 'active', 'retired']),
  ...healthPolicyConfigurationSchema.shape, revision: z.number().int().positive(),
  configurationSha256: z.string().regex(/^[a-f0-9]{64}$/u), createdAt: instant, updatedAt: instant
}).strict();
const healthOwnComponentSchema = z.object({ kind: z.literal('own'), definitionId: id,
  score: z.number().min(0).max(100).nullable(), observedAt: instant, sourceRevision: id }).strict();
const healthChildComponentSchema = z.object({ kind: z.literal('child'), definitionId: id,
  score: z.number().min(0).max(100).nullable(), effectiveWeight: z.number().min(0).max(1) }).strict();
const healthPolicyComponentSchema = z.object({ kind: z.literal('policy'), configuration: healthPolicyConfigurationSchema }).strict();
const healthSnapshotSchema = z.object({
  id, definitionId: id, definitionRevision: z.number().int().positive(), score: z.number().min(0).max(100).nullable(),
  status: z.enum(['healthy', 'watch', 'at_risk', 'unknown']), explanation: z.string().min(1),
  components: z.array(z.union([healthPolicyComponentSchema, healthOwnComponentSchema, healthChildComponentSchema])),
  children: z.array(healthChildComponentSchema), own: healthOwnComponentSchema.nullable(), childLineage: z.array(z.string()),
  policy: z.object({ id, version: id, revision: z.number().int().positive(),
    configurationSha256: z.string().regex(/^[a-f0-9]{64}$/u), rules: healthPolicyConfigurationSchema }).strict(),
  calculatedAt: instant
}).strict();

export type JourneyHierarchyNode = z.infer<typeof nodeSchema>;
export type JourneyHierarchyLink = z.infer<typeof linkSchema>;
export type JourneyHierarchy = z.infer<typeof hierarchySchema>;
export type JourneyHierarchyTraversal = z.infer<typeof traversalSchema>;
export type JourneyHierarchyBreadcrumbs = z.infer<typeof breadcrumbsSchema>;
export type JourneyTaxonomyTerm = z.infer<typeof taxonomyTermSchema>;
export type JourneyHierarchySettings = z.infer<typeof settingsSchema>;
export type JourneyHierarchyHealthPolicy = z.infer<typeof healthPolicySchema>;
export type JourneyHierarchyHealthPolicyConfiguration = z.infer<typeof healthPolicyConfigurationSchema>;
export type JourneyHierarchyHealthSnapshot = z.infer<typeof healthSnapshotSchema>;
export type JourneyHierarchyExportFormat = 'json' | 'csv';

export interface JourneyHierarchyLinkDraft {
  type: JourneyHierarchyLinkType;
  fromDefinitionId: string;
  toDefinitionId: string;
  fromStageKey?: string | null;
  toStageKey?: string | null;
  variantDimension?: JourneyHierarchyVariantDimension | null;
  variantValueId?: string | null;
  handoffOwnerUserId?: string | null;
  handoffOwnerTeamId?: string | null;
}

function parse<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(`Invalid ${label} response: ${result.error.issues[0]?.message || 'contract mismatch'}`);
  return result.data;
}

export async function listJourneyHierarchy(includeRetired = false) {
  const response = await api<unknown>(`/api/journey-hierarchy?includeRetired=${includeRetired}`);
  return parse(hierarchySchema, response, 'journey hierarchy');
}

export async function createJourneyHierarchyLink(input: JourneyHierarchyLinkDraft) {
  const response = await api<unknown>('/api/journey-hierarchy/links', json('POST', input));
  return parse(z.object({ link: linkSchema }).strict(), response, 'journey hierarchy link').link;
}

export async function updateJourneyHierarchyLink(link: JourneyHierarchyLink, input: {
  reviewState?: JourneyHierarchyReviewState; lifecycle?: JourneyHierarchyLifecycle;
}) {
  const response = await api<unknown>(`/api/journey-hierarchy/links/${encodeURIComponent(link.id)}`,
    json('PATCH', { expectedRevision: link.revision, ...input }));
  return parse(z.object({ link: linkSchema }).strict(), response, 'journey hierarchy link').link;
}

export async function readJourneyHierarchyTraversal(definitionId: string, direction: 'upstream' | 'downstream' | 'both') {
  const response = await api<unknown>(`/api/journey-hierarchy/traversal/${encodeURIComponent(definitionId)}?direction=${direction}&limit=500`);
  return parse(z.object({ traversal: traversalSchema }).strict(), response, 'journey hierarchy traversal').traversal;
}

export async function readJourneyHierarchyBreadcrumbs(definitionId: string) {
  const response = await api<unknown>(`/api/journey-hierarchy/breadcrumbs/${encodeURIComponent(definitionId)}?limit=100`);
  return parse(z.object({ breadcrumbs: breadcrumbsSchema }).strict(), response, 'journey hierarchy breadcrumbs').breadcrumbs;
}

export async function listJourneyTaxonomyTerms(includeRetired = false) {
  const response = await api<unknown>(`/api/journey-hierarchy/taxonomy?includeRetired=${includeRetired}`);
  return parse(z.object({ terms: z.array(taxonomyTermSchema) }).strict(), response, 'journey taxonomy').terms;
}

export async function createJourneyTaxonomyTerm(input: {
  kind: JourneyTaxonomyKind; name: string; parentTermId?: string | null;
}) {
  const response = await api<unknown>('/api/journey-hierarchy/taxonomy', json('POST', input));
  return parse(z.object({ term: taxonomyTermSchema }).strict(), response, 'journey taxonomy term').term;
}

export async function updateJourneyTaxonomyTerm(term: JourneyTaxonomyTerm, input: {
  name?: string; parentTermId?: string | null; lifecycle?: JourneyHierarchyLifecycle;
}) {
  const response = await api<unknown>(`/api/journey-hierarchy/taxonomy/${encodeURIComponent(term.id)}`,
    json('PATCH', { expectedRevision: term.revision, ...input }));
  return parse(z.object({ term: taxonomyTermSchema }).strict(), response, 'journey taxonomy term').term;
}

export async function readJourneyHierarchySettings() {
  const response = await api<unknown>('/api/journey-hierarchy/settings');
  return parse(z.object({ settings: settingsSchema }).strict(), response, 'journey hierarchy settings').settings;
}

export async function updateJourneyHierarchySettings(settings: JourneyHierarchySettings, input: {
  hierarchyEnabled?: boolean; blueprintsEnabled?: boolean; maximumDepth?: number; maximumLinks?: number;
}) {
  const response = await api<unknown>('/api/journey-hierarchy/settings',
    json('PATCH', { expectedRevision: settings.revision, ...input }));
  return parse(z.object({ settings: settingsSchema }).strict(), response, 'journey hierarchy settings').settings;
}

export async function listJourneyHierarchyHealthPolicies(includeRetired = true) {
  const response = await api<unknown>(`/api/journey-hierarchy/health/policies?includeRetired=${includeRetired}`);
  return parse(z.object({ policies: z.array(healthPolicySchema) }).strict(), response,
    'journey hierarchy health policies').policies;
}

export async function createJourneyHierarchyHealthPolicy(input: {
  name: string; lifecycle?: 'draft' | 'active'; policy: JourneyHierarchyHealthPolicyConfiguration;
}) {
  const response = await api<unknown>('/api/journey-hierarchy/health/policies', json('POST', input));
  return parse(z.object({ policy: healthPolicySchema }).strict(), response, 'journey hierarchy health policy').policy;
}

export async function updateJourneyHierarchyHealthPolicy(policy: JourneyHierarchyHealthPolicy, input: {
  name?: string; lifecycle?: 'draft' | 'active' | 'retired'; policy?: JourneyHierarchyHealthPolicyConfiguration;
}) {
  const response = await api<unknown>(`/api/journey-hierarchy/health/policies/${encodeURIComponent(policy.id)}`,
    json('PATCH', { expectedRevision: policy.revision, ...input }));
  return parse(z.object({ policy: healthPolicySchema }).strict(), response, 'journey hierarchy health policy').policy;
}

export async function calculateJourneyHierarchyHealthSnapshots(input: {
  policyId: string; definitionId?: string; observations: Array<{
    definitionId: string; score: number | null; observedAt: string; sourceRevision: string;
  }>;
}) {
  const response = await api<unknown>('/api/journey-hierarchy/health/snapshots', json('POST', input));
  return parse(z.object({ snapshots: z.array(healthSnapshotSchema) }).strict(), response,
    'journey hierarchy health calculation').snapshots;
}

export async function listJourneyHierarchyHealthSnapshots(definitionId?: string, limit = 50) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (definitionId) query.set('definitionId', definitionId);
  const response = await api<unknown>(`/api/journey-hierarchy/health/snapshots?${query}`);
  return parse(z.object({ snapshots: z.array(healthSnapshotSchema) }).strict(), response,
    'journey hierarchy health snapshots').snapshots;
}

export async function readJourneyHierarchyHealthSnapshot(snapshotId: string) {
  const response = await api<unknown>(`/api/journey-hierarchy/health/snapshots/${encodeURIComponent(snapshotId)}`);
  return parse(z.object({ snapshot: healthSnapshotSchema }).strict(), response,
    'journey hierarchy health snapshot').snapshot;
}

export async function assignJourneyTaxonomyTerm(definitionId: string, termId: string) {
  const response = await api<unknown>(`/api/journey-hierarchy/journeys/${encodeURIComponent(definitionId)}/taxonomy/${encodeURIComponent(termId)}`,
    { method: 'PUT' });
  return parse(z.object({ assigned: z.literal(true), definitionId: id, termId: id }).strict(), response, 'journey taxonomy assignment');
}

export async function unassignJourneyTaxonomyTerm(definitionId: string, termId: string) {
  const response = await api<unknown>(`/api/journey-hierarchy/journeys/${encodeURIComponent(definitionId)}/taxonomy/${encodeURIComponent(termId)}`,
    { method: 'DELETE' });
  return parse(z.object({ removed: z.boolean(), definitionId: id, termId: id }).strict(), response, 'journey taxonomy removal');
}

export async function downloadJourneyHierarchy(format: JourneyHierarchyExportFormat) {
  const response = await fetch(spaceScopedApiUrl(`/api/journey-hierarchy/export.${format}`), {
    credentials: 'include', headers: { 'X-Request-Id': crypto.randomUUID() }
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(detail?.error || 'The hierarchy export failed.');
  }
  const disposition = response.headers.get('Content-Disposition') || '';
  const match = /filename="([^"]+)"/u.exec(disposition);
  return { blob: await response.blob(), filename: match?.[1] || `journey-hierarchy.${format}`,
    contentSha256: response.headers.get('X-Content-SHA256') || '' };
}
