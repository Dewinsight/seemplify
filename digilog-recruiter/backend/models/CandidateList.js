const mongoose = require('mongoose');

const CandidateListEntrySchema = new mongoose.Schema({
  candidate: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Candidate',
    required: true,
  },
  rank: {
    type: Number,
    min: 1,
  },
  score: {
    type: Number,
  },
  source: {
    type: String,
    trim: true,
  },
  notes: {
    type: String,
    trim: true,
  },
  addedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  addedAt: {
    type: Date,
    default: Date.now,
  },
}, { _id: false });

const CandidateListSchema = new mongoose.Schema({
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 140,
  },
  description: {
    type: String,
    trim: true,
    maxlength: 1000,
  },
  source: {
    type: String,
    enum: ['manual', 'candidates', 'ai_matching', 'ai_interview', 'imported'],
    default: 'manual',
  },
  sourceRef: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  entries: {
    type: [CandidateListEntrySchema],
    default: [],
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
}, { timestamps: true });

CandidateListSchema.index({ organization: 1, updatedAt: -1 });
CandidateListSchema.index({ organization: 1, name: 1 });
CandidateListSchema.index({ organization: 1, 'entries.candidate': 1 });

CandidateListSchema.virtual('candidateCount').get(function getCandidateCount() {
  return this.entries?.length || 0;
});

CandidateListSchema.set('toJSON', { virtuals: true });
CandidateListSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('CandidateList', CandidateListSchema);
