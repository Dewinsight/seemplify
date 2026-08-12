import express from 'express'
import bcrypt from 'bcrypt'
import crypto from 'crypto'
import { Account } from '../models/Account.js'
import { Organization } from '../models/Organization.js'
import { AgentInvite } from '../models/AgentInvite.js'
import { AdminInvite } from '../models/AdminInvite.js'
import { optionalAuth, requireAuth } from '../middleware/auth.js'
import { resolveBranding } from '../utils/branding.js'
import { emailService } from '../services/emailService.js'
import {
  buildIdpAuthorizationUrl,
  createOidcTransaction,
  exchangeAuthorizationCode,
  fetchIdpOrganizationMembers,
  fetchIdpUserInfo,
  getFreshSessionAccessToken,
  isIdpOidcConfigured,
  toSessionTokenSet
} from '../services/idpOidcService.js'
import {
  syncIdpOrganizationMembers,
  syncIdpUserAndOrganizations
} from '../services/idpLearningSyncService.js'
import { queueAccountLearningSnapshot } from '../services/performanceLearningSyncService.js'
import { logAuditEvent } from '../utils/auditLog.js'
import {
  canAccessReturnPath,
  getDefaultDashboardPath,
  getDashboardPathForKey,
  resolveAccessProfile,
  shouldUseWorkspaceChooser
} from '../utils/accessProfile.js'
import {
  createPartnerApprovalRequest,
  sanitizePartnerOrganizationName
} from '../utils/partnerRoleRequests.js'
import {
  ACTIVE_REGISTRATION_INTENTS,
  INTENT_DEFAULT_ROLE_MAP,
  isPartnerRegistrationIntent,
  resolveLearningRole,
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

const sanitizeOrgName = sanitizePartnerOrganizationName
const normalizeEmail = (value) => String(value || '').trim().toLowerCase()
const sanitizeInviteToken = (value) => String(value || '').trim().slice(0, 200)
const sanitizeOtpCode = (value) => String(value || '').replace(/\D+/g, '').slice(0, 6)

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
const resolveSessionAccountIdentifier = (account) => String(account?.sub || account?._id || '').trim()

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
const hashOtpCode = (token) => crypto.createHash('sha256').update(String(token || '')).digest('hex')
const generateOtpCode = () => String(Math.floor(100000 + Math.random() * 900000))

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

const resolveLoginDestination = async (account, returnTo) => {
  const accessProfile = await resolveAccessProfile(account)
  const sanitizedReturnTo = sanitizeReturnTo(returnTo)

  if (canUseReturnToDirectly(sanitizedReturnTo) && canAccessReturnPath(accessProfile, sanitizedReturnTo)) {
    return sanitizedReturnTo
  }
  if (shouldUseWorkspaceChooser(accessProfile, sanitizedReturnTo)) {
    return '/choose-workspace'
  }
  return getDefaultDashboardPath(accessProfile, '/simple-lms')
}

const oidcStateMatches = (expected, received) => {
  const left = Buffer.from(String(expected || ''))
  const right = Buffer.from(String(received || ''))
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right)
}

const beginSeemplifyLogin = async (req, res) => {
  try {
    if (!isIdpOidcConfigured()) {
      return res.redirect('/login?error=Seemplify%20sign-in%20is%20not%20configured')
    }
    const returnTo = sanitizeReturnTo(req.query.return_to || req.query.returnTo || '/simple-lms')
    const transaction = createOidcTransaction(returnTo)
    req.session.seemplifyOidc = transaction
    const authorizationUrl = await buildIdpAuthorizationUrl({
      req,
      transaction,
      hubToken: req.query.hub_token || ''
    })
    return req.session.save((sessionError) => {
      if (sessionError) {
        console.error('Seemplify OIDC session save error:', sessionError)
        return res.redirect('/login?error=Failed%20to%20start%20Seemplify%20sign-in')
      }
      return res.redirect(authorizationUrl)
    })
  } catch (error) {
    console.error('Seemplify OIDC start error:', error)
    return res.redirect(`/login?error=${encodeURIComponent('The Seemplify identity service is temporarily unavailable')}`)
  }
}

