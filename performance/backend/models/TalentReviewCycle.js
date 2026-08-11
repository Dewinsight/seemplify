const mongoose = require('mongoose');

const auditSchema = new mongoose.Schema({
  action: { type: String, required: true, trim: true, maxlength: 120 },
  actorId: { type: String, required: true, trim: true, maxlength: 240 },
  actorRole: { type: String, trim: true, maxlength: 80 },
  at: { type: Date, default: Date.now },
  details: mongoose.Schema.Types.Mixed
}, { _id: true });

const talentReviewCycleSchema = new mongoose.Schema({
  organizationId: { type: String, required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 240 },
  description: { type: String, trim: true, maxlength: 2000 },
  sourceAppraisalCycleId: { type: mongoose.Schema.Types.ObjectId, ref: 'AppraisalCycle', required: true },
  sourceCycle: {
    name: { type: String, required: true },
    periodStart: Date,
    periodEnd: Date
  },
  state: {
    type: String,
    enum: ['draft', 'open', 'calibration', 'closed', 'cancelled'],
    default: 'draft',
    index: true
  },
  stats: {
    participants: { type: Number, default: 0 },
    managerProposed: { type: Number, default: 0 },
    hrCalibrated: { type: Number, default: 0 }
  },
  openedAt: Date,
  calibrationStartedAt: Date,
  closedAt: Date,
  createdBy: { type: String, required: true },
  audit: [auditSchema]
}, { timestamps: true });

talentReviewCycleSchema.index({ organizationId: 1, sourceAppraisalCycleId: 1 }, { unique: true });
talentReviewCycleSchema.index({ organizationId: 1, state: 1, updatedAt: -1 });

module.exports = mongoose.models.TalentReviewCycle
  || mongoose.model('TalentReviewCycle', talentReviewCycleSchema);
