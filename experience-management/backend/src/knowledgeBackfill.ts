import crypto from 'node:crypto';
import { backfillKnowledgeIndex } from './knowledgeClient.js';
import {
  config, gteKnowledgeEmbeddingProfile, qwenKnowledgeEmbeddingProfile, type KnowledgeEmbeddingProfile
} from './config.js';
import { db } from './database.js';
import { isDatabaseConstraintError } from './databaseAdapter.js';
import {
  auditKnowledge, getKnowledgeBase, getKnowledgeEmbeddingProfile, KnowledgeError,
  lockKnowledgeBaseEmbeddingMutation
} from './knowledgeRepository.js';

export type KnowledgeBackfillState = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type KnowledgeBackfillItemState = 'pending' | 'queued' | 'processing' | 'completed' | 'failed';

export interface KnowledgeBackfillRun {
  id: string;
  scopeSpaceId: string | null;
  sourceVectorIndexVersion: string;
  targetVectorIndexVersion: string;
  state: KnowledgeBackfillState;
  batchSize: number;
  totalDocuments: number;
  completedDocuments: number;
  failedDocuments: number;
  cursorDocumentId: string | null;
  error: string | null;
  requestedBy: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface KnowledgeBackfillItem {
  runId: string;
  spaceId: string;
  knowledgeBaseId: string;
  documentId: string;
  targetVectorIndexVersion: string;
  sourceSha256: string;
  sourceIndexVersion: number;
  sourceChunkerVersion: string;
  sourceEmbeddingProfile: KnowledgeEmbeddingProfile;
  targetEmbeddingProfile: KnowledgeEmbeddingProfile;
  state: KnowledgeBackfillItemState;
  attempt: number;
  zeroProgressCount: number;
  cursorAfterKey: string;
  processedChunks: number;
  writtenChunks: number;
  remainingChunks: number | null;
  error: string | null;
  nextAttemptAt: string | null;
  leaseOwner: string | null;
  leaseToken: string | null;
  leaseGeneration: number;
  leaseAcquiredAt: string | null;
  leaseExpiresAt: string | null;
  heartbeatAt: string | null;
  lastProgressAt: string | null;
  runtimeMetrics: Record<string, unknown>;
  runtimeAttestation: Record<string, unknown>;
  runtimeAttestationSha256: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

const parseJson = <T>(value: unknown, fallback: T): T => {
  try { return value ? JSON.parse(String(value)) as T : fallback; } catch { return fallback; }
};

const profileSnapshot = (profile: KnowledgeEmbeddingProfile): KnowledgeEmbeddingProfile => ({
  provider: profile.provider, model: profile.model, revision: profile.revision, dtype: profile.dtype,
  dimensions: profile.dimensions, vectorIndexVersion: profile.vectorIndexVersion
});

function rowRun(row: any): KnowledgeBackfillRun {
  return {
    id: row.id,
    scopeSpaceId: row.scope_space_id || null,
    sourceVectorIndexVersion: row.source_vector_index_version,
    targetVectorIndexVersion: row.target_vector_index_version,
    state: row.state,
    batchSize: Number(row.batch_size),
    totalDocuments: Number(row.total_documents || 0),
    completedDocuments: Number(row.completed_documents || 0),
    failedDocuments: Number(row.failed_documents || 0),
    cursorDocumentId: row.cursor_document_id || null,
    error: row.error,
    requestedBy: row.requested_by,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at
  };
}

function rowItem(row: any): KnowledgeBackfillItem {
  return {
    runId: row.run_id,
    spaceId: row.space_id,
    knowledgeBaseId: row.knowledge_base_id,
    documentId: row.document_id,
    targetVectorIndexVersion: row.target_vector_index_version,
    sourceSha256: row.source_sha256,
    sourceIndexVersion: Number(row.source_index_version),
    sourceChunkerVersion: row.source_chunker_version,
    sourceEmbeddingProfile: parseJson(row.source_embedding_profile_json, qwenKnowledgeEmbeddingProfile) as KnowledgeEmbeddingProfile,
    targetEmbeddingProfile: parseJson(row.target_embedding_profile_json, gteKnowledgeEmbeddingProfile) as KnowledgeEmbeddingProfile,
    state: row.state,
    attempt: Number(row.attempt || 0),
    zeroProgressCount: Number(row.zero_progress_count || 0),
    cursorAfterKey: row.cursor_after_key || '',
    processedChunks: Number(row.processed_chunks || 0),
    writtenChunks: Number(row.written_chunks || 0),
    remainingChunks: row.remaining_chunks == null ? null : Number(row.remaining_chunks),
    error: row.error,
    nextAttemptAt: row.next_attempt_at,
    leaseOwner: row.lease_owner,
    leaseToken: row.lease_token,
    leaseGeneration: Number(row.lease_generation || 0),
    leaseAcquiredAt: row.lease_acquired_at,
    leaseExpiresAt: row.lease_expires_at,
    heartbeatAt: row.heartbeat_at,
    lastProgressAt: row.last_progress_at,
    runtimeMetrics: parseJson(row.runtime_metrics_json, {}),
    runtimeAttestation: parseJson(row.runtime_attestation_json, {}),
    runtimeAttestationSha256: row.runtime_attestation_sha256,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at
  };
}

export function getKnowledgeBackfillRun(id: string) {
  const row = db.prepare('SELECT * FROM knowledge_backfill_runs WHERE id=?').get(id) as any;
  return row ? rowRun(row) : null;
}

export function listKnowledgeBackfillItems(runId: string, limit = 500) {
  return (db.prepare(`SELECT * FROM knowledge_backfill_items WHERE run_id=?
    ORDER BY created_at,document_id LIMIT ?`).all(runId, Math.max(1, Math.min(2_000, limit))) as any[]).map(rowItem);
}

export function knowledgeBackfillStatus(id: string) {
  const run = getKnowledgeBackfillRun(id);
  if (!run) throw new KnowledgeError('Knowledge backfill was not found.', 404, 'KNOWLEDGE_BACKFILL_NOT_FOUND');
  const counts = db.prepare(`SELECT
    SUM(CASE WHEN state IN ('pending','queued') THEN 1 ELSE 0 END) queued,
    SUM(CASE WHEN state='processing' THEN 1 ELSE 0 END) processing,
    SUM(CASE WHEN state='completed' THEN 1 ELSE 0 END) completed,
    SUM(CASE WHEN state='failed' THEN 1 ELSE 0 END) failed,
    COALESCE(SUM(processed_chunks),0) processed_chunks,
    COALESCE(SUM(written_chunks),0) written_chunks,
    COALESCE(SUM(remaining_chunks),0) remaining_chunks
    FROM knowledge_backfill_items WHERE run_id=?`).get(id) as any;
  return {
    ...run,
    queuedDocuments: Number(counts?.queued || 0),
    processingDocuments: Number(counts?.processing || 0),
    completedDocuments: Number(counts?.completed || 0),
    failedDocuments: Number(counts?.failed || 0),
    processedChunks: Number(counts?.processed_chunks || 0),
    writtenChunks: Number(counts?.written_chunks || 0),
    remainingChunks: Number(counts?.remaining_chunks || 0)
  };
}

function activeBackfill(sourceVectorIndexVersion: string, targetVectorIndexVersion: string, spaceId?: string | null) {
  const row = db.prepare(`SELECT * FROM knowledge_backfill_runs
    WHERE source_vector_index_version=? AND target_vector_index_version=?
      AND COALESCE(scope_space_id,'')=COALESCE(?,'') AND state IN ('queued','running','paused')
    ORDER BY created_at LIMIT 1`).get(sourceVectorIndexVersion, targetVectorIndexVersion, spaceId || null) as any;
  return row ? rowRun(row) : null;
}

export function createKnowledgeBackfill(input: {
  sourceVectorIndexVersion?: string;
  targetVectorIndexVersion?: string;
  spaceId?: string | null;
  batchSize?: number;
  requestedBy?: string | null;
}) {
  const sourceVectorIndexVersion = input.sourceVectorIndexVersion || 'qwen-v1';
  const targetVectorIndexVersion = input.targetVectorIndexVersion || 'gte-modernbert-v1';
  const batchSize = Number(input.batchSize ?? 32);
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 128) {
    throw new KnowledgeError('Knowledge backfill batch size must be between 1 and 128.', 400, 'KNOWLEDGE_BACKFILL_BATCH_INVALID');
  }
  const sourceProfile = getKnowledgeEmbeddingProfile(sourceVectorIndexVersion);
  const targetProfile = getKnowledgeEmbeddingProfile(targetVectorIndexVersion);
  if (!sourceProfile || sourceProfile.provider !== 'qwen-tei' || sourceProfile.state !== 'configured') {
    throw new KnowledgeError('The configured Qwen source profile is unavailable.', 409, 'KNOWLEDGE_BACKFILL_SOURCE_UNAVAILABLE');
  }
  if (!targetProfile || targetProfile.provider !== 'gte-node' || targetProfile.state !== 'configured') {
    throw new KnowledgeError('The configured GTE target profile is unavailable.', 409, 'KNOWLEDGE_BACKFILL_TARGET_UNAVAILABLE');
  }
  if (input.spaceId && !db.prepare("SELECT 1 FROM spaces WHERE id=? AND status<>'deleted'").get(input.spaceId)) {
    throw new KnowledgeError('Backfill workspace was not found.', 404, 'SPACE_NOT_FOUND');
  }
  const replay = activeBackfill(sourceVectorIndexVersion, targetVectorIndexVersion, input.spaceId);
  if (replay) return { run: replay, deduplicated: true };

  try {
    return db.transaction(() => {
      const concurrent = activeBackfill(sourceVectorIndexVersion, targetVectorIndexVersion, input.spaceId);
      if (concurrent) return { run: concurrent, deduplicated: true };
      const eligibleBases = db.prepare(`SELECT b.space_id,b.id knowledge_base_id,b.current_version,b.chunker_version
        FROM knowledge_bases b JOIN knowledge_base_embedding_profiles source_base
          ON source_base.knowledge_base_id=b.id AND source_base.space_id=b.space_id
          AND source_base.vector_index_version=? AND source_base.state='ready'
        WHERE b.deleted_at IS NULL AND (? IS NULL OR b.space_id=?)
        ORDER BY b.space_id,b.id`).all(sourceVectorIndexVersion, input.spaceId || null, input.spaceId || null) as any[];
      const candidates = db.prepare(`SELECT d.space_id,d.knowledge_base_id,d.id document_id,d.sha256,d.index_version,
          d.chunk_count,d.created_at,d.updated_at,b.chunker_version
        FROM knowledge_documents d
        JOIN knowledge_bases b ON b.id=d.knowledge_base_id AND b.space_id=d.space_id
        JOIN knowledge_document_embeddings source ON source.document_id=d.id
          AND source.vector_index_version=? AND source.state='ready' AND source.source_sha256=d.sha256
          AND source.index_version>=d.index_version
        JOIN knowledge_base_embedding_profiles source_base ON source_base.knowledge_base_id=b.id
          AND source_base.space_id=b.space_id AND source_base.vector_index_version=? AND source_base.state='ready'
        LEFT JOIN knowledge_document_embeddings target ON target.document_id=d.id
          AND target.vector_index_version=?
        WHERE d.deleted_at IS NULL AND d.state='ready' AND b.deleted_at IS NULL
          AND (? IS NULL OR d.space_id=?)
          AND (target.document_id IS NULL OR target.state<>'ready' OR target.source_sha256<>d.sha256
            OR target.index_version<d.index_version)
        ORDER BY d.space_id,d.knowledge_base_id,d.created_at,d.id`)
        .all(sourceVectorIndexVersion, sourceVectorIndexVersion, targetVectorIndexVersion,
          input.spaceId || null, input.spaceId || null) as any[];
      const id = crypto.randomUUID(); const now = new Date().toISOString();
      const state: KnowledgeBackfillState = candidates.length ? 'queued' : 'completed';
      db.prepare(`INSERT INTO knowledge_backfill_runs
        (id,scope_space_id,source_vector_index_version,target_vector_index_version,state,batch_size,total_documents,
          completed_documents,failed_documents,requested_by,created_at,completed_at,updated_at)
        VALUES (?,?,?,?,?,?,?,0,0,?,?,?,?)`).run(id, input.spaceId || null, sourceVectorIndexVersion,
          targetVectorIndexVersion, state, batchSize, candidates.length, input.requestedBy || null, now,
          candidates.length ? null : now, now);
      const insertMapping = db.prepare(`INSERT INTO knowledge_base_embedding_profiles
        (space_id,knowledge_base_id,vector_index_version,mode,state,current_version,error,created_at,updated_at)
        VALUES (?,?,?,'shadow','indexing',0,NULL,?,?)
        ON CONFLICT(knowledge_base_id,vector_index_version) DO UPDATE SET
          state=CASE WHEN knowledge_base_embedding_profiles.state='ready' THEN 'ready' ELSE 'indexing' END,
          error=NULL,updated_at=excluded.updated_at`);
      const insertRunBase = db.prepare(`INSERT INTO knowledge_backfill_run_bases
        (run_id,space_id,knowledge_base_id,source_base_version,source_chunker_version,created_at)
        VALUES (?,?,?,?,?,?)`);
      const insertProjection = db.prepare(`INSERT INTO knowledge_document_embeddings
        (space_id,knowledge_base_id,document_id,vector_index_version,source_sha256,index_version,state,chunk_count,
          last_job_id,error,indexed_at,created_at,updated_at)
        VALUES (?,?,?,?,?,0,'queued',0,NULL,NULL,NULL,?,?)
        ON CONFLICT(document_id,vector_index_version) DO UPDATE SET source_sha256=excluded.source_sha256,
          state='queued',error=NULL,updated_at=excluded.updated_at`);
      const insertItem = db.prepare(`INSERT INTO knowledge_backfill_items
        (run_id,space_id,knowledge_base_id,document_id,target_vector_index_version,source_sha256,source_index_version,
          source_chunker_version,source_embedding_profile_json,target_embedding_profile_json,state,attempt,zero_progress_count,
          cursor_after_key,processed_chunks,written_chunks,remaining_chunks,error,next_attempt_at,runtime_metrics_json,
          runtime_attestation_json,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,'pending',0,0,'',0,0,NULL,NULL,NULL,'{}','{}',?,?)`);
      const mapped = new Set<string>();
      for (const eligible of eligibleBases) {
        insertRunBase.run(id, eligible.space_id, eligible.knowledge_base_id, eligible.current_version,
          eligible.chunker_version, now);
        insertMapping.run(eligible.space_id, eligible.knowledge_base_id, targetVectorIndexVersion, now, now);
        mapped.add(`${eligible.knowledge_base_id}:${targetVectorIndexVersion}`);
      }
      for (const candidate of candidates) {
        const mappingKey = `${candidate.knowledge_base_id}:${targetVectorIndexVersion}`;
        if (!mapped.has(mappingKey)) {
          insertMapping.run(candidate.space_id, candidate.knowledge_base_id, targetVectorIndexVersion, now, now);
          mapped.add(mappingKey);
        }
        insertProjection.run(candidate.space_id, candidate.knowledge_base_id, candidate.document_id,
          targetVectorIndexVersion, candidate.sha256, now, now);
        insertItem.run(id, candidate.space_id, candidate.knowledge_base_id, candidate.document_id,
          targetVectorIndexVersion, candidate.sha256, candidate.index_version, candidate.chunker_version,
          JSON.stringify(profileSnapshot(sourceProfile)), JSON.stringify(profileSnapshot(targetProfile)), now, now);
      }
      return { run: getKnowledgeBackfillRun(id)!, deduplicated: false };
    })();
  } catch (error) {
    if (isDatabaseConstraintError(error)) {
      const concurrent = activeBackfill(sourceVectorIndexVersion, targetVectorIndexVersion, input.spaceId);
      if (concurrent) return { run: concurrent, deduplicated: true };
    }
    throw error;
  }
}

export function pauseKnowledgeBackfill(id: string) {
  const now = new Date().toISOString();
  const changed = db.prepare(`UPDATE knowledge_backfill_runs SET state='paused',updated_at=?
    WHERE id=? AND state IN ('queued','running')`).run(now, id).changes;
  if (!changed) {
    const current = getKnowledgeBackfillRun(id);
    if (!current) throw new KnowledgeError('Knowledge backfill was not found.', 404, 'KNOWLEDGE_BACKFILL_NOT_FOUND');
    if (current.state !== 'paused') throw new KnowledgeError('Only active backfills can be paused.', 409, 'KNOWLEDGE_BACKFILL_NOT_ACTIVE');
  }
  return knowledgeBackfillStatus(id);
}

export function resumeKnowledgeBackfill(id: string) {
  const now = new Date().toISOString();
  const current = getKnowledgeBackfillRun(id);
  if (!current) throw new KnowledgeError('Knowledge backfill was not found.', 404, 'KNOWLEDGE_BACKFILL_NOT_FOUND');
  if (current.state !== 'paused' && current.state !== 'failed') {
    if (current.state === 'queued' || current.state === 'running') return knowledgeBackfillStatus(id);
    throw new KnowledgeError('This backfill cannot be resumed.', 409, 'KNOWLEDGE_BACKFILL_NOT_RESUMABLE');
  }
  db.transaction(() => {
    if (current.state === 'failed') {
      db.prepare(`UPDATE knowledge_backfill_items SET state='queued',attempt=0,zero_progress_count=0,error=NULL,
        next_attempt_at=NULL,completed_at=NULL,lease_owner=NULL,lease_token=NULL,lease_acquired_at=NULL,
        lease_expires_at=NULL,heartbeat_at=NULL,updated_at=? WHERE run_id=? AND state='failed'`).run(now, id);
    }
    db.prepare(`UPDATE knowledge_backfill_runs SET state='queued',error=NULL,completed_at=NULL,updated_at=? WHERE id=?`)
      .run(now, id);
  })();
  return knowledgeBackfillStatus(id);
}

export function recoverKnowledgeBackfills() {
  const now = new Date().toISOString();
  return db.transaction(() => {
    const items = db.prepare(`UPDATE knowledge_backfill_items SET state='queued',error='Recovered after expired worker lease.',
      next_attempt_at=NULL,lease_owner=NULL,lease_token=NULL,lease_acquired_at=NULL,lease_expires_at=NULL,
      heartbeat_at=NULL,updated_at=? WHERE state='processing' AND (lease_expires_at IS NULL OR lease_expires_at<=?)`)
      .run(now, now).changes;
    const runs = db.prepare(`UPDATE knowledge_backfill_runs SET state='queued',error='Recovered after expired worker lease.',
      updated_at=? WHERE state='running' AND NOT EXISTS (SELECT 1 FROM knowledge_backfill_items item
        WHERE item.run_id=knowledge_backfill_runs.id AND item.state='processing'
          AND item.lease_expires_at>?)`).run(now, now).changes;
    return { runs, items };
  })();
}

function embeddingCoverage(knowledgeBaseId: string, spaceId: string, vectorIndexVersion: string) {
  const row = db.prepare(`SELECT COUNT(*) total,
      SUM(CASE WHEN projection.state='ready' AND projection.source_sha256=document.sha256
        AND projection.index_version>=document.index_version THEN 1 ELSE 0 END) covered
    FROM knowledge_documents document
    LEFT JOIN knowledge_document_embeddings projection ON projection.document_id=document.id
      AND projection.vector_index_version=?
    WHERE document.knowledge_base_id=? AND document.space_id=? AND document.deleted_at IS NULL
      AND document.state='ready'`).get(vectorIndexVersion, knowledgeBaseId, spaceId) as any;
  return { total: Number(row?.total || 0), covered: Number(row?.covered || 0) };
}

export interface KnowledgePromotionGateEvidence {
  realDataEvaluation: {
    queryCount: number; qwenRerankedMrr: number; gteRerankedMrr: number;
    criticalRegressionCount: number; hit5MinimumMet: boolean; materialDifferencesApproved: boolean;
    reportSha256: string;
  };
  shadow: {
    sampleCount: number; representedNormalAndPeakTraffic: boolean;
    sensitiveDataProtected: boolean; sideEffectsIsolated: boolean;
  };
  operating: {
    errorRate: number; p95Ms: number; p99Ms: number; sustainedQueueGrowth: boolean;
    progressiveMemoryGrowth: boolean; materialRelevanceRegression: boolean; monitoringAndAlertsActive: boolean;
  };
  rollback: { rehearsed: boolean; qwenReady: boolean };
}

export interface KnowledgePromotionApprovalRecord {
  id: string; backfillRunId: string; knowledgeBaseId: string | null; spaceId: string | null;
  sourceVectorIndexVersion: string; targetVectorIndexVersion: string; corpusManifestSha256: string;
  gates: KnowledgePromotionGateEvidence; gatePayloadSha256: string;
  state: 'pending' | 'approved' | 'rejected' | 'revoked' | 'consumed' | 'expired';
  artifactSha256: string | null; requestedBy: string; approvedBy: string | null;
  approvalReason: string | null; approvedAt: string | null; expiresAt: string;
  consumedAt: string | null; createdAt: string;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => [key, canonicalValue(item)]));
  }
  return value;
}

