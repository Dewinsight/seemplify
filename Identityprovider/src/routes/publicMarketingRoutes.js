import crypto from 'crypto'
import express from 'express'
import Campaign from '../models/Campaign.js'
import CampaignBatch from '../models/CampaignBatch.js'
import CampaignEvent from '../models/CampaignEvent.js'
import CampaignRecipient from '../models/CampaignRecipient.js'
import CampaignSuppression from '../models/CampaignSuppression.js'
import MarketingVisit from '../models/MarketingVisit.js'
import { buildAttributionTouch, resolveRequestAttribution } from '../services/campaignAttributionService.js'

const router = express.Router()
const MARKETING_SITE_URL = String(process.env.MARKETING_SITE_URL || 'https://seemplifyai.com').trim()

function applyCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', MARKETING_SITE_URL)
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-seemplify-visitor-id, x-seemplify-session-id')
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, POST')
}

function normalizeEventType(eventName = '') {
  const normalized = String(eventName || '').trim().toLowerCase()
  if (normalized === 'click') return 'click'
  if (normalized === 'opened') return 'opened'
  if (normalized === 'proxy_open' || normalized === 'proxyopen') return 'proxy_open'
  if (normalized === 'delivered') return 'delivered'
  if (normalized === 'hardbounce' || normalized === 'hard_bounce') return 'hardBounce'
  if (normalized === 'softbounce' || normalized === 'soft_bounce') return 'softBounce'
  if (normalized === 'unsubscribed' || normalized === 'unsubscribe') return 'unsubscribed'
  if (normalized === 'spam' || normalized === 'complaint') return 'spam'
  return ''
}

function buildFingerprint(payload = {}) {
  return crypto
    .createHash('sha1')
    .update(JSON.stringify(payload))
    .digest('hex')
}

async function applyWebhookEventToModels({
  campaign,
  batch,
  recipient,
  eventType,
  eventTime,
  linkUrl,
  reason
}) {
  const recipientUpdate = {
    $set: {
      lastEventAt: eventTime
    },
    $inc: {}
  }

  const metricKey = eventType === 'click'
    ? 'clicked'
    : eventType === 'opened'
      ? 'opened'
      : eventType === 'proxy_open'
        ? 'proxyOpens'
        : eventType === 'delivered'
          ? 'delivered'
          : eventType === 'hardBounce'
            ? 'hardBounces'
            : eventType === 'softBounce'
              ? 'softBounces'
              : eventType === 'unsubscribed'
                ? 'unsubscribes'
                : eventType === 'spam'
                  ? 'spam'
                  : ''

  if (metricKey) {
    recipientUpdate.$inc[`eventCounts.${metricKey}`] = 1
  }

  if (eventType === 'click') {
    recipientUpdate.$set.status = 'clicked'
    recipientUpdate.$set.clickedAt = eventTime
    recipientUpdate.$set.lastClickedUrl = linkUrl || ''
  } else if (eventType === 'opened' || eventType === 'proxy_open') {
    recipientUpdate.$set.status = 'opened'
    recipientUpdate.$set.openedAt = eventTime
  } else if (eventType === 'delivered') {
    recipientUpdate.$set.status = recipient?.status === 'clicked' || recipient?.status === 'opened' ? recipient.status : 'delivered'
    recipientUpdate.$set.deliveredAt = eventTime
  } else if (eventType === 'hardBounce' || eventType === 'softBounce') {
    recipientUpdate.$set.status = 'bounced'
    recipientUpdate.$set.bouncedAt = eventTime
  } else if (eventType === 'unsubscribed') {
    recipientUpdate.$set.status = 'unsubscribed'
    recipientUpdate.$set.unsubscribedAt = eventTime
  } else if (eventType === 'spam') {
    recipientUpdate.$set.status = 'complained'
    recipientUpdate.$set.complainedAt = eventTime
  }

  await CampaignRecipient.updateOne({ _id: recipient._id }, recipientUpdate)

  const campaignInc = {}
  const batchInc = {}
  if (metricKey) {
    campaignInc[`metrics.${metricKey}`] = 1
    batchInc[`metrics.${metricKey}`] = 1
  }

  if (Object.keys(campaignInc).length > 0) {
    await Campaign.updateOne({ _id: campaign._id }, {
      $inc: campaignInc,
      $set: { lastBrevoSyncAt: eventTime }
    })
    await CampaignBatch.updateOne({ _id: batch._id }, {
      $inc: batchInc
    })
  }
}

router.use((req, res, next) => {
  applyCors(req, res)
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204)
  }
  next()
})

