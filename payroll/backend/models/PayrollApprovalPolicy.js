const mongoose = require('mongoose');

const ApprovalLevelSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  roles: [{ type: String, trim: true }],
  minimumApprovals: { type: Number, min: 1, default: 1 },
}, { _id: false });

const PayrollApprovalPolicySchema = new mongoose.Schema({
  organizationId: { type: String, required: true, index: true },
  employerEntityId: { type: mongoose.Schema.Types.ObjectId, ref: 'PayrollEmployerEntity', default: null },
  name: { type: String, required: true, trim: true, default: 'Default payroll approval' },
  isDefault: { type: Boolean, default: false },
  active: { type: Boolean, default: true },
  approvalRequired: { type: Boolean, default: true },
  requireSeparationOfDuties: { type: Boolean, default: true },
  allowedApproverUserIds: [{ type: String, trim: true }],
  automaticRelease: { type: Boolean, default: true },
  deliverAccountingOnRelease: { type: Boolean, default: true },
  levels: { type: [ApprovalLevelSchema], default: () => [{ name: 'Payroll approval', roles: ['owner', 'admin', 'hr_manager'], minimumApprovals: 1 }] },
  createdBy: String,
  updatedBy: String,
}, { timestamps: true });

PayrollApprovalPolicySchema.index({ organizationId: 1, employerEntityId: 1, name: 1 }, { unique: true });
PayrollApprovalPolicySchema.index(
  { organizationId: 1, isDefault: 1 },
  { unique: true, partialFilterExpression: { isDefault: true, active: true } }
);

module.exports = mongoose.model('PayrollApprovalPolicy', PayrollApprovalPolicySchema);
