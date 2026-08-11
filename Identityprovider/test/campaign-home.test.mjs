import assert from 'node:assert/strict'
import test from 'node:test'

import { loadCampaignHomeData } from '../src/services/campaignHomeService.js'

test('campaign home only loads recent campaign summaries', async () => {
  const campaigns = [
    { _id: '1', status: 'draft' },
    { _id: '2', status: 'running' },
    { _id: '3', status: 'completed' },
    { _id: '4', status: 'paused' },
    { _id: '5', status: 'ready' },
    { _id: '6', status: 'scheduled' },
    { _id: '7', status: 'failed' }
  ]
  const requestedLimits = []

  const result = await loadCampaignHomeData(async (limit) => {
    requestedLimits.push(limit)
    return campaigns
  })

  assert.deepEqual(requestedLimits, [12])
  assert.deepEqual(result.recentCampaigns, campaigns.slice(0, 6))
  assert.equal(result.stats.total, 7)
  assert.equal(result.stats.draft, 1)
  assert.equal(result.stats.running, 1)
  assert.equal(result.stats.completed, 1)
  assert.equal(result.stats.paused, 1)
  assert.equal(result.stats.ready, 1)
  assert.equal(result.stats.scheduled, 1)
  assert.equal(result.stats.failed, 1)
})
