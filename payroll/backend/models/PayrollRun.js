const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const PayrollSequence = require('./PayrollSequence');

/**
 * PayrollRun Model
 * 
 * Represents a payroll processing run for an organization.
 * A PayrollRun generates Payslips for all eligible employees.
 * 
 * Access Control:
 * - Only HR Admins (owner, admin, hr_manager) can create/process payroll runs
 * - Finance team (if defined) can view and approve
 */

// Processing summary for a payroll run
const CurrencyBreakdownSchema = new Schema({
  currency: { type: String, required: true },
  employeeCount: { type: Number, default: 0 },
  totalGrossPayroll: { type: Number, default: 0 },
  totalDeductions: { type: Number, default: 0 },
  totalNetPayroll: { type: Number, default: 0 },
  totalTaxWithheld: { type: Number, default: 0 },
  totalEmployerContributions: { type: Number, default: 0 },
  totalEmployerCost: { type: Number, default: 0 }
}, { _id: false });

const ProcessingSummarySchema = new Schema({
  totalEmployees: { type: Number, default: 0 },
  processedCount: { type: Number, default: 0 },
  skippedCount: { type: Number, default: 0 },
  errorCount: { type: Number, default: 0 },
  totalGrossPayroll: { type: Number, default: 0 },
  totalDeductions: { type: Number, default: 0 },
  totalNetPayroll: { type: Number, default: 0 },
  totalTaxWithheld: { type: Number, default: 0 },
  totalEmployerContributions: { type: Number, default: 0 },
  totalEmployerCost: { type: Number, default: 0 },
  currency: { type: String, default: 'USD' },
  reportingCurrency: String,
  hasAggregateTotals: { type: Boolean, default: true },
  isMultiCurrency: { type: Boolean, default: false },
  currencies: [String],
  currencyBreakdown: [CurrencyBreakdownSchema],
  unconvertedCurrencies: [String],
  conversionWarnings: [String]
}, { _id: false });

// Employee breakdown (summary per employee)
const EmployeeBreakdownSchema = new Schema({
  userId: { type: String, required: true },
  employeeName: String,
  currency: { type: String, default: 'USD' },
  grossPay: { type: Number, default: 0 },
  deductions: { type: Number, default: 0 },
  netPay: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ['pending', 'processed', 'error', 'skipped', 'paid'],
    default: 'pending'
  },
  payslipId: { type: Schema.Types.ObjectId, ref: 'Payslip' },
  errorMessage: String
}, { _id: false });

// Approval workflow entry
const ApprovalEntrySchema = new Schema({
  action: {
    type: String,
    enum: ['submitted', 'approved', 'rejected', 'revised', 'finalized', 'retracted'],
    required: true
  },
  actionBy: { type: String, required: true },
  actionByName: String,
  actionByRole: String,
  actionAt: { type: Date, default: Date.now },
  comments: String,
  level: { type: Number, default: 1 } // For multi-level approvals
}, { _id: false });

// Processing settings
const ProcessingSettingsSchema = new Schema({
  // What to include
  includeAllowances: { type: Boolean, default: true },
  includeBonuses: { type: Boolean, default: true },
  includeOvertime: { type: Boolean, default: true },
  includeCommissions: { type: Boolean, default: true },
  
  // What to deduct
  processStatutoryDeductions: { type: Boolean, default: true },
  processLoans: { type: Boolean, default: true },
  processUnpaidLeave: { type: Boolean, default: true },
  
  // Tax settings
  calculateTax: { type: Boolean, default: true },
  taxCalculationMethod: {
    type: String,
    enum: ['cumulative', 'standalone'],
    default: 'cumulative'
  },
  
  // Other settings
  prorate: { type: Boolean, default: true }, // Prorate for partial months
  roundingMethod: {
    type: String,
    enum: ['round', 'floor', 'ceil', 'none'],
    default: 'round'
  },
  roundingPrecision: { type: Number, default: 2 },
  reportingCurrency: {
    type: String,
    uppercase: true,
    trim: true,
    maxlength: 3
  },
  
  // Filters
  departments: [String], // If empty, include all
  teams: [String],
  employmentTypes: [String]
}, { _id: false });

