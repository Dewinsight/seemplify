import mongoose from 'mongoose'

const HubAppSchema = new mongoose.Schema({
  // Unique identifier for the app (e.g., 'smarthr', 'outlook', 'teams')
  appId: { type: String, unique: true, required: true, index: true },

  // Display information
  name: { type: String, required: true },
  description: { type: String },
  icon: { type: String }, // URL or emoji/icon identifier
  color: { type: String, default: '#667eea' }, // Brand color for the app card

  // App URLs
  url: { type: String, required: true }, // Main app URL
  loginUrl: { type: String }, // Optional separate login URL (for OIDC flow)

  // OIDC client information (if this app uses OIDC)
  clientId: { type: String }, // Links to clients.json client_id

  // Visibility and access
  isActive: { type: Boolean, default: true },
  isPublic: { type: Boolean, default: false }, // If true, shown to all users

  // App category for organization
  category: {
    type: String,
    enum: ['productivity', 'hr', 'communication', 'analytics', 'admin', 'other'],
    default: 'other'
  },

  // Display order (lower = shown first)
  order: { type: Number, default: 100 },

  // Timestamps
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
})

// Update the updatedAt timestamp on save
HubAppSchema.pre('save', function(next) {
  this.updatedAt = new Date()
  next()
})

export const HubApp = mongoose.model('HubApp', HubAppSchema)

// Seed default apps if none exist, or update existing apps with current env vars
export async function seedDefaultApps() {
  const frontendUrl = process.env.SMARTHR_URL || 'http://localhost:5000'
  // NOTE: Hub app URLs should always point to the FRONTEND (not API).
  // Keep backward compatibility with existing env var naming.
  const leaveManagementUrl =
    process.env.LEAVE_MANAGEMENT_URL ||
    process.env.LEAVE_MANAGEMENT_FRONTEND_URL ||
    'http://localhost:5003'
  const performanceManagementUrl =
    process.env.PERFORMANCE_MANAGEMENT_URL ||
    'http://localhost:5005'
  const payrollManagementUrl =
    process.env.PAYROLL_MANAGEMENT_URL ||
    'http://localhost:5007'

  const defaultApps = [
    {
      appId: 'smarthr',
      name: 'Recruiter',
      description: 'AI-powered recruitment and HR management',
      icon: 'briefcase',
      color: '#667eea',
      url: frontendUrl,
      // loginUrl is no longer used - the launch route builds the SSO URL dynamically
      loginUrl: null,
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
      url: leaveManagementUrl,
      loginUrl: null,
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
      url: performanceManagementUrl,
      loginUrl: null,
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
      url: payrollManagementUrl,
      loginUrl: null,
      clientId: 'payroll-management',
      isActive: true,
      isPublic: true,
      category: 'hr',
      order: 4
    }
  ]

  for (const appConfig of defaultApps) {
    const existingApp = await HubApp.findOne({ appId: appConfig.appId })

    if (existingApp) {
      // Update existing app with current environment variables
      existingApp.url = appConfig.url
      existingApp.loginUrl = appConfig.loginUrl
      existingApp.name = appConfig.name
      existingApp.description = appConfig.description
      existingApp.icon = appConfig.icon
      existingApp.color = appConfig.color
      existingApp.clientId = appConfig.clientId
      existingApp.isActive = appConfig.isActive
      existingApp.isPublic = appConfig.isPublic
      existingApp.category = appConfig.category
      existingApp.order = appConfig.order

      await existingApp.save()
      console.log(`✅ Updated ${appConfig.name} app config:`)
      console.log(`  - URL: ${appConfig.url}`)
    } else {
      // Create new app if it doesn't exist
      console.log(`🌱 Seeding ${appConfig.name} hub app...`)
      await HubApp.create(appConfig)
      console.log(`✅ ${appConfig.name} hub app seeded`)
      console.log(`  - URL: ${appConfig.url}`)
    }
  }
}
