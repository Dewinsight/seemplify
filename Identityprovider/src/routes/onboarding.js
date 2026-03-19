import express from 'express'
import multer from 'multer'
import { requireAuth, requireOrganizationMember } from '../middleware/permissions.js'
import { Organization } from '../models/Organization.js'
import { Account } from '../models/Account.js'
import { OnboardingTemplate } from '../models/OnboardingTemplate.js'
import { OnboardingAssignment } from '../models/OnboardingAssignment.js'
import { OnboardingActivity } from '../models/OnboardingActivity.js'
import { emailService } from '../services/emailService.js'
import { uploadBufferToCloudinary, isCloudinaryConfigured, deleteFromCloudinary } from '../services/cloudinaryService.js'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { normalizeManualOnboardingStatus } from '../utils/onboardingStatus.js'

const router = express.Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }
})

const ONBOARDING_MANAGER_ROLES = ['owner', 'admin', 'hr_manager']
const WORKFLOW_TYPES = ['onboarding', 'agreement', 'policy', 'general']
const WORKFLOW_LABELS = {
  onboarding: 'Onboarding',
  agreement: 'Agreement Signing',
  policy: 'Policy Acknowledgement',
  general: 'General Document Workflow'
}

const canManageOnboarding = (role) => ONBOARDING_MANAGER_ROLES.includes(role)

const normalizeWorkflowType = (value, options = {}) => {
  const allowAll = options.allowAll === true
  const fallback = options.fallback || 'onboarding'
  const raw = String(value || '').trim().toLowerCase()

  if (allowAll && raw === 'all') {
    return 'all'
  }

  return WORKFLOW_TYPES.includes(raw) ? raw : fallback
}

const getWorkflowLabel = (value) => WORKFLOW_LABELS[normalizeWorkflowType(value)] || WORKFLOW_LABELS.onboarding

const parseJson = (value, fallback) => {
  if (!value) return fallback
  if (typeof value === 'object') return value
  try {
    return JSON.parse(value)
  } catch (error) {
    return fallback
  }
}

const normalizeSigners = (signers = []) => {
  if (!Array.isArray(signers)) return []

  return signers
    .map(signer => {
      if (!signer) return null

      if (typeof signer === 'string') {
        return {
          key: signer,
          type: signer === 'assignee' ? 'assignee' : 'member',
          memberId: signer === 'assignee' ? undefined : signer
        }
      }

      const key = signer.key || signer.memberId || signer.member || signer.id
      if (!key) return null

      const type = signer.type || (key === 'assignee' ? 'assignee' : 'member')
      return {
        key: String(key),
        type,
        memberId: type === 'member' ? String(signer.memberId || key) : undefined,
        label: signer.label || signer.name || signer.email
      }
    })
    .filter(Boolean)
}

const normalizeSignatureFields = (fields = []) => {
  if (!Array.isArray(fields)) return []

  return fields
    .map(field => {
      const page = Number(field.page)
      const x = Number(field.x)
      const y = Number(field.y)
      const width = Number(field.width)
      const height = Number(field.height)
      const signerKey = field.signerKey || field.signerId || field.signer

      return {
        label: field.label ? String(field.label).trim() : 'Signature',
        type: field.type && ['signature', 'date', 'text'].includes(field.type)
          ? field.type
          : 'signature',
        page: Number.isFinite(page) && page > 0 ? page : 1,
        x: Number.isFinite(x) ? x : 50,
        y: Number.isFinite(y) ? y : 50,
        width: Number.isFinite(width) && width > 0 ? width : 180,
        height: Number.isFinite(height) && height > 0 ? height : 60,
        origin: field.origin === 'bottom-left' ? 'bottom-left' : 'top-left',
        text: field.text ? String(field.text).trim() : undefined,
        signerKey: signerKey ? String(signerKey) : undefined,
        signerId: field.signerId ? String(field.signerId) : undefined
      }
    })
    .filter(field => Number.isFinite(field.x) && Number.isFinite(field.y))
}

const normalizeItems = (items = []) => {
  if (!Array.isArray(items)) return []
  return items
    .map(item => {
      if (!item || !item.type || !item.title) return null

      const requiredValue = item.required
      const isRequired = requiredValue === false || requiredValue === 'false' ? false : true

      const base = {
        type: item.type,
        title: String(item.title).trim(),
        description: item.description ? String(item.description).trim() : '',
        required: isRequired,
        config: {}
      }

      if (base.type === 'form') {
        const fields = item.config?.fields || item.fields || []
        base.config.fields = Array.isArray(fields)
          ? fields
            .map(field => ({
              key: String(field.key || field.label || '').trim().toLowerCase().replace(/\s+/g, '_'),
              label: String(field.label || field.key || '').trim(),
              type: field.type || 'text',
              required: field.required === true || field.required === 'true' || field.required === 'required',
              options: Array.isArray(field.options) ? field.options : []
            }))
            .filter(field => field.label)
          : []
      }

      if (base.type === 'upload') {
        base.config.accept = item.config?.accept || item.accept || '.pdf,.jpg,.jpeg,.png'
      }

      if (base.type === 'esign') {
        base.config.document = item.config?.document || item.document || null
        base.config.signatureFields = normalizeSignatureFields(
          item.config?.signatureFields || item.signatureFields || []
        )
        base.config.signers = normalizeSigners(
          item.config?.signers || item.signers || []
        )
      }

      return base
    })
    .filter(Boolean)
}

