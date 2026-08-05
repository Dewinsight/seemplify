import crypto from 'node:crypto';
import { db } from './database.js';
import {
  evaluateJourneyStageRules, journeyStageRuleLimits, type JourneyRuleEvent,
  type JourneyStagePredicate, type JourneyStageRule, type JourneyStageRuleRole
} from './journeyStageRules.js';
import { assertSubscriptionFeature } from './subscriptionEntitlements.js';
import type { JourneyEventPropertyDefinition } from './journeyEventControlPlane.js';

export type JourneyStageRuleDraftInput = {
  name: string;
  journeyMapVersionId: string;
  stageKey: string;
  role: JourneyStageRuleRole;
  priority: number;
  eventName: string;
  sourceIds?: string[];
  environments?: Array<'development' | 'staging' | 'production'>;
  predicates?: JourneyStagePredicate[];
  requiredPriorEvents?: Array<{ eventName: string; withinSeconds?: number | null }>;
  excludedEventNames?: string[];
  effectiveAt?: string | null;
  expiresAt?: string | null;
};

export class JourneyStageRuleRepositoryError extends Error {
  constructor(message: string, public status: number, public code: string) {
    super(message);
    this.name = 'JourneyStageRuleRepositoryError';
  }
}

type RuleDefinitionRow = {
  id: string; space_id: string; journey_definition_id: string; name: string; revision: number | string;
  draft_version_id: string | null; published_version_id: string | null; created_by_user_id: string | null;
  created_at: string; updated_at: string;
};

type RuleVersionRow = {
  id: string; rule_definition_id: string; space_id: string; journey_definition_id: string;
  journey_map_version_id: string; stage_key: string; version_number: number | string;
  state: 'draft' | 'published' | 'retired'; role: JourneyStageRuleRole; priority: number | string;
  event_name: string; source_ids_json: string | unknown[]; environments_json: string | unknown[];
  predicates_json: string | unknown[]; required_prior_events_json: string | unknown[];
  excluded_event_names_json: string | unknown[]; effective_at: string | null; expires_at: string | null;
  revision: number | string; content_sha256: string; created_by_user_id: string | null;
  published_by_user_id: string | null; created_at: string; updated_at: string; published_at: string | null;
};

function parseArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  try { const parsed = JSON.parse(String(value || '[]')); return Array.isArray(parsed) ? parsed as T[] : []; }
  catch { return []; }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value as Record<string, unknown>)
    .sort().map((key) => [key, stableValue((value as Record<string, unknown>)[key])]));
  return value;
}

function content(input: JourneyStageRuleDraftInput) {
  return {
    journeyMapVersionId: input.journeyMapVersionId,
    stageKey: input.stageKey,
    role: input.role,
    priority: input.priority,
    eventName: input.eventName,
    sourceIds: [...new Set(input.sourceIds || [])].sort(),
    environments: [...new Set(input.environments || [])].sort(),
    predicates: input.predicates || [],
    requiredPriorEvents: input.requiredPriorEvents || [],
    excludedEventNames: [...new Set(input.excludedEventNames || [])].sort(),
    effectiveAt: input.effectiveAt || null,
    expiresAt: input.expiresAt || null
  };
}

function contentHash(input: JourneyStageRuleDraftInput) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(content(input)))).digest('hex');
}

function assertConnected(spaceId: string) {
  assertSubscriptionFeature(spaceId, 'journeyDesign');
  assertSubscriptionFeature(spaceId, 'journeyConnected');
}

function assertJourney(spaceId: string, journeyDefinitionId: string) {
  const row = db.prepare('SELECT id,published_version_id FROM journey_definitions WHERE id=? AND space_id=?')
    .get(journeyDefinitionId, spaceId) as { id: string; published_version_id: string | null } | undefined;
  if (!row) throw new JourneyStageRuleRepositoryError('Journey definition not found.', 404, 'JOURNEY_STAGE_RULE_JOURNEY_NOT_FOUND');
  return row;
}

function assertGovernedStage(spaceId: string, journeyDefinitionId: string, mapVersionId: string, stageKey: string,
  requirePublished = false) {
  const row = db.prepare(`SELECT version.id,version.state,definition.published_version_id
    FROM journey_map_versions version
    JOIN journey_definitions definition ON definition.id=version.definition_id AND definition.space_id=version.space_id
    JOIN journey_map_stages stage ON stage.version_id=version.id AND stage.space_id=version.space_id
      AND stage.stage_key=?
    WHERE version.id=? AND version.definition_id=? AND version.space_id=?`).get(
      stageKey, mapVersionId, journeyDefinitionId, spaceId
    ) as { id: string; state: string; published_version_id: string | null } | undefined;
  if (!row) throw new JourneyStageRuleRepositoryError(
    'The stage does not belong to the selected governed Journey Map version.', 400, 'JOURNEY_STAGE_RULE_STAGE_VERSION_MISMATCH'
  );
  if (requirePublished && (row.state !== 'published' || row.published_version_id !== mapVersionId)) {
    throw new JourneyStageRuleRepositoryError(
      "Rules can be published only against the journey's exact published map version.", 409,
      'JOURNEY_STAGE_RULE_MAP_NOT_PUBLISHED'
    );
  }
}

