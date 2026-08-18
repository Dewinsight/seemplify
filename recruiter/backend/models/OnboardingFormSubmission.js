const mongoose = require('mongoose');

const FileSnapshotSchema = new mongoose.Schema({
  url: String,
  downloadUrl: String,
  provider: { type: String, enum: ['cloudinary', 'azure-blob'], default: 'cloudinary' },
  storageProvider: { type: String, enum: ['cloudinary', 'azure-blob'], default: 'cloudinary' },
  storageKey: String,
  storageContainer: String,
  publicId: String,
  resourceType: String,
  format: String,
  bytes: Number,
  originalName: String,
  mimeType: String,
  renderedAt: Date
}, { _id: false });

const FormValueSchema = new mongoose.Schema({
  fieldId: { type: String, required: true },
  key: { type: String, required: true, trim: true },
  label: { type: String, required: true, trim: true },
  type: { type: String, required: true },
  sensitive: { type: Boolean, default: false },
  value: mongoose.Schema.Types.Mixed,
  encryptedValue: mongoose.Schema.Types.Mixed,
  valuePreview: String,
  files: {
    type: [FileSnapshotSchema],
    default: []
  },
  updatedAt: Date
}, { _id: false });

const OnboardingFormSubmissionSchema = new mongoose.Schema({
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true
  },
  onboarding: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CandidateOnboarding',
    required: true,
    index: true
  },
  candidate: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Candidate',
    index: true
  },
  candidateAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CandidateAccount',
    index: true
  },
  formTemplate: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'OnboardingFormTemplate'
  },
  templateSnapshot: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  status: {
    type: String,
    enum: ['draft', 'submitted', 'under_review', 'approved', 'rejected'],
    default: 'draft',
    index: true
  },
  values: {
    type: [FormValueSchema],
    default: []
  },
  hasSensitiveValues: {
    type: Boolean,
    default: false,
    index: true
  },
  submittedAt: Date,
  reviewedAt: Date,
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  reviewerNotes: {
    type: String,
    trim: true
  },
  rejectionReason: {
    type: String,
    trim: true
  }
}, { timestamps: true });

OnboardingFormSubmissionSchema.index({ organization: 1, status: 1, updatedAt: -1 });
OnboardingFormSubmissionSchema.index({ onboarding: 1, status: 1 });
OnboardingFormSubmissionSchema.index({ candidateAccount: 1, status: 1 });

module.exports = mongoose.model('OnboardingFormSubmission', OnboardingFormSubmissionSchema);
