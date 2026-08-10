import assert from 'node:assert/strict';
import test from 'node:test';
import { JourneyPrivacyPropagationRuntime, createJourneyPrivacyPropagationRuntime } from '../src/journeyPrivacyPropagationRuntime.js';

const base={enabled:false,databaseProvider:'postgres',pollMs:100,batchSize:1,leaseSeconds:5,principalId:'privacy-principal',
  keyId:'privacy-key',keyRef:'external-file://privacy/key',secretFile:'missing-secret',identityKeyFile:'missing-identity',postgres:{}};

test('privacy propagation is a safe no-processing state unless explicitly enabled',()=>{
  assert.equal(createJourneyPrivacyPropagationRuntime(base,()=>undefined),null);
});

test('enabled startup fails closed before opening a database when authority configuration is invalid',()=>{
  assert.throws(()=>createJourneyPrivacyPropagationRuntime({...base,enabled:true,databaseProvider:'sqlite'},()=>undefined),/PostgreSQL/);
  assert.throws(()=>createJourneyPrivacyPropagationRuntime({...base,enabled:true,principalId:'',databaseProvider:'postgres'},()=>undefined),/principal metadata/);
  assert.throws(()=>createJourneyPrivacyPropagationRuntime({...base,enabled:true,keyRef:'kms://privacy/key',databaseProvider:'postgres'},()=>undefined),/no configured resolver/);
  assert.throws(()=>createJourneyPrivacyPropagationRuntime({...base,enabled:true,databaseProvider:'postgres'},()=>undefined),/ENOENT/);
});

test('runtime claims, settles one fenced checkpoint, and closes its dedicated database on drain',async()=>{
  let closed=0,claims=0,checkpoints=0,processed=0;const checkpoint={schema:'seemplify.journey-privacy-propagation/v1',
    status:'completed',cursor:11,updatedAt:'2026-08-08T13:00:00.000Z',targets:{},limitations:[
      'legal_hold_authority_not_modelled','backup_deletion_is_external_to_the_online_database',
      'regional_replica_deletion_is_external_to_the_online_database','append_only_audit_receipts_and_dispatch_evidence_are_preserved',
      'raw_identifier_erasure_requires_a_pseudonymous_reidentification_barrier']};
  const database={close:()=>{closed+=1;}} as any;
  const authority={kind:'journey_privacy_worker',principalId:'p',keyId:'k',workerIdSha256:'a'.repeat(64),
    allowedSpaceIds:['s'],allowedRegions:['EU-WEST'],expiresAt:'2026-08-09T00:00:00.000Z'} as any;
  const authorityRepository={claim:()=>{claims+=1;return claims===1?{claim:{id:'claim',source_type:'privacy_job',source_id:'job',
    lease_generation:1,revision:2},leaseToken:'unused'}:null;},checkpoint:()=>{checkpoints+=1;}} as any;
  const propagationRepository={processNext:()=>{processed+=1;return {checkpoint};}} as any;
  const runtime=new JourneyPrivacyPropagationRuntime(database,authorityRepository,propagationRepository,authority,100,2,5,()=>undefined);
  runtime.start();
  assert.equal(await runtime.drain(1_000),true);assert.equal(processed,1);assert.equal(checkpoints,1);assert.equal(closed,1);
});
