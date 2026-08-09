import assert from 'node:assert/strict'
import test from 'node:test'

import { Account } from '../src/models/Account.js'
import {
  DEFAULT_HUB_PINNED_APP_IDS,
  EXTERNAL_HUB_PINNED_APP_IDS,
  MAX_HUB_PINNED_APP_IDS,
  buildKnownHubPinAppIdSet,
  getHubPinPreference,
  resolveHubPinnedAppIds,
  sanitizeHubPinnedAppIds,
  validateHubPinsPayload
} from '../src/utils/hubPins.js'

const knownAppIds = buildKnownHubPinAppIdSet([
  { appId: 'smarthr' },
  { appId: 'leave-management' },
  { appId: 'payroll-management' }
])

test('known pin targets include the external experience app', () => {
  assert.equal(knownAppIds.has('experience-management'), true)
  assert.deepEqual(EXTERNAL_HUB_PINNED_APP_IDS, ['experience-management'])
})

test('sanitizes duplicates, unknown apps, non-strings, and unavailable apps', () => {
  assert.deepEqual(
    sanitizeHubPinnedAppIds([
      ' payroll-management ',
      'unknown-app',
      'smarthr',
      'smarthr',
      null,
      'experience-management'
    ], {
      knownAppIds,
      visibleAppIds: ['smarthr', 'experience-management']
    }),
    ['smarthr', 'experience-management']
  )
})

test('uses visible defaults only when the organization has no saved preference', () => {
  const account = {
    hubPreferences: {
      pinnedAppsByOrganization: new Map()
    }
  }

  assert.deepEqual(
    resolveHubPinnedAppIds({
      account,
      organizationId: 'org-a',
      knownAppIds,
      visibleAppIds: ['leave-management', 'payroll-management']
    }),
    ['leave-management']
  )
  assert.deepEqual(DEFAULT_HUB_PINNED_APP_IDS, ['smarthr', 'leave-management'])
})

test('an intentionally empty organization preference suppresses defaults', () => {
  const account = {
    hubPreferences: {
      pinnedAppsByOrganization: new Map([
        ['org-a', { pinnedAppIds: [] }]
      ])
    }
  }

  assert.deepEqual(getHubPinPreference(account, 'org-a'), {
    exists: true,
    pinnedAppIds: []
  })
  assert.deepEqual(
    resolveHubPinnedAppIds({
      account,
      organizationId: 'org-a',
      knownAppIds,
      visibleAppIds: ['smarthr', 'leave-management']
    }),
    []
  )
})

test('account schema stores an explicitly empty preference for one organization', () => {
  const organizationId = '507f1f77bcf86cd799439011'
  const account = new Account({
    sub: 'hub-pin-schema-test',
    email: 'hub-pin-schema-test@example.com'
  })

  account.hubPreferences.pinnedAppsByOrganization.set(organizationId, {
    pinnedAppIds: [],
    updatedAt: new Date('2026-08-09T00:00:00.000Z')
  })

  assert.equal(account.validateSync(), undefined)
  assert.deepEqual(getHubPinPreference(account, organizationId), {
    exists: true,
    pinnedAppIds: []
  })
})

test('organization preferences remain isolated and support plain persisted objects', () => {
  const account = {
    hubPreferences: {
      pinnedAppsByOrganization: {
        'org-a': { pinnedAppIds: ['smarthr'] },
        'org-b': { pinnedAppIds: ['payroll-management'] }
      }
    }
  }

  assert.deepEqual(
    resolveHubPinnedAppIds({
      account,
      organizationId: 'org-a',
      knownAppIds,
      visibleAppIds: [...knownAppIds]
    }),
    ['smarthr']
  )
  assert.deepEqual(
    resolveHubPinnedAppIds({
      account,
      organizationId: 'org-b',
      knownAppIds,
      visibleAppIds: [...knownAppIds]
    }),
    ['payroll-management']
  )
})

test('rejects malformed and oversized pin payloads', () => {
  assert.equal(validateHubPinsPayload({}).valid, false)
  assert.equal(validateHubPinsPayload({ pinnedAppIds: ['smarthr', 7] }).valid, false)
  assert.equal(
    validateHubPinsPayload({
      pinnedAppIds: Array.from({ length: MAX_HUB_PINNED_APP_IDS + 1 }, (_, index) => `app-${index}`)
    }).valid,
    false
  )
  assert.deepEqual(validateHubPinsPayload({ pinnedAppIds: [] }), {
    valid: true,
    pinnedAppIds: []
  })
})
