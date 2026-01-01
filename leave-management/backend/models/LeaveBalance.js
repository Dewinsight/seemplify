const mongoose = require('mongoose');

const balanceTypeSchema = new mongoose.Schema({
  total: { type: Number, default: 0 },
  used: { type: Number, default: 0 },
  remaining: { type: Number, default: 0 },
  pending: { type: Number, default: 0 }, // Days in pending requests
}, { _id: false });

const leaveBalanceSchema = new mongoose.Schema({
  // User reference (from Identity Provider)
  userId: { type: String, required: true, index: true }, // IdP account ID
  userEmail: { type: String, required: true },
  userName: { type: String },

  // Organization reference
  organizationId: { type: String, required: true, index: true }, // IdP organization ID

  // Leave balances by type
  annual: {
    type: balanceTypeSchema,
    default: () => ({ total: 20, used: 0, remaining: 20, pending: 0 }),
  },
  sick: {
    type: balanceTypeSchema,
    default: () => ({ total: 10, used: 0, remaining: 10, pending: 0 }),
  },
  personal: {
    type: balanceTypeSchema,
    default: () => ({ total: 5, used: 0, remaining: 5, pending: 0 }),
  },
  maternity: {
    type: balanceTypeSchema,
    default: () => ({ total: 90, used: 0, remaining: 90, pending: 0 }),
  },
  paternity: {
    type: balanceTypeSchema,
    default: () => ({ total: 14, used: 0, remaining: 14, pending: 0 }),
  },
  unpaid: {
    type: balanceTypeSchema,
    default: () => ({ total: 30, used: 0, remaining: 30, pending: 0 }),
  },

  // Year tracking
  year: { type: Number, required: true, index: true },

  // Timezone (for accurate date calculations)
  timezone: { type: String, default: 'UTC' },

  // Transaction version (for optimistic locking)
  version: { type: Number, default: 0 },

  // Carryover from previous year
  carryOver: {
    annual: { type: Number, default: 0 },
    appliedAt: { type: Date },
  },

  // Metadata
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, {
  timestamps: true,
});

// Compound unique index
leaveBalanceSchema.index({ userId: 1, organizationId: 1, year: 1 }, { unique: true });

// Pre-save middleware to update timestamps and recalculate remaining
leaveBalanceSchema.pre('save', function(next) {
  this.updatedAt = new Date();

  // Recalculate remaining for all leave types
  const leaveTypes = ['annual', 'sick', 'personal', 'maternity', 'paternity', 'unpaid'];
  for (const type of leaveTypes) {
    if (this[type]) {
      this[type].remaining = this[type].total - this[type].used;
    }
  }

  next();
});

// Instance methods
leaveBalanceSchema.methods.hasBalance = function(leaveType, days) {
  if (!this[leaveType]) {
    return { hasBalance: false, reason: `Invalid leave type: ${leaveType}` };
  }

  const available = this[leaveType].remaining - this[leaveType].pending;
  if (available >= days) {
    return { hasBalance: true, available };
  }

  return {
    hasBalance: false,
    reason: `Insufficient ${leaveType} leave balance. Available: ${available}, Requested: ${days}`,
    available,
  };
};

leaveBalanceSchema.methods.reserveBalance = function(leaveType, days) {
  if (!this[leaveType]) {
    throw new Error(`Invalid leave type: ${leaveType}`);
  }

  const available = this[leaveType].remaining - this[leaveType].pending;
  if (available < days) {
    throw new Error(`Insufficient ${leaveType} leave balance`);
  }

  this[leaveType].pending += days;
  this.version += 1;
};

leaveBalanceSchema.methods.useBalance = function(leaveType, days) {
  if (!this[leaveType]) {
    throw new Error(`Invalid leave type: ${leaveType}`);
  }

  // Move from pending to used
  this[leaveType].pending -= days;
  this[leaveType].used += days;
  this[leaveType].remaining = this[leaveType].total - this[leaveType].used;
  this.version += 1;
};

leaveBalanceSchema.methods.releaseReservation = function(leaveType, days) {
  if (!this[leaveType]) {
    throw new Error(`Invalid leave type: ${leaveType}`);
  }

  this[leaveType].pending = Math.max(0, this[leaveType].pending - days);
  this.version += 1;
};

leaveBalanceSchema.methods.restoreBalance = function(leaveType, days) {
  if (!this[leaveType]) {
    throw new Error(`Invalid leave type: ${leaveType}`);
  }

  this[leaveType].used = Math.max(0, this[leaveType].used - days);
  this[leaveType].remaining = this[leaveType].total - this[leaveType].used;
  this.version += 1;
};

// Static methods
leaveBalanceSchema.statics.findOrCreate = async function(userId, userEmail, userName, organizationId, year = new Date().getFullYear()) {
  // First, try to find existing balance
  let balance = await this.findOne({ userId, organizationId, year });

  if (!balance) {
    // Get policy to set initial balances
    const LeavePolicy = mongoose.model('LeavePolicy');
    const policy = await LeavePolicy.findOne({ organizationId });

    try {
      // Use findOneAndUpdate with upsert to handle race conditions atomically
      // This ensures only one document is created even if multiple requests come in simultaneously
      balance = await this.findOneAndUpdate(
        { userId, organizationId, year },
        {
          $setOnInsert: {
            userId,
            userEmail,
            userName,
            organizationId,
            year,
            annual: {
              total: policy?.annualLeaveDays || 20,
              used: 0,
              remaining: policy?.annualLeaveDays || 20,
              pending: 0,
            },
            sick: {
              total: policy?.sickLeaveDays || 10,
              used: 0,
              remaining: policy?.sickLeaveDays || 10,
              pending: 0,
            },
            personal: {
              total: policy?.personalLeaveDays || 5,
              used: 0,
              remaining: policy?.personalLeaveDays || 5,
              pending: 0,
            },
          }
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true
        }
      );
    } catch (error) {
      // Handle race condition: if duplicate key error, another request created it
      if (error.code === 11000) {
        // Retry finding the balance that was just created
        balance = await this.findOne({ userId, organizationId, year });
        if (!balance) {
          throw new Error('Failed to create or find leave balance after duplicate key error');
        }
      } else {
        throw error;
      }
    }
  }

  return balance;
};

leaveBalanceSchema.statics.getOrganizationBalances = async function(organizationId, year = new Date().getFullYear()) {
  return this.find({ organizationId, year }).sort({ userName: 1 });
};

const LeaveBalance = mongoose.model('LeaveBalance', leaveBalanceSchema);

module.exports = LeaveBalance;