function assertSources(spaceId: string, sourceIds: string[]) {
  for (const sourceId of [...new Set(sourceIds)]) {
    const source = db.prepare('SELECT id FROM journey_event_sources WHERE id=? AND space_id=?')
      .get(sourceId, spaceId) as { id: string } | undefined;
    if (!source) throw new JourneyStageRuleRepositoryError(
      'A rule source does not belong to this space.', 400, 'JOURNEY_STAGE_RULE_SOURCE_MISMATCH'
    );
  }
}

const unsafeRulePropertyName = /(?:^|_)(?:prompt|body|content|document|transcript|password|secret|token|credential|access_token|refresh_token|email|phone|name|address|survey_response|raw_payload)(?:_|$)/u;

function scalarType(value: unknown) {
  return value === null ? 'null' : typeof value;
}

function assertPredicateCompatible(property: JourneyEventPropertyDefinition, predicate: JourneyStagePredicate) {
  if (property.dataClass !== 'operational' || unsafeRulePropertyName.test(property.name)) {
    throw new JourneyStageRuleRepositoryError(
      'Stage-rule predicates may use only explicitly operational, non-content properties.', 400,
      'JOURNEY_STAGE_RULE_PROPERTY_CLASS_FORBIDDEN'
    );
  }
  const values = predicate.operator === 'in' ? predicate.value : [predicate.value];
  if (predicate.operator === 'exists') {
    if (predicate.value !== undefined && typeof predicate.value !== 'boolean') throw new JourneyStageRuleRepositoryError(
      'An exists predicate accepts only an optional boolean value.', 400, 'JOURNEY_STAGE_RULE_PREDICATE_TYPE_MISMATCH'
    );
    return;
  }
  if (['object', 'array'].includes(property.type)) throw new JourneyStageRuleRepositoryError(
    'Object and array properties can only be tested for existence.', 400, 'JOURNEY_STAGE_RULE_PREDICATE_TYPE_MISMATCH'
  );
  if (predicate.operator === 'in' && (!Array.isArray(values) || values.length < 1 || values.length > 100)) {
    throw new JourneyStageRuleRepositoryError(
      'An in predicate requires between 1 and 100 bounded scalar values.', 400, 'JOURNEY_STAGE_RULE_PREDICATE_VALUE_INVALID'
    );
  }
  const candidates = Array.isArray(values) ? values : [];
  if (['greater_than', 'at_least', 'less_than', 'at_most'].includes(predicate.operator)
      && property.type !== 'number') throw new JourneyStageRuleRepositoryError(
    'Numeric comparison operators require a number property.', 400, 'JOURNEY_STAGE_RULE_PREDICATE_TYPE_MISMATCH'
  );
  for (const value of candidates) {
    if (value === null || scalarType(value) !== property.type
        || (typeof value === 'number' && !Number.isFinite(value))
        || (typeof value === 'string' && value.length > Math.min(500, property.maximumLength || 500))) {
      throw new JourneyStageRuleRepositoryError(
        'A predicate value is incompatible with its published operational property.', 400,
        'JOURNEY_STAGE_RULE_PREDICATE_TYPE_MISMATCH'
      );
    }
    if (property.enumValues?.length && !property.enumValues.some((item) => Object.is(item, value))) {
      throw new JourneyStageRuleRepositoryError(
        "A predicate value is outside the property's published enumeration.", 400,
        'JOURNEY_STAGE_RULE_PREDICATE_ENUM_MISMATCH'
      );
    }
  }
}

/** Freeze rule semantics to an explicit source set and the currently
 * published tracking-plan version for every source. This prevents both
 * future-source drift and predicates becoming a side-channel over personal,
 * sensitive, content, or inconsistently typed properties. */
