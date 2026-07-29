import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import request from 'supertest';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-esign-'));
const passwordFile = path.join(root, 'admin-password'); const sessionFile = path.join(root, 'session-secret');
const esignKeyFile = path.join(root, 'esign-key'); const xKeyFile = path.join(root, 'x-key');
fs.writeFileSync(passwordFile, 'Test-Admin-Password-2026!'); fs.writeFileSync(sessionFile, 'test-session-secret-that-is-long-and-random-enough');
fs.writeFileSync(esignKeyFile, Buffer.alloc(32, 21).toString('base64url')); fs.writeFileSync(xKeyFile, Buffer.alloc(32, 22).toString('base64url'));
Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'test.sqlite'), UPLOAD_DIR: path.join(root, 'uploads'), FRONTEND_DIST: path.join(root, 'missing-frontend'),
  PUBLIC_URL: 'http://127.0.0.1:5412', ADMIN_EMAIL: 'qa@seemplify.local', ADMIN_PASSWORD_FILE: passwordFile, SESSION_SECRET_FILE: sessionFile,
  EMAIL_MODE: 'log', ESIGN_STORAGE_DIR: path.join(root, 'esign'), ESIGN_ENCRYPTION_KEY_FILE: esignKeyFile, ESIGN_WORKER_POLL_MS: '250',
  X_CREDENTIAL_ENCRYPTION_KEY_FILE: xKeyFile, X_SEED_CONSUMER_KEY_FILE: path.join(root, 'missing-x-key'), X_SEED_CONSUMER_SECRET_FILE: path.join(root, 'missing-x-secret'),
  X_SEED_BEARER_TOKEN_FILE: path.join(root, 'missing-x-bearer'), X_SEED_ACCESS_TOKEN_FILE: path.join(root, 'missing-x-token'), X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(root, 'missing-x-token-secret')
});

const { app } = await import('../src/app.js');
const { db } = await import('../src/database.js');
const { esignWorker } = await import('../src/esign.js');
esignWorker.start();
after(async () => { await esignWorker.stop(); db.close(); fs.rmSync(root, { recursive: true, force: true }); });

async function samplePdf() {
  const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const [index, title] of ['Employment agreement', 'Terms and acknowledgements'].entries()) {
    const page = pdf.addPage([612, 792]); page.drawText(title, { x: 48, y: 730, size: 18, font }); page.drawText(`Synthetic signing fixture page ${index + 1}`, { x: 48, y: 690, size: 11, font });
  }
  return Buffer.from(await pdf.save());
}

async function waitFor<T>(read: () => Promise<T>, accepted: (value: T) => boolean, label: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) { const value = await read(); if (accepted(value)) return value; await new Promise((resolve) => setTimeout(resolve, 25)); }
  throw new Error(`Timed out waiting for ${label}.`);
}