const stableJson = (value: unknown) => JSON.stringify(canonicalValue(value));
const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

function promotionBases(runId: string) {
  return db.prepare(`SELECT knowledge_base_id,space_id FROM knowledge_backfill_run_bases
    WHERE run_id=? ORDER BY space_id,knowledge_base_id`).all(runId) as Array<{
      knowledge_base_id: string; space_id: string;
    }>;
}

function promotionManifest(runId: string, knowledgeBaseId?: string | null) {
  const run = getKnowledgeBackfillRun(runId);
  if (!run) throw new KnowledgeError('Knowledge backfill was not found.', 404, 'KNOWLEDGE_BACKFILL_NOT_FOUND');
  const rows = db.prepare(`SELECT scope.space_id,scope.knowledge_base_id,scope.source_base_version,
      scope.source_chunker_version,base.current_version,base.chunker_version,
      document.id document_id,document.sha256,document.index_version,
      target.state target_state,target.source_sha256 target_sha256,target.index_version target_index_version,
      rollback.state rollback_state,rollback.source_sha256 rollback_sha256,rollback.index_version rollback_index_version,
      item.runtime_attestation_sha256
    FROM knowledge_backfill_run_bases scope
    JOIN knowledge_bases base ON base.id=scope.knowledge_base_id AND base.space_id=scope.space_id
    LEFT JOIN knowledge_documents document ON document.knowledge_base_id=scope.knowledge_base_id
      AND document.space_id=scope.space_id AND document.deleted_at IS NULL AND document.state='ready'
    LEFT JOIN knowledge_document_embeddings target ON target.document_id=document.id
      AND target.vector_index_version=?
    LEFT JOIN knowledge_document_embeddings rollback ON rollback.document_id=document.id
      AND rollback.vector_index_version='qwen-v1'
    LEFT JOIN knowledge_backfill_items item ON item.run_id=scope.run_id AND item.document_id=document.id
    WHERE scope.run_id=? AND (? IS NULL OR scope.knowledge_base_id=?)
    ORDER BY scope.space_id,scope.knowledge_base_id,document.id`)
    .all(run.targetVectorIndexVersion, runId, knowledgeBaseId || null, knowledgeBaseId || null) as any[];
  if (!rows.length) {
    throw new KnowledgeError('The promotion scope contains no eligible knowledge bases.',
      409, 'KNOWLEDGE_PROMOTION_SCOPE_EMPTY');
  }
  if (rows.some((row) => row.document_id && (row.target_state !== 'ready'
      || row.target_sha256 !== row.sha256 || Number(row.target_index_version) < Number(row.index_version)
      || row.rollback_state !== 'ready' || row.rollback_sha256 !== row.sha256
      || Number(row.rollback_index_version) < Number(row.index_version)
      || (row.runtime_attestation_sha256 == null && db.prepare(`SELECT 1 FROM knowledge_backfill_items
        WHERE run_id=? AND document_id=?`).get(runId, row.document_id))))) {
    throw new KnowledgeError('The promotion manifest is missing exact target, rollback, or runtime-attested coverage.',
      409, 'KNOWLEDGE_EMBEDDING_COVERAGE_INCOMPLETE');
  }
  const manifest = {
    version: 1,
    backfillRunId: runId,
    sourceEmbeddingProfile: profileSnapshot(qwenKnowledgeEmbeddingProfile),
    targetEmbeddingProfile: profileSnapshot(gteKnowledgeEmbeddingProfile),
    knowledgeBaseId: knowledgeBaseId || null,
    records: rows.map((row) => ({
      spaceId: row.space_id, knowledgeBaseId: row.knowledge_base_id,
      sourceBaseVersion: Number(row.source_base_version), sourceChunkerVersion: row.source_chunker_version,
      currentBaseVersion: Number(row.current_version), currentChunkerVersion: row.chunker_version,
      documentId: row.document_id || null, sha256: row.sha256 || null,
      indexVersion: row.document_id ? Number(row.index_version) : null,
      target: row.document_id ? { state: row.target_state, sha256: row.target_sha256,
        indexVersion: Number(row.target_index_version || 0), runtimeAttestationSha256: row.runtime_attestation_sha256 || null } : null,
      rollback: row.document_id ? { state: row.rollback_state, sha256: row.rollback_sha256,
        indexVersion: Number(row.rollback_index_version || 0) } : null
    }))
  };
  return { manifest, sha256: sha256(stableJson(manifest)) };
}

