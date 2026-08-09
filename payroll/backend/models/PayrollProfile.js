const mongoose = require('mongoose');
const Schema = mongoose.Schema;

/**
 * PayrollProfile Model
 * 
 * Stores employee-specific payroll configuration.
 * This is linked to the IdP user account but contains payroll-specific data
 * like salary, bank details, tax info, and recurring allowances/deductions.
 * 
 * Access Control:
 * - HR Admins (owner, admin, hr_manager) can create/edit profiles
 * - Employees can view their own profile (limited fields)
 * - Line Managers can view team members' basic salary info
 */

// Recurring allowance schema
const AllowanceSchema = new Schema({
  type: {
    type: String,
    enum: [
      'hra',           // House Rent Allowance
      'transport',     // Transportation allowance
      'meal',          // Meal/Food allowance
      'phone',         // Phone/Communication allowance
      'medical',       // Medical allowance
      'education',     // Education allowance
      'special',       // Special allowance
      'other'
    ],
    required: true
  },
  name: { type: String, required: true },
  amount: { type: Number, required: true, default: 0 },
  isTaxable: { type: Boolean, default: true },
  isActive: { type: Boolean, default: true },
  effectiveFrom: Date,
  effectiveTo: Date,
  notes: String
}, { _id: true });

// Recurring deduction schema
const RecurringDeductionSchema = new Schema({
  type: {
    type: String,
    required: true
  },
  name: { type: String, required: true },
  amount: { type: Number, required: true, default: 0 },
  percentage: Number, // If deduction is percentage-based
  isPercentage: { type: Boolean, default: false },
  isPreTax: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  startDate: Date,
  endDate: Date,
  totalAmount: Number, // For loans - total loan amount
  remainingAmount: Number, // For loans - remaining balance
  notes: String
}, { _id: true });

// Bank account schema
const BankAccountSchema = new Schema({
  isPrimary: { type: Boolean, default: true },
  accountName: { type: String, required: true },
  accountNumber: { type: String, required: true },
  bankName: { type: String, required: true },
  branchName: String,
  branchCode: String,
  swiftCode: String,
  routingNumber: String,
  iban: String,
  accountType: {
    type: String,
    enum: ['checking', 'savings', 'current'],
    default: 'checking'
  },
  splitPercentage: { type: Number, default: 100 }, // For split deposits
  isVerified: { type: Boolean, default: false },
  verifiedAt: Date
}, { _id: true });

// Emergency contact (for payroll purposes)
const EmergencyContactSchema = new Schema({
  name: String,
  relationship: String,
  phone: String,
  email: String
}, { _id: false });

// Tax configuration schema
const TaxConfigSchema = new Schema({
  taxId: String,              // SSN, TIN, PAN, etc.
  taxRegime: {
    type: String,
    enum: ['standard', 'simplified', 'exempt', 'custom'],
    default: 'standard'
  },
  calculationMode: {
    type: String,
    enum: ['builtin', 'manual', 'configured'],
    default: 'configured'
  },
  jurisdictionCode: {
    type: String,
    uppercase: true,
    trim: true,
    maxlength: 16,
    default: 'OTHER'
  },
  jurisdictionName: String,
  jurisdictionConfigId: {
    type: Schema.Types.ObjectId,
    ref: 'TaxJurisdictionConfig',
    default: null,
  },
  jurisdictionVersionId: {
    type: Schema.Types.ObjectId,
    default: null,
  },
  employeeTaxInputs: {
    type: Schema.Types.Mixed,
    default: {},
  },
  taxValidation: {
    status: {
      type: String,
      enum: ['valid', 'warning', 'error', 'unknown'],
      default: 'unknown',
    },
    messages: {
      type: [String],
      default: [],
    },
    validatedAt: Date,
  },
  taxSubdivision: String,
  residencyStatus: {
    type: String,
    enum: ['resident', 'non_resident'],
    default: 'resident'
  },
  manualCalculationType: {
    type: String,
    enum: ['none', 'flat', 'progressive'],
    default: 'progressive'
  },
  manualTaxFreeAllowance: { type: Number, min: 0, default: 0 },
  // Payroll calculation settings (kept generic; not a tax-filing system)
  // Legacy compatibility field - superseded by calculationMode + jurisdictionCode.
  calculationRegime: {
    type: String,
    enum: ['none', 'flat', 'progressive_uk', 'progressive_us', 'progressive_generic'],
    default: 'flat'
  },
  flatTaxRate: { type: Number, min: 0, max: 100 }, // percent, used when calculationRegime='flat'
  customBrackets: [{
    min: { type: Number, required: true },
    max: { type: Number, required: true }, // Use a large number instead of Infinity
    rate: { type: Number, required: true, min: 0, max: 100 }
  }],
  socialSecurityRate: { type: Number, min: 0, max: 100 }, // percent (optional override)
  socialSecurityCap: { type: Number, min: 0 }, // annual cap (optional override)
  taxExemptions: [{
    type: { type: String }, // e.g., 'housing_loan', 'education', 'charitable'
    amount: Number,
    proofSubmitted: Boolean,
    validUntil: Date
  }],
  additionalWithholding: { type: Number, default: 0 },
  otherIncome: { type: Number, default: 0 }, // Annualized extra income for withholding worksheets
  deductionsAdjustment: { type: Number, default: 0 }, // Annualized deduction adjustment
  taxCredits: { type: Number, default: 0 }, // Annualized credit amount
  multipleJobs: { type: Boolean, default: false }, // Used by the IRS Step 2 multiple-jobs tables
  // For countries with tax declarations
  taxDeclarationSubmitted: { type: Boolean, default: false },
  taxDeclarationYear: Number,
  filingStatus: {
    type: String,
    enum: ['single', 'married_filing_jointly', 'married_filing_separately', 'head_of_household'],
    default: 'single'
  },
  dependents: { type: Number, default: 0 }
}, { _id: false });

