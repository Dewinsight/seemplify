import test from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeInternalReturnTo,
  renderInternalReturnToInput,
  serializeForInlineScript
} from '../src/utils/authRedirects.js'

test('preserves legitimate internal invitation routes', () => {
  assert.equal(
    normalizeInternalReturnTo('/invitations/accept/confirm?token=abc123#details'),
    '/invitations/accept/confirm?token=abc123#details'
  )
})

test('rejects absolute and protocol-relative redirect destinations', () => {
  const rejected = [
    'https://attacker.example/path',
    '//attacker.example/path',
    '/\\attacker.example/path',
    '/%5Cattacker.example/path',
    '/%2Fattacker.example/path',
    '/%252Fattacker.example/path',
    'javascript:alert(1)',
    'not-a-path'
  ]

  for (const value of rejected) {
    assert.equal(normalizeInternalReturnTo(value), '', value)
  }
})

test('rejects malformed encoding and control characters', () => {
  assert.equal(normalizeInternalReturnTo('/broken/%E0%A4%A'), '')
  assert.equal(normalizeInternalReturnTo('/safe\nLocation: https://attacker.example'), '')
})

test('renders only an escaped hidden input for a validated internal path', () => {
  assert.equal(
    renderInternalReturnToInput('/invitations/accept?token=one&mode=two'),
    '<input type="hidden" name="return_to" value="/invitations/accept?token=one&amp;mode=two" />'
  )
  assert.equal(renderInternalReturnToInput('//attacker.example/path'), '')
})

test('serializes route values without allowing an inline script breakout', () => {
  const serialized = serializeForInlineScript('</script><script>alert(1)</script>\u2028next')

  assert.equal(serialized.includes('</script>'), false)
  assert.equal(serialized.includes('\\u003c/script\\u003e'), true)
  assert.equal(serialized.includes('\\u2028'), true)
})
