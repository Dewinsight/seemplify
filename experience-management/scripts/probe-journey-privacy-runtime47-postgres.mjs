import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { Client } from 'pg';
import { createDatabase } from '../backend/dist/databaseAdapter.js';
import { advanceJourneyPrivacyCheckpoint, createJourneyPrivacyCheckpoint,
  journeyPrivacyPropagationTargets } from '../backend/dist/journeyPrivacyPropagationDomain.js';
import { JourneyPrivacyAuthorityRepository,
  journeyPrivacyCheckpointSha256 } from '../backend/dist/journeyPrivacyAuthorityRepository.js';

const required=(name)=>{const value=String(process.env[name]||'').trim();if(!value)throw new Error(`${name} is required.`);return value;};
const postgres=(user,passwordFile)=>({host:required('POSTGRES_HOST'),port:Number(required('POSTGRES_PORT')),
  database:required('POSTGRES_DATABASE'),user,passwordFile,ssl:false,schemaVersion:1,
  runtimeSchemaVersion:Number(required('POSTGRES_RUNTIME_SCHEMA_VERSION')),sourceSha256:required('POSTGRES_SOURCE_SHA256')});
const workerSettings={databaseProvider:'postgres',databasePath:'',postgres:postgres(required('POSTGRES_PRIVACY_WORKER_USER'),
  required('POSTGRES_PRIVACY_WORKER_PASSWORD_FILE'))};
const ownerPasswordFile=required('POSTGRES_PROBE_OWNER_PASSWORD_FILE');
const first=createDatabase(workerSettings),second=createDatabase(workerSettings),owner=new Client({host:required('POSTGRES_HOST'),
  port:Number(required('POSTGRES_PORT')),database:required('POSTGRES_DATABASE'),user:required('POSTGRES_PROBE_OWNER_USER'),
  password:fs.readFileSync(ownerPasswordFile,'utf8').trim(),ssl:false});
const principalId='privacy47-principal',keyId='privacy47-key',worker='a'.repeat(64),otherWorker='b'.repeat(64);
const spaceA='privacy47-space-a',spaceB='privacy47-space-b';let now='2026-08-08T13:00:00.000Z';
const repoA=new JourneyPrivacyAuthorityRepository(first),repoB=new JourneyPrivacyAuthorityRepository(second);
const completeCheckpoint=(startedAt,settledAt)=>{let checkpoint=createJourneyPrivacyCheckpoint(startedAt);
  for(const target of journeyPrivacyPropagationTargets)checkpoint=advanceJourneyPrivacyCheckpoint({checkpoint,target,
    state:target==='immutable_evidence'?'preserved_append_only':'completed',affectedCount:1,code:'target_completed',at:settledAt});
  return checkpoint;};
const operatorCheckpoint=(startedAt,settledAt)=>{let checkpoint=createJourneyPrivacyCheckpoint(startedAt);
  for(const target of journeyPrivacyPropagationTargets){checkpoint=advanceJourneyPrivacyCheckpoint({checkpoint,target,
    state:target==='raw_identity_event_erasure'?'operator_required':target==='immutable_evidence'?'preserved_append_only':'completed',
    affectedCount:0,code:target==='raw_identity_event_erasure'?'external_authority_required':'target_completed',at:settledAt});
    if(checkpoint.status==='operator_required')break;}return checkpoint;};
const insertJob=(id,operation,space=spaceA)=>owner.query(`INSERT INTO journey_profile_privacy_jobs
  (id,space_id,profile_id,operation,purpose,state,request_json,result_json,requested_by_user_id,created_at,completed_at)
  VALUES ($1,$2,$3,$4,'analytics','queued','{}','{}','privacy47-user',$5,NULL)`,[id,space,`${space}-profile`,operation,now]);
