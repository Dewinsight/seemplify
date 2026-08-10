const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const http = require('node:http');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const Candidate = require('../models/Candidate');
const CandidateAccount = require('../models/CandidateAccount');
const CandidateOnboarding = require('../models/CandidateOnboarding');
const OnboardingDocument = require('../models/OnboardingDocument');
const OnboardingEnvelope = require('../models/OnboardingEnvelope');
const OnboardingFormSubmission = require('../models/OnboardingFormSubmission');
const OnboardingWorkflowItem = require('../models/OnboardingWorkflowItem');
const Organization = require('../models/Organization');
const User = require('../models/User');

const ONE_PIXEL_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lw+v4QAAAABJRU5ErkJggg==';

function objectId(value) {
  return new mongoose.Types.ObjectId(value);
}

async function createBasePdf(title) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  page.drawText(title, {
    x: 72,
    y: 760,
    size: 18,
    font,
    color: rgb(0.1, 0.12, 0.16)
  });
  page.drawText('Candidate portal integration verifier', {
    x: 72,
    y: 730,
    size: 11,
    font,
    color: rgb(0.35, 0.4, 0.5)
  });
  return Buffer.from(await pdfDoc.save());
}

function patchExternalServices(memoryFiles, resetEmails) {
  const storageService = require('../services/onboardingStorageService');
  const pdfService = require('../services/onboardingPdfService');
  const onboardingEmailService = require('../services/onboardingEmailService');
  const emailService = require('../services/emailService');

  const original = {
    uploadBuffer: storageService.uploadBuffer,
    downloadPdfBuffer: pdfService.downloadPdfBuffer,
    sendEmail: emailService.sendEmail,
    sendEnvelopeCompleted: onboardingEmailService.sendEnvelopeCompleted,
    sendEnvelopeSignerNotification: onboardingEmailService.sendEnvelopeSignerNotification
  };

  let uploadCount = 0;
  storageService.uploadBuffer = async (buffer, options = {}) => {
    uploadCount += 1;
    const url = `memory://signed/${uploadCount}`;
    memoryFiles.set(url, Buffer.from(buffer));
    return {
      url,
      downloadUrl: url,
      publicId: `signed-${uploadCount}`,
      resourceType: 'raw',
      format: 'pdf',
      bytes: buffer.length,
      originalName: options.fileName || `signed-${uploadCount}.pdf`,
      mimeType: 'application/pdf',
      renderedAt: new Date()
    };
  };
  pdfService.downloadPdfBuffer = async (url) => {
    if (!memoryFiles.has(url)) throw new Error(`Missing memory PDF ${url}`);
    return Buffer.from(memoryFiles.get(url));
  };
  emailService.sendEmail = async (payload) => {
    resetEmails.push(payload);
    return { skipped: true };
  };
  onboardingEmailService.sendEnvelopeCompleted = async () => ({ skipped: true });
  onboardingEmailService.sendEnvelopeSignerNotification = async () => ({ skipped: true });

  return () => {
    storageService.uploadBuffer = original.uploadBuffer;
    pdfService.downloadPdfBuffer = original.downloadPdfBuffer;
    emailService.sendEmail = original.sendEmail;
    onboardingEmailService.sendEnvelopeCompleted = original.sendEnvelopeCompleted;
    onboardingEmailService.sendEnvelopeSignerNotification = original.sendEnvelopeSignerNotification;
  };
}

function startApp() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/candidate-portal', require('../routes/candidatePortal'));
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

