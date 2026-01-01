const mongoose = require('mongoose');

const FeedbackSchema = new mongoose.Schema({
  senderId: { 
    type: String, 
    required: true 
  },
  receiverId: { 
    type: String, 
    required: true 
  },
  content: { 
    type: String, 
    required: true 
  },
  type: { 
    type: String, 
    enum: ['praise', 'coaching', 'general'] 
  },
  visibility: { 
    type: String, 
    enum: ['public', 'private', 'manager-only'] 
  },
  relatedOkrId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'OKR' 
  },
  
  // AI Analysis
  aiAnalysis: {
    sentimentScore: Number, // -100 to 100
    category: String, // "achievement", "improvement", "teamwork", etc.
    actionItems: [String], // Suggested follow-up actions
    urgency: String, // "low", "medium", "high"
  },
  aiModeration: {
    isAppropriate: Boolean,
    flaggedPhrases: [String],
    suggestedEdits: [String]
  },
  
  createdAt: { 
    type: Date, 
    default: Date.now 
  }
});

// Indexes for performance
FeedbackSchema.index({ senderId: 1, receiverId: 1, createdAt: 1 });
FeedbackSchema.index({ relatedOkrId: 1 });

module.exports = mongoose.model('Feedback', FeedbackSchema);