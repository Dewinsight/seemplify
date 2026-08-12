'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  allowedConsumerIds,
  canonicalConsumerId,
  configuredConsumers,
  isSharedConsumer
} = require('./consumer-registry.cjs');

test('shared registry includes the Seemplify suite and deliberately excludes Experience Management', () => {
  assert.deepEqual(allowedConsumerIds(), [
    'identity-provider',
    'leave-management',
    'messaging',
    'payroll',
    'performance-management',
    'recruiter',
    'time-attendance'
  ]);
  assert.equal(isSharedConsumer('recruiter'), true);
  assert.equal(isSharedConsumer('recruiter-cv-worker'), true);
  assert.equal(canonicalConsumerId('recruiter-cv-worker'), 'recruiter');
  assert.equal(canonicalConsumerId('recruiter-worker'), 'recruiter');
  assert.equal(canonicalConsumerId('recruiter-ai-interview'), 'recruiter');
  assert.equal(canonicalConsumerId('ai-interview'), 'recruiter');
  assert.equal(canonicalConsumerId('admin'), 'recruiter');
  assert.equal(canonicalConsumerId('identityprovider'), 'identity-provider');
  assert.equal(canonicalConsumerId('unknown-worker'), null);
  assert.equal(isSharedConsumer('experience-management'), false);
  assert.deepEqual(
    allowedConsumerIds('recruiter,experience-management,payroll,unknown,recruiter'),
    ['recruiter', 'payroll']
  );
  assert.deepEqual(
    allowedConsumerIds('recruiter-cv-worker,ai-interview,recruiter-worker'),
    ['recruiter']
  );
});

test('deployment consumers are discovered from optional platform application IDs', () => {
  const consumers = configuredConsumers({
    RECRUITER_BACKEND_APP_ID: 'recruiter-id',
    MESSAGING_BACKEND_APP_ID: 'messaging-id',
    PERFORMANCE_BACKEND_APP_ID: 'performance-id',
    EXPERIENCE_BACKEND_APP_ID: 'must-not-be-used'
  });
  assert.deepEqual(consumers.map(({ id }) => id), ['messaging', 'performance-management', 'recruiter']);
});
