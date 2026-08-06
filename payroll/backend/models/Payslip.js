const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const PAYSLIP_NUMBER_PREFIX = 'PS';

function buildPayslipPrefix(year, month) {
  return `${PAYSLIP_NUMBER_PREFIX}-${year}-${String(month).padStart(2, '0')}`;
}

function parsePayslipSequence(payslipNumber) {
  const parts = String(payslipNumber || '').split('-');
  const sequence = Number.parseInt(parts[3], 10);
  return Number.isFinite(sequence) ? sequence : 0;
}

/**
 * Comprehensive Payslip Model
 * 
 * A payslip represents the breakdown of an employee's compensation for a pay period.
 * It includes earnings (gross pay), deductions, and calculates net pay.
 * 
 * Key Concepts:
 * - HR Admins (owner, admin, hr_manager roles) can view all payslips and run payroll
 * - Line Managers can view their direct reports' payslips
 * - Employees can only view their own payslips
 */

// Individual earning item schema
const EarningItemSchema = new Schema({
  type: {
    type: String,
    enum: [
      'basic',           // Base salary
      'hra',             // House Rent Allowance
      'transport',       // Transportation allowance
      'meal',            // Meal/Food allowance
      'phone',           // Phone/Communication allowance
      'medical',         // Medical allowance
      'education',       // Education allowance
      'special',         // Special allowance
      'overtime',        // Overtime pay
      'bonus',           // Performance/annual bonus
      'commission',      // Sales commission
      'incentive',       // Incentive pay
      'arrears',         // Back pay/salary arrears
      'reimbursement',   // Expense reimbursement
      'gratuity',        // End of service gratuity
      'other'            // Other earnings
    ],
    required: true
  },
  name: { type: String, required: true }, // Display name
  amount: { type: Number, required: true, default: 0 },
  description: String,
  taxable: { type: Boolean, default: true },
  isRecurring: { type: Boolean, default: true }, // Part of regular salary structure
  linkedRequestId: String // Link to BonusRequest/CompensationRequest if applicable
}, { _id: false });

// Individual deduction item schema
const DeductionItemSchema = new Schema({
  type: {
    type: String,
    enum: [
      'income_tax',           // Income tax
      'social_security',      // Social security/National Insurance
      'pension',              // Pension/401k contribution
      'health_insurance',     // Health insurance premium
      'life_insurance',       // Life insurance premium
      'loan_repayment',       // Company loan repayment
      'advance_recovery',     // Salary advance recovery
      'unpaid_leave',         // Unpaid leave deduction
      'late_penalty',         // Late attendance penalty
      'union_dues',           // Union membership dues
      'garnishment',          // Court-ordered garnishment
      'voluntary_contribution', // Charity/voluntary deduction
      'parking',              // Parking fees
      'other'                 // Other deductions
    ],
    required: true
  },
  name: { type: String, required: true },
  amount: { type: Number, required: true, default: 0 },
  description: String,
  isPreTax: { type: Boolean, default: false }, // Whether deducted before tax calculation
  isRecurring: { type: Boolean, default: true },
  metadata: Schema.Types.Mixed // Additional data (e.g., days for unpaid leave)
}, { _id: false });

// Employer contribution schema (benefits paid by employer, not deducted from salary)
const EmployerContributionSchema = new Schema({
  type: {
    type: String,
    enum: [
      'pension_match',        // Employer pension matching
      'health_insurance',     // Employer health insurance contribution
      'life_insurance',       // Employer life insurance contribution
      'social_security',      // Employer social security contribution
      'training_allowance',   // Training/education benefit
      'other'
    ],
    required: true
  },
  name: { type: String, required: true },
  amount: { type: Number, required: true, default: 0 },
  description: String
}, { _id: false });

