const mongoose = require('mongoose');
const { applyGoalScore } = require('../services/goalScoringService');

const actorSchema = new mongoose.Schema({
  userId: String,
  name: String,
  email: String,
  role: String
}, { _id: false });

const keyResultSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  metricType: {
    type: String,
    enum: ['percentage', 'number', 'currency', 'boolean', 'milestone'],
    default: 'percentage'
  },
  unit: String,
  weight: { type: Number, min: 0, default: 1 },
  startValue: { type: Number, default: 0 },
  targetValue: { type: Number, required: true },
  // No default: an omitted measurement must remain unrated rather than being
  // interpreted as zero performance.
  currentValue: Number,
  direction: { type: String, enum: ['auto', 'increase', 'decrease'], default: 'auto' },
  dueDate: Date,
  health: {
    type: String,
    enum: ['not_set', 'on_track', 'at_risk', 'off_track', 'complete'],
    default: 'not_set'
  },
  lastUpdated: Date,
  aiSuggestions: String
});

const objectiveSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  weight: { type: Number, min: 0, default: 1 },
  keyResults: [keyResultSchema],
  aiGenerated: { type: Boolean, default: false },
  aiConfidence: { type: Number, min: 0, max: 100 }
});

const versionSchema = new mongoose.Schema({
  version: { type: Number, required: true },
  reason: { type: String, required: true },
  changedBy: actorSchema,
  changedAt: { type: Date, default: Date.now },
  changes: mongoose.Schema.Types.Mixed,
  snapshot: { type: mongoose.Schema.Types.Mixed, required: true }
}, { _id: false });

const OKRSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['individual', 'team', 'department', 'organization'],
    required: true,
    default: 'individual'
  },
  ownerId: { type: String, required: true, index: true },
  owner: {
    name: String,
    email: String
  },
  organizationId: { type: String, required: true, index: true },

  // `period` remains for backwards compatibility. `periodId` is the canonical
  // contract for fiscal/custom periods.
  period: { type: String, required: true },
  periodId: { type: mongoose.Schema.Types.ObjectId, ref: 'GoalPeriod', index: true },
  title: { type: String, trim: true },

  status: {
    type: String,
    enum: ['draft', 'pending', 'active', 'closed', 'cancelled', 'rejected'],
    default: 'draft',
    index: true
  },
  approvalStatus: {
    type: String,
    enum: ['draft', 'pending', 'approved', 'changes_requested', 'rejected', 'not_required'],
    default: 'draft'
  },
  approvedBy: String,
  approvedAt: Date,

  creationSource: {
    type: String,
    enum: ['employee', 'manager', 'hr', 'bulk', 'cascade', 'import', 'legacy'],
    default: 'employee'
  },
  createdBy: actorSchema,
  updatedBy: actorSchema,
  scoringEligibility: {
    mode: {
      type: String,
      enum: ['scored', 'evidence_only'],
      default: 'scored'
    },
    lateCreated: { type: Boolean, default: false },
    reason: String,
    decidedBy: actorSchema,
    decidedAt: Date
  },

  assignment: {
    assignedBy: actorSchema,
    assignedAt: Date,
    acknowledgementStatus: {
      type: String,
      enum: ['not_required', 'pending', 'acknowledged', 'change_requested'],
      default: 'not_required'
    },
    acknowledgedAt: Date,
    acknowledgementComment: String,
    idempotencyKey: String,
    bulkBatchKey: String
  },

  lifecycle: {
    state: {
      type: String,
      enum: [
        'draft',
        'pending_approval',
        'changes_requested',
        'pending_acknowledgement',
        'active',
        'rejected',
        'closed',
        'cancelled'
      ],
      default: 'draft',
      index: true
    },
    submittedAt: Date,
    submittedBy: actorSchema,
    decidedAt: Date,
    decidedBy: actorSchema,
    decision: { type: String, enum: ['approve', 'request_changes', 'reject'] },
    decisionComment: String,
    activatedAt: Date,
    closedAt: Date,
    cancelledAt: Date
  },

  objectives: [objectiveSchema],

  teamHierarchy: {
    teamId: String,
    teamName: String,
    departmentId: String,
    departmentName: String,
    teamPath: [String],
    managedTeams: [String]
  },

  alignment: {
    parentOKRId: { type: mongoose.Schema.Types.ObjectId, ref: 'OKR' },
    parentObjectiveIndex: Number,
    alignmentType: {
      type: String,
      enum: ['cascade', 'contribute', 'reference'],
      default: 'cascade'
    },
    alignmentNotes: String,
    contributionWeight: { type: Number, min: 0, max: 100 }
  },
  childOKRIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'OKR' }],

  // Null means genuinely unrated; zero means measured and no progress.
  progress: { type: Number, default: null, min: 0, max: 100 },
  scoring: {
    status: {
      type: String,
      enum: ['unrated', 'partially_rated', 'rated'],
      default: 'unrated'
    },
    progress: { type: Number, default: null, min: 0, max: 100 },
    ratedKeyResults: { type: Number, default: 0 },
    unratedKeyResults: { type: Number, default: 0 },
    totalKeyResults: { type: Number, default: 0 },
    calculatedAt: Date
  },
  health: {
    type: String,
    enum: ['not_set', 'on_track', 'at_risk', 'off_track', 'complete'],
    default: 'not_set'
  },
  lastCheckInAt: Date,
  lastCheckInBy: actorSchema,

  version: { type: Number, default: 0 },
  versionHistory: [versionSchema]
}, { timestamps: true });

OKRSchema.index({ organizationId: 1, ownerId: 1, status: 1, type: 1 });
OKRSchema.index({ organizationId: 1, periodId: 1, status: 1 });
OKRSchema.index({ organizationId: 1, period: 1, status: 1 });
OKRSchema.index({ organizationId: 1, 'teamHierarchy.teamId': 1 });
OKRSchema.index({ organizationId: 1, 'alignment.parentOKRId': 1 });
OKRSchema.index(
  { organizationId: 1, 'assignment.idempotencyKey': 1 },
  { unique: true, sparse: true }
);

OKRSchema.methods.captureVersion = function captureVersion(reason, actor = {}, changes = {}) {
  const nextVersion = Number(this.version || 0) + 1;
  const plainObjectives = (this.objectives || []).map((objective) =>
    typeof objective.toObject === 'function' ? objective.toObject() : objective
  );
  const plainAlignment = this.alignment && typeof this.alignment.toObject === 'function'
    ? this.alignment.toObject()
    : (this.alignment || null);

  this.version = nextVersion;
  this.versionHistory.push({
    version: nextVersion,
    reason,
    changedBy: actor,
    changes,
    snapshot: {
      title: this.title,
      type: this.type,
      ownerId: this.ownerId,
      period: this.period,
      periodId: this.periodId ? String(this.periodId._id || this.periodId) : null,
      status: this.status,
      approvalStatus: this.approvalStatus,
      lifecycleState: this.lifecycle?.state,
      objectives: plainObjectives,
      alignment: plainAlignment
    }
  });
  return nextVersion;
};

OKRSchema.pre('save', function calculateProgressBeforeSave(next) {
  try {
    applyGoalScore(this);
    next();
  } catch (error) {
    next(error);
  }
});

OKRSchema.virtual('alignmentDepth').get(function alignmentDepth() {
  return this.alignment?.parentOKRId ? 1 : 0;
});

OKRSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.models.OKR || mongoose.model('OKR', OKRSchema);
