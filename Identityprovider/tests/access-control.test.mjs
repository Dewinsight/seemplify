import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import {
  ACCESS_CONTROL_SCHEMA_VERSION,
  DEFAULT_ACCESS_ROLES,
  HR_MANAGER_TOP_LEVEL_EXCLUSIONS,
  MEMBER_RESTRICTED_PERMISSION_EXCLUSIONS,
  PRODUCT_PERMISSION_CATALOG,
  getDefaultRolePermissions,
  getPermissionDefinition
} from '../src/config/accessControlCatalog.js'
import {
  mergeDefaultRoles,
  resolveOrganizationAuthorization,
  sanitizePermissionRows
} from '../src/services/accessControlService.js'
import { LMS_ROLE_PERMISSIONS } from '../src/models/LmsRole.js'
import { requireSameOriginMutation } from '../src/middleware/sameOriginMutation.js'
import { getAllOrganizationManagedHubApps } from '../src/config/hubApps.js'
import { getPermissionsForRole, getRegisteredApps } from '../src/utils/permissions.js'

const policy = {
  revision: 7,
  roles: DEFAULT_ACCESS_ROLES
}

test('permission catalogue and built-in roles contain only unique known tokens', () => {
  const appIds = PRODUCT_PERMISSION_CATALOG.map((entry) => entry.appId)
  assert.equal(new Set(appIds).size, appIds.length)

  for (const product of PRODUCT_PERMISSION_CATALOG) {
    const permissionIds = product.permissions.map((permission) => permission.id)
    assert.equal(new Set(permissionIds).size, permissionIds.length, `${product.appId} contains duplicate permissions`)
  }

  for (const role of DEFAULT_ACCESS_ROLES) {
    for (const row of [...role.grants, ...role.denies]) {
      assert.ok(appIds.includes(row.appId), `${role.key} references unknown product ${row.appId}`)
      for (const permissionId of row.permissions) {
        assert.ok(
          permissionId === '*' || getPermissionDefinition(row.appId, permissionId),
          `${role.key} references unknown permission ${row.appId}:${permissionId}`
        )
      }
    }
  }

  for (const exclusions of [MEMBER_RESTRICTED_PERMISSION_EXCLUSIONS, HR_MANAGER_TOP_LEVEL_EXCLUSIONS]) {
    for (const [appId, permissionIds] of Object.entries(exclusions)) {
      for (const permissionId of permissionIds) {
        const definition = getPermissionDefinition(appId, permissionId)
        assert.ok(definition, `exclusion references unknown permission ${appId}:${permissionId}`)
        assert.notEqual(definition.delegable, false, `non-delegable permission does not need an exclusion ${appId}:${permissionId}`)
      }
    }
  }
})

test('every ordinary organization role receives every non-administrative permission across all products', () => {
  for (const sourceRole of ['staff', 'recruiter', 'interviewer']) {
    for (const product of PRODUCT_PERMISSION_CATALOG) {
      const expected = product.permissions
        .filter((permission) => permission.delegable !== false)
        .map((permission) => permission.id)
        .filter((permissionId) => !(MEMBER_RESTRICTED_PERMISSION_EXCLUSIONS[product.appId] || []).includes(permissionId))
        .sort()
      assert.deepEqual(
        getDefaultRolePermissions(sourceRole, product.appId),
        expected,
        `${sourceRole} does not have the complete non-admin ${product.appId} baseline`
      )
    }
  }

  assert.ok(getDefaultRolePermissions('staff', 'messaging').includes('members.view'))
  assert.ok(getDefaultRolePermissions('staff', 'messaging').includes('calls.start'))
  assert.ok(getDefaultRolePermissions('staff', 'messaging').includes('notifications.read'))
  assert.ok(!getDefaultRolePermissions('staff', 'messaging').includes('members.manage'))
  assert.ok(!getDefaultRolePermissions('staff', 'identity').includes('access.manage'))
})

test('legacy permission helpers use the same all-product role policy', () => {
  assert.deepEqual(getRegisteredApps().sort(), PRODUCT_PERMISSION_CATALOG.map((product) => product.appId).sort())
  for (const sourceRole of ['staff', 'recruiter', 'interviewer', 'hr_manager', 'admin']) {
    for (const product of PRODUCT_PERMISSION_CATALOG) {
      assert.deepEqual(
        getPermissionsForRole(sourceRole, product.appId),
        getDefaultRolePermissions(sourceRole, product.appId),
        `legacy helper drifted for ${sourceRole}:${product.appId}`
      )
    }
  }
})