router.get('/auth/seemplify', beginSeemplifyLogin)
router.get('/oidc/start', beginSeemplifyLogin)
router.get('/api/auth/oidc/start', beginSeemplifyLogin)

router.get('/auth/seemplify/callback', async (req, res) => {
  const transaction = req.session?.seemplifyOidc || null
  const fallbackReturnTo = sanitizeReturnTo(transaction?.returnTo || '/simple-lms')
  try {
    if (req.query.error) {
      const message = String(req.query.error_description || req.query.error || 'Seemplify sign-in was cancelled.')
      return res.redirect(`/login?error=${encodeURIComponent(message)}&return_to=${encodeURIComponent(fallbackReturnTo)}`)
    }
    if (!transaction || (Date.now() - Number(transaction.createdAt || 0)) > 10 * 60 * 1000) {
      return res.redirect('/login?error=Seemplify%20sign-in%20expired.%20Please%20try%20again.')
    }
    if (!oidcStateMatches(transaction.state, req.query.state)) {
      return res.redirect('/login?error=Seemplify%20sign-in%20could%20not%20be%20verified')
    }
    const code = String(req.query.code || '').trim()
    if (!code) return res.redirect('/login?error=Seemplify%20did%20not%20return%20an%20authorization%20code')

    const tokenSet = await exchangeAuthorizationCode({
      req,
      code,
      codeVerifier: transaction.codeVerifier
    })
    const sessionTokenSet = toSessionTokenSet(tokenSet)
    const userinfo = await fetchIdpUserInfo(sessionTokenSet.accessToken)
    const synchronized = await syncIdpUserAndOrganizations(userinfo)

    req.session.accountId = resolveSessionAccountIdentifier(synchronized.account)
    req.session.idpTokens = sessionTokenSet
    req.session.idpIdentity = {
      sub: String(userinfo.sub || '').trim(),
      email: normalizeEmail(userinfo.email),
      currentOrganizationId: String(
        userinfo.current_organization?.id
        || userinfo.currentOrganization?.id
        || ''
      ).trim(),
      linkedAt: Date.now()
    }
    delete req.session.seemplifyOidc

    if (synchronized.currentOrganization?.idpOrganizationId) {
      try {
        const accessToken = await getFreshSessionAccessToken(req.session)
        const memberPayload = await fetchIdpOrganizationMembers({
          accessToken,
          organizationId: synchronized.currentOrganization.idpOrganizationId
        })
        await syncIdpOrganizationMembers({
          organization: synchronized.currentOrganization,
          remoteMembers: memberPayload.members || []
        })
      } catch (syncError) {
        console.warn('Seemplify staff sync deferred:', syncError.message)
      }
    }

    const destination = await resolveLoginDestination(synchronized.account, fallbackReturnTo)
    setImmediate(() => {
      queueAccountLearningSnapshot(synchronized.account).catch((syncError) => {
        console.warn('Performance Learning history backfill was deferred:', syncError.message)
      })
    })
    return req.session.save((sessionError) => {
      if (sessionError) {
        console.error('Seemplify OIDC callback session save error:', sessionError)
        return res.redirect('/login?error=Failed%20to%20start%20Learning%20session')
      }
      return res.redirect(destination)
    })
  } catch (error) {
    console.error('Seemplify OIDC callback error:', error)
    if (req.session) delete req.session.seemplifyOidc
    return res.redirect(`/login?error=${encodeURIComponent(error.message || 'Seemplify sign-in failed')}&return_to=${encodeURIComponent(fallbackReturnTo)}`)
  }
})

const findAdminInviteByToken = async (inviteToken, {
  allowedStatuses = ['pending', 'registered'],
  requireRegisteredAccount = false
} = {}) => {
  const token = sanitizeInviteToken(inviteToken)
  if (!token) return null

  const invite = await AdminInvite.findOne({ token })
    .populate('invitedBy', '_id email profile')
    .populate('registeredAccount', '_id email profile emailVerified learningRole isSystemAdmin isSuperAdmin')

  if (!invite) return null

  if (invite.expiresAt && invite.expiresAt.getTime() <= Date.now() && !['accepted', 'revoked', 'expired'].includes(String(invite.status || '').trim().toLowerCase())) {
    invite.status = 'expired'
    await invite.save()
  }

  const status = String(invite.status || '').trim().toLowerCase()
  if (!allowedStatuses.includes(status)) return null
  if (requireRegisteredAccount && !invite.registeredAccount?._id) return null
  return invite
}

