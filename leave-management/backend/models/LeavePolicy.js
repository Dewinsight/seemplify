const mongoose = require('mongoose');

const leavePolicySchema = new mongoose.Schema({
  // Organization reference
  organizationId: { type: String, required: true, unique: true, index: true }, // IdP organization ID
  organizationName: { type: String },

  // Default leave entitlements (days per year)
  annualLeaveDays: { type: Number, default: 20, min: 0, max: 365 },
  sickLeaveDays: { type: Number, default: 10, min: 0, max: 365 },
  personalLeaveDays: { type: Number, default: 5, min: 0, max: 365 },
  maternityLeaveDays: { type: Number, default: 90, min: 0, max: 365 },
  paternityLeaveDays: { type: Number, default: 14, min: 0, max: 365 },
  unpaidLeaveDays: { type: Number, default: 30, min: 0, max: 365 },

  // Approval settings
  requiresApproval: { type: Boolean, default: true },
  approvalRoles: {
    type: [String],
    default: ['owner', 'admin', 'hr_manager'],
  },
  autoApproveTypes: {
    type: [String],
    default: [], // Leave types that don't require approval
  },

  // Rules
  maxConsecutiveDays: { type: Number, default: 30 },
  advanceNoticeDays: { type: Number, default: 0, min: 0 }, // 0 = no advance notice required
  minLeaveDays: { type: Number, default: 0.5 }, // Allow half days

  // Carryover settings
  carryOverAllowed: { type: Boolean, default: false },
  maxCarryOverDays: { type: Number, default: 5 },
  carryOverExpiryMonths: { type: Number, default: 3 }, // Months into new year

  // Timezone and locale settings
  timezone: { type: String, default: 'UTC' }, // Organization timezone
  workingDays: {
    type: [Number],
    default: [1, 2, 3, 4, 5], // 0=Sunday, 1=Monday, etc.
  },

  // Holidays (organization-specific)
  holidays: [{
    date: { type: Date, required: true },
    name: { type: String },
    isRecurring: { type: Boolean, default: false }, // Repeats yearly
  }],

  // Holiday calendar reference (e.g., 'US', 'UK', 'NG')
  holidayCalendar: { type: String },

  // Accrual settings
  accrualMethod: {
    type: String,
    enum: ['upfront', 'monthly', 'quarterly', 'annually'],
    default: 'upfront',
  },
  accrualDay: { type: Number, default: 1, min: 1, max: 28 }, // Day of month/quarter for accrual

  // Notification settings
  notifyApproversOnRequest: { type: Boolean, default: true },
  notifyRequesterOnDecision: { type: Boolean, default: true },
  reminderDaysBeforeLeave: { type: Number, default: 1 },

  // Custom fields (for extensibility)
  customSettings: { type: mongoose.Schema.Types.Mixed },

  // Metadata
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  createdBy: { type: String }, // IdP account ID
  updatedBy: { type: String }, // IdP account ID
}, {
  timestamps: true,
});

// Pre-save middleware
leavePolicySchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Instance methods
leavePolicySchema.methods.isWorkingDay = function(date) {
  const dayOfWeek = date.getDay();
  return this.workingDays.includes(dayOfWeek);
};

leavePolicySchema.methods.isHoliday = function(date) {
  const dateStr = date.toISOString().split('T')[0];

  return this.holidays.some(holiday => {
    const holidayDate = new Date(holiday.date);
    const holidayStr = holidayDate.toISOString().split('T')[0];

    if (holiday.isRecurring) {
      // Compare month and day only
      return holidayDate.getMonth() === date.getMonth() &&
             holidayDate.getDate() === date.getDate();
    }

    return holidayStr === dateStr;
  });
};

leavePolicySchema.methods.getLeaveEntitlement = function(leaveType) {
  const entitlementMap = {
    annual: this.annualLeaveDays,
    sick: this.sickLeaveDays,
    personal: this.personalLeaveDays,
    maternity: this.maternityLeaveDays,
    paternity: this.paternityLeaveDays,
    unpaid: this.unpaidLeaveDays,
  };

  return entitlementMap[leaveType] || 0;
};

leavePolicySchema.methods.requiresApprovalForType = function(leaveType) {
  if (!this.requiresApproval) {
    return false;
  }
  return !this.autoApproveTypes.includes(leaveType);
};

// Static methods
leavePolicySchema.statics.findOrCreate = async function(organizationId, organizationName) {
  let policy = await this.findOne({ organizationId });

  if (!policy) {
    policy = new this({
      organizationId,
      organizationName,
    });
    await policy.save();
  }

  return policy;
};

leavePolicySchema.statics.getDefaultPolicy = function() {
  return {
    annualLeaveDays: 20,
    sickLeaveDays: 10,
    personalLeaveDays: 5,
    maternityLeaveDays: 90,
    paternityLeaveDays: 14,
    unpaidLeaveDays: 30,
    requiresApproval: true,
    maxConsecutiveDays: 30,
    advanceNoticeDays: 0,
    carryOverAllowed: false,
    workingDays: [1, 2, 3, 4, 5],
    accrualMethod: 'upfront',
  };
};

const LeavePolicy = mongoose.model('LeavePolicy', leavePolicySchema);

module.exports = LeavePolicy;
