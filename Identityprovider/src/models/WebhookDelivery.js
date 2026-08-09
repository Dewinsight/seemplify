import mongoose from 'mongoose'

const WebhookDeliverySchema = new mongoose.Schema({
  eventId: { type: String, required: true, index: true },
  event: { type: String, required: true, index: true },
  endpointName: { type: String, required: true },
  endpointUrl: { type: String, required: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  signature: { type: String, required: true },
  status: { type: String, enum: ['pending', 'delivering', 'delivered', 'failed', 'dead'], default: 'pending', index: true },
  attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 10 },
  nextAttemptAt: { type: Date, default: Date.now, index: true },
  leaseUntil: Date,
  responseStatus: Number,
  lastError: String,
  deliveredAt: Date,
}, { timestamps: true })

WebhookDeliverySchema.index({ eventId: 1, endpointName: 1 }, { unique: true })
WebhookDeliverySchema.index({ status: 1, nextAttemptAt: 1, leaseUntil: 1 })

export const WebhookDelivery = mongoose.model('AiinWebhookDelivery', WebhookDeliverySchema)
