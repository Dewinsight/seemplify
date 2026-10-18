const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const User = require('../models/User');
const Appraisal = require('../models/Appraisal');
const AppraisalCycle = require('../models/AppraisalCycle');
const routes = require('../routes/appraisals');
const { ensureQuarterlyCycles } = require('../services/quarterlyAppraisalService');
const { migrateQuarterlyReviews } = require('../scripts/migrateQuarterlyReviews');

let mongo, app;
const org = { id: 'org-review', role: 'employee', appAccess: { mode: 'all', appIds: [] } };
function actor(name) {
  const hr = name === 'hr';
  const organization = { ...org, role: hr ? 'hr_manager' : 'employee' };
  const team = name === 'outsider' ? 'separate' : name === 'leader' ? 'parent' : 'child';
  return { id: name, sub: name, name, email: `${name}@example.test`, currentOrganization: organization, organizations: [organization],
    idpTeams: hr ? [] : [{ id: team, name: team, organizationId: org.id, parentTeamId: team === 'child' ? 'parent' : null, role: name === 'leader' ? 'line_manager' : 'member' }] };
}
async function seed(name, organizationId = org.id) {
  const principal = actor(name);
  return User.create({ idpSub: name, email: principal.email, profile: { displayName: name }, currentOrganizationId: organizationId,
    idpTeams: principal.idpTeams.map((team) => ({ ...team, organizationId })) });
}
const call = (method, url, who = 'member') => request(app)[method](`/api/appraisals${url}`).set('x-actor', who);
const launch = (userId) => ({ reviewerMode: 'initiator', employees: [{ userId }], responseDeadlines: { selfAssessmentDue: '2099-01-01', managerReviewDue: '2099-01-10' } });

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  app = express(); app.use(express.json());
  app.use((req, res, next) => { if (req.get('x-actor') !== 'anonymous') req.session = { user: actor(req.get('x-actor') || 'member'), currentOrganizationId: org.id }; next(); });
  app.use('/api/appraisals', routes);
});
beforeEach(async () => {
  await mongoose.connection.db.dropDatabase();
  await Appraisal.createIndexes(); await AppraisalCycle.createIndexes();
  for (const name of ['member', 'peer', 'leader', 'outsider', 'hr']) await seed(name);
  await seed('foreign', 'other-org');
});
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });

test('quarterly defaults are tenant scoped, concurrency safe, editable and roll over into a new year', async () => {
  const now = new Date('2026-10-18');
  await Promise.all([ensureQuarterlyCycles(org.id, now), ensureQuarterlyCycles(org.id, now)]);
  expect(await AppraisalCycle.countDocuments()).toBe(5);
  const cycle = await AppraisalCycle.findOne({ defaultQuarterKey: '2026-Q3' });
  cycle.name = 'HR edited quarter'; await cycle.save();
  await ensureQuarterlyCycles(org.id, now);
  expect((await AppraisalCycle.findById(cycle._id)).name).toBe('HR edited quarter');
  await ensureQuarterlyCycles('other-org', now);
  expect(await AppraisalCycle.countDocuments({ organizationId: 'other-org' })).toBe(5);
  await ensureQuarterlyCycles(org.id, new Date('2027-01-01'));
  expect(await AppraisalCycle.countDocuments({ organizationId: org.id, defaultQuarterKey: /^2027/ })).toBe(4);
});

test('members can select peers and managers across parent/child teams, but not self, unrelated teams or tenants', async () => {
  const roster = await call('get', '/colleague-roster').expect(200);
  expect(roster.body.data.employees.map((person) => person.userId).sort()).toEqual(['leader', 'peer']);
  const hrRoster = await call('get', '/colleague-roster', 'hr').expect(200);
  expect(hrRoster.body.data.employees.map((person) => person.userId)).toContain('leader');
  expect(hrRoster.body.data.employees.map((person) => person.userId)).not.toContain('foreign');
  await call('get', '/colleague-roster', 'anonymous').expect(401);
  await ensureQuarterlyCycles(org.id, new Date('2026-10-18'));
  const cycle = await AppraisalCycle.findOne({ defaultQuarterKey: '2026-Q3' });
  for (const target of ['member', 'outsider', 'foreign', 'unknown']) await call('post', `/cycles/${cycle._id}/launch`).send(launch(target)).expect(403);
  expect(await Appraisal.countDocuments()).toBe(0);
});

