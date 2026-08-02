const mongoose = require('mongoose');

const OnboardingReminderRuleSchema = new mongoose.Schema({
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true
  },
  template: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'OnboardingTemplate'
  },
  onboarding: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CandidateOnboarding'
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  targetType: {
    type: String,
    enum: ['candidate', 'owner', 'approver'],
    default: 'candidate'
  },
  itemTypes: [{
    type: String,
    enum: ['document', 'form', 'task', 'approval', 'handoff']
  }],
  delayHours: {
    type: Number,
    default: 24
  },
  repeatEveryHours: {
    type: Number,
    default: 48
  },
  maxSends: {
    type: Number,
    default: 3
  },
  enabled: {
    type: Boolean,
    default: true,
    index: true
  }
}, { timestamps: true });

OnboardingReminderRuleSchema.index({ organization: 1, enabled: 1 });
OnboardingReminderRuleSchema.index({ onboarding: 1, enabled: 1 });

module.exports = mongoose.model('OnboardingReminderRule', OnboardingReminderRuleSchema);