test('HR manager matches admin across products except explicit top-level controls', () => {
  for (const product of PRODUCT_PERMISSION_CATALOG) {
    const adminPermissions = getDefaultRolePermissions('admin', product.appId)
    const expectedHrPermissions = adminPermissions.filter((permissionId) => (
      !(HR_MANAGER_TOP_LEVEL_EXCLUSIONS[product.appId] || []).includes(permissionId)
    ))
    assert.deepEqual(
      getDefaultRolePermissions('hr_manager', product.appId),
      expectedHrPermissions,
      `HR manager differs unexpectedly from admin for ${product.appId}`
    )
  }

  for (const [appId, permissionId] of [
    ['identity', 'members.remove'],
    ['lms', 'manage_lms_settings'],
    ['messaging', 'files.manage'],
    ['messaging', 'settings.manage'],
    ['community', 'articles.publish'],
    ['community', 'settings.manage'],
    ['automation-hub', 'connections.manage'],
    ['automation-hub', 'settings.manage'],
    ['experience-management', 'journeys.manage_roles'],
    ['approver', 'workflow.manage'],
    ['seemplify-learning', 'courses.manage']
  ]) assert.ok(getDefaultRolePermissions('hr_manager', appId).includes(permissionId), `HR manager lacks ${appId}:${permissionId}`)

  for (const [appId, permissionId] of [
    ['identity', 'access.manage'],
    ['identity', 'roles.assign'],
    ['identity', 'owner.transfer'],
    ['identity', 'organization.delete'],
    ['smarthr', 'manage_billing'],
    ['messaging', 'security.manage'],
    ['messaging', 'webhooks.manage']
  ]) assert.ok(!getDefaultRolePermissions('hr_manager', appId).includes(permissionId), `HR manager received protected ${appId}:${permissionId}`)
})

test('schema version three refreshes locked role baselines without replacing custom roles', () => {
  assert.equal(ACCESS_CONTROL_SCHEMA_VERSION, 3)
  const customRole = {
    key: 'project_coordinator', name: 'Project Coordinator', locked: false,
    sourceOrganizationRoles: [], sourceTeamRoles: [],
    grants: [{ appId: 'messaging', permissions: ['messages.read'] }], denies: []
  }
  const staleEmployee = {
    ...DEFAULT_ACCESS_ROLES.find((role) => role.key === 'employee'),
    grants: [{ appId: 'identity', permissions: ['organization.view'] }]
  }

  const merged = mergeDefaultRoles([staleEmployee, customRole], { refreshLocked: true })
  const refreshedEmployee = merged.find((role) => role.key === 'employee')
  const preservedCustom = merged.find((role) => role.key === 'project_coordinator')

  assert.ok(refreshedEmployee.grants.some((row) => (
    row.appId === 'messaging' && row.permissions.includes('messages.read')
  )))
  assert.deepEqual(preservedCustom.grants, customRole.grants)
})

test('every organization-managed Hub product has an IdP permission matrix', () => {
  const catalogAppIds = new Set(PRODUCT_PERMISSION_CATALOG.map((entry) => entry.appId))
  const missing = getAllOrganizationManagedHubApps()
    .map((app) => app.appId)
    .filter((appId) => !catalogAppIds.has(appId))
  assert.deepEqual(missing, [])
})

test('canonical LMS catalogue covers every active legacy Frappe role permission', () => {
  for (const [role, permissions] of Object.entries(LMS_ROLE_PERMISSIONS)) {
    if (role === 'administrator') continue
    for (const permissionId of permissions) {
      assert.ok(getPermissionDefinition('lms', permissionId), `${role} uses missing lms:${permissionId}`)
    }
  }
})