test('upward reviews need no reporting manager and only the assigned reviewer, subject and HR can access them', async () => {
  await ensureQuarterlyCycles(org.id, new Date('2026-10-18'));
  const cycle = await AppraisalCycle.findOne({ defaultQuarterKey: '2026-Q3' });
  const result = await call('post', `/cycles/${cycle._id}/launch`).send(launch('leader')).expect(200);
  expect(result.body.data.launched).toBe(1);
  const review = await Appraisal.findOne();
  expect(review.manager.userId).toBe('member'); expect(review.reviewerInitiated).toBe(true);
  await call('get', `/${review._id}`, 'member').expect(200);
  await call('get', `/${review._id}`, 'leader').expect(200);
  await call('get', `/${review._id}`, 'hr').expect(200);
  await call('get', `/${review._id}`, 'peer').expect(403);
  await call('get', `/${review._id}`, 'outsider').expect(403);
  await call('post', `/${review._id}/manager-review/start`, 'member').expect(400); // needs self-assessment, not a manager job title
  await call('post', `/${review._id}/manager-review/start`, 'peer').expect(403);
  const queue = await call('get', '/assigned-reviews').expect(200);
  expect(queue.body.data).toHaveLength(1);
  const replay = await call('post', `/cycles/${cycle._id}/launch`).send(launch('leader')).expect(200);
  expect(replay.body.data.replayed).toBe(1);
  await call('post', `/cycles/${cycle._id}/launch`, 'peer').send(launch('leader')).expect(200);
  expect(await Appraisal.countDocuments()).toBe(2);
  expect((await AppraisalCycle.findById(cycle._id)).responseDeadlines.selfAssessmentDue.getUTCFullYear()).toBe(2026);
});

test('future quarters and bad deadlines cannot launch; HR can appraise a leader with no teams', async () => {
  await User.updateOne({ idpSub: 'leader' }, { $set: { idpTeams: [] } });
  await ensureQuarterlyCycles(org.id, new Date('2026-10-18'));
  const future = await AppraisalCycle.create({ name: 'Future', organizationId: org.id, periodStart: '2098-01-01', periodEnd: '2098-03-31', scope: { type: 'organization' } });
  await call('post', `/cycles/${future._id}/launch`, 'hr').send(launch('leader')).expect(400);
  const cycle = await AppraisalCycle.findOne({ defaultQuarterKey: '2026-Q3' });
  await call('post', `/cycles/${cycle._id}/launch`, 'hr').send({ ...launch('leader'), responseDeadlines: { selfAssessmentDue: '2020-01-01', managerReviewDue: '2020-01-02' } }).expect(400);
  await call('post', `/cycles/${cycle._id}/launch`, 'hr').send(launch('leader')).expect(200);
  expect(await Appraisal.countDocuments()).toBe(1);
});

test('migration backs up and retires old cycles without deleting their review history', async () => {
  const old = await AppraisalCycle.create({ name: 'Old custom cycle', organizationId: org.id, periodStart: '2025-01-01', periodEnd: '2025-03-31' });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quarterly-review-'));
  const backupPath = path.join(directory, 'cycles.json');
  try {
    expect((await migrateQuarterlyReviews(mongoose.connection.db)).cyclesToRetire).toBe(1);
    expect((await AppraisalCycle.findById(old._id)).retiredAt).toBeNull();
    await migrateQuarterlyReviews(mongoose.connection.db, { apply: true, backupPath });
    expect(JSON.parse(fs.readFileSync(backupPath)).cycles).toHaveLength(1);
    expect((await AppraisalCycle.findById(old._id)).retiredAt).toBeTruthy();
    expect(await AppraisalCycle.countDocuments({ retiredAt: null, organizationId: org.id })).toBe(5);
    const later = await AppraisalCycle.create({ name: 'Later HR cycle', organizationId: org.id, periodStart: '2026-01-01', periodEnd: '2026-03-31' });
    expect((await migrateQuarterlyReviews(mongoose.connection.db, { apply: true })).alreadyApplied).toBe(true);
    expect((await AppraisalCycle.findById(later._id)).retiredAt).toBeNull();
    const list = await call('get', '/cycles').expect(200);
    expect(list.body.data.some((cycle) => cycle._id === String(old._id))).toBe(false);
  } finally { fs.rmSync(directory, { recursive: true }); }
});
