import express from 'express'
import bcrypt from 'bcrypt'
import crypto from 'crypto'
import { Account } from '../models/Account.js'
import { Organization } from '../models/Organization.js'
import { RoleApprovalRequest } from '../models/RoleApprovalRequest.js'
import { AgentInvite } from '../models/AgentInvite.js'
import { optionalAuth } from '../middleware/auth.js'
import { resolveBranding } from '../utils/branding.js'
import { emailService } from '../services/emailService.js'
import { logAuditEvent } from '../utils/auditLog.js'
import {
  ACTIVE_REGISTRATION_INTENTS,
  INTENT_DEFAULT_ROLE_MAP,
  getPostLoginRedirect,
  isPartnerRegistrationIntent,
  resolveLearningRole,
  resolvePartnerTypeForIntent,
  resolveRequestedRoleForIntent
} from '../utils/learningRoles.js'

const router = express.Router()

const LEARNING_INTENTS = ACTIVE_REGISTRATION_INTENTS

const sanitizeReturnTo = (value) => {
  const normalized = String(value || '').trim()
  if (!normalized.startsWith('/')) return '/simple-lms'
  if (normalized.startsWith('//')) return '/simple-lms'
  return normalized
}

const sanitizeIntent = (value, fallback = 'learn') => {
  const normalized = String(value || '').trim().toLowerCase()
  if (LEARNING_INTENTS.includes(normalized)) return normalized
  return fallback
}

const sanitizeIntentSource = (value, fallback = 'direct') => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return normalized || fallback
}

const sanitizeOrgName = (value) => String(value || '').trim().slice(0, 160)
const normalizeEmail = (value) => String(value || '').trim().toLowerCase()
const sanitizeInviteToken = (value) => String(value || '').trim().slice(0, 200)

const appendQuery = (path, entries = {}) => {
  const params = new URLSearchParams()
  Object.entries(entries).forEach(([key, rawValue]) => {
    const value = String(rawValue || '').trim()
    if (value) params.set(key, value)
  })
  const query = params.toString()
  if (!query) return path
  return `${path}${path.includes('?') ? '&' : '?'}${query}`
}

const createSub = () => `sl_${crypto.randomUUID().replace(/-/g, '')}`

const findValidAgentInvite = async (inviteToken) => {
  const token = sanitizeInviteToken(inviteToken)
  if (!token) return null
  return AgentInvite.findOne({
    token,
    status: 'pending',
    expiresAt: { $gt: new Date() }
  })
    .populate('partnerOrganization', '_id name partnerType partnerSettings.partnerStatus')
    .populate('invitedBy', '_id email profile')
}

const createResetToken = () => crypto.randomBytes(32).toString('hex')

const hashResetToken = (token) => crypto.createHash('sha256').update(String(token || '')).digest('hex')

const buildBaseUrl = (req) => {
  const proto = String(req.protocol || 'http').trim()
  const host = String(req.get('host') || '').trim()
  return host ? `${proto}://${host}` : ''
}

const canUseReturnToDirectly = (path) => {
  const normalized = sanitizeReturnTo(path)
  if (!normalized) return false
  if (normalized === '/simple-lms') return false
  if (normalized.startsWith('/login') || normalized.startsWith('/register')) return false
  return true
}

const resolveLoginDestination = (account, returnTo) => {
  if (canUseReturnToDirectly(returnTo)) {
    return sanitizeReturnTo(returnTo)
  }
  const role = resolveLearningRole(account)
  return getPostLoginRedirect(role, '/simple-lms')
}

