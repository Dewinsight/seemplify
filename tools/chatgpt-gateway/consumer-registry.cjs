'use strict';

const SHARED_CONSUMERS = Object.freeze([
  Object.freeze({ id: 'experience-management', applicationIdEnv: 'EXPERIENCE_BACKEND_APP_ID' }),
  Object.freeze({ id: 'identity-provider', applicationIdEnv: 'IDENTITY_PROVIDER_APP_ID' }),
  Object.freeze({ id: 'leave-management', applicationIdEnv: 'LEAVE_BACKEND_APP_ID' }),
  Object.freeze({ id: 'messaging', applicationIdEnv: 'MESSAGING_BACKEND_APP_ID' }),
  Object.freeze({ id: 'payroll', applicationIdEnv: 'PAYROLL_BACKEND_APP_ID' }),
  Object.freeze({ id: 'performance-management', applicationIdEnv: 'PERFORMANCE_BACKEND_APP_ID' }),
  Object.freeze({ id: 'recruiter', applicationIdEnv: 'RECRUITER_BACKEND_APP_ID' }),
  Object.freeze({ id: 'time-attendance', applicationIdEnv: 'TIME_ATTENDANCE_BACKEND_APP_ID' })
]);

const SHARED_CONSUMER_IDS = new Set(SHARED_CONSUMERS.map(({ id }) => id));
const EXCLUDED_CONSUMER_IDS = new Set();

// Product services historically used their worker or route name as the usage
// source. The gateway authorizes products, not their internal processes, so
// normalize those established labels at the boundary while callers roll over
// to the canonical product identity. Keep this list explicit: accepting an
// arbitrary `recruiter-*` prefix would silently widen the allowlist.
const LEGACY_CONSUMER_ALIASES = Object.freeze({
  admin: 'recruiter',
  'ai-interview': 'recruiter',
  identityprovider: 'identity-provider',
  'recruiter-ai-interview': 'recruiter',
  'recruiter-cv-worker': 'recruiter',
  'recruiter-worker': 'recruiter'
});

function normalizeSourceApp(value) {
  return String(value || '').trim().toLowerCase();
}

function canonicalConsumerId(value) {
  const id = normalizeSourceApp(value);
  const canonical = LEGACY_CONSUMER_ALIASES[id] || id;
  return SHARED_CONSUMER_IDS.has(canonical) && !EXCLUDED_CONSUMER_IDS.has(canonical)
    ? canonical
    : null;
}

function allowedConsumerIds(value) {
  const requested = String(value || SHARED_CONSUMERS.map(({ id }) => id).join(','))
    .split(',')
    .map(canonicalConsumerId)
    .filter(Boolean);
  return [...new Set(requested)];
}

function isSharedConsumer(value) {
  return canonicalConsumerId(value) !== null;
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
  LEGACY_CONSUMER_ALIASES,
  SHARED_CONSUMERS,
  SHARED_CONSUMER_IDS,
  allowedConsumerIds,
  canonicalConsumerId,
  configuredConsumers,
  isSharedConsumer,
  normalizeSourceApp
};
