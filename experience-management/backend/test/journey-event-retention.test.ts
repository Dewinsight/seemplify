import test from 'node:test';import assert from 'node:assert/strict';
import {createDatabase} from '../src/databaseAdapter.js';import {deriveJourneyEventReconciliation,planJourneyRawRetention} from '../src/journeyEventRetention.js';
import {JourneyEventRetentionRepository} from '../src/journeyEventRetentionRepository.js';
import {JourneyEventRetentionWorker} from '../src/journeyEventRetentionWorker.js';
const at='2026-08-08T10:00:00.000Z';
const candidate=(id:string,overrides:Record<string,unknown>={})=>({spaceId:'space-a',sourceId:'source-a',environment:'production',rawEventId:id,
  receivedAt:`2026-07-01T00:00:0${id}.000Z`,retentionExpiresAt:'2026-08-01T00:00:00.000Z',inboxState:'completed',latestDependentExpiry:null,
  stageDecisionCount:0,stageVisitCount:0,...overrides});
test('retention planning is bounded, deterministic and does not let a blocked oldest row starve later work',()=>{const result=planJourneyRawRetention({asOf:at,limit:3,
  rows:[candidate('3'),candidate('1',{inboxState:'leased'}),candidate('2',{stageVisitCount:1}),candidate('4')]});
  assert.deepEqual(result.planned.map(row=>[row.candidate.rawEventId,row.disposition]),[['1','active_processing'],['2','stage_reconciliation_required'],['3','purgeable']]);
  assert.equal(result.nextCursor?.rawEventId,'3');});
test('future dependent retention and stage lineage fail closed instead of authorising destructive purge',()=>{const result=planJourneyRawRetention({asOf:at,limit:10,
  rows:[candidate('1',{latestDependentExpiry:'2026-09-01T00:00:00.000Z'}),candidate('2',{stageDecisionCount:1})]});
  assert.deepEqual(result.planned.map(row=>row.disposition),['dependent_retention','stage_reconciliation_required']);});
test('reconciliation only emits bounded counts, hashes and deterministic drift codes',()=>{const report=deriveJourneyEventReconciliation({windowSha256:'a'.repeat(64),
  observation:{raw:2,terminalInbox:3,successfulReceipts:2,decisions:0,visits:1,expiredRaw:1}});assert.deepEqual(report.driftCodes,
    ['terminal_inbox_without_raw','visit_without_decision','retention_backlog']);assert.equal(JSON.stringify(report).includes('subject'),false);});
test('SQLite repository fences claims, checkpoints pages and preserves append-only content-safe audit',()=>{const path=':memory:';
  const db=createDatabase({databaseProvider:'sqlite',databasePath:path,postgres:{} as any} as any);const repository=new JourneyEventRetentionRepository(db);
  repository.request({id:'run-a',kind:'reconciliation',asOf:at,batchSize:25,at});const claim=repository.claim({owner:'worker-a',at,
    leaseExpiresAt:'2026-08-08T10:05:00.000Z'});assert.ok(claim);assert.equal(repository.reconcilePage({runId:'run-a',owner:'worker-b',token:claim.leaseToken,
      at,rows:[],cursor:null,hasMore:false}),null);const report=repository.reconcilePage({runId:'run-a',owner:'worker-a',token:claim.leaseToken,at,
      rows:[{inboxState:'completed',successfulReceipt:true,stageDecisionCount:0,stageVisitCount:0,retentionExpiresAt:'2026-08-01T00:00:00.000Z'}],
      cursor:null,hasMore:false});assert.equal(report?.counts.raw,1);assert.equal((db.prepare("SELECT state FROM journey_event_retention_runs WHERE id='run-a'").get() as any).state,'completed');
    const event=db.prepare('SELECT detail_json FROM journey_event_retention_events').get() as any;assert.equal(event.detail_json.includes('worker-a'),false);
    assert.throws(()=>db.prepare('DELETE FROM journey_event_retention_events').run(),/append-only/u);db.close();});
test('worker isolates candidate failures, advances the page and emits no source or subject identity',()=>{const events:Record<string,unknown>[]=[];
  const checkpoints:any[]=[];const worker=new JourneyEventRetentionWorker({scan:()=>({rows:[candidate('1'),candidate('2'),candidate('3',{inboxState:'leased'}),candidate('4')]}),
    purge:({candidate})=>{if(candidate.rawEventId==='1')throw new Error('private payload for subject 42');return {purgedCount:1,outcomeCode:'purged'};},
    checkpoint:value=>checkpoints.push(value)},(_level,event)=>events.push(event));const result=worker.runPage({asOf:at,limit:3,cursor:null});
  assert.deepEqual({scanned:result.scanned,purged:result.purged,blocked:result.blocked,failed:result.failed},{scanned:3,purged:1,blocked:1,failed:1});
  assert.equal(result.nextCursor?.rawEventId,'3');assert.equal(JSON.stringify(events).includes('private payload'),false);assert.equal(checkpoints.length,1);});
test('PostgreSQL scan aliases preserve the typed worker projection',async()=>{const fs=await import('node:fs');const source=fs.readFileSync(
  new URL('../src/journeyEventRetentionRepository.ts',import.meta.url),'utf8');for(const alias of ['spaceId','sourceId','rawEventId','receivedAt',
    'retentionExpiresAt','inboxState','latestDependentExpiry','stageDecisionCount','stageVisitCount'])assert.match(source,new RegExp(`"${alias}"`,'u'));});
