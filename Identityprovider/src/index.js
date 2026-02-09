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
import { Team } from './models/Team.js'
import { Notification } from './models/Notification.js'
import { OnboardingTemplate } from './models/OnboardingTemplate.js'
import { OnboardingAssignment } from './models/OnboardingAssignment.js'
import { getHubApps, getAppById, getAppApiUrl } from './config/hubApps.js'
import bcrypt from 'bcrypt'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import crypto from 'crypto'
import { SignJWT, jwtVerify } from 'jose'
import { emailService } from './services/emailService.js'
import { otpService } from './services/otpService.js'
import { buildOrganizationClaims } from './utils/permissions.js'
import { getTeamClaims } from './utils/teams.js'
import { initializeCleanupJobs } from './jobs/cleanupExpiredInvites.js'
import { startSubscriptionLifecycleJobs } from './jobs/subscriptionLifecycle.js'

// SAML 2.0 Support
import samlRoutes, { setClaimsFunction, setSessionFunction } from './routes/samlRoutes.js'
import { samlIdPService as samlService } from './services/samlService.js'
import { subscriptionService } from './services/subscriptionService.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// =============================================================================
// CLAIMS CACHING - Performance optimization for repeated claims building
// =============================================================================
const claimsCache = new Map()
const CLAIMS_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

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

  const claims = {
    sub: acc.sub,
    email: acc.email,
    email_verified: acc.emailVerified,
    name: acc.profile?.name,
    preferred_username: acc.profile?.preferred_username,
    // Organization claims (with permissions)
    organizations: organizationClaims,
    current_organization: acc.currentOrganization ? {
      id: acc.currentOrganization._id?.toString() || acc.currentOrganization.toString(),
      name: acc.currentOrganization.name
    } : null,
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
        maxTeams: 0
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
          maxTeams: 0
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
        maxTeams: limits.maxTeams
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
        maxTeams: 0
      },
      expiresAt: null,
      isInGracePeriod: false
    }
  }
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
import adminViewsRouter from './routes/adminViews.js'
import publicPlansRouter from './routes/publicPlans.js'
import organizationSubscriptionRouter from './routes/organizationSubscription.js'
import adminUsersRouter from './routes/adminUsers.js'
import profileRouter from './routes/profile.js'

dotenv.config()

// Shared UI theme for IdP pages (marketing-site aesthetic)
const themeCss = readFileSync(join(__dirname, 'public/css/idp-theme.css'), 'utf-8')
const seemplifyMarkSvg = `
  <svg viewBox="0 0 100 100" aria-hidden="true">
    <defs>
      <linearGradient id="seemplifyGradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#3b82f6" />
        <stop offset="50%" stop-color="#8b5cf6" />
        <stop offset="100%" stop-color="#ec4899" />
      </linearGradient>
    </defs>
    <path d="M 65 25 Q 75 25 75 35 Q 75 45 65 45 Q 50 50 35 55 Q 25 55 25 65 Q 25 75 35 75" stroke="url(#seemplifyGradient)" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round" />
    <circle cx="65" cy="25" r="6" fill="#fff" />
    <circle cx="50" cy="50" r="6" fill="#fff" />
    <circle cx="35" cy="75" r="6" fill="#fff" />
  </svg>
`