function validatePromotionGates(gates: KnowledgePromotionGateEvidence) {
  const quality = gates?.realDataEvaluation; const shadow = gates?.shadow;
  const operating = gates?.operating; const rollback = gates?.rollback;
  const validQuality = Number.isSafeInteger(quality?.queryCount) && quality.queryCount >= 100
    && quality.queryCount <= 10_000 && Number.isFinite(quality.qwenRerankedMrr)
    && Number.isFinite(quality.gteRerankedMrr) && quality.qwenRerankedMrr >= 0 && quality.qwenRerankedMrr <= 1
    && quality.gteRerankedMrr >= 0 && quality.gteRerankedMrr <= 1
    && quality.gteRerankedMrr >= quality.qwenRerankedMrr - 0.02
    && quality.criticalRegressionCount === 0 && quality.hit5MinimumMet === true
    && quality.materialDifferencesApproved === true && /^[a-f0-9]{64}$/u.test(quality.reportSha256);
  const validShadow = Number.isSafeInteger(shadow?.sampleCount) && shadow.sampleCount >= 100
    && shadow.representedNormalAndPeakTraffic === true && shadow.sensitiveDataProtected === true
    && shadow.sideEffectsIsolated === true;
  const validOperating = Number.isFinite(operating?.errorRate) && operating.errorRate >= 0
    && operating.errorRate <= 0.01 && Number.isFinite(operating.p95Ms) && operating.p95Ms <= 500
    && Number.isFinite(operating.p99Ms) && operating.p99Ms <= 1_000
    && operating.sustainedQueueGrowth === false && operating.progressiveMemoryGrowth === false
    && operating.materialRelevanceRegression === false && operating.monitoringAndAlertsActive === true;
  if (!validQuality || !validShadow || !validOperating || rollback?.rehearsed !== true || rollback.qwenReady !== true) {
    throw new KnowledgeError('The persisted GTE quality, shadow, operating, and rollback gates have not all passed.',
      409, 'KNOWLEDGE_PROMOTION_GATES_FAILED');
  }
}

