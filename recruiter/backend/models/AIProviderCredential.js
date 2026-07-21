const mongoose = require('mongoose');

const EncryptedSecretSchema = new mongoose.Schema({
  algorithm: { type: String, enum: ['aes-256-gcm'], required: true },
  keyVersion: { type: String, required: true },
  iv: { type: String, required: true },
  authTag: { type: String, required: true },
  ciphertext: { type: String, required: true }
}, { _id: false });

const AIProviderCredentialSchema = new mongoose.Schema({
  provider: { type: String, enum: ['groq'], required: true, index: true },
  label: { type: String, required: true, trim: true, maxlength: 100 },
  encryptedSecret: { type: EncryptedSecretSchema, required: true, select: false },
  fingerprint: { type: String, required: true, unique: true, index: true },
  lastFour: { type: String, required: true },
  quotaGroup: { type: String, required: true, default: 'groq-primary', index: true },
  projectLabel: { type: String, trim: true, default: '' },
  priority: { type: Number, default: 100, min: 1, max: 10000 },
  enabled: { type: Boolean, default: true, index: true },
  status: {
    type: String,
    enum: ['unknown', 'healthy', 'degraded', 'disabled', 'revoked'],
    default: 'unknown',
    index: true
  },
  blockedModels: [{ type: String }],
  cooldownUntil: Date,
  lastUsedAt: Date,
  lastSuccessAt: Date,
  lastCheckedAt: Date,
  consecutiveFailures: { type: Number, default: 0 },
  lastError: {
    code: String,
    message: String,
    at: Date
  },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  revokedAt: Date
}, { timestamps: true });

AIProviderCredentialSchema.index({ provider: 1, enabled: 1, status: 1, priority: 1 });
AIProviderCredentialSchema.index({ quotaGroup: 1, cooldownUntil: 1 });

module.exports = mongoose.model('AIProviderCredential', AIProviderCredentialSchema);
