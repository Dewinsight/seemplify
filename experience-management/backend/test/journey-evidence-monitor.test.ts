import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import request from 'supertest';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'seemplify-evidence-monitor-'));
const passwordFile=path.join(root,'admin-password');const sessionFile=path.join(root,'session-secret');
const terraFile=path.join(root,'terra-secret');const xKeyFile=path.join(root,'x-key');const esignKeyFile=path.join(root,'esign-key');
fs.writeFileSync(passwordFile,'Evidence-Monitor-Test-2026!');
fs.writeFileSync(sessionFile,'evidence-monitor-session-secret-that-is-long-enough');
fs.writeFileSync(terraFile,'evidence-monitor-terra-secret-that-is-long-enough');
fs.writeFileSync(xKeyFile,Buffer.alloc(32,71).toString('base64url'));fs.writeFileSync(esignKeyFile,Buffer.alloc(32,72).toString('base64url'));
Object.assign(process.env,{DATABASE_PATH:path.join(root,'test.sqlite'),UPLOAD_DIR:path.join(root,'uploads'),
  KNOWLEDGE_STORAGE_DIR:path.join(root,'knowledge'),FRONTEND_DIST:path.join(root,'missing-frontend'),
  PUBLIC_URL:'http://127.0.0.1:5412',ADMIN_EMAIL:'evidence-monitor@seemplify.local',ADMIN_PASSWORD_FILE:passwordFile,
  SESSION_SECRET_FILE:sessionFile,TERRA_GATEWAY_SHARED_SECRET_FILE:terraFile,LOCAL_LLM_SHARED_SECRET_FILE:terraFile,
  EMAIL_MODE:'log',X_CREDENTIAL_ENCRYPTION_KEY_FILE:xKeyFile,ESIGN_STORAGE_DIR:path.join(root,'esign'),
  ESIGN_ENCRYPTION_KEY_FILE:esignKeyFile,X_SEED_CONSUMER_KEY_FILE:path.join(root,'missing-x-key'),
  X_SEED_CONSUMER_SECRET_FILE:path.join(root,'missing-x-secret'),X_SEED_BEARER_TOKEN_FILE:path.join(root,'missing-x-bearer'),
  X_SEED_ACCESS_TOKEN_FILE:path.join(root,'missing-x-token'),X_SEED_ACCESS_TOKEN_SECRET_FILE:path.join(root,'missing-x-token-secret')});

const {app}=await import('../src/app.js');const {db}=await import('../src/database.js');
const maps=await import('../src/journeyMaps.js');
const {journeyEvidenceMonitorRepository:repository}=await import('../src/journeyEvidenceMonitorRepository.js');
const {JourneyEvidenceMonitorWorker}=await import('../src/journeyEvidenceMonitorWorker.js');
const backendRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

after(()=>{db.close();fs.rmSync(root,{recursive:true,force:true});});

const agent=request.agent(app);
await agent.post('/api/auth/login').send({email:'evidence-monitor@seemplify.local',password:'Evidence-Monitor-Test-2026!'}).expect(200);
const session=(await agent.get('/api/auth/session').expect(200)).body;
const userId=String(session.user.id);const spaceId=String(session.activeSpace.id);
db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(spaceId);
const map=maps.createJourneyMap(spaceId,userId,{name:'Evidence monitor map',stageNames:['Discover']});

