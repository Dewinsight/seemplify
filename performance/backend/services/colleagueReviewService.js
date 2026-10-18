const User = require('../models/User');
const { resolveAppraisalAccessScope, isHrPlusRole, getOrganizationRole } = require('./appraisalAccessService');
const id = value => String(value?.id || value?._id || value || '');
function organizationId(req) { return id(req.currentOrganization?.id || req.session?.currentOrganizationId || req.session?.user?.currentOrganization?.id); }
const actorId = req => id(req.session?.user?.id || req.session?.user?.sub);
const denied = message => Object.assign(new Error(message), { status: 403 });

async function reviewerDirectory(req, scope) {
  if (scope.directory) return scope.directory.reviewers;
  // Disposable tests and older local fixtures have no delegated OIDC token.
  const users = await User.find({ $or: [{ currentOrganizationId: scope.organizationId }, { 'idpTeams.organizationId': scope.organizationId },
    { organizationMemberships: { $elemMatch: { organization: scope.organizationId, isActive: true } } }] }).lean();
  const actor = req.session.user;
  const candidates = users.map(user => ({ userId: id(user.idpSub || user._id), name: user.profile?.displayName || user.email, email: user.email,
    organizationRole: user.organizationMemberships?.find(member => id(member.organization) === scope.organizationId && member.isActive)?.role,
    teams: (user.idpTeams || []).filter(team => id(team.organizationId) === scope.organizationId) }));
  candidates.push({ userId: actorId(req), name: actor.name || actor.email, email: actor.email, organizationRole: getOrganizationRole(actor, scope.organizationId),
    teams: (actor.idpTeams || actor.teams || []).filter(team => id(team.organizationId) === scope.organizationId) });
  const nodes = new Map(candidates.flatMap(person => person.teams).map(team => [id(team.id), team]));
  return [...new Map(candidates.map(person => [person.userId, person])).values()].map(person => {
    const eligible = new Set(person.teams.filter(team => ['line_manager', 'team_lead'].includes(team.role)).map(team => id(team.id)));
    if (person.userId === actorId(req)) (scope.accessibleTeamIds || []).forEach(teamId => eligible.add(teamId));
    let changed = true;
    while (changed) { changed = false; for (const [teamId, team] of nodes) if (eligible.has(id(team.parentTeamId)) && !eligible.has(teamId)) { eligible.add(teamId); changed = true; } }
    return { ...person, organizationWide: isHrPlusRole(person.organizationRole), eligibleTeamIds: [...eligible] };
  });
}

async function colleagueRoster(req) {
  const scope = await resolveAppraisalAccessScope(req, { includeSelf: true });
  if (!scope.canManageAppraisals) return [];
  const reviewers = await reviewerDirectory(req, scope);
  return scope.organizationUsers.map(person => {
    const reviewerOptions = reviewers.filter(reviewer => reviewer.userId !== person.userId &&
      (reviewer.organizationWide || reviewer.eligibleTeamIds.some(teamId => person.teamIds.includes(teamId))))
      .map(reviewer => ({ userId: reviewer.userId, name: reviewer.name, email: reviewer.email,
        role: reviewer.organizationRole && isHrPlusRole(reviewer.organizationRole) ? reviewer.organizationRole :
          (reviewer.teamRoles || reviewer.teams || []).find(team => ['line_manager', 'team_lead'].includes(team.role))?.role || 'team_manager' }));
    return { ...person, reviewerOptions, isSelectableForAppraisal: reviewerOptions.length > 0,
      selectionBlockedReason: reviewerOptions.length ? null : 'Assign a team lead, line manager, HR manager or administrator in Seemplify Identity. A person cannot review themselves.' };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

async function resolveColleagueParticipants(req, selections) {
  const scope = await resolveAppraisalAccessScope(req);
  if (!scope.canManageAppraisals) throw denied('Only team managers, team leads and organization administrators can start appraisals.');
  const roster = await colleagueRoster(req);
  return selections.map(selection => {
    const person = roster.find(entry => entry.userId === id(selection.userId));
    if (!person) throw denied('Choose a person from the teams you manage. Organization administrators can select anyone in this organization.');
    const reviewerId = req.body?.reviewerMode === 'selected' ? id(selection.reviewerId) : actorId(req);
    if (!reviewerId) throw Object.assign(new Error('Choose a reviewer for every selected person.'), { status: 400 });
    const reviewer = person.reviewerOptions.find(entry => entry.userId === reviewerId);
    if (!reviewer) throw denied('The selected reviewer must be an eligible team lead, line manager, HR manager or administrator, and cannot be the person being reviewed.');
    return { ...person, reviewerId, managerId: reviewer.userId, managerName: reviewer.name, managerEmail: reviewer.email };
  });
}
module.exports = { colleagueRoster, resolveColleagueParticipants, organizationId };
