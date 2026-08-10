#!/usr/bin/env node
import assert from 'node:assert/strict';import crypto from 'node:crypto';import fs from 'node:fs';import {Client} from 'pg';
import {createDatabase} from '../backend/src/databaseAdapter.js';import {JourneyEventRetentionRepository} from '../backend/src/journeyEventRetentionRepository.js';
const required=(name:string)=>{const value=String(process.env[name]||'');assert.ok(value,`${name} is required`);return value;};
const password=(file:string)=>fs.readFileSync(file,'utf8').trim(),host=String(process.env.POSTGRES_HOST||'127.0.0.1'),
  port=Number(process.env.POSTGRES_PORT||5432),database=required('POSTGRES_DATABASE'),ownerUser=required('POSTGRES_PROBE_OWNER_USER'),
  ownerFile=required('POSTGRES_PROBE_OWNER_PASSWORD_FILE'),workerUser=required('POSTGRES_EVENT_RETENTION_WORKER_USER'),
  workerFile=required('POSTGRES_EVENT_RETENTION_WORKER_PASSWORD_FILE'),runtimeSchemaVersion=Number(required('POSTGRES_RUNTIME_SCHEMA_VERSION')),
  sourceSha256=required('POSTGRES_SOURCE_SHA256');
assert.equal(process.env.POSTGRES_PROBE_ALLOW_WRITES,'true');assert.match(database,/^experience_e2e_[a-f0-9]{12}$/u);
const proof=`pg53_${crypto.randomBytes(5).toString('hex')}`,id=(suffix:string)=>`${proof}_${suffix}`;
const now=new Date(),asOf=new Date(now.getTime()-60_000).toISOString(),received=new Date(now.getTime()-86_400_000).toISOString(),
  expired=new Date(now.getTime()-120_000).toISOString(),future=new Date(now.getTime()+86_400_000).toISOString();
const owner=new Client({host,port,database,user:ownerUser,password:password(ownerFile),ssl:false});const settings={databaseProvider:'postgres' as const,
  databasePath:'',postgres:{host,port,database,user:workerUser,passwordFile:workerFile,ssl:false as const,schemaVersion:1,runtimeSchemaVersion,sourceSha256}};