router.post('/marketing/visit', async (req, res) => {
  try {
    const resolved = await resolveRequestAttribution(req, req.body || {})
    const touch = buildAttributionTouch({
      sourceType: resolved.verifiedToken ? 'campaign_click' : 'website_visit',
      source: String(req.body?.source || req.body?.sourceApp || 'marketing-site'),
      channel: req.body?.channel || 'web',
      campaignId: resolved.verifiedToken?.campaignId || null,
      batchId: resolved.verifiedToken?.batchId || null,
      recipientId: resolved.verifiedToken?.recipientId || null,
      campaignName: resolved.verifiedToken?.campaignName || '',
      signedToken: resolved.signedToken,
      visitorId: resolved.visitorId,
      sessionId: resolved.sessionId,
      email: resolved.verifiedToken?.email || '',
      landingPage: String(req.body?.pageUrl || req.body?.landingPage || ''),
      referrer: String(req.body?.referrer || req.headers.referer || ''),
      utm: resolved.utm,
      metadata: {
        pathname: req.body?.path || '',
        eventLabel: req.body?.eventLabel || ''
      },
      occurredAt: new Date()
    })

    const visit = await MarketingVisit.create({
      visitorId: resolved.visitorId,
      sessionId: resolved.sessionId,
      eventType: req.body?.eventType || 'page_view',
      sourceApp: req.body?.sourceApp || 'marketing-site',
      pageUrl: String(req.body?.pageUrl || ''),
      path: String(req.body?.path || ''),
      referrer: String(req.body?.referrer || req.headers.referer || ''),
      ipAddress: req.ip || req.connection?.remoteAddress || '',
      userAgent: String(req.headers['user-agent'] || ''),
      utm: resolved.utm,
      attribution: touch,
      metadata: req.body?.metadata || {}
    })

    return res.json({
      success: true,
      visitorId: resolved.visitorId,
      sessionId: resolved.sessionId,
      visitId: visit._id
    })
  } catch (error) {
    console.error('Marketing visit tracking error:', error)
    return res.status(500).json({ error: 'Failed to record marketing visit.' })
  }
})

router.post('/brevo/webhooks/marketing', async (req, res) => {
  try {
    const configuredSecret = String(process.env.BREVO_MARKETING_WEBHOOK_SECRET || '').trim()
    const providedSecret = String(req.headers['x-seemplify-brevo-secret'] || '').trim()
    if (configuredSecret && configuredSecret !== providedSecret) {
      return res.status(401).json({ error: 'Invalid webhook secret.' })
    }

    const events = Array.isArray(req.body) ? req.body : [req.body]
    for (const rawEvent of events) {
      const eventType = normalizeEventType(rawEvent?.event)
      if (!eventType) continue

      const childCampaignId = Number(
        rawEvent?.campaignId ||
        rawEvent?.campaign_id ||
        rawEvent?.idCampaign ||
        rawEvent?.campaignid ||
        0
      ) || null

      if (!childCampaignId) continue

      const batch = await CampaignBatch.findOne({ 'brevo.childCampaignId': childCampaignId }).lean()
      if (!batch) continue

      const campaign = await Campaign.findById(batch.campaign).lean()
      if (!campaign) continue

      const email = String(rawEvent?.email || '').trim().toLowerCase()
      const recipient = email
        ? await CampaignRecipient.findOne({ campaign: campaign._id, normalizedEmail: email }).lean()
        : null
      if (!recipient) continue

      const eventTime = rawEvent?.eventTime
        ? new Date(rawEvent.eventTime)
        : (rawEvent?.ts_event ? new Date(Number(rawEvent.ts_event) * 1000) : new Date())
      const fingerprint = buildFingerprint({
        eventType,
        childCampaignId,
        email,
        ts: eventTime.toISOString(),
        link: rawEvent?.link || ''
      })

      try {
        await CampaignEvent.create({
          campaign: campaign._id,
          batch: batch._id,
          recipient: recipient._id,
          email,
          eventType,
          source: 'brevo_webhook',
          eventTime,
          ipAddress: rawEvent?.ip || '',
          linkUrl: rawEvent?.link || '',
          reason: rawEvent?.description || rawEvent?.reason || '',
          fingerprint,
          brevo: {
            campaignId: childCampaignId,
            messageId: rawEvent?.['message-id'] || rawEvent?.messageId || '',
            tag: rawEvent?.tag || ''
          },
          raw: rawEvent
        })
      } catch (error) {
        if (error?.code === 11000) {
          continue
        }
        throw error
      }

      await applyWebhookEventToModels({
        campaign,
        batch,
        recipient,
        eventType,
        eventTime,
        linkUrl: rawEvent?.link || '',
        reason: rawEvent?.description || rawEvent?.reason || ''
      })

      const suppressionReason = eventType === 'unsubscribed'
        ? 'unsubscribed'
        : eventType === 'spam'
          ? 'complained'
          : eventType === 'hardBounce'
            ? 'hard_bounce'
            : ''

      if (suppressionReason) {
        await CampaignSuppression.findOneAndUpdate({ normalizedEmail: email }, {
          $set: {
            email,
            normalizedEmail: email,
            reason: suppressionReason,
            source: 'brevo_webhook',
            campaign: campaign._id,
            recipient: recipient._id,
            suppressedAt: eventTime,
            details: {
              childCampaignId,
              reason: rawEvent?.description || rawEvent?.reason || ''
            }
          }
        }, { upsert: true, new: true })
      }
    }

    return res.json({ success: true })
  } catch (error) {
    console.error('Brevo marketing webhook error:', error)
    return res.status(500).json({ error: 'Failed to process marketing webhook.' })
  }
})

export default router
