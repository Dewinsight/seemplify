#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { Client } from 'pg';
import { createDatabase } from '../backend/src/databaseAdapter.js';
import { mintConnectorWorkerCredential } from '../backend/src/journeyConnectorWorkerDomain.js';
import { JourneyConnectorWorkerRepository } from '../backend/src/journeyConnectorWorkerRepository.js';

const required=(name:string)=>{const value=String(process.env[name]||'');assert.ok(value,`${name} is required`);return value;};
const host=String(process.env.POSTGRES_HOST||'127.0.0.1'),port=Number(process.env.POSTGRES_PORT||5432);
const database=required('POSTGRES_DATABASE'),ownerUser=required('POSTGRES_PROBE_OWNER_USER'),ownerFile=required('POSTGRES_PROBE_OWNER_PASSWORD_FILE');
const workerUser=required('POSTGRES_CONNECTOR_WORKER_USER'),workerFile=required('POSTGRES_CONNECTOR_WORKER_PASSWORD_FILE');
const sourceSha256=required('POSTGRES_SOURCE_SHA256'),runtimeSchemaVersion=Number(required('POSTGRES_RUNTIME_SCHEMA_VERSION'));
assert.equal(process.env.POSTGRES_PROBE_ALLOW_WRITES,'true');assert.match(database,/^experience_e2e_[a-f0-9]{12}$/u);
const password=(file:string)=>fs.readFileSync(file,'utf8').trim(),proof=`pg51_${crypto.randomBytes(5).toString('hex')}`;
const id=(suffix:string)=>`${proof}_${suffix}`,at='2026-08-08T10:00:00.000Z',later='2026-08-08T10:00:11.000Z';
const secret=crypto.randomBytes(48).toString('base64url'),keyRef=`env://${proof}`;
const user=id('user'),space=id('space'),foreignSpace=id('foreign'),survey=id('survey'),foreignSurvey=id('foreign_survey');
const connector=id('connector'),foreignConnector=id('foreign_connector'),source=id('source'),foreignSource=id('foreign_source');
const owner=new Client({host,port,database,user:ownerUser,password:password(ownerFile),ssl:false});
const settings={databaseProvider:'postgres' as const,databasePath:'',postgres:{host,port,database,user:workerUser,passwordFile:workerFile,
  ssl:false as const,schemaVersion:1,runtimeSchemaVersion,sourceSha256}};
