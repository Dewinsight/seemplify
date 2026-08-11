const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const supportPlanRoutes = require('../routes/supportPlans');
const recognitionRoutes = require('../routes/recognition');
const projectRoutes = require('../routes/performanceProjects');
const managerInsightRoutes = require('../routes/managerInsights');
const feedbackRoutes = require('../routes/feedback');
const userRoutes = require('../routes/user');
const PerformanceSupportPlan = require('../models/PerformanceSupportPlan');
const Recognition = require('../models/Recognition');
const PerformanceProject = require('../models/PerformanceProject');
const FeedbackRequest = require('../models/FeedbackRequest');
const Feedback = require('../models/Feedback');
const DomainEvent = require('../models/DomainEvent');
const User = require('../models/User');
const OKR = require('../models/OKR');
const PerformanceCheckIn = require('../models/PerformanceCheckIn');
const { getUserRole, getDirectReports } = require('../middleware/rbac');

const ORG_A = 'phase2-org-a';
const ORG_B = 'phase2-org-b';
const EMPLOYEE = 'phase2-employee';
const REVIEWER = 'phase2-reviewer';
const MANAGER = 'phase2-manager';
const HR = 'phase2-hr';

let mongo;
let app;

function sessionUser(actor, organizationId) {
  const id = actor === 'manager' ? MANAGER : actor === 'hr' ? HR : actor === 'reviewer' ? REVIEWER : EMPLOYEE;
  const organization = { id: organizationId, role: actor === 'hr' ? 'hr_manager' : 'employee', appAccess: { mode: 'all', appIds: [] } };
  return {
    id, sub: id, name: `${actor} user`, email: `${id}@example.com`, currentOrganization: organization, organizations: [organization],
    idpTeams: actor === 'manager' ? [{ id: 'team-a', name: 'Team A', organizationId, role: 'line_manager', isManager: true, directReports: [EMPLOYEE, REVIEWER] }] : [{ id: 'team-a', name: 'Team A', organizationId, role: 'member', managerId: MANAGER }]
  };
}

async function seedUser(id, organizationId, role = 'employee') {
  return User.create({
    idpSub: id,
    email: `${id}@example.com`,
    profile: { displayName: id.replaceAll('-', ' ') },
    currentOrganizationId: organizationId,
    idpOrganizations: [{ id: organizationId, name: 'Phase 2 Org', role }],
    idpTeams: [{ id: 'team-a', name: 'Team A', organizationId, role: 'member', managerId: MANAGER }]
  });
}

function planPayload() {
  const dueDate = new Date(Date.now() + 30 * 86400000).toISOString();
  return {
    employee: { userId: EMPLOYEE, name: 'Employee One', email: 'employee@example.com' },
    manager: { name: 'Manager One', email: 'manager@example.com' },
    planType: 'formal_improvement',
    title: 'Delivery reliability support',
    summary: 'A time-bound plan with measurable expectations and documented manager support.',
    concerns: [{ description: 'Two agreed delivery dates were missed.', expectedStandard: 'Surface delivery risk at least two working days before the due date.' }],
    objectives: [{ title: 'Raise delivery risks early', measure: 'Weekly delivery review record', target: 'All material risks raised two working days early', dueDate }],
    supportCommitments: [{ description: 'Manager will hold a weekly priority review.', ownerType: 'manager', dueDate }],
    milestones: [{ title: 'Midpoint review', dueDate }],
    reviewDates: [dueDate]
  };
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
    req.currentTeam = { id: 'team-a' };
    next();
  });
  app.use('/api/support-plans', supportPlanRoutes);
  app.use('/api/recognition', recognitionRoutes);
  app.use('/api/performance-projects', projectRoutes);
  app.use('/api/manager-insights', managerInsightRoutes);
  app.use('/api/feedback', feedbackRoutes);
  app.use('/api/users', userRoutes);
});