const updateAssignmentStatus = (assignment) => {
  if (assignment.status === 'cancelled') return
  const requiredItems = assignment.items.filter(item => item.required !== false)
  const completedRequired = requiredItems.length === 0
    ? assignment.items.every(item => item.status === 'completed')
    : requiredItems.every(item => item.status === 'completed')

  if (completedRequired) {
    assignment.status = 'completed'
    assignment.completedAt = new Date()
  } else if (assignment.items.some(item => item.status !== 'pending')) {
    assignment.status = 'in_progress'
  } else {
    assignment.status = 'pending'
  }
}

const buildActivityMetadata = (metadata = {}) => {
  const normalized = {}

  if (metadata.template) normalized.template = metadata.template
  if (metadata.previousStatus) normalized.previousStatus = metadata.previousStatus
  if (metadata.nextStatus) normalized.nextStatus = metadata.nextStatus
  if (metadata.triggerItemId) normalized.triggerItemId = metadata.triggerItemId
  if (metadata.triggerItemType) normalized.triggerItemType = metadata.triggerItemType
  if (metadata.dueAt) normalized.dueAt = metadata.dueAt

  return normalized
}

const logOnboardingActivity = async ({
  organization,
  assignment,
  member,
  actor,
  type,
  metadata = {}
}) => {
  try {
    const payload = {
      organization,
      assignment,
      member,
      actor,
      type,
      metadata: buildActivityMetadata(metadata)
    }

    if (type === 'assignment_completed') {
      await OnboardingActivity.findOneAndUpdate(
        { assignment, type },
        { $setOnInsert: payload },
        { upsert: true }
      )
      return
    }

    await OnboardingActivity.create(payload)
  } catch (error) {
    console.error('Failed to record onboarding activity:', error)
  }
}

const logAssignmentCompletionIfNeeded = async ({
  assignment,
  previousStatus,
  actor,
  triggerItem
}) => {
  if (!assignment) return
  if (previousStatus === 'completed') return
  if (assignment.status !== 'completed') return

  await logOnboardingActivity({
    organization: assignment.organization,
    assignment: assignment._id,
    member: assignment.member,
    actor,
    type: 'assignment_completed',
    metadata: {
      previousStatus,
      nextStatus: assignment.status,
      triggerItemId: triggerItem?._id,
      triggerItemType: triggerItem?.type
    }
  })
}

const resolveEsignSigners = async (item, memberId, organization) => {
  if (item.type !== 'esign') return item

  const signersInput = item.config?.signers?.length
    ? item.config.signers
    : [{ key: 'assignee', type: 'assignee' }]

  const resolved = []
  const seen = new Set()

  for (const signer of signersInput) {
    const key = signer.key || signer.memberId || signer.member || signer.id || signer
    const type = signer.type || (key === 'assignee' ? 'assignee' : 'member')
    const accountId = type === 'assignee' || key === 'assignee'
      ? memberId
      : key

    if (!accountId) continue
    const accountIdStr = accountId.toString()
    if (seen.has(accountIdStr)) continue

    const memberEntry = organization.members.find(m => {
      const memberAccountId = (m.account?._id || m.account).toString()
      return memberAccountId === accountIdStr && m.status === 'active'
    })
    if (!memberEntry) continue

    const account = await Account.findById(accountId).select('email profile.name')
    if (!account) continue

    resolved.push({
      member: account._id,
      name: account.profile?.name || account.email.split('@')[0],
      email: account.email
    })
    seen.add(accountIdStr)
  }

  if (resolved.length === 0) {
    const account = await Account.findById(memberId).select('email profile.name')
    if (account) {
      resolved.push({
        member: account._id,
        name: account.profile?.name || account.email.split('@')[0],
        email: account.email
      })
    }
  }

  item.config.signers = resolved

  const defaultSignerId = resolved[0]?.member?.toString()
  item.config.signatureFields = (item.config.signatureFields || []).map(field => {
    const rawKey = field.signerId || field.signerKey || field.signer
    let signerId = rawKey && rawKey !== 'assignee' ? rawKey.toString() : null
    if (!signerId || !resolved.find(signer => signer.member.toString() === signerId)) {
      signerId = defaultSignerId || memberId.toString()
    }
    return {
      ...field,
      signerId,
      signerKey: undefined
    }
  })

  item.data = item.data || {}
  item.data.esign = item.data.esign || {}
  item.data.esign.signers = resolved.map(signer => ({
    member: signer.member,
    name: signer.name,
    email: signer.email,
    status: 'pending'
  }))

  return item
}

