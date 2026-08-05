import crypto from 'node:crypto';
import type { Journey } from './types.js';
import { db, getJourney, listJourneys } from './database.js';
import { convertLegacyJourney, defaultJourneyLanes, journeyMapLimits } from './journeyDomain.js';
import {
  ensureJourneyMapForLegacyJourney,
  getJourneyMap,
  journeyLegacyChecksum,
  legacyJourneyFromMap,
  reconcileJourneyMap,
  refreshJourneyMapForLegacyJourney,
  type JourneyCardMoveAffectedCellsResponse,
  type JourneyDefinitionSummary,
  type JourneyMapReadModel,
  JourneyMapError
} from './journeyMaps.js';

export type JourneyRolloutEnrollment = 'inherit' | 'included' | 'excluded';
export type JourneyRolloutOperation = 'legacy_to_v2_write' | 'v2_to_legacy_write' | 'shadow_read';
export type JourneyRolloutServedSource = 'legacy' | 'v2' | 'none';

export type JourneyRolloutSettings = {
  v2ReadEnabled: boolean;
  v2WriteEnabled: boolean;
  dualWriteEnabled: boolean;
  compareReadsEnabled: boolean;
  rolloutPercentage: number;
  forcedLegacy: boolean;
  killSwitchReference: string | null;
  killSwitchReviewAt: string | null;
};

export type JourneyPlatformRollout = JourneyRolloutSettings & {
  revision: number;
  updatedByUserId: string | null;
  reason: string;
  effectiveAt: string;
  createdAt: string;
  updatedAt: string;
};

export type JourneySpaceRollout = {
  spaceId: string;
  enrollment: JourneyRolloutEnrollment;
  v2ReadEnabled: boolean | null;
  v2WriteEnabled: boolean | null;
  dualWriteEnabled: boolean | null;
  compareReadsEnabled: boolean | null;
  rolloutPercentage: number | null;
  forcedLegacy: boolean;
  killSwitchReference: string | null;
  killSwitchReviewAt: string | null;
  revision: number;
  updatedByUserId: string | null;
  reason: string;
  effectiveAt: string;
  createdAt: string;
  updatedAt: string;
};

export type EffectiveJourneyRollout = JourneyRolloutSettings & {
  spaceId: string;
  enrollment: JourneyRolloutEnrollment;
  cohortBucket: number;
  enrolled: boolean;
  v2Read: boolean;
  v2Write: boolean;
  dualWrite: boolean;
  compareReads: boolean;
  platformRevision: number;
  spaceRevision: number | null;
  decisionCode: 'forced_legacy' | 'excluded' | 'outside_percentage' | 'eligible';
};

export type JourneyDivergenceRecord = {
  id: string;
  spaceId: string;
  journeyId: string | null;
  definitionId: string | null;
  operation: JourneyRolloutOperation;
  servedSource: JourneyRolloutServedSource;
  legacyChecksum: string | null;
  v2Checksum: string | null;
  reasonCode: string;
  detailCodes: string[];
  requestId: string | null;
  createdAt: string;
};

const defaultSettings: JourneyRolloutSettings = {
  // Preserve the already-shipped Map 2.0 behaviour. Operators can immediately
  // force legacy or reduce the cohort before enabling dual/shadow operation.
  v2ReadEnabled: true,
  v2WriteEnabled: true,
  dualWriteEnabled: false,
  compareReadsEnabled: false,
  rolloutPercentage: 100,
  forcedLegacy: false,
  killSwitchReference: null,
  killSwitchReviewAt: null
};

