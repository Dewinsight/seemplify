const mongoose = require('mongoose');
const UserActivityEvent = require('../models/UserActivityEvent');

const READ_ACTIVITY_WINDOW_MS = 5 * 60 * 1000;
const SESSION_ACTIVITY_WINDOW_MS = 60 * 1000;
const MAX_CACHE_ENTRIES = 20_000;
const recentReadActivity = new Map();
const recentSessionActivity = new Map();

const MODULE_RULES = [
  [/^\/api\/ai-interviews(?:\/|$)/, 'ai-interviews'],
  [/^\/api\/(?:assistant|ai|chat-sessions)(?:\/|$)/, 'ai-assistant'],
  [/^\/api\/(?:people-transitions|onboarding)(?:\/|$)/, 'people-transitions'],
  [/^\/api\/(?:candidate-emails|candidate-shortlists|candidate-lists|candidates)(?:\/|$)/, 'candidates'],
  [/^\/api\/(?:interview-status|interview-stages|interviews)(?:\/|$)/, 'interviews'],
  [/^\/api\/jobs(?:\/|$)/, 'jobs'],
  [/^\/api\/(?:bulk-upload|cv)(?:\/|$)/, 'cv-processing'],
  [/^\/api\/(?:enrichment|embeddings)(?:\/|$)/, 'candidate-enrichment'],
  [/^\/api\/(?:organizations|departments)(?:\/|$)/, 'organization'],
  [/^\/api\/(?:credits|credit-packs|subscription|plans)(?:\/|$)/, 'billing'],
  [/^\/api\/(?:notifications)(?:\/|$)/, 'notifications'],
  [/^\/api\/(?:sessions|trusted-devices)(?:\/|$)/, 'security']
];

function normalizeActivityPath(value) {
  const path = String(value || '').split('?')[0] || '/';
  return path
    .replace(/\/[a-f\d]{24}(?=\/|$)/gi, '/:id')
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?=\/|$)/gi, '/:id')
    .replace(/\/\d+(?=\/|$)/g, '/:id')
    .slice(0, 240);
}

function getActivityModule(path) {
  const normalizedPath = normalizeActivityPath(path);
  const match = MODULE_RULES.find(([pattern]) => pattern.test(normalizedPath));
  return match ? match[1] : 'platform';
}

function getActivityAction(method, path) {
  const normalizedMethod = String(method || 'GET').toUpperCase();
  const normalizedPath = normalizeActivityPath(path);

  if (/\/(?:login|refresh)(?:\/|$)/.test(normalizedPath)) return 'signed in';
  if (/\/cancel(?:\/|$)/.test(normalizedPath)) return 'cancelled';
  if (/\/(?:schedule|from-pipeline|schedule-multi)(?:\/|$)/.test(normalizedPath)) return 'scheduled';
  if (/\/(?:upload|bulk-upload)(?:\/|$)/.test(normalizedPath)) return 'uploaded';
  if (/\/(?:send|invite)(?:\/|$)/.test(normalizedPath)) return 'sent';
  if (normalizedMethod === 'DELETE') return 'deleted';
  if (normalizedMethod === 'POST') return 'created';
  if (normalizedMethod === 'PUT' || normalizedMethod === 'PATCH') return 'updated';
  return 'viewed';
}

function getActivityCategory(method) {
  return ['GET', 'HEAD', 'OPTIONS'].includes(String(method || 'GET').toUpperCase())
    ? 'navigation'
    : 'action';
}

function resolveOrganizationId(req, fallbackOrganizationId) {
  const candidates = [
    req.activeOrganization,
    req.organization?._id,
    req.organization?.id,
    req.user?.currentOrganization,
    fallbackOrganizationId
  ];

  for (const candidate of candidates) {
    const value = candidate?._id || candidate?.id || candidate;
    if (value && mongoose.Types.ObjectId.isValid(String(value))) return value;
  }
  return undefined;
}

function pruneCache(cache) {
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  const entriesToDelete = cache.size - Math.floor(MAX_CACHE_ENTRIES * 0.75);
  let deleted = 0;
  for (const key of cache.keys()) {
    cache.delete(key);
    deleted += 1;
    if (deleted >= entriesToDelete) break;
  }
}

function shouldRecordReadActivity(key, now = Date.now()) {
  const previous = recentReadActivity.get(key);
  if (previous && now - previous < READ_ACTIVITY_WINDOW_MS) return false;
  recentReadActivity.set(key, now);
  pruneCache(recentReadActivity);
  return true;
}

function shouldRefreshSessionActivity(sessionId, lastActivityAt, now = Date.now()) {
  if (!sessionId) return false;
  const previous = recentSessionActivity.get(sessionId)
    || (lastActivityAt ? new Date(lastActivityAt).getTime() : 0);
  if (previous && now - previous < SESSION_ACTIVITY_WINDOW_MS) return false;
  recentSessionActivity.set(sessionId, now);
  pruneCache(recentSessionActivity);
  return true;
}

function attachUserActivityTracking(req, res, { user, session } = {}) {
  const userId = req.user?.id || user?._id || user?.id;
  if (!userId || req.activityTrackingAttached || String(req.path || '').startsWith('/api/admin')) return;
  req.activityTrackingAttached = true;

  const startedAt = Date.now();
  const fallbackOrganizationId = user?.currentOrganization;

  res.once('finish', () => {
    const occurredAt = new Date();
    const path = normalizeActivityPath(req.originalUrl || req.path);
    const method = String(req.method || 'GET').toUpperCase();
    const organization = resolveOrganizationId(req, fallbackOrganizationId);
    const category = getActivityCategory(method);
    const cacheKey = `${userId}:${organization || 'none'}:${method}:${path}`;

    const shouldRecord = category === 'action'
      || shouldRecordReadActivity(cacheKey, occurredAt.getTime());

    if (shouldRecord) {
      UserActivityEvent.create({
        organization,
        user: userId,
        sessionId: session?.accessTokenId,
        category,
        module: getActivityModule(path),
        action: getActivityAction(method, path),
        method,
        path,
        statusCode: res.statusCode,
        durationMs: Math.max(0, Date.now() - startedAt),
        ip: String(req.ip || req.socket?.remoteAddress || '').slice(0, 80),
        userAgent: String(req.headers?.['user-agent'] || '').slice(0, 500),
        occurredAt
      }).catch((error) => {
        console.warn('Unable to record user activity:', error.message);
      });
    }

    if (session?.accessTokenId && shouldRefreshSessionActivity(
      session.accessTokenId,
      session.lastActivityAt,
      occurredAt.getTime()
    )) {
      session.updateOne({ $set: { lastActivityAt: occurredAt } }).catch((error) => {
        console.warn('Unable to refresh session activity:', error.message);
      });
    }
  });
}

async function recordLoginActivity({ user, session, ip, userAgent, occurredAt = new Date() }) {
  return UserActivityEvent.create({
    organization: user.currentOrganization || undefined,
    user: user._id,
    sessionId: session?.accessTokenId,
    category: 'authentication',
    module: 'authentication',
    action: 'signed in',
    method: 'POST',
    path: '/api/auth/login',
    statusCode: 200,
    durationMs: 0,
    ip: String(ip || '').slice(0, 80),
    userAgent: String(userAgent || '').slice(0, 500),
    occurredAt
  });
}

module.exports = {
  READ_ACTIVITY_WINDOW_MS,
  normalizeActivityPath,
  getActivityModule,
  getActivityAction,
  getActivityCategory,
  shouldRecordReadActivity,
  attachUserActivityTracking,
  recordLoginActivity
};