function rowPromotionApproval(row: any): KnowledgePromotionApprovalRecord {
  return {
    id: row.id, backfillRunId: row.backfill_run_id, knowledgeBaseId: row.knowledge_base_id || null,
    spaceId: row.space_id || null, sourceVectorIndexVersion: row.source_vector_index_version,
    targetVectorIndexVersion: row.target_vector_index_version, corpusManifestSha256: row.corpus_manifest_sha256,
    gates: parseJson(row.gate_payload_json, {}) as KnowledgePromotionGateEvidence,
    gatePayloadSha256: row.gate_payload_sha256, state: row.state, artifactSha256: row.artifact_sha256,
    requestedBy: row.requested_by, approvedBy: row.approved_by, approvalReason: row.approval_reason,
    approvedAt: row.approved_at, expiresAt: row.expires_at, consumedAt: row.consumed_at, createdAt: row.created_at
  };
}

export function getKnowledgePromotionApproval(id: string) {
  const row = db.prepare('SELECT * FROM knowledge_embedding_promotion_approvals WHERE id=?').get(id) as any;
  return row ? rowPromotionApproval(row) : null;
}

export function createKnowledgePromotionApprovalRequest(input: {
  backfillRunId: string; knowledgeBaseId?: string | null; spaceId?: string | null;
  gates: KnowledgePromotionGateEvidence; requestedBy: string; expiresInHours?: number;
}) {
  const run = getKnowledgeBackfillRun(input.backfillRunId);
  if (!run || run.state !== 'completed' || run.targetVectorIndexVersion !== 'gte-modernbert-v1') {
    throw new KnowledgeError('Only a completed GTE backfill can enter promotion approval.',
      409, 'KNOWLEDGE_BACKFILL_NOT_PROMOTABLE');
  }
  if (input.knowledgeBaseId && !input.spaceId) {
    throw new KnowledgeError('A base-scoped promotion request requires its workspace.',
      400, 'KNOWLEDGE_PROMOTION_SCOPE_INVALID');
  }
  if (input.knowledgeBaseId && !promotionBases(run.id).some((base) => base.knowledge_base_id === input.knowledgeBaseId
      && base.space_id === input.spaceId)) {
    throw new KnowledgeError('The requested knowledge base is outside this backfill.', 409, 'KNOWLEDGE_PROMOTION_SCOPE_INVALID');
  }
  validatePromotionGates(input.gates);
  const manifest = promotionManifest(run.id, input.knowledgeBaseId);
  const gatePayloadJson = stableJson(input.gates); const gatePayloadSha256 = sha256(gatePayloadJson);
  const now = new Date().toISOString(); const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + Math.max(1, Math.min(168, input.expiresInHours || 24)) * 3_600_000).toISOString();
  db.prepare(`INSERT INTO knowledge_embedding_promotion_approvals
    (id,backfill_run_id,knowledge_base_id,space_id,source_vector_index_version,target_vector_index_version,
      corpus_manifest_sha256,gate_payload_json,gate_payload_sha256,state,artifact_sha256,requested_by,approved_by,
      approval_reason,approved_at,expires_at,consumed_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,'pending',NULL,?,NULL,NULL,NULL,?,NULL,?)`).run(id, run.id,
      input.knowledgeBaseId || null, input.knowledgeBaseId ? input.spaceId || null : null,
      run.sourceVectorIndexVersion, run.targetVectorIndexVersion, manifest.sha256, gatePayloadJson,
      gatePayloadSha256, input.requestedBy, expiresAt, now);
  return getKnowledgePromotionApproval(id)!;
}

