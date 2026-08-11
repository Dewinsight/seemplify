const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const talentRoutes = require('../routes/talent');
const TalentReviewCycle = require('../models/TalentReviewCycle');
const TalentReviewEntry = require('../models/TalentReviewEntry');
const SuccessionPlan = require('../models/SuccessionPlan');
const AppraisalCycle = require('../models/AppraisalCycle');
const Appraisal = require('../models/Appraisal');
const User = require('../models/User');
const aiGatewayService = require('../services/aiGatewayService');
const { getUserRole, getDirectReports } = require('../middleware/rbac');

const ORG_A = 'talent-org-a';
const ORG_B = 'talent-org-b';
const HR = 'talent-hr';
const MANAGER = 'talent-manager';
const EMPLOYEE = 'talent-employee';
const OTHER_REPORT = 'talent-other-report';

let mongo;
let app;

function sessionUser(actor, organizationId = ORG_A) {
  const id = actor === 'hr' ? HR : actor === 'manager' ? MANAGER : actor === 'other_manager' ? 'other-manager' : EMPLOYEE;
  const role = actor === 'hr' ? 'hr_manager' : 'employee';
  const organization = { id: organizationId, role, appAccess: { mode: 'all', appIds: [] } };
  return {
    id, sub: id, name: actor, email: `${id}@example.test`, currentOrganization: organization, organizations: [organization],
    idpTeams: actor === 'manager'
      ? [{ id: 'team-a', name: 'Team A', organizationId, role: 'line_manager', isManager: true, directReports: [EMPLOYEE] }]
      : actor === 'other_manager'
        ? [{ id: 'team-b', name: 'Team B', organizationId, role: 'line_manager', isManager: true, directReports: [OTHER_REPORT] }]
        : [{ id: 'team-a', name: 'Team A', organizationId, role: 'member', managerId: MANAGER }]
  };
}

async function seedUser(id, organizationId = ORG_A, teamId = 'team-a') {
  return User.create({
    idpSub: id,
    email: `${id}@example.test`,
    profile: { displayName: id.replaceAll('-', ' '), title: 'Principal Specialist' },
    currentOrganizationId: organizationId,
    idpOrganizations: [{ id: organizationId, name: organizationId, role: 'employee', designation: 'Principal Specialist' }],
    idpTeams: [{ id: teamId, name: teamId, organizationId, role: 'member', managerId: MANAGER }]
  });
}

async function seedFinalizedAppraisal(employeeId = EMPLOYEE, organizationId = ORG_A, teamId = 'team-a') {
  const cycle = await AppraisalCycle.create({
    name: `${organizationId} FY26`, organizationId, periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-06-30'), status: 'completed', currentPhase: 'completed'
  });
  const appraisal = await Appraisal.create({
    cycleId: cycle._id,
    organizationId,
    employee: { userId: employeeId, name: employeeId.replaceAll('-', ' '), email: `${employeeId}@example.test`, jobTitle: 'Principal Specialist', department: 'Operations', teamId, teamName: teamId },
    manager: { userId: MANAGER, name: 'Talent Manager', email: 'manager@example.test' },
    status: 'completed',
    goalEvidenceSummary: { rated: true, score: 88, ratedGoals: 2, totalGoals: 2 },
    managerReview: { submittedAt: new Date('2026-07-01'), overallManagerRating: 4, overallSummary: { achievements: 'Reduced processing time with measured service improvements.', strengths: 'Clear cross-team leadership.', improvements: 'Delegate earlier.' }, competencyRatings: [{ competencyId: 'leadership', competencyName: 'Leadership', managerRating: 4, managerComments: 'Led a cross-team delivery.' }] },
    finalRating: { overall: 4.2, competencyScore: 4, ratingLabel: 'Exceeds expectations', finalizedAt: new Date('2026-07-05'), finalizedBy: { userId: HR, name: 'HR' } }
  });
  return { cycle, appraisal };
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const actor = String(req.get('x-test-actor') || 'employee');
    const organizationId = String(req.get('x-test-organization') || ORG_A);
    const user = sessionUser(actor, organizationId);
    req.session = { user, currentOrganizationId: organizationId };
    req.user = user;
    req.currentOrganization = user.currentOrganization;
    req.organizationId = organizationId;
    req.userRole = getUserRole(user);
    req.directReports = getDirectReports(user);
    next();
  });
  app.use('/api/talent', talentRoutes);
});

