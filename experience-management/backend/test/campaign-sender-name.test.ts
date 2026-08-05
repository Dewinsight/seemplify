import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import request from 'supertest';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-campaign-sender-'));
const passwordFile = path.join(root, 'admin-password');
const sessionFile = path.join(root, 'session-secret');
const xKeyFile = path.join(root, 'x-key');
const esignKeyFile = path.join(root, 'esign-key');
fs.writeFileSync(passwordFile, 'Campaign-Sender-Admin-Password-2026!');
fs.writeFileSync(sessionFile, 'campaign-sender-session-secret-that-is-long-enough');
fs.writeFileSync(xKeyFile, Buffer.alloc(32, 81).toString('base64url'));
fs.writeFileSync(esignKeyFile, Buffer.alloc(32, 82).toString('base64url'));
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'campaign-sender.sqlite'),
  UPLOAD_DIR: path.join(root, 'uploads'),
  FRONTEND_DIST: path.join(root, 'missing-frontend'),
  PUBLIC_URL: 'http://127.0.0.1:5512',
  ADMIN_EMAIL: 'campaign-sender-admin@example.test',
  ADMIN_PASSWORD_FILE: passwordFile,
  SESSION_SECRET_FILE: sessionFile,
  EMAIL_MODE: 'log',
  MAIL_API_BASE_URL: 'http://127.0.0.1:5020',
  MAIL_FROM_EMAIL: 'verified-campaign-sender@example.test',
  MAIL_FROM_NAME: 'Configured Experience Team',
  X_CREDENTIAL_ENCRYPTION_KEY_FILE: xKeyFile,
  ESIGN_STORAGE_DIR: path.join(root, 'esign'),
  ESIGN_ENCRYPTION_KEY_FILE: esignKeyFile,
  X_SEED_CONSUMER_KEY_FILE: path.join(root, 'missing-x-key'),
  X_SEED_CONSUMER_SECRET_FILE: path.join(root, 'missing-x-secret'),
  X_SEED_BEARER_TOKEN_FILE: path.join(root, 'missing-x-bearer'),
  X_SEED_ACCESS_TOKEN_FILE: path.join(root, 'missing-x-token'),
  X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(root, 'missing-x-token-secret')
});

const { app } = await import('../src/app.js');
const { campaignRunner } = await import('../src/campaigns.js');
const { config } = await import('../src/config.js');
const { db } = await import('../src/database.js');

after(async () => {
  await campaignRunner.stop();
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test('uses a safe immutable campaign sender identity for tests and durable deliveries', async () => {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({
    email: 'campaign-sender-admin@example.test', password: 'Campaign-Sender-Admin-Password-2026!'
  }).expect(200);

  assert.ok(db.prepare("SELECT 1 FROM schema_migrations WHERE version=12 AND name='campaign_sender_display_name'").get());
  const survey = await agent.post('/api/surveys').send({
    title: 'Sender identity survey', purpose: 'customer_experience', primaryMetric: 'custom',
    questions: [{ id: 'sender-answer', page: 1, position: 0, type: 'short_text', title: 'Comment', required: false, options: [], settings: {}, logic: [] }]
  }).expect(201);
  await agent.post(`/api/surveys/${survey.body.id}/publish`).send({ status: 'live' }).expect(200);

  const defaulted = await agent.post('/api/campaigns').send({
    name: 'Default sender campaign', surveyId: survey.body.id
  }).expect(201);
  assert.equal(defaulted.body.campaign.senderName, 'Configured Experience Team');
  assert.equal(defaulted.body.campaign.senderEmail, 'verified-campaign-sender@example.test');

  const senderName = 'Équipe Research — Lagos (CX)!';
  const created = await agent.post('/api/campaigns').send({
    name: 'Custom sender campaign', surveyId: survey.body.id, senderName: `  ${senderName}  `
  }).expect(201);
  const campaignId = created.body.campaign.id;
  assert.equal(created.body.campaign.senderName, senderName);
  assert.equal(created.body.campaign.senderEmail, config.mailFromEmail);
  assert.equal((db.prepare('SELECT sender_name FROM campaigns WHERE id=?').get(campaignId) as any).sender_name, senderName);

  for (const invalid of ['Research\r\nBcc: victim@example.test', 'Research\tTeam', `Research\u2028Team`, 'x'.repeat(151)]) {
    await agent.put(`/api/campaigns/${campaignId}`).send({ senderName: invalid }).expect(400);
  }
  const reset = await agent.put(`/api/campaigns/${campaignId}`).send({ senderName: '   ' }).expect(200);
  assert.equal(reset.body.campaign.senderName, 'Configured Experience Team');
  await agent.put(`/api/campaigns/${campaignId}`).send({ senderName }).expect(200);

  await agent.put(`/api/campaigns/${campaignId}/steps`).send({
    steps: [{ delayMinutes: 0, subject: 'Sender identity test', mode: 'plain', bodyText: '{{survey_link}}' }]
  }).expect(200);
  await agent.post(`/api/campaigns/${campaignId}/contacts`).send({
    contacts: [{ email: 'campaign-recipient@example.test', firstName: 'Campaign', lastName: 'Recipient' }]
  }).expect(201);

  const originalMode = config.emailMode;
  const originalKey = config.mailApiToken;
  const originalFetch = globalThis.fetch;
  const providerRequests: any[] = [];
  let releaseDelivery!: (response: Response) => void;
  const heldDelivery = new Promise<Response>((resolve) => { releaseDelivery = resolve; });
  config.emailMode = 'send';
  config.mailApiToken = 'campaign-sender-key.test-secret';
  globalThis.fetch = async (_url, init) => {
    providerRequests.push(JSON.parse(String(init?.body || '{}')));
    if (providerRequests.length > 1) return heldDelivery;
    return new Response(JSON.stringify({ status: 'accepted', messageId: 'sender-test-message' }), {
      status: 202, headers: { 'content-type': 'application/json' }
    });
  };
  try {
    await agent.post(`/api/campaigns/${campaignId}/test`).send({ email: 'preview@example.test' }).expect(200);
    await agent.post(`/api/campaigns/${campaignId}/launch`).send({ startAt: new Date(Date.now() - 1000).toISOString() }).expect(200);
    await agent.put(`/api/campaigns/${campaignId}`).send({ senderName: 'A different sender' }).expect(400)
      .expect(({ body }) => assert.match(body.error, /cannot be changed after launch/i));
    const unchanged = await agent.put(`/api/campaigns/${campaignId}`).send({ senderName }).expect(200);
    assert.equal(unchanged.body.campaign.senderName, senderName);
    assert.equal(unchanged.body.campaign.senderEmail, 'verified-campaign-sender@example.test');
    releaseDelivery(new Response(JSON.stringify({ status: 'accepted', messageId: 'sender-delivery-message' }), {
      status: 202, headers: { 'content-type': 'application/json' }
    }));
    await campaignRunner.pump();
    assert.equal(providerRequests.length, 2);
    for (const payload of providerRequests) {
      assert.equal(payload.from, 'verified-campaign-sender@example.test');
      assert.equal(payload.fromName, senderName);
    }
  } finally {
    config.emailMode = originalMode;
    config.mailApiToken = originalKey;
    globalThis.fetch = originalFetch;
  }

});
