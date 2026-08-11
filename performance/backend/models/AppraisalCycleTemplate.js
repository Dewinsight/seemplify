const mongoose = require('mongoose');

const appraisalCycleTemplateSchema = new mongoose.Schema({
  organizationId: { type: String, required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, trim: true, maxlength: 1000 },
  category: {
    type: String,
    enum: ['annual', 'semi-annual', 'quarterly', 'probation', 'project', 'adhoc', 'custom'],
    default: 'custom'
  },
  version: { type: Number, default: 1, min: 1 },
  design: { type: mongoose.Schema.Types.Mixed, required: true },
  createdBy: {
    userId: String,
    name: String,
    email: String
  },
  updatedBy: {
    userId: String,
    name: String,
    email: String
  },
  archivedAt: Date
}, { timestamps: true });

appraisalCycleTemplateSchema.index({ organizationId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('AppraisalCycleTemplate', appraisalCycleTemplateSchema);
