const mongoose = require('mongoose');

const ChatSessionSchema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  userId: {
    type: String, // Can be user ID or session ID for anonymous users
    required: true,
    index: true
  },
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true
  },
  title: {
    type: String,
    default: 'New Chat'
  },
  description: {
    type: String,
    default: ''
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isPinned: {
    type: Boolean,
    default: false
  },
  messageCount: {
    type: Number,
    default: 0
  },
  lastMessage: {
    content: String,
    timestamp: Date,
    type: {
      type: String,
      enum: ['user', 'assistant'],
      default: 'user'
    }
  },
  metadata: {
    intent: String,
    topics: [String],
    totalTokens: Number,
    avgConfidence: Number,
    dataUsed: String
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  lastActivity: {
    type: Date,
    default: Date.now,
    index: true
  }
});

// Update the updatedAt and lastActivity on save
ChatSessionSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  this.lastActivity = new Date();
  next();
});

// Index for efficient queries
ChatSessionSchema.index({ userId: 1, organizationId: 1, lastActivity: -1 });
ChatSessionSchema.index({ userId: 1, organizationId: 1, isPinned: -1, lastActivity: -1 });
ChatSessionSchema.index({ organizationId: 1, lastActivity: -1 });

module.exports = mongoose.model('ChatSession', ChatSessionSchema); 