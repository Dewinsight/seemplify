function toIdString(value) {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value._id) return String(value._id)
  return String(value)
}

export function isActiveTeamMember(member) {
  if (!member) return false
  const normalizedStatus = String(member.status || '').trim().toLowerCase()
  return !normalizedStatus || normalizedStatus === 'active'
}

export function getActiveLineManagers(team = {}) {
  return (team.members || []).filter((member) => (
    isActiveTeamMember(member) &&
    String(member.role || '').trim().toLowerCase() === 'line_manager'
  ))
}

export function getDerivedManagerAccountId(team = {}) {
  const lineManagers = getActiveLineManagers(team)
  if (lineManagers.length === 0) {
    return null
  }

  const currentManagerId = toIdString(team.manager)
  const currentLineManager = lineManagers.find((member) => (
    toIdString(member.account) === currentManagerId
  ))

  if (currentLineManager) {
    return currentLineManager.account?._id || currentLineManager.account || null
  }

  return lineManagers[0].account?._id || lineManagers[0].account || null
}

export function hasLineManagerRole(team = {}, accountId) {
  const targetId = toIdString(accountId)
  return getActiveLineManagers(team).some((member) => toIdString(member.account) === targetId)
}

export function getDerivedManagerInfo(team = {}) {
  const managerAccountId = toIdString(getDerivedManagerAccountId(team))
  if (!managerAccountId) return null

  const populatedManagerId = toIdString(team.manager)
  if (populatedManagerId && populatedManagerId === managerAccountId && typeof team.manager === 'object') {
    return {
      id: managerAccountId,
      sub: team.manager.sub || null,
      email: team.manager.email || null,
      name: team.manager.profile?.name || team.manager.name || team.manager.email || null
    }
  }

  const matchedLineManager = getActiveLineManagers(team).find((member) => (
    toIdString(member.account) === managerAccountId
  ))
  const account = matchedLineManager?.account

  if (account && typeof account === 'object') {
    return {
      id: managerAccountId,
      sub: account.sub || null,
      email: account.email || null,
      name: account.profile?.name || account.name || account.email || null
    }
  }

  return {
    id: managerAccountId,
    sub: null,
    email: null,
    name: null
  }
}
