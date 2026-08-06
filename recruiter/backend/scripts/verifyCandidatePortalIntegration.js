const assert = require('node:assert/strict');
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

function patchExternalServices(memoryFiles) {
  const storageService = require('../services/onboardingStorageService');
  const pdfService = require('../services/onboardingPdfService');
  const emailService = require('../services/onboardingEmailService');

  const original = {
    uploadBuffer: storageService.uploadBuffer,
    downloadPdfBuffer: pdfService.downloadPdfBuffer,
    sendEnvelopeCompleted: emailService.sendEnvelopeCompleted,
    sendEnvelopeSignerNotification: emailService.sendEnvelopeSignerNotification
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
  emailService.sendEnvelopeCompleted = async () => ({ skipped: true });
  emailService.sendEnvelopeSignerNotification = async () => ({ skipped: true });

  return () => {
    storageService.uploadBuffer = original.uploadBuffer;
    pdfService.downloadPdfBuffer = original.downloadPdfBuffer;
    emailService.sendEnvelopeCompleted = original.sendEnvelopeCompleted;
    emailService.sendEnvelopeSignerNotification = original.sendEnvelopeSignerNotification;
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
  const restoreServices = patchExternalServices(memoryFiles);
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

    const login = await request(app.baseUrl, '/api/candidate-portal/auth/login', {
      method: 'POST',
      body: { email: seeded.account.email, password: 'Password123!' }
    });
    assert.equal(login.response.status, 200, `login failed: ${JSON.stringify(login.payload)}`);
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
    assert.equal(signAgreement.payload.transition.nextAction.type, 'complete');

    envelope = await OnboardingEnvelope.findById(seeded.envelope._id);
    assert.equal(envelope.status, 'completed');
    assert.equal(envelope.signers[0].status, 'signed');
    assert.equal(envelope.documents.id(seeded.agreementDocumentId).status, 'completed');
    assert.ok(envelope.documents.id(seeded.bioDocumentId).signedPdf?.url, 'fill-only document should store a stamped PDF');
    assert.ok(envelope.documents.id(seeded.agreementDocumentId).signedPdf?.url, 'signed document should store a stamped PDF');

    const refreshedCandidate = await Candidate.findById(seeded.candidate._id);
    assert.equal(refreshedCandidate.status, 'Hired');

    const finalTransition = await request(app.baseUrl, `/api/candidate-portal/transitions/${seeded.onboarding._id}`, { token });
    assert.equal(finalTransition.response.status, 200);
    assert.equal(finalTransition.payload.data.status, 'completed');
    assert.equal(finalTransition.payload.data.nextAction.type, 'complete');

    console.log('Candidate portal integration verified: real auth, form submit, fill-only completion, ordered signing, PDF stamping, and completion.');
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