let left:ReturnType<typeof createDatabase>|null=null,right:ReturnType<typeof createDatabase>|null=null;
try{
  await owner.connect();
  await owner.query(`INSERT INTO users(id,email,name,password_hash,role,session_version,created_at,updated_at)
    VALUES($1,$2,'Runtime51 probe','not-a-login','member',1,$3,$3)`,[user,`${proof}@example.invalid`,at]);
  for(const [spaceId,slug] of [[space,`${proof}-a`],[foreignSpace,`${proof}-b`]]){
    await owner.query(`INSERT INTO spaces(id,name,slug,created_by_user_id,created_at,updated_at) VALUES($1,'Runtime51 probe',$2,$3,$4,$4)`,[spaceId,slug,user,at]);
    await owner.query(`INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at) VALUES($1,$2,'owner',$3,$3)`,[spaceId,user,at]);
    await owner.query(`INSERT INTO platform_subscriptions(id,space_id,plan_code,status,features_json,limits_json,effective_at,created_at,updated_at)
      VALUES($1,$2,'enterprise','active','{"journeyConnectors":true}','{}',$3,$3,$3)`,[id(`subscription_${spaceId===space?'a':'b'}`),spaceId,at]);
  }
  for(const [surveyId,spaceId,title] of [[survey,space,'A'],[foreignSurvey,foreignSpace,'B']])await owner.query(`INSERT INTO surveys
    (id,space_id,title,description,purpose,audience,status,primary_metric,language,thank_you_message,theme_json,settings_json,created_at,updated_at)
    VALUES($1,$2,$3,'','research','','published','nps','English','Thanks','{}','{}',$4,$4)`,[surveyId,spaceId,title,at]);
  for(const [connectorId,spaceId] of [[connector,space],[foreignConnector,foreignSpace]])await owner.query(`INSERT INTO journey_connector_definitions
    (id,space_id,kind,name,state,deletion_mode,maximum_attempts,base_retry_seconds,revision,created_at,updated_at)
    VALUES($1,$2,'jsonl_upload','Runtime51','active','tombstone',5,5,1,$3,$3)`,[connectorId,spaceId,at]);
  await owner.query(`INSERT INTO tickets(id,survey_id,title,priority,status,owner,notes,created_at,updated_at)
    VALUES($1,$2,'must-not-leak','high','open','must-not-leak','must-not-leak',$3,$3),($4,$5,'foreign','low','open','','',$3,$3)`,
    [id('ticket'),survey,at,id('foreign_ticket'),foreignSurvey]);
  await owner.query(`INSERT INTO journey_connector_worker_principals
    (id,key_id,secret_ref,state,allowed_space_ids_json,allowed_connector_ids_json,allowed_adapters_json,not_before,expires_at,revision,created_at,updated_at)
    VALUES($1,$2,$3,'active',$4,$5,'["service_recovery_tickets_v1"]',$6,$7,1,$6,$6)`,
    [id('principal'),id('key'),keyRef,JSON.stringify([space]),JSON.stringify([connector]),at,'2026-08-09T10:00:00.000Z']);
  for(const [sourceId,connectorId,spaceId,surveyIds] of [[source,connector,space,[survey]],[foreignSource,foreignConnector,foreignSpace,[foreignSurvey]]])
    await owner.query(`INSERT INTO journey_connector_worker_sources
      (id,connector_id,space_id,adapter,state,survey_ids_json,interval_seconds,page_size,phase,generation,next_run_at,attempt_count,fencing_token,revision,created_at,updated_at)
      VALUES($1,$2,$3,'service_recovery_tickets_v1','active',$4,60,10,'scan',0,$5,0,0,1,$5,$5)`,[sourceId,connectorId,spaceId,JSON.stringify(surveyIds),at]);
  left=createDatabase(settings);right=createDatabase(settings);const resolver=(ref:string)=>ref===keyRef?secret:'';
  const leftRepo=new JourneyConnectorWorkerRepository(left,resolver),rightRepo=new JourneyConnectorWorkerRepository(right,resolver);
  const credential=mintConnectorWorkerCredential({principalId:id('principal'),keyId:id('key'),allowedSpaceIds:[space],allowedConnectorIds:[connector],
    allowedAdapters:['service_recovery_tickets_v1'],issuedAt:at,expiresAt:'2026-08-09T10:00:00.000Z',secret});
  const authority=leftRepo.authenticate({credential,at});const lease=leftRepo.claim({authority,now:at,leaseSeconds:10});assert.ok(lease);
  assert.equal(rightRepo.claim({authority,now:at,leaseSeconds:10}),null,'a second PostgreSQL adapter must not claim the leased source');
  assert.equal(rightRepo.reapExpired(later),1);const replacement=rightRepo.claim({authority,now:later,leaseSeconds:10});assert.ok(replacement);
  assert.ok(replacement!.fencingToken>lease!.fencingToken);assert.throws(()=>leftRepo.commitTicketPage({authority,lease:lease!,rows:[],at:later}),/stale/u);
  const rows=rightRepo.ticketPage(replacement!);assert.equal(rows.length,1);rightRepo.commitTicketPage({authority,lease:replacement!,rows,at:later});
  const record=await owner.query(`SELECT payload_json::text payload FROM journey_connector_records WHERE connector_id=$1`,[connector]);
  assert.equal(record.rowCount,1);assert.doesNotMatch(String(record.rows[0].payload),/must-not-leak|title|notes|owner|content/iu);
  const foreign=await owner.query(`SELECT COUNT(*)::int count FROM journey_connector_records WHERE connector_id=$1`,[foreignConnector]);assert.equal(foreign.rows[0].count,0);
  process.stdout.write(`${JSON.stringify({event:'journey_connector_worker_postgres_probe_passed',twoAdapters:true,fencedCrashRecovery:true,crossTenant:true,contentSafe:true})}\n`);
}finally{left?.close();right?.close();await owner.end().catch(()=>{});}
