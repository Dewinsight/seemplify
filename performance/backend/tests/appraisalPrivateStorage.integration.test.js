'use strict';
// Real appraisal routes, authorization, Mongo records and Cloudinary signing.
// Upload/delete transport is a named substitute; no provider is contacted.
jest.mock('../services/platformConfigurationClient', () => ({ resolveStoragePlatformConfiguration: jest.fn(async () => ({
  configured: true, defaultProvider: 'cloudinary', providers: { cloudinary: {
    configured: true, cloudName: 'synthetic-cloud', apiKey: 'synthetic-key', apiSecret: 'synthetic-secret'
  } }
})) }));
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { Writable } = require('node:stream');
const cloudinary = require('cloudinary').v2;
const Appraisal = require('../models/Appraisal');
const Cycle = require('../models/AppraisalCycle');
const Document = require('../models/AppraisalDocument');
const routes = require('../routes/appraisals');
const ai = require('../services/appraisalAIService');
const gateway = require('../services/aiGatewayService');
const account = require('../services/chatGptAccountService');
let app, mongo, appraisal;
const org = 'private-storage-acceptance';
const actor = name => ({ id: name, sub: name, name: `Synthetic ${name}`, email: `${name}@example.test`,
  currentOrganization: { id: name === 'foreign' ? 'other-organization' : org, role: name === 'hr' ? 'hr_manager' : 'staff', appAccess: { mode: 'all', appIds: [] } },
  organizations: [{ id: name === 'foreign' ? 'other-organization' : org, role: name === 'hr' ? 'hr_manager' : 'staff', appAccess: { mode: 'all', appIds: [] } }],
  idpTeams: [{ id: 'attachment-team', organizationId: org, role: name === 'manager' ? 'line_manager' : 'member', directReports: name === 'manager' ? ['employee'] : [] }] });
const call = (method, suffix, who = 'employee') => request(app)[method](`/api/appraisals/${appraisal._id}${suffix}`).set('x-storage-actor', who);
async function document(values = {}) {
  return Document.create({ appraisalId: appraisal._id, organizationId: org, fileName: 'server-private-key.txt', originalName: 'synthetic.txt',
    fileType: 'txt', mimeType: 'text/plain', storageProvider: 'cloudinary', storageKey: 'server-private-key.txt', storageResourceType: 'raw',
    storageDeliveryType: 'authenticated', storageFormat: 'txt', visibility: 'employee_only', uploadedBy: { userId: 'employee', role: 'employee' }, ...values });
}
beforeAll(async () => {
  mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri());
  app = express(); app.use(express.json());
  app.use((req, _res, next) => { const who = req.get('x-storage-actor') || 'employee'; if (who !== 'anonymous') {
    const user = actor(who); req.session = { user, currentOrganizationId: user.currentOrganization.id };
  } next(); });
  app.use('/api/appraisals', routes);
});
beforeEach(async () => {
  await mongoose.connection.db.dropDatabase();
  const cycle = await Cycle.create({ organizationId: org, name: 'Synthetic private documents', status: 'active', periodStart: '2026-01-01',
    periodEnd: '2026-12-31', createdBy: { userId: 'manager' }, settings: { enableAiAssist: false, requireOkrAlignment: false } });
  appraisal = await Appraisal.create({ organizationId: org, cycleId: cycle._id, employee: { userId: 'employee', name: 'Synthetic employee', email: 'employee@example.test' },
    manager: { userId: 'manager', name: 'Synthetic manager', email: 'manager@example.test' }, status: 'self_assessment_pending' });
});
afterEach(() => jest.restoreAllMocks());
afterAll(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });

test('content authorization precedes fresh five-minute signing; foreign, anonymous and unrelated actors never sign', async () => {
  const source = await document(); const sign = jest.spyOn(cloudinary.utils, 'private_download_url');
  for (const [who, code] of [['anonymous', 401], ['foreign', 404], ['outsider', 403]]) {
    await call('get', `/documents/${source._id}/content`, who).expect(code);
  }
  expect(sign).not.toHaveBeenCalled();
  const now = jest.spyOn(Date, 'now').mockReturnValue(1800000000000);
  const first = await call('get', `/documents/${source._id}/content`).expect(302);
  expect(first.headers['cache-control']).toBe('private, no-store'); expect(first.headers['referrer-policy']).toBe('no-referrer');
  const url = new URL(first.headers.location); expect(url.pathname).toBe('/v1_1/synthetic-cloud/raw/download');
  expect(url.searchParams.get('public_id')).toBe('server-private-key.txt'); expect(url.searchParams.get('type')).toBe('authenticated');
  expect(url.searchParams.get('expires_at')).toBe('1800000300'); expect(url.searchParams.has('format')).toBe(false);
  expect(url.searchParams.get('signature')).toMatch(/^[a-f0-9]+$/);
  now.mockReturnValue(1800000600000);
  const next = await call('get', `/documents/${source._id}/content`).expect(302);
  expect(new URL(next.headers.location).searchParams.get('expires_at')).toBe('1800000900');
  expect(next.headers.location).not.toBe(first.headers.location);
});

