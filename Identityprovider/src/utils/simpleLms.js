import { Organization } from '../models/Organization.js'
import { Team } from '../models/Team.js'
import { Account } from '../models/Account.js'

export const SIMPLE_LMS_ORG_MANAGER_ROLES = ['owner', 'admin', 'hr_manager']
export const SIMPLE_LMS_TEAM_MANAGER_ROLES = ['line_manager', 'team_lead']

export const toIdString = (value) => {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value._id) return String(value._id)
  return String(value)
}

export const slugifyValue = (value, fallback = 'item') => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)

  return normalized || fallback
}

const buildTeamPathResolver = (teamMap) => {
  const memo = new Map()

  const resolvePath = (teamId) => {
    if (!teamId) return []
    if (memo.has(teamId)) return memo.get(teamId)

    const path = []
    const seen = new Set()
    let currentId = teamId

    while (currentId && !seen.has(currentId)) {
      seen.add(currentId)
      const team = teamMap.get(currentId)
      if (!team) break
      path.unshift(team.name)
      currentId = toIdString(team.parentTeam) || null
    }

    memo.set(teamId, path)
    return path
  }

  return resolvePath
}

const collectDescendantTeamIds = (rootTeamId, childrenByParent) => {
  const visited = new Set()
  const stack = [rootTeamId]

  while (stack.length > 0) {
    const currentTeamId = stack.pop()
    if (!currentTeamId || visited.has(currentTeamId)) continue
    visited.add(currentTeamId)

    const children = childrenByParent.get(currentTeamId) || []
    children.forEach((childTeamId) => {
      if (!visited.has(childTeamId)) {
        stack.push(childTeamId)
      }
    })
  }

  return visited
}

const canScopeManageRole = (scopeRole, targetRole) => {
  if (scopeRole === 'line_manager') {
    return true
  }
  if (scopeRole === 'team_lead') {
    return targetRole === 'member'
  }
  return false
}

export async function getOrganizationMembersWithTeamContext({ organizationId }) {
  const [organization, teams] = await Promise.all([
    Organization.findById(organizationId).select('members').lean(),
    Team.find({ organization: organizationId })
      .select('_id name parentTeam members.account members.role members.status')
      .lean()
  ])

  if (!organization) {
    return { members: [], teams: [] }
  }

  const teamMap = new Map()
  const accountTeamContext = new Map()
  for (const team of teams) {
    const teamId = toIdString(team._id)
    teamMap.set(teamId, team)
  }

  const resolvePath = buildTeamPathResolver(teamMap)

  for (const team of teams) {
    const teamId = toIdString(team._id)
    const teamPath = resolvePath(teamId)
    for (const member of team.members || []) {
      if (member.status !== 'active') continue
      const accountId = toIdString(member.account)
      if (!accountId) continue

      const existing = accountTeamContext.get(accountId)
      if (existing) continue

      accountTeamContext.set(accountId, {
        teamId,
        teamName: team.name,
        teamPath,
        memberRole: member.role || 'member'
      })
    }
  }

  const activeMemberships = (organization.members || []).filter(entry => entry.status === 'active')
  const accountIds = activeMemberships.map(entry => toIdString(entry.account)).filter(Boolean)
  if (accountIds.length === 0) {
    return { members: [], teams }
  }

  const accounts = await Account.find({ _id: { $in: accountIds } })
    .select('email profile.name')
    .lean()
  const accountById = new Map(accounts.map(account => [toIdString(account._id), account]))

  const members = activeMemberships
    .map((entry) => {
      const accountId = toIdString(entry.account)
      const account = accountById.get(accountId)
      if (!account) return null

      const teamContext = accountTeamContext.get(accountId)
      return {
        accountId,
        name: account.profile?.name || account.email || 'Unknown member',
        email: account.email || '',
        organizationRole: entry.role || 'staff',
        memberRole: teamContext?.memberRole || 'member',
        teamId: teamContext?.teamId || '',
        teamName: teamContext?.teamName || '',
        teamHierarchyPath: teamContext?.teamPath || []
      }
    })
    .filter(Boolean)
    .sort((a, b) => {
      const aLabel = `${a.name} ${a.email}`.toLowerCase()
      const bLabel = `${b.name} ${b.email}`.toLowerCase()
      return aLabel.localeCompare(bLabel)
    })

  return { members, teams }
}