export function approveKnowledgePromotionApproval(id: string, approvedBy: string, reason: string) {
  const normalizedReason = String(reason || '').trim();
  if (!approvedBy || normalizedReason.length < 10 || normalizedReason.length > 1_000) {
    throw new KnowledgeError('Manual approval requires an authenticated approver and a substantive reason.',
      400, 'KNOWLEDGE_PROMOTION_APPROVAL_INVALID');
  }
  return db.transaction(() => {
    const lock = db.provider === 'postgres' ? ' FOR UPDATE' : '';
    const row = db.prepare(`SELECT * FROM knowledge_embedding_promotion_approvals WHERE id=?${lock}`).get(id) as any;
    if (!row) throw new KnowledgeError('Promotion approval was not found.', 404, 'KNOWLEDGE_PROMOTION_APPROVAL_NOT_FOUND');
    const approval = rowPromotionApproval(row);
    if (approval.state !== 'pending') throw new KnowledgeError('Only a pending promotion request can be approved.',
      409, 'KNOWLEDGE_PROMOTION_APPROVAL_STATE');
    if (approval.expiresAt <= new Date().toISOString()) throw new KnowledgeError('The promotion request has expired.',
      409, 'KNOWLEDGE_PROMOTION_APPROVAL_EXPIRED');
    validatePromotionGates(approval.gates);
    if (sha256(stableJson(approval.gates)) !== approval.gatePayloadSha256
        || promotionManifest(approval.backfillRunId, approval.knowledgeBaseId).sha256 !== approval.corpusManifestSha256) {
      throw new KnowledgeError('The promotion evidence or corpus changed after the approval request.',
        409, 'KNOWLEDGE_PROMOTION_ARTIFACT_STALE');
    }
    const approvedAt = new Date().toISOString();
    const artifactSha256 = sha256(stableJson({ version: 1, id, gatePayloadSha256: approval.gatePayloadSha256,
      corpusManifestSha256: approval.corpusManifestSha256, approvedBy, reason: normalizedReason,
      approvedAt, expiresAt: approval.expiresAt }));
    db.prepare(`UPDATE knowledge_embedding_promotion_approvals SET state='approved',artifact_sha256=?,approved_by=?,
      approval_reason=?,approved_at=? WHERE id=? AND state='pending'`).run(artifactSha256, approvedBy,
        normalizedReason, approvedAt, id);
    return getKnowledgePromotionApproval(id)!;
  })();
}

export function rejectKnowledgePromotionApproval(id: string, actorUserId: string, reason: string) {
  const message = String(reason || '').trim();
  if (!actorUserId || message.length < 5) throw new KnowledgeError('A rejection reason is required.',
    400, 'KNOWLEDGE_PROMOTION_APPROVAL_INVALID');
  const changed = db.prepare(`UPDATE knowledge_embedding_promotion_approvals SET state='rejected',approved_by=?,
    approval_reason=?,approved_at=? WHERE id=? AND state='pending'`).run(actorUserId, message,
      new Date().toISOString(), id).changes;
  if (!changed) throw new KnowledgeError('Only a pending promotion request can be rejected.',
    409, 'KNOWLEDGE_PROMOTION_APPROVAL_STATE');
  return getKnowledgePromotionApproval(id)!;
}

function verifiedPromotionApproval(id: string, runId: string, knowledgeBaseId?: string | null) {
  const lock = db.provider === 'postgres' ? ' FOR UPDATE' : '';
  const row = db.prepare(`SELECT * FROM knowledge_embedding_promotion_approvals WHERE id=?${lock}`).get(id) as any;
  const approval = row ? rowPromotionApproval(row) : null;
  if (!approval || approval.backfillRunId !== runId || approval.knowledgeBaseId !== (knowledgeBaseId || null)) {
    throw new KnowledgeError('A durable approval artifact for this exact promotion scope is required.',
      409, 'KNOWLEDGE_EMBEDDING_PROMOTION_APPROVAL_REQUIRED');
  }
  if (approval.state !== 'approved' || !approval.artifactSha256 || !approval.approvedBy || !approval.approvedAt
      || approval.expiresAt <= new Date().toISOString()) {
    throw new KnowledgeError('The promotion approval is not active.', 409, 'KNOWLEDGE_PROMOTION_APPROVAL_STATE');
  }
  validatePromotionGates(approval.gates);
  const expectedArtifact = sha256(stableJson({ version: 1, id: approval.id,
    gatePayloadSha256: approval.gatePayloadSha256, corpusManifestSha256: approval.corpusManifestSha256,
    approvedBy: approval.approvedBy, reason: approval.approvalReason, approvedAt: approval.approvedAt,
    expiresAt: approval.expiresAt }));
  if (expectedArtifact !== approval.artifactSha256 || sha256(stableJson(approval.gates)) !== approval.gatePayloadSha256
      || promotionManifest(runId, knowledgeBaseId).sha256 !== approval.corpusManifestSha256) {
    throw new KnowledgeError('The promotion approval artifact or corpus manifest is invalid.',
      409, 'KNOWLEDGE_PROMOTION_ARTIFACT_STALE');
  }
  return approval;
}

function switchKnowledgeBasePrimary(input: {
  knowledgeBaseId: string;
  spaceId: string;
  targetVectorIndexVersion: string;
  previousMode: 'dual_write' | 'shadow';
  actorUserId?: string | null;
  approvalId?: string | null;
  approvalReason?: string | null;
  action: string;
}) {
  return db.transaction(() => {
    const base = lockKnowledgeBaseEmbeddingMutation(input.knowledgeBaseId, input.spaceId);
    if (!base) throw new KnowledgeError('Knowledge base not found.', 404, 'KNOWLEDGE_BASE_NOT_FOUND');
    if (db.prepare(`SELECT 1 FROM knowledge_jobs WHERE knowledge_base_id=? AND space_id=?
      AND state IN ('queued','processing') LIMIT 1`).get(input.knowledgeBaseId, input.spaceId)) {
      throw new KnowledgeError('Wait for live knowledge work to finish before switching embedding profiles.',
        409, 'KNOWLEDGE_EMBEDDING_SWITCH_BUSY');
    }
    const target = getKnowledgeEmbeddingProfile(input.targetVectorIndexVersion);
    if (!target || target.state !== 'configured') {
      throw new KnowledgeError('The target embedding profile is not configured.',
        409, 'KNOWLEDGE_EMBEDDING_PROFILE_DISABLED');
    }
    const targetMapping = db.prepare(`SELECT * FROM knowledge_base_embedding_profiles
      WHERE knowledge_base_id=? AND space_id=? AND vector_index_version=? AND state='ready'`)
      .get(input.knowledgeBaseId, input.spaceId, input.targetVectorIndexVersion) as any;
    if (!targetMapping) {
      throw new KnowledgeError('The target embedding index is not ready for this knowledge base.',
        409, 'KNOWLEDGE_EMBEDDING_PROFILE_NOT_READY');
    }
    const targetCoverage = embeddingCoverage(input.knowledgeBaseId, input.spaceId, input.targetVectorIndexVersion);
    if (targetCoverage.covered !== targetCoverage.total) {
      throw new KnowledgeError('The target embedding index does not match every active source document.',
        409, 'KNOWLEDGE_EMBEDDING_COVERAGE_INCOMPLETE');
    }
    const qwenProfile = getKnowledgeEmbeddingProfile('qwen-v1');
    const qwenMapping = db.prepare(`SELECT * FROM knowledge_base_embedding_profiles
      WHERE knowledge_base_id=? AND space_id=? AND vector_index_version='qwen-v1' AND state='ready'`)
      .get(input.knowledgeBaseId, input.spaceId) as any;
    const qwenCoverage = embeddingCoverage(input.knowledgeBaseId, input.spaceId, 'qwen-v1');
    if (!qwenProfile || qwenProfile.state !== 'configured' || !qwenMapping
        || qwenCoverage.covered !== qwenCoverage.total) {
      throw new KnowledgeError('The Qwen rollback index must remain complete before an embedding switch.',
        409, 'KNOWLEDGE_QWEN_ROLLBACK_NOT_READY');
    }
    const persisted = db.prepare(`SELECT vector_index_version FROM knowledge_bases WHERE id=? AND space_id=?`)
      .get(input.knowledgeBaseId, input.spaceId) as { vector_index_version: string } | undefined;
    if (persisted?.vector_index_version === target.vectorIndexVersion) {
      return { knowledgeBase: base, changed: false };
    }
    const now = new Date().toISOString();
    db.prepare(`UPDATE knowledge_base_embedding_profiles SET mode=?,updated_at=?
      WHERE knowledge_base_id=? AND space_id=? AND mode='primary'`)
      .run(input.previousMode, now, input.knowledgeBaseId, input.spaceId);
    db.prepare(`UPDATE knowledge_base_embedding_profiles SET mode='primary',state='ready',
      current_version=MAX(current_version,?),error=NULL,last_indexed_at=COALESCE(last_indexed_at,?),updated_at=?
      WHERE knowledge_base_id=? AND space_id=? AND vector_index_version=?`)
      .run(base.currentVersion, now, now, input.knowledgeBaseId, input.spaceId, target.vectorIndexVersion);
    db.prepare(`UPDATE knowledge_bases SET embedding_provider=?,embedding_model=?,embedding_revision=?,embedding_dtype=?,
      embedding_dimension=?,vector_index_version=?,updated_at=? WHERE id=? AND space_id=? AND deleted_at IS NULL`)
      .run(target.provider, target.model, target.revision, target.dtype, target.dimensions, target.vectorIndexVersion,
        now, input.knowledgeBaseId, input.spaceId);
    auditKnowledge({ spaceId: input.spaceId, knowledgeBaseId: input.knowledgeBaseId,
      actorUserId: input.actorUserId || null, action: input.action,
      detail: { from: persisted?.vector_index_version || base.embeddingProfile.vectorIndexVersion, to: target.vectorIndexVersion,
        activeDocumentCount: targetCoverage.total, qwenRollbackRetained: true,
        approvalId: input.approvalId || null, approvalReason: input.approvalReason || null } });
    return { knowledgeBase: getKnowledgeBase(input.knowledgeBaseId, input.spaceId)!, changed: true };
  })();
}

