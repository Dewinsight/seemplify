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
  currencyScope: {
    type: String,
    enum: ['calculation_currency', 'payroll_currency'],
    default: 'calculation_currency',
  },
  currencyCode: { type: String, uppercase: true, trim: true, maxlength: 3, default: '' },
  evidenceRequiredWhenPositive: { type: Boolean, default: false },
  evidenceFieldKey: { type: String, trim: true, default: '' },
  defaultValue: Schema.Types.Mixed,
  options: [FieldOptionSchema],
}, { _id: false });

const TaxSourceLinkSchema = new Schema({
  label: { type: String, required: true, trim: true },
  url: { type: String, required: true, trim: true },
  authorityType: {
    type: String,
    enum: [
      'legislation',
      'tax_authority',
      'social_security_authority',
      'official_guidance',
      'court_or_ruling',
      'secondary',
    ],
    default: 'official_guidance',
  },
  isPrimary: { type: Boolean, default: true },
  publishedAt: { type: Date, default: null },
  checkedAt: { type: Date, default: null },
  retrievedAt: { type: Date, default: null },
  effectiveFrom: { type: Date, default: null },
  effectiveTo: { type: Date, default: null },
  contentDigestSha256: {
    type: String,
    lowercase: true,
    trim: true,
    match: /^[a-f0-9]{64}$/,
    default: '',
  },
  archiveReference: { type: String, default: '', trim: true },
}, { _id: true });

const TaxCertificationReviewSchema = new Schema({
  role: {
    type: String,
    enum: ['tax_law', 'payroll_calculation', 'independent_qa'],
    required: true,
  },
  decision: {
    type: String,
    enum: ['approved', 'changes_requested', 'rejected'],
    required: true,
  },
  contentHash: { type: String, required: true, trim: true },
  reviewer: {
    userId: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    credentialType: {
      type: String,
      enum: ['professional_license', 'professional_membership', 'engagement', 'internal_appointment'],
    },
    credentialReference: { type: String, default: '', trim: true },
    authorizationId: { type: Schema.Types.ObjectId, default: null },
  },
  sourceReferences: { type: [String], default: [] },
  fixtureRunReference: { type: String, default: '', trim: true },
  notes: { type: String, default: '', trim: true },
  reviewedAt: { type: Date, default: Date.now },
}, { _id: true });

const TaxAutomatedTechnicalReviewSchema = new Schema({
  runReference: { type: String, required: true, trim: true },
  contentHash: { type: String, required: true, trim: true },
  origin: {
    type: String,
    enum: ['deterministic', 'ai_assisted'],
    required: true,
  },
  generatedByAI: { type: Boolean, required: true, default: false },
  engine: {
    provider: { type: String, default: '', trim: true },
    model: { type: String, default: '', trim: true },
    promptVersion: { type: String, default: '', trim: true },
    outputDigestSha256: {
      type: String,
      lowercase: true,
      trim: true,
      match: /^[a-f0-9]{64}$/,
      default: '',
    },
  },
  objectiveStatus: {
    type: String,
    enum: ['passed', 'failed'],
    required: true,
  },
  productionApproval: { type: Boolean, required: true, default: false },
  humanReviewRequired: { type: Boolean, required: true, default: true },
  checks: [{
    code: { type: String, required: true, trim: true },
    status: { type: String, enum: ['passed', 'failed'], required: true },
    details: { type: [String], default: [] },
  }],
  unresolvedLegalContradictions: { type: [String], default: [] },
  summary: { type: String, default: '', trim: true },
  triggeredBy: {
    userId: { type: String, default: '', trim: true },
    name: { type: String, default: '', trim: true },
  },
  completedAt: { type: Date, default: Date.now },
}, { _id: true });

const TaxPlatformReleaseSchema = new Schema({
  releaseId: { type: String, required: true, trim: true },
  channel: { type: String, enum: ['stable'], default: 'stable' },
  releasedAt: { type: Date, required: true },
  evidenceReference: { type: String, required: true, trim: true },
  implementationDigestSha256: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    match: /^[a-f0-9]{64}$/,
  },
  fixtureDigestSha256: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    match: /^[a-f0-9]{64}$/,
  },
  fixtureSuite: { type: String, required: true, trim: true },
}, { _id: false });

