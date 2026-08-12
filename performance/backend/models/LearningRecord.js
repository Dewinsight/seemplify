const mongoose = require('mongoose');

const LearningRecordSchema = new mongoose.Schema({
  organizationId: {
    type: String,
    required: true,
    index: true
  },
  subjectId: {
    type: String,
    required: true,
    index: true
  },
  performanceUserId: {
    type: String,
    default: '',
    index: true
  },
  learningAccountId: String,
  learnerEmail: {
    type: String,
    lowercase: true,
    trim: true
  },
  learnerName: String,
  enrollmentId: {
    type: String,
    required: true
  },
  courseId: {
    type: String,
    required: true
  },
  courseTitle: {
    type: String,
    required: true
  },
  courseUrl: String,
  courseCategory: String,
  courseLevel: String,
  courseTags: {
    type: [String],
    default: []
  },
  lessonCount: {
    type: Number,
    default: 0,
    min: 0
  },
  completedLessonCount: {
    type: Number,
    default: 0,
    min: 0
  },
  status: {
    type: String,
    enum: ['assigned', 'in_progress', 'completed'],
    default: 'assigned',
    index: true
  },
  progressPercent: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  latestQuizScore: {
    type: Number,
    default: 0,
    min: 0
  },
  assignmentType: String,
  assignmentSource: String,
  assignedAt: Date,
  dueAt: Date,
  startedAt: Date,
  completedAt: Date,
  lastActivityAt: Date,
  sourceUpdatedAt: Date,
  lastEventId: String,
  source: {
    type: String,
    enum: ['seemplify_learning'],
    default: 'seemplify_learning'
  }
}, { timestamps: true });

LearningRecordSchema.index({ organizationId: 1, enrollmentId: 1 }, { unique: true });
LearningRecordSchema.index({ organizationId: 1, subjectId: 1, updatedAt: -1 });
LearningRecordSchema.index({ organizationId: 1, performanceUserId: 1, updatedAt: -1 });
LearningRecordSchema.index({ organizationId: 1, status: 1, dueAt: 1 });

module.exports = mongoose.models.LearningRecord
  || mongoose.model('LearningRecord', LearningRecordSchema);
