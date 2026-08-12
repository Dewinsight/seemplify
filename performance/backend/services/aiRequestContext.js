'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');

const storage = new AsyncLocalStorage();

function aiRequestContext(req, _res, next) {
  const preference = ['local', 'chatgpt'].includes(req.cookies?.performance_ai_runtime)
    ? req.cookies.performance_ai_runtime : 'default';
  const context = {
    runtimePreference: preference,
    requestId: req.headers['x-request-id'] || ''
  };
  // This middleware is mounted before route authentication. Resolve identity
  // lazily so a session populated or refreshed by later middleware is the
  // identity used by the AI gateway, never a stale pre-auth snapshot.
  Object.defineProperties(context, {
    actorId: {
      enumerable: true,
      get: () => req.session?.user?.sub || req.session?.user?.id || ''
    },
    identity: {
      enumerable: true,
      get: () => {
        const organizationId = String(req.session?.currentOrganizationId || '').trim();
        return {
          sub: req.session?.user?.sub || req.session?.user?.userinfo?.sub || req.session?.user?.id || '',
          email: String(req.session?.user?.email || req.session?.user?.userinfo?.email || '').trim().toLowerCase(),
          ...(organizationId ? { organizationId } : {})
        };
      }
    }
  });
  storage.run(context, next);
}

function withAIRequestContext(overrides, callback) {
  return storage.run({ ...(storage.getStore() || {}), ...(overrides || {}) }, callback);
}

module.exports = {
  aiRequestContext,
  getAIRequestContext: () => storage.getStore() || {},
  withAIRequestContext
};
