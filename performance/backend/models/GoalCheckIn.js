const mongoose = require('mongoose');

const actorSchema = new mongoose.Schema({
  userId: String,
  name: String,
  email: String,
  role: String
}, { _id: false });

const GoalCheckInSchema = new mongoose.Schema({
  organizationId: { type: String, required: true, index: true },
  goalId: { type: mongoose.Schema.Types.ObjectId, ref: 'OKR', required: true, index: true },
  periodId: { type: mongoose.Schema.Types.ObjectId, ref: 'GoalPeriod' },
  ownerId: { type: String, required: true, index: true },
  sequence: { type: Number, required: true, min: 1 },
  idempotencyKey: { type: String, trim: true, maxlength: 128 },
  checkedInBy: { type: actorSchema, required: true },
  summary: { type: String, trim: true },
  health: {
    type: String,
    enum: ['not_set', 'on_track', 'at_risk', 'off_track', 'complete'],
    default: 'not_set'
  },
  confidence: { type: Number, min: 0, max: 100 },
  keyResultUpdates: [{
    objectiveId: String,
    objectiveIndex: Number,
    keyResultId: String,
    keyResultIndex: Number,
    previousValue: Number,
    currentValue: Number,
    health: {
      type: String,
      enum: ['not_set', 'on_track', 'at_risk', 'off_track', 'complete'],
      default: 'not_set'
    },
    note: String
  }],
  blockers: [{
    description: { type: String, required: true },
    ownerId: String,
    dueDate: Date,
    status: { type: String, enum: ['open', 'resolved'], default: 'open' }
  }],
  evidence: [{
    type: { type: String, enum: ['link', 'document', 'note', 'metric'], default: 'note' },
    label: String,
    url: String,
    note: String,
    documentId: String,
    visibility: {
      type: String,
      enum: ['employee_manager', 'all_reviewers', 'hr_only'],
      default: 'employee_manager'
    }
  }],
  scoreSnapshot: mongoose.Schema.Types.Mixed
}, {
  timestamps: { createdAt: true, updatedAt: false },
  strict: true
});

GoalCheckInSchema.index({ organizationId: 1, goalId: 1, sequence: 1 }, { unique: true });
GoalCheckInSchema.index(
  { organizationId: 1, goalId: 1, idempotencyKey: 1 },
  { unique: true, sparse: true }
);

// Check-ins are evidence records. Mutations and deletions must be represented by
// a later check-in, never by rewriting history.
GoalCheckInSchema.pre('save', function rejectExistingDocumentSave(next) {
  if (!this.isNew) return next(new Error('Goal check-ins are append-only'));
  return next();
});

[
  'updateOne',
  'updateMany',
  'replaceOne',
  'findOneAndUpdate',
  'findOneAndReplace',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete'
].forEach((operation) => {
  GoalCheckInSchema.pre(operation, function rejectMutation(next) {
    next(new Error('Goal check-ins are append-only'));
  });
});

GoalCheckInSchema.pre('deleteOne', { document: true, query: false }, function rejectDocumentDelete(next) {
  next(new Error('Goal check-ins are append-only'));
});

module.exports = mongoose.models.GoalCheckIn || mongoose.model('GoalCheckIn', GoalCheckInSchema);
