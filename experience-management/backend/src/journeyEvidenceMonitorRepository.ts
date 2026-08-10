import crypto from 'node:crypto';
import { db } from './database.js';
import { journeyEvidenceSnapshotFingerprint, journeyEvidenceSnapshotFromSource,
  type JourneyEvidenceSnapshot } from './journeyEvidenceLifecycle.js';
import { journeyEvidenceSourceAdapters } from './journeyEvidenceSources.js';
import type { EvidenceSourceType } from './journeyDomain.js';

export type JourneyEvidenceMonitorStatus =
  | 'pending' | 'current' | 'changed' | 'stale' | 'unavailable' | 'authority_missing' | 'invalidated';
export type JourneyEvidenceMonitorReason =
  | 'pending' | 'source_current' | 'source_changed' | 'freshness_expired' | 'source_unavailable'
  | 'authority_missing' | 'already_invalidated';

export type JourneyEvidenceMonitorClaim = {
  evidenceLinkId: string; spaceId: string; sourceType: EvidenceSourceType; sourceRef: string;
  createdBy: string | null; collectedAt: string | null; freshnessDays: number | null;
  invalidatedAt: string | null; snapshot: JourneyEvidenceSnapshot; snapshotFingerprint: string;
  previousStatus: JourneyEvidenceMonitorStatus; leaseOwner: string; leaseToken: string; leaseGeneration: number;
};

export type JourneyEvidenceObservation = {
  status: Exclude<JourneyEvidenceMonitorStatus, 'pending'>;
  reason: Exclude<JourneyEvidenceMonitorReason, 'pending'>;
  sourceFingerprint: string | null;
};

const monitorStatuses = new Set<JourneyEvidenceMonitorStatus>([
  'pending','current','changed','stale','unavailable','authority_missing','invalidated'
]);
const referenceIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u;

function iso(value: Date | string) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error('JOURNEY_EVIDENCE_MONITOR_TIME_INVALID');
  return parsed.toISOString();
}

function sha(value: unknown) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function snapshot(row: any): JourneyEvidenceSnapshot {
  return {
    sourceType: String(row.source_type), sourceRef: String(row.source_ref), sourceLabel: String(row.source_label || ''),
    excerpt: String(row.excerpt || ''), population: String(row.population || ''),
    sampleSize: row.sample_size === null || row.sample_size === undefined ? null : Number(row.sample_size),
    collectedAt: row.collected_at || null, windowStart: row.window_start || null, windowEnd: row.window_end || null,
    sourceUpdatedAt: row.source_updated_at || null
  };
}

function ensureSqliteSchema() {
  if (db.provider !== 'sqlite') return;
  db.exec(`CREATE TABLE IF NOT EXISTS journey_evidence_monitor_states (
    evidence_link_id TEXT PRIMARY KEY,
    space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',observation_reason TEXT NOT NULL DEFAULT 'pending',
    snapshot_fingerprint TEXT NOT NULL,observed_source_fingerprint TEXT,observation_fingerprint TEXT,
    first_observed_at TEXT,last_observed_at TEXT,next_check_at TEXT NOT NULL,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,last_error_sha256 TEXT,
    lease_owner TEXT,lease_token TEXT,lease_generation INTEGER NOT NULL DEFAULT 0,lease_expires_at TEXT,
    created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(evidence_link_id,space_id),
    FOREIGN KEY(evidence_link_id,space_id) REFERENCES journey_evidence_links(id,space_id) ON DELETE CASCADE);
  CREATE INDEX IF NOT EXISTS journey_evidence_monitor_due
    ON journey_evidence_monitor_states(next_check_at,evidence_link_id);
  CREATE TABLE IF NOT EXISTS journey_evidence_monitor_events (
    id TEXT PRIMARY KEY,evidence_link_sha256 TEXT NOT NULL,space_id TEXT NOT NULL,
    from_status TEXT NOT NULL,to_status TEXT NOT NULL,observation_reason TEXT NOT NULL,
    snapshot_fingerprint TEXT NOT NULL,observed_source_fingerprint TEXT,observation_fingerprint TEXT NOT NULL,
    invalidation_applied INTEGER NOT NULL DEFAULT 0,observed_at TEXT NOT NULL,created_at TEXT NOT NULL,
    FOREIGN KEY(space_id) REFERENCES spaces(id) ON DELETE CASCADE,
    UNIQUE(evidence_link_sha256,from_status,to_status,observation_fingerprint));`);
}

