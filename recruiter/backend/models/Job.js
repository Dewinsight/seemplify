const mongoose = require('mongoose');

const JobSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Job title is required'],
    trim: true,
  },
  department: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    required: [true, 'Department is required'],
  },
  location: {
    type: String,
    required: [true, 'Location is required'],
    trim: true,
  },
  type: { // e.g., 'Full-time', 'Part-time', 'Contract', 'Internship' - DYNAMIC ENUM
    type: String,
    required: [true, 'Job type is required'],
    trim: true,
    // Removed enum constraint to allow dynamic values
  },
  level: { // e.g., 'Entry', 'Mid', 'Senior', 'Lead', 'Executive', 'Manager' - DYNAMIC ENUM
    type: String,
    required: [true, 'Job level is required'],
    trim: true,
    // Removed enum constraint to allow dynamic values like 'Manager', 'Director', etc.
  },
  description: {
    type: String,
    required: [true, 'Job description is required'],
  },
  requirements: {
    type: String,
    required: [true, 'Job requirements are required'],
  },
  responsibilities: {
    type: String,
    required: [true, 'Job responsibilities are required'],
  },
  skills: { // Comma-separated string of required skills
    type: String,
    trim: true,
  },
  experience: { // Required years of experience - DYNAMIC ENUM
    type: String,
    required: [true, 'Experience requirement is required'],
    trim: true,
    // Removed enum constraint to allow dynamic values like '3-5', '2-4', etc.
  },
  education: { // Minimum education requirement - DYNAMIC ENUM
    type: String,
    required: [true, 'Education requirement is required'],
    trim: true,
    // Removed enum constraint to allow dynamic values like 'Bachelor', 'MBA', etc.
  },
  salary: {
    min: {
      type: Number,
      min: 0,
    },
    max: {
      type: Number,
      min: 0,
    },
    currency: {
      type: String,
      default: 'USD',
      trim: true,
      uppercase: true
      // Removed enum constraint to allow dynamic currencies from Currency model
    },
    period: {
      type: String,
      default: 'annually',
      enum: ['hourly', 'monthly', 'annually'],
    },
  },
  benefits: {
    type: String,
    trim: true,
  },
  status: {
    type: String,
    default: 'draft',
    enum: ['draft', 'active', 'paused', 'closed', 'archived'],
  },
  priority: {
    type: String,
    default: 'medium',
    enum: ['low', 'medium', 'high', 'urgent'],
  },
  remote: {
    type: Boolean,
    default: false,
  },
  openings: { // Number of positions available
    type: Number,
    default: 1,
    min: 1,
  },
  // Application tracking with enhanced audit trail
  shortlist: [{
    candidate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Candidate',
      required: true,
    },
    addedAt: {
      type: Date,
      default: Date.now,
    },
    addedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    status: {
      type: String,
      default: 'shortlisted',
      enum: ['shortlisted', 'moved_to_pipeline', 'rejected'],
    },
    movedToPipelineAt: {
      type: Date,
    },
    relevanceScore: {
      type: Number,
      min: 0,
      max: 1,
    },
  }],
  applicants: [{
    candidate: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Candidate',
      required: true,
    },
    appliedAt: {
      type: Date,
      default: Date.now,
    },
    applicationType: {
      type: String,
      enum: ['public', 'internal', 'manual'],
      default: 'manual', // For backward compatibility
    },
    status: {
      type: String,
      default: 'applied',
      enum: ['applied', 'reviewing', 'shortlisted', 'interviewing', 'keep_in_view', 'offered', 'hired', 'rejected'],
    },
    statusHistory: [{
      status: {
        type: String,
        enum: ['applied', 'reviewing', 'shortlisted', 'interviewing', 'keep_in_view', 'offered', 'hired', 'rejected'],
        required: true,
      },
      changedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
      },
      changedAt: {
        type: Date,
        default: Date.now,
      },
      notes: String,
      previousStatus: String,
    }],
    addedAt: {
      type: Date,
      default: Date.now,
    },
    addedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    notes: String,
    score: {
      type: Number,
      min: 0,
      max: 100,
    },
    tags: [String],
    
    // Stage Tracking
    currentStage: {
      stageId: mongoose.Schema.Types.ObjectId,
      stageName: String,
      enteredAt: Date
    },
    stageHistory: [{
      stageId: mongoose.Schema.Types.ObjectId,
      stageName: String,
      enteredAt: Date,
      exitedAt: Date,
      result: {
        type: String,
        enum: ['passed', 'failed', 'on_hold', 'withdrawn']
      },
      score: Number,
      feedback: String
    }],
    interviews: [{
      interviewId: mongoose.Schema.Types.ObjectId,
      stageId: mongoose.Schema.Types.ObjectId,
      scheduledAt: Date,
      status: String,
      score: Number
    }],
    
    // AI Insights
    aiInsights: {
      lastAnalyzed: Date,
      recommendedAction: String,
      confidence: Number,
      keyStrengths: [String],
      keyConcerns: [String]
    }
  }],
  // Hiring team
  hiringManager: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  recruiters: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  interviewers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  // Dates
  applicationDeadline: {
    type: Date,
  },
  startDate: {
    type: Date,
  },
  // Posting details
  jobBoard: {
    internal: {
      type: Boolean,
      default: true,
    },
    external: [{
      platform: String, // e.g., 'LinkedIn', 'Indeed', 'Glassdoor'
      url: String,
      postedAt: Date,
    }],
  },
  
  // Public Application Settings
  isPublic: {
    type: Boolean,
    default: false,
  },
  publicSlug: {
    type: String,
    unique: true,
    sparse: true, // Only enforce uniqueness for non-null values
    index: true,
  },
  publicUrl: {
    type: String,
  },

  // Internal Recruitment Settings
  isInternalEnabled: {
    type: Boolean,
    default: false,
  },
  internalSlug: {
    type: String,
    unique: true,
    sparse: true,
    index: true,
  },
  internalUrl: {
    type: String,
  },
  internalApplicationCount: {
    type: Number,
    default: 0,
    min: 0,
  },
  internalCandidateApplyLimit: {
    type: Number,
    min: 0,
    default: 0, // 0 means no limit
  },
  reservedInternalCredits: {
    type: Number,
    default: 0,
    min: 0,
  },
  internalSettings: {
    requireEmployeeId: {
      type: Boolean,
      default: false,
    },
    notifyHiringManager: {
      type: Boolean,
      default: true,
    },
  },

  // Analytics
  analytics: {
    views: {
      type: Number,
      default: 0,
    },
    applications: {
      type: Number,
      default: 0,
    },
    publicViews: {
      type: Number,
      default: 0,
    },
    publicApplications: {
      type: Number,
      default: 0,
    },
    internalViews: {
      type: Number,
      default: 0,
    },
    internalApplications: {
      type: Number,
      default: 0,
    },
    lastViewedAt: {
      type: Date,
    },
  },
  // Interview Pipeline Configuration
  interviewStages: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'InterviewStage'
  }],
  
  pipelineConfiguration: {
    useCustomStages: {
      type: Boolean,
      default: false
    },
    template: {
      type: String,
      enum: ['standard', 'technical', 'sales', 'executive', 'custom'],
      default: 'standard'
    },
    totalStages: {
      type: Number,
      default: 0
    },
    estimatedTimeToHire: {
      type: Number, // days
      default: 30
    },
    stageTransitions: [{
      from: String,
      to: String,
      automatic: Boolean,
      conditions: mongoose.Schema.Types.Mixed
    }]
  },

  // Metadata
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false,
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
  // Bulk upload metadata
  uploadMetadata: {
    source: String, // 'manual', 'csv', 'excel'
    batchId: String, // For tracking bulk uploads
    originalData: mongoose.Schema.Types.Mixed, // Store original CSV/Excel data
  },
  // Embedding fields
  isEmbedded: {
    type: Boolean,
    default: false,
  },
  embeddingCreatedAt: {
    type: Date,
  },
  
  // Email notification settings for candidate communications
  emailSettings: {
    enableAdvancementEmails: {
      type: Boolean,
      default: true
    },
    enableRejectionEmails: {
      type: Boolean,
      default: true
    },
    enableShortlistEmails: {
      type: Boolean,
      default: true
    },
    autoSendRejections: {
      type: Boolean,
      default: false // Require manual approval by default
    },
    senderEmail: {
      type: String,
      trim: true,
      lowercase: true
    },
    customTemplates: {
      advancement: {
        type: String,
        trim: true
      },
      shortlist: {
        type: String,
        trim: true
      },
      rejection: {
        type: String,
        trim: true
      },
      shortlistRejection: {
        type: String,
        trim: true
      },
      applicationConfirmation: {
        type: String,
        trim: true
      }
    },
    emailSignature: {
      type: String,
      trim: true
    },
    ccEmails: [{
      type: String,
      trim: true,
      lowercase: true
    }],
    bccEmails: [{
      type: String,
      trim: true,
      lowercase: true
    }],
    lastUpdated: {
      type: Date,
      default: Date.now
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },

  // Organization field - REQUIRED for data isolation
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true
  },
  // Public job settings with credit reservation
  isPublic: {
    type: Boolean,
    default: false
  },
  candidateApplyLimit: {
    type: Number,
    min: 0,
    default: 0 // 0 means no limit
  },
  reservedCredits: {
    type: Number,
    default: 0,
    min: 0
  },
  // Locked when a public application pool is funded. Plan changes must not
  // reprice an already-reserved pool or its later refunds.
  publicApplicationCreditUnitCost: {
    type: Number,
    min: 0
  },
  publicApplicationCount: {
    type: Number,
    default: 0,
    min: 0
  },
  publicApplicationReservations: [{
    processingJob: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CVProcessingJob',
      required: true
    },
    processingJobPublicId: {
      type: String,
      required: true
    },
    creditCost: {
      type: Number,
      required: true,
      min: 0
    },
    applicationCount: {
      type: Number,
      required: true,
      min: 1
    },
    limitReached: {
      type: Boolean,
      default: false
    },
    reservedAt: {
      type: Date,
      default: Date.now
    }
  }],

  // Feedback Form Configuration
  feedbackFormConfig: {
    useTemplate: {
      type: Boolean,
      default: true
    },
    templateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FeedbackFormTemplate'
    },
    overrides: {
      systemFields: [{
        fieldId: String,
        isVisible: Boolean,
        isRequired: Boolean,
        order: Number,
        label: String
      }],
      customFields: [{
        customFieldId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'CustomField'
        },
        isVisible: Boolean,
        isRequired: Boolean,
        order: Number,
        label: String
      }],
      fieldOrder: [String] // Array of field IDs in display order
    }
  }
});

