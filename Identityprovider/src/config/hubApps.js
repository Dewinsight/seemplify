/**
 * Hub Apps Configuration
 * Environment-aware app definitions for Identity Provider hub
 */

// Determine environment from NODE_ENV
const isProduction = process.env.NODE_ENV === 'production'

function productionSafeUrl(value, fallback) {
  const configured = String(value || '').trim()
  if (!configured) return fallback
  try {
    const hostname = new URL(configured).hostname.toLowerCase()
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || !hostname.includes('.')) return fallback
  } catch {
    return fallback
  }
  return configured
}

function hasConfiguredUrl(value) {
  return Boolean(String(value || '').trim())
}

function environmentFlagEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase())
}

const N8N_EDITOR_HOSTS = new Set([
  'automations.seemplifyai.com'
])
const WORKSPACE_HOSTS = new Set([
  'workspace.seemplifyai.com'
])
const WORKSPACE_AUTOMATION_PRODUCTION_ORIGIN = 'https://workspace.seemplifyai.com'
const WORKSPACE_AUTOMATION_API_PRODUCTION_ORIGIN = 'https://api-workspace.seemplifyai.com'
const WORKSPACE_AUTOMATION_DEVELOPMENT_ORIGINS = new Set([
  WORKSPACE_AUTOMATION_PRODUCTION_ORIGIN,
  'http://localhost:4200'
])

function pinnedHttpsUrl(value, allowedHosts, requiredPath = '') {
  try {
    const parsed = new URL(String(value || '').trim())
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return ''
    if (!allowedHosts.has(parsed.hostname.toLowerCase())) return ''
    if (requiredPath && parsed.pathname !== requiredPath) return ''
    return parsed.toString()
  } catch {
    return ''
  }
}

export function getN8nEditorUrl(env = process.env) {
  return pinnedHttpsUrl(env.AUTOMATIONS_URL, N8N_EDITOR_HOSTS)
}

export function getWorkspaceAutomationLaunchUrl(env = process.env) {
  const launch = pinnedHttpsUrl(env.WORKSPACE_AUTOMATIONS_URL, WORKSPACE_HOSTS, '/automations')
  if (!launch) return ''
  const parsed = new URL(launch)
  if (parsed.searchParams.get('editor') !== 'standalone' || [...parsed.searchParams.keys()].length !== 1) return ''
  return parsed.toString()
}

function getPinnedWorkspaceAutomationUrl(value, env = process.env) {
  try {
    const parsed = new URL(String(value || '').trim())
    const allowedOrigins = String(env.NODE_ENV || '').trim().toLowerCase() === 'production'
      ? new Set([WORKSPACE_AUTOMATION_PRODUCTION_ORIGIN])
      : WORKSPACE_AUTOMATION_DEVELOPMENT_ORIGINS
    if (!allowedOrigins.has(parsed.origin) || parsed.username || parsed.password) return null
    if (parsed.pathname !== '/automations' || parsed.hash) return null
    const queryKeys = [...parsed.searchParams.keys()]
    if (queryKeys.some((key) => key !== 'editor')) return null
    if (queryKeys.length && (
      parsed.searchParams.getAll('editor').length !== 1 ||
      parsed.searchParams.get('editor') !== 'standalone'
    )) return null
    parsed.search = ''
    return parsed
  } catch {
    return null
  }
}

/**
 * The Identity editor and external Workspace entry always resolve to the same
 * Workspace broker. The configured application URL supplies no caller-owned
 * host, path, query, fragment, or credentials after this validation step.
 */
