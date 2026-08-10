#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { Client } from 'pg';
import { createDatabase } from '../backend/src/databaseAdapter.js';
import { JourneyOperationalStageFeedRepository } from '../backend/src/journeyOperationalStageFeedRepository.js';

const required=(name:string)=>{const value=String(process.env[name]||'');assert.ok(value,`${name} is required`);return value;};
const password=(file:string)=>fs.readFileSync(file,'utf8').trim();
const host=String(process.env.POSTGRES_HOST||'127.0.0.1'),port=Number(process.env.POSTGRES_PORT||5432);
const database=required('POSTGRES_DATABASE'),ownerUser=required('POSTGRES_PROBE_OWNER_USER');
const ownerFile=required('POSTGRES_PROBE_OWNER_PASSWORD_FILE'),appUser=required('POSTGRES_USER');
const appFile=required('POSTGRES_PASSWORD_FILE'),workerUser=required('POSTGRES_OPERATIONAL_FEED_WORKER_USER');
const workerFile=required('POSTGRES_OPERATIONAL_FEED_WORKER_PASSWORD_FILE');
const sourceSha256=required('POSTGRES_SOURCE_SHA256'),runtimeSchemaVersion=Number(required('POSTGRES_RUNTIME_SCHEMA_VERSION'));
const identityKey=fs.readFileSync(required('JOURNEY_IDENTITY_HASH_KEY_FILE'));
assert.equal(process.env.POSTGRES_PROBE_ALLOW_WRITES,'true');assert.match(database,/^experience_e2e_[a-f0-9]{12}$/u);
const proof=`pg52_${crypto.randomBytes(5).toString('hex')}`,id=(suffix:string)=>`${proof}_${suffix}`;
const hmac=(value:string)=>crypto.createHmac('sha256',identityKey).update(value,'utf8').digest('hex');
const at='2026-08-08T10:00:00.000Z',expired='2026-08-08T10:00:06.000Z',retention='2026-09-01T00:00:00.000Z';
const ids={user:id('user'),space:id('space'),journey:id('journey'),map:id('map'),stage:id('stage'),survey:id('survey'),
  collector:id('collector'),response:id('response'),ticket:id('ticket'),event:id('event'),metric:id('metric'),metricVersion:id('metric_v1'),
  research:id('research'),snapshot:id('snapshot'),link:id('link'),profile:id('profile'),policy:id('policy'),policyVersion:id('policy_v1'),
  receipt:id('receipt'),mapping:id('mapping'),mappingVersion:id('mapping_v1')};
const settings=(user:string,passwordFile:string)=>({databaseProvider:'postgres' as const,databasePath:'',postgres:{host,port,database,user,
  passwordFile,ssl:false as const,schemaVersion:1,runtimeSchemaVersion,sourceSha256}});
