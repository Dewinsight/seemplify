/**
 * Hub Apps Configuration
 * Environment-aware app definitions for Identity Provider hub
 */

// Determine environment from NODE_ENV
const isProduction = process.env.NODE_ENV === 'production'

// Development apps configuration
const developmentApps = [
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
    order: 3
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
    order: 4
  },
  {
    appId: 'appflowy',
    name: 'AppFlowy',
    description: 'AI-powered workspace and knowledge management',
    icon: 'cube',
    color: '#a78bfa',
    url: process.env.APPFLOWY_URL || 'http://localhost:8000',
    apiUrl: process.env.APPFLOWY_URL || 'http://localhost:8000',
    authType: 'saml',
    clientId: 'appflowy',
    isActive: true,
    isPublic: true,
    category: 'productivity',
    order: 5
  }
]

// Production apps configuration
const productionApps = [
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
    order: 3
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
    order: 4
  },
  {
    appId: 'appflowy',
    name: 'AppFlowy',
    description: 'AI-powered workspace and knowledge management',
    icon: 'cube',
    color: '#a78bfa',
    url: process.env.APPFLOWY_URL || 'https://docs.seemplifyai.com',
    apiUrl: process.env.APPFLOWY_URL || 'https://docs.seemplifyai.com',
    authType: 'saml',
    clientId: 'appflowy',
    isActive: true,
    isPublic: true,
    category: 'productivity',
    order: 5
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