test('securely completes a routed two-signer envelope and verifies its certificate', async () => {
  const owner = request.agent(app);
  await owner.post('/api/auth/signup').send({ name: 'Envelope Owner', email: 'owner@example.com', password: 'Envelope-Owner-2026' }).expect(201);
  const created = await owner.post('/api/esign/envelopes').send({ title: 'Employment agreement', message: 'Please review and sign this employment agreement.', routingMode: 'sequential', expiresInDays: 14, reminderIntervalHours: 48 }).expect(201);
  const envelopeId = created.body.envelope.id;
  assert.equal(created.body.readiness.sections.documents.complete, false);

  const uploaded = await owner.post(`/api/esign/envelopes/${envelopeId}/documents`).attach('file', await samplePdf(), { filename: '../agreement.pdf', contentType: 'application/pdf' }).expect(201);
  const document = uploaded.body.documents[0]; assert.equal(document.pageCount, 2); assert.equal(document.name, 'agreement.pdf');
  const storedDocument = db.prepare('SELECT storage_key FROM esign_documents WHERE id=?').get(document.id) as any;
  assert.equal(fs.readFileSync(path.join(root, 'esign', storedDocument.storage_key)).subarray(0, 5).toString(), 'SEEMS');
  const recipientsResponse = await owner.put(`/api/esign/envelopes/${envelopeId}/recipients`).send({ recipients: [
    { name: 'Ada First', email: 'ada@example.com', role: 'signer', routingOrder: 1, accessCode: '2468' },
    { name: 'Ben Second', email: 'ben@example.com', role: 'signer', routingOrder: 2 }
  ] }).expect(200);
  const [ada, ben] = recipientsResponse.body.recipients;
  assert.equal(ada.accessCodeSet, true);
  const fields = [
    { id: crypto.randomUUID(), documentId: document.id, recipientId: ada.id, type: 'signature', page: 1, x: 0.1, y: 0.75, width: 0.35, height: 0.08, required: true, label: 'Employee signature' },
    { id: crypto.randomUUID(), documentId: document.id, recipientId: ben.id, type: 'signature', page: 2, x: 0.1, y: 0.75, width: 0.35, height: 0.08, required: true, label: 'Employer signature' }
  ];
  const prepared = await owner.put(`/api/esign/envelopes/${envelopeId}/fields`).send({ fields }).expect(200);
  assert.equal(prepared.body.readiness.ready, true);
  await owner.post(`/api/esign/envelopes/${envelopeId}/send`).send({}).expect(200);

  const firstOutbox: any = await waitFor(async () => (await owner.get(`/api/esign/outbox?envelopeId=${envelopeId}`).expect(200)).body, (items: any[]) => items.some((item) => item.recipientId === ada.id && item.signerUrl), 'first invitation');
  assert.equal(firstOutbox.some((item: any) => item.recipientId === ben.id && item.kind === 'invitation'), false);
  const deliveryDetail = (await owner.get(`/api/esign/envelopes/${envelopeId}`).expect(200)).body;
  const invitationDelivery = deliveryDetail.deliveries.find((item: any) => item.recipientId === ada.id && item.kind === 'invitation');
  assert.equal(invitationDelivery.recipientName, 'Ada First'); assert.equal(invitationDelivery.recipientEmail, 'ada@example.com');
  assert.equal(invitationDelivery.state, 'sent'); assert.equal(invitationDelivery.attempts, 1);
  for (const field of ['scheduledAt', 'providerMessageId', 'providerStatus', 'providerUpdatedAt', 'deliveredAt', 'openedAt', 'bouncedAt', 'error', 'createdAt', 'updatedAt', 'sentAt']) assert.equal(Object.hasOwn(invitationDelivery, field), true);
  assert.equal(Object.hasOwn(invitationDelivery, 'debugLinkEnc'), false); assert.equal(Object.hasOwn(invitationDelivery, 'debug_link_enc'), false); assert.equal(Object.hasOwn(invitationDelivery, 'idempotencyKey'), false);
  const adaToken = new URL(firstOutbox.find((item: any) => item.recipientId === ada.id).signerUrl).searchParams.get('token');
  const adaSession = request.agent(app); await adaSession.post('/api/public/esign/session').send({ token: adaToken }).expect(201).expect(({ body }) => assert.equal(body.requiresAccessCode, true));
  await adaSession.get(`/api/public/esign/documents/${document.id}/content`).expect(401);
  await adaSession.post('/api/public/esign/access-code').send({ code: 'incorrect' }).expect(401);
  await adaSession.post('/api/public/esign/access-code').send({ code: '2468' }).expect(200);
  await adaSession.get(`/api/public/esign/documents/${document.id}/content`).expect(409);
  await adaSession.post('/api/public/esign/consent').send({ agreed: true }).expect(200);
  await adaSession.get(`/api/public/esign/documents/${document.id}/content`).expect(200).expect('Content-Type', /application\/pdf/);
  await adaSession.put(`/api/public/esign/fields/${fields[0].id}`).send({ signature: { mode: 'typed', value: 'Ada First' } }).expect(200);
  const storedSignature = db.prepare(`SELECT v.value_json,a.display_text FROM esign_field_values v JOIN esign_signature_assets a ON a.id=v.signature_asset_id WHERE v.field_id=?`).get(fields[0].id) as any;
  assert.doesNotMatch(`${storedSignature.value_json}${storedSignature.display_text}`, /Ada First/);
  await adaSession.post('/api/public/esign/complete').send({}).expect(200);

  const secondOutbox: any = await waitFor(async () => (await owner.get(`/api/esign/outbox?envelopeId=${envelopeId}`).expect(200)).body, (items: any[]) => items.some((item) => item.recipientId === ben.id && item.kind === 'invitation' && item.signerUrl), 'second invitation');
  const benToken = new URL(secondOutbox.find((item: any) => item.recipientId === ben.id && item.kind === 'invitation').signerUrl).searchParams.get('token');
  const benSession = request.agent(app); await benSession.post('/api/public/esign/session').send({ token: benToken }).expect(201);
  await benSession.post('/api/public/esign/consent').send({ agreed: true }).expect(200);
  await benSession.put(`/api/public/esign/fields/${fields[1].id}`).send({ signature: { mode: 'typed', value: 'Ben Second' } }).expect(200);
  await benSession.post('/api/public/esign/complete').send({}).expect(200);

  const completed: any = await waitFor(async () => (await owner.get(`/api/esign/envelopes/${envelopeId}`).expect(200)).body, (detail: any) => detail.envelope.status === 'completed' && detail.artifacts.length === 2, 'final artifacts');
  assert.equal(completed.audit.some((event: any) => event.action === 'envelope.completed'), true);
  const completedPdf = completed.artifacts.find((artifact: any) => artifact.kind === 'completed_pdf');
  const certificate = completed.artifacts.find((artifact: any) => artifact.kind === 'completion_certificate');
  await owner.get(`/api/esign/envelopes/${envelopeId}/artifacts/${completedPdf.id}/content`).expect(200).expect('Content-Type', /application\/pdf/);
  const verification = await request(app).get(`/api/public/esign/certificates/${certificate.certificateId}`).expect(200);
  assert.equal(verification.body.valid, true); assert.equal(verification.body.participants[0].maskedEmail, 'a***@example.com');
  assert.equal(JSON.stringify(verification.body).includes('Ada First'), false);

  const outsider = request.agent(app); await outsider.post('/api/auth/signup').send({ name: 'Other User', email: 'other@example.com', password: 'Other-User-2026' }).expect(201);
  await outsider.get(`/api/esign/envelopes/${envelopeId}`).expect(404);
  await request(app).get(`/api/public/esign/documents/${document.id}/content`).expect(401);

  db.prepare("UPDATE esign_envelopes SET status='failed',finalization_attempt=4,finalization_error='Synthetic finalization fault' WHERE id=?").run(envelopeId);
  const retried = await owner.post(`/api/esign/envelopes/${envelopeId}/retry-finalization`).send({}).expect(202);
  assert.equal(['finalizing', 'completed'].includes(retried.body.envelope.status), true);
  const recovered: any = await waitFor(async () => (await owner.get(`/api/esign/envelopes/${envelopeId}`).expect(200)).body, (detail: any) => detail.envelope.status === 'completed', 'retried finalization');
  assert.equal(recovered.envelope.finalizationError, null);
  assert.equal(recovered.audit.some((event: any) => event.action === 'envelope.finalization_retried'), true);
});

