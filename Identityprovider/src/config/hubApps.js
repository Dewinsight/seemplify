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
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return fallback
  } catch {
    return fallback
  }
  return configured
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
    badge: 'Beta',
    isBeta: true
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
    badge: 'Beta',
    isBeta: true
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
    name: 'Seemplify Learning',
    description: 'Organisation learning, internal courses, and staff development',
    icon: 'academic-cap',
    color: '#0f766e',
    url: process.env.SEEMPLIFY_LEARNING_URL || 'http://localhost:5012',
    apiUrl: process.env.SEEMPLIFY_LEARNING_URL || 'http://localhost:5012',
    clientId: 'seemplify-learning',
    isActive: true,
    isPublic: true,
    category: 'productivity',
    order: 7.5
  },
  {
    appId: 'messaging',
    name: 'Seemplify Messaging',
    description: 'Channels, direct messages, calls, notes, pages, and boards for your organization',
    icon: 'chat-bubble-left-right',
    color: '#5f6654',
    url: process.env.MESSAGING_URL || 'http://localhost:4200',
    apiUrl: process.env.MESSAGING_API_URL || 'http://localhost:3333',
    clientId: 'messaging',
    isActive: true,
    isPublic: true,
    category: 'communication',
    order: 8
  },
  {
    appId: 'zulip',
    name: 'Seemplify Chat',
    description: 'Thread-based team messaging and collaboration',
    icon: 'chat-bubble-left-right',
    color: '#6492fe',
    url: process.env.ZULIP_URL || 'http://localhost:80',
    apiUrl: process.env.ZULIP_URL || 'http://localhost:80',
    clientId: 'zulip',
    isActive: true,
    isPublic: true,
    category: 'communication',
    order: 8.5
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
    url: process.env.OUTLINE_URL || 'https://docs.seemplifyai.com',
    apiUrl: process.env.OUTLINE_URL || 'https://docs.seemplifyai.com',
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
    badge: 'Beta',
    isBeta: true
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
    badge: 'Beta',
    isBeta: true
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
    name: 'Seemplify Learning',
    description: 'Organisation learning, internal courses, and staff development',
    icon: 'academic-cap',
    color: '#0f766e',
    url: productionSafeUrl(process.env.SEEMPLIFY_LEARNING_URL, 'https://learning.seemplifyai.com'),
    apiUrl: productionSafeUrl(process.env.SEEMPLIFY_LEARNING_URL, 'https://learning.seemplifyai.com'),
    clientId: 'seemplify-learning',
    isActive: true,
    isPublic: true,
    category: 'productivity',
    order: 7.5
  },
  {
    appId: 'messaging',
    name: 'Seemplify Messaging',
    description: 'Channels, direct messages, calls, notes, pages, and boards for your organization',
    icon: 'chat-bubble-left-right',
    color: '#5f6654',
    url: productionSafeUrl(process.env.MESSAGING_URL, 'https://messaging.seemplifyai.com'),
    apiUrl: productionSafeUrl(process.env.MESSAGING_API_URL, 'https://api-messaging.seemplifyai.com'),
    clientId: 'messaging',
    isActive: true,
    isPublic: true,
    category: 'communication',
    order: 8
  },
  {
    appId: 'zulip',
    name: 'Seemplify Chat',
    description: 'Thread-based team messaging and collaboration',
    icon: 'chat-bubble-left-right',
    color: '#6492fe',
    url: process.env.ZULIP_URL || 'https://chat.seemplifyai.com',
    apiUrl: process.env.ZULIP_URL || 'https://chat.seemplifyai.com',
    clientId: 'zulip',
    isActive: true,
    isPublic: true,
    category: 'communication',
    order: 8.5
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
