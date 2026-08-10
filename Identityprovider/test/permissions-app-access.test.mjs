import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOrganizationClaims, organizationClaimAppAccess } from '../src/utils/permissions.js'
import { Organization } from '../src/models/Organization.js'

test('OIDC organization claim prefers canonical selected member access over embedded legacy all', () => {
  const result = organizationClaimAppAccess(
    { appAccess: { mode: 'all', appIds: [] } },
    { appAccess: { mode: 'selected', appIds: ['leave-management'] } }
  )
  assert.deepEqual(result, { mode: 'selected', appIds: ['leave-management'] })
})

test('OIDC organization claim falls back to embedded access for legacy organizations', () => {
  const result = organizationClaimAppAccess(
    { appAccess: { mode: 'selected', appIds: ['smarthr'] } },
    null
  )
  assert.deepEqual(result, { mode: 'selected', appIds: ['smarthr'] })
})

test('OIDC claims fail closed when Account retains an org removed from canonical Organization members', async () => {
  const originalFind = Organization.find
  Organization.find = () => ({
    select() { return this },
    async lean() {
      return [{
        _id: 'organization-a',
        name: 'Organization A',
        departments: [],
        branches: [],
        members: []
      }]
    }
  })

  try {
    const claims = await buildOrganizationClaims({
      _id: 'account-a',
      organizations: [{
        organization: { _id: 'organization-a', name: 'Stale Organization A' },
        isActive: true,
        role: 'owner',
        appAccess: { mode: 'all', appIds: [] }
      }],
      teams: []
    })
    assert.deepEqual(claims, [])
  } finally {
    Organization.find = originalFind
  }
})
