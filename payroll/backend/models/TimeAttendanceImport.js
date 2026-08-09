const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const PayCodeLineSchema = new Schema({
  payCode: { type: String, required: true },
  category: { type: String, enum: ['regular', 'overtime', 'unpaid_break', 'allowance', 'differential', 'holiday', 'cost_allocation', 'adjustment'], required: true },
  unit: { type: String, enum: ['hours', 'days', 'amount'], default: 'hours' },
  quantity: { type: Number, required: true },
  rateMultiplier: Number,
  activityCode: String,
  costCentreCode: String,
  date: Date,
  metadata: Schema.Types.Mixed,
}, { _id: false });

const TimeAttendanceImportSchema = new Schema({
  organizationId: { type: String, required: true, index: true },
  employeeId: String,
  userId: { type: String, required: true, index: true },
  userEmail: String,
  sourceTimesheetId: { type: String, required: true, index: true },
  sourceVersion: { type: Number, required: true, min: 1 },
  eventType: { type: String, enum: ['approved_timesheet', 'adjustment'], default: 'approved_timesheet' },
  supersedesImportId: { type: Schema.Types.ObjectId, ref: 'TimeAttendanceImport' },
  period: { startAt: { type: Date, required: true }, endAt: { type: Date, required: true }, type: String },
  rulePack: { id: String, version: Number },
  payCodeLines: { type: [PayCodeLineSchema], default: [] },
  totals: {
    regularHours: Number,
    overtimeHours: Number,
    unpaidBreakHours: Number,
    holidayHours: Number,
    totalHours: Number,
  },
  idempotencyKey: { type: String, required: true, unique: true, index: true },
  correlationId: String,
  schemaVersion: { type: String, default: '1.0' },
  status: { type: String, enum: ['accepted', 'applied', 'superseded', 'rejected'], default: 'accepted', index: true },
  acceptedAt: { type: Date, default: Date.now },
  appliedPayrollRunId: { type: Schema.Types.ObjectId, ref: 'PayrollRun' },
  sourcePayloadHash: { type: String, required: true },
}, { timestamps: true });

TimeAttendanceImportSchema.index({ organizationId: 1, sourceTimesheetId: 1, sourceVersion: 1 }, { unique: true });
TimeAttendanceImportSchema.index({ organizationId: 1, userId: 1, 'period.startAt': 1, 'period.endAt': 1 });

module.exports = mongoose.model('TimeAttendanceImport', TimeAttendanceImportSchema);
