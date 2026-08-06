import crypto from 'node:crypto';
import { purgeExpiredJourneySavedViews } from './journeySavedViews.js';

type RetentionOutcome = ReturnType<typeof purgeExpiredJourneySavedViews>;
type RetentionRun = (asOf?: string) => RetentionOutcome;
type RetentionTelemetry = (level: 'info' | 'error', event: Record<string, unknown>) => void;

function defaultTelemetry(level: 'info' | 'error', event: Record<string, unknown>) {
  const line = JSON.stringify({ component: 'journey-saved-view-retention', ...event });
  if (level === 'error') console.error(line); else console.info(line);
}

function errorFingerprint(error: unknown) {
  const message = error instanceof Error ? `${error.name}:${error.message}` : String(error);
  return crypto.createHash('sha256').update(message.slice(0, 2_000)).digest('hex');
}

/** Executes the declared saved-view retention policy. Without this coordinator
 * `retention_expires_at` only gates restore, so soft-deleted views and their
 * references accumulate for ever and the stated policy is never applied. Each
 * pass is bounded (500 rows) and every row is deleted in its own transaction,
 * so shutdown only needs to wait for the active pass. */
export class JourneySavedViewRetentionWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = true;

  constructor(
    private readonly intervalMs = 60_000,
    private readonly runRetention: RetentionRun = purgeExpiredJourneySavedViews,
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
      const result = this.runRetention(asOf);
      if (result.purged) {
        this.telemetry('info', { event: 'journey_saved_view_retention_pass', at: asOf, purged: result.purged });
      }
      return result;
    } catch (error) {
      this.telemetry('error', { event: 'journey_saved_view_retention_pass_failed', at: asOf,
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

export const journeySavedViewRetentionWorker = new JourneySavedViewRetentionWorker();
