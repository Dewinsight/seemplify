const mongoose = require('mongoose');

const BuilderBlockSchema = new mongoose.Schema({
  id: { type: String, required: true },
  type: {
    type: String,
    enum: ['logo', 'heading', 'text', 'section', 'table', 'signature', 'spacer', 'pageBreak'],
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
    enum: ['signature', 'date', 'name', 'email', 'text', 'image'],
    default: 'signature'
  },
  label: { type: String, trim: true },
  placeholder: { type: String, trim: true },
  multiline: { type: Boolean, default: false },
  signerKey: { type: String, trim: true },
  page: { type: Number, default: 1, min: 1 },
  x: { type: Number, default: 0.1, min: 0, max: 1 },
  y: { type: Number, default: 0.1, min: 0, max: 1 },
  width: { type: Number, default: 0.25, min: 0.01, max: 1 },
  height: { type: Number, default: 0.08, min: 0.01, max: 1 },
  required: { type: Boolean, default: true }
}, { _id: false });

const OnboardingDocumentTemplateSchema = new mongoose.Schema({
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
    enum: ['offer', 'nda', 'privacy', 'contract', 'agreement', 'checklist', 'custom'],
    default: 'custom',
    index: true
  },
  isDefault: {
    type: Boolean,
    default: false
  },
  isSystem: {
    type: Boolean,
    default: false
  },
  builderBlocks: {
    type: [BuilderBlockSchema],
    default: []
  },
  variables: {
    type: [String],
    default: []
  },
  signatureFields: {
    type: [SignatureFieldSchema],
    default: []
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

OnboardingDocumentTemplateSchema.index({ organization: 1, name: 1 });
OnboardingDocumentTemplateSchema.index({ organization: 1, isDefault: 1 });

module.exports = mongoose.model('OnboardingDocumentTemplate', OnboardingDocumentTemplateSchema);
