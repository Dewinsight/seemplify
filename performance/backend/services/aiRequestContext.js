'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');

const storage = new AsyncLocalStorage();

function aiRequestContext(req, _res, next) {
  const preference = ['local', 'chatgpt'].includes(req.cookies?.performance_ai_runtime)
    ? req.cookies.performance_ai_runtime : 'default';
  storage.run({
    runtimePreference: preference,
    actorId: req.session?.user?.sub || req.session?.user?.id || '',
    requestId: req.headers['x-request-id'] || ''
  }, next);
}

module.exports = { aiRequestContext, getAIRequestContext: () => storage.getStore() || {} };
