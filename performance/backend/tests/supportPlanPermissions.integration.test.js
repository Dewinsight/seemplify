'use strict';
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Plan = require('../models/PerformanceSupportPlan');
const { requireAuth } = require('../middleware/rbac');
const { requireOrganization } = require('../services/tenantPolicy');
const routes = require('../routes/supportPlans');
const ORG = 'support-permission-org';
const permission = 'support_plan:manage:direct_reports';
let mongo, app, plan;
const call = (actor, org = ORG) => request(app).patch(`/api/support-plans/${plan._id}/milestones/${plan.milestones[0]._id}`)
  .set('x-support-actor', actor).set('x-support-org', org);
beforeAll(async () => {
  mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri());
  app = express(); app.use(express.json());
  app.use((req, _res, next) => {
    const actor = req.get('x-support-actor') || 'employee';
    if (actor === 'logged-out') return next();
    const org = req.get('x-support-org') || ORG;
    const userId = actor.startsWith('manager') ? 'manager' : actor.startsWith('hr') ? 'hr' : actor;
    const grants = actor.endsWith('-denied') || actor === 'employee' ? [] : [permission];
    const organization = { id: org, role: actor.startsWith('hr') ? 'hr_manager' : 'staff',
      appAccess: { mode: 'all', appIds: [] },
      ...(actor !== 'manager-legacy' ? { authorization: { permissionsByApp: { 'performance-management': grants } } } : {}) };
    const user = { id: userId, sub: userId, email: `${userId}@example.test`, currentOrganization: organization,
      organizations: [organization], idpTeams: [{ id: 'support-team', organizationId: org,
        role: actor.startsWith('manager') || actor === 'unrelated' ? 'line_manager' : 'member',
        ...(actor.startsWith('manager') ? { directReports: ['employee'] } : {}) }] };
    req.session = { user, currentOrganizationId: org }; next();
  });
  app.use('/api/support-plans', requireAuth, requireOrganization, routes);
});
beforeEach(async () => {
  await mongoose.connection.db.dropDatabase();
  plan = await Plan.create({ organizationId: ORG, employee: { userId: 'employee' }, manager: { userId: 'manager' },
    planType: 'informal_support', state: 'active', title: 'Synthetic milestone exercise', summary: 'Document progress and manager support.',
    objectives: [{ title: 'Raise risks', measure: 'Weekly notes', target: 'Every week', dueDate: '2027-01-01' }],
    supportCommitments: [{ description: 'Weekly support review', ownerType: 'manager' }],
    milestones: [{ title: 'First review', dueDate: '2027-01-01', employeeUpdate: 'Original employee progress', managerResponse: 'Original manager response' }] });
});
afterAll(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });

test.each(['manager-denied', 'hr-denied'])('%s cannot bypass an explicit central manage-grant denial through the milestone route', async actor => {
  const before = JSON.parse(JSON.stringify(await Plan.findById(plan._id)));
  await call(actor).send({ managerResponse: 'Unauthorized response', status: 'completed' }).expect(403);
  expect(JSON.parse(JSON.stringify(await Plan.findById(plan._id)))).toEqual(before);
});

test.each(['manager', 'hr', 'manager-legacy'])('%s retains an authorized milestone response and audit on the same plan', async actor => {
  const updated = await call(actor).send({ managerResponse: 'Reviewed the synthetic evidence', employeeUpdate: 'Forged employee text', status: 'completed' }).expect(200);
  expect(updated.body.data.milestones[0]).toMatchObject({ _id: String(plan.milestones[0]._id),
    managerResponse: 'Reviewed the synthetic evidence', employeeUpdate: 'Original employee progress', status: 'completed' });
  const saved = await Plan.findById(plan._id);
  expect(saved.audit).toHaveLength(1); expect(saved.audit[0].action).toBe('milestone_updated');
  expect(saved.milestones[0].managerResponse).toBe('Reviewed the synthetic evidence');
});

test('employee-own progress needs no manager grant and cannot replace the manager response', async () => {
  const updated = await call('employee').send({ employeeUpdate: 'Synthetic evidence is ready', managerResponse: 'Forged manager text', status: 'due' }).expect(200);
  expect(updated.body.data.milestones[0]).toMatchObject({ employeeUpdate: 'Synthetic evidence is ready',
    managerResponse: 'Original manager response', status: 'due' });
  const loaded = await request(app).get(`/api/support-plans/${plan._id}`).set('x-support-actor', 'employee').expect(200);
  expect(loaded.body.data.milestones[0].employeeUpdate).toBe('Synthetic evidence is ready');
});

test('a grant alone does not authorize unrelated or foreign plans, and authentication still precedes mutation', async () => {
  const before = JSON.parse(JSON.stringify(await Plan.findById(plan._id)));
  await call('unrelated').send({ managerResponse: 'Unrelated edit' }).expect(403);
  await call('manager', 'foreign-org').send({ managerResponse: 'Foreign edit' }).expect(404);
  await call('logged-out').send({ managerResponse: 'Anonymous edit' }).expect(401);
  expect(JSON.parse(JSON.stringify(await Plan.findById(plan._id)))).toEqual(before);
});