ensureSqliteSchema();

export class JourneyEvidenceMonitorRepository {
  available() {
    return db.provider === 'sqlite' || Number(db.health().runtimeSchemaVersion || 0) >= 54;
  }

  seedMissing(now: Date | string = new Date(), limit = 100) {
    if (!this.available()) return 0;
    const at = iso(now); const bounded = Math.max(1, Math.min(500, Math.trunc(limit)));
    const rows = db.prepare(`SELECT link.* FROM journey_evidence_links link
      LEFT JOIN journey_evidence_monitor_states state ON state.evidence_link_id=link.id AND state.space_id=link.space_id
      WHERE state.evidence_link_id IS NULL ORDER BY link.space_id,link.id LIMIT ?`).all(bounded) as any[];
    return db.transaction(() => {
      let seeded = 0;
      const insert = db.prepare(`INSERT INTO journey_evidence_monitor_states
        (evidence_link_id,space_id,status,observation_reason,snapshot_fingerprint,next_check_at,created_at,updated_at)
        VALUES (?,?,'pending','pending',?,?,?,?) ON CONFLICT(evidence_link_id) DO NOTHING`);
      for (const row of rows) seeded += insert.run(row.id,row.space_id,
        journeyEvidenceSnapshotFingerprint(snapshot(row)),at,at,at).changes;
      return seeded;
    })();
  }

  claim(input: { owner: string; now?: Date | string; leaseMs?: number }): JourneyEvidenceMonitorClaim | null {
    if (!this.available()) return null;
    const owner = String(input.owner || '').trim();
    if (!owner || owner.length > 200) throw new Error('JOURNEY_EVIDENCE_MONITOR_OWNER_INVALID');
    const at = iso(input.now || new Date());
    const leaseExpires = new Date(Date.parse(at) + Math.max(5_000, Math.min(300_000, input.leaseMs || 60_000))).toISOString();
    return db.transaction(() => {
      const candidate = db.prepare(`SELECT state.evidence_link_id,state.space_id,state.status,state.lease_generation,link.*
        FROM journey_evidence_monitor_states state
        JOIN journey_evidence_links link ON link.id=state.evidence_link_id AND link.space_id=state.space_id
        WHERE state.next_check_at<=? AND (state.lease_owner IS NULL OR state.lease_expires_at<=?)
        ORDER BY state.next_check_at,state.evidence_link_id LIMIT 1`).get(at,at) as any;
      if (!candidate) return null;
      const leaseToken = crypto.randomBytes(32).toString('hex');
      const generation = Number(candidate.lease_generation) + 1;
      const changed = db.prepare(`UPDATE journey_evidence_monitor_states SET lease_owner=?,lease_token=?,
        lease_generation=?,lease_expires_at=?,updated_at=? WHERE evidence_link_id=? AND space_id=?
        AND lease_generation=? AND (lease_owner IS NULL OR lease_expires_at<=?)`)
        .run(owner,leaseToken,generation,leaseExpires,at,candidate.evidence_link_id,candidate.space_id,
          candidate.lease_generation,at).changes;
      if (changed !== 1) return null;
      const stored = snapshot(candidate);
      return {
        evidenceLinkId:String(candidate.evidence_link_id),spaceId:String(candidate.space_id),
        sourceType:String(candidate.source_type) as EvidenceSourceType,sourceRef:String(candidate.source_ref),
        createdBy:candidate.created_by ? String(candidate.created_by) : null,
        collectedAt:candidate.collected_at || null,
        freshnessDays:candidate.freshness_days === null || candidate.freshness_days === undefined
          ? null : Number(candidate.freshness_days),invalidatedAt:candidate.invalidated_at || null,
        snapshot:stored,snapshotFingerprint:journeyEvidenceSnapshotFingerprint(stored),
        previousStatus:monitorStatuses.has(candidate.status) ? candidate.status : 'pending',
        leaseOwner:owner,leaseToken,leaseGeneration:generation
      };
    })();
  }

