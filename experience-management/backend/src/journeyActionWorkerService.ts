import crypto from 'node:crypto';
import { assertWorkerScope, JourneyActionWorkerError, resolveJourneyWorkerGates,
  type WorkerAuthority, type WorkerLiveFacts } from './journeyActionWorkerDomain.js';

export type WorkerQueueState = 'held' | 'ready' | 'retry_scheduled' | 'leased' | 'succeeded' | 'dead_letter';
export type WorkerQueueItem = Readonly<{ id: string; spaceId: string; workflowId: string; adapter: string;
  profileId: string; state: WorkerQueueState; availableAt: string; leaseToken: string | null;
  fencingToken: number; leaseExpiresAt: string | null; holdReasonCode: string | null; revision: number }>;
export type WorkerLease = Readonly<{ queueId: string; spaceId: string; adapter: string; leaseToken: string;
  fencingToken: number; leaseExpiresAt: string; reservationId?: string }>;

export interface JourneyActionWorkerSafetyLifecycle {
  reserve(input: { authority: WorkerAuthority; lease: WorkerLease; at: string }): { reservationId: string; replayed: boolean };
  completeReservedNoEffect(input: { authority: WorkerAuthority; lease: WorkerLease; reservationId: string;
    receiptSha256: string; at: string }): { replayed: boolean };
  completeReservedReviewedEffect(input: { authority: WorkerAuthority; lease: WorkerLease; reservationId: string;
    adapter: string; providerReferenceSha256: string; responseSha256: string; requestSha256: string;
    applyInternalEffect?: () => void; at: string }): { receiptId: string; replayed: boolean };
  release(input: { authority: WorkerAuthority; lease: WorkerLease; reservationId: string; at: string }): { replayed: boolean };
  holdReservedLease(input: { authority: WorkerAuthority; lease: WorkerLease; reservationId: string;
    reasonCode: string; at: string }): void;
  failReservedLease(input: { authority: WorkerAuthority; lease: WorkerLease; reservationId: string;
    errorCode: string; at: string }): void;
}
export type JourneyActionWorkerMode = Readonly<{mode:'test_no_effect'}>|Readonly<{mode:'durable';safety:JourneyActionWorkerSafetyLifecycle}>;

export interface JourneyActionWorkerRepository {
  claimCandidate(input: { authority: WorkerAuthority; now: string; leaseExpiresAt: string }): Promise<WorkerQueueItem | null>;
  readLiveFacts(input: { authority: WorkerAuthority; queueId: string; now: string }): Promise<{ item: WorkerQueueItem; facts: WorkerLiveFacts }>;
  holdLease(input: { authority: WorkerAuthority; lease: WorkerLease; reasonCode: string; now: string }): Promise<void>;
  completeNoEffect(input: { authority: WorkerAuthority; lease: WorkerLease; receiptSha256: string; now: string }):
    Promise<{ replayed: boolean }>;
  failLease(input: { authority: WorkerAuthority; lease: WorkerLease; errorCode: string; now: string }): Promise<void>;
  listHeld(input: { authority: WorkerAuthority; limit: number }): Promise<readonly WorkerQueueItem[]>;
  releaseHeld(input: { authority: WorkerAuthority; queueId: string; expectedRevision: number; now: string }): Promise<boolean>;
}

export type WorkerTelemetryEvent = Readonly<{ event: 'claimed' | 'held' | 'completed_no_effect' | 'completed_reviewed_effect' | 'failed'
  | 'released' | 'scheduler_error'; queueIdSha256?: string; workerIdSha256: string; reasonCode: string;
  fencingToken?: number; at: string }>;
export interface WorkerTelemetrySink { emit(event: WorkerTelemetryEvent): void }
const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

export class JourneyActionWorkerService {
  constructor(private readonly repository: JourneyActionWorkerRepository, private readonly telemetry: WorkerTelemetrySink,
    private readonly clock: () => Date = () => new Date(), private readonly workerMode?: JourneyActionWorkerMode) {
      if(!workerMode)throw new JourneyActionWorkerError('Worker safety mode must be explicit.','WORKER_SAFETY_MODE_REQUIRED',500);
    }
  private get safety(){return this.workerMode?.mode==='durable'?this.workerMode.safety:undefined;}