beforeEach(async () => {
  await mongoose.connection.db.dropDatabase();
  await Promise.all([
    seedUser(EMPLOYEE, ORG_A), seedUser(REVIEWER, ORG_A), seedUser(MANAGER, ORG_A), seedUser(HR, ORG_A, 'hr_manager'), seedUser('org-b-person', ORG_B)
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

test('manager, HR, and employee complete the guarded support-plan handoffs', async () => {
  const created = await request(app).post('/api/support-plans').set('x-test-actor', 'manager').send({
    ...planPayload(),
    aiAssistance: {
      suggestionId: 'suggestion-1',
      draft: {
        title: 'Delivery reliability support',
        summary: 'Generated wording reviewed by the manager.',
        objectives: [{ title: 'Raise risks early', measure: 'Weekly review', target: '100%' }],
        supportCommitments: ['Weekly priority review']
      }
    }
  }).expect(201);
  const id = created.body.data._id;
  expect(created.body.data.state).toBe('draft');
  expect(created.body.data.aiAssistance[0]).toMatchObject({ activity: 'performance.support_plan.draft', status: 'accepted', requestedBy: MANAGER, reviewedBy: MANAGER });

  await request(app).get(`/api/support-plans/${id}`).set('x-test-actor', 'employee').expect(403);
  const submitted = await request(app).post(`/api/support-plans/${id}/submit-for-hr-review`).set('x-test-actor', 'manager').send({}).expect(200);
  expect(submitted.body.data.state).toBe('hr_review');
  await request(app).get(`/api/support-plans/${id}`).set('x-test-actor', 'employee').expect(403);

  const approved = await request(app).post(`/api/support-plans/${id}/hr-decision`).set('x-test-actor', 'hr').send({ decision: 'approve', comment: 'The plan includes measurable expectations and manager support.' }).expect(200);
  expect(approved.body.data.state).toBe('employee_review');
  const response = await request(app).post(`/api/support-plans/${id}/employee-response`).set('x-test-actor', 'employee').send({ acknowledgement: 'acknowledged_with_comments', comment: 'I understand the expectations and support.' }).expect(200);
  expect(response.body.data.state).toBe('active');

  const stored = await PerformanceSupportPlan.findById(id).lean();
  expect(stored.audit.map(item => item.action)).toEqual(expect.arrayContaining(['created', 'ai_suggestion_accepted', 'submitted_for_hr_review', 'hr_approved', 'employee_acknowledged']));
  expect(await DomainEvent.countDocuments({ organizationId: ORG_A, 'aggregate.id': String(id) })).toBeGreaterThanOrEqual(3);
});

test('HR change request returns the plan to the manager without exposing it to the employee', async () => {
  const created = await request(app).post('/api/support-plans').set('x-test-actor', 'manager').send(planPayload()).expect(201);
  const id = created.body.data._id;
  await request(app).post(`/api/support-plans/${id}/submit-for-hr-review`).set('x-test-actor', 'manager').send({}).expect(200);
  const decision = await request(app).post(`/api/support-plans/${id}/hr-decision`).set('x-test-actor', 'hr').send({ decision: 'request_changes', comment: 'Make the target more specific.' }).expect(200);
  expect(decision.body.data.state).toBe('changes_requested');
  await request(app).get(`/api/support-plans/${id}`).set('x-test-actor', 'employee').expect(403);
});

test('support plans reject unrelated managers and cross-organization IDs', async () => {
  const created = await request(app).post('/api/support-plans').set('x-test-actor', 'manager').send(planPayload()).expect(201);
  await request(app).get(`/api/support-plans/${created.body.data._id}`).set('x-test-actor', 'employee').set('x-test-organization', ORG_B).expect(404);
  await request(app).post('/api/support-plans').set('x-test-actor', 'manager').send({ ...planPayload(), employee: { userId: 'not-a-report' } }).expect(403);
  const hr = await User.findOne({ idpSub: HR }).lean();
  await request(app).post('/api/support-plans').set('x-test-actor', 'hr').send({ ...planPayload(), employee: { userId: String(hr._id) } }).expect(403);
});

test('active support plans accept employee and manager check-ins without changing appraisal data', async () => {
  const plan = await PerformanceSupportPlan.create({ organizationId: ORG_A, ...planPayload(), manager: { userId: MANAGER, name: 'Manager' }, state: 'active', audit: [{ action: 'seeded', actorId: HR }] });
  await request(app).post(`/api/support-plans/${plan._id}/check-ins`).set('x-test-actor', 'employee').send({ progress: 40, update: 'Raised this week’s delivery risk during planning.' }).expect(201);
  await request(app).post(`/api/support-plans/${plan._id}/check-ins`).set('x-test-actor', 'manager').send({ progress: 50, update: 'Reviewed the delivery plan and removed a dependency.' }).expect(201);
  const stored = await PerformanceSupportPlan.findById(plan._id).lean();
  expect(stored.checkIns).toHaveLength(2);
  expect(stored).not.toHaveProperty('rating');
});

test('recognition is tenant-validated, audience-aware, acknowledged, and non-scoring', async () => {
  const sent = await request(app).post('/api/recognition').set('x-test-actor', 'manager').send({ recipient: { userId: EMPLOYEE }, message: 'You surfaced a delivery risk early and helped the team adjust.', companyValue: 'Ownership', visibility: 'private' }).expect(201);
  expect(sent.body.data).not.toHaveProperty('rating');
  await request(app).post(`/api/recognition/${sent.body.data._id}/acknowledge`).set('x-test-actor', 'employee').expect(200);
  const received = await request(app).get('/api/recognition?view=received').set('x-test-actor', 'employee').expect(200);
  expect(received.body.data).toHaveLength(1);
  expect(received.body.data[0].acknowledgedAt).toBeTruthy();
  await request(app).post('/api/recognition').set('x-test-actor', 'manager').send({ recipient: { userId: 'org-b-person' }, message: 'Cross tenant', visibility: 'private' }).expect(400);
  const managerRecord = await User.findOne({ idpSub: MANAGER }).lean();
  await request(app).post('/api/recognition').set('x-test-actor', 'manager').send({ recipient: { userId: String(managerRecord._id) }, message: 'Self recognition through an alternate identifier', visibility: 'private' }).expect(400);
  expect(await Recognition.countDocuments({ organizationId: ORG_A })).toBe(1);
});

test('project feedback requires a lead and verifies both people are project members', async () => {
  const created = await request(app).post('/api/performance-projects').set('x-test-actor', 'manager').send({ name: 'Payroll migration', startDate: new Date().toISOString(), state: 'active', participants: [{ userId: EMPLOYEE }, { userId: REVIEWER }] }).expect(201);
  const id = created.body.data._id;
  const dueDate = new Date(Date.now() + 7 * 86400000).toISOString();
  const requested = await request(app).post(`/api/performance-projects/${id}/feedback-requests`).set('x-test-actor', 'manager').send({ subjectId: EMPLOYEE, reviewerId: REVIEWER, dueDate, questions: ['What improved delivery?'] }).expect(201);
  expect(requested.body.data.contextType).toBe('project');
  expect(String(requested.body.data.projectId)).toBe(id);
  const fulfilled = await request(app).post('/api/feedback').set('x-test-actor', 'reviewer').send({ requestId: requested.body.data._id, receiverId: EMPLOYEE, content: 'Clear project coordination and early risk communication.', type: 'praise' }).expect(201);
  expect(String(fulfilled.body.data.projectId)).toBe(id);
  await request(app).post(`/api/performance-projects/${id}/feedback-requests`).set('x-test-actor', 'employee').send({ subjectId: EMPLOYEE, reviewerId: REVIEWER, dueDate }).expect(403);
  await request(app).post(`/api/performance-projects/${id}/feedback-requests`).set('x-test-actor', 'manager').send({ subjectId: EMPLOYEE, reviewerId: 'org-b-person', dueDate }).expect(400);
  await request(app).post('/api/performance-projects').set('x-test-actor', 'manager').send({ name: 'Invalid lead', startDate: new Date().toISOString(), leads: [{ userId: 'org-b-person' }], participants: [{ userId: EMPLOYEE }] }).expect(400);
  expect(await FeedbackRequest.countDocuments({ projectId: id, state: 'fulfilled' })).toBe(1);
  expect(await Feedback.countDocuments({ projectId: id })).toBe(1);
});

test('manager coaching returns defined practice signals without sentiment or pulse content', async () => {
  await OKR.create({ organizationId: ORG_A, ownerId: EMPLOYEE, owner: { name: 'Employee' }, type: 'individual', period: 'FY26 Q3', title: 'Stabilize service', status: 'active', approvalStatus: 'approved', lifecycle: { state: 'active' }, objectives: [{ title: 'Reliability', keyResults: [{ title: 'Reduce incidents', targetValue: 5, currentValue: 2, health: 'at_risk' }] }] });
  await PerformanceCheckIn.create({ organizationId: ORG_A, employeeId: EMPLOYEE, authorId: EMPLOYEE, cadence: 'ad_hoc', periodStart: new Date(), periodEnd: new Date(), wins: ['private evidence'], pulse: 1, visibility: 'employee_manager', status: 'submitted' });
  const response = await request(app).get('/api/manager-insights/practices').set('x-test-actor', 'manager').expect(200);
  expect(response.body.data.scope.employeeCount).toBe(2);
  expect(response.body.data.summary.atRiskGoals).toBe(1);
  expect(response.body.data.definitions).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'checkInCoverage' })]));
  const serialized = JSON.stringify(response.body);
  expect(serialized).not.toContain('private evidence');
  expect(serialized).not.toContain('sentiment');
  expect(serialized).not.toContain('pulse');
});

