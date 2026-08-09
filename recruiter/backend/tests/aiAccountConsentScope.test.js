'use strict';

const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const test = require('node:test');

const AIUserRuntimeAccount = require('../models/AIUserRuntimeAccount');

test('Performance consent is routable only for Performance and never implies Recruiter CV consent', () => {
  const account = new AIUserRuntimeAccount({
    user: new mongoose.Types.ObjectId(),
    subjectKey: 'consent-scope-test',
    status: 'connected',
    performanceDataSharingAcknowledgedAt: new Date('2026-08-09T10:00:00Z')
  });
  assert.equal(account.isRoutable('performance'), true);
  assert.equal(account.isRoutable('recruiter'), false);
  const publicPerformance = account.toPublicJSON({ app: 'performance' });
  const publicRecruiter = account.toPublicJSON();
  assert.equal(publicPerformance.routable, true);
  assert.equal(publicPerformance.consentScope, 'performance');
  assert.equal(publicRecruiter.routable, false);
  assert.equal(publicRecruiter.dataSharingAcknowledgedAt, null);
});

test('usage observation timestamp is null when only connection verification was observed', () => {
  const account = new AIUserRuntimeAccount({
    user: new mongoose.Types.ObjectId(),
    subjectKey: 'truthful-usage-test',
    status: 'connected',
    lastVerifiedAt: new Date('2026-08-09T10:00:00Z')
  });
  const payload = account.toPublicJSON();
  assert.equal(payload.usage.available, false);
  assert.equal(payload.usage.observedAt, null);
});