const TaxReviewerAuthorizationSchema = new Schema({
  userId: { type: String, required: true, trim: true },
  name: { type: String, required: true, trim: true },
  roles: [{
    type: String,
    enum: ['tax_law', 'payroll_calculation', 'independent_qa'],
  }],
  credentialType: {
    type: String,
    enum: ['professional_license', 'professional_membership', 'engagement', 'internal_appointment'],
    required: true,
  },
  credentialReference: { type: String, required: true, trim: true },
  verifiedBy: {
    userId: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
  },
  verifiedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: null },
  status: { type: String, enum: ['active', 'revoked'], default: 'active' },
  revokedBy: {
    userId: { type: String, default: '', trim: true },
    name: { type: String, default: '', trim: true },
  },
  revokedAt: { type: Date, default: null },
  revocationReason: { type: String, default: '', trim: true },
  notes: { type: String, default: '', trim: true },
}, { _id: true });

const TaxPackCreationProvenanceSchema = new Schema({
  kind: {
    type: String,
    enum: ['manual', 'rollout_backlog', 'clone', 'legacy_import', 'system_seed'],
    default: 'manual',
  },
  reference: { type: String, default: '', trim: true },
  backlogGroupId: { type: String, default: '', trim: true },
  backlogEntryCode: { type: String, default: '', uppercase: true, trim: true },
  sourceUrl: { type: String, default: '', trim: true },
  sourceLabel: { type: String, default: '', trim: true },
  clonedFromVersionId: { type: Schema.Types.ObjectId, default: null },
  recordedAt: { type: Date, default: Date.now },
  recordedBy: {
    userId: { type: String, default: '', trim: true },
    name: { type: String, default: '', trim: true },
  },
}, { _id: false });

const TaxJurisdictionVersionSchema = new Schema({
  packKey: { type: String, default: '', trim: true },
  contentHash: { type: String, default: '', trim: true },
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
  sourceLinks: [TaxSourceLinkSchema],
  notes: [String],
  validationStatus: {
    type: String,
    enum: ['draft', 'validated', 'needs_review'],
    default: 'draft',
  },
  calculationStatus: {
    type: String,
    enum: ['runnable', 'preview_only', 'blocked'],
    default: 'blocked',
  },
  coverage: {
    level: {
      type: String,
      enum: ['national', 'federal', 'subdivision', 'local', 'organization_override', 'template'],
      default: 'national',
    },
    modules: { type: [String], default: [] },
    exclusions: { type: [String], default: [] },
    supportedSubdivisions: { type: [String], default: [] },
  },
  calculationCurrency: { type: String, uppercase: true, trim: true, maxlength: 3, default: '' },
  reviewedBy: {
    userId: { type: String, default: '' },
    name: { type: String, default: '' },
    reviewedAt: { type: Date, default: null },
  },
  authoredBy: {
    userId: { type: String, default: '', trim: true },
    name: { type: String, default: '', trim: true },
  },
  legalOpenIssues: { type: [String], default: [] },
  platformRelease: { type: TaxPlatformReleaseSchema, default: null },
  certificationReviews: { type: [TaxCertificationReviewSchema], default: [] },
  automatedTechnicalReviews: { type: [TaxAutomatedTechnicalReviewSchema], default: [] },
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
  localityCode: {
    type: String,
    default: '',
    uppercase: true,
    trim: true,
    maxlength: 64,
  },
  localityName: {
    type: String,
    default: '',
    trim: true,
  },
  jurisdictionLevel: {
    type: String,
    enum: ['national', 'federal', 'subdivision', 'local', 'organization_override', 'template'],
    default: 'national',
    index: true,
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
  creationProvenance: {
    type: TaxPackCreationProvenanceSchema,
    default: () => ({ kind: 'manual' }),
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
  reviewTeam: { type: [TaxReviewerAuthorizationSchema], default: [] },
}, {
  timestamps: true,
});

TaxJurisdictionConfigSchema.index(
  {
    scope: 1,
    organizationId: 1,
    countryCode: 1,
    subdivisionCode: 1,
    localityCode: 1,
    displayName: 1,
  },
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
    localityCode: this.localityCode,
    localityName: this.localityName,
    jurisdictionLevel: this.jurisdictionLevel,
    displayName: this.displayName,
    description: this.description,
    status: this.status,
    clonedFromId: this.clonedFromId,
    creationProvenance: this.creationProvenance,
    publishedVersionId: this.publishedVersionId,
    publishedVersion: publishedVersion ? {
      _id: publishedVersion._id,
      label: publishedVersion.label,
      versionNumber: publishedVersion.versionNumber,
      effectiveFrom: publishedVersion.effectiveFrom,
      effectiveTo: publishedVersion.effectiveTo,
      validationStatus: publishedVersion.validationStatus,
      calculationStatus: publishedVersion.calculationStatus,
      coverage: publishedVersion.coverage,
      calculationCurrency: publishedVersion.calculationCurrency,
      contentHash: publishedVersion.contentHash,
      platformRelease: publishedVersion.platformRelease || null,
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