let left:ReturnType<typeof createDatabase>|null=null,right:ReturnType<typeof createDatabase>|null=null;
try{await owner.connect();const user=id('user'),space=id('space'),source=id('source'),credential=id('credential'),schema=id('schema'),
  schemaVersion=id('schema_v1'),journey=id('journey'),map=id('map');
  await owner.query(`INSERT INTO users(id,email,name,password_hash,role,session_version,created_at,updated_at)
    VALUES($1,$2,'Runtime53','none','member',1,$3,$3)`,[user,`${proof}@example.invalid`,received]);
  await owner.query(`INSERT INTO spaces(id,name,slug,created_by_user_id,created_at,updated_at) VALUES($1,'Runtime53',$2,$3,$4,$4)`,[space,proof,user,received]);
  await owner.query(`INSERT INTO journey_event_sources(id,space_id,name,environment,status,validation_mode,allowed_origins_json,
    allowed_bundle_ids_json,events_per_minute,bytes_per_minute,idempotency_key,intent_hash,created_at,updated_at)
    VALUES($1,$2,'Runtime53','production','active','enforce','[]','[]',1000,1000000,$3,$4,$5,$5)`,[source,space,id('source-key'),'a'.repeat(64),received]);
  await owner.query(`INSERT INTO journey_event_credentials(id,source_id,space_id,environment,kind,scope,display_prefix,algorithm,salt,digest,status,
    idempotency_key,intent_hash,created_at) VALUES($1,$2,$3,'production','server_secret','events:write','jsk_live.pg53','scrypt-v1',$4,$5,
    'active',$6,$7,$8)`,[credential,source,space,'s'.repeat(24),'b'.repeat(64),id('credential-key'),'c'.repeat(64),received]);
  await owner.query(`INSERT INTO journey_event_schemas(id,source_id,space_id,event_name,idempotency_key,intent_hash,created_at,updated_at)
    VALUES($1,$2,$3,'retention_probe',$4,$5,$6,$6)`,[schema,source,space,id('schema-key'),'d'.repeat(64),received]);
  await owner.query(`INSERT INTO journey_event_schema_versions(id,schema_id,source_id,space_id,version,version_major,version_minor,state,
    properties_json,compatibility_json,content_sha256,idempotency_key,intent_hash,created_at,published_at)
    VALUES($1,$2,$3,$4,'1.0',1,0,'published','[]','{}',$5,$6,$7,$8,$8)`,
    [schemaVersion,schema,source,space,'e'.repeat(64),id('schema-v-key'),'f'.repeat(64),received]);
  await owner.query(`INSERT INTO journey_definitions(id,space_id,name,purpose,experience_type,map_type,mode,status,owner_user_id,current_version_id,
    review_cadence_days,revision,created_at,updated_at) VALUES($1,$2,'Runtime53','Retention','customer','current_state','connected','draft',$3,$4,0,1,$5,$5)`,
    [journey,space,user,map,received]);
  await owner.query(`INSERT INTO journey_map_versions(id,definition_id,space_id,version_number,schema_version,state,map_type,mode,experience_type,
    objective,industry,summary,legacy_audience,provenance_json,author_user_id,created_at)
    VALUES($1,$2,$3,1,2,'draft','current_state','connected','customer','','','','','{}',$4,$5)`,[map,journey,space,user,received]);
  const rawSql=`INSERT INTO journey_raw_events(received_at,id,space_id,source_id,environment,credential_id,event_id,protocol_version,event_call,event_name,
    event_version,occurred_at,schema_version_id,channel,consent_state,ingest_state,payload_json,context_json,consent_json,validation_issues_json,
    envelope_sha256,payload_bytes,retention_expires_at) VALUES($1,$2,$3,$4,'production',$5,$6,'1.0','track','retention_probe',1,$1,$7,
    'server','granted','accepted','{}','{}','{}','[]',$8,2,$9)`;
  for(const suffix of ['a_purge','b_active','c_stage'])await owner.query(rawSql,[received,id(suffix),space,source,credential,id(`event_${suffix}`),
    schemaVersion,crypto.createHash('sha256').update(suffix).digest('hex'),expired]);
  await owner.query(`INSERT INTO journey_event_processing_inbox(raw_received_at,raw_event_id,space_id,source_id,environment,event_id,processor,state,
    available_at,lease_generation,attempt_count,updated_at) VALUES($1,$2,$3,$4,'production',$5,'connected_journey_v1','pending',$1,0,0,$1)`,
    [received,id('b_active'),space,source,id('event_b_active')]);
  await owner.query(`INSERT INTO journey_stage_rule_decisions(id,decision_key,raw_received_at,raw_event_id,space_id,source_id,environment,event_id,
    journey_definition_id,journey_map_version_id,subject_kind,anonymous_id_hash,outcome,event_occurred_at,evaluated_at,is_late,is_out_of_order,
    rule_set_sha256,trace_json,provenance_json,processor,processor_version,lease_generation,created_at,retention_expires_at)
    VALUES($1,$2,$3,$4,$5,$6,'production',$7,$8,$9,'anonymous',$10,'no_match',$3,$3,FALSE,FALSE,$11,'{}','{}',
    'connected_journey_v1','1',1,$3,$12)`,[id('decision'),crypto.createHash('sha256').update(proof).digest('hex'),received,id('c_stage'),space,
      source,id('event_c_stage'),journey,map,'1'.repeat(64),'2'.repeat(64),future]);
  left=createDatabase(settings);right=createDatabase(settings);const a=new JourneyEventRetentionRepository(left),b=new JourneyEventRetentionRepository(right);
  assert.equal(a.request({id:id('run'),kind:'retention',asOf,batchSize:10,at:now.toISOString()}),true);
  const first=a.claim({owner:id('worker-a'),at:now.toISOString(),leaseExpiresAt:new Date(now.getTime()+5_000).toISOString()});assert.ok(first);
  assert.equal(b.claim({owner:id('worker-b'),at:now.toISOString(),leaseExpiresAt:new Date(now.getTime()+30_000).toISOString()}),null);
  const reclaimAt=new Date(now.getTime()+6_000).toISOString();const second=b.claim({owner:id('worker-b'),at:reclaimAt,
    leaseExpiresAt:new Date(now.getTime()+60_000).toISOString()});assert.ok(second);assert.ok(second!.leaseGeneration>first!.leaseGeneration);
  assert.throws(()=>a.purgeRetentionCandidate({claim:first,candidate:{spaceId:space,sourceId:source,environment:'production',receivedAt:received,
    rawEventId:id('a_purge')}}),/lease is invalid/u);
  const rows=b.scanRetentionPage({claim:second,limit:10});const plan=b.planRetentionPage({asOf,limit:10,rows});
  const outcomes=new Map<string,string>();for(const item of plan.planned){const result=item.disposition==='purgeable'
    ?b.purgeRetentionCandidate({claim:second,candidate:item.candidate}):{outcomeCode:item.disposition,purgedCount:0};outcomes.set(item.candidate.rawEventId,result.outcomeCode);}
  assert.equal(outcomes.get(id('a_purge')),'purged');assert.equal(outcomes.get(id('b_active')),'active_processing');
  assert.equal(outcomes.get(id('c_stage')),'stage_reconciliation_required');
  const remaining=await owner.query(`SELECT id FROM journey_raw_events WHERE space_id=$1 ORDER BY id`,[space]);
  assert.deepEqual(remaining.rows.map(row=>row.id),[id('b_active'),id('c_stage')]);
  await owner.query(`UPDATE journey_event_processing_inbox SET state='completed',available_at=$1,lease_owner=NULL,lease_token=NULL,
    lease_expires_at=NULL,updated_at=$1 WHERE raw_received_at=$2 AND raw_event_id=$3`,[now.toISOString(),received,id('b_active')]);
  process.stdout.write(`${JSON.stringify({event:'journey_event_retention_postgres_probe_passed',twoAdapters:true,staleFence:true,
    purgedEligible:true,activeBlocked:true,stageLinkedBlocked:true})}\n`);
}finally{left?.close();right?.close();await owner.end().catch(()=>{});}
