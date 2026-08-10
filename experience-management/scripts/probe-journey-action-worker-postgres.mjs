import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createDatabase } from '../backend/dist/databaseAdapter.js';
import { authenticateJourneyWorker, mintJourneyWorkerCredential } from '../backend/dist/journeyActionWorkerDomain.js';
import { JourneyActionWorkerSafetyRepository, productionJourneyWorkerPolicyResolver } from '../backend/dist/journeyActionWorkerSafetyRepository.js';
import { JourneyActionWorkerService, NoContentWorkerTelemetry } from '../backend/dist/journeyActionWorkerService.js';
import { JourneyReviewedAdapterWorker } from '../backend/dist/journeyReviewedAdapterWorker.js';

const required=(name)=>{const value=String(process.env[name]||'').trim();if(!value)throw new Error(`${name} is required.`);return value;};
const settings={databaseProvider:'postgres',databasePath:'',postgres:{host:required('POSTGRES_HOST'),port:Number(required('POSTGRES_PORT')),
  database:required('POSTGRES_DATABASE'),user:required('POSTGRES_WORKER_USER'),passwordFile:required('POSTGRES_WORKER_PASSWORD_FILE'),
  ssl:false,schemaVersion:1,runtimeSchemaVersion:Number(required('POSTGRES_RUNTIME_SCHEMA_VERSION')),
  sourceSha256:required('POSTGRES_SOURCE_SHA256')}};
