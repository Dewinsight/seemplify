import { Team } from '../models/Team.js'
import { Account } from '../models/Account.js'

const EVALUATOR_ROLES = new Set(['line_manager', 'team_lead'])
const ORG_WIDE_EVALUATOR_ROLES = new Set(['owner', 'admin', 'hr_manager'])
const ROLE_PRIVILEGE = {
  line_manager: 2,
  team_lead: 1
}

export const SIMPLE_PERFORMANCE_DEFAULT_FIELDS = [
  { key: 'attendance', label: 'Attendance' },
  { key: 'communication', label: 'Communication' },
  { key: 'time_management', label: 'Time management' },
  { key: 'team_work', label: 'Team work' },
  { key: 'customer_satisfaction', label: 'Customer satisfaction' },
  { key: 'knowledge_of_work', label: 'Knowledge of work' },
  { key: 'documentation_accuracy', label: 'Documentation accuracy' }
]

export const PERFORMANCE_RATING_SCALE = [
  { value: 5, label: 'Excellent' },
  { value: 4, label: 'Good' },
  { value: 3, label: 'Average' },
  { value: 2, label: 'Bad' },
  { value: 1, label: 'Very Bad' }
]

export const TEAM_ROLE_LABELS = {
  member: 'Member',
  line_manager: 'Line Manager',
  team_lead: 'Team Lead'
}

export function normalizeSimplePerformanceFieldLabel(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

export function buildSimplePerformanceFieldKey(label, existingKeys = new Set()) {
  const normalized = normalizeSimplePerformanceFieldLabel(label)
  const raw = normalized
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)

  const baseKey = raw || 'field'
  let candidateKey = baseKey
  let suffix = 2
  while (existingKeys.has(candidateKey)) {
    candidateKey = `${baseKey}_${suffix}`
    suffix += 1
  }
  return candidateKey
}

function toIdString(value) {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value._id) return String(value._id)
  return String(value)
}

function isActiveTeamMember(member) {
  if (!member) return false
  const normalizedStatus = String(member.status || '').trim().toLowerCase()
  // Backward compatibility: legacy records may not have `status` set.
  return !normalizedStatus || normalizedStatus === 'active'
}

function buildPathResolver(teamMap) {
  const memo = new Map()

  const resolvePath = (teamId) => {
    if (!teamId) return []
    if (memo.has(teamId)) return memo.get(teamId)

    const path = []
    const seen = new Set()
    let currentTeamId = teamId

    while (currentTeamId && !seen.has(currentTeamId)) {
      seen.add(currentTeamId)
      const team = teamMap.get(currentTeamId)
      if (!team) break

      path.unshift(team.name)
      currentTeamId = toIdString(team.parentTeam) || null
    }

    memo.set(teamId, path)
    return path
  }

  return resolvePath
}

function collectDescendantTeamIds(rootTeamId, childrenByParent) {
  const collected = new Set()
  const stack = [rootTeamId]

  while (stack.length > 0) {
    const teamId = stack.pop()
    if (!teamId || collected.has(teamId)) {
      continue
    }

    collected.add(teamId)
    const childIds = childrenByParent.get(teamId) || []
    for (const childId of childIds) {
      if (!collected.has(childId)) {
        stack.push(childId)
      }
    }
  }

  return collected
}

function canScopeRoleEvaluateMember(scopeRole, memberRole) {
  if (scopeRole === 'line_manager') {
    return true
  }

  if (scopeRole === 'team_lead') {
    return memberRole === 'member'
  }

  return false
}

