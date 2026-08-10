import crypto from 'node:crypto';
import { sendTransactionalEmail } from './emailService.js';
import {
  classifyJourneyCollaborationEmailFailure,
  journeyCollaborationEmailLimits,
  renderJourneyCollaborationEmail
} from './journeyCollaborationEmailDomain.js';
import {
  journeyCollaborationEmailRepository,
  type JourneyCollaborationEmailClaim,
  type JourneyCollaborationEmailRepository
} from './journeyCollaborationEmailRepository.js';

type EmailRepository = Pick<JourneyCollaborationEmailRepository,
  'available' | 'claim' | 'markSent' | 'recordFailure' | 'recoverStaleDeliveries'>;
type EmailSender = typeof sendTransactionalEmail;
type WorkerTelemetry = (level: 'info' | 'error', event: Record<string, unknown>) => void;

function defaultTelemetry(level: 'info' | 'error', event: Record<string, unknown>) {
  const line = JSON.stringify({ component: 'journey-collaboration-email', ...event });
  if (level === 'error') console.error(line); else console.info(line);
}

/** Errors are reported as a hash. The message can name a recipient address or a
 * provider payload, and this telemetry goes to a general application log. */
function errorFingerprint(error: unknown) {
  const message = error instanceof Error ? `${error.name}:${error.message}` : String(error);
  return crypto.createHash('sha256').update(message.slice(0, 2_000)).digest('hex');
}

/**
 * Bounded, non-overlapping delivery coordinator for Journey collaboration email.
 *
 * It is globally disabled by default: `server.ts` only constructs it when
 * JOURNEY_COLLABORATION_EMAIL_WORKER_ENABLED is set, so a deployment that has
 * not made a decision about outbound notification mail sends none.
 *
 * Every pass is bounded by `batchSize`, one claim at a time under a fenced
 * lease, and one row's failure never starves the rest: a claim that throws is
 * recorded against its own lease and the pass continues.
 */
export class JourneyCollaborationEmailWorker {
  private timer: NodeJS.Timeout | null = null;
  private active: Promise<void> | null = null;
  private stopped = true;
  private readonly owner = `journey-collaboration-email:${crypto.randomUUID()}`;

  constructor(
    private readonly intervalMs = 15_000,
    private readonly batchSize: number = journeyCollaborationEmailLimits.batchSize,
    private readonly idempotencyWindowMs = 29 * 60_000,
    private readonly repository: EmailRepository = journeyCollaborationEmailRepository,
    private readonly send: EmailSender = sendTransactionalEmail,
    private readonly telemetry: WorkerTelemetry = defaultTelemetry
  ) {}

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.timer = setInterval(() => { void this.runOnce(); }, this.intervalMs);
    this.timer.unref();
    void this.runOnce();
  }

  async runOnce(now: Date | string = new Date()) {
    if (this.active) return null;
    // The pass promise is published before the first await, so a timer tick that
    // lands mid-pass sees it and returns instead of overlapping.
    const pass = this.pass(now);
    this.active = pass.then(() => undefined, () => undefined);
    try { return await pass; } finally { this.active = null; }
  }

  private async pass(now: Date | string) {
    let sent = 0; let retried = 0; let failed = 0; let recovered = 0;
    try {
      if (!this.repository.available()) return null;
      // Rows abandoned by a killed process are reclaimed before anything new is
      // taken, so a restart cannot leave a delivery leased for ever.
      const recovery = this.repository.recoverStaleDeliveries(now, this.idempotencyWindowMs);
      recovered = recovery.requeued + recovery.deadLettered;
      const bounded = Math.max(1, Math.min(100, this.batchSize));
      for (let index = 0; index < bounded; index += 1) {
        const claim = this.repository.claim({ owner: this.owner, now });
        if (!claim) break;
        const outcome = await this.deliver(claim, now);
        if (outcome === 'sent') sent += 1;
        else if (outcome === 'retry') retried += 1;
        else failed += 1;
      }
      if (sent || retried || failed || recovered) this.telemetry('info', {
        event: 'journey_collaboration_email_pass', sent, retried, failed, recovered
      });
      return { sent, retried, failed, recovered };
    } catch (error) {
      this.telemetry('error', { event: 'journey_collaboration_email_pass_failed',
        errorFingerprint: errorFingerprint(error) });
      return null;
    }
  }

  private async deliver(claim: JourneyCollaborationEmailClaim, now: Date | string) {
    const message = renderJourneyCollaborationEmail({ kind: claim.kind });
    let result: unknown;
    // Only the send itself is classified as a transport outcome. Bookkeeping
    // that fails AFTER the message left must never be recorded as a transport
    // failure, or a delivery that actually happened would be scheduled again.
    try {
      result = await this.send({
        to: claim.recipientEmail,
        subject: message.subject,
        html: message.html,
        text: message.text,
        // Derived from the delivery, so a retry after a crash presents the same
        // key and the mail service collapses it instead of sending twice.
        idempotencyKey: claim.idempotencyKey,
        correlation: `journey_collaboration_email:${claim.outboxId}`
      });
    } catch (error) {
      const code = classifyJourneyCollaborationEmailFailure(error);
      try {
        const outcome = this.repository.recordFailure(claim, code, now);
        return outcome.state === 'pending' ? 'retry' as const : 'failed' as const;
      } catch (recordError) {
        this.telemetry('error', { event: 'journey_collaboration_email_outcome_record_failed',
          errorFingerprint: errorFingerprint(recordError) });
        return 'failed' as const;
      }
    }
    try {
      this.repository.markSent(claim, (result as { messageId?: string }).messageId || null, now);
      return 'sent' as const;
    } catch (error) {
      // The lease was taken while this send was in flight. The row now belongs
      // to whoever holds it; leave it alone and let recovery settle it.
      this.telemetry('error', { event: 'journey_collaboration_email_sent_record_failed',
        errorFingerprint: errorFingerprint(error) });
      return 'failed' as const;
    }
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async drain(timeoutMs = 8_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const active = this.active;
      if (!active) return true;
      await Promise.race([active, new Promise((resolve) => setTimeout(resolve, 10))]);
    }
    return this.active === null;
  }
}
