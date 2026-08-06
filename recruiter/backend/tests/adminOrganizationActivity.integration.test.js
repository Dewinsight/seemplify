const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const UserActivityEvent = require('../models/UserActivityEvent');
const UserSession = require('../models/UserSession');
const User = require('../models/User');
const Organization = require('../models/Organization');
const Job = require('../models/Job');
const Candidate = require('../models/Candidate');
const Interview = require('../models/Interview');
const AIInterview = require('../models/AIInterview');
const OnboardingAuditEvent = require('../models/OnboardingAuditEvent');
const { buildActivityDataset } = require('../services/adminOrganizationActivityService');

const testMongoUri = process.env.ADMIN_ACTIVITY_TEST_MONGO_URI;

test('aggregates organization, person, session, request, product and credit activity', {
  skip: testMongoUri ? false : 'ADMIN_ACTIVITY_TEST_MONGO_URI is not configured'
}, async (t) => {
  await mongoose.connect(testMongoUri);
  t.after(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  const now = new Date('2026-07-21T12:00:00.000Z');
  const userId = new mongoose.Types.ObjectId();
  const organizationId = new mongoose.Types.ObjectId();

  await User.collection.insertOne({
    _id: userId,
    email: 'recruiter@example.com',
    password: 'not-used',
    profile: { firstName: 'Amina', lastName: 'Okafor' },
    role: 'recruiter',
    isActive: true,
    currentOrganization: organizationId,
    organizationMemberships: [{ organization: organizationId, role: 'recruiter', isActive: true, joinedAt: now }],
    lastLoginAt: now,
    loginCount: 4,
    createdAt: new Date('2026-01-01T00:00:00.000Z')
  });

  await Organization.collection.insertOne({
    _id: organizationId,
    name: 'Northwind Hiring',
    owner: userId,
    isActive: true,
    members: [{ user: userId, role: 'recruiter', status: 'active', joinedAt: now }],
    subscription: {
      plan: 'pro',
      licenseStatus: 'active',
      creditUsage: {
        transactions: [{ action: 'createJob', credits: 2, performedBy: userId, timestamp: now }]
      }
    },
    createdAt: new Date('2026-01-01T00:00:00.000Z')
  });

  await UserSession.collection.insertOne({
    user: userId,
    fingerprint: 'browser-test',
    userAgent: 'Mozilla/5.0 Test Browser',
    ip: '127.0.0.1',
    refreshTokenHash: 'hash',
    accessTokenId: 'session-test',
    expiresAt: new Date('2026-08-01T00:00:00.000Z'),
    revoked: false,
    createdAt: now,
    lastActivityAt: now
  });

  await UserActivityEvent.collection.insertOne({
    organization: organizationId,
    user: userId,
    sessionId: 'session-test',
    category: 'navigation',
    module: 'jobs',
    action: 'viewed',
    method: 'GET',
    path: '/api/jobs',
    statusCode: 200,
    durationMs: 20,
    occurredAt: now,
    expiresAt: new Date('2027-07-21T00:00:00.000Z')
  });

  await Job.collection.insertOne({ _id: new mongoose.Types.ObjectId(), title: 'Product Manager', organization: organizationId, createdBy: userId, createdAt: now });
  await Candidate.collection.insertOne({ _id: new mongoose.Types.ObjectId(), firstName: 'Tayo', lastName: 'Cole', email: 'tayo@example.com', organization: organizationId, createdBy: userId, createdAt: now });
  await Interview.collection.insertOne({ _id: new mongoose.Types.ObjectId(), title: 'Hiring interview', organizationId, interviewerId: userId, candidateId: new mongoose.Types.ObjectId(), createdAt: now });
  await AIInterview.collection.insertOne({ _id: new mongoose.Types.ObjectId(), title: 'Async screening', organization: organizationId, createdBy: userId, createdAt: now });
  await OnboardingAuditEvent.collection.insertOne({ _id: new mongoose.Types.ObjectId(), organization: organizationId, actorType: 'user', actorUser: userId, action: 'transition_started', createdAt: now });

  const result = await buildActivityDataset({ range: '7d' }, now);

  assert.equal(result.totals.organizations, 1);
  assert.equal(result.totals.activeOrganizations, 1);
  assert.equal(result.totals.users, 1);
  assert.equal(result.totals.activeUsers, 1);
  assert.equal(result.totals.sessions, 1);
  assert.equal(result.totals.trackedRequests, 1);
  assert.equal(result.totals.businessActions, 5);
  assert.equal(result.totals.creditsUsed, 2);
  assert.equal(result.organizations[0].activeUsers, 1);
  assert.equal(result.organizations[0].activationRate, 100);
  assert.equal(result.users[0].businessActions, 5);
  assert.equal(result.trend.at(-1).actions, 5);
});