const owner=new Client({host,port,database,user:ownerUser,password:password(ownerFile),ssl:false});
let app:ReturnType<typeof createDatabase>|null=null,left:ReturnType<typeof createDatabase>|null=null,right:ReturnType<typeof createDatabase>|null=null;
try{
  await owner.connect();
  await owner.query('BEGIN');
  await owner.query(`INSERT INTO users(id,email,name,password_hash,role,session_version,created_at,updated_at)
    VALUES($1,$2,'Runtime52 probe','not-a-login','member',1,$3,$3)`,[ids.user,`${proof}@example.invalid`,at]);
  await owner.query(`INSERT INTO spaces(id,name,slug,created_by_user_id,created_at,updated_at) VALUES($1,'Runtime52 probe',$2,$3,$4,$4)`,
    [ids.space,proof,ids.user,at]);
  await owner.query(`INSERT INTO journey_definitions(id,space_id,name,purpose,experience_type,map_type,mode,status,owner_user_id,
    current_version_id,published_version_id,review_cadence_days,revision,created_at,updated_at)
    VALUES($1,$2,'Recovery','Recovery','customer','current_state','connected','draft',$3,$4,NULL,0,1,$5,$5)`,
    [ids.journey,ids.space,ids.user,ids.map,at]);
  await owner.query(`INSERT INTO journey_map_versions(id,definition_id,space_id,version_number,schema_version,state,map_type,mode,
    experience_type,objective,industry,summary,legacy_audience,provenance_json,author_user_id,created_at)
    VALUES($1,$2,$3,1,2,'draft','current_state','connected','customer','','','','','{}',$4,$5)`,[ids.map,ids.journey,ids.space,ids.user,at]);
  await owner.query(`INSERT INTO journey_map_stages(id,version_id,space_id,stage_key,name,goal,description,ordinal)
    VALUES($1,$2,$3,'recover','Recover','','',0)`,[ids.stage,ids.map,ids.space]);
  await owner.query(`INSERT INTO surveys(id,space_id,title,description,purpose,audience,status,primary_metric,language,thank_you_message,
    theme_json,settings_json,created_at,updated_at) VALUES($1,$2,'Recovery','','research','','published','nps','English','Thanks','{}','{}',$3,$3)`,
    [ids.survey,ids.space,at]);
  await owner.query(`INSERT INTO collectors(id,survey_id,name,type,slug,status,settings_json,created_at)
    VALUES($1,$2,'Web','web',$3,'open','{}',$4)`,[ids.collector,ids.survey,proof,at]);
  await owner.query(`INSERT INTO responses(id,survey_id,collector_id,respondent_token,status,answers_json,metadata_json,started_at,completed_at,duration_seconds)
    VALUES($1,$2,$3,'governed-subject','completed','{}','{}',$4,$4,1)`,[ids.response,ids.survey,ids.collector,at]);
  await owner.query(`INSERT INTO tickets(id,survey_id,response_id,title,priority,status,owner,notes,created_at,updated_at)
    VALUES($1,$2,$3,'PRIVATE title','high','open','PRIVATE owner','PRIVATE notes',$4,$4)`,[ids.ticket,ids.survey,ids.response,at]);
  await owner.query(`INSERT INTO ticket_events(id,ticket_id,event_type,detail_json,created_at) VALUES($1,$2,'created','{}',$3)`,[ids.event,ids.ticket,at]);
  await owner.query(`INSERT INTO journey_metric_definitions(id,space_id,journey_definition_id,target_type,target_id,stage_id,name,state,
    current_version_id,revision,idempotency_key,intent_sha256,created_by_user_id,created_at,updated_at)
    VALUES($1,$2,$3,'stage',$4,$4,'Recovery rate','active',$5,1,$6,$7,$8,$9,$9)`,
    [ids.metric,ids.space,ids.journey,ids.stage,ids.metricVersion,id('metric-key'),'a'.repeat(64),ids.user,at]);
  const configuration={kind:'recovery_rate',eligibleEventType:'ticket.opened',successEventType:'ticket.recovered',
    nativeSource:{configVersion:'journey-native-metric-source/v1',adapter:'service_recovery_tickets',adapterVersion:'1',
      sourceIds:[ids.survey],stageAssociation:{stageId:ids.stage,via:'research_link'}}};
  await owner.query(`INSERT INTO journey_metric_definition_versions(id,definition_id,space_id,version_number,source_kind,binding_id,
    calculator_kind,aggregation,direction,window_seconds,timezone,minimum_sample_size,freshness_max_age_seconds,population_json,
    filters_json,formula_json,configuration_json,content_sha256,idempotency_key,intent_sha256,created_by_user_id,created_at)
    VALUES($1,$2,$3,1,'operational_import',NULL,'operational','rate','higher_is_better',86400,'UTC',3,86400,'{}','{}','{}',$4,$5,$6,$7,$8,$9)`,
    [ids.metricVersion,ids.metric,ids.space,JSON.stringify(configuration),'b'.repeat(64),id('metric-v-key'),'c'.repeat(64),ids.user,at]);
  await owner.query(`INSERT INTO journey_research_sources(id,space_id,source_type,source_ref,adapter,owner_user_id,state,revision,last_resolved_at,
    idempotency_key,intent_sha256,created_at,updated_at) VALUES($1,$2,'ticket',$3,'recovery',$4,'active',1,$5,$6,$7,$5,$5)`,
    [ids.research,ids.space,`recovery-ticket:${ids.ticket}`,ids.user,at,id('research-key'),'d'.repeat(64)]);
  await owner.query(`INSERT INTO journey_research_snapshots(id,source_id,space_id,version_number,fingerprint,access_state,source_label,excerpt,
    population,sample_size,collected_at,metadata_json,created_by_user_id,created_at,retention_expires_at)
    VALUES($1,$2,$3,1,$4,'available','Recovery','','',1,$5,'{}',$6,$5,$7)`,
    [ids.snapshot,ids.research,ids.space,'e'.repeat(64),at,ids.user,retention]);
  await owner.query(`INSERT INTO journey_research_links(id,space_id,source_id,snapshot_id,target_type,target_id,state,revision,idempotency_key,
    intent_sha256,created_by_user_id,created_at,updated_at) VALUES($1,$2,$3,$4,'stage',$5,'active',1,$6,$7,$8,$9,$9)`,
    [ids.link,ids.space,ids.research,ids.snapshot,ids.stage,id('link-key'),'f'.repeat(64),ids.user,at]);
  await owner.query(`INSERT INTO journey_identity_profiles(id,space_id,kind,status,created_at,created_by_command_id)
    VALUES($1,$2,'anonymous','active',$3,$4)`,[ids.profile,ids.space,at,id('identity-command')]);
  await owner.query(`INSERT INTO journey_identity_bindings(id,space_id,identifier_kind,identifier_namespace,identifier_value,profile_id,bound_at,bound_by_command_id)
    VALUES($1,$2,'anonymous_id','survey-recipient','governed-subject',$3,$4,$5)`,[id('binding'),ids.space,ids.profile,at,id('binding-command')]);
  await owner.query(`INSERT INTO journey_stage_survey_policies(id,space_id,survey_id_hmac,collector_id_hmac,state,revision,current_version_id,
    created_by_user_id,created_at,updated_at) VALUES($1,$2,$3,$4,'active',1,$5,$6,$7,$7)`,
    [ids.policy,ids.space,hmac(ids.survey),hmac(ids.collector),ids.policyVersion,ids.user,at]);
  await owner.query(`INSERT INTO journey_stage_survey_policy_versions(id,policy_id,space_id,version_number,notice_text,notice_sha256,
    allowed_purposes_json,retention_days,requires_explicit_consent,content_sha256,created_by_user_id,created_at)
    VALUES($1,$2,$3,1,'Governed recovery analytics notice',$4,'["analytics"]',30,TRUE,$5,$6,$7)`,
    [ids.policyVersion,ids.policy,ids.space,'1'.repeat(64),'2'.repeat(64),ids.user,at]);
  await owner.query(`INSERT INTO journey_stage_survey_governance_receipts(id,space_id,policy_version_id,policy_id,response_id_hmac,subject_id_hmac,
    consent_state,purposes_json,notice_sha256,source_snapshot_sha256,retention_expires_at,created_at)
    VALUES($1,$2,$3,$4,$5,$6,'granted','["analytics"]',$7,$8,$9,$10)`,
    [ids.receipt,ids.space,ids.policyVersion,ids.policy,hmac(ids.response),hmac('governed-subject'),'1'.repeat(64),'3'.repeat(64),retention,at]);
  await owner.query(`INSERT INTO journey_operational_stage_mappings(id,space_id,source_kind,state,metric_definition_id,revision,current_version_id,
    idempotency_key_hmac,intent_sha256,created_by_user_id,created_at,updated_at)
    VALUES($1,$2,'service_recovery_ticket','active',$3,1,$4,$5,$6,$7,$8,$8)`,
    [ids.mapping,ids.space,ids.metric,ids.mappingVersion,hmac(id('mapping-key')),'4'.repeat(64),ids.user,at]);
  await owner.query(`INSERT INTO journey_operational_stage_mapping_versions(id,mapping_id,space_id,version_number,journey_definition_id,stage_id,
    metric_definition_id,metric_definition_version_id,metric_definition_version_sha256,source_survey_hmacs_json,event_map_json,
    identity_identifier_kind,identity_identifier_namespace,allowed_purposes_json,retention_days,projection_version,content_sha256,created_by_user_id,created_at)
    VALUES($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,'anonymous_id','survey-recipient','["analytics"]',15,'ticket-stage-feed/v1',$11,$12,$13)`,
    [ids.mappingVersion,ids.mapping,ids.space,ids.journey,ids.stage,ids.metric,ids.metricVersion,'b'.repeat(64),JSON.stringify([hmac(ids.survey)]),
      JSON.stringify({created:'ticket.opened',closed:'ticket.recovered'}),'5'.repeat(64),ids.user,at]);
  await owner.query('COMMIT');

  app=createDatabase(settings(appUser,appFile));left=createDatabase(settings(workerUser,workerFile));right=createDatabase(settings(workerUser,workerFile));
  const appRepo=new JourneyOperationalStageFeedRepository(app),leftRepo=new JourneyOperationalStageFeedRepository(left);
  const rightRepo=new JourneyOperationalStageFeedRepository(right);
  assert.deepEqual(appRepo.captureTicketEvent(ids.event,at),{captured:1,excluded:null});
  const lease=leftRepo.claim({owner:id('worker-a'),now:at,leaseMs:5_000,spaceIds:[ids.space]});assert.ok(lease);
  assert.equal(rightRepo.claim({owner:id('worker-b'),now:at,leaseMs:5_000,spaceIds:[ids.space]}),null);
  const replacement=rightRepo.claim({owner:id('worker-b'),now:expired,leaseMs:5_000,spaceIds:[ids.space]});assert.ok(replacement);
  assert.ok(Number(replacement!.lease_generation)>Number(lease!.lease_generation));
  assert.throws(()=>leftRepo.complete(lease!,expired),/lease was lost/u);assert.equal(rightRepo.complete(replacement!,expired),true);
  const derived=await owner.query(`SELECT (SELECT COUNT(*)::int FROM journey_stage_intelligence_facts WHERE space_id=$1) facts,
    (SELECT COUNT(*)::int FROM journey_operational_timeline_revisions WHERE space_id=$1) timeline`,[ids.space]);
  assert.deepEqual(derived.rows[0],{facts:1,timeline:1});
  const raw=await owner.query(`SELECT projection_json::text projection FROM journey_operational_stage_source_revisions WHERE space_id=$1`,[ids.space]);
  assert.doesNotMatch(String(raw.rows[0].projection),/PRIVATE|title|notes|owner|content|message/iu);
  assert.deepEqual(appRepo.tombstoneTicketEvent({spaceId:ids.space,ticketEventId:ids.event,reason:'source_deleted',now:expired}),{enqueued:1});
  const deletion=rightRepo.claim({owner:id('worker-b'),now:expired,spaceIds:[ids.space]});assert.ok(deletion);rightRepo.complete(deletion!,expired);
  const final=await owner.query(`SELECT operation FROM journey_stage_intelligence_facts WHERE space_id=$1 ORDER BY revision DESC LIMIT 1`,[ids.space]);
  assert.equal(final.rows[0].operation,'delete');
  process.stdout.write(`${JSON.stringify({event:'journey_operational_stage_feed_postgres_probe_passed',twoAdapters:true,
    fencedCrashRecovery:true,contentSafe:true,tombstone:true})}\n`);
}finally{app?.close();left?.close();right?.close();await owner.query('ROLLBACK').catch(()=>{});await owner.end().catch(()=>{});}
