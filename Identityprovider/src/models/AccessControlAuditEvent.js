import mongoose from 'mongoose'

const AccessControlAuditEventSchema = new mongoose.Schema({
  scope: { type: String, enum: ['global', 'organization'], required: true, index: true },
  organization: { type: mongoose.Schema.Types.ObjectId, ref: 'AiinOrganization', default: null, index: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'AiinAccount', required: true },
  actorEmail: { type: String, required: true, trim: true, lowercase: true },
  action: { type: String, required: true, trim: true },
  targetType: { type: String, required: true, trim: true },
  targetKey: { type: String, required: true, trim: true },
  summary: { type: String, required: true, trim: true, maxLength: 500 },
  revision: { type: Number, required: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now, index: true }
})

AccessControlAuditEventSchema.index({ organization: 1, createdAt: -1 })
AccessControlAuditEventSchema.index({ scope: 1, createdAt: -1 })

export const AccessControlAuditEvent = mongoose.model('AiinAccessControlAuditEvent', AccessControlAuditEventSchema)
