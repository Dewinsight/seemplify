import express from 'express'
import multer from 'multer'
import Campaign from '../models/Campaign.js'
import CampaignAudience from '../models/CampaignAudience.js'
import CampaignTemplate from '../models/CampaignTemplate.js'
import CampaignBatch from '../models/CampaignBatch.js'
import CampaignRecipient from '../models/CampaignRecipient.js'
import { requireAdminAuth, adminRateLimit } from '../middleware/adminAuth.js'
import { importAudienceFromCsv, slugifyValue } from '../services/campaignAudienceService.js'
import { getCampaignAnalytics, getCampaignConsoleSummary, getRecipientAnalytics } from '../services/campaignAnalyticsService.js'
import {
  buildBrevoContactAttributes,
  computeSenderReadiness,
  ensureSystemCampaignTemplates,
  getSenderHealthSummary,
  getRequiredBrevoAttributes,
  launchCampaign,
  pauseCampaign,
  resumeCampaign,
  cancelCampaign
} from '../services/campaignOperationsService.js'
import { brevoMarketingService } from '../services/brevoMarketingService.js'
import { compileCampaignTemplateContent } from '../services/campaignRenderer.js'

const router = express.Router()
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024
  }
})

function parseMaybeJson(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'object') return value
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

async function ensureUniqueSlug(Model, baseSlug) {
  let counter = 0
  let slug = baseSlug

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const existing = await Model.findOne({ slug }).select('_id').lean()
    if (!existing) return slug
    counter += 1
    slug = `${baseSlug}-${counter}`
  }
}

function normalizeEmailList(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry || '').trim().toLowerCase())
      .filter(Boolean)
  }

  return String(value || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
}

async function buildCampaignDocument(payload, user, existingCampaign = null) {
  const templateId = String(payload.templateId || '').trim()
  const template = templateId ? await CampaignTemplate.findById(templateId).lean() : null
  const designMode = payload.designMode === 'html'
    ? 'html'
    : (template?.designMode || 'visual')
  const name = String(payload.name || existingCampaign?.name || '').trim()
  if (!name) {
    throw new Error('Campaign name is required.')
  }

  const baseSlug = slugifyValue(name, 'campaign')
  const slug = existingCampaign
    ? existingCampaign.slug
    : await ensureUniqueSlug(Campaign, baseSlug)

  const senderEmail = String(payload.senderEmail || existingCampaign?.sender?.email || '').trim().toLowerCase()
  const senderName = String(payload.senderName || existingCampaign?.sender?.name || 'Seemplify').trim()
  const senderReadiness = senderEmail ? await computeSenderReadiness(senderEmail) : {
    readinessBand: 'red',
    readinessReasons: ['Sender email is required.']
  }

  const nextDocument = {
    name,
    slug,
    description: String(payload.description || existingCampaign?.description || '').trim(),
    status: existingCampaign?.status || 'draft',
    sender: {
      email: senderEmail,
      name: senderName,
      senderId: senderReadiness.sender?.id || null,
      domain: senderEmail.includes('@') ? senderEmail.split('@')[1] : '',
      active: senderReadiness.sender ? senderReadiness.sender.active !== false : false,
      readinessBand: senderReadiness.readinessBand,
      readinessReasons: senderReadiness.readinessReasons
    },
    audience: payload.audienceId || existingCampaign?.audience || null,
    content: {
      subject: String(payload.subject || existingCampaign?.content?.subject || '').trim(),
      previewText: String(payload.previewText || existingCampaign?.content?.previewText || '').trim(),
      replyTo: String(payload.replyTo || existingCampaign?.content?.replyTo || '').trim().toLowerCase(),
      designMode,
      design: parseMaybeJson(payload.design, payload.design || template?.design || existingCampaign?.content?.design || {}),
      htmlContent: String(payload.htmlContent || template?.htmlContent || existingCampaign?.content?.htmlContent || ''),
      textContent: String(payload.textContent || template?.textContent || existingCampaign?.content?.textContent || ''),
      template: template
        ? {
          templateId: template._id,
          name: template.name,
          slug: template.slug,
          category: template.category
        }
        : existingCampaign?.content?.template || {}
    },
    pacing: {
      batchSize: Math.max(1, Number(payload.batchSize || existingCampaign?.pacing?.batchSize || Number(process.env.CAMPAIGN_DEFAULT_BATCH_SIZE || 200))),
      intervalMinutes: Math.max(1, Number(payload.intervalMinutes || existingCampaign?.pacing?.intervalMinutes || Number(process.env.CAMPAIGN_DEFAULT_BATCH_INTERVAL_MINUTES || 30))),
      startAt: payload.startAt ? new Date(payload.startAt) : (existingCampaign?.pacing?.startAt || new Date()),
      nextBatchAt: existingCampaign?.pacing?.nextBatchAt || null,
      batchCount: existingCampaign?.pacing?.batchCount || 0
    },
    tracking: {
      utmSource: String(payload.utmSource || existingCampaign?.tracking?.utmSource || 'seemplify').trim() || 'seemplify',
      utmMedium: String(payload.utmMedium || existingCampaign?.tracking?.utmMedium || 'email').trim() || 'email',
      utmCampaign: String(payload.utmCampaign || existingCampaign?.tracking?.utmCampaign || slug).trim() || slug,
      allowExternalLinkDecoration: payload.allowExternalLinkDecoration === true || payload.allowExternalLinkDecoration === 'true'
    },
    testSendEmails: normalizeEmailList(payload.testSendEmails || existingCampaign?.testSendEmails || []),
    updatedBy: user._id
  }

  if (!existingCampaign) {
    nextDocument.createdBy = user._id
  }

  return nextDocument
}

