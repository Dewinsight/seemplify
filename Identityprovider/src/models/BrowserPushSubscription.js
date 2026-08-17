import mongoose from 'mongoose'

const BrowserPushSubscriptionSchema = new mongoose.Schema({
  idpSubject: { type: String, required: true, index: true, maxlength: 200 },
  organizationId: { type: String, default: null, index: true, maxlength: 160 },
  appId: { type: String, required: true, maxlength: 80 },
  deviceId: { type: String, required: true, maxlength: 160 },
  endpoint: { type: String, required: true, unique: true, maxlength: 2048 },
  expirationTime: { type: Date, default: null },
  keys: {
    p256dh: { type: String, required: true, maxlength: 200 },
    auth: { type: String, required: true, maxlength: 100 }
  },
  userAgentHash: { type: String, default: '', maxlength: 128 },
  lastConfirmedAt: { type: Date, default: Date.now },
  lastDeliveredAt: { type: Date, default: null },
  failureCount: { type: Number, default: 0, min: 0, max: 1000 }
}, { timestamps: true })

BrowserPushSubscriptionSchema.index(
  { idpSubject: 1, appId: 1, deviceId: 1 },
  { unique: true }
)
BrowserPushSubscriptionSchema.index({ expirationTime: 1 }, { expireAfterSeconds: 0 })

export default mongoose.model('BrowserPushSubscription', BrowserPushSubscriptionSchema)
