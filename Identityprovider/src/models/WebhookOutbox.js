import mongoose from 'mongoose'

const webhookDeliverySchema = new mongoose.Schema({
  name: { type: String, required: true },
  url: { type: String, required: true },
  status: { type: String, enum: ['pending', 'delivered', 'dead'], default: 'pending' },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now },
  deliveredAt: { type: Date, default: null },
  lastError: { type: String, default: '' }
}, { _id: false })

const webhookOutboxSchema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true, index: true },
  event: { type: String, required: true, index: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  // Delivery is tracked independently for every consumer. A transient outage
  // in one app must not replay an already-delivered invalidation to every
  // other app after its user has reauthenticated.
  deliveries: { type: [webhookDeliverySchema], default: [] },
  status: { type: String, enum: ['pending', 'processing', 'delivered', 'dead'], default: 'pending', index: true },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now, index: true },
  leaseExpiresAt: { type: Date, default: null, index: true },
  deliveredAt: { type: Date, default: null },
  lastError: { type: String, default: '' },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 30 * 24 * 60 * 60_000), index: { expires: 0 } }
}, { timestamps: true })

export default mongoose.models.WebhookOutbox || mongoose.model('WebhookOutbox', webhookOutboxSchema)
