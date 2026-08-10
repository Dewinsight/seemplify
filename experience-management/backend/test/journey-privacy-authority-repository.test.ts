import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import type { DatabaseRuntime } from '../src/databaseAdapter.js';
import { advanceJourneyPrivacyCheckpoint, createJourneyPrivacyCheckpoint, journeyPrivacyPropagationTargets,
  type JourneyPrivacyCheckpoint } from '../src/journeyPrivacyPropagationDomain.js';
import { JourneyPrivacyAuthorityError, JourneyPrivacyAuthorityRepository, journeyPrivacyCheckpointSha256,
  journeyPrivacyRuntime47Tables, type JourneyPrivacyOperatorAuthority } from '../src/journeyPrivacyAuthorityRepository.js';

const at='2026-08-08T12:00:00.000Z',settleAt='2026-08-08T12:00:10.000Z',later='2026-08-08T12:10:00.000Z',worker='a'.repeat(64);
const operator:JourneyPrivacyOperatorAuthority={kind:'journey_privacy_operator',userId:'platform-admin',platformAdmin:true};

function setup(){const sqlite=new Database(':memory:');Object.defineProperty(sqlite,'provider',{value:'sqlite'});sqlite.exec(`
  CREATE TABLE spaces(id TEXT PRIMARY KEY);
  CREATE TABLE journey_profile_privacy_jobs(id TEXT PRIMARY KEY,space_id TEXT NOT NULL,profile_id TEXT NOT NULL,operation TEXT NOT NULL,
    state TEXT NOT NULL,result_json TEXT NOT NULL,created_at TEXT NOT NULL,completed_at TEXT);
  CREATE TABLE journey_identity_correction_runs(id TEXT PRIMARY KEY,space_id TEXT NOT NULL,command_id TEXT NOT NULL,
    profile_ids_json TEXT NOT NULL,result_json TEXT NOT NULL,created_at TEXT NOT NULL);
  INSERT INTO spaces VALUES ('space-a'),('space-b');`);const db=sqlite as unknown as DatabaseRuntime;
  return {sqlite,repo:new JourneyPrivacyAuthorityRepository(db)};}

function provision(repo:JourneyPrivacyAuthorityRepository,id='privacy-principal-a',keyId='privacy-key-a',spaces=['space-a']){
  return repo.provisionPrincipal({id,keyId,keyRef:`kms://privacy/${keyId}`,allowedSpaceIds:spaces,allowedRegions:['EU-WEST'],
    notBefore:'2026-08-08T00:00:00.000Z',expiresAt:'2026-08-09T00:00:00.000Z',at});}
function insertJob(sqlite:Database.Database,id:string,spaceId='space-a',operation='suppress'){
  sqlite.prepare(`INSERT INTO journey_profile_privacy_jobs VALUES (?,?,?,?, 'queued','{}',?,NULL)`)
    .run(id,spaceId,`profile-${id}`,operation,at);}
function completeCheckpoint(){let checkpoint:JourneyPrivacyCheckpoint=createJourneyPrivacyCheckpoint(at);
  for(const target of journeyPrivacyPropagationTargets)checkpoint=advanceJourneyPrivacyCheckpoint({checkpoint,target,state:target==='immutable_evidence'
    ?'preserved_append_only':'completed',affectedCount:1,code:'target_completed',at:settleAt});return checkpoint;}

test('runtime47 SQLite parity declares the dedicated authority, claim and append-only event tables',()=>{
  const {sqlite}=setup();const names=(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'journey_privacy_%' ORDER BY name")
    .all() as any[]).map(row=>row.name);assert.deepEqual(names,[...journeyPrivacyRuntime47Tables].sort());
  sqlite.prepare("INSERT INTO journey_privacy_service_key_audit VALUES ('a','p','provisioned',NULL,'x',1,'{}','x','x')").run();
  assert.throws(()=>sqlite.prepare("UPDATE journey_privacy_service_key_audit SET action='revoked' WHERE id='a'").run(),/append-only/);
});

