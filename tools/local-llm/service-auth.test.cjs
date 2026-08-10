'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  authorizeServiceRequest,
  deriveServiceSecret,
  legacyV1Allowed,
  signatureForServiceSecret,
  verifyServiceSignature
} = require('./service-auth.cjs');

const master = 'local-gateway-master-secret-for-tests';
const signedInput = {
  timestamp: '1770000000000',
  nonce: 'nonce_1234567890abcdef',
  serviceId: 'performance-management',
  method: 'POST',
  requestPath: '/v1/complete',
  rawBody: '{"activity":"performance.okr.generate"}'
};

test('service credentials and signatures are cryptographically bound to the service id', () => {
  const performanceSecret = deriveServiceSecret(master, 'performance-management');
  const recruiterSecret = deriveServiceSecret(master, 'recruiter');
  assert.notEqual(performanceSecret, recruiterSecret);
  const signature = signatureForServiceSecret(performanceSecret, signedInput);
  assert.equal(verifyServiceSignature(master, signedInput, signature), true);
  assert.equal(verifyServiceSignature(master, { ...signedInput, serviceId: 'recruiter' }, signature), false);
  assert.equal(verifyServiceSignature(master, { ...signedInput, requestPath: '/v1/status' }, signature), false);
});

test('Performance cannot claim Recruiter source, metering, activity, or Codex namespaces', () => {
  const base = {
    requestPath: '/v1/complete',
    activity: 'performance.okr.generate',
    requestSource: 'performance-management',
    meteringSource: 'performance-management'
  };
  assert.equal(authorizeServiceRequest('performance-management', base).ok, true);
  assert.equal(authorizeServiceRequest('performance-management', { ...base, activity: 'candidate.cv_parse' }).code, 'SERVICE_ACTIVITY_MISMATCH');
  assert.equal(authorizeServiceRequest('performance-management', { ...base, requestSource: 'recruiter' }).code, 'SERVICE_REQUEST_SOURCE_MISMATCH');
  assert.equal(authorizeServiceRequest('performance-management', { ...base, meteringSource: 'recruiter' }).code, 'SERVICE_METERING_SOURCE_MISMATCH');
  assert.equal(authorizeServiceRequest('performance-management', {
    requestPath: '/v1/codex/account', codexSource: 'recruiter'
  }).code, 'SERVICE_CODEX_SOURCE_MISMATCH');
  assert.equal(authorizeServiceRequest('performance-management', {
    requestPath: '/v1/queue-telemetry'
  }).code, 'SERVICE_PATH_NOT_AUTHORIZED');
});

test('Experience and CRM are restricted to their own existing activity namespaces', () => {
  assert.equal(authorizeServiceRequest('experience-management', {
    requestPath: '/v1/complete', activity: 'experience.knowledge_graph_extract',
    requestSource: 'knowledge-runtime', meteringSource: 'experience-management'
  }).ok, true);
  assert.equal(authorizeServiceRequest('experience-management', {
    requestPath: '/v1/complete', activity: 'knowledge.ask',
    requestSource: 'knowledge-runtime', meteringSource: 'experience-management'
  }).code, 'SERVICE_ACTIVITY_MISMATCH');
  assert.equal(authorizeServiceRequest('xplorer-crm', {
    requestPath: '/v1/complete', activity: 'knowledge.ask',
    requestSource: 'xplorer-crm', meteringSource: 'xplorer-crm'
  }).ok, true);
  assert.equal(authorizeServiceRequest('xplorer-crm', {
    requestPath: '/v1/complete', activity: 'performance.review.bias',
    requestSource: 'xplorer-crm', meteringSource: 'xplorer-crm'
  }).code, 'SERVICE_ACTIVITY_MISMATCH');
});

test('legacy v1 is limited to an unforwarded loopback request in non-production', () => {
  assert.equal(legacyV1Allowed({
    nodeEnv: 'development', gatewayHost: '127.0.0.1', remoteAddress: '::1'
  }), true);
  assert.equal(legacyV1Allowed({
    nodeEnv: 'production', gatewayHost: '127.0.0.1', remoteAddress: '::1'
  }), false);
  assert.equal(legacyV1Allowed({
    nodeEnv: 'development', gatewayHost: '0.0.0.0', remoteAddress: '127.0.0.1'
  }), false);
  assert.equal(legacyV1Allowed({
    nodeEnv: 'development', gatewayHost: '127.0.0.1', remoteAddress: '127.0.0.1', forwarded: true
  }), false);
});
