import crypto from 'node:crypto';
import {
  db, getJob, insertUnadmittedAiJobRecord
} from './database.js';
import {
  reserveExistingDurableAiJobAttempt, reserveNewDurableAiJob, SubscriptionEntitlementError
} from './subscriptionEntitlements.js';
import type { AiJob, AiJobKind } from './types.js';

export function aiJobExecutionGeneration(input: Record<string, unknown>) {
  const value = Number(input.terraExecutionGeneration ?? 0);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/** The only production entry point for creating durable AI work. The usage
 * event, materialized bucket, and queue row share one database transaction. */
export function createAdmittedAiJob(kind: AiJobKind, input: Record<string, unknown>, spaceId: string,
  surveyId?: string | null, responseId?: string | null, requestedBy?: string | null,
  admittedAt: Date | string = new Date()) {
  const id = crypto.randomUUID();
  const instant = admittedAt instanceof Date ? new Date(admittedAt.getTime()) : new Date(admittedAt);
  if (!Number.isFinite(instant.getTime())) throw new TypeError('AI job admission requires a valid date.');
  const createdAt = instant.toISOString();
  const generation = aiJobExecutionGeneration(input);
  return db.transaction(() => {
    reserveNewDurableAiJob({
      jobId: id,
      spaceId,
      kind,
      requestedBy: requestedBy || null,
      generation,
      attempt: 1,
      now: createdAt
    });
    return insertUnadmittedAiJobRecord({
      id, kind, jobInput: input, spaceId, surveyId, responseId, requestedBy, createdAt
    });
  })();
}

export function reserveAiJobRetryAttempt(job: AiJob, generation = aiJobExecutionGeneration(job.input),
  attempt = job.attempt + 1, now?: Date | string) {
  return reserveExistingDurableAiJobAttempt({
    jobId: job.id,
    spaceId: job.spaceId,
    generation,
    attempt,
    now
  });
}

export type AdmittedAiJobClaim = {
  job: AiJob;
  denied: false;
} | {
  job: AiJob;
  denied: true;
  error: SubscriptionEntitlementError;
};

/** Preserve the established cross-space FIFO/fairness selection while making
 * the per-execution reservation a prerequisite for dispatch. */
export const claimNextAdmittedAiJob = db.transaction((claimAt: Date | string = new Date()): AdmittedAiJobClaim | null => {
  const instant = claimAt instanceof Date ? new Date(claimAt.getTime()) : new Date(claimAt);
  if (!Number.isFinite(instant.getTime())) throw new TypeError('AI job claim requires a valid date.');
  const now = instant.toISOString();
  const lock = db.provider === 'postgres' ? ' FOR UPDATE OF candidate SKIP LOCKED' : '';
  const row = db.prepare(`SELECT candidate.* FROM ai_jobs candidate
    WHERE candidate.state='queued' AND (candidate.retry_at IS NULL OR candidate.retry_at<=?)
      AND candidate.id=(
        SELECT queued.id FROM ai_jobs queued
        WHERE queued.space_id=candidate.space_id AND queued.state='queued' AND (queued.retry_at IS NULL OR queued.retry_at<=?)
        ORDER BY queued.created_at,queued.rowid LIMIT 1
      )
    ORDER BY
      (SELECT COUNT(*) FROM ai_jobs active WHERE active.space_id=candidate.space_id AND active.state='processing'),
      COALESCE((SELECT MAX(started_at) FROM ai_jobs served
        WHERE served.space_id=candidate.space_id AND served.started_at IS NOT NULL),''),
      candidate.created_at,candidate.rowid
    LIMIT 1${lock}`).get(now, now) as any;
  if (!row) return null;
  const job = getJob(String(row.id));
  if (!job) return null;
  try {
    reserveAiJobRetryAttempt(job, aiJobExecutionGeneration(job.input), job.attempt + 1, now);
  } catch (error) {
    if (!(error instanceof SubscriptionEntitlementError) || error.code !== 'SUBSCRIPTION_QUOTA_EXCEEDED') throw error;
    const message = error.message.slice(0, 1_000);
    db.prepare(`UPDATE ai_jobs SET state='failed',stage='subscription_quota_exceeded',progress=100,error=?,
      retry_at=NULL,completed_at=?,updated_at=? WHERE id=? AND state='queued'`).run(message, now, now, job.id);
    return { job: getJob(job.id)!, denied: true, error };
  }
  const changed = db.prepare(`UPDATE ai_jobs SET state='processing',stage='dispatching',progress=5,
    attempt=attempt+1,started_at=?,updated_at=? WHERE id=? AND state='queued'`).run(now, now, job.id).changes;
  return changed ? { job: getJob(job.id)!, denied: false } : null;
});
