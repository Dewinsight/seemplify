import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const routeSource = fs.readFileSync(new URL('../src/routes/internalMemberships.js', import.meta.url), 'utf8')

test('a new membership operation is not rejected as an idempotency conflict', () => {
  assert.match(
    routeSource,
    /if \(record && \(record\.requestHash !== hash \|\| record\.operation !== operation\)\)/
  )
  assert.doesNotMatch(routeSource, /if \(record\?\.requestHash !== hash/)
})

test('membership mutations immediately invalidate authorization claims', () => {
  assert.match(routeSource, /import \{ invalidateClaimsCache \} from '\.\.\/index\.js'/)
  assert.equal((routeSource.match(/invalidateClaimsCache\(account\.sub\)/g) || []).length, 4)
})
