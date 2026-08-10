import assert from 'node:assert/strict';
import test from 'node:test';
import { authenticateJourneyWorker, mintJourneyWorkerCredential, type WorkerLiveFacts } from '../src/journeyActionWorkerDomain.js';
import { JourneyActionWorkerMemoryRepository } from '../src/journeyActionWorkerMemoryRepository.js';
import { JourneyActionWorkerService, NoContentWorkerTelemetry, type WorkerQueueItem } from '../src/journeyActionWorkerService.js';

const secret = 'worker-test-secret-that-is-at-least-32-bytes';
const clock = { now: Date.parse('2026-08-08T12:00:00.000Z') };
const authority = (spaces = ['space-a'], adapters = ['assistant_action']) => authenticateJourneyWorker({
  credential: mintJourneyWorkerCredential({ workerId: 'worker-a', allowedSpaceIds: spaces, allowedAdapters: adapters,
    issuedAt: '2026-08-08T11:00:00.000Z', expiresAt: '2026-08-09T12:00:00.000Z', keyId: 'key-a', secret }),
  secretForKey: () => secret, now: new Date(clock.now).toISOString() });
const facts = (): WorkerLiveFacts => ({ consent: 'granted', suppressed: false, entitled: true,
  quota: { used: 0, reserved: 0, limit: 1000 }, quietHours: { timezone: 'UTC', startMinute: 60, endMinute: 120 },
  frequency: { observed: 0, maximum: 10, windowEndsAt: '2026-08-09T12:00:00.000Z' }, sourceState: 'active',
  killSwitchScope: { spaceId: 'space-a', workflowId: 'workflow-a', adapter: 'assistant_action', profileId: 'profile-a' },
  killSwitchRecords: [] });
const item = (id: string, state: WorkerQueueItem['state'] = 'ready'): WorkerQueueItem => ({ id, spaceId: 'space-a',
  workflowId: 'workflow-a', adapter: 'assistant_action', profileId: 'profile-a', state,
  availableAt: new Date(clock.now).toISOString(), leaseToken: null, fencingToken: 0, leaseExpiresAt: null,
  holdReasonCode: state === 'held' ? 'CONSENT_DENIED' : null, revision: 1 });
const setup = () => { const repository = new JourneyActionWorkerMemoryRepository(); const telemetry = new NoContentWorkerTelemetry();
  return { repository, telemetry, service: new JourneyActionWorkerService(repository, telemetry, () => new Date(clock.now),{mode:'test_no_effect'}) }; };

test('atomic contention yields one fenced lease and no human-session authority path', async () => {
  const { repository, service } = setup(); repository.seed(item('queue-a'), facts());
  const claims = await Promise.all(Array.from({ length: 20 }, () => service.claim(authority())));
  assert.equal(claims.filter(Boolean).length, 1); assert.equal(claims.find(Boolean)?.fencingToken, 1);
  await assert.rejects(() => service.claim({ ...authority(), kind: 'user_session' } as never), /Service authority is required|Repository/);
});

test('reloads gates before completion, holds safely, and rejects stale fence', async () => {
  const { repository, service } = setup(); repository.seed(item('queue-a'), facts());
  const lease = await service.claim(authority()); assert.ok(lease);
  repository.replaceFacts('queue-a', { ...facts(), suppressed: true });
  await assert.rejects(() => service.completeNoEffect(authority(), lease!), /changed before completion/);
  assert.equal(repository.inspect('queue-a')?.state, 'held');
  assert.equal(repository.inspect('queue-a')?.fencingToken, 2);
  await assert.rejects(() => service.fail(authority(), lease!, 'SAFE_FAILURE'), /stale/i);
});

test('re-evaluates held work and releases only when every current gate allows', async () => {
  const { repository, service } = setup(); repository.seed(item('queue-a', 'held'), { ...facts(), consent: 'denied' });
  assert.deepEqual(await service.reevaluateHeld(authority()), { checked: 1, released: 0 });
  repository.replaceFacts('queue-a', facts());
  assert.deepEqual(await service.reevaluateHeld(authority()), { checked: 1, released: 1 });
  assert.equal(repository.inspect('queue-a')?.state, 'ready');
});

test('enforces tenant and adapter scope and emits content-safe telemetry only', async () => {
  const { repository, service, telemetry } = setup(); repository.seed(item('queue-a'), facts());
  assert.equal(await service.claim(authority(['space-b'])), null);
  const lease = await service.claim(authority()); assert.ok(lease); await service.completeNoEffect(authority(), lease!);
  const serialized = JSON.stringify(telemetry.events);
  assert.doesNotMatch(serialized, /queue-a|profile-a|payload|recipient/i);
  assert.match(serialized, /queueIdSha256/);
});

test('expired lease is reclaimed with a higher fence and old worker cannot complete', async () => {
  const { repository, service } = setup(); repository.seed(item('queue-a'), facts());
  const first = await service.claim(authority(), 5); assert.ok(first); clock.now += 6_000;
  const second = await service.claim(authority(), 5); assert.ok(second); assert.equal(second!.fencingToken, 2);
  await assert.rejects(() => service.completeNoEffect(authority(), first!), /stale/i);
  await service.completeNoEffect(authority(), second!); clock.now -= 6_000;
});

test('bounded load probe drains 500 items across workers without duplicate effects', async () => {
  const { repository, service } = setup();
  for (let index = 0; index < 500; index += 1) repository.seed(item(`queue-${String(index).padStart(4, '0')}`), facts());
  let completed = 0;
  await Promise.all(Array.from({ length: 8 }, async () => { while (true) { const lease = await service.claim(authority());
    if (!lease) break; const result = await service.completeNoEffect(authority(), lease); if (!result.replayed) completed += 1; } }));
  assert.equal(completed, 500);
  assert.equal(Array.from({ length: 500 }, (_, i) => repository.inspect(`queue-${String(i).padStart(4, '0')}`)?.state)
    .filter((state) => state === 'succeeded').length, 500);
});

test('durable mode requires safety and routes reserve, completion, hold, and failure through atomic lifecycle',async()=>{
  const repository=new JourneyActionWorkerMemoryRepository();const telemetry=new NoContentWorkerTelemetry();
  assert.throws(()=>new JourneyActionWorkerService(repository,telemetry,()=>new Date(clock.now)),/mode must be explicit/i);
  const calls:string[]=[];const safety={reserve:()=>{calls.push('reserve');return {reservationId:'reservation-a',replayed:false}},
    completeReservedNoEffect:()=>{calls.push('complete');return {replayed:false}},release:()=>({replayed:false}),
    holdReservedLease:()=>{calls.push('hold')},failReservedLease:()=>{calls.push('fail')}};
  const service=new JourneyActionWorkerService(repository,telemetry,()=>new Date(clock.now),{mode:'durable',safety});
  repository.seed(item('queue-a'),facts());const completed=await service.claim(authority());assert.equal(completed?.reservationId,'reservation-a');
  await service.completeNoEffect(authority(),completed!);assert.deepEqual(calls,['reserve','complete']);
  repository.seed(item('queue-b'),facts());const held=await service.claim(authority());repository.replaceFacts('queue-b',{...facts(),consent:'denied'});
  await assert.rejects(()=>service.completeNoEffect(authority(),held!),/changed before completion/);assert.equal(calls.at(-1),'hold');
  repository.seed(item('queue-c'),facts());const failed=await service.claim(authority());await service.fail(authority(),failed!,'SAFE_FAILURE');
  assert.equal(calls.at(-1),'fail');
});