test('legacy Azure and public Cloudinary contents retain original URL after central default switch', async () => {
  const sign = jest.spyOn(cloudinary.utils, 'private_download_url');
  for (const [provider, url] of [['azure-blob', 'https://synthetic.blob.core.windows.net/original/file?synthetic-sas'],
    ['cloudinary', 'https://res.cloudinary.com/synthetic/image/upload/original.pdf']]) {
    const source = await document({ storageProvider: provider, storageUrl: url, storageDeliveryType: undefined });
    const response = await call('get', `/documents/${source._id}/content`).expect(302); expect(response.headers.location).toBe(url);
  }
  expect(sign).not.toHaveBeenCalled();
});

test('ordinary upload persists private snapshot but upload/detail/appraisal JSON contain no provider keys or links', async () => {
  const upload = jest.spyOn(cloudinary.uploader, 'upload_stream').mockImplementation((options, done) => {
    const parts = []; return new Writable({ write(chunk, _encoding, callback) { parts.push(chunk); callback(); }, final(callback) {
      done(null, { public_id: options.public_id, resource_type: 'raw', type: 'authenticated', bytes: Buffer.concat(parts).length,
        secure_url: 'https://res.cloudinary.com/synthetic/raw/authenticated/not-for-the-client' }); callback();
    } });
  });
  const response = await call('post', '/documents').attach('file', Buffer.from('Synthetic plain text evidence.'), { filename: 'evidence.txt', contentType: 'text/plain' }).expect(201);
  expect(upload).toHaveBeenCalledTimes(1); const source = await Document.findById(response.body.data._id);
  expect(source.storageDeliveryType).toBe('authenticated'); expect(source.storageResourceType).toBe('raw'); expect(source.storageFormat).toBe('txt');
  expect(source.storageKey).toMatch(/\.txt$/); expect(source.storageUrl).toBeUndefined();
  for (const value of [response.body.data, (await call('get', `/documents/${source._id}`).expect(200)).body.data,
    JSON.parse(JSON.stringify(await Appraisal.findById(appraisal._id).populate('documents'))).documents[0]]) {
    for (const key of ['storageKey', 'storagePath', 'fileName', 'storageUrl', 'publicUrl', 'storageDeliveryType', 'storageFormat']) expect(value[key]).toBeUndefined();
  }
  expect(source.toObject().storageKey).toBe(source.storageKey);
});

