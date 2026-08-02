const COURSE_RATING_MIN = 1
const COURSE_RATING_MAX = 5
const COURSE_REVIEW_MODERATION_STATUSES = ['visible', 'hidden']

const toIdString = (value) => {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value._id) return String(value._id)
  return String(value)
}

const clampCourseRating = (value, fallback = 0) => {
  const numeric = Math.round(Number(value))
  if (!Number.isFinite(numeric)) return fallback
  if (numeric < COURSE_RATING_MIN || numeric > COURSE_RATING_MAX) return fallback
  return numeric
}

const sanitizeCourseReviewComment = (value, maxLength = 1200) => (
  String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLength)
)

const sanitizeCourseReviewReply = (value, maxLength = 1500) => (
  String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLength)
)

const sanitizeCourseReviewModerationReason = (value, maxLength = 600) => (
  String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLength)
)

const normalizeCourseReviewModerationStatus = (value, fallback = 'visible') => {
  const normalized = String(value || '').trim().toLowerCase()
  return COURSE_REVIEW_MODERATION_STATUSES.includes(normalized) ? normalized : fallback
}

const buildVisibleCourseReviewFilter = (courseId) => ({
  course: courseId,
  $or: [
    { moderationStatus: 'visible' },
    { moderationStatus: { $exists: false } },
    { moderationStatus: null },
    { moderationStatus: '' }
  ]
})

const buildCourseReviewSummary = (course = {}) => {
  const ratingCount = Math.max(0, Math.round(Number(course?.ratingCount) || 0))
  const commentCount = Math.max(0, Math.round(Number(course?.commentCount) || 0))
  const ratingAverageRaw = ratingCount > 0 ? Number(course?.ratingAverage) || 0 : 0
  const ratingAverage = ratingCount > 0
    ? Math.max(0, Math.min(COURSE_RATING_MAX, Math.round(ratingAverageRaw * 10) / 10))
    : 0
  const roundedStarCount = ratingCount > 0 ? Math.max(0, Math.min(COURSE_RATING_MAX, Math.round(ratingAverage))) : 0

  return {
    ratingAverage,
    ratingAverageLabel: ratingCount > 0 ? ratingAverage.toFixed(1) : '0.0',
    ratingCount,
    commentCount,
    roundedStarCount,
    hasRatings: ratingCount > 0,
    hasComments: commentCount > 0
  }
}

const buildCourseReviewAuthorName = (review = {}) => {
  const explicitName = String(review?.authorName || review?.accountName || '').trim()
  if (explicitName) return explicitName
  const profileName = String(review?.account?.profile?.name || '').trim()
  if (profileName) return profileName
  const email = String(review?.authorEmail || review?.accountEmail || review?.account?.email || '').trim()
  if (email) {
    const [prefix] = email.split('@')
    return prefix || 'Learner'
  }
  return 'Learner'
}

const formatCourseReviewDate = (value) => {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  }).format(date)
}

const mapCourseReviewForDisplay = (review = {}, { viewerId = '' } = {}) => {
  const rating = clampCourseRating(review?.rating, 0)
  const comment = sanitizeCourseReviewComment(review?.comment, 1200)
  const creatorReply = sanitizeCourseReviewReply(review?.creatorReply, 1500)
  const authorName = buildCourseReviewAuthorName(review)
  const accountId = toIdString(review?.account)
  const reviewId = toIdString(review?._id)
  const moderationStatus = normalizeCourseReviewModerationStatus(review?.moderationStatus, 'visible')
  const moderationReason = sanitizeCourseReviewModerationReason(review?.moderationReason, 600)
  const updatedAtLabel = formatCourseReviewDate(review?.updatedAt || review?.createdAt)
  const createdAtLabel = formatCourseReviewDate(review?.createdAt)
  const creatorReplyUpdatedAtLabel = formatCourseReviewDate(review?.creatorReplyUpdatedAt)
  const moderatedAtLabel = formatCourseReviewDate(review?.moderatedAt)
  const creatorReplyByName = String(review?.creatorReplyBy?.profile?.name || review?.creatorReplyBy?.email || '').trim() || 'Course creator'
  const moderatedByName = String(review?.moderatedBy?.profile?.name || review?.moderatedBy?.email || '').trim()

  return {
    ...review,
    _id: reviewId,
    accountId,
    rating,
    comment,
    hasComment: Boolean(comment),
    creatorReply,
    hasCreatorReply: Boolean(creatorReply),
    creatorReplyUpdatedAtLabel,
    creatorReplyByName,
    authorName,
    createdAtLabel,
    updatedAtLabel,
    moderationStatus,
    moderationReason,
    hasModerationReason: Boolean(moderationReason),
    isVisible: moderationStatus === 'visible',
    moderatedAtLabel,
    moderatedByName,
    isEdited: Boolean(review?.isEdited) && Boolean(updatedAtLabel) && updatedAtLabel !== createdAtLabel,
    isOwner: Boolean(viewerId) && accountId === toIdString(viewerId)
  }
}

export {
  buildVisibleCourseReviewFilter,
  COURSE_RATING_MAX,
  COURSE_RATING_MIN,
  COURSE_REVIEW_MODERATION_STATUSES,
  buildCourseReviewAuthorName,
  buildCourseReviewSummary,
  clampCourseRating,
  mapCourseReviewForDisplay,
  normalizeCourseReviewModerationStatus,
  sanitizeCourseReviewComment,
  sanitizeCourseReviewModerationReason,
  sanitizeCourseReviewReply
}