// Tax breakdown schema
const TaxBreakdownSchema = new Schema({
  grossTaxableIncome: { type: Number, default: 0 },
  taxExemptIncome: { type: Number, default: 0 },
  deductionsBeforeTax: { type: Number, default: 0 },
  netTaxableIncome: { type: Number, default: 0 },
  taxRate: { type: Number, default: 0 }, // Effective tax rate %
  taxAmount: { type: Number, default: 0 },
  yearToDateTax: { type: Number, default: 0 },
  taxBracket: String, // e.g., "20% bracket"
  jurisdictionCode: String,
  jurisdictionName: String,
  jurisdictionConfigId: Schema.Types.ObjectId,
  jurisdictionVersionId: Schema.Types.ObjectId,
  taxYearLabel: String,
  calculationMode: String,
  method: String,
  annualizedIncome: { type: Number, default: 0 },
  annualizedTaxableIncome: { type: Number, default: 0 },
  taxableIncomeAfterReliefs: { type: Number, default: 0 },
  notes: [String],
  details: Schema.Types.Mixed,
  calculationTrace: Schema.Types.Mixed,
}, { _id: false });

// Year-to-Date summary schema
const YTDSummarySchema = new Schema({
  grossEarnings: { type: Number, default: 0 },
  totalDeductions: { type: Number, default: 0 },
  totalTax: { type: Number, default: 0 },
  netPay: { type: Number, default: 0 },
  employerContributions: { type: Number, default: 0 },
  periods: { type: Number, default: 0 } // Number of pay periods YTD
}, { _id: false });

// Leave summary for the pay period
const LeaveSummarySchema = new Schema({
  paidLeaveTaken: { type: Number, default: 0 }, // Days
  unpaidLeaveTaken: { type: Number, default: 0 }, // Days
  sickLeaveTaken: { type: Number, default: 0 },
  workingDays: { type: Number, default: 0 },
  daysWorked: { type: Number, default: 0 },
  holidays: { type: Number, default: 0 }
}, { _id: false });

