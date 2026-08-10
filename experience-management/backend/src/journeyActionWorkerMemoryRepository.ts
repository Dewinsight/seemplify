import crypto from 'node:crypto';
import { assertWorkerScope, JourneyActionWorkerError, type WorkerAuthority,
  type WorkerLiveFacts } from './journeyActionWorkerDomain.js';
import type { JourneyActionWorkerRepository, WorkerLease, WorkerQueueItem } from './journeyActionWorkerService.js';

type MutableItem = { -readonly [K in keyof WorkerQueueItem]: WorkerQueueItem[K] };
const copy = (item: MutableItem): WorkerQueueItem => Object.freeze(structuredClone(item));

/**
 * Deterministic, process-local repository for contract tests and dry-run deployments.
 * It performs no external effect. A durable adapter must implement the same atomic/fenced methods.
 */
export class JourneyActionWorkerMemoryRepository implements JourneyActionWorkerRepository {
  private readonly items = new Map<string, MutableItem>();
  private readonly facts = new Map<string, WorkerLiveFacts>();
  private readonly receipts = new Map<string, string>();

  seed(item: WorkerQueueItem, facts: WorkerLiveFacts): void {
    if (this.items.has(item.id)) throw new Error('Duplicate queue id.');
    this.items.set(item.id, structuredClone(item)); this.facts.set(item.id, structuredClone(facts));
  }
  replaceFacts(queueId: string, facts: WorkerLiveFacts): void { if (!this.items.has(queueId)) throw new Error('Unknown queue id.');
    this.facts.set(queueId, structuredClone(facts)); }
  inspect(queueId: string): WorkerQueueItem | null { const item = this.items.get(queueId); return item ? copy(item) : null; }

  async claimCandidate(input: { authority: WorkerAuthority; now: string; leaseExpiresAt: string }): Promise<WorkerQueueItem | null> {
    const candidates = [...this.items.values()].filter((item) => input.authority.allowedSpaceIds.includes(item.spaceId)
      && input.authority.allowedAdapters.includes(item.adapter) && ((['ready', 'retry_scheduled'].includes(item.state)
        && Date.parse(item.availableAt) <= Date.parse(input.now)) || (item.state === 'leased' && item.leaseExpiresAt
          && Date.parse(item.leaseExpiresAt) <= Date.parse(input.now))))
      .sort((left, right) => left.availableAt.localeCompare(right.availableAt) || left.id.localeCompare(right.id));
    const item = candidates[0]; if (!item) return null;
    assertWorkerScope(input.authority, item.spaceId, item.adapter);
    item.state = 'leased'; item.leaseToken = crypto.randomUUID(); item.fencingToken += 1;
    item.leaseExpiresAt = input.leaseExpiresAt; item.holdReasonCode = null; item.revision += 1;
    return copy(item);
  }

  async readLiveFacts(input: { authority: WorkerAuthority; queueId: string; now: string }) {
    const item = this.required(input.queueId); assertWorkerScope(input.authority, item.spaceId, item.adapter);
    const facts = this.facts.get(input.queueId);
    if (!facts) throw new JourneyActionWorkerError('Live facts are unavailable.', 'WORKER_LIVE_FACTS_UNAVAILABLE', 503);
    return { item: copy(item), facts: structuredClone(facts) };
  }

  async holdLease(input: { authority: WorkerAuthority; lease: WorkerLease; reasonCode: string; now: string }): Promise<void> {
    const item = this.assertLease(input.authority, input.lease, input.now);
    item.state = 'held'; item.holdReasonCode = input.reasonCode; item.leaseToken = null;
    item.leaseExpiresAt = null; item.fencingToken += 1; item.revision += 1;
  }

  async completeNoEffect(input: { authority: WorkerAuthority; lease: WorkerLease; receiptSha256: string; now: string }) {
    const existing = this.receipts.get(input.lease.queueId);
    if (existing) return { replayed: true };
    const item = this.assertLease(input.authority, input.lease, input.now);
    this.receipts.set(item.id, input.receiptSha256); item.state = 'succeeded'; item.leaseToken = null;
    item.leaseExpiresAt = null; item.revision += 1; return { replayed: false };
  }

  async failLease(input: { authority: WorkerAuthority; lease: WorkerLease; errorCode: string; now: string }): Promise<void> {
    const item = this.assertLease(input.authority, input.lease, input.now);
    item.state = 'retry_scheduled'; item.availableAt = input.now; item.leaseToken = null;
    item.leaseExpiresAt = null; item.revision += 1;
  }

  async listHeld(input: { authority: WorkerAuthority; limit: number }): Promise<readonly WorkerQueueItem[]> {
    return [...this.items.values()].filter((item) => item.state === 'held'
      && input.authority.allowedSpaceIds.includes(item.spaceId) && input.authority.allowedAdapters.includes(item.adapter))
      .sort((left, right) => left.id.localeCompare(right.id)).slice(0, input.limit).map(copy);
  }

  async releaseHeld(input: { authority: WorkerAuthority; queueId: string; expectedRevision: number; now: string }): Promise<boolean> {
    const item = this.required(input.queueId); assertWorkerScope(input.authority, item.spaceId, item.adapter);
    if (item.state !== 'held' || item.revision !== input.expectedRevision) return false;
    item.state = 'ready'; item.availableAt = input.now; item.holdReasonCode = null; item.revision += 1; return true;
  }

  private required(queueId: string): MutableItem {
    const item = this.items.get(queueId);
    if (!item) throw new JourneyActionWorkerError('Queue item not found.', 'WORKER_QUEUE_NOT_FOUND', 404);
    return item;
  }
  private assertLease(authority: WorkerAuthority, lease: WorkerLease, now: string): MutableItem {
    const item = this.required(lease.queueId); assertWorkerScope(authority, item.spaceId, item.adapter);
    if (item.spaceId !== lease.spaceId || item.adapter !== lease.adapter || item.state !== 'leased'
      || item.leaseToken !== lease.leaseToken || item.fencingToken !== lease.fencingToken || !item.leaseExpiresAt
      || Date.parse(item.leaseExpiresAt) <= Date.parse(now)) throw new JourneyActionWorkerError(
        'Lease is stale, expired, or outside scope.', 'WORKER_STALE_FENCE', 409);
    return item;
  }
}
