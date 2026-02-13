import mongoose from 'mongoose'

const OnboardingAssignmentItemSchema = new mongoose.Schema({
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
      member: { type: mongoose.Schema.Types.ObjectId, ref: 'AiinAccount' },
      name: { type: String, trim: true },
      email: { type: String, trim: true }
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
      signerId: { type: mongoose.Schema.Types.ObjectId, ref: 'AiinAccount' }
    }]
  },
  status: {
    type: String,
    enum: ['pending', 'submitted', 'completed'],
    default: 'pending'
  },
  data: {
    form: mongoose.Schema.Types.Mixed,
    upload: {
      url: { type: String, trim: true },
      publicId: { type: String, trim: true },
      fileName: { type: String, trim: true },
      mimeType: { type: String, trim: true },
      size: { type: Number },
      uploadedAt: { type: Date }
    },
    esign: {
      status: { type: String, trim: true },
      signedAt: { type: Date },
      signerEmail: { type: String, trim: true },
      signerName: { type: String, trim: true },
      originalUrl: { type: String, trim: true },
      signedUrl: { type: String, trim: true },
      signedPublicId: { type: String, trim: true },
      signedFileName: { type: String, trim: true },
      signedMimeType: { type: String, trim: true },
      ipAddress: { type: String, trim: true },
      userAgent: { type: String, trim: true },
      signers: [{
        member: { type: mongoose.Schema.Types.ObjectId, ref: 'AiinAccount' },
        name: { type: String, trim: true },
        email: { type: String, trim: true },
        status: { type: String, trim: true },
        signedAt: { type: Date },
        signerName: { type: String, trim: true },
        ipAddress: { type: String, trim: true },
        userAgent: { type: String, trim: true }
      }]
    }
  }
}, { _id: true })

const OnboardingAssignmentSchema = new mongoose.Schema({
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinOrganization',
    required: true,
    index: true
  },
  member: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    required: true,
    index: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    required: true
  },
  template: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinOnboardingTemplate'
  },
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'completed', 'cancelled'],
    default: 'pending',
    index: true
  },
  dueAt: {
    type: Date
  },
  items: [OnboardingAssignmentItemSchema],
  completedAt: {
    type: Date
  },
  cancelledAt: {
    type: Date
  }
}, { timestamps: true })

OnboardingAssignmentSchema.index({ organization: 1, member: 1, status: 1 })
OnboardingAssignmentSchema.index({ member: 1, status: 1 })

export const OnboardingAssignment = mongoose.model('AiinOnboardingAssignment', OnboardingAssignmentSchema)
