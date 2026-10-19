const axios = require('axios');
const id = value => String(value?.id || value?._id || value || '');
const failure = (status = 503) => Object.assign(new Error(status === 401
  ? 'Your Seemplify Identity session has expired. Please sign in again.'
  : status === 403 ? 'Your access to this organization has changed. Sign in again or choose another organization.'
    : 'Could not refresh colleagues from Seemplify Identity. Please retry.'), { status });

async function loadPerformanceColleagues(req, { q, userId, action, limit = 10 } = {}, client = axios) {
  const user = req.session?.user;
  const organizationId = id(req.currentOrganization || req.session?.currentOrganizationId || user?.currentOrganization);
  // Only requireAuth's verified delegated principal token is trusted. A raw
  // Authorization header might refer to a different account or organization.
  const token = user?.accessToken;
  if (!organizationId) throw failure();
  if (!token) {
    if (process.env.NODE_ENV === 'production') throw failure(401);
    return null;
  }
  const search = typeof q === 'string' ? q.trim().slice(0, 120) : '';
  const maximum = Math.min(25, Math.max(1, Number.parseInt(limit, 10) || 10));
  const exact = userId !== undefined;
  if (exact && (typeof userId !== 'string' || !userId.trim() || userId.trim().length > 256)) throw failure(403);
  if (!exact && search.length < 2) return { organizationId, members: [] };
  try {
    const base = process.env.IDP_ISSUER_URL || process.env.OIDC_ISSUER || 'http://localhost:4000';
    const { data } = await client.get(`${base.replace(/\/$/, '')}/api/organizations/${encodeURIComponent(organizationId)}/performance-colleagues`, {
      headers: { Authorization: `Bearer ${token}` }, params: { ...(exact ? { userId: userId.trim() } : { q: search }),
        ...(action ? { action } : {}), limit: exact ? 1 : maximum }, timeout: 10000, maxRedirects: 0
    });
    if (id(data?.organizationId) !== organizationId || !Array.isArray(data.members) || data.members.length > 25 ||
        data.members.some(member => !member || ['userId', 'name', 'email'].some(field => typeof member[field] !== 'string' || !member[field].trim()) ||
          (member.jobTitle !== undefined && typeof member.jobTitle !== 'string') || (exact && member.userId !== userId.trim()))) throw failure();
    // Even an upstream response with extra fields cannot leak authority or team
    // metadata through a collaboration picker. Do not mirror this into User.
    return { organizationId, members: data.members.slice(0, maximum).map(member => ({
      userId: member.userId, name: member.name, email: member.email,
      ...(member.jobTitle ? { jobTitle: member.jobTitle } : {})
    })) };
  } catch (error) {
    throw failure([401, 403].includes(error.response?.status) ? error.response.status : 503);
  }
}

async function resolvePerformanceColleague(req, userId, { action } = {}) {
  const directory = await loadPerformanceColleagues(req, { userId, action });
  if (directory) {
    // The exact IdP lookup is authoritative, including removals and app access.
    // Never fall back to a cached user after an empty or failed remote response.
    if (directory.members.length === 1) return directory.members[0];
  } else {
    // Tokenless nonproduction fixtures retain real tenant membership checks.
    const User = require('../models/User');
    const organizationId = id(req.currentOrganization || req.session?.currentOrganizationId);
    const filters = [{ idpSub: userId }];
    if (/^[a-f\d]{24}$/i.test(userId)) filters.push({ _id: userId });
    const user = await User.findOne({ isActive: { $ne: false }, $and: [{ $or: filters }, { $or: [
      { 'idpTeams.organizationId': organizationId },
      { organizationMemberships: { $elemMatch: { organization: organizationId, isActive: true } } }
    ] }] }).select('idpSub email profile').lean();
    if (user) return { userId: String(user.idpSub || user._id), name: user.profile?.displayName || user.email, email: user.email };
  }
  throw Object.assign(new Error('Choose a current colleague in the active organization.'), { status: 400, code: 'COLLEAGUE_NOT_AVAILABLE' });
}

module.exports = { loadPerformanceColleagues, resolvePerformanceColleague };