const buildOnboardingEmail = (memberName, orgName, issuerUrl, workflowType = 'onboarding') => {
  const normalizedWorkflowType = normalizeWorkflowType(workflowType)
  const workflowLabel = getWorkflowLabel(normalizedWorkflowType)
  const baseUrl = issuerUrl || 'http://localhost:4000'
  const workspaceUrl = `${baseUrl}/notifications?category=documents`
  const actionLabel = 'Open Notifications'
  const introLine = normalizedWorkflowType === 'onboarding'
    ? 'Your onboarding tasks are ready. Please complete them to finish your setup.'
    : `You have ${workflowLabel.toLowerCase()} tasks ready for review and signing.`

  return {
    subject: `${workflowLabel} action required for ${orgName}`,
    html: `
      <h2>Welcome to ${orgName}</h2>
      <p>Hi ${memberName},</p>
      <p>${introLine}</p>
      <p><a href="${workspaceUrl}" style="display:inline-block;padding:12px 22px;background:#6366f1;color:#fff;text-decoration:none;border-radius:8px;">${actionLabel}</a></p>
      <p style="font-size:12px;color:#94a3b8;">Open Notifications to review this task and any other pending actions: ${workspaceUrl}</p>
    `,
    text: `Hi ${memberName},\n\n${introLine}\n\nOpen Notifications to review your pending tasks: ${workspaceUrl}`
  }
}

// =========================
// Admin: Templates
// =========================
router.get('/organizations/:orgId/onboarding/templates', requireAuth, requireOrganizationMember, async (req, res) => {
  if (!canManageOnboarding(req.memberRole)) {
    return res.status(403).json({ error: 'Insufficient permissions to manage onboarding' })
  }

  try {
    const workflowType = normalizeWorkflowType(req.query.workflowType || req.query.workflow, {
      allowAll: true,
      fallback: 'all'
    })
    const query = { organization: req.params.orgId }
    if (workflowType !== 'all') {
      query.workflowType = workflowType
    }

    const templates = await OnboardingTemplate.find(query)
      .sort({ createdAt: -1 })

    templates.forEach(template => {
      if (!template.workflowType) {
        template.workflowType = 'onboarding'
      }
    })

    res.json(templates)
  } catch (error) {
    console.error('Get onboarding templates error:', error)
    res.status(500).json({ error: 'Failed to fetch onboarding templates' })
  }
})

router.post('/organizations/:orgId/onboarding/templates', requireAuth, requireOrganizationMember, async (req, res) => {
  if (!canManageOnboarding(req.memberRole)) {
    return res.status(403).json({ error: 'Insufficient permissions to manage onboarding' })
  }

  try {
    const { name, description, isDefault } = req.body
    const workflowType = normalizeWorkflowType(req.body.workflowType)
    const itemsInput = parseJson(req.body.items, [])
    const items = normalizeItems(itemsInput)

    if (!name || items.length === 0) {
      return res.status(400).json({ error: 'Template name and at least one item are required' })
    }

    const template = await OnboardingTemplate.create({
      organization: req.params.orgId,
      name: String(name).trim(),
      description: description ? String(description).trim() : '',
      workflowType,
      isDefault: isDefault === true || isDefault === 'true',
      items,
      createdBy: req.user._id
    })

    if (template.isDefault) {
      await OnboardingTemplate.updateMany(
        {
          organization: req.params.orgId,
          workflowType: template.workflowType,
          _id: { $ne: template._id }
        },
        { $set: { isDefault: false } }
      )
    }

    res.status(201).json(template)
  } catch (error) {
    console.error('Create onboarding template error:', error)
    res.status(500).json({ error: 'Failed to create onboarding template' })
  }
})

