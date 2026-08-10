import assert from 'node:assert/strict'
import test from 'node:test'

import { claimsCacheEnabled } from '../src/utils/claimsCachePolicy.js'

test('process-local claims cache fails closed in production multi-replica deployments', () => {
  assert.equal(claimsCacheEnabled({ NODE_ENV: 'production' }), false)
  assert.equal(claimsCacheEnabled({ NODE_ENV: 'development' }), true)
})

test('production cannot opt back into a process-local authorization cache', () => {
  assert.equal(claimsCacheEnabled({ NODE_ENV: 'production', IDP_CLAIMS_CACHE_ENABLED: 'true' }), false)
  assert.equal(claimsCacheEnabled({ NODE_ENV: 'development', IDP_CLAIMS_CACHE_ENABLED: 'false' }), false)
})