const createPartnerOrganizationForRequest = async ({ account, intent, organizationName }) => {
  const normalizedOrgName = sanitizeOrgName(organizationName)
  if (!normalizedOrgName) return null

  const partnerType = resolvePartnerTypeForIntent(intent)
  const organization = await Organization.create({
    name: normalizedOrgName,
    description: `${partnerType === 'channel_partner' ? 'Channel partner' : 'Partner'} application`,
    owner: account._id,
    partnerType,
    members: [{
      account: account._id,
      role: 'partner_admin',
      appAccess: {
        mode: 'all',
        appIds: []
      },
      joinedAt: new Date(),
      invitedBy: account._id,
      status: 'active'
    }],
    partnerSettings: {
      partnerStatus: 'pending',
      maxAgents: null,
      defaultAgentCommissionRate: 10,
      agentInviteApproval: true
    }
  })

  const hasMembership = Array.isArray(account.organizations)
    && account.organizations.some((membership) => String(membership.organization) === String(organization._id))

  if (!hasMembership) {
    account.organizations = Array.isArray(account.organizations) ? account.organizations : []
    account.organizations.push({
      organization: organization._id,
      role: 'partner_admin',
      appAccess: {
        mode: 'all',
        appIds: []
      },
      joinedAt: new Date(),
      isActive: true
    })
  }

  account.partnerOrganization = organization._id
  await account.save()

  return organization
}

const createPartnerApprovalRequest = async ({ account, intent, source, organizationName }) => {
  if (!isPartnerRegistrationIntent(intent)) return null

  const requestedRole = resolveRequestedRoleForIntent(intent)
  if (!requestedRole) return null

  const organization = await createPartnerOrganizationForRequest({ account, intent, organizationName })

  const request = await RoleApprovalRequest.create({
    account: account._id,
    requestType: 'partner_role_activation',
    registrationIntent: intent,
    requestedRole,
    partnerType: resolvePartnerTypeForIntent(intent),
    organizationName: sanitizeOrgName(organizationName),
    organization: organization?._id || null,
    status: 'pending',
    metadata: {
      source: String(source || 'direct').trim() || 'direct'
    }
  })

  await logAuditEvent({
    action: 'approval.request.create',
    performedBy: account._id,
    targetAccount: account._id,
    targetOrganization: organization?._id || null,
    metadata: {
      requestId: request._id,
      requestedRole,
      registrationIntent: intent
    }
  })

  return request
}

const activateAgentInviteForAccount = async ({ account, invite, req }) => {
  if (!account || !invite) return null
  const organization = invite.partnerOrganization
  if (!organization?._id) {
    throw new Error('Partner organization for this invite could not be found.')
  }

  account.learningRole = 'channel_sales_agent'
  account.isSuperAdmin = false
  account.isSystemAdmin = false
  account.partnerOrganization = organization._id
  account.roleMetadata = {
    previousLearningRole: 'channel_sales_agent',
    lastUpdatedAt: new Date(),
    lastUpdatedBy: invite.invitedBy?._id || null
  }

  const accountMembership = Array.isArray(account.organizations)
    ? account.organizations.find((entry) => String(entry.organization) === String(organization._id))
    : null

  if (accountMembership) {
    accountMembership.role = 'sales_agent'
    accountMembership.isActive = true
  } else {
    account.organizations = Array.isArray(account.organizations) ? account.organizations : []
    account.organizations.push({
      organization: organization._id,
      role: 'sales_agent',
      appAccess: {
        mode: 'all',
        appIds: []
      },
      joinedAt: new Date(),
      isActive: true
    })
  }
  await account.save()

  const orgRecord = await Organization.findById(organization._id)
  if (!orgRecord) {
    throw new Error('Partner organization for this invite no longer exists.')
  }

  const orgMembership = (orgRecord.members || []).find((member) => (
    String(member.account) === String(account._id)
  ))
  if (orgMembership) {
    orgMembership.role = 'sales_agent'
    orgMembership.status = 'active'
    orgMembership.updatedAt = new Date()
    orgMembership.updatedBy = invite.invitedBy?._id || account._id
  } else {
    orgRecord.members.push({
      account: account._id,
      role: 'sales_agent',
      appAccess: {
        mode: 'all',
        appIds: []
      },
      joinedAt: new Date(),
      invitedBy: invite.invitedBy?._id || account._id,
      status: 'active',
      updatedAt: new Date(),
      updatedBy: invite.invitedBy?._id || account._id
    })
  }
  await orgRecord.save()

  invite.status = 'accepted'
  invite.acceptedAt = new Date()
  invite.acceptedBy = account._id
  invite.metadata = {
    ...(invite.metadata || {}),
    acceptedEmail: account.email
  }
  await invite.save()

  await logAuditEvent({
    action: 'agent.add',
    performedBy: invite.invitedBy?._id || account._id,
    targetAccount: account._id,
    targetOrganization: organization._id,
    metadata: {
      mode: 'invite_accept',
      inviteId: invite._id
    },
    req
  })

  return orgRecord
}

