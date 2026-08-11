const mongoose = require('mongoose');

const identitySchema = new mongoose.Schema({
  userId: { type: String, required: true, trim: true, maxlength: 240 },
  name: { type: String, required: true, trim: true, maxlength: 240 },
  email: { type: String, trim: true, maxlength: 320 },
  jobTitle: { type: String, trim: true, maxlength: 240 },
  department: { type: String, trim: true, maxlength: 240 },
  teamId: { type: String, trim: true, maxlength: 240 },
  teamName: { type: String, trim: true, maxlength: 240 }
}, { _id: false });

const auditSchema = new mongoose.Schema({
  action: { type: String, required: true, trim: true, maxlength: 120 },
  actorId: { type: String, required: true, trim: true, maxlength: 240 },
  actorRole: { type: String, trim: true, maxlength: 80 },
  at: { type: Date, default: Date.now },
  details: mongoose.Schema.Types.Mixed
}, { _id: true });

const talentReviewEntrySchema = new mongoose.Schema({
  organizationId: { type: String, required: true, index: true },
  cycleId: { type: mongoose.Schema.Types.ObjectId, ref: 'TalentReviewCycle', required: true, index: true },
  employee: { type: identitySchema, required: true },
  managerId: { type: String, trim: true, maxlength: 240, index: true },
  sourceAppraisalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appraisal', required: true },
  evidenceSnapshot: {
    finalRating: { type: Number, min: 1, max: 5, required: true },
    ratingLabel: { type: String, trim: true, maxlength: 160 },
    goalAchievement: { type: Number, min: 0, max: 100 },
    competencyScore: { type: Number, min: 0, max: 5 },
    finalizedAt: { type: Date, required: true }
  },
  performanceBand: { type: String, enum: ['developing', 'effective', 'strong'], required: true },
  potential: { type: String, enum: ['not_assessed', 'limited', 'moderate', 'high'], default: 'not_assessed' },
  readiness: { type: String, enum: ['not_assessed', 'ready_now', 'ready_1_2_years', 'ready_3_plus_years'], default: 'not_assessed' },
  nextRole: { type: String, trim: true, maxlength: 240 },
  criticalRole: { type: Boolean, default: false },
  rationale: { type: String, trim: true, maxlength: 4000 },
  strengths: [{ type: String, trim: true, maxlength: 500 }],
  developmentPriorities: [{ type: String, trim: true, maxlength: 500 }],
  decisionState: { type: String, enum: ['unassessed', 'manager_proposed', 'hr_calibrated'], default: 'unassessed', index: true },
  proposedBy: { type: String, trim: true, maxlength: 240 },
  proposedAt: Date,
  calibratedBy: { type: String, trim: true, maxlength: 240 },
  calibratedAt: Date,
  aiBriefs: [{
    activity: { type: String, default: 'performance.talent.evidence_brief' },
    status: { type: String, enum: ['suggested', 'accepted', 'rejected'], default: 'suggested' },
    output: mongoose.Schema.Types.Mixed,
    provider: String,
    requestedBy: String,
    reviewedBy: String,
    reviewedAt: Date,
    createdAt: { type: Date, default: Date.now }
  }],
  audit: [auditSchema]
}, { timestamps: true });

talentReviewEntrySchema.index({ organizationId: 1, cycleId: 1, 'employee.userId': 1 }, { unique: true });
talentReviewEntrySchema.index({ organizationId: 1, cycleId: 1, decisionState: 1 });
talentReviewEntrySchema.index({ organizationId: 1, managerId: 1, cycleId: 1 });

module.exports = mongoose.models.TalentReviewEntry
  || mongoose.model('TalentReviewEntry', talentReviewEntrySchema);
