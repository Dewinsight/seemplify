/**
 * Team utility for OIDC claims
 * Builds team hierarchy claims for OIDC userinfo
 *
 * PERFORMANCE OPTIMIZED: Uses lean(), parallel queries, and caching
 */

import { Team } from '../models/Team.js'
import { getPermissionsForRole } from './permissions.js'

// Cache for hierarchy paths (team ID -> path array)
const hierarchyPathCache = new Map()
const HIERARCHY_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

/**
 * Get cached hierarchy path or compute it
 * Uses optimized batch lookup instead of recursive queries
 */
async function getOptimizedHierarchyPath(team, allTeamsMap) {
  const cacheKey = team._id.toString()
  const cached = hierarchyPathCache.get(cacheKey)
  if (cached && (Date.now() - cached.timestamp) < HIERARCHY_CACHE_TTL) {
    return cached.data
  }

  const path = [team.name]
  let currentParentId = team.parentTeam?._id?.toString() || team.parentTeam?.toString()

  // Traverse up the hierarchy using pre-fetched teams map
  while (currentParentId) {
    const parent = allTeamsMap.get(currentParentId)
    if (parent) {
      path.unshift(parent.name)
      currentParentId = parent.parentTeam?._id?.toString() || parent.parentTeam?.toString()
    } else {
      break
    }
  }

  hierarchyPathCache.set(cacheKey, { data: path, timestamp: Date.now() })
  return path
}

/**
 * Get team claims for an account
 * Builds team hierarchy information for OIDC userinfo
 *
 * OPTIMIZED: Uses lean(), parallel queries, and batch lookups
 *
 * @param {Object} account - The account document
 * @returns {Object[]} - Array of team claims
 */
export async function getTeamClaims(account) {
  const startTime = Date.now()
  const accountIdStr = account._id.toString()

  // Use lean() for read-only queries - significantly faster
  const teams = await Team.find({
    'members.account': account._id,
    'members.status': 'active'
  })
    .populate('organization', 'name')
    .populate('parentTeam', 'name')
    .populate('manager', 'email profile.name')
    .lean()

  if (teams.length === 0) {
    console.log(`⏱️ [PERF] getTeamClaims: 0 teams found (${Date.now() - startTime}ms)`)
    return []
  }

  // Get all team IDs for batch operations
  const teamIds = teams.map(t => t._id)

  // Batch fetch all parent teams for hierarchy path computation
  // This avoids N+1 queries for hierarchy paths
  const allTeamIds = new Set(teamIds.map(id => id.toString()))
  for (const team of teams) {
    if (team.parentTeam?._id) {
      allTeamIds.add(team.parentTeam._id.toString())
    }
  }

  // Fetch all potential parent teams in one query
  const allRelatedTeams = await Team.find({
    _id: { $in: Array.from(allTeamIds) }
  }).select('_id name parentTeam').lean()

  // Create lookup map for fast access
  const allTeamsMap = new Map(allRelatedTeams.map(t => [t._id.toString(), t]))

  // Batch fetch all sub-teams in one query (for managers)
  const subTeamsMap = new Map()
  const subTeamsDocs = await Team.find({
    parentTeam: { $in: teamIds }
  }).select('_id name parentTeam').lean()

  for (const subTeam of subTeamsDocs) {
    const parentId = subTeam.parentTeam.toString()
    if (!subTeamsMap.has(parentId)) {
      subTeamsMap.set(parentId, [])
    }
    subTeamsMap.get(parentId).push({
      id: subTeam._id.toString(),
      name: subTeam.name
    })
  }

  // Process all teams in parallel
  const teamClaimsPromises = teams.map(async (team) => {
    const teamIdStr = team._id.toString()
    const teamMember = team.members.find(
      m => m.account.toString() === accountIdStr && m.status === 'active'
    )

    if (!teamMember) return null

    // Get hierarchy path using optimized batch lookup
    const hierarchyPath = await getOptimizedHierarchyPath(team, allTeamsMap)

    // Determine if user has approval role
    const isManager = team.manager?._id?.toString() === accountIdStr ||
                      team.manager?.toString() === accountIdStr
    const hasApprovalRole = teamMember.role === 'line_manager' || teamMember.role === 'team_lead'

    // Get direct reports only if user has approval role
    // Use simplified approach - just get direct team members
    let directReports = []
    if (hasApprovalRole) {
      directReports = team.members
        .filter(m => m.status === 'active' && m.account.toString() !== accountIdStr)
        .map(m => m.account.toString())
    }

    // Get sub-teams from pre-fetched map
    const subTeams = isManager && hasApprovalRole
      ? (subTeamsMap.get(teamIdStr) || [])
      : []

    // Skip teams with missing organization (data integrity issue)
    if (!team.organization) {
      console.warn(`⚠️ Team ${team.name} (${teamIdStr}) has no organization - skipping`)
      return null
    }

    return {
      id: teamIdStr,
      name: team.name,
      organizationId: team.organization._id.toString(),
      organizationName: team.organization.name,
      parentTeamId: team.parentTeam?._id?.toString() || null,
      parentTeamName: team.parentTeam?.name || null,
      hierarchyPath: hierarchyPath,
      role: teamMember.role,
      isManager: isManager,
      managerId: team.manager?._id?.toString() || null,
      managerName: team.manager?.profile?.name || team.manager?.email || null,
      directReports: directReports,
      subTeams: subTeams,
      joinedAt: teamMember.joinedAt
    }
  })

  const results = await Promise.all(teamClaimsPromises)
  const teamClaims = results.filter(claim => claim !== null)

  console.log(`⏱️ [PERF] getTeamClaims: ${teamClaims.length} teams processed in ${Date.now() - startTime}ms`)

  return teamClaims
}