const createAccountFromRegistration = async ({
  req,
  intent,
  source,
  returnTo,
  name,
  email,
  password,
  organizationName
}) => {
  const hasExistingSuperAdmin = await Account.exists({
    $or: [
      { isSuperAdmin: true },
      { learningRole: 'super_admin' }
    ]
  })

  const bootstrapAsSuperAdmin = !hasExistingSuperAdmin
  const roleFromIntent = INTENT_DEFAULT_ROLE_MAP[intent] || 'learner'
  const passwordHash = await bcrypt.hash(password, 12)

  const account = await Account.create({
    sub: createSub(),
    email,
    passwordHash,
    emailVerified: true,
    profile: {
      name,
      preferred_username: name
    },
    learningRole: bootstrapAsSuperAdmin ? 'super_admin' : roleFromIntent,
    learningProfile: {
      registrationIntent: intent,
      intentSource: source,
      instructorActivatedAt: intent === 'teach' || bootstrapAsSuperAdmin ? new Date() : null,
      instructorOnboardingCompleted: bootstrapAsSuperAdmin ? true : false
    },
    isSystemAdmin: bootstrapAsSuperAdmin,
    isSuperAdmin: bootstrapAsSuperAdmin,
    organizations: [],
    teams: []
  })

  let approvalRequest = null
  if (!bootstrapAsSuperAdmin && isPartnerRegistrationIntent(intent)) {
    approvalRequest = await createPartnerApprovalRequest({
      account,
      intent,
      source,
      organizationName
    })
  }

  const successMessage = bootstrapAsSuperAdmin
    ? 'Your account was bootstrapped as Super Admin.'
    : isPartnerRegistrationIntent(intent)
      ? 'Your partner application has been submitted for admin approval.'
      : 'Your account is ready.'

  let destination = returnTo
  if (bootstrapAsSuperAdmin) {
    destination = '/admin'
  } else if (!canUseReturnToDirectly(returnTo)) {
    if (intent === 'teach') {
      destination = '/teach/get-started'
    } else {
      destination = '/simple-lms'
    }
  }

  return {
    account,
    bootstrapAsSuperAdmin,
    successMessage,
    destination,
    approvalRequest
  }
}

router.get('/login', optionalAuth, async (req, res) => {
  const branding = resolveBranding(req.hostname || req.get('host'))
  const returnTo = sanitizeReturnTo(req.query.return_to)
  const loginMode = String(req.query.mode || '').trim().toLowerCase() === 'admin' ? 'admin' : 'workspace'
  if (req.user) {
    return res.redirect(resolveLoginDestination(req.user, returnTo || '/simple-lms'))
  }

  const registerIntent = sanitizeIntent(
    req.query.intent || (returnTo.startsWith('/teach') ? 'teach' : 'learn'),
    'learn'
  )
  const registerSource = sanitizeIntentSource(
    req.query.source || (registerIntent === 'teach' ? 'teach_login' : 'login'),
    registerIntent === 'teach' ? 'teach_login' : 'login'
  )

  res.render('login', {
    title: `${branding.learningName} - Sign in`,
    returnTo,
    loginMode,
    registerUrl: appendQuery('/register', {
      return_to: returnTo,
      intent: registerIntent,
      source: registerSource
    }),
    forgotPasswordUrl: '/forgot-password',
    error: String(req.query.error || ''),
    success: String(req.query.success || '')
  })
})