const spaceId=required('JOURNEY_WORKER_PROBE_SPACE_ID'),adapter='assistant_action',adapters=[adapter,'signed_webhook'];
const signingSecret=fs.readFileSync(required('JOURNEY_ACTION_WORKER_SECRET_FILE'),'utf8').trim();
assert.ok(signingSecret.length>=32,'worker probe signing material is invalid');
const first=createDatabase(settings),second=createDatabase(settings);let clock='2026-08-08T12:00:00.000Z';
const repoA=new JourneyActionWorkerSafetyRepository(first,productionJourneyWorkerPolicyResolver(first));
const repoB=new JourneyActionWorkerSafetyRepository(second,productionJourneyWorkerPolicyResolver(second));
try{
  for(const runtime of [first,second]){const session=runtime.prepare(`SELECT current_user AS "currentUser",
      has_table_privilege(current_user,'public.journey_workflow_definitions','SELECT') AS "canReadDefinitions",
      has_table_privilege(current_user,'public.journey_action_queue','UPDATE') AS "canUpdateQueue"`).get();
    assert.equal(session.currentUser,settings.postgres.user);assert.equal(session.canReadDefinitions,true);assert.equal(session.canUpdateQueue,true);
    runtime.transaction(()=>runtime.prepare(`SELECT q.id FROM journey_action_queue q JOIN journey_workflow_definitions w
      ON w.id=q.workflow_id AND w.space_id=q.space_id WHERE q.space_id=? LIMIT 1 FOR UPDATE OF q SKIP LOCKED`).get(spaceId))();}
  repoA.provisionPrincipal({id:'probe-worker',keyId:'probe-key-a',keyRef:'file://probe-key-a',allowedSpaceIds:[spaceId],allowedAdapters:adapters,
    notBefore:'2026-08-08T00:00:00.000Z',expiresAt:'2026-08-10T00:00:00.000Z',at:clock});
  const authorityFor=(keyId)=>authenticateJourneyWorker({credential:mintJourneyWorkerCredential({workerId:`probe-${keyId}`,
    allowedSpaceIds:[spaceId],allowedAdapters:adapters,issuedAt:'2026-08-08T00:00:00.000Z',expiresAt:'2026-08-10T00:00:00.000Z',keyId,
    secret:signingSecret}),secretForKey:()=>signingSecret,now:clock});
  const oldAuthority=authorityFor('probe-key-a');
  const serviceA=new JourneyActionWorkerService(repoA,new NoContentWorkerTelemetry(),()=>new Date(clock),{mode:'durable',safety:repoA});
  const serviceB=new JourneyActionWorkerService(repoB,new NoContentWorkerTelemetry(),()=>new Date(clock),{mode:'durable',safety:repoB});
  const adapterWorker=new JourneyReviewedAdapterWorker(first,serviceA);

  const contenders=await Promise.all([serviceA.claim(oldAuthority,5),serviceB.claim(oldAuthority,5)]);
  const winner=contenders.find(Boolean),denied=contenders.filter((value)=>!value).length;
  assert.ok(winner?.reservationId,'one independent adapter must win a durable reservation');assert.equal(denied,1);
  assert.equal((await adapterWorker.execute(oldAuthority,winner)).replayed,false);
  const receipt=first.prepare(`SELECT receipt.adapter,receipt.provider_reference_sha256,receipt.response_sha256,attempt.request_sha256
    FROM journey_adapter_effect_receipts receipt JOIN journey_adapter_execution_attempts attempt
      ON attempt.queue_id=receipt.queue_id AND attempt.space_id=receipt.space_id AND attempt.outcome='succeeded'
    WHERE receipt.queue_id=?`).get(winner.queueId);
  assert.equal(repoA.completeReservedReviewedEffect({authority:oldAuthority,lease:winner,reservationId:winner.reservationId,
    adapter:receipt.adapter,
    providerReferenceSha256:receipt.provider_reference_sha256,responseSha256:receipt.response_sha256,
    requestSha256:receipt.request_sha256,at:clock}).replayed,true);
  assert.equal(Number(first.prepare("SELECT COUNT(*) count FROM journey_adapter_effect_receipts WHERE queue_id=?").get(winner.queueId).count),1);
  assert.equal(Number(first.prepare("SELECT COUNT(*) count FROM assistant_actions WHERE title='Runtime 44 reviewed effect'").get().count),1);
  assert.equal(Number(first.prepare("SELECT COUNT(*) count FROM platform_usage_events WHERE source_type='journey_action_worker' AND source_id=?").get(winner.queueId).count),1);

  const crashed=await serviceA.claim(oldAuthority,5);assert.ok(crashed?.reservationId,'crash fixture must reserve');
  clock='2026-08-08T12:00:06.000Z';assert.equal(repoB.reapExpired(clock),1);
  const reclaimed=await serviceB.claim(oldAuthority,5);assert.ok(reclaimed?.reservationId);assert.equal(reclaimed.queueId,crashed.queueId);
  assert.ok(reclaimed.fencingToken>crashed.fencingToken,'reclaimed lease must advance the fence');await serviceB.completeNoEffect(oldAuthority,reclaimed);
  assert.equal(Number(first.prepare("SELECT COUNT(*) count FROM journey_action_worker_reservations WHERE queue_id=? AND state='expired'").get(crashed.queueId).count),1);

  const rotating=await serviceA.claim(oldAuthority,5);assert.ok(rotating?.reservationId,'rotation fixture must reserve');
  repoA.rotatePrincipal({previousId:'probe-worker',expectedRevision:1,nextId:'probe-worker-b',nextKeyId:'probe-key-b',nextKeyRef:'file://probe-key-b',
    notBefore:clock,expiresAt:'2026-08-10T00:00:00.000Z',at:clock});
  await serviceA.completeNoEffect(oldAuthority,rotating);
  await assert.rejects(()=>serviceA.claim(oldAuthority,5),/inactive/i);
  const newAuthority=authorityFor('probe-key-b');const replacement=await serviceB.claim(newAuthority,5);assert.ok(replacement?.reservationId);
  await serviceB.completeNoEffect(newAuthority,replacement);

  const unknownWebhook=await serviceB.claim(newAuthority,5);assert.ok(unknownWebhook?.reservationId);
  assert.equal(unknownWebhook.adapter,'signed_webhook');
  first.prepare(`INSERT INTO journey_webhook_dispatches(id,queue_id,destination_id,space_id,nonce,signed_at,request_body_sha256,state,
    attempt_count,updated_at,created_at) VALUES ('worker44-dispatch',?,'worker44-webhook',?,'stable-nonce',?,?,'sending',1,?,?)`)
    .run(unknownWebhook.queueId,spaceId,clock,'a'.repeat(64),clock,clock);
  await serviceB.fail(newAuthority,unknownWebhook,'WEBHOOK_PROVIDER_OUTCOME_UNKNOWN');
  first.prepare("UPDATE journey_webhook_dispatches SET state='succeeded',response_status=202,response_sha256=?,updated_at=? WHERE id='worker44-dispatch'")
    .run('b'.repeat(64),clock);
  const retriedWebhook=await serviceB.claim(newAuthority,5);assert.ok(retriedWebhook?.reservationId);
  assert.equal(retriedWebhook.queueId,unknownWebhook.queueId);assert.ok(retriedWebhook.fencingToken>unknownWebhook.fencingToken);
  await serviceB.completeReviewedEffect(newAuthority,retriedWebhook,{adapter:'signed_webhook',providerReferenceSha256:'c'.repeat(64),
    responseSha256:'b'.repeat(64),requestSha256:'d'.repeat(64)});
  assert.equal(Number(first.prepare("SELECT COUNT(*) count FROM journey_webhook_dispatches WHERE id='worker44-dispatch' AND attempt_count=1").get().count),1);
  assert.equal(Number(first.prepare('SELECT COUNT(*) count FROM platform_usage_events WHERE source_id=?').get(retriedWebhook.queueId).count),1);

  const states=first.prepare("SELECT state,COUNT(*) count FROM journey_action_worker_reservations GROUP BY state ORDER BY state").all();
  assert.ok(states.some((row)=>row.state==='consumed'&&Number(row.count)>=5));
  assert.equal(Number(first.prepare("SELECT COUNT(*) count FROM journey_action_worker_reservation_events WHERE detail_sha256 !~ '^[a-f0-9]{64}$'").get().count),0);
  console.log(JSON.stringify({event:'journey_action_worker_postgres_probe_passed',spaceIdSha256:crypto.createHash('sha256').update(spaceId).digest('hex'),
    independentAdapters:2,expiredReservations:1,rotationVerified:true,canonicalUsageVerified:true,
    reviewedEffectReplayVerified:true,webhookUnknownRetryFenced:true}));
}finally{first.close();second.close();}