export function getOrganizationScopedAutomationSurfaceUrls(app, organizationId, env = process.env) {
  if (app?.appId !== 'automation-hub') return null

  const normalizedOrganizationId = String(organizationId || '').trim().toLowerCase()
  if (!/^[a-f0-9]{24}$/.test(normalizedOrganizationId)) return null

  const workspaceUrl = getPinnedWorkspaceAutomationUrl(app?.url, env)
  if (!workspaceUrl) return null

  const embedUrl = new URL(workspaceUrl)
  embedUrl.searchParams.set('organizationId', normalizedOrganizationId)

  const externalUrl = new URL(workspaceUrl)
  externalUrl.searchParams.set('editor', 'standalone')
  externalUrl.searchParams.set('organizationId', normalizedOrganizationId)

  return Object.freeze({
    embedUrl: embedUrl.toString(),
    externalUrl: externalUrl.toString(),
    workspaceOrigin: workspaceUrl.origin,
    workspaceApiOrigin: workspaceUrl.origin === WORKSPACE_AUTOMATION_PRODUCTION_ORIGIN
      ? WORKSPACE_AUTOMATION_API_PRODUCTION_ORIGIN
      : 'http://localhost:3333'
  })
}

/**
 * Only the absence of a query or the exact `surface=external` query selects a
 * surface. Arrays, duplicate keys, and additional parameters fail closed.
 */
export function resolveAutomationHubSurface(query = {}) {
  if (!query || typeof query !== 'object' || Array.isArray(query)) return ''
  const keys = Object.keys(query)
  if (keys.length === 0) return 'embedded'
  if (keys.length === 1 && keys[0] === 'surface' && query.surface === 'external') return 'external'
  return ''
}

/**
 * Carry Identity's active organization into the Workspace-hosted standalone
 * n8n surface. Workspace still resolves the reference against the current
 * user's entitled organization list before it selects anything.
 */
export function getOrganizationScopedDirectLaunchUrl(app, organizationId) {
  const configuredUrl = String(app?.url || '').trim()
  if (app?.appId !== 'automation-hub') return configuredUrl
  return getOrganizationScopedAutomationSurfaceUrls(app, organizationId)?.externalUrl || ''
}

/**
 * Community is intentionally dormant in production until its public DNS,
 * Workspace routes, and protected OIDC client secret have all been deployed.
 * Development keeps its existing zero-configuration local defaults.
 */
export function isCommunityProductionReady(env = process.env) {
  return environmentFlagEnabled(env.COMMUNITY_PRODUCTION_ENABLED) &&
    Boolean(productionSafeUrl(env.COMMUNITY_URL, '')) &&
    Boolean(productionSafeUrl(env.COMMUNITY_API_URL, '')) &&
    Boolean(String(env.COMMUNITY_OIDC_CLIENT_SECRET || '').trim())
}

/**
 * Keep the n8n surface dormant until its editor, Workspace-brokered launch,
 * and delegated Workspace-node client have all been explicitly provisioned.
 * End users never enter through n8n's native OIDC account namespace: both the
 * Hub card and embedded editor use Workspace's organization-scoped exchange.
 */
export function isN8nProductionReady(env = process.env) {
  return environmentFlagEnabled(env.N8N_HUB_ENABLED) &&
    environmentFlagEnabled(env.N8N_INTEGRATION_ENABLED) &&
    Boolean(getN8nEditorUrl(env)) &&
    Boolean(getWorkspaceAutomationLaunchUrl(env)) &&
    Boolean(String(env.N8N_WORKSPACE_NODE_OIDC_CLIENT_SECRET || '').trim())
}