test('central catalogue covers permission constants enforced by product adapters', () => {
  const source = (relativePath) => fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8')
  const objectPermissionKeys = (relativePath) => {
    const text = source(relativePath)
    const start = text.indexOf('const PERMISSIONS = {')
    const end = text.indexOf('\n};', start)
    assert.ok(start >= 0 && end > start, `Could not find PERMISSIONS in ${relativePath}`)
    return [...text.slice(start, end).matchAll(/^\s*'([^']+)'\s*:/gm)].map((match) => match[1])
  }

  for (const [appId, relativePath] of [
    ['performance-management', '../../performance/backend/middleware/rbac.js'],
    ['payroll-management', '../../payroll/backend/middleware/rbac.js']
  ]) {
    for (const permissionId of objectPermissionKeys(relativePath)) {
      assert.ok(getPermissionDefinition(appId, permissionId), `${appId} enforces missing ${permissionId}`)
    }
  }

  const attendanceSource = source('../../time-attendance/backend/services/attendanceAccessService.js')
  const attendanceBlock = attendanceSource.slice(
    attendanceSource.indexOf('const PERMISSIONS = Object.freeze({'),
    attendanceSource.indexOf('\n});', attendanceSource.indexOf('const PERMISSIONS = Object.freeze({'))
  )
  for (const match of attendanceBlock.matchAll(/:\s*'([^']+)'/g)) {
    assert.ok(getPermissionDefinition('time-attendance', match[1]), `time-attendance enforces missing ${match[1]}`)
  }
})

