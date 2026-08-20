const mongoose = require('mongoose');

const ChildRunSchema = new mongoose.Schema({
  employerEntityId: { type: mongoose.Schema.Types.ObjectId, ref: 'PayrollEmployerEntity', required: true },
  payrollRunId: { type: mongoose.Schema.Types.ObjectId, ref: 'PayrollRun', default: null },
  legalName: String,
  countryCode: String,
  currency: String,
  status: { type: String, enum: ['pending', 'calculating', 'calculated', 'failed', 'submitted', 'approved', 'released'], default: 'pending' },
  errorCode: String,
  errorMessage: String,
}, { _id: false });

const CycleApprovalSchema = new mongoose.Schema({
  action: { type: String, enum: ['submitted', 'approved', 'rejected', 'released', 'revised'], required: true },
  actorId: { type: String, required: true },
  actorName: String,
  actorRole: String,
  level: { type: Number, min: 0, default: 0 },
  revision: { type: Number, min: 1 },
  totalsHash: String,
  comments: String,
  at: { type: Date, default: Date.now },
}, { _id: false });

const PayrollCycleSchema = new mongoose.Schema({
  organizationId: { type: String, required: true, index: true },
  cycleNumber: { type: String, required: true },
  idempotencyKey: { type: String, required: true },
  payPeriod: {
    type: { type: String, enum: ['monthly'], default: 'monthly' },
    month: { type: Number, required: true, min: 1, max: 12 },
    year: { type: Number, required: true, min: 2000, max: 2200 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    paymentDate: { type: Date, required: true },
  },
  reportingCurrency: { type: String, uppercase: true, trim: true, maxlength: 3 },
  nativeSummaries: [{
    employerEntityId: mongoose.Schema.Types.ObjectId,
    legalName: String,
    currency: String,
    employeeCount: Number,
    totalGrossPayroll: Number,
    totalDeductions: Number,
    totalNetPayroll: Number,
    totalEmployerCost: Number,
    _id: false,
  }],
  reportingSummary: {
    currency: String,
    available: { type: Boolean, default: false },
    totalGrossPayroll: Number,
    totalDeductions: Number,
    totalNetPayroll: Number,
    totalEmployerCost: Number,
    missingRates: [String],
  },
  status: { type: String, enum: ['calculating', 'needs_attention', 'calculated', 'pending_approval', 'rejected', 'releasing', 'released', 'release_failed', 'partially_failed', 'cancelled'], default: 'calculating' },
  childRuns: [ChildRunSchema],
  revision: { type: Number, min: 1, default: 1 },
  totalsHash: String,
  submittedRevision: Number,
  submittedTotalsHash: String,
  approvalPolicyId: { type: mongoose.Schema.Types.ObjectId, ref: 'PayrollApprovalPolicy', default: null },
  approvalPolicySnapshot: {
    approvalRequired: { type: Boolean, default: true },
    requireSeparationOfDuties: { type: Boolean, default: true },
    allowedApproverUserIds: [String],
    automaticRelease: { type: Boolean, default: true },
    deliverAccountingOnRelease: { type: Boolean, default: true },
    levels: [{ name: String, roles: [String], minimumApprovals: Number, _id: false }],
  },
  currentApprovalLevel: { type: Number, default: 0 },
  approvals: [CycleApprovalSchema],
  createdBy: { type: String, required: true },
  createdByName: String,
  submittedBy: String,
  submittedAt: Date,
  releasedAt: Date,
}, { timestamps: true });

PayrollCycleSchema.index({ organizationId: 1, cycleNumber: 1 }, { unique: true });
PayrollCycleSchema.index({ organizationId: 1, idempotencyKey: 1 }, { unique: true });
PayrollCycleSchema.index({ organizationId: 1, 'payPeriod.year': -1, 'payPeriod.month': -1, createdAt: -1 });

module.exports = mongoose.model('PayrollCycle', PayrollCycleSchema);
