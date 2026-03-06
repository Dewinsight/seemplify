import mongoose from 'mongoose'

const SimpleLmsCurrencySchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    minlength: 3,
    maxlength: 3
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 120
  },
  symbol: {
    type: String,
    trim: true,
    maxlength: 16,
    default: ''
  },
  decimals: {
    type: Number,
    min: 0,
    max: 4,
    default: 2
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  isDefault: {
    type: Boolean,
    default: false,
    index: true
  },
  sortOrder: {
    type: Number,
    default: 100
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    default: null
  }
}, {
  timestamps: true
})

SimpleLmsCurrencySchema.index({ code: 1 }, { unique: true })

SimpleLmsCurrencySchema.pre('validate', function normalizeCode(next) {
  this.code = String(this.code || '').trim().toUpperCase().slice(0, 3)
  next()
})

const SimpleLmsCurrency =
  mongoose.models.AiinSimpleLmsCurrency ||
  mongoose.model('AiinSimpleLmsCurrency', SimpleLmsCurrencySchema)

export { SimpleLmsCurrency }
export default SimpleLmsCurrency
