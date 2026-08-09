const mongoose = require('mongoose');

const performanceCheckInSchema = new mongoose.Schema({
  organizationId: { type: String, required: true, index: true },
  employeeId: { type: String, required: true, index: true },
  authorId: { type: String, required: true },
  cadence: {
    type: String,
    enum: ['weekly', 'fortnightly', 'ad_hoc'],
    default: 'weekly'
  },
  periodStart: { type: Date, required: true },
  periodEnd: { type: Date, required: true },
  wins: [{ type: String, trim: true }],
  priorities: [{ type: String, trim: true }],
  blockers: [{ type: String, trim: true }],
  supportNeeded: [{ type: String, trim: true }],
  pulse: { type: Number, min: 1, max: 5 },
  linkedGoalIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'OKR' }],
  visibility: {
    type: String,
    enum: ['employee_manager', 'employee_only'],
    default: 'employee_manager'
  },
  status: {
    type: String,
    enum: ['draft', 'submitted'],
    default: 'draft'
  },
  submittedAt: Date,
  nextDueAt: Date,
  managerResponse: {
    text: String,
    authorId: String,
    respondedAt: Date
  },
  audit: [{
    action: String,
    actorId: String,
    at: { type: Date, default: Date.now }
  }]
}, { timestamps: true });

performanceCheckInSchema.index({ organizationId: 1, employeeId: 1, periodStart: -1 });
performanceCheckInSchema.index(
  { organizationId: 1, employeeId: 1, periodStart: 1, cadence: 1 },
  { unique: true, partialFilterExpression: { cadence: { $in: ['weekly', 'fortnightly'] } } }
);

module.exports = mongoose.models.PerformanceCheckIn || mongoose.model('PerformanceCheckIn', performanceCheckInSchema);
