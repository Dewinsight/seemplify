import crypto from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { currentSessionUser, isPlatformAdmin, isRootPlatformAdmin, type SessionUser } from './auth.js';
import { config } from './config.js';
import { db } from './database.js';
import {
  deterministicJourneyId, isCustomJourneyLane, isJourneyLaneKey, journeyCardKinds, journeyExperienceTypes,
  journeyMapLimits, journeyMapTypes, type JourneyCardKind, type JourneyExperienceType, type JourneyLaneDefinition,
  type JourneyLaneKey, type JourneyMapType
} from './journeyDomain.js';
import { createJourneyMapFromTemplate, JourneyMapError } from './journeyMaps.js';
import { journeyTemplateSeeds, type JourneyTemplateSeed } from './journeyTemplateCatalog.js';
import { hasControlPlanePermission } from './platformRbac.js';
import { resolveRequestSpace, spaceRoleOrIdpPermission, SpaceError, type SpaceContext } from './spaces.js';
import {
  assertSubscriptionFeature, assertSubscriptionQuota, SubscriptionEntitlementError
} from './subscriptionEntitlements.js';

export type JourneyTemplateScope = 'system' | 'space';
export type JourneyTemplateVersionState = 'draft' | 'in_review' | 'published' | 'retired';

export type JourneyTemplateCardInput = {
  laneType: JourneyLaneKey;
  kind: JourneyCardKind;
  title: string;
  content?: string;
};

export type JourneyTemplateStageInput = {
  key: string;
  name: string;
  goal: string;
  cards: JourneyTemplateCardInput[];
};

export type JourneyTemplateContentInput = {
  name: string;
  description?: string;
  industry?: string;
  useCase?: string;
  experienceType: JourneyExperienceType;
  mapType: JourneyMapType;
  lanes: JourneyLaneDefinition[];
  stages: JourneyTemplateStageInput[];
};

export class JourneyTemplateError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = 'JOURNEY_TEMPLATE_ERROR',
    public details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'JourneyTemplateError';
  }
}

const keyPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const stageKeyPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function bounded(value: unknown, maximum: number) {
  return String(value || '').trim().replace(/\s+/gu, ' ').slice(0, maximum);
}

function narrative(value: unknown) {
  return String(value || '').trim().slice(0, journeyMapLimits.contentChars);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(',')}}`;
}

function contentChecksum(content: JourneyTemplateContentInput) {
  return crypto.createHash('sha256').update(stableJson(content)).digest('hex');
}

function parseJson<T>(value: unknown, fallback: T): T {
  try { return value ? JSON.parse(String(value)) as T : fallback; }
  catch { return fallback; }
}

function normalizeContent(input: JourneyTemplateContentInput): JourneyTemplateContentInput {
  const name = bounded(input.name, journeyMapLimits.titleChars);
  if (!name) throw new JourneyTemplateError('Template name is required.', 400, 'JOURNEY_TEMPLATE_NAME_REQUIRED');
  if (!journeyExperienceTypes.includes(input.experienceType) || !journeyMapTypes.includes(input.mapType)) {
    throw new JourneyTemplateError('Template experience or map type is invalid.', 400, 'JOURNEY_TEMPLATE_TYPE_INVALID');
  }
  if (!Array.isArray(input.lanes) || input.lanes.length < 1 || input.lanes.length > journeyMapLimits.lanes) {
    throw new JourneyTemplateError('Template lanes are outside the supported limit.', 400, 'JOURNEY_TEMPLATE_LANES_INVALID');
  }
  const seenLaneTypes = new Set<string>();
  const lanes = input.lanes.map((lane, index) => {
    if (!isJourneyLaneKey(lane.laneType) || seenLaneTypes.has(lane.laneType)) {
      throw new JourneyTemplateError('Template lane types must be valid and unique.', 400, 'JOURNEY_TEMPLATE_LANES_INVALID');
    }
    seenLaneTypes.add(lane.laneType);
    return {
      laneType: lane.laneType,
      title: bounded(lane.title, journeyMapLimits.titleChars) || lane.laneType,
      description: narrative(lane.description),
      ordinal: index,
      blueprintOnly: Boolean(lane.blueprintOnly)
    };
  });
  if (!Array.isArray(input.stages) || input.stages.length < 1 || input.stages.length > journeyMapLimits.stages) {
    throw new JourneyTemplateError('Template stages are outside the supported limit.', 400, 'JOURNEY_TEMPLATE_STAGES_INVALID');
  }
  const seenStageKeys = new Set<string>();
  let totalCards = 0;
  const stages = input.stages.map((stage) => {
    const key = bounded(stage.key, 80);
    if (!stageKeyPattern.test(key) || seenStageKeys.has(key)) {
      throw new JourneyTemplateError('Template stage keys must be unique lower-kebab-case values.', 400,
        'JOURNEY_TEMPLATE_STAGE_KEY_INVALID');
    }
    seenStageKeys.add(key);
    const name = bounded(stage.name, journeyMapLimits.titleChars);
    const goal = bounded(stage.goal, journeyMapLimits.titleChars);
    if (!name || !goal || !Array.isArray(stage.cards)) {
      throw new JourneyTemplateError('Every template stage needs a name, goal, and card list.', 400,
        'JOURNEY_TEMPLATE_STAGE_INVALID');
    }
    const perCell = new Map<string, number>();
    const cards = stage.cards.map((card) => {
      if (!isJourneyLaneKey(card.laneType) || !seenLaneTypes.has(card.laneType)
        || !journeyCardKinds.includes(card.kind)) {
        throw new JourneyTemplateError('A template card uses an unavailable lane or kind.', 400,
          'JOURNEY_TEMPLATE_CARD_INVALID');
      }
      if (isCustomJourneyLane(card.laneType) && card.kind !== 'note') {
        throw new JourneyTemplateError('Custom template lanes accept note cards only.', 400,
          'JOURNEY_TEMPLATE_CARD_INVALID');
      }
      const cardTitle = bounded(card.title, journeyMapLimits.titleChars);
      if (!cardTitle) throw new JourneyTemplateError('Template cards require a title.', 400, 'JOURNEY_TEMPLATE_CARD_INVALID');
      totalCards += 1;
      const cellCount = (perCell.get(card.laneType) || 0) + 1;
      perCell.set(card.laneType, cellCount);
      if (totalCards > journeyMapLimits.cards || cellCount > journeyMapLimits.cardsPerCell) {
        throw new JourneyTemplateError('Template cards exceed the supported map limits.', 400,
          'JOURNEY_TEMPLATE_CARD_LIMIT');
      }
      return { laneType: card.laneType, kind: card.kind, title: cardTitle, content: narrative(card.content) };
    });
    return { key, name, goal, cards };
  });
  return {
    name,
    description: narrative(input.description),
    industry: bounded(input.industry, journeyMapLimits.titleChars),
    useCase: bounded(input.useCase, journeyMapLimits.titleChars),
    experienceType: input.experienceType,
    mapType: input.mapType,
    lanes,
    stages
  };
}

function seedContent(seed: JourneyTemplateSeed): JourneyTemplateContentInput {
  return normalizeContent({
    name: seed.name,
    description: seed.description,
    industry: seed.industry,
    useCase: seed.useCase,
    experienceType: seed.experienceType,
    mapType: seed.mapType,
    lanes: seed.lanes,
    stages: seed.stages
  });
}

function rowVersion(row: any) {
  return {
    id: String(row.id),
    templateId: String(row.template_id),
    scope: String(row.scope) as JourneyTemplateScope,
    spaceId: row.space_id ? String(row.space_id) : null,
    versionNumber: Number(row.version_number),
    schemaVersion: Number(row.schema_version),
    state: String(row.state) as JourneyTemplateVersionState,
    name: String(row.name),
    description: String(row.description || ''),
    industry: String(row.industry || ''),
    useCase: String(row.use_case || ''),
    experienceType: String(row.experience_type) as JourneyExperienceType,
    mapType: String(row.map_type) as JourneyMapType,
    lanes: parseJson<JourneyLaneDefinition[]>(row.lanes_json, []),
    stages: parseJson<JourneyTemplateStageInput[]>(row.stages_json, []),
    contentChecksum: String(row.content_checksum),
    revision: Number(row.revision),
    createdByUserId: row.created_by_user_id ? String(row.created_by_user_id) : null,
    reviewedByUserId: row.reviewed_by_user_id ? String(row.reviewed_by_user_id) : null,
    reviewedAt: row.reviewed_at || null,
    publishedByUserId: row.published_by_user_id ? String(row.published_by_user_id) : null,
    publishedAt: row.published_at || null,
    retiredByUserId: row.retired_by_user_id ? String(row.retired_by_user_id) : null,
    retiredAt: row.retired_at || null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function templateRows(where: string, parameters: unknown[] = []) {
  const templates = db.prepare(`SELECT * FROM journey_templates WHERE ${where}
    ORDER BY CASE scope WHEN 'system' THEN 0 ELSE 1 END,template_key,id`).all(...parameters) as any[];
  if (!templates.length) return [];
  const ids = templates.map((template) => String(template.id));
  const placeholders = ids.map(() => '?').join(',');
  const versions = db.prepare(`SELECT * FROM journey_template_versions WHERE template_id IN (${placeholders})
    ORDER BY template_id,version_number DESC`).all(...ids) as any[];
  const templateById = new Map(templates.map((template) => [String(template.id), template]));
  const versionsByTemplate = new Map<string, ReturnType<typeof rowVersion>[]>();
  for (const version of versions) {
    const templateId = String(version.template_id);
    const template = templateById.get(templateId);
    if (!template || String(template.scope) !== String(version.scope)
      || String(template.space_id || '') !== String(version.space_id || '')) continue;
    versionsByTemplate.set(templateId, [...(versionsByTemplate.get(templateId) || []), rowVersion(version)]);
  }
  return templates.map((template) => ({
    id: String(template.id),
    scope: String(template.scope) as JourneyTemplateScope,
    spaceId: template.space_id ? String(template.space_id) : null,
    key: String(template.template_key),
    status: String(template.status) as 'active' | 'retired',
    currentVersionId: template.current_version_id ? String(template.current_version_id) : null,
    publishedVersionId: template.published_version_id ? String(template.published_version_id) : null,
    revision: Number(template.revision),
    createdByUserId: template.created_by_user_id ? String(template.created_by_user_id) : null,
    createdAt: String(template.created_at),
    updatedAt: String(template.updated_at),
    versions: versionsByTemplate.get(String(template.id)) || []
  }));
}

function audit(input: {
  templateId: string;
  templateVersionId?: string | null;
  spaceId?: string | null;
  actorUserId?: string | null;
  action: 'seeded' | 'created' | 'draft_updated' | 'version_created' | 'submitted_for_review'
    | 'review_rejected' | 'published' | 'retired';
  reason?: string;
  before?: unknown;
  after?: unknown;
}) {
  db.prepare(`INSERT INTO journey_template_audit_events
    (id,template_id,template_version_id,space_id,actor_user_id,action,reason,before_json,after_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    crypto.randomUUID(), input.templateId, input.templateVersionId || null, input.spaceId || null,
    input.actorUserId || null, input.action, narrative(input.reason), JSON.stringify(input.before || {}),
    JSON.stringify(input.after || {}), new Date().toISOString()
  );
}

