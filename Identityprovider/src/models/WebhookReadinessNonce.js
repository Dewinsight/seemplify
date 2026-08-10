import mongoose from 'mongoose'

const { Schema } = mongoose

// A unique, expiring replay claim shared by every IdP replica. The readiness
// endpoint is deployment infrastructure, so it must fail closed when Mongo
// cannot provide an atomic cross-process claim.
const webhookReadinessNonceSchema = new Schema({
  key: {
    type: String,
    required: true,
    maxlength: 180
  },
  expiresAt: {
    type: Date,
    required: true
  }
}, {
  timestamps: true,
  versionKey: false,
  // This index is a security boundary, not an optional query optimization.
  // Override a connection-wide production autoIndex=false so Model.init()
  // cannot resolve before the unique replay constraint exists.
  autoIndex: true,
  collection: 'aiin_webhook_readiness_nonces'
})

webhookReadinessNonceSchema.index({ key: 1 }, { unique: true })
webhookReadinessNonceSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

const WebhookReadinessNonce = mongoose.models.AiinWebhookReadinessNonce
  || mongoose.model('AiinWebhookReadinessNonce', webhookReadinessNonceSchema)

export default WebhookReadinessNonce
