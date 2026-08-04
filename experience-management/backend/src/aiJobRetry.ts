import crypto from 'node:crypto';
import { socialListeningResultFor } from './aiSchemas.js';
import {
  db, getJobForSpace, getJobProviderResult, listSocialMentionsByIdsForSpace
} from './database.js';
import { publishEvent } from './events.js';
import { intelligenceExecutionInput, validateSocialListeningEvidence } from './intelligence.js';
import { pinnedKnowledgeRefs } from './knowledgeContext.js';
import { getKnowledgeContext, resolveKnowledgeBaseRefs } from './knowledgeRepository.js';
import type { AiJob } from './types.js';

const maximumManualRetries = 3;

type RetryHistoryEntry = {
  generation: number;
  attempt: number;
  failedAt: string;
  retriedAt: string;
  retriedBy: string;
  error: string | null;
  providerJournalRetained: boolean;
  sourceIdsSha256: string;
};

export class AiJobRetryError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 409, code = 'AI_JOB_RETRY_UNAVAILABLE') {
    super(message);
    this.name = 'AiJobRetryError';
    this.status = status;
    this.code = code;
  }
}

function explicitMentionIds(job: AiJob) {
  return Array.isArray(job.input.mentionIds)
    ? [...new Set(job.input.mentionIds.map(String).filter(Boolean))]
    : [];
}

function unsupportedReason(job: AiJob) {
  if (job.kind === 'social.report') return 'Retry this report from its Social listening report card.';
  if (job.kind.startsWith('assistant.')) return 'Private assistant runs do not yet support retry from the shared AI queue.';
  if (job.kind === 'social.reply_draft') {
    return 'This activity requires a paired artifact retry and cannot be retried from the AI queue.';
  }
  return 'This activity does not have a retry-safe immutable source snapshot. Start a new request instead.';
}

export function aiJobRetryStatus(job: AiJob, viewerUserId: string) {
  if (job.kind.startsWith('assistant.') && job.requestedBy !== viewerUserId) {
    return { eligible: false, reason: 'This private assistant job is not available to this user.' };
  }
  if (!['social.analyze', 'intelligence.synthesize'].includes(job.kind)) {
    return { eligible: false, reason: unsupportedReason(job) };
  }
  if (job.kind === 'social.analyze' && !explicitMentionIds(job).length) {
    return { eligible: false, reason: 'This legacy analysis has no explicit durable source IDs. Start a new analysis instead.' };
  }
  if (job.state === 'completed') return { eligible: false, reason: 'Completed jobs cannot be retried.' };
  if (job.state === 'queued' || job.state === 'processing') {
    return { eligible: false, reason: 'This job is already queued or processing.' };
  }
  if (manualRetryCount(job) >= maximumManualRetries) {
    return { eligible: false, reason: 'This job has reached its limit of three manual retries.' };
  }
  try {
    if (job.kind === 'intelligence.synthesize') intelligencePreflight(job, viewerUserId);
    else preflight(job, viewerUserId);
  } catch (error) {
    return {
      eligible: false,
      reason: error instanceof Error ? error.message : 'The durable sources for this job are unavailable.'
    };
  }
  return { eligible: true, reason: null };
}