function rowAuditEvent(row: any) {
  return {
    id: String(row.id),
    templateId: String(row.template_id),
    templateVersionId: row.template_version_id ? String(row.template_version_id) : null,
    spaceId: row.space_id ? String(row.space_id) : null,
    actorUserId: row.actor_user_id ? String(row.actor_user_id) : null,
    action: String(row.action),
    reason: String(row.reason || ''),
    before: parseJson<Record<string, unknown>>(row.before_json, {}),
    after: parseJson<Record<string, unknown>>(row.after_json, {}),
    createdAt: String(row.created_at)
  };
}

function insertVersion(input: {
  id: string;
  templateId: string;
  scope: JourneyTemplateScope;
  spaceId: string | null;
  versionNumber: number;
  state?: JourneyTemplateVersionState;
  content: JourneyTemplateContentInput;
  actorUserId: string | null;
  now: string;
}) {
  const content = normalizeContent(input.content);
  db.prepare(`INSERT INTO journey_template_versions
    (id,template_id,scope,space_id,version_number,schema_version,state,name,description,industry,use_case,
      experience_type,map_type,lanes_json,stages_json,content_checksum,revision,created_by_user_id,
      reviewed_by_user_id,reviewed_at,published_by_user_id,published_at,retired_by_user_id,retired_at,created_at,updated_at)
    VALUES (?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,1,?,NULL,NULL,NULL,NULL,NULL,NULL,?,?)`).run(
    input.id, input.templateId, input.scope, input.spaceId, input.versionNumber, input.state || 'draft', content.name,
    content.description || '', content.industry || '', content.useCase || '', content.experienceType, content.mapType,
    JSON.stringify(content.lanes), JSON.stringify(content.stages), contentChecksum(content), input.actorUserId, input.now, input.now
  );
  return content;
}

/** Seed only missing deterministic system rows. Existing drafts, reviewed
 * metadata, publications, and customer changes are never overwritten. */
