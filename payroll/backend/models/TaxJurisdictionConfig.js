const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const FieldOptionSchema = new Schema({
  value: { type: String, required: true },
  label: { type: String, required: true },
}, { _id: false });

const TaxFieldDefinitionSchema = new Schema({
  key: { type: String, required: true, trim: true },
  label: { type: String, required: true, trim: true },
  type: {
    type: String,
    enum: ['currency', 'percent', 'integer', 'boolean', 'select', 'text', 'date'],
    required: true,
  },
  required: { type: Boolean, default: false },
  placeholder: { type: String, default: '' },
  helpText: { type: String, default: '' },
  unit: { type: String, default: '' },
  defaultValue: Schema.Types.Mixed,
  options: [FieldOptionSchema],
}, { _id: false });

const TaxJurisdictionVersionSchema = new Schema({
  label: { type: String, required: true, trim: true },
  versionNumber: { type: Number, required: true, min: 1 },
  status: {
    type: String,
    enum: ['draft', 'published', 'archived'],
    default: 'draft',
  },
  effectiveFrom: { type: Date, required: true },
  effectiveTo: { type: Date, default: null },
  sourceDate: { type: Date, default: null },
  sourceLinks: [{
    label: { type: String, required: true, trim: true },
    url: { type: String, required: true, trim: true },
  }],
  notes: [String],
  validationStatus: {
    type: String,
    enum: ['draft', 'validated', 'needs_review'],
    default: 'draft',
  },
  fieldDefinitions: [TaxFieldDefinitionSchema],
  taxYear: {
    mode: {
      type: String,
      enum: ['calendar', 'uk_apr_6', 'south_africa_mar_1'],
      default: 'calendar',
    },
  },
  constants: { type: Schema.Types.Mixed, default: {} },
  incomeTax: { type: Schema.Types.Mixed, default: {} },
  statutoryRules: { type: [Schema.Types.Mixed], default: [] },
  testCases: { type: [Schema.Types.Mixed], default: [] },
}, {
  _id: true,
  timestamps: true,
});

const TaxJurisdictionConfigSchema = new Schema({
  scope: {
    type: String,
    enum: ['global', 'organization'],
    required: true,
    default: 'organization',
    index: true,
  },
  organizationId: {
    type: String,
    default: '',
    index: true,
  },
  countryCode: {
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    maxlength: 16,
    index: true,
  },
  countryName: {
    type: String,
    required: true,
    trim: true,
  },
  subdivisionCode: {
    type: String,
    default: '',
    uppercase: true,
    trim: true,
  },
  subdivisionName: {
    type: String,
    default: '',
    trim: true,
  },
  displayName: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
    default: '',
    trim: true,
  },
  status: {
    type: String,
    enum: ['draft', 'active', 'archived'],
    default: 'active',
    index: true,
  },
  clonedFromId: {
    type: Schema.Types.ObjectId,
    ref: 'TaxJurisdictionConfig',
    default: null,
  },
  publishedVersionId: {
    type: Schema.Types.ObjectId,
    default: null,
  },
  versions: [TaxJurisdictionVersionSchema],
  createdBy: {
    userId: { type: String, default: '' },
    name: { type: String, default: '' },
  },
  lastModifiedBy: {
    userId: { type: String, default: '' },
    name: { type: String, default: '' },
  },
}, {
  timestamps: true,
});

TaxJurisdictionConfigSchema.index(
  { scope: 1, organizationId: 1, countryCode: 1, subdivisionCode: 1, displayName: 1 },
  { unique: true }
);

TaxJurisdictionConfigSchema.methods.getPublishedVersion = function getPublishedVersion() {
  if (!this.publishedVersionId) return null;
  return (this.versions || []).find((version) => String(version._id) === String(this.publishedVersionId)) || null;
};

TaxJurisdictionConfigSchema.methods.toSummary = function toSummary() {
  const publishedVersion = this.getPublishedVersion();
  return {
    _id: this._id,
    scope: this.scope,
    organizationId: this.organizationId,
    countryCode: this.countryCode,
    countryName: this.countryName,
    subdivisionCode: this.subdivisionCode,
    subdivisionName: this.subdivisionName,
    displayName: this.displayName,
    description: this.description,
    status: this.status,
    clonedFromId: this.clonedFromId,
    publishedVersionId: this.publishedVersionId,
    publishedVersion: publishedVersion ? {
      _id: publishedVersion._id,
      label: publishedVersion.label,
      versionNumber: publishedVersion.versionNumber,
      effectiveFrom: publishedVersion.effectiveFrom,
      effectiveTo: publishedVersion.effectiveTo,
      validationStatus: publishedVersion.validationStatus,
      sourceLinks: publishedVersion.sourceLinks || [],
      fieldDefinitions: publishedVersion.fieldDefinitions || [],
    } : null,
    versionCount: Array.isArray(this.versions) ? this.versions.length : 0,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

module.exports = mongoose.models.TaxJurisdictionConfig
  || mongoose.model('TaxJurisdictionConfig', TaxJurisdictionConfigSchema);
