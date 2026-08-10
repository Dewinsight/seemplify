#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { Client } from 'pg';

const required=(name:string)=>{const value=String(process.env[name]||'');assert.ok(value,`${name} is required`);return value;};
assert.equal(process.env.POSTGRES_PROBE_ALLOW_WRITES,'true');
const database=required('POSTGRES_DATABASE');
assert.match(database,/^experience_e2e_[a-f0-9]{12}$/u,'Runtime55 probe refuses non-disposable databases.');
const host=String(process.env.POSTGRES_HOST||'127.0.0.1'),port=Number(process.env.POSTGRES_PORT||5432);
const ownerUser=required('POSTGRES_PROBE_OWNER_USER'),ownerFile=required('POSTGRES_PROBE_OWNER_PASSWORD_FILE');
const proof=`pg55_${crypto.randomBytes(5).toString('hex')}`,id=(suffix:string)=>`${proof}_${suffix}`;
const at='2026-08-08T15:00:00.000Z',user=id('user'),space=id('space'),foreignSpace=id('foreign_space');
const password=fs.readFileSync(ownerFile,'utf8').trim();
const owner=new Client({host,port,database,user:ownerUser,password,ssl:false,application_name:'runtime55-workspace-view-owner'});

try {
  await owner.connect();
  assert.equal((await owner.query('SELECT version FROM experience_runtime_schema_version WHERE version=55')).rowCount,1);
  await owner.query(`INSERT INTO users(id,email,name,password_hash,role,session_version,created_at,updated_at)
    VALUES($1,$2,'Runtime55 owner','not-a-login','member',1,$3,$3)`,[user,`${proof}@example.invalid`,at]);
  for(const [spaceId,slug] of [[space,`${proof}-a`],[foreignSpace,`${proof}-b`]]) {
    await owner.query(`INSERT INTO spaces(id,name,slug,created_by_user_id,created_at,updated_at)
      VALUES($1,'Runtime55 saved views',$2,$3,$4,$4)`,[spaceId,slug,user,at]);
    await owner.query(`INSERT INTO space_memberships(space_id,user_id,role,joined_at,updated_at)
      VALUES($1,$2,'owner',$3,$3)`,[spaceId,user,at]);
    await owner.query(`INSERT INTO platform_subscriptions
      (id,space_id,plan_code,status,features_json,limits_json,effective_at,created_at,updated_at)
      VALUES($1,$2,'enterprise','active','{"journeyHierarchy":true,"journeyBlueprints":true}','{}',$3,$3,$3)`,
    [id(`subscription_${spaceId===space?'a':'b'}`),spaceId,at]);
  }

  const repository=await import('../backend/src/journeyWorkspaceSavedViews.js');
  const hierarchyConfiguration={version:1 as const,includeRetired:false,rootDefinitionId:null,direction:'both' as const,
    taxonomyKinds:['product'] as const,reviewStates:['approved'] as const,lifecycles:['active'] as const};
  const created=repository.createJourneyWorkspaceSavedView({spaceId:space,actorUserId:user,surface:'hierarchy',
    audience:'executive',name:'Runtime55 executive hierarchy',configuration:hierarchyConfiguration,makeDefault:true,
    expectedPreferenceRevision:0,idempotencyKey:`${proof}:create`,at});
  assert.equal(created.replayed,false);assert.equal(created.preferenceRevision,1);
  const replay=repository.createJourneyWorkspaceSavedView({spaceId:space,actorUserId:user,surface:'hierarchy',
    audience:'executive',name:'Runtime55 executive hierarchy',configuration:hierarchyConfiguration,makeDefault:true,
    expectedPreferenceRevision:0,idempotencyKey:`${proof}:create`,at});
  assert.equal(replay.replayed,true);assert.equal(replay.viewId,created.viewId);
  const revised=repository.reviseJourneyWorkspaceSavedView({spaceId:space,actorUserId:user,viewId:created.viewId,
    expectedRevision:1,audience:'delivery',name:'Runtime55 delivery hierarchy',
    configuration:{...hierarchyConfiguration,direction:'downstream'},idempotencyKey:`${proof}:revise`,at});
  assert.equal(revised.replayed,false);
  assert.throws(()=>repository.reviseJourneyWorkspaceSavedView({spaceId:space,actorUserId:user,viewId:created.viewId,
    expectedRevision:1,audience:'internal',name:'Stale',configuration:hierarchyConfiguration,
    idempotencyKey:`${proof}:stale`,at}),(error:any)=>error?.code==='JOURNEY_WORKSPACE_VIEW_REVISION_CONFLICT');
  assert.throws(()=>repository.reviseJourneyWorkspaceSavedView({spaceId:foreignSpace,actorUserId:user,viewId:created.viewId,
    expectedRevision:2,audience:'internal',name:'Cross tenant',configuration:hierarchyConfiguration,
    idempotencyKey:`${proof}:cross`,at}),(error:any)=>error?.code==='JOURNEY_WORKSPACE_VIEW_NOT_FOUND');
  const listed=repository.listJourneyWorkspaceSavedViews({spaceId:space,actorUserId:user,surface:'hierarchy'});
  assert.equal(listed.views[0]?.revision,2);assert.equal(listed.defaultViewId,created.viewId);
  const versionId=listed.views[0]?.versionId;
  await assert.rejects(owner.query('UPDATE journey_workspace_view_versions SET configuration_sha256=$1 WHERE id=$2',
    ['0'.repeat(64),versionId]),(error:any)=>error?.code==='55000');
  const evidence=await owner.query(`SELECT
    (SELECT count(*)::int FROM journey_workspace_view_versions WHERE view_id=$1) version_count,
    (SELECT count(*)::int FROM journey_workspace_view_operations WHERE space_id=$2) operation_count,
    (SELECT count(*)::int FROM journey_workspace_view_audit_events WHERE view_id=$1) audit_count`,
  [created.viewId,space]);
  assert.deepEqual(evidence.rows[0],{version_count:2,operation_count:2,audit_count:2});
  process.stdout.write(`${JSON.stringify({event:'journey_workspace_saved_views_runtime55_postgres_probe_passed',
    appRoleRepository:true,idempotentReplay:true,optimisticConflict:true,crossTenantDenied:true,
    immutableHistory:true,privateDefault:true})}\n`);
} finally {
  const { db }=await import('../backend/src/database.js');
  db.close();
  await owner.end().catch(()=>undefined);
}
