'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');
const bootstrapLoad = Module._load;
Module._load = function bootstrapDependencies(request, parent, isMain) {
  if (request === 'axios') return { get: async () => ({ data: {} }) };
  return bootstrapLoad.call(this, request, parent, isMain);
};
const AIPerformanceService = require('../services/aiPerformanceService');
const { PerformanceAIRuntimeError } = require('../services/aiGatewayService');
Module._load = bootstrapLoad;

function loadHandlers() {
  const routes = new Map();
  const router = {
    post(path, ...handlers) { routes.set(`POST ${path}`, handlers); },
    get(path, ...handlers) { routes.set(`GET ${path}`, handlers); }
  };
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'express') return { Router: () => router };
    if (request === 'axios') return { get: async () => ({ data: {} }) };
    if (request === '../middleware/performanceMiddleware') {
      return { requirePerformancePermission: () => (_req, _res, next) => next() };
    }
    if (request === 'express-validator') {
      return { validationResult: () => ({ isEmpty: () => true, array: () => [] }) };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  const routePath = require.resolve('../routes/ai');
  delete require.cache[routePath];
  try {
    require(routePath);
  } finally {
    Module._load = originalLoad;
  }
  return routes;
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('AI feature route surfaces disconnected and consent-required account failures', async (t) => {
  const handlers = loadHandlers().get('POST /generate-okrs');
  const routeHandler = handlers[handlers.length - 1];
  const original = AIPerformanceService.generateOKRs;
  t.after(() => { AIPerformanceService.generateOKRs = original; });
  const request = {
    body: { userRole: 'Manager', teamGoals: 'Reliability', companyGoals: 'Growth' }
  };

  AIPerformanceService.generateOKRs = async () => {
    throw new PerformanceAIRuntimeError(
      'Connect ChatGPT before running this action.',
      'CHATGPT_ACCOUNT_NOT_CONNECTED',
      503,
      { retryable: true, retryAfterSeconds: 12 }
    );
  };
  const disconnected = responseRecorder();
  await routeHandler(request, disconnected);
  assert.equal(disconnected.statusCode, 503);
  assert.deepEqual(disconnected.body, {
    success: false,
    error: 'Connect ChatGPT before running this action.',
    code: 'CHATGPT_ACCOUNT_NOT_CONNECTED',
    retryable: true,
    retryAfterSeconds: 12
  });

  AIPerformanceService.generateOKRs = async () => {
    throw new PerformanceAIRuntimeError(
      'Review the Performance Management OpenAI acknowledgement.',
      'CHATGPT_CONSENT_REQUIRED',
      409
    );
  };
  const consentRequired = responseRecorder();
  await routeHandler(request, consentRequired);
  assert.equal(consentRequired.statusCode, 409);
  assert.equal(consentRequired.body.success, false);
  assert.equal(consentRequired.body.code, 'CHATGPT_CONSENT_REQUIRED');
});
