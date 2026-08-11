import mongoose from 'mongoose'
import Campaign from '../models/Campaign.js'
import CampaignBatch from '../models/CampaignBatch.js'
import CampaignEvent from '../models/CampaignEvent.js'
import CampaignRecipient from '../models/CampaignRecipient.js'
import MarketingVisit from '../models/MarketingVisit.js'

function toObjectId(value) {
  if (!value) return null
  if (value instanceof mongoose.Types.ObjectId) return value
  return mongoose.Types.ObjectId.isValid(String(value)) ? new mongoose.Types.ObjectId(String(value)) : null
}

function buildStatusTimeline(recipient, events) {
  return [
    recipient.sentAt ? { label: 'Sent', at: recipient.sentAt } : null,
    recipient.deliveredAt ? { label: 'Delivered', at: recipient.deliveredAt } : null,
    recipient.openedAt ? { label: 'Opened', at: recipient.openedAt } : null,
    recipient.clickedAt ? { label: 'Clicked', at: recipient.clickedAt } : null,
    recipient.bouncedAt ? { label: 'Bounced', at: recipient.bouncedAt } : null,
    recipient.unsubscribedAt ? { label: 'Unsubscribed', at: recipient.unsubscribedAt } : null,
    ...events.map((event) => ({
      label: event.eventType,
      at: event.eventTime,
      url: event.linkUrl || '',
      reason: event.reason || ''
    }))
  ].filter(Boolean).sort((left, right) => new Date(left.at) - new Date(right.at))
}

export async function getCampaignConsoleSummary(limit = 20) {
  const campaigns = await Campaign.find()
    .sort({ updatedAt: -1 })
    .limit(limit)
    .populate('audience', 'name')
    .populate('createdBy', 'email profile.name')
    .lean()

  return campaigns
}

export async function getCampaignHomeSummary(limit = 12) {
  return Campaign.find()
    .sort({ updatedAt: -1 })
    .limit(limit)
    .select('name status sender.email sender.name sender.readinessBand audience updatedAt')
    .populate('audience', 'name')
    .lean()
}

export async function getCampaignAnalytics(campaignId) {
  const objectId = toObjectId(campaignId)
  if (!objectId) return null

  const [campaign, batches, topEvents, recipients, visits] = await Promise.all([
    Campaign.findById(objectId)
      .populate('audience', 'name importSummary')
      .populate('createdBy', 'email profile.name')
      .lean(),
    CampaignBatch.find({ campaign: objectId })
      .sort({ sequence: 1 })
      .lean(),
    CampaignEvent.aggregate([
      { $match: { campaign: objectId, eventType: 'click', linkUrl: { $type: 'string', $ne: '' } } },
      {
        $group: {
          _id: '$linkUrl',
          uniqueClicks: { $sum: 1 },
          lastClickedAt: { $max: '$eventTime' }
        }
      },
      { $sort: { uniqueClicks: -1, lastClickedAt: -1 } },
      { $limit: 10 }
    ]),
    CampaignRecipient.find({ campaign: objectId })
      .sort({ updatedAt: -1 })
      .limit(100)
      .lean(),
    MarketingVisit.find({ 'attribution.campaignId': objectId })
      .sort({ occurredAt: -1 })
      .limit(100)
      .lean()
  ])

  if (!campaign) {
    return null
  }

  return {
    campaign,
    batches,
    topLinks: topEvents.map((event) => ({
      url: event._id,
      uniqueClicks: event.uniqueClicks,
      lastClickedAt: event.lastClickedAt
    })),
    recipients,
    visits
  }
}

export async function getRecipientAnalytics(campaignId, recipientId) {
  const campaignObjectId = toObjectId(campaignId)
  const recipientObjectId = toObjectId(recipientId)
  if (!campaignObjectId || !recipientObjectId) return null

  const [recipient, events, visits] = await Promise.all([
    CampaignRecipient.findOne({
      _id: recipientObjectId,
      campaign: campaignObjectId
    }).lean(),
    CampaignEvent.find({
      campaign: campaignObjectId,
      recipient: recipientObjectId
    }).sort({ eventTime: 1 }).lean(),
    MarketingVisit.find({
      'attribution.campaignId': campaignObjectId,
      'attribution.recipientId': recipientObjectId
    }).sort({ occurredAt: -1 }).lean()
  ])

  if (!recipient) {
    return null
  }

  return {
    recipient,
    events,
    visits,
    timeline: buildStatusTimeline(recipient, events)
  }
}