// Production environment detection
const isProduction = process.env.NODE_ENV === 'production'

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
      grant.addOIDCClaims(['email', 'email_verified', 'name', 'preferred_username', 'organizations', 'teams', 'team_permissions']);

      await grant.save();
      return grant;
    }

    // No session or grant - will trigger login interaction
    return undefined;
  },
  claims: {
    openid: ['sub'],
    email: ['email', 'email_verified'],
    profile: ['name', 'preferred_username', 'organizations', 'teams', 'team_permissions', 'current_organization']
  },
  findAccount: async (ctx, id) => {
    const findAccountStart = Date.now()
    // Use lean() for read-only query - significantly faster
    const acc = await Account.findOne({ sub: id })
      .populate('organizations.organization', 'name')
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

    // Return HTML login form
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>AIIN Identity - Sign in</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link rel="stylesheet" href="/css/idp-theme.css">
        <link rel="stylesheet" href="/css/login.css">
        <script src="/js/theme.js?v=3"></script>
        <style>
          body { visibility: hidden; }
          body.light, body.dark, [data-theme] body { visibility: visible; }
        </style>
      </head>
      <body>
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
                <div class="brand-mark">${seemplifyMarkSvg}</div>
                <span class="login-brand-name">Seemplify</span>
              </div>

              <h1 class="login-heading">Welcome back</h1>
              <p class="login-subheading">Sign in to access your AIIN workspace.</p>

              ${lastLoggedInEmail ? `
              <div id="quickLogin">
                <div class="error" id="errorQuick"></div>
                <div style="background: var(--surface-2, rgba(30,41,59,0.4)); border:1px solid var(--border); padding: 16px; border-radius: 14px; margin-bottom: 14px;">
                  <div style="display: flex; align-items: center; margin-bottom: 12px;">
                    <div style="width: 44px; height: 44px; background: linear-gradient(135deg, #a855f7, #ec4899); border-radius: 12px; display: grid; place-items: center; color: white; font-size: 18px; font-weight: bold; margin-right: 12px;">
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
                Enterprise-ready &bull; SOC 2 Ready
              </div>

              <h2 class="marketing-heading">
                Your Workforce,<br/><span class="highlight">Supercharged.</span>
              </h2>

              <p class="marketing-desc">
                Seemplify gives your organization a unified identity platform that connects HR, learning, and collaboration tools &mdash; reducing friction while improving security.
              </p>

              <div class="feature-cards">
                <div class="feature-card">
                  <div class="feature-icon feature-icon--blue">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                  </div>
                  <div>
                    <div class="feature-title">Single Sign-On</div>
                    <div class="feature-desc">One identity for SmartHR, LMS, Chat, AI Assistant, and all connected apps.</div>
                  </div>
                </div>

                <div class="feature-card">
                  <div class="feature-icon feature-icon--purple">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                  </div>
                  <div>
                    <div class="feature-title">Instant Access</div>
                    <div class="feature-desc">Adaptive MFA and session continuity for seamless, secure access across your tools.</div>
                  </div>
                </div>

                <div class="feature-card">
                  <div class="feature-icon feature-icon--green">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/></svg>
                  </div>
                  <div>
                    <div class="feature-title">Enterprise Security</div>
                    <div class="feature-desc">SOC 2 ready with end-to-end encryption, SAML/OIDC, and organization-level controls.</div>
                  </div>
                </div>
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

    // Handle expired or invalid interaction sessions
    if (err.name === 'SessionNotFound' || err.error === 'invalid_request') {
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Session Expired - AIIN Identity</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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
            }
            .icon { font-size: 64px; margin-bottom: 24px; }
            h1 { font-size: 24px; color: #1a1a1a; margin-bottom: 16px; }
            p { color: #666; margin-bottom: 32px; line-height: 1.6; }
            button { 
              padding: 14px 32px;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
              border: none;
              border-radius: 8px;
              font-size: 16px;
              font-weight: 600;
              cursor: pointer;
              transition: all 0.2s;
            }
            button:hover { 
              transform: translateY(-1px);
              box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="icon">⏱️</div>
            <h1>Session Expired</h1>
            <p>Your login session has expired. This can happen if you waited too long or used an old link. Please start the login process again.</p>
            <button onclick="window.close()">Close Window</button>
          </div>
        </body>
        </html>
      `)
    }

    res.status(500).send('Internal server error')
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

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Create Account - AIIN Identity</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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
        input[type="email"],
        input[type="password"],
        input[type="text"] { 
          width: 100%;
          padding: 14px 16px;
          border: 2px solid #e0e0e0;
          border-radius: 8px;
          font-size: 15px;
          transition: all 0.2s;
        }
        input[type="email"]:focus,
        input[type="password"]:focus,
        input[type="text"]:focus { 
          outline: none;
          border-color: #667eea;
          box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
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
        button { 
          width: 100%;
          padding: 14px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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
          box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
        }
        button:active {
          transform: translateY(0);
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
        .success {
          background: #e8f5e9;
          color: #2e7d32;
          padding: 12px;
          border-radius: 8px;
          font-size: 14px;
          margin-bottom: 16px;
          border: 1px solid #a5d6a7;
          display: none;
        }
        .success.show {
          display: block;
        }
        .divider {
          text-align: center;
          margin: 24px 0;
          position: relative;
        }
        .divider::before {
          content: '';
          position: absolute;
          top: 50%;
          left: 0;
          right: 0;
          height: 1px;
          background: #e0e0e0;
        }
        .divider span {
          background: white;
          padding: 0 16px;
          position: relative;
          color: #999;
          font-size: 14px;
        }
        .login-link {
          text-align: center;
          margin-top: 24px;
          font-size: 14px;
          color: #666;
        }
        .login-link a {
          color: #667eea;
          text-decoration: none;
          font-weight: 600;
        }
        .login-link a:hover {
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
          <div class="logo-icon">✨</div>
          <h1>Create Your Account</h1>
          <p>Join AIIN Identity to get started</p>
        </div>
        
        <form id="signupForm">
          <div class="error" id="error"></div>
          <div class="success" id="success"></div>
          
          <div class="form-group">
            <label for="name">Full Name (Optional)</label>
            <input type="text" id="name" name="name" placeholder="John Doe" />
          </div>
          
          <div class="form-group">
            <label for="email">Email Address</label>
            <input type="email" id="email" name="email" placeholder="you@example.com" required autofocus />
          </div>
          
          <div class="form-group">
            <label for="password">Password</label>
            <input type="password" id="password" name="password" placeholder="Create a strong password" required minlength="8" />
            <div class="password-strength">
              <div class="password-strength-bar" id="strengthBar"></div>
            </div>
            <div class="password-hint" id="strengthText">Use 8+ characters with letters and numbers</div>
          </div>
          
          <div class="form-group">
            <label for="confirmPassword">Confirm Password</label>
            <input type="password" id="confirmPassword" name="confirmPassword" placeholder="Re-enter your password" required />
          </div>
          
          <button type="submit" id="submitBtn">
            <span id="btnText">Create Account</span>
          </button>
        </form>
        
        <div class="divider"><span>or</span></div>
        
        <div class="login-link">
          Already have an account? <a href="/interaction/${uid}">Sign in</a>
        </div>
      </div>
      
      <script>
        const form = document.getElementById('signupForm');
        const errorDiv = document.getElementById('error');
        const successDiv = document.getElementById('success');
        const submitBtn = document.getElementById('submitBtn');
        const btnText = document.getElementById('btnText');
        const passwordInput = document.getElementById('password');
        const confirmPasswordInput = document.getElementById('confirmPassword');
        const strengthBar = document.getElementById('strengthBar');
        const strengthText = document.getElementById('strengthText');
        
        // Show error message if present
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
          
          // Show loading state
          submitBtn.disabled = true;
          btnText.innerHTML = '<span class="spinner"></span>Creating account...';
          errorDiv.classList.remove('show');
          successDiv.classList.remove('show');
          
          const formData = new FormData(e.target);
          
          // Create hidden form to allow browser to follow redirects
          const hiddenForm = document.createElement('form');
          hiddenForm.method = 'POST';
          hiddenForm.action = '/interaction/${uid}/signup';
          
          const emailInput = document.createElement('input');
          emailInput.type = 'hidden';
          emailInput.name = 'email';
          emailInput.value = formData.get('email');
          hiddenForm.appendChild(emailInput);
          
          const passwordInputField = document.createElement('input');
          passwordInputField.type = 'hidden';
          passwordInputField.name = 'password';
          passwordInputField.value = formData.get('password');
          hiddenForm.appendChild(passwordInputField);
          
          const nameInput = document.createElement('input');
          nameInput.type = 'hidden';
          nameInput.name = 'name';
          nameInput.value = formData.get('name') || '';
          hiddenForm.appendChild(nameInput);
          
          document.body.appendChild(hiddenForm);
          hiddenForm.submit();
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
    console.log('📝 Signup attempt for:', req.body.email)
    const { email, password, name } = req.body

    // Check if user already exists
    const existing = await Account.findOne({ email })
    if (existing) {
      console.log('❌ Account already exists:', email)
      return res.redirect(`/signup/${req.params.uid}?error=account_exists`)
    }

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
      security: {}
    })

    console.log(`✅ New account created (unverified): ${email}`)

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
      res.redirect(`/signup/${req.params.uid}?error=signup_failed`)
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
      <title>Verify Email - AIIN Identity</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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
          box-shadow: 0 10px 40px rgba(0,0,0,0.1);
          width: 100%;
          max-width: 480px;
        }
        .logo { text-align: center; margin-bottom: 32px; }
        .logo-icon { font-size: 64px; margin-bottom: 16px; }
        h1 { font-size: 28px; color: #1a202c; margin-bottom: 8px; }
        p { color: #718096; font-size: 16px; line-height: 1.5; margin-bottom: 24px; }
        .form-group { margin-bottom: 24px; }
        label { display: block; color: #4a5568; font-weight: 500; margin-bottom: 8px; }
        input {
          width: 100%;
          padding: 14px;
          border: 2px solid #e2e8f0;
          border-radius: 8px;
          font-size: 16px;
          transition: all 0.2s;
          text-align: center;
          letter-spacing: 8px;
          font-weight: bold;
          font-size: 24px;
        }
        input:focus {
          outline: none;
          border-color: #667eea;
          box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }
        button {
          width: 100%;
          padding: 14px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: opacity 0.2s;
        }
        button:hover:not(:disabled) { opacity: 0.9; }
        button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .error {
          background: #fee;
          color: #c33;
          padding: 12px;
          border-radius: 8px;
          margin-bottom: 16px;
          font-size: 14px;
        }
        .success {
          background: #efe;
          color: #3c3;
          padding: 12px;
          border-radius: 8px;
          margin-bottom: 16px;
          font-size: 14px;
          display: none;
        }
        .success.show { display: block; }
        .resend-link {
          text-align: center;
          margin-top: 16px;
          font-size: 14px;
          color: #718096;
        }
        .resend-link a {
          color: #667eea;
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
      <title>Forgot Password - AIIN Identity</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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
          color: #333;
        }
        input[type="email"] { 
          width: 100%;
          padding: 14px 16px;
          border: 2px solid #e0e0e0;
          border-radius: 8px;
          font-size: 15px;
          transition: all 0.2s;
        }
        input[type="email"]:focus { 
          outline: none;
          border-color: #667eea;
          box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }
        button { 
          width: 100%;
          padding: 14px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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
          box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
        }
        button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none;
        }
        .success { 
          background: #e8f5e9;
          color: #2e7d32;
          padding: 12px;
          border-radius: 8px;
          font-size: 14px;
          margin-bottom: 16px;
          border: 1px solid #a5d6a7;
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
          color: #667eea;
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
      <title>Password Reset Successful - AIIN Identity</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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
          box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="icon">✅</div>
        <h1>Password Reset Successful!</h1>
        <p>Your password has been changed successfully. You can now sign in with your new password.</p>
        <a href="${ISSUER_URL}" style="padding: 14px 32px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; text-decoration: none; display: inline-block;">
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
      <title>Reset Password - AIIN Identity</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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
          border-color: #667eea;
          box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }
        button { 
          width: 100%;
          padding: 14px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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
          box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
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
          color: #667eea;
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

// Public Plans Page - View available subscription plans
app.get('/plans', async (req, res) => {
  try {
    const sessionAccount = await getSessionFromCookies(req)
    const plans = await subscriptionService.getPublicPlans()

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

    // Get all active apps and add iconSvg for the template
    const apps = getHubApps().map(app => ({
      ...app,
      iconSvg: getAppIcon(app.icon)
    }))

    const pendingOnboardingAssignments = await OnboardingAssignment.find({
      member: account._id,
      status: { $nin: ['completed', 'cancelled'] }
    })
      .populate('organization', 'name')
      .sort({ createdAt: -1 })
      .lean()

    // Render the hub homepage using EJS template
    res.render('home', {
      user: account,
      apps,
      organizations,
      pendingOnboardingCount: pendingOnboardingAssignments.length,
      pendingOnboardingAssignments,
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

  res.send(renderHubLoginPage(errorMsg, returnTo, pendingInviteInfo))
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

    // Redirect to return_to URL if provided (e.g., for invitation acceptance), otherwise home
    if (return_to && return_to.startsWith('/')) {
      console.log('Redirecting to return_to:', return_to)
      res.redirect(return_to)
    } else {
      res.redirect('/')
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

  res.send(renderHubSignupPage(errorMsg))
})

// Hub Signup Handler
app.post('/signup', async (req, res) => {
  try {
    const { email, password, name } = req.body

    // Check if account exists
    const existing = await Account.findOne({ email })
    if (existing) {
      return res.redirect('/signup?error=account_exists')
    }

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
      security: {}
    })

    console.log('Hub signup successful (unverified):', email)

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
    res.redirect('/signup?error=signup_failed')
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
    res.redirect('/login')
  } catch (err) {
    console.error('Hub logout error:', err)
    res.redirect('/login')
  }
})


// Hub App Launch - Creates SSO token and redirects to app's auth endpoint
// Supports both OIDC and SAML based on app.authType
app.get('/launch/:appId', async (req, res) => {
  const launchStartTime = Date.now()
  try {
    const { appId } = req.params

    const sessionStart = Date.now()
    const account = await getSessionFromCookies(req)
    console.log(`⏱️ Hub session lookup took ${Date.now() - sessionStart}ms`)

    if (!account) {
      return res.redirect('/login')
    }

    const app = getAppById(appId)
    if (!app) {
      return res.status(404).send('App not found')
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
      console.warn(`⚠️ No subscription feature mapping for appId: ${appId} - subscription check skipped`)
    }
    if (featureKey && account.currentOrganization) {
      const orgId = account.currentOrganization._id?.toString() || account.currentOrganization.toString()
      const canAccess = await subscriptionService.canAccessApp(orgId, featureKey)

      if (!canAccess) {
        console.log(`🚫 Subscription check failed for ${account.email} - ${appId} (feature: ${featureKey})`)
        return res.render('subscription-required', {
          appName: app.name,
          organization: account.currentOrganization,
          user: account
        })
      }
    }

    console.log('🚀 Launching app from hub:')
    console.log('  App ID:', app.appId)
    console.log('  App Name:', app.name)
    console.log('  Auth Type:', app.authType || 'oidc')
    console.log('  User:', account.email)

    // Check if app uses SAML authentication
    if (app.authType === 'saml') {
      // For SAML apps, redirect directly to the SAML SSO endpoint
      // The user is already authenticated (we have their session), so SAML will generate assertion
      const samlSsoUrl = `/saml/sso?sp=${app.appId}`
      console.log('  📍 SAML SSO REDIRECT TO:', samlSsoUrl)
      console.log(`⏱️ Total hub launch time: ${Date.now() - launchStartTime}ms`)
      return res.redirect(samlSsoUrl)
    }

    // Check if app uses direct link (no SSO)
    if (app.authType === 'direct') {
      // For direct apps, just redirect to the app URL - no SSO integration
      console.log('  📍 DIRECT REDIRECT TO:', app.url)
      console.log(`⏱️ Total hub launch time: ${Date.now() - launchStartTime}ms`)
      return res.redirect(app.url)
    }

    // Special handling for Outline - it uses direct OIDC, not backend-initiated
    if (app.appId === 'outline') {
      // Outline handles OIDC at /auth/oidc - redirect there directly
      const outlineAuthUrl = `${app.url}/auth/oidc`
      console.log('  📍 OUTLINE OIDC REDIRECT TO:', outlineAuthUrl)
      console.log(`⏱️ Total hub launch time: ${Date.now() - launchStartTime}ms`)
      return res.redirect(outlineAuthUrl)
    }

    // Special handling for Open WebUI - it uses direct OIDC, not backend-initiated
    if (app.appId === 'openwebui') {
      // Open WebUI handles OIDC at /oauth/oidc/login - redirect there directly
      const openwebuiAuthUrl = `${app.url}/oauth/oidc/login`
      console.log('  📍 OPEN WEBUI OIDC REDIRECT TO:', openwebuiAuthUrl)
      console.log(`⏱️ Total hub launch time: ${Date.now() - launchStartTime}ms`)
      return res.redirect(openwebuiAuthUrl)
    }

    // Zulip uses a single realm instance with multi-org support via OIDC claims
    // The current_organization claim determines which organization the user accesses
    if (app.appId === 'zulip') {
      const zulipUrl = 'https://chat.seemplifyai.com/login/oidc/?next=/'
      console.log('  🔗 Redirecting to Zulip:', zulipUrl)
      console.log('  🏢 Organization context will be determined by OIDC claims')
      console.log(`⏱️ Total hub launch time: ${Date.now() - launchStartTime}ms`)
      return res.redirect(zulipUrl)
    }

    // Special handling for LMS - Frappe uses Social Login Key for OIDC
    // We need to redirect to the IDP's OAuth authorization endpoint with proper parameters
    // Frappe will handle the callback at /api/method/frappe.integrations.oauth2_logins.custom/Seemplify
    if (app.appId === 'lms') {
      // Generate SSO token to enable auto-login from hub session
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
        .setExpirationTime('5m') // Short-lived token
        .sign(secretKey)

      // Build the OAuth authorization URL with proper parameters
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
        state: state,
        hub_token: hubToken // Include SSO token for auto-login
      })

      const lmsAuthUrl = `${process.env.ISSUER_BASE_URL || 'https://auth.seemplifyai.com'}/auth?${authParams.toString()}`
      console.log('  📍 LMS OAUTH REDIRECT TO:', lmsAuthUrl)
      console.log('  🔑 Hub SSO token included for auto-login')
      console.log(`⏱️ Total hub launch time: ${Date.now() - launchStartTime}ms`)
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
      .setExpirationTime('5m') // Short-lived token
      .sign(secretKey)

    // Build the redirect URL to the app's backend OIDC start
    // Use app-specific API URL based on appId
    let apiUrl;
    switch (app.appId) {
      case 'smarthr':
        apiUrl = process.env.SMARTHR_API_URL || 'http://localhost:5001';
        break;
      case 'leave-management':
        apiUrl = process.env.LEAVE_MANAGEMENT_API_URL || 'http://localhost:5002';
        break;
      case 'performance-management':
        apiUrl = process.env.PERFORMANCE_MANAGEMENT_API_URL || 'http://localhost:5004';
        break;
      case 'payroll-management':
        apiUrl = process.env.PAYROLL_MANAGEMENT_API_URL || 'http://localhost:5006';
        break;
      case 'time-attendance':
        apiUrl = process.env.TIME_ATTENDANCE_API_URL || 'https://api-time.seemplifyai.com';
        break;
      default:
        // Fallback to smarthr API URL for unknown apps
        apiUrl = process.env.SMARTHR_API_URL || 'http://localhost:5001';
    }

    const frontendUrl = app.url

    // Construct the OIDC start URL with SSO token
    const redirectUrl = `${apiUrl}/api/auth/oidc/start?` + new URLSearchParams({
      idp_initiated: 'true',
      hub_token: ssoToken,
      returnTo: frontendUrl
    }).toString()

    console.log('  📍 OIDC REDIRECT TO:', redirectUrl)
    console.log(`⏱️ Total hub launch time: ${Date.now() - launchStartTime}ms`)

    res.redirect(redirectUrl)
  } catch (err) {
    console.error('App launch error:', err)
    res.status(500).send('Failed to launch app')
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
          if (req.user) return next()
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
  next()
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

const buildPersonalOnboardingQuery = (userId, organizationId) => {
  const base = {
    $or: [
      { member: userId },
      { 'items.config.signers.member': userId },
      { 'items.data.esign.signers.member': userId }
    ]
  }

  if (organizationId) {
    base.organization = organizationId
  }

  return base
}

const getPersonalOnboardingAssignments = async (userId, organizationId) => {
  return OnboardingAssignment.find(buildPersonalOnboardingQuery(userId, organizationId))
    .populate('organization', 'name')
    .sort({ createdAt: -1 })
}

const loadOnboardingAdminContext = async (req, organizationId) => {
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

  const templates = await OnboardingTemplate.find({ organization: organizationId }).sort({ createdAt: -1 })
  const assignments = await OnboardingAssignment.find({ organization: organizationId })
    .populate('member', 'email profile.name')
    .populate('createdBy', 'email profile.name')
    .sort({ createdAt: -1 })

  const members = organization.members
    .filter(m => m.status === 'active')
    .map(m => ({
      id: m.account?._id || m.account,
      name: m.account?.profile?.name || m.account?.email?.split('@')[0] || 'Unknown',
      email: m.account?.email || '',
      role: m.role
    }))

  const onboardingStatusByMember = {}
  assignments.forEach(assignment => {
    const memberId = assignment.member?._id?.toString() || assignment.member?.toString()
    if (!memberId) return
    if (!onboardingStatusByMember[memberId]) {
      onboardingStatusByMember[memberId] = assignment.status
    }
  })

  return {
    organization,
    templates,
    assignments,
    members,
    onboardingStatusByMember,
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
app.use('/api/admin/plans', adminPlansRouter)
app.use('/api/admin/subscription-requests', adminSubscriptionRequestsRouter)
app.use('/api/admin/subscriptions', adminSubscriptionsRouter)
app.use('/api/admin/users', adminUsersRouter)
app.use('/api/plans', publicPlansRouter)
app.use('/api/organizations', organizationSubscriptionRouter)

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

// Profile page
app.get('/profile', getSessionUser, async (req, res) => {
  try {
    res.render('profile', {
      user: req.user,
      error: req.query.error,
      success: req.query.success
    })
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

    const onboardingStatusByMember = {}
    assignments.forEach(assignment => {
      const memberId = assignment.member?.toString()
      if (!memberId) return
      if (!onboardingStatusByMember[memberId]) {
        onboardingStatusByMember[memberId] = assignment.status
      }
    })

    const mappedMembers = organization.members
      .filter(m => m.status === 'active')
      .map(m => ({
        id: m.account?._id || m.account,
        name: m.account?.profile?.name || m.account?.profile?.preferred_username || m.account?.email?.split('@')[0] || 'Unknown',
        email: m.account?.email || '',
        role: m.role,
        joinedAt: m.joinedAt,
        isOwner: m.role === 'owner',
        onboardingStatus: onboardingStatusByMember[(m.account?._id || m.account).toString()] || 'not_started'
      }))

    res.render('members', {
      organization,
      members: mappedMembers,
      yourRole: member.role,
      ownerCount: organization.getOwnerCount(),
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

    const member = organization.members.find(
      m => m.account.toString() === req.user._id.toString() && m.status === 'active'
    )

    if (!member || !['owner', 'admin'].includes(member.role)) {
      return res.redirect('/organizations?error=Admin or owner role required')
    }

    const invitations = await OrganizationInvite.find({
      organization: req.params.orgId,
      status: 'pending',
      expiresAt: { $gt: new Date() }
    }).populate('invitedBy', 'email profile.name')

    res.render('invitations', {
      organization,
      invitations,
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
    const adminContext = await loadOnboardingAdminContext(req, req.params.orgId)
    const personalAssignments = await getPersonalOnboardingAssignments(req.user._id, req.params.orgId)

    res.render('onboarding-admin', {
      ...adminContext,
      personalAssignments,
      defaultTemplateId: adminContext.templates.find(t => t.isDefault)?._id?.toString() || null,
      activePage: 'organizations',
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

// View onboarding documents (uses PDF.js viewer so Cloudinary raw PDFs render correctly in-app)
app.get('/onboarding/assignments/:assignmentId/items/:itemId/document', getSessionUser, async (req, res) => {
  try {
    const assignment = await OnboardingAssignment.findById(req.params.assignmentId)
      .populate('organization', 'name')

    if (!assignment) {
      return res.redirect('/onboarding?error=Document not found')
    }

    const item = assignment.items.id(req.params.itemId)
    if (!item || !['esign', 'upload'].includes(item.type)) {
      return res.redirect('/onboarding?error=Document not found')
    }

    const organizationId = assignment.organization?._id || assignment.organization
    const organization = await Organization.findById(organizationId).select('members')

    const userIdStr = req.user._id.toString()
    const member = organization?.members?.find(
      m => m.account.toString() === userIdStr && m.status === 'active'
    )

    const isManager = !!(member && ONBOARDING_MANAGER_ROLES.includes(member.role))

    const isAssignee = assignment.member?.toString() === userIdStr
    const isConfiguredSigner = item.type === 'esign'
      ? (item.config?.signers || []).some(signer => signer?.member?.toString() === userIdStr)
      : false
    const isSignerInStatus = item.type === 'esign'
      ? (item.data?.esign?.signers || []).some(signer => signer?.member?.toString() === userIdStr)
      : false

    const backParam = (req.query.back || '').toString()
    // Only allow same-site paths. Disallow protocol-relative URLs like "//evil.com".
    const safeBackUrl = backParam && backParam.startsWith('/') && !backParam.startsWith('//') ? backParam : null
    const defaultBackUrl = isManager
      ? `/organizations/${organizationId.toString()}/onboarding`
      : '/onboarding'
    const backUrl = safeBackUrl || defaultBackUrl

    if (!isManager && !isAssignee && !(isConfiguredSigner || isSignerInStatus)) {
      return res.status(403).render('document-viewer', {
        user: req.user,
        activePage: isManager ? 'organizations' : 'onboarding',
        title: 'Unauthorized',
        subtitle: 'You do not have access to this document.',
        docUrl: null,
        docType: 'unknown',
        backUrl
      })
    }

    let docUrl = null
    let docType = 'pdf'
    let subtitle = 'Document'

    if (item.type === 'esign') {
      const version = (req.query.version || '').toString().toLowerCase()
      const originalUrl = item.config?.document?.url
      const signedUrl = item.data?.esign?.signedUrl
      docUrl = version === 'original' ? originalUrl : (signedUrl || originalUrl)
      subtitle = version === 'original'
        ? 'Original document'
        : (signedUrl ? 'Signed document' : 'Document')
      docType = 'pdf'
    } else if (item.type === 'upload') {
      const upload = item.data?.upload || {}
      docUrl = upload.url
      const mimeType = (upload.mimeType || '').toString().toLowerCase()
      const fileName = (upload.fileName || '').toString().toLowerCase()
      const isPdf = mimeType.includes('pdf') || fileName.endsWith('.pdf')
      const isImage = mimeType.startsWith('image/') || /\.(png|jpg|jpeg|gif|webp)$/.test(fileName)
      docType = isPdf ? 'pdf' : (isImage ? 'image' : 'unknown')
      subtitle = 'Uploaded document'
    }

    if (!docUrl) {
      return res.redirect('/onboarding?error=Document is not available')
    }

    res.render('document-viewer', {
      user: req.user,
      activePage: isManager ? 'organizations' : 'onboarding',
      title: item.title || 'Document',
      subtitle,
      docUrl,
      docType,
      backUrl
    })
  } catch (error) {
    console.error('Onboarding document viewer error:', error)
    res.redirect('/onboarding?error=Failed to load document')
  }
})

// Employee onboarding page
app.get('/onboarding', getSessionUser, async (req, res) => {
  try {
    const currentOrgId = req.user.currentOrganization?._id?.toString() || req.user.currentOrganization?.toString()

    if (currentOrgId) {
      try {
        const adminContext = await loadOnboardingAdminContext(req, currentOrgId)
        const personalAssignments = await getPersonalOnboardingAssignments(req.user._id, currentOrgId)

        return res.render('onboarding-admin', {
          ...adminContext,
          personalAssignments,
          defaultTemplateId: adminContext.templates.find(t => t.isDefault)?._id?.toString() || null,
          activePage: 'onboarding',
          user: req.user,
          error: req.query.error,
          success: req.query.success
        })
      } catch (adminError) {
        // Fall back to personal onboarding view if user isn't an admin/HR in the current org
      }
    }

    const assignments = await getPersonalOnboardingAssignments(req.user._id)

    res.render('onboarding', {
      assignments,
      user: req.user,
      error: req.query.error,
      success: req.query.success
    })
  } catch (error) {
    console.error('Onboarding page error:', error)
    res.redirect('/?error=Failed to load onboarding')
  }
})

app.get('/organizations/:orgId/teams', getSessionUser, async (req, res) => {
  try {
    const organization = await Organization.findById(req.params.orgId)
    if (!organization) {
      return res.redirect('/organizations?error=Organization not found')
    }

    const member = organization.members.find(
      m => m.account.toString() === req.user._id.toString() && m.status === 'active'
    )

    if (!member) {
      return res.redirect('/organizations?error=Not a member of this organization')
    }

    const teams = await Team.find({ organization: req.params.orgId })
      .populate('manager', 'email profile.name')
      .populate('members.account', 'email profile.name')
      .populate('parentTeam', 'name')
      .sort({ name: 1 })

    // Get all organization members for adding to teams
    const orgMembers = await Account.find({
      _id: { $in: organization.members.filter(m => m.status === 'active').map(m => m.account) }
    }).select('email profile.name')

    res.render('teams', {
      organization,
      teams: teams.map(t => ({
        id: t._id.toString(),
        name: t.name,
        description: t.description,
        parentTeam: t.parentTeam ? {
          id: t.parentTeam._id.toString(),
          name: t.parentTeam.name
        } : null,
        manager: t.manager ? {
          id: t.manager._id.toString(),
          email: t.manager.email,
          name: t.manager.profile?.name
        } : null,
        members: t.members.filter(m => m.status === 'active').map(m => ({
          id: m.account._id.toString(),
          email: m.account.email,
          name: m.account.profile?.name,
          role: m.role
        })),
        memberCount: t.memberCount
      })),
      orgMembers: orgMembers.map(m => ({
        id: m._id.toString(),
        email: m.email,
        name: m.profile?.name
      })),
      yourRole: member.role,
      user: req.user,
      error: req.query.error,
      success: req.query.success
    })
  } catch (error) {
    console.error('Teams page error:', error)
    res.redirect('/organizations?error=Failed to load teams')
  }
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

    res.render('pending-invitations', {
      invitations: invitations.map(inv => ({
        id: inv._id.toString(),
        organization: {
          id: inv.organization._id.toString(),
          name: inv.organization.name,
          description: inv.organization.description
        },
        role: inv.role,
        invitedBy: {
          email: inv.invitedBy?.email,
          name: inv.invitedBy?.profile?.name
        },
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
            --success: #22c55e;
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
            background: linear-gradient(135deg, var(--success), #16a34a);
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
          .role-hr_manager { background: rgba(34, 197, 94, 0.2); color: #22c55e; }
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
            background: linear-gradient(135deg, var(--success), #16a34a);
            color: white;
          }
          .btn-primary:hover {
            transform: translateY(-1px);
            box-shadow: 0 8px 24px rgba(34, 197, 94, 0.3);
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
                <span class="detail-label">Invited By</span>
                <span class="detail-value">${inviterName}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Your Email</span>
                <span class="detail-value">${req.user.email}</span>
              </div>
            </div>

            <div class="buttons">
              <button class="btn btn-secondary" onclick="window.location.href='/organizations'">
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
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner"></span>Joining...';

            try {
              const response = await fetch('/invitations/accept/do?token=${token}', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
              });

              if (response.ok) {
                const data = await response.json();
                window.location.href = data.redirectUrl || '/organizations';
              } else {
                const error = await response.json();
                alert(error.error || 'Failed to join organization');
                btn.disabled = false;
                btn.innerHTML = 'Join Organization';
              }
            } catch (error) {
              console.error('Error:', error);
              alert('Failed to join organization. Please try again.');
              btn.disabled = false;
              btn.innerHTML = 'Join Organization';
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
    await organization.addMember(req.user._id, matchedInvite.role, matchedInvite.invitedBy)

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
        .dot { width: 10px; height: 10px; border-radius: 999px; background: #22c55e; box-shadow: 0 0 0 6px rgba(34,197,94,0.14); }

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
          ${seemplifyMarkSvg}
          <span>Seemplify</span>
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
function renderHubLoginPage(errorMsg, returnTo = '', pendingInviteInfo = null) {
  const inviteBanner = pendingInviteInfo ? `
    <div style="
      background: linear-gradient(135deg, rgba(34, 197, 94, 0.15), rgba(59, 130, 246, 0.15));
      border: 1px solid rgba(34, 197, 94, 0.4);
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
        background: linear-gradient(135deg, #22c55e, #3b82f6);
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
      <title>AIIN Hub - Sign in</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <link rel="stylesheet" href="/css/login.css">
      <style>
        ${themeCss}
      </style>
      <script src="/js/theme.js?v=3"></script>
    </head>
    <body>
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
              <div class="brand-mark">${seemplifyMarkSvg}</div>
              <span class="login-brand-name">Seemplify</span>
            </div>

            <h1 class="login-heading">Welcome back</h1>
            <p class="login-subheading">Sign in to access your AIIN workspace.</p>

            ${inviteBanner}
            ${errorMsg ? `<div class="error show">${errorMsg}</div>` : ''}

            <form id="loginForm" action="/login" method="POST">
              ${returnTo ? `<input type="hidden" name="return_to" value="${returnTo}" />` : ''}
              
              <div class="form-group">
                <label for="email">Email address</label>
                <input type="email" id="email" name="email" placeholder="name@example.com" required autofocus ${pendingInviteInfo ? `value="${pendingInviteInfo.email}"` : ''} />
              </div>

              <div class="form-group">
                <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px;">
                  <label for="password" style="margin: 0;">Password</label>
                  <a href="/forgot-password" class="link">Forgot password?</a>
                </div>
                <input type="password" id="password" name="password" placeholder="••••••••" required />
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
          </div>
        </div>

        <!-- RIGHT: Marketing Panel -->
        <div class="login-marketing-panel">
          <div class="marketing-inner">
            <div class="marketing-pill">
              <span class="status-dot"></span>
              Enterprise-ready &bull; SOC 2 Ready
            </div>

            <h2 class="marketing-heading">
              Your Workforce,<br/><span class="highlight">Supercharged.</span>
            </h2>

            <p class="marketing-desc">
              Seemplify gives your organization a unified identity platform that connects HR, learning, and collaboration tools &mdash; reducing friction while improving security.
            </p>

            <div class="feature-cards">
              <div class="feature-card">
                <div class="feature-icon feature-icon--blue">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                  </svg>
                </div>
                <div>
                  <div class="feature-title">Single Sign-On</div>
                  <div class="feature-desc">One identity for SmartHR, LMS, Chat, AI Assistant, and all connected apps.</div>
                </div>
              </div>

              <div class="feature-card">
                <div class="feature-icon feature-icon--purple">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
                  </svg>
                </div>
                <div>
                  <div class="feature-title">Instant Access</div>
                  <div class="feature-desc">Adaptive MFA and session continuity for seamless, secure access across your tools.</div>
                </div>
              </div>

              <div class="feature-card">
                <div class="feature-icon feature-icon--green">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M9 12l2 2 4-4"/>
                  </svg>
                </div>
                <div>
                  <div class="feature-title">Enterprise Security</div>
                  <div class="feature-desc">SOC 2 ready with end-to-end encryption, SAML/OIDC, and organization-level controls.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <script>
        const form = document.getElementById('loginForm');
        const submitBtn = document.getElementById('submitBtn');
        const btnText = document.getElementById('btnText');

        form.addEventListener('submit', () => {
          submitBtn.disabled = true;
          btnText.innerHTML = '<span class="spinner"></span>Signing in...';
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

        // Initialize theme icon on load
        window.addEventListener('DOMContentLoaded', () => {
          const currentTheme = window.ThemeManager?.getTheme() || 'dark';
          updateThemeIcon(currentTheme);
        });
      </script>
}

// Hub Signup Page Renderer
function renderHubSignupPage(errorMsg) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>AIIN Hub - Create account</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        ${themeCss}
        body {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 32px 18px;
          position: relative;
        }
        .shell {
          position: relative;
          z-index: 1;
          width: min(1080px, 100%);
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
          align-items: stretch;
        }
        .card { padding: 28px; }
        .btn { width: 100%; margin-top: 6px; }
        @media (max-width: 1024px) { .shell { grid-template-columns: 1fr; } }
        @media (max-width: 640px) { .card { padding: 22px; } }
      </style>
      <script src="/js/theme.js?v=2"></script>
    </head>
    <body>
      <div style="position: absolute; top: 20px; right: 20px; z-index: 10;">
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
      </div>
      <div class="halo one"></div>
      <div class="halo two"></div>
      <div class="halo three"></div>

      <div class="shell">
        <div class="card intro">
          <span class="pill">AIIN Identity / New account</span>
          <h1>Create your AIIN identity</h1>
          <p>Aligned with the SmartHR dashboard aesthetic for a seamless move between login, hub, and apps.</p>
          <div class="list">
            <div class="list-item"><span class="dot"></span>SSO-ready hub credentials</div>
            <div class="list-item"><span class="dot"></span>Adaptive MFA and session continuity</div>
            <div class="list-item"><span class="dot"></span>Instant access to SmartHR and connected tools</div>
          </div>
        </div>

        <div class="card form-card">
          <div class="form-header">
            <div>
              <span class="eyebrow">Identity</span>
              <h2 class="form-title">Create account</h2>
              <p class="hint">One account for the hub and all connected apps.</p>
            </div>
            <div class="brand-mark">
              ${seemplifyMarkSvg}
            </div>
          </div>

          ${errorMsg ? `<div class="error">${errorMsg}</div>` : ''}

          <form id="signupForm" action="/signup" method="POST">
            <div class="form-group">
              <label for="name">Full name (optional)</label>
              <input type="text" id="name" name="name" placeholder="Jordan Harper" />
            </div>

            <div class="form-group">
              <label for="email">Work email</label>
              <input type="email" id="email" name="email" placeholder="you@company.com" required autofocus />
            </div>

            <div class="form-group">
              <label for="password">Password</label>
              <input type="password" id="password" name="password" placeholder="Create a strong password" required minlength="8" />
              <div class="password-strength">
                <div class="password-strength-bar" id="strengthBar"></div>
              </div>
              <div class="password-hint" id="strengthText">Use 8+ characters with letters, numbers, and symbols.</div>
            </div>

            <div class="form-group">
              <label for="confirmPassword">Confirm password</label>
              <input type="password" id="confirmPassword" name="confirmPassword" placeholder="Re-enter your password" required />
            </div>

            <button type="submit" id="submitBtn" class="btn">
              <span id="btnText">Create account</span>
            </button>
          </form>

          <hr class="divider" />

          <div class="login-link">
            Already a member? <a href="/login">Sign in</a>
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
            strengthText.style.color = '#fca5a5';
          } else if (strength <= 3) {
            strengthBar.classList.add('strength-medium');
            strengthText.textContent = 'Medium strength';
            strengthText.style.color = '#fbbf24';
          } else {
            strengthBar.classList.add('strength-strong');
            strengthText.textContent = 'Strong password!';
            strengthText.style.color = '#34d399';
          }
        });

        form.addEventListener('submit', (e) => {
          if (passwordInput.value !== confirmPasswordInput.value) {
            e.preventDefault();
            alert('Passwords do not match');
            return;
          }
          submitBtn.disabled = true;
          btnText.innerHTML = '<span class=\"spinner\"></span>Creating account...';
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
    default: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>'
  }

  return icons[iconName] || icons.default
}

// ==============================================================
// PROFILE ROUTES - Employee Self-Service Hub
// ==============================================================

// Register profile API routes
app.use(profileRouter)

// Profile page GET routes
app.get('/profile/personal', async (req, res) => {
  try {
    if (!req.session || !req.session.accountId) {
      return res.redirect('/interaction/' + req.params.uid)
    }
    const account = await Account.findOne({ sub: req.session.accountId })
    if (!account) {
      return res.status(404).send('Account not found')
    }
    res.render('profile-personal', { user: account })
  } catch (error) {
    console.error('Error loading personal page:', error)
    res.status(500).send('Error loading page')
  }
})

app.get('/profile/tax', async (req, res) => {
  try {
    if (!req.session || !req.session.accountId) {
      return res.redirect('/interaction/' + req.params.uid)
    }
    const account = await Account.findOne({ sub: req.session.accountId })
    if (!account) {
      return res.status(404).send('Account not found')
    }
    res.render('profile-tax', { user: account })
  } catch (error) {
    console.error('Error loading tax page:', error)
    res.status(500).send('Error loading page')
  }
})

app.get('/profile/banking', async (req, res) => {
  try {
    if (!req.session || !req.session.accountId) {
      return res.redirect('/interaction/' + req.params.uid)
    }
    const account = await Account.findOne({ sub: req.session.accountId })
    if (!account) {
      return res.status(404).send('Account not found')
    }
    res.render('profile-banking', { user: account })
  } catch (error) {
    console.error('Error loading banking page:', error)
    res.status(500).send('Error loading page')
  }
})

app.get('/profile/dependents', async (req, res) => {
  try {
    if (!req.session || !req.session.accountId) {
      return res.redirect('/interaction/' + req.params.uid)
    }
    const account = await Account.findOne({ sub: req.session.accountId })
    if (!account) {
      return res.status(404).send('Account not found')
    }
    res.render('profile-dependents', { user: account })
  } catch (error) {
    console.error('Error loading dependents page:', error)
    res.status(500).send('Error loading page')
  }
})

app.get('/profile/documents', async (req, res) => {
  try {
    if (!req.session || !req.session.accountId) {
      return res.redirect('/interaction/' + req.params.uid)
    }
    const account = await Account.findOne({ sub: req.session.accountId })
    if (!account) {
      return res.status(404).send('Account not found')
    }
    res.render('profile-documents', { user: account })
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
})


