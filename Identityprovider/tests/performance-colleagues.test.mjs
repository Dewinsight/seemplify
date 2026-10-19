import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPerformanceColleagues } from '../src/utils/performanceColleagues.js'
import { buildPerformanceDirectory } from '../src/utils/performanceDirectory.js'
import { DEFAULT_ACCESS_ROLES, ACCESS_CONTROL_SCHEMA_VERSION } from '../src/config/accessControlCatalog.js'
import { resolveOrganizationAuthorization } from '../src/services/accessControlService.js'

const APP = 'performance-management'
const ACTIONS = ['feedback:send', 'feedback:request', 'recognition:create']
function fixture(role = 'staff') {
  const person = (key, fields = {}) => ({ account: { _id: key, sub: `sub-${key}`, email: `${key}@example.test`, profile: { name: `Colleague ${key}` } },
    role: 'staff', status: 'active', appAccess: { mode: 'all' }, ...fields })
  return { _id: 'org-a', owner: 'owner', members: [person('actor', { role }), person('peer', { designation: 'Designer', privateNotes: 'private' }),
    person('inactive', { status: 'inactive' }), person('unassigned', { appAccess: { mode: 'selected', appIds: ['payroll-management'] } })], departments: [] }
}
async function authorization(organization, { grants = [], denies = [] } = {}) {
  const member = organization.members.find(member => member.account._id === 'actor')
  return resolveOrganizationAuthorization({ account: member.account, organization, member: { ...member, accessControl: {
    grants: [{ appId: APP, permissions: grants }], denies: [{ appId: APP, permissions: denies }]
  } }, policy: { schemaVersion: ACCESS_CONTROL_SCHEMA_VERSION, revision: 1, roles: DEFAULT_ACCESS_ROLES } })
}
const build = (organization, resolved, fields = {}) => buildPerformanceColleagues({ organization, actorId: 'actor', authorization: resolved, q: 'peer', ...fields })

for (const role of ['staff', 'recruiter', 'interviewer']) test(`${role} can discover an active colleague using existing canonical collaboration grants only`, async () => {
  const organization = fixture(role), resolved = await authorization(organization)
  const result = build(organization, resolved)
  assert.deepEqual(result, { organizationId: 'org-a', members: [{ userId: 'sub-peer', name: 'Colleague peer', email: 'peer@example.test', jobTitle: 'Designer' }] })
  // Discovery must not broaden the independent employee assessment directory.
  const performance = buildPerformanceDirectory({ organization, actorId: 'actor', teams: [] })
  assert.equal(performance.scope, 'self'); assert.equal(performance.canStartAppraisals, false)
  assert.deepEqual(performance.members.map(member => member.userId), ['sub-actor'])
  assert.deepEqual(performance.reviewers, [])
})

test('explicitly denying all collaboration actions overrides both staff and HR defaults', async () => {
  for (const role of ['staff', 'hr_manager']) {
    const organization = fixture(role), resolved = await authorization(organization, { denies: ACTIONS })
    assert.throws(() => build(organization, resolved), error => error.status === 403)
  }
})

test('any one permitted collaboration action is sufficient without granting assessment authority', async () => {
  for (const action of ACTIONS) {
    const organization = fixture(), resolved = await authorization(organization, { denies: ACTIONS.filter(other => other !== action) })
    assert.equal(build(organization, resolved).members[0].userId, 'sub-peer')
    assert.equal(resolved.permissionsByApp[APP].includes('competency.assessment.launch'), false)
  }
})

test('inactive, foreign and Performance-unassigned actors are rejected even with a supplied grant matrix', async () => {
  for (const scenario of ['inactive', 'unassigned', 'foreign']) {
    const organization = fixture(), resolved = await authorization(organization)
    if (scenario === 'inactive') organization.members[0].status = 'inactive'
    if (scenario === 'unassigned') organization.members[0].appAccess = { mode: 'selected', appIds: [] }
    assert.throws(() => build(organization, resolved, { actorId: scenario === 'foreign' ? 'foreign-actor' : 'actor' }), error => error.status === 403)
  }
})

test('fresh membership changes and app assignments remove candidates; responses expose only contact labels', async () => {
  const organization = fixture(), resolved = await authorization(organization)
  const result = build(organization, resolved, { q: 'Colleague' })
  assert.deepEqual(result.members.map(member => member.userId), ['sub-actor', 'sub-peer'])
  for (const member of result.members) assert.ok(Object.keys(member).every(key => ['userId', 'name', 'email', 'jobTitle'].includes(key)))
  assert.deepEqual(Object.keys(result), ['organizationId', 'members'])
  organization.members[1].status = 'inactive'
  assert.deepEqual(build(organization, resolved).members, [])
  organization.members[1].status = 'active'; organization.members[1].account.isActive = false
  assert.deepEqual(build(organization, resolved).members, [])
})

test('literal bounded search cannot become a regex or return more than25 minimal records', async () => {
  const organization = fixture(), resolved = await authorization(organization)
  organization.members[1].account.profile.name = 'Literal.* Colleague'
  organization.members.push({ ...organization.members[1], account: { _id: 'other', sub: 'sub-other', email: 'other@example.test', profile: { name: 'LiteralAB Colleague' } } })
  assert.deepEqual(build(organization, resolved, { q: 'Literal.*' }).members.map(member => member.userId), ['sub-peer'])
  for (const q of ['a', 'x'.repeat(121), ['peer']]) assert.throws(() => build(organization, resolved, { q }), error => error.status === 400)
  for (let index = 0; index < 40; index++) organization.members.push({ role: 'staff', status: 'active', account: { _id: `extra${index}`, sub: `extra${index}`, email: `extra${index}@example.test`, profile: { name: `Colleague ${index}` } } })
  assert.equal(build(organization, resolved, { q: 'Colleague', limit: 999 }).members.length, 25)
})

test('exact canonical ID lookup is independent of top25 name search and enforces the specific write action', async () => {
  const organization = fixture(), resolved = await authorization(organization)
  for (let index = 0; index < 40; index++) organization.members.push({ role: 'staff', status: 'active', account: { _id: `extra${index}`, sub: `opaque-${index}`, email: `person${index}@example.test`, profile: { name: 'Identical name' } } })
  assert.deepEqual(build(organization, resolved, { q: undefined, userId: 'opaque-39', action: 'recognition:create' }).members,
    [{ userId: 'opaque-39', name: 'Identical name', email: 'person39@example.test' }])
  const deniedRecognition = await authorization(organization, { denies: ['recognition:create'] })
  assert.throws(() => build(organization, deniedRecognition, { userId: 'opaque-39', action: 'recognition:create' }), error => error.status === 403)
  assert.equal(build(organization, deniedRecognition, { userId: 'opaque-39', action: 'feedback:send' }).members.length, 1)
  assert.deepEqual(build(organization, resolved, { userId: 'unknown-foreign' }).members, [])
  assert.deepEqual(build(organization, resolved, { userId: 'peer' }).members, [], 'a noncanonical account alias is not a canonical recipient ID')
})