router.patch('/organizations/:orgId/onboarding/templates/:templateId', requireAuth, requireOrganizationMember, async (req, res) => {
  if (!canManageOnboarding(req.memberRole)) {
    return res.status(403).json({ error: 'Insufficient permissions to manage onboarding' })
  }

  try {
    const updates = {}
    if (req.body.name) updates.name = String(req.body.name).trim()
    if (req.body.description !== undefined) updates.description = String(req.body.description || '').trim()

    if (req.body.items !== undefined) {
      const itemsInput = parseJson(req.body.items, [])
      const items = normalizeItems(itemsInput)
      updates.items = items
    }

    if (req.body.isDefault !== undefined) {
      updates.isDefault = req.body.isDefault === true || req.body.isDefault === 'true'
    }
    if (req.body.workflowType !== undefined) {
      updates.workflowType = normalizeWorkflowType(req.body.workflowType)
    }

    const template = await OnboardingTemplate.findOneAndUpdate(
      { _id: req.params.templateId, organization: req.params.orgId },
      { $set: updates },
      { new: true }
    )

    if (!template) {
      return res.status(404).json({ error: 'Template not found' })
    }

    if (template.isDefault) {
      await OnboardingTemplate.updateMany(
        {
          organization: req.params.orgId,
          workflowType: template.workflowType,
          _id: { $ne: template._id }
        },
        { $set: { isDefault: false } }
      )
    }

    res.json(template)
  } catch (error) {
    console.error('Update onboarding template error:', error)
    res.status(500).json({ error: 'Failed to update onboarding template' })
  }
})

router.delete('/organizations/:orgId/onboarding/templates/:templateId', requireAuth, requireOrganizationMember, async (req, res) => {
  if (!canManageOnboarding(req.memberRole)) {
    return res.status(403).json({ error: 'Insufficient permissions to manage onboarding' })
  }

  try {
    const result = await OnboardingTemplate.findOneAndDelete({
      _id: req.params.templateId,
      organization: req.params.orgId
    })

    if (!result) {
      return res.status(404).json({ error: 'Template not found' })
    }

    res.json({ message: 'Template deleted' })
  } catch (error) {
    console.error('Delete onboarding template error:', error)
    res.status(500).json({ error: 'Failed to delete onboarding template' })
  }
})

// =========================
// Admin: Document upload for e-sign
// =========================
router.post('/organizations/:orgId/onboarding/documents',
  requireAuth,
  requireOrganizationMember,
  upload.single('file'),
  async (req, res) => {
    if (!canManageOnboarding(req.memberRole)) {
      return res.status(403).json({ error: 'Insufficient permissions to manage onboarding' })
    }

    if (!req.file) {
      return res.status(400).json({ error: 'File is required' })
    }

    if (!req.file.mimetype.includes('pdf')) {
      return res.status(400).json({ error: 'Only PDF documents are allowed for e-signing' })
    }

    if (!isCloudinaryConfigured()) {
      return res.status(500).json({ error: 'Cloudinary is not configured' })
    }

    try {
      const uploadResult = await uploadBufferToCloudinary({
        buffer: req.file.buffer,
        filename: req.file.originalname,
        folder: `seemplify/onboarding/${req.params.orgId}`,
        resourceType: 'raw'
      })

      res.json({
        url: uploadResult.secure_url,
        publicId: uploadResult.public_id,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size
      })
    } catch (error) {
      console.error('Onboarding document upload error:', error)
      res.status(500).json({ error: 'Failed to upload document' })
    }
  }
)

router.post('/organizations/:orgId/onboarding/documents/delete', requireAuth, requireOrganizationMember, async (req, res) => {
  if (!canManageOnboarding(req.memberRole)) {
    return res.status(403).json({ error: 'Insufficient permissions to manage onboarding' })
  }

  const { publicId } = req.body || {}
  if (!publicId || typeof publicId !== 'string') {
    return res.status(400).json({ error: 'publicId is required' })
  }

  const expectedPrefix = `seemplify/onboarding/${req.params.orgId}/`
  if (!publicId.startsWith(expectedPrefix)) {
    return res.status(400).json({ error: 'Invalid document reference' })
  }

  if (!isCloudinaryConfigured()) {
    return res.status(500).json({ error: 'Cloudinary is not configured' })
  }

  try {
    await deleteFromCloudinary({ publicId, resourceType: 'raw' })
    res.json({ message: 'Document deleted' })
  } catch (error) {
    console.error('Onboarding document delete error:', error)
    res.status(500).json({ error: 'Failed to delete document' })
  }
})