describe.each(['completed', 'cancelled', 'escalated'])('%s support plans retain their closed milestone evidence', state => {
  test.each(['employee', 'manager', 'hr'])('%s receives 409 without changing notes, state, timestamps or audit', async actor => {
    await Plan.updateOne({ _id: plan._id }, { $set: { state } });
    const before = JSON.parse(JSON.stringify(await Plan.findById(plan._id)));
    await call(actor).send({ employeeUpdate: 'Attempted replacement employee note', managerResponse: 'Attempted replacement manager note', status: 'missed' }).expect(409);
    expect(JSON.parse(JSON.stringify(await Plan.findById(plan._id)))).toEqual(before);
  });
});

test.each(['draft', 'hr_review', 'changes_requested', 'employee_review'])('manager cannot update milestones before the %s plan becomes active', async state => {
  await Plan.updateOne({ _id: plan._id }, { $set: { state } });
  const before = JSON.parse(JSON.stringify(await Plan.findById(plan._id)));
  await call('manager').send({ managerResponse: 'Premature response', status: 'completed' }).expect(409);
  expect(JSON.parse(JSON.stringify(await Plan.findById(plan._id)))).toEqual(before);
});

describe.each(['review_due', 'extended'])('%s support plans retain legitimate milestone updates', state => {
  test.each(['employee', 'manager'])('%s can save only their own note and audit', async actor => {
    await Plan.updateOne({ _id: plan._id }, { $set: { state } });
    const updated = await call(actor).send({ employeeUpdate: 'Employee progress retained', managerResponse: 'Manager support retained', status: 'completed' }).expect(200);
    expect(updated.body.data.state).toBe(state);
    expect(updated.body.data.milestones[0]).toMatchObject({
      employeeUpdate: actor === 'employee' ? 'Employee progress retained' : 'Original employee progress',
      managerResponse: actor === 'manager' ? 'Manager support retained' : 'Original manager response',
      status: 'completed'
    });
    const saved = await Plan.findById(plan._id);
    expect(saved.audit).toHaveLength(1);
    expect(saved.audit[0]).toMatchObject({ action: 'milestone_updated', actorId: actor });
  });
});

test('a closed-state guard retains central grant denial before exposing a milestone', async () => {
  await Plan.updateOne({ _id: plan._id }, { $set: { state: 'completed' } });
  const before = JSON.parse(JSON.stringify(await Plan.findById(plan._id)));
  await call('manager-denied').send({ managerResponse: 'Denied grant response' }).expect(403);
  expect(JSON.parse(JSON.stringify(await Plan.findById(plan._id)))).toEqual(before);
});

const outcome = (body) => request(app).post(`/api/support-plans/${plan._id}/outcome`).set('x-support-actor', 'manager').send(body);

test('extension date and human decision history survive completion and employee reload', async () => {
  await outcome({ decision: 'extended', reason: 'A further fictional support review is agreed.', nextReviewDate: '2026-12-20' }).expect(200);
  const extended = JSON.parse(JSON.stringify(await Plan.findById(plan._id)));
  const extensionAudit = extended.audit.find(event => event.action === 'outcome_extended');
  expect(extensionAudit).toMatchObject({ actorId: 'manager', details: { reason: extended.outcome.reason, nextReviewDate: '2026-12-20T00:00:00.000Z' } });
  await outcome({ decision: 'completed', reason: 'The fictional support objectives were completed.', previousOutcome: { decision: 'cancelled', nextReviewDate: '2099-01-01' } }).expect(200);
  const loaded = await request(app).get(`/api/support-plans/${plan._id}`).set('x-support-actor', 'employee').expect(200);
  expect(loaded.body.data).toMatchObject({ state: 'completed', outcome: { decision: 'completed', reason: 'The fictional support objectives were completed.', decidedBy: 'manager' } });
  expect(loaded.body.data.audit.find(event => event.action === 'outcome_extended')).toEqual(extensionAudit);
  expect(loaded.body.data.audit.find(event => event.action === 'outcome_completed')).toMatchObject({ actorId: 'manager', details: { previousOutcome: extended.outcome } });
  const history = await request(app).get(`/api/support-plans/${plan._id}/history`).set('x-support-actor', 'employee').expect(200);
  expect(history.body.data.find(event => event.action === 'outcome_extended').details.nextReviewDate).toBe('2026-12-20T00:00:00.000Z');
  const before = JSON.parse(JSON.stringify(await Plan.findById(plan._id)));
  await outcome({ decision: 'extended', reason: 'Attempted closed-plan change', nextReviewDate: '2027-01-01' }).expect(409);
  expect(JSON.parse(JSON.stringify(await Plan.findById(plan._id)))).toEqual(before);
});

test('completion snapshots an existing extension date even when its legacy audit omitted the date', async () => {
  await Plan.updateOne({ _id: plan._id }, { $set: {
    state: 'extended',
    outcome: { decision: 'extended', reason: 'Existing fictional extension', decidedBy: 'manager', decidedAt: new Date('2026-10-19'), nextReviewDate: new Date('2026-12-20') },
    audit: [{ action: 'outcome_extended', actorId: 'manager', details: { reason: 'Existing fictional extension' } }]
  } });
  const before = JSON.parse(JSON.stringify(await Plan.findById(plan._id)));
  await outcome({ decision: 'completed', reason: 'The existing extension objectives were completed.' }).expect(200);
  const after = JSON.parse(JSON.stringify(await Plan.findById(plan._id)));
  expect(after.audit[0]).toEqual(before.audit[0]);
  expect(after.audit[1]).toMatchObject({ action: 'outcome_completed', details: { previousOutcome: before.outcome } });
});
