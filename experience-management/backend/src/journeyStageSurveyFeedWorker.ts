import crypto from 'node:crypto';
import { journeyStageSurveyFeedRepository } from './journeyStageSurveyFeedRepository.js';

type FeedRepository = Pick<typeof journeyStageSurveyFeedRepository, 'claim' | 'execute' | 'fail'>;
type Telemetry = (level: 'info' | 'error', detail: Record<string, unknown>) => void;

function fingerprint(error: unknown) {
  const message = error instanceof Error ? `${error.name}:${error.message}` : String(error);
  return crypto.createHash('sha256').update(message.slice(0, 2_000)).digest('hex');
}

function telemetry(level: 'info' | 'error', detail: Record<string, unknown>) {
  const line = JSON.stringify({ component: 'journey-stage-survey-feed', ...detail });
  if (level === 'error') console.error(line); else console.info(line);
}

/** Durable runtime-43 projection worker. It consumes only server-created,
 * content-safe revisions; it cannot access raw survey answers or identities. */
export class JourneyStageSurveyFeedWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = true;
  private readonly owner = `stage-survey-feed:${crypto.randomUUID()}`;

  constructor(private readonly repository: FeedRepository = journeyStageSurveyFeedRepository,
    private readonly intervalMs = 1_000, private readonly emit: Telemetry = telemetry) {}

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.timer = setInterval(() => { void this.runOnce(); }, this.intervalMs);
    this.timer.unref(); void this.runOnce();
  }

  async runOnce() {
    if (this.stopped || this.running) return false;
    this.running = true;
    try {
      const claim = this.repository.claim({ owner: this.owner });
      if (!claim) return false;
      try {
        const result = this.repository.execute(claim);
        this.emit('info', { event: 'survey_feed_applied', appliedCount: result.applied, complete: result.complete });
      } catch (error) {
        const code = error instanceof Error && 'code' in error && typeof error.code === 'string'
          ? error.code : 'JOURNEY_STAGE_SURVEY_FEED_EXECUTION_FAILED';
        this.repository.fail(claim, code);
        this.emit('error', { event: 'survey_feed_failed', errorFingerprint: fingerprint(error) });
      }
      return true;
    } finally { this.running = false; }
  }

  stop() { this.stopped = true; if (this.timer) clearInterval(this.timer); this.timer = null; }

  async drain(timeoutMs = 8_000) {
    const deadline = Date.now() + timeoutMs;
    while (this.running && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    return !this.running;
  }
}

export const journeyStageSurveyFeedWorker = new JourneyStageSurveyFeedWorker();
