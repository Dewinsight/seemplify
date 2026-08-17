import mongoose from 'mongoose'

const BrowserNotificationEventSchema = new mongoose.Schema({
  idpSubject: { type: String, required: true, index: true, maxlength: 200 },
  organizationId: { type: String, default: null, index: true, maxlength: 160 },
  eventId: { type: String, required: true, maxlength: 200 },
  kind: { type: String, required: true, maxlength: 80 },
  title: { type: String, default: '', maxlength: 120 },
  body: { type: String, default: '', maxlength: 240 },
  deepLink: { type: String, default: '/messaging', maxlength: 500 },
  callId: { type: String, default: null, maxlength: 200 },
  occurredAt: { type: Date, required: true },
  expiresAt: { type: Date, default: null },
  silent: { type: Boolean, default: false },
  purgeAt: { type: Date, default: () => new Date(Date.now() + 24 * 60 * 60 * 1000) }
}, { timestamps: true })

BrowserNotificationEventSchema.index({ idpSubject: 1, eventId: 1 }, { unique: true })
BrowserNotificationEventSchema.index({ idpSubject: 1, occurredAt: -1 })
BrowserNotificationEventSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 })

export default mongoose.model('BrowserNotificationEvent', BrowserNotificationEventSchema)
