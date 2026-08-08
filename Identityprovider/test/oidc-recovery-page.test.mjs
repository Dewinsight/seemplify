import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeReason, renderOidcRecoveryPage } from '../src/services/oidcRecoveryPage.js'

test('expired authorization requests get an app-aware retry path without raw protocol details', () => {
  const page = renderOidcRecoveryPage({
    error: 'invalid_request',
    description: 'authorization request has expired; iss: https://auth.example.com',
    appId: 'time-attendance',
    appName: 'Time & Attendance',
    requestId: 'request-123'
  })

  assert.match(page.html, /This sign-in request has expired/)
  assert.match(page.html, /href="\/launch\/time-attendance"/)
  assert.match(page.html, /Return to workspace/)
  assert.match(page.html, /request-123/)
  assert.doesNotMatch(page.html, /authorization request has expired; iss/)
})

test('unknown app identifiers cannot become retry links', () => {
  const page = renderOidcRecoveryPage({
    error: 'server_error',
    description: 'temporarily unavailable',
    appId: '../admin',
    requestId: '<unsafe>'
  })

  assert.match(page.html, /href="\/"/)
  assert.doesNotMatch(page.html, /launch\/\.\./)
  assert.match(page.html, /&lt;unsafe&gt;/)
})

test('unavailable identity service is described as recoverable', () => {
  assert.equal(normalizeReason('server_error', 'IDP unavailable').title, 'Sign-in is temporarily unavailable')
})
