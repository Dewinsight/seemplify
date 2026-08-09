const mongoose = require('mongoose');

const OrganizationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxLength: 100
  },
  description: {
    type: String,
    trim: true,
    maxLength: 500
  },
  // Link to Identity Provider organization (source of truth)
  idpOrganizationId: {
    type: String,
    unique: true,
    sparse: true,
    index: true
  },
  industry: {
    type: String,
    trim: true
  },
  size: {
    type: String,
    enum: ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+']
  },
  website: {
    type: String,
    trim: true
  },
  logo: {
    type: String // URL to logo
  },
  settings: {
    allowPublicJobApplications: {
      type: Boolean,
      default: true
    },
    requireApprovalForNewMembers: {
      type: Boolean,
      default: true
    },
    defaultCandidateStatus: {
      type: String,
      default: 'New'
    },
    defaultCurrency: {
      type: String,
      default: 'USD',
      trim: true,
      uppercase: true
    },
    defaultFeedbackTemplate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FeedbackFormTemplate'
    }
  },
  subscription: {
    plan: {
      type: String,
      // No hardcoded defaults or enum restrictions
    },
    memberLimit: {
      type: Number,
      default: 5
    },
    // License management fields
    licenseKey: {
      type: String,
      unique: true,
      sparse: true
    },
    licenseType: {
      type: String,
      enum: ['trial', 'monthly', 'annual', 'lifetime'],
      default: 'trial'
    },
    licenseStatus: {
      type: String,
      enum: ['active', 'expired', 'suspended', 'cancelled'],
      default: 'active'
    },
    licenseStartDate: {
      type: Date,
      default: Date.now
    },
    licenseEndDate: {
      type: Date
    },
    // Billing information
    billingCycle: {
      type: String,
      enum: ['monthly', 'quarterly', 'annual'],
      default: 'monthly'
    },
    nextBillingDate: {
      type: Date
    },
    paymentStatus: {
      type: String,
      enum: ['paid', 'pending', 'overdue', 'failed'],
      default: 'pending'
    },
    // Usage tracking
    currentMembers: {
      type: Number,
      default: 1
    },
    currentJobs: {
      type: Number,
      default: 0
    },
    currentCandidates: {
      type: Number,
      default: 0
    },
    // Admin notes
    adminNotes: [{
      note: String,
      addedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Admin'
      },
      addedAt: {
        type: Date,
        default: Date.now
      }
    }],
    // Credits-based resource management
    creditUsage: {
      totalCredits: {
        type: Number,
        default: 100
      },
      usedCredits: {
        type: Number,
        default: 0
      },
      remainingCredits: {
        type: Number,
        default: 100
      },
      currentCycleStart: {
        type: Date,
        default: Date.now
      },
      currentCycleEnd: {
        type: Date,
        default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      },
      transactions: [{
        action: {
          type: String,
          enum: ['createJob', 'uploadCandidate', 'scheduleInterview', 'aiMatching',
            'generateQuestions', 'aiAnalysis', 'aiInterviewCandidate', 'bulkUpload', 'reEmbed',
            'creditPurchase', 'creditRefund', 'cycleReset'],
          required: true
        },
        credits: {
          type: Number,
          required: true
        },
        entityId: mongoose.Schema.Types.ObjectId,
        entityType: {
          type: String,
          enum: ['job', 'candidate', 'interview', 'aiInterview', 'matching', 'question', 'analysis', 'system']
        },
        performedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User'
        },
        timestamp: {
          type: Date,
          default: Date.now
        },
        balanceAfter: Number,
        metadata: mongoose.Schema.Types.Mixed
      }],
      rolloverCredits: {
        type: Number,
        default: 0
      },
      creditPurchases: [{
        credits: Number,
        price: Number,
        currency: String,
        purchasedAt: Date,
        expiresAt: Date
      }],
      lowCreditWarning: {
        enabled: { type: Boolean, default: true },
        threshold: { type: Number, default: 20 },
        lastWarningAt: Date
      }
    }
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  members: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    role: {
      type: String,
      // Note: 'member' and 'staff' added for IdP compatibility
      enum: ['owner', 'admin', 'hr_manager', 'recruiter', 'interviewer', 'employee', 'member', 'staff'],
      default: 'member'
    },
    joinedAt: {
      type: Date,
      default: Date.now
    },
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    status: {
      type: String,
      enum: ['active', 'pending', 'suspended'],
      default: 'active'
    }
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  erasureState: {
    type: String,
    enum: ['active', 'tombstoned'],
    default: 'active',
    select: false,
    index: true
  },
  erasureToken: { type: String, select: false },
  erasureRequestedAt: { type: Date, select: false },
  erasureLastError: { type: String, select: false },
  // Durable cross-collection write fence. Organization deletion tombstones
  // this document first (blocking new leases) and cannot hard-delete it until
  // every live writer either releases or its bounded lease expires.
  cvWriteLeases: {
    type: [{
      token: { type: String, required: true },
      kind: { type: String, required: true },
      acquiredAt: { type: Date, required: true },
      expiresAt: { type: Date, required: true }
    }],
    default: [],
    select: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes for better performance
OrganizationSchema.index({ name: 'text' });
OrganizationSchema.index({ owner: 1 });
OrganizationSchema.index({ 'members.user': 1 });
OrganizationSchema.index({ isActive: 1 });
OrganizationSchema.index({ erasureState: 1, erasureRequestedAt: 1 });
OrganizationSchema.index({ erasureState: 1, _id: 1 });
OrganizationSchema.index({ createdAt: -1 });

// Pre-save middleware to update timestamp
OrganizationSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

// Virtual for member count
OrganizationSchema.virtual('memberCount').get(function () {
  return this.members ? this.members.filter(m => m.status === 'active').length : 0;
});

// Methods
OrganizationSchema.methods.getMemberRole = function (userId) {
  const member = this.members.find(m => m.user.toString() === userId.toString() && m.status === 'active');
  return member ? member.role : null;
};

OrganizationSchema.methods.isMember = function (userId) {
  return this.members.some(m => m.user.toString() === userId.toString() && m.status === 'active');
};

OrganizationSchema.methods.addMember = function (userId, role = 'recruiter', invitedBy = null) {
  // Check if user is already a member
  if (this.isMember(userId)) {
    throw new Error('User is already a member of this organization');
  }

  this.members.push({
    user: userId,
    role: role,
    invitedBy: invitedBy,
    status: 'active'
  });

  return this;
};

OrganizationSchema.methods.removeMember = function (userId) {
  this.members = this.members.filter(m => m.user.toString() !== userId.toString());
  return this;
};

OrganizationSchema.methods.updateMemberRole = function (userId, newRole) {
  const member = this.members.find(m => m.user.toString() === userId.toString() && m.status === 'active');
  if (member) {
    member.role = newRole;
  }
  return this;
};

// Ensure virtual fields are serialized
OrganizationSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Organization', OrganizationSchema); 
