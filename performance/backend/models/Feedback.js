const mongoose = require('mongoose');

const FeedbackSchema = new mongoose.Schema({
  organizationId: {
    type: String,
    required: true,
    index: true
  },
  senderId: { 
    type: String, 
    required: true 
  },
  receiverId: { 
    type: String, 
    required: true 
  },
  senderInfo: {
    name: String,
    email: String
  },
  receiverInfo: {
    name: String,
    email: String
  },
  content: { 
    type: String, 
    required: true 
  },
  type: { 
    type: String, 
    enum: ['praise', 'coaching', 'general'] 
  },
  visibility: { 
    type: String, 
    enum: ['public', 'private', 'manager-only'],
    default: 'private'
  },
  contextType: {
    type: String,
    enum: ['general', 'goal', 'project', 'peer', 'upward', '360'],
    default: 'general'
  },
  contextLabel: String,
  requestId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FeedbackRequest'
  },
  anonymity: {
    type: String,
    enum: ['named', 'confidential', 'anonymous'],
    default: 'named'
  },
  // Anonymous responses are withheld until the whole request cohort reaches
  // its configured privacy threshold. The cohort ID is intentionally opaque.
  cohortId: { type: String, trim: true, index: true },
  minimumCohortSize: { type: Number, min: 5, default: 5 },
  relatedOkrId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'OKR' 
  },
  projectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PerformanceProject'
  },
  
  // AI Analysis
  aiAnalysis: {
    sentimentScore: Number, // -100 to 100
    category: String, // "achievement", "improvement", "teamwork", etc.
    actionItems: [String], // Suggested follow-up actions
    urgency: String, // "low", "medium", "high"
  },
  aiModeration: {
    isAppropriate: Boolean,
    flaggedPhrases: [String],
    suggestedEdits: [String]
  },
  appraisalEvidence: {
    included: { type: Boolean, default: false },
    selectedBy: String,
    appraisalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appraisal' },
    selectedAt: Date
  },
  acknowledgedAt: Date,
  deletedAt: Date,
  
  createdAt: { 
    type: Date, 
    default: Date.now 
  }
});

// Indexes for performance
FeedbackSchema.index({ organizationId: 1, receiverId: 1, createdAt: -1 });
FeedbackSchema.index({ organizationId: 1, senderId: 1, createdAt: -1 });
FeedbackSchema.index({ relatedOkrId: 1 });
FeedbackSchema.index({ organizationId: 1, projectId: 1, receiverId: 1 });
FeedbackSchema.index({ organizationId: 1, cohortId: 1, anonymity: 1, deletedAt: 1 });

module.exports = mongoose.models.Feedback || mongoose.model('Feedback', FeedbackSchema);