  observe(claim: JourneyEvidenceMonitorClaim, now: Date | string = new Date()): JourneyEvidenceObservation {
    const at = iso(now);
    if (claim.invalidatedAt) return { status:'invalidated',reason:'already_invalidated',sourceFingerprint:null };
    if (!claim.createdBy) return { status:'authority_missing',reason:'authority_missing',sourceFingerprint:null };
    const adapter = journeyEvidenceSourceAdapters.get(claim.sourceType);
    if (!adapter) return { status:'authority_missing',reason:'authority_missing',sourceFingerprint:null };
    let sourceId = claim.sourceRef;
    for (const prefix of adapter.prefixes) if (sourceId.startsWith(prefix)) { sourceId = sourceId.slice(prefix.length); break; }
    if (!referenceIdPattern.test(sourceId)) return { status:'authority_missing',reason:'authority_missing',sourceFingerprint:null };
    const source = adapter.resolve({ spaceId:claim.spaceId,userId:claim.createdBy },sourceId);
    if (!source) return { status:'unavailable',reason:'source_unavailable',sourceFingerprint:null };
    const current = journeyEvidenceSnapshotFromSource({sourceType:source.sourceType,sourceRef:source.sourceRef,
      label:source.label,excerpt:source.excerpt,population:source.population,sampleSize:source.sampleSize,
      collectedAt:source.collectedAt,windowStart:source.windowStart,windowEnd:source.windowEnd,updatedAt:source.updatedAt});
    const currentFingerprint = journeyEvidenceSnapshotFingerprint(current);
    const collected = claim.collectedAt ? Date.parse(claim.collectedAt) : Number.NaN;
    const freshnessDays = typeof claim.freshnessDays === 'number' && Number.isFinite(claim.freshnessDays) && claim.freshnessDays > 0
      ? Number(claim.freshnessDays) : 90;
    if (Number.isFinite(collected) && Date.parse(at) - collected > freshnessDays * 86_400_000) {
      return { status:'stale',reason:'freshness_expired',sourceFingerprint:currentFingerprint };
    }
    return currentFingerprint === claim.snapshotFingerprint
      ? { status:'current',reason:'source_current',sourceFingerprint:currentFingerprint }
      : { status:'changed',reason:'source_changed',sourceFingerprint:currentFingerprint };
  }

