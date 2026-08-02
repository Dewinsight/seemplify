import Campaign from '../models/Campaign.js'
import CampaignBatch from '../models/CampaignBatch.js'
import CampaignRecipient from '../models/CampaignRecipient.js'
import MarketingVisit from '../models/MarketingVisit.js'

export async function resolveVisitorTouches({ visitorId, fallbackTouch }) {
  if (!visitorId) {
    return {
      firstTouch: fallbackTouch,
      lastTouch: fallbackTouch
    }
  }

  const [firstVisit, lastVisit] = await Promise.all([
    MarketingVisit.findOne({ visitorId }).sort({ occurredAt: 1 }).lean(),
    MarketingVisit.findOne({ visitorId }).sort({ occurredAt: -1 }).lean()
  ])

  return {
    firstTouch: firstVisit?.attribution || fallbackTouch,
    lastTouch: lastVisit?.attribution || fallbackTouch
  }
}

export async function registerCampaignConversion({
  conversionType,
  campaignId,
  recipientId,
  email,
  visitorId,
  occurredAt = new Date(),
  accountId = null,
  demoRequestId = null
} = {}) {
  if (!campaignId && !recipientId) {
    return null
  }

  let recipient = null
  if (recipientId) {
    recipient = await CampaignRecipient.findById(recipientId)
  }

  if (!recipient && campaignId && email) {
    recipient = await CampaignRecipient.findOne({
      campaign: campaignId,
      normalizedEmail: String(email || '').trim().toLowerCase()
    })
  }

  if (!recipient) {
    return null
  }

  const existingType = String(recipient?.conversion?.type || '').trim()
  const shouldIncrementMetrics = existingType !== conversionType || !recipient?.conversion?.convertedAt

  const conversion = {
    type: conversionType,
    visitorId: String(visitorId || '').trim(),
    convertedAt: occurredAt
  }

  if (accountId) {
    conversion.accountId = accountId
  }

  if (demoRequestId) {
    conversion.demoRequestId = demoRequestId
  }

  await CampaignRecipient.updateOne(
    { _id: recipient._id },
    {
      $set: {
        conversion,
        lastEventAt: occurredAt
      }
    }
  )

  if (!shouldIncrementMetrics) {
    return recipient
  }

  const campaignInc = {
    'metrics.conversions': 1
  }
  const batchInc = {
    'metrics.conversions': 1
  }

  if (conversionType === 'signup') {
    campaignInc['metrics.signups'] = 1
    batchInc['metrics.signups'] = 1
  } else if (conversionType === 'demo_request') {
    campaignInc['metrics.demoRequests'] = 1
    batchInc['metrics.demoRequests'] = 1
  }

  await Campaign.updateOne(
    { _id: recipient.campaign },
    {
      $inc: campaignInc,
      $set: {
        lastBrevoSyncAt: occurredAt
      }
    }
  )

  if (recipient.batch) {
    await CampaignBatch.updateOne(
      { _id: recipient.batch },
      {
        $inc: batchInc
      }
    )
  }

  return recipient
}
