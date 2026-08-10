import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type { DatabaseRuntime } from './databaseAdapter.js';
import { materializeStatefulValue,planJourneyEventIntelligenceTombstone } from './journeyEventStageIntelligenceDomain.js';

type Db=Database.Database|DatabaseRuntime;
const json=(value:unknown)=>JSON.stringify(value);const sha=(value:string)=>crypto.createHash('sha256').update(value).digest('hex');
const hmac=(key:string,value:string)=>crypto.createHmac('sha256',key).update(value).digest('hex');
const stable=(value:unknown):string=>Array.isArray(value)?`[${value.map(stable).join(',')}]`:value&&typeof value==='object'
  ?`{${Object.keys(value as Record<string,unknown>).sort().map(key=>`${JSON.stringify(key)}:${stable((value as any)[key])}`).join(',')}}`:JSON.stringify(value);
export type JourneyEventMappingVersionInput={sourceId:string;environment:'development'|'staging'|'production';eventName:string;
  schemaVersionId:string;journeyDefinitionId:string;journeyMapVersionId:string;stageKey:string;stageRuleVersionId:string;
  metricDefinitionId:string;metricDefinitionVersionId:string;metricUnit:'score'|'percent'|'count'|'seconds'|'minutes'|'hours'|'rate'|'index'|'currency'|'unknown';
  valueMode:'count'|'constant'|'numeric_property'|'elapsed_since_prior';constantValue:number|null;numericPropertyPath:string|null;
  dimensionKeys:('channel'|'environment')[];consentRequirement:'granted'|'granted_or_not_required';purpose:'service_improvement'|'analytics'|'research';retentionDays:number};

export function initializeJourneyEventStageIntelligenceSqlite(db:Database.Database){db.exec(`
  CREATE TABLE IF NOT EXISTS journey_event_intelligence_mappings(id TEXT PRIMARY KEY,space_id TEXT NOT NULL,source_id TEXT NOT NULL,
    environment TEXT NOT NULL,event_name TEXT NOT NULL,state TEXT NOT NULL,current_version_id TEXT,revision INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS journey_event_intelligence_mapping_versions(id TEXT PRIMARY KEY,mapping_id TEXT NOT NULL,space_id TEXT NOT NULL,
    version_number INTEGER NOT NULL,source_id TEXT NOT NULL,schema_version_id TEXT NOT NULL,journey_definition_id TEXT NOT NULL,
    journey_map_version_id TEXT NOT NULL,stage_key TEXT NOT NULL,stage_rule_version_id TEXT NOT NULL,stage_rule_definition_id TEXT NOT NULL,
    metric_definition_id TEXT NOT NULL,metric_definition_version_id TEXT NOT NULL,metric_definition_version_sha256 TEXT NOT NULL,
    metric_unit TEXT NOT NULL,value_mode TEXT NOT NULL,constant_value REAL,numeric_property_path TEXT,dimension_keys_json TEXT NOT NULL,
    consent_requirement TEXT NOT NULL,purpose TEXT NOT NULL,retention_days INTEGER NOT NULL,projection_version TEXT NOT NULL,content_sha256 TEXT NOT NULL,created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS journey_event_intelligence_erasure_handles(space_id TEXT NOT NULL,subject_id_hmac TEXT NOT NULL,command_id_sha256 TEXT NOT NULL,
    erased_at TEXT NOT NULL,PRIMARY KEY(space_id,subject_id_hmac));
  CREATE TABLE IF NOT EXISTS journey_event_intelligence_outbox(id TEXT PRIMARY KEY,space_id TEXT NOT NULL,mapping_version_id TEXT NOT NULL,
    source_visit_id TEXT NOT NULL,source_decision_id TEXT NOT NULL,raw_received_at TEXT NOT NULL,raw_event_id TEXT NOT NULL,
    source_envelope_sha256 TEXT NOT NULL,source_id TEXT NOT NULL,schema_version_id TEXT NOT NULL,journey_definition_id TEXT NOT NULL,
    journey_map_version_id TEXT NOT NULL,stage_rule_version_id TEXT NOT NULL,stage_rule_definition_id TEXT NOT NULL,mapping_content_sha256 TEXT NOT NULL,
    stage_key TEXT NOT NULL,metric_definition_id TEXT NOT NULL,metric_definition_version_id TEXT NOT NULL,metric_definition_version_sha256 TEXT NOT NULL,
    metric_unit TEXT NOT NULL,projection_version TEXT NOT NULL,subject_id_hmac TEXT NOT NULL,value_mode TEXT NOT NULL,value REAL,
    dimensions_json TEXT NOT NULL,occurred_at TEXT NOT NULL,consent_state TEXT NOT NULL,purpose TEXT NOT NULL,raw_retention_expires_at TEXT NOT NULL,
    visit_retention_expires_at TEXT NOT NULL,mapping_retention_days INTEGER NOT NULL,retention_expires_at TEXT NOT NULL,
    state TEXT NOT NULL,block_reason TEXT,created_at TEXT NOT NULL,materialized_fact_id TEXT,UNIQUE(mapping_version_id,source_visit_id));
  CREATE TABLE IF NOT EXISTS journey_event_intelligence_materialization_state(mapping_version_id TEXT NOT NULL,space_id TEXT NOT NULL,
    subject_id_hmac TEXT NOT NULL,stage_key TEXT NOT NULL,last_occurred_at TEXT NOT NULL,last_outbox_id TEXT NOT NULL,revision INTEGER NOT NULL,
    updated_at TEXT NOT NULL,PRIMARY KEY(mapping_version_id,space_id,subject_id_hmac,stage_key));
  CREATE TABLE IF NOT EXISTS journey_event_intelligence_tombstones(id TEXT PRIMARY KEY,space_id TEXT NOT NULL,source_outbox_id TEXT NOT NULL,
    reason TEXT NOT NULL,correction_ref_sha256 TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(source_outbox_id,reason,correction_ref_sha256));
  CREATE TRIGGER IF NOT EXISTS journey_event_intelligence_mapping_versions_immutable BEFORE UPDATE ON journey_event_intelligence_mapping_versions
    BEGIN SELECT RAISE(ABORT,'append-only');END;
  CREATE TRIGGER IF NOT EXISTS journey_event_intelligence_tombstones_immutable BEFORE UPDATE ON journey_event_intelligence_tombstones
    BEGIN SELECT RAISE(ABORT,'append-only');END;
  CREATE TRIGGER IF NOT EXISTS journey_event_intelligence_erasure_handles_immutable BEFORE UPDATE ON journey_event_intelligence_erasure_handles
    BEGIN SELECT RAISE(ABORT,'append-only');END;`)}

