'use strict';

const crypto = require('node:crypto');

const SERVICE_KEY_CONTEXT = 'seemplify-local-llm-service-v2';
const SIGNATURE_VERSION = '2';

const RECRUITER_ACTIVITY_PREFIXES = Object.freeze([
  'recruiter.', 'candidate.', 'job.', 'matching.', 'assistant.',
  'analytics.', 'report.', 'interview.', 'ai_interview.'
]);

const XPLORER_ACTIVITIES = Object.freeze(new Set([
  'knowledge.ask', 'knowledge.source_ingestion', 'knowledge.draft_generation',
  'inbox.classification', 'case.recommendation', 'ai.advisory', 'ai.copilot',
  'summarization', 'action.classification', 'ai.interview.reasoning',
  'ai.interview.chat'
]));

const SERVICE_POLICIES = Object.freeze({
  recruiter: Object.freeze({
    requestSources: Object.freeze(new Set([
      'recruiter', 'admin', 'ai-interview', 'recruiter-ai-interview',
      'recruiter-cv-worker', 'recruiter-worker',
      // These are signed operator harnesses, not product identities. They stay
      // explicit so a product cannot invent another unmetered source label.
      'gateway-integration-test', 'local-benchmark', 'local-codex-benchmark',
      'local-cv-evaluation', 'local-engine-benchmark', 'local-engine-verification',
      'local-external-smoke', 'local-soak', 'provider-benchmark',
      'runtime-model-evaluation'
    ])),
    meteringSources: Object.freeze(new Set(['recruiter'])),
    codexSources: Object.freeze(new Set(['recruiter'])),
    activityPrefixes: RECRUITER_ACTIVITY_PREFIXES,
    completion: true,
    codex: true,
    queueTelemetry: true
  }),
  'performance-management': Object.freeze({
    requestSources: Object.freeze(new Set(['performance-management'])),
    meteringSources: Object.freeze(new Set(['performance-management'])),
    codexSources: Object.freeze(new Set()),
    activityPrefixes: Object.freeze(['performance.']),
    completion: true,
    codex: false,
    queueTelemetry: false
  }),
  'experience-management': Object.freeze({
    requestSources: Object.freeze(new Set(['experience-management', 'knowledge-runtime'])),
    meteringSources: Object.freeze(new Set(['experience-management'])),
    codexSources: Object.freeze(new Set()),
    activityPrefixes: Object.freeze(['experience.']),
    completion: true,
    codex: false,
    queueTelemetry: false
  }),
  'xplorer-crm': Object.freeze({
    requestSources: Object.freeze(new Set(['xplorer-crm'])),
    meteringSources: Object.freeze(new Set(['xplorer-crm'])),
    codexSources: Object.freeze(new Set()),
    activities: XPLORER_ACTIVITIES,
    activityPrefixes: Object.freeze([]),
    completion: true,
    codex: false,
    queueTelemetry: false
  }),
  'identity-provider': Object.freeze({
    requestSources: Object.freeze(new Set(['identity-provider', 'identityprovider'])),
    meteringSources: Object.freeze(new Set(['identity-provider'])),
    codexSources: Object.freeze(new Set()),
    activityPrefixes: Object.freeze(['identity.', 'idp.']),
    completion: true,
    codex: false,
    queueTelemetry: false
  }),
  'leave-management': Object.freeze({
    requestSources: Object.freeze(new Set(['leave-management'])),
    meteringSources: Object.freeze(new Set(['leave-management'])),
    codexSources: Object.freeze(new Set()),
    activityPrefixes: Object.freeze(['leave.']),
    completion: true,
    codex: false,
    queueTelemetry: false
  }),
  payroll: Object.freeze({
    requestSources: Object.freeze(new Set(['payroll'])),
    meteringSources: Object.freeze(new Set(['payroll'])),
    codexSources: Object.freeze(new Set()),
    activityPrefixes: Object.freeze(['payroll.']),
    completion: true,
    codex: false,
    queueTelemetry: false
  }),
  'time-attendance': Object.freeze({
    requestSources: Object.freeze(new Set(['time-attendance'])),
    meteringSources: Object.freeze(new Set(['time-attendance'])),
    codexSources: Object.freeze(new Set()),
    activityPrefixes: Object.freeze(['attendance.', 'time-attendance.']),
    completion: true,
    codex: false,
    queueTelemetry: false
  })
});

function normalizeServiceId(value) {
  return String(value || '').trim().toLowerCase();
}

function servicePolicy(value) {
  return SERVICE_POLICIES[normalizeServiceId(value)] || null;
}