  private now(): string { return this.clock().toISOString(); }
  private emit(authority: WorkerAuthority, event: WorkerTelemetryEvent['event'], reasonCode: string,
    queueId?: string, fencingToken?: number) {
    this.telemetry.emit(Object.freeze({ event, workerIdSha256: authority.workerIdSha256, reasonCode,
      ...(queueId ? { queueIdSha256: sha256(queueId) } : {}), ...(fencingToken === undefined ? {} : { fencingToken }),
      at: this.now() }));
  }

  async claim(authority: WorkerAuthority, leaseSeconds = 60): Promise<WorkerLease | null> {
    if (!authority || authority.kind !== 'journey_action_worker') throw new JourneyActionWorkerError(
      'Service authority is required.', 'WORKER_SERVICE_AUTHORITY_REQUIRED', 403);
    if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 5 || leaseSeconds > 900) throw new JourneyActionWorkerError(
      'Lease duration is outside the safe range.', 'WORKER_LEASE_DURATION_INVALID');
    const now = this.now();
    if (Date.parse(authority.expiresAt) <= Date.parse(now)) throw new JourneyActionWorkerError(
      'Worker credential expired.', 'WORKER_CREDENTIAL_EXPIRED', 401);
    const leaseExpiresAt = new Date(Date.parse(now) + leaseSeconds * 1000).toISOString();
    const item = await this.repository.claimCandidate({ authority, now, leaseExpiresAt });
    if (!item) return null;
    assertWorkerScope(authority, item.spaceId, item.adapter);
    if (!item.leaseToken || !item.leaseExpiresAt || item.state !== 'leased') throw new JourneyActionWorkerError(
      'Repository returned an invalid lease.', 'WORKER_REPOSITORY_LEASE_INVALID', 500);
    const lease = Object.freeze({ queueId: item.id, spaceId: item.spaceId, adapter: item.adapter,
      leaseToken: item.leaseToken, fencingToken: item.fencingToken, leaseExpiresAt: item.leaseExpiresAt });
    const live = await this.repository.readLiveFacts({ authority, queueId: item.id, now });
    const resolution = resolveJourneyWorkerGates(live.facts, now);
    if (resolution.decision !== 'allow') {
      await this.repository.holdLease({ authority, lease, reasonCode: resolution.reasonCode, now });
      this.emit(authority, 'held', resolution.reasonCode, item.id, item.fencingToken);
      return null;
    }
    let reservedLease: WorkerLease = lease;
    if (this.safety) {
      try { const reservation=this.safety.reserve({authority,lease,at:now});reservedLease=Object.freeze({...lease,reservationId:reservation.reservationId}); }
      catch (caught) { const reason=caught instanceof Error && 'code' in caught ? String((caught as {code:unknown}).code) : 'WORKER_RESERVATION_DENIED';
        await this.repository.holdLease({authority,lease,reasonCode:reason,now});this.emit(authority,'held',reason,item.id,item.fencingToken);return null; }
    }
    this.emit(authority, 'claimed', 'LIVE_GATES_ALLOW', item.id, item.fencingToken);
    return reservedLease;
  }

  /** Reloads every server-owned fact immediately before the no-effect completion boundary. */
  async completeNoEffect(authority: WorkerAuthority, lease: WorkerLease): Promise<{ replayed: boolean }> {
    assertWorkerScope(authority, lease.spaceId, lease.adapter);
    const now = this.now();
    const live = await this.repository.readLiveFacts({ authority, queueId: lease.queueId, now });
    const resolution = resolveJourneyWorkerGates(live.facts, now);
    if (resolution.decision !== 'allow') {
      if(this.safety&&lease.reservationId)this.safety.holdReservedLease({authority,lease,reservationId:lease.reservationId,
        reasonCode:resolution.reasonCode,at:now});
      else await this.repository.holdLease({ authority, lease, reasonCode: resolution.reasonCode, now });
      this.emit(authority, 'held', resolution.reasonCode, lease.queueId, lease.fencingToken);
      throw new JourneyActionWorkerError('Live safety state changed before completion.',
        'WORKER_PRECOMPLETION_GATE_DENIED', 409);
    }
    const receiptSha256 = sha256(`${lease.queueId}:${lease.fencingToken}:deterministic_no_effect`);
    const result = this.safety&&lease.reservationId
      ? this.safety.completeReservedNoEffect({authority,lease,reservationId:lease.reservationId,receiptSha256,at:now})
      : await this.repository.completeNoEffect({ authority, lease, receiptSha256, now });
    this.emit(authority, 'completed_no_effect', result.replayed ? 'NO_EFFECT_REPLAYED' : 'NO_EFFECT_SUCCEEDED',
      lease.queueId, lease.fencingToken);
    return result;
  }

  async completeReviewedEffect(authority: WorkerAuthority, lease: WorkerLease, effect: Readonly<{
    adapter: string; providerReferenceSha256: string; responseSha256: string; requestSha256: string;
    applyInternalEffect?: () => void
  }>): Promise<{ receiptId: string; replayed: boolean }> {
    assertWorkerScope(authority, lease.spaceId, lease.adapter);
    if (!this.safety || !lease.reservationId) throw new JourneyActionWorkerError(
      'Reviewed effects require durable reservation settlement.', 'WORKER_REVIEWED_EFFECT_SAFETY_REQUIRED', 500);
    if (effect.adapter !== lease.adapter || ![effect.providerReferenceSha256,effect.responseSha256,effect.requestSha256]
      .every((value) => /^[a-f0-9]{64}$/u.test(value))) throw new JourneyActionWorkerError(
      'Reviewed effect receipt metadata is invalid.', 'WORKER_REVIEWED_EFFECT_RECEIPT_INVALID');
    const now = this.now();
    const live = await this.repository.readLiveFacts({ authority, queueId: lease.queueId, now });
    const resolution = resolveJourneyWorkerGates(live.facts, now);
    if (resolution.decision !== 'allow') {
      this.safety.holdReservedLease({ authority, lease, reservationId: lease.reservationId,
        reasonCode: resolution.reasonCode, at: now });
      this.emit(authority, 'held', resolution.reasonCode, lease.queueId, lease.fencingToken);
      throw new JourneyActionWorkerError('Live safety state changed before reviewed-effect settlement.',
        'WORKER_PRECOMPLETION_GATE_DENIED', 409);
    }
    const result = this.safety.completeReservedReviewedEffect({ authority, lease, reservationId: lease.reservationId,
      ...effect, at: now });
    this.emit(authority, 'completed_reviewed_effect', result.replayed ? 'REVIEWED_EFFECT_REPLAYED' : 'REVIEWED_EFFECT_SUCCEEDED',
      lease.queueId, lease.fencingToken);
    return result;
  }

  async fail(authority: WorkerAuthority, lease: WorkerLease, errorCode: string): Promise<void> {
    assertWorkerScope(authority, lease.spaceId, lease.adapter);
    if (!/^[A-Z][A-Z0-9_]{2,127}$/u.test(errorCode)) throw new JourneyActionWorkerError(
      'Failure code must be content-safe.', 'WORKER_ERROR_CODE_INVALID');
    const now=this.now();if(this.safety&&lease.reservationId)this.safety.failReservedLease({authority,lease,reservationId:lease.reservationId,errorCode,at:now});
    else await this.repository.failLease({ authority, lease, errorCode, now });
    this.emit(authority, 'failed', errorCode, lease.queueId, lease.fencingToken);
  }

  async reevaluateHeld(authority: WorkerAuthority, limit = 100): Promise<{ checked: number; released: number }> {
    if (!authority || authority.kind !== 'journey_action_worker') throw new JourneyActionWorkerError(
      'Service authority is required.', 'WORKER_SERVICE_AUTHORITY_REQUIRED', 403);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new JourneyActionWorkerError(
      'Re-evaluation limit is invalid.', 'WORKER_REEVALUATION_LIMIT_INVALID');
    const held = await this.repository.listHeld({ authority, limit }); let released = 0;
    for (const item of held) {
      assertWorkerScope(authority, item.spaceId, item.adapter);
      const now = this.now();
      const live = await this.repository.readLiveFacts({ authority, queueId: item.id, now });
      if (resolveJourneyWorkerGates(live.facts, now).decision !== 'allow') continue;
      if (await this.repository.releaseHeld({ authority, queueId: item.id, expectedRevision: item.revision, now })) {
        released += 1; this.emit(authority, 'released', 'LIVE_GATES_REEVALUATED_ALLOW', item.id);
      }
    }
    return { checked: held.length, released };
  }
}

export class NoContentWorkerTelemetry implements WorkerTelemetrySink {
  readonly events: WorkerTelemetryEvent[] = [];
  emit(event: WorkerTelemetryEvent): void { this.events.push(structuredClone(event)); }
}
export class ConsoleJourneyWorkerTelemetry implements WorkerTelemetrySink {
  emit(event:WorkerTelemetryEvent):void{console.info(JSON.stringify({component:'journey_action_worker',...event}));}
}
