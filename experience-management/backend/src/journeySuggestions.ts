import crypto from 'node:crypto';
import {
  db
} from './database.js';
import {
  deterministicJourneyId, isCustomJourneyLane, isJourneyLaneKey, journeyCardId, journeyCustomLaneKey,
  journeyLaneId, journeyMapLimits, journeyStageId, journeyStageKey, journeyVersionId,
  validateJourneyStructure
} from './journeyDomain.js';
import { getEvidenceLinkSource, getJourneyMap, JourneyMapError, type JourneyMapReadModel } from './journeyMaps.js';
import {
  journeySuggestionResult, type JourneySuggestionCandidate, type JourneySuggestionProviderResult
} from './journeySuggestionSchemas.js';
import { assertSubscriptionFeature } from './subscriptionEntitlements.js';
import { isDatabaseConstraintError } from './databaseAdapter.js';

export const JOURNEY_SUGGESTION_SCHEMA_VERSION = 1;
export const JOURNEY_SUGGESTION_PROMPT_VERSION = 'journey-suggestion-review-v1';

export type JourneySuggestionRunState =
  | 'queued' | 'generating' | 'review' | 'ready_to_apply' | 'applied' | 'dismissed' | 'superseded' | 'failed';
export type JourneySuggestionDecision = 'accepted' | 'rejected';

export class JourneySuggestionError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = 'JOURNEY_SUGGESTION_INVALID',
    public details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'JourneySuggestionError';
  }
}

