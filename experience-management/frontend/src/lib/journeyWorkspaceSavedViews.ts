import { z } from 'zod';
import { api } from '@/lib/api';

export const journeyWorkspaceViewSurfaces = ['hierarchy','service_blueprint'] as const;
export const journeyWorkspaceViewAudiences = ['internal','executive','research','delivery','external'] as const;
const id = z.string().min(1).max(128), instant = z.string().datetime({ offset: true });
const hierarchyConfigurationSchema = z.object({
  version: z.literal(1), includeRetired: z.boolean(), rootDefinitionId: id.nullable(),
  direction: z.enum(['upstream','downstream','both']),
  taxonomyKinds: z.array(z.enum(['product','geography','channel','segment','tag','business_unit'])).max(6),
  reviewStates: z.array(z.enum(['draft','in_review','approved','changes_requested'])).max(4),
  lifecycles: z.array(z.enum(['active','retired'])).max(2)
}).strict();
const blueprintConfigurationSchema = z.object({
  version: z.literal(1), blueprintId: id.nullable(), versionMode: z.enum(['current','future','comparison']),
  selectedSection: z.enum(['design','analysis','history','measurements']),
  lifecycles: z.array(z.enum(['draft','in_review','approved','retired'])).max(4)
}).strict();
const configurationSchema = z.union([hierarchyConfigurationSchema, blueprintConfigurationSchema]);
const viewBase = {
  id, audience: z.enum(journeyWorkspaceViewAudiences),
  name: z.string().min(1).max(160), state: z.enum(['active','retired']), revision: z.number().int().positive(),
  versionId: id, versionNumber: z.number().int().positive(),
  configurationSha256: z.string().regex(/^[a-f0-9]{64}$/u), createdAt: instant, updatedAt: instant
};
const viewSchema = z.discriminatedUnion('surface', [
  z.object({ ...viewBase, surface: z.literal('hierarchy'), configuration: hierarchyConfigurationSchema }).strict(),
  z.object({ ...viewBase, surface: z.literal('service_blueprint'), configuration: blueprintConfigurationSchema }).strict()
]);
const listSchema = z.object({ views: z.array(viewSchema), defaultViewId: id.nullable(),
  preferenceRevision: z.number().int().nonnegative() }).strict();
const mutationSchema = z.object({ viewId: id, preferenceRevision: z.number().int().positive().nullable().optional(),
  replayed: z.boolean() }).strict();
const defaultSchema = z.object({ defaultViewId: id.nullable(), preferenceRevision: z.number().int().positive(),
  replayed: z.boolean() }).strict();

export type JourneyWorkspaceViewSurface = typeof journeyWorkspaceViewSurfaces[number];
export type JourneyWorkspaceViewAudience = typeof journeyWorkspaceViewAudiences[number];
export type JourneyHierarchyViewConfiguration = z.infer<typeof hierarchyConfigurationSchema>;
export type JourneyBlueprintViewConfiguration = z.infer<typeof blueprintConfigurationSchema>;
export type JourneyWorkspaceViewConfiguration = z.infer<typeof configurationSchema>;
export type JourneyWorkspaceSavedView = z.infer<typeof viewSchema>;
export type JourneyWorkspaceSavedViewList = z.infer<typeof listSchema>;

function parse<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(`Invalid ${label} response: ${result.error.issues[0]?.message || 'contract mismatch'}`);
  return result.data;
}
function mutation(method: string, body: unknown, idempotencyKey: string): RequestInit {
  return { method, headers: { 'Idempotency-Key': idempotencyKey }, body: JSON.stringify(body) };
}

export async function listJourneyWorkspaceSavedViews(surface: JourneyWorkspaceViewSurface, includeRetired = false) {
  return parse(listSchema, await api<unknown>(`/api/journey-workspace-saved-views?surface=${surface}&includeRetired=${includeRetired}`),
    'journey workspace saved-view list');
}
export async function createJourneyWorkspaceSavedView(input: { surface: JourneyWorkspaceViewSurface;
  audience: JourneyWorkspaceViewAudience; name: string; configuration: JourneyWorkspaceViewConfiguration;
  makeDefault: boolean; expectedPreferenceRevision?: number }, idempotencyKey: string) {
  return parse(mutationSchema, await api<unknown>('/api/journey-workspace-saved-views',
    mutation('POST', input, idempotencyKey)), 'created journey workspace saved view');
}
export async function reviseJourneyWorkspaceSavedView(view: JourneyWorkspaceSavedView, input: {
  audience: JourneyWorkspaceViewAudience; name: string; configuration: JourneyWorkspaceViewConfiguration
}, idempotencyKey: string) {
  return parse(mutationSchema, await api<unknown>(`/api/journey-workspace-saved-views/${encodeURIComponent(view.id)}`,
    mutation('PATCH', { expectedRevision: view.revision, ...input }, idempotencyKey)),
  'revised journey workspace saved view');
}
export async function retireJourneyWorkspaceSavedView(view: JourneyWorkspaceSavedView, idempotencyKey: string) {
  return parse(mutationSchema, await api<unknown>(`/api/journey-workspace-saved-views/${encodeURIComponent(view.id)}/retire`,
    mutation('POST', { expectedRevision: view.revision }, idempotencyKey)), 'retired journey workspace saved view');
}
export async function setJourneyWorkspaceDefaultView(surface: JourneyWorkspaceViewSurface, viewId: string | null,
  expectedRevision: number, idempotencyKey: string) {
  return parse(defaultSchema, await api<unknown>(`/api/journey-workspace-saved-views/default/${surface}`,
    mutation('PUT', { viewId, expectedRevision }, idempotencyKey)), 'journey workspace default view');
}
