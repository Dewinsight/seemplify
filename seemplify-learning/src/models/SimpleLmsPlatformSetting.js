import mongoose from 'mongoose'

const EncryptedCredentialSchema = new mongoose.Schema({
  ciphertext: {
    type: String,
    trim: true,
    default: ''
  },
  iv: {
    type: String,
    trim: true,
    default: ''
  },
  authTag: {
    type: String,
    trim: true,
    default: ''
  },
  lastFour: {
    type: String,
    trim: true,
    maxlength: 4,
    default: ''
  },
  updatedAt: {
    type: Date,
    default: null
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    default: null
  }
}, { _id: false })

const SimpleLmsPlatformSettingSchema = new mongoose.Schema({
  defaultCurrency: {
    type: String,
    trim: true,
    uppercase: true,
    maxlength: 3,
    default: 'NGN'
  },
  defaultPaymentMode: {
    type: String,
    enum: ['free', 'paid'],
    default: 'free'
  },
  defaultCourseVisibility: {
    type: String,
    enum: ['private', 'public', 'marketplace'],
    default: 'private'
  },
  defaultCourseStatus: {
    type: String,
    enum: ['draft', 'published'],
    default: 'draft'
  },
  requirePublicReviewForCreators: {
    type: Boolean,
    default: true
  },
  allowExternalMediaEmbeds: {
    type: Boolean,
    default: true
  },
  allowAudioLessons: {
    type: Boolean,
    default: true
  },
  minCoursePriceMinor: {
    type: Number,
    min: 0,
    default: 0
  },
  maxCoursePriceMinor: {
    type: Number,
    min: 0,
    default: 50000000
  },
  analyticsLookbackDays: {
    type: Number,
    min: 7,
    max: 365,
    default: 30
  },
  cartExpiryDays: {
    type: Number,
    min: 1,
    max: 365,
    default: 30
  },
  featuredRefreshHours: {
    type: Number,
    min: 1,
    max: 168,
    default: 24
  },
  maxChaptersPerCourse: {
    type: Number,
    min: 1,
    max: 100,
    default: 25
  },
  maxLessonsPerChapter: {
    type: Number,
    min: 1,
    max: 200,
    default: 60
  },
  allowCourseComments: {
    type: Boolean,
    default: true
  },
  requireCourseThumbnail: {
    type: Boolean,
    default: false
  },
  enableWishlist: {
    type: Boolean,
    default: true
  },
  autoApproveSystemCourses: {
    type: Boolean,
    default: true
  },
  homepageFeaturedCourseLimit: {
    type: Number,
    min: 1,
    max: 24,
    default: 8
  },
  maintenanceMode: {
    type: Boolean,
    default: false
  },
  maintenanceMessage: {
    type: String,
    trim: true,
    maxlength: 500,
    default: ''
  },
  creatorSubmissionGuidelines: {
    type: String,
    trim: true,
    maxlength: 3000,
    default: ''
  },
  paymentGateways: {
    flutterwave: {
      enabled: {
        type: Boolean,
        default: true
      },
      secretKey: {
        type: EncryptedCredentialSchema,
        default: () => ({})
      },
      publicKey: {
        type: EncryptedCredentialSchema,
        default: () => ({})
      },
      webhookHash: {
        type: EncryptedCredentialSchema,
        default: () => ({})
      }
    },
    paystack: {
      enabled: {
        type: Boolean,
        default: false
      },
      secretKey: {
        type: EncryptedCredentialSchema,
        default: () => ({})
      },
      publicKey: {
        type: EncryptedCredentialSchema,
        default: () => ({})
      }
    },
    defaultProvider: {
      type: String,
      enum: ['flutterwave', 'paystack'],
      default: 'flutterwave'
    }
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    default: null
  }
}, {
  timestamps: true
})

const SimpleLmsPlatformSetting =
  mongoose.models.AiinSimpleLmsPlatformSetting ||
  mongoose.model('AiinSimpleLmsPlatformSetting', SimpleLmsPlatformSettingSchema)

export { SimpleLmsPlatformSetting }
export default SimpleLmsPlatformSetting
