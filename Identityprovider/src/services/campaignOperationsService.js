import Campaign from '../models/Campaign.js'
import CampaignAudience from '../models/CampaignAudience.js'
import CampaignBatch from '../models/CampaignBatch.js'
import CampaignRecipient from '../models/CampaignRecipient.js'
import CampaignTemplate from '../models/CampaignTemplate.js'
import CampaignEvent from '../models/CampaignEvent.js'
import CampaignSuppression from '../models/CampaignSuppression.js'
import { getSystemCampaignTemplates } from './campaignTemplateLibrary.js'
import { compileCampaignTemplateContent } from './campaignRenderer.js'
import { brevoMarketingService } from './brevoMarketingService.js'

const DEFAULT_FREE_TRIAL_URL = 'https://auth.seemplifyai.com/signup'
const DEFAULT_FOLDER_NAME = 'Seemplify Campaigns'

function slugifyValue(value = '', fallback = 'campaign') {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)

  return slug || fallback
}

function splitIntoChunks(items = [], size = 1) {
  const chunks = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

export function sequenceDelayMilliseconds(delay = {}) {
  const value = Math.max(0, Number(delay?.value || 0))
  const unit = String(delay?.unit || 'days').trim().toLowerCase()
  if (unit === 'minutes') return value * 60 * 1000
  if (unit === 'hours') return value * 60 * 60 * 1000
  return value * 24 * 60 * 60 * 1000
}

export function getCampaignSequenceSteps(campaign = {}) {
  const rawSteps = campaign?.sequence?.enabled && Array.isArray(campaign?.sequence?.steps)
    ? campaign.sequence.steps
    : []

  if (rawSteps.length === 0) {
    return [{
      _id: null,
      name: 'Message 1',
      position: 0,
      delay: { value: 0, unit: 'minutes' },
      condition: 'all',
      content: campaign?.content || {}
    }]
  }

  return [...rawSteps]
    .sort((left, right) => Number(left?.position || 0) - Number(right?.position || 0))
    .map((step, index) => ({
      ...step,
      name: String(step?.name || `Message ${index + 1}`).trim(),
      position: index,
      delay: index === 0 ? { value: 0, unit: 'minutes' } : (step?.delay || { value: 1, unit: 'days' }),
      condition: step?.condition || 'all',
      content: step?.content || campaign?.content || {}
    }))
}

export function recipientHasSequenceExit(recipient = {}, sequence = {}) {
  if (sequence.stopOnConversion !== false && (recipient?.status === 'converted' || recipient?.conversion?.convertedAt)) return 'converted'
  if (recipient?.status === 'unsubscribed') return 'unsubscribed'
  if (recipient?.status === 'complained') return 'complained'
  if (recipient?.status === 'bounced') return 'bounced'
  return ''
}

export function conditionMatchesEngagement(condition = 'all', engagement = {}) {
  if (condition === 'opened_previous') return engagement.opened === true
  if (condition === 'not_opened_previous') return engagement.opened !== true
  if (condition === 'clicked_previous') return engagement.clicked === true
  if (condition === 'not_clicked_previous') return engagement.clicked !== true
  return true
}

function stripClosing(text = '') {
  return String(text || '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\b(best regards|regards|thanks|thank you|sincerely|warm regards)\b[\s\S]*$/i, '')
    .trim()
}

function buildRoleBenefits(contact = {}) {
  const haystack = `${contact.role || ''} ${contact.jobTitle || ''} ${contact.jobLevel || ''} ${contact.department || ''}`.toLowerCase()

  if (/(chief|head|director|vp|people lead|hr lead|hr manager|head of people|people operations lead)/.test(haystack)) {
    return 'Seemplify gives leadership teams one platform for recruiting, onboarding, payroll, approvals, performance, and compliance visibility without fragmenting the operating layer.'
  }

  if (/(recruit|talent|sourc|hiring)/.test(haystack)) {
    return 'Seemplify helps recruiting teams move faster from candidate pipeline to onboarding, with fewer admin handoffs and clearer recruiting-to-employee workflows.'
  }

  return 'Seemplify centralizes employee records, workflow automation, approvals, auditability, and real-time people operations visibility in one operating system.'
}

function buildOpening(contact = {}) {
  const cleaned = stripClosing(contact.tailoredMessage || '')
  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)

  if (sentences.length > 0) {
    return sentences.slice(0, 2).join(' ')
  }

  const company = contact.companyName ? ` at ${contact.companyName}` : ''
  const role = contact.jobTitle || contact.role || 'your team'
  return `Seemplify helps ${role}${company} replace fragmented HR administration with one structured operating system for daily workforce execution.`
}

export function buildRecipientPersonalization(contact = {}) {
  return {
    customOpening: buildOpening(contact),
    customBenefits: buildRoleBenefits(contact),
    freeTrialUrl: DEFAULT_FREE_TRIAL_URL
  }
}

export function getRequiredBrevoAttributes() {
  return [
    { name: 'FIRSTNAME', type: 'text' },
    { name: 'LASTNAME', type: 'text' },
    { name: 'JOBTITLE', type: 'text' },
    { name: 'JOBLEVEL', type: 'text' },
    { name: 'DEPARTMENT', type: 'text' },
    { name: 'COMPANYNAME', type: 'text' },
    { name: 'INDUSTRY', type: 'text' },
    { name: 'HEADCOUNT', type: 'text' },
    { name: 'LOCATION', type: 'text' },
    { name: 'COMPANYDESCRIPTION', type: 'text' },
    { name: 'CUSTOM_OPENING', type: 'text' },
    { name: 'CUSTOM_BENEFITS', type: 'text' },
    { name: 'FREE_TRIAL_URL', type: 'text' }
  ]
}

export function buildBrevoContactAttributes(recipient = {}) {
  const personalization = recipient.personalization || {}
  return {
    FIRSTNAME: recipient.firstName || '',
    LASTNAME: recipient.lastName || '',
    JOBTITLE: recipient.jobTitle || '',
    JOBLEVEL: recipient.jobLevel || '',
    DEPARTMENT: recipient.department || '',
    COMPANYNAME: recipient.companyName || '',
    INDUSTRY: recipient.industry || '',
    HEADCOUNT: recipient.headcount || '',
    LOCATION: recipient.location || '',
    COMPANYDESCRIPTION: recipient.companyDescription || '',
    CUSTOM_OPENING: personalization.customOpening || '',
    CUSTOM_BENEFITS: personalization.customBenefits || '',
    FREE_TRIAL_URL: personalization.freeTrialUrl || DEFAULT_FREE_TRIAL_URL
  }
}

export async function ensureSystemCampaignTemplates() {
  const systemTemplates = getSystemCampaignTemplates()
  const writes = systemTemplates.map((template) => CampaignTemplate.findOneAndUpdate(
    { slug: template.slug },
    {
      $set: {
        ...template,
        updatedBy: null
      },
      $setOnInsert: {
        createdBy: null
      }
    },
    {
      new: true,
      upsert: true
    }
  ))

  return Promise.all(writes)
}

export async function computeSenderReadiness(senderEmail = '') {
  const normalizedEmail = String(senderEmail || '').trim().toLowerCase()
  if (!normalizedEmail) {
    return {
      readinessBand: 'red',
      readinessReasons: ['Sender email is required.'],
      sender: null,
      webhookConfigured: false
    }
  }

  if (!brevoMarketingService.isConfigured()) {
    return {
      readinessBand: 'red',
      readinessReasons: ['BREVO_API_KEY is not configured.'],
      sender: null,
      webhookConfigured: false
    }
  }

  const senderDomain = normalizedEmail.includes('@') ? normalizedEmail.split('@')[1] : ''
  const [senders, domains, webhooks, recentCampaigns] = await Promise.all([
    brevoMarketingService.getSenders(),
    brevoMarketingService.getDomains().catch(() => []),
    brevoMarketingService.getWebhooks().catch(() => []),
    Campaign.find({
      'sender.email': normalizedEmail,
      launchedAt: {
        $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      }
    }).select('metrics').lean()
  ])

  const sender = senders.find((entry) => String(entry.email || '').trim().toLowerCase() === normalizedEmail) || null
  const domain = domains.find((entry) => {
    const candidate = String(entry.domain || entry.name || '').trim().toLowerCase()
    return candidate === senderDomain
  }) || null
  const webhookConfigured = process.env.BREVO_MARKETING_WEBHOOK_PUBLIC_URL
    ? webhooks.some((webhook) => String(webhook.url || '').trim() === String(process.env.BREVO_MARKETING_WEBHOOK_PUBLIC_URL).trim())
    : false

  let readinessBand = 'green'
  const readinessReasons = []

  if (!sender) {
    readinessBand = 'red'
    readinessReasons.push('Sender does not exist in Brevo.')
  } else if (sender.active === false) {
    readinessBand = 'red'
    readinessReasons.push('Sender exists in Brevo but is inactive.')
  }

  const explicitDomainStatus = typeof domain?.authenticated === 'boolean'
    ? domain.authenticated
    : (String(domain?.status || '').trim().toLowerCase() === 'verified' ? true : null)

  if (explicitDomainStatus === false) {
    readinessBand = 'red'
    readinessReasons.push('Sender domain is not authenticated in Brevo.')
  } else if (!domain) {
    readinessBand = readinessBand === 'red' ? 'red' : 'amber'
    readinessReasons.push('Sender domain could not be verified from Brevo domain settings.')
  }

  if (!webhookConfigured) {
    readinessBand = 'red'
    readinessReasons.push('Marketing webhook is not configured for live event ingestion.')
  }

  const recentTotals = recentCampaigns.reduce((summary, campaign) => {
    summary.sent += Number(campaign?.metrics?.sent || 0)
    summary.hardBounces += Number(campaign?.metrics?.hardBounces || 0)
    summary.unsubscribes += Number(campaign?.metrics?.unsubscribes || 0)
    summary.spam += Number(campaign?.metrics?.spam || 0)
    return summary
  }, {
    sent: 0,
    hardBounces: 0,
    unsubscribes: 0,
    spam: 0
  })

  if (recentTotals.sent === 0 && readinessBand !== 'red') {
    readinessBand = 'amber'
    readinessReasons.push('No recent local send history is available for this sender.')
  }

  if (recentTotals.sent > 0) {
    const hardBounceRate = recentTotals.hardBounces / recentTotals.sent
    const unsubscribeRate = recentTotals.unsubscribes / recentTotals.sent
    const spamRate = recentTotals.spam / recentTotals.sent

    if (hardBounceRate > 0.02 || unsubscribeRate > 0.005 || spamRate > 0.001) {
      readinessBand = readinessBand === 'red' ? 'red' : 'amber'
      readinessReasons.push('Recent sender health is degraded based on local bounce, unsubscribe, or spam rates.')
    }
  }

  if (readinessReasons.length === 0) {
    readinessReasons.push('Sender is active, webhook ingestion is configured, and recent local health is within tolerance.')
  }

  return {
    readinessBand,
    readinessReasons,
    sender,
    domain,
    webhookConfigured
  }
}

export async function createCampaignRecipients(campaignId) {
  const campaign = await Campaign.findById(campaignId)
  if (!campaign) {
    throw new Error('Campaign not found.')
  }

  const existingCount = await CampaignRecipient.countDocuments({ campaign: campaign._id })
  if (existingCount > 0) {
    return existingCount
  }

  const audience = await CampaignAudience.findById(campaign.audience).lean()
  if (!audience) {
    throw new Error('Campaign audience not found.')
  }

  const activeContacts = Array.isArray(audience.contacts) ? audience.contacts.filter((contact) => contact.status === 'active') : []
  const suppressedRows = activeContacts.length > 0
    ? await CampaignSuppression.find({
      normalizedEmail: { $in: activeContacts.map((contact) => contact.normalizedEmail) }
    }).select('normalizedEmail').lean()
    : []
  const suppressedEmails = new Set(suppressedRows.map((row) => row.normalizedEmail))
  const contacts = activeContacts.filter((contact) => !suppressedEmails.has(contact.normalizedEmail))
  if (contacts.length === 0) {
    throw new Error('Audience does not contain any active, non-suppressed contacts.')
  }

  const recipientDocs = contacts.map((contact) => ({
    campaign: campaign._id,
    audience: audience._id,
    email: contact.email,
    normalizedEmail: contact.normalizedEmail,
    firstName: contact.firstName || '',
    lastName: contact.lastName || '',
    role: contact.role || '',
    jobTitle: contact.jobTitle || '',
    jobLevel: contact.jobLevel || '',
    department: contact.department || '',
    companyName: contact.companyName || '',
    industry: contact.industry || '',
    headcount: contact.companyHeadCount || '',
    location: contact.location || '',
    companyDescription: contact.companyDescription || '',
    tailoredMessage: contact.tailoredMessage || '',
    rawAttributes: contact.metadata || {},
    personalization: buildRecipientPersonalization(contact),
    status: 'queued'
  }))

  await CampaignRecipient.insertMany(recipientDocs, { ordered: false })

  campaign.audienceSnapshot = {
    audienceId: audience._id,
    name: audience.name,
    totalRecipients: recipientDocs.length,
    validRecipients: recipientDocs.length,
    excludedRecipients: Math.max((audience.importSummary?.validRecipients || activeContacts.length) - recipientDocs.length, 0)
  }
  campaign.metrics.queued = recipientDocs.length
  campaign.pacing.batchCount = 0
  await campaign.save()

  return recipientDocs.length
}

export async function createCampaignBatches(campaignId) {
  const campaign = await Campaign.findById(campaignId)
  if (!campaign) {
    throw new Error('Campaign not found.')
  }

  const existingBatches = await CampaignBatch.countDocuments({ campaign: campaign._id })
  if (existingBatches > 0) {
    return existingBatches
  }

  const recipients = await CampaignRecipient.find({ campaign: campaign._id })
    .sort({ normalizedEmail: 1 })
    .select('_id')
    .lean()

  const batchSize = Math.max(1, Number(campaign?.pacing?.batchSize || 200))
  const intervalMinutes = Math.max(1, Number(campaign?.pacing?.intervalMinutes || 30))
  const startAt = campaign?.pacing?.startAt ? new Date(campaign.pacing.startAt) : new Date()
  const chunks = splitIntoChunks(recipients, batchSize)
  const steps = getCampaignSequenceSteps(campaign.toObject())
  const batchDocs = []
  let sequence = 0
  let previousStepLastAt = startAt

  steps.forEach((step, stepIndex) => {
    const stepStartAt = stepIndex === 0
      ? startAt
      : new Date(previousStepLastAt.getTime() + sequenceDelayMilliseconds(step.delay))

    chunks.forEach((chunk, chunkIndex) => {
      sequence += 1
      batchDocs.push({
        campaign: campaign._id,
        sequence,
        stepId: step._id || null,
        stepIndex,
        stepName: step.name || `Message ${stepIndex + 1}`,
        status: 'pending',
        scheduledAt: new Date(stepStartAt.getTime() + (chunkIndex * intervalMinutes * 60 * 1000)),
        recipientIds: chunk.map((recipient) => recipient._id),
        recipientCount: chunk.length
      })
    })

    previousStepLastAt = new Date(stepStartAt.getTime() + (Math.max(chunks.length - 1, 0) * intervalMinutes * 60 * 1000))
  })

  const batches = await CampaignBatch.insertMany(batchDocs, { ordered: true })
  await Promise.all(batches.filter((batch) => Number(batch.stepIndex || 0) === 0).map((batch) => CampaignRecipient.updateMany(
    { _id: { $in: batch.recipientIds } },
    { $set: { batch: batch._id } }
  )))

  campaign.pacing.batchCount = batches.length
  campaign.pacing.nextBatchAt = batches[0]?.scheduledAt || null
  await campaign.save()

  return batches.length
}

export async function launchCampaign(campaignId, {
  adminId = null,
  overrideSenderQuality = false
} = {}) {
  const campaign = await Campaign.findById(campaignId)
  if (!campaign) {
    throw new Error('Campaign not found.')
  }
  if (!['draft', 'ready', 'scheduled'].includes(campaign.status)) {
    throw new Error(`Campaign cannot be launched from ${campaign.status} status.`)
  }
  if (!campaign.audience) {
    throw new Error('Attach an audience before launching this campaign.')
  }
  const sequenceSteps = getCampaignSequenceSteps(campaign.toObject())
  const invalidMessage = sequenceSteps.find((step) => {
    const content = step?.content || {}
    const hasSubject = Boolean(String(content.subject || '').trim())
    const hasBody = content.designMode === 'html'
      ? Boolean(String(content.htmlContent || '').trim())
      : (Array.isArray(content.design?.blocks) && content.design.blocks.length > 0)
    const complianceSource = content.designMode === 'html'
      ? String(content.htmlContent || '')
      : JSON.stringify(content.design || {})
    return !hasSubject || !hasBody || !/\{\{\s*unsubscribe\s*\}\}/i.test(complianceSource)
  })
  if (invalidMessage) {
    throw new Error(`${invalidMessage.name || 'A sequence message'} needs a subject, message content, and an unsubscribe footer before launch.`)
  }

  const audienceConsent = await CampaignAudience.findById(campaign.audience).select('consent').lean()
  if (!audienceConsent) {
    throw new Error('Campaign audience not found.')
  }
  if (!audienceConsent?.consent?.confirmedAt || audienceConsent?.consent?.basis === 'not_recorded') {
    throw new Error('Confirm and document the audience contact basis before launching this campaign.')
  }

  const senderReadiness = await computeSenderReadiness(campaign?.sender?.email || '')
  campaign.sender = {
    ...campaign.sender?.toObject?.(),
    email: campaign?.sender?.email || '',
    name: campaign?.sender?.name || '',
    senderId: senderReadiness.sender?.id || campaign?.sender?.senderId || null,
    active: senderReadiness.sender ? senderReadiness.sender.active !== false : false,
    domain: campaign?.sender?.email?.split?.('@')?.[1] || campaign?.sender?.domain || '',
    readinessBand: senderReadiness.readinessBand,
    readinessReasons: senderReadiness.readinessReasons
  }

  if (senderReadiness.readinessBand === 'red' && !overrideSenderQuality) {
    await campaign.save()
    throw new Error(senderReadiness.readinessReasons.join(' '))
  }

  if (process.env.BREVO_MARKETING_WEBHOOK_PUBLIC_URL && process.env.BREVO_API_KEY) {
    const webhook = await brevoMarketingService.ensureMarketingWebhook({
      url: process.env.BREVO_MARKETING_WEBHOOK_PUBLIC_URL,
      description: 'Seemplify marketing campaign webhook',
      secret: process.env.BREVO_MARKETING_WEBHOOK_SECRET || ''
    }).catch(() => null)
    if (webhook?.id) {
      campaign.brevo = {
        ...campaign.brevo,
        webhookId: webhook.id
      }
    }
  }

  await createCampaignRecipients(campaign._id)
  await createCampaignBatches(campaign._id)

  campaign.status = 'running'
  campaign.launchedAt = new Date()
  campaign.updatedBy = adminId || campaign.updatedBy
  await campaign.save()

  return campaign
}

export async function pauseCampaign(campaignId, adminId = null) {
  const campaign = await Campaign.findById(campaignId)
  if (!campaign) {
    throw new Error('Campaign not found.')
  }

  campaign.status = 'paused'
  campaign.pausedAt = new Date()
  campaign.updatedBy = adminId || campaign.updatedBy
  await campaign.save()

  await CampaignBatch.updateMany(
    { campaign: campaign._id, status: 'pending' },
    { $set: { status: 'paused' } }
  )

  return campaign
}

export async function resumeCampaign(campaignId, adminId = null) {
  const campaign = await Campaign.findById(campaignId)
  if (!campaign) {
    throw new Error('Campaign not found.')
  }

  const resumedAt = new Date()
  const pauseDuration = campaign.pausedAt
    ? Math.max(0, resumedAt.getTime() - new Date(campaign.pausedAt).getTime())
    : 0
  campaign.status = 'running'
  campaign.pausedAt = null
  campaign.updatedBy = adminId || campaign.updatedBy
  await campaign.save()

  const pausedBatches = await CampaignBatch.find({ campaign: campaign._id, status: 'paused' })
  await Promise.all(pausedBatches.map((batch) => {
    batch.status = 'pending'
    if (pauseDuration > 0 && batch.scheduledAt) {
      batch.scheduledAt = new Date(new Date(batch.scheduledAt).getTime() + pauseDuration)
    }
    return batch.save()
  }))

  campaign.pacing.nextBatchAt = await CampaignBatch.findOne({ campaign: campaign._id, status: 'pending' })
    .sort({ scheduledAt: 1 })
    .select('scheduledAt')
    .lean()
    .then((batch) => batch?.scheduledAt || null)
  await campaign.save()

  return campaign
}

export async function cancelCampaign(campaignId, adminId = null) {
  const campaign = await Campaign.findById(campaignId)
  if (!campaign) {
    throw new Error('Campaign not found.')
  }

  campaign.status = 'cancelled'
  campaign.cancelledAt = new Date()
  campaign.updatedBy = adminId || campaign.updatedBy
  await campaign.save()

  await CampaignBatch.updateMany(
    { campaign: campaign._id, status: { $in: ['pending', 'paused'] } },
    { $set: { status: 'cancelled' } }
  )

  await CampaignRecipient.updateMany(
    { campaign: campaign._id, 'sequence.exitReason': { $exists: false } },
    { $set: { 'sequence.exitReason': 'cancelled', 'sequence.completedAt': new Date() } }
  )

  return campaign
}

export async function claimNextDueBatch(workerId) {
  const now = new Date()
  const leaseExpiry = new Date(now.getTime() + 5 * 60 * 1000)

  const batch = await CampaignBatch.findOneAndUpdate({
    status: 'pending',
    scheduledAt: { $lte: now },
    $or: [
      { 'lease.expiresAt': { $exists: false } },
      { 'lease.expiresAt': { $lte: now } }
    ]
  }, {
    $set: {
      status: 'processing',
      startedAt: now,
      'lease.claimedBy': workerId,
      'lease.claimedAt': now,
      'lease.expiresAt': leaseExpiry,
      'lease.heartbeatAt': now
    },
    $inc: {
      attemptCount: 1
    }
  }, {
    new: true,
    sort: {
      scheduledAt: 1,
      sequence: 1
    }
  })

  if (!batch) {
    return null
  }

  const campaign = await Campaign.findById(batch.campaign)
  if (!campaign || campaign.status !== 'running') {
    await CampaignBatch.updateOne({ _id: batch._id }, {
      $set: { status: campaign?.status === 'cancelled' ? 'cancelled' : 'pending' },
      $unset: { lease: 1 }
    })
    return null
  }

  return batch
}

export async function processCampaignBatch(batchId) {
  const batch = await CampaignBatch.findById(batchId).populate('campaign')
  if (!batch) {
    throw new Error('Campaign batch not found.')
  }

  const campaign = batch.campaign
  if (!campaign) {
    throw new Error('Parent campaign not found.')
  }

  const allRecipients = await CampaignRecipient.find({ _id: { $in: batch.recipientIds } })
  if (allRecipients.length === 0) {
    throw new Error('Batch does not contain any recipients.')
  }

  const sequenceSteps = getCampaignSequenceSteps(campaign.toObject())
  const step = sequenceSteps[Number(batch.stepIndex || 0)] || sequenceSteps[0]
  const exited = new Map()
  let recipients = allRecipients.filter((recipient) => {
    const reason = recipientHasSequenceExit(recipient, campaign.sequence || {})
    if (reason) exited.set(recipient._id.toString(), reason)
    return !reason
  })

  if (exited.size > 0) {
    await Promise.all(Array.from(exited.entries()).map(([recipientId, reason]) => CampaignRecipient.updateOne(
      { _id: recipientId },
      { $set: { 'sequence.exitReason': reason, 'sequence.completedAt': new Date() } }
    )))
  }

  if (Number(batch.stepIndex || 0) > 0 && step.condition !== 'all' && recipients.length > 0) {
    const priorBatches = await CampaignBatch.find({
      campaign: campaign._id,
      stepIndex: Number(batch.stepIndex || 0) - 1,
      recipientIds: { $in: recipients.map((recipient) => recipient._id) }
    }).select('_id').lean()
    const engagementRows = priorBatches.length > 0
      ? await CampaignEvent.aggregate([
        {
          $match: {
            batch: { $in: priorBatches.map((priorBatch) => priorBatch._id) },
            recipient: { $in: recipients.map((recipient) => recipient._id) },
            eventType: { $in: ['opened', 'proxy_open', 'click'] }
          }
        },
        {
          $group: {
            _id: '$recipient',
            eventTypes: { $addToSet: '$eventType' }
          }
        }
      ])
      : []
    const engagement = new Map(engagementRows.map((row) => [row._id.toString(), {
      opened: row.eventTypes.includes('opened') || row.eventTypes.includes('proxy_open'),
      clicked: row.eventTypes.includes('click')
    }]))
    recipients = recipients.filter((recipient) => conditionMatchesEngagement(
      step.condition,
      engagement.get(recipient._id.toString()) || {}
    ))
  }

  if (recipients.length === 0) {
    const finishedAt = new Date()
    batch.status = 'skipped'
    batch.finishedAt = finishedAt
    batch.error = {
      code: 'no_eligible_recipients',
      message: 'No recipients remained after suppression, exit, and sequence-condition checks.',
      details: {},
      lastFailedAt: null
    }
    await batch.save()
    campaign.pacing.nextBatchAt = await CampaignBatch.findOne({ campaign: campaign._id, status: 'pending' })
      .sort({ scheduledAt: 1 })
      .select('scheduledAt')
      .lean()
      .then((nextBatch) => nextBatch?.scheduledAt || null)
    const activeBatchCount = await CampaignBatch.countDocuments({
      campaign: campaign._id,
      status: { $in: ['pending', 'processing'] }
    })
    if (activeBatchCount === 0) {
      campaign.completedAt = finishedAt
      campaign.status = 'completed'
      await CampaignRecipient.updateMany(
        { campaign: campaign._id, 'sequence.exitReason': { $exists: false } },
        { $set: { 'sequence.exitReason': 'completed', 'sequence.completedAt': finishedAt } }
      )
    }
    await campaign.save()
    return { batchId: batch._id, childCampaignId: null, recipientCount: 0, skipped: true }
  }

  await brevoMarketingService.ensureAttributes(getRequiredBrevoAttributes())
  const folder = await brevoMarketingService.ensureFolder(DEFAULT_FOLDER_NAME)
  const list = await brevoMarketingService.ensureList({
    folderId: folder.id,
    name: `${campaign.name} / ${step.name} / Batch ${batch.sequence}`
  })

  await brevoMarketingService.upsertContacts({
    listId: list.id,
    contacts: recipients.map((recipient) => ({
      email: recipient.email,
      attributes: buildBrevoContactAttributes(recipient)
    }))
  })

  const campaignForStep = {
    ...campaign.toObject(),
    content: step.content || campaign.content
  }
  const templateContent = compileCampaignTemplateContent(campaignForStep)
  const created = await brevoMarketingService.createEmailCampaign({
    name: `${campaign.name} / ${step.name} / Batch ${batch.sequence}`,
    subject: templateContent.subject,
    previewText: templateContent.previewText,
    sender: {
      name: campaign?.sender?.name || 'Seemplify',
      email: campaign?.sender?.email || ''
    },
    replyTo: campaignForStep?.content?.replyTo || undefined,
    htmlContent: templateContent.html,
    textContent: templateContent.text,
    recipients: {
      listIds: [list.id]
    }
  })

  const childCampaignId = created?.id
  if (!childCampaignId) {
    throw new Error('Brevo did not return a child campaign id.')
  }

  await brevoMarketingService.sendCampaignNow(childCampaignId)

  const sentAt = new Date()
  batch.status = 'sent'
  batch.finishedAt = sentAt
  batch.brevo = {
    ...batch.brevo,
    childCampaignId,
    listId: list.id,
    folderId: folder.id,
    sendTriggeredAt: sentAt
  }
  batch.metrics.sent = recipients.length
  await batch.save()

  await CampaignRecipient.updateMany(
    { _id: { $in: recipients.map((recipient) => recipient._id) } },
    {
      $set: {
        status: 'sent',
        sentAt,
        'sequence.lastSentStepIndex': Number(batch.stepIndex || 0),
        'sequence.lastSentStepId': step._id || null,
        'sequence.lastSentAt': sentAt,
        'brevo.childCampaignId': childCampaignId,
        'brevo.listId': list.id
      }
    }
  )

  campaign.metrics.sent = Number(campaign?.metrics?.sent || 0) + recipients.length
  campaign.metrics.queued = Math.max(Number(campaign?.metrics?.queued || 0) - recipients.length, 0)
  campaign.brevo.childCampaignIds = Array.from(new Set([...(campaign?.brevo?.childCampaignIds || []), childCampaignId]))
  campaign.pacing.nextBatchAt = await CampaignBatch.findOne({
    campaign: campaign._id,
    status: 'pending'
  }).sort({ scheduledAt: 1 }).select('scheduledAt').lean().then((nextBatch) => nextBatch?.scheduledAt || null)
  const activeBatchCount = await CampaignBatch.countDocuments({
    campaign: campaign._id,
    status: { $in: ['pending', 'processing'] }
  })
  if (activeBatchCount === 0) {
    campaign.completedAt = sentAt
    campaign.status = 'completed'
    await CampaignRecipient.updateMany(
      { campaign: campaign._id, 'sequence.exitReason': { $exists: false } },
      { $set: { 'sequence.exitReason': 'completed', 'sequence.completedAt': sentAt } }
    )
  }
  await campaign.save()

  return {
    batchId: batch._id,
    childCampaignId,
    recipientCount: recipients.length
  }
}

export async function getSenderHealthSummary({
  loadCampaignSenders = () => Campaign.find().select('sender').lean(),
  checkSender = computeSenderReadiness,
  logger = console
} = {}) {
  const campaigns = await loadCampaignSenders()
  const uniqueSenders = Array.from(new Set(
    campaigns
      .map((campaign) => String(campaign?.sender?.email || '').trim().toLowerCase())
      .filter(Boolean)
  ))

  const results = []
  for (const senderEmail of uniqueSenders) {
    try {
      const health = await checkSender(senderEmail)
      results.push({
        email: senderEmail,
        ...health
      })
    } catch (error) {
      logger.error?.('Campaign sender health check failed:', {
        senderEmail,
        message: error?.message || String(error)
      })
      results.push({
        email: senderEmail,
        readinessBand: 'red',
        readinessReasons: ['Sender health is temporarily unavailable. Verify the sender again before launch.'],
        sender: null,
        domain: null,
        webhookConfigured: false,
        unavailable: true
      })
    }
  }

  return results.sort((left, right) => left.email.localeCompare(right.email))
}

export async function getCampaignEventTotals(campaignId) {
  const rows = await CampaignEvent.aggregate([
    { $match: { campaign: campaignId } },
    {
      $group: {
        _id: '$eventType',
        count: { $sum: 1 }
      }
    }
  ])

  return rows.reduce((summary, row) => {
    summary[row._id] = row.count
    return summary
  }, {})
}
