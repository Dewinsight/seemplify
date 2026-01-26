import mongoose from 'mongoose'

const AccountSchema = new mongoose.Schema({
  sub: { type: String, unique: true, index: true },
  email: { type: String, unique: true, lowercase: true },
  passwordHash: { type: String },
  emailVerified: { type: Boolean, default: false },
  profile: {
    name: String,
    preferred_username: String,
    // Extended personal information for employee self-service
    personalInfo: {
      mailingAddress: {
        street: String,
        street2: String,
        city: String,
        state: String,
        zipCode: String,
        country: { type: String, default: 'USA' }
      },
      phoneNumbers: {
        mobile: String,
        home: String,
        work: String
      },
      emergencyContacts: [{
        name: String,
        relationship: String,
        phone: String,
        email: String,
        isPrimary: { type: Boolean, default: false }
      }]
    },
    // Tax information
    taxInfo: {
      w4Allowances: Number,
      additionalWithholding: Number,
      filingStatus: {
        type: String,
        enum: ['single', 'married_jointly', 'married_separately', 'head_of_household', 'widow']
      },
      lastUpdated: Date
    },
    // Banking information for direct deposit
    banking: {
      accounts: [{
        accountType: {
          type: String,
          enum: ['checking', 'savings']
        },
        bankName: String,
        routingNumber: String, // Should be encrypted in production
        accountNumber: String, // Should be encrypted in production  
        percentage: { type: Number, default: 100, min: 0, max: 100 },
        isActive: { type: Boolean, default: true }
      }]
    },
    // Dependents and beneficiaries
    dependents: [{
      name: String,
      relationship: {
        type: String,
        enum: ['spouse', 'child', 'parent', 'sibling', 'other']
      },
      dateOfBirth: Date,
      ssn: String, // Should be encrypted in production
      isBeneficiary: { type: Boolean, default: false },
      beneficiaryPercentage: { type: Number, min: 0, max: 100 }
    }]
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
      enum: ['owner', 'admin', 'hr_manager', 'recruiter', 'interviewer', 'staff']
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

  // System-level admin role (IDP admin, not organization admin)
  isSystemAdmin: {
    type: Boolean,
    default: false
  },
  // Super admin (can manage other admins)
  isSuperAdmin: {
    type: Boolean,
    default: false
  },

  // =====================================================
  // SAML Support
  // =====================================================
  saml: {
    // SAML NameID (unique identifier from IdP)
    nameId: { type: String, sparse: true, index: true },
    nameIdFormat: { type: String },

    // IdP that authenticated this user
    identityProvider: { type: String },

    // Session tracking
    sessionIndex: { type: String },

    // Last SAML authentication
    lastSamlAuth: { type: Date },

    // SAML attributes passed from IdP
    attributes: { type: Map, of: String }
  },

  // Auth provider tracking
  authProvider: {
    type: String,
    enum: ['local', 'oauth', 'oidc', 'saml', 'oidc-saml'],
    default: 'local'
  },

  createdAt: { type: Date, default: Date.now }
})

// Indexes for organization and team lookups
AccountSchema.index({ 'organizations.organization': 1 })
AccountSchema.index({ 'teams.team': 1 })
AccountSchema.index({ 'teams.organization': 1 })

// Get active organizations
AccountSchema.methods.getActiveOrganizations = function () {
  return this.organizations.filter(o => o.isActive)
}

// Get active teams
AccountSchema.methods.getActiveTeams = function () {
  return this.teams.filter(t => t.isActive)
}

// Get teams for a specific organization
AccountSchema.methods.getTeamsForOrganization = function (organizationId) {
  return this.teams.filter(
    t => t.organization.toString() === organizationId.toString() && t.isActive
  )
}

// Check if user has line_manager role in any team
AccountSchema.methods.isLineManager = function () {
  return this.teams.some(t => t.role === 'line_manager' && t.isActive)
}

// Get organizations where user has a specific role
AccountSchema.methods.getOrganizationsWithRole = function (role) {
  return this.organizations.filter(o => o.role === role && o.isActive)
}

// Set current organization (for session context switching)
AccountSchema.methods.setCurrentOrganization = async function (organizationId) {
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

// Check if user is any kind of system admin
AccountSchema.methods.hasAdminAccess = function () {
  return this.isSystemAdmin || this.isSuperAdmin
}

// Check if user can manage other admins
AccountSchema.methods.canManageAdmins = function () {
  return this.isSuperAdmin === true
}

// Static: Find all system admins
AccountSchema.statics.findSystemAdmins = function () {
  return this.find({ $or: [{ isSystemAdmin: true }, { isSuperAdmin: true }] })
}

// Static: Find super admins only
AccountSchema.statics.findSuperAdmins = function () {
  return this.find({ isSuperAdmin: true })
}

export const Account = mongoose.model('AiinAccount', AccountSchema)

