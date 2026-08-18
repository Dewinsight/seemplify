const mongoose = require('mongoose');

const SignatureFieldSchema = new mongoose.Schema({
  id: { type: String, required: true },
  role: {
    type: String,
    enum: ['candidate', 'internal', 'external'],
    default: 'candidate'
  },
  type: {
    type: String,
    enum: ['signature', 'date', 'name', 'email', 'text', 'image'],
    default: 'signature'
  },
  label: String,
  placeholder: String,
  multiline: { type: Boolean, default: false },
  signerKey: { type: String, trim: true },
  page: { type: Number, default: 1 },
  x: { type: Number, default: 0.1 },
  y: { type: Number, default: 0.1 },
  width: { type: Number, default: 0.25 },
  height: { type: Number, default: 0.08 },
  required: { type: Boolean, default: true }
}, { _id: false });

const FileSnapshotSchema = new mongoose.Schema({
  url: String,
  downloadUrl: String,
  provider: { type: String, enum: ['cloudinary', 'azure-blob'], default: 'cloudinary' },
  storageProvider: { type: String, enum: ['cloudinary', 'azure-blob'], default: 'cloudinary' },
  storageKey: String,
  storageContainer: String,
  publicId: String,
  resourceType: String,
  deliveryType: String,
  format: String,
  bytes: Number,
  originalName: String,
  mimeType: String,
  renderedAt: Date
}, { _id: false });

const EnvelopeDocumentSchema = new mongoose.Schema({
  document: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'OnboardingDocument',
    required: true
  },
  title: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'signed', 'completed', 'voided'],
    default: 'pending'
  },
  pdfSnapshot: FileSnapshotSchema,
  signedPdf: FileSnapshotSchema,
  signatureFields: {
    type: [SignatureFieldSchema],
    default: []
  },
  signedAt: Date
}, { _id: true });

const SignerSchema = new mongoose.Schema({
  key: {
    type: String,
    trim: true
  },
  role: {
    type: String,
    enum: ['candidate', 'internal', 'external'],
    required: true
  },
  name: String,
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  order: {
    type: Number,
    default: 1
  },
  candidateAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CandidateAccount'
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  status: {
    type: String,
    enum: ['pending', 'viewed', 'signed', 'declined'],
    default: 'pending'
  },
  viewedAt: Date,
  signedAt: Date,
  declinedAt: Date,
  declinedReason: String,
  lastReminderAt: Date,
  loginCodeHash: {
    type: String,
    select: false
  },
  loginCodeExpiresAt: {
    type: Date,
    select: false
  },
  loginCodeAttempts: {
    type: Number,
    default: 0,
    select: false
  },
  loginCodeSentAt: {
    type: Date,
    select: false
  }
}, { _id: true });

const OnboardingEnvelopeSchema = new mongoose.Schema({
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required() {
      return this.contextType !== 'team_signing';
    },
    index: true
  },
  onboarding: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CandidateOnboarding',
    required() {
      return this.contextType !== 'team_signing';
    },
    index: true
  },
  contextType: {
    type: String,
    enum: ['candidate_transition', 'team_signing'],
    default: 'candidate_transition',
    index: true
  },
  processType: {
    type: String,
    enum: ['onboarding', 'exit', 'retirement', 'team_signing'],
    default: 'onboarding',
    index: true
  },
  candidate: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Candidate',
    index: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  message: {
    type: String,
    trim: true
  },
  status: {
    type: String,
    enum: ['draft', 'sent', 'viewed', 'partially_signed', 'completed', 'voided', 'expired'],
    default: 'draft',
    index: true
  },
  documents: {
    type: [EnvelopeDocumentSchema],
    default: []
  },
  signers: {
    type: [SignerSchema],
    default: []
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  sentAt: Date,
  completedAt: Date,
  voidedAt: Date,
  voidReason: String
}, { timestamps: true });

OnboardingEnvelopeSchema.index({ organization: 1, status: 1, createdAt: -1 });
OnboardingEnvelopeSchema.index({ organization: 1, candidate: 1, createdAt: -1 });
OnboardingEnvelopeSchema.index({ organization: 1, contextType: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('OnboardingEnvelope', OnboardingEnvelopeSchema);
