import { api, json } from '@/lib/api';
import { platformAdminApi, platformAdminJson } from '@/lib/platformAdminApi';
import type { JourneyDefinitionSummary, JourneyExperienceType, JourneyMapType } from '@/lib/journeyMaps';

export type JourneyTemplateScope = 'system' | 'space';
export type JourneyTemplateVersionState = 'draft' | 'in_review' | 'published' | 'retired';
export type JourneyTemplateAuditAction = 'seeded' | 'created' | 'draft_updated' | 'version_created'
  | 'submitted_for_review' | 'review_rejected' | 'published' | 'retired' | 'map_created';

export interface JourneyTemplateLane {
  laneType: string;
  title: string;
  description: string;
  ordinal: number;
  blueprintOnly: boolean;
}

export interface JourneyTemplateCard {
  laneType: string;
  kind: string;
  title: string;
  content?: string;
}

export interface JourneyTemplateStage {
  key: string;
  name: string;
  goal: string;
  cards: JourneyTemplateCard[];
}

export interface JourneyTemplateContent {
  name: string;
  description?: string;
  industry?: string;
  useCase?: string;
  experienceType: JourneyExperienceType;
  mapType: JourneyMapType;
  lanes: JourneyTemplateLane[];
  stages: JourneyTemplateStage[];
}