export function seedJourneyTemplateCatalog() {
  const now = '2026-08-04T00:00:00.000Z';
  let inserted = 0;
  db.transaction(() => {
    for (const seed of journeyTemplateSeeds) {
      const templateId = deterministicJourneyId('template', 'system', seed.key);
      if (db.prepare('SELECT 1 FROM journey_templates WHERE id=? OR (scope=? AND template_key=?)')
        .get(templateId, 'system', seed.key)) continue;
      const versionId = deterministicJourneyId('template-version', templateId, seed.version);
      db.prepare(`INSERT INTO journey_templates
        (id,scope,space_id,template_key,status,current_version_id,published_version_id,revision,created_by_user_id,created_at,updated_at)
        VALUES (?,'system',NULL,?,'active',NULL,NULL,1,NULL,?,?)`).run(templateId, seed.key, now, now);
      const content = insertVersion({
        id: versionId, templateId, scope: 'system', spaceId: null, versionNumber: seed.version,
        state: 'draft', content: seedContent(seed), actorUserId: null, now
      });
      db.prepare('UPDATE journey_templates SET current_version_id=? WHERE id=?').run(versionId, templateId);
      audit({ templateId, templateVersionId: versionId, action: 'seeded', after: {
        key: seed.key, versionNumber: seed.version, state: 'draft', checksum: contentChecksum(content)
      } });
      inserted += 1;
    }
  })();
  return inserted;
}

export function listPublishedJourneyTemplates(spaceId: string, includeSpaceDrafts = false) {
  assertSubscriptionFeature(spaceId, 'journeyTemplates');
  if (!includeSpaceDrafts) {
    const templates = templateRows(`status='active' AND published_version_id IS NOT NULL
      AND (scope='system' OR (scope='space' AND space_id=?))`, [spaceId]);
    return templates.map((template) => ({
      ...template,
      versions: template.versions.filter((version) => version.id === template.publishedVersionId)
    }));
  }
  return templateRows(`(scope='system' AND status='active' AND published_version_id IS NOT NULL)
    OR (scope='space' AND space_id=?)`, [spaceId]).map((template) => ({
      ...template,
      versions: template.scope === 'system'
        ? template.versions.filter((version) => version.id === template.publishedVersionId)
        : template.versions
    }));
}

export function listSystemJourneyTemplatesForAdmin() {
  return templateRows("scope='system'");
}

export function previewJourneyTemplate(spaceId: string, templateId: string, versionId: string, includeSpaceDrafts = false) {
  assertSubscriptionFeature(spaceId, 'journeyTemplates');
  const row = db.prepare(`SELECT version.* FROM journey_template_versions version
    JOIN journey_templates template ON template.id=version.template_id
    WHERE template.id=? AND version.id=? AND template.scope=version.scope AND (
      (version.scope='system' AND version.state='published' AND template.published_version_id=version.id AND template.status='active')
      OR (version.scope='space' AND version.space_id=? AND template.space_id=? AND (
        (version.state='published' AND template.published_version_id=version.id AND template.status='active') OR ?=1
      ))
    )`).get(templateId, versionId, spaceId, spaceId, includeSpaceDrafts ? 1 : 0) as any;
  if (!row) throw new JourneyTemplateError('Journey template version not found.', 404, 'JOURNEY_TEMPLATE_NOT_FOUND');
  return rowVersion(row);
}

export function previewSystemJourneyTemplateForAdmin(templateId: string, versionId: string) {
  const row = db.prepare(`SELECT version.* FROM journey_template_versions version
    WHERE version.template_id=? AND version.id=? AND version.scope='system'`).get(templateId, versionId) as any;
  if (!row) throw new JourneyTemplateError('System journey template version not found.', 404, 'JOURNEY_TEMPLATE_NOT_FOUND');
  return rowVersion(row);
}

export function listJourneyTemplateAuditEvents(input: {
  templateId: string;
  scope: JourneyTemplateScope;
  spaceId: string | null;
  limit?: number;
  before?: string;
}) {
  governedTemplate(input.templateId, input.scope, input.spaceId);
  if (input.scope === 'space') assertSubscriptionFeature(input.spaceId!, 'journeyTemplates');
  const limit = Math.max(1, Math.min(100, Math.trunc(input.limit || 50)));
  const before = input.before ? new Date(input.before) : null;
  if (before && Number.isNaN(before.valueOf())) {
    throw new JourneyTemplateError('The audit cursor is invalid.', 400, 'JOURNEY_TEMPLATE_AUDIT_CURSOR_INVALID');
  }
  const rows = db.prepare(`SELECT * FROM journey_template_audit_events
    WHERE template_id=? AND ((? IS NULL AND space_id IS NULL) OR space_id=?)
      AND (? IS NULL OR created_at<?)
    ORDER BY created_at DESC,id DESC LIMIT ?`).all(
    input.templateId, input.spaceId, input.spaceId,
    before ? before.toISOString() : null, before ? before.toISOString() : null, limit + 1
  ) as any[];
  const hasMore = rows.length > limit;
  const events = rows.slice(0, limit).map(rowAuditEvent);
  return {
    events,
    nextBefore: hasMore && events.length ? events.at(-1)!.createdAt : null
  };
}

export function createGovernedJourneyTemplate(input: {
  scope: JourneyTemplateScope;
  spaceId: string | null;
  key: string;
  content: JourneyTemplateContentInput;
  actorUserId: string;
}) {
  const key = bounded(input.key, 100).toLowerCase();
  if (!keyPattern.test(key)) throw new JourneyTemplateError('Template key must use lower kebab case.', 400,
    'JOURNEY_TEMPLATE_KEY_INVALID');
  if ((input.scope === 'system') !== (input.spaceId === null)) {
    throw new JourneyTemplateError('Template scope is invalid.', 400, 'JOURNEY_TEMPLATE_SCOPE_INVALID');
  }
  if (input.scope === 'space') {
    assertSubscriptionFeature(input.spaceId!, 'journeyTemplates');
    const current = Number((db.prepare("SELECT COUNT(*) count FROM journey_templates WHERE scope='space' AND space_id=?")
      .get(input.spaceId) as any)?.count || 0);
    assertSubscriptionQuota(input.spaceId!, 'journeyTemplates', current);
  }
  const content = normalizeContent(input.content);
  const now = new Date().toISOString();
  const templateId = crypto.randomUUID();
  const versionId = deterministicJourneyId('template-version', templateId, 1);
  try {
    return db.transaction(() => {
      db.prepare(`INSERT INTO journey_templates
        (id,scope,space_id,template_key,status,current_version_id,published_version_id,revision,created_by_user_id,created_at,updated_at)
        VALUES (?,?,?,?,'active',NULL,NULL,1,?,?,?)`)
        .run(templateId, input.scope, input.spaceId, key, input.actorUserId, now, now);
      insertVersion({ id: versionId, templateId, scope: input.scope, spaceId: input.spaceId, versionNumber: 1,
        content, actorUserId: input.actorUserId, now });
      db.prepare('UPDATE journey_templates SET current_version_id=? WHERE id=?').run(versionId, templateId);
      audit({ templateId, templateVersionId: versionId, spaceId: input.spaceId, actorUserId: input.actorUserId,
        action: 'created', after: { key, versionNumber: 1, state: 'draft', checksum: contentChecksum(content) } });
      return templateRows('id=?', [templateId])[0];
    })();
  } catch (error: any) {
    if (String(error?.code || '') === 'SQLITE_CONSTRAINT_UNIQUE' || String(error?.code || '') === '23505') {
      throw new JourneyTemplateError('A template with this key already exists in the scope.', 409,
        'JOURNEY_TEMPLATE_KEY_CONFLICT');
    }
    throw error;
  }
}

