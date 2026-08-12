import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canAccessReturnPath,
  getDefaultDashboardPath,
  shouldUseWorkspaceChooser
} from '../src/utils/accessProfile.js'

test('learners land in My Learning by default', () => {
  assert.equal(getDefaultDashboardPath({}), '/simple-lms?view=my-learning')
  assert.equal(
    getDefaultDashboardPath({}, '/simple-lms?view=my-learning'),
    '/simple-lms?view=my-learning'
  )
})

test('privileged roles keep their role-specific dashboard', () => {
  assert.equal(getDefaultDashboardPath({ platformRole: 'admin' }), '/admin')
  assert.equal(getDefaultDashboardPath({ partnerAccess: { organizationId: 'org_1' } }), '/partner-dashboard')
  assert.equal(getDefaultDashboardPath({ agentAccess: { organizationId: 'org_1' } }), '/agent-dashboard')
})

test('explicit Learning return paths remain available to every signed-in account', () => {
  assert.equal(canAccessReturnPath({}, '/simple-lms?view=catalog'), true)
  assert.equal(canAccessReturnPath({}, '/simple-lms?view=my-learning'), true)
  assert.equal(canAccessReturnPath({}, 'https://example.com'), false)
})

test('multiple privileged dashboards do not force a chooser for a Learning deep link', () => {
  const accessProfile = {
    hasMultiplePrivilegedDashboards: true,
    platformRole: 'admin',
    partnerAccess: { organizationId: 'org_1' }
  }

  assert.equal(shouldUseWorkspaceChooser(accessProfile, '/simple-lms?view=my-learning'), false)
  assert.equal(shouldUseWorkspaceChooser(accessProfile, '/admin'), true)
})
