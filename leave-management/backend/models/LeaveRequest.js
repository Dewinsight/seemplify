const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  action: {
    type: String,
    enum: ['created', 'updated', 'approved', 'rejected', 'cancelled'],
    required: true,
  },
  performedBy: { type: String, required: true }, // IdP account ID
  performedByName: { type: String },
  performedAt: { type: Date, default: Date.now },
  details: { type: String },
}, { _id: false });

const leaveRequestSchema = new mongoose.Schema({
  // User reference (from Identity Provider)
  userId: { type: String, required: true, index: true }, // IdP account ID
  userEmail: { type: String, required: true },
  userName: { type: String },

  // Organization reference (from Identity Provider)
  organizationId: { type: String, required: true, index: true }, // IdP organization ID
  organizationName: { type: String },

  // Team reference (from Identity Provider) - for approval routing
  teamId: { type: String }, // IdP team ID (optional - user's primary team)
  teamName: { type: String },
  teamHierarchyPath: [{ type: String }], // Full team path for display

  // Leave details
  leaveType: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    maxlength: 50,
    index: true,
  },
  leaveTypeName: { type: String, trim: true, maxlength: 80 },
  startDate: { type: Date, required: true, index: true },
  endDate: { type: Date, required: true },
  numberOfDays: { type: Number, required: true },
  reason: { type: String, maxlength: 1000 },

  // Timezone and locale
  timezone: { type: String, default: 'UTC' }, // User's timezone
  workingDaysOnly: { type: Boolean, default: true }, // Exclude weekends/holidays

  // Status and workflow
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'cancelled'],
    default: 'pending',
    index: true,
  },

  // Approval routing (team-based)
  assignedApprover: {
    userId: String, // Line manager's IdP account ID (from team hierarchy)
    userName: String,
    userEmail: String,
    teamId: String, // Team where approver is line_manager
    assignedAt: Date,
    assignmentType: {
      type: String,
      enum: ['line_manager', 'organization_role'],
    },
  },

  // Approval details
  approvedBy: {
    userId: String, // IdP account ID
    userName: String,
    userEmail: String,
    approvedAt: Date,
    comment: String,
    approvalType: {
      type: String,
      enum: ['organization_role', 'line_manager', 'admin_override'],
    },
  },

  // Rejection details
  rejectedBy: {
    userId: String,
    userName: String,
    userEmail: String,
    rejectedAt: Date,
    rejectionReason: String,
  },

  // Cancellation details
  cancelledBy: {
    userId: String,
    userName: String,
    cancelledAt: Date,
    cancellationReason: String,
  },

  // Idempotency (for concurrent approvals)
  approvalIdempotencyKey: { type: String, unique: true, sparse: true },

  // Audit trail
  auditLog: [auditLogSchema],

  // Metadata
  createdAt: { type: Date, default: Date.now, index: true },
  updatedAt: { type: Date, default: Date.now },
}, {
  timestamps: true,
});

// Compound indexes for common queries
leaveRequestSchema.index({ userId: 1, organizationId: 1, status: 1 });
leaveRequestSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
leaveRequestSchema.index({ 'assignedApprover.userId': 1, status: 1 });
leaveRequestSchema.index({ startDate: 1, endDate: 1 }); // For overlap detection

// Pre-save middleware to update timestamps
leaveRequestSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Instance methods
leaveRequestSchema.methods.addAuditLog = function(action, performedBy, performedByName, details) {
  this.auditLog.push({
    action,
    performedBy,
    performedByName,
    performedAt: new Date(),
    details,
  });
};

leaveRequestSchema.methods.canBeCancelled = function(userId) {
  // Only the requester can cancel
  if (this.userId !== userId) {
    return { allowed: false, reason: 'Only the requester can cancel this leave request' };
  }

  // Can cancel pending requests anytime
  if (this.status === 'pending') {
    return { allowed: true };
  }

  // Can cancel approved requests within 24 hours of approval
  if (this.status === 'approved' && this.approvedBy?.approvedAt) {
    const hoursSinceApproval = (Date.now() - new Date(this.approvedBy.approvedAt).getTime()) / (1000 * 60 * 60);
    if (hoursSinceApproval <= 24) {
      return { allowed: true };
    }
    return { allowed: false, reason: 'Cannot cancel approved leave after 24 hours' };
  }

  return { allowed: false, reason: `Cannot cancel leave request with status: ${this.status}` };
};

// Static methods
leaveRequestSchema.statics.findOverlapping = async function(userId, organizationId, startDate, endDate, excludeId = null) {
  const query = {
    userId,
    organizationId,
    status: { $in: ['pending', 'approved'] },
    $or: [
      { startDate: { $lte: endDate }, endDate: { $gte: startDate } },
    ],
  };

  if (excludeId) {
    query._id = { $ne: excludeId };
  }

  return this.find(query);
};

leaveRequestSchema.statics.findPendingForApprover = async function(approverId, organizationId) {
  return this.find({
    organizationId,
    status: 'pending',
    'assignedApprover.userId': approverId,
  }).sort({ createdAt: -1 });
};

const LeaveRequest = mongoose.model('LeaveRequest', leaveRequestSchema);

module.exports = LeaveRequest;