// =========================
// Admin: Assign onboarding
// =========================
router.post('/organizations/:orgId/onboarding/assign', requireAuth, requireOrganizationMember, async (req, res) => {
  if (!canManageOnboarding(req.memberRole)) {
    return res.status(403).json({ error: 'Insufficient permissions to manage onboarding' })
  }

  try {
    const { memberId, templateId, useDefaultTemplate, dueAt } = req.body
    const requestedWorkflowType = normalizeWorkflowType(req.body.workflowType)
    const customItemsInput = parseJson(req.body.customItems, [])
    const customItems = normalizeItems(customItemsInput)

    if (!memberId) {
      return res.status(400).json({ error: 'Member is required' })
    }

    const organization = await Organization.findById(req.params.orgId)
    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' })
    }

    const memberEntry = organization.members.find(m => m.account.toString() === memberId && m.status === 'active')
    if (!memberEntry) {
      return res.status(404).json({ error: 'Member not found in this organization' })
    }

    let template = null
    if (templateId) {
      template = await OnboardingTemplate.findOne({ _id: templateId, organization: req.params.orgId })
    } else if (useDefaultTemplate === true || useDefaultTemplate === 'true') {
      template = await OnboardingTemplate.findOne({
        organization: req.params.orgId,
        workflowType: requestedWorkflowType,
        isDefault: true
      })
    }

    if ((useDefaultTemplate === true || useDefaultTemplate === 'true') && !template && customItems.length === 0) {
      return res.status(400).json({
        error: 'No default onboarding template found. Create one in the document workspace or assign onboarding manually there.'
      })
    }

    const templateItems = template ? normalizeItems(template.items.map(item => item.toObject())) : []
    const items = [...templateItems, ...customItems]
    const resolvedWorkflowType = template
      ? normalizeWorkflowType(template.workflowType, { fallback: requestedWorkflowType })
      : requestedWorkflowType

    if (items.length === 0) {
      return res.status(400).json({ error: 'At least one onboarding item is required' })
    }

    const resolvedItems = await Promise.all(
      items.map(item => resolveEsignSigners(item, memberId, organization))
    )

    if (memberEntry.onboardingStatusOverride) {
      await organization.setMemberOnboardingStatusOverride(memberId, null, req.user._id)
    }

    const assignment = await OnboardingAssignment.create({
      organization: req.params.orgId,
      member: memberId,
      createdBy: req.user._id,
      template: template?._id,
      workflowType: resolvedWorkflowType,
      items: resolvedItems,
      dueAt: dueAt ? new Date(dueAt) : undefined
    })

    await logOnboardingActivity({
      organization: req.params.orgId,
      assignment: assignment._id,
      member: memberId,
      actor: req.user._id,
      type: 'assignment_created',
      metadata: {
        template: template?._id,
        nextStatus: assignment.status,
        dueAt: assignment.dueAt
      }
    })

    const memberAccount = await Account.findById(memberId)
    if (memberAccount?.email) {
      const memberName = memberAccount.profile?.name || memberAccount.email.split('@')[0]
      const orgName = organization.name
      const { subject, html, text } = buildOnboardingEmail(
        memberName,
        orgName,
        process.env.ISSUER_URL,
        resolvedWorkflowType
      )

      try {
        await emailService.sendEmail({
          to: memberAccount.email,
          subject,
          html,
          text
        })
      } catch (emailError) {
        console.error('Failed to send onboarding email:', emailError)
      }
    }

    res.status(201).json(assignment)
  } catch (error) {
    console.error('Assign onboarding error:', error)
    res.status(500).json({ error: 'Failed to assign onboarding' })
  }
})

router.patch('/organizations/:orgId/onboarding/members/:memberId/status', requireAuth, requireOrganizationMember, async (req, res) => {
  if (!canManageOnboarding(req.memberRole)) {
    return res.status(403).json({ error: 'Insufficient permissions to manage onboarding' })
  }

  try {
    const organization = await Organization.findById(req.params.orgId)
    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' })
    }

    const normalizedStatus = normalizeManualOnboardingStatus(req.body?.status)
    const shouldClearOverride = req.body?.clearOverride === true || req.body?.clearOverride === 'true'

    if (!shouldClearOverride && !normalizedStatus) {
      return res.status(400).json({
        error: 'A valid onboarding status is required'
      })
    }

    const memberEntry = organization.members.find(
      m => m.account.toString() === req.params.memberId && m.status === 'active'
    )

    if (!memberEntry) {
      return res.status(404).json({ error: 'Member not found in this organization' })
    }

    const updatedMember = await organization.setMemberOnboardingStatusOverride(
      req.params.memberId,
      shouldClearOverride ? null : normalizedStatus,
      req.user._id
    )

    res.json({
      message: shouldClearOverride
        ? 'Onboarding status reset to automatic tracking'
        : 'Onboarding status updated',
      memberId: req.params.memberId,
      onboardingStatusOverride: updatedMember.onboardingStatusOverride || null
    })
  } catch (error) {
    console.error('Update onboarding member status error:', error)
    res.status(500).json({ error: 'Failed to update onboarding status' })
  }
})

