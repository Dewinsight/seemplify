import test from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'

import Subscription from '../models/Subscription.js'
import { Organization } from '../models/Organization.js'
import { subscriptionService } from '../services/subscriptionService.js'

const DAY_IN_MS = 24 * 60 * 60 * 1000

function buildSubscription(overrides = {}) {
  const subscription = new Subscription({
    organization: new mongoose.Types.ObjectId(),
    plan: new mongoose.Types.ObjectId(),
    billingCycle: 'monthly',
    priceAtPurchase: 0,
    currency: 'NGN',
    status: 'active',
    startDate: new Date(Date.now() - 60 * DAY_IN_MS),
    endDate: new Date(Date.now() + 10 * DAY_IN_MS),
    ...overrides
  })

  subscription.save = async () => subscription
  return subscription
}

test('extending an expired subscription renews it from today and restores active access', async () => {
  const subscription = buildSubscription({
    status: 'expired',
    endDate: new Date(Date.now() - 20 * DAY_IN_MS),
    gracePeriodEnd: new Date(Date.now() - 13 * DAY_IN_MS),
    accessRemovalEmailSent: true,
    renewalReminder7DaysSent: true
  })
  const beforeExtension = Date.now()

  await subscription.extend(30)

  assert.equal(subscription.status, 'active')
  assert.equal(subscription.accessRemovalEmailSent, false)
  assert.equal(subscription.renewalReminder7DaysSent, false)
  assert.ok(subscription.endDate.getTime() >= beforeExtension + 30 * DAY_IN_MS)
  assert.ok(subscription.endDate.getTime() <= Date.now() + 30 * DAY_IN_MS)
  assert.equal(
    subscription.gracePeriodEnd.getTime(),
    subscription.endDate.getTime() + 7 * DAY_IN_MS
  )
})

test('extending an active subscription preserves its remaining time', async () => {
  const originalEndDate = new Date(Date.now() + 10 * DAY_IN_MS)
  const subscription = buildSubscription({ endDate: originalEndDate })

  await subscription.extend(30)

  assert.equal(subscription.status, 'active')
  assert.equal(subscription.endDate.getTime(), originalEndDate.getTime() + 30 * DAY_IN_MS)
})

test('cancelled subscriptions cannot be renewed through the extension action', () => {
  const subscription = buildSubscription({ status: 'cancelled' })

  assert.throws(
    () => subscription.extend(30),
    /Cancelled subscriptions cannot be extended/
  )
})

test('reading a legacy future-dated expired subscription repairs status and organization cache', async () => {
  const originalFindActiveForOrg = Subscription.findActiveForOrg
  const originalFindOrganization = Organization.findById
  const subscription = {
    status: 'expired',
    endDate: new Date(Date.now() + 30 * DAY_IN_MS),
    accessRemovalEmailSent: true,
    saveCalls: 0,
    async save() {
      this.saveCalls += 1
      return this
    }
  }
  const organization = {
    cachedSubscription: null,
    async updateSubscriptionCache(value) {
      this.cachedSubscription = value
    }
  }

  Subscription.findActiveForOrg = async () => subscription
  Organization.findById = async () => organization

  try {
    const result = await subscriptionService.getSubscriptionForOrg('legacy-org')

    assert.equal(result, subscription)
    assert.equal(subscription.status, 'active')
    assert.equal(subscription.accessRemovalEmailSent, false)
    assert.equal(subscription.saveCalls, 1)
    assert.equal(organization.cachedSubscription, subscription)
  } finally {
    Subscription.findActiveForOrg = originalFindActiveForOrg
    Organization.findById = originalFindOrganization
  }
})
