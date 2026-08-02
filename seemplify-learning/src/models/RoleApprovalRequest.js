import mongoose from 'mongoose'
import { LEARNING_ROLES } from '../utils/learningRoles.js'

const RoleApprovalRequestSchema = new mongoose.Schema({
  account: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    required: true,
    index: true
  },
  requestType: {
    type: String,
    enum: ['partner_role_activation'],
    default: 'partner_role_activation',
    index: true
  },
  registrationIntent: {
    type: String,
    enum: ['partner', 'channel_partner'],
    required: true,
    index: true
  },
  requestedRole: {
    type: String,
    enum: LEARNING_ROLES,
    required: true,
    index: true
  },
  partnerType: {
    type: String,
    enum: ['channel_partner', 'partner'],
    required: true,
    index: true
  },
  organizationName: {
    type: String,
    trim: true,
    maxlength: 160,
    default: ''
  },
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinOrganization',
    default: null
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'cancelled'],
    default: 'pending',
    index: true
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    default: null
  },
  reviewedAt: Date,
  reviewNotes: {
    type: String,
    trim: true,
    maxlength: 3000,
    default: ''
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true,
  collection: 'aiin_role_approval_requests'
})

RoleApprovalRequestSchema.index({ status: 1, createdAt: -1 })
RoleApprovalRequestSchema.index({ account: 1, status: 1, createdAt: -1 })

export const RoleApprovalRequest =
  mongoose.models.AiinRoleApprovalRequest ||
  mongoose.model('AiinRoleApprovalRequest', RoleApprovalRequestSchema)

export default RoleApprovalRequest
