const mongoose = require('mongoose');

const leaveEntitlementAdjustmentSchema = new mongoose.Schema({
  organizationId: { type: String, required: true, index: true },
  userId: { type: String, required: true, index: true },
  userName: { type: String },
  userEmail: { type: String },
  year: { type: Number, required: true, index: true },
  leaveTypeKey: { type: String, required: true, index: true },
  leaveTypeName: { type: String, required: true },
  operation: {
    type: String,
    enum: ['add', 'deduct', 'set', 'reset'],
    required: true,
    default: 'set',
  },
  previousTotal: { type: Number, required: true },
  newTotal: { type: Number, required: true },
  delta: { type: Number, required: true },
  reason: { type: String, required: true, trim: true, maxlength: 1000 },
  actorId: { type: String, required: true, index: true },
  actorName: { type: String },
  actorEmail: { type: String },
  createdAt: { type: Date, default: Date.now, immutable: true, index: true },
}, {
  versionKey: false,
});

leaveEntitlementAdjustmentSchema.index({ organizationId: 1, userId: 1, createdAt: -1 });
leaveEntitlementAdjustmentSchema.index({ organizationId: 1, createdAt: -1 });

const LeaveEntitlementAdjustment = mongoose.model(
  'LeaveEntitlementAdjustment',
  leaveEntitlementAdjustmentSchema
);

module.exports = LeaveEntitlementAdjustment;
