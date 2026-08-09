const mongoose = require('mongoose');

const actorSchema = new mongoose.Schema({
  userId: String,
  name: String,
  email: String,
  role: String
}, { _id: false });

const GoalPeriodSchema = new mongoose.Schema({
  organizationId: { type: String, required: true, index: true },
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, trim: true },
  type: {
    type: String,
    enum: ['fiscal_year', 'fiscal_half', 'fiscal_quarter', 'custom'],
    default: 'custom'
  },
  fiscalYear: Number,
  fiscalYearStartMonth: { type: Number, min: 1, max: 12 },
  fiscalQuarter: { type: Number, min: 1, max: 4 },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  planningStartDate: Date,
  planningEndDate: Date,
  status: {
    type: String,
    enum: ['draft', 'upcoming', 'open', 'closed', 'archived'],
    default: 'draft',
    index: true
  },
  checkInCadence: {
    type: String,
    enum: ['none', 'weekly', 'biweekly', 'monthly', 'quarterly', 'custom'],
    default: 'monthly'
  },
  checkInIntervalDays: { type: Number, min: 1 },
  timezone: { type: String, default: 'UTC' },
  settings: {
    allowFutureGoalCreation: { type: Boolean, default: true },
    requiresManagerApproval: { type: Boolean, default: true },
    managerAssignedRequiresAcknowledgement: { type: Boolean, default: true },
    allowEmployeeChangeRequests: { type: Boolean, default: true },
    allowCheckInsBeforeStart: { type: Boolean, default: false },
    allowCheckInsAfterEnd: { type: Boolean, default: false }
  },
  createdBy: actorSchema,
  updatedBy: actorSchema
}, { timestamps: true });

GoalPeriodSchema.index({ organizationId: 1, code: 1 }, { unique: true });
GoalPeriodSchema.index({ organizationId: 1, startDate: 1, endDate: 1 });

GoalPeriodSchema.pre('validate', function validateDates(next) {
  if (this.startDate && this.endDate && this.startDate >= this.endDate) {
    return next(new Error('Goal period end date must be after its start date'));
  }
  if (this.planningStartDate && this.planningEndDate && this.planningStartDate > this.planningEndDate) {
    return next(new Error('Planning end date must be on or after its start date'));
  }
  return next();
});

module.exports = mongoose.models.GoalPeriod || mongoose.model('GoalPeriod', GoalPeriodSchema);
