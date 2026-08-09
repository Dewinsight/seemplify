const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  idpSubject: {
    type: String,
    trim: true,
    sparse: true,
    index: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
  },
  // Stable subject issued by the Seemplify identity provider.  Cross-product
  // services use this value to resolve the same person without coupling
  // themselves to Recruiter's local Mongo ObjectId.
  idpSubject: {
    type: String,
    trim: true,
    maxlength: 255,
    index: true,
    sparse: true,
    unique: true,
  },
  // Identity-only rows are created when another Seemplify product needs the
  // shared ChatGPT account service before the person has ever opened
  // Recruiter. They are not Recruiter accounts and must never authenticate
  // locally or fund Recruiter background work. A successful Recruiter OIDC
  // membership/app-access sync is the only flow allowed to clear this flag.
  sharedAIOnly: {
    type: Boolean,
    default: false,
    index: true,
  },
  password: {
    type: String,
    required: true,
  },
  // Profile Information
  profile: {
    firstName: {
      type: String,
      trim: true,
    },
    lastName: {
      type: String,
      trim: true,
    },
    displayName: {
      type: String,
      trim: true,
    },
    avatar: {
      type: String, // URL to profile picture
      trim: true,
    },
    title: {
      type: String, // Job title like "HR Manager", "Recruiter"
      trim: true,
    },
    bio: {
      type: String,
      maxlength: 500,
    },
    phone: {
      type: String,
      trim: true,
    },
    timezone: {
      type: String,
      default: 'Africa/Lagos',
    },
    language: {
      type: String,
      default: 'en',
    },
  },
  
  // Company Information
  company: {
    name: {
      type: String,
      trim: true,
    },
    industry: {
      type: String,
      trim: true,
    },
    size: {
      type: String,
      enum: ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+'],
    },
    website: {
      type: String,
      trim: true,
    },
    logo: {
      type: String, // URL to company logo
      trim: true,
    },
  },

  // Preferences & Settings
  preferences: {
    emailNotifications: {
      newApplications: { type: Boolean, default: true },
      interviews: { type: Boolean, default: true },
      deadlines: { type: Boolean, default: true },
      systemUpdates: { type: Boolean, default: false },
    },
    dashboardConfig: {
      defaultView: { type: String, default: 'overview', enum: ['overview', 'analytics', 'candidates', 'jobs'] },
      showQuickStats: { type: Boolean, default: true },
      preferredChartType: { type: String, default: 'line', enum: ['line', 'bar', 'pie'] },
    },
    privacy: {
      profileVisibility: { type: String, default: 'team', enum: ['private', 'team', 'company', 'public'] },
      showEmail: { type: Boolean, default: false },
      showPhone: { type: Boolean, default: false },
    },
  },

  // Profile completion tracking
  profileCompletion: {
    percentage: { type: Number, default: 0 },
    missingFields: [String],
    lastUpdated: { type: Date, default: Date.now },
  },

  // Role and permissions
  role: {
    type: String,
    default: 'recruiter',
    enum: ['admin', 'hr_manager', 'recruiter', 'interviewer', 'hiring_manager'],
  },

  permissions: [{
    type: String,
    enum: ['view_candidates', 'edit_candidates', 'delete_candidates', 'view_jobs', 'edit_jobs', 'delete_jobs', 'view_analytics', 'manage_users', 'system_settings'],
  }],

  // Activity tracking
  lastLoginAt: {
    type: Date,
  },
  loginCount: {
    type: Number,
    default: 0,
  },
  
  // Feature flags
  features: {
    aiAssistant: { type: Boolean, default: true },
    advancedAnalytics: { type: Boolean, default: false },
    bulkOperations: { type: Boolean, default: true },
    apiAccess: { type: Boolean, default: false },
  },

  // Subscription removed - users no longer have plans, only organizations do

  // Security
  twoFactorEnabled: {
    type: Boolean,
    default: false,
  },
  
  lastPasswordChange: {
    type: Date,
    default: Date.now,
  },

  resetPasswordToken: String,
  resetPasswordExpires: Date,

  // Soft delete
  isActive: {
    type: Boolean,
    default: true,
  },

  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },

  // Nylas v3 integration fields
  nylasGrantId: String,
  nylasAccountId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'NylasAccount',
    index: true 
  }, // Which Nylas account this grant belongs to
  nylasGrantStatus: { 
    type: String, 
    enum: ['valid', 'active', 'expired', 'revoked', 'invalid', 'stopped', 'reauth_pending'], 
    default: null 
  },
  calendarConnected: { type: Boolean, default: false },
  calendarProvider: { type: String, enum: ['google', 'outlook', 'yahoo', 'microsoft'], default: null },
  grantConnectedAt: { type: Date, index: true }, // NEW: Track when grant was first connected
  lastGrantRefresh: Date,
  lastGrantExpiry: Date,
  lastGrantRevocation: Date,

  // Organization membership
  organizationMemberships: [{
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true
    },
    role: {
      type: String,
      enum: ['owner', 'admin', 'hr_manager', 'recruiter', 'interviewer', 'employee'],
      required: true
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
  currentOrganization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization'
  },
  // Product authorization is organization-scoped. A person can have
  // Recruiter in org A and Performance-only access in org B; a global user
  // flag cannot safely answer which org may use this account for CV work.
  recruiterAuthorizedOrganizations: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization'
  }],
  recruiterAppAccessSyncedAt: { type: Date, default: null },
  hasCompletedOrganizationSetup: {
    type: Boolean,
    default: false
  },
  
  // MFA and Security
  security: {
    mfaEnabled: {
      type: Boolean,
      default: false
    },
    sessionVersion: {
      type: Number,
      default: 1
    },
    sessionVersionIssuedAt: {
      type: Date,
      default: Date.now
    },
    lastDeviceRevokedAt: Date,
    trustedBrowsers: [{
      fingerprint: String,
      userAgent: String,
      ip: String,
      lastUsed: Date,
      createdAt: {
        type: Date,
        default: Date.now
      }
    }],
    lastOtpSent: Date,
    otpAttempts: {
      type: Number,
      default: 0
    },
    otpLockedUntil: Date
  },

  // Identity Provider team claims (synced from OIDC userinfo)
  idpTeams: [{
    id: String,
    name: String,
    organizationId: String,
    organizationName: String,
    parentTeamId: String,
    hierarchyPath: [String],
    role: String, // 'member', 'line_manager', 'team_lead'
    isManager: Boolean,
    directReports: [String], // Account IDs
    joinedAt: Date
  }],

  // Identity Provider team permissions (for leave management)
  idpTeamPermissions: [{
    team_id: String,
    team_name: String,
    organization_id: String,
    direct_reports: [String], // Account IDs of direct reports
    permissions: [String]
  }],

  // Identity Provider API tokens (for calling IdP APIs)
  idpAccessToken: {
    type: String,
    select: false // Don't return by default for security
  },
  idpTokenExpiry: {
    type: Date
  },
  idpRefreshToken: {
    type: String,
    select: false // Don't return by default for security
  }
});