// Development apps configuration
const developmentApps = [
  {
    appId: 'openwebui',
    name: 'AI Assistant',
    description: 'AI chat interface with multiple model support',
    icon: 'chat',
    color: '#7c3aed',
    url: process.env.OPENWEBUI_URL || 'http://localhost:8080',
    apiUrl: process.env.OPENWEBUI_URL || 'http://localhost:8080',
    clientId: 'openwebui',
    isActive: true,
    isPublic: true,
    category: 'ai',
    order: 6
  },
  {
    appId: 'outline',
    name: 'Outline Docs',
    description: 'Team knowledge base and documentation',
    icon: 'document-text',
    color: '#0366d6',
    url: process.env.OUTLINE_URL || 'http://localhost:3000',
    apiUrl: process.env.OUTLINE_URL || 'http://localhost:3000',
    clientId: 'outline',
    isActive: true,
    isPublic: true,
    category: 'productivity',
    order: 5
  },
  {
    appId: 'smarthr',
    name: 'Recruiter',
    description: 'AI-powered recruitment and HR management',
    icon: 'briefcase',
    color: '#667eea',
    url: process.env.SMARTHR_URL || 'http://localhost:5000',
    apiUrl: process.env.SMARTHR_API_URL || 'http://localhost:5001',
    clientId: 'smarthr-backend',
    isActive: true,
    isPublic: true,
    category: 'hr',
    order: 1
  },
  {
    appId: 'leave-management',
    name: 'Leave Management',
    description: 'Manage employee leave requests and approvals',
    icon: 'calendar',
    color: '#8b5cf6',
    url: process.env.LEAVE_MANAGEMENT_URL || 'http://localhost:5003',
    apiUrl: process.env.LEAVE_MANAGEMENT_API_URL || 'http://localhost:5002',
    clientId: 'leave-management',
    isActive: true,
    isPublic: true,
    category: 'hr',
    order: 2
  },
  {
    appId: 'performance-management',
    name: 'Performance Management',
    description: 'AI-powered OKRs, reviews, and continuous feedback',
    icon: 'chart-bar',
    color: '#8b5cf6',
    url: process.env.PERFORMANCE_MANAGEMENT_URL || 'http://localhost:5005',
    apiUrl: process.env.PERFORMANCE_MANAGEMENT_API_URL || 'http://localhost:5004',
    clientId: 'performance-management',
    isActive: true,
    isPublic: true,
    category: 'hr',
    order: 3,
    badge: 'New'
  },
  {
    appId: 'payroll-management',
    name: 'Payroll',
    description: 'Salary processing, bonuses, and compensation management',
    icon: 'currency-dollar',
    color: '#f59e0b',
    url: process.env.PAYROLL_MANAGEMENT_URL || 'http://localhost:5007',
    apiUrl: process.env.PAYROLL_MANAGEMENT_API_URL || 'http://localhost:5006',
    clientId: 'payroll-management',
    isActive: true,
    isPublic: true,
    category: 'hr',
    order: 4,
    badge: 'New'
  },
  {
    appId: 'time-attendance',
    name: 'Time & Attendance',
    description: 'Track work hours, manage timesheets, and handle approvals',
    icon: 'clock',
    color: '#a855f7',
    url: process.env.TIME_ATTENDANCE_URL || 'http://localhost:5011',
    apiUrl: process.env.TIME_ATTENDANCE_API_URL || 'http://localhost:5010',
    clientId: 'time-attendance',
    isActive: true,
    isPublic: true,
    category: 'hr',
    order: 4.5,
    badge: 'New'
  },
  {
    appId: 'lms',
    name: 'Simple LMS',
    description: 'Online courses, training, and certifications (Identity Provider)',
    icon: 'academic-cap',
    color: '#06b6d4',
    url: process.env.SIMPLE_LMS_URL || 'http://localhost:4000/simple-lms',
    authType: 'direct',
    isActive: true,
    isPublic: true,
    category: 'productivity',
    order: 7
  },
  {
    appId: 'seemplify-learning',
    name: 'Learning',
    description: 'Organisation learning, internal courses, and staff development',
    icon: 'academic-cap',
    color: '#0f766e',
    url: process.env.SEEMPLIFY_LEARNING_URL || 'http://localhost:5012',
    apiUrl: process.env.SEEMPLIFY_LEARNING_URL || 'http://localhost:5012',
    clientId: 'seemplify-learning',
    isActive: true,
    isPublic: true,
    category: 'productivity',
    order: 7.5,
    badge: 'Beta',
    isBeta: true
  },
  {
    appId: 'messaging',
    name: 'Workspace',
    description: 'Messages, AI, boards, notes, pages, and meetings in one connected team workspace',
    icon: 'chat-bubble-left-right',
    color: '#5f6654',
    url: process.env.MESSAGING_URL || 'http://localhost:4200',
    apiUrl: process.env.MESSAGING_API_URL || 'http://localhost:3333',
    clientId: 'messaging',
    isActive: true,
    isPublic: true,
    category: 'productivity',
    order: 8,
    badge: 'Beta',
    isBeta: true
  },
  {
    appId: 'automation-hub',
    name: 'Automations',
    description: 'Build and run connected Workspace workflows with n8n',
    icon: 'bolt',
    color: '#5f6654',
    url: process.env.WORKSPACE_AUTOMATIONS_URL || 'http://localhost:4200/automations?editor=standalone',
    apiUrl: process.env.AUTOMATIONS_URL || 'http://localhost:5678',
    clientId: 'messaging',
    authType: 'direct',
    isActive: environmentFlagEnabled(process.env.N8N_HUB_ENABLED) &&
      environmentFlagEnabled(process.env.N8N_INTEGRATION_ENABLED),
    isPublic: true,
    category: 'productivity',
    order: 8.05,
    badge: 'Beta',
    isBeta: true
  },
  {
    appId: 'community',
    name: 'Community',
    description: 'Public conversations, communities, articles, events, and connections',
    icon: 'users',
    color: '#5f6654',
    url: process.env.COMMUNITY_URL || 'http://localhost:4200',
    apiUrl: process.env.COMMUNITY_API_URL || process.env.MESSAGING_API_URL || 'http://localhost:3333',
    oidcStartPath: '/api/auth/oidc/community/start',
    clientId: 'community',
    organizationRequired: false,
    isActive: true,
    isPublic: true,
    category: 'productivity',
    order: 8.1,
    badge: 'Beta',
    isBeta: true
  },
   {
    appId: 'approver',
    name: 'Approver',
    description: 'Govern AI initiatives, policies, reviews, and executive approvals',
    icon: 'check-badge',
    color: '#7b3fc0',
    url: process.env.APPROVER_URL || 'http://localhost:5000',
    apiUrl: process.env.APPROVER_URL || 'http://localhost:5000',
    clientId: 'approver',
    isActive: true,
    isPublic: true,
    category: 'productivity',
    order: 8.5
  },
  {
    appId: 'experience-management',
    name: 'Experience Management',
    description: 'Research, listening, journeys, and action in one evidence-led workspace',
    icon: 'chart-bar',
    color: '#7048e8',
    url: process.env.EXPERIENCE_MANAGEMENT_URL || 'http://localhost:5410',
    apiUrl: process.env.EXPERIENCE_MANAGEMENT_URL || 'http://localhost:5410',
    clientId: 'experience-management',
    isActive: true,
    isPublic: true,
    category: 'insights',
    order: 8.25
  }
]

