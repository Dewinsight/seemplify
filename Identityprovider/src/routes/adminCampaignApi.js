import express from 'express'
import multer from 'multer'
import Campaign from '../models/Campaign.js'
import CampaignAudience from '../models/CampaignAudience.js'
import CampaignTemplate from '../models/CampaignTemplate.js'
import CampaignBatch from '../models/CampaignBatch.js'
import CampaignRecipient from '../models/CampaignRecipient.js'
import CampaignSuppression from '../models/CampaignSuppression.js'
import { Account } from '../models/Account.js'
import { Organization } from '../models/Organization.js'
import { requireAdminAuth, adminRateLimit } from '../middleware/adminAuth.js'
import {
  CAMPAIGN_AUDIENCE_FIELDS,
  importAudienceFromUpload,
  previewAudienceUpload,
  slugifyValue
} from '../services/campaignAudienceService.js'
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
  cancelCampaign,
  getCampaignSequenceSteps
} from '../services/campaignOperationsService.js'
import { brevoMarketingService } from '../services/brevoMarketingService.js'
import { compileCampaignTemplateContent } from '../services/campaignRenderer.js'
import { loadCampaignAudienceSummaries } from '../services/campaignWorkspaceService.js'

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

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim())
}

const CUSTOMER_AUDIENCE_ROLES = new Set(['owner', 'admin', 'hr_manager', 'recruiter', 'interviewer', 'staff'])
const CONSENT_BASES = new Set(['explicit_opt_in', 'customer_relationship', 'legitimate_interest'])

function splitPersonName(value = '') {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean)
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' ')
  }
}

async function loadCustomerContacts({ accountIds = [], search = '', roles = ['owner', 'admin'], limit = 100 } = {}) {
  const normalizedRoles = roles.filter((role) => CUSTOMER_AUDIENCE_ROLES.has(role))
  const query = {
    email: { $exists: true, $ne: '' },
    organizations: {
      $elemMatch: {
        isActive: true,
        ...(normalizedRoles.length > 0 ? { role: { $in: normalizedRoles } } : {})
      }
    }
  }

  if (accountIds.length > 0) query._id = { $in: accountIds }
  if (search) {
    const safeSearch = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const matchingOrganizations = await Organization.find({ name: { $regex: safeSearch, $options: 'i' } })
      .select('_id')
      .limit(500)
      .lean()
    const matchingOrganizationIds = matchingOrganizations.map((organization) => organization._id)
    query.$or = [
      { email: { $regex: safeSearch, $options: 'i' } },
      { 'profile.name': { $regex: safeSearch, $options: 'i' } },
      ...(matchingOrganizationIds.length > 0
        ? [{ organizations: { $elemMatch: { organization: { $in: matchingOrganizationIds }, isActive: true } } }]
        : [])
    ]
  }

  const accounts = await Account.find(query)
    .select('email profile.name organizations')
    .sort({ email: 1 })
    .limit(Math.min(Math.max(Number(limit || 100), 1), 500))
    .lean()

  const organizationIds = Array.from(new Set(accounts.flatMap((account) => (
    (account.organizations || [])
      .filter((membership) => membership.isActive && (normalizedRoles.length === 0 || normalizedRoles.includes(membership.role)))
      .map((membership) => membership.organization?.toString())
      .filter(Boolean)
  ))))
  const organizations = await Organization.find({ _id: { $in: organizationIds } })
    .select('name subscriptionStatus currentPlan')
    .populate('currentPlan', 'name slug')
    .lean()
  const organizationMap = new Map(organizations.map((organization) => [organization._id.toString(), organization]))

  return accounts.map((account) => {
    const membership = (account.organizations || []).find((candidate) => (
      candidate.isActive &&
      (normalizedRoles.length === 0 || normalizedRoles.includes(candidate.role)) &&
      organizationMap.has(candidate.organization?.toString())
    ))
    const organization = membership ? organizationMap.get(membership.organization.toString()) : null
    const name = splitPersonName(account?.profile?.name || '')
    return {
      accountId: account._id,
      email: String(account.email || '').trim().toLowerCase(),
      firstName: name.firstName,
      lastName: name.lastName,
      role: membership?.role || '',
      companyName: organization?.name || '',
      organizationId: organization?._id || null,
      subscriptionStatus: organization?.subscriptionStatus || 'none',
      planName: organization?.currentPlan?.name || ''
    }
  }).filter((contact) => isValidEmail(contact.email))
}