function governedTemplate(templateId: string, scope: JourneyTemplateScope, spaceId: string | null) {
  const row = db.prepare(`SELECT * FROM journey_templates WHERE id=? AND scope=?
    AND ((? IS NULL AND space_id IS NULL) OR space_id=?)`).get(templateId, scope, spaceId, spaceId) as any;
  if (!row) throw new JourneyTemplateError('Journey template not found.', 404, 'JOURNEY_TEMPLATE_NOT_FOUND');
  return row;
}

function governedVersion(templateId: string, versionId: string, scope: JourneyTemplateScope, spaceId: string | null) {
  const row = db.prepare(`SELECT * FROM journey_template_versions WHERE id=? AND template_id=? AND scope=?
    AND ((? IS NULL AND space_id IS NULL) OR space_id=?)`).get(versionId, templateId, scope, spaceId, spaceId) as any;
  if (!row) throw new JourneyTemplateError('Journey template version not found.', 404, 'JOURNEY_TEMPLATE_NOT_FOUND');
  return row;
}

function assertRevision(actual: number, expected: number, target: 'template' | 'version') {
  if (Number(actual) !== expected) {
    throw new JourneyTemplateError(`The ${target} changed before this request. Refresh and try again.`, 409,
      'JOURNEY_TEMPLATE_REVISION_CONFLICT', { target, expected, actual: Number(actual) });
  }
}

export function createGovernedJourneyTemplateVersion(input: {
  templateId: string;
  scope: JourneyTemplateScope;
  spaceId: string | null;
  expectedTemplateRevision: number;
  content: JourneyTemplateContentInput;
  actorUserId: string;
}) {
  const content = normalizeContent(input.content);
  return db.transaction(() => {
    const template = governedTemplate(input.templateId, input.scope, input.spaceId);
    assertRevision(template.revision, input.expectedTemplateRevision, 'template');
    const versionNumber = Number((db.prepare(`SELECT COALESCE(MAX(version_number),0) maximum
      FROM journey_template_versions WHERE template_id=?`).get(input.templateId) as any)?.maximum || 0) + 1;
    const versionId = deterministicJourneyId('template-version', input.templateId, versionNumber);
    const now = new Date().toISOString();
    insertVersion({ id: versionId, templateId: input.templateId, scope: input.scope, spaceId: input.spaceId,
      versionNumber, content, actorUserId: input.actorUserId, now });
    const changed = db.prepare(`UPDATE journey_templates SET current_version_id=?,revision=revision+1,status='active',updated_at=?
      WHERE id=? AND revision=?`).run(versionId, now, input.templateId, input.expectedTemplateRevision).changes;
    if (changed !== 1) throw new JourneyTemplateError('The template changed before this version was created.', 409,
      'JOURNEY_TEMPLATE_REVISION_CONFLICT');
    audit({ templateId: input.templateId, templateVersionId: versionId, spaceId: input.spaceId,
      actorUserId: input.actorUserId, action: 'version_created', before: { revision: input.expectedTemplateRevision },
      after: { versionNumber, checksum: contentChecksum(content) } });
    return templateRows('id=?', [input.templateId])[0];
  })();
}

export function updateGovernedJourneyTemplateDraft(input: {
  templateId: string;
  versionId: string;
  scope: JourneyTemplateScope;
  spaceId: string | null;
  expectedTemplateRevision: number;
  expectedVersionRevision: number;
  content: JourneyTemplateContentInput;
  actorUserId: string;
}) {
  const content = normalizeContent(input.content);
  return db.transaction(() => {
    const template = governedTemplate(input.templateId, input.scope, input.spaceId);
    const version = governedVersion(input.templateId, input.versionId, input.scope, input.spaceId);
    assertRevision(template.revision, input.expectedTemplateRevision, 'template');
    assertRevision(version.revision, input.expectedVersionRevision, 'version');
    if (version.state !== 'draft') throw new JourneyTemplateError('Only a draft template version can be edited.', 409,
      'JOURNEY_TEMPLATE_VERSION_IMMUTABLE');
    const now = new Date().toISOString();
    const versionChanged = db.prepare(`UPDATE journey_template_versions SET name=?,description=?,industry=?,use_case=?,
        experience_type=?,map_type=?,lanes_json=?,stages_json=?,content_checksum=?,revision=revision+1,updated_at=?
      WHERE id=? AND revision=? AND state='draft'`).run(content.name, content.description || '', content.industry || '',
      content.useCase || '', content.experienceType, content.mapType, JSON.stringify(content.lanes), JSON.stringify(content.stages),
      contentChecksum(content), now, input.versionId, input.expectedVersionRevision).changes;
    const templateChanged = db.prepare(`UPDATE journey_templates SET current_version_id=?,revision=revision+1,updated_at=?
      WHERE id=? AND revision=?`).run(input.versionId, now, input.templateId, input.expectedTemplateRevision).changes;
    if (versionChanged !== 1 || templateChanged !== 1) throw new JourneyTemplateError('The template changed before it was saved.',
      409, 'JOURNEY_TEMPLATE_REVISION_CONFLICT');
    audit({ templateId: input.templateId, templateVersionId: input.versionId, spaceId: input.spaceId,
      actorUserId: input.actorUserId, action: 'draft_updated', before: { checksum: version.content_checksum },
      after: { checksum: contentChecksum(content) } });
    return previewGovernedVersion(input.templateId, input.versionId, input.scope, input.spaceId);
  })();
}

function previewGovernedVersion(templateId: string, versionId: string, scope: JourneyTemplateScope, spaceId: string | null) {
  return rowVersion(governedVersion(templateId, versionId, scope, spaceId));
}

export function submitSystemJourneyTemplateForReview(input: {
  templateId: string;
  versionId: string;
  expectedTemplateRevision: number;
  expectedVersionRevision: number;
  actorUserId: string;
  reason: string;
}) {
  return db.transaction(() => {
    const template = governedTemplate(input.templateId, 'system', null);
    const version = governedVersion(input.templateId, input.versionId, 'system', null);
    assertRevision(template.revision, input.expectedTemplateRevision, 'template');
    assertRevision(version.revision, input.expectedVersionRevision, 'version');
    if (version.state !== 'draft') throw new JourneyTemplateError('Only a draft can be submitted for review.', 409,
      'JOURNEY_TEMPLATE_REVIEW_STATE_INVALID');
    const now = new Date().toISOString();
    const versionChanged = db.prepare(`UPDATE journey_template_versions SET state='in_review',reviewed_by_user_id=?,
        reviewed_at=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND state='draft'`)
      .run(input.actorUserId, now, now, input.versionId, input.expectedVersionRevision).changes;
    const templateChanged = db.prepare(`UPDATE journey_templates SET current_version_id=?,revision=revision+1,updated_at=?
      WHERE id=? AND revision=?`).run(input.versionId, now, input.templateId, input.expectedTemplateRevision).changes;
    if (versionChanged !== 1 || templateChanged !== 1) throw new JourneyTemplateError('The template changed before review.', 409,
      'JOURNEY_TEMPLATE_REVISION_CONFLICT');
    audit({ templateId: input.templateId, templateVersionId: input.versionId, actorUserId: input.actorUserId,
      action: 'submitted_for_review', reason: input.reason,
      before: { state: 'draft' }, after: { state: 'in_review', reviewedAt: now } });
    return previewGovernedVersion(input.templateId, input.versionId, 'system', null);
  })();
}

