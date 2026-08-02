function toIdString(value) {
  if (!value) return null
  if (typeof value === 'string') return value
  if (value._id) return value._id.toString()
  return value.toString()
}

function ensureEntry(map, accountId) {
  if (!map.has(accountId)) {
    map.set(accountId, {
      departmentId: null,
      departmentName: '',
      teamIds: [],
      teamNames: [],
      hasDepartmentConflict: false
    })
  }

  return map.get(accountId)
}

export function buildMemberStructureMap(organization, teams = []) {
  const structureMap = new Map()

  for (const team of teams || []) {
    const teamId = toIdString(team?._id || team?.id)
    const teamName = String(team?.name || '').trim()
    const departmentId = toIdString(team?.department)

    for (const member of team?.members || []) {
      if (member?.status !== 'active') continue

      const accountId = toIdString(member?.account?._id || member?.account || member?.id)
      if (!accountId) continue

      const entry = ensureEntry(structureMap, accountId)

      if (teamId && !entry.teamIds.includes(teamId)) {
        entry.teamIds.push(teamId)
      }

      if (teamName && !entry.teamNames.includes(teamName)) {
        entry.teamNames.push(teamName)
      }

      if (!departmentId) continue

      if (!entry.departmentId) {
        entry.departmentId = departmentId
        entry.departmentName = organization.getDepartmentById(departmentId)?.name || ''
        continue
      }

      if (entry.departmentId !== departmentId) {
        entry.hasDepartmentConflict = true
      }
    }
  }

  return structureMap
}

export function getMemberStructure(structureMap, accountId, organization = null) {
  const entry = structureMap.get(toIdString(accountId)) || {
    departmentId: null,
    departmentName: '',
    teamIds: [],
    teamNames: [],
    hasDepartmentConflict: false
  }

  if (!entry.departmentName && entry.departmentId && organization) {
    entry.departmentName = organization.getDepartmentById(entry.departmentId)?.name || ''
  }

  return entry
}