// Production apps configuration
const productionApps = [
  {
    appId: 'openwebui',
    name: 'AI Assistant',
    description: 'AI chat interface with multiple model support',
    icon: 'chat',
    color: '#7c3aed',
    url: process.env.OPENWEBUI_URL || 'https://ai.seemplifyai.com',
    apiUrl: process.env.OPENWEBUI_URL || 'https://ai.seemplifyai.com',
    clientId: 'openwebui',
    isActive: hasConfiguredUrl(process.env.OPENWEBUI_URL),
    isPublic: true,
    category: 'ai',
    order: 6
  },
  {
    appId: 'outline',
    name: 'Outline Docs',
    description: 'Team knowledge base and documentation',
    icon: 'document-text',
    color: '#0366d6',
    url: process.env.OUTLINE_URL || 'https://docs.seemplifyai.com',
    apiUrl: process.env.OUTLINE_URL || 'https://docs.seemplifyai.com',
    clientId: 'outline',
    isActive: hasConfiguredUrl(process.env.OUTLINE_URL),
    isPublic: true,
    category: 'productivity',
    order: 5
  },
  {
    appId: 'smarthr',
    name: 'Recruiter',
    description: 'AI-powered recruitment and HR management',
    icon: 'briefcase',
    color: '#667eea',
    url: process.env.SMARTHR_URL,
    apiUrl: process.env.SMARTHR_API_URL,
    clientId: 'smarthr-backend',
    isActive: true,
    isPublic: true,
    category: 'hr',
    order: 1
  },
  {
    appId: 'leave-management',
    name: 'Leave Management',
    description: 'Manage employee leave requests and approvals',
    icon: 'calendar',
    color: '#8b5cf6',
    url: process.env.LEAVE_MANAGEMENT_URL,
    apiUrl: process.env.LEAVE_MANAGEMENT_API_URL,
    clientId: 'leave-management',
    isActive: true,
    isPublic: true,
    category: 'hr',
    order: 2
  },
  {
    appId: 'performance-management',
    name: 'Performance Management',
    description: 'AI-powered OKRs, reviews, and continuous feedback',
    icon: 'chart-bar',
    color: '#8b5cf6',
    url: productionSafeUrl(process.env.PERFORMANCE_MANAGEMENT_URL, 'https://performance.seemplifyai.com'),
    apiUrl: productionSafeUrl(process.env.PERFORMANCE_MANAGEMENT_API_URL, 'https://api-performance.seemplifyai.com'),
    clientId: 'performance-management',
    isActive: true,
    isPublic: true,
    category: 'hr',
    order: 3,
    badge: 'New'
  },
  {
    appId: 'payroll-management',
    name: 'Payroll',
    description: 'Salary processing, bonuses, and compensation management',
    icon: 'currency-dollar',
    color: '#f59e0b',
    url: productionSafeUrl(process.env.PAYROLL_MANAGEMENT_URL, 'https://payroll.seemplifyai.com'),
    apiUrl: productionSafeUrl(process.env.PAYROLL_MANAGEMENT_API_URL, 'https://api-payroll.seemplifyai.com'),
    clientId: 'payroll-management',
    isActive: true,
    isPublic: true,
    category: 'hr',
    order: 4,
    badge: 'New'
  },
  {
    appId: 'time-attendance',
    name: 'Time & Attendance',
    description: 'Track work hours, manage timesheets, and handle approvals',
    icon: 'clock',
    color: '#a855f7',
    url: process.env.TIME_ATTENDANCE_URL || 'https://time.seemplifyai.com',
    apiUrl: process.env.TIME_ATTENDANCE_API_URL || 'https://api-time.seemplifyai.com',
    clientId: 'time-attendance',
    isActive: true,
    isPublic: true,
    category: 'hr',
    order: 4.5,
    badge: 'New'
  },
  {
    appId: 'lms',
    name: 'Simple LMS',
    description: 'Online courses, training, and certifications (Identity Provider)',
    icon: 'academic-cap',
    color: '#06b6d4',
    url: process.env.SIMPLE_LMS_URL || 'https://auth.seemplifyai.com/simple-lms',
    authType: 'direct',
    isActive: true,
    isPublic: true,
    category: 'productivity',
    order: 7
  },
  {
    appId: 'seemplify-learning',
    name: 'Learning',
    description: 'Organisation learning, internal courses, and staff development',
    icon: 'academic-cap',
    color: '#0f766e',
    url: productionSafeUrl(process.env.SEEMPLIFY_LEARNING_URL, 'https://learning.seemplifyai.com'),
    apiUrl: productionSafeUrl(process.env.SEEMPLIFY_LEARNING_URL, 'https://learning.seemplifyai.com'),
    clientId: 'seemplify-learning',
    isActive: true,
    isPublic: true,
    category: 'productivity',
    order: 7.5,
    badge: 'Beta',
    isBeta: true
  },
  {
    appId: 'messaging',
    name: 'Workspace',
    description: 'Messages, AI, boards, notes, pages, and meetings in one connected team workspace',
    icon: 'chat-bubble-left-right',
    color: '#5f6654',
    url: productionSafeUrl(process.env.MESSAGING_URL, 'https://workspace.seemplifyai.com'),
    apiUrl: productionSafeUrl(process.env.MESSAGING_API_URL, 'https://api-workspace.seemplifyai.com'),
    clientId: 'messaging',
    isActive: hasConfiguredUrl(process.env.MESSAGING_URL),
    isPublic: true,
    category: 'productivity',
    order: 8,
    badge: 'Beta',
    isBeta: true
  },
  {
    appId: 'automation-hub',
    name: 'Automations',
    description: 'Build and run connected Workspace workflows with n8n',
    icon: 'bolt',
    color: '#5f6654',
    url: getWorkspaceAutomationLaunchUrl(process.env),
    apiUrl: getN8nEditorUrl(process.env),
    clientId: 'messaging',
    authType: 'direct',
    isActive: isN8nProductionReady(process.env),
    isPublic: true,
    category: 'productivity',
    order: 8.05,
    badge: 'Beta',
    isBeta: true
  },
  {
    appId: 'community',
    name: 'Community',
    description: 'Public conversations, communities, articles, events, and connections',
    icon: 'users',
    color: '#5f6654',
    url: productionSafeUrl(process.env.COMMUNITY_URL, ''),
    apiUrl: productionSafeUrl(process.env.COMMUNITY_API_URL, ''),
    oidcStartPath: '/api/auth/oidc/community/start',
    clientId: 'community',
    organizationRequired: false,
    isActive: isCommunityProductionReady(process.env),
    isPublic: true,
    category: 'productivity',
    order: 8.1,
    badge: 'Beta',
    isBeta: true
  },
   {
    appId: 'approver',
    name: 'Approver',
    description: 'Govern AI initiatives, policies, reviews, and executive approvals',
    icon: 'check-badge',
    color: '#7b3fc0',
    url: productionSafeUrl(process.env.APPROVER_URL, 'https://approver.seemplifyai.com'),
    apiUrl: productionSafeUrl(process.env.APPROVER_URL, 'https://approver.seemplifyai.com'),
    clientId: 'approver',
    isActive: true,
    isPublic: true,
    category: 'productivity',
    order: 8.5
  },
  {
    appId: 'experience-management',
    name: 'Experience Management',
    description: 'Research, listening, journeys, and action in one evidence-led workspace',
    icon: 'chart-bar',
    color: '#7048e8',
    url: productionSafeUrl(process.env.EXPERIENCE_MANAGEMENT_URL, 'https://experience.seemplifyai.com'),
    apiUrl: productionSafeUrl(process.env.EXPERIENCE_MANAGEMENT_URL, 'https://experience.seemplifyai.com'),
    clientId: 'experience-management',
    isActive: true,
    isPublic: true,
    category: 'insights',
    order: 8.25
  }
]