const WorkInputSchema = new Schema({
  userId: { type: String, required: true },
  employeeName: String,
  regularHours: { type: Number, min: 0, default: 0 },
  daysWorked: { type: Number, min: 0, default: 0 },
  notes: String,
  enteredBy: String,
  enteredAt: { type: Date, default: Date.now }
}, { _id: false });

// Main PayrollRun Schema
const PayrollRunSchema = new Schema({
  // Identification
  runNumber: {
    type: String,
    required: true
  }, // e.g., "PR-2024-12-001"
  
  organizationId: { type: String, required: true, index: true },
  cycleId: { type: Schema.Types.ObjectId, ref: 'PayrollCycle', default: null, index: true },
  employerEntityId: { type: Schema.Types.ObjectId, ref: 'PayrollEmployerEntity', default: null, index: true },
  employerEntitySnapshot: {
    code: String,
    legalName: String,
    employerType: String,
    countryCode: String,
    jurisdictionCode: String,
    currency: String,
    taxJurisdictionConfigId: Schema.Types.ObjectId,
    taxJurisdictionVersionId: Schema.Types.ObjectId,
    taxAdapterCandidateId: String,
    taxPackContentHash: String,
    payrollRunnableAtCreation: { type: Boolean, default: false },
    blockingIssuesAtCreation: [String],
  },
  activePeriodKey: { type: String, default: undefined },
  
  // Pay Period
  payPeriod: {
    type: {
      type: String,
      enum: ['monthly', 'bi-weekly', 'weekly', 'semi-monthly'],
      default: 'monthly'
    },
    month: { type: Number, required: true, min: 1, max: 12 },
    year: { type: Number, required: true, min: 2000, max: 2200 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    paymentDate: { type: Date, required: true }
  },
  
  // Status
  status: {
    type: String,
    enum: [
      'draft',            // Initial creation
      'calculating',      // Processing in progress
      'calculated',       // All calculations done
      'pending_review',   // Awaiting HR review
      'pending_approval', // Awaiting approval
      'approved',         // Approved, ready for payment
      'finalizing',       // Transactional finalization claim
      'retracting',       // Transactional retraction claim
      'processing_payment', // Payment in progress
      'paid',             // Fully paid
      'exported',         // Exported/finalized for accountant
      'partially_paid',   // Some payments completed
      'cancelled'         // Cancelled
    ],
    default: 'draft'
  },
  
  // Processing Summary
  summary: ProcessingSummarySchema,
  
  // Employee Breakdown
  employees: [EmployeeBreakdownSchema],
  
  // Processing Settings
  settings: ProcessingSettingsSchema,

  // Period-specific work records used by hourly and daily-paid staff.
  workInputs: [WorkInputSchema],
  
  // Approval Workflow
  approvals: [ApprovalEntrySchema],
  
  // Required approval levels (configurable per org)
  requiredApprovalLevels: { type: Number, default: 1 },
  currentApprovalLevel: { type: Number, default: 0 },
  calculationRevision: { type: Number, min: 1, default: 1 },
  calculationTotalsHash: String,
  submittedRevision: Number,
  submittedTotalsHash: String,
  
  // Dates
  calculatedAt: Date,
  approvedAt: Date,
  finalizationStartedAt: Date,
  retractionStartedAt: Date,
  paidAt: Date,
  exportedAt: Date,
  retractedAt: Date,

  // Audit
  createdBy: { type: String, required: true },
  createdByName: String,
  processedBy: String,
  processedByName: String,
  finalizationStartedBy: String,
  finalizationStartedByName: String,
  retractionStartedBy: String,
  retractionStartedByName: String,
  exportedBy: String,
  exportedByName: String,
  retractedBy: String,
  retractedByName: String,
  
  // Notes
  notes: String,
  internalNotes: String, // HR only
  retractionReason: String,
  retractionSummary: {
    originalStatus: String,
    deletedPayslips: { type: Number, min: 0 },
    resetCompensationRequests: { type: Number, min: 0 },
    resetTimeAttendanceImports: { type: Number, min: 0 }
  },
  
  // Error tracking
  errors: [{
    userId: String,
    employeeName: String,
    errorType: String,
    errorMessage: String,
    occurredAt: { type: Date, default: Date.now }
  }],
  
  // Document references
  documents: [{
    type: { type: String }, // e.g., 'summary_report', 'bank_file', 'tax_report'
    name: String,
    url: String,
    generatedAt: Date
  }],
  
  // Payment batch reference
  paymentBatch: {
    batchId: String,
    bankReference: String,
    processedAt: Date,
    status: String
  }
  
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// ===== INDEXES =====
PayrollRunSchema.index({ organizationId: 1, 'payPeriod.year': -1, 'payPeriod.month': -1 });
PayrollRunSchema.index({ organizationId: 1, status: 1 });
PayrollRunSchema.index({ organizationId: 1, runNumber: 1 }, { unique: true });
PayrollRunSchema.index(
  { organizationId: 1, employerEntityId: 1, activePeriodKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      employerEntityId: { $type: 'objectId' },
      activePeriodKey: { $type: 'string' },
    },
  }
);

PayrollRunSchema.pre('validate', function setActivePeriodKey(next) {
  if (this.status === 'cancelled') {
    this.activePeriodKey = undefined;
    return next();
  }
  if ((this.payPeriod?.type || 'monthly') === 'monthly') {
    this.activePeriodKey = `monthly:${this.payPeriod?.year}:${String(this.payPeriod?.month).padStart(2, '0')}`;
    return next();
  }
  const start = this.payPeriod?.startDate ? new Date(this.payPeriod.startDate) : null;
  const end = this.payPeriod?.endDate ? new Date(this.payPeriod.endDate) : null;
  if (start && end && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
    this.activePeriodKey = `${this.payPeriod?.type || 'monthly'}:${start.toISOString()}:${end.toISOString()}`;
  }
  return next();
});

// ===== VIRTUALS =====

// Check if run is editable
PayrollRunSchema.virtual('isEditable').get(function() {
  return ['draft', 'calculated', 'pending_review'].includes(this.status);
});

// Check if run is approvable
PayrollRunSchema.virtual('isApprovable').get(function() {
  return this.status === 'pending_approval';
});

// Check if run is payable
PayrollRunSchema.virtual('isPayable').get(function() {
  return this.status === 'approved';
});

// Period display
PayrollRunSchema.virtual('periodDisplay').get(function() {
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[this.payPeriod.month - 1]} ${this.payPeriod.year}`;
});

// Progress percentage
PayrollRunSchema.virtual('progressPercent').get(function() {
  if (!this.summary || !this.summary.totalEmployees) return 0;
  return Math.round((this.summary.processedCount / this.summary.totalEmployees) * 100);
});

// ===== METHODS =====

// Initialize summary
PayrollRunSchema.methods.initializeSummary = function(totalEmployees, currency = 'USD', options = {}) {
  this.summary = {
    totalEmployees,
    processedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    totalGrossPayroll: 0,
    totalDeductions: 0,
    totalNetPayroll: 0,
    totalTaxWithheld: 0,
    totalEmployerContributions: 0,
    totalEmployerCost: 0,
    currency,
    reportingCurrency: options.reportingCurrency || null,
    hasAggregateTotals: true,
    isMultiCurrency: false,
    currencies: currency ? [currency] : [],
    currencyBreakdown: [],
    unconvertedCurrencies: [],
    conversionWarnings: []
  };
  return this;
};

// Update employee status
PayrollRunSchema.methods.updateEmployeeStatus = function(userId, status, payslipId = null, errorMessage = null) {
  const employee = this.employees.find(e => e.userId === userId);
  if (employee) {
    employee.status = status;
    if (payslipId) employee.payslipId = payslipId;
    if (errorMessage) employee.errorMessage = errorMessage;
    
    // Update summary counts
    if (status === 'processed') {
      this.summary.processedCount++;
    } else if (status === 'error') {
      this.summary.errorCount++;
    } else if (status === 'skipped') {
      this.summary.skippedCount++;
    }
  }
  return this;
};

// Add employee to run
PayrollRunSchema.methods.addEmployee = function(userId, employeeName, grossPay = 0, deductions = 0, netPay = 0) {
  this.employees.push({
    userId,
    employeeName,
    grossPay,
    deductions,
    netPay,
    status: 'pending'
  });
  return this;
};

// Update totals from payslips
PayrollRunSchema.methods.updateTotalsFromPayslips = function(payslips) {
  let totalGross = 0;
  let totalDeductions = 0;
  let totalNet = 0;
  let totalTax = 0;
  let totalEmployerContributions = 0;
  
  payslips.forEach(payslip => {
    totalGross += payslip.earningsSummary?.grossPay || 0;
    totalDeductions += payslip.deductionsSummary?.totalDeductions || 0;
    totalNet += payslip.netPay || 0;
    totalTax += payslip.taxBreakdown?.taxAmount || 0;
    totalEmployerContributions += payslip.totalEmployerContributions || 0;
  });
  
  this.summary.totalGrossPayroll = totalGross;
  this.summary.totalDeductions = totalDeductions;
  this.summary.totalNetPayroll = totalNet;
  this.summary.totalTaxWithheld = totalTax;
  this.summary.totalEmployerContributions = totalEmployerContributions;
  this.summary.totalEmployerCost = totalGross + totalEmployerContributions;
  
  // Also update employee breakdown
  payslips.forEach(payslip => {
    const emp = this.employees.find(e => e.userId === payslip.userId);
    if (emp) {
      emp.currency = payslip.currency || emp.currency || this.summary?.currency || 'USD';
      emp.grossPay = payslip.earningsSummary?.grossPay || 0;
      emp.deductions = payslip.deductionsSummary?.totalDeductions || 0;
      emp.netPay = payslip.netPay || 0;
      emp.payslipId = payslip._id;
    }
  });
  
  return this;
};

// Add approval entry
PayrollRunSchema.methods.addApproval = function(action, actionBy, actionByName, actionByRole, comments) {
  this.approvals.push({
    action,
    actionBy,
    actionByName,
    actionByRole,
    comments,
    level: this.currentApprovalLevel + 1
  });
  
  if (action === 'approved') {
    this.currentApprovalLevel++;
    if (this.currentApprovalLevel >= this.requiredApprovalLevels) {
      this.status = 'approved';
      this.approvedAt = new Date();
    }
  } else if (action === 'rejected') {
    this.status = 'pending_review';
    this.currentApprovalLevel = 0;
  }
  
  return this;
};

// Log error
PayrollRunSchema.methods.logError = function(userId, employeeName, errorType, errorMessage) {
  this.errors.push({
    userId,
    employeeName,
    errorType,
    errorMessage
  });
  return this;
};

// ===== STATICS =====

// Generate run number
PayrollRunSchema.statics.generateRunNumber = async function(organizationId, year, month) {
  const prefix = 'PR';
  const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
  const sequence = await PayrollSequence.reserve(`payroll-run:${organizationId}:${yearMonth}`, 1);
  return `${prefix}-${yearMonth}-${String(sequence).padStart(3, '0')}`;
};

// Get latest run for organization
PayrollRunSchema.statics.getLatestByOrganization = function(organizationId) {
  return this.findOne({ organizationId })
    .sort({ 'payPeriod.year': -1, 'payPeriod.month': -1, createdAt: -1 });
};

// Check if run exists for period
PayrollRunSchema.statics.existsForPeriod = async function(organizationId, year, month, options = {}) {
  const query = {
    organizationId,
    'payPeriod.year': year,
    'payPeriod.month': month,
    status: { $nin: ['cancelled'] }
  };
  if (options.employerEntityId) query.employerEntityId = options.employerEntityId;
  if (options.type) query['payPeriod.type'] = options.type;
  if (options.startDate) query['payPeriod.startDate'] = new Date(options.startDate);
  if (options.endDate) query['payPeriod.endDate'] = new Date(options.endDate);
  const count = await this.countDocuments(query);
  return count > 0;
};

// Get runs for organization
PayrollRunSchema.statics.getByOrganization = function(organizationId, options = {}) {
  const query = { organizationId };
  
  if (options.year) {
    query['payPeriod.year'] = options.year;
  }
  if (options.status) {
    query.status = Array.isArray(options.status) ? { $in: options.status } : options.status;
  }
  if (options.employerEntityId) query.employerEntityId = options.employerEntityId;
  
  return this.find(query)
    .sort({ 'payPeriod.year': -1, 'payPeriod.month': -1, createdAt: -1 })
    .limit(options.limit || 12);
};

module.exports = mongoose.model('PayrollRun', PayrollRunSchema);