function source(id:string,completedAt:string){
  const surveyId=`survey-${id}`;const collectorId=`collector-${id}`;const responseId=`response-${id}`;
  const now='2026-08-08T08:00:00.000Z';
  db.prepare(`INSERT INTO surveys(id,space_id,title,description,purpose,audience,status,primary_metric,language,
    thank_you_message,theme_json,settings_json,created_at,updated_at,published_at)
    VALUES (?,?,?,'','customer_experience','','live','nps','English','Thank you','{}','{}',?,?,?)`)
    .run(surveyId,spaceId,`Survey ${id}`,now,now,now);
  db.prepare(`INSERT INTO collectors(id,survey_id,name,type,slug,status,settings_json,created_at)
    VALUES (?,?,'Web','web',?,'open','{}',?)`).run(collectorId,surveyId,`slug-${id}`,now);
  db.prepare(`INSERT INTO responses(id,survey_id,collector_id,respondent_token,status,answers_json,metadata_json,
    started_at,completed_at,duration_seconds,ai_analysis_json,analyzed_at)
    VALUES (?,?,?,?,'completed','{}','{}',?,?,60,NULL,NULL)`)
    .run(responseId,surveyId,collectorId,`respondent-${id}`,completedAt,completedAt);
  const link=maps.attachEvidenceLink(spaceId,userId,{targetType:'definition',targetId:map.id,
    sourceType:'survey_response',sourceRef:responseId,assessment:'supports',confidence:0.8,freshnessDays:30});
  return{surveyId,responseId,link};
}

function claimOnly(linkId:string,at:string){
  db.prepare("UPDATE journey_evidence_monitor_states SET next_check_at='2999-01-01T00:00:00.000Z',lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL").run();
  db.prepare('UPDATE journey_evidence_monitor_states SET next_check_at=? WHERE evidence_link_id=?').run(at,linkId);
  const claim=repository.claim({owner:'monitor-test',now:at});assert.ok(claim);return claim;
}

test('registered runtime54 has exact predecessor53 and content-safe fenced monitor storage',()=>{
  const migration=fs.readFileSync(path.join(backendRoot,'migrations/postgres/0054_journey_evidence_monitor.sql'),'utf8');
  assert.match(migration,/MAX\(version\)[\s\S]*?<>53/u);
  assert.match(migration,/lease_token TEXT[\s\S]*?\^\[a-f0-9\]\{64\}\$/u);
  assert.match(migration,/journey_evidence_monitor_events_append_only/u);
  assert.match(migration,/BEFORE UPDATE OR DELETE/u);
  assert.doesNotMatch(migration,/source_ref|excerpt|source_label/iu);
});

test('monitor records current and changed source fingerprints without refreshing reviewed content',()=>{
  const item=source('change','2026-08-08T07:00:00.000Z');const at='2026-08-08T09:00:00.000Z';
  assert.equal(repository.seedMissing(at,100)>0,true);
  let claim=claimOnly(item.link.id,at);let observed=repository.observe(claim,at);assert.equal(observed.status,'current');
  repository.complete(claim,observed,at);
  db.prepare('UPDATE responses SET analyzed_at=? WHERE id=?').run('2026-08-08T09:30:00.000Z',item.responseId);
  const later='2026-08-08T10:00:00.000Z';claim=claimOnly(item.link.id,later);observed=repository.observe(claim,later);
  assert.equal(observed.status,'changed');repository.complete(claim,observed,later);
  const link=db.prepare('SELECT source_updated_at,last_validated_at,invalidated_at FROM journey_evidence_links WHERE id=?')
    .get(item.link.id) as any;
  assert.equal(link.source_updated_at,item.link.sourceUpdatedAt);assert.equal(link.last_validated_at,item.link.lastValidatedAt);
  assert.equal(link.invalidated_at,null);
});