test('IdP route guards and Simple LMS gates reference catalogued permissions', () => {
  const source = (relativePath) => fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8')
  const identityRouteSources = [
    '../src/routes/invitations.js',
    '../src/routes/members.js',
    '../src/routes/notifications.js',
    '../src/routes/onboarding.js',
    '../src/routes/organizations.js',
    '../src/routes/organizationSubscription.js',
    '../src/routes/teams.js'
  ].map(source).join('\n')

  const identityGuards = [...identityRouteSources.matchAll(
    /(?:requireIdentityPermission\(|requestHasIdentityPermission\(req,\s*)['"]([^'"]+)['"]/g
  )]
  assert.ok(identityGuards.length >= 20, 'Expected the IdP organization routes to use central permission guards')
  for (const match of identityGuards) {
    assert.ok(getPermissionDefinition('identity', match[1]), `identity route enforces missing ${match[1]}`)
  }

  const simpleLmsSource = source('../src/routes/simpleLms.js')
  const lmsGuards = [...simpleLmsSource.matchAll(/requireLmsPermission\([^,]+,[^,]+,\s*['"]([^'"]+)['"]/g)]
  assert.ok(lmsGuards.length >= 8, 'Expected Simple LMS mutations to use central permission guards')
  for (const match of lmsGuards) {
    assert.ok(getPermissionDefinition('lms', match[1]), `Simple LMS enforces missing lms:${match[1]}`)
  }
})

test('invitation creation cannot escalate roles or product access without explicit grants', () => {
  const source = fs.readFileSync(new URL('../src/routes/invitations.js', import.meta.url), 'utf8')
  assert.match(source, /role !== 'staff' && !requestHasIdentityPermission\(req, 'roles\.assign'\)/)
  assert.match(source, /requestHasIdentityPermission\(req, 'apps\.assign'\)/)
  assert.match(source, /appAccess = \{ mode: APP_ACCESS_MODE_SELECTED, appIds: \[\] \}/)
})

test('organization inputs reject unknown and platform-controlled grants', () => {
  assert.throws(
    () => sanitizePermissionRows([{ appId: 'lms', permissions: ['not_real'] }]),
    (error) => error.code === 'UNKNOWN_PERMISSION'
  )
  assert.throws(
    () => sanitizePermissionRows([{ appId: 'identity', permissions: ['owner.transfer'] }], { delegableOnly: true }),
    (error) => error.code === 'NON_DELEGABLE_PERMISSION'
  )
  assert.throws(
    () => sanitizePermissionRows([{ appId: 'experience-management', permissions: ['roles.manage'] }], { delegableOnly: true }),
    (error) => error.code === 'NON_DELEGABLE_PERMISSION'
  )
  assert.deepEqual(
    sanitizePermissionRows([{ appId: 'identity', permissions: ['owner.transfer'] }]),
    [{ appId: 'identity', permissions: ['owner.transfer'] }]
  )
  assert.deepEqual(
    sanitizePermissionRows([{ appId: 'lms', permissions: ['*'] }], { allowWildcard: true }),
    [{ appId: 'lms', permissions: ['*'] }]
  )
})

test('built-in organization roles never receive platform-only product permissions', () => {
  for (const role of DEFAULT_ACCESS_ROLES) {
    for (const row of role.grants) {
      for (const permissionId of row.permissions) {
        const definition = getPermissionDefinition(row.appId, permissionId)
        assert.notEqual(definition?.scope, 'platform', `${role.key} received platform-only ${row.appId}:${permissionId}`)
      }
    }
  }
})

test('effective authorization applies roles, direct exceptions, app assignment, and deny precedence', async () => {
  const member = {
    account: 'account-1',
    status: 'active',
    role: 'staff',
    appAccess: { mode: 'selected', appIds: ['smarthr'] },
    accessControl: {
      roleKeys: ['recruiter'],
      grants: [{ appId: 'smarthr', permissions: ['manage_settings'] }],
      denies: [{ appId: 'smarthr', permissions: ['view_jobs', 'manage_settings'] }]
    }
  }
  const authorization = await resolveOrganizationAuthorization({
    account: { _id: 'account-1', teams: [] },
    organization: {
      _id: 'organization-1',
      members: [member],
      departments: [],
      accessControl: { revision: 4, roleOverrides: [] }
    },
    member,
    policy
  })

  assert.deepEqual(Object.keys(authorization.permissionsByApp).sort(), ['identity', 'smarthr'])
  assert.ok(authorization.roleKeys.includes('employee'))
  assert.ok(authorization.roleKeys.includes('recruiter'))
  assert.ok(!authorization.permissionsByApp.smarthr.includes('view_jobs'))
  assert.ok(!authorization.permissionsByApp.smarthr.includes('manage_settings'))
  assert.ok(!Object.prototype.hasOwnProperty.call(authorization.permissionsByApp, 'lms'))
})

test('assigned products retain an authoritative permission list after explicit denies', async () => {
  const member = {
    account: 'account-2',
    status: 'active',
    role: 'staff',
    appAccess: { mode: 'selected', appIds: ['smarthr'] },
    accessControl: {
      roleKeys: [],
      grants: [],
      denies: [{ appId: 'smarthr', permissions: ['view_jobs'] }]
    }
  }
  const authorization = await resolveOrganizationAuthorization({
    account: { _id: 'account-2', teams: [] },
    organization: { _id: 'organization-2', members: [member], departments: [], accessControl: { revision: 2 } },
    member,
    policy
  })
  assert.deepEqual(authorization.permissionsByApp.smarthr, [
    'manage_candidates',
    'manage_interviews',
    'manage_jobs',
    'submit_interview_feedback',
    'view_analytics',
    'view_candidates'
  ])
  assert.ok(!authorization.permissionsByApp.smarthr.includes('view_jobs'))
})

test('organization owner recovery permissions survive organization and member denies', async () => {
  const member = {
    account: 'account-owner',
    status: 'active',
    role: 'owner',
    appAccess: { mode: 'all', appIds: [] },
    accessControl: {
      roleKeys: [],
      grants: [],
      denies: [{ appId: 'identity', permissions: ['access.manage', 'owner.transfer', 'organization.delete'] }]
    }
  }
  const authorization = await resolveOrganizationAuthorization({
    account: { _id: 'account-owner', teams: [] },
    organization: {
      _id: 'organization-owner',
      members: [member],
      departments: [],
      accessControl: {
        revision: 3,
        roleOverrides: [{
          roleKey: 'organization_owner',
          name: 'Owner',
          grants: [],
          denies: [{ appId: 'identity', permissions: ['access.manage', 'owner.transfer', 'organization.delete'] }]
        }]
      }
    },
    member,
    policy
  })
  assert.ok(authorization.permissionsByApp.identity.includes('access.manage'))
  assert.ok(authorization.permissionsByApp.identity.includes('owner.transfer'))
  assert.ok(authorization.permissionsByApp.identity.includes('organization.delete'))
})

test('access-control mutation middleware rejects cross-site browser requests', () => {
  const response = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this }
  }
  const request = {
    method: 'PUT',
    get(name) {
      return ({
        'sec-fetch-site': 'cross-site',
        host: 'auth.seemplifyai.com',
        origin: 'https://attacker.example'
      })[name.toLowerCase()] || ''
    }
  }
  let continued = false
  requireSameOriginMutation(request, response, () => { continued = true })
  assert.equal(response.statusCode, 403)
  assert.equal(response.body.code, 'CROSS_SITE_MUTATION')
  assert.equal(continued, false)
})