export async function getHierarchyScopedMembers({ organizationId, accountId }) {
  const teams = await Team.find({ organization: organizationId })
    .select('_id name parentTeam members.account members.role members.status')
    .lean()

  if (teams.length === 0) {
    return { members: [], managedTeamIds: new Set(), teams: [] }
  }

  const teamMap = new Map()
  const childrenByParent = new Map()
  for (const team of teams) {
    const teamId = toIdString(team._id)
    teamMap.set(teamId, team)
    const parentTeamId = toIdString(team.parentTeam)
    if (!parentTeamId) continue
    if (!childrenByParent.has(parentTeamId)) {
      childrenByParent.set(parentTeamId, [])
    }
    childrenByParent.get(parentTeamId).push(teamId)
  }

  const accountIdStr = toIdString(accountId)
  const scopes = []
  for (const team of teams) {
    const membership = (team.members || []).find((entry) => (
      entry.status === 'active' &&
      toIdString(entry.account) === accountIdStr &&
      SIMPLE_LMS_TEAM_MANAGER_ROLES.includes(entry.role)
    ))
    if (!membership) continue
    scopes.push({
      teamId: toIdString(team._id),
      scopeRole: membership.role
    })
  }

  if (scopes.length === 0) {
    return { members: [], managedTeamIds: new Set(), teams }
  }

  const resolvePath = buildTeamPathResolver(teamMap)
  const candidateByMemberId = new Map()
  const managedTeamIds = new Set()

  for (const scope of scopes) {
    const descendantTeamIds = collectDescendantTeamIds(scope.teamId, childrenByParent)
    descendantTeamIds.forEach((teamId) => managedTeamIds.add(teamId))

    for (const scopedTeamId of descendantTeamIds) {
      const scopedTeam = teamMap.get(scopedTeamId)
      if (!scopedTeam) continue

      for (const member of scopedTeam.members || []) {
        if (member.status !== 'active') continue
        const memberId = toIdString(member.account)
        if (!memberId || memberId === accountIdStr) continue

        const memberRole = member.role || 'member'
        if (!canScopeManageRole(scope.scopeRole, memberRole)) continue

        const existing = candidateByMemberId.get(memberId)
        if (existing && existing.scopeRole === 'line_manager') {
          continue
        }

        candidateByMemberId.set(memberId, {
          accountId: memberId,
          scopeRole: scope.scopeRole,
          memberRole,
          teamId: scopedTeamId,
          teamName: scopedTeam.name,
          teamHierarchyPath: resolvePath(scopedTeamId)
        })
      }
    }
  }

  const memberIds = Array.from(candidateByMemberId.keys())
  if (memberIds.length === 0) {
    return { members: [], managedTeamIds, teams }
  }

  const accounts = await Account.find({ _id: { $in: memberIds } })
    .select('email profile.name')
    .lean()
  const accountById = new Map(accounts.map(account => [toIdString(account._id), account]))

  const members = Array.from(candidateByMemberId.values())
    .map((candidate) => {
      const account = accountById.get(candidate.accountId)
      if (!account) return null
      return {
        ...candidate,
        name: account.profile?.name || account.email || 'Unknown member',
        email: account.email || ''
      }
    })
    .filter(Boolean)
    .sort((a, b) => {
      const aLabel = `${a.name} ${a.email}`.toLowerCase()
      const bLabel = `${b.name} ${b.email}`.toLowerCase()
      return aLabel.localeCompare(bLabel)
    })

  return { members, managedTeamIds, teams }
}

export async function getSimpleLmsAccessScope({
  organizationId,
  accountId,
  memberRole,
  canManageOrganization: explicitCanManageOrganization = null
}) {
  const canManageOrganization = typeof explicitCanManageOrganization === 'boolean'
    ? explicitCanManageOrganization
    : SIMPLE_LMS_ORG_MANAGER_ROLES.includes(memberRole)

  if (canManageOrganization) {
    const { members, teams } = await getOrganizationMembersWithTeamContext({ organizationId })
    return {
      canManageOrganization: true,
      manageableMembers: members,
      manageableMemberIdSet: new Set(members.map(member => member.accountId)),
      manageableTeamIds: new Set(teams.map(team => toIdString(team._id))),
      teams
    }
  }

  const { members, managedTeamIds, teams } = await getHierarchyScopedMembers({ organizationId, accountId })
  return {
    canManageOrganization: false,
    manageableMembers: members,
    manageableMemberIdSet: new Set(members.map(member => member.accountId)),
    manageableTeamIds: managedTeamIds,
    teams
  }
}

export const extractLessonKeys = (course) => {
  const keys = []
  for (const chapter of course?.chapters || []) {
    for (const lesson of chapter?.lessons || []) {
      const key = String(lesson?.key || '').trim()
      if (!key) continue
      keys.push(key)
    }
  }
  return keys
}

export const calculateProgress = ({ course, completedLessonKeys = [] }) => {
  const allLessonKeys = extractLessonKeys(course)
  if (allLessonKeys.length === 0) {
    return {
      lessonCount: 0,
      completedCount: 0,
      progressPercent: 0,
      isCompleted: false
    }
  }

  const completedSet = new Set((completedLessonKeys || []).map(key => String(key || '').trim()).filter(Boolean))
  const completedCount = allLessonKeys.filter(key => completedSet.has(key)).length
  const progressPercent = Math.min(100, Math.round((completedCount / allLessonKeys.length) * 100))

  return {
    lessonCount: allLessonKeys.length,
    completedCount,
    progressPercent,
    isCompleted: completedCount >= allLessonKeys.length
  }
}
