import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import request, { type SuperAgentTest } from 'supertest';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-esign-security-'));
const passwordFile = path.join(root, 'admin-password');
const sessionFile = path.join(root, 'session-secret');
const esignKeyFile = path.join(root, 'esign-key');
const xKeyFile = path.join(root, 'x-key');
fs.writeFileSync(passwordFile, 'Security-Test-Admin-Password-2026!');
fs.writeFileSync(sessionFile, 'security-test-session-secret-that-is-long-and-random');
fs.writeFileSync(esignKeyFile, Buffer.alloc(32, 31).toString('base64url'));
fs.writeFileSync(xKeyFile, Buffer.alloc(32, 32).toString('base64url'));

Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'security.sqlite'),
  UPLOAD_DIR: path.join(root, 'uploads'),
  FRONTEND_DIST: path.join(root, 'missing-frontend'),
  PUBLIC_URL: 'http://127.0.0.1:5413',
  ADMIN_EMAIL: 'security-qa@seemplify.local',
  ADMIN_PASSWORD_FILE: passwordFile,
  SESSION_SECRET_FILE: sessionFile,
  EMAIL_MODE: 'log',
  ESIGN_STORAGE_DIR: path.join(root, 'esign'),
  ESIGN_ENCRYPTION_KEY_FILE: esignKeyFile,
  ESIGN_WORKER_POLL_MS: '250',
  X_CREDENTIAL_ENCRYPTION_KEY_FILE: xKeyFile,
  X_SEED_CONSUMER_KEY_FILE: path.join(root, 'missing-x-key'),
  X_SEED_CONSUMER_SECRET_FILE: path.join(root, 'missing-x-secret'),
  X_SEED_BEARER_TOKEN_FILE: path.join(root, 'missing-x-bearer'),
  X_SEED_ACCESS_TOKEN_FILE: path.join(root, 'missing-x-token'),
  X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(root, 'missing-x-token-secret')
});

const { app } = await import('../src/app.js');
const { db } = await import('../src/database.js');
const { esignWorker } = await import('../src/esign.js');
esignWorker.start();

after(async () => {
  await esignWorker.stop();
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

let identity = 0;

async function samplePdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < 2; index += 1) {
    const page = pdf.addPage([612, 792]);
    page.drawText(`Security fixture page ${index + 1}`, { x: 48, y: 730, size: 16, font });
  }
  return Buffer.from(await pdf.save());
}

async function signup(label: string) {
  identity += 1;
  const agent = request.agent(app);
  const email = `${label}-${identity}@example.com`;
  await agent.post('/api/auth/signup').send({ name: `${label} user`, email, password: 'Security-Account-2026!' }).expect(201);
  return { agent, email };
}

type RecipientSpec = {
  name: string;
  email: string;
  role?: 'signer' | 'approver' | 'cc' | 'viewer';
  routingOrder?: number;
  accessCode?: string;
};

async function prepareEnvelope(owner: SuperAgentTest, label: string, recipients: RecipientSpec[], extraFields = false) {
  const created = await owner.post('/api/esign/envelopes').send({
    title: `${label} ${crypto.randomUUID().slice(0, 8)}`,
    subject: `${label} signature request`,
    message: 'Review this synthetic security fixture.',
    routingMode: 'sequential',
    expiresInDays: 1,
    reminderIntervalHours: 24
  }).expect(201);
  const envelopeId = created.body.envelope.id as string;
  const uploaded = await owner.post(`/api/esign/envelopes/${envelopeId}/documents`)
    .attach('file', await samplePdf(), { filename: 'security-fixture.pdf', contentType: 'application/pdf' })
    .expect(201);
  const document = uploaded.body.documents[0];
  const savedRecipients = (await owner.put(`/api/esign/envelopes/${envelopeId}/recipients`).send({
    recipients: recipients.map((item, index) => ({
      ...item,
      role: item.role || 'signer',
      routingOrder: item.routingOrder || index + 1
    }))
  }).expect(200)).body.recipients;
  const actionRecipients = savedRecipients.filter((item: any) => ['signer', 'approver'].includes(item.role));
  const fields: any[] = actionRecipients.map((recipient: any, index: number) => ({
    id: crypto.randomUUID(), documentId: document.id, recipientId: recipient.id,
    type: 'signature', page: index % 2 + 1, x: 0.08, y: 0.65 + index * 0.08,
    width: 0.3, height: 0.07, required: true, label: `${recipient.name} signature`
  }));
  if (extraFields && actionRecipients[0]) {
    fields.push({
      id: crypto.randomUUID(), documentId: document.id, recipientId: actionRecipients[0].id,
      type: 'text', page: 1, x: 0.08, y: 0.5, width: 0.35, height: 0.05,
      required: true, label: 'Security phrase'
    });
    fields.push({
      id: crypto.randomUUID(), documentId: document.id, recipientId: actionRecipients[0].id,
      type: 'checkbox', page: 1, x: 0.08, y: 0.58, width: 0.04, height: 0.04,
      required: true, label: 'Acknowledgement'
    });
  }
  await owner.put(`/api/esign/envelopes/${envelopeId}/fields`).send({ fields }).expect(200);
  return { envelopeId, document, recipients: savedRecipients, fields };
}

