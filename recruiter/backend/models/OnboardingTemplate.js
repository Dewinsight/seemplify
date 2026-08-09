const mongoose = require('mongoose');

const TemplateWorkflowItemSchema = new mongoose.Schema({
  id: { type: String, required: true },
  type: {
    type: String,
    enum: ['document', 'form', 'task', 'approval', 'handoff'],
    required: true
  },
  title: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  ownerType: {
    type: String,
    enum: ['candidate', 'user', 'system'],
    default: 'candidate'
  },
  defaultOwnerRole: { type: String, trim: true },
  defaultOwnerUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  dueOffsetDays: Number,
  dueInDays: Number,
  order: { type: Number, default: 0 },
  required: { type: Boolean, default: true },
  dependencyKeys: [{ type: String, trim: true }],
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, { _id: false });

const OnboardingTemplateSchema = new mongoose.Schema({
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  category: {
    type: String,
    trim: true,
    default: 'default',
    index: true
  },
  processType: {
    type: String,
    enum: ['onboarding', 'exit', 'retirement', 'agreement', 'policy', 'general', 'team_signing', 'compliance_documents'],
    default: 'onboarding',
    index: true
  },
  status: {
    type: String,
    enum: ['active', 'archived'],
    default: 'active',
    index: true
  },
  version: {
    type: Number,
    default: 1
  },
  documents: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'OnboardingDocument'
  }],
  formTemplates: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'OnboardingFormTemplate'
  }],
  workflowItems: {
    type: [TemplateWorkflowItemSchema],
    default: []
  },
  reminderRules: {
    type: [mongoose.Schema.Types.Mixed],
    default: []
  },
  completionActions: {
    type: [mongoose.Schema.Types.Mixed],
    default: []
  },
  isSystem: {
    type: Boolean,
    default: false,
    index: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, { timestamps: true });

OnboardingTemplateSchema.index({ organization: 1, status: 1, name: 1 });
OnboardingTemplateSchema.index({ organization: 1, category: 1, createdAt: -1 });
OnboardingTemplateSchema.index({ organization: 1, processType: 1, status: 1, name: 1 });

module.exports = mongoose.model('OnboardingTemplate', OnboardingTemplateSchema);
