import crypto from 'crypto'
import fs from 'fs'
import PlatformIntegrationCredential from '../models/PlatformIntegrationCredential.js'

const INTEGRATION = 'nylas'
const DEFAULT_API_URI = 'https://api.us.nylas.com'
const DEFAULT_SCOPES = [
  'openid',
  'profile',
  'offline_access',
  'User.Read',
  'Mail.Read',
  'Mail.ReadWrite',
  'Mail.Send',
  'Calendars.Read',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.readonly'
]

function encryptionKey(environment = process.env) {
  const file = String(environment.IDP_PLATFORM_CREDENTIAL_ENCRYPTION_KEY_FILE || '').trim()
  let material = ''
  if (file) material = fs.readFileSync(file, 'utf8').trim()
  else if (environment.NODE_ENV !== 'production') {
    material = String(environment.IDP_PLATFORM_CREDENTIAL_ENCRYPTION_KEY || 'idp-platform-credential-development-key-change-me').trim()
  }
  if (material.length < 32) throw new Error('IDP platform credential encryption key is not configured.')
  return crypto.createHash('sha256').update(material, 'utf8').digest()
}

export function encryptPlatformConfiguration(configuration, environment = process.env) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(environment), iv)
  cipher.setAAD(Buffer.from(`seemplify-platform-integration:${INTEGRATION}:v1`, 'utf8'))
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(configuration), 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.')
}

export function decryptPlatformConfiguration(envelope, environment = process.env) {
  const [version, ivValue, tagValue, ciphertextValue] = String(envelope || '').split('.')
  if (version !== 'v1' || !ivValue || !tagValue || !ciphertextValue) throw new Error('Stored Nylas configuration is invalid.')
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(environment), Buffer.from(ivValue, 'base64url'))
  decipher.setAAD(Buffer.from(`seemplify-platform-integration:${INTEGRATION}:v1`, 'utf8'))
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'))
  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, 'base64url')),
    decipher.final()
  ]).toString('utf8'))
}

function cleanText(value, maximum) {
  return String(value || '').trim().slice(0, maximum)
}

function normalizeHttpsUrl(value, fallback = '') {
  const text = cleanText(value || fallback, 2_000).replace(/\/+$/, '')
  if (!text) return ''
  const url = new URL(text)
  const localDevelopment = process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !localDevelopment) throw new Error('Nylas URLs must use HTTPS.')
  if (url.username || url.password || url.search || url.hash) throw new Error('Nylas URLs cannot contain credentials, query strings, or fragments.')
  return url.toString().replace(/\/$/, '')
}

function normalizeScopes(value) {
  const items = Array.isArray(value) ? value : String(value || '').split(/[\s,]+/u)
  return [...new Set(items.map(item => cleanText(item, 300)).filter(Boolean))].slice(0, 40)
}

export function normalizeNylasConfiguration(input, existing = null) {
  const clientId = cleanText(input.clientId, 500) || existing?.clientId || ''
  const apiKey = cleanText(input.apiKey, 2_000) || existing?.apiKey || ''
  if (!clientId || !apiKey) throw new Error('Nylas client ID and API key are required.')
  return {
    clientId,
    apiKey,
    apiUri: normalizeHttpsUrl(input.apiUri, existing?.apiUri || DEFAULT_API_URI),
    redirectUri: normalizeHttpsUrl(input.redirectUri, existing?.redirectUri || ''),
    connectScopes: normalizeScopes(input.connectScopes).length
      ? normalizeScopes(input.connectScopes)
      : (existing?.connectScopes?.length ? existing.connectScopes : DEFAULT_SCOPES),
    webhookSecret: cleanText(input.webhookSecret, 2_000) || existing?.webhookSecret || ''
  }
}

export function publicNylasConfiguration(record, configuration = null) {
  return {
    configured: Boolean(configuration?.clientId && configuration?.apiKey),
    clientIdConfigured: Boolean(configuration?.clientId),
    apiKeyConfigured: Boolean(configuration?.apiKey),
    webhookSecretConfigured: Boolean(configuration?.webhookSecret),
    apiUri: configuration?.apiUri || DEFAULT_API_URI,
    redirectUri: configuration?.redirectUri || '',
    connectScopes: configuration?.connectScopes || DEFAULT_SCOPES,
    revision: Number(record?.revision || 0),
    updatedAt: record?.updatedAt || null
  }
}

export async function getStoredNylasConfiguration() {
  const record = await PlatformIntegrationCredential.findOne({ integration: INTEGRATION })
  if (!record) return { record: null, configuration: null }
  return { record, configuration: decryptPlatformConfiguration(record.encryptedConfiguration) }
}

export async function getNylasConfigurationStatus() {
  const { record, configuration } = await getStoredNylasConfiguration()
  return publicNylasConfiguration(record, configuration)
}

export async function saveNylasConfiguration(input, adminId) {
  const { record, configuration } = await getStoredNylasConfiguration()
  const normalized = normalizeNylasConfiguration(input, configuration)
  const encryptedConfiguration = encryptPlatformConfiguration(normalized)
  const next = await PlatformIntegrationCredential.findOneAndUpdate(
    { integration: INTEGRATION },
    {
      $set: {
        encryptedConfiguration,
        configuredBy: adminId,
        revision: Number(record?.revision || 0) + 1
      },
      $setOnInsert: { integration: INTEGRATION }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  )
  return publicNylasConfiguration(next, normalized)
}

export async function deleteNylasConfiguration() {
  await PlatformIntegrationCredential.deleteOne({ integration: INTEGRATION })
}

export async function getNylasRuntimeConfiguration() {
  const { record, configuration } = await getStoredNylasConfiguration()
  if (!record || !configuration?.clientId || !configuration?.apiKey) return { configured: false }
  return { configured: true, ...configuration, revision: record.revision, updatedAt: record.updatedAt }
}