export class JourneyEventStageIntelligenceRepository{
  constructor(private readonly db:Db,private readonly lineageKey?:string){if(lineageKey!==undefined&&lineageKey.length<32)throw new Error('Adapter lineage key is unavailable.');
    if('provider' in db&&db.provider==='sqlite')initializeJourneyEventStageIntelligenceSqlite(db as unknown as Database.Database);}
  materialize(outboxId:string,at:string):{factId:string;replayed:boolean}{return this.tx(()=>{const row=this.db.prepare(
      'SELECT * FROM journey_event_intelligence_outbox WHERE id=?').get(outboxId) as any;if(!row)throw new Error('Outbox record not found.');
    if(row.state==='materialized')return {factId:String(row.materialized_fact_id),replayed:true};if(row.state!=='ready')throw new Error('Outbox record is not materializable.');
    if(Date.parse(row.retention_expires_at)<=Date.parse(at))throw new Error('Outbox retention expired.');
    if(this.db.prepare('SELECT 1 FROM journey_event_intelligence_erasure_handles WHERE space_id=? AND subject_id_hmac=?').get(row.space_id,row.subject_id_hmac))
      throw new Error('Subject privacy handle is erased.');
    const prior=this.db.prepare(`SELECT last_occurred_at FROM journey_event_intelligence_materialization_state
      WHERE mapping_version_id=? AND space_id=? AND subject_id_hmac=? AND stage_key=?`).get(row.mapping_version_id,row.space_id,row.subject_id_hmac,row.stage_key) as any;
    const stateful=materializeStatefulValue({mode:row.value_mode,occurredAt:new Date(row.occurred_at).toISOString(),priorOccurredAt:prior?.last_occurred_at||null});
    const value=row.value_mode==='elapsed_since_prior'?stateful:(row.value===null?null:Number(row.value));
    const lineageKey=this.requireLineageKey(),sourceIdHmac=hmac(lineageKey,`source:${row.source_id}`),externalHmac=hmac(lineageKey,`visit:${row.source_visit_id}`),
      subjectHmac=hmac(lineageKey,`subject:${row.subject_id_hmac}`);
    const latest=this.db.prepare(`SELECT id,revision FROM journey_stage_intelligence_facts WHERE space_id=? AND metric_definition_id=?
      AND source_id_hmac=? AND external_record_hmac=? ORDER BY revision DESC LIMIT 1`).get(row.space_id,row.metric_definition_id,sourceIdHmac,externalHmac) as any;
    const revision=Number(latest?.revision||0)+1,factId=crypto.randomUUID();const intent={mappingVersionId:row.mapping_version_id,
      sourceVisitIdHmac:externalHmac,stageRuleVersionId:row.stage_rule_version_id,projectionVersion:row.projection_version,revision,value};
    this.db.prepare(`INSERT INTO journey_stage_intelligence_facts(id,space_id,journey_definition_id,source_type,source_id_hmac,
      external_record_hmac,source_version,schema_version,projection_version,revision,operation,supersedes_fact_id,subject_id_hmac,
      stage_id,metric_definition_id,metric_definition_version_id,metric_definition_version_sha256,metric_unit,value,dimensions_json,
      sentiment,emotions_json,occurred_at,consent_state,purposes_json,retention_expires_at,idempotency_key_hmac,intent_sha256,created_at)
      VALUES (?,?,?,'journey_event',?,?,?,?,?,?,'upsert',?,?,?,?,?,?,?,?,?,NULL,'[]',?,?,?,?,?,?,?)`).run(factId,row.space_id,
      row.journey_definition_id,sourceIdHmac,externalHmac,`mapping:${row.mapping_version_id}`,row.schema_version_id,row.projection_version,revision,
      latest?.id||null,subjectHmac,row.stage_key,row.metric_definition_id,row.metric_definition_version_id,
      row.metric_definition_version_sha256,row.metric_unit,value,typeof row.dimensions_json==='string'?row.dimensions_json:json(row.dimensions_json),
      new Date(row.occurred_at).toISOString(),row.consent_state==='not_required'?'not_required':'granted',json([row.purpose]),
      new Date(row.retention_expires_at).toISOString(),hmac(lineageKey,`outbox:${row.id}:upsert:${revision}`),sha(json(intent)),at);
    const changed=this.db.prepare("UPDATE journey_event_intelligence_outbox SET state='materialized',materialized_fact_id=? WHERE id=? AND state='ready'")
      .run(factId,row.id).changes;if(changed!==1)throw new Error('Outbox materialization raced.');
    this.db.prepare(`INSERT INTO journey_event_intelligence_materialization_state(mapping_version_id,space_id,subject_id_hmac,stage_key,
      last_occurred_at,last_outbox_id,revision,updated_at) VALUES (?,?,?,?,?,?,1,?) ON CONFLICT(mapping_version_id,space_id,subject_id_hmac,stage_key)
      DO UPDATE SET last_occurred_at=CASE WHEN excluded.last_occurred_at>=journey_event_intelligence_materialization_state.last_occurred_at
        THEN excluded.last_occurred_at ELSE journey_event_intelligence_materialization_state.last_occurred_at END,
      last_outbox_id=CASE WHEN excluded.last_occurred_at>=journey_event_intelligence_materialization_state.last_occurred_at
        THEN excluded.last_outbox_id ELSE journey_event_intelligence_materialization_state.last_outbox_id END,
      revision=journey_event_intelligence_materialization_state.revision+1,updated_at=excluded.updated_at`)
      .run(row.mapping_version_id,row.space_id,row.subject_id_hmac,row.stage_key,new Date(row.occurred_at).toISOString(),row.id,at);
    return {factId,replayed:false};});}

