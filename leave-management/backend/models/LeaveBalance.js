const mongoose = require('mongoose');
const {
  getPolicyLeaveTypes,
  synchronizeEntitlements,
} = require('../services/leaveEntitlementService');

const balanceTypeSchema = new mongoose.Schema({
  total: { type: Number, default: 0 },
  used: { type: Number, default: 0 },
  remaining: { type: Number, default: 0 },
  pending: { type: Number, default: 0 }, // Days in pending requests
}, { _id: false });

const entitlementSchema = new mongoose.Schema({
  leaveTypeKey: { type: String, required: true, trim: true, lowercase: true },
  leaveTypeName: { type: String, required: true, trim: true },
  total: { type: Number, default: 0, min: 0, max: 3650 },
  used: { type: Number, default: 0, min: 0 },
  remaining: { type: Number, default: 0 },
  pending: { type: Number, default: 0, min: 0 },
  policyDefault: { type: Number, default: 0, min: 0, max: 3650 },
  source: { type: String, enum: ['policy', 'override'], default: 'policy' },
  overrideReason: { type: String, maxlength: 1000, default: '' },
  lastAdjustedAt: { type: Date },
  lastAdjustedBy: { type: String },
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

  // Canonical dynamic balances. Legacy fields remain during migration so
  // historical records and older deployed clients can still be read.
  entitlements: { type: [entitlementSchema], default: [] },

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

  // Recalculate remaining for all legacy leave types
  const leaveTypes = ['annual', 'sick', 'personal', 'maternity', 'paternity', 'unpaid'];
  for (const type of leaveTypes) {
    if (this[type]) {
      this[type].remaining = this[type].total - this[type].used;
    }
  }

  for (const entitlement of this.entitlements || []) {
    entitlement.remaining = Number(entitlement.total || 0) - Number(entitlement.used || 0);
  }

  next();
});

// Instance methods
leaveBalanceSchema.methods.hasBalance = function(leaveType, days) {
  const entitlement = this.getEntitlement(leaveType);
  if (!entitlement) {
    return { hasBalance: false, reason: `Invalid leave type: ${leaveType}` };
  }

  const available = Number(entitlement.total || 0) - Number(entitlement.used || 0) - Number(entitlement.pending || 0);
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
  const entitlement = this.getEntitlement(leaveType);
  if (!entitlement) {
    throw new Error(`Invalid leave type: ${leaveType}`);
  }

  const available = Number(entitlement.total || 0) - Number(entitlement.used || 0) - Number(entitlement.pending || 0);
  if (available < days) {
    throw new Error(`Insufficient ${leaveType} leave balance`);
  }

  entitlement.pending += days;
  this.version += 1;
};

leaveBalanceSchema.methods.useBalance = function(leaveType, days) {
  const entitlement = this.getEntitlement(leaveType);
  if (!entitlement) {
    throw new Error(`Invalid leave type: ${leaveType}`);
  }

  // Move from pending to used
  entitlement.pending = Math.max(0, Number(entitlement.pending || 0) - days);
  entitlement.used += days;
  entitlement.remaining = entitlement.total - entitlement.used;
  this.version += 1;
};

leaveBalanceSchema.methods.releaseReservation = function(leaveType, days) {
  const entitlement = this.getEntitlement(leaveType);
  if (!entitlement) {
    throw new Error(`Invalid leave type: ${leaveType}`);
  }

  entitlement.pending = Math.max(0, entitlement.pending - days);
  this.version += 1;
};

leaveBalanceSchema.methods.restoreBalance = function(leaveType, days) {
  const entitlement = this.getEntitlement(leaveType);
  if (!entitlement) {
    throw new Error(`Invalid leave type: ${leaveType}`);
  }

  entitlement.used = Math.max(0, entitlement.used - days);
  entitlement.remaining = entitlement.total - entitlement.used;
  this.version += 1;
};

leaveBalanceSchema.methods.getEntitlement = function(leaveType) {
  const dynamic = (this.entitlements || []).find((entry) => entry.leaveTypeKey === leaveType);
  if (dynamic) return dynamic;
  return this[leaveType] || null;
};

leaveBalanceSchema.methods.synchronizeWithPolicy = function(policy) {
  return synchronizeEntitlements(this, policy);
};

// Static methods
leaveBalanceSchema.statics.findOrCreate = async function(userId, userEmail, userName, organizationId, year = new Date().getFullYear()) {
  // First, try to find existing balance
  let balance = await this.findOne({ userId, organizationId, year });

  if (!balance) {
    // Get policy to set initial balances
    const LeavePolicy = mongoose.model('LeavePolicy');
    const policy = await LeavePolicy.findOrCreate(organizationId);
    const entitlements = getPolicyLeaveTypes(policy, { includeInactive: true }).map((definition) => ({
      leaveTypeKey: definition.key,
      leaveTypeName: definition.name,
      total: definition.defaultDays,
      used: 0,
      remaining: definition.defaultDays,
      pending: 0,
      policyDefault: definition.defaultDays,
      source: 'policy',
    }));

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
            timezone: policy.timezone,
            entitlements,
            annual: {
              total: policy?.annualLeaveDays ?? 20,
              used: 0,
              remaining: policy?.annualLeaveDays ?? 20,
              pending: 0,
            },
            sick: {
              total: policy?.sickLeaveDays ?? 10,
              used: 0,
              remaining: policy?.sickLeaveDays ?? 10,
              pending: 0,
            },
            personal: {
              total: policy?.personalLeaveDays ?? 5,
              used: 0,
              remaining: policy?.personalLeaveDays ?? 5,
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

  const LeavePolicy = mongoose.model('LeavePolicy');
  const policy = await LeavePolicy.findOrCreate(organizationId);
  const changed = balance.synchronizeWithPolicy(policy);
  if (balance.userEmail !== userEmail || balance.userName !== userName) {
    balance.userEmail = userEmail;
    balance.userName = userName;
    balance.timezone = policy.timezone;
    balance.version += 1;
    await balance.save();
  } else if (changed) {
    balance.version += 1;
    await balance.save();
  }

  return balance;
};

leaveBalanceSchema.statics.getOrganizationBalances = async function(organizationId, year = new Date().getFullYear()) {
  return this.find({ organizationId, year }).sort({ userName: 1 });
};

const LeaveBalance = mongoose.model('LeaveBalance', leaveBalanceSchema);

module.exports = LeaveBalance;
