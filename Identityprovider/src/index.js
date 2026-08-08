import dotenv from 'dotenv'
import express from 'express'
import cookieParser from 'cookie-parser'
import session from 'express-session'
import { Provider } from 'oidc-provider'
import mongoose from 'mongoose'
import { MongoAdapter } from './adapter/mongoAdapter.js'
import { Account } from './models/Account.js'
import { Organization } from './models/Organization.js'
import { OrganizationInvite } from './models/OrganizationInvite.js'
import SubscriptionRequest from './models/SubscriptionRequest.js'
import { Team } from './models/Team.js'
import { Notification } from './models/Notification.js'
import { OnboardingTemplate } from './models/OnboardingTemplate.js'
import { OnboardingAssignment } from './models/OnboardingAssignment.js'
import { OnboardingActivity } from './models/OnboardingActivity.js'
import PerformanceEvaluation from './models/PerformanceEvaluation.js'
import SimplePerformanceEvaluationConfig from './models/SimplePerformanceEvaluationConfig.js'
import AppLaunchActivity from './models/AppLaunchActivity.js'
import { getHubApps, getAppById, getAppApiUrl, getComingSoonCards } from './config/hubApps.js'
import bcrypt from 'bcryptjs'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import crypto from 'crypto'
import { SignJWT, jwtVerify } from 'jose'
import { emailService } from './services/emailService.js'
import { issueAttendanceHubToken } from './services/attendanceHubService.js'
import { renderOidcRecoveryPage } from './services/oidcRecoveryPage.js'
import { otpService } from './services/otpService.js'
import MarketingVisit from './models/MarketingVisit.js'
import { buildOrganizationClaims } from './utils/permissions.js'
import { getTeamClaims } from './utils/teams.js'
import { buildMemberStructureMap, getMemberStructure } from './utils/memberStructure.js'
import { buildOnboardingStateMap, getMemberOnboardingState } from './utils/onboardingStatus.js'
import { getDerivedManagerInfo } from './utils/teamManager.js'
import {
  SIMPLE_PERFORMANCE_DEFAULT_FIELDS,
  PERFORMANCE_RATING_SCALE,
  TEAM_ROLE_LABELS,
  buildSimplePerformanceFieldKey,
  normalizeSimplePerformanceFieldLabel,
  calculateAverageRating,
  getEvaluableMembersForEvaluator
} from './utils/performanceEvaluation.js'
import {
  APP_ACCESS_MODE_SELECTED,
  buildValidAppIdSet,
  memberCanAccessApp,
  normalizeAppAccess
} from './utils/appAccess.js'
import { initializeCleanupJobs } from './jobs/cleanupExpiredInvites.js'
import { startCampaignWorker } from './jobs/campaignWorker.js'
import { startSubscriptionLifecycleJobs } from './jobs/subscriptionLifecycle.js'
import { getProfileCompletion, getProfileCompletionForAccount } from './utils/profileCompletion.js'
import {
  PAYROLL_BANK_JURISDICTIONS,
  NIGERIAN_BANK_OPTIONS
} from './config/payrollBankJurisdictions.js'

// SAML 2.0 Support
import samlRoutes, { setClaimsFunction, setSessionFunction } from './routes/samlRoutes.js'
import {
  ATTRIBUTION_QUERY_PARAM,
  buildAttributionTouch,
  resolveRequestAttribution
} from './services/campaignAttributionService.js'
import { registerCampaignConversion, resolveVisitorTouches } from './services/marketingConversionService.js'
import { samlIdPService as samlService } from './services/samlService.js'
import { subscriptionService } from './services/subscriptionService.js'
import cloudinary, { isCloudinaryConfigured } from './services/cloudinaryService.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// =============================================================================
// CLAIMS CACHING - Performance optimization for repeated claims building
// =============================================================================
const claimsCache = new Map()
const CLAIMS_CACHE_TTL = 5 * 60 * 1000 // 5 minutes
const DAY_IN_MS = 24 * 60 * 60 * 1000

/**
 * Get cached claims or build new ones
 * Cache key includes:
 *   - account ID (sub)
 *   - updatedAt timestamp for data change invalidation
 *   - currentOrganization ID to invalidate on org switch
 *
 * IMPORTANT: Including currentOrganization in the cache key ensures that
 * switching organizations in the Hub immediately gives the user fresh claims
 * reflecting their new current organization context.
 */
async function getCachedClaims(acc) {
  const startTime = Date.now()
  const currentOrgId = acc.currentOrganization?._id?.toString() || acc.currentOrganization?.toString() || 'none'
  const cacheKey = `claims:${acc.sub}:${acc.updatedAt?.getTime() || 0}:${currentOrgId}`
  const cached = claimsCache.get(cacheKey)

  if (cached && (Date.now() - cached.timestamp) < CLAIMS_CACHE_TTL) {
    console.log(`⚡ [PERF] Claims cache HIT for ${acc.email} (${Date.now() - startTime}ms)`)
    return cached.data
  }

  console.log(`🔨 [PERF] Building claims for ${acc.email}...`)

  // Build claims in PARALLEL for performance
  const [organizationClaims, teamClaims, subscriptionClaims] = await Promise.all([
    buildOrganizationClaims(acc),
    getTeamClaims(acc),
    buildSubscriptionClaims(acc)
  ])

  const currentOrganizationId =
    acc.currentOrganization?._id?.toString() ||
    acc.currentOrganization?.toString() ||
    null
  const currentOrganizationClaim = currentOrganizationId
    ? organizationClaims.find((organization) => organization.id === currentOrganizationId) || null
    : null
  const currentOrganization = currentOrganizationClaim
    ? {
      id: currentOrganizationClaim.id,
      name: currentOrganizationClaim.name,
      role: currentOrganizationClaim.role,
      departmentId: currentOrganizationClaim.departmentId || null,
      departmentName: currentOrganizationClaim.departmentName || null,
      branchId: currentOrganizationClaim.branchId || null,
      branchName: currentOrganizationClaim.branchName || null,
      branchCode: currentOrganizationClaim.branchCode || null,
      designation: currentOrganizationClaim.designation || null,
      employeeId: currentOrganizationClaim.employeeId || null
    }
    : (acc.currentOrganization
      ? {
        id: acc.currentOrganization._id?.toString() || acc.currentOrganization.toString(),
        name: acc.currentOrganization.name
      }
      : null)

  const claims = {
    sub: acc.sub,
    email: acc.email,
    email_verified: acc.emailVerified,
    name: acc.profile?.name,
    preferred_username: acc.profile?.preferred_username,
    // Organization claims (with permissions)
    organizations: organizationClaims,
    current_organization: currentOrganization,
    currentOrganization: currentOrganization,
    // Subscription claims (for current organization)
    subscription: subscriptionClaims,
    // Team claims (with hierarchy)
    teams: teamClaims,
    // Team-based permissions across all organizations
    team_permissions: teamClaims
      .filter(t => t.role === 'line_manager' || t.role === 'team_lead')
      .map(t => ({
        team_id: t.id,
        team_name: t.name,
        organization_id: t.organizationId,
        direct_reports: t.directReports,
        permissions: ['approve_leaves', 'view_team_leaves', 'view_direct_reports_leaves']
      }))
  }

  // Cache the claims
  claimsCache.set(cacheKey, { data: claims, timestamp: Date.now() })

  // Clean up old cache entries periodically (keep cache size manageable)
  if (claimsCache.size > 1000) {
    const now = Date.now()
    for (const [key, value] of claimsCache.entries()) {
      if (now - value.timestamp > CLAIMS_CACHE_TTL) {
        claimsCache.delete(key)
      }
    }
  }

  console.log(`✅ [PERF] Claims built for ${acc.email} in ${Date.now() - startTime}ms (orgs: ${organizationClaims.length}, teams: ${teamClaims.length})`)

  return claims
}

/**
 * Build subscription claims for the current organization
 * Returns subscription status, features, and limits for apps to verify access
 */
async function buildSubscriptionClaims(acc) {
  // No current organization = no subscription claims
  if (!acc.currentOrganization) {
    return {
      status: 'none',
      planId: null,
      planName: null,
      features: {
        recruiter: false,
        leaveManagement: false,
        payrollManagement: false,
        performanceManagement: false,
        outlineDocs: false,
        aiChat: false,
        lms: false
      },
      limits: {
        maxMembers: 0,
        maxTeams: 0,
        maxSystemCourses: null
      },
      expiresAt: null,
      isInGracePeriod: false
    }
  }

  try {
    const orgId = acc.currentOrganization._id?.toString() || acc.currentOrganization.toString()

    // Get subscription info from service
    const subscription = await subscriptionService.getSubscriptionForOrg(orgId)

    if (!subscription) {
      return {
        status: 'none',
        planId: null,
        planName: null,
        features: {
          recruiter: false,
          leaveManagement: false,
          payrollManagement: false,
          performanceManagement: false,
          outlineDocs: false,
          aiChat: false,
          lms: false
        },
        limits: {
          maxMembers: 0,
          maxTeams: 0,
          maxSystemCourses: null
        },
        expiresAt: null,
        isInGracePeriod: false
      }
    }

    // Get effective features and limits (merges plan + custom overrides)
    const [features, limits] = await Promise.all([
      subscriptionService.getEffectiveFeatures(orgId),
      subscriptionService.getEffectiveLimits(orgId)
    ])

    // Determine effective status
    let effectiveStatus = subscription.status
    if (subscription.status === 'expired' && subscription.isInGracePeriod) {
      effectiveStatus = 'grace_period'
    }

    return {
      status: effectiveStatus,
      planId: subscription.plan?._id?.toString() || null,
      planName: subscription.plan?.name || null,
      features: {
        recruiter: features.recruiter || false,
        leaveManagement: features.leaveManagement || false,
        payrollManagement: features.payrollManagement || false,
        performanceManagement: features.performanceManagement || false,
        outlineDocs: features.outlineDocs || false,
        aiChat: features.aiChat || false,
        lms: features.lms || false
      },
      limits: {
        maxMembers: limits.maxMembers,
        maxTeams: limits.maxTeams,
        maxSystemCourses: Object.prototype.hasOwnProperty.call(limits || {}, 'maxSystemCourses')
          ? limits.maxSystemCourses
          : null
      },
      expiresAt: subscription.endDate?.toISOString() || null,
      isInGracePeriod: subscription.isInGracePeriod || false
    }
  } catch (error) {
    console.error('Error building subscription claims:', error)
    // Return safe defaults on error
    return {
      status: 'error',
      planId: null,
      planName: null,
      features: {
        recruiter: false,
        leaveManagement: false,
        payrollManagement: false,
        performanceManagement: false,
        outlineDocs: false,
        aiChat: false,
        lms: false
      },
      limits: {
        maxMembers: 0,
        maxTeams: 0,
        maxSystemCourses: null
      },
      expiresAt: null,
      isInGracePeriod: false
    }
  }
}

async function getCurrentOrganizationSubscriptionAccessState(user, options = {}) {
  const { includePendingRequest = false, includeFeatures = false } = options
  const organizationId =
    user?.currentOrganization?._id?.toString() ||
    user?.currentOrganization?.toString() ||
    null

  if (!organizationId) {
    return null
  }

  const now = new Date()
  const [organization, subscription, pendingRequest] = await Promise.all([
    Organization.findById(organizationId)
      .select('name subscriptionStatus subscriptionExpiresAt currentPlan')
      .populate('currentPlan', 'name')
      .lean(),
    subscriptionService.getSubscriptionForOrg(organizationId),
    includePendingRequest
      ? SubscriptionRequest.findOne({
        organization: organizationId,
        status: 'pending',
        expiresAt: { $gte: now }
      })
        .populate('plan', 'name slug')
        .sort({ createdAt: -1 })
        .lean()
      : Promise.resolve(null)
  ])

  if (!organization) {
    return null
  }

  const hasActiveAccess = Boolean(
    subscription &&
    subscription.status === 'active' &&
    subscription.endDate &&
    new Date(subscription.endDate).getTime() >= now.getTime()
  )
  const daysUntilExpiry = hasActiveAccess && subscription?.endDate
    ? Math.max(0, Math.ceil((new Date(subscription.endDate).getTime() - now.getTime()) / DAY_IN_MS))
    : null

  const status = hasActiveAccess
    ? 'active'
    : (
      organization.subscriptionStatus ||
      (subscription?.isInGracePeriod ? 'grace_period' : 'none')
    )

  const features = includeFeatures && hasActiveAccess
    ? await subscription.getEffectiveFeatures()
    : null

  return {
    organizationId,
    organizationName: organization.name || 'Organization',
    status,
    hasActiveAccess,
    isLocked: !hasActiveAccess,
    planName: subscription?.plan?.name || organization.currentPlan?.name || null,
    expiresAt: subscription?.endDate || organization.subscriptionExpiresAt || null,
    gracePeriodEnd: subscription?.gracePeriodEnd || null,
    daysUntilExpiry,
    showExpiryReminder: Boolean(hasActiveAccess && daysUntilExpiry !== null && daysUntilExpiry <= 7),
    features,
    pendingRequest: pendingRequest
      ? {
        id: pendingRequest._id?.toString?.() || '',
        planName: pendingRequest.plan?.name || 'Requested plan',
        status: pendingRequest.status,
        createdAt: pendingRequest.createdAt
      }
      : null
  }
}

function respondToSubscriptionLock(req, res, accessState) {
  const message = accessState?.pendingRequest
    ? `Access is locked for ${accessState.organizationName}. A plan request is already pending approval.`
    : `Access is locked for ${accessState?.organizationName || 'this organization'}. Request another plan to continue.`

  const acceptsJson = String(req.get('accept') || '').includes('application/json') || req.xhr
  if (req.method !== 'GET' || acceptsJson) {
    return res.status(403).json({
      error: message,
      subscriptionStatus: accessState?.status || 'none',
      requiresPlanRequest: true
    })
  }

  return res.redirect('/?subscription=locked')
}

const requireCurrentOrganizationActiveSubscription = async (req, res, next) => {
  if (!req.user) return next()

  const accessState = await getCurrentOrganizationSubscriptionAccessState(req.user, {
    includePendingRequest: true
  })

  req.currentSubscriptionAccess = accessState
  if (!accessState || accessState.hasActiveAccess) {
    return next()
  }

  return respondToSubscriptionLock(req, res, accessState)
}

// =============================================================================
// SAML 2.0 SETUP - Share getCachedClaims and getSessionFromCookies with SAML routes
// =============================================================================
setClaimsFunction(getCachedClaims)
setSessionFunction(getSessionFromCookies)

// Initialize SAML Identity Provider and load Service Providers
const initializeSamlIdP = () => {
  try {
    // Initialize the SAML IdP service
    samlService.initialize()

    if (!samlService.isReady()) {
      console.log('ℹ️ SAML IdP not configured (missing certificates)')
      return
    }

    // Load Service Provider configurations
    const spsConfigPath = join(__dirname, '../saml-sps.json')
    const spsData = JSON.parse(readFileSync(spsConfigPath, 'utf-8'))

    let enabledCount = 0
    for (const sp of spsData.serviceProviders) {
      if (sp.enabled !== false) {
        samlService.registerServiceProvider(sp.id, sp)
        enabledCount++
      }
    }

    if (enabledCount > 0) {
      console.log(`✅ SAML IdP ready with ${enabledCount} Service Provider(s)`)
    }
  } catch (error) {
    console.log('ℹ️ SAML IdP not configured:', error.message)
  }
}

initializeSamlIdP()

/**
 * Invalidate claims cache for a specific account
 * Call this when account data changes (org membership, team membership, etc.)
 */
export function invalidateClaimsCache(accountSub) {
  for (const key of claimsCache.keys()) {
    if (key.startsWith(`claims:${accountSub}:`)) {
      claimsCache.delete(key)
    }
  }
}
import { setProviderInstance } from './middleware/apiAuth.js'
import organizationsRouter from './routes/organizations.js'
import invitationsRouter from './routes/invitations.js'
import membersRouter from './routes/members.js'
import teamsRouter from './routes/teams.js'
import notificationsRouter from './routes/notifications.js'
import onboardingRouter from './routes/onboarding.js'
// Subscription Management Routes
import adminPlansRouter from './routes/adminPlans.js'
import adminSubscriptionRequestsRouter from './routes/adminSubscriptionRequests.js'
import adminSubscriptionsRouter from './routes/adminSubscriptions.js'
import adminCampaignApiRouter from './routes/adminCampaignApi.js'
import adminCampaignViewsRouter from './routes/adminCampaignViews.js'
import adminViewsRouter from './routes/adminViews.js'
import publicPlansRouter from './routes/publicPlans.js'
import publicMarketingRoutesRouter from './routes/publicMarketingRoutes.js'
import publicRoutesRouter from './routes/publicRoutes.js'
import organizationSubscriptionRouter from './routes/organizationSubscription.js'
import adminUsersRouter from './routes/adminUsers.js'
import profileRouter from './routes/profile.js'

dotenv.config()

// Shared UI theme for IdP pages (marketing-site aesthetic)
const themeCss = readFileSync(join(__dirname, 'public/css/idp-theme.css'), 'utf-8')
const seemplifyLogoUrl = 'https://seemplifyai.com/images/seemplifylogo.png'
const seemplifyMarkSvg = `
  <img
    src="${seemplifyLogoUrl}"
    alt="Seemplify"
    width="148"
    height="62"
    loading="eager"
    decoding="async"
    class="seemplify-wordmark"
    style="display:block;width:auto;max-width:100%;height:40px;"
  />
`
const seemplifyNavLogoImg = `
  <img
    src="${seemplifyLogoUrl}"
    alt="Seemplify"
    width="148"
    height="62"
    loading="eager"
    decoding="async"
    class="seemplify-wordmark seemplify-wordmark--nav"
    style="display:block;width:auto;max-width:100%;height:51px;"
  />
`

function getIdpBrand(req) {
  const host = (req.headers['x-forwarded-host'] || req.hostname || '').toLowerCase()
  if (host.includes('akwa') || host.includes('ibom')) {
    const logoUrl = 'https://akwaibom.aiinnigeria.com/logoakwa.png'
    const logoHtml = `
      <img
        src="${logoUrl}"
        alt="Akwa Ibom State"
        width="148"
        height="62"
        loading="eager"
        decoding="async"
        class="seemplify-wordmark"
        style="display:block;width:auto;max-width:100%;height:40px;"
      />
    `
    const navLogoHtml = `
      <img
        src="${logoUrl}"
        alt="Akwa Ibom State"
        width="148"
        height="62"
        loading="eager"
        decoding="async"
        class="seemplify-wordmark seemplify-wordmark--nav"
        style="display:block;width:auto;max-width:100%;height:51px;"
      />
    `
    return {
      name: 'Akwa Ibom State',
      logoHtml,
      navLogoHtml,
      themeClass: 'jetstone-light-theme',
      cssVars: `
        :root {
          --brand: #15803d;
          --brand-2: #d97706;
          --brand-hover: #166534;
        }
        .jetstone-light-theme .login-brand {
          align-items: center;
        }
        .jetstone-light-theme .login-brand .brand-mark img {
          height: 48px !important;
        }
        .jetstone-light-theme .login-brand-name {
          display: none !important;
        }
        .jetstone-light-theme .marketing-pill {
          background: rgba(21, 128, 61, 0.1) !important;
          color: #15803d !important;
          border-color: rgba(21, 128, 61, 0.2) !important;
        }
        .jetstone-light-theme .status-dot {
          background: #15803d !important;
          box-shadow: 0 0 0 4px rgba(21, 128, 61, 0.2) !important;
        }
        .jetstone-light-theme .marketing-heading .highlight {
          background: linear-gradient(135deg, #15803d, #b45309, #854d0e) !important;
          -webkit-background-clip: text !important;
          -webkit-text-fill-color: transparent !important;
          background-clip: text !important;
          background-size: 200% 200% !important;
        }
        .jetstone-light-theme .feature-icon--green {
          background: rgba(21, 128, 61, 0.1) !important;
          color: #15803d !important;
        }
        .jetstone-light-theme .feature-icon--amber {
          background: rgba(217, 119, 6, 0.1) !important;
          color: #d97706 !important;
        }
        .jetstone-light-theme .feature-icon--teal {
          background: rgba(13, 148, 136, 0.1) !important;
          color: #0d9488 !important;
        }
        .jetstone-light-theme .feature-card:hover .feature-icon--green {
          background: rgba(21, 128, 61, 0.15) !important;
        }
        .jetstone-light-theme .feature-card:hover .feature-icon--amber {
          background: rgba(217, 119, 6, 0.15) !important;
        }
        .jetstone-light-theme .feature-card:hover .feature-icon--teal {
          background: rgba(13, 148, 136, 0.15) !important;
        }
      `,
      marketing: {
        pill: 'Official State Government Portal',
        heading: 'ARISE WORKFORCE,<br/><span class="highlight">Golden Era.</span>',
        desc: 'Akwa Ibom State provides a unified platform to manage human resources, recruitment, and public service administration efficiently.',
        features: [
          {
            title: 'Centralized Identity',
            desc: 'One secure digital identity for HR, learning, and public service administration.',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
            color: 'green'
          },
          {
            title: 'Transparent Access',
            desc: 'Secure role-based access for all state ministries, departments, and agencies.',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
            color: 'amber'
          },
          {
            title: 'Accountability',
            desc: 'Audit-ready security and transparency at every step of public service management.',
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/></svg>',
            color: 'teal'
          }
        ]
      }
    }
  }
  return {
    name: 'Seemplify',
    logoHtml: seemplifyMarkSvg,
    navLogoHtml: seemplifyNavLogoImg,
    themeClass: '',
    cssVars: '',
    marketing: {
      pill: 'Enterprise-ready &bull; SOC 2 Ready',
      heading: 'Your Workforce,<br/><span class="highlight">Supercharged.</span>',
      desc: 'Seemplify gives your organization a unified identity platform that connects HR, learning, and collaboration tools &mdash; reducing friction while improving security.',
      features: [
        {
          title: 'Single Sign-On',
          desc: 'One identity for SmartHR, LMS, Chat, AI Assistant, and all connected apps.',
          icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
          color: 'blue'
        },
        {
          title: 'Instant Access',
          desc: 'Adaptive MFA and session continuity for seamless, secure access across your tools.',
          icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
          color: 'purple'
        },
        {
          title: 'Enterprise Security',
          desc: 'SOC 2 ready with end-to-end encryption, SAML/OIDC, and organization-level controls.',
          icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/></svg>',
          color: 'accent'
        }
      ]
    }
  }
}

// Production environment detection
const isProduction = process.env.NODE_ENV === 'production'
const getProductionSafeUrl = (value, fallback) => {
  const configured = String(value || '').trim()
  if (!configured) return fallback
  try {
    const hostname = new URL(configured).hostname.toLowerCase()
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return fallback
  } catch {
    return fallback
  }
  return configured
}

// Load clients configuration
const clientsConfigPath = process.env.CLIENTS_CONFIG || join(__dirname, '../clients.json')
const clientsData = JSON.parse(readFileSync(clientsConfigPath, 'utf-8'))

// Helper function to validate redirect URI against patterns
function validateRedirectUri(uri, patterns) {
  return patterns.some(pattern => {
    // Convert pattern to regex (simple wildcard support)
    const regexPattern = pattern
      .replace(/\*/g, '.*')
      .replace(/\//g, '\\/')
    const regex = new RegExp(`^${regexPattern}$`)
    return regex.test(uri)
  })
}

// Helper function to validate origin against allowed origins
function validateOrigin(origin, allowedOrigins) {
  if (!origin) return false
  return allowedOrigins.some(allowed => {
    const regexPattern = allowed
      .replace(/\*/g, '.*')
      .replace(/\//g, '\\/')
    const regex = new RegExp(`^${regexPattern}$`)
    return regex.test(origin)
  })
}

const SIGNUP_ATTRIBUTION_FIELDS = [
  ATTRIBUTION_QUERY_PARAM,
  'visitorId',
  'sessionId',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content'
]

function escapeAttribute(value = '') {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function collectSignupAttribution(source = {}) {
  const values = {}
  for (const field of SIGNUP_ATTRIBUTION_FIELDS) {
    const value = String(source?.[field] ?? '').trim()
    if (value) {
      values[field] = value
    }
  }
  return values
}

function buildHiddenAttributionInputs(source = {}) {
  return Object.entries(collectSignupAttribution(source))
    .map(([field, value]) => `<input type="hidden" name="${field}" value="${escapeAttribute(value)}" />`)
    .join('\n')
}

function buildPathWithQuery(pathname, source = {}, extra = {}) {
  const params = new URLSearchParams()
  for (const [field, value] of Object.entries(collectSignupAttribution(source))) {
    params.set(field, value)
  }
  for (const [field, value] of Object.entries(extra)) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      params.set(field, String(value))
    }
  }
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}

async function buildSignupAttributionState(req, email = '') {
  const resolved = await resolveRequestAttribution(req, req.body || {})
  const occurredAt = new Date()
  const websiteTouch = buildAttributionTouch({
    sourceType: resolved.verifiedToken ? 'campaign_click' : 'website_visit',
    source: String(req.body?.source || req.query?.source || 'website'),
    channel: 'web',
    campaignId: resolved.verifiedToken?.campaignId || null,
    batchId: resolved.verifiedToken?.batchId || null,
    recipientId: resolved.verifiedToken?.recipientId || null,
    campaignName: resolved.verifiedToken?.campaignName || '',
    signedToken: resolved.signedToken,
    visitorId: resolved.visitorId,
    sessionId: resolved.sessionId,
    email: String(email || '').trim().toLowerCase(),
    landingPage: String(req.body?.landingPage || req.query?.landingPage || req.headers.referer || ''),
    referrer: String(req.body?.referrer || req.headers.referer || ''),
    utm: resolved.utm,
    occurredAt
  })
  const { firstTouch, lastTouch } = await resolveVisitorTouches({
    visitorId: resolved.visitorId,
    fallbackTouch: websiteTouch
  })
  const signupTouch = buildAttributionTouch({
    sourceType: 'signup',
    source: 'identityprovider',
    channel: 'web',
    campaignId: lastTouch?.campaignId || resolved.verifiedToken?.campaignId || null,
    batchId: lastTouch?.batchId || resolved.verifiedToken?.batchId || null,
    recipientId: lastTouch?.recipientId || resolved.verifiedToken?.recipientId || null,
    campaignName: lastTouch?.campaignName || resolved.verifiedToken?.campaignName || '',
    signedToken: resolved.signedToken,
    visitorId: resolved.visitorId,
    sessionId: resolved.sessionId,
    email: String(email || '').trim().toLowerCase(),
    landingPage: String(req.body?.landingPage || req.query?.landingPage || req.originalUrl || ''),
    referrer: String(req.body?.referrer || req.headers.referer || ''),
    utm: resolved.utm,
    occurredAt
  })

  return {
    resolved,
    firstTouch,
    lastTouch,
    signupTouch
  }
}

// Store clients metadata for later use (CORS, validation)
const clientsMetadata = new Map()
clientsData.clients.forEach(client => {
  clientsMetadata.set(client.client_id, {
    redirect_uri_patterns: client.redirect_uri_patterns,
    allowed_origins: client.allowed_origins
  })
})

const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI
if (!MONGODB_URI) {
  throw new Error('MONGO_URI environment variable is required')
}

const ISSUER_URL = process.env.ISSUER_URL
if (!ISSUER_URL) {
  throw new Error('ISSUER_URL environment variable is required')
}

const PORT = process.env.PORT || 4000
const SIMPLE_LMS_EXTERNAL_BASE_URL = String(
  process.env.SEEMPLIFY_LEARNING_URL ||
  process.env.SIMPLE_LMS_EXTERNAL_URL ||
  (isProduction ? 'https://learning.seemplifyai.com' : 'http://localhost:5012')
)
  .trim()
  .replace(/\/+$/, '')
const SIMPLE_LMS_EXTERNAL_WORKSPACE_URL = SIMPLE_LMS_EXTERNAL_BASE_URL.endsWith('/simple-lms')
  ? SIMPLE_LMS_EXTERNAL_BASE_URL
  : `${SIMPLE_LMS_EXTERNAL_BASE_URL}/simple-lms`

// Connect to MongoDB with error handling
try {
  console.log('🔌 Connecting to MongoDB...')
  await mongoose.connect(MONGODB_URI)
  console.log('✅ MongoDB connected successfully')
} catch (error) {
  console.error('❌ MongoDB connection failed:', error.message)
  console.error('Error details:', error)
  process.exit(1)
}

const config = {
  adapter: MongoAdapter,
  proxy: true, // Enable proxy support for Azure Web Apps
  clients: clientsData.clients.map(client => ({
    client_id: client.client_id,
    client_secret: client.client_secret,
    redirect_uris: client.redirect_uri_patterns,
    post_logout_redirect_uris: client.redirect_uri_patterns,
    response_types: client.response_types,
    grant_types: client.grant_types,
    token_endpoint_auth_method: client.token_endpoint_auth_method
  })),
  cookies: {
    keys: [process.env.OIDC_COOKIE_SECRET || 'dev-cookie-secret'],
    long: {
      signed: true,
      httpOnly: true,
      sameSite: isProduction ? 'none' : 'lax',
      secure: isProduction  // Required for cross-site cookies in production
    },
    short: {
      signed: true,
      httpOnly: true,
      sameSite: isProduction ? 'none' : 'lax',
      secure: isProduction
    }
  },
  scopes: ['openid', 'offline_access', 'email', 'profile'],
  // Allow hub_token to be passed through the authorization request
  // This enables IdP-initiated SSO from the hub
  extraParams: ['hub_token'],
  features: {
    devInteractions: { enabled: false },
    revocation: { enabled: true },
    introspection: { enabled: true },
    userinfo: { enabled: true }
  },
  // Make PKCE optional for clients that don't support it (like Outline, Zulip)
  pkce: {
    required: (ctx, client) => {
      // List of clients that don't support PKCE
      const noPkceClients = ['outline', 'openwebui', 'zulip'];
      return !noPkceClients.includes(client.clientId);
    }
  },
  interactions: {
    url(ctx, interaction) {
      return `/interaction/${interaction.uid}`;
    }
  },
  async renderError(ctx, out, error) {
    const clientId = ctx.oidc?.params?.client_id || ctx.query?.client_id || ''
    const recoveryApp = getHubApps().find(app => app.clientId === clientId || app.appId === clientId)
    const requestId = ctx.get?.('x-request-id') || crypto.randomUUID()
    const page = renderOidcRecoveryPage({
      error: out?.error || error?.error || error?.name,
      description: out?.error_description || error?.error_description || error?.message,
      appId: recoveryApp?.appId,
      appName: recoveryApp?.name,
      requestId,
      statusCode: error?.statusCode || ctx.status || 400
    })
    ctx.set('Cache-Control', 'no-store')
    ctx.set('X-SSO-Request-ID', requestId)
    ctx.type = 'html'
    ctx.status = page.statusCode
    ctx.body = page.html
  },
  // Load existing grant or return undefined to force consent interaction
  async loadExistingGrant(ctx) {
    const grantId = (ctx.oidc.result && ctx.oidc.result.consent && ctx.oidc.result.consent.grantId)
      || (ctx.oidc.session && ctx.oidc.session.grantIdFor(ctx.oidc.client.clientId));

    if (grantId) {
      // Return existing grant if found
      return ctx.oidc.provider.Grant.find(grantId);
    }

    // If there's a session and login was just completed, auto-grant
    if (ctx.oidc.session && ctx.oidc.session.accountId) {
      console.log('🎫 Creating grant for account:', ctx.oidc.session.accountId)
      const grant = new ctx.oidc.provider.Grant({
        clientId: ctx.oidc.client.clientId,
        accountId: ctx.oidc.session.accountId,
      });

      // Grant all requested scopes
      grant.addOIDCScope('openid email profile offline_access');
      grant.addOIDCClaims(['email', 'email_verified', 'name', 'preferred_username', 'organizations', 'teams', 'team_permissions', 'current_organization', 'currentOrganization']);

      await grant.save();
      return grant;
    }

    // No session or grant - will trigger login interaction
    return undefined;
  },
  claims: {
    openid: ['sub'],
    email: ['email', 'email_verified'],
    profile: ['name', 'preferred_username', 'organizations', 'teams', 'team_permissions', 'current_organization', 'currentOrganization']
  },
  findAccount: async (ctx, id) => {
    const findAccountStart = Date.now()
    // Use lean() for read-only query - significantly faster
    const acc = await Account.findOne({ sub: id })
      .populate('organizations.organization', 'name departments')
      .populate('currentOrganization', 'name')
      .lean()
    console.log(`⏱️ [PERF] findAccount query: ${Date.now() - findAccountStart}ms`)
    if (!acc) return undefined
    return {
      accountId: acc.sub,
      claims: async () => {
        // Use cached claims for performance
        return getCachedClaims(acc)
      }
    }
  }
}

const provider = new Provider(ISSUER_URL, config)

// Set provider instance for API authentication middleware
setProviderInstance(provider)

// Set proxy on the Koa app directly for Azure and dev (behind Traefik)
provider.proxy = true
console.log('🔧 Provider proxy set to:', provider.proxy)

// Add event listeners to debug the OIDC flow
provider.on('authorization.accepted', (ctx) => {
  console.log('✅ Authorization accepted:', {
    client_id: ctx.oidc.client?.clientId,
    redirect_uri: ctx.oidc.params?.redirect_uri,
    response_type: ctx.oidc.params?.response_type,
    code_issued: ctx.oidc.authorization?.code ? 'yes' : 'no'
  })
  // Store this for comparison later
  if (ctx.oidc.client?.clientId === 'lms') {
    console.log('📝 LMS Authorization redirect_uri:', ctx.oidc.params?.redirect_uri)
  }
})

provider.on('authorization.error', (ctx, err) => {
  console.error('❌ Authorization error:', err.message)
  console.error('Error details:', err)
})

provider.on('interaction.started', (ctx) => {
  console.log('🔄 Interaction started for:', ctx.oidc.interaction?.uid)
})

provider.on('interaction.ended', (ctx) => {
  console.log('✅ Interaction ended for:', ctx.oidc.interaction?.uid)
})

// Token endpoint events
provider.on('grant.success', async (ctx) => {
  const clientId = ctx.oidc.client?.clientId
  // Account ID can be in session, grant, or entities.Account
  const accountId = ctx.oidc.session?.accountId ||
    ctx.oidc.account?.accountId ||
    ctx.oidc.entities?.Account?.accountId ||
    ctx.oidc.grant?.accountId

  console.log('✅ Grant success:', {
    client_id: clientId,
    grant_type: ctx.oidc.params?.grant_type,
    accountId: accountId,
    sessionAccountId: ctx.oidc.session?.accountId,
    grantAccountId: ctx.oidc.grant?.accountId
  })
})

provider.on('grant.error', (ctx, err) => {
  console.error('❌ Grant error:', {
    client_id: ctx.oidc.client?.clientId,
    grant_type: ctx.oidc.params?.grant_type,
    error: err.error,
    error_description: err.error_description,
    error_detail: err.error_detail,
    message: err.message
  })
  // Log redirect_uri comparison
  console.error('🔍 Token request redirect_uri:', ctx.oidc.params?.redirect_uri)
  console.error('Grant error details:', err)
})

provider.on('grant.revoked', (ctx, grantId) => {
  console.log('🗑️ Grant revoked:', grantId)
})

// Server errors
provider.on('server_error', (ctx, err) => {
  console.error('💥 Server error:', err.message)
  console.error('Server error stack:', err.stack)
})

// Userinfo endpoint
provider.on('userinfo.success', async (ctx) => {
  const clientId = ctx.oidc.client?.clientId
  const account = ctx.oidc.account

  console.log('✅ Userinfo success for:', account?.accountId, 'client:', clientId)
})

const app = express()

// Trust proxy for Azure (required for secure cookies behind load balancer)
app.set('trust proxy', 1)
console.log('🔒 Trust proxy enabled for Azure')

// CRITICAL: Force HTTPS detection for Azure Web Apps
// Azure's proxy sets x-forwarded-proto but oidc-provider needs it to be present
// This middleware ensures HTTPS is detected correctly
if (isProduction) {
  app.use((req, res, next) => {
    // If x-forwarded-proto is not set but we're in production, assume HTTPS
    if (!req.headers['x-forwarded-proto']) {
      req.headers['x-forwarded-proto'] = 'https'
    }
    // Log for debugging
    if (req.path === '/.well-known/openid-configuration') {
      console.log('📋 Discovery request - x-forwarded-proto:', req.headers['x-forwarded-proto'])
    }
    next()
  })
}

// Dynamic CORS configuration based on registered clients
app.use((req, res, next) => {
  const origin = req.headers.origin

  // Collect all allowed origins from all clients
  const allAllowedOrigins = []
  clientsMetadata.forEach((metadata) => {
    allAllowedOrigins.push(...metadata.allowed_origins)
  })

  // Add self-origin
  if (ISSUER_URL) {
    allAllowedOrigins.push(ISSUER_URL)
  }

  // Validate origin against all allowed origins
  if (origin && validateOrigin(origin, allAllowedOrigins)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  }

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200)
  }

  next()
})

app.use(cookieParser())

// IMPORTANT: Skip body parsing for OIDC endpoints to avoid conflicts with oidc-provider
// oidc-provider needs to parse the body itself for token requests
const skipBodyParsingRoutes = ['/token', '/introspect', '/revocation']

// Debug middleware to log token requests (headers only, don't consume body)
app.use((req, res, next) => {
  if (req.path === '/token' && req.method === 'POST') {
    console.log('🔍 TOKEN REQUEST RECEIVED:')
    console.log('  Content-Type:', req.headers['content-type'])
    console.log('  Authorization header:', req.headers['authorization'] ? 'PRESENT (Basic)' : 'MISSING')
    console.log('  Expecting: client_secret_post (credentials in body)')
  }
  next()
})

app.use((req, res, next) => {
  // Skip body parsing for OIDC token-related endpoints
  if (skipBodyParsingRoutes.some(route => req.path.startsWith(route))) {
    return next()
  }
  express.json({ limit: '5mb' })(req, res, next)
})

app.use((req, res, next) => {
  // Skip body parsing for OIDC token-related endpoints
  if (skipBodyParsingRoutes.some(route => req.path.startsWith(route))) {
    return next()
  }
  express.urlencoded({ extended: false, limit: '5mb' })(req, res, next)
})

