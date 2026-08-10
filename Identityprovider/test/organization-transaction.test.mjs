import assert from 'node:assert/strict'
import test from 'node:test'
import mongoose from 'mongoose'

import { Account } from '../src/models/Account.js'
import { Organization } from '../src/models/Organization.js'

function organizationWithMember() {
  const ownerId = new mongoose.Types.ObjectId()
  const memberId = new mongoose.Types.ObjectId()
  const organization = new Organization({
    name: 'Transactional organization',
    owner: ownerId,
    members: [
      { account: ownerId, role: 'owner', status: 'active' },
      { account: memberId, role: 'recruiter', status: 'active' }
    ]
  })
  return { organization, ownerId, memberId }
}

test('app-access and member removal propagate the transaction session to both documents', async () => {
  const session = { id: 'mongo-session-a' }
  const originalUpdateOne = Account.updateOne
  const accountSessions = []
  Account.updateOne = async (_query, _update, options) => {
    accountSessions.push(options?.session)
    return { acknowledged: true }
  }

  try {
    const first = organizationWithMember()
    const organizationSessions = []
    first.organization.save = async options => {
      organizationSessions.push(options?.session)
      return first.organization
    }
    await first.organization.updateMemberDetails(
      first.memberId,
      { appAccess: { mode: 'selected', appIds: ['performance-management'] } },
      first.ownerId,
      { session }
    )

    const second = organizationWithMember()
    second.organization.save = async options => {
      organizationSessions.push(options?.session)
      return second.organization
    }
    await second.organization.removeMember(second.memberId, { session })

    assert.deepEqual(organizationSessions, [session, session])
    assert.deepEqual(accountSessions, [session, session, session])
  } finally {
    Account.updateOne = originalUpdateOne
  }
})
