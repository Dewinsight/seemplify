const mongoose = require('mongoose');

const BuilderBlockSchema = new mongoose.Schema({
  id: { type: String, required: true },
  type: {
    type: String,
    enum: ['logo', 'heading', 'text', 'section', 'table', 'signature', 'pageBreak'],
    required: true
  },
  content: mongoose.Schema.Types.Mixed,
  style: mongoose.Schema.Types.Mixed
}, { _id: false });

const SignatureFieldSchema = new mongoose.Schema({
  id: { type: String, required: true },
  role: {
    type: String,
    enum: ['candidate', 'internal'],
    default: 'candidate'
  },
  type: {
    type: String,
    enum: ['signature', 'date', 'name', 'email', 'text'],
    default: 'signature'
  },
  label: { type: String, trim: true },
  signerKey: { type: String, trim: true },
  page: { type: Number, default: 1, min: 1 },
  x: { type: Number, default: 0.1, min: 0, max: 1 },
  y: { type: Number, default: 0.1, min: 0, max: 1 },
  width: { type: Number, default: 0.25, min: 0.01, max: 1 },
  height: { type: Number, default: 0.08, min: 0.01, max: 1 },
  required: { type: Boolean, default: true }
}, { _id: false });

const FileSnapshotSchema = new mongoose.Schema({
  url: String,
  downloadUrl: String,
  publicId: String,
  resourceType: String,
  format: String,
  bytes: Number,
  originalName: String,
  mimeType: String,
  renderedAt: Date
}, { _id: false });

const OnboardingDocumentSchema = new mongoose.Schema({
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true
  },
  template: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'OnboardingDocumentTemplate'
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  sourceType: {
    type: String,
    enum: ['builder', 'uploaded_pdf', 'uploaded_docx'],
    default: 'builder',
    index: true
  },
  status: {
    type: String,
    enum: ['draft', 'ready', 'sent', 'archived'],
    default: 'draft',
    index: true
  },
  builderBlocks: {
    type: [BuilderBlockSchema],
    default: []
  },
  variables: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  signatureFields: {
    type: [SignatureFieldSchema],
    default: []
  },
  originalFile: FileSnapshotSchema,
  pdfSnapshot: FileSnapshotSchema,
  lockedAt: Date,
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, { timestamps: true });

OnboardingDocumentSchema.index({ organization: 1, status: 1, createdAt: -1 });
OnboardingDocumentSchema.index({ organization: 1, title: 1 });

module.exports = mongoose.model('OnboardingDocument', OnboardingDocumentSchema);
