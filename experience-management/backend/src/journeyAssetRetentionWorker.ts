import crypto from 'node:crypto';
import { purgeExpiredJourneyCardAssets } from './journeyRichCards.js';

type RetentionOutcome = Awaited<ReturnType<typeof purgeExpiredJourneyCardAssets>>;
type RetentionRun = (asOf?: string) => RetentionOutcome | Promise<RetentionOutcome>;
type RetentionTelemetry = (level: 'info' | 'error', event: Record<string, unknown>) => void;

function defaultTelemetry(level: 'info' | 'error', event: Record<string, unknown>) {
  const line = JSON.stringify({ component: 'journey-asset-retention', ...event });
  if (level === 'error') console.error(line); else console.info(line);
}

function errorFingerprint(error: unknown) {
  const message = error instanceof Error ? `${error.name}:${error.message}` : String(error);
  return crypto.createHash('sha256').update(message.slice(0, 2_000)).digest('hex');
}

/** Bounded production coordinator for tombstone expiry and durable blob
 * deletion. Work is synchronous and small by design (500 tombstones and 100
 * outbox receipts per pass), so shutdown only needs to wait for the active
 * pass and every retry remains durable across process restarts. */
export class JourneyAssetRetentionWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = true;

  constructor(
    private readonly intervalMs = 60_000,
    private readonly runRetention: RetentionRun = purgeExpiredJourneyCardAssets,
    private readonly telemetry: RetentionTelemetry = defaultTelemetry
  ) {}

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.timer = setInterval(() => { void this.runOnce(); }, this.intervalMs);
    this.timer.unref();
    void this.runOnce();
  }

  async runOnce(asOf = new Date().toISOString()) {
    if (this.stopped || this.running) return null;
    this.running = true;
    try {
      const result = await this.runRetention(asOf);
      if (result.purged || result.purgeReceiptsClaimed || result.purgeReceiptsFailed) {
        this.telemetry('info', { event: 'journey_asset_retention_pass', at: asOf,
          purged: result.purged, blobsScheduled: result.blobsScheduled, blobsPurged: result.blobsPurged,
          purgeReceiptsClaimed: result.purgeReceiptsClaimed,
          purgeReceiptsFailed: result.purgeReceiptsFailed });
      }
      return result;
    } catch (error) {
      this.telemetry('error', { event: 'journey_asset_retention_pass_failed', at: asOf,
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

export const journeyAssetRetentionWorker = new JourneyAssetRetentionWorker();
