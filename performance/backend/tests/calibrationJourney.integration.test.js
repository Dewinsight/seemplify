const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const routes = require('../routes/calibration');
const Calibration = require('../models/Calibration');
const Appraisal = require('../models/Appraisal');
const AppraisalCycle = require('../models/AppraisalCycle');
let mongo;
let app;
let cycle;
const organizationId = 'calibration-org';
const identity = (id) => ({ userId: id, name: id, email: `${id}@example.test` });
async function appraisal(status, userId = 'employee') {
  return Appraisal.create({ organizationId, cycleId: cycle._id, status, employee: identity(userId), manager: identity('manager'),
    selfAssessment: { overallSelfRating: 4 }, managerReview: { overallManagerRating: 4 },
    ...(status === 'completed' ? { finalRating: { overall: 4, finalizedAt: new Date() } } : {}) });
}
beforeAll(async () => {
  mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri());
  app = express(); app.use(express.json());
  app.use((req, _res, next) => {
    const organization = { id: req.get('x-test-organization') || organizationId, role: req.get('x-test-employee') ? 'employee' : 'hr_manager', appAccess: { mode: 'all', appIds: [] } };
    req.session = { user: { id: 'hr', sub: 'hr', name: 'HR', currentOrganization: organization, organizations: [organization] } };
    next();
  });
  app.use('/api/calibration', routes);
});
beforeEach(async () => {
  await mongoose.connection.db.dropDatabase();
  await Promise.all([Calibration.createIndexes(), Appraisal.createIndexes(), AppraisalCycle.createIndexes()]);
  cycle = await AppraisalCycle.create({ organizationId, name: 'Calibrated review', periodStart: '2026-01-01', periodEnd: '2026-12-31', status: 'active', ratingScale: { min: 1, max: 5 } });
});
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });

test('calibration cannot reopen a finalized result or create an empty session', async () => {
  const completed = await appraisal('completed');
  await request(app).post('/api/calibration').send({ reviewCycleId: String(cycle._id) }).expect(409);
  expect(await Calibration.countDocuments()).toBe(0);
  expect((await Appraisal.findById(completed._id)).status).toBe('completed');
});

test('HR reviews ratings, records approval without retyping the rating, completes and safely replays', async () => {
  const pending = await appraisal('calibration_pending');
  await appraisal('completed', 'finished-employee');
  const created = await request(app).post('/api/calibration').send({ reviewCycleId: String(cycle._id) }).expect(201);
  const id = created.body.data._id;
  expect(created.body.data.reviewsUnderCalibration).toHaveLength(1);
  await request(app).post(`/api/calibration/${id}/start`).expect(200);
  await request(app).put(`/api/calibration/${id}/reviews/0`).send({ decision: 'adjusted', calibratedRating: 99, calibrationNotes: 'Synthetic reason for invalid rating' }).expect(400);
  await request(app).put(`/api/calibration/${id}/reviews/0`).send({ decision: 'approved' }).expect(200);
  const approved = await Appraisal.findById(pending._id);
  expect(approved.calibration.calibratedRating).toBe(4);
  expect(approved.calibration.calibratedAt).toBeTruthy();
  await request(app).post(`/api/calibration/${id}/complete`).expect(200);
  expect((await Appraisal.findById(pending._id)).status).toBe('final_review_pending');
  await Appraisal.updateOne({ _id: pending._id }, { $set: { status: 'completed', 'finalRating.finalizedAt': new Date(), 'finalRating.overall': 4 } });
  await request(app).post(`/api/calibration/${id}/complete`).expect(200);
  expect((await Appraisal.findById(pending._id)).status).toBe('completed');
  await request(app).post(`/api/calibration/${id}/start`).expect(409);
  await request(app).put(`/api/calibration/${id}/reviews/0`).send({ decision: 'adjusted', calibratedRating: 3, calibrationNotes: 'Synthetic override after finalization' }).expect(409);
  const report = await request(app).get(`/api/calibration/${id}/export`).expect(200);
  expect(report.body.data.reviewCycle).toBe('Calibrated review');
  await request(app).get(`/api/calibration/${id}`).set('x-test-organization', 'foreign').expect(404);
  await request(app).get(`/api/calibration/${id}`).set('x-test-employee', 'true').expect(403);
});

test('deferred reviews cannot complete and generic updates cannot change tenant or decisions', async () => {
  await appraisal('calibration_pending');
  const created = await request(app).post('/api/calibration').send({ reviewCycleId: String(cycle._id) }).expect(201);
  const id = created.body.data._id;
  await request(app).put(`/api/calibration/${id}`).send({ organizationId: 'foreign', status: 'completed' }).expect(400);
  await request(app).post(`/api/calibration/${id}/start`).expect(200);
  await request(app).put(`/api/calibration/${id}/reviews/0`).send({ decision: 'deferred' }).expect(200);
  await request(app).post(`/api/calibration/${id}/complete`).expect(400);
  expect((await Appraisal.findOne({ cycleId: cycle._id })).status).toBe('calibration_pending');
});
