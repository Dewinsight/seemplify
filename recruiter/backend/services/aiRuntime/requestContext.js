const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

function cleanContext(value = {}) {
  const result = {};
  for (const [key, item] of Object.entries(value || {})) {
    if (item === undefined || item === null || item === '') continue;
    result[key] = typeof item === 'object' && item.toString ? item.toString() : item;
  }
  return result;
}

function getAIRequestContext(overrides = {}) {
  return {
    ...(storage.getStore() || {}),
    ...cleanContext(overrides)
  };
}

function updateAIRequestContext(updates = {}) {
  const current = storage.getStore();
  if (current) Object.assign(current, cleanContext(updates));
  return getAIRequestContext();
}

function runWithAIRequestContext(context, callback) {
  return storage.run(cleanContext(context), callback);
}

function aiRequestContextMiddleware(req, _res, next) {
  const requestId = String(req.headers['x-request-id'] || req.headers['x-trace-id'] || crypto.randomUUID());
  req.aiRequestId = requestId;
  runWithAIRequestContext({
    requestId,
    sourceApp: 'recruiter',
    ipAddress: req.ip,
    userAgent: req.get('user-agent')
  }, next);
}

module.exports = {
  aiRequestContextMiddleware,
  getAIRequestContext,
  runWithAIRequestContext,
  updateAIRequestContext
};
