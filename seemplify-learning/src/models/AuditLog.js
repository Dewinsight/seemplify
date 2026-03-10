import mongoose from 'mongoose'

const AUDIT_ACTIONS = Object.freeze([
  'super_user.create',
  'super_user.promote',
  'super_user.demote',
  'super_user.delete',
  'role.change',
  'partner.create',
  'partner.activate',
  'partner.suspend',
  'agent.invite',
  'agent.add',
  'agent.remove',
  'agent.commission_rate_update',
  'course.partner_publish',
  'course.partner_approve',
  'course.partner_reject',
  'approval.request.create',
  'approval.request.approve',
  'approval.request.reject',
  'security.password_reset_requested',
  'security.password_reset_completed',
  'payment.gateway.provider_toggled',
  'payment.gateway.default_changed',
  'payment.gateway.credential_updated',
  'payment.gateway.reauth_failed',
  'payment.gateway.reauth_blocked',
  'partner.withdrawal.request',
  'partner.withdrawal.cancel',
  'partner.withdrawal.approve',
  'partner.withdrawal.reject',
  'partner.withdrawal.paid',
  'reports.export'
])

const AuditLogSchema = new mongoose.Schema({
  action: {
    type: String,
    required: true,
    enum: AUDIT_ACTIONS,
    index: true
  },
  performedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    required: true,
    index: true
  },
  targetAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinAccount',
    default: null
  },
  targetOrganization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiinOrganization',
    default: null
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  ipAddress: {
    type: String,
    trim: true,
    maxlength: 45,
    default: ''
  },
  userAgent: {
    type: String,
    trim: true,
    maxlength: 500,
    default: ''
  }
}, {
  timestamps: true,
  collection: 'aiin_audit_logs'
})

AuditLogSchema.index({ createdAt: -1 })
AuditLogSchema.index({ action: 1, createdAt: -1 })
AuditLogSchema.index({ performedBy: 1, createdAt: -1 })
AuditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 730 * 24 * 60 * 60 })

const appendOnlyOperations = ['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete']
for (const operation of appendOnlyOperations) {
  AuditLogSchema.pre(operation, function(next) {
    next(new Error('Audit logs are append-only.'))
  })
}

export const AuditLog = mongoose.models.AiinAuditLog || mongoose.model('AiinAuditLog', AuditLogSchema)

export default AuditLog
