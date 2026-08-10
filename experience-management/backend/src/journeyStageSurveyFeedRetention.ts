import crypto from 'node:crypto';
import { db } from './database.js';
import { journeyStageSurveyFeedRepository } from './journeyStageSurveyFeedRepository.js';

type Purger = (spaceId: string, asOf: string) => { purgedCount: number; hasMore: boolean };

/** Bounded cursor coordinator. The cursor advances even when a tenant fails, so
 * a corrupt or temporarily unavailable early tenant cannot starve later ones. */
export function purgeExpiredJourneyStageSurveyFeed(asOf = new Date().toISOString(), limit = 100,
  afterSpaceId: string | null = null, purge: Purger = (spaceId, at) =>
    journeyStageSurveyFeedRepository.purgeExpired({ spaceId, now: at, limit: 500 })) {
  const bounded = Math.max(1, Math.min(100, limit));
  const spaces: Array<{ space_id: string }> = db.prepare(`SELECT DISTINCT space_id
    FROM journey_stage_survey_governance_receipts WHERE retention_expires_at<=? AND space_id>?
    ORDER BY space_id LIMIT ?`).all(asOf, afterSpaceId || '', bounded + 1) as Array<{ space_id: string }>;
  const page = spaces.slice(0, bounded); let purgedCount = 0; let spacesPurged = 0; let failedSpaces = 0;
  const failureFingerprints: string[] = [];
  for (const row of page) {
    try { const result = purge(row.space_id, asOf); purgedCount += result.purgedCount; spacesPurged += 1; }
    catch (error) {
      failedSpaces += 1; const message = error instanceof Error ? `${error.name}:${error.message}` : String(error);
      failureFingerprints.push(crypto.createHash('sha256').update(message.slice(0, 2_000)).digest('hex'));
    }
  }
  return { spacesScanned: page.length, spacesPurged, failedSpaces, purgedCount,
    failureFingerprints, nextCursor: spaces.length > bounded ? page.at(-1)?.space_id || null : null };
}

type RetentionRun = typeof purgeExpiredJourneyStageSurveyFeed;
type RetentionTelemetry = (level: 'info' | 'error', detail: Record<string, unknown>) => void;

export class JourneyStageSurveyFeedRetentionWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = true;
  private afterSpaceId: string | null = null;

  constructor(private readonly intervalMs = 60_000,
    private readonly runRetention: RetentionRun = purgeExpiredJourneyStageSurveyFeed,
    private readonly emit: RetentionTelemetry = (level, detail) => {
      const line = JSON.stringify({ component: 'journey-stage-survey-feed-retention', ...detail });
      if (level === 'error') console.error(line); else console.info(line);
    }) {}

  start() {
    if (!this.stopped) return;
    this.stopped = false; this.timer = setInterval(() => { this.runOnce(); }, this.intervalMs);
    this.timer.unref(); this.runOnce();
  }

  runOnce(asOf = new Date().toISOString()) {
    if (this.stopped || this.running) return null;
    this.running = true;
    try {
      const result = this.runRetention(asOf, 100, this.afterSpaceId);
      this.afterSpaceId = result.nextCursor;
      if (result.purgedCount || result.failedSpaces) this.emit('info', {
        event: 'survey_feed_retention_pass', spacesScanned: result.spacesScanned,
        spacesPurged: result.spacesPurged, failedSpaces: result.failedSpaces, purgedCount: result.purgedCount,
        failureFingerprints: result.failureFingerprints.slice(0, 100)
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? `${error.name}:${error.message}` : String(error);
      this.emit('error', { event: 'survey_feed_retention_pass_failed',
        errorFingerprint: crypto.createHash('sha256').update(message.slice(0, 2_000)).digest('hex') });
      return null;
    } finally { this.running = false; }
  }

  stop() { this.stopped = true; if (this.timer) clearInterval(this.timer); this.timer = null; }
  async drain(timeoutMs = 8_000) {
    const deadline = Date.now() + timeoutMs;
    while (this.running && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    return !this.running;
  }
}

export const journeyStageSurveyFeedRetentionWorker = new JourneyStageSurveyFeedRetentionWorker();
