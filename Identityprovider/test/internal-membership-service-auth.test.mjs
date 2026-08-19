import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveInternalMembershipSecret } from '../src/services/internalMembershipAuthService.js'

const env = {
  INTERNAL_SERVICE_SECRET: 'generic-secret',
  ATTENDANCE_HUB_SECRET: 'attendance-secret',
  MESSAGING_IDP_SERVICE_SECRET: 'messaging-secret',
  RECRUITER_IDP_SERVICE_SECRET: 'recruiter-secret',
}

test('selects the Time and Attendance secret for roster reconciliation', () => {
  assert.equal(resolveInternalMembershipSecret('time-attendance', env), 'attendance-secret')
})

test('selects caller-specific secrets for other membership clients', () => {
  assert.equal(resolveInternalMembershipSecret('recruiter', env), 'recruiter-secret')
  assert.equal(resolveInternalMembershipSecret('leave-management', env), 'messaging-secret')
  assert.equal(resolveInternalMembershipSecret('workspace', env), 'messaging-secret')
})

test('falls back safely for legacy callers and dedicated attendance configuration', () => {
  assert.equal(resolveInternalMembershipSecret('legacy-service', env), 'generic-secret')
  assert.equal(resolveInternalMembershipSecret('time-attendance', {
    ...env,
    TIME_ATTENDANCE_IDP_SERVICE_SECRET: 'dedicated-attendance-secret',
  }), 'dedicated-attendance-secret')
})