test('principal provisioning is externally referenced, scoped, bounded and rotates without editing key identity',()=>{
  const {sqlite,repo}=setup();const first=provision(repo);assert.equal(first.state,'active');assert.equal(first.key_ref,'kms://privacy/privacy-key-a');
  assert.doesNotMatch(JSON.stringify(sqlite.prepare('SELECT * FROM journey_privacy_service_key_audit').all()),/kms:\/\/|privacy-key-a/u);
  assert.throws(()=>repo.provisionPrincipal({id:'bad',keyId:'bad',keyRef:'plaintext-secret',allowedSpaceIds:['space-a'],allowedRegions:['EU-WEST'],
    notBefore:at,expiresAt:later,at}),JourneyPrivacyAuthorityError);
  const rotated=repo.rotatePrincipal({currentPrincipalId:first.id,expectedRevision:1,nextId:'privacy-principal-b',nextKeyId:'privacy-key-b',
    nextKeyRef:'vault://privacy/privacy-key-b',notBefore:'2026-08-08T00:00:00.000Z',expiresAt:'2026-08-10T00:00:00.000Z',at});
  assert.equal(rotated.previous.state,'draining');assert.equal(rotated.current.state,'active');
  assert.throws(()=>repo.authenticate({principalId:first.id,keyId:first.key_id,workerIdSha256:worker,at}),/unavailable/);
  assert.equal(repo.authenticate({principalId:rotated.current.id,keyId:'privacy-key-b',workerIdSha256:worker,at}).allowedSpaceIds[0],'space-a');
  assert.throws(()=>repo.rotatePrincipal({currentPrincipalId:first.id,expectedRevision:1,nextId:'x',nextKeyId:'x',nextKeyRef:'kms://x/xxx',
    notBefore:at,expiresAt:later,at}),/changed/);
});