function normalizeSequencePayload(rawSequence, primaryContent, existingSequence = {}) {
  const parsed = parseMaybeJson(rawSequence, rawSequence || existingSequence || {}) || {}
  const rawSteps = Array.isArray(parsed.steps) ? parsed.steps.slice(0, 12) : []
  const steps = rawSteps.map((step, index) => {
    const sourceContent = step?.content && typeof step.content === 'object' ? step.content : {}
    const fallbackContent = index === 0 ? primaryContent : {}
    const designMode = String(sourceContent.designMode || fallbackContent.designMode || 'visual') === 'html' ? 'html' : 'visual'
    return {
      ...(step?._id ? { _id: step._id } : {}),
      name: String(step?.name || `Message ${index + 1}`).trim().slice(0, 120),
      position: index,
      delay: index === 0
        ? { value: 0, unit: 'minutes' }
        : {
          value: Math.max(0, Number(step?.delay?.value || 0)),
          unit: ['minutes', 'hours', 'days'].includes(step?.delay?.unit) ? step.delay.unit : 'days'
        },
      condition: ['all', 'not_opened_previous', 'opened_previous', 'not_clicked_previous', 'clicked_previous'].includes(step?.condition)
        ? step.condition
        : 'all',
      content: {
        subject: String(sourceContent.subject || fallbackContent.subject || '').trim(),
        previewText: String(sourceContent.previewText || fallbackContent.previewText || '').trim(),
        replyTo: String(sourceContent.replyTo || fallbackContent.replyTo || '').trim().toLowerCase(),
        designMode,
        design: parseMaybeJson(sourceContent.design, sourceContent.design || fallbackContent.design || {}),
        htmlContent: String(sourceContent.htmlContent || fallbackContent.htmlContent || ''),
        textContent: String(sourceContent.textContent || fallbackContent.textContent || ''),
        template: sourceContent.template || fallbackContent.template || {}
      }
    }
  })

  if (steps.length === 0) {
    steps.push({
      name: 'Message 1',
      position: 0,
      delay: { value: 0, unit: 'minutes' },
      condition: 'all',
      content: primaryContent
    })
  }

  return {
    enabled: parsed.enabled === true || parsed.enabled === 'true' || steps.length > 1,
    stopOnConversion: parsed.stopOnConversion !== false && parsed.stopOnConversion !== 'false',
    stopOnUnsubscribe: true,
    stopOnBounce: true,
    steps
  }
}

async function validateCampaignTestSend(campaign, rawEmails) {
  const emails = Array.from(new Set(normalizeEmailList(rawEmails)))
  const errors = []

  if (emails.length === 0) {
    errors.push('At least one test email is required.')
  }

  const invalidEmails = emails.filter((email) => !isValidEmail(email))
  if (invalidEmails.length > 0) {
    errors.push(`Invalid test email${invalidEmails.length === 1 ? '' : 's'}: ${invalidEmails.join(', ')}`)
  }

  if (!brevoMarketingService.isConfigured()) {
    errors.push('Campaign test send is unavailable because BREVO_API_KEY is not configured.')
  }

  const senderEmail = String(campaign?.sender?.email || '').trim().toLowerCase()
  if (!senderEmail) {
    errors.push('Set a sender email before sending a campaign test.')
  } else if (!isValidEmail(senderEmail)) {
    errors.push('The sender email is not valid.')
  }

  const senderReadiness = senderEmail
    ? await computeSenderReadiness(senderEmail)
    : null

  if (senderEmail && senderReadiness) {
    if (!senderReadiness.sender) {
      errors.push('Sender does not exist in Brevo.')
    } else if (senderReadiness.sender.active === false) {
      errors.push('Sender exists in Brevo but is inactive.')
    }

    const explicitDomainStatus = typeof senderReadiness?.domain?.authenticated === 'boolean'
      ? senderReadiness.domain.authenticated
      : (String(senderReadiness?.domain?.status || '').trim().toLowerCase() === 'verified' ? true : null)

    if (explicitDomainStatus === false) {
      errors.push('Sender domain is not authenticated in Brevo.')
    }
  }

  const compiled = compileCampaignTemplateContent(campaign)
  if (!String(compiled.subject || '').trim()) {
    errors.push('Add a campaign subject before sending a test.')
  }

  const hasHtml = String(compiled.html || '').trim()
  const hasText = String(compiled.text || '').trim()
  if (!hasHtml && !hasText) {
    errors.push('Add campaign content before sending a test.')
  }

  return {
    emails,
    compiled,
    senderReadiness,
    errors: Array.from(new Set(errors))
  }
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

  const primaryContent = {
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
  }
  const sequence = normalizeSequencePayload(payload.sequence, primaryContent, existingCampaign?.sequence || {})
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
    content: sequence.steps[0]?.content || primaryContent,
    sequence,
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
    await ensureSystemCampaignTemplates().catch((error) => {
      console.error('Campaign template sync failed; using persisted templates:', error)
    })
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
    const audiences = await loadCampaignAudienceSummaries(CampaignAudience)
    res.json({ audiences })
  } catch (error) {
    console.error('List campaign audiences error:', error)
    res.status(500).json({ error: 'Failed to load campaign audiences.' })
  }
})

