const mongoose = require('mongoose');

const participantSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  name: String,
  email: String,
  role: { type: String, trim: true, maxlength: 160 }
}, { _id: false });

const performanceProjectSchema = new mongoose.Schema({
  organizationId: { type: String, required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 240 },
  description: { type: String, trim: true, maxlength: 3000 },
  externalReference: { type: String, trim: true, maxlength: 240 },
  leads: [participantSchema],
  participants: [participantSchema],
  startDate: { type: Date, required: true },
  endDate: Date,
  state: { type: String, enum: ['draft', 'active', 'closed'], default: 'draft', index: true },
  feedbackWindow: {
    opensAt: Date,
    closesAt: Date
  },
  createdBy: { type: String, required: true },
  audit: [{
    action: String,
    actorId: String,
    at: { type: Date, default: Date.now },
    details: mongoose.Schema.Types.Mixed
  }]
}, { timestamps: true });

performanceProjectSchema.index({ organizationId: 1, 'participants.userId': 1, state: 1 });
performanceProjectSchema.index({ organizationId: 1, 'leads.userId': 1, state: 1 });

module.exports = mongoose.models.PerformanceProject || mongoose.model('PerformanceProject', performanceProjectSchema);
