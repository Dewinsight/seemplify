const axios = require('axios');
const User = require('../models/User');
const { createHash } = require('node:crypto');
const inFlight = new Map();

async function mirrorDirectory(data) {
  if (!data.members.length) return;
  const organizationId = String(data.organizationId);
  await User.bulkWrite(data.members.map(member => ({ updateOne: {
    filter: { $or: [{ idpSub: member.userId }, { email: member.email.toLowerCase() }] }, upsert: true,
    update: [{ $set: {
      idpSub: { $literal: member.userId }, email: { $literal: member.email.toLowerCase() },
      'profile.displayName': { $literal: member.name },
      idpTeams: { $concatArrays: [{ $filter: { input: { $ifNull: ['$idpTeams', []] }, as: 'team', cond: { $ne: ['$$team.organizationId', organizationId] } } }, { $literal: member.teams || [] }] },
      organizationMemberships: { $concatArrays: [{ $filter: { input: { $ifNull: ['$organizationMemberships', []] }, as: 'membership', cond: { $ne: ['$$membership.organization', organizationId] } } }, { $literal: [{ organization: organizationId, role: member.organizationRole, isActive: true }] }] },
      currentOrganizationId: { $ifNull: ['$currentOrganizationId', { $literal: organizationId }] },
      createdAt: { $ifNull: ['$createdAt', '$$NOW'] }, updatedAt: '$$NOW'
    } }]
  } })));
}

async function loadPerformanceDirectory(req) {
  if (req._performanceDirectory !== undefined) return req._performanceDirectory;
  const user = req.session?.user;
  const organizationId = String(req.currentOrganization?.id || req.session?.currentOrganizationId || user?.currentOrganization?.id || '');
  // requireAuth stores a verified delegated token on the normalized principal.
  // A raw Authorization header may be unrelated to the active session.
  const token = user?.accessToken;
  if (!token || !organizationId) {
    if (process.env.NODE_ENV === 'production') throw Object.assign(new Error('Sign in again to refresh your organization directory.'), { status: 503 });
    req._performanceDirectory = null;
    return null;
  }
  try {
    const key = createHash('sha256').update(`${organizationId}:${req.query?.scope || ''}:${token}`).digest('hex');
    if (inFlight.has(key)) {
      req._performanceDirectory = await inFlight.get(key);
      return req._performanceDirectory;
    }
    const pending = (async () => {
      try {
        const base = process.env.IDP_ISSUER_URL || process.env.OIDC_ISSUER || 'http://localhost:4000';
        const { data } = await axios.get(`${base.replace(/\/$/, '')}/api/organizations/${encodeURIComponent(organizationId)}/performance-directory`, {
          headers: { Authorization: `Bearer ${token}` }, params: req.query?.scope === 'managed' ? { scope: 'managed' } : {}, timeout: 10000
        });
        if (String(data.organizationId) !== organizationId || !Array.isArray(data.members) || !Array.isArray(data.teams) || !Array.isArray(data.reviewers) ||
          data.members.some(member => !member.userId || !member.email || !Array.isArray(member.teams))) throw new Error('Invalid organization directory');
        await mirrorDirectory(data);
        return data;
      } finally { inFlight.delete(key); }
    })();
    inFlight.set(key, pending);
    req._performanceDirectory = await pending;
    return req._performanceDirectory;
  } catch (error) {
    if (error.response?.status === 401) throw Object.assign(new Error('Your Seemplify Identity session has expired. Please sign in again.'), { status: 401 });
    if (error.response?.status === 403) throw Object.assign(new Error('Your access to this organization has changed. Sign in again or choose another organization.'), { status: 403 });
    throw Object.assign(new Error('Could not refresh people and teams from Seemplify Identity. Please retry.'), { status: 503 });
  }
}

module.exports = { loadPerformanceDirectory };
