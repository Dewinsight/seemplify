import mongoose from 'mongoose'

const commissionOverrideByAccountSchema = new mongoose.Schema({
  account: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    required: true
  },
  ratePercent: {
    type: Number,
    min: 0,
    max: 100,
    required: true
  }
}, { _id: false })

const commissionOverrideByCourseSchema = new mongoose.Schema({
  course: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinSimpleLmsCourse',
    required: true
  },
  ratePercent: {
    type: Number,
    min: 0,
    max: 100,
    required: true
  }
}, { _id: false })

const SimpleLmsCommissionSettingSchema = new mongoose.Schema({
  globalRatePercent: {
    type: Number,
    min: 0,
    max: 100,
    default: 70
  },
  accountOverrides: {
    type: [commissionOverrideByAccountSchema],
    default: []
  },
  courseOverrides: {
    type: [commissionOverrideByCourseSchema],
    default: []
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount'
  }
}, {
  timestamps: true
})

SimpleLmsCommissionSettingSchema.pre('save', function(next) {
  const normalizeRate = (value, fallback = 70) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.min(100, Math.max(0, Math.round(parsed * 100) / 100))
  }

  this.globalRatePercent = normalizeRate(this.globalRatePercent, 70)

  const seenAccounts = new Set()
  this.accountOverrides = (Array.isArray(this.accountOverrides) ? this.accountOverrides : [])
    .map((entry) => ({
      account: entry?.account,
      ratePercent: normalizeRate(entry?.ratePercent, this.globalRatePercent)
    }))
    .filter((entry) => {
      const accountId = String(entry.account || '')
      if (!accountId || seenAccounts.has(accountId)) return false
      seenAccounts.add(accountId)
      return true
    })

  const seenCourses = new Set()
  this.courseOverrides = (Array.isArray(this.courseOverrides) ? this.courseOverrides : [])
    .map((entry) => ({
      course: entry?.course,
      ratePercent: normalizeRate(entry?.ratePercent, this.globalRatePercent)
    }))
    .filter((entry) => {
      const courseId = String(entry.course || '')
      if (!courseId || seenCourses.has(courseId)) return false
      seenCourses.add(courseId)
      return true
    })

  next()
})

const SimpleLmsCommissionSetting =
  mongoose.models.AiinSimpleLmsCommissionSetting ||
  mongoose.model('AiinSimpleLmsCommissionSetting', SimpleLmsCommissionSettingSchema)

export { SimpleLmsCommissionSetting }
export default SimpleLmsCommissionSetting