/**
 * Get all hub apps based on current environment
 * @param {object} [options] - Options
 * @param {boolean} [options.isAkwaIbom] - If true, override SmartHR URL to ibom.aiinnigeria.com
 * @returns {Array} Array of app configurations
 */
export function getHubApps(options = {}) {
  const apps = isProduction ? productionApps : developmentApps
  let filtered = apps.filter(app => app.isActive).sort((a, b) => a.order - b.order)

  if (options.isAkwaIbom) {
    filtered = filtered.map(app => {
      if (app.appId === 'smarthr') {
        return { ...app, name: 'HR Portal', url: 'https://ibom.aiinnigeria.com', description: 'Akwa Ibom State Human Resource Management' }
      }
      return app
    })
  }

  return filtered
}

/**
 * Get every registered hub app, including apps disabled in the current environment.
 * Admin plan configuration uses this so an app can be configured before activation.
 * @returns {Array} Array of app configurations
 */
export function getAllHubApps() {
  const apps = isProduction ? productionApps : developmentApps
  return [...apps].sort((a, b) => a.order - b.order)
}

/**
 * Get single app by ID
 * @param {string} appId - Application ID
 * @returns {Object|undefined} App configuration or undefined
 */
export function getAppById(appId) {
  const apps = isProduction ? productionApps : developmentApps
  return apps.find(app => app.appId === appId)
}