export function promoteKnowledgeBaseToGte(knowledgeBaseId: string, spaceId: string, approvalId: string) {
  if (config.knowledgeEmbeddingForceQwen) {
    throw new KnowledgeError('GTE promotion is disabled by the emergency Qwen rollback flag.',
      409, 'KNOWLEDGE_FORCE_QWEN_ACTIVE');
  }
  return db.transaction(() => {
    const lockedBase = lockKnowledgeBaseEmbeddingMutation(knowledgeBaseId, spaceId);
    if (!lockedBase) throw new KnowledgeError('Knowledge base not found.', 404, 'KNOWLEDGE_BASE_NOT_FOUND');
    const approvalRecord = getKnowledgePromotionApproval(approvalId);
    if (!approvalRecord || approvalRecord.knowledgeBaseId !== knowledgeBaseId || approvalRecord.spaceId !== spaceId) {
      throw new KnowledgeError('No durable base-scoped approval exists for this promotion.',
        409, 'KNOWLEDGE_EMBEDDING_PROMOTION_APPROVAL_REQUIRED');
    }
    const approval = verifiedPromotionApproval(approvalId, approvalRecord.backfillRunId, knowledgeBaseId);
    const result = switchKnowledgeBasePrimary({ knowledgeBaseId, spaceId,
      targetVectorIndexVersion: 'gte-modernbert-v1', previousMode: 'dual_write', actorUserId: approval.approvedBy,
      approvalId: approval.id, approvalReason: approval.approvalReason,
      action: 'knowledge_embedding.gte_promoted' });
    const consumed = db.prepare(`UPDATE knowledge_embedding_promotion_approvals SET state='consumed',consumed_at=?
      WHERE id=? AND state='approved'`).run(new Date().toISOString(), approval.id).changes;
    if (!consumed) throw new KnowledgeError('The promotion approval was consumed concurrently.',
      409, 'KNOWLEDGE_PROMOTION_APPROVAL_STATE');
    return result;
  })();
}

export function rollbackKnowledgeBaseToQwen(knowledgeBaseId: string, spaceId: string, actorUserId?: string | null) {
  return switchKnowledgeBasePrimary({ knowledgeBaseId, spaceId,
    targetVectorIndexVersion: 'qwen-v1', previousMode: 'dual_write', actorUserId,
    action: 'knowledge_embedding.qwen_rollback' });
}

export function promoteCompletedKnowledgeBackfill(id: string, approvalId: string) {
  const run = getKnowledgeBackfillRun(id);
  if (!run) throw new KnowledgeError('Knowledge backfill was not found.', 404, 'KNOWLEDGE_BACKFILL_NOT_FOUND');
  if (run.state !== 'completed' || run.targetVectorIndexVersion !== 'gte-modernbert-v1') {
    throw new KnowledgeError('Only a completed GTE backfill can be promoted.',
      409, 'KNOWLEDGE_BACKFILL_NOT_PROMOTABLE');
  }
  return db.transaction(() => {
    const bases = promotionBases(id);
    if (!bases.length) throw new KnowledgeError('The completed backfill contains no promotable bases.',
      409, 'KNOWLEDGE_PROMOTION_SCOPE_EMPTY');
    for (const base of bases) lockKnowledgeBaseEmbeddingMutation(base.knowledge_base_id, base.space_id);
    const approval = verifiedPromotionApproval(approvalId, id, null);
    const promotionId = crypto.randomUUID();
    const promoted = bases.map((base) => switchKnowledgeBasePrimary({
      knowledgeBaseId: base.knowledge_base_id, spaceId: base.space_id,
      targetVectorIndexVersion: 'gte-modernbert-v1', previousMode: 'dual_write',
      actorUserId: approval.approvedBy, approvalId: approval.id, approvalReason: approval.approvalReason,
      action: 'knowledge_embedding.gte_promoted'
    }));
    const consumedAt = new Date().toISOString();
    const consumed = db.prepare(`UPDATE knowledge_embedding_promotion_approvals SET state='consumed',consumed_at=?
      WHERE id=? AND state='approved'`).run(consumedAt, approval.id).changes;
    if (!consumed) throw new KnowledgeError('The promotion approval was consumed concurrently.',
      409, 'KNOWLEDGE_PROMOTION_APPROVAL_STATE');
    for (const base of bases) auditKnowledge({ spaceId: base.space_id, knowledgeBaseId: base.knowledge_base_id,
      actorUserId: approval.approvedBy, action: 'knowledge_embedding.promotion_committed',
      detail: { promotionId, approvalId: approval.id, backfillRunId: id, atomicBaseCount: bases.length } });
    return promoted;
  })();
}

recoverKnowledgeBackfills();

interface ClaimedBackfill {
  run: KnowledgeBackfillRun;
  item: KnowledgeBackfillItem;
}

