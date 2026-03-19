const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
  },
  idpSub: {
    type: String,
    index: true,
    sparse: true
  },
  password: {
    type: String,
    // Password not required if authenticated via OIDC
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
  
  // Organization membership
  organizationMemberships: [{
    organization: {
      type: String, // Storing as String ID for now to avoid dependency on Organization model
      required: true
    },
    role: {
      type: String,
      enum: ['owner', 'admin', 'hr_manager', 'recruiter', 'interviewer', 'employee', 'staff'],
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
    type: String
  },
  // Current team within current organization (for team switching)
  currentTeamId: {
    type: String
  },
  hasCompletedOrganizationSetup: {
    type: Boolean,
    default: false
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
    managerId: String,
    managerName: String,
    managerEmail: String,
    directReports: [String], // Account IDs
    directReportAccountIds: [String],
    joinedAt: Date
  }],

  // Identity Provider team permissions
  idpTeamPermissions: [{
    team_id: String,
    team_name: String,
    organization_id: String,
    direct_reports: [String], // Account IDs of direct reports
    permissions: [String]
  }],

  // Identity Provider organizations (synced from OIDC userinfo)
  idpOrganizations: [{
    id: String,
    name: String,
    slug: String,
    logo: String,
    role: String, // 'owner', 'admin', 'hr_manager', 'employee'
    designation: String,
    employeeId: String,
    departmentId: String,
    departmentName: String,
    joinedAt: Date
  }],

  // Current organization ID for multi-org users
  currentOrganizationId: String,

  isActive: {
    type: Boolean,
    default: true,
  },

  lastGrantRefresh: {
    type: Date
  },

  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  }
});

// Virtual for full name
UserSchema.virtual('fullName').get(function() {
  if (this.profile.firstName && this.profile.lastName) {
    return `${this.profile.firstName} ${this.profile.lastName}`;
  }
  return this.profile.displayName || 'User';
});

// Pre-save middleware
UserSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Indexes
// Note: email already has unique: true which creates an index automatically
UserSchema.index({ currentOrganization: 1 });
UserSchema.index({ 'idpTeams.id': 1 });

// Ensure virtual fields are serialized
UserSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('User', UserSchema);
