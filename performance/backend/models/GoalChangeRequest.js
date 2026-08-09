const mongoose = require('mongoose');

const actorSchema = new mongoose.Schema({
  userId: String,
  name: String,
  email: String,
  role: String
}, { _id: false });

const GoalChangeRequestSchema = new mongoose.Schema({
  organizationId: { type: String, required: true, index: true },
  goalId: { type: mongoose.Schema.Types.ObjectId, ref: 'OKR', required: true, index: true },
  ownerId: { type: String, required: true, index: true },
  requestedBy: { type: actorSchema, required: true },
  reason: { type: String, required: true, trim: true, maxlength: 2000 },
  proposedChanges: { type: mongoose.Schema.Types.Mixed, required: true },
  previousLifecycleState: String,
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'withdrawn'],
    default: 'pending',
    index: true
  },
  decidedBy: actorSchema,
  decisionComment: String,
  decidedAt: Date
}, { timestamps: true });

GoalChangeRequestSchema.index({ organizationId: 1, goalId: 1, status: 1, createdAt: -1 });
GoalChangeRequestSchema.index(
  { organizationId: 1, goalId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } }
);

module.exports = mongoose.models.GoalChangeRequest || mongoose.model('GoalChangeRequest', GoalChangeRequestSchema);
