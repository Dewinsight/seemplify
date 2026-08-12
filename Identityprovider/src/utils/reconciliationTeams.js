export function serializeReconciliationTeams(teams = [], organization = {}) {
  const accountById = new Map((organization.members || []).map((member) => {
    const account = member.account || {}
    return [String(account._id || account), account]
  }))

  return teams.map((team) => ({
    id: String(team._id),
    teamId: String(team._id),
    name: team.name,
    description: team.description || '',
    parentTeamId: team.parentTeam ? String(team.parentTeam) : null,
    departmentId: team.department ? String(team.department) : null,
    departmentName: organization.getDepartmentById?.(team.department)?.name || null,
    managerId: team.manager ? String(team.manager) : null,
    members: (team.members || [])
      .filter((member) => member.status === 'active')
      .map((member) => {
        const account = accountById.get(String(member.account)) || {}
        return {
          idpSubject: account.sub || null,
          subjectId: account.sub || null,
          email: account.email || null,
          role: member.role || 'member',
          status: member.status
        }
      })
      .filter((member) => member.idpSubject)
  }))
}
