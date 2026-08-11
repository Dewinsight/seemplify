const mongoose = require('mongoose');

const organizationFeaturesSchema = new mongoose.Schema({
  canonicalAppraisals: { type: Boolean },
  goalPeriods: { type: Boolean },
  notifications: { type: Boolean },
  continuousPerformance: { type: Boolean },
  performanceSupportPlans: { type: Boolean },
  recognition: { type: Boolean },
  projectFeedback: { type: Boolean },
  managerPracticeInsights: { type: Boolean },
  continuousCoachingAi: { type: Boolean }
}, { _id: false });

const organizationFeatureConfigSchema = new mongoose.Schema({
  organizationId: {
    type: String,
    required: true,
    trim: true,
    unique: true,
    index: true
  },
  features: {
    type: organizationFeaturesSchema,
    default: () => ({})
  },
  createdBy: { type: String, trim: true, maxlength: 240 },
  updatedBy: { type: String, trim: true, maxlength: 240 }
}, { timestamps: true });

module.exports = mongoose.models.OrganizationFeatureConfig
  || mongoose.model('OrganizationFeatureConfig', organizationFeatureConfigSchema);
