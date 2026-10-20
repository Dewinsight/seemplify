'use strict';
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const User = require('../models/User');
const FeedbackRequest = require('../models/FeedbackRequest');
const userRoutes = require('../routes/user');
const feedbackRoutes = require('../routes/feedback');
const ORG = 'feedback-capability-org';
let app, mongo;
const cases = [['employee-allowed', true], ['employee-denied', false], ['manager-denied', false], ['hr-denied', false], ['employee-legacy', true]];
beforeAll(async () => {
  mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri());
  app = express(); app.use(express.json());
  app.use((req, _res, next) => {
    const actor = req.get('x-capability-actor') || 'employee-allowed';
    const denied = actor.endsWith('-denied');
    const organization = { id: ORG, name: 'Synthetic capability exercise', role: actor.startsWith('hr') ? 'hr_manager' : 'staff',
      appAccess: { mode: 'all', appIds: [] },
      ...(!actor.endsWith('-legacy') ? { authorization: { permissionsByApp: { 'performance-management': denied ? [] : ['feedback:request'] } } } : {}) };
    const user = { id: 'subject', sub: 'subject', email: 'subject@example.test', name: 'Synthetic subject', currentOrganization: organization,
      organizations: [organization, { id: 'other-org', role: 'owner', authorization: { permissionsByApp: { 'performance-management': denied ? ['feedback:request'] : [] } } }],
      idpTeams: [{ id: 'capability-team', organizationId: ORG, role: actor.startsWith('manager') ? 'line_manager' : 'member',
        ...(actor.startsWith('manager') ? { directReports: [] } : {}) }] };
    req.session = { user, currentOrganizationId: ORG }; next();
  });
  app.use('/api/user', userRoutes); app.use('/api/feedback', feedbackRoutes);
});
beforeEach(async () => {
  await mongoose.connection.db.dropDatabase();
  await User.create(['subject', 'reviewer'].map(idpSub => ({ idpSub, email: `${idpSub}@example.test`, isActive: true,
    profile: { displayName: `Synthetic ${idpSub}` }, organizationMemberships: [{ organization: ORG, role: 'staff', isActive: true }] })));
});
afterAll(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });

test.each(cases)('%s context matches the selected-organization feedback-request authority and actual POST guard', async (actor, allowed) => {
  const context = await request(app).get('/api/user/context').set('x-capability-actor', actor).expect(200);
  expect(context.body.data.features.canRequestFeedback).toBe(allowed);
  expect(context.body.data.organization).toEqual({ id: ORG, name: 'Synthetic capability exercise' });
  expect(context.body.data).not.toHaveProperty('authorization');
  const response = await request(app).post('/api/feedback/requests').set('x-capability-actor', actor)
    .send({ subjectId: 'subject', reviewerIds: ['reviewer'], contextType: 'general', anonymity: 'named', dueDate: new Date(Date.now() + 86400000).toISOString() })
    .expect(allowed ? 201 : 403);
  expect(await FeedbackRequest.countDocuments({ organizationId: ORG })).toBe(allowed ? 1 : 0);
  if (!allowed) expect(response.body.code).toBe('PERMISSION_DENIED');
});