export function rejectSystemJourneyTemplateReview(input: {
  templateId: string;
  versionId: string;
  expectedTemplateRevision: number;
  expectedVersionRevision: number;
  actorUserId: string;
  reason: string;
}) {
  if (!input.reason.trim()) {
    throw new JourneyTemplateError('A rejection reason is required.', 400, 'JOURNEY_TEMPLATE_REJECTION_REASON_REQUIRED');
  }
  return db.transaction(() => {
    const template = governedTemplate(input.templateId, 'system', null);
    const version = governedVersion(input.templateId, input.versionId, 'system', null);
    assertRevision(template.revision, input.expectedTemplateRevision, 'template');
    assertRevision(version.revision, input.expectedVersionRevision, 'version');
    if (version.state !== 'in_review') {
      throw new JourneyTemplateError('Only a template awaiting review can be returned to draft.', 409,
        'JOURNEY_TEMPLATE_REVIEW_STATE_INVALID');
    }
    const now = new Date().toISOString();
    const versionChanged = db.prepare(`UPDATE journey_template_versions SET state='draft',reviewed_by_user_id=NULL,
        reviewed_at=NULL,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND state='in_review'`)
      .run(now, input.versionId, input.expectedVersionRevision).changes;
    const templateChanged = db.prepare(`UPDATE journey_templates SET current_version_id=?,revision=revision+1,updated_at=?
      WHERE id=? AND revision=?`).run(input.versionId, now, input.templateId, input.expectedTemplateRevision).changes;
    if (versionChanged !== 1 || templateChanged !== 1) {
      throw new JourneyTemplateError('The template changed before the review decision.', 409,
        'JOURNEY_TEMPLATE_REVISION_CONFLICT');
    }
    audit({ templateId: input.templateId, templateVersionId: input.versionId, actorUserId: input.actorUserId,
      action: 'review_rejected', reason: input.reason,
      before: { state: 'in_review', reviewedByUserId: version.reviewed_by_user_id || null },
      after: { state: 'draft' } });
    return previewGovernedVersion(input.templateId, input.versionId, 'system', null);
  })();
}

export function publishGovernedJourneyTemplateVersion(input: {
  templateId: string;
  versionId: string;
  scope: JourneyTemplateScope;
  spaceId: string | null;
  expectedTemplateRevision: number;
  expectedVersionRevision: number;
  actorUserId: string;
  reason: string;
}) {
  return db.transaction(() => {
    const template = governedTemplate(input.templateId, input.scope, input.spaceId);
    const version = governedVersion(input.templateId, input.versionId, input.scope, input.spaceId);
    assertRevision(template.revision, input.expectedTemplateRevision, 'template');
    assertRevision(version.revision, input.expectedVersionRevision, 'version');
    const allowedState = input.scope === 'system' ? 'in_review' : 'draft';
    if (version.state !== allowedState) {
      throw new JourneyTemplateError(input.scope === 'system'
        ? 'System templates must complete review before publication.'
        : 'Only an organisation draft can be published.', 409, 'JOURNEY_TEMPLATE_PUBLISH_STATE_INVALID');
    }
    if (input.scope === 'system' && (!version.reviewed_by_user_id || !version.reviewed_at)) {
      throw new JourneyTemplateError('System template review metadata is incomplete.', 409,
        'JOURNEY_TEMPLATE_REVIEW_STATE_INVALID');
    }
    if (input.scope === 'system' && String(version.reviewed_by_user_id) === input.actorUserId) {
      throw new JourneyTemplateError(
        'A different platform administrator must publish a reviewed system template.',
        409,
        'JOURNEY_TEMPLATE_TWO_PERSON_REQUIRED',
        { reviewedByUserId: String(version.reviewed_by_user_id) }
      );
    }
    const now = new Date().toISOString();
    if (template.published_version_id && template.published_version_id !== input.versionId) {
      db.prepare(`UPDATE journey_template_versions SET state='retired',retired_by_user_id=?,retired_at=?,
        revision=revision+1,updated_at=? WHERE id=? AND state='published'`)
        .run(input.actorUserId, now, now, template.published_version_id);
    }
    const versionChanged = db.prepare(`UPDATE journey_template_versions SET state='published',published_by_user_id=?,
        published_at=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND state=?`)
      .run(input.actorUserId, now, now, input.versionId, input.expectedVersionRevision, allowedState).changes;
    const templateChanged = db.prepare(`UPDATE journey_templates SET status='active',current_version_id=?,published_version_id=?,
        revision=revision+1,updated_at=? WHERE id=? AND revision=?`)
      .run(input.versionId, input.versionId, now, input.templateId, input.expectedTemplateRevision).changes;
    if (versionChanged !== 1 || templateChanged !== 1) throw new JourneyTemplateError('The template changed before publication.',
      409, 'JOURNEY_TEMPLATE_REVISION_CONFLICT');
    audit({ templateId: input.templateId, templateVersionId: input.versionId, spaceId: input.spaceId,
      actorUserId: input.actorUserId, action: 'published', reason: input.reason,
      before: { state: version.state, publishedVersionId: template.published_version_id || null },
      after: { state: 'published', publishedAt: now } });
    return templateRows('id=?', [input.templateId])[0];
  })();
}

export function retireGovernedJourneyTemplateVersion(input: {
  templateId: string;
  versionId: string;
  scope: JourneyTemplateScope;
  spaceId: string | null;
  expectedTemplateRevision: number;
  expectedVersionRevision: number;
  actorUserId: string;
  reason: string;
}) {
  return db.transaction(() => {
    const template = governedTemplate(input.templateId, input.scope, input.spaceId);
    const version = governedVersion(input.templateId, input.versionId, input.scope, input.spaceId);
    assertRevision(template.revision, input.expectedTemplateRevision, 'template');
    assertRevision(version.revision, input.expectedVersionRevision, 'version');
    if (version.state === 'retired') throw new JourneyTemplateError('The template version is already retired.', 409,
      'JOURNEY_TEMPLATE_RETIRE_STATE_INVALID');
    const now = new Date().toISOString();
    const versionChanged = db.prepare(`UPDATE journey_template_versions SET state='retired',retired_by_user_id=?,
        retired_at=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND state<>'retired'`)
      .run(input.actorUserId, now, now, input.versionId, input.expectedVersionRevision).changes;
    const wasPublished = template.published_version_id === input.versionId;
    const templateChanged = db.prepare(`UPDATE journey_templates SET status=?,published_version_id=?,revision=revision+1,updated_at=?
      WHERE id=? AND revision=?`).run(wasPublished ? 'retired' : template.status,
      wasPublished ? null : template.published_version_id, now, input.templateId, input.expectedTemplateRevision).changes;
    if (versionChanged !== 1 || templateChanged !== 1) throw new JourneyTemplateError('The template changed before retirement.',
      409, 'JOURNEY_TEMPLATE_REVISION_CONFLICT');
    audit({ templateId: input.templateId, templateVersionId: input.versionId, spaceId: input.spaceId,
      actorUserId: input.actorUserId, action: 'retired', reason: input.reason,
      before: { state: version.state }, after: { state: 'retired', retiredAt: now } });
    return templateRows('id=?', [input.templateId])[0];
  })();
}