/**
 * Get API URL for an app based on appId
 * @param {string} appId - Application ID
 * @returns {string|undefined} API URL or undefined
 */
export function getAppApiUrl(appId) {
  const app = getAppById(appId)
  return app?.apiUrl
}

/**
 * Resolve the backend that should initiate OIDC for a hub app.
 * Generic OIDC apps must use their own configured API instead of another
 * product's backend fallback.
 *
 * @param {Object} app Hub application configuration
 * @param {string} fallbackApiUrl Legacy fallback for apps without an API URL
 * @returns {string|undefined} OIDC start backend URL
 */
export function getOidcLaunchApiUrl(app, fallbackApiUrl) {
  const configuredApiUrl = String(app?.apiUrl || '').trim()
  return configuredApiUrl || fallbackApiUrl
}

/**
 * Resolve the public OIDC entrypoint exposed by a hub application.
 * Products may override the default API route when their public OIDC
 * entrypoint differs.
 */
export function getOidcLaunchPath(app) {
  const configuredPath = String(app?.oidcStartPath || '').trim()
  if (configuredPath.startsWith('/') && !configuredPath.startsWith('//')) return configuredPath
  return '/api/auth/oidc/start'
}

/**
 * Organization access remains required unless an app explicitly opts out.
 * This additive default preserves the existing launch contract for every
 * registered app while allowing account-level products such as Community.
 */
