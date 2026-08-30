import test from 'node:test'
import assert from 'node:assert/strict'

import { getAllHubApps } from '../src/config/hubApps.js'
import Plan from '../src/models/Plan.js'
import {
  PLAN_FEATURES,
  createEmptyPlanFeatures,
  getPlanFeatureKeyForApp
} from '../src/config/planFeatures.js'

test('every registered hub app has a plan feature', () => {
  const unmappedApps = getAllHubApps()
    .filter(app => !getPlanFeatureKeyForApp(app.appId))
    .map(app => app.appId)

  assert.deepEqual(unmappedApps, [])
})

test('newly added hub apps have independent access controls', () => {
  assert.equal(getPlanFeatureKeyForApp('messaging'), 'workspace')
  assert.equal(getPlanFeatureKeyForApp('automation-hub'), 'workspace')
  assert.equal(getPlanFeatureKeyForApp('experience-management'), 'experienceManagement')
  assert.equal(getPlanFeatureKeyForApp('approver'), 'approver')
})

test('empty plan features include every admin feature key', () => {
  assert.deepEqual(
    Object.keys(createEmptyPlanFeatures()),
    PLAN_FEATURES.map(feature => feature.key)
  )
  assert.ok(Object.values(createEmptyPlanFeatures()).every(value => value === false))
})

test('existing plans retain access to apps that previously bypassed plan gating', () => {
  const plan = new Plan({ name: 'Legacy plan', slug: 'legacy-plan' })

  assert.equal(plan.features.workspace, true)
  assert.equal(plan.features.experienceManagement, true)
  assert.equal(plan.features.approver, true)
})
