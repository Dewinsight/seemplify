import crypto from 'node:crypto';
import { purgeExpiredJourneyStageIntelligenceFacts } from './journeyStageIntelligenceSqlRepository.js';

type RetentionOutcome = ReturnType<typeof purgeExpiredJourneyStageIntelligenceFacts>;
type RetentionRun = (asOf?: string, limit?: number, afterSpaceId?: string | null) => RetentionOutcome;
type RetentionTelemetry = (level: 'info' | 'error', event: Record<string, unknown>) => void;

function defaultTelemetry(level: 'info' | 'error', event: Record<string, unknown>) {
  const line = JSON.stringify({ component: 'journey-stage-intelligence-retention', ...event });
  if (level === 'error') console.error(line); else console.info(line);
}

function errorFingerprint(error: unknown) {
  const message = error instanceof Error ? `${error.name}:${error.message}` : String(error);
  return crypto.createHash('sha256').update(message.slice(0, 2_000)).digest('hex');
}

/** Executes the declared runtime-41 stage-intelligence retention policy.
 *
 * Without this coordinator `retention_expires_at` only gates comparison reads,
 * so expired pseudonymous facts would accumulate for ever and the stated policy
 * would never be applied to the table itself. Each pass is bounded (100 tenants)
 * and every tenant is purged in its own transaction, so shutdown only needs to
 * wait for the active pass.
 *
 * Telemetry carries counts only. The purge receipt itself lives in the
 * append-only `journey_stage_intelligence_audit` ledger, and neither it nor this
 * log line may carry a subject, so nothing here reaches past the outcome counts.
 */
export class JourneyStageIntelligenceRetentionWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = true;
  private afterSpaceId: string | null = null;

  constructor(
    private readonly intervalMs = 60_000,
    private readonly runRetention: RetentionRun = purgeExpiredJourneyStageIntelligenceFacts,
    private readonly telemetry: RetentionTelemetry = defaultTelemetry
  ) {}

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.timer = setInterval(() => { this.runOnce(); }, this.intervalMs);
    this.timer.unref();
    this.runOnce();
  }

  runOnce(asOf = new Date().toISOString()) {
    if (this.stopped || this.running) return null;
    this.running = true;
    try {
      const result = this.runRetention(asOf, 100, this.afterSpaceId);
      this.afterSpaceId = result.nextCursor;
      if (result.purgedCount || result.failedSpaces) {
        this.telemetry('info', { event: 'journey_stage_intelligence_retention_pass', at: asOf,
          spacesScanned: result.spacesScanned, spacesPurged: result.spacesPurged,
          purgedCount: result.purgedCount, failedSpaces: result.failedSpaces });
      }
      return result;
    } catch (error) {
      this.telemetry('error', { event: 'journey_stage_intelligence_retention_pass_failed', at: asOf,
        errorFingerprint: errorFingerprint(error) });
      return null;
    } finally { this.running = false; }
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async drain(timeoutMs = 8_000) {
    const deadline = Date.now() + timeoutMs;
    while (this.running && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return !this.running;
  }
}

export const journeyStageIntelligenceRetentionWorker = new JourneyStageIntelligenceRetentionWorker();
