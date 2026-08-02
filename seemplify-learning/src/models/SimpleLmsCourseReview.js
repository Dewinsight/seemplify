import mongoose from 'mongoose'
import {
  clampCourseRating,
  normalizeCourseReviewModerationStatus,
  sanitizeCourseReviewComment,
  sanitizeCourseReviewModerationReason,
  sanitizeCourseReviewReply
} from '../utils/courseReviews.js'

const SimpleLmsCourseReviewSchema = new mongoose.Schema({
  course: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinSimpleLmsCourse',
    required: true,
    index: true
  },
  account: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    required: true,
    index: true
  },
  enrollment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinSimpleLmsEnrollment',
    default: null
  },
  authorName: {
    type: String,
    trim: true,
    maxlength: 200,
    default: ''
  },
  authorEmail: {
    type: String,
    trim: true,
    lowercase: true,
    maxlength: 320,
    default: ''
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5
  },
  comment: {
    type: String,
    trim: true,
    maxlength: 1200,
    default: ''
  },
  creatorReply: {
    type: String,
    trim: true,
    maxlength: 1500,
    default: ''
  },
  creatorReplyBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    default: null
  },
  creatorReplyUpdatedAt: {
    type: Date,
    default: null
  },
  moderationStatus: {
    type: String,
    enum: ['visible', 'hidden'],
    default: 'visible'
  },
  moderationReason: {
    type: String,
    trim: true,
    maxlength: 600,
    default: ''
  },
  moderatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    default: null
  },
  moderatedAt: {
    type: Date,
    default: null
  },
  isEdited: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
})

SimpleLmsCourseReviewSchema.index({ course: 1, account: 1 }, { unique: true })
SimpleLmsCourseReviewSchema.index({ course: 1, updatedAt: -1 })
SimpleLmsCourseReviewSchema.index({ course: 1, moderationStatus: 1, updatedAt: -1 })

SimpleLmsCourseReviewSchema.pre('save', function(next) {
  this.authorName = String(this.authorName || '').trim().slice(0, 200)
  this.authorEmail = String(this.authorEmail || '').trim().toLowerCase().slice(0, 320)
  this.comment = sanitizeCourseReviewComment(this.comment, 1200)
  this.creatorReply = sanitizeCourseReviewReply(this.creatorReply, 1500)
  this.moderationReason = sanitizeCourseReviewModerationReason(this.moderationReason, 600)
  this.moderationStatus = normalizeCourseReviewModerationStatus(this.moderationStatus, 'visible')
  this.rating = clampCourseRating(this.rating, 0)

  if (this.rating < 1 || this.rating > 5) {
    return next(new Error('Course rating must be between 1 and 5 stars.'))
  }

  if (!this.isNew && (this.isModified('rating') || this.isModified('comment'))) {
    this.isEdited = true
  }

  return next()
})

const SimpleLmsCourseReview =
  mongoose.models.AiinSimpleLmsCourseReview ||
  mongoose.model('AiinSimpleLmsCourseReview', SimpleLmsCourseReviewSchema)

export { SimpleLmsCourseReview }
export default SimpleLmsCourseReview
