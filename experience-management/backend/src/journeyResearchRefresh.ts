import crypto from 'node:crypto';
import { config } from './config.js';
import { db } from './database.js';
import { runJourneyResearchRefreshBatch } from './journeyResearchHub.js';

export function journeyResearchRefreshStatus(spaceId: string) {
  const rows = db.prepare(`SELECT state,COUNT(*) count FROM journey_research_refresh_runs
    WHERE space_id=? GROUP BY state`).all(spaceId) as Array<{ state: string; count: number | string }>;
  const counts = Object.fromEntries(rows.map((row) => [row.state, Number(row.count)]));
  return {
    queued: Number(counts.queued || 0), leased: Number(counts.leased || 0),
    retryWait: Number(counts.retry_wait || 0), failed: Number(counts.failed || 0)
  };
}

export class JourneyResearchRefreshRunner {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = true;
  readonly ownerId: string;

  constructor(ownerId = `journey-research-${process.pid}-${crypto.randomUUID()}`) { this.ownerId = ownerId; }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.timer = setInterval(() => this.pump(), config.journeyResearchRefreshPollMs);
    this.timer.unref();
    this.pump();
  }

  pump() {
    if (this.stopped || this.running) return;
    this.running = true;
    try {
      runJourneyResearchRefreshBatch({
        leaseOwner: this.ownerId, leaseMs: config.journeyResearchRefreshLeaseMs,
        limit: config.journeyResearchRefreshBatchSize
      });
    } catch {
      // The work is durable and the next poll will reclaim/retry. Never log a
      // source exception here because it may contain provider or content data.
    } finally { this.running = false; }
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async drain(timeoutMs = 8_000) {
    const deadline = Date.now() + timeoutMs;
    while (this.running && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
    return !this.running;
  }

  status(spaceId: string) {
    return { running: !this.stopped, active: this.running ? 1 : 0, ...journeyResearchRefreshStatus(spaceId) };
  }
}

export const journeyResearchRefreshRunner = new JourneyResearchRefreshRunner();