router.use(requireAdminAuth)
router.use(adminRateLimit({ maxRequests: 240, windowMs: 15 * 60 * 1000, keyPrefix: 'admin-campaigns' }))

router.get('/campaign-templates', async (req, res) => {
  try {
    await ensureSystemCampaignTemplates()
    const templates = await CampaignTemplate.find()
      .sort({ systemTemplate: -1, updatedAt: -1 })
      .lean()
    res.json({ templates })
  } catch (error) {
    console.error('List campaign templates error:', error)
    res.status(500).json({ error: 'Failed to load campaign templates.' })
  }
})

router.get('/campaign-audiences', async (req, res) => {
  try {
    const audiences = await CampaignAudience.find()
      .sort({ updatedAt: -1 })
      .select('name slug description sourceType sourceFileName importSummary contacts createdAt updatedAt')
      .lean()

    res.json({
      audiences: audiences.map((audience) => ({
        ...audience,
        contactCount: Array.isArray(audience.contacts) ? audience.contacts.length : 0
      }))
    })
  } catch (error) {
    console.error('List campaign audiences error:', error)
    res.status(500).json({ error: 'Failed to load campaign audiences.' })
  }
})

router.post('/campaign-audiences/import', upload.single('file'), async (req, res) => {
  try {
    const csvText = req.file
      ? req.file.buffer.toString('utf-8')
      : String(req.body.csvText || '')
    const audienceName = String(req.body.name || req.file?.originalname || 'Uploaded Audience').trim()
    const imported = importAudienceFromCsv({
      csvText,
      audienceName,
      sourceFileName: req.file?.originalname || ''
    })

    if (imported.errors.length > 0) {
      return res.status(400).json({ error: imported.errors.join(' ') })
    }

    const slug = await ensureUniqueSlug(CampaignAudience, slugifyValue(audienceName, 'audience'))
    const audience = await CampaignAudience.create({
      name: audienceName,
      slug,
      description: String(req.body.description || '').trim(),
      sourceType: 'csv',
      sourceFileName: imported.sourceFileName,
      columnMap: imported.columnMap,
      importSummary: imported.summary,
      contacts: imported.contacts,
      createdBy: req.user._id,
      updatedBy: req.user._id
    })

    res.status(201).json({
      message: 'Audience imported successfully.',
      audience
    })
  } catch (error) {
    console.error('Import campaign audience error:', error)
    res.status(500).json({ error: 'Failed to import campaign audience.' })
  }
})

router.get('/campaign-senders/health', async (req, res) => {
  try {
    const senders = await getSenderHealthSummary()
    res.json({ senders })
  } catch (error) {
    console.error('Sender health error:', error)
    res.status(500).json({ error: 'Failed to load sender health.' })
  }
})

router.get('/campaigns', async (req, res) => {
  try {
    const campaigns = await getCampaignConsoleSummary(50)
    res.json({ campaigns })
  } catch (error) {
    console.error('List campaigns error:', error)
    res.status(500).json({ error: 'Failed to load campaigns.' })
  }
})

router.get('/campaigns/:campaignId', async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.campaignId).lean()
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found.' })
    }
    res.json({ campaign })
  } catch (error) {
    console.error('Get campaign error:', error)
    res.status(500).json({ error: 'Failed to load campaign.' })
  }
})

router.post('/campaigns', async (req, res) => {
  try {
    const document = await buildCampaignDocument(req.body, req.user)
    const campaign = await Campaign.create(document)
    res.status(201).json({
      message: 'Campaign created successfully.',
      campaign
    })
  } catch (error) {
    console.error('Create campaign error:', error)
    res.status(400).json({ error: error.message || 'Failed to create campaign.' })
  }
})

router.put('/campaigns/:campaignId', async (req, res) => {
  try {
    const existingCampaign = await Campaign.findById(req.params.campaignId)
    if (!existingCampaign) {
      return res.status(404).json({ error: 'Campaign not found.' })
    }

    const document = await buildCampaignDocument(req.body, req.user, existingCampaign)
    Object.assign(existingCampaign, document)
    await existingCampaign.save()

    res.json({
      message: 'Campaign updated successfully.',
      campaign: existingCampaign
    })
  } catch (error) {
    console.error('Update campaign error:', error)
    res.status(400).json({ error: error.message || 'Failed to update campaign.' })
  }
})

