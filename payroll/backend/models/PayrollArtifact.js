const mongoose = require('mongoose');

const PayrollArtifactSchema = new mongoose.Schema({
  organizationId: { type: String, required: true, index: true },
  cycleId: { type: mongoose.Schema.Types.ObjectId, ref: 'PayrollCycle', required: true, index: true },
  payrollRunId: { type: mongoose.Schema.Types.ObjectId, ref: 'PayrollRun', default: null },
  kind: { type: String, enum: ['payroll_register', 'cycle_manifest'], required: true },
  fileName: { type: String, required: true },
  contentType: { type: String, required: true },
  currency: { type: String, uppercase: true, trim: true },
  byteLength: { type: Number, required: true, min: 0 },
  checksum: { type: String, required: true },
  content: { type: Buffer, required: true, select: false },
  createdBy: String,
  revokedAt: Date,
  revokedBy: String,
}, { timestamps: true });

PayrollArtifactSchema.index({ organizationId: 1, cycleId: 1, kind: 1, payrollRunId: 1 }, { unique: true });
module.exports = mongoose.model('PayrollArtifact', PayrollArtifactSchema);
