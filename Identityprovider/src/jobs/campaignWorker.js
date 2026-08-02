import os from 'os'
import Campaign from '../models/Campaign.js'
import CampaignBatch from '../models/CampaignBatch.js'
import {
  claimNextDueBatch,
  processCampaignBatch
} from '../services/campaignOperationsService.js'
import { brevoMarketingService } from '../services/brevoMarketingService.js'

let workerInterval = null
let reconcileInterval = null
let started = false

function toNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function pickMetric(report = {}, keys = []) {
  for (const key of keys) {
    if (report?.[key] !== undefined && report?.[key] !== null) {
      return toNumber(report[key])
    }
    if (report?.statistics?.[key] !== undefined && report?.statistics?.[key] !== null) {
      return toNumber(report.statistics[key])
    }
  }
  return 0
}

async function reconcileCampaignReports() {
  if (!brevoMarketingService.isConfigured()) {
    return
  }

  const activeCampaigns = await Campaign.find({
    status: { $in: ['running', 'completed'] },
    launchedAt: {
      $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    }
  }).select('_id').lean()

  for (const campaign of activeCampaigns) {
    const batches = await CampaignBatch.find({
      campaign: campaign._id,
      'brevo.childCampaignId': { $exists: true, $ne: null }
    })

    for (const batch of batches) {
      try {
        const report = await brevoMarketingService.getCampaignReport(batch.brevo.childCampaignId)
        batch.brevo.reportSnapshot = report
        batch.metrics.delivered = pickMetric(report, ['delivered'])
        batch.metrics.opened = pickMetric(report, ['opened', 'uniqueViews'])
        batch.metrics.clicked = pickMetric(report, ['clickers', 'clicked'])
        batch.metrics.hardBounces = pickMetric(report, ['hardBounces', 'hardBounce'])
        batch.metrics.softBounces = pickMetric(report, ['softBounces', 'softBounce'])
        batch.metrics.unsubscribes = pickMetric(report, ['unsubscribed', 'unsubscribes'])
        batch.metrics.spam = pickMetric(report, ['complaints', 'spam'])
        await batch.save()
      } catch (error) {
        console.error(`Campaign report reconciliation failed for batch ${batch._id}:`, error.message)
      }
    }

    const freshBatches = await CampaignBatch.find({ campaign: campaign._id }).lean()
    const metrics = freshBatches.reduce((summary, batch) => {
      summary.sent += toNumber(batch?.metrics?.sent)
      summary.delivered += toNumber(batch?.metrics?.delivered)
      summary.opened += toNumber(batch?.metrics?.opened)
      summary.clicked += toNumber(batch?.metrics?.clicked)
      summary.hardBounces += toNumber(batch?.metrics?.hardBounces)
      summary.softBounces += toNumber(batch?.metrics?.softBounces)
      summary.unsubscribes += toNumber(batch?.metrics?.unsubscribes)
      summary.spam += toNumber(batch?.metrics?.spam)
      return summary
    }, {
      sent: 0,
      delivered: 0,
      opened: 0,
      clicked: 0,
      hardBounces: 0,
      softBounces: 0,
      unsubscribes: 0,
      spam: 0
    })

    await Campaign.updateOne({ _id: campaign._id }, {
      $set: {
        'metrics.sent': metrics.sent,
        'metrics.delivered': metrics.delivered,
        'metrics.opened': metrics.opened,
        'metrics.clicked': metrics.clicked,
        'metrics.hardBounces': metrics.hardBounces,
        'metrics.softBounces': metrics.softBounces,
        'metrics.unsubscribes': metrics.unsubscribes,
        'metrics.spam': metrics.spam,
        lastReconciledAt: new Date()
      }
    })
  }
}

async function processDueBatches(workerId) {
  let batch = await claimNextDueBatch(workerId)
  while (batch) {
    try {
      await processCampaignBatch(batch._id)
    } catch (error) {
      console.error(`Campaign batch processing failed for ${batch._id}:`, error)
      await CampaignBatch.updateOne({ _id: batch._id }, {
        $set: {
          status: 'failed',
          'error.message': error.message || 'Failed to process campaign batch.',
          'error.lastFailedAt': new Date()
        }
      })
    }
    batch = await claimNextDueBatch(workerId)
  }
}

export function startCampaignWorker() {
  if (started) {
    return
  }

  started = true
  const pollSeconds = Math.max(10, Number(process.env.CAMPAIGN_WORKER_POLL_SECONDS || 60))
  const workerId = `${os.hostname()}:${process.pid}`

  workerInterval = setInterval(() => {
    processDueBatches(workerId).catch((error) => {
      console.error('Campaign worker loop failed:', error)
    })
  }, pollSeconds * 1000)

  reconcileInterval = setInterval(() => {
    reconcileCampaignReports().catch((error) => {
      console.error('Campaign reconciliation failed:', error)
    })
  }, 15 * 60 * 1000)

  processDueBatches(workerId).catch((error) => {
    console.error('Initial campaign worker run failed:', error)
  })
  reconcileCampaignReports().catch((error) => {
    console.error('Initial campaign reconciliation failed:', error)
  })
}

export function stopCampaignWorker() {
  if (workerInterval) {
    clearInterval(workerInterval)
    workerInterval = null
  }

  if (reconcileInterval) {
    clearInterval(reconcileInterval)
    reconcileInterval = null
  }

  started = false
}
