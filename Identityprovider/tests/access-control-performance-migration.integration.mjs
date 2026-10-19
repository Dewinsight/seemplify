import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import mongoose from 'mongoose'

process.env.NODE_ENV = 'test'
process.env.IDP_CLAIMS_CACHE_ENABLED = 'false'
process.env.CLAIMS_CACHE_ENABLED = 'false'

// Run in the Performance backend QA job, where mongodb-memory-server is an
// installed test dependency. This never connects to a configured application DB.
const requireBackend = createRequire(new URL('../../performance/backend/package.json', import.meta.url))
const { MongoMemoryServer } = requireBackend('mongodb-memory-server')

for (const oldSchema of [3, 4]) test(`persisted v${oldSchema} migration changes only builtin Performance rows and preserves deliberate policies`, async () => {
  const [{ AccessControlPolicy }, { Account }, { Organization },
    { DEFAULT_ACCESS_ROLES, getDefaultRolePermissions },
    { getOrCreateGlobalAccessPolicy, resolveOrganizationAuthorization }] = await Promise.all([
    import('../src/models/AccessControlPolicy.js'), import('../src/models/Account.js'),
    import('../src/models/Organization.js'), import('../src/config/accessControlCatalog.js'),
    import('../src/services/accessControlService.js')
  ])
  const server = await MongoMemoryServer.create({ instance: { ip: '127.0.0.1' } })
  try {
    await mongoose.connect(server.getUri(), { dbName: 'isolated_idp_performance_migration' })
    const actorId = new mongoose.Types.ObjectId()
    const accountId = new mongoose.Types.ObjectId()
    const organizationId = new mongoose.Types.ObjectId()
    const roles = structuredClone(DEFAULT_ACCESS_ROLES)
    const employee = roles.find(role => role.key === 'employee')
    Object.assign(employee, { name: 'Company employee label', description: 'Deliberately edited role metadata',
      createdAt: new Date('2020-01-01T00:00:00Z'), updatedAt: new Date('2024-01-01T00:00:00Z'), updatedBy: actorId })
    employee.grants = [
      { appId: 'messaging', permissions: ['messages.read'] },
      { appId: 'smarthr', permissions: ['manage_settings'] },
      { appId: 'performance-management', permissions: ['review:view:all', 'goal:assign:organization'] }
    ]
    employee.denies = [
      { appId: 'messaging', permissions: ['messages.write'] },
      { appId: 'performance-management', permissions: ['recognition:create'] }
    ]
    roles.push({ key: 'deliberate_custom', name: 'Deliberate custom reviewer', locked: false, isActive: true,
      sourceOrganizationRoles: [], sourceTeamRoles: [],
      grants: [{ appId: 'performance-management', permissions: ['review:view:all', 'feedback:view:all'] }],
      denies: [{ appId: 'smarthr', permissions: ['manage_jobs'] }], updatedBy: actorId })
    await AccessControlPolicy.create({ key: 'global', schemaVersion: oldSchema, revision: 30, roles })
    await Account.collection.insertOne({ _id: accountId, sub: 'synthetic-policy-migration', authorizationRevision: 7, teams: [] })
    const member = { account: accountId, role: 'staff', status: 'active', appAccess: { mode: 'selected', appIds: ['performance-management', 'messaging', 'smarthr'] },
      accessControl: { roleKeys: ['deliberate_custom'],
        grants: [{ appId: 'performance-management', permissions: ['analytics:view:organization'] }],
        denies: [{ appId: 'performance-management', permissions: ['feedback:view:all'] }] } }
    await Organization.collection.insertOne({ _id: organizationId, members: [member], departments: [], accessControl: {
      revision: 9, roleOverrides: [{ roleKey: 'employee', grants: [{ appId: 'performance-management', permissions: ['goal:assign:organization'] }], denies: [] }]
    } })
    const before = await AccessControlPolicy.findOne({ key: 'global' }).lean()
    const organizationBefore = await Organization.findById(organizationId).lean()
    await getOrCreateGlobalAccessPolicy()
    const after = await AccessControlPolicy.findOne({ key: 'global' }).lean()
    assert.equal(after.schemaVersion, 5)
    assert.equal(after.revision, 31)
    for (const oldRole of before.roles) {
      const fresh = after.roles.find(role => role.key === oldRole.key)
      if (oldRole.key === 'deliberate_custom') assert.deepEqual(fresh, oldRole)
      else {
        const metadata = ({ grants, denies, ...rest }) => rest
        assert.deepEqual(metadata(fresh), metadata(oldRole), `${oldRole.key} metadata changed`)
        for (const rows of ['grants', 'denies']) assert.deepEqual(
          fresh[rows].filter(row => row.appId !== 'performance-management'),
          oldRole[rows].filter(row => row.appId !== 'performance-management'),
          `${oldRole.key} non-Performance ${rows} changed`
        )
      }
    }
    const migratedEmployee = after.roles.find(role => role.key === 'employee')
    assert.deepEqual(migratedEmployee.grants.filter(row => row.appId === 'performance-management').flatMap(row => row.permissions).sort(), getDefaultRolePermissions('staff', 'performance-management'))
    assert.deepEqual(migratedEmployee.denies.filter(row => row.appId === 'performance-management'), [])
    const organizationAfter = await Organization.findById(organizationId).lean()
    assert.deepEqual(organizationAfter, organizationBefore)
    const account = await Account.findById(accountId).lean()
    assert.equal(account.authorizationRevision, 8)
    const effective = await resolveOrganizationAuthorization({ account, organization: organizationAfter, policy: after })
    for (const id of ['review:view:all', 'goal:assign:organization', 'analytics:view:organization']) assert.ok(effective.permissionsByApp['performance-management'].includes(id))
    assert.ok(!effective.permissionsByApp['performance-management'].includes('feedback:view:all'))
    assert.deepEqual(effective.permissionsByApp.smarthr, ['manage_settings'])
    await getOrCreateGlobalAccessPolicy()
    assert.deepEqual(await AccessControlPolicy.findOne({ key: 'global' }).lean(), after)
    assert.equal((await Account.findById(accountId).lean()).authorizationRevision, 8)
  } finally {
    await mongoose.disconnect()
    await server.stop()
  }
})
