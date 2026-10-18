const User = require('../models/User');
const { isHrPlusRole, getOrganizationRole } = require('./appraisalAccessService');

const id = (value) => value == null ? '' : String(value);
const email = (value) => String(value || '').trim().toLowerCase();
function organizationId(req) {
  return id(req.currentOrganization?.id || req.session?.currentOrganizationId || req.session?.user?.currentOrganization?.id);
}

// Launch eligibility is deliberately separate from access to existing reviews.
// A team member can review upwards or sideways without gaining manager access.
async function colleagueRoster(req) {
  const org = organizationId(req);
  const actor = req.session?.user;
  if (!org || !actor) return [];
  const hr = req.userRole === 'hr_admin' || isHrPlusRole(getOrganizationRole(actor, org));
  const users = await User.find({ $or: [
    { currentOrganizationId: org }, { 'idpTeams.organizationId': org },
    { organizationMemberships: { $elemMatch: { organization: org, isActive: true } } }
  ] }).select('idpSub email profile idpTeams').lean();
  const teams = (actor.idpTeams || actor.teams || actor.userinfo?.teams || [])
    .filter((team) => id(team.organizationId) === org);
  const nodes = new Map();
  for (const team of [...users.flatMap((user) => user.idpTeams || []), ...teams]) {
    if (id(team.organizationId) === org) nodes.set(id(team.id), team);
  }
  const root = (teamId) => {
    const seen = new Set();
    let current = id(teamId);
    while (nodes.get(current)?.parentTeamId && !seen.has(current)) {
      seen.add(current);
      current = id(nodes.get(current).parentTeamId);
    }
    // A malformed hierarchy must not join unrelated teams.
    return seen.has(current) ? id(teamId) : current;
  };
  const roots = new Set(teams.map((team) => root(team.id)));
  return users.flatMap((user) => {
    const userId = id(user.idpSub || user._id);
    if ([id(actor.id), id(actor.sub)].includes(userId) || email(actor.email) === email(user.email)) return [];
    const memberships = (user.idpTeams || []).filter((team) => id(team.organizationId) === org);
    if (!hr && !memberships.some((team) => roots.has(root(team.id)))) return [];
    const team = memberships.find((entry) => roots.has(root(entry.id))) || memberships[0];
    return [{ userId, email: user.email,
      name: user.profile?.displayName || `${user.profile?.firstName || ''} ${user.profile?.lastName || ''}`.trim() || user.email,
      teamId: id(team?.id), teamIds: memberships.map((entry) => id(entry.id)), teamName: team?.name || '',
      department: team?.departmentName || '', jobTitle: user.profile?.title || '',
      managerId: id(actor.id || actor.sub), managerName: actor.name || actor.email, managerEmail: actor.email,
      isSelectableForAppraisal: true }];
  }).sort((a, b) => a.name.localeCompare(b.name));
}

async function resolveColleagueParticipants(req, selections) {
  const roster = await colleagueRoster(req);
  return selections.map((selection) => {
    const person = roster.find((entry) => entry.userId === id(selection.userId));
    if (!person) throw Object.assign(new Error('Choose a colleague in your team hierarchy. HR can review anyone in this organization.'), { status: 403 });
    return { ...person };
  });
}

module.exports = { colleagueRoster, resolveColleagueParticipants, organizationId };