function sessionContext(request: Request) {
  const user = currentSessionUser(request);
  if (!user) throw new SpaceError('Authentication required.', 401, 'AUTHENTICATION_REQUIRED');
  return { user, space: resolveRequestSpace(request, user.id) };
}

function requireSpaceAdmin(space: SpaceContext) {
  if (!spaceRoleOrIdpPermission(space, 'journey_templates.manage')) {
    throw new JourneyTemplateError('Space administrator access is required.', 403, 'JOURNEY_TEMPLATE_ADMIN_REQUIRED');
  }
}

function requireMapEditor(space: SpaceContext) {
  if (!spaceRoleOrIdpPermission(space, 'journeys.edit')) {
    throw new JourneyTemplateError('You do not have permission to create journey maps in this space.', 403,
      'JOURNEY_MAP_FORBIDDEN');
  }
}

function sendError(response: Response, error: unknown) {
  if (error instanceof z.ZodError) return response.status(400).json({ error: 'Validation failed.', code: 'VALIDATION_FAILED', details: error.issues });
  if (error instanceof JourneyTemplateError || error instanceof JourneyMapError || error instanceof SpaceError
    || error instanceof SubscriptionEntitlementError) {
    return response.status(error.status).json({ error: error.message, code: error.code, details: 'details' in error ? error.details : {} });
  }
  console.error('Journey template request failed:', error instanceof Error ? error.message : String(error));
  return response.status(500).json({ error: 'The journey template request could not be completed.', code: 'JOURNEY_TEMPLATE_INTERNAL_ERROR' });
}

const laneSchema = z.object({
  laneType: z.string().min(1).max(63).refine(isJourneyLaneKey, 'Invalid journey lane key.'),
  title: z.string().trim().min(1).max(journeyMapLimits.titleChars),
  description: z.string().max(journeyMapLimits.contentChars).default(''),
  ordinal: z.number().int().min(0).max(journeyMapLimits.lanes), blueprintOnly: z.boolean().default(false)
}).strict();
const cardSchema = z.object({
  laneType: z.string().min(1).max(63).refine(isJourneyLaneKey, 'Invalid journey lane key.'),
  kind: z.enum(journeyCardKinds),
  title: z.string().trim().min(1).max(journeyMapLimits.titleChars),
  content: z.string().max(journeyMapLimits.contentChars).optional()
}).strict();
const stageSchema = z.object({
  key: z.string().trim().min(1).max(80).regex(stageKeyPattern),
  name: z.string().trim().min(1).max(journeyMapLimits.titleChars),
  goal: z.string().trim().min(1).max(journeyMapLimits.titleChars),
  cards: z.array(cardSchema).max(journeyMapLimits.cards)
}).strict();
const contentSchema = z.object({
  name: z.string().trim().min(1).max(journeyMapLimits.titleChars),
  description: z.string().max(journeyMapLimits.contentChars).optional(),
  industry: z.string().trim().max(journeyMapLimits.titleChars).optional(),
  useCase: z.string().trim().max(journeyMapLimits.titleChars).optional(),
  experienceType: z.enum(journeyExperienceTypes), mapType: z.enum(journeyMapTypes),
  lanes: z.array(laneSchema).min(1).max(journeyMapLimits.lanes),
  stages: z.array(stageSchema).min(1).max(journeyMapLimits.stages)
}).strict();
const revisionSchema = z.number().int().min(1);
const versionMutationSchema = z.object({
  expectedTemplateRevision: revisionSchema,
  expectedVersionRevision: revisionSchema,
  reason: z.string().trim().max(1_000).default('')
}).strict();
const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  before: z.string().datetime().optional()
}).strict();

export const journeyTemplateRouter = express.Router();
journeyTemplateRouter.use((_request, response, next) => {
  response.setHeader('Cache-Control', 'private, no-store');
  next();
});

journeyTemplateRouter.get('/', (request, response) => {
  try {
    const { space } = sessionContext(request);
    const includeDrafts = String(request.query.includeDrafts || '') === 'true';
    if (includeDrafts) requireSpaceAdmin(space);
    return response.json({ templates: listPublishedJourneyTemplates(space.id, includeDrafts) });
  } catch (error) { return sendError(response, error); }
});

journeyTemplateRouter.get('/:templateId/audit', (request, response) => {
  try {
    const { space } = sessionContext(request);
    requireSpaceAdmin(space);
    const query = auditQuerySchema.parse(request.query);
    return response.json(listJourneyTemplateAuditEvents({
      templateId: String(request.params.templateId), scope: 'space', spaceId: space.id,
      limit: query.limit, before: query.before
    }));
  } catch (error) { return sendError(response, error); }
});

journeyTemplateRouter.get('/:templateId/versions/:versionId', (request, response) => {
  try {
    const { space } = sessionContext(request);
    const includeDraft = String(request.query.includeDraft || '') === 'true';
    if (includeDraft) requireSpaceAdmin(space);
    return response.json({ templateVersion: previewJourneyTemplate(space.id, String(request.params.templateId),
      String(request.params.versionId), includeDraft) });
  } catch (error) { return sendError(response, error); }
});

journeyTemplateRouter.post('/', (request, response) => {
  try {
    const { user, space } = sessionContext(request);
    requireSpaceAdmin(space);
    const input = z.object({ key: z.string().trim().min(1).max(100).regex(keyPattern), content: contentSchema }).strict()
      .parse(request.body || {});
    return response.status(201).json(createGovernedJourneyTemplate({
      scope: 'space', spaceId: space.id, key: input.key, content: input.content, actorUserId: user.id
    }));
  } catch (error) { return sendError(response, error); }
});

journeyTemplateRouter.post('/:templateId/versions', (request, response) => {
  try {
    const { user, space } = sessionContext(request);
    requireSpaceAdmin(space);
    const input = z.object({ expectedTemplateRevision: revisionSchema, content: contentSchema }).strict().parse(request.body || {});
    return response.status(201).json(createGovernedJourneyTemplateVersion({
      templateId: String(request.params.templateId), scope: 'space', spaceId: space.id,
      expectedTemplateRevision: input.expectedTemplateRevision, content: input.content, actorUserId: user.id
    }));
  } catch (error) { return sendError(response, error); }
});

