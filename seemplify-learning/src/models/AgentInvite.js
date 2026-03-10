import mongoose from 'mongoose'

const AgentInviteSchema = new mongoose.Schema({
  partnerOrganization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinOrganization',
    required: true,
    index: true
  },
  invitedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    required: true,
    index: true
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    maxlength: 320,
    index: true
  },
  token: {
    type: String,
    required: true,
    trim: true,
    unique: true,
    index: true
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'expired', 'revoked'],
    default: 'pending',
    index: true
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true
  },
  acceptedAt: Date,
  acceptedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    default: null
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true,
  collection: 'aiin_agent_invites'
})

AgentInviteSchema.index({ partnerOrganization: 1, status: 1, createdAt: -1 })
AgentInviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 })

AgentInviteSchema.pre('save', function(next) {
  if (this.status === 'pending' && this.expiresAt && this.expiresAt.getTime() <= Date.now()) {
    this.status = 'expired'
  }
  next()
})

export const AgentInvite = mongoose.models.AiinAgentInvite || mongoose.model('AiinAgentInvite', AgentInviteSchema)

export default AgentInvite
