import mongoose from 'mongoose'

const platformIntegrationCredentialSchema = new mongoose.Schema({
  integration: { type: String, required: true, unique: true, maxlength: 80 },
  encryptedConfiguration: { type: String, required: true, maxlength: 32_000 },
  configuredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  revision: { type: Number, required: true, default: 1, min: 1 },
  lastValidatedAt: { type: Date, default: null }
}, {
  timestamps: true,
  versionKey: false,
  collection: 'aiin_platform_integration_credentials'
})

const PlatformIntegrationCredential = mongoose.models.AiinPlatformIntegrationCredential
  || mongoose.model('AiinPlatformIntegrationCredential', platformIntegrationCredentialSchema)

export default PlatformIntegrationCredential