const findPendingAdminInviteForEmail = async (email) => {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) return null

  const invite = await AdminInvite.findOne({
    email: normalizedEmail,
    status: { $in: ['pending', 'registered'] }
  })
    .sort({ createdAt: -1 })
    .populate('registeredAccount', '_id email profile emailVerified learningRole isSystemAdmin isSuperAdmin')

  if (!invite) return null
  if (invite.expiresAt && invite.expiresAt.getTime() <= Date.now()) {
    invite.status = 'expired'
    await invite.save()
    return null
  }
  return invite
}

const getAdminInviteRegisterUrl = (req, invite) => {
  const baseUrl = buildBaseUrl(req)
  const query = appendQuery('/register', {
    admin_invite_token: invite?.token,
    return_to: '/admin',
    source: 'admin_invite'
  })
  return `${baseUrl}${query}`
}

const getAdminInviteVerifyUrl = (req, invite, email) => {
  const baseUrl = buildBaseUrl(req)
  const query = appendQuery('/verify-account', {
    admin_invite_token: invite?.token,
    email
  })
  return `${baseUrl}${query}`
}

const resolveAdminInviteRoleCopy = (role) => (
  String(role || 'admin').trim().toLowerCase() === 'super_admin'
    ? 'super admin'
    : 'admin'
)

const issueAdminInviteOtp = async ({ invite, account, req, purpose = 'initial' }) => {
  if (!invite?._id || !account?._id) {
    throw new Error('Invite verification could not be prepared.')
  }

  const otpCode = generateOtpCode()
  const now = new Date()
  invite.status = 'registered'
  invite.registeredAccount = account._id
  invite.registeredAt = invite.registeredAt || now
  invite.otpHash = hashOtpCode(otpCode)
  invite.otpExpiresAt = new Date(now.getTime() + (10 * 60 * 1000))
  invite.otpSentAt = now
  invite.verificationAttempts = 0
  invite.metadata = {
    ...(invite.metadata || {}),
    verificationPurpose: purpose,
    registrationEmail: account.email
  }
  await invite.save()

  const branding = resolveBranding(req.hostname || req.get('host'))
  const roleCopy = resolveAdminInviteRoleCopy(invite.requestedRole)
  const verifyUrl = getAdminInviteVerifyUrl(req, invite, account.email)

  await emailService.sendNotificationEmail({
    to: account.email,
    subject: `${branding.learningName} ${roleCopy} verification code`,
    html: `<p>Hello ${account.profile?.name || 'there'},</p><p>Your verification code for ${branding.learningName} ${roleCopy} access is:</p><p style="font-size:28px;font-weight:700;letter-spacing:0.16em;">${otpCode}</p><p>The code expires in 10 minutes.</p><p>You can also continue here:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p>`,
    text: `Your ${branding.learningName} ${roleCopy} verification code is ${otpCode}. It expires in 10 minutes. Continue here: ${verifyUrl}`
  })

  await logAuditEvent({
    action: 'admin.invite.verify_sent',
    performedBy: invite.invitedBy?._id || account._id,
    targetAccount: account._id,
    metadata: {
      inviteId: invite._id,
      requestedRole: invite.requestedRole,
      purpose
    },
    req
  })

  await logAuditEvent({
    action: 'security.email_verification_requested',
    performedBy: account._id,
    targetAccount: account._id,
    metadata: {
      inviteId: invite._id,
      requestedRole: invite.requestedRole,
      purpose
    },
    req
  })

  return otpCode
}