test('manual uploads preserve exact private bytes and evidence requirements without AI; content and delete retain authorization', async () => {
  await Cycle.updateOne({ _id: appraisal.cycleId }, { $set: { 'settings.enableAiAssist': true, 'settings.requireDocumentUpload': true } });
  const provider = jest.spyOn(ai, 'analyzeDocument').mockImplementation(() => new Promise(() => {}));
  const bytes = Buffer.from('Synthetic manual evidence describes completed work without requesting any AI analysis. '.repeat(4));
  let storedBytes;
  const upload = jest.spyOn(cloudinary.uploader, 'upload_stream').mockImplementation((options, done) => {
    const parts = []; return new Writable({ write(chunk, _encoding, callback) { parts.push(chunk); callback(); }, final(callback) {
      storedBytes = Buffer.concat(parts);
      done(null, { public_id: options.public_id, resource_type: 'raw', type: 'authenticated', bytes: storedBytes.length }); callback();
    } });
  });
  const selfAssessment = { overallSummary: { achievements: 'Delivered the fictional project with documented evidence.',
    challenges: 'Resolved the invented dependency through clear planning.', learnings: 'Applied a structured approach to synthetic work.',
    goals: 'Complete the next fictional milestone with measured evidence.' } };
  const missing = await call('post', '/self-assessment').send({ assessmentMode: 'form', submit: true, selfAssessment }).expect(400);
  expect(missing.body.error).toMatch(/evidence document is required/);
  const uploaded = await call('post', '/documents').field('assessmentMode', 'form').field('visibility', 'employee_manager')
    .attach('file', bytes, { filename: 'manual-evidence.txt', contentType: 'text/plain' }).expect(201);
  expect(storedBytes).toEqual(bytes);
  expect(upload).toHaveBeenCalledTimes(1);
  const source = await Document.findById(uploaded.body.data._id);
  expect(source.storageDeliveryType).toBe('authenticated');
  expect(source.textExtraction).toMatchObject({ status: 'completed', extractedText: bytes.toString('utf8') });
  expect(source.aiAnalysis.status).toBe('skipped');
  expect(provider).not.toHaveBeenCalled();
  expect((await Appraisal.findById(appraisal._id)).documents.map(String)).toEqual([String(source._id)]);
  for (const key of ['storageKey', 'storageUrl', 'storagePath', 'fileName']) expect(uploaded.body.data[key]).toBeUndefined();
  const sign = jest.spyOn(cloudinary.utils, 'private_download_url');
  for (const [who, status] of [['anonymous', 401], ['foreign', 404], ['outsider', 403]]) {
    await call('get', `/documents/${source._id}/content`, who).expect(status);
  }
  expect(sign).not.toHaveBeenCalled();
  await call('get', `/documents/${source._id}/content`, 'manager').expect(302);
  expect(sign).toHaveBeenCalledTimes(1);
  const destroy = jest.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' });
  await call('delete', `/documents/${source._id}`, 'outsider').expect(403);
  expect(destroy).not.toHaveBeenCalled();
  await call('delete', `/documents/${source._id}`).expect(200);
  expect(destroy).toHaveBeenCalledWith(source.storageKey, expect.objectContaining({ resource_type: 'raw', type: 'authenticated' }));
  await call('get', `/documents/${source._id}/content`).expect(404);
  expect((await Appraisal.findById(appraisal._id)).documents).toHaveLength(0);
  await call('post', '/self-assessment').send({ assessmentMode: 'form', submit: true, selfAssessment }).expect(400);
  expect(provider).not.toHaveBeenCalled();
});

test('manual mode cannot bypass upload authorization or missing-file checks, and provider failure preserves a safe empty record state', async () => {
  await Cycle.updateOne({ _id: appraisal.cycleId }, { $set: { 'settings.enableAiAssist': true } });
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const provider = jest.spyOn(ai, 'analyzeDocument').mockImplementation(() => new Promise(() => {}));
  const upload = jest.spyOn(cloudinary.uploader, 'upload_stream').mockImplementation((_options, done) => new Writable({
    write(_chunk, _encoding, callback) { callback(); }, final(callback) { done(new Error('PRIVATE_PROVIDER_FAILURE')); callback(); }
  }));
  for (const [who, status] of [['anonymous', 401], ['foreign', 404], ['outsider', 403]]) {
    await call('post', '/documents', who).field('assessmentMode', 'form')
      .attach('file', Buffer.from('Synthetic document.'), { filename: 'manual.txt', contentType: 'text/plain' }).expect(status);
  }
  await call('post', '/documents').field('assessmentMode', 'form').expect(400);
  await call('post', '/documents').field('assessmentMode', 'form').field('visibility', 'hr_only')
    .attach('file', Buffer.from('Synthetic document.'), { filename: 'manual.txt', contentType: 'text/plain' }).expect(403);
  expect(upload).not.toHaveBeenCalled();
  const failed = await call('post', '/documents').field('assessmentMode', 'form')
    .attach('file', Buffer.from('Synthetic document.'), { filename: 'manual.txt', contentType: 'text/plain' }).expect(500);
  expect(failed.body).toEqual({ success: false, error: 'Failed to upload document' });
  expect(upload).toHaveBeenCalledTimes(1);
  expect(await Document.countDocuments()).toBe(0);
  expect((await Appraisal.findById(appraisal._id)).documents).toHaveLength(0);
  expect(provider).not.toHaveBeenCalled();
});

