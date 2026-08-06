import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-tenant-fairness-'));
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'fairness.sqlite'),
  UPLOAD_DIR: path.join(root, 'uploads'),
  ESIGN_STORAGE_DIR: path.join(root, 'esign'),
  FRONTEND_DIST: path.join(root, 'frontend'),
  PUBLIC_URL: 'http://127.0.0.1:5495',
  EMAIL_MODE: 'log'
});

const { db, updateJob } = await import('../src/database.js');
const { claimNextAiJobFixture, createAiJobFixture } = await import('./aiJobFixtures.js');
const createdAt = '2026-07-01T09:00:00.000Z';
db.prepare(`INSERT INTO users (id,email,name,password_hash,role,session_version,created_at,updated_at)
  VALUES ('fair-a','fair-a@example.test','Fair A','hash','owner',1,?,?),
         ('fair-b','fair-b@example.test','Fair B','hash','member',1,?,?)`).run(createdAt, createdAt, createdAt, createdAt);
await import('../src/spaces.js');
const { claimNextDelivery } = await import('../src/campaigns.js');
const spaceA = (db.prepare(`SELECT id FROM spaces WHERE personal_for_user_id='fair-a'`).get() as any).id;
const spaceB = (db.prepare(`SELECT id FROM spaces WHERE personal_for_user_id='fair-b'`).get() as any).id;

after(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test('AI dispatch gives another waiting space a slot before taking the first space backlog', () => {
  const firstA = createAiJobFixture('social.analyze', {}, spaceA, null, null, 'fair-a');
  const secondA = createAiJobFixture('social.analyze', {}, spaceA, null, null, 'fair-a');
  const firstB = createAiJobFixture('social.analyze', {}, spaceB, null, null, 'fair-b');

  assert.equal(claimNextAiJobFixture()?.id, firstA.id);
  assert.equal(claimNextAiJobFixture()?.id, firstB.id);
  updateJob(firstA.id, { state: 'completed', stage: 'completed', progress: 100, completedAt: new Date().toISOString() });
  updateJob(firstB.id, { state: 'completed', stage: 'completed', progress: 100, completedAt: new Date().toISOString() });
  assert.equal(claimNextAiJobFixture()?.id, secondA.id);
});

function insertCampaignFixture(prefix: string, spaceId: string, deliveryTimes: string[]) {
  const surveyId = `${prefix}-survey`;
  const collectorId = `${prefix}-collector`;
  const campaignId = `${prefix}-campaign`;
  const stepId = `${prefix}-step`;
  db.prepare(`INSERT INTO surveys
    (id,space_id,title,description,purpose,audience,status,primary_metric,language,thank_you_message,theme_json,settings_json,created_at,updated_at)
    VALUES (?,?,?,'','customer_experience','','live','nps','English','Thank you','{}','{}',?,?)`)
    .run(surveyId, spaceId, `${prefix} survey`, createdAt, createdAt);
  db.prepare(`INSERT INTO collectors (id,survey_id,name,type,slug,status,settings_json,created_at)
    VALUES (?,?,?,'email',?,'open','{}',?)`).run(collectorId, surveyId, `${prefix} collector`, `${prefix}-collector`, createdAt);
  db.prepare(`INSERT INTO campaigns (id,space_id,survey_id,collector_id,name,status,stop_on_response,created_at,updated_at)
    VALUES (?,?,?,?,?,'active',1,?,?)`).run(campaignId, spaceId, surveyId, collectorId, `${prefix} campaign`, createdAt, createdAt);
  db.prepare(`INSERT INTO campaign_steps
    (id,campaign_id,position,delay_minutes,subject,content_mode,body_text,body_html,created_at,updated_at)
    VALUES (?,?,0,0,'Hello','plain','Body','',?,?)`).run(stepId, campaignId, createdAt, createdAt);
  for (let index = 0; index < deliveryTimes.length; index += 1) {
    const contactId = `${prefix}-contact-${index}`;
    db.prepare(`INSERT INTO campaign_contacts
      (id,campaign_id,email,token,status,custom_json,current_step,created_at,updated_at)
      VALUES (?,?,?,?,'active','{}',-1,?,?)`).run(
        contactId, campaignId, `${prefix}-${index}@example.test`, `${prefix}-token-${index}`, createdAt, createdAt
      );
    db.prepare(`INSERT INTO campaign_deliveries
      (id,campaign_id,step_id,contact_id,step_position,state,scheduled_at,attempt,max_attempts,created_at,updated_at)
      VALUES (?,?,?,?,0,'queued',?,0,5,?,?)`).run(
        `${prefix}-delivery-${index}`, campaignId, stepId, contactId, deliveryTimes[index], deliveryTimes[index], deliveryTimes[index]
      );
  }
}

test('campaign dispatch rotates between spaces even when one space has the older backlog', () => {
  insertCampaignFixture('campaign-a', spaceA, [
    '2026-07-01T10:00:00.000Z',
    '2026-07-01T10:01:00.000Z'
  ]);
  insertCampaignFixture('campaign-b', spaceB, ['2026-07-01T10:02:00.000Z']);
  assert.equal(claimNextDelivery()?.id, 'campaign-a-delivery-0');
  assert.equal(claimNextDelivery()?.id, 'campaign-b-delivery-0');
  assert.equal(claimNextDelivery()?.id, 'campaign-a-delivery-1');
});
