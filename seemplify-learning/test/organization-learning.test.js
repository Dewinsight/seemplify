import assert from 'node:assert/strict'
import test from 'node:test'
import {
  courseIsAvailableToOrganizationMember,
  defaultLearningRoleForOrganizationRole,
  normalizeOrganizationLearningAccess,
  organizationClaimAllowsLearning,
  sanitizeCourseAudience
} from '../src/utils/organizationLearning.js'

const organizationId = '64b000000000000000000001'
const memberId = '64b000000000000000000002'

test('IdP organization roles receive safe Learning defaults', () => {
  assert.equal(defaultLearningRoleForOrganizationRole('owner'), 'learning_admin')
  assert.equal(defaultLearningRoleForOrganizationRole('admin'), 'learning_admin')
  assert.equal(defaultLearningRoleForOrganizationRole('hr_manager'), 'learning_manager')
  assert.equal(defaultLearningRoleForOrganizationRole('staff'), 'learner')

  const manager = normalizeOrganizationLearningAccess({}, 'hr_manager')
  assert.equal(manager.canCreateCourses, true)
  assert.equal(manager.canAssignCourses, true)
  assert.equal(manager.canManageLearning, false)
})

test('Seemplify Learning access is separate from the Stanbic/Frappe LMS app scope', () => {
  assert.equal(organizationClaimAllowsLearning({ appAccess: { mode: 'all' } }), true)
  assert.equal(organizationClaimAllowsLearning({
    appAccess: { mode: 'selected', appIds: ['seemplify-learning'] }
  }), true)
  assert.equal(organizationClaimAllowsLearning({
    appAccess: { mode: 'selected', appIds: ['lms'] }
  }), false)
})

test('organization-private courses obey tenant and audience boundaries', () => {
  const baseCourse = {
    isActive: true,
    status: 'published',
    visibility: 'organization_private',
    organization: organizationId,
    audience: { mode: 'selected_members', members: [memberId] }
  }
  const baseContext = {
    organizationId,
    learningAccess: { role: 'learner', catalogAccess: 'all_available' },
    organizationSettings: {}
  }

  assert.equal(courseIsAvailableToOrganizationMember(baseCourse, {
    ...baseContext,
    accountId: memberId
  }), true)
  assert.equal(courseIsAvailableToOrganizationMember(baseCourse, {
    ...baseContext,
    accountId: '64b000000000000000000099'
  }), false)
  assert.equal(courseIsAvailableToOrganizationMember(baseCourse, {
    ...baseContext,
    organizationId: '64b000000000000000000099',
    accountId: memberId
  }), false)
})

test('catalogue policy can hide system courses and limit discovery to assignments', () => {
  const systemCourse = {
    isActive: true,
    status: 'published',
    visibility: 'system_public'
  }
  assert.equal(courseIsAvailableToOrganizationMember(systemCourse, {
    accountId: memberId,
    organizationId,
    learningAccess: { role: 'learner', catalogAccess: 'all_available' },
    organizationSettings: { allowSystemCourses: false }
  }), false)
  assert.equal(courseIsAvailableToOrganizationMember(systemCourse, {
    accountId: memberId,
    organizationId,
    learningAccess: { role: 'learner', catalogAccess: 'assigned_only' },
    organizationSettings: { allowSystemCourses: true }
  }), false)
})

test('course audience input only retains valid Learning staff', () => {
  assert.deepEqual(sanitizeCourseAudience({
    mode: 'selected_members',
    members: [memberId, memberId, '64b000000000000000000099']
  }, [memberId]), {
    mode: 'selected_members',
    learningRoles: [],
    members: [memberId]
  })
})
