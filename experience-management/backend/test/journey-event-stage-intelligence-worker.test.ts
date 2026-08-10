import assert from 'node:assert/strict';
import test from 'node:test';
import { config } from '../src/config.js';
import { createJourneyEventStageIntelligenceWorker,JourneyEventStageIntelligenceWorker } from '../src/journeyEventStageIntelligenceWorker.js';

test('runtime45 worker is a safe no-processing state unless explicitly enabled',()=>{
  assert.equal(config.journeyEventIntelligenceWorkerEnabled,false);
  assert.equal(createJourneyEventStageIntelligenceWorker(),null);
});

test('bounded pass retires expired materialization, blocks expired pending work, and materializes ready work',()=>{
  const calls:string[]=[];const events:Record<string,unknown>[]=[];
  const repository={tombstone(input:any){calls.push(`tombstone:${input.outboxId}`);return {tombstoneId:'t',replayed:false};},
    materialize(id:string){calls.push(`materialize:${id}`);return {factId:'f',replayed:false};}} as any;
  const database={provider:'sqlite',prepare(sql:string){return {all(){return sql.includes("state IN ('ready','materialized')")
      ?[{id:'expired-ready',state:'ready'},{id:'expired-fact',state:'materialized'}]:[{id:'ready-a'}];},
    run(){calls.push('blocked:expired-ready');return {changes:1,lastInsertRowid:0};},get(){return undefined;}};},exec(){return this;},
    pragma(){return undefined;},transaction(callback:any){return callback;},health(){return {provider:'sqlite',ready:true};},close(){}} as any;
  const worker=new JourneyEventStageIntelligenceWorker(repository,60_000,3,(_level,event)=>events.push(event),database);
  worker.start();worker.stop();
  assert.deepEqual(calls,['blocked:expired-ready','tombstone:expired-fact','materialize:ready-a']);
  assert.deepEqual(events.at(-1),{event:'journey_event_intelligence_pass',at:(events.at(-1) as any).at,materialized:1,retired:1,blocked:1,failed:0});
});

test('worker telemetry fingerprints failures without exposing record identifiers',()=>{
  const events:Record<string,unknown>[]=[];const repository={materialize(){throw new Error('private-row-id');},tombstone(){throw new Error('private-expired-id');}} as any;
  const database={provider:'sqlite',prepare(sql:string){return {all(){return sql.includes("state IN ('ready','materialized')")
    ?[{id:'secret-expired',state:'materialized'}]:[{id:'secret-ready'}];},run(){return {changes:0,lastInsertRowid:0};},get(){}};},exec(){return this;},
    pragma(){},transaction(callback:any){return callback;},health(){return {provider:'sqlite',ready:true};},close(){}} as any;
  const worker=new JourneyEventStageIntelligenceWorker(repository,60_000,2,(_level,event)=>events.push(event),database);
  worker.start();worker.stop();const serialized=JSON.stringify(events);
  assert.doesNotMatch(serialized,/secret-expired|secret-ready|private-row-id|private-expired-id/);
  assert.match(serialized,/errorFingerprint/);
});