// Indexes for better query performance
JobSchema.index({ title: 'text', department: 'text', description: 'text' });
JobSchema.index(
  { 'publicApplicationReservations.processingJob': 1 },
  {
    unique: true,
    sparse: true,
    name: 'uniq_public_application_processing_job'
  }
);
JobSchema.index({ status: 1 });
JobSchema.index({ department: 1 });
JobSchema.index({ location: 1 });
JobSchema.index({ type: 1 });
JobSchema.index({ createdAt: -1 });
JobSchema.index({ applicationDeadline: 1 });

// Organization-related indexes for better query performance
JobSchema.index({ organization: 1 });
JobSchema.index({ organization: 1, status: 1 });
JobSchema.index({ organization: 1, createdAt: -1 });
JobSchema.index({ organization: 1, department: 1 });

// Update 'updatedAt' field before saving
JobSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Generate public URL when job is marked as public
JobSchema.pre('save', async function(next) {
  if (this.isPublic && !this.publicUrl) {
    try {
      // Generate URL using job ID
      this.publicUrl = `/public/jobs/${this._id}`;

      // Keep publicSlug for backward compatibility but base it on ID
      this.publicSlug = this._id.toString();
    } catch (error) {
      return next(error);
    }
  }

  // Clear public URL if job is no longer public
  if (!this.isPublic && this.publicUrl) {
    this.publicSlug = undefined;
    this.publicUrl = undefined;
  }

  next();
});

// Generate internal URL when job is marked for internal recruitment
JobSchema.pre('save', async function(next) {
  if (this.isInternalEnabled && !this.internalUrl) {
    try {
      // Generate URL using job ID
      this.internalUrl = `/internal/jobs/${this._id}`;

      // Keep internalSlug for backward compatibility
      this.internalSlug = this._id.toString();
    } catch (error) {
      return next(error);
    }
  }

  // Clear internal URL if internal recruitment is disabled
  if (!this.isInternalEnabled && this.internalUrl) {
    this.internalSlug = undefined;
    this.internalUrl = undefined;
  }

  next();
});

// Virtual for applicant count
JobSchema.virtual('applicantCount').get(function() {
  return this.applicants ? this.applicants.length : 0;
});

// Virtual for shortlist count
JobSchema.virtual('shortlistCount').get(function() {
  return this.shortlist ? this.shortlist.length : 0;
});

// Virtual for days until deadline
JobSchema.virtual('daysUntilDeadline').get(function() {
  if (!this.applicationDeadline) return null;
  const today = new Date();
  const deadline = new Date(this.applicationDeadline);
  const diffTime = deadline - today;
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

// Ensure virtual fields are serialized
JobSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Job', JobSchema); 