test('delete passes captured authenticated type and cannot be repeated by unrelated actors', async () => {
  const source = await document(); appraisal.documents.push(source._id); await appraisal.save();
  const destroy = jest.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' });
  await call('delete', `/documents/${source._id}`, 'outsider').expect(403); expect(destroy).not.toHaveBeenCalled();
  await call('delete', `/documents/${source._id}`).expect(200);
  expect(destroy).toHaveBeenCalledWith('server-private-key.txt', expect.objectContaining({ resource_type: 'raw', type: 'authenticated', invalidate: true }));
  await call('get', `/documents/${source._id}/content`).expect(404);
  expect((await Document.findById(source._id)).status).toBe('deleted');
});

test('database failure after private upload deletes the captured authenticated snapshot without a storage URL', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(cloudinary.uploader, 'upload_stream').mockImplementation((options, done) => new Writable({
    write(_chunk, _encoding, callback) { callback(); },
    final(callback) { done(null, { public_id: options.public_id, resource_type: 'raw', type: 'authenticated', bytes: 28 }); callback(); }
  }));
  jest.spyOn(Document.prototype, 'save').mockRejectedValueOnce(new Error('Synthetic database failure'));
  const destroy = jest.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' });
  await call('post', '/documents').attach('file', Buffer.from('Synthetic persistence failure'), { filename: 'evidence.txt', contentType: 'text/plain' }).expect(500);
  expect(destroy).toHaveBeenCalledWith(expect.stringMatching(/\.txt$/), expect.objectContaining({ type: 'authenticated', resource_type: 'raw' }));
  expect(await Document.countDocuments()).toBe(0);
});

async function mixedDocuments() {
  const definitions = [
    ['private', { visibility: 'employee_only' }], ['shared', { visibility: 'employee_manager' }],
    ['hr', { visibility: 'hr_only' }], ['deleted', { status: 'deleted' }],
    ['foreign', { organizationId: 'another-organization' }], ['wrong-parent', { appraisalId: new mongoose.Types.ObjectId() }]
  ];
  const sources = [];
  for (const [name, values] of definitions) sources.push(await document({ ...values, originalName: `${name}.txt`,
    textExtraction: { status: 'completed', extractedText: `Synthetic confidential marker ${name}` } }));
  appraisal.documents = sources.map(source => source._id); await appraisal.save(); return sources;
}

test.each([['employee', ['private.txt', 'shared.txt']], ['manager', ['shared.txt']], ['hr', ['shared.txt', 'hr.txt']]])(
  '%s parent and conversation visibility matches content access without losing stored document references', async (who, expectedNames) => {
    const sources = await mixedDocuments();
    for (const suffix of ['', '/conversation/context']) {
      const response = await call('get', suffix, who).expect(200);
      const visible = response.body.data.documents;
      expect(visible.map(source => source.originalName).sort()).toEqual([...expectedNames].sort());
      for (const source of sources.filter(source => !expectedNames.includes(source.originalName))) {
        expect(JSON.stringify(response.body)).not.toContain(source.textExtraction.extractedText);
      }
      for (const source of visible) for (const key of ['storageKey', 'storageUrl', 'storagePath']) expect(source[key]).toBeUndefined();
    }
    for (const source of sources) {
      const excludedRecord = ['deleted.txt', 'foreign.txt', 'wrong-parent.txt'].includes(source.originalName);
      await call('get', `/documents/${source._id}/content`, who).expect(excludedRecord ? 404 : expectedNames.includes(source.originalName) ? 302 : 403);
    }
    expect((await Appraisal.findById(appraisal._id)).documents.map(String)).toEqual(sources.map(source => String(source._id)));
  }
);

test('generated employee report receives only visible same-parent same-tenant documents and preserves hidden refs on save', async () => {
  const sources = await mixedDocuments();
  await Cycle.updateOne({ _id: appraisal.cycleId }, { $set: { 'settings.enableAiAssist': true } });
  await Appraisal.updateOne({ _id: appraisal._id }, { $set: { status: 'self_assessment_in_progress',
    'conversationAssessment.startedAt': new Date(), 'conversationAssessment.currentPhase': 'achievements',
    chatThread: [{ sender: { userId: 'employee', name: 'Synthetic employee', role: 'employee' }, message: 'Synthetic evidence discussion.', messageType: 'text' }] } });
  jest.spyOn(gateway, 'policy').mockResolvedValue({ chatgptEnabled: true });
  jest.spyOn(account, 'readAccount').mockResolvedValue({ isRoutable: () => true });
  const generate = jest.spyOn(ai, 'generateSelfAssessmentReport').mockResolvedValue({ overallSummary: { achievements: 'Synthetic result' }, missingInfo: [], tokensUsed: 0 });
  await call('post', '/conversation/generate-report').send({}).expect(200);
  expect(generate).toHaveBeenCalledTimes(1);
  const [context, , documents] = generate.mock.calls[0];
  expect(documents.map(source => source.originalName).sort()).toEqual(['private.txt', 'shared.txt']);
  expect(context.documents.map(source => source.originalName).sort()).toEqual(['private.txt', 'shared.txt']);
  for (const source of sources.filter(source => !['private.txt', 'shared.txt'].includes(source.originalName))) {
    expect(JSON.stringify([context, documents])).not.toContain(source.textExtraction.extractedText);
  }
  expect((await Appraisal.findById(appraisal._id)).documents.map(String)).toEqual(sources.map(source => String(source._id)));
});

