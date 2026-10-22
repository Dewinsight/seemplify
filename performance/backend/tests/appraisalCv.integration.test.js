'use strict';
// Real routes, permissions, Mongo persistence, TXT extraction and evidence collection.
// The named Cloudinary transport substitute retains fictional bytes; no provider is contacted.
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
const CompetencyAssessment = require('../models/CompetencyAssessment');
const evidence = require('../services/appraisalAnalysisEvidenceService');
const ai = require('../services/appraisalAIService');
const extraction = require('../services/documentExtractionService');
const org = 'ordinary-cv-acceptance';
let mongo, app, appraisal, transport, bytesStored;
const bytes = Buffer.from('Jordan Ellis. Fictional CV: product delivery, planning, stakeholder collaboration and measurable service improvements. '.repeat(3));
const actor = who => ({ id: who, sub: who, name: `Fictional ${who}`, email: `${who}@example.test`,
  currentOrganization: { id: who === 'foreign' ? 'foreign-org' : org, role: 'staff', appAccess: { mode: 'all', appIds: [] } },
  organizations: [{ id: who === 'foreign' ? 'foreign-org' : org, role: 'staff', appAccess: { mode: 'all', appIds: [] } }],
  idpTeams: [{ id: 'cv-team', organizationId: org, role: who === 'manager' ? 'line_manager' : 'member', directReports: who === 'manager' ? ['employee'] : [] }] });
const call = (method, suffix, who = 'employee') => request(app)[method](`/api/appraisals/${appraisal._id}${suffix}`).set('x-cv-actor', who);
const upload = (who = 'employee', body = bytes, name = 'fictional-cv.txt', contentType = 'text/plain') => call('post', '/documents', who)
  .field('category', 'cv').field('assessmentMode', 'conversation').attach('file', body, { filename: name, contentType });
const collect = async (shared = false) => evidence.collect(await Appraisal.findById(appraisal._id).lean(), shared ? { shared: true } : { shared: false, actorId: 'employee', isEmployee: true, canManage: false });

beforeAll(async () => {
  mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri());
  app = express(); app.use(express.json()); app.use((req, _res, next) => {
    const who = req.get('x-cv-actor') || 'employee';
    if (who !== 'anonymous') { const user = actor(who); req.session = { user, currentOrganizationId: user.currentOrganization.id }; }
    next();
  }); app.use('/api/appraisals', require('../routes/appraisals'));
});
beforeEach(async () => {
  await mongoose.connection.db.dropDatabase();
  const cycle = await Cycle.create({ organizationId: org, name: 'Ordinary review without a role', periodStart: '2026-01-01', periodEnd: '2026-12-31', createdBy: { userId: 'manager' }, settings: { enableAiAssist: true, requireOkrAlignment: false } });
  appraisal = await Appraisal.create({ organizationId: org, cycleId: cycle._id, status: 'self_assessment_in_progress', employee: { userId: 'employee', name: 'Fictional employee', email: 'employee@example.test' }, manager: { userId: 'manager', name: 'Fictional manager', email: 'manager@example.test' } });
  bytesStored = null;
  transport = jest.spyOn(cloudinary.uploader, 'upload_stream').mockImplementation((options, done) => {
    const parts = []; return new Writable({ write(chunk, _encoding, callback) { parts.push(chunk); callback(); }, final(callback) {
      bytesStored = Buffer.concat(parts);
      done(null, { public_id: options.public_id, resource_type: 'raw', type: 'authenticated', bytes: bytesStored.length }); callback();
    } });
  });
  jest.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' });
  jest.spyOn(ai, 'analyzeDocument').mockResolvedValue({ summary: 'Must not run for a CV upload' });
});
afterEach(() => jest.restoreAllMocks());
afterAll(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });

