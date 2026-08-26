import mongoose from 'mongoose'

const HubAppPinPreferenceSchema = new mongoose.Schema({
  pinnedAppIds: {
    type: [String],
    default: []
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  _id: false
})

const AccountSchema = new mongoose.Schema({
  sub: { type: String, unique: true, index: true },
  email: { type: String, unique: true, lowercase: true },
  passwordHash: { type: String },
  emailVerified: { type: Boolean, default: false },
  profile: {
    name: String,
    preferred_username: String,
    // Canonical cross-product avatar. Only `picture` is exposed to clients;
    // provider metadata remains private so storage objects can be replaced.
    picture: String,
    pictureStorageProvider: { type: String, enum: ['cloudinary', 'azure-blob'] },
    pictureStorageKey: String,
    pictureStorageContainer: String,
    pictureStorageResourceType: String,
    // Extended personal information for employee self-service
    personalInfo: {
      dateOfBirth: Date,
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
    }
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
    department: {
      type: mongoose.Schema.Types.ObjectId
    },
    branch: {
      type: mongoose.Schema.Types.ObjectId
    },
    appAccess: {
      mode: {
        type: String,
        enum: ['all', 'selected'],
        default: 'all'
      },
      appIds: {
        type: [String],
        default: []
      }
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

  // Personal hub preferences, isolated by organization. A present entry with
  // an empty pinnedAppIds array intentionally means "no pinned apps".
  hubPreferences: {
    pinnedAppsByOrganization: {
      type: Map,
      of: HubAppPinPreferenceSchema,
      default: () => new Map()
    }
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
    department: {
      type: mongoose.Schema.Types.ObjectId
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

  // Incremented whenever a role policy or member assignment affecting this
  // account changes. It is part of the OIDC claims-cache key so policy changes
  // invalidate safely across multiple IdP processes.
  authorizationRevision: {
    type: Number,
    default: 0
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

  acquisition: {
    firstTouch: {
      sourceType: {
        type: String,
        enum: ['website_visit', 'campaign_click', 'signup', 'demo_request', 'manual', 'unknown'],
        default: 'unknown'
      },
      source: String,
      channel: String,
      campaignId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AiinCampaign'
      },
      batchId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AiinCampaignBatch'
      },
      recipientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AiinCampaignRecipient'
      },
      campaignName: String,
      brevoCampaignId: Number,
      brevoMessageId: String,
      signedToken: String,
      visitorId: String,
      sessionId: String,
      email: String,
      landingPage: String,
      referrer: String,
      utm: {
        source: String,
        medium: String,
        campaign: String,
        term: String,
        content: String
      },
      metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
      },
      occurredAt: Date
    },
    lastTouch: {
      sourceType: {
        type: String,
        enum: ['website_visit', 'campaign_click', 'signup', 'demo_request', 'manual', 'unknown'],
        default: 'unknown'
      },
      source: String,
      channel: String,
      campaignId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AiinCampaign'
      },
      batchId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AiinCampaignBatch'
      },
      recipientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AiinCampaignRecipient'
      },
      campaignName: String,
      brevoCampaignId: Number,
      brevoMessageId: String,
      signedToken: String,
      visitorId: String,
      sessionId: String,
      email: String,
      landingPage: String,
      referrer: String,
      utm: {
        source: String,
        medium: String,
        campaign: String,
        term: String,
        content: String
      },
      metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
      },
      occurredAt: Date
    },
    conversionSource: {
      type: String,
      enum: ['website', 'campaign', 'demo_request', 'manual', 'unknown'],
      default: 'unknown'
    },
    visitorId: String,
    attributionSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },

  // Dashboard notification view checkpoints (per organization)
  notificationViews: {
    documentsByOrganization: {
      type: Map,
      of: Date,
      default: {}
    },
    simplePerformanceByOrganization: {
      type: Map,
      of: Date,
      default: {}
    },
    simpleLmsByOrganization: {
      type: Map,
      of: Date,
      default: {}
    }
  },

  // Per-item notification read checkpoints
  notificationReads: {
    documentsAssignments: {
      type: Map,
      of: Date,
      default: {}
    },
    simplePerformanceEvaluations: {
      type: Map,
      of: Date,
      default: {}
    }
  },

  // =====================================================
  // EMPLOYEE PROFILE - HR Information
  // =====================================================
  profile: {
    // Basic profile info
    name: { type: String },
    preferred_username: { type: String },

    // Extended personal information
    personalInfo: {
      dateOfBirth: Date,
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
        email: String
      }]
    },

    // Tax withholding information
    taxInfo: {
      taxId: String,
      filingStatus: {
        type: String,
        enum: ['single', 'married_jointly', 'married_separately', 'head_of_household']
      },
      w4Allowances: { type: Number, default: 0 },
      additionalWithholding: { type: Number, default: 0 },
      multipleJobs: { type: Boolean, default: false },
      lastUpdated: Date
    },
    completionReminders: {
      lastSentAt: Date,
      sendCount: { type: Number, default: 0 },
      lastCompletedAt: Date,
      lastMissingSteps: {
        type: [String],
        default: []
      }
    }
  },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
})

AccountSchema.pre('save', function(next) {
  this.updatedAt = new Date()
  next()
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