test('claims are tenant-scoped, fenced, crash-resumable, and stale workers cannot checkpoint',()=>{
  const {sqlite,repo}=setup();const principal=provision(repo);const authority=repo.authenticate({principalId:principal.id,keyId:principal.key_id,
    workerIdSha256:worker,at});insertJob(sqlite,'job-a','space-a');insertJob(sqlite,'job-b','space-b');
  const first=repo.claim(authority,{leaseToken:'lease-token-a-123456789012',leaseSeconds:5,at})!;
  assert.equal(first.claim.source_id,'job-a');assert.equal(first.claim.space_id,'space-a');assert.equal(first.claim.lease_generation,1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM journey_privacy_propagation_claims WHERE space_id='space-b'").get().count,0);
  const checkpoint=advanceJourneyPrivacyCheckpoint({checkpoint:createJourneyPrivacyCheckpoint(at),target:'future_effect_controls',state:'completed',
    affectedCount:2,code:'future_effects_suppressed',at});
  assert.throws(()=>repo.checkpoint(authority,{claimId:first.claim.id,leaseToken:'wrong-token-1234567890123456',leaseGeneration:1,
    expectedRevision:first.claim.revision,state:'pending',checkpoint,checkpointSha256:journeyPrivacyCheckpointSha256(checkpoint),at}),/fence/);
  const reclaimed=repo.claim(authority,{leaseToken:'lease-token-b-123456789012',leaseSeconds:30,at:'2026-08-08T12:00:06.000Z'})!;
  assert.equal(reclaimed.claim.id,first.claim.id);assert.equal(reclaimed.claim.lease_generation,2);
  assert.equal((sqlite.prepare("SELECT COUNT(*) count FROM journey_privacy_propagation_events WHERE event='lease_expired'").get() as any).count,1);
  assert.throws(()=>repo.checkpoint(authority,{claimId:first.claim.id,leaseToken:first.leaseToken,leaseGeneration:1,
    expectedRevision:first.claim.revision,state:'pending',checkpoint,checkpointSha256:journeyPrivacyCheckpointSha256(checkpoint),at:settleAt}),/fence/);
  const settled=repo.checkpoint(authority,{claimId:reclaimed.claim.id,leaseToken:reclaimed.leaseToken,leaseGeneration:2,
    expectedRevision:reclaimed.claim.revision,state:'pending',checkpoint,checkpointSha256:journeyPrivacyCheckpointSha256(checkpoint),at:settleAt});
  assert.equal(settled.state,'pending');assert.equal(settled.lease_token_sha256,null);
});

test('checkpoint corruption and caller-controlled sensitive fields fail closed',()=>{
  const {sqlite,repo}=setup();const principal=provision(repo);const authority=repo.authenticate({principalId:principal.id,keyId:principal.key_id,
    workerIdSha256:worker,at});insertJob(sqlite,'job-corrupt');const claim=repo.claim(authority,{leaseToken:'lease-token-c-123456789012',leaseSeconds:30,at})!;
  const checkpoint={...createJourneyPrivacyCheckpoint(at),payload:'private'} as any;
  assert.throws(()=>repo.checkpoint(authority,{claimId:claim.claim.id,leaseToken:claim.leaseToken,leaseGeneration:1,
    expectedRevision:claim.claim.revision,state:'pending',checkpoint,checkpointSha256:'b'.repeat(64),at}),/corrupt/);
  assert.equal((sqlite.prepare('SELECT state FROM journey_privacy_propagation_claims WHERE id=?').get(claim.claim.id) as any).state,'leased');
});

test('erasure cannot complete until legal hold, backup, region and raw authority are explicitly completed',()=>{
  const {sqlite,repo}=setup();const principal=provision(repo);const authority=repo.authenticate({principalId:principal.id,keyId:principal.key_id,
    workerIdSha256:worker,at});insertJob(sqlite,'job-erasure','space-a','erasure');const claimed=repo.claim(authority,
      {leaseToken:'lease-token-e-123456789012',leaseSeconds:300,at})!;const checkpoint=completeCheckpoint();
  assert.throws(()=>repo.checkpoint(authority,{claimId:claimed.claim.id,leaseToken:claimed.leaseToken,leaseGeneration:1,
    expectedRevision:claimed.claim.revision,state:'completed',checkpoint,checkpointSha256:journeyPrivacyCheckpointSha256(checkpoint),at:settleAt}),
    /authority is incomplete/);
  assert.throws(()=>repo.recordErasureAuthority({kind:'journey_privacy_operator',userId:'member',platformAdmin:false} as any,
    {spaceId:'space-a',privacyJobId:'job-erasure',expectedRevision:0,legalHoldState:'clear',backupState:'deletion_scheduled',
      regionState:'deletion_scheduled',rawErasureState:'authorized',authorityReferenceSha256:'c'.repeat(64),at}),/required/);
  const authorized=repo.recordErasureAuthority(operator,{spaceId:'space-a',privacyJobId:'job-erasure',expectedRevision:0,
    legalHoldState:'clear',backupState:'deletion_scheduled',regionState:'deletion_scheduled',rawErasureState:'authorized',
    authorityReferenceSha256:'c'.repeat(64),at}) as any;assert.equal(authorized.raw_erasure_state,'authorized');
  assert.throws(()=>repo.recordErasureAuthority(operator,{spaceId:'space-a',privacyJobId:'job-erasure',expectedRevision:1,
    legalHoldState:'active',backupState:'deletion_confirmed',regionState:'deletion_confirmed',rawErasureState:'completed',
    authorityReferenceSha256:'d'.repeat(64),at:settleAt}),/not authorised/);
  repo.recordErasureAuthority(operator,{spaceId:'space-a',privacyJobId:'job-erasure',expectedRevision:1,legalHoldState:'clear',
    backupState:'deletion_confirmed',regionState:'deletion_confirmed',rawErasureState:'completed',authorityReferenceSha256:'d'.repeat(64),at:settleAt});
  const settled=repo.checkpoint(authority,{claimId:claimed.claim.id,leaseToken:claimed.leaseToken,leaseGeneration:1,
    expectedRevision:claimed.claim.revision,state:'completed',checkpoint,checkpointSha256:journeyPrivacyCheckpointSha256(checkpoint),at:settleAt});
  assert.equal(settled.state,'completed');assert.equal((sqlite.prepare("SELECT state FROM journey_profile_privacy_jobs WHERE id='job-erasure'").get() as any).state,'completed');
});

test('correction claims settle independently without inventing erasure authority',()=>{
  const {sqlite,repo}=setup();const principal=provision(repo);const authority=repo.authenticate({principalId:principal.id,keyId:principal.key_id,
    workerIdSha256:worker,at});sqlite.prepare('INSERT INTO journey_identity_correction_runs VALUES (?,?,?,?,?,?)')
    .run('correction-a','space-a','command-a',JSON.stringify(['profile-a']),'{}',at);
  const claimed=repo.claim(authority,{leaseToken:'lease-token-r-123456789012',leaseSeconds:300,at})!;assert.equal(claimed.claim.operation,'correction');
  const checkpoint=completeCheckpoint();repo.checkpoint(authority,{claimId:claimed.claim.id,leaseToken:claimed.leaseToken,leaseGeneration:1,
    expectedRevision:claimed.claim.revision,state:'completed',checkpoint,checkpointSha256:journeyPrivacyCheckpointSha256(checkpoint),at:settleAt});
  const result=JSON.parse((sqlite.prepare('SELECT result_json FROM journey_identity_correction_runs').get() as any).result_json);
  assert.equal(result.privacyPropagation.status,'completed');assert.equal((sqlite.prepare('SELECT COUNT(*) count FROM journey_privacy_erasure_authorities').get() as any).count,0);
});
