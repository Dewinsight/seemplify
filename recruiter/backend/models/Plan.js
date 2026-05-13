const mongoose = require('mongoose');

const PlanSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  code: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    unique: true
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    default: 'USD'
  },
  billingCycle: {
    type: String,
    enum: ['monthly', 'quarterly', 'annual', 'yearly', 'custom'],
    default: 'monthly'
  },
  features: [{
    name: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String,
      trim: true
    },
    included: {
      type: Boolean,
      default: true
    }
  }],
  limits: {
    // Organization Plans - controls internal organization resources only
    memberLimit: {
      type: mongoose.Schema.Types.Mixed, // Can be number or string ('unlimited')
      default: 0
    },
    storageLimit: {
      type: mongoose.Schema.Types.Mixed, // Can be number (MB) or string ('unlimited')
      default: 0
    },
    apiCallsLimit: {
      type: mongoose.Schema.Types.Mixed, // Can be number or string ('unlimited')
      default: 0
    }
  },
  // Credits-based resource management
  credits: {
    totalCredits: {
      type: Number,
      required: true,
      min: 0,
      default: 2000
    },
    creditCosts: {
      createJob: { type: Number, default: 4, min: 0 },
      uploadCandidate: { type: Number, default: 7, min: 0 },
      scheduleInterview: { type: Number, default: 2, min: 0 },
      aiMatching: { type: Number, default: 11, min: 0 },
      generateQuestions: { type: Number, default: 6, min: 0 },
      aiAnalysis: { type: Number, default: 12, min: 0 },
      aiInterviewCandidate: { type: Number, default: 12, min: 0 },
      bulkUpload: { type: Number, default: 5, min: 0 },
      reEmbed: { type: Number, default: 3, min: 0 }
    },
    rolloverEnabled: {
      type: Boolean,
      default: false
    },
    rolloverPercentage: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    }
  },
  trialDays: {
    type: Number,
    default: 0
  },
  isPublished: {
    type: Boolean,
    default: true
  },
  displayOrder: {
    type: Number,
    default: 0
  },
  planType: {
    type: String,
    enum: ['organization'], // Only organization plans now
    default: 'organization',
    required: true
  },
  isDefault: {
    type: Boolean,
    default: false
  },
  isCustom: {
    type: Boolean,
    default: false
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

// Update the updatedAt timestamp before saving
PlanSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Method to convert to a simple object with limits parsed
PlanSchema.methods.toPublicJSON = function() {
  const planObject = this.toObject();
  
  // Process limits to convert 'unlimited' string to appropriate frontend representation
  if (planObject.limits) {
    Object.keys(planObject.limits).forEach(key => {
      if (planObject.limits[key] === 'unlimited') {
        planObject.limits[key] = Infinity;
      }
    });
  }
  
  return planObject;
};

module.exports = mongoose.model('Plan', PlanSchema);
