import { Team } from '../models/Team.js'
import {
  DEFAULT_ORGANIZATION_STRUCTURE,
  normalizeDepartmentName,
  toIdString
} from '../utils/departments.js'

export function buildDefaultTeamDocuments(organization) {
  const departmentByName = new Map(
    (organization?.departments || []).map((department) => [
      normalizeDepartmentName(department.name).toLowerCase(),
      department
    ])
  )

  return DEFAULT_ORGANIZATION_STRUCTURE.flatMap((departmentTemplate) => {
    const department = departmentByName.get(departmentTemplate.name.toLowerCase())
    if (!department) return []

    return departmentTemplate.teams.map((team) => ({
      organization: organization._id,
      department: department._id,
      parentTeam: null,
      name: team.name,
      description: team.description,
      manager: null,
      members: []
    }))
  })
}

export async function seedDefaultOrganizationTeams(organization, options = {}) {
  const TeamModel = options.TeamModel || Team
  const teamDocuments = buildDefaultTeamDocuments(organization)
  if (!teamDocuments.length) return []

  const existingTeams = await TeamModel.find({ organization: organization._id })
    .select('name department')
    .lean()
  const existingKeys = new Set(existingTeams.map((team) => (
    `${toIdString(team.department)}:${String(team.name || '').trim().toLowerCase()}`
  )))
  const missingTeams = teamDocuments.filter((team) => (
    !existingKeys.has(`${toIdString(team.department)}:${team.name.toLowerCase()}`)
  ))

  return missingTeams.length ? TeamModel.insertMany(missingTeams) : []
}