router.get('/admin/login', optionalAuth, async (req, res) => {
  const branding = resolveBranding(req.hostname || req.get('host'))
  const returnTo = sanitizeReturnTo(req.query.return_to || '/admin')
  if (req.user) {
    return res.redirect(resolveLoginDestination(req.user, returnTo || '/admin'))
  }

  res.render('login', {
    title: `${branding.learningName} - Admin Sign in`,
    returnTo,
    loginMode: 'admin',
    registerUrl: appendQuery('/register', {
      return_to: returnTo,
      intent: 'learn',
      source: 'admin_login'
    }),
    forgotPasswordUrl: '/forgot-password',
    error: String(req.query.error || ''),
    success: String(req.query.success || '')
  })
})

router.post('/login', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase()
    const password = String(req.body.password || '')
    const returnTo = sanitizeReturnTo(req.body.return_to)

    if (!email || !password) {
      return res.redirect(`/login?error=${encodeURIComponent('Email and password are required')}&return_to=${encodeURIComponent(returnTo)}`)
    }

    const account = await Account.findOne({ email })
    if (!account || !account.passwordHash) {
      return res.redirect(`/login?error=${encodeURIComponent('Invalid credentials')}&return_to=${encodeURIComponent(returnTo)}`)
    }

    const isMatch = await bcrypt.compare(password, account.passwordHash)
    if (!isMatch) {
      return res.redirect(`/login?error=${encodeURIComponent('Invalid credentials')}&return_to=${encodeURIComponent(returnTo)}`)
    }

    req.session.accountId = account.sub
    const destination = resolveLoginDestination(account, returnTo)
    return res.redirect(destination)
  } catch (error) {
    console.error('Login error:', error)
    return res.redirect('/login?error=Failed%20to%20sign%20in')
  }
})

router.get('/register', optionalAuth, async (req, res) => {
  const branding = resolveBranding(req.hostname || req.get('host'))
  const pendingIntent = req.session?.pendingRegistrationIntent || null
  const inviteToken = sanitizeInviteToken(req.query.invite_token || req.query.inviteToken || '')
  const invite = inviteToken ? await findValidAgentInvite(inviteToken) : null

  const intent = invite
    ? 'learn'
    : sanitizeIntent(req.query.intent || pendingIntent?.intent || 'learn', 'learn')
  const source = sanitizeIntentSource(
    req.query.source || pendingIntent?.source || (invite ? 'agent_invite' : (intent === 'teach' ? 'teach_landing' : 'direct')),
    invite ? 'agent_invite' : (intent === 'teach' ? 'teach_landing' : 'direct')
  )
  const returnTo = sanitizeReturnTo(
    req.query.return_to || pendingIntent?.returnTo || (invite ? '/agent-dashboard' : (intent === 'teach' ? '/teach/get-started' : '/simple-lms'))
  )

  if (req.session?.pendingRegistrationIntent) {
    delete req.session.pendingRegistrationIntent
  }

  if (req.user) {
    return res.redirect(resolveLoginDestination(req.user, returnTo || '/simple-lms'))
  }

  res.render('register', {
    title: `${branding.learningName} - Register`,
    error: String(req.query.error || ''),
    intent,
    source,
    returnTo,
    organizationName: String(req.query.organization_name || ''),
    intentOptions: LEARNING_INTENTS,
    inviteToken,
    inviteEmail: invite?.email || '',
    inviteOrganizationName: invite?.partnerOrganization?.name || '',
    inviteExpired: Boolean(inviteToken && !invite),
    loginUrl: appendQuery('/login', {
      return_to: returnTo,
      intent,
      source
    })
  })
})

