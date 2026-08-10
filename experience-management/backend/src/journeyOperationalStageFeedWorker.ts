import crypto from 'node:crypto';
import type { JourneyOperationalStageFeedRepository } from './journeyOperationalStageFeedRepository.js';

type Telemetry = (event: { event: string; outcome: 'completed' | 'failed'; errorCode?: string }) => void;
type WorkerRepository = Pick<JourneyOperationalStageFeedRepository, 'claim' | 'complete' | 'fail'>;

export class JourneyOperationalStageFeedWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = true;
  private readonly owner: string;

  constructor(private readonly repository: WorkerRepository,
    private readonly telemetry: Telemetry = () => undefined,
    private readonly options: { intervalMs?: number; batchSize?: number; leaseMs?: number;
      spaceIds?: readonly string[]; owner?: string } = {}) {
    this.owner = options.owner || `operational-stage-feed:${crypto.randomUUID()}`;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    const intervalMs = Math.max(100, Math.min(60_000, this.options.intervalMs || 1_000));
    this.timer = setInterval(() => { void this.runBatch(); }, intervalMs);
    this.timer.unref(); void this.runBatch();
  }

  async runBatch(at: Date | string = new Date()) {
    if (this.running) return { processed: 0, busy: true };
    this.running = true;
    try {
      const batchSize = Math.max(1, Math.min(100, this.options.batchSize || 25));
      let processed = 0;
      for (; processed < batchSize; processed += 1) {
        const result = this.runOnce(this.owner, at);
        if (result.state === 'idle') break;
      }
      return { processed, busy: false };
    } finally { this.running = false; }
  }

  runOnce(owner: string, at: Date | string = new Date()) {
    const claim = this.repository.claim({ owner, now: at, leaseMs: this.options.leaseMs,
      spaceIds: this.options.spaceIds });
    if (!claim) return { state: 'idle' as const };
    try {
      this.repository.complete(claim, at);
      this.telemetry({ event: 'journey_operational_stage_feed_projection', outcome: 'completed' });
      return { state: 'completed' as const, outboxId: claim.id };
    } catch (error) {
      const errorCode = typeof error === 'object' && error && 'code' in error
        ? String((error as { code?: unknown }).code || 'JOURNEY_OPERATIONAL_FEED_EXECUTION_FAILED')
        : 'JOURNEY_OPERATIONAL_FEED_EXECUTION_FAILED';
      this.repository.fail(claim, errorCode, at);
      this.telemetry({ event: 'journey_operational_stage_feed_projection', outcome: 'failed', errorCode });
      return { state: 'failed' as const, outboxId: claim.id, errorCode };
    }
  }

  stop() { this.stopped = true; if (this.timer) clearInterval(this.timer); this.timer = null; }

  async drain(timeoutMs = 8_000) {
    const deadline = Date.now() + timeoutMs;
    while (this.running && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    return !this.running;
  }
}
