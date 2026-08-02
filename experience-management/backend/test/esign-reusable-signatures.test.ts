import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import request, { type SuperAgentTest } from 'supertest';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-esign-reusable-'));
const passwordFile = path.join(root, 'admin-password');
const sessionFile = path.join(root, 'session-secret');
const esignKeyFile = path.join(root, 'esign-key');
const xKeyFile = path.join(root, 'x-key');
fs.writeFileSync(passwordFile, 'Reusable-Signature-Admin-Password-2026!');
fs.writeFileSync(sessionFile, 'reusable-signature-session-secret-that-is-long-and-random');
fs.writeFileSync(esignKeyFile, Buffer.alloc(32, 91).toString('base64url'));
fs.writeFileSync(xKeyFile, Buffer.alloc(32, 92).toString('base64url'));

Object.assign(process.env, {
  DATABASE_PATH: path.join(root, 'reusable-signatures.sqlite'),
  UPLOAD_DIR: path.join(root, 'uploads'),
  FRONTEND_DIST: path.join(root, 'missing-frontend'),
  PUBLIC_URL: 'http://127.0.0.1:5487',
  ADMIN_EMAIL: 'reusable-signature-qa@seemplify.local',
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
const { issueEmailVerificationToken } = await import('../src/auth.js');
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
  const page = pdf.addPage([612, 792]);
  page.drawText('Reusable signature integration fixture', { x: 48, y: 730, size: 16, font });
  return Buffer.from(await pdf.save());
}

async function signup(label: string, requestedEmail?: string, onboard = true) {
  identity += 1;
  const agent = request.agent(app);
  const email = requestedEmail || `${label}-${identity}@example.com`;
  await agent.post('/api/auth/signup').set('x-forwarded-for', `203.0.113.${identity}`).send({
    name: `${label} user`, email, password: 'Reusable-Signature-Account-2026!'
  }).expect(202);
  const verification = issueEmailVerificationToken(email);
  assert.ok(verification);
  await agent.post('/api/auth/verify-email').send({ token: verification.token }).expect(200);
  if (onboard) {
    await agent.post('/api/account/onboarding').send({
      name: `${label} user`, timezone: 'UTC', primaryGoal: 'customer_experience'
    }).expect(200);
  }
  return { agent, email };
}

type RecipientSpec = {
  name: string;
  email: string;
  routingOrder?: number;
  accessCode?: string;
};

async function prepareEnvelope(
  owner: SuperAgentTest,
  label: string,
  recipients: RecipientSpec[],
  routingMode: 'sequential' | 'parallel' = 'sequential'
) {
  const created = await owner.post('/api/esign/envelopes').send({
    title: `${label} ${crypto.randomUUID().slice(0, 8)}`,
    subject: `${label} signature request`,
    message: 'Review and sign this reusable-signature fixture.',
    routingMode,
    expiresInDays: 1
  }).expect(201);
  const envelopeId = created.body.envelope.id as string;
  const uploaded = await owner.post(`/api/esign/envelopes/${envelopeId}/documents`)
    .attach('file', await samplePdf(), { filename: 'reusable-signature.pdf', contentType: 'application/pdf' })
    .expect(201);
  const document = uploaded.body.documents[0];
  const savedRecipients = (await owner.put(`/api/esign/envelopes/${envelopeId}/recipients`).send({
    recipients: recipients.map((recipient, index) => ({
      ...recipient, role: 'signer', routingOrder: recipient.routingOrder || index + 1
    }))
  }).expect(200)).body.recipients as any[];
  const fields = savedRecipients.map((recipient, index) => ({
    id: crypto.randomUUID(), documentId: document.id, recipientId: recipient.id,
    type: 'signature', page: 1, x: 0.08, y: 0.62 + index * 0.1,
    width: 0.32, height: 0.07, required: true, label: `${recipient.name} signature`
  }));
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
  const rows = await waitFor<any[]>(
    async () => (await owner.get(`/api/esign/outbox?envelopeId=${envelopeId}`).expect(200)).body,
    (items) => items.some((item) => item.recipientId === recipientId && item.kind === 'invitation' && item.signerUrl),
    'signing invitation'
  );
  const item = rows.find((candidate) => candidate.recipientId === recipientId && candidate.kind === 'invitation' && candidate.signerUrl);
  return { item, token: new URL(item.signerUrl).searchParams.get('token') as string, rows };
}

async function openSigningSession(token: string) {
  const agent = request.agent(app);
  const response = await agent.post('/api/public/esign/session').send({ token }).expect(201);
  return { agent, response };
}

async function authenticateSigning(agent: SuperAgentTest, accessCode?: string) {
  if (accessCode) await agent.post('/api/public/esign/access-code').send({ code: accessCode }).expect(200);
  await agent.post('/api/public/esign/consent').send({ agreed: true }).expect(200);
}

function createdSignature(body: any) {
  return body?.signature || body;
}

test('keeps anonymous signature identities server-derived across envelopes and copies before deletion', async () => {
  assert.ok(db.prepare("SELECT 1 FROM schema_migrations WHERE version=13 AND name='reusable_esign_signatures'").get());
  const owner = await signup('anonymous-library-owner');
  const recipientEmail = `anonymous-recipient-${crypto.randomUUID()}@example.com`;
  const unrelatedEmail = `unrelated-recipient-${crypto.randomUUID()}@example.com`;
  const firstEnvelope = await prepareEnvelope(owner.agent, 'Anonymous library first', [{ name: 'Anonymous Recipient', email: recipientEmail }]);
  const secondEnvelope = await prepareEnvelope(owner.agent, 'Anonymous library second', [{ name: 'Anonymous Recipient', email: recipientEmail }]);
  const unrelatedEnvelope = await prepareEnvelope(owner.agent, 'Anonymous library unrelated', [{ name: 'Unrelated Recipient', email: unrelatedEmail }]);
  for (const fixture of [firstEnvelope, secondEnvelope, unrelatedEnvelope]) {
    await owner.agent.post(`/api/esign/envelopes/${fixture.envelopeId}/send`).send({}).expect(200);
  }

  const firstInvite = await invitation(owner.agent, firstEnvelope.envelopeId, firstEnvelope.recipients[0].id);
  const secondInvite = await invitation(owner.agent, secondEnvelope.envelopeId, secondEnvelope.recipients[0].id);
  const unrelatedInvite = await invitation(owner.agent, unrelatedEnvelope.envelopeId, unrelatedEnvelope.recipients[0].id);
  const first = await openSigningSession(firstInvite.token);
  const second = await openSigningSession(secondInvite.token);
  const unrelated = await openSigningSession(unrelatedInvite.token);
  await authenticateSigning(first.agent);
  await authenticateSigning(second.agent);
  await authenticateSigning(unrelated.agent);

  const empty = await first.agent.get('/api/public/esign/signatures').expect(200);
  assert.deepEqual(empty.body.signatures, []);
  assert.equal(empty.body.identity.accountLinked, false);
  assert.match(empty.body.identity.maskedEmail, /@example\.com$/);
  assert.equal(empty.body.maxSignatures, 5);

  const signatureText = `Private reusable mark ${crypto.randomUUID()}`;
  const created = await first.agent.post('/api/public/esign/signatures').send({
    mode: 'typed', label: 'Primary signature', value: signatureText
  }).expect(201);
  const saved = createdSignature(created.body);
  assert.match(saved.id, /^[0-9a-f-]{36}$/i);
  assert.equal(saved.mode, 'typed');
  assert.equal(saved.label, 'Primary signature');
  assert.equal(saved.displayText, signatureText);
  assert.equal(saved.previewUrl, null);
  assert.equal(saved.scope, 'recipient');
  assert.equal(saved.canManage, true);
  assert.equal(JSON.stringify(created.body).includes(recipientEmail), false);

  const stored = db.prepare('SELECT * FROM esign_saved_signatures WHERE id=?').get(saved.id) as any;
  assert.equal(stored.owner_user_id, null);
  assert.match(stored.recipient_identity_hash, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(String(stored.display_text_enc), new RegExp(signatureText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const resumed = await second.agent.get('/api/public/esign/signatures').expect(200);
  assert.deepEqual(resumed.body.signatures.map((item: any) => item.id), [saved.id]);
  const arbitraryEmailAttempt = await unrelated.agent
    .get(`/api/public/esign/signatures?email=${encodeURIComponent(recipientEmail)}`).expect(200);
  assert.deepEqual(arbitraryEmailAttempt.body.signatures, []);
  assert.notEqual(arbitraryEmailAttempt.body.identity.maskedEmail, resumed.body.identity.maskedEmail);
  await unrelated.agent.post('/api/public/esign/signatures').send({
    mode: 'typed', value: 'Attempted arbitrary identity', email: recipientEmail
  }).expect(400);
  assert.deepEqual((await unrelated.agent.get('/api/public/esign/signatures').expect(200)).body.signatures, []);

  await second.agent.put(`/api/public/esign/fields/${secondEnvelope.fields[0].id}`)
    .send({ savedSignatureId: saved.id }).expect(200);
  const refreshedEnvelope = await second.agent.get('/api/public/esign/envelope').expect(200);
  const refreshedField = refreshedEnvelope.body.fields.find((field: any) => field.id === secondEnvelope.fields[0].id);
  assert.deepEqual(refreshedField.signaturePreview, { mode: 'typed', displayText: signatureText, previewUrl: null });
  const copied = db.prepare(`SELECT v.signature_asset_id,a.display_text,a.storage_key
    FROM esign_field_values v JOIN esign_signature_assets a ON a.id=v.signature_asset_id WHERE v.field_id=?`)
    .get(secondEnvelope.fields[0].id) as any;
  assert.ok(copied.signature_asset_id);
  assert.doesNotMatch(String(copied.display_text), new RegExp(signatureText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  await first.agent.delete(`/api/public/esign/signatures/${saved.id}`).expect(204);
  assert.deepEqual((await second.agent.get('/api/public/esign/signatures').expect(200)).body.signatures, []);
  assert.equal(db.prepare('SELECT 1 FROM esign_signature_assets WHERE id=?').get(copied.signature_asset_id) != null, true);
  await second.agent.post('/api/public/esign/complete').send({}).expect(200);
  await waitFor(
    async () => (await owner.agent.get(`/api/esign/envelopes/${secondEnvelope.envelopeId}`).expect(200)).body,
    (detail: any) => detail.envelope.status === 'completed' && detail.artifacts.length === 2,
    'completion after saved-signature deletion'
  );

  const envelopeAudit = db.prepare('SELECT metadata_json FROM esign_audit_events WHERE envelope_id=?')
    .all(secondEnvelope.envelopeId) as Array<{ metadata_json: string }>;
  const libraryAudit = db.prepare('SELECT metadata_json FROM esign_saved_signature_events WHERE recipient_identity_hash=?')
    .all(stored.recipient_identity_hash) as Array<{ metadata_json: string }>;
  assert.doesNotMatch(JSON.stringify([...envelopeAudit, ...libraryAudit]), new RegExp(signatureText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('requires PIN authentication and disclosure consent before signature-library access', async () => {
  const owner = await signup('pin-library-owner');
  const fixture = await prepareEnvelope(owner.agent, 'PIN signature library', [{
    name: 'PIN Recipient', email: `pin-library-${crypto.randomUUID()}@example.com`, accessCode: '8642'
  }]);
  await owner.agent.post(`/api/esign/envelopes/${fixture.envelopeId}/send`).send({}).expect(200);
  const invite = await invitation(owner.agent, fixture.envelopeId, fixture.recipients[0].id);
  const signing = await openSigningSession(invite.token);

  await signing.agent.get('/api/public/esign/signatures').expect(401);
  await signing.agent.post('/api/public/esign/signatures').send({ mode: 'typed', value: 'Blocked before PIN' }).expect(401);
  await signing.agent.post('/api/public/esign/access-code').send({ code: '8642' }).expect(200);
  await signing.agent.get('/api/public/esign/signatures').expect(409);
  await signing.agent.post('/api/public/esign/signatures').send({ mode: 'typed', value: 'Blocked before consent' }).expect(409);
  await signing.agent.post('/api/public/esign/consent').send({ agreed: true }).expect(200);
  const created = await signing.agent.post('/api/public/esign/signatures').send({
    mode: 'typed', label: 'PIN-approved signature', value: 'PIN Recipient'
  }).expect(201);
  const saved = createdSignature(created.body);
  await signing.agent.put(`/api/public/esign/fields/${fixture.fields[0].id}`).send({ savedSignatureId: saved.id }).expect(200);
});

test('isolates account-owned signatures and exposes recipient activity only to the entitled verified account', async () => {
  const sender = await signup('account-library-sender');
  const recipientEmail = `account-recipient-${crypto.randomUUID()}@example.com`;
  const recipientAccount = await signup('account-recipient', recipientEmail, false);
  const otherAccount = await signup('other-recipient', undefined, false);
  const privateMark = `Account-owned mark ${crypto.randomUUID()}`;

  const created = await recipientAccount.agent.post('/api/recipient-documents/signatures').send({
    mode: 'typed', label: 'Account signature', value: privateMark
  }).expect(201);
  const saved = createdSignature(created.body);
  assert.equal(saved.scope, 'account');
  const storedAccountSignature = db.prepare('SELECT owner_user_id,recipient_identity_hash FROM esign_saved_signatures WHERE id=?')
    .get(saved.id) as any;
  assert.ok(storedAccountSignature.owner_user_id);
  assert.match(storedAccountSignature.recipient_identity_hash, /^[a-f0-9]{64}$/);
  const accountList = await recipientAccount.agent.get('/api/recipient-documents/signatures').expect(200);
  assert.equal(accountList.body.maxSignatures, 5);
  assert.deepEqual(accountList.body.signatures.map((item: any) => item.id), [saved.id]);
  assert.equal(accountList.body.signatures[0].canManage, true);
  assert.deepEqual((await otherAccount.agent.get(`/api/recipient-documents/signatures?email=${encodeURIComponent(recipientEmail)}`).expect(200)).body.signatures, []);
  await otherAccount.agent.put(`/api/recipient-documents/signatures/${saved.id}`).send({
    mode: 'typed', label: 'Stolen', value: 'Stolen'
  }).expect(404);
  await otherAccount.agent.delete(`/api/recipient-documents/signatures/${saved.id}`).expect(404);
  await otherAccount.agent.get(`/api/recipient-documents/signatures/${saved.id}/content`).expect(404);

  const fixture = await prepareEnvelope(sender.agent, 'Account signature reuse', [{ name: 'Account Recipient', email: recipientEmail }]);
  await sender.agent.post(`/api/esign/envelopes/${fixture.envelopeId}/send`).send({}).expect(200);
  const invite = await invitation(sender.agent, fixture.envelopeId, fixture.recipients[0].id);

  const anonymousSameEmail = await openSigningSession(invite.token);
  await authenticateSigning(anonymousSameEmail.agent);
  const anonymousPublicLibrary = await anonymousSameEmail.agent.get('/api/public/esign/signatures').expect(200);
  assert.equal(anonymousPublicLibrary.body.identity.accountLinked, false);
  assert.deepEqual(anonymousPublicLibrary.body.signatures.map((item: any) => item.id), [saved.id]);
  assert.equal(anonymousPublicLibrary.body.signatures[0].canManage, false);
  await anonymousSameEmail.agent.put(`/api/public/esign/signatures/${saved.id}`).send({
    mode: 'typed', label: 'Blocked replacement', value: 'Blocked replacement'
  }).expect(403);
  await anonymousSameEmail.agent.delete(`/api/public/esign/signatures/${saved.id}`).expect(403);
  for (let index = 0; index < 4; index += 1) {
    await anonymousSameEmail.agent.post('/api/public/esign/signatures').send({
      mode: 'typed', label: `Recipient signature ${index + 1}`, value: `Recipient signature ${index + 1}`
    }).expect(201);
  }
  const libraryAtLimit = await anonymousSameEmail.agent.get('/api/public/esign/signatures').expect(200);
  assert.equal(libraryAtLimit.body.maxSignatures, 5);
  assert.equal(libraryAtLimit.body.signatures.length, 5);
  await anonymousSameEmail.agent.post('/api/public/esign/signatures').send({
    mode: 'typed', label: 'Over combined limit', value: 'Over combined limit'
  }).expect(409);
  await anonymousSameEmail.agent.put(`/api/public/esign/fields/${fixture.fields[0].id}`)
    .send({ savedSignatureId: saved.id }).expect(200);

  const mismatchedEnvelope = await prepareEnvelope(sender.agent, 'Mismatched account signature invitation', [{
    name: 'Other Recipient', email: otherAccount.email
  }]);
  await sender.agent.post(`/api/esign/envelopes/${mismatchedEnvelope.envelopeId}/send`).send({}).expect(200);
  const mismatchedInvite = await invitation(sender.agent, mismatchedEnvelope.envelopeId, mismatchedEnvelope.recipients[0].id);
  const mismatchedSigning = await openSigningSession(mismatchedInvite.token);
  await authenticateSigning(mismatchedSigning.agent);
  assert.deepEqual((await mismatchedSigning.agent
    .get(`/api/public/esign/signatures?email=${encodeURIComponent(recipientEmail)}`).expect(200)).body.signatures, []);

  await recipientAccount.agent.post('/api/public/esign/session').send({ token: invite.token }).expect(201);
  await recipientAccount.agent.post('/api/public/esign/consent').send({ agreed: true }).expect(200);
  const linkedPublicLibrary = await recipientAccount.agent.get('/api/public/esign/signatures').expect(200);
  assert.equal(linkedPublicLibrary.body.identity.accountLinked, true);
  assert.equal(linkedPublicLibrary.body.signatures.length, 5);
  assert.equal(linkedPublicLibrary.body.signatures.find((item: any) => item.id === saved.id)?.canManage, true);
  await recipientAccount.agent.post('/api/public/esign/complete').send({}).expect(200);
  const completed = await waitFor<any>(
    async () => (await sender.agent.get(`/api/esign/envelopes/${fixture.envelopeId}`).expect(200)).body,
    (detail) => detail.envelope.status === 'completed' && detail.artifacts.length === 2,
    'account-recipient completion'
  );

  const activity = await recipientAccount.agent
    .get(`/api/recipient-documents/envelopes/${fixture.envelopeId}/activity`).expect(200);
  assert.ok(Array.isArray(activity.body.activity));
  assert.ok(activity.body.activity.some((item: any) => item.eventType === 'recipient.completed'));
  assert.equal(JSON.stringify(activity.body).includes(privateMark), false);
  await otherAccount.agent.get(`/api/recipient-documents/envelopes/${fixture.envelopeId}/activity`).expect(404);
  assert.equal((await recipientAccount.agent.get('/api/recipient-documents').expect(200)).body.documents[0].id, fixture.envelopeId);

  const copiedAssetId = (db.prepare('SELECT signature_asset_id FROM esign_field_values WHERE field_id=?')
    .get(fixture.fields[0].id) as any).signature_asset_id;
  await recipientAccount.agent.delete(`/api/recipient-documents/signatures/${saved.id}`).expect(204);
  assert.ok(db.prepare('SELECT 1 FROM esign_signature_assets WHERE id=?').get(copiedAssetId));
  assert.equal(completed.envelope.status, 'completed');
});

test('keeps parallel recipients active while each independently reuses a saved signature', async () => {
  const owner = await signup('parallel-library-owner');
  const fixture = await prepareEnvelope(owner.agent, 'Parallel signature reuse', [
    { name: 'Parallel First', email: `parallel-first-${crypto.randomUUID()}@example.com`, routingOrder: 1 },
    { name: 'Parallel Second', email: `parallel-second-${crypto.randomUUID()}@example.com`, routingOrder: 2 }
  ], 'parallel');
  await owner.agent.post(`/api/esign/envelopes/${fixture.envelopeId}/send`).send({}).expect(200);
  const outbox = await waitFor<any[]>(
    async () => (await owner.agent.get(`/api/esign/outbox?envelopeId=${fixture.envelopeId}`).expect(200)).body,
    (items) => fixture.recipients.every((recipient) => items.some((item) => item.recipientId === recipient.id && item.kind === 'invitation' && item.signerUrl)),
    'parallel invitations'
  );

  const signers = [] as Array<{ agent: SuperAgentTest; savedId: string }>;
  for (let index = 0; index < fixture.recipients.length; index += 1) {
    const recipient = fixture.recipients[index];
    const invitationRow = outbox.find((item) => item.recipientId === recipient.id && item.kind === 'invitation' && item.signerUrl);
    const token = new URL(invitationRow.signerUrl).searchParams.get('token') as string;
    const signing = await openSigningSession(token);
    await authenticateSigning(signing.agent);
    const created = await signing.agent.post('/api/public/esign/signatures').send({
      mode: 'typed', label: `Parallel ${index + 1}`, value: recipient.name
    }).expect(201);
    const saved = createdSignature(created.body);
    await signing.agent.put(`/api/public/esign/fields/${fixture.fields[index].id}`)
      .send({ savedSignatureId: saved.id }).expect(200);
    signers.push({ agent: signing.agent, savedId: saved.id });
  }

  await signers[0].agent.post('/api/public/esign/complete').send({}).expect(200);
  const midway = await owner.agent.get(`/api/esign/envelopes/${fixture.envelopeId}`).expect(200);
  assert.equal(midway.body.envelope.status, 'in_progress');
  assert.equal(midway.body.recipients.find((item: any) => item.id === fixture.recipients[1].id).status, 'in_progress');
  await signers[1].agent.post('/api/public/esign/complete').send({}).expect(200);
  const completed = await waitFor<any>(
    async () => (await owner.agent.get(`/api/esign/envelopes/${fixture.envelopeId}`).expect(200)).body,
    (detail) => detail.envelope.status === 'completed' && detail.artifacts.length === 2,
    'parallel completion'
  );
  assert.equal(completed.audit.filter((item: any) => item.eventType === 'recipient.completed').length, 2);
});