async function request(baseUrl, path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function seedTransition(memoryFiles) {
  const user = await User.create({
    email: 'hr.integration@example.com',
    password: 'not-used-in-test',
    profile: { firstName: 'HR', lastName: 'Verifier' }
  });
  const organization = await Organization.create({
    name: 'Transition Integration Org',
    owner: user._id,
    members: [{ user: user._id, role: 'owner' }]
  });
  const candidate = await Candidate.create({
    firstName: 'Ava',
    lastName: 'Stone',
    email: 'ava.integration@example.com',
    phone: '08001112222',
    position: 'Operations Associate',
    experience: '3-5',
    education: 'bachelors',
    organization: organization._id,
    status: 'New'
  });
  const account = await CandidateAccount.create({
    email: candidate.email,
    passwordHash: await bcrypt.hash('Password123!', 8),
    profile: {
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      phone: candidate.phone
    },
    linkedCandidates: [{ candidate: candidate._id, organization: organization._id }],
    status: 'active',
    refreshTokenVersion: 1
  });
  const onboarding = await CandidateOnboarding.create({
    organization: organization._id,
    candidate: candidate._id,
    candidateAccount: account._id,
    processType: 'onboarding',
    status: 'in_progress',
    title: 'Ava Stone onboarding',
    startedBy: user._id
  });
  const form = await OnboardingFormSubmission.create({
    organization: organization._id,
    onboarding: onboarding._id,
    candidate: candidate._id,
    candidateAccount: account._id,
    title: 'Candidate biodata',
    status: 'draft',
    templateSnapshot: {
      fields: [{
        id: 'phone',
        key: 'phone',
        label: 'Phone number',
        type: 'phone',
        required: true,
        sensitive: false,
        order: 1
      }]
    }
  });

  const bioSource = await OnboardingDocument.create({
    organization: organization._id,
    title: 'Bank account information',
    sourceType: 'uploaded_pdf',
    status: 'sent',
    originalFile: { url: 'memory://source/bio', downloadUrl: 'memory://source/bio', mimeType: 'application/pdf' },
    createdBy: user._id
  });
  const agreementSource = await OnboardingDocument.create({
    organization: organization._id,
    title: 'Employment agreement',
    sourceType: 'uploaded_pdf',
    status: 'sent',
    originalFile: { url: 'memory://source/agreement', downloadUrl: 'memory://source/agreement', mimeType: 'application/pdf' },
    createdBy: user._id
  });
  memoryFiles.set('memory://source/bio', await createBasePdf('Bank account information'));
  memoryFiles.set('memory://source/agreement', await createBasePdf('Employment agreement'));

  const bioDocumentId = objectId();
  const agreementDocumentId = objectId();
  const envelope = await OnboardingEnvelope.create({
    organization: organization._id,
    onboarding: onboarding._id,
    candidate: candidate._id,
    title: 'Ava Stone onboarding packet',
    status: 'sent',
    createdBy: user._id,
    sentAt: new Date(),
    documents: [
      {
        _id: bioDocumentId,
        document: bioSource._id,
        title: bioSource.title,
        status: 'pending',
        signatureFields: [{
          id: 'bankDetails',
          role: 'candidate',
          type: 'text',
          label: 'Bank account details',
          placeholder: 'Account name and number',
          multiline: true,
          page: 1,
          x: 0.12,
          y: 0.28,
          width: 0.62,
          height: 0.12,
          required: true
        }]
      },
      {
        _id: agreementDocumentId,
        document: agreementSource._id,
        title: agreementSource.title,
        status: 'pending',
        signatureFields: [
          {
            id: 'emergencyContact',
            role: 'candidate',
            type: 'text',
            label: 'Emergency contact',
            placeholder: 'Name and phone number',
            page: 1,
            x: 0.12,
            y: 0.3,
            width: 0.55,
            height: 0.06,
            required: true
          },
          {
            id: 'candidateSignature',
            role: 'candidate',
            type: 'signature',
            label: 'Candidate signature',
            page: 1,
            x: 0.12,
            y: 0.48,
            width: 0.38,
            height: 0.1,
            required: true
          }
        ]
      }
    ],
    signers: [{
      key: 'candidate',
      role: 'candidate',
      name: 'Ava Stone',
      email: candidate.email,
      order: 1,
      candidateAccount: account._id,
      status: 'pending'
    }]
  });
  const formItem = await OnboardingWorkflowItem.create({
    organization: organization._id,
    onboarding: onboarding._id,
    type: 'form',
    title: 'Complete candidate biodata',
    status: 'pending',
    ownerType: 'candidate',
    order: 1,
    sourceType: 'form_submission',
    sourceId: form._id
  });
  const documentItem = await OnboardingWorkflowItem.create({
    organization: organization._id,
    onboarding: onboarding._id,
    type: 'document',
    title: 'Review and complete onboarding documents',
    status: 'pending',
    ownerType: 'candidate',
    order: 2,
    sourceType: 'envelope',
    sourceId: envelope._id
  });

  onboarding.forms = [form._id];
  onboarding.envelopes = [envelope._id];
  onboarding.documents = [bioSource._id, agreementSource._id];
  onboarding.workflowItems = [formItem._id, documentItem._id];
  await onboarding.save();

  return {
    account,
    candidate,
    onboarding,
    form,
    envelope,
    bioDocumentId: bioDocumentId.toString(),
    agreementDocumentId: agreementDocumentId.toString()
  };
}

async function closeServer(server) {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
}

async function main() {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'candidate-portal-integration-secret';
  process.env.CANDIDATE_JWT_TTL = '5m';
  process.env.CANDIDATE_REFRESH_TTL = '30m';

  const memoryFiles = new Map();
  const resetEmails = [];
  const restoreServices = patchExternalServices(memoryFiles, resetEmails);
  let mongoServer;
  let appServer;

  try {
    mongoServer = await MongoMemoryServer.create({
      instance: { dbName: 'candidate-portal-integration' }
    });
    await mongoose.connect(mongoServer.getUri(), {
      serverSelectionTimeoutMS: 5000
    });

    const seeded = await seedTransition(memoryFiles);
    const app = await startApp();
    appServer = app.server;

    const initialLogin = await request(app.baseUrl, '/api/candidate-portal/auth/login', {
      method: 'POST',
      body: { email: seeded.account.email, password: 'Password123!' }
    });
    assert.equal(initialLogin.response.status, 200, `initial login failed: ${JSON.stringify(initialLogin.payload)}`);

    const unknownReset = await request(app.baseUrl, '/api/candidate-portal/auth/forgot-password', {
      method: 'POST',
      body: { email: 'missing-candidate@example.com' }
    });
    assert.equal(unknownReset.response.status, 200);
    assert.equal(resetEmails.length, 0, 'unknown accounts must not trigger reset email delivery');

    const forgotPassword = await request(app.baseUrl, '/api/candidate-portal/auth/forgot-password', {
      method: 'POST',
      body: { email: seeded.account.email }
    });
    assert.equal(forgotPassword.response.status, 200, `forgot password failed: ${JSON.stringify(forgotPassword.payload)}`);
    assert.equal(forgotPassword.payload.msg, unknownReset.payload.msg, 'forgot-password responses must not reveal account existence');
    assert.equal(resetEmails.length, 1, 'known candidate account should receive one reset email');
    assert.equal(resetEmails[0].to, seeded.account.email);
    assert.match(resetEmails[0].subject, /candidate portal password/i);
    const resetLinkMatch = resetEmails[0].text.match(/https:\/\/candidate\.seemplifyai\.com\/reset-password\/([a-f0-9]{64})/);
    assert.ok(resetLinkMatch, 'reset email should contain a branded candidate portal reset URL');
    const resetToken = resetLinkMatch[1];

    const repeatedForgotPassword = await request(app.baseUrl, '/api/candidate-portal/auth/forgot-password', {
      method: 'POST',
      body: { email: seeded.account.email }
    });
    assert.equal(repeatedForgotPassword.response.status, 200);
    assert.equal(resetEmails.length, 1, 'reset email delivery should be throttled during the cooldown window');

    const resetState = await CandidateAccount.findById(seeded.account._id)
      .select('+resetPasswordTokenHash +resetPasswordExpiresAt +resetPasswordRequestedAt');
    const expectedTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    assert.equal(resetState.resetPasswordTokenHash, expectedTokenHash, 'only the reset token hash should be stored');
    assert.notEqual(resetState.resetPasswordTokenHash, resetToken, 'raw reset tokens must not be persisted');
    assert.ok(resetState.resetPasswordExpiresAt > new Date(), 'reset token should have a future expiry');

    const invalidReset = await request(app.baseUrl, '/api/candidate-portal/auth/reset-password', {
      method: 'POST',
      body: { token: 'invalid-token', password: 'UpdatedPassword123!' }
    });
    assert.equal(invalidReset.response.status, 400);

    const passwordReset = await request(app.baseUrl, '/api/candidate-portal/auth/reset-password', {
      method: 'POST',
      body: { token: resetToken, password: 'UpdatedPassword123!' }
    });
    assert.equal(passwordReset.response.status, 200, `password reset failed: ${JSON.stringify(passwordReset.payload)}`);

    const consumedResetState = await CandidateAccount.findById(seeded.account._id)
      .select('+resetPasswordTokenHash +resetPasswordExpiresAt +resetPasswordRequestedAt');
    assert.equal(consumedResetState.resetPasswordTokenHash, undefined, 'reset token must be cleared after use');
    assert.equal(consumedResetState.resetPasswordExpiresAt, undefined, 'reset expiry must be cleared after use');
    assert.equal(consumedResetState.refreshTokenVersion, 2, 'reset must invalidate existing candidate sessions');

    const reusedReset = await request(app.baseUrl, '/api/candidate-portal/auth/reset-password', {
      method: 'POST',
      body: { token: resetToken, password: 'AnotherPassword123!' }
    });
    assert.equal(reusedReset.response.status, 400, 'reset token must be single-use');

    const oldPasswordLogin = await request(app.baseUrl, '/api/candidate-portal/auth/login', {
      method: 'POST',
      body: { email: seeded.account.email, password: 'Password123!' }
    });
    assert.equal(oldPasswordLogin.response.status, 400, 'old password must stop working after reset');

    const login = await request(app.baseUrl, '/api/candidate-portal/auth/login', {
      method: 'POST',
      body: { email: seeded.account.email, password: 'UpdatedPassword123!' }
    });
    assert.equal(login.response.status, 200, `login with reset password failed: ${JSON.stringify(login.payload)}`);
    assert.ok(login.payload.token, 'login should return a candidate token');
    const token = login.payload.token;

    const transitionList = await request(app.baseUrl, '/api/candidate-portal/transitions', { token });
    assert.equal(transitionList.response.status, 200);
    assert.equal(transitionList.payload.data[0].nextAction.type, 'form');
    assert.equal(transitionList.payload.data[0].nextAction.href, `/forms/${seeded.form._id}`);

    const formSubmit = await request(app.baseUrl, `/api/candidate-portal/forms/${seeded.form._id}/submit`, {
      token,
      method: 'POST',
      body: { values: { phone: '0800 111 2222' } }
    });
    assert.equal(formSubmit.response.status, 200, `form submit failed: ${JSON.stringify(formSubmit.payload)}`);
    assert.equal(formSubmit.payload.data.status, 'approved');
    assert.equal(formSubmit.payload.transition.nextAction.type, 'document_fill');
    assert.equal(formSubmit.payload.transition.nextAction.href, `/documents/${seeded.bioDocumentId}/sign`);

    const bioDocument = await request(app.baseUrl, `/api/candidate-portal/documents/${seeded.bioDocumentId}`, { token });
    assert.equal(bioDocument.response.status, 200);
    assert.equal(bioDocument.payload.data.actionType, 'document_fill');
    assert.equal(bioDocument.payload.data.canCompleteFillOnly, true);
    assert.equal(bioDocument.payload.data.nextDocumentId, seeded.agreementDocumentId);

    const missingBioField = await request(app.baseUrl, `/api/candidate-portal/documents/${seeded.bioDocumentId}/complete`, {
      token,
      method: 'POST',
      body: { fieldValues: {} }
    });
    assert.equal(missingBioField.response.status, 400);
    assert.match(missingBioField.payload.msg, /Bank account details is required/);

    const completeBio = await request(app.baseUrl, `/api/candidate-portal/documents/${seeded.bioDocumentId}/complete`, {
      token,
      method: 'POST',
      body: { fieldValues: { bankDetails: 'Ava Stone - 12345678' } }
    });
    assert.equal(completeBio.response.status, 200, `fill-only complete failed: ${JSON.stringify(completeBio.payload)}`);
    assert.equal(completeBio.payload.nextDocumentId, seeded.agreementDocumentId);
    assert.equal(completeBio.payload.transition.nextAction.type, 'document_sign');
    assert.equal(completeBio.payload.transition.nextAction.href, `/documents/${seeded.agreementDocumentId}/sign`);

    let envelope = await OnboardingEnvelope.findById(seeded.envelope._id);
    assert.equal(envelope.documents.id(seeded.bioDocumentId).status, 'completed');
    assert.equal(envelope.signers[0].status, 'viewed', 'candidate signer must not be signed until all candidate documents are done');

    const agreementDocument = await request(app.baseUrl, `/api/candidate-portal/documents/${seeded.agreementDocumentId}`, { token });
    assert.equal(agreementDocument.response.status, 200);
    assert.equal(agreementDocument.payload.data.actionType, 'document_sign');
    assert.equal(agreementDocument.payload.data.canSign, true);

    const missingAgreementField = await request(app.baseUrl, `/api/candidate-portal/documents/${seeded.agreementDocumentId}/sign`, {
      token,
      method: 'POST',
      body: { signatureDataUrl: ONE_PIXEL_PNG, fieldValues: {} }
    });
    assert.equal(missingAgreementField.response.status, 400);
    assert.match(missingAgreementField.payload.msg, /Emergency contact is required/);

    const signAgreement = await request(app.baseUrl, `/api/candidate-portal/documents/${seeded.agreementDocumentId}/sign`, {
      token,
      method: 'POST',
      body: {
        signatureDataUrl: ONE_PIXEL_PNG,
        fieldValues: { emergencyContact: 'Taylor Stone, 0800 333 4444' }
      }
    });
    assert.equal(signAgreement.response.status, 200, `sign failed: ${JSON.stringify(signAgreement.payload)}`);
    assert.equal(signAgreement.payload.nextDocumentId, null);
    assert.equal(signAgreement.payload.transition.status, 'ready_to_provision');
    assert.equal(signAgreement.payload.transition.nextAction.type, 'waiting');

    envelope = await OnboardingEnvelope.findById(seeded.envelope._id);
    assert.equal(envelope.status, 'completed');
    assert.equal(envelope.signers[0].status, 'signed');
    assert.equal(envelope.documents.id(seeded.agreementDocumentId).status, 'completed');
    assert.ok(envelope.documents.id(seeded.bioDocumentId).signedPdf?.url, 'fill-only document should store a stamped PDF');
    assert.ok(envelope.documents.id(seeded.agreementDocumentId).signedPdf?.url, 'signed document should store a stamped PDF');

    const refreshedCandidate = await Candidate.findById(seeded.candidate._id);
    assert.equal(refreshedCandidate.status, 'New', 'candidate must not be marked hired before HR provisions the IDP membership');

    const finalTransition = await request(app.baseUrl, `/api/candidate-portal/transitions/${seeded.onboarding._id}`, { token });
    assert.equal(finalTransition.response.status, 200);
    assert.equal(finalTransition.payload.data.status, 'ready_to_provision');
    assert.equal(finalTransition.payload.data.nextAction.type, 'waiting');

    console.log('Candidate portal integration verified: password recovery, real auth, form submit, fill-only completion, ordered signing, PDF stamping, and HR-controlled provisioning readiness.');
  } finally {
    await closeServer(appServer);
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
    restoreServices();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