beforeEach(async () => {
  await mongoose.connection.db.dropDatabase();
  await Promise.all([
    seedUser(HR), seedUser(MANAGER), seedUser(EMPLOYEE), seedUser(OTHER_REPORT, ORG_A, 'team-b'), seedUser('tenant-b-employee', ORG_B, 'team-b')
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

test('HR creates a talent review from immutable finalized appraisal evidence', async () => {
  const { cycle, appraisal } = await seedFinalizedAppraisal();
  const response = await request(app).post('/api/talent/reviews').set('x-test-actor', 'hr').send({ sourceAppraisalCycleId: String(cycle._id), name: 'FY26 talent review' }).expect(201);
  expect(response.body.data.entries).toHaveLength(1);
  expect(response.body.data.entries[0]).toMatchObject({ performanceBand: 'strong', potential: 'not_assessed', evidenceSnapshot: { finalRating: 4.2, goalAchievement: 88 } });
  expect(String(response.body.data.entries[0].sourceAppraisalId)).toBe(String(appraisal._id));

  await Appraisal.findByIdAndUpdate(appraisal._id, { $set: { 'finalRating.overall': 1.5 } });
  const stored = await TalentReviewEntry.findOne({ cycleId: response.body.data._id }).lean();
  expect(stored.evidenceSnapshot.finalRating).toBe(4.2);
});

test('manager proposes only for a direct report and HR calibrates without changing frozen performance', async () => {
  const { cycle } = await seedFinalizedAppraisal();
  const created = await request(app).post('/api/talent/reviews').set('x-test-actor', 'hr').send({ sourceAppraisalCycleId: String(cycle._id), name: 'FY26 talent review' }).expect(201);
  const reviewId = created.body.data._id;
  await request(app).post(`/api/talent/reviews/${reviewId}/transition`).set('x-test-actor', 'hr').send({ state: 'open' }).expect(200);

  const proposal = await request(app).patch(`/api/talent/reviews/${reviewId}/entries/${EMPLOYEE}`).set('x-test-actor', 'manager').send({
    potential: 'high', readiness: 'ready_1_2_years', nextRole: 'Operations Lead', criticalRole: true,
    rationale: 'Led two cross-team deliveries and demonstrated broader operational judgment.', strengths: ['Cross-team leadership'], developmentPriorities: ['Delegation'],
    evidenceSnapshot: { finalRating: 5 }
  }).expect(200);
  const proposed = proposal.body.data.entries[0];
  expect(proposed).toMatchObject({ decisionState: 'manager_proposed', potential: 'high', readiness: 'ready_1_2_years' });
  expect(proposed.evidenceSnapshot.finalRating).toBe(4.2);

  await request(app).patch(`/api/talent/reviews/${reviewId}/entries/${EMPLOYEE}`).set('x-test-actor', 'other_manager').send({ potential: 'limited', readiness: 'ready_3_plus_years', rationale: 'This manager must not be able to change an employee outside their team.' }).expect(403);
  await request(app).post(`/api/talent/reviews/${reviewId}/transition`).set('x-test-actor', 'hr').send({ state: 'calibration' }).expect(200);
  const calibrated = await request(app).patch(`/api/talent/reviews/${reviewId}/entries/${EMPLOYEE}`).set('x-test-actor', 'hr').send({ potential: 'moderate', readiness: 'ready_1_2_years', rationale: 'Calibration retained the readiness horizon after comparing the documented evidence.' }).expect(200);
  expect(calibrated.body.data.entries[0]).toMatchObject({ decisionState: 'hr_calibrated', potential: 'moderate' });
  await request(app).post(`/api/talent/reviews/${reviewId}/transition`).set('x-test-actor', 'hr').send({ state: 'closed' }).expect(200);
  await request(app).patch(`/api/talent/reviews/${reviewId}/entries/${EMPLOYEE}`).set('x-test-actor', 'hr').send({ potential: 'high', readiness: 'ready_now', rationale: 'Closed records must reject later decision edits even from HR administrators.' }).expect(409);
});

test('manager lists are scope-redacted and cross-organization records are never returned', async () => {
  const a = await seedFinalizedAppraisal(EMPLOYEE, ORG_A, 'team-a');
  const b = await seedFinalizedAppraisal('tenant-b-employee', ORG_B, 'team-b');
  await request(app).post('/api/talent/reviews').set('x-test-actor', 'hr').send({ sourceAppraisalCycleId: String(a.cycle._id), name: 'Org A review' }).expect(201);
  await request(app).post('/api/talent/reviews').set('x-test-actor', 'hr').set('x-test-organization', ORG_B).send({ sourceAppraisalCycleId: String(b.cycle._id), name: 'Org B review' }).expect(201);

  const manager = await request(app).get('/api/talent/reviews').set('x-test-actor', 'manager').expect(200);
  expect(manager.body.data).toHaveLength(1);
  expect(manager.body.data[0].entries.map((entry) => entry.employee.userId)).toEqual([EMPLOYEE]);
  expect(JSON.stringify(manager.body)).not.toContain('tenant-b-employee');
  await request(app).get(`/api/talent/reviews/${(await TalentReviewCycle.findOne({ organizationId: ORG_B }))._id}`).set('x-test-actor', 'hr').expect(404);
});

test('succession coverage is HR-only, tenant-validates candidates, and records decisions', async () => {
  await request(app).get('/api/talent/succession-plans').set('x-test-actor', 'manager').expect(403);
  const created = await request(app).post('/api/talent/succession-plans').set('x-test-actor', 'hr').send({ role: { title: 'Head of Operations', departmentId: 'ops', departmentName: 'Operations', criticality: 'critical' }, state: 'active', reviewDate: '2026-12-01' }).expect(201);
  const planId = created.body.data._id;
  await request(app).post(`/api/talent/succession-plans/${planId}/candidates`).set('x-test-actor', 'hr').send({ employeeId: 'tenant-b-employee', readiness: 'ready_now', rationale: 'A cross-organization person must never be accepted onto this succession slate.' }).expect(400);
  const added = await request(app).post(`/api/talent/succession-plans/${planId}/candidates`).set('x-test-actor', 'hr').send({ employeeId: EMPLOYEE, readiness: 'ready_1_2_years', rationale: 'Documented delivery leadership supports a longer-term succession development path.', strengths: ['Operational judgment'], developmentGaps: ['Enterprise planning'] }).expect(201);
  const candidateId = added.body.data.candidates[0]._id;
  await request(app).patch(`/api/talent/succession-plans/${planId}/candidates/${candidateId}`).set('x-test-actor', 'hr').send({ state: 'confirmed' }).expect(200);
  const stored = await SuccessionPlan.findById(planId).lean();
  expect(stored.candidates[0]).toMatchObject({ readiness: 'ready_1_2_years', state: 'confirmed', nominatedBy: HR, confirmedBy: HR });
  expect(stored.audit.map((item) => item.action)).toEqual(['created', 'candidate_nominated', 'candidate_confirmed']);
});

test('AI produces a reviewable evidence brief and is instructed not to make talent decisions', async () => {
  const completion = jest.spyOn(aiGatewayService, 'getChatCompletions').mockResolvedValue({
    id: 'talent-brief-1', provider: 'local', choices: [{ message: { content: JSON.stringify({ summary: 'Documented delivery leadership with a delegation development area.', evidenceHighlights: ['Led a cross-team delivery'], evidenceGaps: ['No evidence from a second review period'], discussionQuestions: ['What broader scope has been sustained?'] }) } }]
  });
  const { cycle } = await seedFinalizedAppraisal();
  const created = await request(app).post('/api/talent/reviews').set('x-test-actor', 'hr').send({ sourceAppraisalCycleId: String(cycle._id), name: 'AI evidence review' }).expect(201);
  const reviewId = created.body.data._id;
  await request(app).post(`/api/talent/reviews/${reviewId}/transition`).set('x-test-actor', 'hr').send({ state: 'open' }).expect(200);
  const brief = await request(app).post(`/api/talent/reviews/${reviewId}/entries/${EMPLOYEE}/ai-brief`).set('x-test-actor', 'manager').expect(200);
  expect(brief.body.forbiddenDecisions).toEqual(expect.arrayContaining(['potential', 'promotion', 'rating']));
  const systemPrompt = completion.mock.calls[0][0][0].content;
  expect(systemPrompt).toMatch(/Do not infer potential, readiness.*promotion, succession, or a new rating/);
  expect(systemPrompt).toMatch(/Do not rank people/);
  await request(app).post(`/api/talent/reviews/${reviewId}/entries/${EMPLOYEE}/ai-briefs/${brief.body.data._id}/review`).set('x-test-actor', 'manager').send({ decision: 'accepted' }).expect(200);
  const stored = await TalentReviewEntry.findOne({ cycleId: reviewId, 'employee.userId': EMPLOYEE }).lean();
  expect(stored.aiBriefs[0]).toMatchObject({ status: 'accepted', requestedBy: MANAGER, reviewedBy: MANAGER });
});

test('workflow signals are explainable, scoped, and do not become employee scores', async () => {
  const { cycle } = await seedFinalizedAppraisal();
  const stalled = await Appraisal.create({
    cycleId: cycle._id, organizationId: ORG_A,
    employee: { userId: EMPLOYEE, name: 'Talent Employee', email: 'talent-employee@example.test', teamId: 'team-a', teamName: 'Team A' },
    manager: { userId: MANAGER, name: 'Talent Manager', email: 'manager@example.test' },
    status: 'self_assessment_pending'
  });
  await Appraisal.collection.updateOne({ _id: stalled._id }, { $set: { updatedAt: new Date(Date.now() - 15 * 86400000) } });
  await request(app).get('/api/talent/signals').set('x-test-actor', 'employee').expect(403);
  const response = await request(app).get('/api/talent/signals').set('x-test-actor', 'manager').expect(200);
  expect(response.body.data.signals).toHaveLength(1);
  expect(response.body.data.signals[0]).toMatchObject({ type: 'cycle_completion_risk', severity: 'high', employee: { userId: EMPLOYEE } });
  expect(response.body.data.signals[0]).not.toHaveProperty('score');
  expect(response.body.data.methodology).toMatch(/No protected characteristics.*attendance, leave/);
  expect(response.body.data.machineLearning.enabled).toBe(false);
});

test('a 1,000-person talent review stores assessments independently and duplicate creation is rejected', async () => {
  const cycle = await AppraisalCycle.create({
    name: 'Enterprise FY26', organizationId: ORG_A, periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-06-30'), status: 'completed', currentPhase: 'completed'
  });
  const finalizedAt = new Date('2026-07-05');
  await Appraisal.insertMany(Array.from({ length: 1000 }, (_, index) => ({
    cycleId: cycle._id,
    organizationId: ORG_A,
    employee: { userId: `enterprise-${index}`, name: `Enterprise Employee ${index}`, email: `enterprise-${index}@example.test`, teamId: `team-${index % 20}`, teamName: `Team ${index % 20}` },
    manager: { userId: `manager-${index % 20}`, name: `Manager ${index % 20}`, email: `manager-${index % 20}@example.test` },
    status: 'completed',
    goalEvidenceSummary: { rated: true, score: 70 + (index % 25), ratedGoals: 2, totalGoals: 2 },
    finalRating: { overall: 3 + ((index % 20) / 20), competencyScore: 3.5, ratingLabel: 'Meets expectations', finalizedAt, finalizedBy: { userId: HR, name: 'HR' } }
  })));
  const created = await request(app).post('/api/talent/reviews').set('x-test-actor', 'hr').send({ sourceAppraisalCycleId: String(cycle._id), name: 'Enterprise talent review' }).expect(201);
  expect(created.body.data.entries).toHaveLength(1000);
  expect(await TalentReviewEntry.countDocuments({ organizationId: ORG_A, cycleId: created.body.data._id })).toBe(1000);
  const cycleRecord = await TalentReviewCycle.findById(created.body.data._id).lean();
  expect(cycleRecord).not.toHaveProperty('entries');
  expect(cycleRecord.stats.participants).toBe(1000);
  await request(app).post('/api/talent/reviews').set('x-test-actor', 'hr').send({ sourceAppraisalCycleId: String(cycle._id), name: 'Duplicate enterprise review' }).expect(409);
  expect(await TalentReviewEntry.countDocuments({ organizationId: ORG_A, cycleId: created.body.data._id })).toBe(1000);
});