async function waitFor<T>(read: () => Promise<T>, accepted: (value: T) => boolean, label: string) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const value = await read();
    if (accepted(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function invitation(owner: SuperAgentTest, envelopeId: string, recipientId: string) {
  const items: any[] = await waitFor(
    async () => (await owner.get(`/api/esign/outbox?envelopeId=${envelopeId}`).expect(200)).body,
    (rows: any[]) => rows.some((row) => row.recipientId === recipientId && row.kind === 'invitation' && row.signerUrl),
    'signing invitation'
  );
  const item = items.find((row) => row.recipientId === recipientId && row.kind === 'invitation' && row.signerUrl);
  return { item, token: new URL(item.signerUrl).searchParams.get('token') as string, items };
}

async function openSigningSession(token: string) {
  const agent = request.agent(app);
  const response = await agent.post('/api/public/esign/session').send({ token }).expect(201);
  return { agent, response };
}

test('normalizes access codes, locks repeated guesses, protects cookies, and isolates owners', async () => {
  const owner = await signup('pin-owner');
  const outsider = await signup('pin-outsider');
  const fixture = await prepareEnvelope(owner.agent, 'PIN protected', [{
    name: 'Protected Signer', email: `protected-${identity}@example.com`, accessCode: ' 2468 '
  }]);
  await owner.agent.post(`/api/esign/envelopes/${fixture.envelopeId}/send`).send({}).expect(200);
  const invite = await invitation(owner.agent, fixture.envelopeId, fixture.recipients[0].id);

  assert.doesNotMatch(JSON.stringify(invite.items), /2468/);
  const storedRecipient = db.prepare('SELECT access_token_hash,access_token_enc,access_code_hash FROM esign_recipients WHERE id=?').get(fixture.recipients[0].id) as any;
  assert.notEqual(storedRecipient.access_token_hash, invite.token);
  assert.doesNotMatch(storedRecipient.access_token_enc, new RegExp(invite.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(storedRecipient.access_code_hash, /2468/);

  const signing = await openSigningSession(invite.token);
  const cookie = ([] as string[]).concat(signing.response.headers['set-cookie'] || []).join(';');
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
  assert.match(cookie, /Path=\/api\/public\/esign/i);
  assert.equal(Object.hasOwn(signing.response.body, 'sessionToken'), false);
  assert.match(signing.response.body.disclosure.sha256, /^[a-f0-9]{64}$/);

  await signing.agent.get(`/api/public/esign/documents/${fixture.document.id}/content`).expect(401);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await signing.agent.post('/api/public/esign/access-code').send({ code: `wrong-${attempt}` }).expect(401);
  }
  await signing.agent.post('/api/public/esign/access-code').send({ code: 'wrong-final' }).expect(429);
  await signing.agent.post('/api/public/esign/access-code').send({ code: '2468' }).expect(429);
  const locked = db.prepare('SELECT code_failed_attempts,code_locked_until FROM esign_recipients WHERE id=?').get(fixture.recipients[0].id) as any;
  assert.ok(Date.parse(locked.code_locked_until) > Date.now());
  db.prepare('UPDATE esign_recipients SET code_locked_until=? WHERE id=?').run(new Date(Date.now() - 1000).toISOString(), fixture.recipients[0].id);
  await signing.agent.post('/api/public/esign/access-code').send({ code: '2468' }).expect(200);
  await signing.agent.get(`/api/public/esign/documents/${fixture.document.id}/content`).expect(409);
  await signing.agent.post('/api/public/esign/consent').send({ agreed: true }).expect(200);
  await signing.agent.get(`/api/public/esign/documents/${fixture.document.id}/content`).expect(200);
  await signing.agent.put(`/api/public/esign/fields/${crypto.randomUUID()}`).send({ value: 'cross-field attempt' }).expect(404);

  await outsider.agent.get(`/api/esign/envelopes/${fixture.envelopeId}`).expect(404);
  await outsider.agent.get(`/api/esign/envelopes/${fixture.envelopeId}/documents/${fixture.document.id}/content`).expect(404);
  const outsiderOutbox = await outsider.agent.get(`/api/esign/outbox?envelopeId=${fixture.envelopeId}`).expect(200);
  assert.deepEqual(outsiderOutbox.body, []);
  await request(app).get(`/api/public/esign/documents/${fixture.document.id}/content`).expect(401);

  await signing.agent.post('/api/public/esign/logout').expect(204);
  await signing.agent.get('/api/public/esign/session').expect(401);
});

test('resets draft-relative expiry at send and makes concurrent sends idempotent', async () => {
  const owner = await signup('send-owner');
  const fixture = await prepareEnvelope(owner.agent, 'Concurrent send', [{ name: 'One Signer', email: `send-${identity}@example.com` }]);
  db.prepare('UPDATE esign_envelopes SET expires_at=? WHERE id=?').run(new Date(Date.now() - 60_000).toISOString(), fixture.envelopeId);
  const beforeSend = Date.now();
  const responses = await Promise.all([
    owner.agent.post(`/api/esign/envelopes/${fixture.envelopeId}/send`).send({}),
    owner.agent.post(`/api/esign/envelopes/${fixture.envelopeId}/send`).send({})
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort((a, b) => a - b), [200, 409]);
  const accepted = responses.find((response) => response.status === 200)!;
  assert.ok(Date.parse(accepted.body.envelope.expiresAt) >= beforeSend + 23 * 60 * 60 * 1000);
  const invitations = db.prepare("SELECT COUNT(*) count FROM esign_email_deliveries WHERE envelope_id=? AND kind='invitation'").get(fixture.envelopeId) as any;
  assert.equal(Number(invitations.count), 1);
  const sentAudits = db.prepare("SELECT COUNT(*) count FROM esign_audit_events WHERE envelope_id=? AND event_type='envelope.sent'").get(fixture.envelopeId) as any;
  assert.equal(Number(sentAudits.count), 1);
});

test('completes once across replayed sessions, encrypts supplied values, and detects evidence tampering', async () => {
  const owner = await signup('completion-owner');
  const outsider = await signup('completion-outsider');
  const fixture = await prepareEnvelope(owner.agent, 'Concurrent completion', [{ name: 'Concurrent Signer', email: `complete-${identity}@example.com` }], true);
  await owner.agent.post(`/api/esign/envelopes/${fixture.envelopeId}/send`).send({}).expect(200);
  const invite = await invitation(owner.agent, fixture.envelopeId, fixture.recipients[0].id);
  const first = await openSigningSession(invite.token);
  const second = await openSigningSession(invite.token);
  await first.agent.post('/api/public/esign/consent').send({ agreed: true }).expect(200);
  await second.agent.post('/api/public/esign/consent').send({ agreed: true }).expect(200);

  const signatureField = fixture.fields.find((field) => field.type === 'signature');
  const textField = fixture.fields.find((field) => field.type === 'text');
  const checkboxField = fixture.fields.find((field) => field.type === 'checkbox');
  const secretSignature = 'Concurrent Signer Security Mark';
  const secretPhrase = `sensitive-${crypto.randomUUID()}`;
  await first.agent.put(`/api/public/esign/fields/${signatureField.id}`).send({ signature: { mode: 'typed', value: secretSignature } }).expect(200);
  await first.agent.put(`/api/public/esign/fields/${textField.id}`).send({ value: secretPhrase }).expect(200);
  await first.agent.put(`/api/public/esign/fields/${checkboxField.id}`).send({ value: true }).expect(200);

  const storedValues = db.prepare(`SELECT v.value_json,a.display_text FROM esign_field_values v LEFT JOIN esign_signature_assets a ON a.id=v.signature_asset_id
    WHERE v.recipient_id=?`).all(fixture.recipients[0].id) as any[];
  assert.doesNotMatch(JSON.stringify(storedValues), new RegExp(secretPhrase));
  assert.doesNotMatch(JSON.stringify(storedValues), new RegExp(secretSignature));
  const resumed = await second.agent.get('/api/public/esign/envelope').expect(200);
  assert.equal(resumed.body.fields.every((field: any) => field.hasValue), true);

  const completions = await Promise.all([
    first.agent.post('/api/public/esign/complete').send({}),
    second.agent.post('/api/public/esign/complete').send({})
  ]);
  assert.equal(completions.filter((response) => response.status === 200).length, 1);
  assert.equal(completions.filter((response) => response.status >= 400).length, 1);

  const completed: any = await waitFor(
    async () => (await owner.agent.get(`/api/esign/envelopes/${fixture.envelopeId}`).expect(200)).body,
    (detail: any) => detail.envelope.status === 'completed' && detail.artifacts.length === 2,
    'completed artifacts'
  );
  assert.equal(completed.audit.filter((event: any) => event.action === 'recipient.completed').length, 1);
  assert.equal(completed.audit.filter((event: any) => event.action === 'envelope.completed').length, 1);
  assert.equal(new Set(completed.artifacts.map((artifact: any) => artifact.kind)).size, 2);
  const deliveryCounts = db.prepare('SELECT kind,COUNT(*) count FROM esign_email_deliveries WHERE envelope_id=? GROUP BY kind').all(fixture.envelopeId) as any[];
  assert.equal(Number(deliveryCounts.find((row) => row.kind === 'invitation')?.count), 1);
  assert.equal(Number(deliveryCounts.find((row) => row.kind === 'completed')?.count), 1);

  const completedPdf = completed.artifacts.find((artifact: any) => artifact.kind === 'completed_pdf');
  const certificate = completed.artifacts.find((artifact: any) => artifact.kind === 'completion_certificate');
  const pdfResponse = await owner.agent.get(`/api/esign/envelopes/${fixture.envelopeId}/artifacts/${completedPdf.id}/content`).expect(200);
  assert.ok(Buffer.isBuffer(pdfResponse.body));
  assert.equal(crypto.createHash('sha256').update(pdfResponse.body).digest('hex'), completedPdf.sha256);
  assert.equal((await PDFDocument.load(pdfResponse.body)).getPageCount(), 2);

  await outsider.agent.get(`/api/esign/envelopes/${fixture.envelopeId}/artifacts/${completedPdf.id}/content`).expect(404);
  await request(app).get(`/api/public/esign/artifacts/${completedPdf.id}/content`).expect(401);
  await first.agent.get(`/api/public/esign/artifacts/${completedPdf.id}/content`).expect(200);
  const verification = await request(app).get(`/api/public/esign/certificates/${certificate.certificateId}`).expect(200);
  assert.equal(verification.body.valid, true);
  assert.equal(JSON.stringify(verification.body).includes('Concurrent Signer'), false);

  const audited = db.prepare("SELECT id FROM esign_audit_events WHERE envelope_id=? AND event_type='recipient.completed'").get(fixture.envelopeId) as any;
  db.prepare('UPDATE esign_audit_events SET metadata_json=? WHERE id=?').run('{"tampered":true}', audited.id);
  const tampered = await request(app).get(`/api/public/esign/certificates/${certificate.certificateId}`).expect(200);
  assert.equal(tampered.body.valid, false);
});

test('accepts only one concurrent decline and leaves no completion artifacts', async () => {
  const owner = await signup('decline-owner');
  const fixture = await prepareEnvelope(owner.agent, 'Concurrent decline', [{ name: 'Declining Signer', email: `decline-${identity}@example.com` }]);
  await owner.agent.post(`/api/esign/envelopes/${fixture.envelopeId}/send`).send({}).expect(200);
  const invite = await invitation(owner.agent, fixture.envelopeId, fixture.recipients[0].id);
  const first = await openSigningSession(invite.token);
  const second = await openSigningSession(invite.token);
  await first.agent.post('/api/public/esign/consent').send({ agreed: true }).expect(200);
  await second.agent.post('/api/public/esign/consent').send({ agreed: true }).expect(200);
  const outcomes = await Promise.all([
    first.agent.post('/api/public/esign/decline').send({ reason: 'Terms were not accepted.' }),
    second.agent.post('/api/public/esign/decline').send({ reason: 'Duplicate decline attempt.' })
  ]);
  assert.equal(outcomes.filter((response) => response.status === 200).length, 1);
  assert.equal(outcomes.filter((response) => response.status >= 400).length, 1);
  const detail = await owner.agent.get(`/api/esign/envelopes/${fixture.envelopeId}`).expect(200);
  assert.equal(detail.body.envelope.status, 'declined');
  assert.equal(detail.body.artifacts.length, 0);
  assert.equal(detail.body.audit.filter((event: any) => event.action === 'recipient.declined').length, 1);
});