function ensureJourneyRolloutSqliteSchema() {
  if (db.provider !== 'sqlite') return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS journey_v2_rollout_platform (
      id TEXT PRIMARY KEY CHECK(id='platform'),
      v2_read_enabled INTEGER NOT NULL CHECK(v2_read_enabled IN (0,1)),
      v2_write_enabled INTEGER NOT NULL CHECK(v2_write_enabled IN (0,1)),
      dual_write_enabled INTEGER NOT NULL CHECK(dual_write_enabled IN (0,1)),
      compare_reads_enabled INTEGER NOT NULL CHECK(compare_reads_enabled IN (0,1)),
      rollout_percentage INTEGER NOT NULL CHECK(rollout_percentage BETWEEN 0 AND 100),
      forced_legacy INTEGER NOT NULL CHECK(forced_legacy IN (0,1)),
      kill_switch_reference TEXT,
      kill_switch_review_at TEXT,
      revision INTEGER NOT NULL CHECK(revision >= 1),
      updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      reason TEXT NOT NULL DEFAULT '',
      effective_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK(forced_legacy=0 OR (length(trim(kill_switch_reference)) BETWEEN 3 AND 200 AND kill_switch_review_at IS NOT NULL))
    );
    CREATE TABLE IF NOT EXISTS journey_v2_rollout_spaces (
      space_id TEXT PRIMARY KEY REFERENCES spaces(id) ON DELETE CASCADE,
      enrollment TEXT NOT NULL DEFAULT 'inherit' CHECK(enrollment IN ('inherit','included','excluded')),
      v2_read_enabled INTEGER CHECK(v2_read_enabled IS NULL OR v2_read_enabled IN (0,1)),
      v2_write_enabled INTEGER CHECK(v2_write_enabled IS NULL OR v2_write_enabled IN (0,1)),
      dual_write_enabled INTEGER CHECK(dual_write_enabled IS NULL OR dual_write_enabled IN (0,1)),
      compare_reads_enabled INTEGER CHECK(compare_reads_enabled IS NULL OR compare_reads_enabled IN (0,1)),
      rollout_percentage INTEGER CHECK(rollout_percentage IS NULL OR rollout_percentage BETWEEN 0 AND 100),
      forced_legacy INTEGER NOT NULL DEFAULT 0 CHECK(forced_legacy IN (0,1)),
      kill_switch_reference TEXT,
      kill_switch_review_at TEXT,
      revision INTEGER NOT NULL CHECK(revision >= 1),
      updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      reason TEXT NOT NULL,
      effective_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK(forced_legacy=0 OR (length(trim(kill_switch_reference)) BETWEEN 3 AND 200 AND kill_switch_review_at IS NOT NULL))
    );
    CREATE TABLE IF NOT EXISTS journey_v2_divergences (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      journey_id TEXT,
      definition_id TEXT,
      operation TEXT NOT NULL CHECK(operation IN ('legacy_to_v2_write','v2_to_legacy_write','shadow_read')),
      served_source TEXT NOT NULL CHECK(served_source IN ('legacy','v2','none')),
      legacy_checksum TEXT CHECK(legacy_checksum IS NULL OR (length(legacy_checksum)=64 AND legacy_checksum NOT GLOB '*[^0-9a-f]*')),
      v2_checksum TEXT CHECK(v2_checksum IS NULL OR (length(v2_checksum)=64 AND v2_checksum NOT GLOB '*[^0-9a-f]*')),
      reason_code TEXT NOT NULL CHECK(length(reason_code) BETWEEN 1 AND 100),
      detail_codes_json TEXT NOT NULL DEFAULT '[]' CHECK(length(detail_codes_json) <= 8000),
      request_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS journey_v2_rollout_spaces_enrollment
      ON journey_v2_rollout_spaces(enrollment,forced_legacy,updated_at DESC,space_id);
    CREATE INDEX IF NOT EXISTS journey_v2_divergences_space_created
      ON journey_v2_divergences(space_id,created_at DESC,id DESC);
    CREATE TRIGGER IF NOT EXISTS journey_v2_divergences_no_update
      BEFORE UPDATE ON journey_v2_divergences BEGIN SELECT RAISE(ABORT,'journey divergence records are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS journey_v2_divergences_no_delete
      BEFORE DELETE ON journey_v2_divergences BEGIN SELECT RAISE(ABORT,'journey divergence records are immutable'); END;
  `);
  const now = new Date().toISOString();
  // Development SQLite databases may have been opened by an earlier P1-03
  // build. Keep the local upgrade additive as well as the fresh schema.
  for (const table of ['journey_v2_rollout_platform', 'journey_v2_rollout_spaces']) {
    const columns = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
      .map((column) => String(column.name)));
    if (!columns.has('effective_at')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN effective_at TEXT`);
      db.prepare(`UPDATE ${table} SET effective_at=COALESCE(updated_at,created_at,?) WHERE effective_at IS NULL`).run(now);
    }
  }
  db.prepare(`INSERT INTO journey_v2_rollout_platform
    (id,v2_read_enabled,v2_write_enabled,dual_write_enabled,compare_reads_enabled,rollout_percentage,
      forced_legacy,kill_switch_reference,kill_switch_review_at,revision,updated_by_user_id,reason,effective_at,created_at,updated_at)
    VALUES ('platform',?,?,?,?,?,0,NULL,NULL,1,NULL,'initial compatibility defaults',?,?,?)
    ON CONFLICT(id) DO NOTHING`).run(
    defaultSettings.v2ReadEnabled ? 1 : 0,
    defaultSettings.v2WriteEnabled ? 1 : 0,
    defaultSettings.dualWriteEnabled ? 1 : 0,
    defaultSettings.compareReadsEnabled ? 1 : 0,
    defaultSettings.rolloutPercentage,
    now,
    now,
    now
  );
}

ensureJourneyRolloutSqliteSchema();

function bool(value: unknown) { return Boolean(Number(value)); }
function nullableBool(value: unknown) { return value === null || value === undefined ? null : bool(value); }