try{
  await owner.connect();
  for(const runtime of [first,second]){const session=runtime.prepare(`SELECT current_user AS "currentUser",
      has_function_privilege(current_user,'journey_privacy_claim(text,text,text,timestamptz,integer)','EXECUTE') AS "canClaim",
      has_table_privilege(current_user,'public.journey_privacy_propagation_claims','SELECT') AS "canReadClaims"`).get();
    assert.equal(session.currentUser,workerSettings.postgres.user);assert.equal(session.canClaim,true);assert.equal(session.canReadClaims,false);}
  await owner.query(`INSERT INTO users(id,email,name,password_hash,role,session_version,created_at,updated_at)
    VALUES ('privacy47-user','privacy47@example.invalid','Runtime 47 privacy','not-a-login','member',1,'${now}','${now}');
    INSERT INTO spaces(id,name,slug,created_by_user_id,personal_for_user_id,created_at,updated_at) VALUES
      ('${spaceA}','Privacy 47 A','privacy47-a','privacy47-user',NULL,'${now}','${now}'),
      ('${spaceB}','Privacy 47 B','privacy47-b','privacy47-user',NULL,'${now}','${now}');
    INSERT INTO journey_identity_profiles(id,space_id,kind,status,created_at,created_by_command_id) VALUES
      ('${spaceA}-profile','${spaceA}','anonymous','active','${now}','privacy47-command-a'),
      ('${spaceB}-profile','${spaceB}','anonymous','active','${now}','privacy47-command-b');
    INSERT INTO journey_privacy_service_principals(id,key_id,key_ref,state,allowed_space_ids_json,allowed_regions_json,
      not_before,expires_at,revision,created_at,updated_at) VALUES ('${principalId}','${keyId}','kms://privacy/runtime47','active',
      '["${spaceA}"]','["EU-WEST"]','2026-08-08T00:00:00.000Z','2026-08-09T00:00:00.000Z',1,'${now}','${now}');`);
  const authorityA=repoA.authenticate({principalId,keyId,workerIdSha256:worker,at:now});
  const authorityB=repoB.authenticate({principalId,keyId,workerIdSha256:otherWorker,at:now});
  await insertJob('privacy47-contention','suppress');
  await insertJob('privacy47-out-of-scope','suppress',spaceB);
  const contenders=await Promise.all([repoA.claim(authorityA,{leaseToken:'privacy47-contention-token-a',leaseSeconds:5,at:now}),
    repoB.claim(authorityB,{leaseToken:'privacy47-contention-token-b',leaseSeconds:5,at:now})]);
  const won=contenders.filter(Boolean);assert.equal(won.length,1,'only one independent adapter may claim the single in-scope job');
  assert.equal(won[0].claim.source_id,'privacy47-contention');
  const settledAt='2026-08-08T13:00:01.000Z',checkpoint=completeCheckpoint(now,settledAt);
  const winningRepo=contenders[0]?repoA:repoB,winningAuthority=contenders[0]?authorityA:authorityB;
  winningRepo.checkpoint(winningAuthority,{claimId:won[0].claim.id,leaseToken:won[0].leaseToken,
    leaseGeneration:Number(won[0].claim.lease_generation),expectedRevision:Number(won[0].claim.revision),state:'completed',checkpoint,
    checkpointSha256:journeyPrivacyCheckpointSha256(checkpoint),at:settledAt});
  assert.equal(Number((await owner.query('SELECT COUNT(*) count FROM journey_privacy_propagation_claims WHERE space_id=$1',[spaceB])).rows[0].count),0,
    'out-of-scope tenant work must not even be materialized by this principal');

  now='2026-08-08T13:01:00.000Z';await insertJob('privacy47-crash','suppress');
  const crashed=repoA.claim(authorityA,{leaseToken:'privacy47-crash-token-aaaa',leaseSeconds:5,at:now});assert.ok(crashed);
  const reclaimedAt='2026-08-08T13:01:06.000Z';
  const reclaimed=repoB.claim(authorityB,{leaseToken:'privacy47-crash-token-bbbb',leaseSeconds:5,at:reclaimedAt});assert.ok(reclaimed);
  assert.equal(reclaimed.claim.id,crashed.claim.id);assert.equal(Number(reclaimed.claim.lease_generation),2);
  assert.throws(()=>repoA.checkpoint(authorityA,{claimId:crashed.claim.id,leaseToken:crashed.leaseToken,leaseGeneration:1,
    expectedRevision:Number(crashed.claim.revision),state:'completed',checkpoint:completeCheckpoint(now,reclaimedAt),
    checkpointSha256:journeyPrivacyCheckpointSha256(completeCheckpoint(now,reclaimedAt)),at:reclaimedAt}),/fence/i);
  const crashCheckpoint=completeCheckpoint(now,reclaimedAt);repoB.checkpoint(authorityB,{claimId:reclaimed.claim.id,
    leaseToken:reclaimed.leaseToken,leaseGeneration:2,expectedRevision:Number(reclaimed.claim.revision),state:'completed',
    checkpoint:crashCheckpoint,checkpointSha256:journeyPrivacyCheckpointSha256(crashCheckpoint),at:reclaimedAt});

  now='2026-08-08T13:02:00.000Z';await insertJob('privacy47-erasure','erasure');
  const erasure=repoA.claim(authorityA,{leaseToken:'privacy47-erasure-token-aa',leaseSeconds:60,at:now});assert.ok(erasure);
  const erasureAt='2026-08-08T13:02:01.000Z',erasureCheckpoint=completeCheckpoint(now,erasureAt);
  assert.throws(()=>repoA.checkpoint(authorityA,{claimId:erasure.claim.id,leaseToken:erasure.leaseToken,
    leaseGeneration:Number(erasure.claim.lease_generation),expectedRevision:Number(erasure.claim.revision),state:'completed',
    checkpoint:erasureCheckpoint,checkpointSha256:journeyPrivacyCheckpointSha256(erasureCheckpoint),at:erasureAt}),/authority/i);
  const heldCheckpoint=operatorCheckpoint(now,erasureAt);repoA.checkpoint(authorityA,{claimId:erasure.claim.id,
    leaseToken:erasure.leaseToken,leaseGeneration:Number(erasure.claim.lease_generation),expectedRevision:Number(erasure.claim.revision),
    state:'operator_required',checkpoint:heldCheckpoint,checkpointSha256:journeyPrivacyCheckpointSha256(heldCheckpoint),at:erasureAt});
  await owner.query(`INSERT INTO journey_privacy_erasure_authorities(id,space_id,privacy_job_id,legal_hold_state,backup_state,region_state,
    raw_erasure_state,authority_reference_sha256,reviewed_by_user_id,revision,created_at,updated_at,completed_at)
    VALUES ('privacy47-authority',$1,$2,'clear','deletion_scheduled','deletion_scheduled','authorized',$3,'privacy47-user',1,$4,$4,NULL)`,
    [spaceA,'privacy47-erasure','c'.repeat(64),now]);
  await owner.query(`UPDATE journey_privacy_erasure_authorities SET backup_state='deletion_confirmed',region_state='deletion_confirmed',
    raw_erasure_state='completed',revision=2,updated_at=$1,completed_at=$1 WHERE id='privacy47-authority'`,[erasureAt]);
  const resumedAt='2026-08-08T13:02:02.000Z';const resumed=repoB.claim(authorityB,{leaseToken:'privacy47-erasure-token-bb',
    leaseSeconds:60,at:resumedAt});assert.ok(resumed);assert.equal(resumed.claim.id,erasure.claim.id);
  assert.equal(Number(resumed.claim.lease_generation),2);
  repoB.checkpoint(authorityB,{claimId:resumed.claim.id,leaseToken:resumed.leaseToken,
    leaseGeneration:Number(resumed.claim.lease_generation),expectedRevision:Number(resumed.claim.revision),state:'completed',
    checkpoint:erasureCheckpoint,checkpointSha256:journeyPrivacyCheckpointSha256(erasureCheckpoint),at:resumedAt});
  const evidence=(await owner.query(`SELECT
    (SELECT COUNT(*) FROM journey_privacy_propagation_events WHERE event='lease_expired') AS "expired",
    (SELECT COUNT(*) FROM journey_privacy_propagation_claims WHERE state='completed') AS "completed",
    (SELECT COUNT(*) FROM journey_privacy_propagation_events WHERE detail_sha256 !~ '^[a-f0-9]{64}$') AS "unsafe"`)).rows[0];
  assert.equal(Number(evidence.expired),1);assert.equal(Number(evidence.completed),3);assert.equal(Number(evidence.unsafe),0);
  await owner.query(`UPDATE journey_privacy_service_principals SET state='draining',revision=2,updated_at=$1 WHERE id=$2`,
    [resumedAt,principalId]);
  await owner.query(`INSERT INTO journey_privacy_service_principals(id,key_id,key_ref,state,allowed_space_ids_json,allowed_regions_json,
    not_before,expires_at,revision,created_at,updated_at) VALUES ('privacy47-principal-b','privacy47-key-b','vault://privacy/runtime47-b',
    'active',$1,$2,'2026-08-08T00:00:00.000Z','2026-08-09T00:00:00.000Z',1,$3,$3)`,
    [JSON.stringify([spaceA]),JSON.stringify(['EU-WEST']),resumedAt]);
  assert.throws(()=>repoA.claim(authorityA,{leaseToken:'privacy47-retired-token-aa',leaseSeconds:5,at:resumedAt}),/unavailable/i);
  const rotated=repoB.authenticate({principalId:'privacy47-principal-b',keyId:'privacy47-key-b',workerIdSha256:otherWorker,at:resumedAt});
  assert.equal(repoB.claim(rotated,{leaseToken:'privacy47-rotated-token-bb',leaseSeconds:5,at:resumedAt}),null);
  console.log(JSON.stringify({event:'journey_privacy_runtime47_postgres_probe_passed',independentAdapters:2,
    contentionFenced:true,crashResumeGeneration:2,authorityResumeGeneration:2,crossTenantDenied:true,noFalseCompletion:true,contentSafeEvents:true,
    rotationVerified:true,scopeSha256:crypto.createHash('sha256').update(spaceA).digest('hex')}));
}finally{first.close();second.close();await owner.end().catch(()=>undefined);}
