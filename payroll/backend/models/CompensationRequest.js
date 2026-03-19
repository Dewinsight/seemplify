const mongoose = require('mongoose');
const Schema = mongoose.Schema;

/**
 * CompensationRequest
 *
 * Represents variable compensation inputs that can be included in a payroll run
 * after approval. This is not a payout system; it prepares payroll for export.
 */
const CompensationRequestSchema = new Schema({
  type: {
    type: String,
    required: true,
    enum: [
      'bonus',
      'salary_revision',
      'overtime',
      'reimbursement',
      'commission',
      'incentive',
      'allowance'
    ]
  },

  // Target Employee
  userId: { type: String, required: true, index: true },
  userName: String,
  organizationId: { type: String, required: true, index: true },

  // Requester (Employee / Line Manager / HR Admin)
  requesterId: { type: String, required: true },
  requesterName: String,
  requesterRole: { type: String }, // 'employee' | 'team_lead' | 'line_manager' | 'hr_admin'

  // Details
  amount: { type: Number, min: 0 }, // optional for overtime if hours provided
  currency: {
    type: String,
    default: 'USD',
    uppercase: true,
    trim: true,
    maxlength: 3
  },
  taxable: { type: Boolean, default: true },

  // Overtime-specific fields
  overtimeHours: { type: Number, min: 0 },
  overtimeMultiplier: { type: Number, min: 0, default: 1.5 },

  reason: String,
  effectiveDate: { type: Date, required: true },

  // Link to Performance (Optional)
  okrReference: {
    okrId: String,
    score: Number
  },

  // Arbitrary extra context (e.g., reimbursement receipt refs)
  metadata: Schema.Types.Mixed,

  // Approval Flow
  status: {
    type: String,
    enum: [
      'pending',
      'approved',
      'approved_l1',
      'approved_l2',
      'rejected',
      'processed',
      'cancelled'
    ],
    default: 'pending',
    index: true
  },
  approvals: [{
    approverId: String,
    approverName: String,
    role: String, // 'hr_admin', 'finance_admin', etc.
    status: { type: String, enum: ['approved', 'rejected'] },
    comment: String,
    date: { type: Date, default: Date.now }
  }],

  // Processing bookkeeping (set when a payroll run is finalized/exported)
  processedInRunId: { type: Schema.Types.ObjectId, ref: 'PayrollRun' },
  processedAt: Date
}, { timestamps: true });

CompensationRequestSchema.index({ organizationId: 1, status: 1, effectiveDate: -1 });

module.exports = mongoose.model('CompensationRequest', CompensationRequestSchema);