function assertSafePublishedRule(spaceId: string, value: JourneyStageRuleDraftInput) {
  const sourceIds = [...new Set(value.sourceIds || [])].sort();
  if (!sourceIds.length) throw new JourneyStageRuleRepositoryError(
    'Publishing or simulating a rule requires an explicit non-empty source set.', 400,
    'JOURNEY_STAGE_RULE_SOURCE_SET_REQUIRED'
  );
  const schemaProperties: JourneyEventPropertyDefinition[][] = [];
  for (const sourceId of sourceIds) {
    const row = db.prepare(`SELECT source.environment,source.status,version.properties_json
      FROM journey_event_sources source
      LEFT JOIN journey_event_schemas schema ON schema.source_id=source.id AND schema.space_id=source.space_id
        AND schema.event_name=?
      LEFT JOIN journey_event_schema_versions version ON version.schema_id=schema.id AND version.source_id=source.id
        AND version.space_id=source.space_id AND version.state='published'
      WHERE source.id=? AND source.space_id=?`).get(value.eventName, sourceId, spaceId) as {
        environment: 'development' | 'staging' | 'production'; status: string; properties_json: unknown;
      } | undefined;
    if (!row || row.status !== 'active' || row.properties_json === null || row.properties_json === undefined) {
      throw new JourneyStageRuleRepositoryError(
        'Every rule source must have an active published tracking-plan version for this event.', 400,
        'JOURNEY_STAGE_RULE_TRACKING_PLAN_REQUIRED'
      );
    }
    if (value.environments?.length && !value.environments.includes(row.environment)) throw new JourneyStageRuleRepositoryError(
      'A selected source is outside the rule environment set.', 400, 'JOURNEY_STAGE_RULE_SOURCE_ENVIRONMENT_MISMATCH'
    );
    schemaProperties.push(parseArray<JourneyEventPropertyDefinition>(row.properties_json));
  }
  for (const predicate of value.predicates || []) {
    if (!/^[a-z][a-z0-9_]{0,63}$/u.test(predicate.path) || unsafeRulePropertyName.test(predicate.path)) {
      throw new JourneyStageRuleRepositoryError(
        'Rule predicate paths must be classified top-level tracking-plan properties.', 400,
        'JOURNEY_STAGE_RULE_PROPERTY_PATH_FORBIDDEN'
      );
    }
    const definitions = schemaProperties.map((properties) => properties.find((property) => property.name === predicate.path));
    if (definitions.some((property) => !property)) throw new JourneyStageRuleRepositoryError(
      'A predicate property is missing from a targeted published tracking plan.', 400,
      'JOURNEY_STAGE_RULE_PROPERTY_NOT_PUBLISHED'
    );
    const typed = definitions as JourneyEventPropertyDefinition[];
    if (typed.some((property) => property.type !== typed[0]!.type || property.dataClass !== typed[0]!.dataClass)) {
      throw new JourneyStageRuleRepositoryError(
        'A predicate property has inconsistent type or classification across rule sources.', 400,
        'JOURNEY_STAGE_RULE_PROPERTY_INCONSISTENT'
      );
    }
    for (const property of typed) assertPredicateCompatible(property, predicate);
  }
}

function rowVersion(row: RuleVersionRow) {
  return {
    id: row.id,
    ruleDefinitionId: row.rule_definition_id,
    journeyDefinitionId: row.journey_definition_id,
    journeyMapVersionId: row.journey_map_version_id,
    stageKey: row.stage_key,
    versionNumber: Number(row.version_number),
    state: row.state,
    role: row.role,
    priority: Number(row.priority),
    eventName: row.event_name,
    sourceIds: parseArray<string>(row.source_ids_json),
    environments: parseArray<Array<'development' | 'staging' | 'production'>[number]>(row.environments_json),
    predicates: parseArray<JourneyStagePredicate>(row.predicates_json),
    requiredPriorEvents: parseArray<{ eventName: string; withinSeconds?: number | null }>(row.required_prior_events_json),
    excludedEventNames: parseArray<string>(row.excluded_event_names_json),
    effectiveAt: row.effective_at,
    expiresAt: row.expires_at,
    revision: Number(row.revision),
    contentSha256: row.content_sha256,
    createdByUserId: row.created_by_user_id,
    publishedByUserId: row.published_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at
  };
}

function definitionSelect() {
  return `SELECT id,space_id,journey_definition_id,name,revision,draft_version_id,published_version_id,
    created_by_user_id,created_at,updated_at FROM journey_stage_rule_definitions`;
}

function versionSelect() { return 'SELECT * FROM journey_stage_rule_versions'; }

function rowDefinition(row: RuleDefinitionRow) {
  const versions = db.prepare(`${versionSelect()} WHERE rule_definition_id=? AND space_id=?
    ORDER BY version_number DESC`).all(row.id, row.space_id) as RuleVersionRow[];
  return {
    id: row.id, journeyDefinitionId: row.journey_definition_id, name: row.name, revision: Number(row.revision),
    draftVersionId: row.draft_version_id, publishedVersionId: row.published_version_id,
    createdByUserId: row.created_by_user_id, createdAt: row.created_at, updatedAt: row.updated_at,
    versions: versions.map(rowVersion)
  };
}