test('freshness expiry becomes stale while authoritative source loss invalidates and is excluded from export',()=>{
  const stale=source('stale','2026-01-01T00:00:00.000Z');const removed=source('removed','2026-08-08T07:00:00.000Z');
  const at='2026-08-08T11:00:00.000Z';repository.seedMissing(at,100);
  let claim=claimOnly(stale.link.id,at);let observed=repository.observe(claim,at);assert.equal(observed.status,'stale');
  repository.complete(claim,observed,at);
  db.prepare('DELETE FROM responses WHERE id=?').run(removed.responseId);
  claim=claimOnly(removed.link.id,at);observed=repository.observe(claim,at);assert.equal(observed.status,'unavailable');
  const result=repository.complete(claim,observed,at);assert.equal(result.invalidationApplied,true);
  const invalidated=db.prepare('SELECT invalidated_at,invalidated_reason FROM journey_evidence_links WHERE id=?')
    .get(removed.link.id) as any;
  assert.equal(invalidated.invalidated_reason,'automatic_source_unavailable');
  const notes=maps.listJourneyExportSourceNotes(spaceId,userId,map.id,map.currentVersionId!,200);
  assert.equal(notes.notes.some((note)=>note.sourceLabel===removed.link.sourceLabel),false);
  const linkSha=crypto.createHash('sha256').update(removed.link.id).digest('hex');
  const events=db.prepare('SELECT * FROM journey_evidence_monitor_events WHERE space_id=? AND evidence_link_sha256=?')
    .all(spaceId,linkSha) as any[];
  assert.equal(events.length,1);const serialized=JSON.stringify(events);
  assert.equal(serialized.includes(removed.responseId),false);assert.equal(serialized.includes(removed.link.sourceLabel),false);
});

test('monitor is tenant-bound and missing attaching authority does not invent deletion authority',()=>{
  const item=source('authority','2026-08-08T07:00:00.000Z');const at='2026-08-08T12:00:00.000Z';
  db.prepare('UPDATE journey_evidence_links SET created_by=NULL WHERE id=?').run(item.link.id);repository.seedMissing(at,100);
  const claim=claimOnly(item.link.id,at);const observed=repository.observe(claim,at);
  assert.deepEqual(observed,{status:'authority_missing',reason:'authority_missing',sourceFingerprint:null});
  repository.complete(claim,observed,at);
  assert.equal((db.prepare('SELECT invalidated_at FROM journey_evidence_links WHERE id=?').get(item.link.id) as any).invalidated_at,null);
});

test('snapshot CAS and lease fencing reject stale monitor completions',()=>{
  const item=source('fence','2026-08-08T07:00:00.000Z');const at='2026-08-08T13:00:00.000Z';
  repository.seedMissing(at,100);let first=claimOnly(item.link.id,at);const firstObservation=repository.observe(first,at);
  db.prepare("UPDATE journey_evidence_monitor_states SET lease_expires_at='2000-01-01T00:00:00.000Z' WHERE evidence_link_id=?")
    .run(item.link.id);
  const second=repository.claim({owner:'monitor-second',now:at});assert.ok(second);
  assert.throws(()=>repository.complete(first,firstObservation,at),/JOURNEY_EVIDENCE_MONITOR_LEASE_LOST/u);
  db.prepare('UPDATE journey_evidence_links SET source_label=?,updated_at=? WHERE id=?')
    .run('Reviewed source changed concurrently','2026-08-08T13:01:00.000Z',item.link.id);
  assert.throws(()=>repository.complete(second,repository.observe(second,at),at),/JOURNEY_EVIDENCE_MONITOR_LINK_CHANGED/u);
  assert.equal(repository.fail(second,new Error('link changed'),at),true);
  assert.equal((db.prepare('SELECT invalidated_at FROM journey_evidence_links WHERE id=?').get(item.link.id) as any).invalidated_at,null);
});

test('bounded worker isolates item failures and emits content-safe telemetry',()=>{
  let claims=0;const events:Array<Record<string,unknown>>=[];
  const fake:any={seedMissing:()=>2,claim:()=>claims++<2?{evidenceLinkId:`secret-${claims}`} :null,
    observe:(claim:any)=>{if(claim.evidenceLinkId==='secret-1')throw new Error('raw secret source');return{status:'current'};},
    complete:()=>({invalidationApplied:false}),fail:()=>true};
  const worker=new JourneyEvidenceMonitorWorker(60_000,2,fake,(level,event)=>events.push({level,...event}));
  worker.start();worker.stop();
  const pass=events.find((event)=>event.event==='journey_evidence_monitor_pass');
  assert.deepEqual({completed:pass?.completed,failed:pass?.failed},{completed:1,failed:1});
  assert.equal(JSON.stringify(events).includes('raw secret source'),false);
  assert.equal(JSON.stringify(events).includes('secret-1'),false);
});