  tombstone(input:{outboxId:string;reason:'correction'|'reprojection'|'privacy_erasure'|'retention_expiry';correctionRef:string;at:string}){
    return this.tx(()=>{const row=this.db.prepare('SELECT * FROM journey_event_intelligence_outbox WHERE id=?').get(input.outboxId) as any;
      if(!row)throw new Error('Outbox record not found.');
      const plan=planJourneyEventIntelligenceTombstone({outboxId:row.id,reason:input.reason,correctionRef:input.correctionRef,at:input.at});
      const existing=this.db.prepare('SELECT id FROM journey_event_intelligence_tombstones WHERE source_outbox_id=? AND reason=? AND correction_ref_sha256=?')
        .get(row.id,input.reason,plan.correctionRefSha256) as any;if(existing)return {tombstoneId:existing.id,replayed:true};
      if(input.reason==='retention_expiry'&&Date.parse(row.retention_expires_at)<=Date.parse(input.at)){
        const tombstoneId=crypto.randomUUID();this.db.prepare('INSERT INTO journey_event_intelligence_tombstones VALUES (?,?,?,?,?,?)')
          .run(tombstoneId,row.space_id,row.id,input.reason,plan.correctionRefSha256,input.at);
        const changed=this.db.prepare("UPDATE journey_event_intelligence_outbox SET state='tombstoned' WHERE id=? AND state='materialized'")
          .run(row.id).changes;if(changed!==1)throw new Error('Outbox retention settlement raced.');
        return {tombstoneId,replayed:false};
      }
      if(row.state!=='materialized')throw new Error('Only materialized outbox records can be tombstoned.');const prior=this.db.prepare(
        'SELECT * FROM journey_stage_intelligence_facts WHERE id=?').get(row.materialized_fact_id) as any;if(!prior)throw new Error('Materialized fact is unavailable.');
      const lineageKey=this.requireLineageKey(),revision=Number(prior.revision)+1,factId=crypto.randomUUID(),tombstoneId=crypto.randomUUID();
      this.db.prepare(`INSERT INTO journey_stage_intelligence_facts(id,space_id,journey_definition_id,source_type,source_id_hmac,
        external_record_hmac,source_version,schema_version,projection_version,revision,operation,supersedes_fact_id,subject_id_hmac,
        stage_id,metric_definition_id,metric_definition_version_id,metric_definition_version_sha256,metric_unit,value,dimensions_json,
        sentiment,emotions_json,occurred_at,consent_state,purposes_json,retention_expires_at,idempotency_key_hmac,intent_sha256,created_at)
        VALUES (?,?,?,'journey_event',?,?,?,?,?,?,'delete',?,?,?,?,?,?,?,NULL,?,NULL,'[]',?,?,?,?,?,?,?)`).run(factId,prior.space_id,
        prior.journey_definition_id,prior.source_id_hmac,prior.external_record_hmac,prior.source_version,prior.schema_version,prior.projection_version,
        revision,prior.id,prior.subject_id_hmac,prior.stage_id,prior.metric_definition_id,prior.metric_definition_version_id,
        prior.metric_definition_version_sha256,prior.metric_unit,typeof prior.dimensions_json==='string'?prior.dimensions_json:json(prior.dimensions_json),
        prior.occurred_at,prior.consent_state,typeof prior.purposes_json==='string'?prior.purposes_json:json(prior.purposes_json),prior.retention_expires_at,
        hmac(lineageKey,`outbox:${row.id}:delete:${revision}:${input.reason}`),sha(json(plan)),input.at);
      this.db.prepare('INSERT INTO journey_event_intelligence_tombstones VALUES (?,?,?,?,?,?)').run(tombstoneId,row.space_id,row.id,input.reason,
        plan.correctionRefSha256,input.at);this.db.prepare("UPDATE journey_event_intelligence_outbox SET state='tombstoned' WHERE id=? AND state='materialized'").run(row.id);
      return {tombstoneId,replayed:false};});}
  eraseSubject(input:{spaceId:string;subjectIdHmac:string;commandId:string;at:string}){
    return this.tx(()=>{if(!/^[a-f0-9]{64}$/.test(input.subjectIdHmac)||!input.commandId)throw new Error('Erasure handle is invalid.');
      const commandIdSha256=sha(input.commandId);this.db.prepare(`INSERT INTO journey_event_intelligence_erasure_handles
        (space_id,subject_id_hmac,command_id_sha256,erased_at) VALUES (?,?,?,?) ON CONFLICT(space_id,subject_id_hmac) DO NOTHING`)
        .run(input.spaceId,input.subjectIdHmac,commandIdSha256,input.at);
      const rows=this.db.prepare(`SELECT id FROM journey_event_intelligence_outbox WHERE space_id=? AND subject_id_hmac=?
        AND state='materialized' ORDER BY id`).all(input.spaceId,input.subjectIdHmac) as any[];
      for(const row of rows)this.tombstone({outboxId:String(row.id),reason:'privacy_erasure',correctionRef:input.commandId,at:input.at});
      return {tombstoned:rows.length};});}
  listMappings(spaceId:string){return this.db.prepare(`SELECT mapping.*,version.version_number,version.schema_version_id,
      version.journey_definition_id,version.journey_map_version_id,version.stage_key,version.stage_rule_version_id,
      version.stage_rule_definition_id,version.metric_definition_id,version.metric_definition_version_id,
      version.metric_definition_version_sha256,version.metric_unit,version.value_mode,version.constant_value,
      version.numeric_property_path,version.dimension_keys_json,version.consent_requirement,version.purpose,
      version.retention_days,version.projection_version,version.content_sha256
      FROM journey_event_intelligence_mappings mapping LEFT JOIN journey_event_intelligence_mapping_versions version
      ON version.id=mapping.current_version_id WHERE mapping.space_id=? ORDER BY mapping.updated_at DESC,mapping.id`).all(spaceId);}
  readMapping(spaceId:string,id:string){const mapping=this.db.prepare(`SELECT * FROM journey_event_intelligence_mappings
      WHERE id=? AND space_id=?`).get(id,spaceId) as any;if(!mapping)return null;const versions=this.db.prepare(`SELECT * FROM
      journey_event_intelligence_mapping_versions WHERE mapping_id=? AND space_id=? ORDER BY version_number DESC`).all(id,spaceId);
    return {mapping,versions};}
  createMapping(input:{spaceId:string;at:string;version:JourneyEventMappingVersionInput}){return this.tx(()=>{
    const lineage=this.serverLineage(input.spaceId,input.version);const contentSha256=sha(stable({...input.version,...lineage,projectionVersion:'journey-event-stage/v1'}));
    const existing=this.db.prepare(`SELECT mapping.id,mapping.current_version_id,version.content_sha256 FROM journey_event_intelligence_mappings mapping
      LEFT JOIN journey_event_intelligence_mapping_versions version ON version.id=mapping.current_version_id
      WHERE mapping.space_id=? AND mapping.source_id=? AND mapping.environment=? AND mapping.event_name=?`)
      .get(input.spaceId,input.version.sourceId,input.version.environment,input.version.eventName) as any;
    if(existing){if(existing.content_sha256===contentSha256)return this.readMapping(input.spaceId,existing.id);throw new Error('Event mapping already exists with different lineage.');}
    const id=crypto.randomUUID(),versionId=crypto.randomUUID();this.db.prepare(`INSERT INTO journey_event_intelligence_mappings
      (id,space_id,source_id,environment,event_name,state,current_version_id,revision,created_at,updated_at)
      VALUES (?,?,?,?,?,'draft',NULL,1,?,?)`).run(id,input.spaceId,input.version.sourceId,input.version.environment,input.version.eventName,input.at,input.at);
    this.insertVersion({mappingId:id,versionId,spaceId:input.spaceId,versionNumber:1,at:input.at,input:input.version,lineage,contentSha256});
    this.db.prepare("UPDATE journey_event_intelligence_mappings SET state='active',current_version_id=?,updated_at=? WHERE id=? AND space_id=?")
      .run(versionId,input.at,id,input.spaceId);return this.readMapping(input.spaceId,id);});}
  appendVersion(input:{spaceId:string;mappingId:string;expectedRevision:number;at:string;version:JourneyEventMappingVersionInput}){return this.tx(()=>{
    const mapping=this.db.prepare('SELECT * FROM journey_event_intelligence_mappings WHERE id=? AND space_id=?').get(input.mappingId,input.spaceId) as any;
    if(!mapping)throw new Error('Event mapping not found.');if(Number(mapping.revision)!==input.expectedRevision)throw new Error('Event mapping changed; reload and retry.');
    if(mapping.source_id!==input.version.sourceId||mapping.environment!==input.version.environment||mapping.event_name!==input.version.eventName)
      throw new Error('Mapping source identity is immutable.');const lineage=this.serverLineage(input.spaceId,input.version);
    const contentSha256=sha(stable({...input.version,...lineage,projectionVersion:'journey-event-stage/v1'}));const latest=this.db.prepare(
      'SELECT MAX(version_number) number FROM journey_event_intelligence_mapping_versions WHERE mapping_id=? AND space_id=?').get(mapping.id,input.spaceId) as any;
    const versionId=crypto.randomUUID();this.insertVersion({mappingId:mapping.id,versionId,spaceId:input.spaceId,versionNumber:Number(latest.number)+1,
      at:input.at,input:input.version,lineage,contentSha256});const changed=this.db.prepare(`UPDATE journey_event_intelligence_mappings SET
      state='active',current_version_id=?,revision=revision+1,updated_at=? WHERE id=? AND space_id=? AND revision=?`).run(versionId,input.at,mapping.id,input.spaceId,input.expectedRevision).changes;
    if(changed!==1)throw new Error('Event mapping changed; reload and retry.');return this.readMapping(input.spaceId,mapping.id);});}
  retireMapping(input:{spaceId:string;mappingId:string;expectedRevision:number;at:string}){const changed=this.db.prepare(`UPDATE journey_event_intelligence_mappings
      SET state='retired',revision=revision+1,updated_at=? WHERE id=? AND space_id=? AND revision=?`).run(input.at,input.mappingId,input.spaceId,input.expectedRevision).changes;
    if(changed!==1)throw new Error('Event mapping not found or changed; reload and retry.');return this.readMapping(input.spaceId,input.mappingId);}
  private serverLineage(spaceId:string,input:JourneyEventMappingVersionInput){const schema=this.db.prepare(`SELECT content_sha256 FROM journey_event_schema_versions
      WHERE id=? AND source_id=? AND space_id=? AND state='published'`).get(input.schemaVersionId,input.sourceId,spaceId) as any;
    const rule=this.db.prepare(`SELECT rule_definition_id,content_sha256 FROM journey_stage_rule_versions WHERE id=? AND space_id=?
      AND journey_definition_id=? AND journey_map_version_id=? AND stage_key=? AND state='published'`).get(input.stageRuleVersionId,spaceId,
      input.journeyDefinitionId,input.journeyMapVersionId,input.stageKey) as any;const metric=this.db.prepare(`SELECT content_sha256 FROM
      journey_metric_definition_versions WHERE id=? AND definition_id=? AND space_id=? AND source_kind='journey_event'`).get(
      input.metricDefinitionVersionId,input.metricDefinitionId,spaceId) as any;if(!schema||!rule||!metric)throw new Error('Published server-owned mapping lineage is unavailable.');
    return {schemaContentSha256:String(schema.content_sha256),stageRuleDefinitionId:String(rule.rule_definition_id),
      stageRuleContentSha256:String(rule.content_sha256),metricDefinitionVersionSha256:String(metric.content_sha256)};}
  private insertVersion(input:{mappingId:string;versionId:string;spaceId:string;versionNumber:number;at:string;input:JourneyEventMappingVersionInput;
    lineage:{stageRuleDefinitionId:string;metricDefinitionVersionSha256:string};contentSha256:string}){const row=input.input;this.db.prepare(`INSERT INTO
      journey_event_intelligence_mapping_versions(id,mapping_id,space_id,version_number,source_id,schema_version_id,journey_definition_id,
      journey_map_version_id,stage_key,stage_rule_version_id,stage_rule_definition_id,metric_definition_id,metric_definition_version_id,
      metric_definition_version_sha256,metric_unit,value_mode,constant_value,numeric_property_path,dimension_keys_json,consent_requirement,purpose,
      retention_days,projection_version,content_sha256,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'journey-event-stage/v1',?,?)`)
      .run(input.versionId,input.mappingId,input.spaceId,input.versionNumber,row.sourceId,row.schemaVersionId,row.journeyDefinitionId,row.journeyMapVersionId,
        row.stageKey,row.stageRuleVersionId,input.lineage.stageRuleDefinitionId,row.metricDefinitionId,row.metricDefinitionVersionId,
        input.lineage.metricDefinitionVersionSha256,row.metricUnit,row.valueMode,row.constantValue,row.numericPropertyPath,json(row.dimensionKeys),
        row.consentRequirement,row.purpose,row.retentionDays,input.contentSha256,input.at);}
  private requireLineageKey(){if(!this.lineageKey)throw new Error('Adapter lineage key is unavailable.');return this.lineageKey;}
  private tx<T>(run:()=>T):T{
    const transaction=this.db.transaction as unknown as (callback:()=>T)=>(()=>T);
    return transaction.call(this.db,run)();
  }
}