function audit(input: {
  spaceId: string; journeyDefinitionId: string; ruleDefinitionId?: string | null; ruleVersionId?: string | null;
  actorUserId: string; action: 'rule.created' | 'rule.draft_updated' | 'rule.published' | 'rule.retired' | 'rule.simulated' | 'decision.viewed';
  detail?: Record<string, unknown>; at?: string;
}) {
  db.prepare(`INSERT INTO journey_stage_rule_audit_events
    (id,space_id,journey_definition_id,rule_definition_id,rule_version_id,actor_user_id,action,detail_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
      crypto.randomUUID(), input.spaceId, input.journeyDefinitionId, input.ruleDefinitionId || null,
      input.ruleVersionId || null, input.actorUserId, input.action, JSON.stringify(input.detail || {}),
      input.at || new Date().toISOString()
    );
}

function insertVersion(input: {
  id: string; ruleDefinitionId: string; spaceId: string; journeyDefinitionId: string; versionNumber: number;
  draft: JourneyStageRuleDraftInput; actorUserId: string; at: string;
}) {
  const normalized = content(input.draft);
  db.prepare(`INSERT INTO journey_stage_rule_versions
    (id,rule_definition_id,space_id,journey_definition_id,journey_map_version_id,stage_key,version_number,
      state,role,priority,event_name,source_ids_json,environments_json,predicates_json,required_prior_events_json,
      excluded_event_names_json,effective_at,expires_at,revision,content_sha256,created_by_user_id,
      published_by_user_id,created_at,updated_at,published_at)
    VALUES (?,?,?,?,?,?,?,'draft',?,?,?,?,?,?,?,?,?,?,1,?,?,NULL,?,?,NULL)`).run(
      input.id, input.ruleDefinitionId, input.spaceId, input.journeyDefinitionId, normalized.journeyMapVersionId,
      normalized.stageKey, input.versionNumber, normalized.role, normalized.priority, normalized.eventName,
      JSON.stringify(normalized.sourceIds), JSON.stringify(normalized.environments), JSON.stringify(normalized.predicates),
      JSON.stringify(normalized.requiredPriorEvents), JSON.stringify(normalized.excludedEventNames),
      normalized.effectiveAt, normalized.expiresAt, contentHash(input.draft), input.actorUserId, input.at, input.at
    );
}

function draftInputFromVersion(row: RuleVersionRow): JourneyStageRuleDraftInput {
  return {
    name: '', journeyMapVersionId: row.journey_map_version_id, stageKey: row.stage_key, role: row.role,
    priority: Number(row.priority), eventName: row.event_name, sourceIds: parseArray(row.source_ids_json),
    environments: parseArray(row.environments_json), predicates: parseArray(row.predicates_json),
    requiredPriorEvents: parseArray(row.required_prior_events_json),
    excludedEventNames: parseArray(row.excluded_event_names_json), effectiveAt: row.effective_at, expiresAt: row.expires_at
  };
}

export function listJourneyStageRules(spaceId: string, journeyDefinitionId: string) {
  assertConnected(spaceId); assertJourney(spaceId, journeyDefinitionId);
  const rows = db.prepare(`${definitionSelect()} WHERE space_id=? AND journey_definition_id=?
    ORDER BY updated_at DESC,id`).all(spaceId, journeyDefinitionId) as RuleDefinitionRow[];
  return { rules: rows.map(rowDefinition), limits: journeyStageRuleLimits };
}

export function createJourneyStageRule(input: {
  spaceId: string; journeyDefinitionId: string; actorUserId: string; draft: JourneyStageRuleDraftInput;
}) {
  assertConnected(input.spaceId); assertJourney(input.spaceId, input.journeyDefinitionId);
  assertGovernedStage(input.spaceId, input.journeyDefinitionId, input.draft.journeyMapVersionId, input.draft.stageKey);
  assertSources(input.spaceId, input.draft.sourceIds || []);
  const count = Number((db.prepare(`SELECT COUNT(*) count FROM journey_stage_rule_definitions
    WHERE space_id=? AND journey_definition_id=?`).get(input.spaceId, input.journeyDefinitionId) as any).count);
  if (count >= journeyStageRuleLimits.rules) throw new JourneyStageRuleRepositoryError(
    'This journey has reached the stage-rule limit.', 409, 'JOURNEY_STAGE_RULE_LIMIT'
  );
  return db.transaction(() => {
    const at = new Date().toISOString(); const ruleId = crypto.randomUUID(); const versionId = crypto.randomUUID();
    db.prepare(`INSERT INTO journey_stage_rule_definitions
      (id,space_id,journey_definition_id,name,revision,draft_version_id,published_version_id,
        created_by_user_id,created_at,updated_at) VALUES (?,?,?,?,1,?,NULL,?,?,?)`).run(
        ruleId, input.spaceId, input.journeyDefinitionId, input.draft.name, versionId, input.actorUserId, at, at
      );
    insertVersion({ id: versionId, ruleDefinitionId: ruleId, spaceId: input.spaceId,
      journeyDefinitionId: input.journeyDefinitionId, versionNumber: 1, draft: input.draft,
      actorUserId: input.actorUserId, at });
    audit({ spaceId: input.spaceId, journeyDefinitionId: input.journeyDefinitionId, ruleDefinitionId: ruleId,
      ruleVersionId: versionId, actorUserId: input.actorUserId, action: 'rule.created',
      detail: { contentSha256: contentHash(input.draft) }, at });
    return rowDefinition(db.prepare(`${definitionSelect()} WHERE id=? AND space_id=?`)
      .get(ruleId, input.spaceId) as RuleDefinitionRow);
  })();
}

export function updateJourneyStageRuleDraft(input: {
  spaceId: string; journeyDefinitionId: string; ruleDefinitionId: string; actorUserId: string;
  expectedRevision: number; draft: JourneyStageRuleDraftInput;
}) {
  assertConnected(input.spaceId);
  assertGovernedStage(input.spaceId, input.journeyDefinitionId, input.draft.journeyMapVersionId, input.draft.stageKey);
  assertSources(input.spaceId, input.draft.sourceIds || []);
  return db.transaction(() => {
    const lock = db.provider === 'postgres' ? ' FOR UPDATE' : '';
    const definition = db.prepare(`${definitionSelect()} WHERE id=? AND space_id=? AND journey_definition_id=?${lock}`)
      .get(input.ruleDefinitionId, input.spaceId, input.journeyDefinitionId) as RuleDefinitionRow | undefined;
    if (!definition) throw new JourneyStageRuleRepositoryError('Stage rule not found.', 404, 'JOURNEY_STAGE_RULE_NOT_FOUND');
    if (Number(definition.revision) !== input.expectedRevision) throw new JourneyStageRuleRepositoryError(
      'The stage rule changed; refresh before saving.', 409, 'JOURNEY_STAGE_RULE_REVISION_CONFLICT'
    );
    const at = new Date().toISOString();
    let draftId = definition.draft_version_id;
    if (!draftId) {
      const published = definition.published_version_id ? db.prepare(`${versionSelect()} WHERE id=? AND rule_definition_id=?`)
        .get(definition.published_version_id, definition.id) as RuleVersionRow | undefined : undefined;
      const maxVersion = Number((db.prepare(`SELECT COALESCE(MAX(version_number),0) value FROM journey_stage_rule_versions
        WHERE rule_definition_id=?`).get(definition.id) as any).value);
      draftId = crypto.randomUUID();
      insertVersion({ id: draftId, ruleDefinitionId: definition.id, spaceId: input.spaceId,
        journeyDefinitionId: input.journeyDefinitionId, versionNumber: maxVersion + 1,
        draft: published ? { ...draftInputFromVersion(published), ...input.draft } : input.draft,
        actorUserId: input.actorUserId, at });
    } else {
      const normalized = content(input.draft);
      const changed = db.prepare(`UPDATE journey_stage_rule_versions SET journey_map_version_id=?,stage_key=?,role=?,
        priority=?,event_name=?,source_ids_json=?,environments_json=?,predicates_json=?,required_prior_events_json=?,
        excluded_event_names_json=?,effective_at=?,expires_at=?,revision=revision+1,content_sha256=?,updated_at=?
        WHERE id=? AND rule_definition_id=? AND space_id=? AND state='draft'`).run(
          normalized.journeyMapVersionId, normalized.stageKey, normalized.role, normalized.priority, normalized.eventName,
          JSON.stringify(normalized.sourceIds), JSON.stringify(normalized.environments), JSON.stringify(normalized.predicates),
          JSON.stringify(normalized.requiredPriorEvents), JSON.stringify(normalized.excludedEventNames),
          normalized.effectiveAt, normalized.expiresAt, contentHash(input.draft), at, draftId, definition.id, input.spaceId
        ).changes;
      if (changed !== 1) throw new JourneyStageRuleRepositoryError(
        'The editable rule draft is no longer available.', 409, 'JOURNEY_STAGE_RULE_DRAFT_CONFLICT'
      );
    }
    const definitionChanged = db.prepare(`UPDATE journey_stage_rule_definitions SET name=?,draft_version_id=?,revision=revision+1,updated_at=?
      WHERE id=? AND space_id=? AND revision=?`).run(
        input.draft.name, draftId, at, definition.id, input.spaceId, input.expectedRevision
      ).changes;
    if (definitionChanged !== 1) throw new JourneyStageRuleRepositoryError(
      'The stage rule changed before its draft could be saved.', 409, 'JOURNEY_STAGE_RULE_REVISION_CONFLICT'
    );
    audit({ spaceId: input.spaceId, journeyDefinitionId: input.journeyDefinitionId,
      ruleDefinitionId: definition.id, ruleVersionId: draftId, actorUserId: input.actorUserId,
      action: 'rule.draft_updated', detail: { contentSha256: contentHash(input.draft) }, at });
    return rowDefinition(db.prepare(`${definitionSelect()} WHERE id=? AND space_id=?`)
      .get(definition.id, input.spaceId) as RuleDefinitionRow);
  })();
}

export function publishJourneyStageRule(input: {
  spaceId: string; journeyDefinitionId: string; ruleDefinitionId: string; actorUserId: string;
  expectedRevision: number;
}) {
  assertConnected(input.spaceId);
  return db.transaction(() => {
    const lock = db.provider === 'postgres' ? ' FOR UPDATE' : '';
    const definition = db.prepare(`${definitionSelect()} WHERE id=? AND space_id=? AND journey_definition_id=?${lock}`)
      .get(input.ruleDefinitionId, input.spaceId, input.journeyDefinitionId) as RuleDefinitionRow | undefined;
    if (!definition) throw new JourneyStageRuleRepositoryError('Stage rule not found.', 404, 'JOURNEY_STAGE_RULE_NOT_FOUND');
    if (Number(definition.revision) !== input.expectedRevision) throw new JourneyStageRuleRepositoryError(
      'The stage rule changed; refresh before publishing.', 409, 'JOURNEY_STAGE_RULE_REVISION_CONFLICT'
    );
    if (!definition.draft_version_id) {
      if (definition.published_version_id) return { rule: rowDefinition(definition), replayed: true };
      throw new JourneyStageRuleRepositoryError('The stage rule has no draft to publish.', 409, 'JOURNEY_STAGE_RULE_DRAFT_REQUIRED');
    }
    const draft = db.prepare(`${versionSelect()} WHERE id=? AND rule_definition_id=? AND state='draft'${lock}`)
      .get(definition.draft_version_id, definition.id) as RuleVersionRow | undefined;
    if (!draft) throw new JourneyStageRuleRepositoryError('The rule draft is unavailable.', 409, 'JOURNEY_STAGE_RULE_DRAFT_CONFLICT');
    assertSafePublishedRule(input.spaceId, { ...draftInputFromVersion(draft), name: definition.name });
    assertGovernedStage(input.spaceId, input.journeyDefinitionId, draft.journey_map_version_id, draft.stage_key, true);
    assertSources(input.spaceId, parseArray<string>(draft.source_ids_json));
    const at = new Date().toISOString();
    if (definition.published_version_id) {
      db.prepare(`UPDATE journey_stage_rule_versions SET state='retired',updated_at=?
        WHERE id=? AND rule_definition_id=? AND state='published'`).run(at, definition.published_version_id, definition.id);
      audit({ spaceId: input.spaceId, journeyDefinitionId: input.journeyDefinitionId,
        ruleDefinitionId: definition.id, ruleVersionId: definition.published_version_id,
        actorUserId: input.actorUserId, action: 'rule.retired', at });
    }
    const published = db.prepare(`UPDATE journey_stage_rule_versions SET state='published',published_by_user_id=?,
      published_at=?,updated_at=? WHERE id=? AND rule_definition_id=? AND state='draft'`).run(
        input.actorUserId, at, at, draft.id, definition.id
      ).changes;
    if (published !== 1) throw new JourneyStageRuleRepositoryError('The rule draft changed.', 409, 'JOURNEY_STAGE_RULE_DRAFT_CONFLICT');
    const definitionChanged = db.prepare(`UPDATE journey_stage_rule_definitions SET draft_version_id=NULL,published_version_id=?,
      revision=revision+1,updated_at=? WHERE id=? AND space_id=? AND revision=?`).run(
        draft.id, at, definition.id, input.spaceId, input.expectedRevision
      ).changes;
    if (definitionChanged !== 1) throw new JourneyStageRuleRepositoryError(
      'The stage rule changed before publication committed.', 409, 'JOURNEY_STAGE_RULE_REVISION_CONFLICT'
    );
    db.prepare("UPDATE journey_definitions SET mode='connected',revision=revision+1,updated_at=? WHERE id=? AND space_id=?")
      .run(at, input.journeyDefinitionId, input.spaceId);
    audit({ spaceId: input.spaceId, journeyDefinitionId: input.journeyDefinitionId,
      ruleDefinitionId: definition.id, ruleVersionId: draft.id, actorUserId: input.actorUserId,
      action: 'rule.published', detail: { contentSha256: draft.content_sha256,
        journeyMapVersionId: draft.journey_map_version_id, stageKey: draft.stage_key }, at });
    const updated = db.prepare(`${definitionSelect()} WHERE id=? AND space_id=?`).get(definition.id, input.spaceId) as RuleDefinitionRow;
    return { rule: rowDefinition(updated), replayed: false };
  })();
}

export function retireJourneyStageRule(input: {
  spaceId: string; journeyDefinitionId: string; ruleDefinitionId: string; actorUserId: string;
  expectedRevision: number;
}) {
  assertConnected(input.spaceId);
  return db.transaction(() => {
    const lock = db.provider === 'postgres' ? ' FOR UPDATE' : '';
    const definition = db.prepare(`${definitionSelect()} WHERE id=? AND space_id=? AND journey_definition_id=?${lock}`)
      .get(input.ruleDefinitionId, input.spaceId, input.journeyDefinitionId) as RuleDefinitionRow | undefined;
    if (!definition) throw new JourneyStageRuleRepositoryError('Stage rule not found.', 404, 'JOURNEY_STAGE_RULE_NOT_FOUND');
    if (Number(definition.revision) !== input.expectedRevision) throw new JourneyStageRuleRepositoryError(
      'The stage rule changed; refresh before retiring it.', 409, 'JOURNEY_STAGE_RULE_REVISION_CONFLICT'
    );
    if (!definition.published_version_id) return { rule: rowDefinition(definition), replayed: true };
    const at = new Date().toISOString();
    const changed = db.prepare(`UPDATE journey_stage_rule_versions SET state='retired',updated_at=?
      WHERE id=? AND rule_definition_id=? AND state='published'`).run(
        at, definition.published_version_id, definition.id
      ).changes;
    if (changed !== 1) throw new JourneyStageRuleRepositoryError(
      'The published rule changed before it could be retired.', 409, 'JOURNEY_STAGE_RULE_PUBLISH_CONFLICT'
    );
    const definitionChanged = db.prepare(`UPDATE journey_stage_rule_definitions SET published_version_id=NULL,revision=revision+1,updated_at=?
      WHERE id=? AND space_id=? AND revision=?`).run(at, definition.id, input.spaceId, input.expectedRevision);
    if (definitionChanged.changes !== 1) throw new JourneyStageRuleRepositoryError(
      'The stage rule changed before retirement committed.', 409, 'JOURNEY_STAGE_RULE_REVISION_CONFLICT'
    );
    audit({ spaceId: input.spaceId, journeyDefinitionId: input.journeyDefinitionId,
      ruleDefinitionId: definition.id, ruleVersionId: definition.published_version_id,
      actorUserId: input.actorUserId, action: 'rule.retired', at });
    const updated = db.prepare(`${definitionSelect()} WHERE id=? AND space_id=?`).get(definition.id, input.spaceId) as RuleDefinitionRow;
    return { rule: rowDefinition(updated), replayed: false };
  })();
}

function evaluatorRule(row: RuleVersionRow, state: JourneyStageRule['state'] = row.state): JourneyStageRule {
  return {
    id: row.rule_definition_id, definitionId: row.journey_definition_id, stageKey: row.stage_key,
    version: Number(row.version_number), state, role: row.role, priority: Number(row.priority),
    eventName: row.event_name, sourceIds: parseArray(row.source_ids_json), environments: parseArray(row.environments_json),
    predicates: parseArray(row.predicates_json), requiredPriorEvents: parseArray(row.required_prior_events_json),
    excludedEventNames: parseArray(row.excluded_event_names_json), effectiveAt: row.effective_at, expiresAt: row.expires_at
  };
}

export function simulateJourneyStageRules(input: {
  spaceId: string; journeyDefinitionId: string; actorUserId: string; useDrafts: boolean;
  event: JourneyRuleEvent; history?: JourneyRuleEvent[];
}) {
  assertConnected(input.spaceId); assertJourney(input.spaceId, input.journeyDefinitionId);
  const rows = db.prepare(`${versionSelect()} WHERE space_id=? AND journey_definition_id=?
    AND state IN (${input.useDrafts ? "'draft','published'" : "'published'"})
    ORDER BY rule_definition_id,state='draft' DESC`).all(input.spaceId, input.journeyDefinitionId) as RuleVersionRow[];
  const selected = new Map<string, RuleVersionRow>();
  for (const row of rows) if (!selected.has(row.rule_definition_id)) selected.set(row.rule_definition_id, row);
  for (const row of selected.values()) assertSafePublishedRule(input.spaceId, {
    ...draftInputFromVersion(row), name: ''
  });
  const rules = [...selected.values()].map((row) => evaluatorRule(row, 'published'));
  const evaluation = evaluateJourneyStageRules(rules, input.event, (input.history || []).slice(0, journeyStageRuleLimits.history));
  audit({ spaceId: input.spaceId, journeyDefinitionId: input.journeyDefinitionId, actorUserId: input.actorUserId,
    action: 'rule.simulated', detail: { useDrafts: input.useDrafts, ruleCount: rules.length,
      matchedRuleIds: evaluation.matches.map((match) => match.ruleId) } });
  return evaluation;
}

export type PublishedJourneyStageRule = ReturnType<typeof rowVersion> & { evaluator: JourneyStageRule };

export function publishedJourneyStageRules(spaceId: string, eventName: string) {
  const rows = db.prepare(`SELECT version.* FROM journey_stage_rule_versions version
    JOIN journey_definitions journey ON journey.id=version.journey_definition_id AND journey.space_id=version.space_id
      AND journey.published_version_id=version.journey_map_version_id
    WHERE version.space_id=? AND version.state='published' AND version.event_name=?
    ORDER BY version.journey_definition_id,version.priority DESC,version.rule_definition_id`)
    .all(spaceId, eventName) as RuleVersionRow[];
  return rows.map((row) => ({ ...rowVersion(row), evaluator: evaluatorRule(row) }));
}

export function journeyStageDecisionExplain(input: {
  spaceId: string; journeyDefinitionId: string; decisionId: string; actorUserId: string;
}) {
  assertConnected(input.spaceId);
  const row = db.prepare(`SELECT id,decision_key,raw_event_id,event_id,journey_definition_id,journey_map_version_id,
    outcome,matched_rule_definition_id,matched_rule_version_id,matched_rule_version_number,stage_key,role,
    event_occurred_at,evaluated_at,is_late,is_out_of_order,rule_set_sha256,trace_json,provenance_json,
    processor,processor_version,lease_generation
    FROM journey_stage_rule_decisions WHERE id=? AND space_id=? AND journey_definition_id=?`).get(
      input.decisionId, input.spaceId, input.journeyDefinitionId
    ) as Record<string, unknown> | undefined;
  if (!row) throw new JourneyStageRuleRepositoryError('Stage decision not found.', 404, 'JOURNEY_STAGE_DECISION_NOT_FOUND');
  audit({ spaceId: input.spaceId, journeyDefinitionId: input.journeyDefinitionId,
    actorUserId: input.actorUserId, action: 'decision.viewed', detail: { decisionId: input.decisionId } });
  const storedTrace = typeof row.trace_json === 'string' ? JSON.parse(row.trace_json) : row.trace_json;
  const storedProvenance = (typeof row.provenance_json === 'string'
    ? JSON.parse(row.provenance_json) : row.provenance_json) as Record<string, any>;
  return {
    id: row.id, eventId: row.event_id,
    journeyDefinitionId: row.journey_definition_id, journeyMapVersionId: row.journey_map_version_id,
    outcome: row.outcome, matchedRuleDefinitionId: row.matched_rule_definition_id,
    matchedRuleVersionId: row.matched_rule_version_id, matchedRuleVersionNumber: row.matched_rule_version_number,
    stageKey: row.stage_key, role: row.role, eventOccurredAt: row.event_occurred_at,
    evaluatedAt: row.evaluated_at, isLate: Boolean(row.is_late), isOutOfOrder: Boolean(row.is_out_of_order),
    ruleSetSha256: row.rule_set_sha256, trace: storedTrace,
    provenance: {
      schemaVersionId: storedProvenance?.rawEvent?.schemaVersionId || null,
      sourceId: storedProvenance?.source?.id || null,
      environment: storedProvenance?.source?.environment || null,
      journeyDefinitionId: storedProvenance?.journey?.definitionId || null,
      journeyMapVersionId: storedProvenance?.journey?.mapVersionId || null,
      ruleSetSha256: storedProvenance?.ruleSetSha256 || null,
      processor: storedProvenance?.processor || row.processor,
      processorVersion: storedProvenance?.processorVersion || row.processor_version,
      subjectKind: storedProvenance?.subjectKind || null,
      eventOccurredAt: storedProvenance?.eventOccurredAt || row.event_occurred_at,
      evaluatedAt: storedProvenance?.evaluatedAt || row.evaluated_at
    },
    processor: row.processor, processorVersion: row.processor_version
  };
}
