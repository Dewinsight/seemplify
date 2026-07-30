import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import Database from 'better-sqlite3';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-spaces-migration-'));
const databasePath = path.join(root, 'legacy.sqlite');
const environment = {
  ...process.env,
  DATABASE_PATH: databasePath,
  UPLOAD_DIR: path.join(root, 'uploads'),
  ESIGN_STORAGE_DIR: path.join(root, 'esign'),
  FRONTEND_DIST: path.join(root, 'frontend'),
  PUBLIC_URL: 'http://127.0.0.1:5496'
};
const databaseModule = pathToFileURL(path.resolve(import.meta.dirname, '../src/database.ts')).href;
const spacesModule = pathToFileURL(path.resolve(import.meta.dirname, '../src/spaces.ts')).href;

function runModule(moduleUrl: string) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval',
    `await import(${JSON.stringify(moduleUrl)}); const { db } = await import(${JSON.stringify(databaseModule)}); db.close();`], {
    env: environment,
    cwd: path.resolve(import.meta.dirname, '..'),
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

runModule(databaseModule);
const legacy = new Database(databasePath);
legacy.pragma('foreign_keys = ON');
fs.mkdirSync(environment.UPLOAD_DIR, { recursive: true });
fs.writeFileSync(path.join(environment.UPLOAD_DIR, 'legacy-evidence.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const first = '2026-07-01T09:00:00.000Z';
const second = '2026-07-20T09:00:00.000Z';
legacy.prepare(`INSERT INTO users (id,email,name,password_hash,role,session_version,created_at,updated_at)
  VALUES ('legacy-owner','owner@example.test','Original Owner','hash','owner',1,?,?)`).run(first, first);
legacy.prepare(`INSERT INTO users (id,email,name,password_hash,role,session_version,created_at,updated_at)
  VALUES ('later-user','later@example.test','Later User','hash','member',1,?,?)`).run(second, second);
legacy.prepare(`INSERT INTO surveys
  (id,title,description,purpose,audience,status,primary_metric,language,thank_you_message,theme_json,settings_json,created_at,updated_at)
  VALUES ('legacy-survey','Original research','','customer_experience','','draft','nps','English','Thank you','{}','{}',?,?)`).run(first, first);
legacy.prepare(`INSERT INTO collectors (id,survey_id,name,type,slug,status,settings_json,created_at)
  VALUES ('legacy-collector','legacy-survey','Email','email','legacy-email','open','{}',?)`).run(first);
legacy.prepare(`INSERT INTO responses
  (id,survey_id,collector_id,respondent_token,status,answers_json,metadata_json,started_at,completed_at)
  VALUES ('legacy-response','legacy-survey','legacy-collector','legacy-token','completed',?,'{}',?,?)`).run(
    JSON.stringify({ evidence: { name: 'research.png', mimeType: 'image/png', url: '/uploads/legacy-evidence.png' } }), first, first
  );
legacy.prepare(`INSERT INTO insights (id,survey_id,kind,payload_json,created_at)
  VALUES ('owner-insight','legacy-survey','ai_insights','{}',?)`).run(first);
legacy.prepare(`INSERT INTO surveys
  (id,title,description,purpose,audience,status,primary_metric,language,thank_you_message,theme_json,settings_json,created_at,updated_at)
  VALUES ('generated-survey','Generated research','','customer_experience','','draft','nps','English','Thank you','{}','{}',?,?)`).run(second, second);
legacy.prepare(`INSERT INTO collectors (id,survey_id,name,type,slug,status,settings_json,created_at)
  VALUES ('generated-collector','generated-survey','Generated web','web','generated-web','open','{}',?)`).run(second);
legacy.prepare(`INSERT INTO responses
  (id,survey_id,collector_id,respondent_token,status,answers_json,metadata_json,started_at,completed_at)
  VALUES ('generated-response','generated-survey','generated-collector','generated-token','completed',?,'{}',?,?)`).run(
    JSON.stringify({ evidence: { name: 'shared-research.png', mimeType: 'image/png', url: '/uploads/legacy-evidence.png' } }), second, second
  );
legacy.prepare(`INSERT INTO ai_jobs
  (id,kind,survey_id,requested_by,state,stage,progress,attempt,input_json,created_at,updated_at)
  VALUES ('survey-job','survey.improve','legacy-survey','later-user','queued','queued',0,0,'{}',?,?)`).run(second, second);
legacy.prepare(`INSERT INTO ai_jobs
  (id,kind,requested_by,state,stage,progress,attempt,input_json,result_json,created_at,completed_at,updated_at)
  VALUES ('generated-survey-job','survey.generate','later-user','completed','completed',100,1,'{}',?, ?,?,?)`).run(
    JSON.stringify({ output: { survey: { id: 'generated-survey' } }, runtime: {} }), second, second, second
  );
legacy.prepare(`INSERT INTO ai_jobs
  (id,kind,requested_by,state,stage,progress,attempt,input_json,created_at,updated_at)
  VALUES ('private-job','social.analyze','later-user','queued','queued',0,0,'{}',?,?)`).run(second, second);
legacy.prepare(`INSERT INTO journeys
  (id,name,audience,objective,industry,stages_json,summary,provenance_json,created_at,updated_at)
  VALUES ('legacy-journey','Original journey','','','','[]','','{}',?,?)`).run(first, first);
legacy.prepare(`INSERT INTO journeys
  (id,name,audience,objective,industry,stages_json,summary,provenance_json,created_at,updated_at)
  VALUES ('generated-journey','Generated journey','','','','[]','','{}',?,?)`).run(second, second);
legacy.prepare(`INSERT INTO ai_jobs
  (id,kind,requested_by,state,stage,progress,attempt,input_json,result_json,created_at,completed_at,updated_at)
  VALUES ('generated-journey-job','journey.generate','later-user','completed','completed',100,1,'{}',?, ?,?,?)`).run(
    JSON.stringify({ output: { journey: { id: 'generated-journey' } }, runtime: {} }), second, second, second
  );
legacy.prepare(`INSERT INTO ai_jobs
  (id,kind,requested_by,state,stage,progress,attempt,input_json,result_json,created_at,completed_at,updated_at)
  VALUES ('optimized-journey-job','journey.optimize','later-user','completed','completed',100,1,?, ?, ?,?,?)`).run(
    JSON.stringify({ journeyId: 'legacy-journey' }),
    JSON.stringify({ output: { journey: { id: 'legacy-journey' } }, runtime: {} }), second, second, second
  );
legacy.prepare(`INSERT INTO journey_ai_applications (job_id,journey_id,kind,result_json,created_at)
  VALUES ('generated-journey-job','generated-journey','journey.generate',?,?)`).run(
    JSON.stringify({ output: { journey: { id: 'generated-journey' } }, runtime: {} }), second
  );
legacy.prepare(`INSERT INTO journey_ai_applications (job_id,journey_id,kind,result_json,created_at)
  VALUES ('optimized-journey-job','legacy-journey','journey.optimize',?,?)`).run(
    JSON.stringify({ output: { journey: { id: 'legacy-journey' } }, runtime: {} }), second
  );
legacy.prepare(`INSERT INTO campaigns
  (id,survey_id,collector_id,name,status,stop_on_response,created_at,updated_at)
  VALUES ('legacy-campaign','legacy-survey','legacy-collector','Original campaign','draft',1,?,?)`).run(first, first);
legacy.prepare(`INSERT INTO x_apps (id,credential_version,configured_by,created_at,updated_at)
  VALUES ('workspace-x-app',1,'later-user',?,?)`).run(second, second);
legacy.prepare(`INSERT INTO x_connections
  (id,user_id,app_id,access_token_enc,auth_type,x_user_id,username,status,created_at,updated_at)
  VALUES ('later-x','later-user','workspace-x-app','encrypted','oauth2','90001','later_x','connected',?,?)`).run(second, second);
legacy.prepare(`INSERT INTO x_connections
  (id,user_id,app_id,access_token_enc,auth_type,x_user_id,username,status,created_at,updated_at)
  VALUES ('owner-x','legacy-owner','workspace-x-app','encrypted','oauth2','90002','owner_x','connected',?,?)`).run(first, first);
legacy.prepare(`INSERT INTO social_mentions
  (id,source,external_id,x_connection_id,ingestion_kind,author,content,url,language,published_at,metadata_json,created_at)
  VALUES ('later-mention','x','post-90001','later-x','mention','@person','A later account post','','en',?,'{}',?)`).run(second, second);
legacy.prepare(`INSERT INTO x_connection_mentions
  (connection_id,mention_id,streams_json,query_ids_json,discovered_at,last_seen_at)
  VALUES ('later-x','later-mention','["mention"]','[]',?,?)`).run(second, second);
legacy.prepare(`INSERT INTO x_connection_mentions
  (connection_id,mention_id,streams_json,query_ids_json,discovered_at,last_seen_at)
  VALUES ('owner-x','later-mention','["search"]','["owner-query"]',?,?)`).run(second, second);
legacy.prepare(`INSERT INTO ai_jobs
  (id,kind,requested_by,state,stage,progress,attempt,input_json,created_at,updated_at)
  VALUES ('owner-social-job','social.analyze','legacy-owner','queued','queued',0,0,?, ?,?)`).run(
    JSON.stringify({ mentionIds: ['later-mention'] }), second, second
  );
legacy.prepare(`INSERT INTO social_reply_drafts
  (id,mention_id,connection_id,requested_by,tone,instructions,source_snapshot_json,state,created_at,updated_at)
  VALUES ('owner-draft','later-mention','owner-x','legacy-owner','helpful','','{}','queued',?,?)`).run(second, second);
legacy.prepare(`INSERT INTO social_intelligence_reports
  (id,user_id,connection_id,title,mention_ids_json,source_snapshot_json,state,created_at,updated_at)
  VALUES ('owner-social-report','legacy-owner','owner-x','Owner X report',?,'[]','queued',?,?)`).run(
    JSON.stringify(['later-mention']), second, second
  );
legacy.prepare(`INSERT INTO social_intelligence_reports
  (id,user_id,connection_id,title,mention_ids_json,source_snapshot_json,state,result_json,created_at,completed_at,updated_at)
  VALUES ('later-social-report','later-user','later-x','Later X report',?,'[]','completed','{}',?,?,?)`).run(
    JSON.stringify(['later-mention']), second, second, second
  );
legacy.prepare(`INSERT INTO intelligence_reports
  (id,user_id,title,objective,source_refs_json,source_snapshot_json,state,created_at,updated_at)
  VALUES ('later-report','later-user','Later report','','{}','[]','completed',?,?)`).run(second, second);
legacy.prepare(`INSERT INTO intelligence_reports
  (id,user_id,title,objective,source_refs_json,source_snapshot_json,state,created_at,updated_at)
  VALUES ('source-owned-report','later-user','Owner evidence','',?,'[]','completed',?,?)`).run(
    JSON.stringify({ survey: ['survey-insight:owner-insight'], social: [] }), second, second
  );
legacy.prepare(`INSERT INTO intelligence_reports
  (id,user_id,title,objective,source_refs_json,source_snapshot_json,state,created_at,updated_at)
  VALUES ('mixed-report','later-user','Mixed evidence','',?,'[]','completed',?,?)`).run(
    JSON.stringify({ survey: ['survey-insight:owner-insight'], social: ['social-report:later-social-report'] }), second, second
  );
legacy.prepare(`INSERT INTO esign_envelopes
  (id,created_by_user_id,title,subject,message,status,routing_mode,revision,created_at,updated_at)
  VALUES ('later-envelope','later-user','Later agreement','','','draft','sequential',1,?,?)`).run(second, second);
legacy.prepare(`INSERT INTO email_suppressions (email,reason,source,created_at,updated_at)
  VALUES ('optout@example.test','Legacy opt-out','legacy',?,?)`).run(first, first);
legacy.close();

runModule(spacesModule);

after(() => fs.rmSync(root, { recursive: true, force: true }));

test('assigns legacy global content once, preserves attributable records, and is restart-idempotent', () => {
  const migrated = new Database(databasePath);
  const ownerSpace = (migrated.prepare(`SELECT id FROM spaces WHERE personal_for_user_id='legacy-owner'`).get() as any).id;
  const laterSpace = (migrated.prepare(`SELECT id FROM spaces WHERE personal_for_user_id='later-user'`).get() as any).id;
  assert.notEqual(ownerSpace, laterSpace);
  assert.equal((migrated.prepare(`SELECT space_id FROM surveys WHERE id='legacy-survey'`).get() as any).space_id, ownerSpace);
  assert.equal((migrated.prepare(`SELECT space_id FROM surveys WHERE id='generated-survey'`).get() as any).space_id, laterSpace);
  assert.equal((migrated.prepare(`SELECT space_id FROM journeys WHERE id='legacy-journey'`).get() as any).space_id, ownerSpace);
  assert.equal((migrated.prepare(`SELECT space_id FROM journeys WHERE id='generated-journey'`).get() as any).space_id, laterSpace);
  assert.equal((migrated.prepare(`SELECT space_id FROM campaigns WHERE id='legacy-campaign'`).get() as any).space_id, ownerSpace);
  assert.equal((migrated.prepare(`SELECT space_id FROM ai_jobs WHERE id='survey-job'`).get() as any).space_id, ownerSpace);
  assert.equal((migrated.prepare(`SELECT space_id FROM ai_jobs WHERE id='private-job'`).get() as any).space_id, laterSpace);
  assert.equal((migrated.prepare(`SELECT space_id FROM ai_jobs WHERE id='generated-survey-job'`).get() as any).space_id, laterSpace);
  assert.equal((migrated.prepare(`SELECT space_id FROM ai_jobs WHERE id='generated-journey-job'`).get() as any).space_id, laterSpace);
  assert.equal((migrated.prepare(`SELECT space_id FROM ai_jobs WHERE id='optimized-journey-job'`).get() as any).space_id, ownerSpace);
  assert.equal((migrated.prepare(`SELECT space_id FROM x_connections WHERE id='later-x'`).get() as any).space_id, laterSpace);
  assert.equal((migrated.prepare(`SELECT space_id FROM social_mentions WHERE id='later-mention'`).get() as any).space_id, laterSpace);
  assert.equal((migrated.prepare(`SELECT space_id FROM intelligence_reports WHERE id='later-report'`).get() as any).space_id, laterSpace);
  assert.equal((migrated.prepare(`SELECT space_id FROM intelligence_reports WHERE id='source-owned-report'`).get() as any).space_id, ownerSpace);
  const mixedSpace = (migrated.prepare(`SELECT space_id FROM intelligence_reports WHERE id='mixed-report'`).get() as any).space_id;
  assert.notEqual(mixedSpace, ownerSpace);
  assert.notEqual(mixedSpace, laterSpace);
  assert.equal((migrated.prepare('SELECT COUNT(*) count FROM space_memberships WHERE space_id=?').get(mixedSpace) as any).count, 0);
  assert.match((migrated.prepare(`SELECT reason FROM space_migration_quarantine
    WHERE artifact_type='intelligence_report' AND artifact_id='mixed-report'`).get() as any).reason, /multiple spaces/);
  assert.equal((migrated.prepare(`SELECT space_id FROM esign_envelopes WHERE id='later-envelope'`).get() as any).space_id, laterSpace);
  assert.equal((migrated.prepare(`SELECT space_id FROM email_suppressions WHERE email='optout@example.test'`).get() as any).space_id, ownerSpace);
  const xCopies = migrated.prepare(`SELECT id,space_id FROM social_mentions
    WHERE source='x' AND external_id='post-90001' ORDER BY space_id`).all() as Array<{ id: string; space_id: string }>;
  assert.equal(xCopies.length, 2);
  const ownerMention = xCopies.find((row) => row.space_id === ownerSpace);
  assert.ok(ownerMention);
  assert.equal((migrated.prepare(`SELECT m.space_id FROM x_connection_mentions cm
    JOIN social_mentions m ON m.id=cm.mention_id WHERE cm.connection_id='owner-x'`).get() as any).space_id, ownerSpace);
  assert.equal((migrated.prepare(`SELECT mention_id FROM social_reply_drafts WHERE id='owner-draft'`).get() as any).mention_id, ownerMention.id);
  assert.deepEqual(JSON.parse((migrated.prepare(`SELECT mention_ids_json FROM social_intelligence_reports
    WHERE id='owner-social-report'`).get() as any).mention_ids_json), [ownerMention.id]);
  const ownerSocialJob = migrated.prepare(`SELECT space_id,input_json FROM ai_jobs WHERE id='owner-social-job'`).get() as any;
  assert.equal(ownerSocialJob.space_id, ownerSpace);
  assert.deepEqual(JSON.parse(ownerSocialJob.input_json).mentionIds, [ownerMention.id]);

  const migratedAnswers = JSON.parse((migrated.prepare(`SELECT answers_json FROM responses WHERE id='legacy-response'`).get() as any).answers_json);
  assert.match(migratedAnswers.evidence.url, /^http:\/\/127\.0\.0\.1:5496\/api\/public\/uploads\/[^/]+\/[^/]+$/);
  const migratedUpload = migrated.prepare(`SELECT * FROM uploads WHERE id=?`).get(migratedAnswers.evidence.id) as any;
  assert.equal(migratedUpload.space_id, ownerSpace);
  assert.equal(migratedUpload.collector_id, 'legacy-collector');
  assert.match(migratedUpload.stored_filename, /^space-migrated-[0-9a-f-]+\.png$/);
  assert.equal(fs.existsSync(path.join(environment.UPLOAD_DIR, migratedUpload.stored_filename)), true);
  const capabilityToken = new URL(migratedAnswers.evidence.url).pathname.split('/').at(-1) || '';
  assert.equal(migratedUpload.access_token_hash, crypto.createHash('sha256').update(capabilityToken).digest('hex'));
  const generatedAnswers = JSON.parse((migrated.prepare(`SELECT answers_json FROM responses WHERE id='generated-response'`).get() as any).answers_json);
  const generatedUpload = migrated.prepare(`SELECT * FROM uploads WHERE id=?`).get(generatedAnswers.evidence.id) as any;
  assert.equal(generatedUpload.space_id, laterSpace);
  assert.equal(generatedUpload.collector_id, 'generated-collector');
  assert.notEqual(generatedUpload.stored_filename, migratedUpload.stored_filename);
  assert.equal(fs.existsSync(path.join(environment.UPLOAD_DIR, generatedUpload.stored_filename)), true);

  for (const table of ['surveys', 'ai_jobs', 'social_mentions', 'x_connections', 'journeys', 'campaigns', 'esign_envelopes']) {
    assert.equal((migrated.prepare(`SELECT COUNT(*) count FROM ${table} WHERE space_id IS NULL`).get() as any).count, 0, table);
  }
  assert.deepEqual(migrated.prepare('PRAGMA foreign_key_check').all(), []);
  assert.match(String((migrated.prepare(`SELECT sql FROM sqlite_master WHERE type='index' AND name='social_mentions_space_x_external'`).get() as any).sql), /space_id/);
  const suppressionPk = (migrated.prepare('PRAGMA table_info(email_suppressions)').all() as any[])
    .filter((column) => column.pk).sort((left, right) => left.pk - right.pk).map((column) => column.name);
  assert.deepEqual(suppressionPk, ['space_id', 'email']);
  assert.throws(() => migrated.prepare(`INSERT INTO surveys
    (id,title,description,purpose,audience,status,primary_metric,language,thank_you_message,theme_json,settings_json,created_at,updated_at)
    VALUES ('missing-space','Blocked','','customer_experience','','draft','nps','English','Thanks','{}','{}',?,?)`).run(first, first), /space_id is required/);

  const beforeRestart = JSON.stringify({
    spaces: migrated.prepare('SELECT id,name,personal_for_user_id FROM spaces ORDER BY id').all(),
    memberships: migrated.prepare('SELECT space_id,user_id,role FROM space_memberships ORDER BY space_id,user_id').all(),
    surveys: migrated.prepare('SELECT id,space_id,title FROM surveys ORDER BY id').all(),
    jobs: migrated.prepare('SELECT id,space_id,kind,state FROM ai_jobs ORDER BY id').all(),
    responses: migrated.prepare('SELECT id,answers_json FROM responses ORDER BY id').all(),
    uploads: migrated.prepare('SELECT id,space_id,collector_id,stored_filename,access_token_hash FROM uploads ORDER BY id').all(),
    mentions: migrated.prepare('SELECT id,space_id,source,external_id FROM social_mentions ORDER BY id').all(),
    artifacts: {
      journeys: migrated.prepare('SELECT id,space_id FROM journeys ORDER BY id').all(),
      campaigns: migrated.prepare('SELECT id,space_id FROM campaigns ORDER BY id').all(),
      x: migrated.prepare('SELECT id,space_id FROM x_connections ORDER BY id').all(),
      esign: migrated.prepare('SELECT id,space_id FROM esign_envelopes ORDER BY id').all()
    }
  });
  migrated.close();

  runModule(spacesModule);
  const restarted = new Database(databasePath);
  const afterRestart = JSON.stringify({
    spaces: restarted.prepare('SELECT id,name,personal_for_user_id FROM spaces ORDER BY id').all(),
    memberships: restarted.prepare('SELECT space_id,user_id,role FROM space_memberships ORDER BY space_id,user_id').all(),
    surveys: restarted.prepare('SELECT id,space_id,title FROM surveys ORDER BY id').all(),
    jobs: restarted.prepare('SELECT id,space_id,kind,state FROM ai_jobs ORDER BY id').all(),
    responses: restarted.prepare('SELECT id,answers_json FROM responses ORDER BY id').all(),
    uploads: restarted.prepare('SELECT id,space_id,collector_id,stored_filename,access_token_hash FROM uploads ORDER BY id').all(),
    mentions: restarted.prepare('SELECT id,space_id,source,external_id FROM social_mentions ORDER BY id').all(),
    artifacts: {
      journeys: restarted.prepare('SELECT id,space_id FROM journeys ORDER BY id').all(),
      campaigns: restarted.prepare('SELECT id,space_id FROM campaigns ORDER BY id').all(),
      x: restarted.prepare('SELECT id,space_id FROM x_connections ORDER BY id').all(),
      esign: restarted.prepare('SELECT id,space_id FROM esign_envelopes ORDER BY id').all()
    }
  });
  assert.equal(afterRestart, beforeRestart);
  assert.equal((restarted.prepare('SELECT COUNT(*) count FROM spaces').get() as any).count, 3);
  assert.deepEqual(restarted.prepare('PRAGMA foreign_key_check').all(), []);
  restarted.close();
});
