import assert from 'node:assert/strict'
import test from 'node:test'
import {
  accountCanSynchronizeLearning,
  isPerformanceLearningSyncConfigured
} from '../src/services/performanceLearningSyncService.js'

test('only Seemplify-linked accounts are eligible for Performance Learning sync', () => {
  assert.equal(accountCanSynchronizeLearning({
    idpSubject: 'idp-account-1',
    authentication: { seemplifyEnabled: true }
  }), true)
  assert.equal(accountCanSynchronizeLearning({
    authentication: { seemplifyEnabled: false }
  }), false)
  assert.equal(accountCanSynchronizeLearning({
    idpSubject: 'idp-account-1',
    authentication: { seemplifyEnabled: false }
  }), false)
})

test('Performance Learning delivery fails closed unless URL and secret are configured', () => {
  const originalUrl = process.env.PERFORMANCE_MANAGEMENT_URL
  const originalSecret = process.env.PERFORMANCE_MANAGEMENT_WEBHOOK_SECRET
  delete process.env.PERFORMANCE_MANAGEMENT_URL
  delete process.env.PERFORMANCE_MANAGEMENT_WEBHOOK_SECRET
  assert.equal(isPerformanceLearningSyncConfigured(), false)
  process.env.PERFORMANCE_MANAGEMENT_URL = 'https://api-performance.seemplifyai.com'
  assert.equal(isPerformanceLearningSyncConfigured(), false)
  process.env.PERFORMANCE_MANAGEMENT_WEBHOOK_SECRET = 'test-secret'
  assert.equal(isPerformanceLearningSyncConfigured(), true)
  if (originalUrl === undefined) delete process.env.PERFORMANCE_MANAGEMENT_URL
  else process.env.PERFORMANCE_MANAGEMENT_URL = originalUrl
  if (originalSecret === undefined) delete process.env.PERFORMANCE_MANAGEMENT_WEBHOOK_SECRET
  else process.env.PERFORMANCE_MANAGEMENT_WEBHOOK_SECRET = originalSecret
})
