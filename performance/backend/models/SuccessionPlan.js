const mongoose = require('mongoose');

const auditSchema = new mongoose.Schema({
  action: { type: String, required: true, trim: true, maxlength: 120 },
  actorId: { type: String, required: true, trim: true, maxlength: 240 },
  at: { type: Date, default: Date.now },
  details: mongoose.Schema.Types.Mixed
}, { _id: true });

const successionPlanSchema = new mongoose.Schema({
  organizationId: { type: String, required: true, index: true },
  role: {
    title: { type: String, required: true, trim: true, maxlength: 240 },
    departmentId: { type: String, trim: true, maxlength: 240 },
    departmentName: { type: String, trim: true, maxlength: 240 },
    teamId: { type: String, trim: true, maxlength: 240 },
    teamName: { type: String, trim: true, maxlength: 240 },
    criticality: { type: String, enum: ['standard', 'important', 'critical'], default: 'standard' },
    incumbent: {
      userId: String,
      name: String
    }
  },
  state: { type: String, enum: ['draft', 'active', 'closed'], default: 'draft', index: true },
  candidates: [{
    employee: {
      userId: { type: String, required: true },
      name: { type: String, required: true },
      email: String,
      jobTitle: String,
      teamId: String,
      teamName: String
    },
    readiness: {
      type: String,
      enum: ['ready_now', 'ready_1_2_years', 'ready_3_plus_years'],
      required: true
    },
    rationale: { type: String, required: true, trim: true, maxlength: 4000 },
    strengths: [{ type: String, trim: true, maxlength: 500 }],
    developmentGaps: [{ type: String, trim: true, maxlength: 500 }],
    developmentPlanId: { type: mongoose.Schema.Types.ObjectId, ref: 'DevelopmentPlan' },
    state: { type: String, enum: ['proposed', 'confirmed', 'removed'], default: 'proposed' },
    nominatedBy: { type: String, required: true },
    nominatedAt: { type: Date, default: Date.now },
    confirmedBy: String,
    confirmedAt: Date
  }],
  reviewDate: Date,
  ownerId: { type: String, required: true },
  audit: [auditSchema]
}, { timestamps: true });

successionPlanSchema.index({ organizationId: 1, 'role.title': 1, 'role.departmentId': 1, 'role.teamId': 1 }, { unique: true });
successionPlanSchema.index({ organizationId: 1, state: 1, reviewDate: 1 });

module.exports = mongoose.models.SuccessionPlan
  || mongoose.model('SuccessionPlan', successionPlanSchema);
