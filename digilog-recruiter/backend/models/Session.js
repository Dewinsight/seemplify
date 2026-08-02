const mongoose = require('mongoose');

const SessionSchema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null, // null for anonymous sessions
  },
  ipAddress: {
    type: String,
    required: true,
  },
  userAgent: {
    type: String,
    required: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  lastActivity: {
    type: Date,
    default: Date.now,
    index: true,
  },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    index: { expireAfterSeconds: 0 }, // MongoDB TTL index
  },
  metadata: {
    browser: String,
    platform: String,
    location: String,
  },
  totalInteractions: {
    type: Number,
    default: 0,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Index for efficient queries
SessionSchema.index({ userId: 1, isActive: 1 });
SessionSchema.index({ sessionId: 1, isActive: 1 });

// Update lastActivity on save
SessionSchema.pre('save', function(next) {
  if (this.isModified() && !this.isModified('lastActivity')) {
    this.lastActivity = new Date();
  }
  next();
});

// Instance methods
SessionSchema.methods.updateActivity = function() {
  this.lastActivity = new Date();
  this.totalInteractions += 1;
  return this.save();
};

SessionSchema.methods.linkToUser = function(userId) {
  this.userId = userId;
  return this.save();
};

SessionSchema.methods.deactivate = function() {
  this.isActive = false;
  return this.save();
};

// Static methods
SessionSchema.statics.createSession = async function(sessionId, ipAddress, userAgent, userId = null) {
  const session = new this({
    sessionId,
    userId,
    ipAddress,
    userAgent,
  });
  return await session.save();
};

SessionSchema.statics.findActiveSession = async function(sessionId) {
  return await this.findOne({ sessionId, isActive: true });
};

SessionSchema.statics.getUserSessions = async function(userId) {
  return await this.find({ userId, isActive: true }).sort({ lastActivity: -1 });
};

SessionSchema.statics.cleanupExpiredSessions = async function() {
  const now = new Date();
  return await this.updateMany(
    { expiresAt: { $lt: now }, isActive: true },
    { $set: { isActive: false } }
  );
};

module.exports = mongoose.model('Session', SessionSchema); 