function platformRow(row: any): JourneyPlatformRollout {
  return {
    v2ReadEnabled: bool(row.v2_read_enabled),
    v2WriteEnabled: bool(row.v2_write_enabled),
    dualWriteEnabled: bool(row.dual_write_enabled),
    compareReadsEnabled: bool(row.compare_reads_enabled),
    rolloutPercentage: Number(row.rollout_percentage),
    forcedLegacy: bool(row.forced_legacy),
    killSwitchReference: row.kill_switch_reference || null,
    killSwitchReviewAt: row.kill_switch_review_at || null,
    revision: Number(row.revision),
    updatedByUserId: row.updated_by_user_id || null,
    reason: String(row.reason || ''),
    effectiveAt: String(row.effective_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function spaceRow(row: any): JourneySpaceRollout {
  return {
    spaceId: String(row.space_id),
    enrollment: row.enrollment as JourneyRolloutEnrollment,
    v2ReadEnabled: nullableBool(row.v2_read_enabled),
    v2WriteEnabled: nullableBool(row.v2_write_enabled),
    dualWriteEnabled: nullableBool(row.dual_write_enabled),
    compareReadsEnabled: nullableBool(row.compare_reads_enabled),
    rolloutPercentage: row.rollout_percentage === null ? null : Number(row.rollout_percentage),
    forcedLegacy: bool(row.forced_legacy),
    killSwitchReference: row.kill_switch_reference || null,
    killSwitchReviewAt: row.kill_switch_review_at || null,
    revision: Number(row.revision),
    updatedByUserId: row.updated_by_user_id || null,
    reason: String(row.reason || ''),
    effectiveAt: String(row.effective_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function getJourneyPlatformRollout(): JourneyPlatformRollout {
  const row = db.prepare("SELECT * FROM journey_v2_rollout_platform WHERE id='platform'").get() as any;
  if (!row) throw new JourneyMapError('Journey rollout defaults are unavailable.', 503, 'JOURNEY_ROLLOUT_UNAVAILABLE');
  return platformRow(row);
}

export function listJourneySpaceRollouts(): JourneySpaceRollout[] {
  return (db.prepare('SELECT * FROM journey_v2_rollout_spaces ORDER BY space_id').all() as any[]).map(spaceRow);
}

export function getJourneySpaceRollout(spaceId: string): JourneySpaceRollout | null {
  const row = db.prepare('SELECT * FROM journey_v2_rollout_spaces WHERE space_id=?').get(spaceId) as any;
  return row ? spaceRow(row) : null;
}

function cohortBucket(spaceId: string) {
  const digest = crypto.createHash('sha256').update(`journey-v2:${spaceId}`).digest();
  return digest.readUInt32BE(0) % 100;
}

export function effectiveJourneyRollout(spaceId: string): EffectiveJourneyRollout {
  const platform = getJourneyPlatformRollout();
  const space = getJourneySpaceRollout(spaceId);
  const inherited = <K extends keyof JourneyRolloutSettings>(key: K): JourneyRolloutSettings[K] => {
    const override = space?.[key as keyof JourneySpaceRollout];
    return (override === null || override === undefined ? platform[key] : override) as JourneyRolloutSettings[K];
  };
  const enrollment = space?.enrollment || 'inherit';
  const bucket = cohortBucket(spaceId);
  const percentage = inherited('rolloutPercentage');
  const enrolled = enrollment === 'included' || (enrollment === 'inherit' && bucket < percentage);
  const forcedLegacy = platform.forcedLegacy || Boolean(space?.forcedLegacy);
  const v2ReadEnabled = inherited('v2ReadEnabled');
  const v2WriteEnabled = inherited('v2WriteEnabled');
  const dualWriteEnabled = inherited('dualWriteEnabled');
  const compareReadsEnabled = inherited('compareReadsEnabled');
  const v2Read = !forcedLegacy && enrolled && v2ReadEnabled;
  const v2Write = !forcedLegacy && enrolled && v2WriteEnabled;
  const compareReads = !forcedLegacy && enrolled && compareReadsEnabled;
  return {
    spaceId,
    enrollment,
    cohortBucket: bucket,
    enrolled,
    v2Read,
    v2Write,
    dualWrite: v2Write && dualWriteEnabled,
    compareReads,
    v2ReadEnabled,
    v2WriteEnabled,
    dualWriteEnabled,
    compareReadsEnabled,
    rolloutPercentage: percentage,
    forcedLegacy,
    killSwitchReference: space?.forcedLegacy ? space.killSwitchReference : platform.killSwitchReference,
    killSwitchReviewAt: space?.forcedLegacy ? space.killSwitchReviewAt : platform.killSwitchReviewAt,
    platformRevision: platform.revision,
    spaceRevision: space?.revision || null,
    decisionCode: forcedLegacy ? 'forced_legacy' : enrollment === 'excluded' ? 'excluded'
      : !enrolled ? 'outside_percentage' : 'eligible'
  };
}

function assertKillSwitchMetadata(input: Pick<JourneyRolloutSettings, 'forcedLegacy' | 'killSwitchReference' | 'killSwitchReviewAt'>) {
  if (!input.forcedLegacy) return;
  if (!input.killSwitchReference || input.killSwitchReference.trim().length < 3) {
    throw new JourneyMapError('A forced-legacy switch requires an incident or change reference.', 400,
      'JOURNEY_KILL_SWITCH_REFERENCE_REQUIRED');
  }
  if (!input.killSwitchReviewAt || !Number.isFinite(Date.parse(input.killSwitchReviewAt))) {
    throw new JourneyMapError('A forced-legacy switch requires a review timestamp.', 400,
      'JOURNEY_KILL_SWITCH_REVIEW_REQUIRED');
  }
}

export function updateJourneyPlatformRollout(input: JourneyRolloutSettings & {
  expectedRevision: number;
  actorUserId: string;
  reason: string;
}) {
  assertKillSwitchMetadata(input);
  const now = new Date().toISOString();
  const changed = db.prepare(`UPDATE journey_v2_rollout_platform SET
      v2_read_enabled=?,v2_write_enabled=?,dual_write_enabled=?,compare_reads_enabled=?,rollout_percentage=?,
      forced_legacy=?,kill_switch_reference=?,kill_switch_review_at=?,revision=revision+1,updated_by_user_id=?,reason=?,effective_at=?,updated_at=?
    WHERE id='platform' AND revision=?`).run(
    input.v2ReadEnabled ? 1 : 0, input.v2WriteEnabled ? 1 : 0, input.dualWriteEnabled ? 1 : 0,
    input.compareReadsEnabled ? 1 : 0, input.rolloutPercentage, input.forcedLegacy ? 1 : 0,
    input.forcedLegacy ? input.killSwitchReference : null,
    input.forcedLegacy ? input.killSwitchReviewAt : null,
    input.actorUserId, input.reason, now, now, input.expectedRevision
  ).changes;
  if (changed !== 1) throw new JourneyMapError('Journey rollout defaults changed since they were opened.', 409,
    'JOURNEY_ROLLOUT_REVISION_CONFLICT');
  return getJourneyPlatformRollout();
}

export function putJourneySpaceRollout(input: Omit<JourneySpaceRollout,
  'revision' | 'updatedByUserId' | 'reason' | 'effectiveAt' | 'createdAt' | 'updatedAt'> & {
    expectedRevision: number | null;
    actorUserId: string;
    reason: string;
  }) {
  assertKillSwitchMetadata({
    forcedLegacy: input.forcedLegacy,
    killSwitchReference: input.killSwitchReference,
    killSwitchReviewAt: input.killSwitchReviewAt
  });
  const now = new Date().toISOString();
  return db.transaction(() => {
    const existing = getJourneySpaceRollout(input.spaceId);
    if (!existing && input.expectedRevision !== null) {
      throw new JourneyMapError('Journey space rollout override does not exist.', 409,
        'JOURNEY_ROLLOUT_REVISION_CONFLICT');
    }
    if (existing && input.expectedRevision !== existing.revision) {
      throw new JourneyMapError('Journey space rollout override changed since it was opened.', 409,
        'JOURNEY_ROLLOUT_REVISION_CONFLICT');
    }
    const values = [
      input.enrollment,
      input.v2ReadEnabled === null ? null : input.v2ReadEnabled ? 1 : 0,
      input.v2WriteEnabled === null ? null : input.v2WriteEnabled ? 1 : 0,
      input.dualWriteEnabled === null ? null : input.dualWriteEnabled ? 1 : 0,
      input.compareReadsEnabled === null ? null : input.compareReadsEnabled ? 1 : 0,
      input.rolloutPercentage,
      input.forcedLegacy ? 1 : 0,
      input.forcedLegacy ? input.killSwitchReference : null,
      input.forcedLegacy ? input.killSwitchReviewAt : null,
      input.actorUserId,
      input.reason,
      now,
      now
    ];
    if (!existing) {
      db.prepare(`INSERT INTO journey_v2_rollout_spaces
        (space_id,enrollment,v2_read_enabled,v2_write_enabled,dual_write_enabled,compare_reads_enabled,
          rollout_percentage,forced_legacy,kill_switch_reference,kill_switch_review_at,revision,
          updated_by_user_id,reason,effective_at,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?)`).run(input.spaceId, ...values, now);
    } else {
      const changed = db.prepare(`UPDATE journey_v2_rollout_spaces SET enrollment=?,v2_read_enabled=?,v2_write_enabled=?,
          dual_write_enabled=?,compare_reads_enabled=?,rollout_percentage=?,forced_legacy=?,kill_switch_reference=?,
          kill_switch_review_at=?,revision=revision+1,updated_by_user_id=?,reason=?,effective_at=?,updated_at=?
        WHERE space_id=? AND revision=?`).run(...values, input.spaceId, existing.revision).changes;
      if (changed !== 1) throw new JourneyMapError('Journey space rollout override changed since it was opened.', 409,
        'JOURNEY_ROLLOUT_REVISION_CONFLICT');
    }
    return getJourneySpaceRollout(input.spaceId)!;
  })();
}

export function resetJourneySpaceRollout(spaceId: string, expectedRevision: number) {
  const changed = db.prepare('DELETE FROM journey_v2_rollout_spaces WHERE space_id=? AND revision=?')
    .run(spaceId, expectedRevision).changes;
  if (changed !== 1) throw new JourneyMapError('Journey space rollout override changed since it was opened.', 409,
    'JOURNEY_ROLLOUT_REVISION_CONFLICT');
}

function safeDetailCodes(values: string[]) {
  return [...new Set(values.map((value) => String(value).replace(/[^a-zA-Z0-9_.:-]/gu, '_').slice(0, 120)))]
    .filter(Boolean).slice(0, 50);
}

export function recordJourneyDivergence(input: {
  spaceId: string;
  journeyId?: string | null;
  definitionId?: string | null;
  operation: JourneyRolloutOperation;
  servedSource: JourneyRolloutServedSource;
  legacyChecksum?: string | null;
  v2Checksum?: string | null;
  reasonCode: string;
  detailCodes?: string[];
  requestId?: string | null;
}) {
  const row = {
    id: crypto.randomUUID(),
    ...input,
    detailCodes: safeDetailCodes(input.detailCodes || []),
    reasonCode: String(input.reasonCode).replace(/[^a-zA-Z0-9_.:-]/gu, '_').slice(0, 100),
    createdAt: new Date().toISOString()
  };
  db.prepare(`INSERT INTO journey_v2_divergences
    (id,space_id,journey_id,definition_id,operation,served_source,legacy_checksum,v2_checksum,
      reason_code,detail_codes_json,request_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    row.id, row.spaceId, row.journeyId || null, row.definitionId || null, row.operation, row.servedSource,
    row.legacyChecksum || null, row.v2Checksum || null, row.reasonCode, JSON.stringify(row.detailCodes),
    row.requestId ? String(row.requestId).slice(0, 120) : null, row.createdAt
  );
  return row.id;
}

function divergenceRow(row: any): JourneyDivergenceRecord {
  let details: string[] = [];
  try {
    details = safeDetailCodes(Array.isArray(row.detail_codes_json)
      ? row.detail_codes_json
      : JSON.parse(String(row.detail_codes_json)));
  } catch { details = ['invalid_detail_codes']; }
  return {
    id: String(row.id), spaceId: String(row.space_id), journeyId: row.journey_id || null,
    definitionId: row.definition_id || null, operation: row.operation, servedSource: row.served_source,
    legacyChecksum: row.legacy_checksum || null, v2Checksum: row.v2_checksum || null,
    reasonCode: String(row.reason_code), detailCodes: details, requestId: row.request_id || null,
    createdAt: String(row.created_at)
  };
}

export function listJourneyDivergences(input: { spaceId?: string; limit?: number; before?: string } = {}) {
  const limit = Math.max(1, Math.min(200, Math.floor(input.limit || 50)));
  const where: string[] = [];
  const parameters: unknown[] = [];
  if (input.spaceId) { where.push('space_id=?'); parameters.push(input.spaceId); }
  if (input.before) { where.push('created_at<?'); parameters.push(input.before); }
  return (db.prepare(`SELECT * FROM journey_v2_divergences${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
    ORDER BY created_at DESC,id DESC LIMIT ?`).all(...parameters, limit) as any[]).map(divergenceRow);
}

function mapChecksum(map: JourneyMapReadModel) {
  return journeyLegacyChecksum(legacyJourneyFromMap(map) as unknown as Journey);
}

function compareAndRecord(spaceId: string, journey: Journey, map: JourneyMapReadModel | null,
  servedSource: JourneyRolloutServedSource, requestId?: string) {
  const legacyChecksum = journeyLegacyChecksum(journey);
  if (!map) {
    recordJourneyDivergence({ spaceId, journeyId: journey.id, operation: 'shadow_read', servedSource,
      legacyChecksum, reasonCode: 'v2_projection_missing', requestId });
    return;
  }
  const v2Checksum = mapChecksum(map);
  if (legacyChecksum === v2Checksum) return;
  const reconciliation = reconcileJourneyMap(spaceId, journey.id);
  recordJourneyDivergence({
    spaceId, journeyId: journey.id, definitionId: map.definition.id, operation: 'shadow_read', servedSource,
    legacyChecksum, v2Checksum, reasonCode: 'checksum_mismatch', detailCodes: reconciliation.differences, requestId
  });
}

/** The projection is derived lazily: `ensureJourneyMapForLegacyJourney` builds it
 * on first read and then deliberately reuses it without re-materialising. Under
 * the shipped default rollout (`v2Read` on, `dualWrite` off) a legacy write is
 * never accompanied by a projection refresh, so without this the projection stays
 * pinned to the state it was first built from and every later read serves the
 * pre-write content. The legacy `updatedAt` is the source's version token - every
 * legacy mutation advances it under optimistic concurrency, and both projection
 * builders store it on the definition row - so a mismatch means the source moved
 * on and the projection has to be re-derived before it can be served.
 *
 * A refresh rebuilds versions from V1 history alone, so it must not run while the
 * projection carries Map 2.0-only evidence, persona, or connected-data
 * relationships; that state is reported as a divergence and the stale-but-intact
 * projection is served instead of being silently rewritten.
 *
 * Only a projection that is actually being served is re-derived. A shadow read
 * exists to observe drift between the two models, so repairing it there would
 * erase the very mismatch the comparison is meant to record. */
function projectionForRead(spaceId: string, journey: Journey, serving: boolean, requestId?: string) {
  const result = ensureJourneyMapForLegacyJourney(journey, spaceId);
  if (serving && !result.created) {
    const stored = db.prepare('SELECT updated_at FROM journey_definitions WHERE id=? AND space_id=?')
      .get(result.definitionId, spaceId) as { updated_at: string } | undefined;
    if (stored && String(stored.updated_at) !== journey.updatedAt) {
      const reconciliation = reconcileJourneyMap(spaceId, journey.id);
      if (reconciliation.noFabricatedEvidence && reconciliation.noFabricatedPersonas
        && reconciliation.noFabricatedConnectedData) {
        refreshJourneyMapForLegacyJourney(journey, spaceId, { bumpRevision: true });
      } else {
        recordJourneyDivergence({
          spaceId, journeyId: journey.id, definitionId: reconciliation.definitionId, operation: 'shadow_read',
          servedSource: 'v2', legacyChecksum: reconciliation.sourceChecksum,
          v2Checksum: reconciliation.projectionChecksum, reasonCode: 'v2_extensions_block_refresh',
          detailCodes: reconciliation.differences, requestId
        });
      }
    }
  }
  return getJourneyMap(spaceId, result.definitionId);
}

/** Selects one source before comparing. A shadow mismatch is observable but
 * can never alter the response already selected by the rollout decision. */
export function readLegacyJourneyWithRollout(spaceId: string, journeyId: string, requestId?: string): Journey | null {
  const journey = getJourney(journeyId, spaceId);
  if (!journey) return null;
  const decision = effectiveJourneyRollout(spaceId);
  let map: JourneyMapReadModel | null = null;
  if (decision.v2Read || decision.compareReads) {
    try { map = projectionForRead(spaceId, journey, decision.v2Read, requestId); }
    catch (error) {
      if (decision.compareReads) {
        recordJourneyDivergence({ spaceId, journeyId, operation: 'shadow_read', servedSource: decision.v2Read ? 'v2' : 'legacy',
          legacyChecksum: journeyLegacyChecksum(journey), reasonCode: 'v2_projection_error',
          detailCodes: [(error as { code?: string }).code || 'projection_error'], requestId });
      }
      if (decision.v2Read) throw error;
    }
  }
  const served = decision.v2Read
    ? (map ? legacyJourneyFromMap(map) as unknown as Journey : null)
    : journey;
  if (!served) throw new JourneyMapError('The selected Journey Map 2.0 projection is unavailable.', 503,
    'JOURNEY_V2_PROJECTION_UNAVAILABLE');
  if (decision.compareReads) compareAndRecord(spaceId, journey, map, decision.v2Read ? 'v2' : 'legacy', requestId);
  return served;
}

export function listLegacyJourneysWithRollout(spaceId: string, requestId?: string) {
  return listJourneys(spaceId).map((journey) => readLegacyJourneyWithRollout(spaceId, journey.id, requestId)!).filter(Boolean);
}

export function canReadJourneyDefinition(spaceId: string, definition: JourneyDefinitionSummary) {
  return !definition.legacyJourneyId || effectiveJourneyRollout(spaceId).v2Read;
}

export function assertJourneyDefinitionReadAllowed(spaceId: string, map: JourneyMapReadModel) {
  if (map.definition.legacyJourneyId && !effectiveJourneyRollout(spaceId).v2Read) {
    throw new JourneyMapError('Journey Map 2.0 reads are disabled for this space.', 404, 'JOURNEY_V2_READ_DISABLED');
  }
}

function assertLegacyProjectionClean(spaceId: string, journeyId: string) {
  const reconciliation = reconcileJourneyMap(spaceId, journeyId);
  if (!reconciliation.matched) {
    throw new JourneyMapError('Dual-write requires a reconciled legacy projection.', 409,
      'JOURNEY_DUAL_WRITE_PRECONDITION_FAILED', { differences: reconciliation.differences });
  }
  if (!reconciliation.noFabricatedEvidence || !reconciliation.noFabricatedPersonas || !reconciliation.noFabricatedConnectedData) {
    throw new JourneyMapError('Dual-write cannot rewrite a legacy projection with Map 2.0-only relationships.', 409,
      'JOURNEY_DUAL_WRITE_EXTENSIONS_PRESENT');
  }
}

/** Wrap a legacy mutation in the same database transaction as its derived V2
 * projection. The projection is regenerated solely from retained source
 * history; it does not invoke the V2 mutation API or manufacture evidence. */
export function runLegacyJourneyWrite<T>(input: {
  spaceId: string;
  journeyId: string | null;
  operation: () => T;
  requestId?: string;
  deleting?: boolean;
  journeyFromResult?: (result: T) => Journey | null;
}) {
  const decision = effectiveJourneyRollout(input.spaceId);
  if (!decision.dualWrite) return input.operation();
  return db.transaction(() => {
    if (input.journeyId && !input.deleting) {
      const before = getJourney(input.journeyId, input.spaceId);
      if (before) {
        ensureJourneyMapForLegacyJourney(before, input.spaceId);
        assertLegacyProjectionClean(input.spaceId, input.journeyId);
      }
    }
    const result = input.operation();
    if (input.deleting) return result;
    const source = input.journeyFromResult
      ? input.journeyFromResult(result)
      : (result && typeof result === 'object' && 'id' in result && 'stages' in result
        ? result as unknown as Journey : null);
    if (!source) return result;
    refreshJourneyMapForLegacyJourney(source, input.spaceId, { bumpRevision: true });
    const reconciliation = reconcileJourneyMap(input.spaceId, source.id);
    if (!reconciliation.matched) {
      recordJourneyDivergence({
        spaceId: input.spaceId, journeyId: source.id, definitionId: reconciliation.definitionId,
        operation: 'legacy_to_v2_write', servedSource: 'none', legacyChecksum: reconciliation.sourceChecksum,
        v2Checksum: reconciliation.projectionChecksum, reasonCode: 'post_write_mismatch',
        detailCodes: reconciliation.differences, requestId: input.requestId
      });
      throw new JourneyMapError('Legacy and Journey Map 2.0 writes diverged.', 409, 'JOURNEY_DUAL_WRITE_DIVERGED');
    }
    return result;
  })();
}

function assertMapLegacyCompatible(map: JourneyMapReadModel) {
  const expectedLanes = defaultJourneyLanes.filter((lane) => !lane.blueprintOnly);
  const builtIn = new Set(expectedLanes.map((lane) => lane.laneType));
  if (map.definition.status !== 'draft' || map.version.state !== 'draft' || map.definition.publishedVersionId
    || map.personas.length > 0 || map.definition.evidenceLinkCount > 0
    || map.lanes.length !== builtIn.size || map.lanes.some((lane, index) => {
      const expected = expectedLanes[index];
      return !expected || lane.laneType !== expected.laneType || lane.title !== expected.title
        || lane.description !== expected.description || lane.ordinal !== expected.ordinal || !lane.visible;
    })) {
    throw new JourneyMapError('This Map 2.0 structure cannot be represented by the legacy journey model.', 422,
      'JOURNEY_DUAL_WRITE_NOT_LEGACY_COMPATIBLE');
  }
  if (map.stages.some((stage) => stage.description) || map.cards.some((card) => card.personaId
    || card.status === 'retired' || !builtIn.has(card.laneType))) {
    throw new JourneyMapError('This Map 2.0 edit contains fields that the legacy journey model cannot preserve.', 422,
      'JOURNEY_DUAL_WRITE_NOT_LEGACY_COMPATIBLE');
  }
  const rendered = legacyJourneyFromMap(map) as unknown as Journey;
  const canonical = convertLegacyJourney(rendered, map.version.versionNumber);
  const stageIndex = new Map(map.stages.map((stage, index) => [stage.stageKey, index]));
  const canonicalStageIndex = new Map(canonical.stages.map((stage, index) => [stage.stageKey, index]));
  const stageShape = map.stages.map((stage) => ({ name: stage.name, goal: stage.goal, description: stage.description,
    ordinal: stage.ordinal }));
  const canonicalStageShape = canonical.stages.map((stage) => ({ name: stage.name, goal: stage.goal,
    description: stage.description, ordinal: stage.ordinal }));
  const cardShape = map.cards.map((card) => ({
    stage: stageIndex.get(card.stageKey), laneType: card.laneType, kind: card.kind, title: card.title,
    content: card.content, ordinal: card.ordinal, status: card.status
  })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const canonicalCardShape = canonical.cards.map((card) => ({
    stage: canonicalStageIndex.get(card.stageKey), laneType: card.laneType, kind: card.kind, title: card.title,
    content: card.content, ordinal: card.ordinal, status: card.status
  })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  if (JSON.stringify(stageShape) !== JSON.stringify(canonicalStageShape)
    || JSON.stringify(cardShape) !== JSON.stringify(canonicalCardShape)) {
    throw new JourneyMapError('This Map 2.0 edit would lose information in the legacy journey model.', 422,
      'JOURNEY_DUAL_WRITE_NOT_LEGACY_COMPATIBLE');
  }
}

/** V2 mutation wrapper. When dual-write is active for a legacy-backed map, the
 * mutated compatibility view is persisted to V1 and the V2 projection is then
 * rebuilt from that legitimate V1 history inside the same outer transaction. */
export function runJourneyV2Write<T>(input: {
  spaceId: string;
  definitionId: string;
  operation: () => T;
  requestId?: string;
}) {
  const definition = db.prepare('SELECT legacy_journey_id FROM journey_definitions WHERE id=? AND space_id=?')
    .get(input.definitionId, input.spaceId) as { legacy_journey_id: string | null } | undefined;
  if (!definition) throw new JourneyMapError('Journey map not found.', 404, 'JOURNEY_MAP_NOT_FOUND');
  if (!definition.legacy_journey_id) return input.operation();
  const decision = effectiveJourneyRollout(input.spaceId);
  if (!decision.v2Write) {
    throw new JourneyMapError('Journey Map 2.0 writes are disabled for this space.', 403, 'JOURNEY_V2_WRITE_DISABLED');
  }
  if (!decision.dualWrite) return input.operation();
  const journeyId = definition.legacy_journey_id;
  return db.transaction(() => {
    assertLegacyProjectionClean(input.spaceId, journeyId);
    const legacy = getJourney(journeyId, input.spaceId);
    if (!legacy) throw new JourneyMapError('Legacy journey not found.', 404, 'JOURNEY_LEGACY_SOURCE_MISSING');
    const result = input.operation();
    const changedMap = getJourneyMap(input.spaceId, input.definitionId);
    if (!changedMap) throw new JourneyMapError('Journey map not found after mutation.', 409, 'JOURNEY_DUAL_WRITE_DIVERGED');
    assertMapLegacyCompatible(changedMap);
    const rendered = legacyJourneyFromMap(changedMap) as unknown as Journey;
    const { updateJourney } = requireDatabaseJourneyWriter();
    const updated = updateJourney(journeyId, {
      name: rendered.name, audience: rendered.audience, objective: rendered.objective, industry: rendered.industry,
      stages: rendered.stages, summary: rendered.summary, provenance: rendered.provenance as Journey['provenance']
    }, legacy.updatedAt, { reason: 'workspace_edit', actor: 'workspace' }, input.spaceId);
    if (!updated) throw new JourneyMapError('The legacy journey changed during the dual write.', 409,
      'JOURNEY_DUAL_WRITE_CONFLICT');
    refreshJourneyMapForLegacyJourney(updated, input.spaceId, { bumpRevision: false });
    const reconciliation = reconcileJourneyMap(input.spaceId, journeyId);
    if (!reconciliation.matched) {
      recordJourneyDivergence({
        spaceId: input.spaceId, journeyId, definitionId: input.definitionId, operation: 'v2_to_legacy_write',
        servedSource: 'none', legacyChecksum: reconciliation.sourceChecksum, v2Checksum: reconciliation.projectionChecksum,
        reasonCode: 'post_write_mismatch', detailCodes: reconciliation.differences, requestId: input.requestId
      });
      throw new JourneyMapError('Journey Map 2.0 and legacy writes diverged.', 409, 'JOURNEY_DUAL_WRITE_DIVERGED');
    }
    const finalMap = getJourneyMap(input.spaceId, input.definitionId);
    if (!finalMap) throw new JourneyMapError('Journey map not found after reconciliation.', 409,
      'JOURNEY_DUAL_WRITE_DIVERGED');
    if (isAffectedCellsMoveResult(result)) {
      const requestedCells = new Map(result.affectedCells.map((cell) => [
        `${cell.stageKey}|${cell.laneType}`, { stageKey: cell.stageKey, laneType: cell.laneType }
      ]));
      const affectedCells = [...requestedCells.values()].map((cell) => {
        const cards = finalMap.cards.filter((card) => card.stageKey === cell.stageKey && card.laneType === cell.laneType)
          .sort((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id));
        if (cards.length > journeyMapLimits.cardsPerCell) {
          throw new JourneyMapError('The reconciled cell exceeds the configured card limit.', 500,
            'JOURNEY_CARD_CELL_LIMIT_INVARIANT');
        }
        return { ...cell, cards };
      });
      const moved = affectedCells.flatMap((cell) => cell.cards).find((card) => card.id === result.cardId);
      if (!moved) {
        throw new JourneyMapError(
          'Legacy reconciliation changed the moved card identity. Retry after loading the complete map.',
          409, 'JOURNEY_COMPACT_MOVE_FULL_RECOVERY_REQUIRED'
        );
      }
      return {
        responseMode: 'affected_cells',
        definitionId: finalMap.definition.id,
        versionId: finalMap.version.id,
        cardId: result.cardId,
        revision: finalMap.definition.revision,
        updatedAt: finalMap.definition.updatedAt,
        cardsPerCellLimit: journeyMapLimits.cardsPerCell,
        affectedCells
      } as T;
    }
    return finalMap as T;
  })();
}

function isAffectedCellsMoveResult(value: unknown): value is JourneyCardMoveAffectedCellsResponse {
  return typeof value === 'object' && value !== null
    && (value as { responseMode?: unknown }).responseMode === 'affected_cells';
}

// Kept behind a function to make the write dependency explicit and avoid any
// temptation to invoke the legacy HTTP route recursively.
function requireDatabaseJourneyWriter() {
  // `updateJourney` is imported lazily through the already-initialised module
  // namespace in CommonJS-free ESM by this tiny indirection at module scope.
  return { updateJourney: databaseUpdateJourney };
}

import { updateJourney as databaseUpdateJourney } from './database.js';