function ensureSqliteSchema() {
  if (db.provider !== 'sqlite') return;
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS journey_definitions_tenant_identity
      ON journey_definitions(id,space_id);
    CREATE UNIQUE INDEX IF NOT EXISTS journey_map_versions_tenant_identity
      ON journey_map_versions(id,definition_id,space_id);
    CREATE UNIQUE INDEX IF NOT EXISTS journey_ai_suggestion_jobs_tenant_identity
      ON ai_jobs(id,space_id);

    CREATE TABLE IF NOT EXISTS journey_ai_suggestion_runs (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE RESTRICT,
      definition_id TEXT NOT NULL,
      base_version_id TEXT NOT NULL,
      base_definition_revision INTEGER NOT NULL CHECK(base_definition_revision>=1),
      base_map_checksum TEXT NOT NULL CHECK(length(base_map_checksum)=64),
      requested_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      ai_job_id TEXT,
      state TEXT NOT NULL CHECK(state IN ('queued','generating','review','ready_to_apply','applied','dismissed','superseded','failed')),
      focus TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      warning_codes_json TEXT NOT NULL DEFAULT '[]',
      runtime_json TEXT,
      prompt_contract_version TEXT NOT NULL,
      change_schema_version INTEGER NOT NULL CHECK(change_schema_version>=1),
      selected_evidence_checksum TEXT NOT NULL CHECK(length(selected_evidence_checksum)=64),
      selected_evidence_count INTEGER NOT NULL CHECK(selected_evidence_count>=0 AND selected_evidence_count<=20),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
      applied_version_id TEXT,
      failure_code TEXT,
      created_at TEXT NOT NULL,
      generation_started_at TEXT,
      completed_at TEXT,
      applied_at TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(id,space_id),
      FOREIGN KEY(definition_id,space_id) REFERENCES journey_definitions(id,space_id) ON DELETE RESTRICT,
      FOREIGN KEY(base_version_id,definition_id,space_id)
        REFERENCES journey_map_versions(id,definition_id,space_id) ON DELETE RESTRICT,
      FOREIGN KEY(applied_version_id,definition_id,space_id)
        REFERENCES journey_map_versions(id,definition_id,space_id) ON DELETE RESTRICT,
      FOREIGN KEY(ai_job_id,space_id) REFERENCES ai_jobs(id,space_id) ON DELETE RESTRICT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS journey_ai_suggestion_runs_one_active
      ON journey_ai_suggestion_runs(space_id,definition_id)
      WHERE state IN ('queued','generating','review','ready_to_apply');
    CREATE INDEX IF NOT EXISTS journey_ai_suggestion_runs_definition
      ON journey_ai_suggestion_runs(space_id,definition_id,created_at DESC,id DESC);

    CREATE TABLE IF NOT EXISTS journey_ai_suggestion_evidence (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE RESTRICT,
      evidence_link_id TEXT NOT NULL,
      target_type TEXT NOT NULL CHECK(target_type IN ('definition','stage','card')),
      target_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      source_label TEXT NOT NULL DEFAULT '',
      excerpt TEXT NOT NULL DEFAULT '',
      population TEXT NOT NULL DEFAULT '',
      sample_size INTEGER,
      collected_at TEXT,
      window_start TEXT,
      window_end TEXT,
      source_updated_at TEXT,
      source_fingerprint TEXT NOT NULL CHECK(length(source_fingerprint)=64),
      assessment TEXT NOT NULL CHECK(assessment IN ('supports','contradicts','neutral')),
      prompt_injection_suspected INTEGER NOT NULL DEFAULT 0 CHECK(prompt_injection_suspected IN (0,1)),
      selected_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      UNIQUE(run_id,evidence_link_id),
      UNIQUE(run_id,source_type,source_ref),
      UNIQUE(id,run_id,space_id),
      FOREIGN KEY(run_id,space_id) REFERENCES journey_ai_suggestion_runs(id,space_id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS journey_ai_suggestion_evidence_run
      ON journey_ai_suggestion_evidence(run_id,source_type,source_ref,id);

    CREATE TABLE IF NOT EXISTS journey_ai_suggestion_changes (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE RESTRICT,
      ordinal INTEGER NOT NULL CHECK(ordinal>=0 AND ordinal<30),
      operation TEXT NOT NULL CHECK(operation IN ('stage.add','stage.update','lane.add','lane.update','card.add','card.update')),
      target_type TEXT NOT NULL CHECK(target_type IN ('stage','lane','card')),
      target_ref TEXT NOT NULL,
      before_json TEXT NOT NULL,
      after_json TEXT NOT NULL,
      rationale TEXT NOT NULL,
      evidence_refs_json TEXT NOT NULL DEFAULT '[]',
      warning_codes_json TEXT NOT NULL DEFAULT '[]',
      change_checksum TEXT NOT NULL CHECK(length(change_checksum)=64),
      created_at TEXT NOT NULL,
      UNIQUE(run_id,ordinal),
      UNIQUE(run_id,change_checksum),
      UNIQUE(id,run_id,space_id),
      FOREIGN KEY(run_id,space_id) REFERENCES journey_ai_suggestion_runs(id,space_id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS journey_ai_suggestion_changes_run
      ON journey_ai_suggestion_changes(run_id,ordinal,id);

    CREATE TABLE IF NOT EXISTS journey_ai_suggestion_decisions (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      change_id TEXT NOT NULL,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE RESTRICT,
      sequence INTEGER NOT NULL CHECK(sequence>=1),
      decision TEXT NOT NULL CHECK(decision IN ('accepted','rejected')),
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(change_id,sequence),
      FOREIGN KEY(run_id,space_id) REFERENCES journey_ai_suggestion_runs(id,space_id) ON DELETE RESTRICT,
      FOREIGN KEY(change_id,run_id,space_id)
        REFERENCES journey_ai_suggestion_changes(id,run_id,space_id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS journey_ai_suggestion_decisions_run
      ON journey_ai_suggestion_decisions(run_id,change_id,sequence DESC);

    CREATE TABLE IF NOT EXISTS journey_ai_suggestion_audit_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      change_id TEXT,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE RESTRICT,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL CHECK(action IN ('run.created','run.generation_started','run.generated','run.failed','change.reviewed','run.applied','run.dismissed')),
      detail_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY(run_id,space_id) REFERENCES journey_ai_suggestion_runs(id,space_id) ON DELETE RESTRICT,
      FOREIGN KEY(change_id,run_id,space_id)
        REFERENCES journey_ai_suggestion_changes(id,run_id,space_id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS journey_ai_suggestion_audit_run
      ON journey_ai_suggestion_audit_events(run_id,created_at,id);

    CREATE TABLE IF NOT EXISTS journey_ai_suggestion_purge_receipts (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL CHECK(scope IN ('definition','space')),
      space_hash TEXT NOT NULL CHECK(length(space_hash)=64),
      definition_hash TEXT,
      change_ticket_hash TEXT NOT NULL CHECK(length(change_ticket_hash)=64),
      reason_code TEXT NOT NULL CHECK(reason_code IN ('privacy_erasure','retention_expiry','legal_order')),
      deleted_counts_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS journey_ai_suggestion_purge_receipts_created
      ON journey_ai_suggestion_purge_receipts(created_at,id);

    CREATE TRIGGER IF NOT EXISTS journey_ai_suggestion_evidence_no_update
      BEFORE UPDATE ON journey_ai_suggestion_evidence BEGIN SELECT RAISE(ABORT,'journey suggestion evidence is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS journey_ai_suggestion_evidence_no_delete
      BEFORE DELETE ON journey_ai_suggestion_evidence BEGIN SELECT RAISE(ABORT,'journey suggestion evidence is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS journey_ai_suggestion_changes_no_update
      BEFORE UPDATE ON journey_ai_suggestion_changes BEGIN SELECT RAISE(ABORT,'journey suggestion changes are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS journey_ai_suggestion_changes_no_delete
      BEFORE DELETE ON journey_ai_suggestion_changes BEGIN SELECT RAISE(ABORT,'journey suggestion changes are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS journey_ai_suggestion_decisions_no_update
      BEFORE UPDATE ON journey_ai_suggestion_decisions BEGIN SELECT RAISE(ABORT,'journey suggestion decisions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS journey_ai_suggestion_decisions_no_delete
      BEFORE DELETE ON journey_ai_suggestion_decisions BEGIN SELECT RAISE(ABORT,'journey suggestion decisions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS journey_ai_suggestion_audit_no_update
      BEFORE UPDATE ON journey_ai_suggestion_audit_events BEGIN SELECT RAISE(ABORT,'journey suggestion audit is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS journey_ai_suggestion_audit_no_delete
      BEFORE DELETE ON journey_ai_suggestion_audit_events BEGIN SELECT RAISE(ABORT,'journey suggestion audit is immutable'); END;
  `);
}

ensureSqliteSchema();

function parseJson<T>(value: unknown, fallback: T): T {
  if (value && typeof value === 'object') return value as T;
  try { return value ? JSON.parse(String(value)) as T : fallback; } catch { return fallback; }
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stable(item)]));
}

function hash(value: unknown) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function nowIso() { return new Date().toISOString(); }
function bounded(value: unknown, maximum: number) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, maximum);
}
function focusKey(value: unknown) { return bounded(value, 2_000).toLocaleLowerCase('en-US'); }

function mapChecksum(map: JourneyMapReadModel) {
  return hash({
    definition: { id: map.definition.id, revision: map.definition.revision, currentVersionId: map.definition.currentVersionId },
    version: { id: map.version.id, number: map.version.versionNumber, state: map.version.state },
    stages: map.stages.map(({ stageKey, name, goal, description, ordinal }) => ({ stageKey, name, goal, description, ordinal })),
    lanes: map.lanes.map(({ laneType, title, description, ordinal, visible }) => ({ laneType, title, description, ordinal, visible })),
    cards: map.cards.map(({ id, stageKey, laneType, kind, title, content, ordinal, status }) =>
      ({ id, stageKey, laneType, kind, title, content, ordinal, status }))
  });
}

function injectionSuspected(value: string) {
  return /(?:ignore|disregard|override)\s+(?:all\s+)?(?:previous|prior|system)|(?:system|developer)\s+(?:message|prompt)|<\/?(?:system|assistant|tool)>|(?:execute|call)\s+(?:a\s+)?tool/iu.test(value);
}

function audit(input: {
  runId: string; spaceId: string; actorUserId?: string | null; changeId?: string | null;
  action: 'run.created' | 'run.generation_started' | 'run.generated' | 'run.failed' | 'change.reviewed'
    | 'run.applied' | 'run.dismissed';
  detail?: Record<string, unknown>;
}) {
  db.prepare(`INSERT INTO journey_ai_suggestion_audit_events
    (id,run_id,change_id,space_id,actor_user_id,action,detail_json,created_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(crypto.randomUUID(), input.runId, input.changeId || null, input.spaceId, input.actorUserId || null,
      input.action, JSON.stringify(input.detail || {}), nowIso());
}

type EvidenceSnapshot = {
  id: string; linkId: string; targetType: 'definition' | 'stage' | 'card'; targetId: string;
  sourceType: string; sourceRef: string; sourceLabel: string; excerpt: string; population: string;
  sampleSize: number | null; collectedAt: string | null; windowStart: string | null; windowEnd: string | null;
  sourceUpdatedAt: string | null; sourceFingerprint: string; assessment: 'supports' | 'contradicts' | 'neutral';
  promptInjectionSuspected: boolean;
};

function selectedEvidence(spaceId: string, definitionId: string, versionId: string, userId: string, linkIds: string[]) {
  const result: EvidenceSnapshot[] = [];
  for (const linkId of [...new Set(linkIds)]) {
    const link = db.prepare(`SELECT link.* FROM journey_evidence_links link
      WHERE link.id=? AND link.space_id=? AND (
        (link.target_type='definition' AND link.target_id=?) OR
        (link.target_type='stage' AND EXISTS (SELECT 1 FROM journey_map_stages stage
          WHERE stage.id=link.target_id AND stage.version_id=? AND stage.space_id=link.space_id)) OR
        (link.target_type='card' AND EXISTS (SELECT 1 FROM journey_map_cards card
          WHERE card.id=link.target_id AND card.version_id=? AND card.space_id=link.space_id))
      )`).get(linkId, spaceId, definitionId, versionId, versionId) as any;
    if (!link) throw new JourneySuggestionError('Selected evidence is not attached to this draft.', 404,
      'JOURNEY_SUGGESTION_EVIDENCE_NOT_FOUND', { evidenceLinkId: linkId });
    let source;
    try { source = getEvidenceLinkSource(spaceId, userId, linkId); }
    catch (error) {
      if (error instanceof JourneyMapError) {
        throw new JourneySuggestionError('Selected evidence is not currently accessible.', 403,
          'JOURNEY_SUGGESTION_EVIDENCE_INACCESSIBLE', { evidenceLinkId: linkId, cause: error.code });
      }
      throw error;
    }
    const canonical = {
      sourceType: source.sourceType,
      sourceRef: source.sourceRef,
      sourceLabel: source.label,
      excerpt: source.excerpt,
      population: source.population,
      sampleSize: source.sampleSize,
      collectedAt: source.collectedAt,
      windowStart: source.windowStart,
      windowEnd: source.windowEnd,
      sourceUpdatedAt: source.updatedAt
    };
    result.push({
      id: deterministicJourneyId('suggestion-evidence', linkId, hash(canonical)),
      linkId, targetType: link.target_type, targetId: link.target_id,
      ...canonical,
      sourceFingerprint: hash(canonical),
      assessment: link.assessment,
      promptInjectionSuspected: injectionSuspected(source.excerpt)
    });
  }
  const duplicateRef = result.find((item, index) => result.findIndex((other) =>
    other.sourceType === item.sourceType && other.sourceRef === item.sourceRef) !== index);
  if (duplicateRef) throw new JourneySuggestionError('Choose each evidence source once.', 409,
    'JOURNEY_SUGGESTION_EVIDENCE_DUPLICATE', { sourceRef: duplicateRef.sourceRef });
  return result.sort((left, right) => `${left.sourceType}:${left.sourceRef}`.localeCompare(`${right.sourceType}:${right.sourceRef}`));
}

export interface JourneySuggestionEvidenceOption {
  linkId: string;
  targetType: 'definition' | 'stage' | 'card';
  targetId: string;
  sourceType: string;
  sourceRef: string;
  sourceLabel: string;
  excerpt: string;
  assessment: 'supports' | 'contradicts' | 'neutral';
  promptInjectionSuspected: boolean;
}

/** Lists only evidence that is attached to the current map version and can be
 * re-authorised for the requesting user now. The generation request still
 * re-authorises and freezes the selected records inside its transaction. */
export function listJourneySuggestionEvidence(
  spaceId: string, definitionId: string, userId: string, limit = 100
): JourneySuggestionEvidenceOption[] {
  assertSubscriptionFeature(spaceId, 'journeyDesign');
  assertSubscriptionFeature(spaceId, 'journeyAi');
  const map = getJourneyMap(spaceId, definitionId, undefined, userId);
  if (!map) throw new JourneySuggestionError('Journey map not found.', 404, 'JOURNEY_MAP_NOT_FOUND');
  const rows = db.prepare(`SELECT link.id FROM journey_evidence_links link
    WHERE link.space_id=? AND link.invalidated_at IS NULL AND (
      (link.target_type='definition' AND link.target_id=?) OR
      (link.target_type='stage' AND EXISTS (SELECT 1 FROM journey_map_stages stage
        WHERE stage.id=link.target_id AND stage.version_id=? AND stage.space_id=link.space_id)) OR
      (link.target_type='card' AND EXISTS (SELECT 1 FROM journey_map_cards card
        WHERE card.id=link.target_id AND card.version_id=? AND card.space_id=link.space_id))
    ) ORDER BY link.updated_at DESC,link.id DESC LIMIT ?`)
    .all(spaceId, definitionId, map.version.id, map.version.id, Math.max(1, Math.min(200, limit))) as Array<{ id: string }>;
  const seenSources = new Set<string>();
  const options: JourneySuggestionEvidenceOption[] = [];
  for (const row of rows) {
    try {
      const item = selectedEvidence(spaceId, definitionId, map.version.id, userId, [row.id])[0];
      if (!item) continue;
      const sourceIdentity = `${item.sourceType}:${item.sourceRef}`;
      if (seenSources.has(sourceIdentity)) continue;
      seenSources.add(sourceIdentity);
      options.push({
        linkId: item.linkId, targetType: item.targetType, targetId: item.targetId,
        sourceType: item.sourceType, sourceRef: item.sourceRef, sourceLabel: item.sourceLabel,
        excerpt: item.excerpt, assessment: item.assessment,
        promptInjectionSuspected: item.promptInjectionSuspected
      });
    } catch (error) {
      if (error instanceof JourneySuggestionError && [
        'JOURNEY_SUGGESTION_EVIDENCE_NOT_FOUND', 'JOURNEY_SUGGESTION_EVIDENCE_INACCESSIBLE'
      ].includes(error.code)) continue;
      throw error;
    }
  }
  return options;
}

function activeRun(spaceId: string, definitionId: string) {
  return db.prepare(`SELECT * FROM journey_ai_suggestion_runs WHERE space_id=? AND definition_id=?
    AND state IN ('queued','generating','review','ready_to_apply') ORDER BY created_at DESC,id DESC LIMIT 1`)
    .get(spaceId, definitionId) as any;
}

export function createJourneySuggestionRun(input: {
  spaceId: string; definitionId: string; userId: string; focus?: string; evidenceLinkIds?: string[];
}) {
  assertSubscriptionFeature(input.spaceId, 'journeyDesign');
  assertSubscriptionFeature(input.spaceId, 'journeyAi');
  const map = getJourneyMap(input.spaceId, input.definitionId, undefined, input.userId);
  if (!map) throw new JourneySuggestionError('Journey map not found.', 404, 'JOURNEY_MAP_NOT_FOUND');
  if (map.version.state !== 'draft' || map.definition.currentVersionId !== map.version.id) {
    throw new JourneySuggestionError('AI suggestions can only target the current draft.', 409,
      'JOURNEY_SUGGESTION_DRAFT_REQUIRED');
  }
  const focus = bounded(input.focus, 2_000);
  const evidenceLinkIds = [...new Set(input.evidenceLinkIds || [])];
  if (evidenceLinkIds.length > 20) throw new JourneySuggestionError('Choose at most 20 evidence records.', 400,
    'JOURNEY_SUGGESTION_EVIDENCE_LIMIT');
  const evidence = selectedEvidence(input.spaceId, input.definitionId, map.version.id, input.userId, evidenceLinkIds);
  const evidenceChecksum = hash(evidence.map(({ sourceType, sourceRef, sourceFingerprint }) =>
    ({ sourceType, sourceRef, sourceFingerprint })));
  const existing = activeRun(input.spaceId, input.definitionId);
  if (existing) {
    if (existing.base_version_id === map.version.id && focusKey(existing.focus) === focusKey(focus)
      && existing.selected_evidence_checksum === evidenceChecksum) {
      return { run: getJourneySuggestionRun(input.spaceId, existing.id, input.userId), created: false };
    }
    throw new JourneySuggestionError('Another suggestion review is active for this journey.', 409,
      'JOURNEY_SUGGESTION_ACTIVE', { runId: existing.id, state: existing.state });
  }
  const now = nowIso();
  const runId = crypto.randomUUID();
  return db.transaction(() => {
    db.prepare(`INSERT INTO journey_ai_suggestion_runs
      (id,space_id,definition_id,base_version_id,base_definition_revision,base_map_checksum,requested_by_user_id,
        state,focus,prompt_contract_version,change_schema_version,selected_evidence_checksum,selected_evidence_count,
        revision,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,'queued',?,?,?,?,?,1,?,?)`).run(
      runId, input.spaceId, input.definitionId, map.version.id, map.definition.revision, mapChecksum(map), input.userId,
      focus, JOURNEY_SUGGESTION_PROMPT_VERSION, JOURNEY_SUGGESTION_SCHEMA_VERSION, evidenceChecksum, evidence.length, now, now
    );
    const insert = db.prepare(`INSERT INTO journey_ai_suggestion_evidence
      (id,run_id,space_id,evidence_link_id,target_type,target_id,source_type,source_ref,source_label,excerpt,population,
        sample_size,collected_at,window_start,window_end,source_updated_at,source_fingerprint,assessment,
        prompt_injection_suspected,selected_by_user_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const item of evidence) insert.run(
      item.id, runId, input.spaceId, item.linkId, item.targetType, item.targetId, item.sourceType, item.sourceRef,
      item.sourceLabel, item.excerpt, item.population, item.sampleSize, item.collectedAt, item.windowStart, item.windowEnd,
      item.sourceUpdatedAt, item.sourceFingerprint, item.assessment, item.promptInjectionSuspected ? 1 : 0, input.userId, now
    );
    audit({ runId, spaceId: input.spaceId, actorUserId: input.userId, action: 'run.created', detail: {
      definitionId: input.definitionId, baseVersionId: map.version.id, baseRevision: map.definition.revision,
      evidenceCount: evidence.length, evidenceChecksum
    } });
    return { run: getJourneySuggestionRun(input.spaceId, runId, input.userId), created: true };
  })();
}

export function attachJourneySuggestionJob(spaceId: string, runId: string, jobId: string) {
  const changed = db.prepare(`UPDATE journey_ai_suggestion_runs SET ai_job_id=?,updated_at=?
    WHERE id=? AND space_id=? AND state='queued' AND ai_job_id IS NULL`).run(jobId, nowIso(), runId, spaceId).changes;
  if (changed !== 1) throw new JourneySuggestionError('Suggestion run could not be linked to its AI job.', 409,
    'JOURNEY_SUGGESTION_JOB_CONFLICT');
}

function evidenceRows(runId: string, spaceId: string) {
  return (db.prepare(`SELECT * FROM journey_ai_suggestion_evidence WHERE run_id=? AND space_id=?
    ORDER BY source_type,source_ref,id`).all(runId, spaceId) as any[]).map((row): EvidenceSnapshot => ({
      id: row.id, linkId: row.evidence_link_id, targetType: row.target_type, targetId: row.target_id,
      sourceType: row.source_type, sourceRef: row.source_ref, sourceLabel: row.source_label, excerpt: row.excerpt,
      population: row.population, sampleSize: row.sample_size === null ? null : Number(row.sample_size),
      collectedAt: row.collected_at || null, windowStart: row.window_start || null, windowEnd: row.window_end || null,
      sourceUpdatedAt: row.source_updated_at || null, sourceFingerprint: row.source_fingerprint,
      assessment: row.assessment, promptInjectionSuspected: Boolean(Number(row.prompt_injection_suspected))
    }));
}

function reauthorizeEvidence(run: any, userId: string) {
  const selected = evidenceRows(run.id, run.space_id);
  for (const item of selected) {
    const current = selectedEvidence(run.space_id, run.definition_id, run.base_version_id, userId, [item.linkId])[0];
    if (!current || current.sourceFingerprint !== item.sourceFingerprint) {
      throw new JourneySuggestionError('Selected evidence changed after the suggestion was requested.', 409,
        'JOURNEY_SUGGESTION_EVIDENCE_CHANGED', { evidenceLinkId: item.linkId });
    }
  }
  return selected;
}

export function journeySuggestionExecutionInput(spaceId: string, runId: string, userId: string) {
  const run = db.prepare('SELECT * FROM journey_ai_suggestion_runs WHERE id=? AND space_id=?').get(runId, spaceId) as any;
  if (!run) throw new JourneySuggestionError('Suggestion run not found.', 404, 'JOURNEY_SUGGESTION_NOT_FOUND');
  if (run.requested_by_user_id !== userId) throw new JourneySuggestionError('Suggestion requester no longer matches the job.', 403,
    'JOURNEY_SUGGESTION_REQUESTER_MISMATCH');
  if (!['queued', 'generating'].includes(run.state)) {
    if (['review', 'ready_to_apply', 'applied'].includes(run.state)) return suggestionExecutionView(run, userId);
    throw new JourneySuggestionError('Suggestion run is not executable.', 409, 'JOURNEY_SUGGESTION_STATE');
  }
  const map = getJourneyMap(spaceId, run.definition_id, undefined, userId);
  if (!map || map.version.id !== run.base_version_id || map.definition.revision !== Number(run.base_definition_revision)
    || map.version.state !== 'draft' || mapChecksum(map) !== run.base_map_checksum) {
    db.prepare(`UPDATE journey_ai_suggestion_runs SET state='superseded',revision=revision+1,
      failure_code='base_draft_changed',completed_at=?,updated_at=? WHERE id=? AND space_id=?`)
      .run(nowIso(), nowIso(), runId, spaceId);
    throw new JourneySuggestionError('The journey changed before suggestion generation began.', 409,
      'JOURNEY_SUGGESTION_BASE_CHANGED');
  }
  const evidence = reauthorizeEvidence(run, userId);
  if (run.state === 'queued') {
    const now = nowIso();
    db.prepare(`UPDATE journey_ai_suggestion_runs SET state='generating',revision=revision+1,
      generation_started_at=?,updated_at=? WHERE id=? AND space_id=? AND state='queued'`).run(now, now, runId, spaceId);
    audit({ runId, spaceId, actorUserId: userId, action: 'run.generation_started', detail: {
      baseVersionId: run.base_version_id, evidenceCount: evidence.length
    } });
  }
  return { run: db.prepare('SELECT * FROM journey_ai_suggestion_runs WHERE id=?').get(runId), map, evidence };
}

function suggestionExecutionView(run: any, userId: string) {
  const map = getJourneyMap(run.space_id, run.definition_id, run.base_version_id, userId);
  return { run, map, evidence: evidenceRows(run.id, run.space_id) };
}

type NormalizedChange = {
  id: string; ordinal: number; operation: JourneySuggestionCandidate['operation']; targetType: 'stage' | 'lane' | 'card';
  targetRef: string; before: Record<string, unknown> | null; after: Record<string, unknown>;
  rationale: string; evidenceRefs: string[]; warningCodes: string[]; checksum: string;
};

function nonEmptyPatch(values: Array<unknown>) { return values.some((value) => value !== null); }

function normalizeChanges(run: any, map: JourneyMapReadModel, evidence: EvidenceSnapshot[], output: JourneySuggestionProviderResult) {
  const allowedRefs = new Set(evidence.map((item) => item.sourceRef));
  const evidenceByRef = new Map(evidence.map((item) => [item.sourceRef, item]));
  const stageKeys = new Set(map.stages.map((stage) => stage.stageKey));
  const laneKeys = new Set(map.lanes.map((lane) => lane.laneType));
  const cards = new Map(map.cards.map((card) => [card.id, card]));
  const targets = new Set<string>();
  const checksums = new Set<string>();
  const changes: NormalizedChange[] = [];
  for (const [ordinal, candidate] of output.changes.entries()) {
    const refs = [...new Set(candidate.evidenceRefs)];
    if (refs.length !== candidate.evidenceRefs.length || refs.some((ref) => !allowedRefs.has(ref))) {
      throw new JourneySuggestionError('The AI cited evidence outside the selected authorised set.', 422,
        'JOURNEY_SUGGESTION_REFERENCE_INVALID', { ordinal });
    }
    const warnings = new Set<string>();
    if (!refs.length) warnings.add('unsupported');
    if (refs.some((ref) => evidenceByRef.get(ref)?.assessment === 'contradicts')) warnings.add('contradictory_evidence');
    if (refs.some((ref) => evidenceByRef.get(ref)?.promptInjectionSuspected)) warnings.add('prompt_injection_suspected');
    let targetType: NormalizedChange['targetType'];
    let targetRef: string;
    let before: Record<string, unknown> | null = null;
    let after: Record<string, unknown>;
    if (candidate.operation === 'stage.add') {
      targetType = 'stage';
      let stageKey = journeyStageKey(candidate.position, candidate.name);
      for (let suffix = 2; stageKeys.has(stageKey); suffix += 1) {
        const base = journeyStageKey(candidate.position, candidate.name);
        stageKey = `${base.slice(0, Math.max(1, 96 - String(suffix).length))}-${suffix}`;
      }
      stageKeys.add(stageKey);
      targetRef = stageKey;
      after = { stageKey, name: candidate.name, goal: candidate.goal, description: candidate.description,
        ordinal: Math.min(candidate.position, stageKeys.size - 1) };
    } else if (candidate.operation === 'stage.update') {
      const stage = map.stages.find((item) => item.stageKey === candidate.stageKey);
      if (!stage) throw new JourneySuggestionError('The AI referenced an unknown stage.', 422,
        'JOURNEY_SUGGESTION_TARGET_INVALID', { ordinal, stageKey: candidate.stageKey });
      if (!nonEmptyPatch([candidate.name, candidate.goal, candidate.description])) throw new JourneySuggestionError(
        'A stage suggestion must change at least one field.', 422, 'JOURNEY_SUGGESTION_CHANGE_EMPTY', { ordinal });
      targetType = 'stage'; targetRef = stage.stageKey;
      before = { stageKey: stage.stageKey, name: stage.name, goal: stage.goal, description: stage.description, ordinal: stage.ordinal };
      after = { ...before, name: candidate.name ?? stage.name, goal: candidate.goal ?? stage.goal,
        description: candidate.description ?? stage.description };
    } else if (candidate.operation === 'lane.add') {
      targetType = 'lane';
      let laneKey = journeyCustomLaneKey(candidate.title);
      for (let suffix = 2; laneKeys.has(laneKey); suffix += 1) {
        const tail = `_${suffix}`;
        laneKey = `${journeyCustomLaneKey(candidate.title).slice(0, 63 - tail.length).replace(/[_-]+$/gu, '')}${tail}`;
      }
      laneKeys.add(laneKey); targetRef = laneKey;
      after = { laneKey, title: candidate.title, description: candidate.description,
        ordinal: Math.min(candidate.position, laneKeys.size - 1), visible: true };
    } else if (candidate.operation === 'lane.update') {
      const lane = map.lanes.find((item) => item.laneType === candidate.laneKey);
      if (!lane || !isJourneyLaneKey(candidate.laneKey)) throw new JourneySuggestionError('The AI referenced an unknown lane.', 422,
        'JOURNEY_SUGGESTION_TARGET_INVALID', { ordinal, laneKey: candidate.laneKey });
      if (!nonEmptyPatch([candidate.title, candidate.description, candidate.visible])) throw new JourneySuggestionError(
        'A lane suggestion must change at least one field.', 422, 'JOURNEY_SUGGESTION_CHANGE_EMPTY', { ordinal });
      targetType = 'lane'; targetRef = lane.laneType;
      before = { laneKey: lane.laneType, title: lane.title, description: lane.description,
        ordinal: lane.ordinal, visible: lane.visible };
      after = { ...before, title: candidate.title ?? lane.title, description: candidate.description ?? lane.description,
        visible: candidate.visible ?? lane.visible };
    } else if (candidate.operation === 'card.add') {
      if (!stageKeys.has(candidate.stageKey) || !laneKeys.has(candidate.laneKey) || !isJourneyLaneKey(candidate.laneKey)) {
        throw new JourneySuggestionError('The AI referenced an unknown card cell.', 422,
          'JOURNEY_SUGGESTION_TARGET_INVALID', { ordinal, stageKey: candidate.stageKey, laneKey: candidate.laneKey });
      }
      if (candidate.laneKey === 'stage_goal') throw new JourneySuggestionError(
        'Stage goals must be proposed as a stage update.', 422, 'JOURNEY_SUGGESTION_STAGE_GOAL_CARD', { ordinal });
      if (isCustomJourneyLane(candidate.laneKey) && candidate.kind !== 'note') throw new JourneySuggestionError(
        'Custom lanes accept note suggestions only.', 422, 'JOURNEY_SUGGESTION_CUSTOM_LANE_KIND', { ordinal });
      targetType = 'card'; targetRef = deterministicJourneyId('ai-suggestion-card', run.id, ordinal);
      after = { cardRef: targetRef, stageKey: candidate.stageKey, laneKey: candidate.laneKey, kind: candidate.kind,
        title: candidate.title, content: candidate.content, status: candidate.status, ordinal: candidate.position };
    } else {
      const card = cards.get(candidate.cardId);
      if (!card) throw new JourneySuggestionError('The AI referenced an unknown card.', 422,
        'JOURNEY_SUGGESTION_TARGET_INVALID', { ordinal, cardId: candidate.cardId });
      if (card.laneType === 'stage_goal') throw new JourneySuggestionError(
        'Stage goals must be proposed as a stage update.', 422, 'JOURNEY_SUGGESTION_STAGE_GOAL_CARD', { ordinal });
      if (!nonEmptyPatch([candidate.kind, candidate.title, candidate.content, candidate.status])) throw new JourneySuggestionError(
        'A card suggestion must change at least one field.', 422, 'JOURNEY_SUGGESTION_CHANGE_EMPTY', { ordinal });
      const kind = candidate.kind ?? card.kind;
      if (isCustomJourneyLane(card.laneType) && kind !== 'note') throw new JourneySuggestionError(
        'Custom lanes accept note suggestions only.', 422, 'JOURNEY_SUGGESTION_CUSTOM_LANE_KIND', { ordinal });
      targetType = 'card'; targetRef = card.id;
      before = { cardRef: card.id, stageKey: card.stageKey, laneKey: card.laneType, kind: card.kind,
        title: card.title, content: card.content, status: card.status, ordinal: card.ordinal };
      after = { ...before, kind, title: candidate.title ?? card.title, content: candidate.content ?? card.content,
        status: candidate.status ?? card.status };
    }
    const targetKey = `${targetType}:${targetRef}`;
    if (targets.has(targetKey)) throw new JourneySuggestionError('The AI proposed conflicting changes to one target.', 422,
      'JOURNEY_SUGGESTION_TARGET_DUPLICATE', { ordinal, targetRef });
    targets.add(targetKey);
    const canonical = { operation: candidate.operation, targetType, targetRef, before, after,
      rationale: candidate.rationale, evidenceRefs: refs, warningCodes: [...warnings].sort() };
    const checksum = hash(canonical);
    if (checksums.has(checksum)) throw new JourneySuggestionError('The AI returned a duplicate suggestion.', 422,
      'JOURNEY_SUGGESTION_CHANGE_DUPLICATE', { ordinal });
    checksums.add(checksum);
    changes.push({ id: deterministicJourneyId('suggestion-change', run.id, ordinal, checksum), ordinal,
      ...canonical, checksum });
  }
  return changes;
}

export function completeJourneySuggestionRun(input: {
  spaceId: string; runId: string; jobId: string; output: unknown; runtime: unknown;
}) {
  const parsed = journeySuggestionResult.safeParse(input.output);
  if (!parsed.success) throw new JourneySuggestionError('The AI returned an invalid suggestion change set.', 502,
    'JOURNEY_SUGGESTION_OUTPUT_INVALID', { issues: parsed.error.issues.map((issue) => issue.path.join('.')).slice(0, 20) });
  const run = db.prepare('SELECT * FROM journey_ai_suggestion_runs WHERE id=? AND space_id=?').get(input.runId, input.spaceId) as any;
  if (!run) throw new JourneySuggestionError('Suggestion run not found.', 404, 'JOURNEY_SUGGESTION_NOT_FOUND');
  if (run.ai_job_id && run.ai_job_id !== input.jobId) throw new JourneySuggestionError('Suggestion job identity changed.', 409,
    'JOURNEY_SUGGESTION_JOB_CONFLICT');
  if (['review', 'ready_to_apply', 'applied'].includes(run.state)) return getJourneySuggestionRun(input.spaceId, input.runId,
    String(run.requested_by_user_id));
  if (run.state !== 'generating') throw new JourneySuggestionError('Suggestion run is not generating.', 409,
    'JOURNEY_SUGGESTION_STATE');
  const map = getJourneyMap(input.spaceId, run.definition_id, run.base_version_id, run.requested_by_user_id);
  if (!map || map.version.state !== 'draft' || mapChecksum(map) !== run.base_map_checksum) {
    throw new JourneySuggestionError('The suggestion base draft changed during generation.', 409,
      'JOURNEY_SUGGESTION_BASE_CHANGED');
  }
  const evidence = reauthorizeEvidence(run, run.requested_by_user_id);
  const changes = normalizeChanges(run, map, evidence, parsed.data);
  const warnings = [...new Set(changes.flatMap((change) => change.warningCodes))].sort();
  const now = nowIso();
  return db.transaction(() => {
    const insert = db.prepare(`INSERT INTO journey_ai_suggestion_changes
      (id,run_id,space_id,ordinal,operation,target_type,target_ref,before_json,after_json,rationale,
        evidence_refs_json,warning_codes_json,change_checksum,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const change of changes) insert.run(
      change.id, input.runId, input.spaceId, change.ordinal, change.operation, change.targetType, change.targetRef,
      JSON.stringify(change.before), JSON.stringify(change.after), change.rationale, JSON.stringify(change.evidenceRefs),
      JSON.stringify(change.warningCodes), change.checksum, now
    );
    const updated = db.prepare(`UPDATE journey_ai_suggestion_runs SET state='review',summary=?,warning_codes_json=?,
      runtime_json=?,revision=revision+1,completed_at=?,updated_at=? WHERE id=? AND space_id=? AND state='generating'`)
      .run(parsed.data.summary, JSON.stringify(warnings), JSON.stringify(input.runtime), now, now, input.runId, input.spaceId).changes;
    if (updated !== 1) throw new JourneySuggestionError('Suggestion run changed while results were stored.', 409,
      'JOURNEY_SUGGESTION_REVISION_CONFLICT');
    audit({ runId: input.runId, spaceId: input.spaceId, actorUserId: run.requested_by_user_id,
      action: 'run.generated', detail: { jobId: input.jobId, changeCount: changes.length,
        changeSetChecksum: hash(changes.map((change) => change.checksum)), warningCodes: warnings } });
    return getJourneySuggestionRun(input.spaceId, input.runId, run.requested_by_user_id);
  })();
}

export function failJourneySuggestionRun(spaceId: string, runId: string, failureCode: string) {
  const run = db.prepare('SELECT * FROM journey_ai_suggestion_runs WHERE id=? AND space_id=?').get(runId, spaceId) as any;
  if (!run || ['applied', 'dismissed', 'failed', 'superseded'].includes(run.state)) return;
  const code = bounded(failureCode, 100).replace(/[^a-zA-Z0-9_.:-]/gu, '_') || 'generation_failed';
  const now = nowIso();
  db.transaction(() => {
    db.prepare(`UPDATE journey_ai_suggestion_runs SET state='failed',failure_code=?,revision=revision+1,
      completed_at=COALESCE(completed_at,?),updated_at=? WHERE id=? AND space_id=?`).run(code, now, now, runId, spaceId);
    audit({ runId, spaceId, actorUserId: run.requested_by_user_id, action: 'run.failed', detail: { failureCode: code } });
  })();
}

function latestDecisions(runId: string, spaceId: string) {
  const rows = db.prepare(`SELECT decision.* FROM journey_ai_suggestion_decisions decision
    WHERE decision.run_id=? AND decision.space_id=? AND decision.sequence=(
      SELECT MAX(latest.sequence) FROM journey_ai_suggestion_decisions latest WHERE latest.change_id=decision.change_id
    ) ORDER BY decision.change_id`).all(runId, spaceId) as any[];
  return new Map(rows.map((row) => [String(row.change_id), {
    id: String(row.id), decision: row.decision as JourneySuggestionDecision, sequence: Number(row.sequence),
    actorUserId: row.actor_user_id || null, reason: String(row.reason), createdAt: String(row.created_at)
  }]));
}

function changeView(row: any, decisions: Map<string, any>) {
  return {
    id: String(row.id), ordinal: Number(row.ordinal), operation: row.operation, targetType: row.target_type,
    targetRef: row.target_ref, before: parseJson(row.before_json, null), after: parseJson(row.after_json, {}),
    rationale: String(row.rationale), evidenceRefs: parseJson<string[]>(row.evidence_refs_json, []),
    warningCodes: parseJson<string[]>(row.warning_codes_json, []), changeChecksum: row.change_checksum,
    decision: decisions.get(String(row.id)) || null, createdAt: String(row.created_at)
  };
}

function runView(row: any) {
  return {
    id: String(row.id), spaceId: String(row.space_id), definitionId: String(row.definition_id),
    baseVersionId: String(row.base_version_id), baseDefinitionRevision: Number(row.base_definition_revision),
    baseMapChecksum: String(row.base_map_checksum), requestedByUserId: row.requested_by_user_id || null,
    aiJobId: row.ai_job_id || null, state: row.state as JourneySuggestionRunState, focus: String(row.focus || ''),
    summary: String(row.summary || ''), warningCodes: parseJson<string[]>(row.warning_codes_json, []),
    promptContractVersion: String(row.prompt_contract_version), changeSchemaVersion: Number(row.change_schema_version),
    selectedEvidenceChecksum: String(row.selected_evidence_checksum), selectedEvidenceCount: Number(row.selected_evidence_count),
    revision: Number(row.revision), appliedVersionId: row.applied_version_id || null, failureCode: row.failure_code || null,
    createdAt: String(row.created_at), generationStartedAt: row.generation_started_at || null,
    completedAt: row.completed_at || null, appliedAt: row.applied_at || null, updatedAt: String(row.updated_at)
  };
}

export function getJourneySuggestionRun(spaceId: string, runId: string, viewerUserId: string) {
  assertSubscriptionFeature(spaceId, 'journeyDesign');
  assertSubscriptionFeature(spaceId, 'journeyAi');
  const row = db.prepare('SELECT * FROM journey_ai_suggestion_runs WHERE id=? AND space_id=?').get(runId, spaceId) as any;
  if (!row) throw new JourneySuggestionError('Suggestion run not found.', 404, 'JOURNEY_SUGGESTION_NOT_FOUND');
  const decisions = latestDecisions(runId, spaceId);
  const changes = (db.prepare(`SELECT * FROM journey_ai_suggestion_changes WHERE run_id=? AND space_id=?
    ORDER BY ordinal,id`).all(runId, spaceId) as any[]).map((change) => changeView(change, decisions));
  const evidence = evidenceRows(runId, spaceId).map((item) => {
    try {
      const current = getEvidenceLinkSource(spaceId, viewerUserId, item.linkId);
      return { ...item, currentAccess: 'available' as const, sourceLabel: current.label, excerpt: current.excerpt,
        currentFingerprint: hash({ sourceType: current.sourceType, sourceRef: current.sourceRef, sourceLabel: current.label,
          excerpt: current.excerpt, population: current.population, sampleSize: current.sampleSize,
          collectedAt: current.collectedAt, windowStart: current.windowStart, windowEnd: current.windowEnd,
          sourceUpdatedAt: current.updatedAt }) };
    } catch {
      return { ...item, currentAccess: 'inaccessible' as const, sourceLabel: 'Evidence unavailable', excerpt: '',
        population: '', sampleSize: null, currentFingerprint: null };
    }
  });
  return { run: runView(row), changes, evidence };
}

export function listJourneySuggestionRuns(spaceId: string, definitionId: string, viewerUserId: string, limit = 20) {
  assertSubscriptionFeature(spaceId, 'journeyDesign');
  assertSubscriptionFeature(spaceId, 'journeyAi');
  if (!getJourneyMap(spaceId, definitionId, undefined, viewerUserId)) {
    throw new JourneySuggestionError('Journey map not found.', 404, 'JOURNEY_MAP_NOT_FOUND');
  }
  return (db.prepare(`SELECT * FROM journey_ai_suggestion_runs WHERE space_id=? AND definition_id=?
    ORDER BY created_at DESC,id DESC LIMIT ?`).all(spaceId, definitionId, Math.max(1, Math.min(50, limit))) as any[])
    .map(runView);
}

export function reviewJourneySuggestionChange(input: {
  spaceId: string; runId: string; changeId: string; expectedRunRevision: number;
  decision: JourneySuggestionDecision; reason: string; actorUserId: string;
}) {
  assertSubscriptionFeature(input.spaceId, 'journeyDesign');
  assertSubscriptionFeature(input.spaceId, 'journeyAi');
  const reason = bounded(input.reason, 2_000);
  if (reason.length < 3) throw new JourneySuggestionError('Record a reason for this review decision.', 400,
    'JOURNEY_SUGGESTION_DECISION_REASON_REQUIRED');
  return db.transaction(() => {
    const run = db.prepare('SELECT * FROM journey_ai_suggestion_runs WHERE id=? AND space_id=?')
      .get(input.runId, input.spaceId) as any;
    if (!run) throw new JourneySuggestionError('Suggestion run not found.', 404, 'JOURNEY_SUGGESTION_NOT_FOUND');
    if (!['review', 'ready_to_apply'].includes(run.state)) throw new JourneySuggestionError(
      'This suggestion run is not open for review.', 409, 'JOURNEY_SUGGESTION_STATE');
    if (Number(run.revision) !== input.expectedRunRevision) throw new JourneySuggestionError(
      'Suggestion review changed since it was opened.', 409, 'JOURNEY_SUGGESTION_REVISION_CONFLICT',
      { currentRevision: Number(run.revision) });
    const change = db.prepare('SELECT id FROM journey_ai_suggestion_changes WHERE id=? AND run_id=? AND space_id=?')
      .get(input.changeId, input.runId, input.spaceId);
    if (!change) throw new JourneySuggestionError('Suggestion change not found.', 404, 'JOURNEY_SUGGESTION_CHANGE_NOT_FOUND');
    const sequence = Number((db.prepare(`SELECT COALESCE(MAX(sequence),0)+1 next FROM journey_ai_suggestion_decisions
      WHERE change_id=? AND run_id=? AND space_id=?`).get(input.changeId, input.runId, input.spaceId) as any).next);
    const now = nowIso();
    db.prepare(`INSERT INTO journey_ai_suggestion_decisions
      (id,run_id,change_id,space_id,sequence,decision,actor_user_id,reason,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(crypto.randomUUID(), input.runId, input.changeId, input.spaceId, sequence, input.decision,
        input.actorUserId, reason, now);
    const total = Number((db.prepare('SELECT COUNT(*) count FROM journey_ai_suggestion_changes WHERE run_id=? AND space_id=?')
      .get(input.runId, input.spaceId) as any).count);
    const decided = Number((db.prepare(`SELECT COUNT(*) count FROM journey_ai_suggestion_changes change
      WHERE change.run_id=? AND change.space_id=? AND EXISTS (
        SELECT 1 FROM journey_ai_suggestion_decisions decision WHERE decision.change_id=change.id
      )`).get(input.runId, input.spaceId) as any).count);
    const state = total > 0 && decided === total ? 'ready_to_apply' : 'review';
    const changed = db.prepare(`UPDATE journey_ai_suggestion_runs SET state=?,revision=revision+1,updated_at=?
      WHERE id=? AND space_id=? AND revision=?`).run(state, now, input.runId, input.spaceId, input.expectedRunRevision).changes;
    if (changed !== 1) throw new JourneySuggestionError('Suggestion review changed since it was opened.', 409,
      'JOURNEY_SUGGESTION_REVISION_CONFLICT');
    audit({ runId: input.runId, spaceId: input.spaceId, actorUserId: input.actorUserId,
      changeId: input.changeId, action: 'change.reviewed', detail: { decision: input.decision, sequence } });
    return getJourneySuggestionRun(input.spaceId, input.runId, input.actorUserId);
  })();
}

type AppliedStage = {
  sourceId: string | null; stageKey: string; name: string; goal: string; description: string; ordinal: number;
};
type AppliedLane = {
  sourceId: string | null; laneKey: string; title: string; description: string; ordinal: number; visible: boolean;
};
type AppliedCard = {
  sourceId: string | null; suggestionRef: string | null; stageKey: string; laneKey: string; kind: string;
  title: string; content: string; ordinal: number; personaId: string | null;
  status: 'draft' | 'active' | 'retired'; origin: string; createdAt: string;
};

function applyPosition<Item extends { ordinal: number }>(items: Item[], item: Item, position: number) {
  const ordered = [...items].sort((left, right) => left.ordinal - right.ordinal);
  ordered.splice(Math.max(0, Math.min(position, ordered.length)), 0, item);
  for (const [ordinal, current] of ordered.entries()) current.ordinal = ordinal;
  return ordered;
}

function reindexCells(cards: AppliedCard[]) {
  const cells = new Map<string, AppliedCard[]>();
  for (const card of cards) {
    const key = `${card.stageKey}\u001f${card.laneKey}`;
    const cell = cells.get(key) || [];
    cell.push(card);
    cells.set(key, cell);
  }
  for (const cell of cells.values()) {
    cell.sort((left, right) => left.ordinal - right.ordinal ||
      String(left.sourceId || left.suggestionRef).localeCompare(String(right.sourceId || right.suggestionRef)));
    for (const [ordinal, card] of cell.entries()) card.ordinal = ordinal;
  }
}

function insertIntoCell(cards: AppliedCard[], card: AppliedCard, position: number) {
  const cell = cards.filter((item) => item.stageKey === card.stageKey && item.laneKey === card.laneKey)
    .sort((left, right) => left.ordinal - right.ordinal);
  cell.splice(Math.max(0, Math.min(position, cell.length)), 0, card);
  for (const [ordinal, item] of cell.entries()) item.ordinal = ordinal;
  cards.push(card);
}

function syncStageGoalCard(cards: AppliedCard[], stage: AppliedStage, now: string, suggestionRef: string) {
  const goalCards = cards.filter((card) => card.stageKey === stage.stageKey && card.laneKey === 'stage_goal')
    .sort((left, right) => left.ordinal - right.ordinal);
  if (!stage.goal) {
    for (const card of goalCards) cards.splice(cards.indexOf(card), 1);
    return;
  }
  const first = goalCards[0];
  if (first) {
    first.kind = 'goal'; first.title = stage.goal; first.content = ''; first.ordinal = 0;
    first.personaId = null; first.status = 'active';
    for (const duplicate of goalCards.slice(1)) cards.splice(cards.indexOf(duplicate), 1);
    return;
  }
  cards.push({ sourceId: null, suggestionRef, stageKey: stage.stageKey, laneKey: 'stage_goal', kind: 'goal',
    title: stage.goal, content: '', ordinal: 0, personaId: null, status: 'active', origin: 'ai_suggestion', createdAt: now });
}

function immutableChangeRows(runId: string, spaceId: string) {
  const decisions = latestDecisions(runId, spaceId);
  return (db.prepare(`SELECT * FROM journey_ai_suggestion_changes WHERE run_id=? AND space_id=?
    ORDER BY ordinal,id`).all(runId, spaceId) as any[]).map((row) => ({
      ...changeView(row, decisions), raw: row
    }));
}

function cloneAndApplyChanges(map: JourneyMapReadModel, changes: ReturnType<typeof immutableChangeRows>, now: string) {
  let stages: AppliedStage[] = map.stages.map((stage) => ({ sourceId: stage.id, stageKey: stage.stageKey,
    name: stage.name, goal: stage.goal, description: stage.description, ordinal: stage.ordinal }));
  let lanes: AppliedLane[] = map.lanes.map((lane) => ({ sourceId: lane.id, laneKey: lane.laneType,
    title: lane.title, description: lane.description, ordinal: lane.ordinal, visible: lane.visible }));
  const cards: AppliedCard[] = map.cards.map((card) => ({ sourceId: card.id, suggestionRef: null,
    stageKey: card.stageKey, laneKey: card.laneType, kind: card.kind, title: card.title, content: card.content,
    ordinal: card.ordinal, personaId: card.personaId, status: card.status, origin: card.origin, createdAt: card.createdAt }));

  for (const change of changes.filter((item) => item.decision?.decision === 'accepted')) {
    const after = change.after as Record<string, any>;
    if (change.operation === 'stage.add') {
      const stage: AppliedStage = { sourceId: null, stageKey: String(after.stageKey), name: String(after.name),
        goal: String(after.goal || ''), description: String(after.description || ''), ordinal: Number(after.ordinal) };
      stages = applyPosition(stages, stage, stage.ordinal);
      syncStageGoalCard(cards, stage, now, `${change.id}:stage-goal`);
    } else if (change.operation === 'stage.update') {
      const stage = stages.find((item) => item.stageKey === change.targetRef);
      if (!stage) throw new JourneySuggestionError('The accepted stage no longer exists.', 409,
        'JOURNEY_SUGGESTION_TARGET_CHANGED', { changeId: change.id });
      stage.name = String(after.name); stage.goal = String(after.goal || ''); stage.description = String(after.description || '');
      syncStageGoalCard(cards, stage, now, `${change.id}:stage-goal`);
    } else if (change.operation === 'lane.add') {
      const lane: AppliedLane = { sourceId: null, laneKey: String(after.laneKey), title: String(after.title),
        description: String(after.description || ''), ordinal: Number(after.ordinal), visible: Boolean(after.visible) };
      lanes = applyPosition(lanes, lane, lane.ordinal);
    } else if (change.operation === 'lane.update') {
      const lane = lanes.find((item) => item.laneKey === change.targetRef);
      if (!lane) throw new JourneySuggestionError('The accepted lane no longer exists.', 409,
        'JOURNEY_SUGGESTION_TARGET_CHANGED', { changeId: change.id });
      lane.title = String(after.title); lane.description = String(after.description || ''); lane.visible = Boolean(after.visible);
    } else if (change.operation === 'card.add') {
      insertIntoCell(cards, { sourceId: null, suggestionRef: change.targetRef, stageKey: String(after.stageKey),
        laneKey: String(after.laneKey), kind: String(after.kind), title: String(after.title), content: String(after.content || ''),
        ordinal: Number(after.ordinal), personaId: null, status: after.status, origin: 'ai_suggestion', createdAt: now }, Number(after.ordinal));
    } else if (change.operation === 'card.update') {
      const card = cards.find((item) => item.sourceId === change.targetRef);
      if (!card) throw new JourneySuggestionError('The accepted card no longer exists.', 409,
        'JOURNEY_SUGGESTION_TARGET_CHANGED', { changeId: change.id });
      card.kind = String(after.kind); card.title = String(after.title); card.content = String(after.content || '');
      card.status = after.status;
    }
  }
  stages.sort((left, right) => left.ordinal - right.ordinal);
  lanes.sort((left, right) => left.ordinal - right.ordinal);
  for (const [ordinal, stage] of stages.entries()) stage.ordinal = ordinal;
  for (const [ordinal, lane] of lanes.entries()) lane.ordinal = ordinal;
  reindexCells(cards);
  const issues = validateJourneyStructure({
    stages: stages.map(({ stageKey, name, ordinal }) => ({ stageKey, name, ordinal })),
    lanes: lanes.map(({ laneKey, ordinal }) => ({ laneType: laneKey, ordinal })),
    cards: cards.map(({ stageKey, laneKey, title, content }) => ({ stageKey, laneType: laneKey, title, content }))
  });
  if (issues.length) throw new JourneySuggestionError('Accepted suggestions would create an invalid journey map.', 422,
    'JOURNEY_SUGGESTION_STRUCTURE_INVALID', { issues });
  return { stages, lanes, cards };
}

function copyEvidenceLinkRows(
  spaceId: string, targetType: 'stage' | 'card', sourceTargetId: string, targetId: string,
  invalidatedAt: string | null = null
) {
  const rows = db.prepare(`SELECT * FROM journey_evidence_links WHERE space_id=? AND target_type=? AND target_id=?
    ORDER BY created_at,id`).all(spaceId, targetType, sourceTargetId) as any[];
  const insert = db.prepare(`INSERT INTO journey_evidence_links
    (id,space_id,target_type,target_id,source_type,source_ref,source_label,excerpt,assessment,confidence,population,
      sample_size,collected_at,window_start,window_end,freshness_days,source_updated_at,last_validated_at,
      invalidated_at,invalidated_reason,created_by,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(space_id,target_type,target_id,source_type,source_ref) DO NOTHING`);
  for (const row of rows) insert.run(
    deterministicJourneyId('suggestion-evidence-copy', row.id, targetId), spaceId, targetType, targetId,
    row.source_type, row.source_ref, row.source_label, row.excerpt, row.assessment, row.confidence, row.population,
    row.sample_size, row.collected_at, row.window_start, row.window_end, row.freshness_days,
    row.source_updated_at, row.last_validated_at, invalidatedAt || row.invalidated_at,
    invalidatedAt ? 'claim_changed_by_reviewed_ai_suggestion' : row.invalidated_reason,
    row.created_by, row.created_at, row.updated_at
  );
}

function attachCitedEvidence(input: {
  spaceId: string; runId: string; actorUserId: string; changes: ReturnType<typeof immutableChangeRows>;
  evidence: EvidenceSnapshot[]; stageIds: Map<string, string>; cardIds: Map<string, string>; definitionId: string; now: string;
}) {
  const byRef = new Map(input.evidence.map((item) => [item.sourceRef, item]));
  const insert = db.prepare(`INSERT INTO journey_evidence_links
    (id,space_id,target_type,target_id,source_type,source_ref,source_label,excerpt,assessment,confidence,population,
      sample_size,collected_at,window_start,window_end,freshness_days,source_updated_at,last_validated_at,
      invalidated_at,invalidated_reason,created_by,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,NULL,?,?,NULL,NULL,?,?,?)
    ON CONFLICT(space_id,target_type,target_id,source_type,source_ref) DO UPDATE SET
      source_label=excluded.source_label,excerpt=excluded.excerpt,assessment=excluded.assessment,confidence=0,
      population=excluded.population,sample_size=excluded.sample_size,collected_at=excluded.collected_at,
      window_start=excluded.window_start,window_end=excluded.window_end,source_updated_at=excluded.source_updated_at,
      last_validated_at=excluded.last_validated_at,invalidated_at=NULL,invalidated_reason=NULL,
      created_by=excluded.created_by,updated_at=excluded.updated_at`);
  for (const change of input.changes.filter((item) => item.decision?.decision === 'accepted')) {
    const targetType = change.targetType === 'lane' ? 'definition' : change.targetType;
    const targetId = change.targetType === 'stage'
      ? input.stageIds.get(change.targetRef)
      : change.targetType === 'card' ? input.cardIds.get(change.targetRef) : input.definitionId;
    if (!targetId) throw new JourneySuggestionError('An accepted suggestion evidence target could not be resolved.', 409,
      'JOURNEY_SUGGESTION_TARGET_CHANGED', { changeId: change.id });
    for (const sourceRef of change.evidenceRefs) {
      const evidence = byRef.get(sourceRef);
      if (!evidence) throw new JourneySuggestionError('Accepted suggestion evidence is no longer in the frozen set.', 409,
        'JOURNEY_SUGGESTION_REFERENCE_INVALID', { changeId: change.id, sourceRef });
      insert.run(
        deterministicJourneyId('suggestion-evidence-apply', input.runId, change.id, targetType, targetId, sourceRef),
        input.spaceId, targetType, targetId, evidence.sourceType, evidence.sourceRef, evidence.sourceLabel,
        evidence.excerpt, evidence.assessment, evidence.population, evidence.sampleSize, evidence.collectedAt,
        evidence.windowStart, evidence.windowEnd, evidence.sourceUpdatedAt, input.now, input.actorUserId,
        input.now, input.now
      );
    }
  }
}

export function applyJourneySuggestionRun(input: {
  spaceId: string; runId: string; expectedRunRevision: number; expectedDefinitionRevision: number; actorUserId: string;
}) {
  assertSubscriptionFeature(input.spaceId, 'journeyDesign');
  assertSubscriptionFeature(input.spaceId, 'journeyAi');
  return db.transaction(() => {
    const lock = db.provider === 'postgres' ? ' FOR UPDATE' : '';
    const run = db.prepare(`SELECT * FROM journey_ai_suggestion_runs WHERE id=? AND space_id=?${lock}`)
      .get(input.runId, input.spaceId) as any;
    if (!run) throw new JourneySuggestionError('Suggestion run not found.', 404, 'JOURNEY_SUGGESTION_NOT_FOUND');
    if (run.state !== 'ready_to_apply') {
      if (['applied', 'dismissed'].includes(run.state)) throw new JourneySuggestionError(
        'This suggestion review was already completed.', 409, 'JOURNEY_SUGGESTION_REVISION_CONFLICT',
        { currentRevision: Number(run.revision), state: run.state });
      throw new JourneySuggestionError('Review every change before applying this suggestion.', 409,
        'JOURNEY_SUGGESTION_REVIEW_INCOMPLETE');
    }
    if (Number(run.revision) !== input.expectedRunRevision) throw new JourneySuggestionError(
      'Suggestion review changed since it was opened.', 409, 'JOURNEY_SUGGESTION_REVISION_CONFLICT',
      { currentRevision: Number(run.revision) });
    const changes = immutableChangeRows(input.runId, input.spaceId);
    if (!changes.length || changes.some((change) => !change.decision)) throw new JourneySuggestionError(
      'Review every change before applying this suggestion.', 409, 'JOURNEY_SUGGESTION_REVIEW_INCOMPLETE');
    const accepted = changes.filter((change) => change.decision?.decision === 'accepted');
    const now = nowIso();
    if (!accepted.length) {
      const dismissed = db.prepare(`UPDATE journey_ai_suggestion_runs SET state='dismissed',revision=revision+1,
        applied_at=?,updated_at=? WHERE id=? AND space_id=? AND state='ready_to_apply' AND revision=?`)
        .run(now, now, input.runId, input.spaceId, input.expectedRunRevision).changes;
      if (dismissed !== 1) throw new JourneySuggestionError('Suggestion review changed since it was opened.', 409,
        'JOURNEY_SUGGESTION_REVISION_CONFLICT');
      audit({ runId: input.runId, spaceId: input.spaceId, actorUserId: input.actorUserId,
        action: 'run.dismissed', detail: { rejectedChangeIds: changes.map((change) => change.id) } });
      return { outcome: 'dismissed' as const,
        suggestion: getJourneySuggestionRun(input.spaceId, input.runId, input.actorUserId), map: null };
    }

    if (input.expectedDefinitionRevision !== Number(run.base_definition_revision)) throw new JourneySuggestionError(
      'The journey revision no longer matches the suggestion base.', 409, 'JOURNEY_SUGGESTION_BASE_CHANGED',
      { expectedRevision: Number(run.base_definition_revision) });
    const definition = db.prepare(`SELECT * FROM journey_definitions WHERE id=? AND space_id=?${lock}`)
      .get(run.definition_id, input.spaceId) as any;
    if (!definition || definition.current_version_id !== run.base_version_id
      || Number(definition.revision) !== Number(run.base_definition_revision)) {
      throw new JourneySuggestionError('The journey changed after suggestions were generated.', 409,
        'JOURNEY_SUGGESTION_BASE_CHANGED');
    }
    if (definition.legacy_journey_id) throw new JourneySuggestionError(
      'AI suggestion apply is unavailable while this legacy journey is in dual-write compatibility mode.', 409,
      'JOURNEY_SUGGESTION_LEGACY_DUAL_WRITE_UNSUPPORTED');
    const map = getJourneyMap(input.spaceId, run.definition_id, run.base_version_id, input.actorUserId);
    if (!map || map.version.state !== 'draft' || mapChecksum(map) !== run.base_map_checksum) {
      throw new JourneySuggestionError('The journey changed after suggestions were generated.', 409,
        'JOURNEY_SUGGESTION_BASE_CHANGED');
    }
    const evidence = reauthorizeEvidence(run, input.actorUserId);
    const applied = cloneAndApplyChanges(map, changes, now);
    const invalidatedStageRefs = new Set(accepted.filter((change) => change.operation === 'stage.update'
      && String((change.before as any)?.goal || '') !== String((change.after as any)?.goal || ''))
      .map((change) => change.targetRef));
    const invalidatedCardRefs = new Set(accepted.filter((change) => change.operation === 'card.update'
      && ['kind', 'title', 'content'].some((field) => String((change.before as any)?.[field] || '')
        !== String((change.after as any)?.[field] || ''))).map((change) => change.targetRef));
    const sourceVersion = db.prepare('SELECT * FROM journey_map_versions WHERE id=? AND definition_id=? AND space_id=?')
      .get(run.base_version_id, run.definition_id, input.spaceId) as any;
    if (!sourceVersion) throw new JourneySuggestionError('Suggestion base version not found.', 409,
      'JOURNEY_SUGGESTION_BASE_CHANGED');
    const nextNumber = Number((db.prepare(`SELECT MAX(version_number) top FROM journey_map_versions
      WHERE definition_id=? AND space_id=?`).get(run.definition_id, input.spaceId) as any)?.top || 0) + 1;
    const nextVersionId = journeyVersionId(run.definition_id, nextNumber);
    const provenance = {
      ...parseJson<Record<string, unknown>>(sourceVersion.provenance_json, {}),
      origin: 'ai_suggestion_review',
      aiSuggestionApplication: {
        runId: input.runId, baseVersionId: run.base_version_id, baseMapChecksum: run.base_map_checksum,
        promptContractVersion: run.prompt_contract_version, changeSchemaVersion: Number(run.change_schema_version),
        accepted: accepted.map((change) => ({ changeId: change.id, decisionId: change.decision.id,
          decisionSequence: change.decision.sequence, changeChecksum: change.changeChecksum })),
        rejected: changes.filter((change) => change.decision?.decision === 'rejected').map((change) => ({
          changeId: change.id, decisionId: change.decision.id, decisionSequence: change.decision.sequence,
          changeChecksum: change.changeChecksum })),
        appliedByUserId: input.actorUserId, appliedAt: now
      }
    };
    try {
      db.prepare(`INSERT INTO journey_map_versions
        (id,definition_id,space_id,version_number,schema_version,state,map_type,mode,experience_type,objective,industry,
          summary,legacy_audience,provenance_json,source_job_id,author_user_id,published_at,created_at)
        VALUES (?,?,?,?,?,'draft',?,?,?,?,?,?,?,?,?,?,NULL,?)`).run(
        nextVersionId, run.definition_id, input.spaceId, nextNumber, sourceVersion.schema_version,
        sourceVersion.map_type, sourceVersion.mode, sourceVersion.experience_type, sourceVersion.objective,
        sourceVersion.industry, sourceVersion.summary, sourceVersion.legacy_audience, JSON.stringify(provenance),
        run.ai_job_id || null, input.actorUserId, now
      );
    } catch (error) {
      if (isDatabaseConstraintError(error)) throw new JourneySuggestionError(
        'The journey changed while suggestions were being applied.', 409, 'JOURNEY_SUGGESTION_BASE_CHANGED');
      throw error;
    }

    const stageIds = new Map<string, string>();
    const insertStage = db.prepare(`INSERT INTO journey_map_stages
      (id,version_id,space_id,stage_key,name,goal,description,ordinal) VALUES (?,?,?,?,?,?,?,?)`);
    for (const stage of applied.stages) {
      const id = journeyStageId(nextVersionId, stage.stageKey);
      insertStage.run(id, nextVersionId, input.spaceId, stage.stageKey, stage.name, stage.goal, stage.description, stage.ordinal);
      stageIds.set(stage.stageKey, id);
      if (stage.sourceId) copyEvidenceLinkRows(input.spaceId, 'stage', stage.sourceId, id,
        invalidatedStageRefs.has(stage.stageKey) ? now : null);
    }
    const insertLane = db.prepare(`INSERT INTO journey_map_lanes
      (id,version_id,space_id,lane_type,title,description,ordinal,visible) VALUES (?,?,?,?,?,?,?,?)`);
    for (const lane of applied.lanes) insertLane.run(journeyLaneId(nextVersionId, lane.laneKey, lane.ordinal),
      nextVersionId, input.spaceId, lane.laneKey, lane.title, lane.description, lane.ordinal, lane.visible ? 1 : 0);

    const cardIds = new Map<string, string>();
    const insertCard = db.prepare(`INSERT INTO journey_map_cards
      (id,version_id,space_id,stage_key,lane_type,kind,title,content,ordinal,persona_id,status,origin,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const card of applied.cards) {
      const sourceRef = card.sourceId || card.suggestionRef || `${card.stageKey}:${card.laneKey}:${card.ordinal}`;
      const id = deterministicJourneyId('suggestion-version-card', nextVersionId, sourceRef);
      insertCard.run(id, nextVersionId, input.spaceId, card.stageKey, card.laneKey, card.kind, card.title, card.content,
        card.ordinal, card.personaId, card.status, card.origin, card.createdAt, now);
      if (card.sourceId) {
        cardIds.set(card.sourceId, id);
        const invalidated = invalidatedCardRefs.has(card.sourceId)
          || (card.laneKey === 'stage_goal' && invalidatedStageRefs.has(card.stageKey));
        copyEvidenceLinkRows(input.spaceId, 'card', card.sourceId, id, invalidated ? now : null);
      }
      if (card.suggestionRef) cardIds.set(card.suggestionRef, id);
    }
    attachCitedEvidence({ spaceId: input.spaceId, runId: input.runId, actorUserId: input.actorUserId,
      changes, evidence, stageIds, cardIds, definitionId: run.definition_id, now });
    const bumped = db.prepare(`UPDATE journey_definitions SET current_version_id=?,revision=revision+1,updated_at=?
      WHERE id=? AND space_id=? AND current_version_id=? AND revision=?`).run(nextVersionId, now, run.definition_id,
      input.spaceId, run.base_version_id, input.expectedDefinitionRevision).changes;
    if (bumped !== 1) throw new JourneySuggestionError('The journey changed while suggestions were being applied.', 409,
      'JOURNEY_SUGGESTION_BASE_CHANGED');
    const superseded = db.prepare(`UPDATE journey_map_versions SET state='superseded'
      WHERE id=? AND definition_id=? AND space_id=? AND state='draft'`)
      .run(run.base_version_id, run.definition_id, input.spaceId).changes;
    if (superseded !== 1) throw new JourneySuggestionError('The suggestion base is no longer the current draft.', 409,
      'JOURNEY_SUGGESTION_BASE_CHANGED');
    const completed = db.prepare(`UPDATE journey_ai_suggestion_runs SET state='applied',applied_version_id=?,
      revision=revision+1,applied_at=?,updated_at=? WHERE id=? AND space_id=? AND state='ready_to_apply' AND revision=?`)
      .run(nextVersionId, now, now, input.runId, input.spaceId, input.expectedRunRevision).changes;
    if (completed !== 1) throw new JourneySuggestionError('Suggestion review changed while it was being applied.', 409,
      'JOURNEY_SUGGESTION_REVISION_CONFLICT');
    audit({ runId: input.runId, spaceId: input.spaceId, actorUserId: input.actorUserId, action: 'run.applied', detail: {
      baseVersionId: run.base_version_id, appliedVersionId: nextVersionId,
      acceptedChangeIds: accepted.map((change) => change.id),
      rejectedChangeIds: changes.filter((change) => change.decision?.decision === 'rejected').map((change) => change.id)
    } });
    return { outcome: 'applied' as const,
      suggestion: getJourneySuggestionRun(input.spaceId, input.runId, input.actorUserId),
      map: getJourneyMap(input.spaceId, run.definition_id, nextVersionId, input.actorUserId)! };
  })();
}

export function listJourneySuggestionAudit(spaceId: string, runId: string) {
  assertSubscriptionFeature(spaceId, 'journeyDesign');
  assertSubscriptionFeature(spaceId, 'journeyAi');
  const run = db.prepare('SELECT id FROM journey_ai_suggestion_runs WHERE id=? AND space_id=?').get(runId, spaceId);
  if (!run) throw new JourneySuggestionError('Suggestion run not found.', 404, 'JOURNEY_SUGGESTION_NOT_FOUND');
  return (db.prepare(`SELECT * FROM journey_ai_suggestion_audit_events WHERE run_id=? AND space_id=?
    ORDER BY created_at,id`).all(runId, spaceId) as any[]).map((row) => ({
      id: String(row.id), runId: String(row.run_id), changeId: row.change_id || null,
      actorUserId: row.actor_user_id || null, action: String(row.action), detail: parseJson(row.detail_json, {}),
      createdAt: String(row.created_at)
  }));
}

/**
 * Deliberately not exposed through HTTP. SQLite deployments may invoke this
 * only from an offline, change-controlled privacy/retention maintenance task.
 * PostgreSQL uses the separately privileged purge function installed by the
 * runtime migration, so the normal application role never receives DELETE on
 * immutable suggestion evidence, changes, decisions, or audit events.
 */
export function purgeJourneySuggestionAuditForMaintenance(input: {
  spaceId: string;
  definitionId?: string;
  reasonCode: 'privacy_erasure' | 'retention_expiry' | 'legal_order';
  changeTicket: string;
}) {
  if (db.provider !== 'sqlite') throw new JourneySuggestionError(
    'PostgreSQL suggestion audit purges require the privileged maintenance database function.', 403,
    'JOURNEY_SUGGESTION_MAINTENANCE_ROLE_REQUIRED');
  if (process.env.JOURNEY_AUDIT_MAINTENANCE_MODE !== 'privacy-purge') throw new JourneySuggestionError(
    'Suggestion audit purge is disabled outside a controlled maintenance window.', 403,
    'JOURNEY_SUGGESTION_MAINTENANCE_DISABLED');
  const ticket = bounded(input.changeTicket, 120);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{5,119}$/u.test(ticket)) throw new JourneySuggestionError(
    'A valid change-control ticket is required for a suggestion audit purge.', 400,
    'JOURNEY_SUGGESTION_MAINTENANCE_TICKET_REQUIRED');
  const target = input.definitionId
    ? db.prepare('SELECT id FROM journey_definitions WHERE id=? AND space_id=?').get(input.definitionId, input.spaceId)
    : db.prepare('SELECT id FROM spaces WHERE id=?').get(input.spaceId);
  if (!target) throw new JourneySuggestionError('Suggestion audit purge target not found.', 404,
    'JOURNEY_SUGGESTION_MAINTENANCE_TARGET_NOT_FOUND');
  const predicate = input.definitionId ? 'space_id=? AND definition_id=?' : 'space_id=?';
  const parameters = input.definitionId ? [input.spaceId, input.definitionId] : [input.spaceId];
  const runRows = db.prepare(`SELECT id,ai_job_id FROM journey_ai_suggestion_runs WHERE ${predicate}`)
    .all(...parameters) as Array<{ id: string; ai_job_id: string | null }>;
  const runIds = runRows.map((row) => row.id);
  const jobIds = [...new Set(runRows.map((row) => row.ai_job_id).filter((value): value is string => Boolean(value)))];
  const receiptId = crypto.randomUUID();
  const now = nowIso();
  return db.transaction(() => {
    db.exec(`
      DROP TRIGGER IF EXISTS journey_ai_suggestion_evidence_no_delete;
      DROP TRIGGER IF EXISTS journey_ai_suggestion_changes_no_delete;
      DROP TRIGGER IF EXISTS journey_ai_suggestion_decisions_no_delete;
      DROP TRIGGER IF EXISTS journey_ai_suggestion_audit_no_delete;
    `);
    try {
      let auditEvents = 0; let decisions = 0; let changes = 0; let evidence = 0; let runs = 0; let aiJobs = 0;
      for (const runId of runIds) {
        auditEvents += db.prepare('DELETE FROM journey_ai_suggestion_audit_events WHERE run_id=? AND space_id=?')
          .run(runId, input.spaceId).changes;
        decisions += db.prepare('DELETE FROM journey_ai_suggestion_decisions WHERE run_id=? AND space_id=?')
          .run(runId, input.spaceId).changes;
        changes += db.prepare('DELETE FROM journey_ai_suggestion_changes WHERE run_id=? AND space_id=?')
          .run(runId, input.spaceId).changes;
        evidence += db.prepare('DELETE FROM journey_ai_suggestion_evidence WHERE run_id=? AND space_id=?')
          .run(runId, input.spaceId).changes;
        runs += db.prepare('DELETE FROM journey_ai_suggestion_runs WHERE id=? AND space_id=?')
          .run(runId, input.spaceId).changes;
      }
      for (const jobId of jobIds) aiJobs += db.prepare(`DELETE FROM ai_jobs
        WHERE id=? AND space_id=? AND kind='journey.optimize'`).run(jobId, input.spaceId).changes;
      const deletedCounts = { runs, evidence, changes, decisions, auditEvents, aiJobs };
      db.prepare(`INSERT INTO journey_ai_suggestion_purge_receipts
        (id,scope,space_hash,definition_hash,change_ticket_hash,reason_code,deleted_counts_json,created_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(receiptId, input.definitionId ? 'definition' : 'space', hash(input.spaceId),
        input.definitionId ? hash(input.definitionId) : null, hash(ticket), input.reasonCode,
        JSON.stringify(deletedCounts), now);
      return { receiptId, scope: input.definitionId ? 'definition' as const : 'space' as const, deletedCounts, createdAt: now };
    } finally {
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS journey_ai_suggestion_evidence_no_delete
          BEFORE DELETE ON journey_ai_suggestion_evidence BEGIN SELECT RAISE(ABORT,'journey suggestion evidence is immutable'); END;
        CREATE TRIGGER IF NOT EXISTS journey_ai_suggestion_changes_no_delete
          BEFORE DELETE ON journey_ai_suggestion_changes BEGIN SELECT RAISE(ABORT,'journey suggestion changes are immutable'); END;
        CREATE TRIGGER IF NOT EXISTS journey_ai_suggestion_decisions_no_delete
          BEFORE DELETE ON journey_ai_suggestion_decisions BEGIN SELECT RAISE(ABORT,'journey suggestion decisions are immutable'); END;
        CREATE TRIGGER IF NOT EXISTS journey_ai_suggestion_audit_no_delete
          BEFORE DELETE ON journey_ai_suggestion_audit_events BEGIN SELECT RAISE(ABORT,'journey suggestion audit is immutable'); END;
      `);
    }
  })();
}
