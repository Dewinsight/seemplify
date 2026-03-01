import mongoose from 'mongoose'

const OnboardingItemSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['form', 'upload', 'esign'],
    required: true
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  description: {
    type: String,
    trim: true,
    maxlength: 1000
  },
  required: {
    type: Boolean,
    default: true
  },
  config: {
    fields: [{
      key: { type: String, trim: true },
      label: { type: String, trim: true },
      type: {
        type: String,
        enum: ['text', 'email', 'tel', 'number', 'date', 'select', 'textarea'],
        default: 'text'
      },
      required: { type: Boolean, default: false },
      options: [{ type: String, trim: true }]
    }],
    accept: { type: String, trim: true },
    document: {
      url: { type: String, trim: true },
      publicId: { type: String, trim: true },
      fileName: { type: String, trim: true },
      mimeType: { type: String, trim: true },
      size: { type: Number }
    },
    signers: [{
      key: { type: String, trim: true },
      type: {
        type: String,
        enum: ['assignee', 'member'],
        default: 'assignee'
      },
      memberId: { type: mongoose.Schema.Types.ObjectId, ref: 'AiinAccount' },
      label: { type: String, trim: true }
    }],
    signatureFields: [{
      label: { type: String, trim: true, default: 'Signature' },
      type: {
        type: String,
        enum: ['signature', 'date', 'text'],
        default: 'signature'
      },
      page: { type: Number, default: 1 },
      x: { type: Number, default: 50 },
      y: { type: Number, default: 50 },
      width: { type: Number, default: 180 },
      height: { type: Number, default: 60 },
      origin: {
        type: String,
        enum: ['top-left', 'bottom-left'],
        default: 'top-left'
      },
      text: { type: String, trim: true },
      signerKey: { type: String, trim: true }
    }]
  }
}, { _id: true })

const OnboardingTemplateSchema = new mongoose.Schema({
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinOrganization',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 120
  },
  description: {
    type: String,
    trim: true,
    maxlength: 1000
  },
  workflowType: {
    type: String,
    enum: ['onboarding', 'agreement', 'policy', 'general'],
    default: 'onboarding',
    index: true
  },
  isDefault: {
    type: Boolean,
    default: false,
    index: true
  },
  items: [OnboardingItemSchema],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount'
  }
}, { timestamps: true })

OnboardingTemplateSchema.index({ organization: 1, isDefault: 1 })
OnboardingTemplateSchema.index({ organization: 1, workflowType: 1, createdAt: -1 })

export const OnboardingTemplate = mongoose.model('AiinOnboardingTemplate', OnboardingTemplateSchema)