router.get('/organizations/:orgId/onboarding/assignments', requireAuth, requireOrganizationMember, async (req, res) => {
  if (!canManageOnboarding(req.memberRole)) {
    return res.status(403).json({ error: 'Insufficient permissions to manage onboarding' })
  }

  try {
    const workflowType = normalizeWorkflowType(req.query.workflowType || req.query.workflow, {
      allowAll: true,
      fallback: 'all'
    })
    const query = { organization: req.params.orgId }
    if (workflowType !== 'all') {
      query.workflowType = workflowType
    }

    const assignments = await OnboardingAssignment.find(query)
      .populate('member', 'email profile.name')
      .populate('createdBy', 'email profile.name')
      .sort({ createdAt: -1 })

    assignments.forEach(assignment => {
      if (!assignment.workflowType) {
        assignment.workflowType = 'onboarding'
      }
    })

    res.json(assignments)
  } catch (error) {
    console.error('Get onboarding assignments error:', error)
    res.status(500).json({ error: 'Failed to fetch onboarding assignments' })
  }
})

router.patch('/organizations/:orgId/onboarding/assignments/:assignmentId/cancel', requireAuth, requireOrganizationMember, async (req, res) => {
  if (!canManageOnboarding(req.memberRole)) {
    return res.status(403).json({ error: 'Insufficient permissions to manage onboarding' })
  }

  try {
    const assignment = await OnboardingAssignment.findOne({
      _id: req.params.assignmentId,
      organization: req.params.orgId
    })

    if (!assignment) {
      return res.status(404).json({ error: 'Onboarding assignment not found' })
    }

    if (assignment.status === 'cancelled') {
      return res.json({ message: 'Assignment already cancelled', assignment })
    }

    const previousStatus = assignment.status
    assignment.status = 'cancelled'
    assignment.cancelledAt = new Date()
    await assignment.save()

    await logOnboardingActivity({
      organization: assignment.organization,
      assignment: assignment._id,
      member: assignment.member,
      actor: req.user._id,
      type: 'assignment_cancelled',
      metadata: {
        previousStatus,
        nextStatus: assignment.status
      }
    })

    res.json({ message: 'Assignment cancelled', assignment })
  } catch (error) {
    console.error('Cancel onboarding assignment error:', error)
    res.status(500).json({ error: 'Failed to cancel onboarding assignment' })
  }
})

// =========================
// Employee: My onboarding
// =========================
router.get('/onboarding/my', requireAuth, async (req, res) => {
  try {
    const workflowType = normalizeWorkflowType(req.query.workflowType || req.query.workflow, {
      allowAll: true,
      fallback: 'all'
    })
    const query = {
      $or: [
        { member: req.user._id },
        { 'items.config.signers.member': req.user._id },
        { 'items.data.esign.signers.member': req.user._id }
      ],
      status: { $ne: 'completed' }
    }
    if (workflowType !== 'all') {
      query.workflowType = workflowType
    }

    const assignments = await OnboardingAssignment.find(query)
      .populate('organization', 'name')
      .sort({ createdAt: -1 })

    assignments.forEach(assignment => {
      if (!assignment.workflowType) {
        assignment.workflowType = 'onboarding'
      }
    })

    res.json(assignments)
  } catch (error) {
    console.error('Get my onboarding error:', error)
    res.status(500).json({ error: 'Failed to fetch onboarding assignments' })
  }
})

router.post('/onboarding/:assignmentId/items/:itemId/form', requireAuth, async (req, res) => {
  try {
    const assignment = await OnboardingAssignment.findOne({
      _id: req.params.assignmentId,
      member: req.user._id
    })

    if (!assignment) {
      return res.status(404).json({ error: 'Onboarding assignment not found' })
    }

    const item = assignment.items.id(req.params.itemId)
    if (!item || item.type !== 'form') {
      return res.status(404).json({ error: 'Form item not found' })
    }

    item.data = item.data || {}
    item.data.form = req.body || {}
    item.status = 'completed'

    const previousStatus = assignment.status
    updateAssignmentStatus(assignment)
    await assignment.save()
    await logAssignmentCompletionIfNeeded({
      assignment,
      previousStatus,
      actor: req.user._id,
      triggerItem: item
    })

    res.json({ message: 'Form submitted', assignment })
  } catch (error) {
    console.error('Submit onboarding form error:', error)
    res.status(500).json({ error: 'Failed to submit form' })
  }
})

