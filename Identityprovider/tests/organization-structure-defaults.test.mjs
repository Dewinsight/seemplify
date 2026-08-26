import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import mongoose from 'mongoose'

import { Organization } from '../src/models/Organization.js'
import {
  COMMON_DEPARTMENT_NAMES,
  DEFAULT_ORGANIZATION_STRUCTURE,
  GENERAL_DEPARTMENT_NAME,
  buildSeedDepartments
} from '../src/utils/departments.js'
import {
  buildDefaultTeamDocuments,
  seedDefaultOrganizationTeams
} from '../src/services/organizationStructureService.js'

test('new organization structure contains the root and every starter department', () => {
  const departments = buildSeedDepartments()
  assert.equal(departments.length, DEFAULT_ORGANIZATION_STRUCTURE.length)
  assert.deepEqual(
    departments.map((department) => department.name),
    [GENERAL_DEPARTMENT_NAME, ...COMMON_DEPARTMENT_NAMES]
  )

  const general = departments[0]
  assert.equal(general.name, GENERAL_DEPARTMENT_NAME)
  assert.equal(general.isSystem, true)
  assert.equal(general.parentDepartment, null)
  for (const department of departments.slice(1)) {
    assert.equal(department.isSystem, false)
    assert.equal(department.parentDepartment.toString(), general._id.toString())
  }
})

test('every starter department receives at least one ordinary removable team', () => {
  const organizationId = new mongoose.Types.ObjectId()
  const departments = buildSeedDepartments()
  const teams = buildDefaultTeamDocuments({ _id: organizationId, departments })

  assert.equal(
    teams.length,
    DEFAULT_ORGANIZATION_STRUCTURE.reduce((total, department) => total + department.teams.length, 0)
  )
  for (const department of departments) {
    assert.ok(
      teams.some((team) => team.department.toString() === department._id.toString()),
      `${department.name} did not receive a starter team`
    )
  }
  assert.ok(teams.every((team) => team.organization.toString() === organizationId.toString()))
  assert.ok(teams.every((team) => team.parentTeam === null && team.members.length === 0))
})

test('default team seeding is idempotent within each department', async () => {
  const organization = {
    _id: new mongoose.Types.ObjectId(),
    departments: buildSeedDepartments()
  }
  const allTeams = buildDefaultTeamDocuments(organization)
  const alreadyPresent = allTeams.slice(0, 2)
  let inserted = []
  const TeamModel = {
    find() {
      return {
        select() { return this },
        async lean() { return alreadyPresent }
      }
    },
    async insertMany(documents) {
      inserted = documents
      return documents
    }
  }

  const result = await seedDefaultOrganizationTeams(organization, { TeamModel })
  assert.equal(result.length, allTeams.length - alreadyPresent.length)
  assert.equal(inserted.length, allTeams.length - alreadyPresent.length)
  for (const existing of alreadyPresent) {
    assert.ok(!inserted.some((team) => (
      team.department.toString() === existing.department.toString() && team.name === existing.name
    )))
  }
})

test('ordinary departments can be removed while the General root remains protected', async () => {
  const organization = new Organization({
    name: 'Structure test',
    owner: new mongoose.Types.ObjectId(),
    members: [],
    departments: buildSeedDepartments()
  })
  organization.save = async () => organization

  const finance = organization.departments.find((department) => department.name === 'Finance')
  const general = organization.getGeneralDepartment()
  await organization.removeDepartment(finance._id)
  assert.equal(organization.getDepartmentById(finance._id), null)
  await assert.rejects(
    organization.removeDepartment(general._id),
    /organization root and cannot be deleted/
  )
  await assert.rejects(
    organization.updateDepartment(general._id, { name: 'Head Office' }),
    /cannot be renamed/
  )
})

test('department deletion blocks dependent children and assigned members', async () => {
  const ownerId = new mongoose.Types.ObjectId()
  const organization = new Organization({
    name: 'Dependency test',
    owner: ownerId,
    members: [{ account: ownerId, role: 'owner', status: 'active' }],
    departments: buildSeedDepartments()
  })
  organization.save = async () => organization

  const engineering = organization.departments.find((department) => department.name === 'Engineering')
  organization.departments.push({
    name: 'Developer Experience',
    parentDepartment: engineering._id,
    isSystem: false
  })
  await assert.rejects(organization.removeDepartment(engineering._id), /child department/)

  organization.departments.pull(organization.departments.at(-1)._id)
  organization.members[0].department = engineering._id
  await assert.rejects(organization.removeDepartment(engineering._id), /Reassign 1 member/)
})

test('organization creation, deletion API, and People & Structure UI use the default hierarchy contract', () => {
  const routeSource = fs.readFileSync(new URL('../src/routes/organizations.js', import.meta.url), 'utf8')
  const indexSource = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8')
  const viewSource = fs.readFileSync(new URL('../src/views/members.ejs', import.meta.url), 'utf8')

  assert.match(routeSource, /await seedDefaultOrganizationTeams\(organization\)/)
  assert.match(routeSource, /router\.delete\('\/:orgId\/departments\/:departmentId'/)
  assert.match(routeSource, /Team\.countDocuments\(\{/)
  assert.match(routeSource, /Move or delete \$\{teamCount\} team/)
  assert.match(indexSource, /isSystem: !!department\.isSystem/)
  assert.match(viewSource, /Delete department/)
  assert.match(viewSource, /async function deleteDepartment/)
  assert.match(viewSource, /department\.isSystem/)
})
