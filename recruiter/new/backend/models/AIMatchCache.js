const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const AIMatchCacheSchema = new Schema({
  jobId: {
    type: Schema.Types.ObjectId,
    ref: 'Job',
    required: true,
    index: true
  },
  candidateId: {
    type: Schema.Types.ObjectId,
    ref: 'Candidate',
    index: true,
    // Optional - for bulk job caching, this might be null
    default: null
  },
  matchData: {
    type: Schema.Types.Mixed,
    required: true
    // Stores the complete AI matching response
    // For single match: { score, reasoning, strengths, concerns, etc. }
    // For bulk match: array of candidate matches
  },
  version: {
    type: Number,
    default: 1,
    // Increment when AI matching algorithm changes
    // Allows invalidation of old algorithm results
  },
  cacheType: {
    type: String,
    enum: ['single', 'bulk', 'report'],
    required: true,
    // single: specific job-candidate match
    // bulk: all candidates for a job
    // report: full report with matches + GPT insights
  },
  metadata: {
    candidateCount: Number, // For bulk caches
    generationTime: Number, // Time taken to generate (ms)
    modelUsed: String, // e.g., 'gpt-4', 'text-embedding-ada-002'
    tokensUsed: Number, // API tokens consumed
    hasInsights: Boolean // For report caches - indicates if GPT insights are included
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true
    // TTL index will auto-delete expired documents
  }
}, {
  timestamps: true
});

// Compound index for efficient lookups
AIMatchCacheSchema.index({ jobId: 1, candidateId: 1 }, { unique: true, sparse: true });
AIMatchCacheSchema.index({ jobId: 1, cacheType: 1 });

// TTL index - MongoDB will automatically delete documents when expiresAt is reached
AIMatchCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Static method to get default TTL (24 hours)
AIMatchCacheSchema.statics.getDefaultTTL = function() {
  return 24 * 60 * 60 * 1000; // 24 hours in milliseconds
};

// Instance method to check if cache is still valid
AIMatchCacheSchema.methods.isValid = function() {
  return this.expiresAt > new Date();
};

// Instance method to get cache age in minutes
AIMatchCacheSchema.methods.getAgeMinutes = function() {
  return Math.floor((Date.now() - this.createdAt.getTime()) / (1000 * 60));
};

const AIMatchCache = mongoose.model('AIMatchCache', AIMatchCacheSchema);

module.exports = AIMatchCache;

