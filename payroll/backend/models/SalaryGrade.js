const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const SalaryGradeSchema = new Schema({
  organizationId: { type: String, required: true },
  
  // Grade Information
  gradeCode: { type: String, required: true }, // e.g., 'ENG-L1', 'MGR-L2'
  gradeName: { type: String, required: true }, // e.g., 'Engineer Level 1', 'Manager Level 2'
  gradeLevel: { type: Number, required: true }, // Numeric level for hierarchy
  
  // Salary Range
  salaryRange: {
    currency: {
      type: String,
      default: 'USD',
      uppercase: true,
      trim: true,
      maxlength: 3
    },
    minimum: { type: Number, required: true },
    maximum: { type: Number, required: true },
    midpoint: { type: Number, required: true }
  },
  
  // Variable Pay Components
  variablePay: {
    eligible: { type: Boolean, default: false },
    percentageOfBase: { type: Number, default: 0 }, // % of base salary
    maximumBonus: Number
  },
  
  // Allowances Structure
  allowances: [{
    name: { type: String, required: true }, // e.g., 'housing', 'transport', 'medical'
    type: { type: String, enum: ['fixed', 'percentage'], required: true },
    amount: Number, // Fixed amount
    percentage: Number, // Percentage of base salary
    isTaxable: { type: Boolean, default: true },
    isMandatory: { type: Boolean, default: false }
  }],
  
  // Benefits
  benefits: [{
    name: String,
    description: String,
    value: String,
    isTaxable: Boolean
  }],
  
  // Hierarchy
  parentGradeId: { type: Schema.Types.ObjectId, ref: 'SalaryGrade' },
  childGradeIds: [{ type: Schema.Types.ObjectId, ref: 'SalaryGrade' }],
  
  // Status & Lifecycle
  isActive: { type: Boolean, default: true },
  effectiveDate: { type: Date, default: Date.now },
  endDate: Date,
  
  // Approval Requirements
  requiresApprovalFor: {
    salaryIncrease: { type: Boolean, default: true },
    bonus: { type: Boolean, default: true },
    promotion: { type: Boolean, default: true }
  },
  
  // Metadata
  department: String,
  location: String,
  jobFamily: String,
  
  created_by: String,
  updated_by: String
}, { 
  timestamps: true,
  indexes: [
    { organizationId: 1, gradeCode: 1 },
    { organizationId: 1, gradeLevel: 1 },
    { gradeCode: 1 }
  ]
});

// Virtual for getting salary range as string
SalaryGradeSchema.virtual('salaryRangeString').get(function() {
  return `${this.salaryRange.currency} ${this.salaryRange.minimum.toLocaleString()} - ${this.salaryRange.maximum.toLocaleString()}`;
});

// Method to check if salary is within range
SalaryGradeSchema.methods.isSalaryInRange = function(salary) {
  return salary >= this.salaryRange.minimum && salary <= this.salaryRange.maximum;
};

// Method to calculate variable pay amount
SalaryGradeSchema.methods.calculateVariablePay = function(baseSalary) {
  if (!this.variablePay.eligible) return 0;
  
  const calculated = baseSalary * (this.variablePay.percentageOfBase / 100);
  return Math.min(calculated, this.variablePay.maximumBonus || calculated);
};

// Static method to find grades by level range
SalaryGradeSchema.statics.findByLevelRange = function(organizationId, minLevel, maxLevel) {
  return this.find({
    organizationId,
    gradeLevel: { $gte: minLevel, $lte: maxLevel },
    isActive: true
  }).sort({ gradeLevel: 1 });
};

// Static method to get next grade level
SalaryGradeSchema.statics.findNextGrade = function(organizationId, currentLevel) {
  return this.findOne({
    organizationId,
    gradeLevel: { $gt: currentLevel },
    isActive: true
  }).sort({ gradeLevel: 1 });
};

module.exports = mongoose.model('SalaryGrade', SalaryGradeSchema);
