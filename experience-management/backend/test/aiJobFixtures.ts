import crypto from 'node:crypto';
import { db, getJob, insertUnadmittedAiJobRecord } from '../src/database.js';
import type { AiJob } from '../src/types.js';

/** Deliberately bypasses usage admission for tests that exercise downstream
 * execution, migration, privacy, or queue behavior in isolation. */
export function createAiJobFixture(kind: AiJob['kind'], input: Record<string, unknown>, spaceId: string,
  surveyId?: string | null, responseId?: string | null, requestedBy?: string | null) {
  return insertUnadmittedAiJobRecord({
    id: crypto.randomUUID(), kind, jobInput: input, spaceId, surveyId, responseId, requestedBy
  });
}

/** Claims without metering solely for the legacy fairness unit contract. The
 * production worker always uses claimNextAdmittedAiJob. */
export const claimNextAiJobFixture = db.transaction((): AiJob | null => {
  const now = new Date().toISOString();
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
    LIMIT 1${lock}`).get(now, now) as { id: string } | undefined;
  if (!row) return null;
  const changed = db.prepare(`UPDATE ai_jobs SET state='processing',stage='dispatching',progress=5,
    attempt=attempt+1,started_at=?,updated_at=? WHERE id=? AND state='queued'`).run(now, now, row.id).changes;
  return changed ? getJob(row.id) : null;
});
