const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const CompensationRequestSchema = new Schema({
  type: { type: String, enum: ['bonus', 'salary_revision', 'overtime'] },
  
  // Target Employee
  userId: { type: String, required: true },
  userName: String,
  organizationId: { type: String, required: true },
  
  // Requester (Line Manager / Team Lead)
  requesterId: { type: String, required: true },
  requesterName: String,
  requesterRole: { type: String }, // 'team_lead', 'line_manager'
  
  // Details
  amount: Number,
  reason: String,
  effectiveDate: Date,
  
  // Link to Performance (Optional)
  okrReference: {
    okrId: String, // From Performance Management
    score: Number
  },
  
  // Approval Flow
  status: { type: String, enum: ['pending', 'approved_l1', 'approved_l2', 'rejected', 'processed'], default: 'pending' },
  approvals: [{
    approverId: String,
    role: String, // 'dept_head', 'finance_admin'
    status: String,
    comment: String,
    date: Date
  }]
}, { timestamps: true });

module.exports = mongoose.model('CompensationRequest', CompensationRequestSchema);
