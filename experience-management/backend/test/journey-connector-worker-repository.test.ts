import assert from 'node:assert/strict';import test from 'node:test';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import Database from 'better-sqlite3';
import {mintConnectorWorkerCredential} from '../src/journeyConnectorWorkerDomain.js';
import {JourneyConnectorWorkerRepository} from '../src/journeyConnectorWorkerRepository.js';
import {JourneyConnectorWorkerService} from '../src/journeyConnectorWorkerService.js';
const secret='x'.repeat(48),t0='2026-08-08T10:00:00.000Z';
function setup(databasePath=':memory:'){const raw=new Database(databasePath);raw.pragma('foreign_keys=ON');raw.exec(`
 CREATE TABLE spaces(id TEXT PRIMARY KEY);CREATE TABLE surveys(id TEXT PRIMARY KEY,space_id TEXT NOT NULL,title TEXT,updated_at TEXT);
 CREATE TABLE platform_subscriptions(id TEXT PRIMARY KEY,space_id TEXT NOT NULL UNIQUE,status TEXT NOT NULL,features_json TEXT NOT NULL);
 CREATE TABLE tickets(id TEXT PRIMARY KEY,survey_id TEXT NOT NULL,priority TEXT NOT NULL,status TEXT NOT NULL,title TEXT NOT NULL DEFAULT '',owner TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE journey_connector_definitions(id TEXT PRIMARY KEY,space_id TEXT NOT NULL,kind TEXT NOT NULL,state TEXT NOT NULL,maximum_attempts INTEGER NOT NULL DEFAULT 5,base_retry_seconds INTEGER NOT NULL DEFAULT 5,UNIQUE(id,space_id));
 CREATE TABLE journey_connector_import_runs(id TEXT PRIMARY KEY,connector_id TEXT NOT NULL,space_id TEXT NOT NULL,state TEXT NOT NULL,checkpoint_revision INTEGER NOT NULL,expected_cursor TEXT,attempt_count INTEGER NOT NULL,retry_at TEXT,accepted_count INTEGER NOT NULL,rejected_count INTEGER NOT NULL,tombstone_count INTEGER NOT NULL,last_error_code TEXT,created_by_user_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(id,connector_id,space_id));
 CREATE TABLE journey_connector_records(connector_id TEXT NOT NULL,space_id TEXT NOT NULL,external_id TEXT NOT NULL,state TEXT NOT NULL,payload_json TEXT,payload_sha256 TEXT,source_occurred_at TEXT NOT NULL,last_run_id TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(connector_id,space_id,external_id));
 CREATE TABLE journey_connector_item_receipts(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,connector_id TEXT NOT NULL,space_id TEXT NOT NULL,external_id_sha256 TEXT NOT NULL,operation TEXT NOT NULL,outcome TEXT NOT NULL,code TEXT NOT NULL,item_checksum TEXT,checkpoint_revision INTEGER NOT NULL,created_at TEXT NOT NULL);
 INSERT INTO spaces VALUES('space-a'),('space-b');INSERT INTO surveys VALUES('survey-a','space-a','A','${t0}'),('survey-b','space-b','B','${t0}');
 INSERT INTO platform_subscriptions VALUES('sub-a','space-a','active','{"journeyConnectors":true}'),('sub-b','space-b','active','{"journeyConnectors":true}');
 INSERT INTO journey_connector_definitions VALUES('connector-a','space-a','jsonl_upload','active',5,5),('connector-b','space-b','jsonl_upload','active',5,5);
 INSERT INTO tickets(id,survey_id,priority,status,created_at,updated_at) VALUES('ticket-a','survey-a','high','open','${t0}','${t0}'),('ticket-b','survey-b','low','closed','${t0}','${t0}');`);
 const db=Object.assign(raw,{provider:'sqlite' as const,health:()=>({provider:'sqlite' as const,ready:true})});
 const repo=new JourneyConnectorWorkerRepository(db,ref=>ref==='env://connector-worker-a'?secret:'');
 repo.provisionTicketSource({id:'source-a',spaceId:'space-a',connectorId:'connector-a',surveyIds:['survey-a'],intervalSeconds:60,pageSize:10,at:t0});
 repo.provisionPrincipal({id:'principal-a',keyId:'key-a',secretRef:'env://connector-worker-a',state:'active',allowedSpaceIds:['space-a'],
   allowedConnectorIds:['connector-a'],allowedAdapters:['service_recovery_tickets_v1'],notBefore:t0,expiresAt:'2026-08-09T10:00:00.000Z',at:t0});
 const credential=mintConnectorWorkerCredential({principalId:'principal-a',keyId:'key-a',allowedSpaceIds:['space-a'],allowedConnectorIds:['connector-a'],
   allowedAdapters:['service_recovery_tickets_v1'],issuedAt:t0,expiresAt:'2026-08-09T10:00:00.000Z',secret});
 return{raw,repo,authority:repo.authenticate({credential,at:t0})};}
