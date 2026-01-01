import mongoose from 'mongoose'

const AccountSchema = new mongoose.Schema({
  sub: { type: String, unique: true, index: true },
  email: { type: String, unique: true, lowercase: true },
  passwordHash: { type: String },
  emailVerified: { type: Boolean, default: false },
  profile: {
    name: String,
    preferred_username: String
  },
  // Password reset fields
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },
  lastPasswordChange: { type: Date },

  // OTP and security fields
  security: {
    // OTP rate limiting and lockout
    otpAttempts: { type: Number, default: 0 },
    otpLockedUntil: { type: Date },
    lastOtpSent: { type: Date },
    
    // Trusted browsers (for device verification - future use)
    trustedBrowsers: [{
      fingerprint: { type: String },
      addedAt: { type: Date, default: Date.now },
      lastUsedAt: { type: Date },
      browserInfo: {
        name: String,
        os: String,
        device: String,
        version: String
      }
    }]
  },

  // Organization memberships
  organizations: [{
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AiinOrganization'
    },
    role: {
      type: String,
      enum: ['owner', 'admin', 'hr_manager', 'recruiter', 'interviewer']
    },
    joinedAt: {
      type: Date,
      default: Date.now
    },
    isActive: {
      type: Boolean,
      default: true
    }
  }],

  // Current organization (for session context)
  currentOrganization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinOrganization'
  },

  // Team memberships across organizations
  teams: [{
    team: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AiinTeam'
    },
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AiinOrganization'
    },
    role: {
      type: String,
      enum: ['member', 'line_manager', 'team_lead']
    },
    joinedAt: {
      type: Date,
      default: Date.now
    },
    isActive: {
      type: Boolean,
      default: true
    }
  }],

  // Migration support
  requiresPasswordReset: {
    type: Boolean,
    default: false
  },

  createdAt: { type: Date, default: Date.now }
})

// Indexes for organization and team lookups
AccountSchema.index({ 'organizations.organization': 1 })
AccountSchema.index({ 'teams.team': 1 })
AccountSchema.index({ 'teams.organization': 1 })

// Get active organizations
AccountSchema.methods.getActiveOrganizations = function() {
  return this.organizations.filter(o => o.isActive)
}

// Get active teams
AccountSchema.methods.getActiveTeams = function() {
  return this.teams.filter(t => t.isActive)
}

// Get teams for a specific organization
AccountSchema.methods.getTeamsForOrganization = function(organizationId) {
  return this.teams.filter(
    t => t.organization.toString() === organizationId.toString() && t.isActive
  )
}

// Check if user has line_manager role in any team
AccountSchema.methods.isLineManager = function() {
  return this.teams.some(t => t.role === 'line_manager' && t.isActive)
}

// Get organizations where user has a specific role
AccountSchema.methods.getOrganizationsWithRole = function(role) {
  return this.organizations.filter(o => o.role === role && o.isActive)
}

// Set current organization (for session context switching)
AccountSchema.methods.setCurrentOrganization = async function(organizationId) {
  // Verify user is member of organization
  const isMember = this.organizations.some(
    o => o.organization.toString() === organizationId.toString() && o.isActive
  )

  if (!isMember) {
    throw new Error('Not a member of this organization')
  }

  this.currentOrganization = organizationId
  await this.save()
  return this
}

export const Account = mongoose.model('AiinAccount', AccountSchema)