const activateAdminInviteForAccount = async ({ account, invite, req }) => {
  if (!account?._id || !invite?._id) {
    throw new Error('Admin invite activation failed.')
  }

  const requestedRole = String(invite.requestedRole || 'admin').trim().toLowerCase() === 'super_admin'
    ? 'super_admin'
    : 'admin'
  const currentLearningRole = String(account.learningRole || 'learner').trim().toLowerCase()
  const previousRole = ['admin', 'super_admin'].includes(currentLearningRole)
    ? String(account.roleMetadata?.previousLearningRole || 'learner').trim().toLowerCase()
    : currentLearningRole

  account.emailVerified = true
  account.learningRole = previousRole || 'learner'
  account.isSystemAdmin = true
  account.isSuperAdmin = requestedRole === 'super_admin'
  account.roleMetadata = {
    previousLearningRole: previousRole || 'learner',
    lastUpdatedAt: new Date(),
    lastUpdatedBy: invite.invitedBy?._id || null
  }
  await account.save()

  invite.status = 'accepted'
  invite.acceptedBy = account._id
  invite.acceptedAt = new Date()
  invite.otpHash = ''
  invite.otpExpiresAt = null
  invite.verificationAttempts = 0
  invite.metadata = {
    ...(invite.metadata || {}),
    activatedRole: requestedRole
  }
  await invite.save()

  await logAuditEvent({
    action: 'admin.invite.accepted',
    performedBy: account._id,
    targetAccount: account._id,
    metadata: {
      inviteId: invite._id,
      requestedRole
    },
    req
  })

  await logAuditEvent({
    action: 'security.email_verification_completed',
    performedBy: account._id,
    targetAccount: account._id,
    metadata: {
      inviteId: invite._id,
      requestedRole
    },
    req
  })

  return requestedRole
}

const activateAgentInviteForAccount = async ({ account, invite, req }) => {
  if (!account || !invite) return null
  const organization = invite.partnerOrganization
  if (!organization?._id) {
    throw new Error('Partner organization for this invite could not be found.')
  }

  const accessProfile = await resolveAccessProfile(account)
  const linkedOrganizationId = String(accessProfile?.partnerAccess?.organizationId || accessProfile?.agentAccess?.organizationId || '').trim()
  if (accessProfile?.platformRole || accessProfile?.partnerAccess) {
    throw new Error('This account already has platform or partner access and cannot also become a sales agent.')
  }
  if (accessProfile?.agentAccess && linkedOrganizationId && linkedOrganizationId !== String(organization._id)) {
    throw new Error('This account already belongs to another channel partner organization.')
  }

  const currentLearningRole = String(account.learningRole || 'learner').trim().toLowerCase()
  const previousRole = currentLearningRole === 'channel_sales_agent'
    ? String(account.roleMetadata?.previousLearningRole || 'learner').trim().toLowerCase()
    : currentLearningRole

  account.learningRole = 'channel_sales_agent'
  account.partnerOrganization = organization._id
  account.currentOrganization = organization._id
  account.roleMetadata = {
    previousLearningRole: ['learner', 'creator'].includes(previousRole) ? previousRole : 'learner',
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
  organizationName,
  emailVerified = true
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
    emailVerified: bootstrapAsSuperAdmin ? true : Boolean(emailVerified),
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
      organizationName,
      req
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
    return res.redirect(await resolveLoginDestination(req.user, returnTo || '/simple-lms'))
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
    idpLoginEnabled: branding.brandKey !== 'aiin' && isIdpOidcConfigured(),
    idpLoginUrl: appendQuery('/auth/seemplify', { return_to: returnTo }),
    error: String(req.query.error || ''),
    success: String(req.query.success || '')
  })
})

