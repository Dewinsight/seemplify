const mongoose = require('mongoose');

const PayrollAccountingContactSchema = new mongoose.Schema({
  organizationId: { type: String, required: true, index: true },
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  telephone: { type: String, trim: true },
  employerEntityId: { type: mongoose.Schema.Types.ObjectId, ref: 'PayrollEmployerEntity', default: null },
  employerEntityIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'PayrollEmployerEntity' }],
  preferredFormat: { type: String, enum: ['csv'], default: 'csv' },
  locale: { type: String, trim: true, default: 'en' },
  deliveryPreferences: { notifyOnRelease: { type: Boolean, default: true } },
  active: { type: Boolean, default: true },
  verifiedAt: Date,
  verifiedBy: String,
  createdBy: String,
  updatedBy: String,
}, { timestamps: true });

PayrollAccountingContactSchema.index({ organizationId: 1, email: 1 }, { unique: true });
module.exports = mongoose.model('PayrollAccountingContact', PayrollAccountingContactSchema);