router.post('/onboarding/:assignmentId/items/:itemId/upload',
  requireAuth,
  upload.single('file'),
  async (req, res) => {
    try {
      const assignment = await OnboardingAssignment.findOne({
        _id: req.params.assignmentId,
        member: req.user._id
      })

      if (!assignment) {
        return res.status(404).json({ error: 'Onboarding assignment not found' })
      }

      const item = assignment.items.id(req.params.itemId)
      if (!item || item.type !== 'upload') {
        return res.status(404).json({ error: 'Upload item not found' })
      }

      if (!req.file) {
        return res.status(400).json({ error: 'File is required' })
      }

      if (!isCloudinaryConfigured()) {
        return res.status(500).json({ error: 'Cloudinary is not configured' })
      }

      const uploadResult = await uploadBufferToCloudinary({
        buffer: req.file.buffer,
        filename: req.file.originalname,
        folder: `seemplify/onboarding/${assignment.organization.toString()}/${assignment.member.toString()}`,
        resourceType: 'raw'
      })

      item.data = item.data || {}
      item.data.upload = {
        url: uploadResult.secure_url,
        publicId: uploadResult.public_id,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        uploadedAt: new Date()
      }
      item.status = 'completed'

      const previousStatus = assignment.status
      updateAssignmentStatus(assignment)
      await assignment.save()
      await logAssignmentCompletionIfNeeded({
        assignment,
        previousStatus,
        actor: req.user._id,
        triggerItem: item
      })

      res.json({ message: 'File uploaded', assignment })
    } catch (error) {
      console.error('Onboarding upload error:', error)
      res.status(500).json({ error: 'Failed to upload file' })
    }
  }
)