function generation(job: AiJob) {
  const value = Number(job.input.terraExecutionGeneration ?? 0);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function manualRetryCount(job: AiJob) {
  const value = Number(job.input.terraManualRetryCount ?? 0);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function sourcePreflight(job: AiJob) {
  const ids = explicitMentionIds(job);
  if (!ids.length || ids.length > 50) {
    throw new AiJobRetryError(
      'This social analysis has no retry-safe explicit source set. Start a new analysis instead.',
      409,
      'AI_JOB_SOURCE_SNAPSHOT_UNAVAILABLE'
    );
  }
  const mentions = listSocialMentionsByIdsForSpace(ids, job.spaceId);
  if (mentions.length !== ids.length) {
    throw new AiJobRetryError(
      'One or more source posts for this analysis no longer exist in this space.',
      409,
      'AI_JOB_SOURCE_SNAPSHOT_UNAVAILABLE'
    );
  }
  const byId = new Map(mentions.map((mention) => [mention.id, mention]));
  return ids.map((id) => byId.get(id)!);
}

function knowledgePreflight(job: AiJob, viewerUserId: string) {
  const refs = pinnedKnowledgeRefs(job.input);
  if (!refs.length || getKnowledgeContext(job.id, job.spaceId)) return;
  resolveKnowledgeBaseRefs(job.spaceId, refs.map((ref) => ref.id), {
    requireTerra: true,
    viewerUserId: job.requestedBy || viewerUserId,
    allowPrivate: false
  });
}

function preflight(job: AiJob, viewerUserId: string) {
  const mentions = sourcePreflight(job);
  knowledgePreflight(job, viewerUserId);
  return mentions;
}

function intelligencePreflight(job: AiJob, viewerUserId: string) {
  const reportId = String(job.input.reportId || '');
  const row = db.prepare(`SELECT id,state,ai_job_id FROM intelligence_reports
    WHERE id=? AND space_id=?`).get(reportId, job.spaceId) as { id: string; state: string; ai_job_id: string | null } | undefined;
  if (!row || row.ai_job_id !== job.id) {
    throw new AiJobRetryError('The immutable intelligence artifact for this job is unavailable.', 409,
      'AI_JOB_SOURCE_SNAPSHOT_UNAVAILABLE');
  }
  if (row.state !== 'failed') {
    throw new AiJobRetryError('Only a failed intelligence analysis can be retried.', 409, 'AI_JOB_NOT_FAILED');
  }
  const execution = intelligenceExecutionInput(reportId, job.spaceId);
  const knowledgeRefs = pinnedKnowledgeRefs(job.input);
  if (execution.sources.length + knowledgeRefs.length < 2) {
    throw new AiJobRetryError('This analysis no longer has at least two immutable evidence sources.', 409,
      'AI_JOB_SOURCE_SNAPSHOT_UNAVAILABLE');
  }
  knowledgePreflight(job, viewerUserId);
  return [
    ...execution.sources.map((source) => source.ref),
    ...knowledgeRefs.map((ref) => `knowledge-base:${ref.id}`)
  ];
}

function validProviderJournal(job: AiJob, mentions: ReturnType<typeof sourcePreflight>) {
  const journal = getJobProviderResult(job.id);
  if (journal?.activity !== 'experience.social_listening' || journal.schemaName !== 'experience_social_listening') return null;
  const sourceRefs = mentions.map((mention) => mention.id);
  const parsed = socialListeningResultFor(sourceRefs).safeParse(journal.output);
  if (!parsed.success) return null;
  try {
    validateSocialListeningEvidence(
      mentions.map((mention) => ({ sourceRef: mention.id, content: mention.content })),
      parsed.data
    );
    return { ...journal, output: parsed.data };
  } catch {
    return null;
  }
}

function retryHistory(job: AiJob, entry: RetryHistoryEntry) {
  const prior = Array.isArray(job.input.terraManualRetryHistory)
    ? job.input.terraManualRetryHistory.filter((value) => value && typeof value === 'object').slice(-19)
    : [];
  return [...prior, entry];
}

export function retryFailedAiJob(jobId: string, spaceId: string, viewerUserId: string) {
  const retried = db.transaction(() => {
    const lock = db.provider === 'postgres' ? ' FOR UPDATE' : '';
    const locked = db.prepare(`SELECT id FROM ai_jobs WHERE id=? AND space_id=?
      AND (kind NOT LIKE 'assistant.%' OR requested_by=?)${lock}`).get(jobId, spaceId, viewerUserId);
    if (!locked) throw new AiJobRetryError('AI job not found.', 404, 'AI_JOB_NOT_FOUND');
    const job = getJobForSpace(jobId, spaceId, viewerUserId)!;
    if (!['social.analyze', 'intelligence.synthesize'].includes(job.kind)) {
      throw new AiJobRetryError(unsupportedReason(job), 409, 'AI_JOB_RETRY_UNSUPPORTED');
    }
    if (job.state === 'completed') {
      throw new AiJobRetryError('Completed jobs cannot be retried.', 409, 'AI_JOB_ALREADY_COMPLETED');
    }
    if (job.state === 'queued' || job.state === 'processing') {
      return { job, restarted: false, journalReused: false };
    }
    if (job.state !== 'failed') {
      throw new AiJobRetryError('Only a failed AI job can be retried.', 409, 'AI_JOB_NOT_FAILED');
    }
    const priorManualRetries = manualRetryCount(job);
    if (priorManualRetries >= maximumManualRetries) {
      throw new AiJobRetryError(
        'This job has reached its limit of three manual retries.',
        409,
        'AI_JOB_RETRY_EXHAUSTED'
      );
    }

    if (job.kind === 'intelligence.synthesize') {
      const sourceRefs = intelligencePreflight(job, viewerUserId);
      const currentGeneration = generation(job);
      if (currentGeneration >= Number.MAX_SAFE_INTEGER) {
        throw new AiJobRetryError('This analysis has exhausted its safe retry identities.', 409, 'AI_JOB_RETRY_EXHAUSTED');
      }
      const timestamp = new Date().toISOString();
      const historyEntry: RetryHistoryEntry = {
        generation: currentGeneration,
        attempt: job.attempt,
        failedAt: job.completedAt || job.updatedAt,
        retriedAt: timestamp,
        retriedBy: viewerUserId,
        error: job.error ? job.error.slice(0, 1_000) : null,
        providerJournalRetained: false,
        sourceIdsSha256: crypto.createHash('sha256').update(JSON.stringify(sourceRefs)).digest('hex')
      };
      const nextInput = {
        ...job.input,
        terraExecutionGeneration: currentGeneration + 1,
        terraExecutionReason: 'manual_retry',
        terraCorrectionRequired: false,
        terraSemanticCorrectionCount: 0,
        terraManualRetryCount: priorManualRetries + 1,
        terraManualRetryHistory: retryHistory(job, historyEntry)
      };
      const jobChanged = db.prepare(`UPDATE ai_jobs SET state='queued',stage='queued',progress=0,attempt=0,result_json=NULL,error=NULL,
        retry_at=NULL,started_at=NULL,completed_at=NULL,provider_result_json=NULL,input_json=?,updated_at=?
        WHERE id=? AND space_id=? AND kind='intelligence.synthesize' AND state='failed'`)
        .run(JSON.stringify(nextInput), timestamp, job.id, job.spaceId).changes;
      const reportChanged = db.prepare(`UPDATE intelligence_reports SET state='queued',result_json=NULL,runtime_json=NULL,error=NULL,
        completed_at=NULL,updated_at=? WHERE id=? AND space_id=? AND ai_job_id=? AND state='failed'`)
        .run(timestamp, String(job.input.reportId || ''), job.spaceId, job.id).changes;
      if (jobChanged !== 1 || reportChanged !== 1) {
        throw new AiJobRetryError('The analysis changed while it was being retried.', 409, 'AI_JOB_RETRY_CONFLICT');
      }
      return {
        job: getJobForSpace(job.id, job.spaceId, viewerUserId)!,
        restarted: true,
        journalReused: false
      };
    }

    // This is intentionally a full preflight, not only a count check: the
    // original explicit IDs must all still resolve inside the same space.
    const mentions = preflight(job, viewerUserId);
    const retainedJournal = validProviderJournal(job, mentions);
    const currentGeneration = generation(job);
    if (currentGeneration >= Number.MAX_SAFE_INTEGER) {
      throw new AiJobRetryError('This job has exhausted its safe Terra retry identities.', 409, 'AI_JOB_RETRY_EXHAUSTED');
    }
    const timestamp = new Date().toISOString();
    const historyEntry: RetryHistoryEntry = {
      generation: currentGeneration,
      attempt: job.attempt,
      failedAt: job.completedAt || job.updatedAt,
      retriedAt: timestamp,
      retriedBy: viewerUserId,
      error: job.error ? job.error.slice(0, 1_000) : null,
      providerJournalRetained: Boolean(retainedJournal),
      sourceIdsSha256: crypto.createHash('sha256').update(JSON.stringify(explicitMentionIds(job))).digest('hex')
    };
    const nextInput = {
      ...job.input,
      terraExecutionGeneration: currentGeneration + 1,
      terraExecutionReason: 'manual_retry',
      terraCorrectionRequired: false,
      terraSemanticCorrectionCount: 0,
      terraManualRetryCount: priorManualRetries + 1,
      terraManualRetryHistory: retryHistory(job, historyEntry)
    };
    const changed = db.prepare(`UPDATE ai_jobs SET state='queued',stage='queued',progress=0,attempt=0,result_json=NULL,error=NULL,
      retry_at=NULL,started_at=NULL,completed_at=NULL,provider_result_json=?,input_json=?,updated_at=?
      WHERE id=? AND space_id=? AND kind='social.analyze' AND state='failed'`)
      .run(retainedJournal ? JSON.stringify(retainedJournal) : null, JSON.stringify(nextInput), timestamp, job.id, job.spaceId).changes;
    if (changed !== 1) throw new AiJobRetryError('The job changed while it was being retried.', 409, 'AI_JOB_RETRY_CONFLICT');
    return {
      job: getJobForSpace(job.id, job.spaceId, viewerUserId)!,
      restarted: true,
      journalReused: Boolean(retainedJournal)
    };
  })();
  publishEvent('ai-job', retried.job, spaceId);
  publishEvent('data-changed', { reason: 'ai-job-retried', jobId }, spaceId);
  return retried;
}
