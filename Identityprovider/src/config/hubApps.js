/**
 * Hub Apps Configuration
 * Environment-aware app definitions for Identity Provider hub
 */

// Determine environment from NODE_ENV
const isProduction = process.env.NODE_ENV === 'production'

function buildLmsLaunchUrl(baseUrl) {
  const normalized = (baseUrl || '').replace(/\/+$/, '')
  if (!normalized) return baseUrl
  if (normalized.endsWith('/lms')) {
    return `${normalized}/`
  }
  return `${normalized}/lms/`
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
    name: 'SmartHR',
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
    color: '#10b981',
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
    badge: 'Beta'
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
    badge: 'Beta'
  },
  {
    appId: 'time-attendance',
    name: 'Time & Attendance',
    description: 'Track work hours, manage timesheets, and handle approvals',
    icon: 'clock',
    color: '#14b8a6',
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
    name: 'Seemplify LMS',
    description: 'Online courses, training, and certifications',
    icon: 'academic-cap',
    color: '#06b6d4',
    url: buildLmsLaunchUrl(process.env.LMS_URL || 'http://localhost:8000'),
    authType: 'direct',
    isActive: true,
    isPublic: true,
    category: 'productivity',
    order: 7
  },
  {
    appId: 'rocket-chat',
    name: 'Team Chat',
    description: 'Team messaging and collaboration',
    icon: 'chat-bubble-left-right',
    color: '#f5455c',
    url: process.env.ROCKET_CHAT_URL || 'http://localhost:3000',
    apiUrl: process.env.ROCKET_CHAT_URL || 'http://localhost:3000',
    clientId: 'rocket-chat',
    isActive: true,
    isPublic: true,
    category: 'communication',
    order: 8
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
    name: 'SmartHR',
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
    color: '#10b981',
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
    url: process.env.PERFORMANCE_MANAGEMENT_URL,
    apiUrl: process.env.PERFORMANCE_MANAGEMENT_API_URL,
    clientId: 'performance-management',
    isActive: true,
    isPublic: true,
    category: 'hr',
    order: 3,
    badge: 'Beta'
  },
  {
    appId: 'payroll-management',
    name: 'Payroll',
    description: 'Salary processing, bonuses, and compensation management',
    icon: 'currency-dollar',
    color: '#f59e0b',
    url: process.env.PAYROLL_MANAGEMENT_URL,
    apiUrl: process.env.PAYROLL_MANAGEMENT_API_URL,
    clientId: 'payroll-management',
    isActive: true,
    isPublic: true,
    category: 'hr',
    order: 4,
    badge: 'Beta'
  },
  {
    appId: 'time-attendance',
    name: 'Time & Attendance',
    description: 'Track work hours, manage timesheets, and handle approvals',
    icon: 'clock',
    color: '#14b8a6',
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
    name: 'Seemplify LMS',
    description: 'Online courses, training, and certifications',
    icon: 'academic-cap',
    color: '#06b6d4',
    url: buildLmsLaunchUrl(process.env.LMS_URL || 'https://lms.seemplifyai.com'),
    authType: 'direct',
    isActive: true,
    isPublic: true,
    category: 'productivity',
    order: 7
  },
  {
    appId: 'rocket-chat',
    name: 'Team Chat',
    description: 'Team messaging and collaboration',
    icon: 'chat-bubble-left-right',
    color: '#f5455c',
    url: process.env.ROCKET_CHAT_URL || 'https://chat.seemplifyai.com',
    apiUrl: process.env.ROCKET_CHAT_URL || 'https://chat.seemplifyai.com',
    clientId: 'rocket-chat',
    isActive: true,
    isPublic: true,
    category: 'communication',
    order: 8
  }
]

/**
 * Get all hub apps based on current environment
 * @returns {Array} Array of app configurations
 */
export function getHubApps() {
  const apps = isProduction ? productionApps : developmentApps
  return apps.filter(app => app.isActive).sort((a, b) => a.order - b.order)
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
