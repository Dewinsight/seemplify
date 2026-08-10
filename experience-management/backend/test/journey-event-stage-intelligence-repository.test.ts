import assert from 'node:assert/strict';import test from 'node:test';import Database from 'better-sqlite3';
import {initializeJourneyEventStageIntelligenceSqlite,JourneyEventStageIntelligenceRepository} from '../src/journeyEventStageIntelligenceRepository.js';
const at='2026-08-08T12:00:01.000Z';
function insertOutbox(db:Database.Database,input:{id?:string;visit?:string;occurredAt?:string;mode?:string;value?:number|null}={}){
  const id=input.id||'outbox-a',visit=input.visit||'visit-a',occurredAt=input.occurredAt||'2026-08-08T12:00:00.000Z',mode=input.mode||'count',value=input.value===undefined?1:input.value;
  const values=[id,'space-a','mapping-v1',visit,'decision-a','2026-08-08T12:00:00.000Z',
    'raw-a','e'.repeat(64),'source-a','schema-v1','journey-a','map-v1','rule-v1','rule-definition-v1','d'.repeat(64),'stage-a','metric-a','metric-v1','a'.repeat(64),'count','projection-v1',
    'b'.repeat(64),mode,value,JSON.stringify({channel:'web'}),occurredAt,'granted','analytics',
    '2026-10-01T00:00:00.000Z','2026-09-15T00:00:00.000Z',30,'2026-09-01T00:00:00.000Z',
    'ready',null,at,null];
  db.prepare(`INSERT INTO journey_event_intelligence_outbox VALUES (${values.map(()=>'?').join(',')})`).run(...values);
}
function setup(){const db=new Database(':memory:');db.exec(`CREATE TABLE journey_stage_intelligence_facts(id TEXT PRIMARY KEY,space_id TEXT,journey_definition_id TEXT,
  source_type TEXT,source_id_hmac TEXT,external_record_hmac TEXT,source_version TEXT,schema_version TEXT,projection_version TEXT,revision INTEGER,
  operation TEXT,supersedes_fact_id TEXT,subject_id_hmac TEXT,stage_id TEXT,metric_definition_id TEXT,metric_definition_version_id TEXT,
  metric_definition_version_sha256 TEXT,metric_unit TEXT,value REAL,dimensions_json TEXT,sentiment TEXT,emotions_json TEXT,occurred_at TEXT,
  consent_state TEXT,purposes_json TEXT,retention_expires_at TEXT,idempotency_key_hmac TEXT,intent_sha256 TEXT,created_at TEXT);`);
  initializeJourneyEventStageIntelligenceSqlite(db);insertOutbox(db);
  return {db,repo:new JourneyEventStageIntelligenceRepository(db,'k'.repeat(64))};}
test('materializes governed outbox exactly once with HMAC lineage and no raw payload',()=>{const {db,repo}=setup();const first=repo.materialize('outbox-a',at);
  assert.equal(first.replayed,false);assert.equal(repo.materialize('outbox-a',at).replayed,true);const fact=db.prepare('SELECT * FROM journey_stage_intelligence_facts').get() as any;
  assert.equal(fact.source_type,'journey_event');assert.match(fact.source_id_hmac,/^[a-f0-9]{64}$/);assert.match(fact.external_record_hmac,/^[a-f0-9]{64}$/);
  assert.match(fact.subject_id_hmac,/^[a-f0-9]{64}$/);assert.notEqual(fact.subject_id_hmac,'b'.repeat(64));assert.equal(fact.source_version,'mapping:mapping-v1');
  assert.equal(fact.value,1);assert.doesNotMatch(JSON.stringify(fact),/visit-a|raw payload|email|message/i);});
test('reprojection tombstone appends a delete fact and is idempotent',()=>{const {db,repo}=setup();repo.materialize('outbox-a',at);
  const first=repo.tombstone({outboxId:'outbox-a',reason:'reprojection',correctionRef:'run-private',at:'2026-08-08T13:00:00.000Z'});
  assert.equal(first.replayed,false);assert.equal(repo.tombstone({outboxId:'outbox-a',reason:'reprojection',correctionRef:'run-private',at:'2026-08-08T13:00:00.000Z'}).replayed,true);
  assert.deepEqual(db.prepare('SELECT operation,revision,value FROM journey_stage_intelligence_facts ORDER BY revision').all(),
    [{operation:'upsert',revision:1,value:1},{operation:'delete',revision:2,value:null}]);
  assert.doesNotMatch(JSON.stringify(db.prepare('SELECT * FROM journey_event_intelligence_tombstones').get()),/run-private/);});
test('stateful elapsed materialization uses prior governed event without regressing late state',()=>{const {db,repo}=setup();
  db.prepare("DELETE FROM journey_event_intelligence_outbox WHERE id='outbox-a'").run();
  insertOutbox(db,{id:'elapsed-a',visit:'visit-elapsed-a',mode:'elapsed_since_prior',value:null,occurredAt:'2026-08-08T12:00:00.000Z'});
  insertOutbox(db,{id:'elapsed-b',visit:'visit-elapsed-b',mode:'elapsed_since_prior',value:null,occurredAt:'2026-08-08T12:00:30.000Z'});
  insertOutbox(db,{id:'elapsed-late',visit:'visit-elapsed-late',mode:'elapsed_since_prior',value:null,occurredAt:'2026-08-08T11:59:00.000Z'});
  repo.materialize('elapsed-a',at);repo.materialize('elapsed-b',at);repo.materialize('elapsed-late',at);
  assert.deepEqual((db.prepare("SELECT value FROM journey_stage_intelligence_facts ORDER BY occurred_at").all() as any[]).map(row=>row.value),[null,null,30]);
  assert.equal((db.prepare('SELECT last_occurred_at FROM journey_event_intelligence_materialization_state').get() as any).last_occurred_at,'2026-08-08T12:00:30.000Z');});