  complete(claim: JourneyEvidenceMonitorClaim, observation: JourneyEvidenceObservation,
    now: Date | string = new Date()) {
    const at = iso(now);
    return db.transaction(() => {
      const current = db.prepare(`SELECT state.status,state.snapshot_fingerprint,link.*
        FROM journey_evidence_monitor_states state JOIN journey_evidence_links link
          ON link.id=state.evidence_link_id AND link.space_id=state.space_id
        WHERE state.evidence_link_id=? AND state.space_id=? AND state.lease_owner=? AND state.lease_token=?
          AND state.lease_generation=?`).get(claim.evidenceLinkId,claim.spaceId,claim.leaseOwner,
            claim.leaseToken,claim.leaseGeneration) as any;
      if (!current) throw new Error('JOURNEY_EVIDENCE_MONITOR_LEASE_LOST');
      if (journeyEvidenceSnapshotFingerprint(snapshot(current)) !== claim.snapshotFingerprint) {
        throw new Error('JOURNEY_EVIDENCE_MONITOR_LINK_CHANGED');
      }
      const observationFingerprint = sha({snapshotFingerprint:claim.snapshotFingerprint,
        sourceFingerprint:observation.sourceFingerprint,status:observation.status,reason:observation.reason});
      let invalidationApplied = 0;
      if (observation.status === 'unavailable' && !current.invalidated_at) {
        invalidationApplied = db.prepare(`UPDATE journey_evidence_links SET invalidated_at=?,
          invalidated_reason='automatic_source_unavailable',updated_at=?
          WHERE id=? AND space_id=? AND invalidated_at IS NULL`)
          .run(at,at,claim.evidenceLinkId,claim.spaceId).changes;
      }
      const nextCheck = new Date(Date.parse(at) + (observation.status === 'current' ? 3_600_000 : 21_600_000)).toISOString();
      const changed = db.prepare(`UPDATE journey_evidence_monitor_states SET status=?,observation_reason=?,
        snapshot_fingerprint=?,observed_source_fingerprint=?,observation_fingerprint=?,
        first_observed_at=COALESCE(first_observed_at,?),last_observed_at=?,next_check_at=?,consecutive_failures=0,
        last_error_sha256=NULL,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=?
        WHERE evidence_link_id=? AND space_id=? AND lease_token=? AND lease_generation=?`)
        .run(observation.status,observation.reason,claim.snapshotFingerprint,observation.sourceFingerprint,
          observationFingerprint,at,at,nextCheck,at,claim.evidenceLinkId,claim.spaceId,claim.leaseToken,
          claim.leaseGeneration).changes;
      if (changed !== 1) throw new Error('JOURNEY_EVIDENCE_MONITOR_LEASE_LOST');
      db.prepare(`INSERT INTO journey_evidence_monitor_events
        (id,evidence_link_sha256,space_id,from_status,to_status,observation_reason,snapshot_fingerprint,
          observed_source_fingerprint,observation_fingerprint,invalidation_applied,observed_at,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(evidence_link_sha256,from_status,to_status,observation_fingerprint) DO NOTHING`)
        .run(crypto.randomUUID(),sha(claim.evidenceLinkId),claim.spaceId,current.status,observation.status,
          observation.reason,claim.snapshotFingerprint,observation.sourceFingerprint,observationFingerprint,
          invalidationApplied,at,at);
      return { status:observation.status,invalidationApplied:Boolean(invalidationApplied),observationFingerprint };
    })();
  }

  fail(claim: JourneyEvidenceMonitorClaim, error: unknown, now: Date | string = new Date()) {
    const at = iso(now); const fingerprint = sha(error instanceof Error ? `${error.name}:${error.message}` : String(error));
    const row = db.prepare(`SELECT consecutive_failures FROM journey_evidence_monitor_states
      WHERE evidence_link_id=? AND space_id=? AND lease_token=? AND lease_generation=?`)
      .get(claim.evidenceLinkId,claim.spaceId,claim.leaseToken,claim.leaseGeneration) as any;
    if (!row) return false;
    const failures = Math.min(20,Number(row.consecutive_failures || 0) + 1);
    const nextCheck = new Date(Date.parse(at) + Math.min(21_600_000,30_000 * 2 ** Math.min(10,failures - 1))).toISOString();
    return db.prepare(`UPDATE journey_evidence_monitor_states SET consecutive_failures=?,last_error_sha256=?,
      next_check_at=?,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=?
      WHERE evidence_link_id=? AND space_id=? AND lease_token=? AND lease_generation=?`)
      .run(failures,fingerprint,nextCheck,at,claim.evidenceLinkId,claim.spaceId,claim.leaseToken,
        claim.leaseGeneration).changes === 1;
  }
}

export const journeyEvidenceMonitorRepository = new JourneyEvidenceMonitorRepository();
