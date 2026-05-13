const mongoose = require('mongoose');
const crypto = require('crypto');

function createLegacyPublicLinkValue() {
  return `ai_${crypto.randomBytes(18).toString('base64url')}`;
}

const QuestionSnapshotSchema = new mongoose.Schema({
  questionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'InterviewQuestion',
    required: true
  },
  question: {
    type: String,
    required: true,
    trim: true
  },
  type: String,
  category: String,
  difficulty: String,
  interviewStage: String,
  order: Number,
  timeLimit: Number,
  expectedAnswer: String,
  scoringCriteria: [{
    criterion: String,
    weight: Number,
    description: String
  }]
}, { _id: false });

const AIInterviewSchema = new mongoose.Schema({
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
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  // Some existing databases have a legacy unique index on publicLink.
  // Candidate access uses per-session token hashes, but this keeps that index from colliding on null.
  publicLink: {
    type: String,
    required: true,
    default: createLegacyPublicLinkValue,
    select: false
  },
  guidelines: {
    type: String,
    trim: true,
    maxlength: 5000,
    default: ''
  },
  questionSnapshots: {
    type: [QuestionSnapshotSchema],
    validate: {
      validator: (items) => Array.isArray(items) && items.length > 0,
      message: 'At least one question is required'
    }
  },
  timers: {
    perQuestionMinutes: {
      type: Number,
      min: 1,
      max: 120,
      default: 10
    },
    totalMinutes: {
      type: Number,
      min: 1,
      max: 480,
      default: 60
    }
  },
  schedule: {
    sendAt: {
      type: Date,
      required: true,
      index: true
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true
    },
    timezone: {
      type: String,
      trim: true,
      default: 'UTC'
    }
  },
  status: {
    type: String,
    enum: ['scheduled', 'sending', 'active', 'completed', 'cancelled', 'expired'],
    default: 'scheduled',
    index: true
  },
  candidateCount: {
    type: Number,
    min: 0,
    default: 0
  },
  voice: {
    voiceId: String,
    name: String,
    displayName: String,
    tier: String,
    tierLabel: String,
    provider: {
      type: String,
      default: 'azure-speech'
    },
    language: {
      type: String,
      default: 'en-US'
    },
    gender: String,
    avatarTone: String,
    samplePhrase: String,
    description: String,
    traits: [String],
    surchargeCredits: {
      type: Number,
      default: 0
    },
    usdPerMillionCharacters: {
      type: Number,
      default: 15
    }
  },
  creditCostPerCandidate: {
    type: Number,
    min: 0,
    default: 8
  },
  costEstimate: {
    baseCreditsPerCandidate: Number,
    voiceSurchargeCredits: Number,
    durationSurchargeCredits: Number,
    creditCostPerCandidate: Number,
    candidateCount: Number,
    totalCredits: Number,
    estimatedSpeechCharacters: Number,
    estimatedSpeechUsd: Number,
    estimatedSttUsd: Number,
    estimatedLlmAndPlatformUsd: Number,
    estimatedBackendCostUsdPerCandidate: Number,
    targetProfitUsdPerCandidate: Number,
    voiceSurchargeUsdPerCandidate: Number,
    billableUsdPerCandidate: Number,
    estimatedBackendCostUsd: Number,
    targetProfitUsd: Number,
    voiceSurchargeUsd: Number,
    billableUsdBeforeRounding: Number,
    roundedBillableUsd: Number,
    estimatedUsdValue: Number,
    creditUsdRate: Number,
    creditRateSource: String,
    displayCurrency: String,
    displayCurrencyRate: Number,
    estimatedDisplayValue: Number,
    rateSource: String,
    calculatedAt: Date
  },
  stats: {
    sent: { type: Number, default: 0 },
    opened: { type: Number, default: 0 },
    inProgress: { type: Number, default: 0 },
    completed: { type: Number, default: 0 },
    blocked: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    proctorFailed: { type: Number, default: 0 }
  },
  cancelledAt: Date,
  cancelledBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  cancellationReason: String
}, {
  timestamps: true
});

AIInterviewSchema.index({ organization: 1, createdAt: -1 });
AIInterviewSchema.index({ organization: 1, job: 1, createdAt: -1 });
AIInterviewSchema.index({ status: 1, 'schedule.sendAt': 1 });

module.exports = mongoose.model('AIInterview', AIInterviewSchema);
