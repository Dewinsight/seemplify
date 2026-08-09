'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const {
  isRuntimeGateError,
  isUnboundedRuntimeDeferral,
  isRetryableProcessingError,
  resolveOrganizationRuntimeActor
} = require('../services/cvAnalysisQueueService');
const { handleLoginRuntimeCheck } = require('../services/cvLoginRuntimeService');
const AIUserRuntimeAccount = require('../models/AIUserRuntimeAccount');
const Notification = require('../models/Notification');
const Organization = require('../models/Organization');
const User = require('../models/User');

let mongo;

test.before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

test('routing health accepts locked CV activities running on a connected ChatGPT account', () => {
  const { createDefaultRuntimeSettings, CHATGPT_PROVIDER } = require('../config/aiRuntimeCatalog');
  const settings = createDefaultRuntimeSettings();

  // The shipped default routes CV parsing to the user's own account, so the
  // admin console must not report it as an invalid provider.
  for (const activity of ['candidate.cv_parse', 'ai_interview.cv_parse']) {
    const route = settings.routes.find((item) => item.activity === activity);
    assert.equal(route.provider, CHATGPT_PROVIDER, `${activity} ships on ChatGPT`);
  }
  assert.equal(settings.routes.every((route) => route.provider === CHATGPT_PROVIDER), true,
    'every AI activity is locked to connected ChatGPT');
});

test('every ChatGPT runtime-gate failure defers instead of failing a CV', () => {
  const gateCodes = [
    'AI_RUNTIME_ACCOUNT_REQUIRED',
    'CODEX_DATA_SHARING_ACKNOWLEDGEMENT_REQUIRED',
    'AI_RUNTIME_CHATGPT_DISABLED',
    'CHATGPT_NOT_CONNECTED',
    'CHATGPT_SUBJECT_UNRESOLVED'
  ];
  for (const code of gateCodes) {
    const error = { code, message: 'runtime is gated' };
    assert.equal(isRuntimeGateError(error), true, `${code} must be a gate error`);
    assert.equal(isUnboundedRuntimeDeferral(error), true, `${code} must defer unbounded`);
    assert.equal(isRetryableProcessingError(error), true, `${code} must stay retryable`);
  }
  // A personal plan that ran out of usage is a waiting condition, not a failure.
  assert.equal(isRuntimeGateError({
    code: 'CODEX_TURN_FAILED',
    message: "You've hit your usage limit. Try again at Aug 10th."
  }), true);
  // A genuine turn failure is not a gate: it must keep its bounded-failure path.
  assert.equal(isRuntimeGateError({
    code: 'CODEX_TURN_FAILED',
    message: 'Invalid schema for response_format'
  }), false);
  assert.equal(isRuntimeGateError({ code: 'AI_RUNTIME_ERROR', message: 'boom' }), false);
});

test('an actorless job never borrows a member personal ChatGPT account', async () => {
  const organizationId = new mongoose.Types.ObjectId();
  const stale = await User.create({
    email: 'stale@example.test',
    password: 'Password-123!',
    profile: { firstName: 'Stale', lastName: 'Older' }
  });
  const owner = await User.create({
    email: 'owner@example.test',
    password: 'Password-123!',
    profile: { firstName: 'Olu', lastName: 'Owner' }
  });
  // Disconnected and consent-missing accounts must never be picked.
  await AIUserRuntimeAccount.create({
    user: stale._id,
    organization: organizationId,
    subjectKey: 'a'.repeat(24),
    status: 'connected',
    dataSharingAcknowledgedAt: null,
    connectedAt: new Date('2026-01-01')
  });
  await AIUserRuntimeAccount.create({
    user: owner._id,
    organization: organizationId,
    subjectKey: 'b'.repeat(24),
    status: 'connected',
    dataSharingAcknowledgedAt: new Date(),
    connectedAt: new Date('2026-06-01')
  });

  const resolved = await resolveOrganizationRuntimeActor(organizationId);
  assert.equal(resolved, null, 'personal consent only covers work the member initiates');

  const nobody = await resolveOrganizationRuntimeActor(new mongoose.Types.ObjectId());
  assert.equal(nobody, null, 'an organization with no routable account resolves to none');

  // An older account without an organization is equally ineligible.
  const orphanOrgId = new mongoose.Types.ObjectId();
  const orphanUser = await User.create({
    email: 'orphan@example.test',
    password: 'Password-123!',
    profile: { firstName: 'Ora', lastName: 'Orphan' },
    currentOrganization: orphanOrgId
  });
  await AIUserRuntimeAccount.create({
    user: orphanUser._id,
    subjectKey: 'c'.repeat(24),
    status: 'connected',
    dataSharingAcknowledgedAt: new Date(),
    connectedAt: new Date('2026-07-01')
  });
  const viaOrphan = await resolveOrganizationRuntimeActor(orphanOrgId);
  assert.equal(viaOrphan, null);
  const healed = await AIUserRuntimeAccount.findOne({ user: orphanUser._id }).lean();
  assert.equal(healed.organization, undefined, 'actorless lookup must not mutate a personal account');
});

test('login wakes waiting CV analyses once and tells the recruiter once', async () => {
  const founder = await User.create({
    email: 'founder@example.test',
    password: 'Password-123!',
    profile: { firstName: 'Fola', lastName: 'Founder' }
  });
  const organization = await Organization.create({ name: 'Gate Test Org', owner: founder._id });
  const user = await User.create({
    email: 'recruiter@example.test',
    password: 'Password-123!',
    profile: { firstName: 'Rita', lastName: 'Recruiter' },
    currentOrganization: organization._id
  });

  const calls = [];
  const queue = {
    promoteWaitingJobsForOrganization: async (orgId) => {
      calls.push(String(orgId));
      return { waiting: 3, promoted: 3 };
    }
  };

  const first = await handleLoginRuntimeCheck(user, { queue });
  assert.deepEqual(first, { waiting: 3, promoted: 3 });
  assert.deepEqual(calls, [String(organization._id)]);

  const notifications = await Notification.find({ user: user._id }).lean();
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, 'general');
  assert.match(notifications[0].message, /3 applicant CVs are waiting/);
  assert.equal(notifications[0].actionUrl, '/candidates');
  assert.equal(notifications[0].data.organizationName, 'Gate Test Org');

  // A second login the same day must not stack a duplicate notification.
  await handleLoginRuntimeCheck(user, { queue });
  assert.equal(await Notification.countDocuments({ user: user._id }), 1);

  // No waiting work, no notification.
  const quietQueue = { promoteWaitingJobsForOrganization: async () => ({ waiting: 0, promoted: 0 }) };
  const quietUser = await User.create({
    email: 'quiet@example.test',
    password: 'Password-123!',
    profile: { firstName: 'Q', lastName: 'Uiet' },
    currentOrganization: organization._id
  });
  assert.equal(await handleLoginRuntimeCheck(quietUser, { queue: quietQueue }), null);
  assert.equal(await Notification.countDocuments({ user: quietUser._id }), 0);
});
