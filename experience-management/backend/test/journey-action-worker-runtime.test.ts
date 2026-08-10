import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { config } from '../src/config.js';
import { createJourneyActionWorkerRuntime } from '../src/journeyActionWorkerRuntime.js';
import { initializeJourneyWorkerSafetySqlite } from '../src/journeyActionWorkerSafetyRepository.js';

test('disabled production worker is a safe no-processing state and enabled mode fails closed',async()=>{const provider=config.databaseProvider,enabled=config.journeyActionWorkerEnabled;
  try{(config as any).databaseProvider='postgres';(config as any).journeyActionWorkerEnabled=false;
    assert.equal(await createJourneyActionWorkerRuntime(),null);
    (config as any).databaseProvider='sqlite';(config as any).journeyActionWorkerEnabled=true;
    await assert.rejects(()=>createJourneyActionWorkerRuntime(),/requires PostgreSQL/);
  }finally{(config as any).databaseProvider=provider;(config as any).journeyActionWorkerEnabled=enabled;}});

test('enabled production worker refuses implicit tenant and adapter scope',async()=>{const before={provider:config.databaseProvider,
  enabled:config.journeyActionWorkerEnabled,spaces:config.journeyActionWorkerSpaceIds,adapters:config.journeyActionWorkerAdapters};
  try{(config as any).databaseProvider='postgres';(config as any).journeyActionWorkerEnabled=true;
    (config as any).journeyActionWorkerSpaceIds=[];(config as any).journeyActionWorkerAdapters=[];
    await assert.rejects(()=>createJourneyActionWorkerRuntime(),/explicit scope of 1 to 100 spaces/);
    (config as any).journeyActionWorkerSpaceIds=Array.from({length:101},(_,index)=>`space-${index}`);
    await assert.rejects(()=>createJourneyActionWorkerRuntime(),/explicit scope of 1 to 100 spaces/);
    (config as any).journeyActionWorkerSpaceIds=['space-a'];(config as any).journeyActionWorkerAdapters=['unreviewed'];
    await assert.rejects(()=>createJourneyActionWorkerRuntime(),/only reviewed adapters/);
  }finally{(config as any).databaseProvider=before.provider;(config as any).journeyActionWorkerEnabled=before.enabled;
    (config as any).journeyActionWorkerSpaceIds=before.spaces;(config as any).journeyActionWorkerAdapters=before.adapters;}});

test('startup refuses mismatched, revoked, and expired operator-approved key metadata',async()=>{const before={provider:config.databaseProvider,
  enabled:config.journeyActionWorkerEnabled,spaces:config.journeyActionWorkerSpaceIds,adapters:config.journeyActionWorkerAdapters,
  keyRef:config.journeyActionWorkerKeyRef,secretFile:config.journeyActionWorkerSecretFile};const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'journey-worker-runtime-'));
  try{(config as any).databaseProvider='postgres';(config as any).journeyActionWorkerEnabled=true;(config as any).journeyActionWorkerSpaceIds=['space-a'];
    (config as any).journeyActionWorkerAdapters=['assistant_action'];(config as any).journeyActionWorkerKeyRef='file://worker-key';
    (config as any).journeyActionWorkerSecretFile=path.join(temporary,'secret');fs.writeFileSync(config.journeyActionWorkerSecretFile,'s'.repeat(64));
    for(const scenario of [{state:'active',keyRef:'file://other',expires:'2027-01-01T00:00:00.000Z',pattern:/rotation/},
      {state:'revoked',keyRef:'file://worker-key',expires:'2027-01-01T00:00:00.000Z',pattern:/rotation/},
      {state:'active',keyRef:'file://worker-key',expires:'2025-01-01T00:00:00.000Z',pattern:/validity/}]){
      const db=new Database(':memory:');db.exec("CREATE TABLE spaces(id TEXT PRIMARY KEY);CREATE TABLE journey_action_queue(id TEXT,space_id TEXT,UNIQUE(id,space_id));INSERT INTO spaces VALUES ('space-a');");
      initializeJourneyWorkerSafetySqlite(db);db.prepare(`INSERT INTO journey_worker_service_principals
        (id,key_id,key_ref,state,allowed_space_ids_json,allowed_adapters_json,not_before,expires_at,revision,created_at,updated_at)
        VALUES ('principal','journey-worker-primary',?,?,?,?,?, ?,1,?,?)`).run(scenario.keyRef,scenario.state,JSON.stringify(['space-a']),
          JSON.stringify(['assistant_action']),'2024-01-01T00:00:00.000Z',scenario.expires,'2024-01-01T00:00:00.000Z','2024-01-01T00:00:00.000Z');
      await assert.rejects(()=>createJourneyActionWorkerRuntime({createWorkerDatabase:(()=>db as any) as any,
        now:()=>new Date('2026-08-08T12:00:00.000Z')}),scenario.pattern);
    }
    const missingDb=new Database(':memory:');missingDb.exec("CREATE TABLE spaces(id TEXT PRIMARY KEY);CREATE TABLE journey_action_queue(id TEXT,space_id TEXT,UNIQUE(id,space_id));INSERT INTO spaces VALUES ('space-a');");
    initializeJourneyWorkerSafetySqlite(missingDb);(config as any).journeyActionWorkerSecretFile=path.join(temporary,'missing');
    await assert.rejects(()=>createJourneyActionWorkerRuntime({createWorkerDatabase:(()=>missingDb as any) as any,
      now:()=>new Date('2026-08-08T12:00:00.000Z')}),/external key resolver/i);
    const cleanDb=new Database(':memory:');cleanDb.exec("CREATE TABLE spaces(id TEXT PRIMARY KEY);CREATE TABLE journey_action_queue(id TEXT,space_id TEXT,UNIQUE(id,space_id));INSERT INTO spaces VALUES ('space-a');");
    initializeJourneyWorkerSafetySqlite(cleanDb);(config as any).journeyActionWorkerSecretFile=path.join(temporary,'secret');
    const runtime=await createJourneyActionWorkerRuntime({createWorkerDatabase:(()=>cleanDb as any) as any,
      now:()=>new Date('2026-08-08T12:00:00.000Z')});assert.ok(runtime);runtime!.start();assert.equal(await runtime!.stop(100),true);
  }finally{Object.assign(config,{databaseProvider:before.provider,journeyActionWorkerEnabled:before.enabled,
    journeyActionWorkerSpaceIds:before.spaces,journeyActionWorkerAdapters:before.adapters,journeyActionWorkerKeyRef:before.keyRef,
    journeyActionWorkerSecretFile:before.secretFile});fs.rmSync(temporary,{recursive:true,force:true});}});

test('server owns worker start, drain, stop and exposes no human-session claim route',()=>{const server=fs.readFileSync(new URL('../src/server.ts',import.meta.url),'utf8');
  const app=fs.readFileSync(new URL('../src/app.ts',import.meta.url),'utf8');
  assert.match(server,/await createJourneyActionWorkerRuntime\(\)/);assert.match(server,/journeyActionWorkerRuntime\?\.start\(\)/);
  assert.match(server,/journeyActionWorkerRuntime\.stop\(8_000\)/);assert.doesNotMatch(app,/journeyActionWorker|worker\/claim|worker\/complete/);
});
