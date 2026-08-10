'use strict';

let sessionStore = null;

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildSessionIdentityFilter(userId) {
  const normalized = String(userId || '').trim();
  if (!normalized) return null;
  const serialized = new RegExp(`"(?:sub|id)"\\s*:\\s*"${escapeRegExp(normalized)}"`);
  return {
    $or: [
      { 'session.user.sub': normalized },
      { 'session.user.id': normalized },
      { 'session.passport.user.sub': normalized },
      { session: { $regex: serialized } },
    ],
  };
}

function initSessionStore(store) {
  sessionStore = store;
}

async function sessionCollection() {
  if (!sessionStore) throw new Error('Payroll session store is not initialized');
  const collection = sessionStore.collectionPromise
    ? await sessionStore.collectionPromise
    : sessionStore.collection;
  if (!collection) throw new Error('Payroll session collection is unavailable');
  return collection;
}

async function getUserSessions(userId) {
  const filter = buildSessionIdentityFilter(userId);
  if (!filter) return [];
  return (await sessionCollection()).find(filter).toArray();
}

async function invalidateUserSessions(userId) {
  const filter = buildSessionIdentityFilter(userId);
  if (!filter) return 0;
  const result = await (await sessionCollection()).deleteMany(filter);
  return Number(result.deletedCount || 0);
}

function updateUserTeamClaims(userId) { return invalidateUserSessions(userId); }
function updateUserOrgClaims(userId) { return invalidateUserSessions(userId); }
function refreshUserClaims(userId) { return invalidateUserSessions(userId); }

module.exports = {
  initSessionStore,
  buildSessionIdentityFilter,
  getUserSessions,
  invalidateUserSessions,
  updateUserTeamClaims,
  updateUserOrgClaims,
  refreshUserClaims,
};