test('manager coaching denies employees', async () => {
  await request(app).get('/api/manager-insights/practices').set('x-test-actor', 'employee').expect(403);
});

test('recognition and project records are isolated by organization', async () => {
  await Recognition.create({ organizationId: ORG_B, sender: { userId: 'b1' }, recipient: { userId: 'b2' }, message: 'Other tenant', visibility: 'public' });
  await PerformanceProject.create({ organizationId: ORG_B, name: 'Other project', startDate: new Date(), state: 'active', createdBy: 'b1', leads: [{ userId: 'b1' }], participants: [{ userId: 'b2' }] });
  const recognition = await request(app).get('/api/recognition').set('x-test-actor', 'employee').expect(200);
  const projects = await request(app).get('/api/performance-projects').set('x-test-actor', 'employee').expect(200);
  expect(recognition.body.data).toHaveLength(0);
  expect(projects.body.data).toHaveLength(0);
});

test('colleague search cannot return people from another organization', async () => {
  await User.create({ idpSub: 'stale-preference', email: 'stale-preference@example.com', profile: { displayName: 'Stale Preference' }, currentOrganizationId: ORG_A, idpTeams: [{ id: 'team-b', organizationId: ORG_B, role: 'member' }] });
  const local = await request(app).get('/api/users/search?q=phase2-employee').set('x-test-actor', 'manager').expect(200);
  expect(local.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ id: EMPLOYEE })]));

  const otherTenant = await request(app).get('/api/users/search?q=org-b-person').set('x-test-actor', 'manager').expect(200);
  expect(otherTenant.body.data).toEqual([]);
  const stalePreference = await request(app).get('/api/users/search?q=Stale Preference').set('x-test-actor', 'manager').expect(200);
  expect(stalePreference.body.data).toEqual([]);
});