// Virtual for full name
UserSchema.virtual('fullName').get(function() {
  if (this.profile.firstName && this.profile.lastName) {
    return `${this.profile.firstName} ${this.profile.lastName}`;
  }
  return this.profile.displayName || 'User';
});

// Method to calculate profile completion
UserSchema.methods.calculateProfileCompletion = function() {
  const requiredFields = [
    'profile.firstName',
    'profile.lastName', 
    'profile.title',
    'profile.phone'
  ];
  
  const optionalFields = [
    'profile.bio',
    'profile.avatar'
  ];

  let completed = 0;
  let total = requiredFields.length + optionalFields.length;
  let missing = [];

  // Check required fields
  requiredFields.forEach(field => {
    const value = field.split('.').reduce((obj, key) => obj?.[key], this);
    if (value && value.toString().trim()) {
      completed++;
    } else {
      missing.push(field);
    }
  });

  // Check optional fields
  optionalFields.forEach(field => {
    const value = field.split('.').reduce((obj, key) => obj?.[key], this);
    if (value && value.toString().trim()) {
      completed++;
    }
  });

  const percentage = Math.round((completed / total) * 100);
  
  this.profileCompletion = {
    percentage,
    missingFields: missing,
    lastUpdated: new Date()
  };

  return percentage;
};

// Organization-related methods
UserSchema.methods.getCurrentOrganization = function() {
  return this.currentOrganization;
};

UserSchema.methods.getOrganizationRole = function(organizationId) {
  const normalizeOrgId = (value) => (value && value._id ? value._id : value)?.toString?.();
  const membership = this.organizationMemberships.find(
    m => normalizeOrgId(m.organization) === organizationId.toString() && m.isActive
  );
  return membership ? membership.role : null;
};

