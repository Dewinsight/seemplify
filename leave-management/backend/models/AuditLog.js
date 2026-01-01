const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  // Action type
  action: {
    type: String,
    required: true,
    enum: [
      'leave_request_created',
      'leave_request_updated',
      'leave_request_approved',
      'leave_request_rejected',
      'leave_request_cancelled',
      'leave_balance_updated',
      'leave_balance_accrued',
      'leave_policy_created',
      'leave_policy_updated',
      'user_login',
      'user_logout',
      'hub_launch',
    ],
    index: true,
  },

  // Resource information
  resourceType: {
    type: String,
    enum: ['LeaveRequest', 'LeaveBalance', 'LeavePolicy', 'User', 'Session'],
    index: true,
  },
  resourceId: { type: String, index: true },

  // Organization context
  organizationId: { type: String, required: true, index: true },

  // User who performed the action
  performedBy: { type: String, required: true, index: true }, // IdP account ID
  performedByName: { type: String },
  performedByEmail: { type: String },

  // Timestamp
  performedAt: { type: Date, default: Date.now, index: true },

  // Additional details
  details: { type: String },
  metadata: { type: mongoose.Schema.Types.Mixed },

  // Request information
  ipAddress: { type: String },
  userAgent: { type: String },

  // Before/after state (for updates)
  previousState: { type: mongoose.Schema.Types.Mixed },
  newState: { type: mongoose.Schema.Types.Mixed },
}, {
  timestamps: false,
});

// Compound indexes for common queries
auditLogSchema.index({ organizationId: 1, performedAt: -1 });
auditLogSchema.index({ resourceType: 1, resourceId: 1, performedAt: -1 });
auditLogSchema.index({ performedBy: 1, performedAt: -1 });

// TTL index for automatic cleanup (optional - keep logs for 2 years)
auditLogSchema.index({ performedAt: 1 }, { expireAfterSeconds: 63072000 }); // 2 years

// Static methods
auditLogSchema.statics.log = async function({
  action,
  resourceType,
  resourceId,
  organizationId,
  performedBy,
  performedByName,
  performedByEmail,
  details,
  metadata,
  ipAddress,
  userAgent,
  previousState,
  newState,
}) {
  try {
    const log = new this({
      action,
      resourceType,
      resourceId,
      organizationId,
      performedBy,
      performedByName,
      performedByEmail,
      details,
      metadata,
      ipAddress,
      userAgent,
      previousState,
      newState,
    });

    await log.save();
    return log;
  } catch (error) {
    // Log errors but don't throw - audit logging shouldn't break operations
    console.error('Audit log error:', error);
    return null;
  }
};

auditLogSchema.statics.getResourceHistory = async function(resourceType, resourceId, limit = 50) {
  return this.find({ resourceType, resourceId })
    .sort({ performedAt: -1 })
    .limit(limit);
};

auditLogSchema.statics.getUserActivity = async function(performedBy, organizationId, limit = 50) {
  return this.find({ performedBy, organizationId })
    .sort({ performedAt: -1 })
    .limit(limit);
};

auditLogSchema.statics.getOrganizationActivity = async function(organizationId, options = {}) {
  const { limit = 50, startDate, endDate, action } = options;

  const query = { organizationId };

  if (startDate || endDate) {
    query.performedAt = {};
    if (startDate) query.performedAt.$gte = new Date(startDate);
    if (endDate) query.performedAt.$lte = new Date(endDate);
  }

  if (action) {
    query.action = action;
  }

  return this.find(query)
    .sort({ performedAt: -1 })
    .limit(limit);
};

const AuditLog = mongoose.model('AuditLog', auditLogSchema);

module.exports = AuditLog;
