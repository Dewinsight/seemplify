'use strict';

const SHARED_CONSUMERS = Object.freeze([
  Object.freeze({ id: 'identity-provider', applicationIdEnv: 'IDENTITY_PROVIDER_APP_ID' }),
  Object.freeze({ id: 'leave-management', applicationIdEnv: 'LEAVE_BACKEND_APP_ID' }),
  Object.freeze({ id: 'payroll', applicationIdEnv: 'PAYROLL_BACKEND_APP_ID' }),
  Object.freeze({ id: 'performance-management', applicationIdEnv: 'PERFORMANCE_BACKEND_APP_ID' }),
  Object.freeze({ id: 'recruiter', applicationIdEnv: 'RECRUITER_BACKEND_APP_ID' }),
  Object.freeze({ id: 'time-attendance', applicationIdEnv: 'TIME_ATTENDANCE_BACKEND_APP_ID' })
]);

const SHARED_CONSUMER_IDS = new Set(SHARED_CONSUMERS.map(({ id }) => id));
const EXCLUDED_CONSUMER_IDS = new Set(['experience-management']);

function normalizeSourceApp(value) {
  return String(value || '').trim().toLowerCase();
}

function allowedConsumerIds(value) {
  const requested = String(value || SHARED_CONSUMERS.map(({ id }) => id).join(','))
    .split(',')
    .map(normalizeSourceApp)
    .filter(Boolean);
  return [...new Set(requested.filter((id) => SHARED_CONSUMER_IDS.has(id) && !EXCLUDED_CONSUMER_IDS.has(id)))];
}

function isSharedConsumer(value) {
  const id = normalizeSourceApp(value);
  return SHARED_CONSUMER_IDS.has(id) && !EXCLUDED_CONSUMER_IDS.has(id);
}

function configuredConsumers(source = process.env) {
  return SHARED_CONSUMERS
    .map((consumer) => ({
      ...consumer,
      applicationId: String(source[consumer.applicationIdEnv] || '').trim()
    }))
    .filter(({ applicationId }) => applicationId);
}

module.exports = {
  EXCLUDED_CONSUMER_IDS,
  SHARED_CONSUMERS,
  SHARED_CONSUMER_IDS,
  allowedConsumerIds,
  configuredConsumers,
  isSharedConsumer,
  normalizeSourceApp
};
