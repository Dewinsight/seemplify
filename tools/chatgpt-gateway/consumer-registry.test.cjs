'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  allowedConsumerIds,
  configuredConsumers,
  isSharedConsumer
} = require('./consumer-registry.cjs');

test('shared registry includes the Seemplify suite and deliberately excludes Experience Management', () => {
  assert.deepEqual(allowedConsumerIds(), [
    'identity-provider',
    'leave-management',
    'payroll',
    'performance-management',
    'recruiter',
    'time-attendance'
  ]);
  assert.equal(isSharedConsumer('recruiter'), true);
  assert.equal(isSharedConsumer('experience-management'), false);
  assert.deepEqual(
    allowedConsumerIds('recruiter,experience-management,payroll,unknown,recruiter'),
    ['recruiter', 'payroll']
  );
});

test('deployment consumers are discovered from optional platform application IDs', () => {
  const consumers = configuredConsumers({
    RECRUITER_BACKEND_APP_ID: 'recruiter-id',
    PERFORMANCE_BACKEND_APP_ID: 'performance-id',
    EXPERIENCE_BACKEND_APP_ID: 'must-not-be-used'
  });
  assert.deepEqual(consumers.map(({ id }) => id), ['performance-management', 'recruiter']);
});
