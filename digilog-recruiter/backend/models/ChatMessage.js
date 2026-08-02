const mongoose = require('mongoose');

const ChatMessageSchema = new mongoose.Schema({
  messageId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  sessionId: {
    type: String,
    required: true,
    index: true
  },
  chatSessionId: {
    type: String,
    required: true,
    index: true
  },
  userId: {
    type: String,
    required: true,
    index: true
  },
  role: {
    type: String,
    required: true,
    enum: ['user', 'assistant', 'system'],
    index: true
  },
  content: {
    type: String,
    required: true,
    maxlength: 10000 // Prevent extremely long messages
  },
  metadata: {
    intent: String,
    confidence: Number,
    processingTime: Number,
    dataUsed: String,
    actions: [{
      label: String,
      action: String,
      data: mongoose.Schema.Types.Mixed
    }],
    attachments: [{
      name: String,
      type: String,
      size: Number,
      url: String
    }]
  },
  isLoading: {
    type: Boolean,
    default: false
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update the updatedAt on save
ChatMessageSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Compound indexes for efficient queries
ChatMessageSchema.index({ chatSessionId: 1, timestamp: 1 });
ChatMessageSchema.index({ userId: 1, timestamp: -1 });
ChatMessageSchema.index({ sessionId: 1, timestamp: -1 });
ChatMessageSchema.index({ chatSessionId: 1, role: 1, timestamp: 1 });

module.exports = mongoose.model('ChatMessage', ChatMessageSchema); 