import assert from 'node:assert/strict'
import test from 'node:test'

import { buildInternalLoginRedirect } from '../src/utils/authRedirects.js'
import { buildRecruiterLaunchUrl, isLegacyIdpOnboardingUiPath } from '../src/utils/legacyUiRedirects.js'

test('retires legacy IDP onboarding and document-management pages', () => {
  const retiredPaths = [
    '/documents',
    '/documents/',
    '/documents/my',
    '/documents/workspace',
    '/profile/documents',
    '/onboarding',
    '/organizations/organization-id/onboarding',
    '/organizations/organization-id/onboarding/assignments/assignment-id'
  ]

  for (const pathname of retiredPaths) {
    assert.equal(isLegacyIdpOnboardingUiPath(pathname), true, pathname)
  }
})

test('preserves compatibility APIs and historical document file access', () => {
  const preservedPaths = [
    '/api/onboarding/assignment-id/items/item-id/form',
    '/api/organizations/organization-id/onboarding/assign',
    '/onboarding/assignments/assignment-id/items/item-id/document',
    '/onboarding/assignments/assignment-id/items/item-id/document/file',
    '/onboarding/assignments/assignment-id/items/item-id/document/download',
    '/profile/personal',
    '/launch/smarthr'
  ]

  for (const pathname of preservedPaths) {
    assert.equal(isLegacyIdpOnboardingUiPath(pathname), false, pathname)
  }
})

test('legacy assignment emails launch Recruiter through the IDP', () => {
  assert.equal(
    buildRecruiterLaunchUrl('https://auth.seemplifyai.com'),
    'https://auth.seemplifyai.com/launch/smarthr'
  )
  assert.equal(
    buildRecruiterLaunchUrl('not-a-url'),
    'https://auth.seemplifyai.com/launch/smarthr'
  )
  assert.equal(
    buildInternalLoginRedirect('/launch/smarthr'),
    '/login?return_to=%2Flaunch%2Fsmarthr'
  )
})