function deriveServiceSecret(masterSecret, serviceId) {
  const master = String(masterSecret || '').trim();
  const normalized = normalizeServiceId(serviceId);
  if (!master) throw new TypeError('The Local LLM gateway master secret is required');
  if (!servicePolicy(normalized)) throw new TypeError(`Unknown Local LLM service ${normalized || '(empty)'}`);
  return crypto.createHmac('sha256', master)
    .update(`${SERVICE_KEY_CONTEXT}:${normalized}`)
    .digest('base64url');
}

function signatureInput({ timestamp, nonce, serviceId, method, requestPath, rawBody }) {
  return [
    String(timestamp || ''), String(nonce || ''), normalizeServiceId(serviceId),
    String(method || '').toUpperCase(), String(requestPath || ''), String(rawBody || '')
  ].join('\n');
}

function signatureForServiceSecret(serviceSecret, input) {
  return crypto.createHmac('sha256', String(serviceSecret || ''))
    .update(signatureInput(input))
    .digest('base64url');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifyServiceSignature(masterSecret, input, suppliedSignature) {
  const policy = servicePolicy(input.serviceId);
  if (!policy) return false;
  const serviceSecret = deriveServiceSecret(masterSecret, input.serviceId);
  return safeEqual(signatureForServiceSecret(serviceSecret, input), suppliedSignature);
}

function isLoopbackHost(value) {
  const host = String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  return ['127.0.0.1', '::1', 'localhost'].includes(host);
}

function isLoopbackAddress(value) {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(String(value || '').trim().toLowerCase());
}

function legacyV1Allowed({ nodeEnv, gatewayHost, remoteAddress, forwarded = false } = {}) {
  return String(nodeEnv || '').trim().toLowerCase() !== 'production'
    && isLoopbackHost(gatewayHost)
    && isLoopbackAddress(remoteAddress)
    && forwarded !== true;
}

function activityAllowed(policy, activity) {
  const normalized = String(activity || '').trim().toLowerCase();
  return Boolean(normalized) && (
    policy.activities?.has(normalized)
    || policy.activityPrefixes.some((prefix) => normalized.startsWith(prefix))
  );
}

function authorizeServiceRequest(serviceId, {
  requestPath,
  activity,
  requestSource,
  meteringSource,
  codexSource
} = {}) {
  const normalized = normalizeServiceId(serviceId);
  const policy = servicePolicy(normalized);
  if (!policy) return { ok: false, code: 'SERVICE_NOT_AUTHORIZED' };
  const path = String(requestPath || '');
  if (path === '/v1/status') return { ok: true, serviceId: normalized };
  if (path === '/v1/queue-telemetry') {
    return policy.queueTelemetry
      ? { ok: true, serviceId: normalized }
      : { ok: false, code: 'SERVICE_PATH_NOT_AUTHORIZED' };
  }
  if (path.startsWith('/v1/codex/')) {
    if (!policy.codex || !policy.codexSources.has(String(codexSource || '').trim().toLowerCase())) {
      return { ok: false, code: 'SERVICE_CODEX_SOURCE_MISMATCH' };
    }
    return { ok: true, serviceId: normalized };
  }
  if (!['/v1/complete', '/v1/cv/analyze'].includes(path) || !policy.completion) {
    return { ok: false, code: 'SERVICE_PATH_NOT_AUTHORIZED' };
  }
  if (!activityAllowed(policy, activity)) return { ok: false, code: 'SERVICE_ACTIVITY_MISMATCH' };
  if (!policy.requestSources.has(String(requestSource || '').trim().toLowerCase())) {
    return { ok: false, code: 'SERVICE_REQUEST_SOURCE_MISMATCH' };
  }
  if (meteringSource != null && !policy.meteringSources.has(String(meteringSource).trim().toLowerCase())) {
    return { ok: false, code: 'SERVICE_METERING_SOURCE_MISMATCH' };
  }
  if (codexSource != null && !policy.codexSources.has(String(codexSource).trim().toLowerCase())) {
    return { ok: false, code: 'SERVICE_CODEX_SOURCE_MISMATCH' };
  }
  return { ok: true, serviceId: normalized };
}

module.exports = {
  SERVICE_KEY_CONTEXT,
  SERVICE_POLICIES,
  SIGNATURE_VERSION,
  authorizeServiceRequest,
  deriveServiceSecret,
  legacyV1Allowed,
  normalizeServiceId,
  servicePolicy,
  signatureForServiceSecret,
  signatureInput,
  verifyServiceSignature
};