journeyTemplateRouter.put('/:templateId/versions/:versionId', (request, response) => {
  try {
    const { user, space } = sessionContext(request);
    requireSpaceAdmin(space);
    const input = z.object({ expectedTemplateRevision: revisionSchema, expectedVersionRevision: revisionSchema,
      content: contentSchema }).strict().parse(request.body || {});
    return response.json(updateGovernedJourneyTemplateDraft({
      templateId: String(request.params.templateId), versionId: String(request.params.versionId), scope: 'space',
      spaceId: space.id, expectedTemplateRevision: input.expectedTemplateRevision,
      expectedVersionRevision: input.expectedVersionRevision, content: input.content, actorUserId: user.id
    }));
  } catch (error) { return sendError(response, error); }
});

journeyTemplateRouter.post('/:templateId/versions/:versionId/publish', (request, response) => {
  try {
    const { user, space } = sessionContext(request);
    requireSpaceAdmin(space);
    const input = versionMutationSchema.parse(request.body || {});
    return response.json(publishGovernedJourneyTemplateVersion({
      templateId: String(request.params.templateId), versionId: String(request.params.versionId), scope: 'space',
      spaceId: space.id, expectedTemplateRevision: input.expectedTemplateRevision,
      expectedVersionRevision: input.expectedVersionRevision, actorUserId: user.id, reason: input.reason
    }));
  } catch (error) { return sendError(response, error); }
});

journeyTemplateRouter.post('/:templateId/versions/:versionId/retire', (request, response) => {
  try {
    const { user, space } = sessionContext(request);
    requireSpaceAdmin(space);
    const input = versionMutationSchema.parse(request.body || {});
    return response.json(retireGovernedJourneyTemplateVersion({
      templateId: String(request.params.templateId), versionId: String(request.params.versionId), scope: 'space',
      spaceId: space.id, expectedTemplateRevision: input.expectedTemplateRevision,
      expectedVersionRevision: input.expectedVersionRevision, actorUserId: user.id, reason: input.reason
    }));
  } catch (error) { return sendError(response, error); }
});

journeyTemplateRouter.post('/:templateId/versions/:versionId/create-map', (request, response) => {
  try {
    const { user, space } = sessionContext(request);
    requireMapEditor(space);
    const input = z.object({ name: z.string().trim().min(1).max(journeyMapLimits.titleChars).optional() }).strict()
      .parse(request.body || {});
    const version = previewJourneyTemplate(space.id, String(request.params.templateId), String(request.params.versionId));
    if (version.state !== 'published') throw new JourneyTemplateError('A published template version is required.', 409,
      'JOURNEY_TEMPLATE_VERSION_NOT_PUBLISHED');
    return response.status(201).json(createJourneyMapFromTemplate(space.id, user.id, version.id, input.name));
  } catch (error) { return sendError(response, error); }
});

function platformActor(request: Request, response: Response, permission: 'journey_templates.read' | 'journey_templates.manage') {
  const actor = currentSessionUser(request);
  if (!actor) {
    response.status(401).json({ error: 'Authentication required.', code: 'AUTHENTICATION_REQUIRED' });
    return null;
  }
  if (!actor.emailVerifiedAt) {
    response.status(403).json({ error: 'Verify your email address first.', code: 'EMAIL_VERIFICATION_REQUIRED' });
    return null;
  }
  if (!isPlatformAdmin(actor.id)) {
    response.status(403).json({ error: 'Platform administrator access is required.', code: 'PLATFORM_ADMIN_REQUIRED' });
    return null;
  }
  if (!isRootPlatformAdmin(actor.id) && !hasControlPlanePermission(actor.id, permission)) {
    response.status(403).json({ error: 'This administrator role does not grant the requested permission.',
      code: 'ADMIN_PERMISSION_REQUIRED', permission });
    return null;
  }
  return actor;
}

function platformAudit(request: Request, actor: SessionUser, input: {
  action: string;
  targetId: string;
  reason?: string;
  after?: unknown;
}) {
  const supplied = String(request.get('x-request-id') || '').trim();
  const requestId = /^[A-Za-z0-9._:-]{8,120}$/u.test(supplied) ? supplied : crypto.randomUUID();
  db.prepare(`INSERT INTO platform_audit_events
    (id,actor_user_id,actor_role,action,target_type,target_id,space_id,reason,before_json,after_json,
      request_id,ip_address,user_agent,created_at)
    VALUES (?,?,?,?,?,?,NULL,?,'{}',?,?,?,?,?)`).run(
    crypto.randomUUID(), actor.id, isRootPlatformAdmin(actor.id) ? 'superadmin' : 'admin', input.action,
    'journey_template', input.targetId, narrative(input.reason), JSON.stringify(input.after || {}), requestId,
    String(request.ip || '').slice(0, 100), String(request.get('user-agent') || '').slice(0, 500), new Date().toISOString()
  );
}

function requirePlatformPermission(permission: 'journey_templates.read' | 'journey_templates.manage') {
  return (request: Request, response: Response, next: NextFunction) => {
    const actor = platformActor(request, response, permission);
    if (!actor) return;
    response.locals.journeyTemplateActor = actor;
    next();
  };
}

function platformMutationOriginGuard(request: Request, response: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) return next();
  const origin = String(request.get('origin') || '').trim();
  if (!origin) return next();
  let expected = '';
  try { expected = new URL(config.publicUrl).origin; } catch { /* startup validation owns malformed configuration */ }
  let loopback = false;
  try {
    const parsed = new URL(origin);
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/gu, '');
    const remote = String(request.ip || request.socket.remoteAddress || '').toLowerCase();
    loopback = parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(host)
      && (remote === '::1' || remote === '127.0.0.1' || remote.startsWith('::ffff:127.'))
      && [`http://127.0.0.1:${config.port}`, `http://localhost:${config.port}`, `http://[::1]:${config.port}`]
        .includes(parsed.origin);
  } catch { /* rejected below */ }
  if ((!expected || origin !== expected) && !loopback) {
    return response.status(403).json({ error: 'Cross-origin administration requests are not allowed.',
      code: 'ADMIN_ORIGIN_REJECTED' });
  }
  return next();
}

export const platformJourneyTemplateRouter = express.Router();
platformJourneyTemplateRouter.use((_request, response, next) => {
  response.setHeader('Cache-Control', 'private, no-store');
  next();
});
platformJourneyTemplateRouter.use(platformMutationOriginGuard);

platformJourneyTemplateRouter.get('/', requirePlatformPermission('journey_templates.read'), (_request, response) => {
  return response.json({ templates: listSystemJourneyTemplatesForAdmin() });
});

platformJourneyTemplateRouter.get('/:templateId/audit', requirePlatformPermission('journey_templates.read'),
  (request, response) => {
    try {
      const query = auditQuerySchema.parse(request.query);
      return response.json(listJourneyTemplateAuditEvents({
        templateId: String(request.params.templateId), scope: 'system', spaceId: null,
        limit: query.limit, before: query.before
      }));
    } catch (error) { return sendError(response, error); }
  });