test('rejects disguised, malformed PDF uploads without creating public files', async () => {
  const owner = request.agent(app); await owner.post('/api/auth/login').send({ email: 'owner@example.com', password: 'Envelope-Owner-2026' }).expect(200);
  const created = await owner.post('/api/esign/envelopes').send({ title: 'Unsafe upload check' }).expect(201);
  await owner.post(`/api/esign/envelopes/${created.body.envelope.id}/documents`).attach('file', Buffer.from('%PDF-not-a-real-document'), { filename: 'unsafe.pdf', contentType: 'application/pdf' }).expect(400);
  await request(app).get('/uploads/unsafe.pdf').expect(404);
});

test('keeps the next sequential routing order locked until every same-order signer completes', async () => {
  const owner = request.agent(app); await owner.post('/api/auth/login').send({ email: 'owner@example.com', password: 'Envelope-Owner-2026' }).expect(200);
  const created = await owner.post('/api/esign/envelopes').send({ title: 'Grouped routing agreement', message: 'All first-stage signers must finish before the next stage.', routingMode: 'sequential' }).expect(201);
  const envelopeId = created.body.envelope.id;
  const uploaded = await owner.post(`/api/esign/envelopes/${envelopeId}/documents`).attach('file', await samplePdf(), { filename: 'routing.pdf', contentType: 'application/pdf' }).expect(201);
  const documentId = uploaded.body.documents[0].id;
  const recipientResult = await owner.put(`/api/esign/envelopes/${envelopeId}/recipients`).send({ recipients: [
    { name: 'First A', email: 'first-a@example.com', role: 'signer', routingOrder: 1 },
    { name: 'First B', email: 'first-b@example.com', role: 'signer', routingOrder: 1 },
    { name: 'Second C', email: 'second-c@example.com', role: 'signer', routingOrder: 2 }
  ] }).expect(200);
  const [firstA, firstB, secondC] = recipientResult.body.recipients;
  const groupedFields = [firstA, firstB, secondC].map((recipient: any, index: number) => ({ id: crypto.randomUUID(), documentId, recipientId: recipient.id, type: 'signature', page: index === 2 ? 2 : 1, x: 0.1, y: 0.62 + index * 0.1, width: 0.3, height: 0.06, required: true, label: `${recipient.name} signature` }));
  await owner.put(`/api/esign/envelopes/${envelopeId}/fields`).send({ fields: groupedFields }).expect(200);
  await owner.post(`/api/esign/envelopes/${envelopeId}/send`).send({}).expect(200);
  const firstWave: any = await waitFor(async () => (await owner.get(`/api/esign/outbox?envelopeId=${envelopeId}`).expect(200)).body, (items: any[]) => items.filter((item) => item.kind === 'invitation' && item.signerUrl).length === 2, 'first routing wave');
  assert.deepEqual(new Set(firstWave.filter((item: any) => item.kind === 'invitation').map((item: any) => item.recipientId)), new Set([firstA.id, firstB.id]));

  async function sign(outbox: any[], recipient: any, field: any) {
    const token = new URL(outbox.find((item: any) => item.recipientId === recipient.id && item.kind === 'invitation').signerUrl).searchParams.get('token');
    const signer = request.agent(app); await signer.post('/api/public/esign/session').send({ token }).expect(201); await signer.post('/api/public/esign/consent').send({ agreed: true }).expect(200);
    await signer.put(`/api/public/esign/fields/${field.id}`).send({ signature: { mode: 'typed', value: recipient.name } }).expect(200); await signer.post('/api/public/esign/complete').send({}).expect(200);
  }
  await sign(firstWave, firstA, groupedFields[0]); await new Promise((resolve) => setTimeout(resolve, 150));
  const stillLocked = (await owner.get(`/api/esign/outbox?envelopeId=${envelopeId}`).expect(200)).body;
  assert.equal(stillLocked.some((item: any) => item.recipientId === secondC.id && item.kind === 'invitation'), false);
  await sign(firstWave, firstB, groupedFields[1]);
  const secondWave: any = await waitFor(async () => (await owner.get(`/api/esign/outbox?envelopeId=${envelopeId}`).expect(200)).body, (items: any[]) => items.some((item) => item.recipientId === secondC.id && item.kind === 'invitation' && item.signerUrl), 'second routing wave');
  assert.ok(secondWave.find((item: any) => item.recipientId === secondC.id).signerUrl);
});