function claimKnowledgeBackfillItem(ownerId: string): ClaimedBackfill | null {
  return db.transaction(() => {
    // Live indexing and deletion always outrank corpus migration work.
    if (db.prepare("SELECT 1 FROM knowledge_jobs WHERE state IN ('queued','processing') LIMIT 1").get()) return null;
    const now = new Date().toISOString(); const leaseToken = crypto.randomUUID();
    const leaseExpiresAt = new Date(Date.now() + config.knowledgeBackfillLeaseMs).toISOString();
    const lock = db.provider === 'postgres' ? ' FOR UPDATE OF item SKIP LOCKED' : '';
    const row = db.prepare(`SELECT item.* FROM knowledge_backfill_items item
      JOIN knowledge_backfill_runs run ON run.id=item.run_id
      WHERE run.state IN ('queued','running') AND item.state IN ('pending','queued')
        AND (item.next_attempt_at IS NULL OR item.next_attempt_at<=?)
      ORDER BY run.created_at,item.space_id,item.created_at,item.document_id LIMIT 1${lock}`).get(now) as any;
    if (!row) {
      const emptyRun = db.prepare(`SELECT id FROM knowledge_backfill_runs run WHERE state IN ('queued','running')
        AND NOT EXISTS (SELECT 1 FROM knowledge_backfill_items item WHERE item.run_id=run.id
          AND item.state IN ('pending','queued','processing')) ORDER BY created_at LIMIT 1`).get() as any;
      if (emptyRun) refreshBackfillRun(emptyRun.id);
      return null;
    }
    const changed = db.prepare(`UPDATE knowledge_backfill_items SET state='processing',attempt=attempt+1,
      error=NULL,next_attempt_at=NULL,lease_owner=?,lease_token=?,lease_generation=lease_generation+1,
      lease_acquired_at=?,lease_expires_at=?,heartbeat_at=?,updated_at=?
      WHERE run_id=? AND document_id=? AND state IN ('pending','queued')`)
      .run(ownerId, leaseToken, now, leaseExpiresAt, now, now, row.run_id, row.document_id).changes;
    if (!changed) return null;
    db.prepare(`UPDATE knowledge_backfill_runs SET state='running',started_at=COALESCE(started_at,?),
      cursor_document_id=?,error=NULL,updated_at=? WHERE id=? AND state IN ('queued','running')`)
      .run(now, row.document_id, now, row.run_id);
    return { run: getKnowledgeBackfillRun(row.run_id)!,
      item: rowItem(db.prepare('SELECT * FROM knowledge_backfill_items WHERE run_id=? AND document_id=?')
        .get(row.run_id, row.document_id)) };
  })();
}

function heartbeatBackfillLease(claimed: ClaimedBackfill) {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + config.knowledgeBackfillLeaseMs).toISOString();
  return db.prepare(`UPDATE knowledge_backfill_items SET heartbeat_at=?,lease_expires_at=?,updated_at=?
    WHERE run_id=? AND document_id=? AND state='processing' AND lease_owner=? AND lease_token=?
      AND lease_generation=?`).run(now, expiresAt, now, claimed.run.id, claimed.item.documentId,
        claimed.item.leaseOwner, claimed.item.leaseToken, claimed.item.leaseGeneration).changes === 1;
}

function refreshBackfillRun(id: string, preservePaused = true) {
  const current = getKnowledgeBackfillRun(id);
  if (!current) return null;
  const counts = db.prepare(`SELECT
      SUM(CASE WHEN state='completed' THEN 1 ELSE 0 END) completed,
      SUM(CASE WHEN state='failed' THEN 1 ELSE 0 END) failed,
      SUM(CASE WHEN state IN ('pending','queued','processing') THEN 1 ELSE 0 END) active
    FROM knowledge_backfill_items WHERE run_id=?`).get(id) as any;
  const completed = Number(counts?.completed || 0); const failed = Number(counts?.failed || 0);
  const active = Number(counts?.active || 0); const now = new Date().toISOString();
  const state: KnowledgeBackfillState = preservePaused && current.state === 'paused' ? 'paused'
    : active > 0 ? 'running' : failed > 0 ? 'failed' : 'completed';
  db.prepare(`UPDATE knowledge_backfill_runs SET state=?,completed_documents=?,failed_documents=?,
    error=CASE WHEN ?='failed' THEN COALESCE(error,'One or more documents failed to backfill.') ELSE error END,
    completed_at=CASE WHEN ? IN ('completed','failed') THEN COALESCE(completed_at,?) ELSE NULL END,updated_at=? WHERE id=?`)
    .run(state, completed, failed, state, state, now, now, id);
  return getKnowledgeBackfillRun(id);
}

function runtimeOperationId(run: KnowledgeBackfillRun, item: KnowledgeBackfillItem) {
  return `backfill_${crypto.createHash('sha256').update(`${run.id}\n${item.documentId}\n${item.cursorAfterKey}`)
    .digest('hex').slice(0, 40)}`;
}

function completeBackfillBatch(claimed: ClaimedBackfill, result: Awaited<ReturnType<typeof backfillKnowledgeIndex>>) {
  return db.transaction(() => {
    const now = new Date().toISOString();
    lockKnowledgeBaseEmbeddingMutation(claimed.item.knowledgeBaseId, claimed.item.spaceId);
    const document = db.prepare(`SELECT d.index_version,d.chunk_count,d.sha256,b.chunker_version FROM knowledge_documents d
      JOIN knowledge_bases b ON b.id=d.knowledge_base_id AND b.space_id=d.space_id
      WHERE d.id=? AND d.knowledge_base_id=? AND d.space_id=? AND d.deleted_at IS NULL`)
      .get(claimed.item.documentId, claimed.item.knowledgeBaseId, claimed.item.spaceId) as any;
    if (!document || document.sha256 !== claimed.item.sourceSha256
        || Number(document.index_version) !== claimed.item.sourceIndexVersion
        || document.chunker_version !== claimed.item.sourceChunkerVersion) {
      throw new KnowledgeError('The source document changed during backfill.', 409, 'KNOWLEDGE_BACKFILL_SOURCE_CHANGED');
    }
    if (result.complete && (result.coverage.canonicalCount !== Number(document.chunk_count || 0)
        || result.coverage.validSourceCount !== Number(document.chunk_count || 0)
        || result.coverage.validTargetCount !== Number(document.chunk_count || 0)
        || result.coverage.targetCount !== Number(document.chunk_count || 0)
        || result.coverage.exact !== true)) {
      throw new KnowledgeError('The signed GTE chunk manifest does not exactly match the hosted source document.',
        409, 'KNOWLEDGE_BACKFILL_COVERAGE_INVALID', false);
    }
    const noProgress = !result.complete && (result.processed < 1 || result.afterKey === claimed.item.cursorAfterKey
      || (claimed.item.remainingChunks != null && result.remaining > claimed.item.remainingChunks));
    if (noProgress) {
      const count = claimed.item.zeroProgressCount + 1;
      const terminal = count >= 5;
      const delay = Math.min(10 * 60_000, 5_000 * (2 ** Math.min(7, count - 1)));
      const changed = db.prepare(`UPDATE knowledge_backfill_items SET state=?,zero_progress_count=?,
        error='Knowledge runtime returned no forward backfill progress.',next_attempt_at=?,completed_at=?,
        lease_owner=NULL,lease_token=NULL,lease_acquired_at=NULL,lease_expires_at=NULL,heartbeat_at=NULL,updated_at=?
        WHERE run_id=? AND document_id=? AND state='processing' AND lease_owner=? AND lease_token=?
          AND lease_generation=?`).run(terminal ? 'failed' : 'queued', count,
          terminal ? null : new Date(Date.now() + delay).toISOString(), terminal ? now : null, now,
          claimed.run.id, claimed.item.documentId, claimed.item.leaseOwner, claimed.item.leaseToken,
          claimed.item.leaseGeneration).changes;
      if (!changed) return null;
      if (terminal) {
        db.prepare(`UPDATE knowledge_document_embeddings SET state='failed',error='Knowledge runtime made no progress.',updated_at=?
          WHERE document_id=? AND vector_index_version=?`).run(now, claimed.item.documentId,
            claimed.run.targetVectorIndexVersion);
      }
      return refreshBackfillRun(claimed.run.id);
    }
    const changed = db.prepare(`UPDATE knowledge_backfill_items SET state=?,attempt=0,zero_progress_count=0,cursor_after_key=?,
      processed_chunks=processed_chunks+?,written_chunks=written_chunks+?,remaining_chunks=?,error=NULL,
      next_attempt_at=NULL,runtime_metrics_json=?,runtime_attestation_json=?,runtime_attestation_sha256=?,
      last_progress_at=?,completed_at=?,lease_owner=NULL,lease_token=NULL,lease_acquired_at=NULL,
      lease_expires_at=NULL,heartbeat_at=NULL,updated_at=?
      WHERE run_id=? AND document_id=? AND state='processing' AND lease_owner=? AND lease_token=?
        AND lease_generation=?`).run(result.complete ? 'completed' : 'queued', result.afterKey,
        result.processed, result.written, result.remaining, JSON.stringify(result.metrics || {}),
        JSON.stringify(result.attestation), result.attestation.payloadSha256, now,
        result.complete ? now : null, now, claimed.run.id, claimed.item.documentId,
        claimed.item.leaseOwner, claimed.item.leaseToken, claimed.item.leaseGeneration).changes;
    if (!changed) return null;
    if (result.complete) {
      db.prepare(`UPDATE knowledge_document_embeddings SET state='ready',source_sha256=?,index_version=?,chunk_count=?,
        error=NULL,indexed_at=?,updated_at=? WHERE document_id=? AND vector_index_version=?`)
        .run(claimed.item.sourceSha256, claimed.item.sourceIndexVersion, document.chunk_count, now, now,
          claimed.item.documentId, claimed.run.targetVectorIndexVersion);
      const coverage = embeddingCoverage(claimed.item.knowledgeBaseId, claimed.item.spaceId,
        claimed.run.targetVectorIndexVersion);
      const ready = coverage.total === coverage.covered;
      db.prepare(`UPDATE knowledge_base_embedding_profiles SET state=?,current_version=MAX(current_version,?),
        error=NULL,last_indexed_at=CASE WHEN ?='ready' THEN ? ELSE last_indexed_at END,updated_at=?
        WHERE knowledge_base_id=? AND space_id=? AND vector_index_version=?`).run(ready ? 'ready' : 'indexing',
          claimed.item.sourceIndexVersion, ready ? 'ready' : 'indexing', now, now, claimed.item.knowledgeBaseId,
          claimed.item.spaceId, claimed.run.targetVectorIndexVersion);
    }
    return refreshBackfillRun(claimed.run.id);
  })();
}

