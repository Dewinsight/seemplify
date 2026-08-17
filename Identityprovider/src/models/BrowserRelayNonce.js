import mongoose from 'mongoose'

const BrowserRelayNonceSchema = new mongoose.Schema({
  keyId: { type: String, required: true, maxlength: 120 },
  nonce: { type: String, required: true, maxlength: 200 },
  expiresAt: { type: Date, required: true }
}, { timestamps: true })

BrowserRelayNonceSchema.index({ keyId: 1, nonce: 1 }, { unique: true })
BrowserRelayNonceSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export default mongoose.model('BrowserRelayNonce', BrowserRelayNonceSchema)