// Salary history entry
const SalaryHistorySchema = new Schema({
  effectiveDate: { type: Date, required: true },
  previousSalary: Number,
  newSalary: { type: Number, required: true },
  changeReason: {
    type: String,
    enum: ['joining', 'promotion', 'annual_increment', 'market_adjustment', 'role_change', 'other']
  },
  changePercentage: Number,
  approvedBy: String,
  approvedByName: String,
  notes: String,
  linkedRequestId: { type: Schema.Types.ObjectId, ref: 'CompensationRequest' }
}, { _id: true });

// Main PayrollProfile Schema
const PayrollProfileSchema = new Schema({
  // User identification (from IdP)
  userId: { type: String, required: true, index: true },
  organizationId: { type: String, required: true, index: true },

  // Employee snapshot (synced from IdP but stored locally for payroll processing)
  employeeInfo: {
    name: String,
    email: String,
    employeeId: String, // Internal company employee ID
    designation: String,
    department: String,
    teamId: String,
    teamName: String,
    managerId: String,
    managerName: String,
    employmentType: {
      type: String,
      enum: ['full_time', 'part_time', 'contract', 'intern'],
      default: 'full_time'
    },
    dateOfJoining: Date,
    dateOfBirth: Date,
    probationEndDate: Date,
    costCenter: String,
    workLocation: String,
    lastSyncedAt: Date
  },

  // ===== COMPENSATION =====
  // Base Salary
  basicSalary: { type: Number, required: true, default: 0 },
  currency: {
    type: String,
    default: 'USD',
    uppercase: true,
    trim: true,
    maxlength: 3
  },
  payFrequency: {
    type: String,
    enum: ['monthly', 'bi-weekly', 'weekly', 'semi-monthly'],
    default: 'monthly'
  },
  compensationBasis: {
    type: String,
    enum: ['salaried', 'hourly'],
    default: 'salaried'
  },
  hourlyRate: { type: Number, min: 0 },
  standardHoursPerMonth: { type: Number, min: 1, max: 744, default: 176 },

  // How regular pay is earned. Salary remains the default for existing profiles.
  workTerms: {
    payBasis: {
      type: String,
      enum: ['salary', 'hourly', 'daily', 'fixed_contract'],
      default: 'salary'
    },
    rate: { type: Number, min: 0, default: 0 },
    standardHoursPerWeek: { type: Number, min: 0, max: 168, default: 40 },
    standardHoursPerDay: { type: Number, min: 0, max: 24, default: 8 },
    contractStartDate: Date,
    contractEndDate: Date,
    contractReference: { type: String, trim: true },
    contractAmount: { type: Number, min: 0, default: 0 },
    contractAmountFrequency: {
      type: String,
      enum: ['contract_total', 'pay_period'],
      default: 'contract_total'
    }
  },

  // Salary Grade (optional - for organizations using grade structures)
  salaryGrade: {
    gradeId: { type: Schema.Types.ObjectId, ref: 'SalaryGrade' },
    gradeName: String,
    gradeLevel: String,
    assignedAt: Date
  },

  // Salary History
  salaryHistory: [SalaryHistorySchema],

  // ===== ALLOWANCES =====
  allowances: [AllowanceSchema],

  // ===== RECURRING DEDUCTIONS =====
  recurringDeductions: [RecurringDeductionSchema],

  // ===== BANK DETAILS =====
  bankAccounts: [BankAccountSchema],

  // ===== TAX CONFIGURATION =====
  taxConfig: TaxConfigSchema,

  // ===== STATUTORY CONTRIBUTIONS =====
  statutoryContributions: {
    socialSecurityOptIn: { type: Boolean, default: true },
    socialSecurityNumber: String,
    pensionOptIn: { type: Boolean, default: true },
    pensionAccountNumber: String,
    pensionContributionPercent: { type: Number, default: 0 }, // Employee contribution %
    employerPensionPercent: { type: Number, default: 0 },      // Employer contribution %
  },

  // ===== BENEFITS ENROLLMENT =====
  benefits: {
    healthInsurancePlan: String,
    healthInsurancePremium: { type: Number, default: 0 },
    lifeInsuranceCoverage: { type: Number, default: 0 },
    lifeInsurancePremium: { type: Number, default: 0 },
    dentalPlan: String,
    visionPlan: String
  },

  // ===== LEAVE BALANCES (synced from Leave Management) =====
  leaveBalances: {
    annual: { type: Number, default: 0 },
    sick: { type: Number, default: 0 },
    unpaid: { type: Number, default: 0 },
    lastSyncedAt: Date
  },

  // ===== EMERGENCY CONTACT =====
  emergencyContact: EmergencyContactSchema,

  // ===== STATUS =====
  status: {
    type: String,
    enum: ['active', 'on_notice', 'on_leave', 'terminated', 'suspended'],
    default: 'active'
  },
  isActive: { type: Boolean, default: true },
  terminationDate: Date,
  terminationReason: String,

  // ===== PAYROLL PROCESSING FLAGS =====
  payrollFlags: {
    includeInNextRun: { type: Boolean, default: true },
    holdPayment: { type: Boolean, default: false },
    holdReason: String,
    requiresReview: { type: Boolean, default: false },
    reviewReason: String
  },

  // ===== METADATA =====
  notes: String, // Internal notes (HR only)
  tags: [String], // For filtering/grouping

  // Audit
  createdBy: String,
  lastModifiedBy: String,

}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// ===== INDEXES =====
PayrollProfileSchema.index({ userId: 1, organizationId: 1 }, { unique: true });
PayrollProfileSchema.index({ organizationId: 1, status: 1 });
PayrollProfileSchema.index({ 'employeeInfo.teamId': 1 });
PayrollProfileSchema.index({ 'salaryGrade.gradeId': 1 });

// ===== VIRTUALS =====

// Calculate total recurring allowances
PayrollProfileSchema.virtual('totalAllowances').get(function () {
  if (!this.allowances) return 0;
  return this.allowances
    .filter(a => a.isActive)
    .reduce((sum, a) => sum + a.amount, 0);
});

// Calculate total recurring deductions
PayrollProfileSchema.virtual('totalRecurringDeductions').get(function () {
  if (!this.recurringDeductions) return 0;
  return this.recurringDeductions
    .filter(d => d.isActive)
    .reduce((sum, d) => sum + d.amount, 0);
});

// Calculate gross monthly salary (basic + allowances)
PayrollProfileSchema.virtual('grossMonthlySalary').get(function () {
  return this.basicSalary + (this.totalAllowances || 0);
});

// Get primary bank account
PayrollProfileSchema.virtual('primaryBankAccount').get(function () {
  if (!this.bankAccounts || this.bankAccounts.length === 0) return null;
  return this.bankAccounts.find(b => b.isPrimary) || this.bankAccounts[0];
});

// ===== METHODS =====

// Add salary history entry
PayrollProfileSchema.methods.recordSalaryChange = function (newSalary, reason, approvedBy, approvedByName, notes) {
  const previousSalary = this.basicSalary;
  const changePercentage = previousSalary > 0
    ? ((newSalary - previousSalary) / previousSalary * 100).toFixed(2)
    : 0;

  this.salaryHistory.push({
    effectiveDate: new Date(),
    previousSalary,
    newSalary,
    changeReason: reason,
    changePercentage: parseFloat(changePercentage),
    approvedBy,
    approvedByName,
    notes
  });

  this.basicSalary = newSalary;
  return this;
};

// Add or update allowance
PayrollProfileSchema.methods.setAllowance = function (type, name, amount, options = {}) {
  const existingIndex = this.allowances.findIndex(a => a.type === type);

  const allowanceData = {
    type,
    name,
    amount,
    isTaxable: options.isTaxable !== false,
    isActive: options.isActive !== false,
    effectiveFrom: options.effectiveFrom,
    effectiveTo: options.effectiveTo,
    notes: options.notes
  };

  if (existingIndex >= 0) {
    this.allowances[existingIndex] = { ...this.allowances[existingIndex], ...allowanceData };
  } else {
    this.allowances.push(allowanceData);
  }

  return this;
};

// Add recurring deduction
PayrollProfileSchema.methods.addRecurringDeduction = function (type, name, amount, options = {}) {
  this.recurringDeductions.push({
    type,
    name,
    amount,
    percentage: options.percentage,
    isPercentage: options.isPercentage || false,
    isPreTax: options.isPreTax || false,
    isActive: true,
    startDate: options.startDate || new Date(),
    endDate: options.endDate,
    totalAmount: options.totalAmount,
    remainingAmount: options.remainingAmount || options.totalAmount,
    notes: options.notes
  });

  return this;
};

// Sync employee info from IdP user data
PayrollProfileSchema.methods.syncFromIdpUser = function (idpUser) {
  this.employeeInfo = {
    ...this.employeeInfo,
    name: idpUser.name,
    email: idpUser.email,
    employeeId: idpUser.employeeId || this.employeeInfo?.employeeId,
    designation: idpUser.designation || idpUser.jobTitle,
    department: idpUser.department,
    teamId: idpUser.teamId,
    teamName: idpUser.teamName,
    managerId: idpUser.managerId,
    managerName: idpUser.managerName,
    lastSyncedAt: new Date()
  };

  return this;
};

// ===== STATICS =====

function buildDefaultPayrollFlags(basicSalary, existingFlags = {}) {
  const flags = {
    ...(existingFlags || {}),
  };

  if (!(Number(basicSalary || 0) > 0)) {
    flags.includeInNextRun = false;
    flags.requiresReview = true;
    if (!String(flags.reviewReason || '').trim()) {
      flags.reviewReason = 'Automatically excluded from payroll until payroll setup is completed.';
    }
  }

  return flags;
}

// Find or create profile for user
PayrollProfileSchema.statics.findOrCreateForUser = async function (userId, organizationId, defaults = {}) {
  let profile = await this.findOne({ userId, organizationId });

  if (!profile) {
    const basicSalary = Number(defaults.basicSalary || 0);
    profile = new this({
      userId,
      organizationId,
      ...defaults,
      basicSalary,
      currency: defaults.currency || 'USD',
      employeeInfo: defaults.employeeInfo || {},
      payrollFlags: buildDefaultPayrollFlags(basicSalary, defaults.payrollFlags),
    });
    await profile.save();
  }

  return profile;
};

// Get all active profiles for an organization
PayrollProfileSchema.statics.getActiveByOrganization = function (organizationId, options = {}) {
  const query = {
    organizationId,
    isActive: true,
    basicSalary: { $gt: 0 },
    'payrollFlags.includeInNextRun': true
  };

  if (options.teamId) {
    query['employeeInfo.teamId'] = options.teamId;
  }

  return this.find(query)
    .populate('salaryGrade.gradeId')
    .sort({ 'employeeInfo.name': 1 });
};

// Get profiles for a list of user IDs (for team view)
PayrollProfileSchema.statics.getByUserIds = function (userIds, organizationId) {
  return this.find({
    userId: { $in: userIds },
    organizationId,
    isActive: true
  });
};

module.exports = mongoose.model('PayrollProfile', PayrollProfileSchema);