router.post('/campaigns/:campaignId/test-send', async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.campaignId)
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found.' })
    }

    const emails = normalizeEmailList(req.body.emails || campaign.testSendEmails || [])
    if (emails.length === 0) {
      return res.status(400).json({ error: 'At least one test email is required.' })
    }

    await brevoMarketingService.ensureAttributes(getRequiredBrevoAttributes())
    const folder = await brevoMarketingService.ensureFolder('Seemplify Campaign Tests')
    const list = await brevoMarketingService.ensureList({
      folderId: folder.id,
      name: `${campaign.name} / Test`
    })

    await brevoMarketingService.upsertContacts({
      listId: list.id,
      contacts: emails.map((email) => ({
        email,
        attributes: buildBrevoContactAttributes({
          email,
          firstName: email.split('@')[0],
          personalization: {
            customOpening: 'This is a test rendering of the Seemplify campaign.',
            customBenefits: 'Use this test send to validate layout, links, and sender configuration before launch.',
            freeTrialUrl: 'https://auth.seemplifyai.com/signup'
          }
        })
      }))
    })

    const compiled = compileCampaignTemplateContent(campaign)
    const created = await brevoMarketingService.createEmailCampaign({
      name: `[Test] ${campaign.name}`,
      subject: compiled.subject,
      previewText: compiled.previewText,
      sender: {
        name: campaign?.sender?.name || 'Seemplify',
        email: campaign?.sender?.email || ''
      },
      replyTo: campaign?.content?.replyTo || undefined,
      htmlContent: compiled.html,
      textContent: compiled.text,
      recipients: {
        listIds: [list.id]
      }
    })

    await brevoMarketingService.sendCampaignTest(created.id, emails)

    res.json({
      message: 'Test campaign sent.',
      testCampaignId: created.id,
      emails
    })
  } catch (error) {
    console.error('Campaign test send error:', error)
    res.status(500).json({ error: error.message || 'Failed to send campaign test.' })
  }
})

router.post('/campaigns/:campaignId/launch', async (req, res) => {
  try {
    const campaign = await launchCampaign(req.params.campaignId, {
      adminId: req.user._id,
      overrideSenderQuality: req.body.overrideSenderQuality === true || req.body.overrideSenderQuality === 'true'
    })
    res.json({
      message: 'Campaign launched successfully.',
      campaign
    })
  } catch (error) {
    console.error('Launch campaign error:', error)
    res.status(400).json({ error: error.message || 'Failed to launch campaign.' })
  }
})

router.post('/campaigns/:campaignId/pause', async (req, res) => {
  try {
    const campaign = await pauseCampaign(req.params.campaignId, req.user._id)
    res.json({
      message: 'Campaign paused.',
      campaign
    })
  } catch (error) {
    console.error('Pause campaign error:', error)
    res.status(400).json({ error: error.message || 'Failed to pause campaign.' })
  }
})

router.post('/campaigns/:campaignId/resume', async (req, res) => {
  try {
    const campaign = await resumeCampaign(req.params.campaignId, req.user._id)
    res.json({
      message: 'Campaign resumed.',
      campaign
    })
  } catch (error) {
    console.error('Resume campaign error:', error)
    res.status(400).json({ error: error.message || 'Failed to resume campaign.' })
  }
})

router.post('/campaigns/:campaignId/cancel', async (req, res) => {
  try {
    const campaign = await cancelCampaign(req.params.campaignId, req.user._id)
    res.json({
      message: 'Campaign cancelled.',
      campaign
    })
  } catch (error) {
    console.error('Cancel campaign error:', error)
    res.status(400).json({ error: error.message || 'Failed to cancel campaign.' })
  }
})

router.get('/campaigns/:campaignId/analytics', async (req, res) => {
  try {
    const analytics = await getCampaignAnalytics(req.params.campaignId)
    if (!analytics) {
      return res.status(404).json({ error: 'Campaign analytics not found.' })
    }
    res.json(analytics)
  } catch (error) {
    console.error('Campaign analytics error:', error)
    res.status(500).json({ error: 'Failed to load campaign analytics.' })
  }
})

router.get('/campaigns/:campaignId/recipients/:recipientId', async (req, res) => {
  try {
    const recipientAnalytics = await getRecipientAnalytics(req.params.campaignId, req.params.recipientId)
    if (!recipientAnalytics) {
      return res.status(404).json({ error: 'Recipient analytics not found.' })
    }
    res.json(recipientAnalytics)
  } catch (error) {
    console.error('Recipient analytics error:', error)
    res.status(500).json({ error: 'Failed to load recipient analytics.' })
  }
})

router.get('/campaign-batches/:batchId', async (req, res) => {
  try {
    const batch = await CampaignBatch.findById(req.params.batchId).lean()
    if (!batch) {
      return res.status(404).json({ error: 'Batch not found.' })
    }
    res.json({ batch })
  } catch (error) {
    console.error('Get campaign batch error:', error)
    res.status(500).json({ error: 'Failed to load batch.' })
  }
})

router.get('/campaign-recipients', async (req, res) => {
  try {
    const recipients = await CampaignRecipient.find()
      .sort({ updatedAt: -1 })
      .limit(100)
      .lean()
    res.json({ recipients })
  } catch (error) {
    console.error('List campaign recipients error:', error)
    res.status(500).json({ error: 'Failed to load recipients.' })
  }
})

export default router
