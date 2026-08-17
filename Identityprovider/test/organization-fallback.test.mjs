import test from 'node:test'
import assert from 'node:assert/strict'
import { Account } from '../src/models/Account.js'
import {
  removeOrganizationMembershipsAndAssignFallback
} from '../src/services/adminOrganizationManagementService.js'
import {
  selectNextAvailableOrganizationId
} from '../src/services/organizationFallbackService.js'

test('selects the next active organization after the removed membership', () => {
  assert.equal(selectNextAvailableOrganizationId([
    { organization: 'org-a', isActive: true },
    { organization: 'org-b', isActive: true },
    { organization: 'org-c', isActive: true }
  ], 'org-b'), 'org-c')
})

test('wraps to the first active organization and skips inactive memberships', () => {
  assert.equal(selectNextAvailableOrganizationId([
    { organization: 'org-a', isActive: true },
    { organization: 'org-b', isActive: false },
    { organization: 'org-c', isActive: true }
  ], 'org-c'), 'org-a')
})

test('clears current organization when no active membership remains', () => {
  assert.equal(selectNextAvailableOrganizationId([
    { organization: 'org-a', isActive: true },
    { organization: 'org-b', isActive: false }
  ], 'org-a'), null)
})

test('membership removal assigns fallbacks only to accounts using the removed organization', async () => {
  const originalFind = Account.find
  const originalUpdateMany = Account.updateMany
  const originalBulkWrite = Account.bulkWrite
  const updateManyCalls = []
  let findQuery = null
  let bulkOperations = []

  Account.find = (query) => {
    findQuery = query
    return {
      select() { return this },
      async lean() {
        return [{
          _id: 'account-current',
          organizations: [
            { organization: 'org-removed', isActive: true },
            { organization: 'org-next', isActive: true }
          ]
        }]
      }
    }
  }
  Account.updateMany = async (...args) => { updateManyCalls.push(args) }
  Account.bulkWrite = async (operations) => { bulkOperations = operations }

  try {
    const assignments = await removeOrganizationMembershipsAndAssignFallback([
      'account-current',
      'account-other'
    ], 'org-removed')

    assert.deepEqual(assignments, [{
      accountId: 'account-current',
      currentOrganization: 'org-next'
    }])
    assert.deepEqual(findQuery._id.$in, ['account-current', 'account-other'])
    assert.deepEqual(updateManyCalls[0][0]._id.$in, ['account-other'])
    assert.equal(bulkOperations.length, 1)
    assert.equal(
      bulkOperations[0].updateOne.update.$set.currentOrganization,
      'org-next'
    )
    assert.deepEqual(
      bulkOperations[0].updateOne.update.$pull.organizations,
      { organization: 'org-removed' }
    )
  } finally {
    Account.find = originalFind
    Account.updateMany = originalUpdateMany
    Account.bulkWrite = originalBulkWrite
  }
})