test('ordinary employee CV persists privately, extracts text and feeds current/final analysis without starting AI or requiring a role', async () => {
  expect(await CompetencyAssessment.countDocuments()).toBe(0);
  const response = await upload().expect(201);
  expect(bytesStored).toEqual(bytes); expect(transport).toHaveBeenCalledTimes(1);
  const doc = await Document.findById(response.body.data._id);
  expect(doc).toMatchObject({ category: 'cv', visibility: 'employee_manager', storageDeliveryType: 'authenticated', aiAnalysis: { status: 'skipped' }, textExtraction: { status: 'completed', extractedText: bytes.toString() } });
  for (const key of ['storageKey', 'storagePath', 'storageUrl', 'fileName']) expect(response.body.data[key]).toBeUndefined();
  const parent = await Appraisal.findById(appraisal._id);
  expect(parent.documents.map(String)).toEqual([String(doc._id)]); expect(parent.finalRating?.overall).toBeUndefined();
  const current = await collect();
  expect(current.text).toContain(bytes.toString()); expect(current.coverage.counts.cv).toBe(1); expect(current.coverage.counts.documents).toBeUndefined();
  expect(current.coverage.sources.find(source => source.category === 'cv').id).toBe(`cv:appraisal-document:${doc._id}`);
  expect(current.coverage.gaps.join(' ')).not.toContain('No accessible, processed CV');
  await Appraisal.updateOne({ _id: appraisal._id }, { $set: { status: 'completed', 'selfAssessment.submittedAt': new Date(), 'finalRating.overall': 4 } });
  const final = await collect(true);
  expect(final.coverage.counts.cv).toBe(1); expect(final.text).toContain(bytes.toString());
  expect((await Appraisal.findById(appraisal._id)).finalRating.overall).toBe(4);
  expect(ai.analyzeDocument).not.toHaveBeenCalled();
});

test.each([['anonymous', 401], ['foreign', 404], ['outsider', 403]])('CV upload rejects %s before storage', async (who, status) => {
  await upload(who).expect(status); expect(transport).not.toHaveBeenCalled(); expect(await Document.countDocuments()).toBe(0);
});

test.each(['employee_only', 'hr_only', 'all_reviewers', 'invalid'])('CV rejects a forged %s audience instead of exposing or hiding the source', async visibility => {
  await call('post', '/documents').field('category', 'cv').field('visibility', visibility).attach('file', bytes, { filename: 'cv.txt', contentType: 'text/plain' }).expect(422);
  expect(transport).not.toHaveBeenCalled(); expect(await Document.countDocuments()).toBe(0);
});

