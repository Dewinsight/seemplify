import assert from 'node:assert/strict'
import test from 'node:test'
import { AccessControlPolicy } from '../src/models/AccessControlPolicy.js'
import { Account } from '../src/models/Account.js'
import { ACCESS_CONTROL_SCHEMA_VERSION, DEFAULT_ACCESS_ROLES } from '../src/config/accessControlCatalog.js'
import { getOrCreateGlobalAccessPolicy } from '../src/services/accessControlService.js'

// Deterministic model-boundary race tests: real Mongo persistence is exercised
// separately in the programme integration evidence. No live database is used.
test('concurrent schema migration reloads winner instead of exposing VersionError', async (t) => {
  let reads = 0, saves = 0, invalidations = 0
  const winner = { schemaVersion: ACCESS_CONTROL_SCHEMA_VERSION, revision: 8, roles: DEFAULT_ACCESS_ROLES }
  const stale = () => ({ schemaVersion: ACCESS_CONTROL_SCHEMA_VERSION - 1, revision: 7, roles: [], async save() {
    saves += 1
    if (saves === 1) return this
    const error = new Error('No matching document version')
    error.name = 'VersionError'
    throw error
  } })
  t.mock.method(AccessControlPolicy, 'findOne', async () => ++reads <= 2 ? stale() : winner)
  t.mock.method(Account, 'updateMany', async () => { invalidations += 1; return { modifiedCount: 1 } })
  const results = await Promise.all([getOrCreateGlobalAccessPolicy(), getOrCreateGlobalAccessPolicy()])
  assert.equal(results.length, 2)
  assert.ok(results.every(value => value.schemaVersion === ACCESS_CONTROL_SCHEMA_VERSION))
  assert.equal(invalidations, 1)
  assert.equal(saves, 2)
  assert.equal(reads, 3)
})

test('migration conflict reload preserves the concurrently changed custom role', async (t) => {
  const custom = { key: 'custom_assessor', name: 'Concurrent custom assessor', description: '', grants: [{ appId: 'performance-management', permissions: ['competency.assessment.edit'] }], denies: [], locked: false }
  let reads = 0, saves = 0
  const fresh = { schemaVersion: ACCESS_CONTROL_SCHEMA_VERSION - 1, revision: 15, roles: [...DEFAULT_ACCESS_ROLES, custom], async save() { saves += 1; return this } }
  t.mock.method(AccessControlPolicy, 'findOne', async () => ++reads === 1 ? { schemaVersion: ACCESS_CONTROL_SCHEMA_VERSION - 1, revision: 14, roles: DEFAULT_ACCESS_ROLES, async save() { const error = new Error('Concurrent role edit'); error.name = 'VersionError'; throw error } } : fresh)
  t.mock.method(Account, 'updateMany', async () => ({ modifiedCount: 1 }))
  const result = await getOrCreateGlobalAccessPolicy()
  assert.equal(result.revision, 16)
  assert.equal(result.schemaVersion, ACCESS_CONTROL_SCHEMA_VERSION)
  assert.deepEqual(result.roles.find(role => role.key === custom.key).grants, custom.grants)
  assert.equal(saves, 1)
})

test('initial creation duplicate reloads the existing policy', async (t) => {
  let reads = 0
  const persisted = { schemaVersion: ACCESS_CONTROL_SCHEMA_VERSION, revision: 1, roles: DEFAULT_ACCESS_ROLES }
  t.mock.method(AccessControlPolicy, 'findOne', async () => ++reads === 1 ? null : persisted)
  t.mock.method(AccessControlPolicy, 'create', async () => { const error = new Error('Duplicate global policy'); error.code = 11000; throw error })
  assert.equal(await getOrCreateGlobalAccessPolicy(), persisted)
})

test('non-concurrency persistence failures are not hidden or retried', async (t) => {
  const failure = new Error('Storage unavailable')
  let saves = 0
  t.mock.method(AccessControlPolicy, 'findOne', async () => ({ schemaVersion: ACCESS_CONTROL_SCHEMA_VERSION - 1, revision: 1, roles: [], async save() { saves += 1; throw failure } }))
  await assert.rejects(getOrCreateGlobalAccessPolicy(), error => error === failure)
  assert.equal(saves, 1)
})

test('repeated migration contention fails boundedly without stale policy writes', async (t) => {
  let saves = 0
  t.mock.method(AccessControlPolicy, 'findOne', async () => ({ schemaVersion: ACCESS_CONTROL_SCHEMA_VERSION - 1, revision: 1, roles: [], async save() { saves += 1; const error = new Error('Concurrent edit'); error.name = 'VersionError'; throw error } }))
  await assert.rejects(getOrCreateGlobalAccessPolicy(), error => error.code === 'POLICY_MIGRATION_BUSY' && error.statusCode === 503)
  assert.equal(saves, 8)
})