router.post('/onboarding/:assignmentId/items/:itemId/esign/complete', requireAuth, async (req, res) => {
  try {
    const { signatureDataUrl, signerName } = req.body || {}

    if (!signatureDataUrl) {
      return res.status(400).json({ error: 'Signature is required' })
    }

    const signatureMatch = signatureDataUrl.match(/^data:image\/(png|jpeg);base64,(.+)$/)
    if (!signatureMatch) {
      return res.status(400).json({ error: 'Invalid signature format' })
    }

    const signatureFormat = signatureMatch[1]
    const signatureBuffer = Buffer.from(signatureMatch[2], 'base64')

    const assignment = await OnboardingAssignment.findOne({
      _id: req.params.assignmentId
    })

    if (!assignment) {
      return res.status(404).json({ error: 'Onboarding assignment not found' })
    }

    const item = assignment.items.id(req.params.itemId)
    if (!item || item.type !== 'esign') {
      return res.status(404).json({ error: 'E-sign item not found' })
    }
    if (item.status === 'completed') {
      return res.status(400).json({ error: 'This document is already fully signed' })
    }

    const document = item.config?.document
    if (!document?.url) {
      return res.status(400).json({ error: 'No document attached for signing' })
    }

    const previousSignedPublicId = item.data?.esign?.signedPublicId

    const signerIdStr = req.user._id.toString()
    const configuredSigners = item.config?.signers?.length
      ? item.config.signers
      : [{ member: assignment.member }]
    const signerAllowed = configuredSigners.some(signer => signer?.member?.toString() === signerIdStr)
      || assignment.member?.toString() === signerIdStr

    if (!signerAllowed) {
      return res.status(403).json({ error: 'You are not assigned to sign this document' })
    }

    const sourceUrl = item.data?.esign?.signedUrl || document.url
    const docResponse = await fetch(sourceUrl)
    if (!docResponse.ok) {
      return res.status(500).json({ error: 'Failed to fetch document for signing' })
    }
    const arrayBuffer = await docResponse.arrayBuffer()

    const pdfDoc = await PDFDocument.load(arrayBuffer)
    const pages = pdfDoc.getPages()
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica)

    const signatureImage = signatureFormat === 'png'
      ? await pdfDoc.embedPng(signatureBuffer)
      : await pdfDoc.embedJpg(signatureBuffer)

    const allSignatureFields = item.config?.signatureFields?.length
      ? item.config.signatureFields
      : [{
          label: 'Signature',
          type: 'signature',
          page: 1,
          x: 50,
          y: 50,
          width: 180,
          height: 60,
          origin: 'top-left',
          signerId: signerIdStr
        }]

    const normalizeSignerId = (value) => {
      if (!value) return ''
      if (typeof value === 'string') return value
      if (typeof value === 'object') {
        // Serialized ObjectId from some JSON formats.
        if (typeof value.$oid === 'string') return value.$oid
        // Native/Mongoose ObjectId.
        if (typeof value.toHexString === 'function') return value.toHexString()
        // Avoid accessing `value._id` here: Mongoose ObjectId defines `_id` as a getter
        // that returns itself, which can cause infinite recursion.
        if (Object.prototype.hasOwnProperty.call(value, '_id')) {
          const next = value._id
          if (next && next !== value) return normalizeSignerId(next)
        }
      }
      try {
        return String(value)
      } catch (e) {
        return ''
      }
    }

    const signatureFields = allSignatureFields.filter(field => {
      const rawSigner = normalizeSignerId(field.signerKey || field.signerId || field.signer)
      if (!rawSigner) return true
      const resolvedSigner = rawSigner === 'assignee' ? assignment.member.toString() : rawSigner
      return resolvedSigner === signerIdStr
    })

    if (signatureFields.length === 0) {
      return res.status(400).json({ error: 'No signature fields assigned to you' })
    }

    const now = new Date()
    const dateText = now.toLocaleDateString()
    const resolvedSignerName = signerName || req.user.profile?.name || req.user.email

    signatureFields.forEach(field => {
      const pageIndex = Math.min(pages.length - 1, Math.max(0, (field.page || 1) - 1))
      const page = pages[pageIndex]
      const pageHeight = page.getHeight()
      const origin = field.origin === 'bottom-left' ? 'bottom-left' : 'top-left'

      const drawX = Number(field.x) || 0
      const drawY = origin === 'top-left'
        ? pageHeight - (Number(field.y) || 0) - (Number(field.height) || 0)
        : (Number(field.y) || 0)
      const width = Number(field.width) || 180
      const height = Number(field.height) || 60

      if (field.type === 'date') {
        page.drawText(dateText, {
          x: drawX,
          y: drawY + (height / 4),
          size: 11,
          font,
          color: rgb(0.1, 0.1, 0.1)
        })
      } else if (field.type === 'text') {
        const textValue = field.text || resolvedSignerName
        if (textValue) {
          page.drawText(textValue, {
            x: drawX,
            y: drawY + (height / 4),
            size: 11,
            font,
            color: rgb(0.1, 0.1, 0.1)
          })
        }
      } else {
        page.drawImage(signatureImage, {
          x: drawX,
          y: drawY,
          width,
          height
        })
      }
    })

    const signedPdfBytes = await pdfDoc.save()

    if (!isCloudinaryConfigured()) {
      return res.status(500).json({ error: 'Cloudinary is not configured' })
    }

    const baseFileName = (document.fileName || 'signed-document').replace(/\.[^/.]+$/, '')
    const signedFileName = `${baseFileName}-signed-${Date.now()}.pdf`
    const uploadResult = await uploadBufferToCloudinary({
      buffer: Buffer.from(signedPdfBytes),
      filename: signedFileName,
      folder: `seemplify/onboarding/${assignment.organization.toString()}/${assignment.member.toString()}`,
      resourceType: 'raw'
    })

    item.data = item.data || {}
    item.data.esign = item.data.esign || {}
    item.data.esign.originalUrl = item.data.esign.originalUrl || document.url
    item.data.esign.signedUrl = uploadResult.secure_url
    item.data.esign.signedPublicId = uploadResult.public_id
    item.data.esign.signedFileName = signedFileName
    item.data.esign.signedMimeType = 'application/pdf'

    const signersData = Array.isArray(item.data.esign.signers)
      ? item.data.esign.signers
      : configuredSigners.map(signer => ({
          member: signer.member,
          name: signer.name,
          email: signer.email,
          status: 'pending'
        }))

    let signerEntry = signersData.find(signer => signer.member?.toString() === signerIdStr)
    if (!signerEntry) {
      signerEntry = {
        member: req.user._id,
        name: req.user.profile?.name || req.user.email.split('@')[0],
        email: req.user.email,
        status: 'pending'
      }
      signersData.push(signerEntry)
    }
    signerEntry.status = 'signed'
    signerEntry.signedAt = now
    signerEntry.signerName = resolvedSignerName
    signerEntry.ipAddress = req.ip
    signerEntry.userAgent = req.headers['user-agent']

    item.data.esign.signers = signersData
    const allSigned = signersData.length > 0
      ? signersData.every(signer => signer.status === 'signed')
      : true

    item.data.esign.status = allSigned ? 'completed' : 'in_progress'
    item.data.esign.signedAt = allSigned ? now : item.data.esign.signedAt
    item.data.esign.signerEmail = req.user.email
    item.data.esign.signerName = resolvedSignerName
    item.data.esign.ipAddress = req.ip
    item.data.esign.userAgent = req.headers['user-agent']

    item.status = allSigned ? 'completed' : 'submitted'
    const previousStatus = assignment.status
    updateAssignmentStatus(assignment)
    await assignment.save()
    await logAssignmentCompletionIfNeeded({
      assignment,
      previousStatus,
      actor: req.user._id,
      triggerItem: item
    })

    if (previousSignedPublicId && previousSignedPublicId !== uploadResult.public_id) {
      try {
        await deleteFromCloudinary({ publicId: previousSignedPublicId, resourceType: 'raw' })
      } catch (deleteError) {
        console.error('Failed to delete old signed document from Cloudinary:', deleteError)
      }
    }

    res.json({ message: 'Document signed', signedUrl: uploadResult.secure_url, assignment })
  } catch (error) {
    console.error('Complete e-sign error:', error)
    res.status(500).json({ error: 'Failed to complete e-signing' })
  }
})

export default router
