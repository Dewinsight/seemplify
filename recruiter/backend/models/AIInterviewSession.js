const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ['ai', 'candidate', 'system'],
    required: true
  },
  content: {
    type: String,
    required: true,
    trim: true
  },
  questionIndex: {
    type: Number,
    default: null
  },
  messageType: {
    type: String,
    enum: ['greeting', 'question', 'clarification', 'answer', 'acknowledgement', 'transition', 'system'],
    default: 'system'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, { _id: true });

const AnswerSchema = new mongoose.Schema({
  questionIndex: {
    type: Number,
    required: true
  },
  questionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'InterviewQuestion'
  },
  question: {
    type: String,
    required: true
  },
  answer: {
    type: String,
    trim: true,
    default: ''
  },
  status: {
    type: String,
    enum: ['draft', 'answered', 'skipped', 'timeout'],
    default: 'draft'
  },
  startedAt: Date,
  submittedAt: Date,
  timeSpentSeconds: {
    type: Number,
    min: 0,
    default: 0
  }
}, { _id: true });

const AIInterviewSessionSchema = new mongoose.Schema({
  aiInterview: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AIInterview',
    required: true,
    index: true
  },
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true
  },
  job: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Job',
    required: true,
    index: true
  },
  candidate: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Candidate',
    required: true,
    index: true
  },
  recipientType: {
    type: String,
    enum: ['candidate', 'guest'],
    default: 'candidate',
    index: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  candidateSnapshot: {
    firstName: String,
    lastName: String,
    name: String,
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true
    }
  },
  tokenHash: {
    type: String,
    index: true,
    sparse: true
  },
  tokenGeneratedAt: Date,
  status: {
    type: String,
    enum: [
      'pending_send',
      'sending',
      'sent',
      'opened',
      'in_progress',
      'completed',
      'expired',
      'cancelled',
      'credit_blocked',
      'credit_error',
      'email_failed'
    ],
    default: 'pending_send',
    index: true
  },
  currentQuestionIndex: {
    type: Number,
    min: 0,
    default: 0
  },
  startedAt: Date,
  completedAt: Date,
  lastActivityAt: Date,
  questionStartedAt: Date,
  questionDeadlineAt: Date,
  totalDeadlineAt: Date,
  messages: [MessageSchema],
  answers: [AnswerSchema],
  scoring: {
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending'
    },
    overallScore: {
      type: Number,
      min: 0,
      max: 100
    },
    recommendation: String,
    summary: String,
    strengths: [String],
    concerns: [String],
    questionScores: [{
      questionIndex: Number,
      score: {
        type: Number,
        min: 1,
        max: 5
      },
      rationale: String
    }],
    raw: mongoose.Schema.Types.Mixed,
    error: String,
    scoredAt: Date
  },
  email: {
    sentAt: Date,
    messageId: String,
    lastError: String,
    attempts: {
      type: Number,
      default: 0
    }
  },
  credits: {
    charged: {
      type: Boolean,
      default: false
    },
    cost: {
      type: Number,
      min: 0,
      default: 0
    },
    chargedAt: Date,
    refunded: {
      type: Boolean,
      default: false
    },
    refundedAt: Date,
    error: String
  }
}, {
  timestamps: true
});

AIInterviewSessionSchema.index({ aiInterview: 1, candidate: 1 }, { unique: true });
AIInterviewSessionSchema.index({ organization: 1, status: 1, createdAt: -1 });
AIInterviewSessionSchema.index({ status: 1, updatedAt: 1 });

module.exports = mongoose.model('AIInterviewSession', AIInterviewSessionSchema);