export function appRequiresOrganization(app) {
  return app?.organizationRequired !== false
}

export function getOrganizationManagedHubApps(options = {}) {
  return getHubApps(options).filter(appRequiresOrganization)
}

export function getAllOrganizationManagedHubApps() {
  return getAllHubApps().filter(appRequiresOrganization)
}

/**
 * Get all active apps by category
 * @param {string} category - Category name
 * @returns {Array} Filtered apps
 */
export function getAppsByCategory(category) {
  return getHubApps().filter(app => app.category === category)
}

/**
 * Coming soon cards - special non-clickable cards shown when enabled per plan
 * These are separate from normal hub apps (e.g. payroll, performance-management have both live and coming-soon variants)
 */
const COMING_SOON_CARDS = [
  {
    cardId: 'payroll',
    name: 'Payroll',
    description: 'Salary processing, bonuses, and compensation management',
    icon: 'currency-dollar',
    color: '#94a3b8',
    order: 2
  },
  {
    cardId: 'performance-management',
    name: 'Performance Management',
    description: 'AI-powered OKRs, reviews, and continuous feedback',
    icon: 'chart-bar',
    color: '#94a3b8',
    order: 3
  },
  {
    cardId: 'hmo-plans',
    name: 'HMO Plans',
    description: 'Employee health plans, family coverage, enrolment, and payroll contributions',
    icon: 'users',
    color: '#94a3b8',
    order: 4
  }
]

/**
 * Get coming soon cards that are enabled for a plan
 * @param {string[]} enabledCardIds - Card IDs to show (from plan.showComingSoonCards)
 * @returns {Array} Filtered coming soon cards
 */
export function getComingSoonCards(enabledCardIds = []) {
  if (!Array.isArray(enabledCardIds) || enabledCardIds.length === 0) {
    return []
  }
  const enabledSet = new Set(enabledCardIds.map(id => String(id).trim()).filter(Boolean))
  return COMING_SOON_CARDS
    .filter(card => enabledSet.has(card.cardId))
    .sort((a, b) => a.order - b.order)
}

/**
 * Get all coming soon card definitions (for admin UI)
 * @returns {Array} All coming soon cards
 */
export function getAllComingSoonCards() {
  return [...COMING_SOON_CARDS]
}