function failBackfillBatch(claimed: ClaimedBackfill, error: unknown) {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
  const retryable = error instanceof KnowledgeError && error.retryable
    && (error.status === 429 || error.status >= 500 || error.code.includes('RUNTIME'));
  const staleSource = error instanceof KnowledgeError
    && (error.code === 'BACKFILL_SOURCE_INVALID' || error.code === 'BACKFILL_TARGET_INVALID'
      || error.code === 'KNOWLEDGE_BACKFILL_SOURCE_CHANGED' || error.code === 'KNOWLEDGE_BACKFILL_COVERAGE_INVALID');
  // A runtime-attested source/profile mismatch cannot heal by retrying the same
  // immutable snapshot. Fail it immediately so an operator can create a fresh
  // run from the new source corpus; ordinary deterministic errors stay bounded.
  const terminal = staleSource || (!retryable && claimed.item.attempt >= 3);
  const delay = Math.min(10 * 60_000, 5_000 * (2 ** Math.min(7, Math.max(0, claimed.item.attempt - 1))));
  return db.transaction(() => {
    const now = new Date().toISOString();
    const current = getKnowledgeBackfillRun(claimed.run.id);
    const changed = db.prepare(`UPDATE knowledge_backfill_items SET state=?,error=?,next_attempt_at=?,completed_at=?,
      lease_owner=NULL,lease_token=NULL,lease_acquired_at=NULL,lease_expires_at=NULL,heartbeat_at=NULL,updated_at=?
      WHERE run_id=? AND document_id=? AND state='processing' AND lease_owner=? AND lease_token=?
        AND lease_generation=?`).run(terminal ? 'failed' : 'queued', message,
        terminal ? null : new Date(Date.now() + delay).toISOString(), terminal ? now : null, now,
        claimed.run.id, claimed.item.documentId, claimed.item.leaseOwner, claimed.item.leaseToken,
        claimed.item.leaseGeneration).changes;
    if (!changed) return null;
    if (terminal) {
      db.prepare(`UPDATE knowledge_document_embeddings SET state='failed',error=?,updated_at=?
        WHERE document_id=? AND vector_index_version=?`).run(message, now, claimed.item.documentId,
          claimed.run.targetVectorIndexVersion);
      db.prepare(`UPDATE knowledge_base_embedding_profiles SET state='degraded',error=?,updated_at=?
        WHERE knowledge_base_id=? AND space_id=? AND vector_index_version=?`).run(message, now,
          claimed.item.knowledgeBaseId, claimed.item.spaceId, claimed.run.targetVectorIndexVersion);
    }
    db.prepare(`UPDATE knowledge_backfill_runs SET state=?,error=?,updated_at=? WHERE id=?`)
      .run(current?.state === 'paused' ? 'paused' : terminal ? 'failed' : 'queued', message, now, claimed.run.id);
    return refreshBackfillRun(claimed.run.id);
  })();
}

export class KnowledgeBackfillCoordinator {
  private timer: NodeJS.Timeout | null = null;
  private active = false;
  private stopped = true;
  readonly ownerId: string;

  constructor(ownerId = `experience-backfill-${process.pid}-${crypto.randomUUID()}`) {
    this.ownerId = ownerId;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.timer = setInterval(() => void this.pump(), config.knowledgeBackfillPollMs);
    this.timer.unref();
    void this.pump();
  }

  async runOne() {
    if (this.active) return null;
    recoverKnowledgeBackfills();
    const claimed = claimKnowledgeBackfillItem(this.ownerId);
    if (!claimed) return null;
    this.active = true;
    let leaseHeld = true;
    const heartbeat = setInterval(() => { leaseHeld = heartbeatBackfillLease(claimed); },
      config.knowledgeBackfillHeartbeatMs);
    heartbeat.unref();
    try {
      if (claimed.item.targetEmbeddingProfile?.provider !== 'gte-node') {
        throw new KnowledgeError('The GTE target profile is no longer configured.',
          409, 'KNOWLEDGE_BACKFILL_TARGET_UNAVAILABLE');
      }
      const result = await backfillKnowledgeIndex({
        jobId: runtimeOperationId(claimed.run, claimed.item),
        spaceId: claimed.item.spaceId,
        knowledgeBaseId: claimed.item.knowledgeBaseId,
        documentId: claimed.item.documentId,
        sourceIndexVersion: claimed.item.sourceIndexVersion,
        sourceSha256: claimed.item.sourceSha256,
        sourceChunkerVersion: claimed.item.sourceChunkerVersion,
        sourceEmbeddingProfile: claimed.item.sourceEmbeddingProfile,
        afterKey: claimed.item.cursorAfterKey,
        batchSize: claimed.run.batchSize,
        targetEmbeddingProfile: claimed.item.targetEmbeddingProfile
      });
      if (!leaseHeld || !heartbeatBackfillLease(claimed)) return null;
      return completeBackfillBatch(claimed, result);
    } catch (error) {
      if (!leaseHeld) return null;
      return failBackfillBatch(claimed, error);
    } finally {
      clearInterval(heartbeat);
      this.active = false;
    }
  }

  async pump() {
    if (this.stopped || this.active) return;
    const result = await this.runOne();
    if (result && !this.stopped) queueMicrotask(() => void this.pump());
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async drain(timeoutMs = 8_000) {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    while (this.active && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    return !this.active;
  }

  status() {
    const counts = db.prepare(`SELECT state,COUNT(*) count FROM knowledge_backfill_runs GROUP BY state`).all() as Array<{
      state: string; count: number;
    }>;
    return { running: !this.stopped, active: this.active,
      runs: Object.fromEntries(counts.map((row) => [row.state, Number(row.count)])) };
  }
}

export const knowledgeBackfillCoordinator = new KnowledgeBackfillCoordinator();