export interface JourneyTemplateVersion extends JourneyTemplateContent {
  id: string;
  templateId: string;
  scope: JourneyTemplateScope;
  spaceId: string | null;
  versionNumber: number;
  schemaVersion: number;
  state: JourneyTemplateVersionState;
  contentChecksum: string;
  revision: number;
  createdByUserId: string | null;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  publishedByUserId: string | null;
  publishedAt: string | null;
  retiredByUserId: string | null;
  retiredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JourneyTemplate {
  id: string;
  scope: JourneyTemplateScope;
  spaceId: string | null;
  key: string;
  status: 'active' | 'retired';
  currentVersionId: string | null;
  publishedVersionId: string | null;
  revision: number;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  versions: JourneyTemplateVersion[];
}

export interface JourneyTemplateAuditEvent {
  id: string;
  templateId: string;
  templateVersionId: string | null;
  spaceId: string | null;
  actorUserId: string | null;
  action: JourneyTemplateAuditAction;
  reason: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  createdAt: string;
}

export interface JourneyTemplateAuditPage {
  events: JourneyTemplateAuditEvent[];
  nextBefore: string | null;
}

export interface JourneyMapFromTemplateResult {
  definition: JourneyDefinitionSummary;
  templateVersionId: string;
  versionId: string;
}

export const blankJourneyTemplateContent = (): JourneyTemplateContent => ({
  name: '',
  description: '',
  industry: '',
  useCase: '',
  experienceType: 'customer',
  mapType: 'current_state',
  lanes: [
    { laneType: 'customer_actions', title: 'Customer actions', description: '', ordinal: 0, blueprintOnly: false },
    { laneType: 'touchpoints', title: 'Touchpoints', description: '', ordinal: 1, blueprintOnly: false },
    { laneType: 'pain_points', title: 'Pain points', description: '', ordinal: 2, blueprintOnly: false },
    { laneType: 'opportunities', title: 'Opportunities', description: '', ordinal: 3, blueprintOnly: false }
  ],
  stages: [{ key: 'first-stage', name: 'First stage', goal: 'Define the participant goal', cards: [] }]
});

export function contentFromJourneyTemplateVersion(version: JourneyTemplateVersion): JourneyTemplateContent {
  return {
    name: version.name,
    description: version.description,
    industry: version.industry,
    useCase: version.useCase,
    experienceType: version.experienceType,
    mapType: version.mapType,
    lanes: version.lanes.map((lane, ordinal) => ({ ...lane, ordinal })),
    stages: version.stages.map((stage) => ({
      ...stage,
      cards: stage.cards.map((card) => ({ ...card }))
    }))
  };
}

export function listJourneyTemplates(includeDrafts = false) {
  const query = includeDrafts ? '?includeDrafts=true' : '';
  return api<{ templates: JourneyTemplate[] }>(`/api/journey-templates${query}`);
}

export function previewJourneyTemplate(templateId: string, versionId: string, includeDraft = false) {
  const query = includeDraft ? '?includeDraft=true' : '';
  return api<{ templateVersion: JourneyTemplateVersion }>(
    `/api/journey-templates/${encodeURIComponent(templateId)}/versions/${encodeURIComponent(versionId)}${query}`
  );
}

function journeyTemplateAuditQuery(limit = 20, before?: string) {
  const query = new URLSearchParams({ limit: String(Math.max(1, Math.min(100, Math.trunc(limit)))) });
  if (before) query.set('before', before);
  return query.toString();
}

export function listSpaceJourneyTemplateAuditEvents(templateId: string, limit = 20, before?: string) {
  return api<JourneyTemplateAuditPage>(
    `/api/journey-templates/${encodeURIComponent(templateId)}/audit?${journeyTemplateAuditQuery(limit, before)}`
  );
}

export function createSpaceJourneyTemplate(key: string, content: JourneyTemplateContent) {
  return api<JourneyTemplate>('/api/journey-templates', json('POST', { key, content }));
}

export function createSpaceJourneyTemplateVersion(
  templateId: string,
  expectedTemplateRevision: number,
  content: JourneyTemplateContent
) {
  return api<JourneyTemplate>(
    `/api/journey-templates/${encodeURIComponent(templateId)}/versions`,
    json('POST', { expectedTemplateRevision, content })
  );
}

export function updateSpaceJourneyTemplateDraft(
  templateId: string,
  versionId: string,
  expectedTemplateRevision: number,
  expectedVersionRevision: number,
  content: JourneyTemplateContent
) {
  return api<JourneyTemplateVersion>(
    `/api/journey-templates/${encodeURIComponent(templateId)}/versions/${encodeURIComponent(versionId)}`,
    json('PUT', { expectedTemplateRevision, expectedVersionRevision, content })
  );
}

function mutateSpaceJourneyTemplateVersion(
  action: 'publish' | 'retire',
  templateId: string,
  versionId: string,
  expectedTemplateRevision: number,
  expectedVersionRevision: number,
  reason: string
) {
  return api<JourneyTemplate>(
    `/api/journey-templates/${encodeURIComponent(templateId)}/versions/${encodeURIComponent(versionId)}/${action}`,
    json('POST', { expectedTemplateRevision, expectedVersionRevision, reason })
  );
}

export function publishSpaceJourneyTemplateVersion(
  templateId: string,
  versionId: string,
  expectedTemplateRevision: number,
  expectedVersionRevision: number,
  reason: string
) {
  return mutateSpaceJourneyTemplateVersion(
    'publish', templateId, versionId, expectedTemplateRevision, expectedVersionRevision, reason
  );
}

export function retireSpaceJourneyTemplateVersion(
  templateId: string,
  versionId: string,
  expectedTemplateRevision: number,
  expectedVersionRevision: number,
  reason: string
) {
  return mutateSpaceJourneyTemplateVersion(
    'retire', templateId, versionId, expectedTemplateRevision, expectedVersionRevision, reason
  );
}

export function createJourneyMapFromPublishedTemplate(templateId: string, versionId: string, name?: string) {
  return api<JourneyMapFromTemplateResult>(
    `/api/journey-templates/${encodeURIComponent(templateId)}/versions/${encodeURIComponent(versionId)}/create-map`,
    json('POST', name?.trim() ? { name: name.trim() } : {})
  );
}

const platformTemplatePath = '/api/platform-admin/journey-templates';

export function listPlatformJourneyTemplates() {
  return platformAdminApi<{ templates: JourneyTemplate[] }>(platformTemplatePath);
}

export function previewPlatformJourneyTemplate(templateId: string, versionId: string) {
  return platformAdminApi<{ templateVersion: JourneyTemplateVersion }>(
    `${platformTemplatePath}/${encodeURIComponent(templateId)}/versions/${encodeURIComponent(versionId)}`
  );
}

export function listPlatformJourneyTemplateAuditEvents(templateId: string, limit = 20, before?: string) {
  return platformAdminApi<JourneyTemplateAuditPage>(
    `${platformTemplatePath}/${encodeURIComponent(templateId)}/audit?${journeyTemplateAuditQuery(limit, before)}`
  );
}

export function createPlatformJourneyTemplate(key: string, content: JourneyTemplateContent) {
  return platformAdminApi<JourneyTemplate>(platformTemplatePath, platformAdminJson('POST', { key, content }));
}

export function createPlatformJourneyTemplateVersion(
  templateId: string,
  expectedTemplateRevision: number,
  content: JourneyTemplateContent
) {
  return platformAdminApi<JourneyTemplate>(
    `${platformTemplatePath}/${encodeURIComponent(templateId)}/versions`,
    platformAdminJson('POST', { expectedTemplateRevision, content })
  );
}

export function updatePlatformJourneyTemplateDraft(
  templateId: string,
  versionId: string,
  expectedTemplateRevision: number,
  expectedVersionRevision: number,
  content: JourneyTemplateContent
) {
  return platformAdminApi<JourneyTemplateVersion>(
    `${platformTemplatePath}/${encodeURIComponent(templateId)}/versions/${encodeURIComponent(versionId)}`,
    platformAdminJson('PUT', { expectedTemplateRevision, expectedVersionRevision, content })
  );
}

function mutatePlatformJourneyTemplateVersion(
  action: 'review' | 'reject' | 'publish' | 'retire',
  templateId: string,
  versionId: string,
  expectedTemplateRevision: number,
  expectedVersionRevision: number,
  reason: string
) {
  return platformAdminApi<JourneyTemplate | JourneyTemplateVersion>(
    `${platformTemplatePath}/${encodeURIComponent(templateId)}/versions/${encodeURIComponent(versionId)}/${action}`,
    platformAdminJson('POST', { expectedTemplateRevision, expectedVersionRevision, reason })
  );
}

export function submitPlatformJourneyTemplateForReview(
  templateId: string,
  versionId: string,
  expectedTemplateRevision: number,
  expectedVersionRevision: number,
  reason: string
) {
  return mutatePlatformJourneyTemplateVersion(
    'review', templateId, versionId, expectedTemplateRevision, expectedVersionRevision, reason
  );
}

export function rejectPlatformJourneyTemplateReview(
  templateId: string,
  versionId: string,
  expectedTemplateRevision: number,
  expectedVersionRevision: number,
  reason: string
) {
  return mutatePlatformJourneyTemplateVersion(
    'reject', templateId, versionId, expectedTemplateRevision, expectedVersionRevision, reason
  );
}

export function publishPlatformJourneyTemplateVersion(
  templateId: string,
  versionId: string,
  expectedTemplateRevision: number,
  expectedVersionRevision: number,
  reason: string
) {
  return mutatePlatformJourneyTemplateVersion(
    'publish', templateId, versionId, expectedTemplateRevision, expectedVersionRevision, reason
  );
}

export function retirePlatformJourneyTemplateVersion(
  templateId: string,
  versionId: string,
  expectedTemplateRevision: number,
  expectedVersionRevision: number,
  reason: string
) {
  return mutatePlatformJourneyTemplateVersion(
    'retire', templateId, versionId, expectedTemplateRevision, expectedVersionRevision, reason
  );
}
