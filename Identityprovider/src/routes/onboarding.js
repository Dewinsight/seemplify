import express from 'express'
import multer from 'multer'
import { requireAuth, requireOrganizationMember } from '../middleware/permissions.js'
import { Organization } from '../models/Organization.js'
import { Account } from '../models/Account.js'
import { OnboardingTemplate } from '../models/OnboardingTemplate.js'
import { OnboardingAssignment } from '../models/OnboardingAssignment.js'
import { OnboardingActivity } from '../models/OnboardingActivity.js'
import { emailService } from '../services/emailService.js'
import cloudinary, { uploadBufferToCloudinary, isCloudinaryConfigured, deleteFromCloudinary } from '../services/cloudinaryService.js'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { normalizeManualOnboardingStatus } from '../utils/onboardingStatus.js'
import { buildRecruiterLaunchUrl } from '../utils/legacyUiRedirects.js'

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
const DEFAULT_ESIGN_TEXT_STYLE = Object.freeze({
  fontSize: 12,
  align: 'left',
  bold: false,
  italic: false,
  underline: false
})

const normalizeMimeType = (mimeType) => (mimeType || '').toString().toLowerCase().split(';')[0].trim()

const inferFileExtensionFromMimeType = (mimeType) => {
  const normalized = normalizeMimeType(mimeType)
  if (normalized === 'application/pdf') return '.pdf'
  if (normalized === 'image/png') return '.png'
  if (normalized === 'image/jpeg') return '.jpg'
  return ''
}

const inferCloudinaryPublicIdFromUrl = (docUrl = '') => {
  const rawUrl = (docUrl || '').toString().trim()
  if (!rawUrl) return ''

  try {
    const parsed = new URL(rawUrl)
    if (!/cloudinary\.com$/i.test(parsed.hostname)) {
      return ''
    }

    const pathParts = parsed.pathname
      .split('/')
      .map(part => part.trim())
      .filter(Boolean)

    const uploadIndex = pathParts.findIndex(part => part === 'upload')
    if (uploadIndex < 0 || uploadIndex === pathParts.length - 1) {
      return ''
    }

    const publicIdParts = pathParts.slice(uploadIndex + 1)
    if (publicIdParts[0] && /^v\d+$/i.test(publicIdParts[0])) {
      publicIdParts.shift()
    }

    if (!publicIdParts.length) {
      return ''
    }

    return decodeURIComponent(publicIdParts.join('/'))
  } catch {
    return ''
  }
}

const buildCloudinaryRawDownloadUrl = ({
  publicId = '',
  mimeType = 'application/pdf'
} = {}) => {
  const normalizedPublicId = (publicId || '').toString().trim()
  if (!normalizedPublicId || !isCloudinaryConfigured()) {
    return ''
  }

  const fileExtension = inferFileExtensionFromMimeType(mimeType)
  const format = fileExtension ? fileExtension.replace(/^\./, '') : undefined

  try {
    return cloudinary.utils.private_download_url(normalizedPublicId, format, {
      resource_type: 'raw',
      type: 'upload',
      attachment: false
    })
  } catch (error) {
    console.error('Failed to build onboarding Cloudinary download URL:', {
      publicId: normalizedPublicId,
      requestedFormat: format || null
    }, error)
    return ''
  }
}