test.each([
  [Buffer.alloc(0), 'cv.txt', 'text/plain'],
  [Buffer.from('not a PDF'), 'cv.pdf', 'application/pdf'],
  [Buffer.from('not a DOCX'), 'cv.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  [Buffer.from('%PDF-1.4 renamed'), 'cv.txt', 'text/plain'],
  [Buffer.from('presentation'), 'cv.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation']
])('CV validates the actual %s file before storage', async (body, name, mime) => {
  await upload('employee', body, name, mime).expect(422); expect(transport).not.toHaveBeenCalled(); expect(await Document.countDocuments()).toBe(0);
});

test('multer rejects an oversized CV and unsupported MIME with recoverable JSON before storage', async () => {
  const size = await upload('employee', Buffer.alloc(10 * 1024 * 1024 + 1, 'a')).expect(413);
  expect(size.body.error).toContain('10 MiB');
  const type = await upload('employee', Buffer.from('fictional binary'), 'cv.exe', 'application/octet-stream').expect(422);
  expect(type.body.error).toContain('PDF, DOCX or TXT');
  expect(transport).not.toHaveBeenCalled(); expect(await Document.countDocuments()).toBe(0);
});

test('a scoped manager can read the CV; outsiders, foreign tenants and wrong-parent document IDs cannot download or remove it', async () => {
  const response = await upload().expect(201); const docId = response.body.data._id;
  await call('get', `/documents/${docId}`, 'manager').expect(200);
  await call('get', `/documents/${docId}/content`, 'manager').expect(302);
  for (const [who, status] of [['anonymous', 401], ['foreign', 404], ['outsider', 403]]) {
    await call('get', `/documents/${docId}/content`, who).expect(status);
    await call('delete', `/documents/${docId}`, who).expect(status);
  }
  const other = await Document.create({ organizationId: org, appraisalId: new mongoose.Types.ObjectId(), category: 'cv', originalName: 'wrong-parent.txt', fileName: 'private.txt', fileType: 'txt' });
  await call('get', `/documents/${other._id}/content`).expect(404);
  await call('delete', `/documents/${other._id}`).expect(404);
  await call('delete', `/documents/${docId}`).expect(200);
  await call('get', `/documents/${docId}/content`).expect(404);
  expect((await Appraisal.findById(appraisal._id)).documents).toHaveLength(0);
  expect((await collect()).coverage.counts.cv).toBeUndefined();
});

test.each(['completed', 'employee_acknowledged', 'cancelled'])('closed %s appraisals reject CV upload and removal', async status => {
  const response = await upload().expect(201);
  await Appraisal.updateOne({ _id: appraisal._id }, { $set: { status } }); transport.mockClear();
  await upload().expect(409); await call('delete', `/documents/${response.body.data._id}`).expect(409);
  expect(transport).not.toHaveBeenCalled(); expect(await Document.countDocuments()).toBe(1);
});

test('failed extraction retains a downloadable CV but cannot claim processed CV coverage', async () => {
  jest.spyOn(extraction, 'extractText').mockRejectedValue(new Error('Fictional extraction failure'));
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const response = await upload().expect(201);
  expect(response.body.data.textExtraction.status).toBe('failed'); expect(response.body.data.aiAnalysis.status).toBe('skipped');
  await call('get', `/documents/${response.body.data._id}/content`).expect(302);
  const result = await collect(); expect(result.coverage.counts.cv).toBeUndefined();
  expect(result.coverage.gaps.join(' ')).toContain('CV text unavailable: fictional-cv.txt');
  expect(result.coverage.gaps.join(' ')).toContain('No accessible, processed CV');
  expect(ai.analyzeDocument).not.toHaveBeenCalled();
});

test('blank, private, deleted and cross-tenant CV sources cannot become shared final evidence', async () => {
  const rows = [
    { originalName: 'blank.txt', textExtraction: { status: 'completed', extractedText: '  ' } },
    { originalName: 'private.txt', visibility: 'employee_only', textExtraction: { status: 'completed', extractedText: 'PRIVATE CV SENTINEL' } },
    { originalName: 'deleted.txt', status: 'deleted', textExtraction: { status: 'completed', extractedText: 'DELETED CV SENTINEL' } },
    { originalName: 'foreign.txt', organizationId: 'foreign-org', textExtraction: { status: 'completed', extractedText: 'FOREIGN CV SENTINEL' } }
  ];
  for (const row of rows) {
    const doc = await Document.create({ organizationId: org, appraisalId: appraisal._id, category: 'cv', fileName: 'fixture.txt', fileType: 'txt', visibility: 'employee_manager', ...row });
    await Appraisal.updateOne({ _id: appraisal._id }, { $push: { documents: doc._id } });
  }
  const result = await collect(true);
  expect(result.coverage.counts.cv).toBeUndefined(); expect(result.text).not.toContain('CV SENTINEL');
  expect(result.coverage.gaps.join(' ')).toContain('blank.txt');
});

const selfReport = () => ({ overallSelfRating: 4, overallSummary: {
  achievements: 'Delivered the fictional project with clearly documented outcomes.', challenges: 'Resolved an invented dependency through early planning.',
  learnings: 'Applied a structured approach to fictional delivery.', improvements: 'Improve the next fictional handover using a checklist.', goals: 'Practice the next synthetic capability with measured evidence.'
} });
const submit = (mode, extra = {}) => mode === 'form'
  ? call('post', '/self-assessment').send({ assessmentMode: 'form', submit: true, selfAssessment: selfReport(), ...extra })
  : call('post', '/conversation/finalize-report').send({ report: selfReport(), ...extra });
async function requireCv() {
  await Cycle.updateOne({ _id: appraisal.cycleId }, { $set: { 'settings.enableAiAssist': false } });
  await Appraisal.updateOne({ _id: appraisal._id }, { $set: { 'cycleConfigurationSnapshot.cvRequired': true } });
}
async function linkedCv(overrides = {}) {
  const assessment = await CompetencyAssessment.create({ organizationId: org, cycleId: String(new mongoose.Types.ObjectId()), appraisalId: String(appraisal._id), participant: { userId: 'employee' }, definitionSnapshot: { role: { name: 'Fictional role' }, criteria: [] } });
  return require('../models/CompetencyEvidence').create({ organizationId: org, assessmentId: String(assessment._id), participantId: 'employee', documentType: 'cv', kind: 'file', status: 'ready', visibility: 'participant', storageKey: 'private-fictional-cv.txt', originalName: 'cv.txt', mimeType: 'text/plain', size: 100, ...overrides });
}

test.each(['form', 'conversation'])('mandatory CV blocks %s submission before changing any appraisal state or calling AI', async mode => {
  await requireCv();
  const analyze = jest.spyOn(ai, 'analyzeSelfAssessment').mockResolvedValue({});
  const before = await Appraisal.collection.findOne({ _id: appraisal._id });
  const response = await submit(mode, { cvRequired: false, cycleConfigurationSnapshot: { cvRequired: false } }).expect(422);
  expect(response.body).toMatchObject({ success: false, code: 'CV_REQUIRED' }); expect(response.body.error).toContain('Upload your CV');
  expect(await Appraisal.collection.findOne({ _id: appraisal._id })).toEqual(before);
  expect(analyze).not.toHaveBeenCalled(); expect(ai.analyzeDocument).not.toHaveBeenCalled();
  expect((await call('get', '').expect(200)).body.data.cvRequirement).toEqual({ required: true, fulfilled: false });
});

test('mandatory CV still allows a draft and ignores client attempts to change the frozen policy', async () => {
  await requireCv();
  await call('post', '/self-assessment').send({ assessmentMode: 'form', submit: false, selfAssessment: { overallSummary: { achievements: 'A fictional saved draft without any CV.' } }, cvRequired: false }).expect(200);
  const saved = await Appraisal.findById(appraisal._id);
  expect(saved.selfAssessment.submittedAt).toBeUndefined(); expect(saved.selfAssessment.overallSummary.achievements).toContain('saved draft');
  expect(saved.cycleConfigurationSnapshot.cvRequired).toBe(true);
});

test.each(['form', 'conversation'])('legacy optional CV does not block %s submission without a file', async mode => {
  await Cycle.updateOne({ _id: appraisal.cycleId }, { $set: { 'settings.enableAiAssist': false } });
  expect((await call('get', '').expect(200)).body.data.cvRequirement).toEqual({ required: false, fulfilled: false });
  await submit(mode).expect(200); expect((await Appraisal.findById(appraisal._id)).selfAssessment.submittedAt).toBeTruthy();
});

test.each(['form', 'conversation'])('ordinary CV with failed extraction satisfies mandatory %s upload without fabricating analysis coverage', async mode => {
  await requireCv(); jest.spyOn(extraction, 'extractText').mockRejectedValue(new Error('Fictional text extraction unavailable'));
  jest.spyOn(console, 'error').mockImplementation(() => {});
  await upload().expect(201);
  expect((await call('get', '').expect(200)).body.data.cvRequirement).toEqual({ required: true, fulfilled: true });
  expect((await collect()).coverage.counts.cv).toBeUndefined();
  await submit(mode).expect(200); expect((await Appraisal.findById(appraisal._id)).selfAssessment.submittedAt).toBeTruthy();
  expect(ai.analyzeDocument).not.toHaveBeenCalled();
});

test.each(['form', 'conversation'])('retained participant-visible linked CV satisfies mandatory %s upload', async mode => {
  await requireCv(); await linkedCv();
  expect((await call('get', '').expect(200)).body.data.cvRequirement).toEqual({ required: true, fulfilled: true });
  await submit(mode).expect(200); expect((await Appraisal.findById(appraisal._id)).selfAssessment.submittedAt).toBeTruthy();
});

test.each([
  { visibility: 'assessors' }, { status: 'deleted' }, { retention: { expiresAt: new Date('2020-01-01') } },
  { source: { withdrawnAt: new Date() } }, { participantId: 'outsider' }, { organizationId: 'foreign-org' },
  { documentType: 'supporting_evidence' }, { kind: 'manual' }, { storageKey: '' }
])('inaccessible or non-CV linked evidence cannot satisfy a mandatory CV (%j)', async overrides => {
  await requireCv(); await linkedCv(overrides);
  await submit('form').expect(422); await submit('conversation').expect(422);
  expect((await call('get', '').expect(200)).body.data.cvRequirement.fulfilled).toBe(false);
});

test('ordinary supporting files and deleted CVs do not satisfy the dedicated requirement', async () => {
  await requireCv();
  const response = await call('post', '/documents').field('assessmentMode', 'form').attach('file', bytes, { filename: 'evidence.txt', contentType: 'text/plain' }).expect(201);
  expect(response.body.data.category).toBe('other'); await submit('form').expect(422);
  const cv = await upload().expect(201); await call('delete', `/documents/${cv.body.data._id}`).expect(200);
  await submit('form').expect(422); await submit('conversation').expect(422);
});
