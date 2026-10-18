import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPerformanceDirectory } from '../src/utils/performanceDirectory.js'

function fixture(role = 'owner') {
  const person = (key, memberRole = 'staff') => ({ account: { _id: key, sub: `sub-${key}`, email: `${key}@example.test`, profile: { name: key } }, role: memberRole, status: 'active' })
  const organization = { _id: 'org', owner: role === 'owner' ? 'actor' : 'owner', members: [person('actor', role), person('owner', 'owner'), person('employee'), person('child'), person('other'), person('teamless'), person('hr', 'hr_manager'), person('removed')], departments: [] }
  organization.members.at(-1).status = 'inactive'
  const team = (key, parent, members) => ({ _id: key, organization: 'org', name: key, parentTeam: parent, members: members.map(([account, teamRole]) => ({ account, role: teamRole, status: 'active' })) })
  const teams = [team('product', null, [['actor', 'line_manager'], ['employee', 'member']]), team('child-team', 'product', [['child', 'member']]), team('other-team', null, [['other', 'member']]), team('empty', null, []), { ...team('foreign', null, [['actor', 'line_manager']]), organization: 'foreign-org' }]
  return { organization, teams, actorId: 'actor' }
}
for (const role of ['owner', 'admin', 'hr_manager']) test(`${role} sees all active people, teamless people and empty teams`, () => {
  const result = buildPerformanceDirectory(fixture(role))
  assert.equal(result.scope, 'organization'); assert.equal(result.canStartAppraisals, true)
  assert.equal(result.teams.length, 4)
  assert.equal(result.members.length, 7)
  assert.ok(result.members.some(person => person.userId === 'sub-teamless'))
  assert.ok(!result.members.some(person => person.userId === 'sub-removed'))
})
for (const role of ['line_manager', 'team_lead']) test(`${role} sees own teams and descendants without sibling or foreign teams`, () => {
  const input = fixture('staff'); input.teams[0].members[0].role = role
  const result = buildPerformanceDirectory(input)
  assert.equal(result.scope, 'managed_teams'); assert.equal(result.canStartAppraisals, true)
  assert.deepEqual(result.teams.map(team => team.id), ['product', 'child-team'])
  assert.deepEqual(result.members.map(person => person.userId), ['sub-actor', 'sub-employee', 'sub-child'])
  assert.ok(result.reviewers.some(person => person.userId === 'sub-hr' && person.organizationWide))
})
for (const role of ['staff', 'recruiter', 'interviewer']) test(`${role} with member-only team role sees self and cannot start appraisals`, () => {
  const input = fixture(role); input.teams[0].members[0].role = 'member'
  const result = buildPerformanceDirectory(input)
  assert.equal(result.scope, 'self'); assert.equal(result.canStartAppraisals, false)
  assert.deepEqual(result.members.map(person => person.userId), ['sub-actor']); assert.deepEqual(result.teams, [])
  assert.deepEqual(result.reviewers, [])
})
test('an owner can select managed view without mixing organization people with one team count', () => {
  const result = buildPerformanceDirectory({ ...fixture(), view: 'managed' })
  assert.equal(result.organizationRole, 'owner'); assert.equal(result.scope, 'managed_teams')
  assert.equal(result.teams.length, 2); assert.equal(result.members.length, 3)
})
test('inactive and nonmember actors cannot obtain a directory', () => {
  for (const actorId of ['unknown', 'removed']) assert.throws(() => buildPerformanceDirectory({ ...fixture(), actorId }), /membership required/)
})
test('cyclic hierarchies terminate and do not join unrelated teams', () => {
  const input = fixture('staff'); input.teams[0].parentTeam = 'child-team'
  assert.equal(buildPerformanceDirectory(input).teams.length, 2)
})