router.get('/campaign-customers', async (req, res) => {
  try {
    const roles = String(req.query.roles || 'owner,admin')
      .split(',')
      .map((role) => role.trim().toLowerCase())
      .filter(Boolean)
    const contacts = await loadCustomerContacts({
      search: String(req.query.search || '').trim(),
      roles,
      limit: Number(req.query.limit || 100)
    })
    res.json({ contacts })
  } catch (error) {
    console.error('List campaign customers error:', error)
    res.status(500).json({ error: 'Failed to load customer contacts.' })
  }
})

router.post('/campaign-audiences/from-customers', async (req, res) => {
  try {
    const accountIds = Array.from(new Set((Array.isArray(req.body.accountIds) ? req.body.accountIds : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean)))
    const consentBasis = String(req.body.consentBasis || '').trim()
    const consentConfirmed = req.body.consentConfirmed === true || req.body.consentConfirmed === 'true'
    if (accountIds.length === 0) return res.status(400).json({ error: 'Select at least one customer contact.' })
    if (accountIds.length > 500) return res.status(400).json({ error: 'Create customer audiences in groups of 500 or fewer.' })
    if (!consentConfirmed || !CONSENT_BASES.has(consentBasis)) {
      return res.status(400).json({ error: 'Confirm the audience consent basis before creating the audience.' })
    }

    const contacts = await loadCustomerContacts({
      accountIds,
      roles: [],
      limit: 500
    })
    if (contacts.length === 0) return res.status(400).json({ error: 'No eligible customer contacts were found.' })

    const suppressed = await CampaignSuppression.find({
      normalizedEmail: { $in: contacts.map((contact) => contact.email) }
    }).select('normalizedEmail').lean()
    const suppressedEmails = new Set(suppressed.map((row) => row.normalizedEmail))
    const audienceName = String(req.body.name || `Customers ${new Date().toISOString().slice(0, 10)}`).trim()
    const slug = await ensureUniqueSlug(CampaignAudience, slugifyValue(audienceName, 'customer-audience'))
    const audienceContacts = contacts.map((contact, index) => ({
      email: contact.email,
      normalizedEmail: contact.email,
      firstName: contact.firstName,
      lastName: contact.lastName,
      role: contact.role,
      companyName: contact.companyName,
      status: suppressedEmails.has(contact.email) ? 'suppressed' : 'active',
      metadata: {
        source: 'idp_customer',
        accountId: contact.accountId,
        organizationId: contact.organizationId,
        subscriptionStatus: contact.subscriptionStatus,
        planName: contact.planName
      },
      sourceRowNumber: index + 1
    }))
    const activeCount = audienceContacts.filter((contact) => contact.status === 'active').length
    const audience = await CampaignAudience.create({
      name: audienceName,
      slug,
      description: String(req.body.description || 'Selected from existing Seemplify customers.').trim(),
      sourceType: 'customers',
      consent: {
        basis: consentBasis,
        confirmedAt: new Date(),
        confirmedBy: req.user._id,
        note: String(req.body.consentNote || '').trim()
      },
      importSummary: {
        totalRows: audienceContacts.length,
        validRecipients: activeCount,
        invalidRecipients: 0,
        duplicateRecipients: 0,
        skippedRecipients: audienceContacts.length - activeCount,
        lastImportedAt: new Date()
      },
      contacts: audienceContacts,
      createdBy: req.user._id,
      updatedBy: req.user._id
    })
    res.status(201).json({ message: 'Customer audience created.', audience })
  } catch (error) {
    console.error('Create customer audience error:', error)
    res.status(400).json({ error: error.message || 'Failed to create customer audience.' })
  }
})