UserSchema.methods.hasOrganizationPermission = function(organizationId, permission) {
  const role = this.getOrganizationRole(organizationId);
  if (!role) return false;
  
  const permissions = {
    owner: ['all'],
    admin: ['manage_users', 'manage_jobs', 'manage_candidates', 'view_analytics'],
    hr_manager: ['manage_jobs', 'manage_candidates', 'view_analytics'],
    recruiter: ['manage_candidates', 'view_jobs'],
    interviewer: ['view_candidates', 'view_jobs'],
    employee: ['view_jobs'] // Employees have minimal read-only access
  };
  
  return permissions[role].includes(permission) || permissions[role].includes('all');
};

UserSchema.methods.isOrganizationMember = function(organizationId) {
  const normalizeOrgId = (value) => (value && value._id ? value._id : value)?.toString?.();
  return this.organizationMemberships.some(
    m => normalizeOrgId(m.organization) === organizationId.toString() && m.isActive
  );
};

UserSchema.methods.addOrganizationMembership = function(organizationId, role, isActive = true) {
  const normalizeOrgId = (value) => (value && value._id ? value._id : value)?.toString?.();
  const targetOrgId = organizationId.toString();
  // Check if already a member
  const existingMembership = this.organizationMemberships.find(
    m => normalizeOrgId(m.organization) === targetOrgId
  );
  
  if (existingMembership) {
    existingMembership.role = role;
    existingMembership.isActive = isActive;
    existingMembership.joinedAt = new Date();
  } else {
    this.organizationMemberships.push({
      organization: organizationId,
      role: role,
      isActive: isActive
    });
  }
  
  // Set as current organization if user has none
  if (!this.currentOrganization) {
    this.currentOrganization = organizationId;
    this.hasCompletedOrganizationSetup = true;
  }
  
  return this;
};

UserSchema.methods.removeOrganizationMembership = function(organizationId) {
  const normalizeOrgId = (value) => (value && value._id ? value._id : value)?.toString?.();
  this.organizationMemberships = this.organizationMemberships.filter(
    m => normalizeOrgId(m.organization) !== organizationId.toString()
  );
  
  // Clear current organization if it was the removed one
  if (this.currentOrganization && this.currentOrganization.toString() === organizationId.toString()) {
    const activeMemberships = this.organizationMemberships.filter(m => m.isActive);
    this.currentOrganization = activeMemberships.length > 0 ? activeMemberships[0].organization : null;
  }
  
  return this;
};

// Pre-save middleware
UserSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  
  // Ensure required nested objects exist for new/existing users
  if (!this.profile) {
    this.profile = {};
  }
  if (!this.company) {
    this.company = {};
  }
  if (!this.preferences) {
    this.preferences = {
      emailNotifications: {
        newApplications: true,
        interviews: true,
        deadlines: true,
        systemUpdates: false,
      },
      dashboardConfig: {
        defaultView: 'overview',
        showQuickStats: true,
        preferredChartType: 'line',
      },
      privacy: {
        profileVisibility: 'team',
        showEmail: false,
        showPhone: false,
      },
    };
  }
  if (!this.profileCompletion) {
    this.profileCompletion = {
      percentage: 0,
      missingFields: [],
      lastUpdated: new Date(),
    };
  }
  if (!this.subscription) {
    this.subscription = {
      plan: 'personal',
      isActive: true,
    };
  }
  
  // Calculate profile completion on save
  this.calculateProfileCompletion();
  
  next();
});

// Indexes
UserSchema.index({ 'profile.firstName': 1, 'profile.lastName': 1 });
UserSchema.index({ role: 1 });
UserSchema.index({ isActive: 1 });
UserSchema.index({ createdAt: -1 });
UserSchema.index({ currentOrganization: 1 });
UserSchema.index({ 'organizationMemberships.organization': 1 });
UserSchema.index({ recruiterAuthorizedOrganizations: 1 });
UserSchema.index({ hasCompletedOrganizationSetup: 1 });
UserSchema.index({ nylasGrantId: 1 }, { sparse: true }); // Sparse index for grant lookups
UserSchema.index({ grantConnectedAt: -1 }, { sparse: true }); // For finding oldest grants
UserSchema.index({ currentOrganization: 1, nylasGrantId: 1 }, { sparse: true }); // Compound index for org grant queries

// Ensure virtual fields are serialized
UserSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('User', UserSchema);