router.get('/admin/login', optionalAuth, async (req, res) => {
  const branding = resolveBranding(req.hostname || req.get('host'))
  const returnTo = sanitizeReturnTo(req.query.return_to || '/admin')
  if (req.user) {
    return res.redirect(await resolveLoginDestination(req.user, returnTo || '/admin'))
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
    idpLoginEnabled: branding.brandKey !== 'aiin' && isIdpOidcConfigured(),
    idpLoginUrl: appendQuery('/auth/seemplify', { return_to: returnTo }),
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

    if (!account.emailVerified) {
      const pendingAdminInvite = await findPendingAdminInviteForEmail(account.email)
      if (pendingAdminInvite?.registeredAccount?._id && String(pendingAdminInvite.registeredAccount._id) === String(account._id)) {
        const otpExpired = !pendingAdminInvite.otpExpiresAt || pendingAdminInvite.otpExpiresAt.getTime() <= Date.now()
        if (!pendingAdminInvite.otpHash || otpExpired) {
          await issueAdminInviteOtp({
            invite: pendingAdminInvite,
            account,
            req,
            purpose: 'login_retry'
          })
        }
        const verifyPath = appendQuery('/verify-account', {
          admin_invite_token: pendingAdminInvite.token,
          email: account.email,
          info: 'Verify your email to activate admin access.'
        })
        return res.redirect(verifyPath)
      }

      return res.redirect(`/login?error=${encodeURIComponent('Account verification is still required')}&return_to=${encodeURIComponent(returnTo)}`)
    }

    const sessionAccountId = resolveSessionAccountIdentifier(account)
    if (!sessionAccountId) {
      return res.redirect(`/login?error=${encodeURIComponent('Account session could not be established')}&return_to=${encodeURIComponent(returnTo)}`)
    }

    req.session.accountId = sessionAccountId
    const destination = await resolveLoginDestination(account, returnTo)

    return req.session.save((sessionError) => {
      if (sessionError) {
        console.error('Session save error:', sessionError)
        return res.redirect('/login?error=Failed%20to%20start%20session')
      }
      return res.redirect(destination)
    })
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
  const adminInviteToken = sanitizeInviteToken(req.query.admin_invite_token || req.query.adminInviteToken || '')
  const adminInvite = adminInviteToken
    ? await findAdminInviteByToken(adminInviteToken, { allowedStatuses: ['pending', 'registered'] })
    : null

  const intent = invite || adminInvite
    ? 'learn'
    : sanitizeIntent(req.query.intent || pendingIntent?.intent || 'learn', 'learn')
  const source = sanitizeIntentSource(
    req.query.source || pendingIntent?.source || (
      invite
        ? 'agent_invite'
        : (adminInvite ? 'admin_invite' : (intent === 'teach' ? 'teach_landing' : 'direct'))
    ),
    invite
      ? 'agent_invite'
      : (adminInvite ? 'admin_invite' : (intent === 'teach' ? 'teach_landing' : 'direct'))
  )
  const returnTo = sanitizeReturnTo(
    req.query.return_to || pendingIntent?.returnTo || (
      invite
        ? '/agent-dashboard'
        : (adminInvite ? '/admin' : (intent === 'teach' ? '/teach/get-started' : '/simple-lms'))
    )
  )

  if (req.session?.pendingRegistrationIntent) {
    delete req.session.pendingRegistrationIntent
  }

  if (req.user) {
    return res.redirect(await resolveLoginDestination(req.user, returnTo || '/simple-lms'))
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
    adminInviteToken,
    adminInviteEmail: adminInvite?.email || '',
    adminInviteRole: adminInvite?.requestedRole || 'admin',
    adminInviteExpired: Boolean(adminInviteToken && !adminInvite),
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
    const adminInviteToken = sanitizeInviteToken(req.body.admin_invite_token || req.body.adminInviteToken || '')
    const adminInvite = adminInviteToken
      ? await findAdminInviteByToken(adminInviteToken, { allowedStatuses: ['pending', 'registered'] })
      : null
    const intent = sanitizeIntent(req.body.intent || 'learn', 'learn')
    const source = sanitizeIntentSource(
      req.body.source || (
        invite
          ? 'agent_invite'
          : (adminInvite ? 'admin_invite' : (intent === 'teach' ? 'teach_landing' : 'direct'))
      ),
      invite
        ? 'agent_invite'
        : (adminInvite ? 'admin_invite' : (intent === 'teach' ? 'teach_landing' : 'direct'))
    )
    const returnTo = sanitizeReturnTo(
      req.body.return_to || (
        invite
          ? '/agent-dashboard'
          : (adminInvite ? '/admin' : (intent === 'teach' ? '/teach/get-started' : '/simple-lms'))
      )
    )
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
        invite_token: inviteToken,
        admin_invite_token: adminInviteToken
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

    if (adminInviteToken && !adminInvite) {
      return res.redirect(registerRedirect('This admin invite is invalid or has expired'))
    }

    if (invite && email !== normalizeEmail(invite.email)) {
      return res.redirect(registerRedirect('Use the invited email address to complete this agent registration'))
    }

    if (adminInvite && email !== normalizeEmail(adminInvite.email)) {
      return res.redirect(registerRedirect('Use the invited email address to complete this admin registration'))
    }

    if (!invite && !adminInvite && isPartnerRegistrationIntent(intent) && !organizationName) {
      return res.redirect(registerRedirect('Organization name is required for partner applications'))
    }

    const existingAccount = await Account.findOne({ email }).select('_id').lean()
    if (existingAccount) {
      if (adminInvite && adminInvite.registeredAccount?._id && String(adminInvite.registeredAccount._id) === String(existingAccount._id)) {
        return res.redirect(appendQuery('/verify-account', {
          admin_invite_token: adminInvite.token,
          email,
          info: 'Finish verification to activate your admin access.'
        }))
      }
      return res.redirect(registerRedirect('Email already exists'))
    }

    const registrationIntent = invite || adminInvite ? 'learn' : intent
    const registration = await createAccountFromRegistration({
      req,
      intent: registrationIntent,
      source,
      returnTo,
      name,
      email,
      password,
      organizationName,
      emailVerified: !adminInvite
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

    if (adminInvite) {
      await issueAdminInviteOtp({
        invite: adminInvite,
        account: registration.account,
        req,
        purpose: 'initial'
      })
      registration.successMessage = `Verify the code sent to ${email} to activate your ${resolveAdminInviteRoleCopy(adminInvite.requestedRole)} access.`
      registration.destination = appendQuery('/verify-account', {
        admin_invite_token: adminInvite.token,
        email,
        success: `Welcome to ${branding.learningName}. Check your email for the verification code.`
      })
    }

    if (adminInvite) {
      return res.redirect(registration.destination)
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
    const adminInviteToken = sanitizeInviteToken(req.body.admin_invite_token || req.body.adminInviteToken || '')
    const adminInvite = adminInviteToken
      ? await findAdminInviteByToken(adminInviteToken, { allowedStatuses: ['pending', 'registered'] })
      : null
    const intent = sanitizeIntent(req.body.intent || 'learn', 'learn')
    const source = sanitizeIntentSource(
      req.body.source || (invite ? 'agent_invite_api' : (adminInvite ? 'admin_invite_api' : 'api')),
      invite ? 'agent_invite_api' : (adminInvite ? 'admin_invite_api' : 'api')
    )
    const returnTo = sanitizeReturnTo(req.body.return_to || (invite ? '/agent-dashboard' : (adminInvite ? '/admin' : '/simple-lms')))
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
    if (adminInviteToken && !adminInvite) {
      return res.status(400).json({ error: 'Admin invite is invalid or expired', code: 'ADMIN_INVITE_INVALID' })
    }
    if (invite && email !== normalizeEmail(invite.email)) {
      return res.status(400).json({ error: 'Invite email does not match account email', code: 'INVITE_EMAIL_MISMATCH' })
    }
    if (adminInvite && email !== normalizeEmail(adminInvite.email)) {
      return res.status(400).json({ error: 'Admin invite email does not match account email', code: 'ADMIN_INVITE_EMAIL_MISMATCH' })
    }
    if (!invite && !adminInvite && isPartnerRegistrationIntent(intent) && !organizationName) {
      return res.status(400).json({ error: 'Organization name is required for partner applications', code: 'VALIDATION_ERROR' })
    }

    const existingAccount = await Account.findOne({ email }).select('_id').lean()
    if (existingAccount) {
      if (adminInvite && adminInvite.registeredAccount?._id && String(adminInvite.registeredAccount._id) === String(existingAccount._id)) {
        return res.status(200).json({
          success: true,
          destination: appendQuery('/verify-account', {
            admin_invite_token: adminInvite.token,
            email
          }),
          message: 'Finish verification to activate your admin access.',
          pendingApproval: false,
          pendingVerification: true,
          user: {
            id: existingAccount._id,
            email,
            role: 'learner'
          }
        })
      }
      return res.status(409).json({ error: 'Email already exists', code: 'EMAIL_EXISTS' })
    }

    const registrationIntent = invite || adminInvite ? 'learn' : intent
    const registration = await createAccountFromRegistration({
      req,
      intent: registrationIntent,
      source,
      returnTo,
      name,
      email,
      password,
      organizationName,
      emailVerified: !adminInvite
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

    if (adminInvite) {
      await issueAdminInviteOtp({
        invite: adminInvite,
        account: registration.account,
        req,
        purpose: 'initial_api'
      })
      registration.successMessage = `Verify the code sent to ${email} to activate your ${resolveAdminInviteRoleCopy(adminInvite.requestedRole)} access.`
      registration.destination = appendQuery('/verify-account', {
        admin_invite_token: adminInvite.token,
        email
      })
      return res.status(201).json({
        success: true,
        destination: registration.destination,
        message: registration.successMessage,
        pendingApproval: false,
        pendingVerification: true,
        user: {
          id: registration.account._id,
          sub: registration.account.sub,
          email: registration.account.email,
          role: 'learner'
        }
      })
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
    const accessProfile = await resolveAccessProfile(account)
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
        isSystemAdmin: Boolean(account.isSystemAdmin),
        accessProfile
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

router.get('/verify-account', optionalAuth, async (req, res) => {
  const branding = resolveBranding(req.hostname || req.get('host'))
  const adminInviteToken = sanitizeInviteToken(req.query.admin_invite_token || req.query.adminInviteToken || '')
  const email = normalizeEmail(req.query.email || '')
  const invite = adminInviteToken
    ? await findAdminInviteByToken(adminInviteToken, { allowedStatuses: ['pending', 'registered'] })
    : null

  const registeredAccount = invite?.registeredAccount || null
  const verificationReady = Boolean(
    invite
    && registeredAccount?._id
    && normalizeEmail(invite.email) === email
    && String(invite.status || '').trim().toLowerCase() === 'registered'
  )

  return res.render('verify-account', {
    title: `${branding.learningName} - Verify account`,
    email,
    adminInviteToken,
    verificationReady,
    requestedRole: invite?.requestedRole || 'admin',
    inviteExpired: Boolean(adminInviteToken && !invite),
    canResend: Boolean(verificationReady),
    error: String(req.query.error || ''),
    success: String(req.query.success || ''),
    info: String(req.query.info || '')
  })
})

router.post('/verify-account', async (req, res) => {
  try {
    const adminInviteToken = sanitizeInviteToken(req.body.admin_invite_token || req.body.adminInviteToken || '')
    const email = normalizeEmail(req.body.email || '')
    const otp = sanitizeOtpCode(req.body.otp || req.body.code || '')
    const redirectBack = (message, type = 'error') => appendQuery('/verify-account', {
      admin_invite_token: adminInviteToken,
      email,
      [type]: message
    })

    if (!adminInviteToken || !email) {
      return res.redirect('/login?error=Verification%20session%20is%20missing')
    }
    if (!otp || otp.length !== 6) {
      return res.redirect(redirectBack('Enter the 6-digit verification code'))
    }

    const invite = await findAdminInviteByToken(adminInviteToken, {
      allowedStatuses: ['registered'],
      requireRegisteredAccount: true
    })
    if (!invite || normalizeEmail(invite.email) !== email) {
      return res.redirect(redirectBack('This verification session is invalid or expired'))
    }

    const account = await Account.findById(invite.registeredAccount?._id)
    if (!account) {
      return res.redirect(redirectBack('The invited account could not be found'))
    }
    if (account.emailVerified) {
      return res.redirect('/login?success=Account%20already%20verified')
    }
    if (!invite.otpHash || !invite.otpExpiresAt || invite.otpExpiresAt.getTime() <= Date.now()) {
      return res.redirect(redirectBack('The verification code expired. Request a new code.'))
    }

    const matches = hashOtpCode(otp) === String(invite.otpHash || '')
    if (!matches) {
      invite.verificationAttempts = Math.max(0, Number(invite.verificationAttempts || 0)) + 1
      await invite.save()
      return res.redirect(redirectBack('The verification code is incorrect'))
    }

    await activateAdminInviteForAccount({
      account,
      invite,
      req
    })

    req.session.accountId = resolveSessionAccountIdentifier(account)
    const destination = await resolveLoginDestination(account, '/admin')
    return req.session.save((sessionError) => {
      if (sessionError) {
        console.error('Verification session save error:', sessionError)
        return res.redirect('/login?error=Failed%20to%20start%20admin%20session')
      }
      const joiner = destination.includes('?') ? '&' : '?'
      return res.redirect(`${destination}${joiner}success=${encodeURIComponent('Admin access activated')}`)
    })
  } catch (error) {
    console.error('Verify account error:', error)
    const adminInviteToken = sanitizeInviteToken(req.body.admin_invite_token || req.body.adminInviteToken || '')
    const email = normalizeEmail(req.body.email || '')
    return res.redirect(appendQuery('/verify-account', {
      admin_invite_token: adminInviteToken,
      email,
      error: 'Failed to verify account'
    }))
  }
})

router.get('/choose-workspace', requireAuth, async (req, res) => {
  try {
    const branding = resolveBranding(req.hostname || req.get('host'))
    const accessProfile = req.accessProfile || await resolveAccessProfile(req.user)
    if (!accessProfile?.hasMultiplePrivilegedDashboards) {
      return res.redirect(getDefaultDashboardPath(accessProfile, '/simple-lms'))
    }

    const workspaceCards = [
      accessProfile.platformRole
        ? {
          key: 'admin',
          title: 'Admin Console',
          href: getDashboardPathForKey('admin'),
          body: 'Platform administration, approvals, analytics, payments, and access control.'
        }
        : null,
      accessProfile.partnerAccess
        ? {
          key: 'partner',
          title: 'Partner Dashboard',
          href: getDashboardPathForKey('partner'),
          body: `Manage ${accessProfile.partnerAccess.organizationName || 'your organization'} as ${String(accessProfile.partnerAccess.dashboardRole || '').replace(/_/g, ' ')}.`
        }
        : null,
      accessProfile.agentAccess
        ? {
          key: 'agent',
          title: 'Agent Dashboard',
          href: getDashboardPathForKey('agent'),
          body: `Track referral sales and commissions for ${accessProfile.agentAccess.organizationName || 'your channel partner organization'}.`
        }
        : null,
      {
        key: 'workspace',
        title: 'Learning Workspace',
        href: '/simple-lms',
        body: 'Continue learning, view your catalog, and manage your personal workspace.'
      }
    ].filter(Boolean)

    return res.render('choose-workspace', {
      title: `${branding.learningName} - Choose workspace`,
      user: req.user,
      accessProfile,
      activePage: '',
      workspaceCards,
      success: String(req.query.success || ''),
      error: String(req.query.error || '')
    })
  } catch (error) {
    console.error('Choose workspace error:', error)
    return res.redirect('/simple-lms?error=Failed%20to%20load%20workspace%20chooser')
  }
})

router.post('/verify-account/resend', async (req, res) => {
  try {
    const adminInviteToken = sanitizeInviteToken(req.body.admin_invite_token || req.body.adminInviteToken || '')
    const email = normalizeEmail(req.body.email || '')
    const redirectBack = (message, type = 'success') => appendQuery('/verify-account', {
      admin_invite_token: adminInviteToken,
      email,
      [type]: message
    })

    const invite = await findAdminInviteByToken(adminInviteToken, {
      allowedStatuses: ['registered'],
      requireRegisteredAccount: true
    })
    if (!invite || normalizeEmail(invite.email) !== email) {
      return res.redirect(redirectBack('Verification session is invalid or expired', 'error'))
    }

    const account = await Account.findById(invite.registeredAccount?._id)
    if (!account) {
      return res.redirect(redirectBack('The invited account could not be found', 'error'))
    }
    if (account.emailVerified) {
      return res.redirect('/login?success=Account%20already%20verified')
    }

    await issueAdminInviteOtp({
      invite,
      account,
      req,
      purpose: 'resend'
    })

    return res.redirect(redirectBack('A fresh verification code was sent to your email'))
  } catch (error) {
    console.error('Resend verification code error:', error)
    const adminInviteToken = sanitizeInviteToken(req.body.admin_invite_token || req.body.adminInviteToken || '')
    const email = normalizeEmail(req.body.email || '')
    return res.redirect(appendQuery('/verify-account', {
      admin_invite_token: adminInviteToken,
      email,
      error: 'Failed to resend verification code'
    }))
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
