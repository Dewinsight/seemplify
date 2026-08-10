import crypto from 'node:crypto';
import type { DatabaseRuntime } from './databaseAdapter.js';
import type { JourneyOperationalStageFeedRepository } from './journeyOperationalStageFeedRepository.js';

type Repository = Pick<JourneyOperationalStageFeedRepository, 'purgeExpired'>;
type Telemetry = (level: 'info' | 'error', detail: Record<string, unknown>) => void;

function fingerprint(error: unknown) {
  const message = error instanceof Error ? `${error.name}:${error.message}` : String(error);
  return crypto.createHash('sha256').update(message.slice(0, 2_000)).digest('hex');
}

export function purgeExpiredJourneyOperationalStageFeed(input: { runtime: DatabaseRuntime; repository: Repository;
  spaceIds: readonly string[]; asOf?: Date | string; limit?: number; afterSpaceId?: string | null }) {
  const at = new Date(input.asOf || new Date()).toISOString();
  const limit = Math.max(1, Math.min(100, input.limit || 100));
  const allowed = [...new Set(input.spaceIds)].sort();
  if (!allowed.length || allowed.length > 100) throw new Error('Operational feed retention requires an explicit bounded tenant scope.');
  const placeholders = allowed.map(() => '?').join(',');
  const candidates = input.runtime.prepare(`SELECT DISTINCT space_id FROM journey_operational_stage_source_revisions
    WHERE retention_expires_at<=? AND space_id>? AND space_id IN (${placeholders}) ORDER BY space_id LIMIT ?`)
    .all(at, input.afterSpaceId || '', ...allowed, limit + 1) as Array<{ space_id: string }>;
  const page = candidates.slice(0, limit); let purgedCount = 0; let spacesPurged = 0; let failedSpaces = 0;
  const failureFingerprints: string[] = [];
  for (const row of page) {
    try { const result = input.repository.purgeExpired({ spaceId: row.space_id, now: at, limit: 500 });
      purgedCount += result.purgedCount; spacesPurged += 1; }
    catch (error) { failedSpaces += 1; failureFingerprints.push(fingerprint(error)); }
  }
  return { spacesScanned: page.length, spacesPurged, failedSpaces, purgedCount, failureFingerprints,
    nextCursor: candidates.length > limit ? page.at(-1)?.space_id || null : null };
}

export class JourneyOperationalStageFeedRetentionWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = true;
  private afterSpaceId: string | null = null;

  constructor(private readonly runRetention: (afterSpaceId: string | null, asOf?: Date | string) => ReturnType<
    typeof purgeExpiredJourneyOperationalStageFeed>, private readonly intervalMs = 60_000,
    private readonly emit: Telemetry = (level, detail) => {
      const line = JSON.stringify({ component: 'journey-operational-stage-feed-retention', ...detail });
      if (level === 'error') console.error(line); else console.info(line);
    }) {}

  start() { if (!this.stopped) return; this.stopped = false;
    this.timer = setInterval(() => { this.runOnce(); }, Math.max(1_000, Math.min(86_400_000, this.intervalMs)));
    this.timer.unref(); this.runOnce(); }

  runOnce(asOf: Date | string = new Date()) {
    if (this.running) return null; this.running = true;
    try { const result = this.runRetention(this.afterSpaceId, asOf); this.afterSpaceId = result.nextCursor;
      if (result.purgedCount || result.failedSpaces) this.emit('info', { event: 'operational_feed_retention_pass',
        spacesScanned: result.spacesScanned, spacesPurged: result.spacesPurged, failedSpaces: result.failedSpaces,
        purgedCount: result.purgedCount, failureFingerprints: result.failureFingerprints.slice(0, 100) });
      return result;
    } catch (error) { this.emit('error', { event: 'operational_feed_retention_pass_failed',
      errorFingerprint: fingerprint(error) }); return null; }
    finally { this.running = false; }
  }

  stop() { this.stopped = true; if (this.timer) clearInterval(this.timer); this.timer = null; }
  async drain(timeoutMs = 8_000) { const deadline = Date.now() + timeoutMs;
    while (this.running && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10)); return !this.running; }
}
