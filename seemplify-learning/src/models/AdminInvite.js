import mongoose from 'mongoose'

const ADMIN_INVITE_ROLES = Object.freeze(['admin', 'super_admin'])
const ADMIN_INVITE_STATUSES = Object.freeze(['pending', 'registered', 'accepted', 'expired', 'revoked'])

const AdminInviteSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    maxlength: 320,
    index: true
  },
  invitedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    required: true,
    index: true
  },
  requestedRole: {
    type: String,
    enum: ADMIN_INVITE_ROLES,
    required: true,
    index: true
  },
  token: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  status: {
    type: String,
    enum: ADMIN_INVITE_STATUSES,
    default: 'pending',
    index: true
  },
  expiresAt: {
    type: Date,
    required: true
  },
  registeredAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    default: null
  },
  registeredAt: Date,
  acceptedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    default: null
  },
  acceptedAt: Date,
  otpHash: {
    type: String,
    trim: true,
    default: ''
  },
  otpExpiresAt: Date,
  otpSentAt: Date,
  verificationAttempts: {
    type: Number,
    default: 0,
    min: 0
  },
  notes: {
    type: String,
    trim: true,
    maxlength: 1200,
    default: ''
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true,
  collection: 'aiin_admin_invites'
})

AdminInviteSchema.index({ email: 1, status: 1, createdAt: -1 })
AdminInviteSchema.index({ invitedBy: 1, createdAt: -1 })
AdminInviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 14 * 24 * 60 * 60 })

export const AdminInvite =
  mongoose.models.AiinAdminInvite ||
  mongoose.model('AiinAdminInvite', AdminInviteSchema)

export default AdminInvite