const manualSummary = { achievements: 'Delivered the fictional project with documented evidence.',
  challenges: 'Resolved an invented delivery dependency through planning.', learnings: 'Applied a structured method to synthetic work.',
  goals: 'Complete the next fictional milestone with measured evidence.' };
async function requireSectionEvidence(role) {
  await Cycle.updateOne({ _id: appraisal.cycleId }, { $set: { 'settings.enableAiAssist': true } });
  await Appraisal.updateOne({ _id: appraisal._id }, { $set: {
    status: role === 'manager' ? 'manager_review_pending' : 'self_assessment_pending',
    ...(role === 'manager' ? { 'selfAssessment.submittedAt': new Date() } : {}),
    cycleConfigurationSnapshot: { workflowDefinition: { version: 1, sections: [{ id: 'proof', title: 'Required proof', type: 'custom',
      respondent: role, required: true, evidenceRequired: true,
      questions: [{ id: 'example', prompt: 'Describe the supporting example.', responseType: 'long_text', required: true }] }] } },
    customResponses: [{ sectionId: 'proof', questionId: 'example', respondentRole: role, respondentId: role,
      value: 'Synthetic work has a documented supporting example.' }]
  } });
}
function submitAssessment(role) {
  return role === 'employee'
    ? call('post', '/self-assessment').send({ assessmentMode: 'form', submit: true, selfAssessment: { overallSummary: manualSummary, overallSelfRating: 4 } })
    : call('post', '/manager-review', 'manager').send({ assessmentMode: 'form', submit: true, managerReview: { overallManagerRating: 4 } });
}
const hiddenEvidenceCases = ['private', 'deleted', 'foreign', 'wrong-parent', 'stale'];
test.each(['employee', 'manager'].flatMap(role => hiddenEvidenceCases.map(kind => [role, kind])))(
  '%s required evidence rejects %s documents in custom and assessment submission without AI or reference changes', async (role, kind) => {
    await requireSectionEvidence(role);
    const source = kind === 'stale' ? { _id: new mongoose.Types.ObjectId() } : await document({
      visibility: kind === 'private' ? role === 'employee' ? 'hr_only' : 'employee_only' : 'employee_manager',
      ...(kind === 'deleted' ? { status: 'deleted' } : {}),
      ...(kind === 'foreign' ? { organizationId: 'foreign-org' } : {}),
      ...(kind === 'wrong-parent' ? { appraisalId: new mongoose.Types.ObjectId() } : {})
    });
    await Appraisal.updateOne({ _id: appraisal._id }, { $set: { documents: [source._id] } });
    const analyze = jest.spyOn(ai, 'analyzeSelfAssessment').mockResolvedValue({});
    const bias = jest.spyOn(ai, 'checkForBias').mockResolvedValue({});
    const custom = await call('put', '/custom-responses', role).send({ respondentRole: role, submit: true, responses: [] }).expect(400);
    expect(custom.body.missingQuestions).toContain('Required proof: attach supporting evidence');
    const result = await submitAssessment(role).expect(400);
    expect(result.body.missingQuestions).toContain('Required proof: attach supporting evidence');
    if (role === 'employee') {
      const conversation = await call('post', '/conversation/finalize-report').send({ report: { overallSummary: manualSummary, overallSelfRating: 4 } }).expect(400);
      expect(conversation.body.missingQuestions).toContain('Required proof: attach supporting evidence');
    }
    const stored = await Appraisal.findById(appraisal._id);
    expect(stored.documents.map(String)).toEqual([String(source._id)]);
    expect(stored.customResponses[0].submittedAt).toBeUndefined();
    expect(stored.managerReview.submittedAt).toBeUndefined();
    if (role === 'employee') expect(stored.selfAssessment.submittedAt).toBeUndefined();
    expect(analyze).not.toHaveBeenCalled(); expect(bias).not.toHaveBeenCalled();
  }
);