router.post('/register', async (req, res) => {
  try {
    const branding = resolveBranding(req.hostname || req.get('host'))
    const inviteToken = sanitizeInviteToken(req.body.invite_token || req.body.inviteToken || '')
    const invite = inviteToken ? await findValidAgentInvite(inviteToken) : null
    const intent = sanitizeIntent(req.body.intent || 'learn', 'learn')
    const source = sanitizeIntentSource(
      req.body.source || (invite ? 'agent_invite' : (intent === 'teach' ? 'teach_landing' : 'direct')),
      invite ? 'agent_invite' : (intent === 'teach' ? 'teach_landing' : 'direct')
    )
    const returnTo = sanitizeReturnTo(req.body.return_to || (invite ? '/agent-dashboard' : (intent === 'teach' ? '/teach/get-started' : '/simple-lms')))
    const name = String(req.body.name || '').trim()
    const email = normalizeEmail(req.body.email)
    const password = String(req.body.password || '')
    const organizationName = sanitizeOrgName(req.body.organizationName || req.body.organization_name || '')

    const registerRedirect = (errorMessage) => (
      appendQuery('/register', {
        error: errorMessage,
        intent: invite ? 'learn' : intent,
        source,
        return_to: returnTo,
        organization_name: organizationName,
        invite_token: inviteToken
      })
    )

    if (!name || !email || !password) {
      return res.redirect(registerRedirect('Name, email, and password are required'))
    }

    if (password.length < 8) {
      return res.redirect(registerRedirect('Password must be at least 8 characters'))
    }

    if (inviteToken && !invite) {
      return res.redirect(registerRedirect('This invite is invalid or has expired'))
    }

    if (invite && email !== normalizeEmail(invite.email)) {
      return res.redirect(registerRedirect('Use the invited email address to complete this agent registration'))
    }

    if (!invite && isPartnerRegistrationIntent(intent) && !organizationName) {
      return res.redirect(registerRedirect('Organization name is required for partner applications'))
    }

    const existingAccount = await Account.findOne({ email }).select('_id').lean()
    if (existingAccount) {
      return res.redirect(registerRedirect('Email already exists'))
    }

    const registrationIntent = invite ? 'learn' : intent
    const registration = await createAccountFromRegistration({
      req,
      intent: registrationIntent,
      source,
      returnTo,
      name,
      email,
      password,
      organizationName
    })

    if (invite) {
      await activateAgentInviteForAccount({
        account: registration.account,
        invite,
        req
      })
      registration.successMessage = 'Your sales agent access is active.'
      registration.destination = '/agent-dashboard'
    }

    req.session.accountId = registration.account.sub
    if (req.session?.pendingRegistrationIntent) {
      delete req.session.pendingRegistrationIntent
    }

    return res.redirect(appendQuery(
      registration.destination,
      { success: `Welcome to ${branding.learningName}. ${registration.successMessage}` }
    ))
  } catch (error) {
    console.error('Registration error:', error)
    const fallbackIntent = sanitizeIntent(req.body.intent || 'learn', 'learn')
    const fallbackSource = sanitizeIntentSource(
      req.body.source || (fallbackIntent === 'teach' ? 'teach_landing' : 'direct'),
      fallbackIntent === 'teach' ? 'teach_landing' : 'direct'
    )
    const fallbackReturnTo = sanitizeReturnTo(
      req.body.return_to || (fallbackIntent === 'teach' ? '/teach/get-started' : '/simple-lms')
    )
    const fallbackOrganizationName = sanitizeOrgName(req.body.organizationName || req.body.organization_name || '')

    return res.redirect(appendQuery('/register', {
      error: 'Failed to register account',
      intent: fallbackIntent,
      source: fallbackSource,
      return_to: fallbackReturnTo,
      organization_name: fallbackOrganizationName
    }))
  }
})