// Static assets (shared theme, icons)
app.use(express.static(join(__dirname, 'public'), {
  maxAge: isProduction ? '7d' : 0
}))

// Make brand info available to all EJS templates
app.use((req, res, next) => {
  res.locals.brand = getIdpBrand(req)
  next()
})
app.use('/vendor/pdfjs', express.static(join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'build')))

// Session middleware for organization management routes
app.use(session({
  secret: process.env.SESSION_SECRET || process.env.OIDC_COOKIE_SECRET || 'dev-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: isProduction,
    httpOnly: true,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}))

// Set up EJS templating for organization management UI
app.set('view engine', 'ejs')
app.set('views', join(__dirname, 'views'))

// Log all requests for debugging
app.use((req, res, next) => {
  console.log(`📨 ${req.method} ${req.path}`, req.query)
  next()
})

// Interaction routes MUST come BEFORE provider.callback()
app.get('/interaction/:uid', async (req, res) => {
  const interactionStartTime = Date.now()
  try {
    const detailsStart = Date.now()
    const details = await provider.interactionDetails(req, res)
    const { uid, prompt, params, session } = details
    console.log(`⏱️ interactionDetails took ${Date.now() - detailsStart}ms`)

    console.log('🔍 Interaction details:', {
      uid,
      prompt: prompt.name,
      reasons: prompt.reasons,
      hasSession: !!session,
      client: params?.client_id,
      hasHubToken: !!params?.hub_token
    })

    // If it's a consent prompt, auto-grant it
    if (prompt.name === 'consent') {
      console.log('✅ Auto-granting consent for trusted client')
      const result = {
        consent: {
          rejectedScopes: [],
          rejectedClaims: []
        }
      }
      await provider.interactionFinished(req, res, result, { mergeWithLastSubmission: true })
      return
    }

    // CRITICAL: Check for hub SSO token for IdP-initiated SSO
    // This enables seamless login from hub to SmartHR without showing login form
    if (prompt.name === 'login') {
      // First, check for hub_token in the authorization request parameters
      const hubToken = params?.hub_token
      if (hubToken) {
        console.log('🎫 Hub SSO token found, verifying...')
        try {
          const tokenVerifyStart = Date.now()
          const ssoSecret = process.env.OIDC_COOKIE_SECRET || 'dev-cookie-secret'
          const secretKey = new TextEncoder().encode(ssoSecret)
          const { payload: decoded } = await jwtVerify(hubToken, secretKey)
          console.log(`⏱️ JWT verify took ${Date.now() - tokenVerifyStart}ms`)

          // Verify this is a valid hub SSO token
          if (decoded.purpose === 'hub_sso' && decoded.sub && decoded.email) {
            // Find the account by sub or email
            const dbLookupStart = Date.now()
            let account = await Account.findOne({ sub: decoded.sub })
            if (!account) {
              account = await Account.findOne({ email: decoded.email })
            }
            console.log(`⏱️ Account DB lookup took ${Date.now() - dbLookupStart}ms`)

            if (account) {
              console.log('🎯 SSO: Hub token verified for', account.email, '- auto-completing login')
              console.log(`⏱️ Total SSO processing: ${Date.now() - interactionStartTime}ms`)
              const result = {
                login: {
                  accountId: account.sub,
                  remember: true
                }
              }
              await provider.interactionFinished(req, res, result, { mergeWithLastSubmission: false })
              return
            } else {
              console.log('⚠️ Hub token valid but account not found:', decoded.email)
            }
          }
        } catch (tokenErr) {
          console.log('⚠️ Hub token verification failed:', tokenErr.message)
        }
      }

      // Fallback: Check for hub session cookie (same-domain only) - ONLY for IdP-initiated flows
      if (hubToken) {
        const account = await getSessionFromCookies(req)
        if (account) {
          console.log('🎯 SSO: Hub session cookie found for', account.email, '- auto-completing login (IdP-initiated)')
          const result = {
            login: {
              accountId: account.sub,
              remember: true
            }
          }
          await provider.interactionFinished(req, res, result, { mergeWithLastSubmission: false })
          return
        }
      }

      console.log('📝 No SSO token or session - showing login form')
    }

    // Check if user has an active OIDC session (previously logged in)
    let lastLoggedInEmail = null
    if (session && session.accountId) {
      const acc = await Account.findOne({ sub: session.accountId })
      if (acc) {
        lastLoggedInEmail = acc.email
        console.log('👤 Found existing OIDC session for:', lastLoggedInEmail)
      }
    }

    // Get error message if redirected back with error
    const errorMessages = {
      account_not_found: 'Account not found. Please sign up first.',
      invalid_password: 'Invalid password. Please try again.',
      login_failed: 'Login failed. Please try again.',
      session_expired: 'Session expired. Please try again.'
    }
    const errorMsg = req.query.error ? errorMessages[req.query.error] || 'An error occurred' : ''
    const brand = getIdpBrand(req)

    // Return HTML login form
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>${brand.name} - Sign in</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link rel="stylesheet" href="/css/idp-theme.css?v=6">
        <link rel="stylesheet" href="/css/login.css?v=6">
        <script src="/js/theme.js?v=5"></script>
        <style>
          body { visibility: hidden; }
          body.light, body.dark, [data-theme] body { visibility: visible; }
          ${brand.cssVars}
        </style>
      </head>
      <body class="${brand.themeClass}">
        <div class="grid-overlay"></div>

        <!-- Theme Toggle -->
        <button class="theme-toggle-btn" onclick="toggleTheme()" title="Toggle theme" aria-label="Toggle theme">
          <svg class="theme-icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="5"/>
            <line x1="12" y1="1" x2="12" y2="3"/>
            <line x1="12" y1="21" x2="12" y2="23"/>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
            <line x1="1" y1="12" x2="3" y2="12"/>
            <line x1="21" y1="12" x2="23" y2="12"/>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
          </svg>
          <svg class="theme-icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none;">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
          </svg>
        </button>

        <div class="login-split">
          <!-- LEFT: Form Panel -->
          <div class="login-form-panel">
            <a href="/" class="login-back-link">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
              Back to home
            </a>

            <div class="login-form-inner">
              <div class="login-brand">
                <div class="brand-mark">${brand.logoHtml}</div>
                <span class="login-brand-name">${brand.name}</span>
              </div>

              <h1 class="login-heading">Welcome back</h1>
              <p class="login-subheading">Sign in to access your AIIN workspace.</p>

              ${lastLoggedInEmail ? `
              <div id="quickLogin">
                <div class="error" id="errorQuick"></div>
                <div style="background: var(--surface-2, rgba(30,41,59,0.4)); border:1px solid var(--border); padding: 16px; border-radius: 14px; margin-bottom: 14px;">
                  <div style="display: flex; align-items: center; margin-bottom: 12px;">
                    <div style="width: 44px; height: 44px; background: linear-gradient(135deg, #b980ff, #8b5cf6, #4c1d95); border-radius: 12px; display: grid; place-items: center; color: white; font-size: 18px; font-weight: bold; margin-right: 12px;">
                      ${lastLoggedInEmail.charAt(0).toUpperCase()}
                    </div>
                    <div style="flex: 1;">
                      <div style="font-weight: 700; color: var(--text); margin-bottom: 2px; font-size: 14px;">${lastLoggedInEmail}</div>
                      <div style="font-size: 13px; color: var(--muted);">Continue with this account</div>
                    </div>
                    <a href="/interaction/${uid}/logout" class="link" style="font-size: 12px;">Not you?</a>
                  </div>
                  <button type="button" id="continueBtn">
                    Continue as ${lastLoggedInEmail.split('@')[0]}
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                  </button>
                </div>
                <button type="button" id="useDifferentAccount" class="secondary">
                  Use a different account
                </button>
              </div>
              ` : ''}

              <form id="loginForm" style="${lastLoggedInEmail ? 'display: none;' : ''}">
                <div class="error" id="error"></div>

                <div class="form-group">
                  <label for="email">Email address</label>
                  <input type="email" id="email" name="email" placeholder="name@example.com" required ${!lastLoggedInEmail ? 'autofocus' : ''} />
                </div>

                <div class="form-group">
                  <div style="display: flex; justify-content: space-between; align-items: baseline;">
                    <label for="password">Password</label>
                    <a href="/forgot-password" class="link">Forgot password?</a>
                  </div>
                  <input type="password" id="password" name="password" placeholder="••••••••" required />
                </div>

                <div class="muted-row">
                  <label>
                    <input type="checkbox" id="remember" name="remember" />
                    Remember me
                  </label>
                </div>

                <button type="submit" id="submitBtn">
                  <span id="btnText">Sign in</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                </button>

                ${lastLoggedInEmail ? `
                <button type="button" id="backToQuick" class="secondary">
                  Back to quick login
                </button>
                ` : ''}
              </form>

              <div class="divider"><span>or</span></div>

              <div class="signup-link">
                Don't have an account? <a class="link" href="/signup/${uid}">Create free account</a>
              </div>
            </div>
          </div>

          <!-- RIGHT: Marketing Panel -->
          <div class="login-marketing-panel">
            <div class="marketing-inner">
              <div class="marketing-pill">
                <span class="status-dot"></span>
                ${brand.marketing ? brand.marketing.pill : 'Enterprise-ready &bull; SOC 2 Ready'}
              </div>

              <h2 class="marketing-heading">
                ${brand.marketing ? brand.marketing.heading : 'Your Workforce,<br/><span class="highlight">Supercharged.</span>'}
              </h2>

              <p class="marketing-desc">
                ${brand.marketing ? brand.marketing.desc : `${brand.name} gives your organization a unified identity platform that connects HR, learning, and collaboration tools &mdash; reducing friction while improving security.`}
              </p>

              <div class="feature-cards">
                ${(brand.marketing ? brand.marketing.features : [
                  { title: 'Single Sign-On', desc: 'One identity for SmartHR, LMS, Chat, AI Assistant, and all connected apps.', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>', color: 'blue' },
                  { title: 'Instant Access', desc: 'Adaptive MFA and session continuity for seamless, secure access across your tools.', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>', color: 'purple' },
                  { title: 'Enterprise Security', desc: 'SOC 2 ready with end-to-end encryption, SAML/OIDC, and organization-level controls.', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/></svg>', color: 'accent' }
                ]).map(f => `
                <div class="feature-card">
                  <div class="feature-icon feature-icon--${f.color}">
                    ${f.icon}
                  </div>
                  <div>
                    <div class="feature-title">${f.title}</div>
                    <div class="feature-desc">${f.desc}</div>
                  </div>
                </div>
                `).join('')}
              </div>
            </div>
          </div>
        </div>
        
        <script>
          const form = document.getElementById('loginForm');
          const errorDiv = document.getElementById('error');
          const submitBtn = document.getElementById('submitBtn');
          const btnText = document.getElementById('btnText');
          const emailInput = document.getElementById('email');
          const rememberCheckbox = document.querySelector('input[type="checkbox"]');
          const quickLogin = document.getElementById('quickLogin');
          const continueBtn = document.getElementById('continueBtn');
          const useDifferentAccountBtn = document.getElementById('useDifferentAccount');
          const backToQuickBtn = document.getElementById('backToQuick');
          const errorQuick = document.getElementById('errorQuick');
          
          const lastLoggedInEmail = ${JSON.stringify(lastLoggedInEmail || '')};
          const errorMsgSafe = ${JSON.stringify(errorMsg || '')};
          
          if (continueBtn) {
            continueBtn.addEventListener('click', () => {
              continueBtn.disabled = true;
              continueBtn.innerHTML = '<span class="spinner"></span>Signing in...';
              const form = document.createElement('form');
              form.method = 'POST';
              form.action = '/interaction/${uid}/continue';
              document.body.appendChild(form);
              form.submit();
            });
          }
          
          if (useDifferentAccountBtn) {
            useDifferentAccountBtn.addEventListener('click', () => {
              quickLogin.style.display = 'none';
              form.style.display = 'block';
              emailInput.focus();
            });
          }
          
          if (backToQuickBtn) {
            backToQuickBtn.addEventListener('click', () => {
              form.style.display = 'none';
              quickLogin.style.display = 'block';
            });
          }
          
          const rememberedEmail = localStorage.getItem('aiin_remembered_email');
          if (rememberedEmail && !lastLoggedInEmail && emailInput) {
            emailInput.value = rememberedEmail;
            if (rememberCheckbox) rememberCheckbox.checked = true;
          }
          
          const urlParams = new URLSearchParams(window.location.search);
          const errorParam = urlParams.get('error');
          if (errorParam && errorMsgSafe) {
            if (quickLogin && quickLogin.style.display !== 'none' && errorQuick) {
              errorQuick.textContent = errorMsgSafe;
              errorQuick.classList.add('show');
            } else if (errorDiv) {
              errorDiv.textContent = errorMsgSafe;
              errorDiv.classList.add('show');
            }

            const cleanUrl = new URL(window.location.href);
            cleanUrl.searchParams.delete('error');
            window.history.replaceState({}, '', cleanUrl.pathname + cleanUrl.search);
          }
          
          form.addEventListener('submit', (e) => {
            e.preventDefault();
            submitBtn.disabled = true;
            btnText.innerHTML = '<span class="spinner"></span>Signing in...';
            errorDiv.classList.remove('show');
            
            const formData = new FormData(e.target);
            const email = formData.get('email');
            
            if (rememberCheckbox && rememberCheckbox.checked) {
              localStorage.setItem('aiin_remembered_email', email);
            } else {
              localStorage.removeItem('aiin_remembered_email');
            }
            
            const hiddenForm = document.createElement('form');
            hiddenForm.method = 'POST';
            hiddenForm.action = '/interaction/${uid}/login';
            
            const emailField = document.createElement('input');
            emailField.type = 'hidden';
            emailField.name = 'email';
            emailField.value = email;
            hiddenForm.appendChild(emailField);
            
            const passwordInput = document.createElement('input');
            passwordInput.type = 'hidden';
            passwordInput.name = 'password';
            passwordInput.value = formData.get('password');
            hiddenForm.appendChild(passwordInput);
            
            const rememberInput = document.createElement('input');
            rememberInput.type = 'hidden';
            rememberInput.name = 'remember';
            rememberInput.value = rememberCheckbox && rememberCheckbox.checked ? 'true' : 'false';
            hiddenForm.appendChild(rememberInput);
            

            document.body.appendChild(hiddenForm);
            hiddenForm.submit();
          });

          // Theme Toggle Logic
          function toggleTheme() {
            const current = window.ThemeManager?.getTheme() || 'dark';
            const next = current === 'dark' ? 'light' : 'dark';
            window.ThemeManager?.setTheme(next);
            updateThemeIcon(next);
          }

          function updateThemeIcon(theme) {
            const sunIcon = document.querySelector('.theme-icon-sun');
            const moonIcon = document.querySelector('.theme-icon-moon');
            if (theme === 'light') {
              sunIcon.style.display = 'none';
              moonIcon.style.display = 'block';
            } else {
              sunIcon.style.display = 'block';
              moonIcon.style.display = 'none';
            }
          }

          // Initialize theme icon on load
          window.addEventListener('DOMContentLoaded', () => {
            const currentTheme = window.ThemeManager?.getTheme() || 'dark';
            updateThemeIcon(currentTheme);
          });
        </script>
      </body>
      </html>
    `)
  } catch (err) {
    console.error('Interaction error:', err)

    // Handle expired or invalid interaction sessions with the provider-level recovery UI.
    if (err.name === 'SessionNotFound' || err.error === 'invalid_request') {
      const requestId = crypto.randomUUID()
      const page = renderOidcRecoveryPage({
        error: err.error || err.name,
        description: err.error_description || err.message || 'authorization request has expired',
        requestId,
        statusCode: err.statusCode || 400
      })
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('X-SSO-Request-ID', requestId)
      return res.status(page.statusCode).send(page.html)
    }

    const requestId = crypto.randomUUID()
    const page = renderOidcRecoveryPage({
      error: err.error || err.name || 'server_error',
      description: err.error_description || err.message || 'The sign-in request could not be completed.',
      requestId,
      statusCode: 500
    })
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-SSO-Request-ID', requestId)
    return res.status(page.statusCode).send(page.html)
  }
})

// Signup page
app.get('/signup/:uid', async (req, res) => {
  const { uid } = req.params

  // Get error message if redirected back with error
  const errorMessages = {
    account_exists: 'An account with this email already exists. Please sign in instead.',
    signup_failed: 'Signup failed. Please try again.',
    passwords_mismatch: 'Passwords do not match.'
  }
  const errorMsg = req.query.error ? errorMessages[req.query.error] || 'An error occurred' : ''
  const hiddenAttributionInputs = buildHiddenAttributionInputs(req.query)
  const brand = getIdpBrand(req)

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>${brand.name} - Create account</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <link rel="stylesheet" href="/css/idp-theme.css?v=6">
      <link rel="stylesheet" href="/css/login.css?v=6">
      <script src="/js/theme.js?v=5"></script>
      <style>
        body { visibility: hidden; }
        body.light, body.dark, [data-theme] body { visibility: visible; }
        ${brand.cssVars}
      </style>
    </head>
    <body class="${brand.themeClass}">
      <div class="grid-overlay"></div>

      <!-- Theme Toggle -->
      <button class="theme-toggle-btn" onclick="toggleTheme()" title="Toggle theme" aria-label="Toggle theme">
        <svg class="theme-icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="5"/>
          <line x1="12" y1="1" x2="12" y2="3"/>
          <line x1="12" y1="21" x2="12" y2="23"/>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
          <line x1="1" y1="12" x2="3" y2="12"/>
          <line x1="21" y1="12" x2="23" y2="12"/>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
        </svg>
        <svg class="theme-icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none;">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
      </button>

      <div class="login-split">
        <!-- LEFT: Form Panel -->
        <div class="login-form-panel">
          <a href="/interaction/${uid}" class="login-back-link">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            Back to sign in
          </a>

          <div class="login-form-inner">
            <div class="login-brand">
              <div class="brand-mark">${seemplifyMarkSvg}</div>
              <span class="login-brand-name">Seemplify</span>
            </div>

            <h1 class="login-heading">Create your account</h1>
            <p class="login-subheading">One identity for the hub and all connected apps.</p>

            <div class="error" id="error"></div>

            <form id="signupForm" action="/interaction/${uid}/signup" method="POST">
              ${hiddenAttributionInputs}
              <div class="form-group">
                <label for="name">Full name (optional)</label>
                <input type="text" id="name" name="name" placeholder="Jordan Harper" autocomplete="name" />
              </div>

              <div class="form-group">
                <label for="email">Work email</label>
                <input type="email" id="email" name="email" placeholder="you@company.com" required autofocus autocomplete="email" />
              </div>

              <div class="form-group">
                <label for="password">Password</label>
                <input type="password" id="password" name="password" placeholder="Create a strong password" required minlength="8" autocomplete="new-password" />
                <div class="password-strength">
                  <div class="password-strength-bar" id="strengthBar"></div>
                </div>
                <div class="password-hint" id="strengthText">Use 8+ characters with letters, numbers, and symbols.</div>
              </div>

              <div class="form-group">
                <label for="confirmPassword">Confirm password</label>
                <input type="password" id="confirmPassword" name="confirmPassword" placeholder="Re-enter your password" required autocomplete="new-password" />
              </div>

              <button type="submit" id="submitBtn">
                <span id="btnText">Create account</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
              </button>
            </form>

            <div class="divider"><span>or</span></div>

            <div class="signup-link">
              Already have an account? <a class="link" href="/interaction/${uid}">Sign in</a>
            </div>
          </div>
        </div>

        <!-- RIGHT: Marketing Panel -->
        <div class="login-marketing-panel">
          <div class="marketing-inner">
            <div class="marketing-pill">
              <span class="status-dot"></span>
              ${brand.marketing ? brand.marketing.pill : 'Enterprise-ready &bull; SOC 2 Ready'}
            </div>

            <h2 class="marketing-heading">
              ${brand.marketing ? brand.marketing.heading : 'Start in minutes,<br/><span class="highlight">scale for years.</span>'}
            </h2>

            <p class="marketing-desc">
              ${brand.marketing ? brand.marketing.desc : 'Create your identity once. Launch SmartHR, LMS, Chat, and more via single sign-on with org-level controls.'}
            </p>

            <div class="feature-cards">
              ${(brand.marketing ? brand.marketing.features : [
                { title: 'SSO-Ready', desc: 'One account for the hub and all connected apps.', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>', color: 'blue' },
                { title: 'Fast Onboarding', desc: 'Create teams, invite members, and control access from one place.', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>', color: 'purple' },
                { title: 'Secure by Design', desc: 'Email verification + modern session handling across apps.', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/></svg>', color: 'accent' }
              ]).map(f => `
              <div class="feature-card">
                <div class="feature-icon feature-icon--${f.color}">
                  ${f.icon}
                </div>
                <div>
                  <div class="feature-title">${f.title}</div>
                  <div class="feature-desc">${f.desc}</div>
                </div>
              </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>

      <script>
        const form = document.getElementById('signupForm');
        const errorDiv = document.getElementById('error');
        const submitBtn = document.getElementById('submitBtn');
        const btnText = document.getElementById('btnText');
        const passwordInput = document.getElementById('password');
        const confirmPasswordInput = document.getElementById('confirmPassword');
        const strengthBar = document.getElementById('strengthBar');
        const strengthText = document.getElementById('strengthText');

        const errorMsgSafe = ${JSON.stringify(errorMsg || '')};
        if (errorMsgSafe && errorDiv) {
          errorDiv.textContent = errorMsgSafe;
          errorDiv.classList.add('show');

          const cleanUrl = new URL(window.location.href);
          cleanUrl.searchParams.delete('error');
          window.history.replaceState({}, '', cleanUrl.pathname + cleanUrl.search);
        }

        passwordInput.addEventListener('input', () => {
          const password = passwordInput.value;
          let strength = 0;

          if (password.length >= 8) strength++;
          if (password.length >= 12) strength++;
          if (/[a-z]/.test(password) && /[A-Z]/.test(password)) strength++;
          if (/[0-9]/.test(password)) strength++;
          if (/[^a-zA-Z0-9]/.test(password)) strength++;

          strengthBar.className = 'password-strength-bar';
          if (strength <= 2) {
            strengthText.textContent = 'Weak password';
          } else if (strength <= 3) {
            strengthBar.classList.add('strength-medium');
            strengthText.textContent = 'Medium strength';
          } else {
            strengthBar.classList.add('strength-strong');
            strengthText.textContent = 'Strong password!';
          }
        });

        form.addEventListener('submit', (e) => {
          if (passwordInput.value !== confirmPasswordInput.value) {
            e.preventDefault();
            errorDiv.textContent = 'Passwords do not match';
            errorDiv.classList.add('show');
            return;
          }
          submitBtn.disabled = true;
          btnText.innerHTML = '<span class="spinner"></span>Creating account...';
        });

        function toggleTheme() {
          const current = window.ThemeManager?.getTheme() || 'dark';
          const next = current === 'dark' ? 'light' : 'dark';
          window.ThemeManager?.setTheme(next);
          updateThemeIcon(next);
        }

        function updateThemeIcon(theme) {
          const sunIcon = document.querySelector('.theme-icon-sun');
          const moonIcon = document.querySelector('.theme-icon-moon');
          if (theme === 'light') {
            sunIcon.style.display = 'none';
            moonIcon.style.display = 'block';
          } else {
            sunIcon.style.display = 'block';
            moonIcon.style.display = 'none';
          }
        }

        window.addEventListener('DOMContentLoaded', () => {
          const currentTheme = window.ThemeManager?.getTheme() || 'dark';
          updateThemeIcon(currentTheme);
        });
      </script>
    </body>
    </html>
  `)
})

app.post('/interaction/:uid/continue', async (req, res) => {
  try {
    const details = await provider.interactionDetails(req, res)
    const { session } = details

    if (!session || !session.accountId) {
      console.log('❌ No session found for continue')
      return res.redirect(`/interaction/${req.params.uid}?error=session_expired`)
    }

    console.log('✅ Continuing with existing session:', session.accountId)

    const result = {
      login: {
        accountId: session.accountId
      }
    }

    await provider.interactionFinished(req, res, result, { mergeWithLastSubmission: false })
    console.log('✅ Interaction finished with existing session')
  } catch (err) {
    console.error('💥 Continue error:', err)
    if (!res.headersSent) {
      res.redirect(`/interaction/${req.params.uid}?error=login_failed`)
    }
  }
})

app.post('/interaction/:uid/login', async (req, res) => {
  try {
    console.log('🔐 Login attempt for:', req.body.email)
    const { email, password, remember } = req.body
    const acc = await Account.findOne({ email })

    if (!acc) {
      console.log('❌ Account not found:', email)
      // Redirect back to login with error
      return res.redirect(`/interaction/${req.params.uid}?error=account_not_found`)
    }

    const ok = await bcrypt.compare(password, acc.passwordHash)
    if (!ok) {
      console.log('❌ Invalid password for:', email)
      // Redirect back to login with error
      return res.redirect(`/interaction/${req.params.uid}?error=invalid_password`)
    }

    console.log('✅ Login successful for:', email)
    console.log('📍 Remember me:', remember === 'true' ? 'Yes' : 'No')
    console.log('📍 Finishing interaction for UID:', req.params.uid)
    console.log('📍 Account sub:', acc.sub)

    const result = {
      login: {
        accountId: acc.sub,
        remember: remember === 'true' // Pass remember flag to extend session
      }
    }

    // This should redirect to continue the OAuth flow
    await provider.interactionFinished(req, res, result, { mergeWithLastSubmission: false })

    console.log('✅ Interaction finished - if you see this, redirect happened')
  } catch (err) {
    console.error('💥 Login error:', err)
    console.error('💥 Error stack:', err.stack)
    if (!res.headersSent) {
      // Redirect back with error instead of JSON
      res.redirect(`/interaction/${req.params.uid}?error=login_failed`)
    }
  }
})

app.post('/interaction/:uid/signup', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase()
    const password = String(req.body?.password || '')
    const confirmPassword = String(req.body?.confirmPassword || '')
    const name = String(req.body?.name || '').trim()
    const attributionQuery = collectSignupAttribution(req.body)

    console.log('📝 Signup attempt for:', email)

    if (password !== confirmPassword) {
      return res.redirect(buildPathWithQuery(`/signup/${req.params.uid}`, attributionQuery, {
        error: 'passwords_mismatch'
      }))
    }

    // Check if user already exists
    const existing = await Account.findOne({ email })
    if (existing) {
      console.log('❌ Account already exists:', email)
      return res.redirect(buildPathWithQuery(`/signup/${req.params.uid}`, attributionQuery, {
        error: 'account_exists'
      }))
    }

    const attributionState = await buildSignupAttributionState(req, email)

    // Create new account (NOT verified yet)
    const sub = new mongoose.Types.ObjectId().toString()
    const passwordHash = await bcrypt.hash(password, 10)

    const acc = await Account.create({
      sub,
      email,
      passwordHash,
      emailVerified: false, // Requires OTP verification
      profile: {
        name: name || email.split('@')[0],
        preferred_username: email.split('@')[0]
      },
      security: {},
      acquisition: {
        firstTouch: attributionState.firstTouch,
        lastTouch: attributionState.lastTouch,
        conversionSource: attributionState.resolved.verifiedToken ? 'campaign' : 'website',
        visitorId: attributionState.resolved.visitorId,
        attributionSnapshot: {
          signupTouch: attributionState.signupTouch
        }
      }
    })

    console.log(`✅ New account created (unverified): ${email}`)

    const signupTrackingResults = await Promise.allSettled([
      MarketingVisit.create({
        visitorId: attributionState.resolved.visitorId,
        sessionId: attributionState.resolved.sessionId,
        eventType: 'signup_complete',
        sourceApp: 'identityprovider',
        pageUrl: String(req.body?.landingPage || ''),
        path: req.originalUrl,
        referrer: String(req.body?.referrer || req.headers.referer || ''),
        ipAddress: req.ip || req.connection?.remoteAddress || '',
        userAgent: String(req.headers['user-agent'] || ''),
        utm: attributionState.resolved.utm,
        attribution: attributionState.signupTouch,
        account: acc._id,
        metadata: {
          route: 'interaction_signup'
        },
        occurredAt: attributionState.signupTouch.occurredAt
      }),
      registerCampaignConversion({
        conversionType: 'signup',
        campaignId: attributionState.resolved.verifiedToken?.campaignId || attributionState.lastTouch?.campaignId || null,
        recipientId: attributionState.resolved.verifiedToken?.recipientId || attributionState.lastTouch?.recipientId || null,
        email,
        visitorId: attributionState.resolved.visitorId,
        occurredAt: attributionState.signupTouch.occurredAt,
        accountId: acc._id
      })
    ])
    signupTrackingResults.forEach((result) => {
      if (result.status === 'rejected') {
        console.error('Interaction signup tracking error:', result.reason)
      }
    })

    // Generate and send verification OTP
    const otp = otpService.generateOTP()
    otpService.storeOTP(acc.sub, otp, 'email_verification')

    // Update last OTP sent time
    acc.security.lastOtpSent = new Date()
    await acc.save()

    // Send verification email
    try {
      await emailService.sendEmailVerificationOTP(email, otp, name || email.split('@')[0])
      console.log('✉️ Verification OTP sent to:', email)
    } catch (emailError) {
      console.error('❌ Failed to send verification email:', emailError.message)
      // Continue anyway - user can resend
    }

    // Redirect to verification page instead of logging in
    res.redirect(`/verify-email/${acc.sub}?email=${encodeURIComponent(email)}`)

  } catch (err) {
    console.error('💥 Signup error:', err)
    console.error('💥 Error stack:', err.stack)
    if (!res.headersSent) {
      res.redirect(buildPathWithQuery(`/signup/${req.params.uid}`, req.body, {
        error: 'signup_failed'
      }))
    }
  }
})

// ============================================
// EMAIL VERIFICATION ROUTES
// ============================================

// Email verification page
app.get('/verify-email/:accountId', async (req, res) => {
  const { accountId } = req.params
  const email = req.query.email || ''
  const error = req.query.error

  const errorMessages = {
    invalid_code: 'Invalid verification code. Please try again.',
    expired_code: 'Verification code has expired. Please request a new one.',
    too_many_attempts: 'Too many invalid attempts. Please request a new code.',
    account_locked: 'Account is temporarily locked. Please try again later.',
    already_verified: 'This account is already verified!'
  }
  const errorMsg = error ? errorMessages[error] || 'An error occurred' : ''

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Verify Email - Seemplify Identity</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <link rel="stylesheet" href="/css/idp-theme.css?v=6">
      <script src="/js/theme.js?v=5"></script>
      <style>
        body {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }
        .container {
          background: var(--panel);
          backdrop-filter: blur(16px);
          padding: 48px;
          border-radius: 24px;
          border: 1px solid var(--border);
          box-shadow: var(--card-shadow);
          width: 100%;
          max-width: 480px;
        }
        .logo { text-align: center; margin-bottom: 32px; }
        .logo-icon { font-size: 64px; margin-bottom: 16px; }
        h1 { font-size: 28px; color: var(--text); margin-bottom: 8px; font-family: "Space Grotesk", system-ui, sans-serif; }
        p { color: var(--muted); font-size: 16px; line-height: 1.5; margin-bottom: 24px; }
        p strong { color: var(--text); }
        .form-group { margin-bottom: 24px; }
        label { display: block; color: var(--text-secondary); font-weight: 500; margin-bottom: 8px; }
        input {
          width: 100%;
          padding: 14px;
          border: 2px solid var(--border);
          border-radius: 12px;
          background: var(--input-bg);
          color: var(--text);
          font-size: 16px;
          transition: all 0.2s;
          text-align: center;
          letter-spacing: 8px;
          font-weight: bold;
          font-size: 24px;
        }
        input:focus {
          outline: none;
          border-color: var(--brand);
          box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.1);
        }
        button {
          width: 100%;
          padding: 14px;
          background: #18181b;
          color: #ffffff;
          border: none;
          border-radius: 999px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          box-shadow: 0 0 30px rgba(15, 23, 42, 0.2);
        }
        button:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 0 40px rgba(15, 23, 42, 0.35); }
        button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none;
        }
        .error {
          background: var(--badge-error-bg);
          border: 2px solid var(--badge-error-text);
          color: var(--badge-error-text);
          padding: 12px;
          border-radius: 12px;
          margin-bottom: 16px;
          font-size: 14px;
        }
        .success {
          background: var(--badge-success-bg);
          border: 2px solid var(--badge-success-text);
          color: var(--badge-success-text);
          padding: 12px;
          border-radius: 12px;
          margin-bottom: 16px;
          font-size: 14px;
          display: none;
        }
        .success.show { display: block; }
        .resend-link {
          text-align: center;
          margin-top: 16px;
          font-size: 14px;
          color: var(--muted);
        }
        .resend-link a {
          color: var(--brand);
          text-decoration: none;
          font-weight: 500;
        }
        .resend-link a:hover { text-decoration: underline; }
        .spinner {
          display: inline-block;
          width: 16px;
          height: 16px;
          border: 2px solid rgba(255,255,255,0.3);
          border-radius: 50%;
          border-top-color: white;
          animation: spin 0.6s linear infinite;
          margin-right: 8px;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="logo">
          <div class="logo-icon">✉️</div>
          <h1>Verify Your Email</h1>
          <p>We sent a 6-digit code to<br><strong>${email}</strong></p>
        </div>

        ${errorMsg ? `<div class="error">${errorMsg}</div>` : ''}
        <div class="success" id="success"></div>

        <form id="verifyForm">
          <div class="form-group">
            <label for="code">Enter Verification Code</label>
            <input 
              type="text" 
              id="code" 
              name="code" 
              maxlength="6" 
              pattern="[0-9]{6}" 
              placeholder="000000" 
              required 
              autofocus 
              autocomplete="one-time-code"
            />
          </div>

          <button type="submit" id="submitBtn">
            <span id="btnText">Verify Email</span>
          </button>
        </form>

        <div class="resend-link">
          Didn't receive the code? <a href="#" id="resendLink">Resend code</a>
        </div>
      </div>

      <script>
        const form = document.getElementById('verifyForm');
        const codeInput = document.getElementById('code');
        const successDiv = document.getElementById('success');
        const submitBtn = document.getElementById('submitBtn');
        const btnText = document.getElementById('btnText');
        const resendLink = document.getElementById('resendLink');

        // Auto-submit when 6 digits entered
        codeInput.addEventListener('input', (e) => {
          e.target.value = e.target.value.replace(/[^0-9]/g, '');
          if (e.target.value.length === 6) {
            form.requestSubmit();
          }
        });

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          
          submitBtn.disabled = true;
          btnText.innerHTML = '<span class="spinner"></span>Verifying...';
          successDiv.classList.remove('show');

          const formData = new FormData(e.target);
          
          try {
            const response = await fetch('/verify-email', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                accountId: '${accountId}',
                code: formData.get('code')
              })
            });

            const result = await response.json();

            if (!response.ok) {
              throw new Error(result.error || 'Verification failed');
            }

            // Success - show message and redirect
            successDiv.textContent = 'Email verified successfully! Redirecting to login...';
            successDiv.classList.add('show');
            
            setTimeout(() => {
              window.location.href = '${ISSUER_URL}';
            }, 2000);
            
          } catch (error) {
            alert(error.message);
            submitBtn.disabled = false;
            btnText.textContent = 'Verify Email';
            codeInput.value = '';
            codeInput.focus();
          }
        });

        resendLink.addEventListener('click', async (e) => {
          e.preventDefault();
          
          resendLink.textContent = 'Sending...';
          
          try {
            const response = await fetch('/resend-verification', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ accountId: '${accountId}' })
            });

            const result = await response.json();
            
            if (!response.ok) {
              alert(result.error || 'Failed to resend code');
            } else {
              successDiv.textContent = result.message || 'Verification code sent! Please check your email.';
              successDiv.classList.add('show');
              setTimeout(() => successDiv.classList.remove('show'), 5000);
            }
            
          } catch (error) {
            alert('Failed to resend code. Please try again.');
          } finally {
            resendLink.textContent = 'Resend code';
          }
        });
      </script>
    </body>
    </html>
  `)
})

// Verify email POST endpoint
app.post('/verify-email', async (req, res) => {
  try {
    const { accountId, code } = req.body

    if (!accountId || !code) {
      return res.status(400).json({ error: 'Account ID and code are required' })
    }

    // Find account
    const account = await Account.findOne({ sub: accountId })
    if (!account) {
      return res.status(404).json({ error: 'Account not found' })
    }

    // Check if already verified
    if (account.emailVerified) {
      return res.json({ message: 'Email already verified' })
    }

    // Verify OTP
    const result = otpService.verifyOTP(accountId, code, 'email_verification')

    if (!result.valid) {
      await otpService.updateOTPAttempts(account, true)
      return res.status(400).json({
        error: result.reason,
        remainingAttempts: result.remainingAttempts
      })
    }

    // Mark as verified
    account.emailVerified = true
    await otpService.updateOTPAttempts(account, false)
    await account.save()

    console.log('✅ Email verified for:', account.email)

    res.json({ message: 'Email verified successfully' })
  } catch (error) {
    console.error('Email verification error:', error)
    res.status(500).json({ error: 'Verification failed' })
  }
})

// Resend verification code
app.post('/resend-verification', async (req, res) => {
  try {
    const { accountId } = req.body

    if (!accountId) {
      return res.status(400).json({ error: 'Account ID is required' })
    }

    const account = await Account.findOne({ sub: accountId })
    if (!account) {
      return res.status(404).json({ error: 'Account not found' })
    }

    if (account.emailVerified) {
      return res.status(400).json({ error: 'Email already verified' })
    }

    // Check rate limiting
    const canSend = otpService.canSendOTP(account)
    if (!canSend.allowed) {
      return res.status(429).json({ error: canSend.reason })
    }

    // Generate new OTP
    const otp = otpService.generateOTP()
    otpService.storeOTP(account.sub, otp, 'email_verification')

    // Update last sent time
    account.security = account.security || {}
    account.security.lastOtpSent = new Date()
    await account.save()

    // Send email
    await emailService.sendEmailVerificationOTP(account.email, otp, account.profile?.name)

    console.log('✉️ Verification code resent to:', account.email)

    res.json({ message: 'Verification code sent! Please check your email.' })
  } catch (error) {
    console.error('Resend verification error:', error)
    res.status(500).json({ error: 'Failed to resend code' })
  }
})

app.get('/interaction/:uid/logout', async (req, res) => {
  try {
    // Clear the session
    const details = await provider.interactionDetails(req, res)
    if (details.session) {
      await details.session.destroy()
      console.log('🚪 Session cleared for account switch')
    }
    // Redirect back to login page (which will now show full form)
    res.redirect(`/interaction/${req.params.uid}`)
  } catch (err) {
    console.error('Logout error:', err)
    res.redirect(`/interaction/${req.params.uid}`)
  }
})

app.post('/interaction/:uid/abort', async (req, res) => {
  try {
    const result = { error: 'access_denied', error_description: 'User aborted login' }
    await provider.interactionFinished(req, res, result, { mergeWithLastSubmission: false })
  } catch (err) {
    console.error('Abort error:', err)
    res.status(500).json({ error: 'Abort failed' })
  }
})

// Forgot password page (GET - show email form)
app.get('/forgot-password', async (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Forgot Password - Seemplify</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <link rel="stylesheet" href="/css/idp-theme.css?v=6">
      <script src="/js/theme.js?v=5"></script>
      <style>
        body { 
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }
        .container { 
          background: var(--panel);
          backdrop-filter: blur(16px);
          padding: 48px;
          border-radius: 24px;
          border: 1px solid var(--border);
          box-shadow: var(--card-shadow);
          max-width: 440px;
          width: 100%;
          animation: slideIn 0.3s ease-out;
        }
        @keyframes slideIn {
          from { opacity: 0; transform: translateY(-20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .logo {
          text-align: center;
          margin-bottom: 32px;
        }
        .logo-icon {
          width: 60px;
          height: 60px;
          background: linear-gradient(135deg, #b980ff, #8b5cf6, #4c1d95);
          border-radius: 14px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 32px;
          margin-bottom: 16px;
        }
        h1 { 
          font-size: 28px;
          color: var(--text);
          margin-bottom: 8px;
          font-weight: 700;
          text-align: center;
          font-family: "Space Grotesk", system-ui, sans-serif;
        }
        p { 
          color: var(--muted);
          margin-bottom: 32px;
          font-size: 15px;
          text-align: center;
          line-height: 1.5;
        }
        .form-group {
          margin-bottom: 20px;
        }
        label {
          display: block;
          margin-bottom: 8px;
          font-size: 14px;
          font-weight: 500;
          color: var(--text-secondary);
        }
        input[type="email"] { 
          width: 100%;
          padding: 14px 16px;
          border: 2px solid var(--border);
          border-radius: 12px;
          background: var(--input-bg);
          color: var(--text);
          font-size: 15px;
          transition: all 0.2s;
        }
        input[type="email"]:focus { 
          outline: none;
          border-color: var(--brand);
          box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.1);
        }
        button { 
          width: 100%;
          padding: 14px;
          background: #18181b;
          color: #ffffff;
          border: none;
          border-radius: 999px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          margin-top: 8px;
          box-shadow: 0 0 30px rgba(15, 23, 42, 0.2);
        }
        button:hover { 
          transform: translateY(-2px);
          box-shadow: 0 0 40px rgba(15, 23, 42, 0.35);
        }
        button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none;
        }
        .success { 
          background: var(--badge-success-bg);
          color: var(--badge-success-text);
          padding: 12px;
          border-radius: 12px;
          font-size: 14px;
          margin-bottom: 16px;
          border: 2px solid var(--badge-success-text);
          display: none;
        }
        .success.show {
          display: block;
        }
        .back-link {
          text-align: center;
          margin-top: 24px;
        }
        .back-link a {
          color: var(--brand);
          text-decoration: none;
          font-size: 14px;
          font-weight: 600;
        }
        .back-link a:hover {
          text-decoration: underline;
        }
        .spinner {
          border: 2px solid rgba(255,255,255,0.3);
          border-top: 2px solid white;
          border-radius: 50%;
          width: 16px;
          height: 16px;
          animation: spin 0.6s linear infinite;
          display: inline-block;
          margin-right: 8px;
          vertical-align: middle;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="logo">
          <div class="logo-icon">🔒</div>
          <h1>Forgot Password?</h1>
          <p>Enter your email address and we'll send you a link to reset your password.</p>
        </div>
        
        <form id="forgotForm">
          <div class="success" id="success"></div>
          
          <div class="form-group">
            <label for="email">Email Address</label>
            <input type="email" id="email" name="email" placeholder="you@example.com" required autofocus />
          </div>
          
          <button type="submit" id="submitBtn">
            <span id="btnText">Send Reset Link</span>
          </button>
        </form>
        
        <div class="back-link">
          <a href="${ISSUER_URL}">← Back to login</a>
        </div>
      </div>
      
      <script>
        const form = document.getElementById('forgotForm');
        const successDiv = document.getElementById('success');
        const submitBtn = document.getElementById('submitBtn');
        const btnText = document.getElementById('btnText');
        
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          
          // Show loading state
          submitBtn.disabled = true;
          btnText.innerHTML = '<span class="spinner"></span>Sending...';
          successDiv.classList.remove('show');
          
          const formData = new FormData(e.target);
          
          try {
            const response = await fetch('/forgot-password', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: formData.get('email') })
            });
            
            const result = await response.json();
            
            // Always show success message (security: don't reveal if email exists)
            successDiv.textContent = result.message || 'If an account exists, a password reset email has been sent.';
            successDiv.classList.add('show');
            
            // Reset form
            form.reset();
            submitBtn.disabled = false;
            btnText.textContent = 'Send Reset Link';
          } catch (error) {
            successDiv.textContent = 'Email sent! Please check your inbox.';
            successDiv.classList.add('show');
            submitBtn.disabled = false;
            btnText.textContent = 'Send Reset Link';
          }
        });
      </script>
    </body>
    </html>
  `)
})

// Forgot password request
app.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body

    if (!email) {
      return res.status(400).json({ error: 'Email is required' })
    }

    const account = await Account.findOne({ email })

    // Don't reveal if account exists or not (security)
    if (!account) {
      console.log('Password reset requested for non-existent account:', email)
      return res.json({ message: 'If an account with that email exists, a password reset link has been sent.' })
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex')

    // Save token and expiration (1 hour)
    account.resetPasswordToken = resetToken
    account.resetPasswordExpires = new Date(Date.now() + 3600000) // 1 hour
    await account.save()

    console.log('✉️ Sending password reset email to:', email)

    // Send reset email
    try {
      await emailService.sendPasswordResetEmail(email, resetToken)
      console.log('✅ Password reset email sent to:', email)
    } catch (emailError) {
      console.error('❌ Failed to send reset email:', emailError)
      // Don't reveal email sending failure to user
    }

    res.json({ message: 'If an account with that email exists, a password reset link has been sent.' })
  } catch (err) {
    console.error('Forgot password error:', err)
    res.status(500).json({ error: 'An error occurred. Please try again.' })
  }
})

// Reset password handler (POST - process reset)
app.post('/reset-password/:token', async (req, res) => {
  try {
    const { token } = req.params
    const { password } = req.body

    if (!password) {
      return res.status(400).json({ error: 'Password is required' })
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' })
    }

    // Find account with valid token
    const account = await Account.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    })

    if (!account) {
      console.log('❌ Invalid or expired reset token:', token)
      return res.status(400).json({ error: 'Password reset link is invalid or has expired' })
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(password, 10)

    // Update account
    account.passwordHash = passwordHash
    account.resetPasswordToken = undefined
    account.resetPasswordExpires = undefined
    account.lastPasswordChange = new Date()
    await account.save()

    console.log('✅ Password reset successful for:', account.email)

    res.json({ message: 'Password has been reset successfully' })
  } catch (err) {
    console.error('Reset password error:', err)
    res.status(500).json({ error: 'Failed to reset password. Please try again.' })
  }
})

// Reset password success page
app.get('/reset-password/:token/success', async (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Password Reset Successful - Seemplify</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: #18181b;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }
        .container { 
          background: white;
          padding: 48px;
          border-radius: 16px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.15);
          max-width: 440px;
          width: 100%;
          text-align: center;
          animation: slideIn 0.3s ease-out;
        }
        @keyframes slideIn {
          from { opacity: 0; transform: translateY(-20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .icon { font-size: 64px; margin-bottom: 24px; }
        h1 { font-size: 24px; color: #1a1a1a; margin-bottom: 16px; font-weight: 700; }
        p { color: #666; margin-bottom: 32px; line-height: 1.6; }
        button { 
          padding: 14px 32px;
          background: #18181b;
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          text-decoration: none;
          display: inline-block;
        }
        button:hover { 
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(15, 23, 42, 0.35);
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="icon">✅</div>
        <h1>Password Reset Successful!</h1>
        <p>Your password has been changed successfully. You can now sign in with your new password.</p>
        <a href="${ISSUER_URL}" style="padding: 14px 32px; background: #18181b; color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; text-decoration: none; display: inline-block;">
          Go to Login
        </a>
      </div>
    </body>
    </html>
  `)
})

