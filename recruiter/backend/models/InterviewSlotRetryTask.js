const mongoose = require('mongoose');

const retryTaskSchema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
    index: true
  },
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true
  },
  interviewerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  reportEmail: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  provider: {
    type: String,
    default: 'google'
  },
  sharedMeetingLink: {
    type: String,
    default: null
  },
  slot: {
    candidateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Candidate', required: true },
    candidateName: { type: String, required: true },
    candidateEmail: { type: String, required: true },
    jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: false },
    stageId: { type: mongoose.Schema.Types.ObjectId, ref: 'InterviewStage', required: false },
    jobTitle: { type: String, required: false },
    startTime: { type: Date, required: true },
    endTime: { type: Date, required: true },
    duration: { type: Number, required: true },
    notes: { type: String, required: false },
    order: { type: Number, required: true }
  },
  sessionContext: {
    baseStartTime: Date,
    sessionEndTime: Date,
    totalDuration: Number,
    interviewType: String,
    location: String,
    subject: String,
    organizationName: String,
    addNotetaker: { type: Boolean, default: false },
    additionalInterviewers: { type: Array, default: [] },
    bccParticipants: { type: Array, default: [] },
    ccParticipants: { type: Array, default: [] },
    sendCustomEmail: { type: Boolean, default: false },
    emailTemplate: { type: String, default: null },
    sendQuestionsToInterviewers: { type: Boolean, default: false },
    questionsSendTime: { type: Number, default: 60 },
    selectedQuestionIds: { type: Array, default: [] },
    timezone: { type: String, default: 'UTC' }
  },
  attemptsMade: {
    type: Number,
    default: 0
  },
  maxAttempts: {
    type: Number,
    default: 2
  },
  nextAttemptAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  lastAttemptAt: Date,
  completedAt: Date,
  lastError: String,
  status: {
    type: String,
    enum: ['queued', 'processing', 'completed', 'failed'],
    default: 'queued',
    index: true
  },
  createdInterviewId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Interview',
    default: null
  },
  createdEventId: {
    type: String,
    default: null
  },
  finalStatusEmailSent: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

retryTaskSchema.index({ status: 1, nextAttemptAt: 1 });
retryTaskSchema.index({ sessionId: 1, status: 1 });

module.exports = mongoose.model('InterviewSlotRetryTask', retryTaskSchema);