router.post('/api/users/register', async (req, res) => {
  try {
    const inviteToken = sanitizeInviteToken(req.body.invite_token || req.body.inviteToken || '')
    const invite = inviteToken ? await findValidAgentInvite(inviteToken) : null
    const intent = sanitizeIntent(req.body.intent || 'learn', 'learn')
    const source = sanitizeIntentSource(req.body.source || (invite ? 'agent_invite_api' : 'api'), invite ? 'agent_invite_api' : 'api')
    const returnTo = sanitizeReturnTo(req.body.return_to || (invite ? '/agent-dashboard' : '/simple-lms'))
    const name = String(req.body.name || '').trim()
    const email = normalizeEmail(req.body.email)
    const password = String(req.body.password || '')
    const organizationName = sanitizeOrgName(req.body.organizationName || req.body.organization_name || '')

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required', code: 'VALIDATION_ERROR' })
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters', code: 'VALIDATION_ERROR' })
    }
    if (inviteToken && !invite) {
      return res.status(400).json({ error: 'Invite is invalid or expired', code: 'INVITE_INVALID' })
    }
    if (invite && email !== normalizeEmail(invite.email)) {
      return res.status(400).json({ error: 'Invite email does not match account email', code: 'INVITE_EMAIL_MISMATCH' })
    }
    if (!invite && isPartnerRegistrationIntent(intent) && !organizationName) {
      return res.status(400).json({ error: 'Organization name is required for partner applications', code: 'VALIDATION_ERROR' })
    }

    const existingAccount = await Account.findOne({ email }).select('_id').lean()
    if (existingAccount) {
      return res.status(409).json({ error: 'Email already exists', code: 'EMAIL_EXISTS' })
    }

    const registrationIntent = invite ? 'learn' : intent
    const registration = await createAccountFromRegistration({
      req,
      intent: registrationIntent,
      source,
      returnTo,
      name,
      email,
      password,
      organizationName
    })

    if (invite) {
      await activateAgentInviteForAccount({
        account: registration.account,
        invite,
        req
      })
      registration.successMessage = 'Your sales agent access is active.'
      registration.destination = '/agent-dashboard'
    }

    req.session.accountId = registration.account.sub

    return res.status(201).json({
      success: true,
      destination: registration.destination,
      message: registration.successMessage,
      pendingApproval: Boolean(registration.approvalRequest),
      user: {
        id: registration.account._id,
        sub: registration.account.sub,
        email: registration.account.email,
        role: resolveLearningRole(registration.account)
      }
    })
  } catch (error) {
    console.error('API register error:', error)
    return res.status(500).json({ error: 'Failed to register account', code: 'REGISTER_FAILED' })
  }
})

router.get('/api/users/me', async (req, res) => {
  try {
    const sub = String(req.session?.accountId || '').trim()
    if (!sub) {
      return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' })
    }

    const account = await Account.findOne({ sub })
    if (!account) {
      return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' })
    }

    const role = resolveLearningRole(account)
    return res.json({
      user: {
        id: account._id,
        sub: account.sub,
        email: account.email,
        name: account.profile?.name || '',
        role,
        registrationIntent: account.learningProfile?.registrationIntent || 'unknown',
        partnerOrganization: account.partnerOrganization || null,
        isSuperAdmin: Boolean(account.isSuperAdmin),
        isSystemAdmin: Boolean(account.isSystemAdmin)
      }
    })
  } catch (error) {
    console.error('API /users/me error:', error)
    return res.status(500).json({ error: 'Failed to fetch user profile', code: 'USER_PROFILE_FAILED' })
  }
})

router.get('/forgot-password', optionalAuth, (req, res) => {
  const branding = resolveBranding(req.hostname || req.get('host'))
  if (req.user) {
    return res.redirect('/simple-lms?view=settings&settingsTab=profile')
  }

  return res.render('forgot-password', {
    title: `${branding.learningName} - Forgot Password`,
    error: String(req.query.error || ''),
    success: String(req.query.success || '')
  })
})