test('scheduled first-party adapter imports governed ticket fields and never foreign tenant rows',()=>{const{raw,repo,authority}=setup();
  const worker=new JourneyConnectorWorkerService(repo,authority,()=>new Date(t0));const first=worker.runOnce();assert.ok(first);
  const record=raw.prepare(`SELECT * FROM journey_connector_records WHERE external_id='ticket:ticket-a'`).get() as any;assert.equal(record.state,'active');
  assert.equal((raw.prepare(`SELECT COUNT(*) count FROM journey_connector_records WHERE external_id='ticket:ticket-b'`).get() as any).count,0);
  assert.doesNotMatch(String(record.payload_json),/title|notes|owner|response|content/iu);
  const second=worker.runOnce();assert.ok(second);assert.equal((second!.result as any).cycleComplete,true);});
test('authoritative deletion becomes a tombstone on the next durable cycle',()=>{const{raw,repo,authority}=setup();let now=t0;
  const worker=new JourneyConnectorWorkerService(repo,authority,()=>new Date(now));worker.runOnce();worker.runOnce();
  raw.prepare(`DELETE FROM tickets WHERE id='ticket-a'`).run();now='2026-08-08T10:01:01.000Z';worker.runOnce();worker.runOnce();
  const record=raw.prepare(`SELECT state,payload_json FROM journey_connector_records WHERE external_id='ticket:ticket-a'`).get() as any;
  assert.equal(record.state,'tombstoned');assert.equal(record.payload_json,null);assert.equal((raw.prepare(`SELECT COUNT(*) count FROM journey_connector_item_receipts WHERE operation='delete'`).get() as any).count,1);});
test('leases are fenced, expired work is reaped, and stale completion is denied',()=>{const{repo,authority}=setup();const lease=repo.claim({authority,now:t0,leaseSeconds:10});assert.ok(lease);
  assert.equal(repo.claim({authority,now:t0,leaseSeconds:10}),null);assert.equal(repo.reapExpired('2026-08-08T10:00:11.000Z'),1);
  const replacement=repo.claim({authority,now:'2026-08-08T10:00:11.000Z',leaseSeconds:10});assert.ok(replacement);assert.ok(replacement!.fencingToken>lease!.fencingToken);
  assert.throws(()=>repo.commitTicketPage({authority,lease:lease!,rows:[],at:'2026-08-08T10:00:11.000Z'}),/stale/u);});
test('two durable SQLite adapters cannot claim the same due source',()=>{const directory=fs.mkdtempSync(path.join(os.tmpdir(),'connector-worker-'));
  const file=path.join(directory,'runtime.sqlite');const first=setup(file),raw2=new Database(file);raw2.pragma('foreign_keys=ON');
  const db2=Object.assign(raw2,{provider:'sqlite' as const,health:()=>({provider:'sqlite' as const,ready:true})});
  const second=new JourneyConnectorWorkerRepository(db2,()=>secret);const claimed=first.repo.claim({authority:first.authority,now:t0,leaseSeconds:10});assert.ok(claimed);
  assert.equal(second.claim({authority:first.authority,now:t0,leaseSeconds:10}),null);raw2.close();first.raw.close();fs.rmSync(directory,{recursive:true,force:true});});
test('stored principal scope and secret reference fail closed',()=>{const{repo}=setup();const foreign=mintConnectorWorkerCredential({principalId:'principal-a',keyId:'key-a',
  allowedSpaceIds:['space-b'],allowedConnectorIds:['connector-b'],allowedAdapters:['service_recovery_tickets_v1'],issuedAt:t0,expiresAt:'2026-08-09T10:00:00.000Z',secret});
  assert.throws(()=>repo.authenticate({credential:foreign,at:t0}),/exceeds/u);});
