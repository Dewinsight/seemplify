const id = value => String(value?._id || value || '')
const HR = new Set(['owner', 'admin', 'hr_manager'])
const LEADS = new Set(['line_manager', 'team_lead'])

// One source of membership and scope for Performance, including people who
// have never signed into that product. No employment or appraisal data leaves IdP.
export function buildPerformanceDirectory({ organization, teams, actorId, view }) {
  const organizationId = id(organization)
  const active = (organization.members || []).filter(member => (!member.status || member.status === 'active') && member.account?.email)
  const actor = active.find(member => id(member.account) === id(actorId))
  if (!actor) throw Object.assign(new Error('Active organization membership required'), { status: 403 })
  const organizationRole = id(organization.owner) === id(actorId) ? 'owner' : actor.role
  const hr = HR.has(organizationRole)
  const nodes = teams.filter(team => id(team.organization) === organizationId)
  const expand = roots => {
    const result = new Set(roots)
    let changed = true
    while (changed) {
      changed = false
      for (const team of nodes) if (result.has(id(team.parentTeam)) && !result.has(id(team))) { result.add(id(team)); changed = true }
    }
    return result
  }
  const authority = accountId => {
    const headed = new Set((organization.departments || []).filter(department => id(department.headAccount) === accountId).map(id))
    return expand(nodes.filter(team => headed.has(id(team.department)) || (team.members || []).some(member => id(member.account) === accountId && member.status !== 'inactive' && LEADS.has(member.role))).map(id))
  }
  const managed = authority(id(actorId))
  const organizationView = hr && view !== 'managed'
  const scope = organizationView ? 'organization' : managed.size ? 'managed_teams' : 'self'
  const accessible = organizationView ? new Set(nodes.map(id)) : managed
  const teamRows = nodes.map(team => ({ id: id(team), name: team.name, organizationId, parentTeamId: id(team.parentTeam) || null,
    departmentId: id(team.department) || null, departmentName: (organization.departments || []).find(department => id(department) === id(team.department))?.name || '',
    memberCount: (team.members || []).filter(member => member.status !== 'inactive' && active.some(person => id(person.account) === id(member.account))).length }))
  const allMembers = active.map(member => {
    const account = member.account; const accountId = id(account)
    const memberships = nodes.flatMap(team => {
      const membership = (team.members || []).find(entry => id(entry.account) === accountId && entry.status !== 'inactive')
      return membership ? [{ ...teamRows.find(row => row.id === id(team)), role: membership.role, isManager: LEADS.has(membership.role) }] : []
    })
    const orgRole = id(organization.owner) === accountId ? 'owner' : member.role
    return { userId: account.sub || accountId, accountId, name: account.profile?.name || account.email, email: account.email,
      organizationRole: orgRole, jobTitle: member.designation || '', departmentId: id(member.department) || null,
      teams: memberships, teamIds: memberships.map(team => team.id), isSelf: accountId === id(actorId) }
  })
  const members = allMembers.filter(member => organizationView || member.isSelf || member.teamIds.some(teamId => accessible.has(teamId)))
  const reviewers = (hr || managed.size ? allMembers : []).flatMap(member => {
    const eligibleTeamIds = [...authority(member.accountId)]
    const organizationWide = HR.has(member.organizationRole)
    if (!organizationWide && !eligibleTeamIds.some(teamId => accessible.has(teamId))) return []
    return [{ userId: member.userId, name: member.name, email: member.email, organizationRole: member.organizationRole,
      organizationWide, eligibleTeamIds, teamRoles: member.teams.filter(team => LEADS.has(team.role)).map(team => ({ id: team.id, name: team.name, role: team.role })) }]
  })
  return { organizationId, organizationRole, scope, canStartAppraisals: hr || managed.size > 0,
    teams: teamRows.filter(team => accessible.has(team.id)), members, reviewers }
}