export async function getEvaluableMembersForEvaluator({
  organizationId,
  evaluatorId,
  evaluatorOrganizationRole
}) {
  if (!organizationId || !evaluatorId) {
    return { members: [], memberMap: new Map() }
  }

  const evaluatorIdStr = toIdString(evaluatorId)

  const teams = await Team.find({ organization: organizationId })
    .select('_id name parentTeam members.account members.role members.status')
    .lean()

  if (teams.length === 0) {
    return { members: [], memberMap: new Map() }
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

  const normalizedOrgRole = String(evaluatorOrganizationRole || '').trim().toLowerCase()
  const hasOrgWideEvaluatorAccess = ORG_WIDE_EVALUATOR_ROLES.has(normalizedOrgRole)

  const evaluatorScopeByTeamId = new Map()
  if (hasOrgWideEvaluatorAccess) {
    // Org-level admins can evaluate across teams in this organization.
    for (const team of teams) {
      const teamId = toIdString(team._id)
      if (!teamId) continue
      evaluatorScopeByTeamId.set(teamId, { teamId, scopeRole: 'line_manager' })
    }
  } else {
    for (const team of teams) {
      const teamId = toIdString(team._id)
      if (!teamId) continue

      const membership = (team.members || []).find(member => (
        isActiveTeamMember(member) &&
        toIdString(member.account) === evaluatorIdStr
      ))

      let scopeRole = null
      if (membership && EVALUATOR_ROLES.has(membership.role)) {
        scopeRole = membership.role
      } else if (toIdString(team.manager) === evaluatorIdStr) {
        // Data resilience: allow explicit team manager records to evaluate the team
        // even if role metadata is missing/misaligned on a legacy membership row.
        scopeRole = 'line_manager'
      }

      if (!scopeRole) continue

      const existing = evaluatorScopeByTeamId.get(teamId)
      const existingPrivilege = ROLE_PRIVILEGE[existing?.scopeRole] || 0
      const incomingPrivilege = ROLE_PRIVILEGE[scopeRole] || 0
      if (!existing || incomingPrivilege > existingPrivilege) {
        evaluatorScopeByTeamId.set(teamId, { teamId, scopeRole })
      }
    }
  }

  const evaluatorScopes = Array.from(evaluatorScopeByTeamId.values())
  if (evaluatorScopes.length === 0) {
    return { members: [], memberMap: new Map() }
  }

  const resolvePath = buildPathResolver(teamMap)
  const candidateByAccountId = new Map()

  for (const scope of evaluatorScopes) {
    const scopedTeamIds = collectDescendantTeamIds(scope.teamId, childrenByParent)
    const scopePrivilege = ROLE_PRIVILEGE[scope.scopeRole] || 0

    for (const scopedTeamId of scopedTeamIds) {
      const team = teamMap.get(scopedTeamId)
      if (!team) continue

      for (const member of team.members || []) {
        if (!isActiveTeamMember(member)) continue

        const memberAccountId = toIdString(member.account)
        if (!memberAccountId || memberAccountId === evaluatorIdStr) continue

        const memberRole = member.role || 'member'
        if (!canScopeRoleEvaluateMember(scope.scopeRole, memberRole)) continue

        const existing = candidateByAccountId.get(memberAccountId)
        if (existing && existing.scopePrivilege > scopePrivilege) {
          continue
        }

        candidateByAccountId.set(memberAccountId, {
          accountId: memberAccountId,
          memberRole,
          scopeRole: scope.scopeRole,
          scopePrivilege,
          teamId: scopedTeamId,
          teamName: team.name,
          teamHierarchyPath: resolvePath(scopedTeamId)
        })
      }
    }
  }

  const candidateIds = Array.from(candidateByAccountId.keys())
  if (candidateIds.length === 0) {
    return { members: [], memberMap: new Map() }
  }

  const accounts = await Account.find({
    _id: { $in: candidateIds }
  })
    .select('sub email profile.name')
    .lean()

  const accountById = new Map(accounts.map(account => [toIdString(account._id), account]))

  const members = []
  for (const candidate of candidateByAccountId.values()) {
    const account = accountById.get(candidate.accountId)
    if (!account) continue

    members.push({
      accountId: candidate.accountId,
      sub: account.sub,
      name: account.profile?.name || account.email || 'Unknown user',
      email: account.email || '',
      memberRole: candidate.memberRole,
      memberRoleLabel: TEAM_ROLE_LABELS[candidate.memberRole] || TEAM_ROLE_LABELS.member,
      scopeRole: candidate.scopeRole,
      scopeRoleLabel: TEAM_ROLE_LABELS[candidate.scopeRole] || TEAM_ROLE_LABELS.member,
      teamId: candidate.teamId,
      teamName: candidate.teamName,
      teamHierarchyPath: candidate.teamHierarchyPath || []
    })
  }

  members.sort((a, b) => {
    const aLabel = (a.name || a.email || '').toLowerCase()
    const bLabel = (b.name || b.email || '').toLowerCase()
    return aLabel.localeCompare(bLabel)
  })

  const memberMap = new Map(members.map(member => [member.accountId, member]))
  return { members, memberMap }
}

export function calculateAverageRating(ratings = []) {
  let values = []

  if (Array.isArray(ratings)) {
    values = ratings
      .map(entry => Number(entry?.value))
      .filter(value => Number.isFinite(value) && value >= 1 && value <= 5)
  } else if (ratings && typeof ratings === 'object') {
    values = Object.values(ratings)
      .map(value => Number(value))
      .filter(value => Number.isFinite(value) && value >= 1 && value <= 5)
  }

  if (values.length === 0) return 0
  const total = values.reduce((sum, value) => sum + value, 0)
  return Number((total / values.length).toFixed(2))
}
