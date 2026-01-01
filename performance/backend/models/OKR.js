const mongoose = require('mongoose');

const OKRSchema = new mongoose.Schema({
  type: { 
    type: String, 
    enum: ['individual', 'team', 'organization'], 
    required: true 
  },
  ownerId: { 
    type: String, 
    required: true 
  }, // UserId or TeamId from IdP
  organizationId: { 
    type: String, 
    required: true 
  },
  period: { 
    type: String, 
    required: true 
  }, // e.g., "Q1 2025"
  status: { 
    type: String, 
    enum: ['draft', 'active', 'closed'], 
    default: 'draft' 
  },
  
  // AI-Enhanced Objectives
  objectives: [{
    title: { 
      type: String, 
      required: true 
    },
    description: String,
    weight: Number, // Percentage
    keyResults: [{
      title: { 
        type: String, 
        required: true 
      },
      metricType: { 
        type: String, 
        enum: ['percentage', 'number', 'currency', 'boolean'] 
      },
      startValue: { 
        type: Number, 
        default: 0 
      },
      targetValue: { 
        type: Number, 
        required: true 
      },
      currentValue: { 
        type: Number, 
        default: 0 
      },
      lastUpdated: Date,
      aiSuggestions: String, // GPT-4.1 generated suggestions
    }],
    aiGenerated: { 
      type: Boolean, 
      default: false 
    }, // Flag for AI-created objectives
    aiConfidence: { 
      type: Number, 
      min: 0, 
      max: 100 
    } // Confidence score
  }],
  
  // Team Integration
  teamHierarchy: {
    teamId: String,
    teamPath: [String], // Derived from Team hierarchy path
    managedTeams: [String] // For team-level OKRs
  },
  
  // OKR Alignment / Cascading
  alignment: {
    parentOKRId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'OKR'
    },
    parentObjectiveIndex: Number, // Index of objective this aligns to
    alignmentType: {
      type: String,
      enum: ['cascade', 'contribute', 'reference'],
      default: 'cascade'
    },
    alignmentNotes: String
  },
  
  // Children OKRs (populated dynamically)
  childOKRIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'OKR'
  }],
  
  // Overall progress (calculated)
  progress: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
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

// Indexes for performance
OKRSchema.index({ organizationId: 1, ownerId: 1, status: 1, type: 1 });
OKRSchema.index({ 'teamHierarchy.teamId': 1 });
OKRSchema.index({ 'alignment.parentOKRId': 1 });

// Pre-save middleware to calculate progress
OKRSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  
  // Calculate overall progress from key results
  if (this.objectives && this.objectives.length > 0) {
    let totalProgress = 0;
    let krCount = 0;
    
    this.objectives.forEach(obj => {
      if (obj.keyResults && obj.keyResults.length > 0) {
        obj.keyResults.forEach(kr => {
          if (kr.targetValue && kr.targetValue !== kr.startValue) {
            const range = kr.targetValue - (kr.startValue || 0);
            const current = (kr.currentValue || 0) - (kr.startValue || 0);
            const progress = Math.min(100, Math.max(0, (current / range) * 100));
            totalProgress += progress;
            krCount++;
          } else if (kr.metricType === 'boolean') {
            totalProgress += kr.currentValue ? 100 : 0;
            krCount++;
          }
        });
      }
    });
    
    this.progress = krCount > 0 ? Math.round(totalProgress / krCount) : 0;
  }
  
  next();
});

// Virtual for alignment depth (how many levels up to root)
OKRSchema.virtual('alignmentDepth').get(function() {
  // This would need to be calculated via populate in real queries
  return this.alignment?.parentOKRId ? 1 : 0;
});

OKRSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.models.OKR || mongoose.model('OKR', OKRSchema);