// Reset password page (GET - show form)
app.get('/reset-password/:token', async (req, res) => {
  const { token } = req.params
  const error = req.query.error

  const errorMessages = {
    invalid_token: 'This password reset link is invalid or has expired. Please request a new one.',
    passwords_mismatch: 'Passwords do not match. Please try again.',
    weak_password: 'Password must be at least 8 characters long.',
    reset_failed: 'Failed to reset password. Please try again.'
  }
  const errorMsg = error ? errorMessages[error] || 'An error occurred' : ''

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Reset Password - Seemplify</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: #18181b;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }
        .container { 
          background: white;
          padding: 48px;
          border-radius: 16px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.15);
          max-width: 440px;
          width: 100%;
          animation: slideIn 0.3s ease-out;
        }
        @keyframes slideIn {
          from { opacity: 0; transform: translateY(-20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .logo {
          text-align: center;
          margin-bottom: 32px;
        }
        .logo-icon {
          width: 60px;
          height: 60px;
          background: #18181b;
          border-radius: 12px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 32px;
          margin-bottom: 16px;
        }
        h1 { 
          font-size: 28px;
          color: #1a1a1a;
          margin-bottom: 8px;
          font-weight: 700;
          text-align: center;
        }
        p { 
          color: #666;
          margin-bottom: 32px;
          font-size: 15px;
          text-align: center;
        }
        .form-group {
          margin-bottom: 20px;
        }
        label {
          display: block;
          margin-bottom: 8px;
          font-size: 14px;
          font-weight: 500;
          color: #333;
        }
        input[type="password"] { 
          width: 100%;
          padding: 14px 16px;
          border: 2px solid #e0e0e0;
          border-radius: 8px;
          font-size: 15px;
          transition: all 0.2s;
        }
        input[type="password"]:focus { 
          outline: none;
          border-color: var(--brand, #6366f1);
          box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
        }
        button { 
          width: 100%;
          padding: 14px;
          background: #18181b;
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          margin-top: 8px;
        }
        button:hover { 
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(15, 23, 42, 0.35);
        }
        button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none;
        }
        .error { 
          background: #fee;
          color: #c33;
          padding: 12px;
          border-radius: 8px;
          font-size: 14px;
          margin-bottom: 16px;
          border: 1px solid #fcc;
          display: none;
        }
        .error.show {
          display: block;
        }
        .password-strength {
          height: 4px;
          background: #e0e0e0;
          border-radius: 2px;
          margin-top: 8px;
          overflow: hidden;
        }
        .password-strength-bar {
          height: 100%;
          width: 0%;
          transition: all 0.3s;
          border-radius: 2px;
        }
        .strength-weak { width: 33%; background: #f44336; }
        .strength-medium { width: 66%; background: #ff9800; }
        .strength-strong { width: 100%; background: #4caf50; }
        .password-hint {
          font-size: 12px;
          color: #999;
          margin-top: 6px;
        }
        .back-link {
          text-align: center;
          margin-top: 24px;
        }
        .back-link a {
          color: var(--brand, #6366f1);
          text-decoration: none;
          font-size: 14px;
          font-weight: 600;
        }
        .back-link a:hover {
          text-decoration: underline;
        }
        .spinner {
          border: 2px solid rgba(255,255,255,0.3);
          border-top: 2px solid white;
          border-radius: 50%;
          width: 16px;
          height: 16px;
          animation: spin 0.6s linear infinite;
          display: inline-block;
          margin-right: 8px;
          vertical-align: middle;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="logo">
          <div class="logo-icon">🔑</div>
          <h1>Reset Your Password</h1>
          <p>Enter your new password below</p>
        </div>
        
        <form id="resetForm">
          <div class="error" id="error"></div>
          
          <div class="form-group">
            <label for="password">New Password</label>
            <input type="password" id="password" name="password" placeholder="Enter new password" required minlength="8" autofocus />
            <div class="password-strength">
              <div class="password-strength-bar" id="strengthBar"></div>
            </div>
            <div class="password-hint" id="strengthText">Use 8+ characters with letters and numbers</div>
          </div>
          
          <div class="form-group">
            <label for="confirmPassword">Confirm New Password</label>
            <input type="password" id="confirmPassword" name="confirmPassword" placeholder="Confirm new password" required />
          </div>
          
          <button type="submit" id="submitBtn">
            <span id="btnText">Reset Password</span>
          </button>
        </form>
        
        <div class="back-link">
          <a href="${ISSUER_URL}">← Back to login</a>
        </div>
      </div>
      
      <script>
        const form = document.getElementById('resetForm');
        const errorDiv = document.getElementById('error');
        const submitBtn = document.getElementById('submitBtn');
        const btnText = document.getElementById('btnText');
        const passwordInput = document.getElementById('password');
        const confirmPasswordInput = document.getElementById('confirmPassword');
        const strengthBar = document.getElementById('strengthBar');
        const strengthText = document.getElementById('strengthText');
        
        // Show error if present
        const urlParams = new URLSearchParams(window.location.search);
        const errorParam = urlParams.get('error');
        if (errorParam) {
          errorDiv.textContent = '${errorMsg}';
          errorDiv.classList.add('show');
        }
        
        // Password strength checker
        passwordInput.addEventListener('input', () => {
          const password = passwordInput.value;
          let strength = 0;
          
          if (password.length >= 8) strength++;
          if (password.length >= 12) strength++;
          if (/[a-z]/.test(password) && /[A-Z]/.test(password)) strength++;
          if (/[0-9]/.test(password)) strength++;
          if (/[^a-zA-Z0-9]/.test(password)) strength++;
          
          strengthBar.className = 'password-strength-bar';
          if (strength <= 2) {
            strengthBar.classList.add('strength-weak');
            strengthText.textContent = 'Weak password';
            strengthText.style.color = '#f44336';
          } else if (strength <= 3) {
            strengthBar.classList.add('strength-medium');
            strengthText.textContent = 'Medium strength';
            strengthText.style.color = '#ff9800';
          } else {
            strengthBar.classList.add('strength-strong');
            strengthText.textContent = 'Strong password!';
            strengthText.style.color = '#4caf50';
          }
        });
        
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          
          // Validate passwords match
          if (passwordInput.value !== confirmPasswordInput.value) {
            errorDiv.textContent = 'Passwords do not match';
            errorDiv.classList.add('show');
            return;
          }
          
          // Validate minimum length
          if (passwordInput.value.length < 8) {
            errorDiv.textContent = 'Password must be at least 8 characters long';
            errorDiv.classList.add('show');
            return;
          }
          
          // Show loading state
          submitBtn.disabled = true;
          btnText.innerHTML = '<span class="spinner"></span>Resetting password...';
          errorDiv.classList.remove('show');
          
          const formData = new FormData(e.target);
          
          // Submit via POST
          const response = await fetch('/reset-password/${token}', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: formData.get('password') })
          });
          
          const result = await response.json();
          
          if (!response.ok) {
            errorDiv.textContent = result.error || 'Failed to reset password';
            errorDiv.classList.add('show');
            submitBtn.disabled = false;
            btnText.textContent = 'Reset Password';
            return;
          }
          
          // Success - redirect to success page
          window.location.href = '/reset-password/${token}/success';
        });
      </script>
    </body>
    </html>
  `)
})

// ============================================
// OTP-BASED PASSWORD RESET (Alternative)
// ============================================

// Request password reset OTP
app.post('/forgot-password-otp', async (req, res) => {
  try {
    const { email } = req.body

    if (!email) {
      return res.status(400).json({ error: 'Email is required' })
    }

    const account = await Account.findOne({ email })

    // Don't reveal if account exists (security)
    if (!account) {
      console.log('OTP reset requested for non-existent account:', email)
      return res.json({ message: 'If an account exists, a password reset code has been sent.' })
    }

    // Check rate limiting
    const canSend = otpService.canSendOTP(account)
    if (!canSend.allowed) {
      return res.status(429).json({ error: canSend.reason })
    }

    // Generate OTP
    const otp = otpService.generateOTP()
    otpService.storeOTP(account.sub, otp, 'password_reset')

    // Update last OTP sent time
    account.security = account.security || {}
    account.security.lastOtpSent = new Date()
    await account.save()

    // Send OTP via email
    try {
      await emailService.sendPasswordResetOTP(email, otp)
      console.log('✅ Password reset OTP sent to:', email)
    } catch (emailError) {
      console.error('❌ Failed to send OTP email:', emailError)
    }

    res.json({ message: 'If an account exists, a password reset code has been sent.' })
  } catch (err) {
    console.error('OTP password reset error:', err)
    res.status(500).json({ error: 'Failed to send password reset code' })
  }
})

// Verify OTP and reset password
app.post('/reset-password-otp', async (req, res) => {
  try {
    const { email, code, newPassword } = req.body

    if (!email || !code || !newPassword) {
      return res.status(400).json({ error: 'Email, code, and new password are required' })
    }

    // Validate password strength
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' })
    }

    // Find account
    const account = await Account.findOne({ email })
    if (!account) {
      return res.status(404).json({ error: 'Account not found' })
    }

    // Verify OTP
    const result = otpService.verifyOTP(account.sub, code, 'password_reset')

    if (!result.valid) {
      await otpService.updateOTPAttempts(account, true)
      return res.status(400).json({
        error: result.reason,
        remainingAttempts: result.remainingAttempts
      })
    }

    // Update password
    account.passwordHash = await bcrypt.hash(newPassword, 10)
    account.lastPasswordChange = new Date()
    await otpService.updateOTPAttempts(account, false)
    await account.save()

    console.log('✅ Password reset via OTP for:', email)

    res.json({ message: 'Password has been reset successfully' })
  } catch (error) {
    console.error('Reset password OTP error:', error)
    res.status(500).json({ error: 'Failed to reset password' })
  }
})

// ============================================
// HUB ROUTES - App Launcher Portal
// ============================================

// Helper function to get session from cookies
async function getSessionFromCookies(req) {
  try {
    // Try to get session ID from cookie
    const sessionCookie = req.cookies['_session']
    if (!sessionCookie) return null

    // Look up the session using the OIDC provider's Session adapter
    const sessionLookupStart = Date.now()
    const adapter = new MongoAdapter('Session')
    const sessionData = await adapter.find(sessionCookie)
    console.log(`⏱️ Session adapter.find took ${Date.now() - sessionLookupStart}ms`)

    if (sessionData && sessionData.accountId) {
      const accountLookupStart = Date.now()
      // IMPORTANT: Populate currentOrganization to ensure organization context is available
      // This is critical for tenant isolation - apps like Zulip use currentOrganization.name
      // to determine which organization subdomain to redirect to
      const account = await Account.findOne({ sub: sessionData.accountId })
        .populate('currentOrganization', 'name')
        .populate('organizations.organization', 'name')
      console.log(`⏱️ Account.findOne took ${Date.now() - accountLookupStart}ms`)
      return account
    }
    return null
  } catch (err) {
    console.log('Session lookup error:', err.message)
    return null
  }
}

function getHubAppMetadata() {
  const apps = getHubApps().map(app => ({
    appId: app.appId,
    name: app.name,
    description: app.description || ''
  }))

  return {
    apps,
    appIdSet: buildValidAppIdSet(apps),
    appNameById: new Map(apps.map(app => [app.appId, app.name]))
  }
}

function getMemberAppAccessForOrganization(organizations, currentOrgId, accountId, validAppIds) {
  if (!currentOrgId || !Array.isArray(organizations)) {
    return normalizeAppAccess(null, validAppIds)
  }

  const org = organizations.find(item => item?._id?.toString() === currentOrgId.toString())
  const member = org?.members?.find(
    m => m?.status === 'active' && m?.account?.toString() === accountId.toString()
  )

  return normalizeAppAccess(member?.appAccess, validAppIds)
}

function getInvitationAccessSummary(invite, appNameById = new Map(), validAppIds = null) {
  const appAccess = normalizeAppAccess(invite?.appAccess, validAppIds)
  if (appAccess.mode !== APP_ACCESS_MODE_SELECTED) {
    return {
      appAccess,
      appAccessLabel: 'All apps',
      appAccessAppNames: []
    }
  }

  const appAccessAppNames = appAccess.appIds.map(appId => appNameById.get(appId) || appId)

  return {
    appAccess,
    appAccessLabel: appAccessAppNames.length === 1
      ? '1 selected app'
      : `${appAccessAppNames.length} selected apps`,
    appAccessAppNames
  }
}

async function logAppLaunchActivity({ req, account = null, app = null, appId = null, status, details = {} }) {
  try {
    const orgId =
      account?.currentOrganization?._id?.toString() ||
      account?.currentOrganization?.toString() ||
      details.organizationId ||
      null

    const userAgent = typeof req.headers['user-agent'] === 'string'
      ? req.headers['user-agent'].slice(0, 512)
      : null

    const errorMessage = typeof details.error === 'string'
      ? details.error.slice(0, 512)
      : undefined

    await AppLaunchActivity.create({
      organization: orgId || undefined,
      account: account?._id,
      appId: app?.appId || appId || 'unknown',
      appName: app?.name || details.appName || null,
      status,
      source: 'hub',
      details: {
        ...details,
        error: errorMessage
      },
      ipAddress: req.ip || req.connection?.remoteAddress || null,
      userAgent
    })
  } catch (error) {
    console.error('Failed to log app launch activity:', error.message)
  }
}

// Public Plans Page - View available subscription plans
app.get('/plans', async (req, res) => {
  try {
    const sessionAccount = await getSessionFromCookies(req)
    const plans = await subscriptionService.getPublicPlans()
    const planPageErrorMessages = {
      plan_not_found: 'The requested plan could not be found.',
      plan_not_requestable: 'That plan is admin-assigned only and cannot be requested or renewed from here.'
    }

    // If user is logged in, get their organization subscription info
    let currentSubscription = null
    let organization = null

    if (sessionAccount) {
      const account = await Account.findOne({ sub: sessionAccount.sub })
        .populate('currentOrganization')

      if (account?.currentOrganization) {
        organization = account.currentOrganization
        currentSubscription = await subscriptionService.getSubscriptionForOrg(organization._id)
      }
    }

    res.render('plans', {
      user: sessionAccount,
      plans,
      currentSubscription,
      organization,
      errorMessage: planPageErrorMessages[req.query?.error] || null,
      activePage: 'plans'
    })
  } catch (err) {
    console.error('Plans page error:', err)
    res.status(500).send('Internal server error')
  }
})

// Subscription Required Page - Redirect destination when app denies access due to subscription
app.get('/subscription-required', async (req, res) => {
  try {
    const sessionAccount = await getSessionFromCookies(req)
    const { app: appName, org: orgId, reason } = req.query

    // App name display mapping
    const appDisplayNames = {
      'recruiter': 'SmartHR Recruiter',
      'smarthr': 'SmartHR Recruiter',
      'leave-management': 'Leave Management',
      'payroll-management': 'Payroll Management',
      'performance-management': 'Performance Management',
      'time-attendance': 'Time & Attendance'
    }

    // Reason display mapping
    const reasonMessages = {
      'no_subscription': 'Your organization does not have an active subscription.',
      'subscription_inactive': 'Your organization\'s subscription has expired or been cancelled.',
      'feature_not_included': 'Your current plan does not include access to this application.',
      'verification_failed': 'We could not verify your subscription status. Please try again.',
      'verification_error': 'There was an error checking your subscription. Please try again later.',
      'no_organization': 'You need to be part of an organization to access this application.'
    }

    let organization = null
    let subscription = null
    let plans = []

    // Get plans for the user to see upgrade options
    plans = await subscriptionService.getPublicPlans()

    if (sessionAccount && orgId) {
      // Try to get organization info
      try {
        organization = await Organization.findById(orgId).lean()

        if (organization) {
          subscription = await subscriptionService.getSubscriptionForOrg(organization._id)
        }
      } catch (e) {
        console.error('Error fetching org for subscription-required:', e.message)
      }
    }

    res.render('subscription-required', {
      user: sessionAccount,
      appName: appDisplayNames[appName] || appName || 'the application',
      appKey: appName,
      organization,
      subscription,
      reason,
      reasonMessage: reasonMessages[reason] || reasonMessages['no_subscription'],
      plans,
      plansUrl: '/plans',
      subscriptionUrl: '/subscription',
      hubUrl: '/',
      activePage: null
    })
  } catch (err) {
    console.error('Subscription required page error:', err)
    res.status(500).send('Internal server error')
  }
})

// Subscription Status Page - View current subscription and requests
app.get('/subscription', async (req, res) => {
  try {
    const sessionAccount = await getSessionFromCookies(req)

    if (!sessionAccount) {
      return res.redirect('/login?redirect=/subscription')
    }

    const account = await Account.findOne({ sub: sessionAccount.sub })
      .populate('currentOrganization')

    if (!account) {
      return res.redirect('/login')
    }

    // Get user's organizations for the org selector
    const userOrganizations = await Organization.find({
      'members.account': account._id,
      'members.status': 'active'
    }).lean()

    // Determine which organization to show
    let organization = null
    const orgIdParam = req.query.org

    if (orgIdParam) {
      // Check if user is member of requested org
      organization = userOrganizations.find(o => o._id.toString() === orgIdParam)
    }

    if (!organization && account.currentOrganization) {
      organization = userOrganizations.find(o => o._id.toString() === account.currentOrganization._id.toString())
    }

    if (!organization && userOrganizations.length > 0) {
      organization = userOrganizations[0]
    }

    let subscription = null
    let features = null
    let limits = null
    let requests = []
    let isAdmin = false

    if (organization) {
      // Get subscription info
      subscription = await subscriptionService.getSubscriptionForOrg(organization._id)
      features = await subscriptionService.getEffectiveFeatures(organization._id)
      limits = await subscriptionService.getEffectiveLimits(organization._id)

      // Get subscription requests
      const SubscriptionRequest = (await import('./models/SubscriptionRequest.js')).default
      requests = await SubscriptionRequest.findAllForOrg(organization._id)

      // Check if user is admin of this org
      const member = organization.members?.find(m => m.account.toString() === account._id.toString())
      isAdmin = member?.role === 'admin' || member?.role === 'owner'
    }

    res.render('subscription', {
      user: sessionAccount,
      organization,
      organizations: userOrganizations,
      subscription,
      features,
      limits,
      requests,
      isAdmin,
      requested: req.query.requested === 'true',
      activePage: 'subscription'
    })
  } catch (err) {
    console.error('Subscription page error:', err)
    res.status(500).send('Internal server error')
  }
})

// Request Plan Page - Form to request a subscription
app.get('/request-plan/:planId', async (req, res) => {
  try {
    const sessionAccount = await getSessionFromCookies(req)

    if (!sessionAccount) {
      return res.redirect('/login?redirect=/request-plan/' + req.params.planId)
    }

    const account = await Account.findOne({ sub: sessionAccount.sub })
      .populate('currentOrganization')

    if (!account) {
      return res.redirect('/login')
    }

    if (!account.currentOrganization) {
      return res.redirect('/organizations?error=select_org_first')
    }

    // Get the plan
    const Plan = (await import('./models/Plan.js')).default
    const plan = await Plan.findById(req.params.planId)

    if (!plan || !plan.isActive || !plan.isPublic) {
      return res.redirect('/plans?error=plan_not_found')
    }
    if (plan.isRequestable === false) {
      return res.redirect('/plans?error=plan_not_requestable')
    }

    // Check if there's already a pending request
    const SubscriptionRequest = (await import('./models/SubscriptionRequest.js')).default
    const pendingRequest = await SubscriptionRequest.findOne({
      organization: account.currentOrganization._id,
      status: 'pending'
    })

    res.render('request-plan', {
      user: sessionAccount,
      plan,
      organization: account.currentOrganization,
      hasPendingRequest: !!pendingRequest,
      activePage: 'subscription'
    })
  } catch (err) {
    console.error('Request plan page error:', err)
    res.status(500).send('Internal server error')
  }
})

// Shared recovery destination for app backends that cannot start an OIDC request.
app.get('/sso/recovery', (req, res) => {
  const requestedAppId = String(req.query.app || '')
  const recoveryApp = getAppById(requestedAppId)
  const requestId = crypto.randomUUID()
  const page = renderOidcRecoveryPage({
    error: String(req.query.error || 'server_error'),
    description: String(req.query.reason || 'Sign-in is temporarily unavailable'),
    appId: recoveryApp?.appId,
    appName: recoveryApp?.name,
    requestId,
    statusCode: 503
  })
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-SSO-Request-ID', requestId)
  res.status(page.statusCode).send(page.html)
})

// Short-lived, self-service token for the hub's embedded attendance controls.
// It grants no administrative access and is intentionally separate from the user's OIDC token.
app.get('/api/hub/attendance-token', async (req, res) => {
  try {
    const sessionAccount = await getSessionFromCookies(req)
    if (!sessionAccount) return res.status(401).json({ error: 'Authentication required' })

    const account = await Account.findOne({ sub: sessionAccount.sub })
      .populate('organizations.organization', 'name')
      .populate('currentOrganization', 'name')
    if (!account?.currentOrganization) return res.status(409).json({ error: 'Select an organization first' })

    const currentId = account.currentOrganization._id.toString()
    const membership = account.organizations.find(item =>
      item.isActive !== false && (item.organization?._id || item.organization)?.toString() === currentId
    )
    if (!membership) return res.status(403).json({ error: 'Organization membership is not active' })
    if (membership.appAccess?.mode === APP_ACCESS_MODE_SELECTED && !membership.appAccess.appIds?.includes('time-attendance')) {
      return res.status(403).json({ error: 'Time & Attendance is not assigned to this account' })
    }

    const access = await getCurrentOrganizationSubscriptionAccessState(account)
    if (access?.isLocked) return res.status(403).json({ error: 'Organization subscription is not active' })

    const token = await issueAttendanceHubToken({
      account,
      organization: account.currentOrganization,
      role: membership.role,
      teams: account.teams.filter(team => team.isActive !== false && team.organization?.toString() === currentId)
    })
    res.setHeader('Cache-Control', 'no-store')
    res.json({ token, expiresIn: 120, apiUrl: getAppApiUrl('time-attendance') })
  } catch (err) {
    console.error('Attendance hub token error:', err.message)
    res.status(err.message.includes('not configured') ? 503 : 500).json({ error: 'Attendance controls are temporarily unavailable' })
  }
})

// Hub Homepage - Main app launcher (root route)
app.get('/', async (req, res) => {
  try {
    // Check for authenticated session
    const sessionAccount = await getSessionFromCookies(req)

    if (!sessionAccount) {
      // Not logged in - redirect to login
      return res.redirect('/login')
    }

    // Get full account with populated organizations
    const account = await Account.findOne({ sub: sessionAccount.sub })
      .populate('organizations.organization', 'name')
      .populate('currentOrganization', 'name')

    if (!account) {
      return res.redirect('/login')
    }

    // Get user's organizations with their roles
    const userOrganizations = await Organization.find({
      'members.account': account._id,
      'members.status': 'active'
    }).lean()

    const organizations = userOrganizations.map(org => {
      const member = org.members.find(m => m.account.toString() === account._id.toString())
      return {
        id: org._id.toString(),
        name: org.name,
        role: member?.role || 'member',
        isCurrent: account.currentOrganization?._id?.toString() === org._id.toString()
      }
    })

    const { appIdSet, appNameById } = getHubAppMetadata()
    const hasOrganizations = organizations.length > 0
    const currentOrgId = account.currentOrganization?._id?.toString() || account.currentOrganization?.toString()
    const currentSubscriptionAccess = await getCurrentOrganizationSubscriptionAccessState(account, {
      includePendingRequest: true
    })
    const memberAppAccess = getMemberAppAccessForOrganization(
      userOrganizations,
      currentOrgId,
      account._id,
      appIdSet
    )

    const hubBrand = getIdpBrand(req)
    const isAkwaIbomHub = hubBrand.name === 'Akwa Ibom State'
    let apps = getHubApps({ isAkwaIbom: isAkwaIbomHub })
      .filter(app => app.appId !== 'lms')
      .map(app => ({
        ...app,
        iconSvg: getAppIcon(app.icon)
      }))

    // Filter hub cards by per-member access scope
    if (memberAppAccess.mode === APP_ACCESS_MODE_SELECTED) {
      const allowedAppIds = new Set(memberAppAccess.appIds)
      apps = apps.filter(app => allowedAppIds.has(app.appId))
    }

    // Filter hub cards by plan's hideHubCards (dynamically hide cards per plan)
    // Get coming soon cards for this plan (toggleable per plan, default off)
    let comingSoonCards = []
    if (currentOrgId) {
      const subscription = await subscriptionService.getSubscriptionForOrg(currentOrgId)
      const hideHubCards = subscription?.plan?.hideHubCards
      if (hideHubCards && Array.isArray(hideHubCards) && hideHubCards.length > 0) {
        const hideSet = new Set(hideHubCards.map(id => String(id).trim()).filter(Boolean))
        apps = apps.filter(app => !hideSet.has(app.appId))
      }
      const showComingSoonCards = subscription?.plan?.showComingSoonCards
      if (showComingSoonCards && Array.isArray(showComingSoonCards) && showComingSoonCards.length > 0) {
        comingSoonCards = getComingSoonCards(showComingSoonCards).map(card => ({
          ...card,
          iconSvg: getAppIcon(card.icon)
        }))
      }
    }

    const pendingInvites = await OrganizationInvite.find({
      email: account.email.toLowerCase(),
      status: 'pending',
      expiresAt: { $gt: new Date() }
    })
      .populate('organization', 'name description')
      .populate('invitedBy', 'email profile.name')
      .sort({ createdAt: -1 })
      .lean()

    const pendingInvitations = pendingInvites.map(invite => ({
      id: invite._id.toString(),
      organization: {
        id: invite.organization?._id?.toString?.() || '',
        name: invite.organization?.name || 'Organization',
        description: invite.organization?.description || ''
      },
      role: invite.role,
      invitedBy: {
        email: invite.invitedBy?.email || '',
        name: invite.invitedBy?.profile?.name || ''
      },
      expiresAt: invite.expiresAt,
      createdAt: invite.createdAt,
      ...getInvitationAccessSummary(invite, appNameById, appIdSet)
    }))

    if (!hasOrganizations || currentSubscriptionAccess?.isLocked) {
      apps = []
      comingSoonCards = []
    }

    const notificationSummary = await buildNotificationCenterData(account, {
      maxTasks: 12
    })
    const unreadPendingOnboardingAssignments = notificationSummary.unreadDocumentAssignments || []
    const latestReceivedEvaluationsWithMetrics = (notificationSummary.unreadPerformanceEvaluations || []).slice(0, 3)
    const receivedEvaluationCount = notificationSummary.counts?.simplePerformance || 0
    const profileCompletion = await getProfileCompletionForAccount(account, {
      organizationId: account.currentOrganization?._id?.toString?.() || account.currentOrganization?.toString?.() || null
    })

    // Render the hub homepage using EJS template
    res.render('home', {
      user: account,
      apps,
      comingSoonCards,
      attendanceHubEnabled: apps.some(app => app.appId === 'time-attendance'),
      organizations,
      hasOrganizations,
      currentSubscriptionAccess,
      pendingInvitations,
      pendingInvitationsCount: pendingInvitations.length,
      accessError: req.query?.error === 'app_not_assigned'
        ? `${req.query?.app || 'This app'} is not assigned to your account for the current organization.`
        : null,
      pendingOnboardingCount: notificationSummary.counts?.documents || unreadPendingOnboardingAssignments.length,
      pendingOnboardingAssignments: unreadPendingOnboardingAssignments,
      receivedEvaluationCount,
      latestReceivedEvaluations: latestReceivedEvaluationsWithMetrics,
      notificationSummary,
      profileCompletion,
      currentProfileSection: '',
      profileCompletionEnforced: !profileCompletion.complete,
      activePage: 'home'
    })
  } catch (err) {
    console.error('Hub error:', err)
    res.status(500).send('Internal server error')
  }
})

// Hub Login Page - Dedicated login for the hub
app.get('/login', async (req, res) => {
  const errorMessages = {
    account_not_found: 'Account not found. Please sign up first.',
    invalid_password: 'Invalid password. Please try again.',
    login_failed: 'Login failed. Please try again.'
  }
  const errorMsg = req.query.error ? errorMessages[req.query.error] || 'An error occurred' : ''

  // Check if user is coming from an invitation link
  const returnTo = req.query.return_to || ''
  let pendingInviteInfo = null

  if (returnTo.includes('/invitations/accept')) {
    // Extract token from return URL
    const tokenMatch = returnTo.match(/token=([^&]+)/)
    if (tokenMatch) {
      const token = tokenMatch[1]
      try {
        // Find pending invitations that might match this token
        const pendingInvites = await OrganizationInvite.find({
          status: 'pending',
          expiresAt: { $gt: new Date() }
        }).populate('organization', 'name')

        // Check each invitation to find matching token
        for (const invite of pendingInvites) {
          const isValid = await invite.verifyToken(token)
          if (isValid) {
            pendingInviteInfo = {
              organizationName: invite.organization.name,
              role: invite.role,
              email: invite.email
            }
            break
          }
        }
      } catch (err) {
        console.log('Could not verify invitation token on login page:', err.message)
      }
    }
  }

  res.send(renderHubLoginPage(req, errorMsg, returnTo, pendingInviteInfo))
})

// Hub Login Handler
app.post('/login', async (req, res) => {
  try {
    const { email, password, remember, return_to } = req.body

    const account = await Account.findOne({ email })
    if (!account) {
      const returnQuery = return_to ? `&return_to=${encodeURIComponent(return_to)}` : ''
      return res.redirect(`/login?error=account_not_found${returnQuery}`)
    }

    const validPassword = await bcrypt.compare(password, account.passwordHash)
    if (!validPassword) {
      const returnQuery = return_to ? `&return_to=${encodeURIComponent(return_to)}` : ''
      return res.redirect(`/login?error=invalid_password${returnQuery}`)
    }

    console.log('Hub login successful for:', email)

    // Set express-session for downstream org/team pages
    req.session.accountId = account.sub

    // Create a session for the hub
    const adapter = new MongoAdapter('Session')
    const sessionId = crypto.randomBytes(32).toString('hex')
    const sessionData = {
      accountId: account.sub,
      loginTs: Math.floor(Date.now() / 1000),
      uid: sessionId
    }

    // Save session (expires in 7 days if remember, 1 day otherwise)
    const expiresIn = remember === 'true' ? 7 * 24 * 60 * 60 : 24 * 60 * 60
    await adapter.upsert(sessionId, sessionData, expiresIn)

    // Set session cookie
    res.cookie('_session', sessionId, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      maxAge: expiresIn * 1000
    })

    const currentOrgId = account.currentOrganization?._id?.toString?.()
      || account.currentOrganization?.toString?.()
      || null
    const profileCompletion = await getProfileCompletionForAccount(account, {
      organizationId: currentOrgId
    })
    const profileSetupRoute = profileCompletion?.complete
      ? '/'
      : `${profileCompletion?.nextIncompleteStep?.route || '/profile/personal'}?wizard=1`

    // Redirect to return_to URL if provided (e.g., for invitation acceptance), otherwise profile setup or home
    if (return_to && return_to.startsWith('/')) {
      console.log('Redirecting to return_to:', return_to)
      res.redirect(return_to)
    } else {
      res.redirect(profileSetupRoute)
    }
  } catch (err) {
    console.error('Hub login error:', err)
    res.redirect('/login?error=login_failed')
  }
})

// Hub Signup Page
app.get('/signup', async (req, res) => {
  const errorMessages = {
    account_exists: 'An account with this email already exists.',
    signup_failed: 'Signup failed. Please try again.',
    passwords_mismatch: 'Passwords do not match.'
  }
  const errorMsg = req.query.error ? errorMessages[req.query.error] || 'An error occurred' : ''

  res.send(renderHubSignupPage(req, errorMsg, req.query))
})

// Hub Signup Handler
app.post('/signup', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase()
    const password = String(req.body?.password || '')
    const confirmPassword = String(req.body?.confirmPassword || '')
    const name = String(req.body?.name || '').trim()
    const attributionQuery = collectSignupAttribution(req.body)

    if (password !== confirmPassword) {
      return res.redirect(buildPathWithQuery('/signup', attributionQuery, {
        error: 'passwords_mismatch'
      }))
    }

    // Check if account exists
    const existing = await Account.findOne({ email })
    if (existing) {
      return res.redirect(buildPathWithQuery('/signup', attributionQuery, {
        error: 'account_exists'
      }))
    }

    const attributionState = await buildSignupAttributionState(req, email)

    // Create account (NOT verified yet)
    const sub = new mongoose.Types.ObjectId().toString()
    const passwordHash = await bcrypt.hash(password, 10)

    const acc = await Account.create({
      sub,
      email,
      passwordHash,
      emailVerified: false, // Requires OTP verification
      profile: {
        name: name || email.split('@')[0],
        preferred_username: email.split('@')[0]
      },
      security: {},
      acquisition: {
        firstTouch: attributionState.firstTouch,
        lastTouch: attributionState.lastTouch,
        conversionSource: attributionState.resolved.verifiedToken ? 'campaign' : 'website',
        visitorId: attributionState.resolved.visitorId,
        attributionSnapshot: {
          signupTouch: attributionState.signupTouch
        }
      }
    })

    console.log('Hub signup successful (unverified):', email)

    const hubSignupTrackingResults = await Promise.allSettled([
      MarketingVisit.create({
        visitorId: attributionState.resolved.visitorId,
        sessionId: attributionState.resolved.sessionId,
        eventType: 'signup_complete',
        sourceApp: 'identityprovider',
        pageUrl: String(req.body?.landingPage || ''),
        path: req.originalUrl,
        referrer: String(req.body?.referrer || req.headers.referer || ''),
        ipAddress: req.ip || req.connection?.remoteAddress || '',
        userAgent: String(req.headers['user-agent'] || ''),
        utm: attributionState.resolved.utm,
        attribution: attributionState.signupTouch,
        account: acc._id,
        metadata: {
          route: 'hub_signup'
        },
        occurredAt: attributionState.signupTouch.occurredAt
      }),
      registerCampaignConversion({
        conversionType: 'signup',
        campaignId: attributionState.resolved.verifiedToken?.campaignId || attributionState.lastTouch?.campaignId || null,
        recipientId: attributionState.resolved.verifiedToken?.recipientId || attributionState.lastTouch?.recipientId || null,
        email,
        visitorId: attributionState.resolved.visitorId,
        occurredAt: attributionState.signupTouch.occurredAt,
        accountId: acc._id
      })
    ])
    hubSignupTrackingResults.forEach((result) => {
      if (result.status === 'rejected') {
        console.error('Hub signup tracking error:', result.reason)
      }
    })

    // Generate and send verification OTP
    const otp = otpService.generateOTP()
    otpService.storeOTP(acc.sub, otp, 'email_verification')

    // Update last OTP sent time
    acc.security.lastOtpSent = new Date()
    await acc.save()

    // Send verification email
    try {
      await emailService.sendEmailVerificationOTP(email, otp, name || email.split('@')[0])
      console.log('✉️ Verification OTP sent to:', email)
    } catch (emailError) {
      console.error('❌ Failed to send verification email:', emailError.message)
    }

    // Redirect to verification page
    res.redirect(`/verify-email/${sub}?email=${encodeURIComponent(email)}`)

  } catch (err) {
    console.error('Hub signup error:', err)
    res.redirect(buildPathWithQuery('/signup', req.body, {
      error: 'signup_failed'
    }))
  }
})

// Hub Logout
app.get('/logout', async (req, res) => {
  try {
    const sessionCookie = req.cookies['_session']
    if (sessionCookie) {
      const adapter = new MongoAdapter('Session')
      await adapter.destroy(sessionCookie)
    }

    res.clearCookie('_session')
    // A parent-domain marker lets every Seemplify app reject browser tokens
    // issued before this central logout, including already-open app tabs.
    res.cookie('seemplify_logout_at', String(Date.now()), {
      domain: process.env.NODE_ENV === 'production' ? '.seemplifyai.com' : undefined,
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      httpOnly: false,
      maxAge: 365 * 24 * 60 * 60 * 1000
    })
    res.redirect('/login')
  } catch (err) {
    console.error('Hub logout error:', err)
    res.redirect('/login')
  }
})

app.get('/simple-lms', async (req, res) => {
  try {
    const account = await getSessionFromCookies(req)
    if (account) {
      const organizationIds = getOrganizationIdsFromAccount(account)
      if (organizationIds.length === 0) {
        return res.redirect('/')
      }

      const accessState = await getCurrentOrganizationSubscriptionAccessState(account)
      if (!accessState) {
        return res.redirect('/')
      }
      if (accessState.isLocked) {
        return res.redirect('/?subscription=locked')
      }
    }

    const params = new URLSearchParams(req.query || {})
    const targetUrl = params.toString()
      ? `${SIMPLE_LMS_EXTERNAL_WORKSPACE_URL}?${params.toString()}`
      : SIMPLE_LMS_EXTERNAL_WORKSPACE_URL
    return res.redirect(targetUrl)
  } catch (error) {
    console.error('Simple LMS redirect failed:', error)
    return res.redirect('/')
  }
})


// Hub App Launch - Creates SSO token and redirects to app's auth endpoint
// Supports both OIDC and SAML based on app.authType
app.get('/launch/:appId', async (req, res) => {
  const launchStartTime = Date.now()
  let account = null
  let app = null

  try {
    const { appId } = req.params

    const sessionStart = Date.now()
    account = await getSessionFromCookies(req)
    console.log(`Hub session lookup took ${Date.now() - sessionStart}ms`)

    if (!account) {
      void logAppLaunchActivity({
        req,
        appId,
        status: 'no_session'
      })
      return res.redirect('/login')
    }

    app = getAppById(appId)
    if (!app) {
      await logAppLaunchActivity({
        req,
        account,
        appId,
        status: 'app_not_found'
      })
      return res.status(404).send('App not found')
    }

    const currentOrgId = account.currentOrganization?._id?.toString() || account.currentOrganization?.toString() || null
    if (!currentOrgId) {
      await logAppLaunchActivity({
        req,
        account,
        app,
        status: 'blocked_no_organization',
        details: {
          appId
        }
      })
      return res.redirect('/')
    }

    // Membership and subscription are independent reads; run them together to keep launches responsive.
    const [currentSubscriptionAccess, currentOrganization] = await Promise.all([
      getCurrentOrganizationSubscriptionAccessState(account, { includeFeatures: true }),
      Organization.findById(currentOrgId)
        .select('members.account members.status members.appAccess')
        .lean()
    ])
    if (!currentSubscriptionAccess || currentSubscriptionAccess.isLocked) {
      await logAppLaunchActivity({
        req,
        account,
        app,
        status: 'blocked_subscription',
        details: {
          organizationId: currentOrgId,
          subscriptionStatus: currentSubscriptionAccess?.status || 'none'
        }
      })
      return res.redirect('/?subscription=locked')
    }

    const { appIdSet } = getHubAppMetadata()

    const currentMember = currentOrganization?.members?.find(
      m => m?.status === 'active' && m?.account?.toString() === account._id.toString()
    )

    if (!currentMember) {
      await logAppLaunchActivity({
        req,
        account,
        app,
        status: 'blocked_no_membership',
        details: {
          organizationId: currentOrgId
        }
      })
      return res.redirect('/')
    }

    const currentMemberAppAccess = normalizeAppAccess(currentMember.appAccess, appIdSet)

    if (!memberCanAccessApp(currentMemberAppAccess, appId)) {
      await logAppLaunchActivity({
        req,
        account,
        app,
        status: 'blocked_member_scope',
        details: {
          organizationId: currentOrgId,
          appAccessMode: currentMemberAppAccess.mode,
          assignedApps: currentMemberAppAccess.appIds
        }
      })

      const redirectMessage = encodeURIComponent(app.name || appId)
      return res.redirect(`/?error=app_not_assigned&app=${redirectMessage}`)
    }

    // Check subscription access for apps that require it
    // Map app IDs to subscription feature keys
    const appFeatureMap = {
      'smarthr': 'recruiter',
      'recruiter': 'recruiter',
      'leave-management': 'leaveManagement',
      'payroll-management': 'payrollManagement',
      'performance-management': 'performanceManagement',
      'time-attendance': 'timeAttendance',
      'outline': 'outlineDocs',
      'openwebui': 'aiChat',
      'lms': 'lms'
    }

    const featureKey = appFeatureMap[appId]
    if (!featureKey) {
      console.warn(`No subscription feature mapping for appId: ${appId} - subscription check skipped`)
    }

    if (featureKey && currentOrgId) {
      // Reuse the subscription loaded above instead of repeating the same database query.
      const canAccess = currentSubscriptionAccess.features?.[featureKey] === true

      if (!canAccess) {
        console.log(`Subscription check failed for ${account.email} - ${appId} (feature: ${featureKey})`)
        await logAppLaunchActivity({
          req,
          account,
          app,
          status: 'blocked_subscription',
          details: {
            organizationId: currentOrgId,
            featureKey
          }
        })

        return res.render('subscription-required', {
          appName: app.name,
          organization: account.currentOrganization,
          user: account
        })
      }
    }

    console.log('Launching app from hub:')
    console.log('  App ID:', app.appId)
    console.log('  App Name:', app.name)
    console.log('  Auth Type:', app.authType || 'oidc')
    console.log('  User:', account.email)

    // Check if app uses SAML authentication
    if (app.authType === 'saml') {
      const samlSsoUrl = `/saml/sso?sp=${app.appId}`
      void logAppLaunchActivity({
        req,
        account,
        app,
        status: 'launched_saml',
        details: {
          redirectUrl: samlSsoUrl,
          authType: 'saml',
          launchDurationMs: Date.now() - launchStartTime
        }
      })
      return res.redirect(samlSsoUrl)
    }

    // Check if app uses direct link (no SSO)
    if (app.authType === 'direct') {
      void logAppLaunchActivity({
        req,
        account,
        app,
        status: 'launched_direct',
        details: {
          redirectUrl: app.url,
          authType: 'direct',
          launchDurationMs: Date.now() - launchStartTime
        }
      })
      return res.redirect(app.url)
    }

    // Special handling for Outline - it uses direct OIDC, not backend-initiated
    if (app.appId === 'outline') {
      const outlineAuthUrl = `${app.url}/auth/oidc`
      void logAppLaunchActivity({
        req,
        account,
        app,
        status: 'launched_outline',
        details: {
          redirectUrl: outlineAuthUrl,
          authType: 'oidc',
          launchDurationMs: Date.now() - launchStartTime
        }
      })
      return res.redirect(outlineAuthUrl)
    }

    // Special handling for Open WebUI - it uses direct OIDC, not backend-initiated
    if (app.appId === 'openwebui') {
      const openwebuiAuthUrl = `${app.url}/oauth/oidc/login`
      void logAppLaunchActivity({
        req,
        account,
        app,
        status: 'launched_openwebui',
        details: {
          redirectUrl: openwebuiAuthUrl,
          authType: 'oidc',
          launchDurationMs: Date.now() - launchStartTime
        }
      })
      return res.redirect(openwebuiAuthUrl)
    }

    // Zulip uses a single realm instance with multi-org support via OIDC claims
    if (app.appId === 'zulip') {
      const zulipUrl = 'https://chat.seemplifyai.com/login/oidc/?next=/'
      void logAppLaunchActivity({
        req,
        account,
        app,
        status: 'launched_zulip',
        details: {
          redirectUrl: zulipUrl,
          authType: 'oidc',
          launchDurationMs: Date.now() - launchStartTime
        }
      })
      return res.redirect(zulipUrl)
    }

    // Special handling for LMS - Frappe uses Social Login Key for OIDC
    if (app.appId === 'lms') {
      const ssoSecret = process.env.OIDC_COOKIE_SECRET || 'dev-cookie-secret'
      const secretKey = new TextEncoder().encode(ssoSecret)

      const hubToken = await new SignJWT({
        sub: account.sub,
        email: account.email,
        name: account.profile?.name,
        purpose: 'hub_sso'
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(secretKey)

      const state = Buffer.from(JSON.stringify({
        site: app.url,
        token: crypto.randomBytes(16).toString('hex'),
        redirect_to: '/lms'
      })).toString('base64')

      const redirectUri = `${app.url}/api/method/frappe.integrations.oauth2_logins.custom/Seemplify`
      const authParams = new URLSearchParams({
        client_id: 'lms',
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        hub_token: hubToken
      })

      const lmsAuthUrl = `${process.env.ISSUER_BASE_URL || 'https://auth.seemplifyai.com'}/auth?${authParams.toString()}`

      void logAppLaunchActivity({
        req,
        account,
        app,
        status: 'launched_lms',
        details: {
          redirectUrl: lmsAuthUrl,
          authType: 'oidc',
          launchDurationMs: Date.now() - launchStartTime
        }
      })

      return res.redirect(lmsAuthUrl)
    }

    // For OIDC apps, generate SSO token and redirect to backend OIDC start
    const ssoSecret = process.env.OIDC_COOKIE_SECRET || 'dev-cookie-secret'
    const secretKey = new TextEncoder().encode(ssoSecret)

    const ssoToken = await new SignJWT({
      sub: account.sub,
      email: account.email,
      name: account.profile?.name,
      purpose: 'hub_sso'
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(secretKey)

    // Build the redirect URL to the app's backend OIDC start
    let apiUrl
    switch (app.appId) {
      case 'smarthr':
        apiUrl = process.env.SMARTHR_API_URL || 'http://localhost:5001'
        break
      case 'leave-management':
        apiUrl = process.env.LEAVE_MANAGEMENT_API_URL || 'http://localhost:5002'
        break
      case 'performance-management':
        apiUrl = isProduction
          ? getProductionSafeUrl(process.env.PERFORMANCE_MANAGEMENT_API_URL, 'https://api-performance.seemplifyai.com')
          : process.env.PERFORMANCE_MANAGEMENT_API_URL || 'http://localhost:5004'
        break
      case 'payroll-management':
        apiUrl = isProduction
          ? getProductionSafeUrl(process.env.PAYROLL_MANAGEMENT_API_URL, 'https://api-payroll.seemplifyai.com')
          : process.env.PAYROLL_MANAGEMENT_API_URL || 'http://localhost:5006'
        break
      case 'time-attendance':
        apiUrl = process.env.TIME_ATTENDANCE_API_URL || 'https://api-time.seemplifyai.com'
        break
      default:
        apiUrl = process.env.SMARTHR_API_URL || 'http://localhost:5001'
    }

    const launchBrand = getIdpBrand(req)
    let frontendUrl = app.url
    if (launchBrand.name === 'Akwa Ibom State' && app.appId === 'smarthr') {
      frontendUrl = 'https://ibom.aiinnigeria.com'
    }
    const redirectUrl = `${apiUrl}/api/auth/oidc/start?` + new URLSearchParams({
      idp_initiated: 'true',
      hub_token: ssoToken,
      returnTo: frontendUrl
    }).toString()

    void logAppLaunchActivity({
      req,
      account,
      app,
      status: 'launched_oidc',
      details: {
        redirectUrl,
        authType: 'oidc',
        launchDurationMs: Date.now() - launchStartTime
      }
    })

    res.redirect(redirectUrl)
  } catch (err) {
    console.error('App launch error:', err)
    await logAppLaunchActivity({
      req,
      account,
      app,
      appId: req.params?.appId,
      status: 'launch_error',
      details: {
        error: err.message,
        launchDurationMs: Date.now() - launchStartTime
      }
    })
    const requestId = crypto.randomUUID()
    const page = renderOidcRecoveryPage({
      error: 'server_error',
      description: err.message,
      appId: app?.appId || req.params?.appId,
      appName: app?.name,
      requestId,
      statusCode: 500
    })
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-SSO-Request-ID', requestId)
    res.status(page.statusCode).send(page.html)
  }
})
// API: Get all apps (for potential SPA usage)
app.get('/api/apps', async (req, res) => {
  try {
    const apps = getHubApps()
    res.json(apps)
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch apps' })
  }
})

// ============================================================
// Organization, Invitation, Member, and Team Management Routes
// ============================================================

// Helper middleware to check session and get current user
const getSessionUser = async (req, res, next) => {
  const attachProfileCompletionLocals = async (account) => {
    const profileCompletion = await getProfileCompletionForAccount(account, {
      organizationId: account?.currentOrganization?._id?.toString?.() || account?.currentOrganization?.toString?.() || req.session?.currentOrganization || null
    })
    const nextIncompleteStepKey = String(profileCompletion?.nextIncompleteStep?.key || '').trim().toLowerCase()
    const isProfileRoute = req.path.startsWith('/profile')
    const isDocumentWorkspaceRoute = req.path === '/documents'
      || req.path.startsWith('/documents/')
      || req.path === '/onboarding'
      || req.path.startsWith('/onboarding/')
    const isCurrentCompletionRoute = isProfileRoute
      || (nextIncompleteStepKey === 'documents' && isDocumentWorkspaceRoute)

    req.profileCompletion = profileCompletion
    res.locals.user = account
    res.locals.profileCompletion = profileCompletion
    res.locals.currentProfileSection = nextIncompleteStepKey === 'documents' && isDocumentWorkspaceRoute
      ? 'documents'
      : ''
    res.locals.activeProfileSection = res.locals.activeProfileSection || ''
    res.locals.profileCompletionEnforced = !profileCompletion.complete && !isCurrentCompletionRoute
  }

  // Check if user has a session (set during login)
  const sessionAccountId = req.session?.accountId
  if (!sessionAccountId) {
    // Try to get from cookie-based session (_session from hub login/signup)
    const cookieAccount = await getSessionFromCookies(req)
    if (cookieAccount) {
      req.session.accountId = cookieAccount.sub
      req.user = await Account.findOne({ sub: cookieAccount.sub })
        .populate('organizations.organization', 'name')
        .populate('currentOrganization', 'name')
      await attachProfileCompletionLocals(req.user)
      return next()
    }

    // Fallback: legacy hub_session JWT (if present)
    const hubSession = req.cookies?.hub_session
    if (hubSession) {
      try {
        const ssoSecret = process.env.OIDC_COOKIE_SECRET || 'dev-cookie-secret'
        const secretKey = new TextEncoder().encode(ssoSecret)
        const { payload } = await jwtVerify(hubSession, secretKey)
        if (payload.sub) {
          req.session.accountId = payload.sub
          req.user = await Account.findOne({ sub: payload.sub })
            .populate('organizations.organization', 'name')
            .populate('currentOrganization', 'name')
          if (req.user) {
            await attachProfileCompletionLocals(req.user)
            return next()
          }
        }
      } catch (e) {
        console.log('Session token invalid:', e.message)
      }
    }
    return res.redirect('/login?return_to=' + encodeURIComponent(req.originalUrl))
  }

  const account = await Account.findOne({ sub: sessionAccountId })
    .populate('organizations.organization', 'name')
    .populate('currentOrganization', 'name')

  if (!account) {
    return res.redirect('/login?return_to=' + encodeURIComponent(req.originalUrl))
  }

  req.user = account
  await attachProfileCompletionLocals(account)
  next()
}

const getCurrentOrganizationContext = async (user) => {
  const organizationId =
    user?.currentOrganization?._id?.toString() ||
    user?.currentOrganization?.toString() ||
    null

  if (!organizationId) {
    return { error: 'Select an organization first.' }
  }

  const organization = await Organization.findById(organizationId)
    .select('name members')
    .lean()

  if (!organization) {
    return { error: 'Organization not found.' }
  }

  const memberRecord = organization.members?.find(
    member => (
      member.status === 'active' &&
      member.account?.toString() === user._id.toString()
    )
  )

  if (!memberRecord) {
    return { error: 'You are not an active member of the current organization.' }
  }

  return {
    organizationId,
    organizationName: organization.name,
    memberRole: memberRecord.role
  }
}

const DASHBOARD_NOTIFICATION_VIEW_PATHS = Object.freeze({
  documents: 'notificationViews.documentsByOrganization',
  simplePerformance: 'notificationViews.simplePerformanceByOrganization',
  simpleLms: 'notificationViews.simpleLmsByOrganization'
})

const NOTIFICATION_READ_PATHS = Object.freeze({
  documents: 'notificationReads.documentsAssignments',
  simplePerformance: 'notificationReads.simplePerformanceEvaluations'
})

const getOrganizationIdsFromAccount = (account) => {
  if (!account || !Array.isArray(account.organizations)) {
    return []
  }

  const organizationIds = new Set()
  for (const membership of account.organizations) {
    if (membership?.isActive === false) continue
    const organizationId =
      membership?.organization?._id?.toString() ||
      membership?.organization?.toString() ||
      ''
    if (organizationId) {
      organizationIds.add(organizationId)
    }
  }

  return Array.from(organizationIds)
}

const readNotificationViewDate = (mapLike, organizationId) => {
  const key = String(organizationId || '').trim()
  if (!key || !mapLike) {
    return null
  }

  let rawValue = null
  if (typeof mapLike.get === 'function') {
    rawValue = mapLike.get(key)
  } else if (typeof mapLike === 'object') {
    rawValue = mapLike[key]
  }

  if (!rawValue) {
    return null
  }

  const parsedDate = new Date(rawValue)
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate
}

const readNotificationEntityDate = (mapLike, entityId) => {
  const key = String(entityId || '').trim()
  if (!key || !mapLike) {
    return null
  }

  let rawValue = null
  if (typeof mapLike.get === 'function') {
    rawValue = mapLike.get(key)
  } else if (typeof mapLike === 'object') {
    rawValue = mapLike[key]
  }

  if (!rawValue) {
    return null
  }

  const parsedDate = new Date(rawValue)
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate
}

const getDashboardNotificationViewedAt = (account, type, organizationId) => {
  const orgId = String(organizationId || '').trim()
  if (!orgId) {
    return null
  }

  if (type === 'documents') {
    return readNotificationViewDate(account?.notificationViews?.documentsByOrganization, orgId)
  }
  if (type === 'simplePerformance') {
    return readNotificationViewDate(account?.notificationViews?.simplePerformanceByOrganization, orgId)
  }
  if (type === 'simpleLms') {
    return readNotificationViewDate(account?.notificationViews?.simpleLmsByOrganization, orgId)
  }
  return null
}

const getNotificationEntityReadAt = (account, type, entityId) => {
  const id = String(entityId || '').trim()
  if (!id) {
    return null
  }

  if (type === NOTIFICATION_CATEGORY.documents) {
    return readNotificationEntityDate(account?.notificationReads?.documentsAssignments, id)
  }
  if (type === NOTIFICATION_CATEGORY.simplePerformance) {
    return readNotificationEntityDate(account?.notificationReads?.simplePerformanceEvaluations, id)
  }
  return null
}

const getNotificationReferenceFromTask = (task = {}) => {
  const idValue = String(task.id || '').trim()
  const [category, rawEntityId] = idValue.split(':')
  const entityId = String(rawEntityId || '').trim()
  const normalizedCategory = getNotificationCategory(category, '')
  if (!normalizedCategory || !entityId) {
    return null
  }
  return {
    category: normalizedCategory,
    entityId,
    organizationId: task.organizationId ? String(task.organizationId) : ''
  }
}

const markNotificationReferencesAsRead = async ({ accountId, references = [] }) => {
  if (!accountId) {
    return
  }

  const now = new Date()
  const updateSet = {}

  for (const reference of references) {
    if (!reference) continue
    const category = getNotificationCategory(reference.category, '')
    const entityId = String(reference.entityId || '').trim()
    const organizationId = String(reference.organizationId || '').trim()
    if (!category || !entityId) continue

    const readPath = NOTIFICATION_READ_PATHS[category]
    if (readPath) {
      updateSet[`${readPath}.${entityId}`] = now
    }

    const viewPath = DASHBOARD_NOTIFICATION_VIEW_PATHS[category]
    if (viewPath && organizationId) {
      updateSet[`${viewPath}.${organizationId}`] = now
    }
  }

  if (Object.keys(updateSet).length === 0) {
    return
  }

  await Account.updateOne(
    { _id: accountId },
    { $set: updateSet }
  )
}

const markDashboardNotificationViewed = async ({ accountId, type, organizationIds }) => {
  const basePath = DASHBOARD_NOTIFICATION_VIEW_PATHS[type]
  if (!basePath || !accountId) {
    return
  }

  const normalizedOrgIds = Array.from(new Set(
    (Array.isArray(organizationIds) ? organizationIds : [])
      .map(value => String(value || '').trim())
      .filter(Boolean)
  ))

  if (normalizedOrgIds.length === 0) {
    return
  }

  const now = new Date()
  const updateSet = {}
  for (const orgId of normalizedOrgIds) {
    updateSet[`${basePath}.${orgId}`] = now
  }

  await Account.updateOne(
    { _id: accountId },
    { $set: updateSet }
  )
}

const NOTIFICATION_CATEGORY = Object.freeze({
  all: 'all',
  documents: 'documents',
  simplePerformance: 'simplePerformance'
})

const getNotificationCategory = (value, fallback = NOTIFICATION_CATEGORY.all) => {
  const raw = String(value || '').trim().toLowerCase()
  if (raw === NOTIFICATION_CATEGORY.documents) return NOTIFICATION_CATEGORY.documents
  if (raw === NOTIFICATION_CATEGORY.simplePerformance || raw === 'performance') {
    return NOTIFICATION_CATEGORY.simplePerformance
  }
  if (raw === NOTIFICATION_CATEGORY.all) return NOTIFICATION_CATEGORY.all
  return fallback
}

const buildNotificationActionUrl = ({
  type,
  organizationId,
  assignmentId,
  workflowType,
  evaluationId,
  itemId,
  action
}) => {
  const params = new URLSearchParams()
  params.set('type', type)
  if (organizationId) params.set('org', String(organizationId))
  if (assignmentId) params.set('assignment', String(assignmentId))
  if (evaluationId) params.set('evaluation', String(evaluationId))
  if (itemId) params.set('item', String(itemId))
  if (action) params.set('action', String(action))
  if (workflowType && WORKFLOW_TYPES.includes(String(workflowType))) {
    params.set('workflow', String(workflowType))
  }
  return `/notifications/open?${params.toString()}`
}

const buildNotificationCenterData = async (account, options = {}) => {
  if (!account?._id) {
    return {
      totalUnread: 0,
      counts: {
        documents: 0,
        simplePerformance: 0
      },
      tasks: [],
      pendingSignatureCount: 0,
      pendingSignatureDocuments: [],
      unreadDocumentAssignments: [],
      unreadPerformanceEvaluations: []
    }
  }

  const maxTasks = Number.isFinite(Number(options.maxTasks))
    ? Math.max(1, Math.min(200, Number(options.maxTasks)))
    : 50
  const includeAllTasks = options.includeAllTasks === true
  const performanceQueryLimit = Math.max(80, maxTasks * 4)

  const currentOrgId = account.currentOrganization?._id?.toString() || account.currentOrganization?.toString() || ''
  const organizationIds = getOrganizationIdsFromAccount(account)
  if (currentOrgId && !organizationIds.includes(currentOrgId)) {
    organizationIds.push(currentOrgId)
  }

  const organizationNameById = new Map()
  if (organizationIds.length > 0) {
    const organizations = await Organization.find({ _id: { $in: organizationIds } })
      .select('name')
      .lean()
    organizations.forEach(org => {
      organizationNameById.set(org._id.toString(), org.name || 'Organization')
    })
  }

  const pendingOnboardingAssignments = await OnboardingAssignment.find({
    $or: buildOnboardingParticipantMatchClauses(account._id),
    status: { $nin: ['completed', 'cancelled'] }
  })
    .select([
      'organization',
      'member',
      'workflowType',
      'status',
      'dueAt',
      'completedAt',
      'createdAt',
      'updatedAt',
      'items._id',
      'items.type',
      'items.title',
      'items.description',
      'items.status',
      'items.config.document',
      'items.config.signers',
      'items.config.signatureFields',
      'items.data.esign.status',
      'items.data.esign.signedAt',
      'items.data.esign.signedUrl',
      'items.data.esign.signedFileName',
      'items.data.esign.signers'
    ].join(' '))
    .populate('organization', 'name')
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean()

  const pendingSignatureDocuments = buildProfileDocumentEntries(pendingOnboardingAssignments, account)
    .filter(document => document.requiresSignature)

  const pendingSignatureDocumentsByAssignmentId = new Map()
  pendingSignatureDocuments.forEach(document => {
    const assignmentId = String(document?.assignmentId || '').trim()
    if (!assignmentId) return

    const documentsForAssignment = pendingSignatureDocumentsByAssignmentId.get(assignmentId) || []
    documentsForAssignment.push(document)
    pendingSignatureDocumentsByAssignmentId.set(assignmentId, documentsForAssignment)
  })

  // Documents notifications represent pending work until explicitly read.
  // A pending assignment reappears if it is updated after it was marked as read.
  const unreadDocumentAssignments = pendingOnboardingAssignments.filter(assignment => {
    const assignmentId = assignment?._id?.toString()
    if (!assignmentId) return true

    const signatureDocuments = pendingSignatureDocumentsByAssignmentId.get(assignmentId) || []
    if (signatureDocuments.length > 0) {
      return true
    }

    const assignmentOrganizationId =
      assignment?.organization?._id?.toString() ||
      assignment?.organization?.toString() ||
      ''
    const referenceTimestamp = assignment?.updatedAt || assignment?.createdAt
      ? new Date(assignment.updatedAt || assignment.createdAt).getTime()
      : 0

    const entityReadAt = getNotificationEntityReadAt(
      account,
      NOTIFICATION_CATEGORY.documents,
      assignmentId
    )
    if (entityReadAt && (!referenceTimestamp || entityReadAt.getTime() >= referenceTimestamp)) {
      return false
    }

    // Backward compatibility: respect older category-level viewed checkpoints.
    const categoryViewedAt = getDashboardNotificationViewedAt(
      account,
      NOTIFICATION_CATEGORY.documents,
      assignmentOrganizationId
    )
    if (categoryViewedAt && referenceTimestamp && categoryViewedAt.getTime() >= referenceTimestamp) {
      return false
    }

    return true
  })

  const unreadPerformanceEvaluations = organizationIds.length === 0
      ? []
    : (await PerformanceEvaluation.find({
        organization: { $in: organizationIds },
        evaluatedMember: account._id
      })
        .select('organization evaluationDate createdAt evaluatorName evaluatorEmail ratings')
        .sort({ evaluationDate: -1, createdAt: -1 })
        .limit(performanceQueryLimit)
        .lean())
      .filter(evaluation => {
        const evaluationId = evaluation?._id?.toString()
        const evaluationTimestamp = evaluation?.createdAt || evaluation?.evaluationDate
        const evaluationTime = evaluationTimestamp ? new Date(evaluationTimestamp).getTime() : 0
        if (evaluationId) {
          const entityReadAt = getNotificationEntityReadAt(
            account,
            NOTIFICATION_CATEGORY.simplePerformance,
            evaluationId
          )
          if (entityReadAt && (!evaluationTime || entityReadAt.getTime() >= evaluationTime)) {
            return false
          }
        }

        const evaluationOrganizationId =
          evaluation?.organization?._id?.toString() ||
          evaluation?.organization?.toString() ||
          ''
        if (!evaluationOrganizationId) return true

        const lastViewedAt = getDashboardNotificationViewedAt(
          account,
          NOTIFICATION_CATEGORY.simplePerformance,
          evaluationOrganizationId
        )
        if (!lastViewedAt) return true

        if (!evaluationTimestamp) return true

        return new Date(evaluationTimestamp).getTime() > lastViewedAt.getTime()
      })
      .map(entry => ({
        ...entry,
        averageRating: calculateAverageRating(entry.ratings)
      }))

  const documentTasks = unreadDocumentAssignments.map(assignment => {
    const organizationId =
      assignment?.organization?._id?.toString() ||
      assignment?.organization?.toString() ||
      currentOrgId
    const workflowType = normalizeWorkflowType(assignment.workflowType, { allowAll: false, fallback: 'onboarding' })
    const workflowLabel = WORKFLOW_LABELS[workflowType] || WORKFLOW_LABELS.onboarding
    const createdAt = assignment.updatedAt || assignment.createdAt || new Date()
    const assignmentId = assignment?._id?.toString?.() || ''
    const signatureDocuments = pendingSignatureDocumentsByAssignmentId.get(assignmentId) || []
    const pendingSignatureCount = signatureDocuments.length
    const primarySignatureDocument = signatureDocuments[0] || null
    const organizationName = assignment?.organization?.name || organizationNameById.get(organizationId) || 'your organization'

    return {
      id: `documents:${assignment._id}`,
      category: NOTIFICATION_CATEGORY.documents,
      title: pendingSignatureCount === 1
        ? 'Document signature pending'
        : (pendingSignatureCount > 1 ? `${pendingSignatureCount} documents pending signature` : `${workflowLabel} task pending`),
      message: pendingSignatureCount === 1
        ? `${primarySignatureDocument?.title || 'A document'} is waiting for your signature for ${organizationName}.`
        : (pendingSignatureCount > 1
            ? `${pendingSignatureCount} documents are waiting for your signature in ${workflowLabel.toLowerCase()} for ${organizationName}.`
            : `Complete your ${workflowLabel.toLowerCase()} step for ${organizationName}.`),
      organizationId,
      organizationName: assignment?.organization?.name || organizationNameById.get(organizationId) || 'Organization',
      createdAt,
      actionLabel: pendingSignatureCount > 0 ? 'Review & Sign' : 'Open task',
      actionUrl: buildNotificationActionUrl(
        pendingSignatureCount > 0
          ? {
              type: NOTIFICATION_CATEGORY.documents,
              organizationId,
              assignmentId: assignment._id,
              workflowType,
              itemId: primarySignatureDocument?.itemId,
              action: 'sign'
            }
          : {
              type: NOTIFICATION_CATEGORY.documents,
              organizationId,
              assignmentId: assignment._id,
              workflowType
            }
      ),
      pendingSignatureCount,
      workflowType
    }
  })

  const performanceTasks = unreadPerformanceEvaluations.map(evaluation => {
    const organizationId =
      evaluation?.organization?._id?.toString() ||
      evaluation?.organization?.toString() ||
      currentOrgId
    const createdAt = evaluation.createdAt || evaluation.evaluationDate || new Date()
    const evaluatorLabel = evaluation.evaluatorName || evaluation.evaluatorEmail || 'Your manager'
    const dateLabel = new Date(evaluation.evaluationDate || createdAt).toLocaleDateString()

    return {
      id: `simplePerformance:${evaluation._id}`,
      category: NOTIFICATION_CATEGORY.simplePerformance,
      title: 'New simple evaluation available',
      message: `${evaluatorLabel} submitted feedback on ${dateLabel}.`,
      organizationId,
      organizationName: organizationNameById.get(organizationId) || 'Organization',
      createdAt,
      actionLabel: 'Review evaluation',
      actionUrl: buildNotificationActionUrl({
        type: NOTIFICATION_CATEGORY.simplePerformance,
        organizationId,
        evaluationId: evaluation._id
      }),
      averageRating: evaluation.averageRating
    }
  })

  const sortedTasks = [...documentTasks, ...performanceTasks]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  const tasks = includeAllTasks
    ? sortedTasks
    : sortedTasks.slice(0, maxTasks)

  return {
    totalUnread: documentTasks.length + performanceTasks.length,
    counts: {
      documents: documentTasks.length,
      simplePerformance: performanceTasks.length
    },
    tasks,
    pendingSignatureCount: pendingSignatureDocuments.length,
    pendingSignatureDocuments,
    unreadDocumentAssignments,
    unreadPerformanceEvaluations
  }
}

const getQueryStringValue = (value) => {
  if (typeof value === 'string') {
    return value
  }
  if (Array.isArray(value) && value.length > 0) {
    return String(value[0])
  }
  return ''
}

const parseIsoDateFilterValue = (value) => {
  const normalized = String(value || '').trim()
  if (!normalized) {
    return null
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return null
  }

  const [year, month, day] = normalized.split('-').map(part => Number.parseInt(part, 10))
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null
  }

  const start = new Date(Date.UTC(year, month - 1, day))
  if (
    start.getUTCFullYear() !== year ||
    start.getUTCMonth() !== month - 1 ||
    start.getUTCDate() !== day
  ) {
    return null
  }

  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 1)

  return {
    normalized,
    start,
    end
  }
}

const parseIsoMonthFilterValue = (value) => {
  const normalized = String(value || '').trim()
  if (!normalized) {
    return null
  }
  if (!/^\d{4}-\d{2}$/.test(normalized)) {
    return null
  }

  const [year, month] = normalized.split('-').map(part => Number.parseInt(part, 10))
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return null
  }

  const start = new Date(Date.UTC(year, month - 1, 1))
  const end = new Date(Date.UTC(year, month, 1))

  return {
    normalized,
    start,
    end
  }
}

const escapeEmailHtml = (value) => (
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
)

const getIdentityBaseUrl = () => (
  String(process.env.ISSUER_URL || 'http://localhost:4000')
    .trim()
    .replace(/\/+$/, '')
)

const sendReviewedMemberEvaluationNotification = async ({
  reviewedMemberEmail,
  reviewedMemberName,
  evaluatorName,
  organizationName,
  evaluationDate
}) => {
  if (!reviewedMemberEmail) return

  const reviewUrl = `${getIdentityBaseUrl()}/notifications?category=${encodeURIComponent(NOTIFICATION_CATEGORY.simplePerformance)}`
  const safeEvaluatorName = escapeEmailHtml(evaluatorName || 'Your manager')
  const safeOrganizationName = escapeEmailHtml(organizationName || 'your organization')
  const subjectName = String(reviewedMemberName || reviewedMemberEmail || 'you').trim()
  const formattedDate = new Date(evaluationDate || new Date()).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })

  const subject = `New simple evaluation for ${subjectName}`
  const html = `
    <p>A new <strong>Simple Evaluation</strong> has been submitted for you in <strong>${safeOrganizationName}</strong>.</p>
    <p><strong>Evaluator:</strong> ${safeEvaluatorName}<br><strong>Date:</strong> ${formattedDate}</p>
    <p><a href="${reviewUrl}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;">Open notifications</a></p>
    <p style="margin-top:14px;color:#64748b;font-size:13px;">Open Notifications in your dashboard to review this task and any other pending items.</p>
  `
  const text = [
    'A new Simple Evaluation has been submitted for you.',
    `Organization: ${organizationName || 'Your organization'}`,
    `Evaluator: ${evaluatorName || 'Your manager'}`,
    `Date: ${formattedDate}`,
    '',
    `Open notifications: ${reviewUrl}`
  ].join('\n')

  await emailService.sendNotificationEmail({
    to: reviewedMemberEmail,
    toName: reviewedMemberName,
    subject,
    html,
    text
  })
}

const redirectToPerformanceEvaluations = (res, query = {}) => {
  const params = new URLSearchParams()

  Object.entries(query).forEach(([key, rawValue]) => {
    if (rawValue === undefined || rawValue === null) return
    const normalized = String(rawValue).trim()
    if (!normalized) return
    params.set(key, normalized)
  })

  const queryString = params.toString()
  const location = queryString
    ? `/performance-evaluations?${queryString}`
    : '/performance-evaluations'

  return res.redirect(location)
}

const SIMPLE_PERFORMANCE_FIELD_MANAGER_ROLES = ['owner', 'admin', 'hr_manager']

const buildDefaultSimplePerformanceFields = () => (
  SIMPLE_PERFORMANCE_DEFAULT_FIELDS.map(field => ({
    key: field.key,
    label: field.label
  }))
)

const normalizeSimplePerformanceFields = (fields = []) => {
  const normalized = []
  const existingKeys = new Set()

  for (const field of fields) {
    const label = normalizeSimplePerformanceFieldLabel(field?.label || field)
    if (!label) continue

    let key = String(field?.key || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48)

    if (!key || existingKeys.has(key)) {
      key = buildSimplePerformanceFieldKey(label, existingKeys)
    }

    existingKeys.add(key)
    normalized.push({
      key,
      label
    })
  }

  return normalized
}

const getComparableSimplePerformanceFields = (fields = []) => (
  fields.map(field => ({
    key: String(field?.key || ''),
    label: String(field?.label || '')
  }))
)

const ensureSimplePerformanceFieldConfig = async (organizationId, user = null) => {
  let config = await SimplePerformanceEvaluationConfig.findOne({ organization: organizationId })

  if (!config) {
    config = await SimplePerformanceEvaluationConfig.create({
      organization: organizationId,
      fields: buildDefaultSimplePerformanceFields(),
      updatedBy: user?._id || undefined,
      updatedByName: user?.profile?.name || user?.email || undefined
    })
    return config
  }

  const normalizedFields = normalizeSimplePerformanceFields(config.fields)
  const fallbackFields = normalizedFields.length > 0
    ? normalizedFields
    : buildDefaultSimplePerformanceFields()

  const beforeFields = JSON.stringify(getComparableSimplePerformanceFields(config.fields))
  const afterFields = JSON.stringify(getComparableSimplePerformanceFields(fallbackFields))
  if (beforeFields !== afterFields) {
    config.fields = fallbackFields
    config.updatedBy = user?._id || config.updatedBy
    config.updatedByName = user?.profile?.name || user?.email || config.updatedByName
    await config.save()
  }

  return config
}

const canManageSimplePerformanceFields = ({ memberRole, canEvaluate }) => (
  Boolean(canEvaluate) || SIMPLE_PERFORMANCE_FIELD_MANAGER_ROLES.includes(memberRole)
)

const normalizeEvaluationRatingsForHistory = (ratings = []) => {
  if (Array.isArray(ratings)) {
    return ratings
      .filter(entry => entry && entry.fieldKey && entry.fieldLabel)
      .map(entry => ({
        fieldKey: String(entry.fieldKey),
        fieldLabel: String(entry.fieldLabel),
        value: Number(entry.value)
      }))
  }

  if (ratings && typeof ratings === 'object') {
    return Object.entries(ratings)
      .filter(([, value]) => Number.isFinite(Number(value)))
      .map(([fieldKey, value]) => ({
        fieldKey: String(fieldKey),
        fieldLabel: String(fieldKey),
        value: Number(value)
      }))
  }

  return []
}

const parsePerformanceRating = (value) => {
  const parsed = Number.parseInt(String(value || ''), 10)
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 5) {
    return null
  }
  return parsed
}

const buildTeamHierarchyMaps = (teams = []) => {
  const teamById = new Map()
  const childrenByParent = new Map()

  for (const team of teams) {
    const teamId = String(team?._id || '').trim()
    if (!teamId) continue
    teamById.set(teamId, team)
  }

  for (const team of teams) {
    const teamId = String(team?._id || '').trim()
    if (!teamId) continue
    const parentId = String(team?.parentTeam || '').trim()
    if (!parentId) continue
    if (!childrenByParent.has(parentId)) {
      childrenByParent.set(parentId, [])
    }
    childrenByParent.get(parentId).push(teamId)
  }

  return { teamById, childrenByParent }
}

const collectTeamAndDescendantIds = (rootTeamId, childrenByParent) => {
  const rootId = String(rootTeamId || '').trim()
  if (!rootId) return new Set()

  const collected = new Set()
  const stack = [rootId]
  while (stack.length > 0) {
    const teamId = stack.pop()
    if (!teamId || collected.has(teamId)) continue
    collected.add(teamId)
    const children = childrenByParent.get(teamId) || []
    for (const childId of children) {
      if (!collected.has(childId)) {
        stack.push(childId)
      }
    }
  }

  return collected
}

const resolveTeamPath = (teamId, teamById) => {
  const rootId = String(teamId || '').trim()
  if (!rootId) return []

  const path = []
  const seen = new Set()
  let cursor = rootId
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor)
    const team = teamById.get(cursor)
    if (!team) break
    path.unshift(team.name || 'Team')
    cursor = String(team.parentTeam || '').trim()
  }
  return path
}

const updateOnboardingAssignmentStatus = (assignment) => {
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

const ONBOARDING_MANAGER_ROLES = ['owner', 'admin', 'hr_manager']
const WORKFLOW_TYPES = ['onboarding', 'agreement', 'policy', 'general']
const WORKFLOW_LABELS = {
  onboarding: 'Onboarding',
  agreement: 'Agreement Signing',
  policy: 'Policy Acknowledgement',
  general: 'General Document Workflow'
}

const normalizeWorkflowType = (value, options = {}) => {
  const allowAll = options.allowAll === true
  const fallback = options.fallback || 'onboarding'
  const raw = String(value || '').trim().toLowerCase()

  if (allowAll && raw === 'all') {
    return 'all'
  }

  return WORKFLOW_TYPES.includes(raw) ? raw : fallback
}

const withWorkflowType = (entry) => {
  if (!entry) return entry
  const current = typeof entry.toObject === 'function' ? entry.toObject() : entry
  return {
    ...current,
    workflowType: normalizeWorkflowType(current.workflowType, { fallback: 'onboarding' })
  }
}

const buildWorkflowSummary = ({ templates = [], assignments = [] } = {}) => {
  const summary = {}
  WORKFLOW_TYPES.forEach(type => {
    summary[type] = {
      type,
      label: WORKFLOW_LABELS[type],
      templates: 0,
      assignments: 0,
      active: 0,
      completed: 0
    }
  })

  templates.forEach(template => {
    const type = normalizeWorkflowType(template.workflowType)
    summary[type].templates += 1
  })

  assignments.forEach(assignment => {
    const type = normalizeWorkflowType(assignment.workflowType)
    summary[type].assignments += 1
    if (assignment.status === 'completed') {
      summary[type].completed += 1
    } else if (assignment.status !== 'cancelled') {
      summary[type].active += 1
    }
  })

  return summary
}

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

const buildPersonalOnboardingQuery = (userId, organizationId, options = {}) => {
  const workflowType = normalizeWorkflowType(options.workflowType, {
    allowAll: true,
    fallback: 'all'
  })
  const base = {
    $or: buildOnboardingParticipantMatchClauses(userId)
  }

  if (organizationId) {
    base.organization = organizationId
  }
  if (workflowType !== 'all') {
    base.workflowType = workflowType
  }

  return base
}

const getPersonalOnboardingAssignments = async (userId, organizationId, options = {}) => {
  const assignments = await OnboardingAssignment.find(buildPersonalOnboardingQuery(userId, organizationId, options))
    .populate('organization', 'name')
    .sort({ createdAt: -1 })

  return assignments.map(withWorkflowType)
}

const loadOnboardingAdminContext = async (req, organizationId, options = {}) => {
  const workflowTypeFilter = normalizeWorkflowType(options.workflowType, {
    allowAll: true,
    fallback: 'all'
  })
  const organization = await Organization.findById(organizationId)
    .populate('members.account', 'email profile.name')

  if (!organization) {
    throw new Error('Organization not found')
  }

  const member = organization.members.find(
    m => (m.account?._id || m.account).toString() === req.user._id.toString() && m.status === 'active'
  )

  if (!member || !ONBOARDING_MANAGER_ROLES.includes(member.role)) {
    throw new Error('Admin, owner, or HR manager role required')
  }

  const templateQuery = { organization: organizationId }
  const assignmentQuery = { organization: organizationId }
  if (workflowTypeFilter !== 'all') {
    templateQuery.workflowType = workflowTypeFilter
    assignmentQuery.workflowType = workflowTypeFilter
  }

  const [rawTemplates, rawAssignments] = await Promise.all([
    OnboardingTemplate.find(templateQuery).sort({ createdAt: -1 }),
    OnboardingAssignment.find(assignmentQuery)
      .populate('member', 'email profile.name')
      .populate('createdBy', 'email profile.name')
      .populate('template', 'name')
      .sort({ createdAt: -1 })
  ])
  const templates = rawTemplates.map(withWorkflowType)
  const assignments = rawAssignments.map(withWorkflowType)
  const workflowSummary = buildWorkflowSummary({ templates, assignments })
  const assignmentIds = assignments.map(assignment => assignment._id).filter(Boolean)
  const onboardingActivities = assignmentIds.length
    ? await OnboardingActivity.find({
      organization: organizationId,
      assignment: { $in: assignmentIds }
    })
      .populate('member', 'email profile.name')
      .populate('actor', 'email profile.name')
      .sort({ createdAt: -1 })
      .limit(40)
    : []

  const members = organization.members
    .filter(m => m.status === 'active')
    .map(m => ({
      id: m.account?._id || m.account,
      name: m.account?.profile?.name || m.account?.email?.split('@')[0] || 'Unknown',
      email: m.account?.email || '',
      role: m.role
    }))

  const onboardingStateByMember = buildOnboardingStateMap({
    members: organization.members.filter(m => m.status === 'active'),
    assignments,
    workflowType: 'onboarding'
  })

  const statusSortOrder = {
    in_progress: 1,
    pending: 2,
    not_started: 3,
    completed: 4,
    cancelled: 5
  }

  const memberOnboardingRows = members
    .map(m => {
      const memberId = m.id?.toString ? m.id.toString() : String(m.id || '')
      const onboardingState = getMemberOnboardingState(memberId, onboardingStateByMember)
      const latestAssignment = onboardingState.latestAssignment || null
      const onboardingStatus = onboardingState.status || 'not_started'

      return {
        ...m,
        onboardingStatus,
        onboardingStatusSource: onboardingState.source,
        latestAssignment: latestAssignment
          ? {
              id: latestAssignment._id,
              status: latestAssignment.status,
              createdAt: latestAssignment.createdAt,
              dueAt: latestAssignment.dueAt,
              completedAt: latestAssignment.completedAt,
              templateName: latestAssignment.template?.name || null
            }
          : null
      }
    })
    .sort((a, b) => {
      const aOrder = statusSortOrder[a.onboardingStatus] || 999
      const bOrder = statusSortOrder[b.onboardingStatus] || 999
      if (aOrder !== bOrder) return aOrder - bOrder
      return String(a.name || '').localeCompare(String(b.name || ''))
    })

  const memberOnboardingSummary = memberOnboardingRows.reduce((acc, row) => {
    const status = row.onboardingStatus || 'not_started'
    if (status === 'completed') acc.completedMembers += 1
    else if (status === 'in_progress') acc.inProgressMembers += 1
    else if (status === 'pending') acc.pendingMembers += 1
    else if (status === 'cancelled') acc.cancelledMembers += 1
    else acc.notStartedMembers += 1
    return acc
  }, {
    totalMembers: memberOnboardingRows.length,
    completedMembers: 0,
    inProgressMembers: 0,
    pendingMembers: 0,
    notStartedMembers: 0,
    cancelledMembers: 0,
    assignedMembers: 0,
    completionRate: 0
  })

  memberOnboardingSummary.assignedMembers = memberOnboardingSummary.totalMembers - memberOnboardingSummary.notStartedMembers
  memberOnboardingSummary.completionRate = memberOnboardingSummary.totalMembers > 0
    ? Math.round((memberOnboardingSummary.completedMembers / memberOnboardingSummary.totalMembers) * 100)
    : 0

  return {
    organization,
    templates,
    assignments,
    onboardingActivities,
    members,
    onboardingStatusByMember: Object.fromEntries(
      Array.from(onboardingStateByMember.entries()).map(([memberId, state]) => [memberId, state.status])
    ),
    memberOnboardingRows,
    memberOnboardingSummary,
    workflowSummary,
    workflowLabels: WORKFLOW_LABELS,
    workflowTypes: WORKFLOW_TYPES,
    workflowTypeFilter,
    yourRole: member.role
  }
}

// API Routes (JSON responses)
app.use('/api/organizations', organizationsRouter)
app.use('/api/organizations', invitationsRouter) // Mount for /api/organizations/:orgId/invitations routes
app.use('/api/invitations', invitationsRouter) // Mount for /api/invitations/:invitationId routes (delete, resend, accept, reject, pending)
app.use('/api/organizations', membersRouter)
app.use('/api/organizations', notificationsRouter) // Notification routes for /api/organizations/:orgId/notifications
app.use('/api', onboardingRouter)

// Subscription Management API Routes
app.use('/api/admin', adminCampaignApiRouter)
app.use('/api/admin/plans', adminPlansRouter)
app.use('/api/admin/subscription-requests', adminSubscriptionRequestsRouter)
app.use('/api/admin/subscriptions', adminSubscriptionsRouter)
app.use('/api/admin/users', adminUsersRouter)
app.use('/api/plans', publicPlansRouter)
app.use('/api/organizations', organizationSubscriptionRouter)
app.use('/api/public', publicMarketingRoutesRouter)
app.use('/', publicRoutesRouter)

// Admin Login Routes (must come before admin views router)
app.get('/admin/login', (req, res) => {
  const errorMessages = {
    auth_required: 'Authentication required. Please login.',
    account_not_found: 'Account not found or does not have admin privileges.',
    invalid_password: 'Invalid password. Please try again.',
    login_failed: 'Login failed. Please try again.',
    admin_access_required: 'Admin access required. You must be a system or super admin.'
  }

  const errorMsg = req.query.error ? errorMessages[req.query.error] || 'An error occurred' : ''
  const message = req.query.message || ''

  res.render('admin/login', { error: errorMsg, message })
})

app.post('/admin/login', async (req, res) => {
  try {
    const { email, password, remember, redirect } = req.body

    // Find account by email
    const account = await Account.findOne({ email: email.toLowerCase() })

    if (!account) {
      return res.redirect('/admin/login?error=account_not_found')
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, account.passwordHash)
    if (!validPassword) {
      return res.redirect('/admin/login?error=invalid_password')
    }

    // Check admin access
    if (!account.hasAdminAccess()) {
      console.warn(`Non-admin login attempt: ${email}`)
      return res.redirect('/admin/login?error=admin_access_required')
    }

    console.log(`✅ Admin login successful: ${email} (${account.isSuperAdmin ? 'Super Admin' : 'System Admin'})`)

    // Set session
    req.session.accountId = account.sub

    // Redirect to requested page or admin dashboard
    if (redirect && redirect.startsWith('/admin')) {
      res.redirect(redirect)
    } else {
      res.redirect('/admin')
    }
  } catch (error) {
    console.error('Admin login error:', error)
    res.redirect('/admin/login?error=login_failed')
  }
})

app.get('/admin/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Error destroying session:', err)
      return next(err)
    }

    // Clear session cookie
    res.clearCookie('_session')

    console.log('✅ Admin logged out')
    res.redirect('/admin/login?message=You have been logged out')
  })
})

// Admin Panel View Routes
app.use('/admin/campaigns', adminCampaignViewsRouter)
app.use('/admin', adminViewsRouter)

// SAML 2.0 Identity Provider Routes
app.use('/saml', samlRoutes)

// Profile API Routes - MUST come BEFORE teams router to avoid route conflicts
/**
 * Get current user profile
 * GET /api/profile
 */
app.get('/api/profile', getSessionUser, async (req, res) => {
  try {
    res.json({
      sub: req.user.sub,
      email: req.user.email,
      emailVerified: req.user.emailVerified,
      profile: {
        name: req.user.profile?.name || null,
        preferred_username: req.user.profile?.preferred_username || null
      },
      createdAt: req.user.createdAt
    })
  } catch (error) {
    console.error('Get profile error:', error)
    res.status(500).json({ error: 'Failed to get profile' })
  }
})

/**
 * Update user profile
 * PUT /api/profile
 */
app.put('/api/profile', getSessionUser, async (req, res) => {
  try {
    const { name, preferredUsername } = req.body

    // Validate name
    if (name !== undefined) {
      if (typeof name !== 'string') {
        return res.status(400).json({ error: 'Name must be a string' })
      }
      if (name.trim().length === 0) {
        return res.status(400).json({ error: 'Name cannot be empty' })
      }
      if (name.length > 100) {
        return res.status(400).json({ error: 'Name must be 100 characters or less' })
      }
    }

    // Validate preferred username if provided
    if (preferredUsername !== undefined && preferredUsername !== null) {
      if (typeof preferredUsername !== 'string') {
        return res.status(400).json({ error: 'Preferred username must be a string' })
      }
      if (preferredUsername.length > 50) {
        return res.status(400).json({ error: 'Preferred username must be 50 characters or less' })
      }
    }

    // Update profile
    const updates = {}
    if (name !== undefined) {
      updates['profile.name'] = name.trim()
    }
    if (preferredUsername !== undefined) {
      updates['profile.preferred_username'] = preferredUsername ? preferredUsername.trim() : null
    }

    const updatedAccount = await Account.findByIdAndUpdate(
      req.user._id,
      { $set: updates },
      { new: true }
    )

    console.log('✅ Profile updated for:', req.user.email)

    res.json({
      message: 'Profile updated successfully',
      profile: {
        name: updatedAccount.profile?.name || null,
        preferred_username: updatedAccount.profile?.preferred_username || null
      }
    })
  } catch (error) {
    console.error('Update profile error:', error)
    res.status(500).json({ error: 'Failed to update profile' })
  }
})

// Teams router - comes AFTER profile routes
app.use('/api/teams', teamsRouter)
app.use('/api', teamsRouter)

// UI Routes (HTML pages)

app.get('/api/notifications/summary', getSessionUser, async (req, res) => {
  try {
    const summary = await buildNotificationCenterData(req.user, { maxTasks: 6 })
    return res.json({
      success: true,
      totalUnread: summary.totalUnread,
      counts: summary.counts,
      pendingSignatureCount: summary.pendingSignatureCount || 0,
      tasks: summary.tasks
    })
  } catch (error) {
    console.error('Notification summary API error:', error)
    return res.status(500).json({ success: false, error: 'Failed to load notification summary' })
  }
})

app.post('/api/notifications/read', getSessionUser, async (req, res) => {
  try {
    const taskId = String(req.body?.taskId || '').trim()
    const categoryFromBody = getNotificationCategory(req.body?.category, '')
    const organizationId = String(req.body?.organizationId || '').trim()

    let reference = null
    if (taskId) {
      reference = getNotificationReferenceFromTask({
        id: taskId,
        organizationId
      })
    }

    if (!reference) {
      const category = categoryFromBody
      const assignmentId = String(req.body?.assignmentId || '').trim()
      const evaluationId = String(req.body?.evaluationId || '').trim()
      const entityId = category === NOTIFICATION_CATEGORY.documents
        ? assignmentId
        : (category === NOTIFICATION_CATEGORY.simplePerformance ? evaluationId : '')

      if (category && entityId) {
        reference = {
          category,
          entityId,
          organizationId
        }
      }
    }

    if (!reference) {
      return res.status(400).json({ success: false, error: 'Notification reference is required' })
    }

    if (reference.organizationId) {
      const orgIds = getOrganizationIdsFromAccount(req.user)
      if (!orgIds.includes(reference.organizationId)) {
        return res.status(403).json({ success: false, error: 'You are not allowed to modify this notification' })
      }
    }

    await markNotificationReferencesAsRead({
      accountId: req.user._id,
      references: [reference]
    })

    const updatedAccount = await Account.findById(req.user._id)
      .populate('organizations.organization', 'name')
      .populate('currentOrganization', 'name')
    const summary = await buildNotificationCenterData(updatedAccount, { maxTasks: 6 })

    return res.json({
      success: true,
      totalUnread: summary.totalUnread,
      counts: summary.counts,
      pendingSignatureCount: summary.pendingSignatureCount || 0
    })
  } catch (error) {
    console.error('Mark notification read API error:', error)
    return res.status(500).json({ success: false, error: 'Failed to mark notification as read' })
  }
})

app.post('/api/notifications/read-all', getSessionUser, async (req, res) => {
  try {
    const selectedCategory = getNotificationCategory(req.body?.category, NOTIFICATION_CATEGORY.all)
    const summary = await buildNotificationCenterData(req.user, {
      maxTasks: 250,
      includeAllTasks: true
    })

    const scopedTasks = selectedCategory === NOTIFICATION_CATEGORY.all
      ? summary.tasks
      : summary.tasks.filter(task => task.category === selectedCategory)
    const references = scopedTasks
      .map(task => getNotificationReferenceFromTask(task))
      .filter(Boolean)

    await markNotificationReferencesAsRead({
      accountId: req.user._id,
      references
    })

    const updatedAccount = await Account.findById(req.user._id)
      .populate('organizations.organization', 'name')
      .populate('currentOrganization', 'name')
    const updatedSummary = await buildNotificationCenterData(updatedAccount, { maxTasks: 6 })

    return res.json({
      success: true,
      markedCount: references.length,
      totalUnread: updatedSummary.totalUnread,
      counts: updatedSummary.counts,
      pendingSignatureCount: updatedSummary.pendingSignatureCount || 0
    })
  } catch (error) {
    console.error('Mark all notifications read API error:', error)
    return res.status(500).json({ success: false, error: 'Failed to mark notifications as read' })
  }
})

app.get('/notifications', getSessionUser, async (req, res) => {
  try {
    const summary = await buildNotificationCenterData(req.user, { maxTasks: 120, includeAllTasks: true })
    const selectedCategory = getNotificationCategory(req.query.category, NOTIFICATION_CATEGORY.all)
    const tasks = selectedCategory === NOTIFICATION_CATEGORY.all
      ? summary.tasks
      : summary.tasks.filter(task => task.category === selectedCategory)

    res.render('notifications-center', {
      user: req.user,
      activePage: 'notifications',
      notificationSummary: summary,
      selectedCategory,
      tasks,
      error: req.query.error,
      success: req.query.success
    })
  } catch (error) {
    console.error('Notification center page error:', error)
    res.redirect('/?error=Failed to load notifications')
  }
})

app.get('/notifications/open', getSessionUser, async (req, res) => {
  try {
    const type = getNotificationCategory(req.query.type, '')
    if (!type || type === NOTIFICATION_CATEGORY.all) {
      return res.redirect('/notifications?error=Notification target is invalid')
    }

    const organizationId = String(req.query.org || '').trim()
    const activeMembership = (req.user.organizations || []).find(membership => {
      if (membership?.isActive === false) return false
      const memberOrgId =
        membership?.organization?._id?.toString() ||
        membership?.organization?.toString() ||
        ''
      return organizationId && memberOrgId === organizationId
    })

    if (organizationId && !activeMembership) {
      return res.redirect('/notifications?error=You are no longer an active member of this organization')
    }

    if (organizationId) {
      const currentOrgId = req.user.currentOrganization?._id?.toString() || req.user.currentOrganization?.toString() || ''
      if (currentOrgId !== organizationId) {
        await Account.updateOne(
          { _id: req.user._id },
          {
            $set: {
              currentOrganization: organizationId,
              updatedAt: new Date()
            }
          }
        )
        invalidateClaimsCache(req.user.sub)
      }
    }

    if (type === NOTIFICATION_CATEGORY.documents) {
      const workflow = normalizeWorkflowType(req.query.workflow, { allowAll: false, fallback: 'all' })
      const assignmentId = String(req.query.assignment || '').trim()
      const itemId = String(req.query.item || '').trim()
      const action = String(req.query.action || '').trim().toLowerCase()
      if (assignmentId && mongoose.Types.ObjectId.isValid(assignmentId)) {
        await markNotificationReferencesAsRead({
          accountId: req.user._id,
          references: [{
            category: NOTIFICATION_CATEGORY.documents,
            entityId: assignmentId,
            organizationId
          }]
        })
      }
      const params = new URLSearchParams()
      if (workflow && workflow !== 'all') params.set('workflow', workflow)
      params.set('tab', 'my')
      if (assignmentId && mongoose.Types.ObjectId.isValid(assignmentId)) {
        params.set('focusAssignment', assignmentId)
      }
      if (itemId && mongoose.Types.ObjectId.isValid(itemId)) {
        params.set('focusItem', itemId)
      }
      if (action === 'sign') {
        params.set('action', 'sign')
      }
      const query = params.toString()
      return res.redirect(query ? `/documents/my?${query}` : '/documents/my')
    }

    if (type === NOTIFICATION_CATEGORY.simplePerformance) {
      const evaluationId = String(req.query.evaluation || '').trim()
      if (evaluationId && mongoose.Types.ObjectId.isValid(evaluationId)) {
        await markNotificationReferencesAsRead({
          accountId: req.user._id,
          references: [{
            category: NOTIFICATION_CATEGORY.simplePerformance,
            entityId: evaluationId,
            organizationId
          }]
        })
      }
      return res.redirect('/performance-evaluations?view=overview&reviewed=me')
    }

    return res.redirect('/notifications')
  } catch (error) {
    console.error('Notification open redirect error:', error)
    return res.redirect('/notifications?error=Failed to open notification task')
  }
})

// Profile page
app.get('/profile', getSessionUser, async (req, res) => {
  try {
    const completion = req.profileCompletion || await getProfileCompletionForAccount(req.user, {
      organizationId: req.user?.currentOrganization?._id?.toString?.() || req.user?.currentOrganization?.toString?.() || req.session?.currentOrganization || null
    })
    const targetRoute = `${completion?.nextIncompleteStep?.route || '/profile/personal'}?wizard=1`
    res.redirect(targetRoute)
  } catch (error) {
    console.error('Profile page error:', error)
    res.redirect('/?error=Failed to load profile page')
  }
})

app.get('/organizations', getSessionUser, async (req, res) => {
  try {
    const organizations = await Organization.find({
      'members.account': req.user._id,
      'members.status': 'active'
    }).populate('owner', 'email profile.name').lean()

    const result = organizations.map(org => {
      const member = org.members.find(
        m => m.account.toString() === req.user._id.toString()
      )
      return {
        id: org._id,
        name: org.name,
        description: org.description,
        role: member?.role,
        memberCount: org.members.filter(m => m.status === 'active').length,
        isCurrentOrganization: req.user.currentOrganization?._id?.toString() === org._id.toString()
      }
    })

    // Get pending invitations count for notification badge
    const pendingInvitationsCount = await OrganizationInvite.countDocuments({
      email: req.user.email.toLowerCase(),
      status: 'pending',
      expiresAt: { $gt: new Date() }
    })

    res.render('organizations', {
      organizations: result,
      user: req.user,
      pendingInvitationsCount,
      error: req.query.error,
      success: req.query.success
    })
  } catch (error) {
    console.error('Organizations page error:', error)
    res.render('organizations', { organizations: [], user: req.user, pendingInvitationsCount: 0, error: 'Failed to load organizations' })
  }
})

app.post('/organizations/:orgId/switch', getSessionUser, async (req, res) => {
  try {
    // Update currentOrganization and updatedAt to ensure claims cache is invalidated
    await Account.updateOne(
      { _id: req.user._id },
      {
        $set: {
          currentOrganization: req.params.orgId,
          updatedAt: new Date() // Explicitly update timestamp for cache invalidation
        }
      }
    )

    // Invalidate claims cache for this user
    invalidateClaimsCache(req.user.sub)

    console.log(`🔄 User ${req.user.email} switched to organization ${req.params.orgId}`)

    // Redirect back to where the user came from (e.g. Hub or specific page)
    const referer = req.get('Referer') || '/'
    const returnUrl = new URL(referer, `http://${req.headers.host}`)
    returnUrl.searchParams.set('success', 'Switched organization')

    res.redirect(returnUrl.pathname + returnUrl.search)
  } catch (error) {
    console.error('Organization switch error:', error)
    const referer = req.get('Referer') || '/'
    const returnUrl = new URL(referer, `http://${req.headers.host}`)
    returnUrl.searchParams.set('error', 'Failed to switch organization')
    res.redirect(returnUrl.pathname + returnUrl.search)
  }
})

app.get('/organizations/:orgId/members', getSessionUser, async (req, res) => {
  try {
    const organization = await Organization.findById(req.params.orgId)
      .populate('members.account', 'email profile.name profile.preferred_username emailVerified createdAt')
      .populate('members.invitedBy', 'email profile.name')

    if (!organization) {
      return res.redirect('/organizations?error=Organization not found')
    }
    await organization.save()
    const generalDepartmentId = organization.getGeneralDepartment()?._id
    if (generalDepartmentId) {
      await Team.ensureDepartmentAssignments(req.params.orgId, generalDepartmentId)
    }

    const member = organization.members.find(
      m => m.account._id.toString() === req.user._id.toString() && m.status === 'active'
    )

    if (!member) {
      return res.redirect('/organizations?error=Not a member of this organization')
    }

    const assignments = await OnboardingAssignment.find({ organization: req.params.orgId })
      .select('member status updatedAt')
      .sort({ updatedAt: -1 })
      .lean()
    const { apps: availableApps, appIdSet, appNameById } = getHubAppMetadata()
    const teams = await Team.find({ organization: req.params.orgId })
      .populate('manager', 'email profile.name')
      .populate('members.account', 'email profile.name')
      .populate('parentTeam', 'name')
      .sort({ name: 1 })

    const orgMembers = await Account.find({
      _id: { $in: organization.members.filter(m => m.status === 'active').map(m => m.account) }
    }).select('email profile.name')

    const teamNamesByMemberId = new Map()
    const memberStructure = buildMemberStructureMap(organization, teams)
    memberStructure.forEach((value, key) => {
      teamNamesByMemberId.set(key, value.teamNames || [])
    })

    const onboardingStateByMember = buildOnboardingStateMap({
      members: organization.members.filter(m => m.status === 'active'),
      assignments,
      workflowType: 'onboarding'
    })
    const memberEntryById = new Map(
      organization.members
        .filter((m) => m.status === 'active')
        .map((m) => [((m.account?._id || m.account).toString()), m])
    )

    const mappedMembers = organization.members
      .filter(m => m.status === 'active')
      .map((m) => {
        const accountId = (m.account?._id || m.account).toString()
        const structure = getMemberStructure(memberStructure, accountId, organization)
        const onboardingState = getMemberOnboardingState(accountId, onboardingStateByMember)
        const branch = organization.getBranchById(m.branch)
        return {
          id: m.account?._id || m.account,
          name: m.account?.profile?.name || m.account?.profile?.preferred_username || m.account?.email?.split('@')[0] || 'Unknown',
          email: m.account?.email || '',
          designation: m.designation || '',
          employeeId: m.employeeId || '',
          departmentId: structure.departmentId,
          departmentName: structure.departmentName || '',
          branchId: branch?._id?.toString() || '',
          branchName: branch?.name || '',
          role: m.role,
          ...getInvitationAccessSummary(m, appNameById, appIdSet),
          teamIds: structure.teamIds || [],
          teamNames: teamNamesByMemberId.get(accountId) || [],
          joinedAt: m.joinedAt,
          isOwner: m.role === 'owner',
          onboardingStatus: onboardingState.status,
          onboardingStatusSource: onboardingState.source
        }
      })

    res.render('members', {
      organization,
      members: mappedMembers,
      availableApps,
      orgMembers: orgMembers.map(m => ({
        ...getMemberStructure(memberStructure, m._id, organization),
        id: m._id.toString(),
        email: m.email,
        name: m.profile?.name,
        employeeId: memberEntryById.get(m._id.toString())?.employeeId || '',
        branchId: organization.getBranchById(memberEntryById.get(m._id.toString())?.branch)?._id?.toString() || '',
        branchName: organization.getBranchById(memberEntryById.get(m._id.toString())?.branch)?.name || ''
      })),
      teams: teams.map((team) => ({
        id: team._id.toString(),
        name: team.name,
        description: team.description,
        department: team.department ? {
          id: team.department.toString(),
          name: organization.getDepartmentById(team.department)?.name || 'General'
        } : null,
        parentTeam: team.parentTeam ? {
          id: team.parentTeam._id.toString(),
          name: team.parentTeam.name
        } : null,
        manager: getDerivedManagerInfo(team),
        members: team.members.filter(m => m.status === 'active').map(m => ({
          id: m.account._id.toString(),
          email: m.account.email,
          name: m.account.profile?.name,
          employeeId: memberEntryById.get(m.account._id.toString())?.employeeId || '',
          role: m.role
        })),
        memberCount: team.memberCount
      })),
      departments: (organization.departments || []).map((department) => ({
        id: department._id.toString(),
        name: department.name,
        description: department.description || '',
        headAccount: department.headAccount?.toString() || '',
        headName: orgMembers.find((orgMember) => orgMember._id.toString() === department.headAccount?.toString())?.profile?.name || '',
        parentDepartment: department.parentDepartment?.toString() || ''
      })),
      branches: (organization.branches || []).map((branch) => ({
        id: branch._id.toString(),
        name: branch.name,
        code: branch.code || '',
        address: branch.address || '',
        city: branch.city || '',
        state: branch.state || '',
        country: branch.country || '',
        managerAccount: branch.managerAccount?.toString() || '',
        managerName: orgMembers.find((orgMember) => orgMember._id.toString() === branch.managerAccount?.toString())?.profile?.name || '',
        isHeadOffice: !!branch.isHeadOffice,
        memberCount: organization.members.filter((entry) => entry.status === 'active' && entry.branch?.toString() === branch._id.toString()).length
      })),
      canManageMemberRoles: ['owner', 'admin'].includes(member.role),
      canManageMemberMetadata: ['owner', 'admin', 'hr_manager'].includes(member.role),
      canManageTeams: ['owner', 'admin'].includes(member.role) || organization.isDepartmentHead(req.user._id),
      yourRole: member.role,
      ownerCount: organization.getOwnerCount(),
      activeView: ['members', 'branches'].includes(req.query.view) ? req.query.view : 'structure',
      user: req.user,
      error: req.query.error,
      success: req.query.success
    })
  } catch (error) {
    console.error('Members page error:', error)
    res.redirect('/organizations?error=Failed to load members')
  }
})

app.get('/organizations/:orgId/invitations', getSessionUser, async (req, res) => {
  try {
    const organization = await Organization.findById(req.params.orgId)
    if (!organization) {
      return res.redirect('/organizations?error=Organization not found')
    }
    await organization.save()
    const generalDepartmentId = organization.getGeneralDepartment()?._id
    if (generalDepartmentId) {
      await Team.ensureDepartmentAssignments(req.params.orgId, generalDepartmentId)
    }

    const member = organization.members.find(
      m => m.account.toString() === req.user._id.toString() && m.status === 'active'
    )

    if (!member || !['owner', 'admin', 'hr_manager'].includes(member.role)) {
      return res.redirect('/organizations?error=Admin, owner, or HR manager role required')
    }

    const invitations = await OrganizationInvite.find({
      organization: req.params.orgId,
      status: 'pending',
      expiresAt: { $gt: new Date() }
    })
      .populate('invitedBy', 'email profile.name')
      .populate('team', 'name')

    const { apps: availableApps, appIdSet, appNameById } = getHubAppMetadata()
    const invitationRows = invitations.map(invite => ({
      id: invite._id.toString(),
      ...invite.toObject(),
      departmentName: organization.getDepartmentById(invite.department)?.name || 'General',
      teamName: invite.team?.name || '',
      ...getInvitationAccessSummary(invite, appNameById, appIdSet)
    }))

    const teams = await Team.find({ organization: req.params.orgId }).select('name department').lean()

    res.render('invitations', {
      organization,
      invitations: invitationRows,
      availableApps,
      departments: (organization.departments || []).map((department) => ({
        id: department._id.toString(),
        name: department.name,
        parentDepartment: department.parentDepartment?.toString() || ''
      })),
      teams: teams.map((team) => ({
        id: team._id.toString(),
        name: team.name,
        departmentId: team.department?.toString() || ''
      })),
      yourRole: member.role,
      user: req.user,
      error: req.query.error,
      success: req.query.success
    })
  } catch (error) {
    console.error('Invitations page error:', error)
    res.redirect('/organizations?error=Failed to load invitations')
  }
})

// Onboarding admin page
app.get('/organizations/:orgId/onboarding', getSessionUser, async (req, res) => {
  try {
    const adminContext = await loadOnboardingAdminContext(req, req.params.orgId, { workflowType: 'onboarding' })
    const personalAssignments = await getPersonalOnboardingAssignments(req.user._id, req.params.orgId, { workflowType: 'onboarding' })

    res.render('onboarding-admin', {
      ...adminContext,
      personalAssignments,
      defaultTemplateId: adminContext.templates.find(t => t.isDefault)?._id?.toString() || null,
      activePage: 'organizations',
      activeWorkflow: 'onboarding',
      workspaceMode: false,
      user: req.user,
      error: req.query.error,
      success: req.query.success
    })
  } catch (error) {
    console.error('Onboarding admin page error:', error)
    res.redirect('/organizations?error=Failed to load onboarding')
  }
})

// Onboarding assignment detail (admin/HR)
app.get('/organizations/:orgId/onboarding/assignments/:assignmentId', getSessionUser, async (req, res) => {
  try {
    const organization = await Organization.findById(req.params.orgId)
      .populate('members.account', 'email profile.name')

    if (!organization) {
      return res.redirect('/organizations?error=Organization not found')
    }

    const member = organization.members.find(
      m => (m.account?._id || m.account).toString() === req.user._id.toString() && m.status === 'active'
    )

    if (!member || !ONBOARDING_MANAGER_ROLES.includes(member.role)) {
      return res.redirect(`/organizations/${req.params.orgId}/onboarding?error=Admin or HR role required`)
    }

    const assignment = await OnboardingAssignment.findOne({
      _id: req.params.assignmentId,
      organization: req.params.orgId
    })
      .populate('member', 'email profile.name')
      .populate('createdBy', 'email profile.name')
      .populate('template', 'name')
      .lean()

    if (!assignment) {
      return res.redirect(`/organizations/${req.params.orgId}/onboarding?error=Assignment not found`)
    }

    assignment.templateName = assignment.template?.name || null

    res.render('onboarding-assignment', {
      organization,
      assignment,
      yourRole: member.role,
      activePage: 'organizations',
      user: req.user,
      error: req.query.error,
      success: req.query.success
    })
  } catch (error) {
    console.error('Onboarding assignment detail error:', error)
    res.redirect(`/organizations/${req.params.orgId}/onboarding?error=Failed to load assignment`)
  }
})

// Notifications page - Send email notifications to teams, members, or organization
app.get('/organizations/:orgId/notifications', getSessionUser, async (req, res) => {
  try {
    const organization = await Organization.findById(req.params.orgId)
      .populate('members.account', 'email profile.name')

    if (!organization) {
      return res.redirect('/organizations?error=Organization not found')
    }

    const member = organization.members.find(
      m => m.account._id.toString() === req.user._id.toString() && m.status === 'active'
    )

    if (!member) {
      return res.redirect('/organizations?error=Not a member of this organization')
    }

    // Get teams for the dropdown
    const teams = await Team.find({ organization: req.params.orgId })
      .select('name members')
      .sort({ name: 1 })

    const mappedTeams = teams.map(t => ({
      _id: t._id,
      name: t.name,
      memberCount: t.members.filter(m => m.status === 'active').length
    }))

    // Get members for the dropdown
    const mappedMembers = organization.members
      .filter(m => m.status === 'active')
      .map(m => ({
        id: m.account._id,
        name: m.account.profile?.name || m.account.email?.split('@')[0] || 'Unknown',
        email: m.account.email
      }))

    // Get notification history (paginated)
    const page = parseInt(req.query.page) || 1
    const limit = 10
    const skip = (page - 1) * limit

    const [notifications, totalNotifications] = await Promise.all([
      Notification.find({ organization: req.params.orgId })
        .populate('sentBy', 'email profile.name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('-recipients -htmlContent -textContent'),
      Notification.countDocuments({ organization: req.params.orgId })
    ])

    res.render('notifications', {
      organization,
      teams: mappedTeams,
      members: mappedMembers,
      notifications,
      pagination: {
        page,
        limit,
        total: totalNotifications,
        pages: Math.ceil(totalNotifications / limit)
      },
      yourRole: member.role,
      user: req.user,
      error: req.query.error,
      success: req.query.success
    })
  } catch (error) {
    console.error('Notifications page error:', error)
    res.redirect('/organizations?error=Failed to load notifications')
  }
})

const sanitizeDownloadFileName = (value, fallback = 'document') => {
  const raw = (value || '').toString().trim()
  const safe = raw
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()

  return safe || fallback
}

const ensureFileExtension = (fileName, extension) => {
  const safeFileName = sanitizeDownloadFileName(fileName)
  if (!extension) return safeFileName

  const normalizedExtension = extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`
  if (safeFileName.toLowerCase().endsWith(normalizedExtension)) {
    return safeFileName
  }

  const base = safeFileName.replace(/\.[^/.]+$/, '')
  return `${base}${normalizedExtension}`
}

const normalizeMimeType = (mimeType) => (mimeType || '').toString().toLowerCase().split(';')[0].trim()

const inferMimeTypeFromFileName = (fileName) => {
  const lower = (fileName || '').toString().toLowerCase()
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.bmp')) return 'image/bmp'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  if (lower.endsWith('.doc')) return 'application/msword'
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  return 'application/octet-stream'
}

const inferFileExtensionFromMimeType = (mimeType) => {
  const normalized = normalizeMimeType(mimeType)
  if (normalized === 'application/pdf') return '.pdf'
  if (normalized === 'image/png') return '.png'
  if (normalized === 'image/jpeg') return '.jpg'
  if (normalized === 'image/gif') return '.gif'
  if (normalized === 'image/webp') return '.webp'
  if (normalized === 'image/bmp') return '.bmp'
  if (normalized === 'image/svg+xml') return '.svg'
  if (normalized === 'application/msword') return '.doc'
  if (normalized === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return '.docx'
  return ''
}

const isGenericBinaryMimeType = (mimeType) => (
  normalizeMimeType(mimeType) === 'application/octet-stream'
)

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

const ensureExtensionForMimeType = (fileName, mimeType) => {
  const extension = inferFileExtensionFromMimeType(mimeType)
  if (!extension) return sanitizeDownloadFileName(fileName)
  return ensureFileExtension(fileName, extension)
}

const resolveOnboardingDocumentPayload = (item, requestedVersion) => {
  const normalizedVersion = (requestedVersion || '').toString().toLowerCase()

  if (item.type === 'esign') {
    const originalUrl = item.data?.esign?.originalUrl || item.config?.document?.url || ''
    const signedUrl = item.data?.esign?.signedUrl || ''
    const originalPublicId = item.config?.document?.publicId || inferCloudinaryPublicIdFromUrl(originalUrl)
    const signedPublicId = item.data?.esign?.signedPublicId || inferCloudinaryPublicIdFromUrl(signedUrl)
    const originalFileName = ensureFileExtension(
      item.config?.document?.fileName || `${item.title || 'document'}.pdf`,
      '.pdf'
    )
    const generatedSignedName = `${originalFileName.replace(/\.[^/.]+$/, '')}-signed.pdf`
    const signedFileName = ensureFileExtension(
      item.data?.esign?.signedFileName || generatedSignedName,
      '.pdf'
    )

    let resolvedVersion = normalizedVersion === 'original' ? 'original' : 'signed'
    if (resolvedVersion === 'signed' && !signedUrl) {
      resolvedVersion = 'original'
    }

    let docUrl = resolvedVersion === 'signed' ? signedUrl : originalUrl
    if (!docUrl) {
      docUrl = signedUrl || originalUrl
      resolvedVersion = signedUrl ? 'signed' : 'original'
    }

    return {
      docUrl,
      docPublicId: resolvedVersion === 'signed' ? signedPublicId : originalPublicId,
      docType: 'pdf',
      subtitle: resolvedVersion === 'signed' ? 'Signed document' : 'Original document',
      docMimeType: normalizeMimeType(item.data?.esign?.signedMimeType) || 'application/pdf',
      docFileName: resolvedVersion === 'signed' ? signedFileName : originalFileName,
      resolvedVersion
    }
  }

  const upload = item.data?.upload || {}
  const docUrl = upload.url || ''
  const docPublicId = upload.publicId || inferCloudinaryPublicIdFromUrl(docUrl)
  const normalizedMimeType = normalizeMimeType(upload.mimeType) || inferMimeTypeFromFileName(upload.fileName)
  const docFileName = ensureExtensionForMimeType(
    upload.fileName || item.title || 'uploaded-document',
    normalizedMimeType
  )
  const lowerFileName = docFileName.toLowerCase()
  const isPdf = normalizedMimeType.includes('pdf') || lowerFileName.endsWith('.pdf')
  const isImage = normalizedMimeType.startsWith('image/') || /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/.test(lowerFileName)

  return {
    docUrl,
    docPublicId,
    docType: isPdf ? 'pdf' : (isImage ? 'image' : 'unknown'),
    subtitle: 'Uploaded document',
    docMimeType: normalizedMimeType || 'application/octet-stream',
    docFileName,
    resolvedVersion: null
  }
}

const buildDocumentDownloadUrl = (assignmentId, itemId, version) => {
  const params = new URLSearchParams()
  if (version === 'original' || version === 'signed') {
    params.set('version', version)
  }
  const query = params.toString()
  return `/onboarding/assignments/${assignmentId}/items/${itemId}/document/download${query ? `?${query}` : ''}`
}

const buildDocumentInlineUrl = (assignmentId, itemId, version) => {
  const params = new URLSearchParams()
  if (version === 'original' || version === 'signed') {
    params.set('version', version)
  }
  const query = params.toString()
  return `/onboarding/assignments/${assignmentId}/items/${itemId}/document/file${query ? `?${query}` : ''}`
}

const buildDocumentViewUrl = (assignmentId, itemId, version) => {
  const params = new URLSearchParams()
  if (version === 'original' || version === 'signed') {
    params.set('version', version)
  }
  const query = params.toString()
  return `/onboarding/assignments/${assignmentId}/items/${itemId}/document${query ? `?${query}` : ''}`
}

const buildDocumentWorkspaceActionUrl = ({
  assignmentId,
  itemId,
  workflowType,
  itemType,
  statusKey
} = {}) => {
  const params = new URLSearchParams()
  params.set('workflow', normalizeWorkflowType(workflowType, { allowAll: false, fallback: 'onboarding' }))

  if (assignmentId) {
    params.set('focusAssignment', String(assignmentId))
  }

  if (itemId) {
    params.set('focusItem', String(itemId))
  }

  if (statusKey === 'needs_action' && itemType === 'esign') {
    params.set('action', 'sign')
  }

  return `/documents/my?${params.toString()}`
}

const getComparableActorId = (value) => {
  if (!value) return ''

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed || trimmed === 'undefined' || trimmed === 'null' || trimmed === '[object Object]') {
      return ''
    }
    const objectIdMatch = trimmed.match(/^[Oo]bject[Ii]d\(['"]([0-9a-fA-F]{24})['"]\)$/)
    return objectIdMatch ? objectIdMatch[1] : trimmed
  }

  if (typeof value === 'object') {
    if (typeof value.$oid === 'string') return value.$oid
    if (typeof value.toHexString === 'function') return value.toHexString()
    if (typeof value.toString === 'function') {
      const stringValue = value.toString()
      if (/^[0-9a-fA-F]{24}$/.test(stringValue)) {
        return stringValue
      }
    }
    if (Object.prototype.hasOwnProperty.call(value, '_id')) {
      const next = value._id
      if (next && next !== value) return getComparableActorId(next)
    }
    if (value.member) return getComparableActorId(value.member)
    if (value.memberId) return getComparableActorId(value.memberId)
    if (value.key) return getComparableActorId(value.key)
    if (value.id) return getComparableActorId(value.id)
  }

  return String(value)
}

const ensureArray = (value) => (Array.isArray(value) ? value : [])

const isOnboardingESignFieldAssignedToUser = (field, {
  currentUserId = '',
  assignmentMemberId = ''
} = {}) => {
  const rawSignerId = getComparableActorId(field?.signerId || field?.signerKey || field?.signer)

  if (!rawSignerId) {
    return assignmentMemberId === currentUserId
  }

  const resolvedSignerId = rawSignerId === 'assignee'
    ? assignmentMemberId
    : rawSignerId

  return resolvedSignerId === currentUserId
}

const getOnboardingESignState = (item, {
  currentUserId = '',
  assignmentMemberId = '',
  assignmentStatus = ''
} = {}) => {
  const signerConfigList = ensureArray(item?.config?.signers)
  const signatureFieldList = ensureArray(item?.config?.signatureFields)
  const signerStatusList = ensureArray(item?.data?.esign?.signers)
  const signerConfigIds = signerConfigList
    .map(signer => getComparableActorId(signer))
    .filter(Boolean)
  const hasAssignedField = signatureFieldList.some(field => (
    isOnboardingESignFieldAssignedToUser(field, {
      currentUserId,
      assignmentMemberId
    })
  ))
  const signerEntry = signerStatusList.find(signer => getComparableActorId(signer?.member) === currentUserId) || null
  const hasSigned = signerEntry?.status === 'signed'
  const canSign = Boolean(
    signerEntry ||
    signerConfigIds.includes(currentUserId) ||
    hasAssignedField ||
    ((!signerConfigIds.length && !signatureFieldList.length) && assignmentMemberId === currentUserId)
  )
  const isCancelled = assignmentStatus === 'cancelled'
  const isCompleted = item?.status === 'completed' || item?.data?.esign?.status === 'completed'
  const userActionable = !isCancelled && !isCompleted && canSign && !hasSigned
  const userDone = isCompleted || hasSigned

  return {
    signerEntry,
    hasSigned,
    canSign,
    hasAssignedField,
    isCancelled,
    isCompleted,
    userActionable,
    userDone
  }
}

const buildProfileDocumentEntries = (assignments = [], user = {}) => {
  const currentUserId = user?._id?.toString?.() || user?.toString?.() || ''
  const entries = []

  assignments.forEach((assignment) => {
    const assignmentId = assignment?._id?.toString?.() || ''

    try {
      const assignmentMemberId = getComparableActorId(assignment?.member)
      const isAssignee = assignmentMemberId === currentUserId
      const organizationName = assignment?.organization?.name || 'Organization'
      const workflowType = normalizeWorkflowType(assignment?.workflowType, { fallback: 'general' })
      const workflowLabel = WORKFLOW_LABELS[workflowType] || 'Document Workflow'

      ensureArray(assignment?.items).forEach((item) => {
        try {
          if (!['esign', 'upload'].includes(item?.type)) {
            return
          }

          const configuredSigners = ensureArray(item?.config?.signers)
          const signatureFields = ensureArray(item?.config?.signatureFields)
          const signingStatus = ensureArray(item?.data?.esign?.signers)
          const isConfiguredSigner = item.type === 'esign'
            ? configuredSigners.some((signer) => getComparableActorId(signer) === currentUserId)
            : false
          const isFieldSigner = item.type === 'esign'
            ? signatureFields.some((field) => (
                isOnboardingESignFieldAssignedToUser(field, {
                  currentUserId,
                  assignmentMemberId
                })
              ))
            : false
          const isSignerInStatus = item.type === 'esign'
            ? signingStatus.some((signer) => getComparableActorId(signer?.member) === currentUserId)
            : false

          if (!(isAssignee || isConfiguredSigner || isFieldSigner || isSignerInStatus)) {
            return
          }

          const descriptor = resolveOnboardingDocumentPayload(item, item.type === 'esign' ? 'signed' : null)
          if (!descriptor?.docUrl) {
            return
          }

          const esignState = item.type === 'esign'
            ? getOnboardingESignState(item, {
                currentUserId,
                assignmentMemberId,
                assignmentStatus: assignment?.status || ''
              })
            : null

          let statusKey = 'available'
          let statusLabel = 'Available'

          if (item.type === 'esign') {
            if (esignState?.isCancelled) {
              statusKey = 'available'
              statusLabel = 'Cancelled'
            } else if (esignState?.userDone) {
              statusKey = 'completed'
              statusLabel = 'Signed'
            } else if (esignState?.userActionable) {
              statusKey = 'needs_action'
              statusLabel = 'Needs Signature'
            } else {
              statusKey = 'available'
              statusLabel = 'Waiting'
            }
          } else if (item.type === 'upload') {
            if (assignment?.status === 'cancelled') {
              statusKey = 'available'
              statusLabel = 'Cancelled'
            } else {
              statusKey = 'completed'
              statusLabel = 'Uploaded'
            }
          }

          const issuedAt = item.type === 'esign'
            ? (esignState?.signerEntry?.signedAt || item?.data?.esign?.signedAt || assignment?.completedAt || assignment?.createdAt)
            : (item?.data?.upload?.uploadedAt || assignment?.completedAt || assignment?.createdAt)

          const fileName = descriptor.docFileName || item?.data?.upload?.fileName || item?.config?.document?.fileName || item?.title || 'Document'
          const title = item?.title || fileName
          const requiresSignature = item.type === 'esign' && esignState?.userActionable === true
          const workspaceActionUrl = buildDocumentWorkspaceActionUrl({
            assignmentId,
            itemId: item?._id?.toString?.() || '',
            workflowType,
            itemType: item.type,
            statusKey
          })
          const searchText = [
            title,
            fileName,
            descriptor.subtitle,
            organizationName,
            workflowLabel,
            statusLabel,
            item?.description || ''
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()

          entries.push({
            id: `${assignmentId}:${item?._id?.toString?.() || ''}`,
            assignmentId,
            itemId: item?._id?.toString?.() || '',
            title,
            description: item?.description || '',
            organizationName,
            workflowType,
            workflowLabel,
            itemType: item.type,
            itemTypeLabel: item.type === 'esign' ? 'E-sign Document' : 'Uploaded File',
            subtitle: descriptor.subtitle,
            fileName,
            statusKey,
            statusLabel,
            assignmentStatus: assignment?.status || 'pending',
            itemStatus: item?.status || 'pending',
            issuedAt: issuedAt || assignment?.createdAt || null,
            dueAt: assignment?.dueAt || null,
            viewUrl: buildDocumentViewUrl(assignmentId, item?._id?.toString?.() || '', descriptor.resolvedVersion),
            downloadUrl: buildDocumentDownloadUrl(assignmentId, item?._id?.toString?.() || '', descriptor.resolvedVersion),
            actionUrl: requiresSignature ? workspaceActionUrl : buildDocumentViewUrl(assignmentId, item?._id?.toString?.() || '', descriptor.resolvedVersion),
            actionLabel: requiresSignature ? 'Review & Sign' : 'View',
            actionHint: requiresSignature
              ? 'Open the signing screen for this exact document and finish your signature there.'
              : (statusLabel === 'Cancelled'
                  ? 'This document assignment was cancelled. Open the document if you need to review the original file.'
                  : (statusLabel === 'Waiting'
                      ? 'This document is visible to you, but there is no signature action pending from your account right now.'
                      : (statusKey === 'completed'
                          ? 'Open the completed document.'
                          : 'Open the document to review it.'))),
            requiresSignature,
            searchText,
            sortPriority: requiresSignature ? 0 : (statusKey === 'needs_action' ? 1 : (statusKey === 'available' ? 2 : 3))
          })
        } catch (itemError) {
          console.error('Failed to build profile document entry:', {
            assignmentId,
            itemId: item?._id?.toString?.() || '',
            itemType: item?.type || 'unknown'
          }, itemError)
        }
      })
    } catch (assignmentError) {
      console.error('Failed to process document assignment for profile entries:', {
        assignmentId,
        workflowType: assignment?.workflowType || 'unknown'
      }, assignmentError)
    }
  })

  return entries.sort((left, right) => {
    const priorityDelta = Number(left?.sortPriority || 0) - Number(right?.sortPriority || 0)
    if (priorityDelta !== 0) {
      return priorityDelta
    }
    const leftTime = left?.issuedAt ? new Date(left.issuedAt).getTime() : 0
    const rightTime = right?.issuedAt ? new Date(right.issuedAt).getTime() : 0
    return rightTime - leftTime
  })
}

const resolveOnboardingDocumentAccess = async (assignmentId, itemId, userId) => {
  const assignment = await OnboardingAssignment.findById(assignmentId)
    .populate('organization', 'name')

  if (!assignment) {
    return { error: 'not_found' }
  }

  const item = assignment.items.id(itemId)
  if (!item || !['esign', 'upload'].includes(item.type)) {
    return { error: 'not_found' }
  }

  const organizationId = assignment.organization?._id || assignment.organization
  const organization = await Organization.findById(organizationId).select('members')
  const userIdStr = userId.toString()

  const member = organization?.members?.find(
    m => m.account.toString() === userIdStr && m.status === 'active'
  )

  const isManager = !!(member && ONBOARDING_MANAGER_ROLES.includes(member.role))
  const isAssignee = assignment.member?.toString() === userIdStr
  const isConfiguredSigner = item.type === 'esign'
    ? ensureArray(item?.config?.signers).some(signer => signer?.member?.toString() === userIdStr)
    : false
  const isFieldSigner = item.type === 'esign'
    ? ensureArray(item?.config?.signatureFields).some(field => (
        isOnboardingESignFieldAssignedToUser(field, {
          currentUserId: userIdStr,
          assignmentMemberId: assignment.member?.toString?.() || ''
        })
      ))
    : false
  const isSignerInStatus = item.type === 'esign'
    ? ensureArray(item?.data?.esign?.signers).some(signer => signer?.member?.toString() === userIdStr)
    : false

  return {
    assignment,
    item,
    organizationId,
    isManager,
    canAccess: isManager || isAssignee || isConfiguredSigner || isFieldSigner || isSignerInStatus
  }
}

const resolveOnboardingBackUrl = (backParam, isManager, organizationId) => {
  const rawBack = (backParam || '').toString()
  const safeBackUrl = rawBack.startsWith('/') && !rawBack.startsWith('//') ? rawBack : null
  const defaultBackUrl = isManager
    ? `/organizations/${organizationId.toString()}/onboarding`
    : '/documents'
  return safeBackUrl || defaultBackUrl
}

const buildOnboardingCloudinaryDownloadUrl = (payload = {}) => {
  const publicId = (payload.docPublicId || inferCloudinaryPublicIdFromUrl(payload.docUrl)).toString().trim()
  if (!publicId || !isCloudinaryConfigured()) {
    return ''
  }

  const fileExtension = inferFileExtensionFromMimeType(payload.docMimeType || '')
  const format = fileExtension ? fileExtension.replace(/^\./, '') : undefined

  try {
    return cloudinary.utils.private_download_url(publicId, format, {
      resource_type: 'raw',
      type: 'upload',
      attachment: false
    })
  } catch (error) {
    console.error('Failed to build Cloudinary onboarding download URL:', {
      publicId,
      requestedFormat: format || null
    }, error)
    return ''
  }
}

const fetchOnboardingDocumentAsset = async (payload) => {
  const candidateUrls = []
  const cloudinaryDownloadUrl = buildOnboardingCloudinaryDownloadUrl(payload)

  if (cloudinaryDownloadUrl) {
    candidateUrls.push({
      url: cloudinaryDownloadUrl,
      label: 'cloudinary-download'
    })
  }

  if (payload.docUrl) {
    candidateUrls.push({
      url: payload.docUrl,
      label: 'stored-url'
    })
  }

  let lastError = null

  for (const candidate of candidateUrls) {
    try {
      const upstream = await fetch(candidate.url, {
        headers: {
          Accept: payload.docMimeType || 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.8'
        }
      })

      if (!upstream.ok) {
        throw new Error(`Upstream document fetch failed (${candidate.label}): ${upstream.status}`)
      }

      const upstreamContentType = normalizeMimeType(upstream.headers.get('content-type'))
      const contentType = !upstreamContentType || isGenericBinaryMimeType(upstreamContentType)
        ? (payload.docMimeType || inferMimeTypeFromFileName(payload.docFileName) || 'application/octet-stream')
        : upstreamContentType

      return {
        buffer: Buffer.from(await upstream.arrayBuffer()),
        contentType
      }
    } catch (error) {
      lastError = error
    }
  }

  console.error('Failed to fetch onboarding document asset from all sources:', {
    docFileName: payload.docFileName || '',
    docPublicId: payload.docPublicId || '',
    docUrl: payload.docUrl || '',
    sourcesTried: candidateUrls.map(candidate => candidate.label)
  }, lastError)

  throw lastError || new Error('Upstream document fetch failed')
}

const setOnboardingDocumentResponseHeaders = (res, payload, contentType, disposition = 'inline') => {
  const fileName = sanitizeDownloadFileName(payload.docFileName || 'document')
  const asciiFileName = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_')

  res.setHeader('Content-Type', contentType || payload.docMimeType || 'application/octet-stream')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader(
    'Content-Disposition',
    `${disposition}; filename="${asciiFileName || 'document'}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
  )
}

app.get('/performance-evaluations', getSessionUser, requireCurrentOrganizationActiveSubscription, async (req, res) => {
  try {
    const orgContext = await getCurrentOrganizationContext(req.user)
    if (orgContext.error) {
      return res.redirect(`/organizations?error=${encodeURIComponent(orgContext.error)}`)
    }

    try {
      await markDashboardNotificationViewed({
        accountId: req.user._id,
        type: 'simplePerformance',
        organizationIds: [orgContext.organizationId]
      })
    } catch (notificationViewError) {
      console.error('Failed to mark simple performance notification as viewed:', notificationViewError)
    }

    const fieldConfig = await ensureSimplePerformanceFieldConfig(orgContext.organizationId, req.user)
    const evaluationFields = normalizeSimplePerformanceFields(fieldConfig.fields)

    const { members: evaluableMembers } = await getEvaluableMembersForEvaluator({
      organizationId: orgContext.organizationId,
      evaluatorId: req.user._id,
      evaluatorOrganizationRole: orgContext.memberRole
    })
    const canEvaluate = evaluableMembers.length > 0
    const hasOrgWideHistoryAccess = SIMPLE_PERFORMANCE_FIELD_MANAGER_ROLES.includes(orgContext.memberRole)
    const canManageFields = canManageSimplePerformanceFields({
      memberRole: orgContext.memberRole,
      canEvaluate
    })
    const canViewAllHistory = hasOrgWideHistoryAccess || canEvaluate
    const canCreateTeam = ['owner', 'admin'].includes(orgContext.memberRole)
    const teamManagementUrl = `/organizations/${orgContext.organizationId}/teams`

    const organizationTeams = await Team.find({ organization: orgContext.organizationId })
      .select('_id name parentTeam')
      .sort({ name: 1 })
      .lean()
    const organizationTeamCount = organizationTeams.length
    const { teamById: organizationTeamById, childrenByParent: organizationTeamChildrenByParent } =
      buildTeamHierarchyMaps(organizationTeams)

    const requestedView = getQueryStringValue(req.query.view).trim().toLowerCase()
    let viewMode = 'overview'
    if (requestedView === 'new') {
      viewMode = 'new'
    } else if (requestedView === 'settings') {
      viewMode = 'settings'
    }

    let evaluableTeams = []
    if (hasOrgWideHistoryAccess) {
      evaluableTeams = organizationTeams.map(team => ({
        teamId: String(team._id),
        teamName: team.name || 'Team',
        teamHierarchyPath: resolveTeamPath(team._id, organizationTeamById)
      }))
    } else {
      const evaluableTeamMap = new Map()
      for (const member of evaluableMembers) {
        const teamId = String(member.teamId || '').trim()
        if (!teamId || evaluableTeamMap.has(teamId)) continue
        evaluableTeamMap.set(teamId, {
          teamId,
          teamName: member.teamName || 'Team',
          teamHierarchyPath: Array.isArray(member.teamHierarchyPath) ? member.teamHierarchyPath : []
        })
      }
      evaluableTeams = Array.from(evaluableTeamMap.values())
    }
    evaluableTeams.sort((a, b) => {
      const aLabel = (a.teamHierarchyPath?.join(' > ') || a.teamName || '').toLowerCase()
      const bLabel = (b.teamHierarchyPath?.join(' > ') || b.teamName || '').toLowerCase()
      return aLabel.localeCompare(bLabel)
    })

    const evaluableTeamById = new Map(evaluableTeams.map(team => [team.teamId, team]))

    const requestedTeamId = getQueryStringValue(req.query.team).trim()
    let selectedTeam = requestedTeamId ? evaluableTeamById.get(requestedTeamId) : null
    if (canViewAllHistory && !selectedTeam && evaluableTeams.length > 0) {
      selectedTeam = evaluableTeams[0]
    }
    const selectedTeamId = selectedTeam?.teamId || ''
    const selectedTeamScopeIds = selectedTeamId
      ? collectTeamAndDescendantIds(selectedTeamId, organizationTeamChildrenByParent)
      : new Set()

    const teamScopedEvaluableMembers = selectedTeamId
      ? evaluableMembers.filter(member => selectedTeamScopeIds.has(String(member.teamId || '').trim()))
      : (canViewAllHistory ? [] : evaluableMembers)
    const teamScopedMemberMap = new Map(teamScopedEvaluableMembers.map(member => [member.accountId, member]))

    const requestedMemberId = getQueryStringValue(req.query.member).trim()
    const requestedReviewedScope = getQueryStringValue(req.query.reviewed).trim().toLowerCase()
    const requestedMember = requestedMemberId ? teamScopedMemberMap.get(requestedMemberId) : null
    const showOwnHistoryOnly = requestedReviewedScope === 'me' || !canViewAllHistory
    let selectedMember = showOwnHistoryOnly ? null : (requestedMember || null)

    // In "Evaluate New" mode, auto-select first evaluable member for convenience.
    if (viewMode === 'new' && !selectedMember && canEvaluate) {
      selectedMember = teamScopedEvaluableMembers[0] || null
    }

    const selectedMemberId = selectedMember?.accountId || ''
    const historyQuery = { organization: orgContext.organizationId }
    const requestedHistoryDate = getQueryStringValue(req.query.date).trim()
    const requestedHistoryMonth = getQueryStringValue(req.query.month).trim()
    const parsedHistoryDate = parseIsoDateFilterValue(requestedHistoryDate)
    const parsedHistoryMonth = parseIsoMonthFilterValue(requestedHistoryMonth)

    // History is team-scoped for manager views.
    // Non-managers always see evaluations about themselves.
    if (showOwnHistoryOnly) {
      historyQuery.evaluatedMember = req.user._id
    } else {
      if (selectedTeamId) {
        const scopedTeamIds = selectedTeamScopeIds.size
          ? Array.from(selectedTeamScopeIds)
          : [selectedTeamId]
        historyQuery.evaluatedTeam = scopedTeamIds.length > 1
          ? { $in: scopedTeamIds }
          : scopedTeamIds[0]
      }
      if (requestedMember?.accountId) {
        historyQuery.evaluatedMember = requestedMember.accountId
      }
    }

    const historyDateRange = {}
    if (parsedHistoryMonth) {
      historyDateRange.$gte = parsedHistoryMonth.start
      historyDateRange.$lt = parsedHistoryMonth.end
    }
    if (parsedHistoryDate) {
      historyDateRange.$gte = historyDateRange.$gte
        ? new Date(Math.max(historyDateRange.$gte.getTime(), parsedHistoryDate.start.getTime()))
        : parsedHistoryDate.start
      historyDateRange.$lt = historyDateRange.$lt
        ? new Date(Math.min(historyDateRange.$lt.getTime(), parsedHistoryDate.end.getTime()))
        : parsedHistoryDate.end
    }
    if (Object.keys(historyDateRange).length > 0) {
      historyQuery.evaluationDate = historyDateRange
    }

    const shouldSuppressHistoryForMissingTeam = canViewAllHistory && !showOwnHistoryOnly && !selectedTeamId
    const history = shouldSuppressHistoryForMissingTeam
      ? []
      : await PerformanceEvaluation.find(historyQuery)
        .sort({ evaluationDate: -1, createdAt: -1 })
        .limit(80)
        .lean()

    const currentUserId = req.user._id?.toString() || ''
    const evaluableMemberIdSet = new Set(evaluableMembers.map(member => member.accountId))
    const canDeleteAnyEvaluation = SIMPLE_PERFORMANCE_FIELD_MANAGER_ROLES.includes(orgContext.memberRole)

    const historyWithMetrics = history.map(entry => ({
      ...entry,
      ratings: normalizeEvaluationRatingsForHistory(entry.ratings),
      averageRating: calculateAverageRating(entry.ratings),
      canDelete: Boolean(
        canDeleteAnyEvaluation ||
        (currentUserId && String(entry.evaluator || '') === currentUserId) ||
        evaluableMemberIdSet.has(String(entry.evaluatedMember || ''))
      )
    }))

    const historySummary = {
      totalEvaluations: historyWithMetrics.length,
      evaluatedMembersCount: new Set(
        historyWithMetrics
          .map(entry => String(entry.evaluatedMember || ''))
          .filter(Boolean)
      ).size,
      oneOnOneCount: historyWithMetrics.filter(entry => entry.needsOneOnOne).length,
      averageScore: calculateAverageRating(historyWithMetrics.flatMap(entry => entry.ratings || []))
    }
    const historyScopeSubtitle = showOwnHistoryOnly
      ? 'Showing evaluations submitted about you.'
      : (selectedTeam
          ? (selectedMember
              ? `Showing history for ${selectedMember.name} in ${selectedTeam.teamName}.`
              : `Showing history for ${selectedTeam.teamName}.`)
          : (organizationTeamCount === 0
              ? 'No teams found yet. Create a team to start evaluations.'
              : 'Select a team to review history.'))

    let errorMessage = getQueryStringValue(req.query.error)
    if (canViewAllHistory && requestedTeamId && !selectedTeam && !errorMessage) {
      errorMessage = 'Select a valid team.'
    }
    if (canViewAllHistory && requestedMemberId && !requestedMember && !errorMessage) {
      errorMessage = 'Select a valid team member to evaluate.'
    }
    if (requestedHistoryDate && !parsedHistoryDate && !errorMessage) {
      errorMessage = 'Use a valid date filter in YYYY-MM-DD format.'
    }
    if (requestedHistoryMonth && !parsedHistoryMonth && !errorMessage) {
      errorMessage = 'Use a valid month filter in YYYY-MM format.'
    }
    if (viewMode === 'new' && !canEvaluate && !errorMessage) {
      errorMessage = 'You do not have permission to submit evaluations in this organization.'
    }
    if (viewMode === 'settings' && !canManageFields) {
      viewMode = 'overview'
      if (!errorMessage) {
        errorMessage = 'You do not have permission to manage evaluation settings.'
      }
    }

    res.render('performance-evaluations', {
      user: req.user,
      activePage: 'performance-evaluations',
      organizationName: orgContext.organizationName,
      pageTitle: 'Simple Evaluation',
      aiPoweredAppLaunchUrl: '/launch/performance-management',
      viewMode,
      evaluableMembers,
      teamScopedEvaluableMembers,
      evaluableTeams,
      selectedTeam,
      selectedTeamId,
      selectedMember,
      selectedMemberId,
      evaluationFields,
      history: historyWithMetrics,
      historySummary,
      ratingScale: PERFORMANCE_RATING_SCALE,
      roleLabels: TEAM_ROLE_LABELS,
      canEvaluate,
      canManageFields,
      canViewAllHistory,
      canCreateTeam,
      organizationTeamCount,
      teamManagementUrl,
      historyScopeSubtitle,
      historyFilters: {
        date: parsedHistoryDate?.normalized || '',
        month: parsedHistoryMonth?.normalized || '',
        reviewed: requestedReviewedScope === 'me' ? 'me' : '',
        team: selectedTeamId
      },
      error: errorMessage,
      success: getQueryStringValue(req.query.success)
    })
  } catch (error) {
    console.error('Performance evaluations page error:', error)
    res.redirect('/?error=Failed to load performance evaluations')
  }
})

app.post('/performance-evaluations', getSessionUser, requireCurrentOrganizationActiveSubscription, async (req, res) => {
  try {
    const orgContext = await getCurrentOrganizationContext(req.user)
    if (orgContext.error) {
      return res.redirect(`/organizations?error=${encodeURIComponent(orgContext.error)}`)
    }

    const fieldConfig = await ensureSimplePerformanceFieldConfig(orgContext.organizationId, req.user)
    const evaluationFields = normalizeSimplePerformanceFields(fieldConfig.fields)
    if (evaluationFields.length === 0) {
      return redirectToPerformanceEvaluations(res, {
        view: 'new',
        error: 'Add at least one evaluation field before submitting evaluations.'
      })
    }

    const { members: evaluableMembers, memberMap } = await getEvaluableMembersForEvaluator({
      organizationId: orgContext.organizationId,
      evaluatorId: req.user._id,
      evaluatorOrganizationRole: orgContext.memberRole
    })

    if (evaluableMembers.length === 0) {
      return redirectToPerformanceEvaluations(res, {
        view: 'overview',
        error: 'You do not have permission to evaluate any member in this organization.'
      })
    }

    const requestedTeamId = String(req.body.team || '').trim()
    const evaluatedMemberId = String(req.body.evaluatedMemberId || '').trim()
    const selectedMember = memberMap.get(evaluatedMemberId)

    if (!requestedTeamId) {
      return redirectToPerformanceEvaluations(res, {
        view: 'new',
        error: 'Select a team before submitting an evaluation.'
      })
    }

    if (!selectedMember) {
      return redirectToPerformanceEvaluations(res, {
        view: 'new',
        team: requestedTeamId,
        error: 'Select a valid member to evaluate.'
      })
    }

    if (requestedTeamId) {
      const selectedMemberTeamId = String(selectedMember.teamId || '').trim()
      let teamMatchesSelection = selectedMemberTeamId === requestedTeamId

      if (!teamMatchesSelection) {
        const organizationTeams = await Team.find({ organization: orgContext.organizationId })
          .select('_id parentTeam')
          .lean()
        const { childrenByParent } = buildTeamHierarchyMaps(organizationTeams)
        const requestedScopeIds = collectTeamAndDescendantIds(requestedTeamId, childrenByParent)
        teamMatchesSelection = requestedScopeIds.has(selectedMemberTeamId)
      }

      if (!teamMatchesSelection) {
        return redirectToPerformanceEvaluations(res, {
          view: 'new',
          team: requestedTeamId,
          error: 'Selected member is not in the selected team.'
        })
      }
    }

    const ratings = []
    for (const field of evaluationFields) {
      const parsedValue = parsePerformanceRating(req.body[`rating_${field.key}`])
      if (!parsedValue) {
        return redirectToPerformanceEvaluations(res, {
          view: 'new',
          team: requestedTeamId || selectedMember.teamId,
          member: evaluatedMemberId,
          error: `${field.label} rating is required.`
        })
      }
      ratings.push({
        fieldKey: field.key,
        fieldLabel: field.label,
        value: parsedValue
      })
    }

    const evaluationDateRaw = String(req.body.evaluationDate || '').trim()
    let evaluationDate = new Date()
    if (evaluationDateRaw) {
      const parsedDate = new Date(evaluationDateRaw)
      if (Number.isNaN(parsedDate.getTime())) {
        return redirectToPerformanceEvaluations(res, {
          view: 'new',
          team: requestedTeamId || selectedMember.teamId,
          member: evaluatedMemberId,
          error: 'Enter a valid evaluation date.'
        })
      }
      evaluationDate = parsedDate
    }

    const needsOneOnOneValue = String(req.body.needsOneOnOne || '').trim().toLowerCase()
    if (!['yes', 'no'].includes(needsOneOnOneValue)) {
      return redirectToPerformanceEvaluations(res, {
        view: 'new',
        team: requestedTeamId || selectedMember.teamId,
        member: evaluatedMemberId,
        error: 'Select whether a 1:1 meeting is needed.'
      })
    }

    const evaluatorName = req.user.profile?.name || req.user.email || 'Evaluator'

    const createdEvaluation = await PerformanceEvaluation.create({
      organization: orgContext.organizationId,
      evaluator: req.user._id,
      evaluatorName,
      evaluatorEmail: req.user.email,
      evaluatorScopeRole: selectedMember.scopeRole,
      evaluatedMember: selectedMember.accountId,
      evaluatedMemberName: selectedMember.name,
      evaluatedMemberEmail: selectedMember.email,
      evaluatedMemberRole: selectedMember.memberRole,
      evaluatedTeam: selectedMember.teamId || null,
      evaluatedTeamName: selectedMember.teamName || '',
      evaluatedTeamPath: selectedMember.teamHierarchyPath || [],
      evaluationDate,
      ratings,
      improvements: String(req.body.improvements || '').trim(),
      additionalNotes: String(req.body.additionalNotes || '').trim(),
      needsOneOnOne: needsOneOnOneValue === 'yes'
    })

    try {
      await sendReviewedMemberEvaluationNotification({
        reviewedMemberEmail: selectedMember.email,
        reviewedMemberName: selectedMember.name,
        evaluatorName,
        organizationName: orgContext.organizationName,
        evaluationDate: createdEvaluation.evaluationDate
      })
    } catch (emailError) {
      console.error('Performance evaluation notification email failed:', emailError.message || emailError)
    }

    return redirectToPerformanceEvaluations(res, {
      view: 'overview',
      team: selectedMember.teamId,
      success: 'Performance evaluation submitted.'
    })
  } catch (error) {
    console.error('Submit performance evaluation error:', error)
    return redirectToPerformanceEvaluations(res, {
      view: 'new',
      team: String(req.body.team || '').trim(),
      member: String(req.body.evaluatedMemberId || '').trim(),
      error: 'Failed to submit evaluation.'
    })
  }
})

app.post('/performance-evaluations/:evaluationId/delete', getSessionUser, requireCurrentOrganizationActiveSubscription, async (req, res) => {
  try {
    const orgContext = await getCurrentOrganizationContext(req.user)
    if (orgContext.error) {
      return res.redirect(`/organizations?error=${encodeURIComponent(orgContext.error)}`)
    }

    const requestedTeamId = getQueryStringValue(req.body.team).trim()
    const requestedMemberId = getQueryStringValue(req.body.member).trim()
    const requestedReviewedScope = getQueryStringValue(req.body.reviewed).trim().toLowerCase()
    const requestedHistoryDate = getQueryStringValue(req.body.date).trim()
    const requestedHistoryMonth = getQueryStringValue(req.body.month).trim()
    const parsedHistoryDate = parseIsoDateFilterValue(requestedHistoryDate)
    const parsedHistoryMonth = parseIsoMonthFilterValue(requestedHistoryMonth)

    const redirectQuery = {
      view: 'overview'
    }
    if (requestedTeamId) {
      redirectQuery.team = requestedTeamId
    }
    if (requestedReviewedScope === 'me') {
      redirectQuery.reviewed = 'me'
    }
    if (parsedHistoryDate) {
      redirectQuery.date = parsedHistoryDate.normalized
    }
    if (parsedHistoryMonth) {
      redirectQuery.month = parsedHistoryMonth.normalized
    }

    const evaluationId = String(req.params.evaluationId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(evaluationId)) {
      return redirectToPerformanceEvaluations(res, {
        ...redirectQuery,
        error: 'Invalid evaluation record.'
      })
    }

    const { members: evaluableMembers, memberMap } = await getEvaluableMembersForEvaluator({
      organizationId: orgContext.organizationId,
      evaluatorId: req.user._id,
      evaluatorOrganizationRole: orgContext.memberRole
    })

    if (requestedMemberId && memberMap.has(requestedMemberId)) {
      redirectQuery.member = requestedMemberId
    }

    const evaluation = await PerformanceEvaluation.findOne({
      _id: evaluationId,
      organization: orgContext.organizationId
    })
      .select('_id evaluator evaluatedMember')
      .lean()

    if (!evaluation) {
      return redirectToPerformanceEvaluations(res, {
        ...redirectQuery,
        error: 'Evaluation record not found.'
      })
    }

    const currentUserId = req.user._id?.toString() || ''
    const evaluatedMemberId = String(evaluation.evaluatedMember || '')
    const evaluatorId = String(evaluation.evaluator || '')
    const evaluableMemberIdSet = new Set(evaluableMembers.map(member => member.accountId))
    const canDeleteAnyEvaluation = SIMPLE_PERFORMANCE_FIELD_MANAGER_ROLES.includes(orgContext.memberRole)
    const canDeleteEvaluation = Boolean(
      canDeleteAnyEvaluation ||
      (currentUserId && evaluatorId === currentUserId) ||
      evaluableMemberIdSet.has(evaluatedMemberId)
    )

    if (!canDeleteEvaluation) {
      return redirectToPerformanceEvaluations(res, {
        ...redirectQuery,
        error: 'You do not have permission to remove this evaluation.'
      })
    }

    await PerformanceEvaluation.deleteOne({
      _id: evaluationId,
      organization: orgContext.organizationId
    })

    return redirectToPerformanceEvaluations(res, {
      ...redirectQuery,
      success: 'Evaluation removed.'
    })
  } catch (error) {
    console.error('Delete performance evaluation error:', error)
    return redirectToPerformanceEvaluations(res, {
      view: 'overview',
      error: 'Failed to remove evaluation.'
    })
  }
})

app.post('/performance-evaluations/fields', getSessionUser, requireCurrentOrganizationActiveSubscription, async (req, res) => {
  try {
    const orgContext = await getCurrentOrganizationContext(req.user)
    if (orgContext.error) {
      return res.redirect(`/organizations?error=${encodeURIComponent(orgContext.error)}`)
    }

    const { members: evaluableMembers } = await getEvaluableMembersForEvaluator({
      organizationId: orgContext.organizationId,
      evaluatorId: req.user._id,
      evaluatorOrganizationRole: orgContext.memberRole
    })
    const canManageFields = canManageSimplePerformanceFields({
      memberRole: orgContext.memberRole,
      canEvaluate: evaluableMembers.length > 0
    })

    if (!canManageFields) {
      return redirectToPerformanceEvaluations(res, {
        view: 'settings',
        error: 'You do not have permission to manage evaluation fields.'
      })
    }

    const fieldLabel = normalizeSimplePerformanceFieldLabel(req.body.fieldLabel)
    if (!fieldLabel) {
      return redirectToPerformanceEvaluations(res, {
        view: 'settings',
        error: 'Field name is required.'
      })
    }

    const config = await ensureSimplePerformanceFieldConfig(orgContext.organizationId, req.user)
    const fields = normalizeSimplePerformanceFields(config.fields)

    const hasDuplicate = fields.some(field => field.label.toLowerCase() === fieldLabel.toLowerCase())
    if (hasDuplicate) {
      return redirectToPerformanceEvaluations(res, {
        view: 'settings',
        error: 'A field with this name already exists.'
      })
    }

    const existingKeys = new Set(fields.map(field => field.key))
    const newFieldKey = buildSimplePerformanceFieldKey(fieldLabel, existingKeys)

    config.fields = [
      ...fields,
      {
        key: newFieldKey,
        label: fieldLabel,
        createdBy: req.user._id,
        createdByName: req.user.profile?.name || req.user.email || 'User'
      }
    ]
    config.updatedBy = req.user._id
    config.updatedByName = req.user.profile?.name || req.user.email || 'User'
    await config.save()

    return redirectToPerformanceEvaluations(res, {
      view: 'settings',
      success: 'Evaluation field created.'
    })
  } catch (error) {
    console.error('Create evaluation field error:', error)
    return redirectToPerformanceEvaluations(res, {
      view: 'settings',
      error: 'Failed to create evaluation field.'
    })
  }
})

app.post('/performance-evaluations/fields/:fieldKey/delete', getSessionUser, requireCurrentOrganizationActiveSubscription, async (req, res) => {
  try {
    const orgContext = await getCurrentOrganizationContext(req.user)
    if (orgContext.error) {
      return res.redirect(`/organizations?error=${encodeURIComponent(orgContext.error)}`)
    }

    const { members: evaluableMembers } = await getEvaluableMembersForEvaluator({
      organizationId: orgContext.organizationId,
      evaluatorId: req.user._id,
      evaluatorOrganizationRole: orgContext.memberRole
    })
    const canManageFields = canManageSimplePerformanceFields({
      memberRole: orgContext.memberRole,
      canEvaluate: evaluableMembers.length > 0
    })

    if (!canManageFields) {
      return redirectToPerformanceEvaluations(res, {
        view: 'settings',
        error: 'You do not have permission to manage evaluation fields.'
      })
    }

    const fieldKey = String(req.params.fieldKey || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48)

    if (!fieldKey) {
      return redirectToPerformanceEvaluations(res, {
        view: 'settings',
        error: 'Invalid field key.'
      })
    }

    const config = await ensureSimplePerformanceFieldConfig(orgContext.organizationId, req.user)
    const fields = normalizeSimplePerformanceFields(config.fields)
    if (fields.length <= 1) {
      return redirectToPerformanceEvaluations(res, {
        view: 'settings',
        error: 'At least one evaluation field is required.'
      })
    }

    const remainingFields = fields.filter(field => field.key !== fieldKey)
    if (remainingFields.length === fields.length) {
      return redirectToPerformanceEvaluations(res, {
        view: 'settings',
        error: 'Field not found.'
      })
    }

    if (remainingFields.length === 0) {
      return redirectToPerformanceEvaluations(res, {
        view: 'settings',
        error: 'At least one evaluation field is required.'
      })
    }

    config.fields = remainingFields
    config.updatedBy = req.user._id
    config.updatedByName = req.user.profile?.name || req.user.email || 'User'
    await config.save()

    return redirectToPerformanceEvaluations(res, {
      view: 'settings',
      success: 'Evaluation field deleted.'
    })
  } catch (error) {
    console.error('Delete evaluation field error:', error)
    return redirectToPerformanceEvaluations(res, {
      view: 'settings',
      error: 'Failed to delete evaluation field.'
    })
  }
})

app.get('/simple-performance-evaluation', getSessionUser, requireCurrentOrganizationActiveSubscription, async (req, res) => {
  const query = new URLSearchParams(req.query).toString()
  return res.redirect(`/performance-evaluations${query ? `?${query}` : ''}`)
})

// View onboarding documents (uses PDF.js viewer so Cloudinary raw PDFs render correctly in-app)
app.get('/onboarding/assignments/:assignmentId/items/:itemId/document', getSessionUser, async (req, res) => {
  try {
    const access = await resolveOnboardingDocumentAccess(req.params.assignmentId, req.params.itemId, req.user._id)
    if (access.error === 'not_found') {
      return res.redirect('/documents?error=Document not found')
    }

    const { assignment, item, organizationId, isManager, canAccess } = access
    const backUrl = resolveOnboardingBackUrl(req.query.back, isManager, organizationId)

    if (!canAccess) {
      return res.status(403).render('document-viewer', {
        user: req.user,
        activePage: isManager ? 'organizations' : 'documents',
        title: 'Unauthorized',
        subtitle: 'You do not have access to this document.',
        docUrl: null,
        docType: 'unknown',
        backUrl,
        downloadUrl: null
      })
    }

    const payload = resolveOnboardingDocumentPayload(
      item,
      (req.query.version || '').toString().toLowerCase()
    )

    if (!payload.docUrl) {
      return res.redirect('/documents?error=Document is not available')
    }

    res.render('document-viewer', {
      user: req.user,
      activePage: isManager ? 'organizations' : 'documents',
      title: item.title || 'Document',
      subtitle: payload.subtitle,
      docUrl: buildDocumentInlineUrl(
        assignment._id.toString(),
        item._id.toString(),
        payload.resolvedVersion
      ),
      docType: payload.docType,
      backUrl,
      downloadUrl: buildDocumentDownloadUrl(
        assignment._id.toString(),
        item._id.toString(),
        payload.resolvedVersion
      )
    })
  } catch (error) {
    console.error('Onboarding document viewer error:', error)
    res.redirect('/documents?error=Failed to load document')
  }
})

app.get('/onboarding/assignments/:assignmentId/items/:itemId/document/file', getSessionUser, async (req, res) => {
  try {
    const access = await resolveOnboardingDocumentAccess(req.params.assignmentId, req.params.itemId, req.user._id)
    if (access.error === 'not_found') {
      return res.status(404).send('Document not found')
    }

    const { item, canAccess } = access
    if (!canAccess) {
      return res.status(403).send('Unauthorized')
    }

    const payload = resolveOnboardingDocumentPayload(
      item,
      (req.query.version || '').toString().toLowerCase()
    )

    if (!payload.docUrl) {
      return res.status(404).send('Document not available')
    }

    const { buffer, contentType } = await fetchOnboardingDocumentAsset(payload)
    setOnboardingDocumentResponseHeaders(res, payload, contentType, 'inline')
    res.send(buffer)
  } catch (error) {
    console.error('Onboarding document file error:', error)
    res.status(500).send('Failed to load document')
  }
})

// Download onboarding documents with a stable filename + extension.
app.get('/onboarding/assignments/:assignmentId/items/:itemId/document/download', getSessionUser, async (req, res) => {
  try {
    const access = await resolveOnboardingDocumentAccess(req.params.assignmentId, req.params.itemId, req.user._id)
    if (access.error === 'not_found') {
      return res.status(404).send('Document not found')
    }

    const { item, canAccess } = access
    if (!canAccess) {
      return res.status(403).send('Unauthorized')
    }

    const payload = resolveOnboardingDocumentPayload(
      item,
      (req.query.version || '').toString().toLowerCase()
    )

    if (!payload.docUrl) {
      return res.status(404).send('Document not available')
    }

    const { buffer, contentType } = await fetchOnboardingDocumentAsset(payload)
    setOnboardingDocumentResponseHeaders(res, payload, contentType, 'attachment')
    res.send(buffer)
  } catch (error) {
    console.error('Onboarding document download error:', error)
    res.status(500).send('Failed to download document')
  }
})

const buildPathFromRequestQuery = (pathname, query = {}, omitKeys = []) => {
  const omitted = new Set((omitKeys || []).map(key => String(key || '').trim()).filter(Boolean))
  const params = new URLSearchParams()

  Object.keys(query || {}).forEach((key) => {
    if (omitted.has(key)) return
    const value = getQueryStringValue(query[key]).trim()
    if (!value) return
    params.set(key, value)
  })

  const nextQuery = params.toString()
  return nextQuery ? `${pathname}?${nextQuery}` : pathname
}

const markDocumentsNotificationViewedForUser = async (account) => {
  const currentOrgId = account.currentOrganization?._id?.toString() || account.currentOrganization?.toString()
  const documentNotificationOrgIds = getOrganizationIdsFromAccount(account)
  if (currentOrgId && !documentNotificationOrgIds.includes(currentOrgId)) {
    documentNotificationOrgIds.push(currentOrgId)
  }

  try {
    await markDashboardNotificationViewed({
      accountId: account._id,
      type: 'documents',
      organizationIds: documentNotificationOrgIds
    })
  } catch (notificationViewError) {
    console.error('Failed to mark documents notification as viewed:', notificationViewError)
  }
}

const renderMyDocumentsPage = async (req, res) => {
  const activeWorkflow = normalizeWorkflowType(req.query.workflow, {
    allowAll: true,
    fallback: 'all'
  })

  await markDocumentsNotificationViewedForUser(req.user)

  const assignments = await getPersonalOnboardingAssignments(req.user._id, undefined, { workflowType: 'all' })

  return res.render('onboarding', {
    assignments,
    user: req.user,
    activePage: 'documents',
    activeWorkflow,
    workspaceMode: true,
    workflowLabels: WORKFLOW_LABELS,
    workflowTypes: WORKFLOW_TYPES,
    workflowSummary: buildWorkflowSummary({ assignments }),
    error: req.query.error,
    success: req.query.success
  })
}

const renderDocumentsWorkspacePage = async (req, res) => {
  const activeWorkflow = normalizeWorkflowType(req.query.workflow, {
    allowAll: true,
    fallback: 'all'
  })

  await markDocumentsNotificationViewedForUser(req.user)

  const orgContext = await getCurrentOrganizationContext(req.user)
  if (orgContext.error) {
    return res.redirect(`/documents?error=${encodeURIComponent(orgContext.error)}`)
  }

  if (!ONBOARDING_MANAGER_ROLES.includes(orgContext.memberRole)) {
    return res.redirect('/documents?error=Document workspace is available to owners, admins, and HR managers only')
  }

  const adminContext = await loadOnboardingAdminContext(req, orgContext.organizationId, { workflowType: 'all' })

  return res.render('onboarding-admin', {
    ...adminContext,
    defaultTemplateId: adminContext.templates.find(t => t.isDefault)?._id?.toString() || null,
    activePage: 'documents',
    activeWorkflow,
    workspaceMode: true,
    user: req.user,
    error: req.query.error,
    success: req.query.success
  })
}

// Document workspace landing page
app.get('/documents', getSessionUser, requireCurrentOrganizationActiveSubscription, async (req, res) => {
  try {
    const requestedTab = getQueryStringValue(req.query.tab).trim().toLowerCase()
    const hasDirectMyDocumentsTarget = ['workflow', 'focusAssignment', 'focusItem', 'action']
      .some(key => getQueryStringValue(req.query[key]).trim())

    if (requestedTab === 'center') {
      return res.redirect(buildPathFromRequestQuery('/documents/workspace', req.query, ['tab']))
    }

    if (requestedTab === 'my' || hasDirectMyDocumentsTarget) {
      return res.redirect(buildPathFromRequestQuery('/documents/my', req.query, ['tab']))
    }

    const orgContext = await getCurrentOrganizationContext(req.user)
    const canAccessWorkspace = !orgContext.error && ONBOARDING_MANAGER_ROLES.includes(orgContext.memberRole)
    const currentOrganizationName = orgContext.organizationName
      || req.user.currentOrganization?.name
      || 'Current organization'

    return res.render('documents-home', {
      user: req.user,
      activePage: 'documents',
      canAccessWorkspace,
      currentOrganizationName,
      error: req.query.error,
      success: req.query.success
    })
  } catch (error) {
    console.error('Documents landing page error:', error)
    return res.redirect('/?error=Failed to load documents')
  }
})

app.get('/documents/my', getSessionUser, requireCurrentOrganizationActiveSubscription, async (req, res) => {
  try {
    return await renderMyDocumentsPage(req, res)
  } catch (error) {
    console.error('My documents page error:', error)
    return res.redirect('/documents?error=Failed to load your documents')
  }
})

app.get('/documents/workspace', getSessionUser, requireCurrentOrganizationActiveSubscription, async (req, res) => {
  try {
    return await renderDocumentsWorkspacePage(req, res)
  } catch (error) {
    console.error('Document workspace page error:', error)
    return res.redirect('/documents?error=Failed to load document workspace')
  }
})

// Backward-compatible onboarding route
app.get('/onboarding', getSessionUser, requireCurrentOrganizationActiveSubscription, async (req, res) => {
  try {
    const currentOrgId = req.user.currentOrganization?._id?.toString() || req.user.currentOrganization?.toString()
    const documentNotificationOrgIds = getOrganizationIdsFromAccount(req.user)
    if (currentOrgId && !documentNotificationOrgIds.includes(currentOrgId)) {
      documentNotificationOrgIds.push(currentOrgId)
    }

    try {
      await markDashboardNotificationViewed({
        accountId: req.user._id,
        type: 'documents',
        organizationIds: documentNotificationOrgIds
      })
    } catch (notificationViewError) {
      console.error('Failed to mark onboarding notification as viewed:', notificationViewError)
    }

    if (currentOrgId) {
      try {
        const adminContext = await loadOnboardingAdminContext(req, currentOrgId, { workflowType: 'onboarding' })
        const personalAssignments = await getPersonalOnboardingAssignments(req.user._id, currentOrgId, { workflowType: 'onboarding' })

        return res.render('onboarding-admin', {
          ...adminContext,
          personalAssignments,
          defaultTemplateId: adminContext.templates.find(t => t.isDefault)?._id?.toString() || null,
          activePage: 'documents',
          activeWorkflow: 'onboarding',
          workspaceMode: false,
          user: req.user,
          error: req.query.error,
          success: req.query.success
        })
      } catch (adminError) {
        // Fall back to personal onboarding view if user isn't an admin/HR in the current org
      }
    }

    const assignments = await getPersonalOnboardingAssignments(req.user._id, undefined, { workflowType: 'onboarding' })

    res.render('onboarding', {
      assignments,
      user: req.user,
      activePage: 'documents',
      activeWorkflow: 'onboarding',
      workspaceMode: false,
      workflowLabels: WORKFLOW_LABELS,
      workflowTypes: WORKFLOW_TYPES,
      workflowSummary: buildWorkflowSummary({ assignments }),
      error: req.query.error,
      success: req.query.success
    })
  } catch (error) {
    console.error('Onboarding page error:', error)
    res.redirect('/?error=Failed to load onboarding')
  }
})

app.get('/organizations/:orgId/teams', getSessionUser, async (req, res) => {
  return res.redirect(`/organizations/${req.params.orgId}/members?view=structure`)
})

// User's pending invitations page
app.get('/invitations/pending', getSessionUser, async (req, res) => {
  try {
    const invitations = await OrganizationInvite.find({
      email: req.user.email.toLowerCase(),
      status: 'pending',
      expiresAt: { $gt: new Date() }
    })
      .populate('organization', 'name description')
      .populate('invitedBy', 'email profile.name')
      .sort({ createdAt: -1 })

    const { appIdSet, appNameById } = getHubAppMetadata()

    res.render('pending-invitations', {
      invitations: invitations.map(inv => ({
        id: inv._id.toString(),
        organization: {
          id: inv.organization._id.toString(),
          name: inv.organization.name,
          description: inv.organization.description
        },
        role: inv.role,
        employeeId: inv.employeeId || '',
        invitedBy: {
          email: inv.invitedBy?.email,
          name: inv.invitedBy?.profile?.name
        },
        ...getInvitationAccessSummary(inv, appNameById, appIdSet),
        expiresAt: inv.expiresAt,
        createdAt: inv.createdAt
      })),
      user: req.user,
      error: req.query.error,
      success: req.query.success
    })
  } catch (error) {
    console.error('Pending invitations page error:', error)
    res.redirect('/organizations?error=Failed to load pending invitations')
  }
})

// Invitation acceptance page (public, but requires login)
app.get('/invitations/accept', async (req, res) => {
  const { token } = req.query
  if (!token) {
    return res.send('Invalid invitation link')
  }
  // Redirect to login with return URL
  res.redirect(`/login?return_to=/invitations/accept/confirm?token=${token}`)
})

// Show confirmation page before accepting invitation
app.get('/invitations/accept/confirm', getSessionUser, async (req, res) => {
  const { token } = req.query
  if (!token) {
    return res.send('Invalid invitation link')
  }

  try {
    // Find pending invitations for user's email
    const pendingInvites = await OrganizationInvite.find({
      email: req.user.email.toLowerCase(),
      status: 'pending',
      expiresAt: { $gt: new Date() }
    }).populate('organization', 'name description').populate('invitedBy', 'email profile.name')

    // Find matching invitation
    let matchedInvite = null
    for (const invite of pendingInvites) {
      const isValid = await invite.verifyToken(token)
      if (isValid) {
        matchedInvite = invite
        break
      }
    }

    if (!matchedInvite) {
      return res.send(`
        <html><body style="font-family: system-ui; padding: 40px; background: #0f172a; color: #e2e8f0;">
          <h2>Invalid or Expired Invitation</h2>
          <p>This invitation link is no longer valid. It may have expired or been cancelled.</p>
          <a href="/organizations" style="color: #60a5fa;">Go to Organizations</a>
        </body></html>
      `)
    }

    // Show confirmation page instead of auto-accepting
    const inviterName = matchedInvite.invitedBy?.profile?.name || matchedInvite.invitedBy?.email || 'A team member'
    const { appIdSet, appNameById } = getHubAppMetadata()
    const inviteAccess = getInvitationAccessSummary(matchedInvite, appNameById, appIdSet)
    const inviteAccessDetail = inviteAccess.appAccess.mode === APP_ACCESS_MODE_SELECTED
      ? (inviteAccess.appAccessAppNames.join(', ') || 'Selected apps only')
      : 'All apps available to your organization plan'

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Join ${matchedInvite.organization.name} - AIIN Identity</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          :root {
            --brand: #60a5fa;
            --brand-2: #a855f7;
            --surface: #0b1224;
            --surface-2: #0f172a;
            --line: #1f2a44;
            --text: #e2e8f0;
            --muted: #94a3b8;
            --success: #8b5cf6;
          }
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: 'Inter', 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
            background: linear-gradient(135deg, #0b1224 0%, #0f172a 55%, #0b1224 100%);
            min-height: 100vh;
            color: var(--text);
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
          }
          .container {
            max-width: 500px;
            width: 100%;
          }
          .card {
            background: linear-gradient(160deg, rgba(16,24,40,0.88), rgba(11,18,36,0.92));
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 16px;
            padding: 32px;
            text-align: center;
          }
          .icon {
            width: 80px;
            height: 80px;
            background: linear-gradient(135deg, var(--success), #4c1d95);
            border-radius: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 24px;
            font-size: 40px;
          }
          h1 {
            font-size: 24px;
            color: #f8fafc;
            margin-bottom: 8px;
          }
          .subtitle {
            color: var(--muted);
            font-size: 16px;
            margin-bottom: 24px;
          }
          .invite-details {
            background: rgba(255,255,255,0.05);
            border: 1px solid var(--line);
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 24px;
            text-align: left;
          }
          .invite-details .org-name {
            font-size: 20px;
            font-weight: 600;
            color: #f8fafc;
            margin-bottom: 4px;
          }
          .invite-details .org-desc {
            color: var(--muted);
            font-size: 14px;
            margin-bottom: 16px;
          }
          .detail-row {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-top: 1px solid var(--line);
          }
          .detail-row:first-of-type {
            border-top: none;
          }
          .detail-label {
            color: var(--muted);
            font-size: 14px;
          }
          .detail-value {
            font-weight: 600;
            font-size: 14px;
          }
          .role-badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
          }
          .role-owner { background: rgba(168, 85, 247, 0.2); color: #c084fc; }
          .role-admin { background: rgba(96, 165, 250, 0.2); color: #60a5fa; }
          .role-hr_manager { background: rgba(139, 92, 246, 0.2); color: #8b5cf6; }
          .role-recruiter { background: rgba(245, 158, 11, 0.2); color: #f59e0b; }
          .role-interviewer { background: rgba(148, 163, 184, 0.2); color: #94a3b8; }
          .buttons {
            display: flex;
            gap: 12px;
          }
          .btn {
            flex: 1;
            padding: 14px 24px;
            border-radius: 12px;
            font-weight: 600;
            font-size: 15px;
            cursor: pointer;
            border: none;
            transition: all 0.2s;
          }
          .btn-primary {
            background: linear-gradient(135deg, var(--success), #4c1d95);
            color: white;
          }
          .btn-primary:hover {
            transform: translateY(-1px);
            box-shadow: 0 8px 24px rgba(139, 92, 246, 0.3);
          }
          .btn-secondary {
            background: rgba(255,255,255,0.08);
            color: var(--text);
            border: 1px solid var(--line);
          }
          .btn-secondary:hover {
            background: rgba(255,255,255,0.12);
          }
          .btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
          }
          .spinner {
            display: inline-block;
            width: 16px;
            height: 16px;
            border: 2px solid rgba(255,255,255,0.3);
            border-top-color: white;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
            margin-right: 8px;
          }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
          .back-link {
            display: inline-block;
            margin-bottom: 16px;
            color: var(--muted);
            text-decoration: none;
            font-size: 14px;
          }
          .back-link:hover {
            color: var(--text);
          }
        </style>
      </head>
      <body>
        <div class="grid-overlay"></div>
        
        <div class="container">
          <a href="/organizations" class="back-link">← Back to Organizations</a>
          <div class="card">
            <div class="icon">📧</div>
            <h1>You're Invited!</h1>
            <p class="subtitle">You've been invited to join an organization</p>

            <div class="invite-details">
              <div class="org-name">${matchedInvite.organization.name}</div>
              ${matchedInvite.organization.description ? `<div class="org-desc">${matchedInvite.organization.description}</div>` : ''}

              <div class="detail-row">
                <span class="detail-label">Your Role</span>
                <span class="role-badge role-${matchedInvite.role}">${matchedInvite.role}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">App Access</span>
                <span class="detail-value">${inviteAccessDetail}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Invited By</span>
                <span class="detail-value">${inviterName}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Your Email</span>
                <span class="detail-value">${req.user.email}</span>
              </div>
            </div>

            <div class="buttons">
              <button class="btn btn-secondary" id="declineBtn" onclick="declineInvitation()">
                Decline
              </button>
              <button class="btn btn-primary" id="acceptBtn" onclick="acceptInvitation()">
                Join Organization
              </button>
            </div>
          </div>
        </div>

        <script>
          async function acceptInvitation() {
            const btn = document.getElementById('acceptBtn');
            const declineBtn = document.getElementById('declineBtn');
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner"></span>Joining...';
            if (declineBtn) declineBtn.disabled = true;

            try {
              const response = await fetch('/api/invitations/${token}/accept', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin'
              });

              if (response.ok) {
                const data = await response.json();
                window.location.href = '/organizations/' + data.organization.id + '/members?success=' + encodeURIComponent('Welcome to ' + data.organization.name + '!');
              } else {
                const error = await response.json();
                alert(error.error || 'Failed to join organization');
                btn.disabled = false;
                btn.innerHTML = 'Join Organization';
                if (declineBtn) declineBtn.disabled = false;
              }
            } catch (error) {
              console.error('Error:', error);
              alert('Failed to join organization. Please try again.');
              btn.disabled = false;
              btn.innerHTML = 'Join Organization';
              if (declineBtn) declineBtn.disabled = false;
            }
          }

          async function declineInvitation() {
            const btn = document.getElementById('declineBtn');
            const acceptBtn = document.getElementById('acceptBtn');

            btn.disabled = true;
            btn.innerHTML = '<span class="spinner"></span>Declining...';
            if (acceptBtn) acceptBtn.disabled = true;

            try {
              const response = await fetch('/api/invitations/${token}/reject', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin'
              });

              if (response.ok) {
                window.location.href = '/organizations?success=' + encodeURIComponent('Invitation declined successfully');
              } else {
                const error = await response.json();
                alert(error.error || 'Failed to decline invitation');
                btn.disabled = false;
                btn.innerHTML = 'Decline';
                if (acceptBtn) acceptBtn.disabled = false;
              }
            } catch (error) {
              console.error('Error:', error);
              alert('Failed to decline invitation. Please try again.');
              btn.disabled = false;
              btn.innerHTML = 'Decline';
              if (acceptBtn) acceptBtn.disabled = false;
            }
          }
        </script>
      </body>
      </html>
    `)
  } catch (error) {
    console.error('Accept invitation error:', error)
    res.send(`
      <html><body style="font-family: system-ui; padding: 40px; background: #0f172a; color: #e2e8f0;">
        <h2>Error</h2>
        <p>${error.message || 'Failed to load invitation'}</p>
        <a href="/organizations" style="color: #60a5fa;">Go to Organizations</a>
      </body></html>
    `)
  }
})

// Actually accept the invitation (POST endpoint)
app.post('/invitations/accept/do', getSessionUser, async (req, res) => {
  const { token } = req.query
  if (!token) {
    return res.status(400).json({ error: 'Invalid invitation link' })
  }

  try {
    // Find pending invitations for user's email
    const pendingInvites = await OrganizationInvite.find({
      email: req.user.email.toLowerCase(),
      status: 'pending',
      expiresAt: { $gt: new Date() }
    }).populate('organization', 'name')

    // Find matching invitation
    let matchedInvite = null
    for (const invite of pendingInvites) {
      const isValid = await invite.verifyToken(token)
      if (isValid) {
        matchedInvite = invite
        break
      }
    }

    if (!matchedInvite) {
      return res.status(404).json({ error: 'Invitation not found or expired' })
    }

    // Accept the invitation
    await matchedInvite.accept(req.user._id, req.user.email)

    // Add user to organization
    const organization = await Organization.findById(matchedInvite.organization._id)
    await organization.addMember(
      req.user._id,
      matchedInvite.role,
      matchedInvite.invitedBy,
      normalizeAppAccess(matchedInvite.appAccess)
    )

    invalidateClaimsCache(req.user.sub)

    console.log(`✅ User ${req.user.email} joined organization ${organization.name} as ${matchedInvite.role}`)

    res.json({
      success: true,
      message: `Welcome to ${organization.name}!`,
      redirectUrl: `/organizations/${organization._id}/members?success=Welcome to ${encodeURIComponent(organization.name)}!`
    })
  } catch (error) {
    console.error('Accept invitation error:', error)
    res.status(500).json({ error: error.message || 'Failed to accept invitation' })
  }
})

// Debug route to check SmartHR configuration
app.get('/debug/smarthr', async (req, res) => {
  try {
    const smarthr = getAppById('smarthr')
    res.json({
      found: !!smarthr,
      appId: smarthr?.appId,
      name: smarthr?.name,
      url: smarthr?.url,
      apiUrl: smarthr?.apiUrl,
      clientId: smarthr?.clientId,
      envVars: {
        SMARTHR_API_URL: process.env.SMARTHR_API_URL || 'default: http://localhost:5001',
        SMARTHR_URL: process.env.SMARTHR_URL || 'default: http://localhost:5000'
      }
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Hub Page Renderer
function renderHubPage(account, apps, organizations = []) {
  const currentOrg = organizations.find(o => o.isCurrent)
  const appCards = apps.map(app => `
    <a href="/launch/${app.appId}" class="card app-card ${app.appId === 'smarthr' ? 'app-card--primary' : ''}" style="--app-color: ${app.color || '#2563eb'}">
      <div class="app-card__icon">${getAppIcon(app.icon)}</div>
      <div class="app-card__body">
        <div class="app-card__title">
          ${app.name}
          ${app.badge ? `<span class="app-card__badge">${app.badge}</span>` : ''}
        </div>
        <div class="app-card__desc">${app.description || 'Secure single sign-on'}</div>
        <div class="app-card__meta">
          <span class="pill pill--soft">Instant launch</span>
        </div>
      </div>
      <div class="app-card__arrow">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M5 12h14M12 5l7 7-7 7"/>
        </svg>
      </div>
    </a>
  `).join('')

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>AIIN Hub - Your Apps</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        ${themeCss}
        /* Modal Styles */
        /* Modal Styles (Native Dialog) */


        /* Hub-specific tune-ups: reduce noise + keep clean backdrop */
        body { padding: 28px 18px 48px; }
        body::before { opacity: var(--halo-opacity); }
        body::after { display: none; }
        .hub-content { margin-top: 8px; }
        .hub-hero {
          display: grid;
          grid-template-columns: 1.2fr 0.8fr;
          gap: 14px;
          margin: 14px 0 20px;
        }
        .hub-card { position: relative; }
        .hub-card h1 { margin: 0 0 6px; font-size: 26px; letter-spacing: -0.02em; color: var(--text); }
        .hub-card p { margin: 0; color: var(--muted); font-size: 15px; }
        .hub-card .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
        .hub-card .chip { background: var(--panel-strong); border: 1px solid var(--border); }
        .hub-card .chip.secondary { color: var(--brand-2); }
        .stat { display: flex; align-items: center; gap: 8px; margin-top: 12px; color: var(--text); font-weight: 600; }
        .dot { width: 10px; height: 10px; border-radius: 999px; background: #8b5cf6; box-shadow: 0 0 0 6px rgba(139,92,246,0.14); }

        .apps { width: 100%; display: block; margin-top: 18px; }
        .section-title {
          margin: 22px 0 10px;
          color: var(--text);
          font-weight: 700;
          letter-spacing: -0.01em;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .section-title::after { content: ''; flex: 1; height: 1px; background: var(--border); }

        .ghost-btn {
          padding: 8px 12px;
          border-radius: 10px;
          border: 1px solid var(--border);
          background: var(--panel-strong);
          color: var(--text);
          text-decoration: none;
          font-weight: 600;
          font-size: 13px;
        }
        .ghost-btn:hover { background: var(--hover-bg); }

        .app-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
        .app-card {
          text-decoration: none;
          color: inherit;
          display: grid;
          grid-template-columns: auto 1fr auto;
          align-items: center;
          gap: 12px;
          padding: 16px;
          cursor: pointer;
          transition: box-shadow 0.18s ease, transform 0.18s ease, border-color 0.18s ease, background 0.18s ease;
        }
        .app-card:hover { box-shadow: 0 18px 36px rgba(0,0,0,0.35); transform: translateY(-3px); }
        .app-card--primary { border-color: rgba(129,140,248,0.65); box-shadow: 0 18px 42px rgba(59,130,246,0.22); }
        .app-card--primary:hover { border-color: rgba(129,140,248,0.8); box-shadow: 0 22px 46px rgba(59,130,246,0.32); }
        .app-card__icon {
          width: 46px;
          height: 46px;
          border-radius: 12px;
          background: linear-gradient(135deg, var(--app-color, #2563eb), #ffffff);
          display: grid;
          place-items: center;
          color: #0f172a;
          border: 1px solid rgba(255,255,255,0.18);
        }
        .app-card__icon svg { width: 24px; height: 24px; }
        .app-card__body { display: grid; gap: 6px; }
        .app-card__title { font-weight: 700; font-size: 16px; letter-spacing: -0.01em; color: var(--text); display: flex; align-items: center; gap: 8px; }
        .app-card__badge { 
          font-size: 10px; 
          font-weight: 600; 
          padding: 2px 8px; 
          border-radius: 10px; 
          background: linear-gradient(135deg, #f59e0b, #ef4444); 
          color: white; 
          text-transform: uppercase; 
          letter-spacing: 0.5px;
          box-shadow: 0 2px 4px rgba(245, 158, 11, 0.3);
        }
        .app-card__desc { color: var(--muted); font-size: 13px; }
        .app-card__meta { display: flex; gap: 6px; flex-wrap: wrap; }
        .pill { background: var(--panel-strong); border: 1px solid var(--border); color: var(--text-secondary); }
        .pill--soft { background: var(--hover-bg); color: var(--muted); border-color: var(--border); }
        .app-card__arrow { color: var(--muted); }

        .empty {
          margin-top: 12px;
          padding: 48px 16px;
          text-align: center;
          color: var(--muted);
          border: 1px dashed var(--border);
          border-radius: 14px;
          background: var(--hover-bg);
        }
        @media (max-width: 720px) {
          .hub-hero { grid-template-columns: 1fr; }
          .app-card { grid-template-columns: 1fr auto; }
          .app-card__icon { justify-self: flex-start; }
        }
      </style>
      <script src="/js/theme.js?v=2"></script>
      <script src="/js/invitation-gatekeeper.js"></script>
    </head>
    <body>
      <!-- Mobile Nav Checkbox (CSS-only toggle) -->
      <input type="checkbox" id="mobile-nav-toggle" class="mobile-nav-checkbox">

      <nav class="top-nav">
        <a href="/" class="top-nav-brand">
          ${seemplifyNavLogoImg}
        </a>
        <!-- Mobile Nav Toggle Label -->
        <label for="mobile-nav-toggle" class="mobile-nav-toggle" aria-label="Toggle navigation">
          <span></span>
          <span></span>
          <span></span>
        </label>
        <div class="top-nav-links">
          <a href="/" class="top-nav-link active">Home</a>
          <a href="/organizations" class="top-nav-link">Organizations</a>
          <a href="/invitations/pending" class="top-nav-link">Invitations</a>
          <a href="/profile" class="top-nav-link">Profile</a>
        </div>
        <div class="top-nav-user">
          <div class="theme-dropdown">
            <button onclick="window.ThemeManager.toggleDropdown(event)" class="theme-toggle" aria-label="Toggle theme">
              <svg class="theme-toggle-icon-light" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
              <svg class="theme-toggle-icon-dark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:none;"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            </button>
            <div class="theme-menu" id="theme-menu">
              <button class="theme-option" data-value="light" onclick="window.ThemeManager.setTheme('light')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
                Light
              </button>
              <button class="theme-option" data-value="dark" onclick="window.ThemeManager.setTheme('dark')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
                Dark
              </button>
              <button class="theme-option" data-value="system" onclick="window.ThemeManager.setTheme('system')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                System
              </button>
            </div>
          </div>
          <div class="top-nav-user-info">
            <div class="top-nav-user-name">${account.profile?.name || account.email.split('@')[0]}</div>
            <div class="top-nav-user-email">${account.email}</div>
          </div>
          <a href="/logout" class="top-nav-logout">Sign out</a>
        </div>
      </nav>
      <!-- Mobile Nav Overlay (closes menu when clicked) -->
      <label for="mobile-nav-toggle" class="mobile-nav-overlay"></label>

      <div class="container hub-content">


        <section class="apps">
          <div class="section-title">Manage identity & access</div>
          
          <!-- Unified Organization Card -->
          ${organizations.length > 0 ? `
          <div class="card hub-card" style="padding: 0; margin-bottom: 24px; overflow: hidden; display: flex; flex-direction: column; gap: 0;">
            <!-- Top Strip: Current Org & Switcher -->
            <div style="padding: 24px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border); background: var(--hover-bg);">
              <div style="display: flex; align-items: center; gap: 16px;">
                <div style="width: 48px; height: 48px; border-radius: 12px; background: linear-gradient(135deg, #3b82f6, #8b5cf6); display: grid; place-items: center;">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
                    <path d="M3 21h18M5 21V7l8-4 8 4v14M8 21v-4h8v4" />
                  </svg>
                </div>
                <div>
                  <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin-bottom: 4px;">Current Organization</div>
                  <div style="font-size: 18px; font-weight: 700; color: var(--text);">${currentOrg?.name || 'Select Organization'}</div>
                </div>
              </div>
              
              <div style="display: flex; align-items: center; gap: 12px;">
                ${currentOrg ? `
                  <a href="/organizations/${currentOrg.id}/members" class="ghost-btn">Members</a>
                  <a href="/organizations/${currentOrg.id}/teams" class="ghost-btn">Teams</a>
                  ${['owner', 'admin'].includes(currentOrg.role) ? `
                    <a href="/organizations/${currentOrg.id}/invitations" class="ghost-btn">Invites</a>
                  ` : ''}
                  <div style="width: 1px; height: 24px; background: var(--border); margin: 0 4px;"></div>
                ` : ''}
                <button onclick="openOrgModal()" style="
                  display: flex; align-items: center; gap: 10px; padding: 10px 16px; 
                  background: var(--panel-strong); border: 1px solid var(--border); 
                  border-radius: 8px; color: var(--text); font-weight: 500; font-size: 14px; cursor: pointer;
                  transition: all 0.2s;
                " class="org-switch-btn">
                  <span>Switch organization...</span>
                  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
                </button>
                <div style="padding: 10px 14px; background: var(--panel-strong); border-radius: 8px; border: 1px solid var(--border); display: flex; align-items: center; gap: 8px;">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                    <circle cx="9" cy="7" r="4"></circle>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                  </svg>
                  <span style="font-size: 13px; font-weight: 600; color: var(--text);">${organizations.length} Org${organizations.length === 1 ? '' : 's'}</span>
                </div>
              </div>
            </div>

            <!-- Bottom Strip: Settings & Actions -->
            <div style="padding: 20px 24px; display: flex; align-items: center; justify-content: space-between; background: var(--panel);">
              <div style="display: flex; align-items: center; gap: 14px;">
                <div style="width: 40px; height: 40px; border-radius: 10px; background: rgba(96, 165, 250, 0.1); display: grid; place-items: center;">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2.5">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                    <circle cx="9" cy="7" r="4"></circle>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                  </svg>
                </div>
                <div>
                  <div style="font-weight: 600; color: var(--text); font-size: 15px;">Organization Settings</div>
                  <div style="font-size: 13px; color: var(--muted);">Manage your organization structure and team access</div>
                </div>
              </div>
              
              <div style="display: flex; gap: 8px;">
                <a href="/profile" class="ghost-btn">Profile</a>
                <a href="/organizations" class="ghost-btn">Organizations</a>
                <a href="/invitations/pending" class="ghost-btn">Invitations</a>
              </div>
            </div>
          </div>
          ` : ''}
        </section>

        <section class="apps">
          <div class="section-title">Choose an app to launch with single sign-on</div>
          ${apps.length > 0 ? `
            <div class="app-grid">
              ${appCards}
            </div>
          ` : `
            <div class="empty">
              <div style="margin-bottom:8px;font-weight:700;">No apps available yet</div>
              Add an app to launch it from the hub.
            </div>
          `}
        </section>
      </div>
      
      <!-- Custom Premium Modal -->
      <style>
        .custom-modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.7);
          backdrop-filter: blur(8px);
          z-index: 9999;
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0;
          visibility: hidden;
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .custom-modal-overlay.active {
          opacity: 1;
          visibility: visible;
        }
        .custom-modal {
          background: #1e293b;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 24px;
          width: 90%;
          max-width: 440px;
          box-shadow: 
            0 0 0 1px rgba(0,0,0,0.2), 
            0 20px 60px -10px rgba(0,0,0,0.6);
          transform: scale(0.92) translateY(8px);
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          opacity: 0;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .custom-modal-overlay.active .custom-modal {
          transform: scale(1) translateY(0);
          opacity: 1;
        }
        .custom-modal-header {
          padding: 24px 24px 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .custom-modal-title {
          font-size: 18px;
          font-weight: 700;
          color: #f8fafc;
          letter-spacing: -0.01em;
        }
        .custom-modal-close {
          background: transparent;
          border: none;
          color: #94a3b8;
          cursor: pointer;
          padding: 8px;
          margin: -8px -8px -8px 0;
          border-radius: 99px;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .custom-modal-close:hover {
          background: rgba(255,255,255,0.08);
          color: #fff;
        }
        .custom-modal-body {
          padding: 8px 16px 24px;
          max-height: 60vh;
          overflow-y: auto;
        }
        .org-option-item {
          display: flex;
          align-items: center;
          width: 100%;
          padding: 12px 16px;
          margin-bottom: 4px;
          gap: 14px;
          background: transparent;
          border: 1px solid transparent;
          border-radius: 12px;
          cursor: pointer;
          transition: all 0.15s ease;
          text-align: left;
          position: relative;
        }
        .org-option-item:hover {
          background: rgba(255,255,255,0.04);
        }
        .org-option-item.active {
          background: rgba(59,130,246,0.1);
          border-color: rgba(59,130,246,0.2);
        }
        .org-option-avatar {
          width: 36px;
          height: 36px;
          border-radius: 10px;
          background: #334155;
          display: grid;
          place-items: center;
          font-weight: 700;
          color: #cbd5e1;
          font-size: 14px;
          flex-shrink: 0;
          box-shadow: 0 1px 2px rgba(0,0,0,0.1);
        }
        .org-option-item.active .org-option-avatar {
          background: linear-gradient(135deg, #3b82f6, #60a5fa);
          color: #fff;
          box-shadow: 0 4px 6px -1px rgba(59, 130, 246, 0.3);
        }
        .org-option-info { flex: 1; min-width: 0; }
        .org-option-name { font-weight: 600; color: #e2e8f0; font-size: 15px; margin-bottom: 2px; }
        .org-option-role { font-size: 13px; color: #94a3b8; text-transform: capitalize; }
      </style>

      <div id="customOrgModal" class="custom-modal-overlay">
        <div class="custom-modal" onclick="event.stopPropagation()">
          <div class="custom-modal-header">
            <div class="custom-modal-title">Switch Organization</div>
            <button class="custom-modal-close" onclick="closeCustomOrgModal()">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div class="custom-modal-body">
            ${organizations.map(org => `
              <button onclick="switchOrganization('${org.id}')" class="org-option-item ${org.isCurrent ? 'active' : ''}">
                <div class="org-option-avatar">${org.name.substring(0, 2).toUpperCase()}</div>
                <div class="org-option-info">
                  <div class="org-option-name">${org.name}</div>
                  <div class="org-option-role">${org.role}</div>
                </div>
                ${org.isCurrent ? `
                  <div style="color: #60a5fa;">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>
                  </div>
                ` : ''}
              </button>
            `).join('')}
          </div>
        </div>
      </div>
      <form id="org-switch-form" method="POST" style="display: none;"></form>

      <script>
        function openOrgModal() {
          const modal = document.getElementById('customOrgModal');
          const modalContent = modal.querySelector('.custom-modal');
          modal.classList.add('active');
          
          // Animate backdrop click
          modal.onclick = (e) => {
            if (e.target === modal) closeCustomOrgModal();
          };
          
          document.onkeydown = (e) => {
            if (e.key === 'Escape') closeCustomOrgModal();
          };
        }

        function closeCustomOrgModal() {
          const modal = document.getElementById('customOrgModal');
          modal.classList.remove('active');
          document.onkeydown = null;
        }

        function switchOrganization(orgId) {
          const form = document.getElementById('org-switch-form');
          form.action = '/organizations/' + orgId + '/switch';
          form.submit();
        }
      </script>
    </body>
    </html>
  `
}

// Hub Login Page Renderer
function renderHubLoginPage(req, errorMsg, returnTo = '', pendingInviteInfo = null) {
  const brand = getIdpBrand(req)
  const inviteBanner = pendingInviteInfo ? `
    <div style="
      background: linear-gradient(135deg, rgba(139, 92, 246, 0.15), rgba(99, 102, 241, 0.15));
      border: 1px solid rgba(139, 92, 246, 0.4);
      border-radius: 12px;
      padding: 16px 20px;
      margin-bottom: 20px;
      display: flex;
      align-items: flex-start;
      gap: 12px;
    ">
      <div style="
        width: 40px;
        height: 40px;
        background: linear-gradient(135deg, #8b5cf6, #6366f1);
        border-radius: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      ">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
          <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
        </svg>
      </div>
      <div style="flex: 1;">
        <div style="font-weight: 700; color: #bbf7d0; font-size: 15px; margin-bottom: 4px;">
          📧 You have a pending invitation!
        </div>
        <div style="color: #94a3b8; font-size: 14px; line-height: 1.5;">
          You've been invited to join <strong style="color: #e2e8f0;">${pendingInviteInfo.organizationName}</strong> as <strong style="color: #a5b4fc;">${pendingInviteInfo.role}</strong>.
          <br/>Sign in to accept the invitation.
        </div>
      </div>
    </div>
  ` : ''

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>${brand.name} - Sign in</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <link rel="stylesheet" href="/css/idp-theme.css?v=6">
      <link rel="stylesheet" href="/css/login.css?v=6">
      <script src="/js/theme.js?v=5"></script>
      <style>
        ${brand.cssVars}
      </style>
    </head>
    <body class="${brand.themeClass}">
      <div class="grid-overlay"></div>

      <!-- Theme Toggle -->
      <button class="theme-toggle-btn" onclick="toggleTheme()" title="Toggle theme" aria-label="Toggle theme">
        <svg class="theme-icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="5"/>
          <line x1="12" y1="1" x2="12" y2="3"/>
          <line x1="12" y1="21" x2="12" y2="23"/>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
          <line x1="1" y1="12" x2="3" y2="12"/>
          <line x1="21" y1="12" x2="23" y2="12"/>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
        </svg>
        <svg class="theme-icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none;">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
      </button>

      <div class="login-split">
        <!-- LEFT: Form Panel -->
        <div class="login-form-panel">
          <a href="/" class="login-back-link">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            Back to home
          </a>

          <div class="login-form-inner">
            <div class="login-brand">
              <div class="brand-mark">${brand.logoHtml}</div>
              <span class="login-brand-name">${brand.name}</span>
            </div>

            <h1 class="login-heading">Welcome back</h1>
            <p class="login-subheading">Sign in to access your AIIN workspace.</p>

            ${inviteBanner}
            ${errorMsg ? `<div id="loginError" class="error show" role="alert" aria-live="polite">${errorMsg}</div>` : ''}

            <form id="loginForm" action="/login" method="POST">
              ${returnTo ? `<input type="hidden" name="return_to" value="${returnTo}" />` : ''}
              
              <div class="form-group">
                <label for="email">Email address</label>
                <input type="email" id="email" name="email" placeholder="name@example.com" autocomplete="email" inputmode="email" autocapitalize="none" spellcheck="false" required autofocus ${pendingInviteInfo ? `value="${pendingInviteInfo.email}"` : ''} />
              </div>

              <div class="form-group">
                <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px;">
                  <label for="password" style="margin: 0;">Password</label>
                  <a href="/forgot-password" class="link">Forgot password?</a>
                </div>
                <div class="password-field">
                  <input type="password" id="password" name="password" placeholder="&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;" autocomplete="current-password" required />
                  <button type="button" id="passwordToggle" class="password-toggle" aria-label="Show password" aria-controls="password" aria-pressed="false">
                    <svg class="password-toggle-icon password-toggle-icon--show" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                    <svg class="password-toggle-icon password-toggle-icon--hide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20C5 20 1 12 1 12a21.7 21.7 0 0 1 5.06-6.94M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a21.72 21.72 0 0 1-3.1 4.44M1 1l22 22"/>
                    </svg>
                  </button>
                </div>
                <div id="capsLockHint" class="caps-lock-hint" aria-live="polite"></div>
              </div>

              <div class="muted-row">
                <label>
                  <input type="checkbox" name="remember" value="true" />
                  Remember me
                </label>
              </div>

              <button type="submit" id="submitBtn">
                <span id="btnText">${pendingInviteInfo ? 'Sign in to accept invitation' : 'Sign in'}</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </button>
            </form>

            <div class="divider"><span>or</span></div>

            <div class="signup-link">
              Don't have an account? <a class="link" href="/signup">Create free account</a>
            </div>

            <div class="signup-link" style="margin-top: 12px;">
              Need a guided walkthrough? <a class="link" href="/book-demo">Book a demo</a>
            </div>
          </div>
        </div>

        <!-- RIGHT: Marketing Panel -->
        <div class="login-marketing-panel">
          <div class="marketing-inner">
            <div class="marketing-pill">
              <span class="status-dot"></span>
              ${brand.marketing ? brand.marketing.pill : 'Enterprise-ready &bull; SOC 2 Ready'}
            </div>

            <h2 class="marketing-heading">
              ${brand.marketing ? brand.marketing.heading : 'Your Workforce,<br/><span class="highlight">Supercharged.</span>'}
            </h2>

            <p class="marketing-desc">
              ${brand.marketing ? brand.marketing.desc : `${brand.name} gives your organization a unified identity platform that connects HR, learning, and collaboration tools &mdash; reducing friction while improving security.`}
            </p>

            <div class="feature-cards">
              ${(brand.marketing ? brand.marketing.features : [
                { title: 'Single Sign-On', desc: 'One identity for SmartHR, LMS, Chat, AI Assistant, and all connected apps.', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>', color: 'blue' },
                { title: 'Instant Access', desc: 'Adaptive MFA and session continuity for seamless, secure access across your tools.', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>', color: 'purple' },
                { title: 'Enterprise Security', desc: 'SOC 2 ready with end-to-end encryption, SAML/OIDC, and organization-level controls.', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/></svg>', color: 'accent' }
              ]).map(f => `
              <div class="feature-card">
                <div class="feature-icon feature-icon--${f.color}">
                  ${f.icon}
                </div>
                <div>
                  <div class="feature-title">${f.title}</div>
                  <div class="feature-desc">${f.desc}</div>
                </div>
              </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>

      <script>
        const form = document.getElementById('loginForm');
        const submitBtn = document.getElementById('submitBtn');
        const btnText = document.getElementById('btnText');
        const passwordInput = document.getElementById('password');
        const passwordToggle = document.getElementById('passwordToggle');
        const capsLockHint = document.getElementById('capsLockHint');
        const submitLabel = '${pendingInviteInfo ? 'Sign in to accept invitation' : 'Sign in'}';
        const hasError = ${JSON.stringify(Boolean(errorMsg))};

        if (hasError) {
          const cleanUrl = new URL(window.location.href);
          cleanUrl.searchParams.delete('error');
          window.history.replaceState({}, '', cleanUrl.pathname + cleanUrl.search);
        }

        function setSubmittingState(isSubmitting) {
          if (!submitBtn || !btnText) return;
          submitBtn.disabled = isSubmitting;
          submitBtn.classList.toggle('is-loading', isSubmitting);
          btnText.innerHTML = isSubmitting ? '<span class="spinner"></span>Signing in...' : submitLabel;
        }

        form.addEventListener('submit', (event) => {
          if (submitBtn.disabled) {
            event.preventDefault();
            return;
          }
          setSubmittingState(true);
        });

        window.addEventListener('pageshow', () => {
          setSubmittingState(false);
        });

        if (passwordToggle && passwordInput) {
          passwordToggle.addEventListener('click', () => {
            const shouldShowPassword = passwordInput.type === 'password';
            passwordInput.type = shouldShowPassword ? 'text' : 'password';
            passwordToggle.setAttribute('aria-pressed', shouldShowPassword ? 'true' : 'false');
            passwordToggle.setAttribute('aria-label', shouldShowPassword ? 'Hide password' : 'Show password');
            passwordToggle.classList.toggle('is-visible', shouldShowPassword);
            passwordInput.focus();
          });
        }

        if (passwordInput && capsLockHint) {
          const updateCapsLockHint = (event) => {
            const isCapsLock = Boolean(event.getModifierState && event.getModifierState('CapsLock'));
            capsLockHint.textContent = isCapsLock ? 'Caps Lock is on' : '';
          };

          ['keydown', 'keyup', 'focus', 'blur'].forEach((eventName) => {
            passwordInput.addEventListener(eventName, updateCapsLockHint);
          });
        }

        function toggleTheme() {
          const current = window.ThemeManager?.getTheme() || 'dark';
          const next = current === 'dark' ? 'light' : 'dark';
          window.ThemeManager?.setTheme(next);
          updateThemeIcon(next);
        }

        function updateThemeIcon(theme) {
          const sunIcon = document.querySelector('.theme-icon-sun');
          const moonIcon = document.querySelector('.theme-icon-moon');
          if (!sunIcon || !moonIcon) return;
          if (theme === 'light') {
            sunIcon.style.display = 'none';
            moonIcon.style.display = 'block';
          } else {
            sunIcon.style.display = 'block';
            moonIcon.style.display = 'none';
          }
        }

        // Initialize theme icon on load
        window.addEventListener('DOMContentLoaded', () => {
          const currentTheme = window.ThemeManager?.getTheme() || 'dark';
          updateThemeIcon(currentTheme);
        });
      </script>
    </body>
    </html>
  `
}

// Hub Signup Page Renderer
function renderHubSignupPage(req, errorMsg, attributionValues = {}) {
  const brand = getIdpBrand(req)
  const hiddenAttributionInputs = buildHiddenAttributionInputs(attributionValues)
  const marketingFeatures = brand.marketing ? brand.marketing.features : [
    { title: 'Single Sign-On', desc: `One identity for ${brand.name}, SmartHR, LMS, AI Assistant, and all connected apps.`, icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>', color: 'blue' },
    { title: 'Adaptive Security', desc: 'MFA, session continuity, and SOC 2-ready controls baked in from day one.', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/></svg>', color: 'purple' },
    { title: 'Instant Setup', desc: 'Free trial, no credit card required. Invite your team and start in minutes.', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>', color: 'accent' }
  ]
  const marketingPill = brand.marketing ? brand.marketing.pill : 'Start free &bull; No credit card required'
  const marketingHeading = brand.marketing ? brand.marketing.heading : 'Join the workspace,<br/><span class="highlight">unified.</span>'
  const marketingDesc = brand.marketing ? brand.marketing.desc : `Create your ${brand.name} identity to connect HR, learning, and collaboration tools through one secure account.`

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>${brand.name} - Create account</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <link rel="stylesheet" href="/css/idp-theme.css?v=6">
      <link rel="stylesheet" href="/css/login.css?v=6">
      <script src="/js/theme.js?v=5"></script>
      <style>
        ${brand.cssVars}
      </style>
    </head>
    <body class="${brand.themeClass}">
      <div class="grid-overlay"></div>

      <!-- Theme Toggle -->
      <button class="theme-toggle-btn" onclick="toggleTheme()" title="Toggle theme" aria-label="Toggle theme">
        <svg class="theme-icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="5"/>
          <line x1="12" y1="1" x2="12" y2="3"/>
          <line x1="12" y1="21" x2="12" y2="23"/>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
          <line x1="1" y1="12" x2="3" y2="12"/>
          <line x1="21" y1="12" x2="23" y2="12"/>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
        </svg>
        <svg class="theme-icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none;">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
      </button>

      <div class="login-split">
        <!-- LEFT: Form Panel -->
        <div class="login-form-panel">
          <a href="/" class="login-back-link">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            Back to home
          </a>

          <div class="login-form-inner">
            <div class="login-brand">
              <div class="brand-mark">${brand.logoHtml}</div>
              <span class="login-brand-name">${brand.name}</span>
            </div>

            <h1 class="login-heading">Create your account</h1>
            <p class="login-subheading">One identity for ${brand.name} and every connected app. Free trial included.</p>

            ${errorMsg ? `<div id="signupError" class="error show" role="alert" aria-live="polite">${errorMsg}</div>` : ''}

            <form id="signupForm" action="/signup" method="POST">
              ${hiddenAttributionInputs}

              <div class="form-group">
                <label for="name">Full name <span class="label-hint">(optional)</span></label>
                <input type="text" id="name" name="name" placeholder="Jordan Harper" autocomplete="name" />
              </div>

              <div class="form-group">
                <label for="email">Work email</label>
                <input type="email" id="email" name="email" placeholder="you@company.com" autocomplete="email" inputmode="email" autocapitalize="none" spellcheck="false" required autofocus />
              </div>

              <div class="form-group">
                <label for="password">Password</label>
                <div class="password-field">
                  <input type="password" id="password" name="password" placeholder="Create a strong password" autocomplete="new-password" required minlength="8" />
                  <button type="button" id="passwordToggle" class="password-toggle" aria-label="Show password" aria-controls="password" aria-pressed="false">
                    <svg class="password-toggle-icon password-toggle-icon--show" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                    <svg class="password-toggle-icon password-toggle-icon--hide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20C5 20 1 12 1 12a21.7 21.7 0 0 1 5.06-6.94M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a21.72 21.72 0 0 1-3.1 4.44M1 1l22 22"/>
                    </svg>
                  </button>
                </div>
                <div class="password-strength">
                  <div class="password-strength-bar" id="strengthBar"></div>
                </div>
                <div class="password-hint" id="strengthText">Use 8+ characters with letters, numbers, and symbols.</div>
              </div>

              <div class="form-group">
                <label for="confirmPassword">Confirm password</label>
                <input type="password" id="confirmPassword" name="confirmPassword" placeholder="Re-enter your password" autocomplete="new-password" required />
              </div>

              <button type="submit" id="submitBtn">
                <span id="btnText">Create account</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </button>
            </form>

            <p class="terms-line">By creating an account, you agree to our terms of service and privacy policy.</p>

            <div class="divider"><span>or</span></div>

            <div class="signup-link">
              Already have an account? <a class="link" href="/login">Sign in</a>
            </div>
          </div>
        </div>

        <!-- RIGHT: Marketing Panel -->
        <div class="login-marketing-panel">
          <div class="marketing-inner">
            <div class="marketing-pill">
              <span class="status-dot"></span>
              ${marketingPill}
            </div>

            <h2 class="marketing-heading">
              ${marketingHeading}
            </h2>

            <p class="marketing-desc">
              ${marketingDesc}
            </p>

            <div class="feature-cards">
              ${marketingFeatures.map(f => `
              <div class="feature-card">
                <div class="feature-icon feature-icon--${f.color}">
                  ${f.icon}
                </div>
                <div>
                  <div class="feature-title">${f.title}</div>
                  <div class="feature-desc">${f.desc}</div>
                </div>
              </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>

      <script>
        const form = document.getElementById('signupForm');
        const submitBtn = document.getElementById('submitBtn');
        const btnText = document.getElementById('btnText');
        const passwordInput = document.getElementById('password');
        const confirmPasswordInput = document.getElementById('confirmPassword');
        const strengthBar = document.getElementById('strengthBar');
        const strengthText = document.getElementById('strengthText');
        const passwordToggle = document.getElementById('passwordToggle');
        const hasError = ${JSON.stringify(Boolean(errorMsg))};

        if (hasError) {
          const cleanUrl = new URL(window.location.href);
          cleanUrl.searchParams.delete('error');
          window.history.replaceState({}, '', cleanUrl.pathname + cleanUrl.search);
        }

        function setSubmittingState(isSubmitting) {
          if (!submitBtn || !btnText) return;
          submitBtn.disabled = isSubmitting;
          submitBtn.classList.toggle('is-loading', isSubmitting);
          btnText.innerHTML = isSubmitting ? '<span class="spinner"></span>Creating account...' : 'Create account';
        }

        passwordInput.addEventListener('input', () => {
          const password = passwordInput.value;
          let strength = 0;

          if (password.length >= 8) strength++;
          if (password.length >= 12) strength++;
          if (/[a-z]/.test(password) && /[A-Z]/.test(password)) strength++;
          if (/[0-9]/.test(password)) strength++;
          if (/[^a-zA-Z0-9]/.test(password)) strength++;

          strengthBar.className = 'password-strength-bar';
          if (!password) {
            strengthText.textContent = 'Use 8+ characters with letters, numbers, and symbols.';
            strengthText.style.color = '';
          } else if (strength <= 2) {
            strengthBar.classList.add('strength-weak');
            strengthText.textContent = 'Weak password';
            strengthText.style.color = '#fca5a5';
          } else if (strength <= 3) {
            strengthBar.classList.add('strength-medium');
            strengthText.textContent = 'Medium strength';
            strengthText.style.color = '#fbbf24';
          } else {
            strengthBar.classList.add('strength-strong');
            strengthText.textContent = 'Strong password!';
            strengthText.style.color = '#c4b5fd';
          }
        });

        if (passwordToggle && passwordInput) {
          passwordToggle.addEventListener('click', () => {
            const shouldShowPassword = passwordInput.type === 'password';
            passwordInput.type = shouldShowPassword ? 'text' : 'password';
            passwordToggle.setAttribute('aria-pressed', shouldShowPassword ? 'true' : 'false');
            passwordToggle.setAttribute('aria-label', shouldShowPassword ? 'Hide password' : 'Show password');
            passwordToggle.classList.toggle('is-visible', shouldShowPassword);
            passwordInput.focus();
          });
        }

        form.addEventListener('submit', (e) => {
          if (passwordInput.value !== confirmPasswordInput.value) {
            e.preventDefault();
            alert('Passwords do not match');
            return;
          }
          setSubmittingState(true);
        });

        window.addEventListener('pageshow', () => {
          setSubmittingState(false);
        });

        function toggleTheme() {
          const current = window.ThemeManager?.getTheme() || 'dark';
          const next = current === 'dark' ? 'light' : 'dark';
          window.ThemeManager?.setTheme(next);
          updateThemeIcon(next);
        }

        function updateThemeIcon(theme) {
          const sunIcon = document.querySelector('.theme-icon-sun');
          const moonIcon = document.querySelector('.theme-icon-moon');
          if (!sunIcon || !moonIcon) return;
          if (theme === 'light') {
            sunIcon.style.display = 'none';
            moonIcon.style.display = 'block';
          } else {
            sunIcon.style.display = 'block';
            moonIcon.style.display = 'none';
          }
        }

        window.addEventListener('DOMContentLoaded', () => {
          const currentTheme = window.ThemeManager?.getTheme() || 'dark';
          updateThemeIcon(currentTheme);
        });
      </script>
    </body>
    </html>
  `
}

// App Icon Helper
function getAppIcon(iconName) {
  const icons = {
    briefcase: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>',
    'chart-bar': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>',
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>',
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>',
    'document-text': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>',
    'currency-dollar': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>',
    'academic-cap': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 10l-10-5L2 10l10 5 10-5z"></path><path d="M6 12v5c3 3 9 3 12 0v-5"></path><line x1="22" y1="10" x2="22" y2="16"></line></svg>',
    'chat-bubble-left-right': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>',
    default: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>'
  }

  return icons[iconName] || icons.default
}

// ==============================================================
// PROFILE ROUTES - Employee Self-Service Hub
// ==============================================================

// Register profile API routes
app.use(profileRouter)

function buildProfilePageViewModel(req, currentProfileSection) {
  return {
    user: req.user,
    currentProfileSection,
    activeProfileSection: currentProfileSection,
    profileCompletion: req.profileCompletion || getProfileCompletion(req.user),
    profileCompletionEnforced: false
  }
}

// Profile page GET routes
app.get('/profile/personal', getSessionUser, async (req, res) => {
  try {
    res.render('profile-personal', buildProfilePageViewModel(req, 'personal'))
  } catch (error) {
    console.error('Error loading personal page:', error)
    res.status(500).send('Error loading page')
  }
})

app.get('/profile/tax', getSessionUser, async (req, res) => {
  try {
    res.redirect('/profile/personal')
  } catch (error) {
    console.error('Error loading tax page:', error)
    res.status(500).send('Error loading page')
  }
})

app.get('/profile/banking', getSessionUser, async (req, res) => {
  try {
    res.render('profile-banking', {
      ...buildProfilePageViewModel(req, 'banking'),
      bankJurisdictions: PAYROLL_BANK_JURISDICTIONS,
      nigerianBanks: NIGERIAN_BANK_OPTIONS
    })
  } catch (error) {
    console.error('Error loading banking page:', error)
    res.status(500).send('Error loading page')
  }
})

app.get('/profile/dependents', getSessionUser, async (req, res) => {
  try {
    res.render('profile-dependents', buildProfilePageViewModel(req, 'dependents'))
  } catch (error) {
    console.error('Error loading dependents page:', error)
    res.status(500).send('Error loading page')
  }
})

app.get('/profile/documents', getSessionUser, requireCurrentOrganizationActiveSubscription, async (req, res) => {
  try {
    const currentOrgId = req.user.currentOrganization?._id?.toString() || req.user.currentOrganization?.toString()
    const documentNotificationOrgIds = getOrganizationIdsFromAccount(req.user)
    if (currentOrgId && !documentNotificationOrgIds.includes(currentOrgId)) {
      documentNotificationOrgIds.push(currentOrgId)
    }

    try {
      await markDashboardNotificationViewed({
        accountId: req.user._id,
        type: 'documents',
        organizationIds: documentNotificationOrgIds
      })
    } catch (notificationViewError) {
      console.error('Failed to mark profile documents notification as viewed:', notificationViewError)
    }

    const assignments = await getPersonalOnboardingAssignments(req.user._id, undefined, { workflowType: 'all' })
    const documents = buildProfileDocumentEntries(assignments, req.user)
    const defaultWorkflowFilter = normalizeWorkflowType(req.query.workflow, {
      allowAll: true,
      fallback: 'all'
    })
    const rawStatusFilter = String(req.query.status || '').trim().toLowerCase()
    const defaultStatusFilter = ['all', 'needs_action', 'completed', 'available'].includes(rawStatusFilter)
      ? rawStatusFilter
      : 'all'
    const defaultSearchQuery = String(req.query.search || '').trim()

    res.render('profile-documents', {
      ...buildProfilePageViewModel(req, 'documents'),
      documents,
      workflowLabels: WORKFLOW_LABELS,
      workflowTypes: WORKFLOW_TYPES,
      defaultWorkflowFilter,
      defaultStatusFilter,
      defaultSearchQuery
    })
  } catch (error) {
    console.error('Error loading documents page:', error)
    res.status(500).send('Error loading page')
  }
})

// ==============================================================

// Provider callback MUST come AFTER custom routes
// Wrap provider callback to ensure HTTPS is detected in production
if (isProduction) {
  const providerCallback = provider.callback()
  app.use((req, res, next) => {
    // Ensure x-forwarded-proto is set for Azure
    // This is critical for oidc-provider to generate https:// URLs
    req.headers['x-forwarded-proto'] = 'https'
    providerCallback(req, res, next)
  })
} else {
  app.use(provider.callback())
}

// Global error handlers
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason)
})

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error)
  process.exit(1)
})

// Express error handler
app.use((err, req, res, next) => {
  console.error('❌ Express error:', err)
  console.error('Error stack:', err.stack)

  // If it's an OIDC error, return proper OIDC error response
  if (req.path.startsWith('/auth') || req.path.startsWith('/token')) {
    return res.status(err.statusCode || 500).json({
      error: 'server_error',
      error_description: err.message || 'oops! something went wrong'
    })
  }

  res.status(500).json({
    error: 'server_error',
    error_description: 'oops! something went wrong'
  })
})

app.listen(PORT, async () => {
  const baseUrl = isProduction ? process.env.ISSUER_URL : `http://localhost:${PORT}`
  console.log(`🚀 AIIN Identity Provider running on ${baseUrl}`)
  console.log(`🔐 OIDC discovery: ${baseUrl}/.well-known/openid-configuration`)
  console.log(`📍 Environment: ${isProduction ? 'PRODUCTION' : 'development'}`)
  console.log(`🏢 Organization management: ${baseUrl}/organizations`)

  // Initialize background jobs
  try {
    const defaultTrialPlan = await subscriptionService.ensureDefaultTrialPlan()
    console.log(`✅ Default trial plan ready: ${defaultTrialPlan.name} (${defaultTrialPlan.slug})`)
  } catch (error) {
    console.error('⚠️ Failed to ensure default trial plan:', error)
  }

  try {
    await initializeCleanupJobs()
    console.log('✅ Cleanup jobs initialized')
  } catch (error) {
    console.error('⚠️ Failed to initialize cleanup jobs:', error)
  }

  // Initialize subscription lifecycle jobs (runs every 6 hours)
  try {
    startSubscriptionLifecycleJobs(6)
    console.log('✅ Subscription lifecycle jobs initialized')
  } catch (error) {
    console.error('⚠️ Failed to initialize subscription lifecycle jobs:', error)
  }

  try {
    startCampaignWorker()
    console.log('✅ Campaign worker initialized')
  } catch (error) {
    console.error('⚠️ Failed to initialize campaign worker:', error)
  }
})
