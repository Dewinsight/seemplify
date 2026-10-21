import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_ACCESS_ROLES, getDefaultRolePermissions } from '../src/config/accessControlCatalog.js'
import { upgradeManagerCyclePermission } from '../src/services/accessControlService.js'

test('managers get cycle setup without shared role/framework library editing', () => {
  for (const key of ['line_manager', 'team_lead', 'department_head']) {
    const permissions = DEFAULT_ACCESS_ROLES.find(role => role.key === key).grants.filter(row => row.appId === 'performance-management').flatMap(row => row.permissions)
    assert.ok(permissions.includes('competency.cycle.manage'))
    assert.ok(!permissions.includes('competency.role.manage'))
    assert.ok(!permissions.includes('competency.framework.manage'))
  }
})
test('v6 narrowly adds the permission and preserves other policies and explicit denies', () => {
  const roles = [{ key: 'line_manager', name: 'Existing manager', locked: true, grants: [{ appId: 'performance-management', permissions: ['review:conduct:direct_reports'] }, { appId: 'messaging', permissions: ['custom.permission'] }], denies: [{ appId: 'performance-management', permissions: ['competency.cycle.manage'] }] }, { key: 'custom-manager', name: 'Custom', locked: false, grants: [], denies: [] }]
  const result = upgradeManagerCyclePermission(roles)
  assert.deepEqual(result[0].grants[0].permissions, ['review:conduct:direct_reports', 'competency.cycle.manage'])
  assert.deepEqual(result[0].grants[1], roles[0].grants[1])
  assert.deepEqual(result[0].denies, roles[0].denies)
  assert.deepEqual(result[1].grants, [])
  assert.deepEqual(roles[0].grants[0].permissions, ['review:conduct:direct_reports'])
  assert.deepEqual(upgradeManagerCyclePermission(result), result)
})
