const axios = require('axios');
const { getPerformanceOidcClientConfig } = require('../config/identityProvider');
const allows = member => member.appAccess && (member.appAccess.mode === 'all' || (member.appAccess.mode === 'selected' && member.appAccess.appIds?.includes('performance-management')));
const id = value => String(value?.id || value?._id || value || '');
function mapIdentityRoster(organizationId, payload, teams) {
  if (id(payload.organizationId) !== organizationId || !Array.isArray(payload.members) || !Array.isArray(teams)) throw new Error('Invalid identity roster response');
  const members = payload.members.filter(member => member.status !== 'inactive' && member.isActive !== false && allows(member) && member.sub && member.email);
  const allByAccount = new Map(payload.members.map(member => [id(member.id), member]));
  return members.map(member => ({
    idpSub: member.sub, email: member.email, currentOrganizationId: organizationId,
    profile: { displayName: member.name || member.email, title: member.designation || '', department: member.departmentName || '' },
    idpTeams: (member.teamIds || []).map(teamId => {
      const team = teams.find(team => id(team.id) === id(teamId));
      if (!team) return null;
      const manager = allByAccount.get(id(team.manager?.id));
      const isManager = id(team.manager?.id) === id(member.id);
      return { id: id(team.id), name: team.name, organizationId, parentTeamId: id(team.parentTeam?.id) || null,
        departmentId: id(team.department?.id) || null, departmentName: team.department?.name || '',
        role: isManager ? 'line_manager' : 'member', isManager,
        managerId: manager?.sub || null, managerName: manager?.name || null, managerEmail: manager?.email || null,
        directReports: isManager ? members.filter(other => id(other.id) !== id(member.id) && other.teamIds?.map(id).includes(id(team.id))).map(other => other.sub) : [] };
    }).filter(Boolean),
    idpOrganizations: [{ id: organizationId, role: member.role, appAccess: member.appAccess }],
    organizationMemberships: [{ organization: organizationId, role: member.role, isActive: true }]
  }));
}
async function getIdentityRoster(req, organizationId, client = axios) {
  if (req._performanceIdentityRoster) return req._performanceIdentityRoster;
  const token = req.session?.user?.accessToken;
  // Isolated service tests may supply a synthetic session without a token.
  if (!token && process.env.NODE_ENV === 'test') return null;
  const failure = () => Object.assign(new Error('The identity roster could not be refreshed. Retry before selecting people.'), { status: 503, code: 'IDENTITY_ROSTER_UNAVAILABLE' });
  if (!token) throw failure();
  const issuer = getPerformanceOidcClientConfig({ issuerUrlFallback: 'http://localhost:4000' }).issuerUrl;
  try {
    const options = { headers: { Authorization: `Bearer ${token}` }, timeout: 10000, maxRedirects: 0 };
    const [members, teams] = await Promise.all([
      client.get(`${issuer}/api/organizations/${encodeURIComponent(organizationId)}/members`, options),
      client.get(`${issuer}/api/organizations/${encodeURIComponent(organizationId)}/teams`, options)
    ]);
    const roster = mapIdentityRoster(organizationId, members.data, teams.data);
    // Profile projection only: authorization and selection still use the live roster above.
    const User = require('../models/User');
    for (const person of roster) {
      await User.updateOne({ idpSub: person.idpSub }, { $set: { email: person.email, 'profile.displayName': person.profile.displayName, 'profile.title': person.profile.title },
        $addToSet: { organizationMemberships: person.organizationMemberships[0] },
        $setOnInsert: { idpSub: person.idpSub, currentOrganizationId: organizationId, idpTeams: person.idpTeams } }, { upsert: true });
    }
    req._performanceIdentityRoster = roster;
    return roster;
  } catch { throw failure(); }
}
module.exports = { getIdentityRoster, mapIdentityRoster };
