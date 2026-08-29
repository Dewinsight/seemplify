const mongoose = require('mongoose');

const CompensationApprovalPolicySchema = new mongoose.Schema({
  organizationId: { type: String, required: true, unique: true, index: true },
  approvalRequired: { type: Boolean, default: true },
  requireSeparationOfDuties: { type: Boolean, default: true },
  defaultOvertimeMultiplier: { type: Number, min: 1, max: 3, default: 1.5 },
  allowMultiplierOverride: { type: Boolean, default: false },
  requireEvidenceReference: { type: Boolean, default: false },
  preventTimesheetOverlap: { type: Boolean, default: true },
  maximumHoursPerRequest: { type: Number, min: 0.25, max: 24, default: 24 },
  approverRoles: {
    type: [{ type: String, enum: ['hr_admin', 'line_manager'] }],
    default: () => ['hr_admin'],
    validate: {
      validator: roles => Array.isArray(roles) && roles.length > 0,
      message: 'At least one manual overtime approver role is required',
    },
  },
  createdBy: String,
  updatedBy: String,
}, { timestamps: true });

module.exports = mongoose.model('CompensationApprovalPolicy', CompensationApprovalPolicySchema);