router.post('/campaign-audiences/preview', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Choose a CSV or Excel file first.' })
    }

    const preview = previewAudienceUpload({
      buffer: req.file.buffer,
      sourceFileName: req.file.originalname,
      sheetName: String(req.body.sheetName || '').trim()
    })

    if (preview.errors.length > 0) {
      return res.status(400).json({
        error: preview.errors[0],
        details: preview.errors
      })
    }

    res.json({
      preview,
      fields: CAMPAIGN_AUDIENCE_FIELDS
    })
  } catch (error) {
    console.error('Preview campaign audience error:', error)
    res.status(500).json({ error: 'Failed to extract audience fields.' })
  }
})

router.post('/campaign-audiences/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file && !req.body.csvText) {
      return res.status(400).json({ error: 'Choose a CSV or Excel file first.' })
    }
    const consentBasis = String(req.body.consentBasis || '').trim()
    const consentConfirmed = req.body.consentConfirmed === true || req.body.consentConfirmed === 'true'
    if (!consentConfirmed || !CONSENT_BASES.has(consentBasis)) {
      return res.status(400).json({ error: 'Confirm the audience consent basis before importing contacts.' })
    }

    const audienceName = String(req.body.name || req.file?.originalname || 'Uploaded Audience').trim()
    const imported = importAudienceFromUpload({
      buffer: req.file?.buffer || null,
      csvText: String(req.body.csvText || ''),
      audienceName,
      sourceFileName: req.file?.originalname || '',
      sheetName: String(req.body.sheetName || '').trim(),
      columnMap: parseMaybeJson(req.body.columnMap, {})
    })

    if (imported.errors.length > 0) {
      return res.status(400).json({
        error: imported.errors[0],
        details: imported.errors
      })
    }

    const slug = await ensureUniqueSlug(CampaignAudience, slugifyValue(audienceName, 'audience'))
    const audience = await CampaignAudience.create({
      name: audienceName,
      slug,
      description: String(req.body.description || '').trim(),
      sourceType: imported.sourceType,
      sourceFileName: imported.sourceFileName,
      consent: {
        basis: consentBasis,
        confirmedAt: new Date(),
        confirmedBy: req.user._id,
        note: String(req.body.consentNote || '').trim()
      },
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

    const requestedStep = String(req.body.stepId || '').trim()
    const steps = getCampaignSequenceSteps(campaign.toObject())
    const step = steps.find((candidate) => String(candidate._id || candidate.position) === requestedStep) || steps[0]
    const testCampaign = {
      ...campaign.toObject(),
      content: step?.content || campaign.content
    }
    const validation = await validateCampaignTestSend(testCampaign, req.body.emails || campaign.testSendEmails || [])
    if (validation.errors.length > 0) {
      return res.status(400).json({
        error: validation.errors[0],
        details: validation.errors
      })
    }

    await brevoMarketingService.ensureAttributes(getRequiredBrevoAttributes())
    const folder = await brevoMarketingService.ensureFolder('Seemplify Campaign Tests')
    const list = await brevoMarketingService.ensureList({
      folderId: folder.id,
      name: `${campaign.name} / ${step?.name || 'Message 1'} / Test`
    })

    await brevoMarketingService.upsertContacts({
      listId: list.id,
      contacts: validation.emails.map((email) => ({
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

    const created = await brevoMarketingService.createEmailCampaign({
      name: `[Test] ${campaign.name} / ${step?.name || 'Message 1'}`,
      subject: validation.compiled.subject,
      previewText: validation.compiled.previewText,
      sender: {
        name: testCampaign?.sender?.name || 'Seemplify',
        email: testCampaign?.sender?.email || ''
      },
      replyTo: testCampaign?.content?.replyTo || undefined,
      htmlContent: validation.compiled.html,
      textContent: validation.compiled.text,
      recipients: {
        listIds: [list.id]
      }
    })

    await brevoMarketingService.sendCampaignTest(created.id, validation.emails)

    res.json({
      message: 'Test campaign sent.',
      testCampaignId: created.id,
      emails: validation.emails
    })
  } catch (error) {
    console.error('Campaign test send error:', error)
    const status = Number(error?.status || 0)
    const message = error?.message || 'Failed to send campaign test.'
    const isBrevoConfigurationError = /brevo_api_key|sender|campaign test send is unavailable/i.test(message)
    const responseStatus = status >= 400 && status < 500
      ? 400
      : (isBrevoConfigurationError ? 400 : 500)

    res.status(responseStatus).json({
      error: responseStatus === 400
        ? message
        : 'Failed to send campaign test.',
      details: responseStatus === 400 && error?.payload
        ? [message]
        : undefined
    })
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