test('privacy handle and blocked outbox fail closed without facts',()=>{const {db,repo}=setup();db.prepare(
  'INSERT INTO journey_event_intelligence_erasure_handles VALUES (?,?,?,?)').run('space-a','b'.repeat(64),'c'.repeat(64),at);
  assert.throws(()=>repo.materialize('outbox-a',at),/erased/);assert.equal((db.prepare('SELECT COUNT(*) count FROM journey_stage_intelligence_facts').get() as any).count,0);
  db.prepare("UPDATE journey_event_intelligence_outbox SET state='blocked',block_reason='consent_denied' WHERE id='outbox-a'").run();
  assert.throws(()=>repo.materialize('outbox-a',at),/not materializable/);});
test('privacy erasure atomically records a content-safe handle and tombstones existing materialization',()=>{const {db,repo}=setup();repo.materialize('outbox-a',at);
  assert.deepEqual(repo.eraseSubject({spaceId:'space-a',subjectIdHmac:'b'.repeat(64),commandId:'private-command',at:'2026-08-08T13:00:00.000Z'}),{tombstoned:1});
  const handle=db.prepare('SELECT * FROM journey_event_intelligence_erasure_handles').get() as any;
  assert.match(handle.command_id_sha256,/^[a-f0-9]{64}$/);assert.doesNotMatch(JSON.stringify(handle),/private-command/);
  assert.equal((db.prepare("SELECT COUNT(*) count FROM journey_stage_intelligence_facts WHERE operation='delete'").get() as any).count,1);});
test('SQLite parity declares every runtime45 durable table and immutable history guards',()=>{const {db}=setup();const names=(db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'journey_event_intelligence_%' ORDER BY name").all() as any[]).map(row=>row.name);
  assert.deepEqual(names,['journey_event_intelligence_erasure_handles','journey_event_intelligence_mapping_versions','journey_event_intelligence_mappings',
    'journey_event_intelligence_materialization_state','journey_event_intelligence_outbox','journey_event_intelligence_tombstones']);
  db.prepare('INSERT INTO journey_event_intelligence_tombstones VALUES (?,?,?,?,?,?)').run('tombstone-a','space-a','outbox-a','correction','c'.repeat(64),at);
  assert.throws(()=>db.prepare("UPDATE journey_event_intelligence_tombstones SET reason='reprojection'").run(),/append-only/);});
test('manager mappings derive published tenant lineage and enforce optimistic revisions',()=>{const {db,repo}=setup();db.exec(`
  CREATE TABLE journey_event_schema_versions(id TEXT,source_id TEXT,space_id TEXT,state TEXT,content_sha256 TEXT);
  CREATE TABLE journey_stage_rule_versions(id TEXT,space_id TEXT,journey_definition_id TEXT,journey_map_version_id TEXT,stage_key TEXT,state TEXT,rule_definition_id TEXT,content_sha256 TEXT);
  CREATE TABLE journey_metric_definition_versions(id TEXT,definition_id TEXT,space_id TEXT,source_kind TEXT,content_sha256 TEXT);`);
  db.prepare('INSERT INTO journey_event_schema_versions VALUES (?,?,?,?,?)').run('schema-v1','source-a','space-a','published','1'.repeat(64));
  db.prepare('INSERT INTO journey_stage_rule_versions VALUES (?,?,?,?,?,?,?,?)').run('rule-v1','space-a','journey-a','map-v1','stage-a','published','rule-definition-v1','2'.repeat(64));
  db.prepare('INSERT INTO journey_metric_definition_versions VALUES (?,?,?,?,?)').run('metric-v1','metric-a','space-a','journey_event','3'.repeat(64));
  const version={sourceId:'source-a',environment:'production' as const,eventName:'checkout_completed',schemaVersionId:'schema-v1',journeyDefinitionId:'journey-a',
    journeyMapVersionId:'map-v1',stageKey:'stage-a',stageRuleVersionId:'rule-v1',metricDefinitionId:'metric-a',metricDefinitionVersionId:'metric-v1',
    metricUnit:'count' as const,valueMode:'count' as const,constantValue:null,numericPropertyPath:null,dimensionKeys:['channel' as const],
    consentRequirement:'granted_or_not_required' as const,purpose:'analytics' as const,retentionDays:30};
  const created=repo.createMapping({spaceId:'space-a',at,version}) as any;assert.equal(created.mapping.state,'active');assert.equal(created.versions[0].metric_definition_version_sha256,'3'.repeat(64));
  assert.deepEqual(repo.listMappings('space-b'),[]);assert.equal(repo.readMapping('space-b',created.mapping.id),null);
  assert.throws(()=>repo.appendVersion({spaceId:'space-a',mappingId:created.mapping.id,expectedRevision:2,at,version}),/changed/);
  const updated=repo.appendVersion({spaceId:'space-a',mappingId:created.mapping.id,expectedRevision:1,at:'2026-08-08T13:00:00.000Z',version}) as any;
  assert.equal(updated.mapping.revision,2);assert.equal(updated.versions.length,2);
});