const fetchOnboardingPdfBuffer = async ({
  url = '',
  publicId = '',
  storageProvider = '',
  mimeType = 'application/pdf'
} = {}) => {
  const candidateUrls = []
  const cloudinaryDownloadUrl = storageProvider === 'azure-blob'
    ? ''
    : buildCloudinaryRawDownloadUrl({ publicId, mimeType })

  if (cloudinaryDownloadUrl) {
    candidateUrls.push({
      url: cloudinaryDownloadUrl,
      label: 'cloudinary-download'
    })
  }

  if (url) {
    candidateUrls.push({
      url,
      label: 'stored-url'
    })
  }

  let lastError = null

  for (const candidate of candidateUrls) {
    try {
      const response = await fetch(candidate.url, {
        headers: {
          Accept: mimeType || 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.8'
        }
      })

      if (!response.ok) {
        throw new Error(`Document fetch failed (${candidate.label}): ${response.status}`)
      }

      return Buffer.from(await response.arrayBuffer())
    } catch (error) {
      lastError = error
    }
  }

  console.error('Failed to fetch onboarding PDF source:', {
    publicId,
    url,
    sourcesTried: candidateUrls.map(candidate => candidate.label)
  }, lastError)

  throw lastError || new Error('Failed to fetch onboarding PDF source')
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

const buildOnboardingParticipantMatchClauses = (userId) => {
  if (!userId) {
    return []
  }

  const userIdStr = String(userId?.toString?.() || userId || '').trim()
  const clauses = [
    { member: userId },
    { 'items.config.signers.member': userId },
    { 'items.data.esign.signers.member': userId },
    { 'items.config.signatureFields.signerId': userId }
  ]

  if (!userIdStr) {
    return clauses
  }

  clauses.push(
    { 'items.config.signatureFields.signer': userIdStr },
    { 'items.config.signatureFields.signerKey': userIdStr },
    {
      $and: [
        { member: userId },
        {
          $or: [
            { 'items.config.signatureFields.signer': 'assignee' },
            { 'items.config.signatureFields.signerKey': 'assignee' }
          ]
        }
      ]
    }
  )

  return clauses
}

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

const getEsignFieldIdentity = (field = {}) => {
  const signerRef = String(field.signerKey || field.signerId || field.signer || 'all').trim().toLowerCase() || 'all'
  const roundValue = (value) => {
    const numeric = Number(value)
    return Number.isFinite(numeric) ? Math.round(numeric * 1000) / 1000 : 0
  }

  return [
    String(field.type || 'signature').trim().toLowerCase(),
    String(field.label || '').trim().toLowerCase(),
    Number(field.page) || 1,
    roundValue(field.x),
    roundValue(field.y),
    roundValue(field.width),
    roundValue(field.height),
    String(field.origin || 'top-left').trim().toLowerCase(),
    signerRef
  ].join('|')
}

const normalizeEsignFieldValues = (fieldValues = {}) => {
  if (!fieldValues || typeof fieldValues !== 'object' || Array.isArray(fieldValues)) {
    return {}
  }

  return Object.entries(fieldValues).reduce((acc, [key, value]) => {
    const normalizedKey = String(key || '').trim()
    if (!normalizedKey) {
      return acc
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      acc[normalizedKey] = {
        text: String(value.text ?? '')
          .replace(/\r\n/g, '\n')
          .replace(/\r/g, '\n'),
        style: normalizeEsignTextStyle(value.style || value)
      }
      return acc
    }

    const normalizedValue = typeof value === 'string'
      ? value.trim()
      : String(value ?? '').trim()

    acc[normalizedKey] = normalizedValue
    return acc
  }, {})
}

function normalizeEsignFontSize (value) {
  const size = Number(value)
  if (!Number.isFinite(size)) return DEFAULT_ESIGN_TEXT_STYLE.fontSize
  if (size <= 10) return 10
  if (size <= 12) return 12
  if (size <= 14) return 14
  return 16
}

function normalizeEsignTextStyle (style = {}) {
  const safeStyle = style && typeof style === 'object' && !Array.isArray(style) ? style : {}
  const align = String(safeStyle.align || '').trim().toLowerCase()
  return {
    fontSize: normalizeEsignFontSize(safeStyle.fontSize || safeStyle.size || DEFAULT_ESIGN_TEXT_STYLE.fontSize),
    align: ['left', 'center', 'right'].includes(align) ? align : DEFAULT_ESIGN_TEXT_STYLE.align,
    bold: safeStyle.bold === true || safeStyle.bold === 'true' || safeStyle.fontWeight === 'bold',
    italic: safeStyle.italic === true || safeStyle.italic === 'true' || safeStyle.fontStyle === 'italic',
    underline: safeStyle.underline === true || safeStyle.underline === 'true'
  }
}

function getSubmittedEsignFieldText (value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return String(value.text ?? '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
  }

  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
}

function getSubmittedEsignFieldStyle (value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? normalizeEsignTextStyle(value.style || value)
    : normalizeEsignTextStyle()
}

const splitPdfTextIntoLines = ({ text = '', font, fontSize = 11, maxWidth = 120 } = {}) => {
  const normalizedText = String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()

  if (!normalizedText) {
    return []
  }

  const lines = []
  const paragraphs = normalizedText.split('\n')

  const pushWordSegments = (word, output) => {
    const characters = Array.from(String(word || ''))
    let segment = ''

    characters.forEach(character => {
      const candidate = `${segment}${character}`
      if (!segment || font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
        segment = candidate
      } else {
        output.push(segment)
        segment = character
      }
    })

    if (segment) {
      output.push(segment)
    }
  }

  paragraphs.forEach((paragraph, paragraphIndex) => {
    const words = paragraph.split(/\s+/).filter(Boolean)

    if (!words.length) {
      lines.push('')
    } else {
      let currentLine = ''

      words.forEach(word => {
        const candidate = currentLine ? `${currentLine} ${word}` : word
        if (!currentLine || font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
          currentLine = candidate
          return
        }

        lines.push(currentLine)

        if (font.widthOfTextAtSize(word, fontSize) <= maxWidth) {
          currentLine = word
          return
        }

        const brokenSegments = []
        pushWordSegments(word, brokenSegments)
        currentLine = brokenSegments.pop() || ''
        lines.push(...brokenSegments)
      })

      if (currentLine) {
        lines.push(currentLine)
      }
    }

    if (paragraphIndex < paragraphs.length - 1) {
      lines.push('')
    }
  })

  return lines
}

const fitPdfTextIntoField = ({ text = '', font, width = 120, height = 30, preferredFontSize = 11, minFontSize = 7 } = {}) => {
  const safeWidth = Math.max(10, Number(width) || 120)
  const safeHeight = Math.max(12, Number(height) || 30)

  for (let fontSize = preferredFontSize; fontSize >= minFontSize; fontSize -= 0.5) {
    const lineHeight = fontSize * 1.2
    const maxLines = Math.max(1, Math.floor(safeHeight / lineHeight))
    const lines = splitPdfTextIntoLines({
      text,
      font,
      fontSize,
      maxWidth: safeWidth
    })

    if (lines.length <= maxLines) {
      return {
        fontSize,
        lineHeight,
        maxLines,
        lines
      }
    }
  }

  const fallbackFontSize = minFontSize
  const fallbackLineHeight = fallbackFontSize * 1.2
  const fallbackMaxLines = Math.max(1, Math.floor(safeHeight / fallbackLineHeight))
  const fallbackLines = splitPdfTextIntoLines({
    text,
    font,
    fontSize: fallbackFontSize,
    maxWidth: safeWidth
  }).slice(0, fallbackMaxLines)

  return {
    fontSize: fallbackFontSize,
    lineHeight: fallbackLineHeight,
    maxLines: fallbackMaxLines,
    lines: fallbackLines
  }
}

const drawPdfFieldText = ({
  page,
  font,
  fonts,
  text = '',
  x = 0,
  y = 0,
  width = 120,
  height = 30,
  color = rgb(0.1, 0.1, 0.1),
  style = DEFAULT_ESIGN_TEXT_STYLE
} = {}) => {
  const normalizedText = String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
  if (!normalizedText) {
    return
  }

  const normalizedStyle = normalizeEsignTextStyle(style)
  const resolvedFont = fonts
    ? (
        normalizedStyle.bold && normalizedStyle.italic
          ? (fonts.boldItalic || fonts.bold || fonts.italic || fonts.regular)
          : normalizedStyle.bold
            ? (fonts.bold || fonts.regular)
            : normalizedStyle.italic
              ? (fonts.italic || fonts.regular)
              : fonts.regular
      )
    : font

  const horizontalPadding = 3
  const verticalPadding = 3
  const innerWidth = Math.max(10, Number(width) - (horizontalPadding * 2))
  const innerHeight = Math.max(12, Number(height) - (verticalPadding * 2))
  const fitted = fitPdfTextIntoField({
    text: normalizedText,
    font: resolvedFont,
    width: innerWidth,
    height: innerHeight,
    preferredFontSize: normalizedStyle.fontSize,
    minFontSize: Math.max(7, normalizedStyle.fontSize - 3)
  })

  const startY = Number(y) + Number(height) - verticalPadding - fitted.fontSize
  fitted.lines.slice(0, fitted.maxLines).forEach((line, index) => {
    const lineWidth = resolvedFont.widthOfTextAtSize(line, fitted.fontSize)
    let lineX = Number(x) + horizontalPadding

    if (normalizedStyle.align === 'center') {
      lineX += Math.max(0, (innerWidth - lineWidth) / 2)
    } else if (normalizedStyle.align === 'right') {
      lineX += Math.max(0, innerWidth - lineWidth)
    }

    const lineY = Math.max(Number(y) + verticalPadding, startY - (index * fitted.lineHeight))
    page.drawText(line, {
      x: lineX,
      y: lineY,
      size: fitted.fontSize,
      font: resolvedFont,
      color
    })

    if (normalizedStyle.underline && lineWidth > 0) {
      const underlineOffset = Math.max(0.8, fitted.fontSize * 0.12)
      page.drawLine({
        start: { x: lineX, y: Math.max(Number(y) + verticalPadding, lineY - underlineOffset) },
        end: { x: lineX + Math.min(lineWidth, innerWidth), y: Math.max(Number(y) + verticalPadding, lineY - underlineOffset) },
        thickness: Math.max(0.8, fitted.fontSize * 0.06),
        color
      })
    }
  })
}

const normalizeSubmittedDateValue = (value = '') => {
  const raw = String(value || '').trim()
  if (!raw) {
    return ''
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const parsed = new Date(`${raw}T00:00:00`)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString()
    }
  }

  return raw
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
  const workspaceUrl = buildRecruiterLaunchUrl(issuerUrl)
  const actionLabel = 'Open Recruiter'
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
      <p style="font-size:12px;color:#94a3b8;">Open Recruiter and go to My Documents to review this task: ${workspaceUrl}</p>
    `,
    text: `Hi ${memberName},\n\n${introLine}\n\nOpen Recruiter and go to My Documents to review your pending tasks: ${workspaceUrl}`
  }
}

const sendAssignmentEmail = async ({
  memberId,
  organization,
  workflowType
} = {}) => {
  if (!memberId || !organization) return

  const memberAccount = await Account.findById(memberId)
  if (!memberAccount?.email) return

  const memberName = memberAccount.profile?.name || memberAccount.email.split('@')[0]
  const { subject, html, text } = buildOnboardingEmail(
    memberName,
    organization.name,
    process.env.ISSUER_URL,
    workflowType
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

const collectAssignmentAssets = (items = []) => {
  const assets = new Map()

  const addAsset = ({ publicId, storageKey, storageProvider, provider, storageContainer }) => {
    const key = String(storageKey || publicId || '').trim()
    if (!key) return
    const resolvedProvider = storageProvider || provider || 'cloudinary'
    const identity = `${resolvedProvider}:${storageContainer || ''}:${key}`
    assets.set(identity, {
      publicId: publicId || key,
      storageKey: key,
      storageProvider: resolvedProvider,
      storageContainer: storageContainer || null,
      resourceType: 'raw'
    })
  }

  items.forEach(item => {
    addAsset(item?.config?.document || {})
    addAsset(item?.data?.upload || {})
    addAsset({
      publicId: item?.data?.esign?.signedPublicId,
      storageKey: item?.data?.esign?.signedStorageKey,
      storageProvider: item?.data?.esign?.signedStorageProvider,
      storageContainer: item?.data?.esign?.signedStorageContainer
    })
  })

  return assets
}

const cleanupRemovedAssignmentAssets = async ({
  previousItems = [],
  nextItems = []
} = {}) => {
  const previousAssets = collectAssignmentAssets(previousItems)
  const nextAssets = collectAssignmentAssets(nextItems)
  const removedAssets = Array.from(previousAssets.entries())
    .filter(([identity]) => !nextAssets.has(identity))
    .map(([, asset]) => asset)

  await Promise.all(removedAssets.map(async asset => {
    try {
      await deleteFromCloudinary(asset)
    } catch (error) {
      console.warn('Failed to remove replaced onboarding asset:', asset.storageKey, error)
    }
  }))
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
        provider: uploadResult.storageProvider || 'cloudinary',
        storageProvider: uploadResult.storageProvider || 'cloudinary',
        storageKey: uploadResult.storageKey || uploadResult.public_id,
        storageContainer: uploadResult.storageContainer || null,
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

  const { publicId, storageProvider, storageContainer } = req.body || {}
  if (!publicId || typeof publicId !== 'string') {
    return res.status(400).json({ error: 'publicId is required' })
  }

  const expectedPrefix = `seemplify/onboarding/${req.params.orgId}/`
  if (!publicId.startsWith(expectedPrefix)) {
    return res.status(400).json({ error: 'Invalid document reference' })
  }

  try {
    await deleteFromCloudinary({ publicId, storageKey: publicId, storageProvider, storageContainer, resourceType: 'raw' })
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

    await sendAssignmentEmail({
      memberId,
      organization,
      workflowType: resolvedWorkflowType
    })

    res.status(201).json(assignment)
  } catch (error) {
    console.error('Assign onboarding error:', error)
    res.status(500).json({ error: 'Failed to assign onboarding' })
  }
})

router.patch('/organizations/:orgId/onboarding/assignments/:assignmentId', requireAuth, requireOrganizationMember, async (req, res) => {
  if (!canManageOnboarding(req.memberRole)) {
    return res.status(403).json({ error: 'Insufficient permissions to manage onboarding' })
  }

  try {
    const { memberId, dueAt } = req.body || {}
    const requestedWorkflowType = normalizeWorkflowType(req.body?.workflowType)
    const customItemsInput = parseJson(req.body?.customItems, [])
    const customItems = normalizeItems(customItemsInput)

    if (!memberId) {
      return res.status(400).json({ error: 'Member is required' })
    }

    if (customItems.length === 0) {
      return res.status(400).json({ error: 'At least one workflow item is required' })
    }

    const organization = await Organization.findById(req.params.orgId)
    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' })
    }

    const memberEntry = organization.members.find(m => m.account.toString() === memberId && m.status === 'active')
    if (!memberEntry) {
      return res.status(404).json({ error: 'Member not found in this organization' })
    }

    const assignment = await OnboardingAssignment.findOne({
      _id: req.params.assignmentId,
      organization: req.params.orgId
    })

    if (!assignment) {
      return res.status(404).json({ error: 'Onboarding assignment not found' })
    }

    if (assignment.status === 'cancelled') {
      return res.status(400).json({ error: 'Cancelled assignments cannot be edited' })
    }

    if (assignment.status === 'completed') {
      return res.status(400).json({ error: 'Completed assignments cannot be edited' })
    }

    const previousStatus = assignment.status
    const previousItems = assignment.items.map(item => item.toObject())

    const resolvedItems = await Promise.all(
      customItems.map(item => resolveEsignSigners(item, memberId, organization))
    )

    if (memberEntry.onboardingStatusOverride) {
      await organization.setMemberOnboardingStatusOverride(memberId, null, req.user._id)
    }

    assignment.member = memberId
    assignment.workflowType = requestedWorkflowType
    assignment.template = null
    assignment.items = resolvedItems
    assignment.dueAt = dueAt ? new Date(dueAt) : undefined
    assignment.completedAt = undefined
    assignment.cancelledAt = undefined
    assignment.status = 'pending'
    updateAssignmentStatus(assignment)
    await assignment.save()

    await cleanupRemovedAssignmentAssets({
      previousItems,
      nextItems: assignment.items.map(item => item.toObject())
    })

    await sendAssignmentEmail({
      memberId,
      organization,
      workflowType: assignment.workflowType
    })

    res.json({
      message: 'Assignment updated',
      assignment
    })
  } catch (error) {
    console.error('Update onboarding assignment error:', error)
    res.status(500).json({ error: 'Failed to update onboarding assignment' })
  }
})

router.post('/organizations/:orgId/onboarding/members/:memberId/reminder', requireAuth, requireOrganizationMember, async (req, res) => {
  if (!canManageOnboarding(req.memberRole)) {
    return res.status(403).json({ error: 'Insufficient permissions to manage onboarding' })
  }

  try {
    const organization = await Organization.findById(req.params.orgId)
    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' })
    }

    const memberEntry = organization.members.find(
      m => m.account.toString() === req.params.memberId && m.status === 'active'
    )

    if (!memberEntry) {
      return res.status(404).json({ error: 'Member not found in this organization' })
    }

    const assignment = await OnboardingAssignment.findOne({
      organization: req.params.orgId,
      member: req.params.memberId,
      workflowType: 'onboarding',
      status: { $in: ['pending', 'in_progress'] }
    }).sort({ updatedAt: -1, createdAt: -1 })

    if (!assignment) {
      return res.status(404).json({
        error: 'No active onboarding assignment found for this member'
      })
    }

    const memberAccount = await Account.findById(req.params.memberId)
    if (!memberAccount?.email) {
      return res.status(400).json({ error: 'Member does not have a valid email address' })
    }

    const memberName = memberAccount.profile?.name || memberAccount.email.split('@')[0]
    const orgName = organization.name
    const { subject, html, text } = buildOnboardingEmail(
      memberName,
      orgName,
      process.env.ISSUER_URL,
      assignment.workflowType || 'onboarding'
    )

    await emailService.sendEmail({
      to: memberAccount.email,
      subject,
      html,
      text
    })

    res.json({
      message: 'Onboarding reminder sent',
      assignmentId: assignment._id,
      memberId: req.params.memberId
    })
  } catch (error) {
    console.error('Send onboarding reminder error:', error)
    res.status(500).json({ error: 'Failed to send onboarding reminder' })
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
      $or: buildOnboardingParticipantMatchClauses(req.user._id),
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
        provider: uploadResult.storageProvider || 'cloudinary',
        storageProvider: uploadResult.storageProvider || 'cloudinary',
        storageKey: uploadResult.storageKey || uploadResult.public_id,
        storageContainer: uploadResult.storageContainer || null,
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
    const { signatureDataUrl, signerName, fieldValues } = req.body || {}
    const normalizedFieldValues = normalizeEsignFieldValues(fieldValues)

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
    const previousSignedStorageKey = item.data?.esign?.signedStorageKey || previousSignedPublicId
    const previousSignedStorageProvider = item.data?.esign?.signedStorageProvider || 'cloudinary'
    const previousSignedStorageContainer = item.data?.esign?.signedStorageContainer

    const signerIdStr = req.user._id.toString()
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

    const configuredSigners = item.config?.signers?.length
      ? item.config.signers
      : [{ member: assignment.member }]
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

    const signerAllowed = configuredSigners.some(signer => signer?.member?.toString() === signerIdStr)
      || assignment.member?.toString() === signerIdStr
      || allSignatureFields.some(field => {
        const rawSigner = normalizeSignerId(field.signerKey || field.signerId || field.signer)
        if (!rawSigner) return assignment.member?.toString() === signerIdStr
        const resolvedSigner = rawSigner === 'assignee' ? assignment.member?.toString() : rawSigner
        return resolvedSigner === signerIdStr
      })

    if (!signerAllowed) {
      return res.status(403).json({ error: 'You are not assigned to sign this document' })
    }

    const sourceUrl = item.data?.esign?.signedUrl || document.url
    const sourcePublicId = item.data?.esign?.signedPublicId
      || document.publicId
      || inferCloudinaryPublicIdFromUrl(sourceUrl)
    const sourceStorageProvider = item.data?.esign?.signedStorageProvider || document.provider || 'cloudinary'
    const sourceBuffer = await fetchOnboardingPdfBuffer({
      url: sourceUrl,
      publicId: sourcePublicId,
      storageProvider: sourceStorageProvider,
      mimeType: 'application/pdf'
    })

    const pdfDoc = await PDFDocument.load(sourceBuffer)
    const pages = pdfDoc.getPages()
    const fonts = {
      regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
      bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
      italic: await pdfDoc.embedFont(StandardFonts.HelveticaOblique),
      boldItalic: await pdfDoc.embedFont(StandardFonts.HelveticaBoldOblique)
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

    const requiresSignature = signatureFields.some(field => field.type === 'signature')
    if (requiresSignature && !signatureDataUrl) {
      return res.status(400).json({ error: 'Signature is required' })
    }

    let signatureFormat = ''
    let signatureBuffer = null
    if (signatureDataUrl) {
      const signatureMatch = signatureDataUrl.match(/^data:image\/(png|jpeg);base64,(.+)$/)
      if (!signatureMatch) {
        return res.status(400).json({ error: 'Invalid signature format' })
      }

      signatureFormat = signatureMatch[1]
      signatureBuffer = Buffer.from(signatureMatch[2], 'base64')
    }

    let signatureImage = null
    if (requiresSignature && signatureBuffer) {
      signatureImage = signatureFormat === 'png'
        ? await pdfDoc.embedPng(signatureBuffer)
        : await pdfDoc.embedJpg(signatureBuffer)
    }

    const now = new Date()
    const dateText = now.toLocaleDateString()
    const resolvedSignerName = signerName || req.user.profile?.name || req.user.email

    const missingField = signatureFields.find(field => {
      if (field.type === 'signature') {
        return false
      }

      const fieldKey = getEsignFieldIdentity(field)
      const submittedValue = normalizedFieldValues[fieldKey]
      const fallbackValue = field.type === 'date'
        ? dateText
        : (field.text || '')

      return !String(getSubmittedEsignFieldText(submittedValue) || fallbackValue).trim()
    })

    if (missingField) {
      return res.status(400).json({
        error: `${missingField.label || (missingField.type === 'date' ? 'Date' : 'Text')} is required`
      })
    }

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
      const fieldKey = getEsignFieldIdentity(field)
      const submittedFieldValue = normalizedFieldValues[fieldKey]

      if (field.type === 'date') {
        drawPdfFieldText({
          page,
          fonts,
          text: normalizeSubmittedDateValue(getSubmittedEsignFieldText(submittedFieldValue) || field.text || dateText),
          x: drawX,
          y: drawY,
          width,
          height,
          color: rgb(0.1, 0.1, 0.1)
        })
      } else if (field.type === 'text') {
        const textValue = getSubmittedEsignFieldText(submittedFieldValue || field.text || '').trim()
        if (textValue) {
          drawPdfFieldText({
            page,
            fonts,
            text: textValue,
            x: drawX,
            y: drawY,
            width,
            height,
            color: rgb(0.1, 0.1, 0.1),
            style: getSubmittedEsignFieldStyle(submittedFieldValue)
          })
        }
      } else if (signatureImage) {
        page.drawImage(signatureImage, {
          x: drawX,
          y: drawY,
          width,
          height
        })
      }
    })

    const signedPdfBytes = await pdfDoc.save()

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
    item.data.esign.signedStorageProvider = uploadResult.storageProvider || 'cloudinary'
    item.data.esign.signedStorageKey = uploadResult.storageKey || uploadResult.public_id
    item.data.esign.signedStorageContainer = uploadResult.storageContainer || null
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
        await deleteFromCloudinary({
          publicId: previousSignedPublicId,
          storageKey: previousSignedStorageKey,
          storageProvider: previousSignedStorageProvider,
          storageContainer: previousSignedStorageContainer,
          resourceType: 'raw'
        })
      } catch (deleteError) {
        console.error('Failed to delete old signed document from storage:', deleteError)
      }
    }

    res.json({ message: 'Document signed', signedUrl: uploadResult.secure_url, assignment })
  } catch (error) {
    console.error('Complete e-sign error:', error)
    res.status(500).json({ error: 'Failed to complete e-signing' })
  }
})

export default router