platformJourneyTemplateRouter.get('/:templateId/versions/:versionId', requirePlatformPermission('journey_templates.read'),
  (request, response) => {
    try {
      return response.json({ templateVersion: previewSystemJourneyTemplateForAdmin(String(request.params.templateId),
        String(request.params.versionId)) });
    } catch (error) { return sendError(response, error); }
  });

platformJourneyTemplateRouter.post('/', requirePlatformPermission('journey_templates.manage'), (request, response) => {
  try {
    const actor = response.locals.journeyTemplateActor as SessionUser;
    const input = z.object({ key: z.string().trim().min(1).max(100).regex(keyPattern), content: contentSchema }).strict()
      .parse(request.body || {});
    const result = createGovernedJourneyTemplate({ scope: 'system', spaceId: null, key: input.key,
      content: input.content, actorUserId: actor.id });
    platformAudit(request, actor, { action: 'journey_template.created', targetId: result.id,
      after: { scope: result.scope, key: result.key, revision: result.revision, currentVersionId: result.currentVersionId } });
    return response.status(201).json(result);
  } catch (error) { return sendError(response, error); }
});

platformJourneyTemplateRouter.post('/:templateId/versions', requirePlatformPermission('journey_templates.manage'),
  (request, response) => {
    try {
      const actor = response.locals.journeyTemplateActor as SessionUser;
      const input = z.object({ expectedTemplateRevision: revisionSchema, content: contentSchema }).strict().parse(request.body || {});
      const result = createGovernedJourneyTemplateVersion({ templateId: String(request.params.templateId), scope: 'system',
        spaceId: null, expectedTemplateRevision: input.expectedTemplateRevision, content: input.content, actorUserId: actor.id });
      platformAudit(request, actor, { action: 'journey_template.version_created', targetId: String(request.params.templateId),
        after: { revision: result.revision, currentVersionId: result.currentVersionId } });
      return response.status(201).json(result);
    } catch (error) { return sendError(response, error); }
  });

platformJourneyTemplateRouter.put('/:templateId/versions/:versionId', requirePlatformPermission('journey_templates.manage'),
  (request, response) => {
    try {
      const actor = response.locals.journeyTemplateActor as SessionUser;
      const input = z.object({ expectedTemplateRevision: revisionSchema, expectedVersionRevision: revisionSchema,
        content: contentSchema }).strict().parse(request.body || {});
      const result = updateGovernedJourneyTemplateDraft({ templateId: String(request.params.templateId),
        versionId: String(request.params.versionId), scope: 'system', spaceId: null,
        expectedTemplateRevision: input.expectedTemplateRevision, expectedVersionRevision: input.expectedVersionRevision,
        content: input.content, actorUserId: actor.id });
      platformAudit(request, actor, { action: 'journey_template.draft_updated', targetId: String(request.params.templateId),
        after: { versionId: result.id, revision: result.revision, contentChecksum: result.contentChecksum } });
      return response.json(result);
    } catch (error) { return sendError(response, error); }
  });

platformJourneyTemplateRouter.post('/:templateId/versions/:versionId/review',
  requirePlatformPermission('journey_templates.manage'), (request, response) => {
    try {
      const actor = response.locals.journeyTemplateActor as SessionUser;
      const input = versionMutationSchema.extend({ reason: z.string().trim().min(3).max(1_000) }).parse(request.body || {});
      const result = submitSystemJourneyTemplateForReview({ templateId: String(request.params.templateId),
        versionId: String(request.params.versionId), expectedTemplateRevision: input.expectedTemplateRevision,
        expectedVersionRevision: input.expectedVersionRevision, actorUserId: actor.id, reason: input.reason });
      platformAudit(request, actor, { action: 'journey_template.submitted_for_review',
        targetId: String(request.params.templateId), reason: input.reason,
        after: { versionId: result.id, state: result.state, revision: result.revision } });
      return response.json(result);
    } catch (error) { return sendError(response, error); }
  });

platformJourneyTemplateRouter.post('/:templateId/versions/:versionId/reject',
  requirePlatformPermission('journey_templates.manage'), (request, response) => {
    try {
      const actor = response.locals.journeyTemplateActor as SessionUser;
      const input = versionMutationSchema.extend({ reason: z.string().trim().min(3).max(1_000) }).parse(request.body || {});
      const result = rejectSystemJourneyTemplateReview({ templateId: String(request.params.templateId),
        versionId: String(request.params.versionId), expectedTemplateRevision: input.expectedTemplateRevision,
        expectedVersionRevision: input.expectedVersionRevision, actorUserId: actor.id, reason: input.reason });
      platformAudit(request, actor, { action: 'journey_template.review_rejected',
        targetId: String(request.params.templateId), reason: input.reason,
        after: { versionId: result.id, state: result.state, revision: result.revision } });
      return response.json(result);
    } catch (error) { return sendError(response, error); }
  });

platformJourneyTemplateRouter.post('/:templateId/versions/:versionId/publish',
  requirePlatformPermission('journey_templates.manage'), (request, response) => {
    try {
      const actor = response.locals.journeyTemplateActor as SessionUser;
      const input = versionMutationSchema.extend({ reason: z.string().trim().min(3).max(1_000) }).parse(request.body || {});
      const result = publishGovernedJourneyTemplateVersion({ templateId: String(request.params.templateId),
        versionId: String(request.params.versionId), scope: 'system', spaceId: null,
        expectedTemplateRevision: input.expectedTemplateRevision, expectedVersionRevision: input.expectedVersionRevision,
        actorUserId: actor.id, reason: input.reason });
      platformAudit(request, actor, { action: 'journey_template.published', targetId: String(request.params.templateId),
        reason: input.reason,
        after: { revision: result.revision, publishedVersionId: result.publishedVersionId, status: result.status } });
      return response.json(result);
    } catch (error) { return sendError(response, error); }
  });

platformJourneyTemplateRouter.post('/:templateId/versions/:versionId/retire',
  requirePlatformPermission('journey_templates.manage'), (request, response) => {
    try {
      const actor = response.locals.journeyTemplateActor as SessionUser;
      const input = versionMutationSchema.extend({ reason: z.string().trim().min(3).max(1_000) }).parse(request.body || {});
      const result = retireGovernedJourneyTemplateVersion({ templateId: String(request.params.templateId),
        versionId: String(request.params.versionId), scope: 'system', spaceId: null,
        expectedTemplateRevision: input.expectedTemplateRevision, expectedVersionRevision: input.expectedVersionRevision,
        actorUserId: actor.id, reason: input.reason });
      platformAudit(request, actor, { action: 'journey_template.retired', targetId: String(request.params.templateId),
        reason: input.reason,
        after: { revision: result.revision, publishedVersionId: result.publishedVersionId, status: result.status } });
      return response.json(result);
    } catch (error) { return sendError(response, error); }
  });
