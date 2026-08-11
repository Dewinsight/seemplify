const mongoose = require('mongoose');

const recognitionSchema = new mongoose.Schema({
  organizationId: { type: String, required: true, index: true },
  sender: {
    userId: { type: String, required: true },
    name: String,
    email: String
  },
  recipient: {
    userId: { type: String, required: true },
    name: String,
    email: String,
    teamId: String,
    teamName: String
  },
  companyValue: { type: String, trim: true, maxlength: 160 },
  message: { type: String, required: true, trim: true, maxlength: 3000 },
  visibility: { type: String, enum: ['public', 'team', 'private'], default: 'team' },
  contextType: { type: String, enum: ['general', 'goal', 'project'], default: 'general' },
  contextLabel: { type: String, trim: true, maxlength: 240 },
  relatedGoalId: { type: mongoose.Schema.Types.ObjectId, ref: 'OKR' },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'PerformanceProject' },
  status: { type: String, enum: ['active', 'withdrawn'], default: 'active', index: true },
  acknowledgedAt: Date,
  moderation: {
    status: { type: String, enum: ['not_checked', 'passed', 'flagged'], default: 'not_checked' },
    reason: String,
    checkedAt: Date
  },
  audit: [{
    action: String,
    actorId: String,
    at: { type: Date, default: Date.now },
    details: mongoose.Schema.Types.Mixed
  }]
}, { timestamps: true });

recognitionSchema.index({ organizationId: 1, 'recipient.userId': 1, createdAt: -1 });
recognitionSchema.index({ organizationId: 1, 'sender.userId': 1, createdAt: -1 });
recognitionSchema.index({ organizationId: 1, visibility: 1, status: 1, createdAt: -1 });

module.exports = mongoose.models.Recognition || mongoose.model('Recognition', recognitionSchema);
