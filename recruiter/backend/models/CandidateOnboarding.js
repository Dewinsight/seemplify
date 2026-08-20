const mongoose = require('mongoose');

const CandidateOnboardingSchema = new mongoose.Schema({
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true
  },
  candidate: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Candidate',
    index: true
  },
  subject: {
    type: {
      type: String,
      enum: ['candidate', 'idp_member'],
      default: 'candidate',
      index: true
    },
    candidateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Candidate' },
    idpAccountId: { type: String, index: true },
    email: { type: String, lowercase: true, trim: true },
    name: { type: String, trim: true },
    employeeId: { type: String, trim: true },
    snapshot: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  candidateAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CandidateAccount',
    index: true
  },
  job: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Job'
  },
  processType: {
    type: String,
    enum: ['onboarding', 'exit', 'retirement', 'agreement', 'policy', 'general', 'team_signing', 'compliance_documents'],
    default: 'onboarding',
    index: true
  },
  status: {
    type: String,
    enum: ['draft', 'pending', 'in_progress', 'ready_to_provision', 'provisioned', 'completed', 'cancelled', 'failed'],
    default: 'pending',
    index: true
  },
  title: {
    type: String,
    trim: true,
    default: 'Candidate onboarding'
  },
  notes: {
    type: String,
    trim: true
  },
  template: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'OnboardingTemplate'
  },
  templateSnapshot: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  progress: {
    totalItems: { type: Number, default: 0 },
    completedItems: { type: Number, default: 0 },
    percent: { type: Number, default: 0 }
  },
  dueAt: Date,
  startedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  startedAt: {
    type: Date,
    default: Date.now
  },
  completedAt: Date,
  cancelledAt: Date,
  inviteTokenHash: {
    type: String,
    select: false,
    index: true
  },
  inviteTokenExpiresAt: {
    type: Date,
    index: true
  },
  portalInviteUrl: String,
  documents: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'OnboardingDocument'
  }],
  envelopes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'OnboardingEnvelope'
  }],
  workflowItems: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'OnboardingWorkflowItem'
  }],
  forms: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'OnboardingFormSubmission'
  }],
  complianceDocuments: [{
    name: { type: String, trim: true },
    expiresAt: Date,
    notes: { type: String, trim: true },
    workflowItem: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'OnboardingWorkflowItem'
    }
  }],
  approvals: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'OnboardingApproval'
  }],
  handoffs: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'OnboardingHandoff'
  }],
  identityAction: {
    mode: {
      type: String,
      enum: ['manual', 'scheduled_at', 'on_workflow_completion'],
      default: 'manual'
    },
    effectiveAt: Date,
    status: {
      type: String,
      enum: ['not_ready', 'ready', 'pending', 'completed', 'failed', 'cancelled'],
      default: 'not_ready'
    },
    action: { type: String, enum: ['provision', 'deactivate', 'reactivate'] },
    idempotencyKey: String,
    idpAccountId: String,
    attempts: { type: Number, default: 0 },
    lastAttemptAt: Date,
    completedAt: Date,
    lastError: String,
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  employment: {
    role: String,
    managerId: String,
    departmentId: String,
    employeeId: String,
    appAccess: { type: mongoose.Schema.Types.Mixed, default: { mode: 'all', appIds: [] } },
    jurisdiction: { countryCode: String, subdivisionCode: String },
    startAt: Date,
    lastWorkingAt: Date
  },
  migration: {
    sourceSystem: { type: String, enum: ['recruiter', 'idp'] },
    sourceId: String,
    sourceChecksum: String,
    migratedAt: Date,
    reconciliationStatus: { type: String, enum: ['pending', 'verified', 'mismatch', 'not_required'], default: 'not_required' }
  },
  // Payroll-only onboarding data is retained by People Transitions and is
  // exposed solely to Payroll over the signed internal service contract.
  payrollSnapshot: { type: mongoose.Schema.Types.Mixed, select: false }
}, { timestamps: true });

CandidateOnboardingSchema.index({ organization: 1, candidate: 1, createdAt: -1 });
CandidateOnboardingSchema.index({ organization: 1, status: 1, createdAt: -1 });
CandidateOnboardingSchema.index({ organization: 1, processType: 1, status: 1, createdAt: -1 });
CandidateOnboardingSchema.index({ organization: 1, 'subject.idpAccountId': 1, createdAt: -1 });
CandidateOnboardingSchema.index(
  { organization: 1, 'migration.sourceSystem': 1, 'migration.sourceId': 1 },
  { unique: true, partialFilterExpression: { 'migration.sourceId': { $type: 'string' } } }
);

CandidateOnboardingSchema.pre('validate', function(next) {
  if (!this.subject?.type) this.subject = { ...(this.subject || {}), type: this.candidate ? 'candidate' : 'idp_member' };
  if (this.candidate && !this.subject.candidateId) this.subject.candidateId = this.candidate;
  if (this.subject.type === 'candidate' && !this.candidate && !this.subject.candidateId) {
    return next(new Error('Candidate transitions require a candidate subject'));
  }
  if (this.subject.type === 'idp_member' && !this.subject.idpAccountId) {
    return next(new Error('IDP member transitions require an idpAccountId'));
  }
  next();
});

const PeopleTransition = mongoose.models.PeopleTransition || mongoose.model('PeopleTransition', CandidateOnboardingSchema, 'candidateonboardings');
if (!mongoose.models.CandidateOnboarding) mongoose.model('CandidateOnboarding', CandidateOnboardingSchema, 'candidateonboardings');
module.exports = PeopleTransition;