router.post('/forgot-password', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase()
    if (!email) {
      return res.redirect('/forgot-password?error=Email%20is%20required')
    }

    const account = await Account.findOne({ email })
    if (account) {
      const token = createResetToken()
      const tokenHash = hashResetToken(token)
      const expiresAt = new Date(Date.now() + (60 * 60 * 1000))

      account.passwordReset = {
        tokenHash,
        expiresAt,
        requestedAt: new Date()
      }
      await account.save()

      const baseUrl = buildBaseUrl(req)
      const resetLink = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`
      const learningName = String(res.locals?.brandLearningName || 'Seemplify Learning').trim() || 'Seemplify Learning'

      await emailService.sendNotificationEmail({
        to: email,
        subject: `${learningName} password reset`,
        html: `<p>Hello ${account.profile?.name || 'there'},</p><p>Use this link to reset your password:</p><p><a href="${resetLink}">${resetLink}</a></p><p>This link expires in 1 hour.</p>`,
        text: `Use this link to reset your password (expires in 1 hour): ${resetLink}`
      })

      await logAuditEvent({
        action: 'security.password_reset_requested',
        performedBy: account._id,
        targetAccount: account._id,
        metadata: {
          email
        },
        req
      })
    }

    return res.redirect('/forgot-password?success=If%20that%20email%20exists%2C%20a%20password%20reset%20link%20has%20been%20sent')
  } catch (error) {
    console.error('Forgot password error:', error)
    return res.redirect('/forgot-password?error=Failed%20to%20process%20password%20reset')
  }
})

router.get('/reset-password', optionalAuth, async (req, res) => {
  const branding = resolveBranding(req.hostname || req.get('host'))
  const token = String(req.query.token || '').trim()
  const email = String(req.query.email || '').trim().toLowerCase()

  let tokenValid = false
  if (token && email) {
    const tokenHash = hashResetToken(token)
    const account = await Account.findOne({
      email,
      'passwordReset.tokenHash': tokenHash,
      'passwordReset.expiresAt': { $gt: new Date() }
    }).select('_id').lean()
    tokenValid = Boolean(account)
  }

  return res.render('reset-password', {
    title: `${branding.learningName} - Reset Password`,
    token,
    email,
    tokenValid,
    error: String(req.query.error || ''),
    success: String(req.query.success || '')
  })
})

router.post('/reset-password', async (req, res) => {
  try {
    const token = String(req.body.token || '').trim()
    const email = String(req.body.email || '').trim().toLowerCase()
    const password = String(req.body.password || '')
    const confirmPassword = String(req.body.confirm_password || req.body.confirmPassword || '')

    const redirectBack = (message) => `/reset-password?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}&error=${encodeURIComponent(message)}`

    if (!token || !email) {
      return res.redirect('/forgot-password?error=Invalid%20password%20reset%20link')
    }
    if (!password || password.length < 8) {
      return res.redirect(redirectBack('Password must be at least 8 characters'))
    }
    if (password !== confirmPassword) {
      return res.redirect(redirectBack('Password confirmation does not match'))
    }

    const tokenHash = hashResetToken(token)
    const account = await Account.findOne({
      email,
      'passwordReset.tokenHash': tokenHash,
      'passwordReset.expiresAt': { $gt: new Date() }
    })

    if (!account) {
      return res.redirect('/forgot-password?error=Password%20reset%20link%20is%20invalid%20or%20expired')
    }

    account.passwordHash = await bcrypt.hash(password, 12)
    account.passwordReset = {
      tokenHash: '',
      expiresAt: null,
      requestedAt: null
    }
    await account.save()

    await logAuditEvent({
      action: 'security.password_reset_completed',
      performedBy: account._id,
      targetAccount: account._id,
      metadata: {
        email
      },
      req
    })

    return res.redirect('/login?success=Password%20updated%20successfully')
  } catch (error) {
    console.error('Reset password error:', error)
    return res.redirect('/forgot-password?error=Failed%20to%20reset%20password')
  }
})

router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('seemplify_learning_session')
    res.redirect('/login?success=Signed out successfully')
  })
})

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('seemplify_learning_session')
    res.redirect('/login?success=Signed out successfully')
  })
})

export default router