/**
 * Get team-based permissions for an account in a specific organization
 *
 * OPTIMIZED: Uses lean() and avoids N+1 queries
 *
 * @param {Object} account - The account document
 * @param {string} organizationId - The organization ID
 * @returns {Object[]} - Array of team permission objects
 */
export async function getTeamPermissions(account, organizationId) {
  const startTime = Date.now()
  const accountIdStr = account._id.toString()

  // Use lean() for read-only query - significantly faster
  const teams = await Team.find({
    organization: organizationId,
    'members.account': account._id,
    'members.status': 'active'
  }).lean()

  const permissions = []

  for (const team of teams) {
    const teamMember = team.members.find(
      m => m.account.toString() === accountIdStr && m.status === 'active'
    )

    if (!teamMember) continue

    // If user has line_manager or team_lead role in team, add team permissions
    if (teamMember.role === 'line_manager' || teamMember.role === 'team_lead') {
      const teamPerms = getPermissionsForRole(teamMember.role, 'leave-management')

      // Get direct reports from the already-loaded team members
      // This avoids additional DB queries
      const directReports = team.members
        .filter(m => m.status === 'active' && m.account.toString() !== accountIdStr)
        .map(m => m.account.toString())

      permissions.push({
        teamId: team._id.toString(),
        teamName: team.name,
        role: teamMember.role,
        permissions: teamPerms,
        directReports: directReports
      })
    }
  }

  console.log(`⏱️ [PERF] getTeamPermissions: ${permissions.length} permissions in ${Date.now() - startTime}ms`)

  return permissions
}

/**
 * Get teams where account is a manager
 *
 * @param {Object} account - The account document
 * @returns {Object[]} - Array of managed team info
 */
export async function getManagedTeams(account) {
  const teams = await Team.find({
    manager: account._id
  })
    .populate('organization', 'name')
    .populate('members.account', 'email profile.name')

  return teams.map(team => {
    const teamMember = team.members.find(
      m => m.account._id.toString() === account._id.toString()
    )

    return {
      id: team._id.toString(),
      name: team.name,
      organizationId: team.organization._id.toString(),
      organizationName: team.organization.name,
      hasLineManagerRole: teamMember?.role === 'line_manager',
      memberCount: team.memberCount
    }
  })
}

/**
 * Check if account can approve leaves for a target account
 * Based on team hierarchy and line_manager role
 *
 * @param {string} approverAccountId - The approver's account ID
 * @param {string} targetAccountId - The target's account ID
 * @returns {boolean} - True if approver can approve target's leaves
 */
export async function canApproveLeaves(approverAccountId, targetAccountId) {
  // Get teams where approver is manager with line_manager role
  const approverTeams = await Team.find({
    manager: approverAccountId,
    'members.account': approverAccountId,
    'members.role': 'line_manager',
    'members.status': 'active'
  })

  for (const team of approverTeams) {
    // Check if target is in this team's direct reports
    const directReports = await team.getDirectReports()
    if (directReports.some(id => id.toString() === targetAccountId.toString())) {
      return true
    }
  }

  return false
}

/**
 * Get team hierarchy for an organization (for display)
 *
 * @param {string} organizationId - The organization ID
 * @returns {Object[]} - Tree structure of teams
 */
export async function getOrganizationTeamTree(organizationId) {
  return await Team.buildTeamTree(organizationId)
}

export default {
  getTeamClaims,
  getTeamPermissions,
  getManagedTeams,
  canApproveLeaves,
  getOrganizationTeamTree
}
