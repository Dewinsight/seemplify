const mongoose = require('mongoose');

const feedbackRequestSchema = new mongoose.Schema({
  organizationId: { type: String, required: true, index: true },
  requesterId: { type: String, required: true },
  subjectId: { type: String, required: true, index: true },
  reviewerId: { type: String, required: true, index: true },
  requesterInfo: { name: String, email: String },
  subjectInfo: { name: String, email: String },
  reviewerInfo: { name: String, email: String },
  contextType: {
    type: String,
    enum: ['general', 'goal', 'project', 'peer', 'upward', '360'],
    default: 'general'
  },
  contextLabel: String,
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'PerformanceProject' },
  questions: [{ type: String, trim: true }],
  dueDate: { type: Date, required: true },
  visibility: {
    type: String,
    enum: ['public', 'private', 'manager-only'],
    default: 'private'
  },
  anonymity: {
    type: String,
    enum: ['named', 'confidential', 'anonymous'],
    default: 'named'
  },
  cohortId: String,
  minimumCohortSize: { type: Number, default: 5, min: 5 },
  state: {
    type: String,
    enum: ['requested', 'accepted', 'declined', 'fulfilled', 'cancelled', 'overdue'],
    default: 'requested',
    index: true
  },
  decisionComment: String,
  decidedAt: Date,
  fulfilledByFeedbackId: { type: mongoose.Schema.Types.ObjectId, ref: 'Feedback' },
  fulfilledAt: Date,
  createdBy: String
}, { timestamps: true });

feedbackRequestSchema.index({ organizationId: 1, reviewerId: 1, state: 1, dueDate: 1 });
feedbackRequestSchema.index({ organizationId: 1, subjectId: 1, contextType: 1 });
feedbackRequestSchema.index({ organizationId: 1, projectId: 1, state: 1 });

module.exports = mongoose.models.FeedbackRequest || mongoose.model('FeedbackRequest', feedbackRequestSchema);