test.each(['employee', 'manager'])('%s can submit with shared evidence while every hidden document reference stays stored', async role => {
  await requireSectionEvidence(role);
  const sources = await mixedDocuments();
  const originalIds = sources.map(source => String(source._id));
  const analyze = jest.spyOn(ai, 'analyzeSelfAssessment').mockResolvedValue({});
  const bias = jest.spyOn(ai, 'checkForBias').mockResolvedValue({});
  await call('put', '/custom-responses', role).send({ respondentRole: role, submit: true, responses: [] }).expect(200);
  await submitAssessment(role).expect(200);
  const stored = await Appraisal.findById(appraisal._id);
  expect(stored.documents.map(String)).toEqual(originalIds);
  expect(stored.customResponses[0].submittedAt).toBeInstanceOf(Date);
  expect(role === 'employee' ? stored.selfAssessment.submittedAt : stored.managerReview.submittedAt).toBeInstanceOf(Date);
  expect(analyze).not.toHaveBeenCalled(); expect(bias).not.toHaveBeenCalled();
});

test('conversation submission accepts shared evidence without dropping hidden references', async () => {
  await requireSectionEvidence('employee');
  const sources = await mixedDocuments();
  const analyze = jest.spyOn(ai, 'analyzeSelfAssessment').mockResolvedValue({});
  await call('post', '/conversation/finalize-report').send({ report: { overallSummary: manualSummary, overallSelfRating: 4 } }).expect(200);
  const stored = await Appraisal.findById(appraisal._id);
  expect(stored.selfAssessment.submittedAt).toBeInstanceOf(Date);
  expect(stored.documents.map(String)).toEqual(sources.map(source => String(source._id)));
  expect(analyze).toHaveBeenCalledTimes(1);
});

test.each(['/self-assessment', '/conversation/finalize-report'])('%s requires a visible real document for the global upload rule', async endpoint => {
  await Cycle.updateOne({ _id: appraisal.cycleId }, { $set: { 'settings.requireDocumentUpload': true } });
  const hidden = await document({ visibility: 'hr_only' });
  await Appraisal.updateOne({ _id: appraisal._id }, { $set: { documents: [hidden._id] } });
  const payload = endpoint === '/self-assessment'
    ? { assessmentMode: 'form', submit: true, selfAssessment: { overallSummary: manualSummary, overallSelfRating: 4 } }
    : { report: { overallSummary: manualSummary, overallSelfRating: 4 } };
  const rejected = await call('post', endpoint).send(payload).expect(400);
  expect(rejected.body.error).toMatch(/evidence document is required/);
  const shared = await document({ visibility: 'employee_manager' });
  await Appraisal.updateOne({ _id: appraisal._id }, { $push: { documents: shared._id } });
  await call('post', endpoint).send(payload).expect(200);
  expect((await Appraisal.findById(appraisal._id)).documents.map(String)).toEqual([String(hidden._id), String(shared._id)]);
});

test('assessment actor and tenant authorization precede document requirement lookups', async () => {
  await requireSectionEvidence('employee');
  const source = await document({ visibility: 'employee_manager' });
  await Appraisal.updateOne({ _id: appraisal._id }, { $set: { documents: [source._id] } });
  const find = jest.spyOn(Document, 'find');
  const analyze = jest.spyOn(ai, 'analyzeSelfAssessment').mockResolvedValue({});
  for (const [who, status] of [['outsider', 403], ['foreign', 404]]) {
    await call('put', '/custom-responses', who).send({ respondentRole: 'employee', submit: true, responses: [] }).expect(status);
    await call('post', '/self-assessment', who).send({ submit: true, selfAssessment: { overallSummary: manualSummary } }).expect(status);
    await call('post', '/conversation/finalize-report', who).send({ report: { overallSummary: manualSummary } }).expect(status);
    await call('post', '/manager-review', who).send({ submit: true, managerReview: {} }).expect(status);
  }
  expect(find).not.toHaveBeenCalled(); expect(analyze).not.toHaveBeenCalled();
});