// Main Payslip Schema
const PayslipSchema = new Schema({
  // Identifiers
  payslipNumber: { 
    type: String, 
    required: true, 
    unique: true 
  }, // e.g., "PS-2024-12-001"
  payrollRunId: { 
    type: Schema.Types.ObjectId, 
    ref: 'PayrollRun',
    required: true 
  },
  
  // Employee Identification (from IdP)
  userId: { type: String, required: true, index: true },
  organizationId: { type: String, required: true, index: true },
  
  // Pay Period
  payPeriod: {
    type: { 
      type: String, 
      enum: ['monthly', 'bi-weekly', 'weekly', 'semi-monthly'],
      default: 'monthly'
    },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    paymentDate: { type: Date, required: true },
    month: Number, // 1-12
    year: Number   // e.g., 2024
  },
  
  // Snapshot of Employee Details at time of payslip generation
  // (Important: preserves historical data even if employee details change later)
  employeeSnapshot: {
    name: { type: String, required: true },
    email: String,
    employeeId: String, // Company employee ID if different from userId
    designation: String,
    department: String,
    teamName: String,
    teamId: String,
    managerName: String,
    managerId: String,
    employmentType: { 
      type: String, 
      enum: ['full_time', 'part_time', 'contract', 'intern'],
      default: 'full_time'
    },
    dateOfJoining: Date,
    costCenter: String,
    location: String,
    bankAccount: {
      bankName: String,
      accountNumber: String, // Masked for security
      routingNumber: String  // Masked for security
    }
  },
  
  // Salary Grade Reference (if using grade-based pay structure)
  salaryGrade: {
    gradeId: { type: Schema.Types.ObjectId, ref: 'SalaryGrade' },
    gradeName: String,
    gradeLevel: String
  },
  
  // ===== EARNINGS =====
  earnings: [EarningItemSchema],
  
  // Earnings Summary
  earningsSummary: {
    basicSalary: { type: Number, default: 0 },
    totalAllowances: { type: Number, default: 0 },
    totalBonuses: { type: Number, default: 0 },
    overtimePay: { type: Number, default: 0 },
    otherEarnings: { type: Number, default: 0 },
    grossPay: { type: Number, required: true, default: 0 }
  },
  
  // ===== DEDUCTIONS =====
  deductions: [DeductionItemSchema],
  
  // Deductions Summary
  deductionsSummary: {
    taxDeductions: { type: Number, default: 0 },
    statutoryDeductions: { type: Number, default: 0 }, // Social security, pension
    voluntaryDeductions: { type: Number, default: 0 },
    loanDeductions: { type: Number, default: 0 },
    otherDeductions: { type: Number, default: 0 },
    totalDeductions: { type: Number, required: true, default: 0 }
  },
  
  // ===== TAX DETAILS =====
  taxBreakdown: TaxBreakdownSchema,
  
  // ===== EMPLOYER CONTRIBUTIONS (Not deducted from employee) =====
  employerContributions: [EmployerContributionSchema],
  totalEmployerContributions: { type: Number, default: 0 },
  
  // ===== NET PAY =====
  netPay: { type: Number, required: true, default: 0 },
  
  // Currency
  currency: { 
    type: String, 
    default: 'USD',
    uppercase: true,
    trim: true,
    maxlength: 3
  },
  
  // ===== YEAR-TO-DATE SUMMARY =====
  ytdSummary: YTDSummarySchema,
  
  // ===== LEAVE SUMMARY =====
  leaveSummary: LeaveSummarySchema,
  
  // ===== STATUS & WORKFLOW =====
  status: {
    type: String,
    enum: [
      'draft',           // Being prepared
      'pending_approval',// Awaiting HR approval
      'approved',        // Approved by HR
      'exported',        // Finalized/exported to accountant
      'processing',      // Payment being processed
      'paid',            // Payment completed
      'disputed',        // Employee raised dispute
      'revised',         // Payslip was revised
      'cancelled'        // Cancelled
    ],
    default: 'draft'
  },
  
  // Approval tracking
  approvals: [{
    action: { type: String, enum: ['created', 'approved', 'rejected', 'revised', 'disputed'] },
    actionBy: String,  // userId
    actionByName: String,
    actionAt: { type: Date, default: Date.now },
    comments: String
  }],
  
  // Payment details
  paymentDetails: {
    method: { 
      type: String, 
      enum: ['bank_transfer', 'check', 'cash', 'direct_deposit'],
      default: 'bank_transfer'
    },
    transactionId: String,
    paymentDate: Date,
    bankReference: String
  },
  
  // Document handling
  document: {
    pdfUrl: String,        // URL to generated PDF
    pdfGeneratedAt: Date,
    hash: String           // For document integrity verification
  },
  
  // Notes & Comments
  notes: String,           // Internal notes (HR only)
  employeeNotes: String,   // Notes visible to employee
  
  // Audit trail
  createdBy: String,       // userId of creator
  lastModifiedBy: String,
  
  // Flags
  isReissued: { type: Boolean, default: false },
  originalPayslipId: { type: Schema.Types.ObjectId, ref: 'Payslip' }, // If reissued
  
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// ===== INDEXES =====
PayslipSchema.index({ userId: 1, 'payPeriod.year': -1, 'payPeriod.month': -1 });
PayslipSchema.index({ organizationId: 1, status: 1 });
PayslipSchema.index({ payrollRunId: 1 });
PayslipSchema.index({ 'payPeriod.paymentDate': -1 });

// ===== VIRTUALS =====

// Virtual for period display (e.g., "December 2024")
PayslipSchema.virtual('periodDisplay').get(function() {
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[this.payPeriod?.month - 1]} ${this.payPeriod?.year}`;
});

// ===== METHODS =====

// Calculate totals from line items
PayslipSchema.methods.calculateTotals = function() {
  // Calculate gross pay from earnings
  let grossPay = 0;
  let basicSalary = 0;
  let totalAllowances = 0;
  let totalBonuses = 0;
  let overtimePay = 0;
  let otherEarnings = 0;
  
  this.earnings.forEach(earning => {
    grossPay += earning.amount;
    switch (earning.type) {
      case 'basic':
        basicSalary += earning.amount;
        break;
      case 'hra':
      case 'transport':
      case 'meal':
      case 'phone':
      case 'medical':
      case 'education':
      case 'special':
        totalAllowances += earning.amount;
        break;
      case 'bonus':
      case 'commission':
      case 'incentive':
        totalBonuses += earning.amount;
        break;
      case 'overtime':
        overtimePay += earning.amount;
        break;
      default:
        otherEarnings += earning.amount;
    }
  });
  
  // Calculate total deductions
  let totalDeductions = 0;
  let taxDeductions = 0;
  let statutoryDeductions = 0;
  let voluntaryDeductions = 0;
  let loanDeductions = 0;
  let otherDeductions = 0;
  
  this.deductions.forEach(deduction => {
    totalDeductions += deduction.amount;
    switch (deduction.type) {
      case 'income_tax':
        taxDeductions += deduction.amount;
        break;
      case 'social_security':
      case 'pension':
        statutoryDeductions += deduction.amount;
        break;
      case 'health_insurance':
      case 'life_insurance':
      case 'voluntary_contribution':
        voluntaryDeductions += deduction.amount;
        break;
      case 'loan_repayment':
      case 'advance_recovery':
        loanDeductions += deduction.amount;
        break;
      default:
        otherDeductions += deduction.amount;
    }
  });
  
  // Calculate employer contributions
  let totalEmployerContributions = 0;
  this.employerContributions.forEach(contribution => {
    totalEmployerContributions += contribution.amount;
  });
  
  // Update summaries
  this.earningsSummary = {
    basicSalary,
    totalAllowances,
    totalBonuses,
    overtimePay,
    otherEarnings,
    grossPay
  };
  
  this.deductionsSummary = {
    taxDeductions,
    statutoryDeductions,
    voluntaryDeductions,
    loanDeductions,
    otherDeductions,
    totalDeductions
  };
  
  this.totalEmployerContributions = totalEmployerContributions;
  this.netPay = grossPay - totalDeductions;
  
  return this;
};

// Add an earning item
PayslipSchema.methods.addEarning = function(type, name, amount, options = {}) {
  this.earnings.push({
    type,
    name,
    amount,
    description: options.description,
    taxable: options.taxable !== false,
    isRecurring: options.isRecurring !== false,
    linkedRequestId: options.linkedRequestId
  });
  return this.calculateTotals();
};

// Add a deduction item
PayslipSchema.methods.addDeduction = function(type, name, amount, options = {}) {
  this.deductions.push({
    type,
    name,
    amount,
    description: options.description,
    isPreTax: options.isPreTax || false,
    isRecurring: options.isRecurring !== false,
    metadata: options.metadata
  });
  return this.calculateTotals();
};

// ===== STATICS =====

// Generate payslip number
PayslipSchema.statics.generatePayslipNumber = async function(organizationId, year, month) {
  const sequence = await this.getNextPayslipSequence(organizationId, year, month);
  return this.buildPayslipNumber(year, month, sequence);
};

PayslipSchema.statics.buildPayslipNumber = function(year, month, sequence) {
  return `${buildPayslipPrefix(year, month)}-${String(sequence).padStart(4, '0')}`;
};

PayslipSchema.statics.getNextPayslipSequence = async function(organizationId, year, month, options = {}) {
  const query = {
    organizationId,
    payslipNumber: new RegExp(`^${buildPayslipPrefix(year, month)}-`)
  };

  if (options.excludePayrollRunId) {
    query.payrollRunId = { $ne: options.excludePayrollRunId };
  }

  const lastPayslip = await this.findOne(query).sort({ payslipNumber: -1 }).lean();
  return lastPayslip ? parsePayslipSequence(lastPayslip.payslipNumber) + 1 : 1;
};

// Get payslips for a user
PayslipSchema.statics.getByUser = function(userId, organizationId, options = {}) {
  const query = { userId, organizationId };
  
  if (options.year) {
    query['payPeriod.year'] = options.year;
  }
  if (options.status) {
    query.status = options.status;
  }
  
  return this.find(query)
    .sort({ 'payPeriod.year': -1, 'payPeriod.month': -1 })
    .limit(options.limit || 12);
};

// Get payslips for a payroll run
PayslipSchema.statics.getByPayrollRun = function(payrollRunId) {
  return this.find({ payrollRunId })
    .sort({ 'employeeSnapshot.name': 1 });
};

module.exports = mongoose.model('Payslip', PayslipSchema);
