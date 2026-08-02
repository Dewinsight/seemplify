import mongoose from 'mongoose'

const SimpleLmsPermissionSchema = new mongoose.Schema({
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinOrganization',
    required: false,
    default: null,
    index: true
  },
  account: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    required: true,
    index: true
  },
  canPublishWithoutReview: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  grantedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount'
  },
  grantedAt: Date,
  revokedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount'
  },
  revokedAt: Date,
  notes: {
    type: String,
    trim: true,
    maxlength: 2000
  }
}, {
  timestamps: true
})

SimpleLmsPermissionSchema.index(
  { organization: 1, account: 1 },
  { unique: true }
)
SimpleLmsPermissionSchema.index({ organization: 1, canPublishWithoutReview: 1, isActive: 1 })

SimpleLmsPermissionSchema.statics.hasPublishWithoutReview = async function({ organizationId, accountId }) {
  if (!organizationId || !accountId) {
    return false
  }

  const permission = await this.findOne({
    organization: organizationId,
    account: accountId,
    canPublishWithoutReview: true,
    isActive: true
  }).select('_id').lean()

  return Boolean(permission)
}

const SimpleLmsPermission =
  mongoose.models.AiinSimpleLmsPermission ||
  mongoose.model('AiinSimpleLmsPermission', SimpleLmsPermissionSchema)

export { SimpleLmsPermission }
export default SimpleLmsPermission