test('live connector entitlement is re-evaluated at claim time',()=>{const{raw,repo,authority}=setup();raw.prepare(`UPDATE platform_subscriptions SET features_json='{"journeyConnectors":false}' WHERE space_id='space-a'`).run();
  assert.equal(repo.claim({authority,now:t0,leaseSeconds:10}),null);});
test('principal rotation is CAS-bound and old credentials stop authenticating',()=>{const{raw,repo}=setup();repo.rotatePrincipal({currentId:'principal-a',expectedRevision:1,
  replacement:{id:'principal-next',keyId:'key-next',secretRef:'env://connector-worker-a',notBefore:t0,expiresAt:'2026-08-09T10:00:00.000Z'},at:t0});
  const old=mintConnectorWorkerCredential({principalId:'principal-a',keyId:'key-a',allowedSpaceIds:['space-a'],allowedConnectorIds:['connector-a'],
    allowedAdapters:['service_recovery_tickets_v1'],issuedAt:t0,expiresAt:'2026-08-09T10:00:00.000Z',secret});
  assert.throws(()=>repo.authenticate({credential:old,at:t0}),/unavailable/u);assert.equal((raw.prepare('SELECT COUNT(*) count FROM journey_connector_worker_key_events').get() as any).count,3);
  assert.throws(()=>repo.rotatePrincipal({currentId:'principal-a',expectedRevision:1,replacement:{id:'x',keyId:'x',secretRef:'env://connector-worker-a',
    notBefore:t0,expiresAt:'2026-08-09T10:00:00.000Z'},at:t0}),/unavailable/u);});
test('already-authenticated authority is rechecked after live revocation',()=>{const{raw,repo,authority}=setup();raw.prepare(`UPDATE journey_connector_worker_principals SET state='revoked',revision=revision+1`).run();
  assert.throws(()=>repo.claim({authority,now:t0,leaseSeconds:10}),/inactive/u);});
test('crash reaping closes the abandoned import and preserves resumable source state',()=>{const{raw,repo,authority}=setup();const lease=repo.claim({authority,now:t0,leaseSeconds:10});assert.ok(lease);
  assert.equal(repo.reapExpired('2026-08-08T10:00:11.000Z'),1);const run=raw.prepare('SELECT state,last_error_code FROM journey_connector_import_runs WHERE id=?').get(lease!.runId) as any;
  assert.deepEqual(run,{state:'failed',last_error_code:'LEASE_EXPIRED'});const replacement=repo.claim({authority,now:'2026-08-08T10:00:11.000Z',leaseSeconds:10});assert.ok(replacement);});
test('transient failure is durably retried without leaving a phantom retry-wait import',()=>{const{raw,repo,authority}=setup();const lease=repo.claim({authority,now:t0,leaseSeconds:10});assert.ok(lease);
  const failed=repo.fail({authority,lease:lease!,code:'SOURCE_TRANSIENT',at:'2026-08-08T10:00:01.000Z'});assert.equal(failed.terminal,false);assert.ok(failed.retryAt);
  assert.equal(repo.claim({authority,now:'2026-08-08T10:00:02.000Z',leaseSeconds:10}),null);
  assert.ok(repo.claim({authority,now:failed.retryAt!,leaseSeconds:10}));const old=raw.prepare('SELECT state,retry_at FROM journey_connector_import_runs WHERE id=?').get(lease!.runId) as any;
  assert.deepEqual(old,{state:'failed',retry_at:null});});
test('append-only telemetry contains counts and codes, never connector payloads',()=>{const{raw,repo,authority}=setup();new JourneyConnectorWorkerService(repo,authority,()=>new Date(t0)).runOnce();
  const row=raw.prepare('SELECT * FROM journey_connector_worker_events LIMIT 1').get() as any;assert.deepEqual(Object.keys(JSON.parse(row.counts_json)).sort(),['attempt']);
  assert.throws(()=>raw.prepare(`UPDATE journey_connector_worker_events SET code='X'`).run(),/append-only/u);});
