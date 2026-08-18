import crypto from 'crypto'
import fs from 'fs'
import PlatformIntegrationCredential from '../models/PlatformIntegrationCredential.js'

const CLOUDINARY = 'cloudinary'
const AZURE_SPEECH = 'azure-speech'
const AZURE_BLOB = 'azure-blob'
const STORAGE_DEFAULTS = 'storage-defaults'

export const STORAGE_SOLUTIONS = Object.freeze([
  { id: 'identity-provider', label: 'Identity, onboarding & exits' },
  { id: 'recruiter', label: 'Recruiter & candidate files' },
  { id: 'people-transitions', label: 'People Transitions' },
  { id: 'seemplify-learning', label: 'Learning' },
  { id: 'workspace', label: 'Workspace, documents & messaging' },
  { id: 'performance', label: 'Performance management' },
  { id: 'experience-management', label: 'Experience management' },
  { id: 'approver', label: 'Approver logos' }
])

export const STORAGE_SOLUTION_ACCESS = Object.freeze({
  'identity-provider': Object.freeze(['identity-provider']),
  recruiter: Object.freeze(['recruiter', 'people-transitions']),
  'seemplify-learning': Object.freeze(['seemplify-learning']),
  workspace: Object.freeze(['workspace']),
  performance: Object.freeze(['performance']),
  'experience-management': Object.freeze(['experience-management']),
  approver: Object.freeze(['approver'])
})

export function canServiceAccessStorageSolution(service, solution) {
  return STORAGE_SOLUTION_ACCESS[String(service || '').trim().toLowerCase()]?.includes(
    String(solution || '').trim().toLowerCase()
  ) === true
}

const STORAGE_PROVIDERS = new Set([CLOUDINARY, AZURE_BLOB])
const INITIAL_STORAGE_DEFAULTS = Object.freeze({
  'identity-provider': CLOUDINARY,
  recruiter: CLOUDINARY,
  'people-transitions': CLOUDINARY,
  'seemplify-learning': CLOUDINARY,
  workspace: CLOUDINARY,
  performance: AZURE_BLOB,
  'experience-management': AZURE_BLOB,
  approver: AZURE_BLOB
})

function encryptionKey(environment = process.env) {
  const file = String(environment.IDP_PLATFORM_CREDENTIAL_ENCRYPTION_KEY_FILE || '').trim()
  const material = file
    ? fs.readFileSync(file, 'utf8').trim()
    : (environment.NODE_ENV !== 'production'
        ? String(environment.IDP_PLATFORM_CREDENTIAL_ENCRYPTION_KEY || 'idp-platform-credential-development-key-change-me').trim()
        : '')
  if (material.length < 32) throw new Error('IDP platform credential encryption key is not configured.')
  return crypto.createHash('sha256').update(material, 'utf8').digest()
}

export function encryptMediaConfiguration(integration, configuration, environment = process.env) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(environment), iv)
  cipher.setAAD(Buffer.from(`seemplify-platform-integration:${integration}:v1`, 'utf8'))
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(configuration), 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.')
}

export function decryptMediaConfiguration(integration, envelope, environment = process.env) {
  const [version, ivValue, tagValue, ciphertextValue] = String(envelope || '').split('.')
  if (version !== 'v1' || !ivValue || !tagValue || !ciphertextValue) throw new Error(`Stored ${integration} configuration is invalid.`)
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(environment), Buffer.from(ivValue, 'base64url'))
  decipher.setAAD(Buffer.from(`seemplify-platform-integration:${integration}:v1`, 'utf8'))
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'))
  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, 'base64url')),
    decipher.final()
  ]).toString('utf8'))
}

const clean = (value, maximum = 2_000) => String(value || '').trim().slice(0, maximum)

function cloudinaryUrlValue(value) {
  let text = clean(value, 4_000)
  if (text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))) {
    text = text.slice(1, -1).trim()
  }
  return text.replace(/^CLOUDINARY_URL\s*=\s*/iu, '').trim()
}

export function parseCloudinaryEnvironmentVariable(value) {
  const text = cloudinaryUrlValue(value)
  if (!text) return null

  try {
    const parsed = new URL(text)
    if (parsed.protocol !== 'cloudinary:' || !parsed.hostname || !parsed.username || !parsed.password) {
      throw new Error('incomplete Cloudinary URL')
    }
    if (parsed.search || parsed.hash) throw new Error('Cloudinary URL options are not supported')
    return {
      cloudName: parsed.hostname,
      apiKey: decodeURIComponent(parsed.username),
      apiSecret: decodeURIComponent(parsed.password)
    }
  } catch {
    throw new Error('The Cloudinary API environment variable must use CLOUDINARY_URL=cloudinary://API_KEY:API_SECRET@CLOUD_NAME.')
  }
}

export function buildCloudinaryUrl(configuration = {}) {
  const cloudName = clean(configuration.cloudName, 300)
  const apiKey = clean(configuration.apiKey, 500)
  const apiSecret = clean(configuration.apiSecret)
  if (!cloudName || !apiKey || !apiSecret || !/^[a-z0-9_-]+$/iu.test(cloudName)) {
    throw new Error('Cloudinary cloud name, API key, and API secret are required.')
  }
  return `cloudinary://${encodeURIComponent(apiKey)}:${encodeURIComponent(apiSecret)}@${cloudName}`
}

export function buildCloudinaryEnvironmentVariable(configuration = {}) {
  return `CLOUDINARY_URL=${buildCloudinaryUrl(configuration)}`
}

function optionalHttpsUrl(value) {
  const text = clean(value).replace(/\/+$/u, '')
  if (!text) return ''
  const url = new URL(text)
  const localDevelopment = process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !localDevelopment) throw new Error('Service endpoints must use HTTPS.')
  if (url.username || url.password || url.search || url.hash) throw new Error('Service endpoints cannot contain credentials, query strings, or fragments.')
  return url.toString().replace(/\/$/u, '')
}

async function stored(integration) {
  const record = await PlatformIntegrationCredential.findOne({ integration })
  return {
    record,
    configuration: record ? decryptMediaConfiguration(integration, record.encryptedConfiguration) : null
  }
}

async function save(integration, configuration, adminId) {
  const previous = await PlatformIntegrationCredential.findOne({ integration })
  return PlatformIntegrationCredential.findOneAndUpdate(
    { integration },
    {
      $set: {
        encryptedConfiguration: encryptMediaConfiguration(integration, configuration),
        configuredBy: adminId,
        revision: Number(previous?.revision || 0) + 1
      },
      $setOnInsert: { integration }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  )
}

export function normalizeCloudinaryConfiguration(input, existing = null) {
  const fromEnvironmentVariable = parseCloudinaryEnvironmentVariable(input.cloudinaryUrl)
  if (fromEnvironmentVariable) return fromEnvironmentVariable

  const configuration = {
    cloudName: clean(input.cloudName, 300) || existing?.cloudName || '',
    apiKey: clean(input.apiKey, 500) || existing?.apiKey || '',
    apiSecret: clean(input.apiSecret) || existing?.apiSecret || ''
  }
  if (!configuration.cloudName || !configuration.apiKey || !configuration.apiSecret) {
    throw new Error('Cloudinary cloud name, API key, and API secret are required.')
  }
  return configuration
}

export function normalizeAzureSpeechConfiguration(input, existing = null) {
  const configuration = {
    speechKey: clean(input.speechKey) || existing?.speechKey || '',
    region: clean(input.region, 100) || existing?.region || '',
    ttsEndpoint: optionalHttpsUrl(input.ttsEndpoint || existing?.ttsEndpoint || ''),
    language: clean(input.language, 50) || existing?.language || 'en-US',
    voice: clean(input.voice, 200) || existing?.voice || 'en-US-AvaNeural',
    outputFormat: clean(input.outputFormat, 200) || existing?.outputFormat || 'audio-24khz-48kbitrate-mono-mp3'
  }
  if (!configuration.speechKey || !configuration.region) throw new Error('Azure Speech key and region are required.')
  return configuration
}

export function normalizeAzureBlobConfiguration(input, existing = null) {
  const accountName = clean(input.accountName, 80) || existing?.accountName || ''
  const configuration = {
    accountName,
    accountKey: clean(input.accountKey, 4_000) || existing?.accountKey || '',
    containerName: (clean(input.containerName, 63) || existing?.containerName || 'seemplify-files').toLowerCase(),
    endpoint: optionalHttpsUrl(input.endpoint || existing?.endpoint || (accountName ? `https://${accountName}.blob.core.windows.net` : ''))
  }
  if (!/^[a-z0-9]{3,24}$/u.test(configuration.accountName)) throw new Error('Azure Storage account name is invalid.')
  if (!configuration.accountKey) throw new Error('Azure Storage account key is required.')
  if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/u.test(configuration.containerName) || configuration.containerName.includes('--')) {
    throw new Error('Azure Blob container name is invalid.')
  }
  return configuration
}

export function normalizeStorageDefaults(input = {}, existing = null) {
  const source = input.defaults && typeof input.defaults === 'object' ? input.defaults : input
  const defaults = {}
  for (const solution of STORAGE_SOLUTIONS) {
    const value = clean(source[solution.id] || existing?.defaults?.[solution.id] || INITIAL_STORAGE_DEFAULTS[solution.id], 40).toLowerCase()
    if (!STORAGE_PROVIDERS.has(value)) throw new Error(`Unsupported storage provider for ${solution.label}.`)
    defaults[solution.id] = value
  }
  return { defaults }
}

function publicCloudinary(record, configuration) {
  return {
    configured: Boolean(configuration?.cloudName && configuration?.apiKey && configuration?.apiSecret),
    cloudName: configuration?.cloudName || '',
    apiKeyConfigured: Boolean(configuration?.apiKey),
    apiSecretConfigured: Boolean(configuration?.apiSecret),
    apiEnvironmentVariableConfigured: Boolean(configuration?.cloudName && configuration?.apiKey && configuration?.apiSecret),
    revision: Number(record?.revision || 0),
    updatedAt: record?.updatedAt || null
  }
}

function publicAzureSpeech(record, configuration) {
  return {
    configured: Boolean(configuration?.speechKey && configuration?.region),
    speechKeyConfigured: Boolean(configuration?.speechKey),
    region: configuration?.region || '',
    ttsEndpoint: configuration?.ttsEndpoint || '',
    language: configuration?.language || 'en-US',
    voice: configuration?.voice || 'en-US-AvaNeural',
    outputFormat: configuration?.outputFormat || 'audio-24khz-48kbitrate-mono-mp3',
    revision: Number(record?.revision || 0),
    updatedAt: record?.updatedAt || null
  }
}

function publicAzureBlob(record, configuration) {
  return {
    configured: Boolean(configuration?.accountName && configuration?.accountKey && configuration?.containerName),
    accountName: configuration?.accountName || '',
    accountKeyConfigured: Boolean(configuration?.accountKey),
    containerName: configuration?.containerName || 'seemplify-files',
    endpoint: configuration?.endpoint || '',
    revision: Number(record?.revision || 0),
    updatedAt: record?.updatedAt || null
  }
}

function publicStorageDefaults(record, configuration) {
  const normalized = normalizeStorageDefaults({}, configuration)
  return {
    solutions: STORAGE_SOLUTIONS.map((solution) => ({
      ...solution,
      defaultProvider: normalized.defaults[solution.id]
    })),
    revision: Number(record?.revision || 0),
    updatedAt: record?.updatedAt || null
  }
}

export function buildAzureSpeechAdminCredentialReveal(record, configuration) {
  const speechKey = clean(configuration?.speechKey)
  if (!record || !speechKey) throw new Error('Azure Speech key is not configured.')
  return {
    speechKey,
    revision: Number(record.revision || 0),
    updatedAt: record.updatedAt || null
  }
}

export function buildCloudinaryAdminCredentialReveal(record, configuration) {
  if (!record || !configuration?.cloudName || !configuration?.apiKey || !configuration?.apiSecret) {
    throw new Error('Cloudinary credentials are not configured.')
  }
  return {
    cloudinaryUrl: buildCloudinaryEnvironmentVariable(configuration),
    revision: Number(record.revision || 0),
    updatedAt: record.updatedAt || null
  }
}

export function buildAzureBlobAdminCredentialReveal(record, configuration) {
  const accountKey = clean(configuration?.accountKey, 4_000)
  if (!record || !accountKey) throw new Error('Azure Storage account key is not configured.')
  return {
    accountKey,
    revision: Number(record.revision || 0),
    updatedAt: record.updatedAt || null
  }
}

export async function getMediaConfigurationStatus() {
  const [cloudinary, azureSpeech, azureBlob, storageDefaults] = await Promise.all([
    stored(CLOUDINARY), stored(AZURE_SPEECH), stored(AZURE_BLOB), stored(STORAGE_DEFAULTS)
  ])
  return {
    cloudinary: publicCloudinary(cloudinary.record, cloudinary.configuration),
    azureSpeech: publicAzureSpeech(azureSpeech.record, azureSpeech.configuration),
    azureBlob: publicAzureBlob(azureBlob.record, azureBlob.configuration),
    storageDefaults: publicStorageDefaults(storageDefaults.record, storageDefaults.configuration)
  }
}

export async function saveCloudinaryConfiguration(input, adminId) {
  const current = await stored(CLOUDINARY)
  const configuration = normalizeCloudinaryConfiguration(input, current.configuration)
  const record = await save(CLOUDINARY, configuration, adminId)
  applyMediaConfigurationEnvironment({ cloudinary: configuration })
  return publicCloudinary(record, configuration)
}

export async function saveAzureSpeechConfiguration(input, adminId) {
  const current = await stored(AZURE_SPEECH)
  const configuration = normalizeAzureSpeechConfiguration(input, current.configuration)
  const record = await save(AZURE_SPEECH, configuration, adminId)
  applyMediaConfigurationEnvironment({ azureSpeech: configuration })
  return publicAzureSpeech(record, configuration)
}

export async function saveAzureBlobConfiguration(input, adminId) {
  const current = await stored(AZURE_BLOB)
  const configuration = normalizeAzureBlobConfiguration(input, current.configuration)
  const record = await save(AZURE_BLOB, configuration, adminId)
  return publicAzureBlob(record, configuration)
}

export async function saveStorageDefaults(input, adminId) {
  const current = await stored(STORAGE_DEFAULTS)
  const configuration = normalizeStorageDefaults(input, current.configuration)
  const record = await save(STORAGE_DEFAULTS, configuration, adminId)
  return publicStorageDefaults(record, configuration)
}

export async function getAzureSpeechAdminCredentialReveal() {
  const { record, configuration } = await stored(AZURE_SPEECH)
  return buildAzureSpeechAdminCredentialReveal(record, configuration)
}

export async function getCloudinaryAdminCredentialReveal() {
  const { record, configuration } = await stored(CLOUDINARY)
  return buildCloudinaryAdminCredentialReveal(record, configuration)
}

export async function getAzureBlobAdminCredentialReveal() {
  const { record, configuration } = await stored(AZURE_BLOB)
  return buildAzureBlobAdminCredentialReveal(record, configuration)
}

export async function deleteMediaConfiguration(integration) {
  if (![CLOUDINARY, AZURE_SPEECH, AZURE_BLOB].includes(integration)) throw new Error('Unsupported media integration.')
  await PlatformIntegrationCredential.deleteOne({ integration })
}

export async function getMediaRuntimeConfiguration(integration) {
  if (![CLOUDINARY, AZURE_SPEECH].includes(integration)) return { configured: false }
  const { record, configuration } = await stored(integration)
  if (!record || !configuration) return { configured: false }
  const configured = integration === CLOUDINARY
    ? Boolean(configuration.cloudName && configuration.apiKey && configuration.apiSecret)
    : Boolean(configuration.speechKey && configuration.region)
  return configured ? { configured: true, ...configuration, revision: record.revision, updatedAt: record.updatedAt } : { configured: false }
}

export async function getStorageRuntimeConfiguration(solution) {
  const normalizedSolution = clean(solution, 80).toLowerCase()
  if (!STORAGE_SOLUTIONS.some((entry) => entry.id === normalizedSolution)) return { configured: false }
  const [cloudinary, azureBlob, storageDefaults] = await Promise.all([
    stored(CLOUDINARY), stored(AZURE_BLOB), stored(STORAGE_DEFAULTS)
  ])
  const defaults = normalizeStorageDefaults({}, storageDefaults.configuration)
  const defaultProvider = defaults.defaults[normalizedSolution]
  const providers = {
    cloudinary: cloudinary.configuration
      ? { configured: true, ...cloudinary.configuration, revision: cloudinary.record?.revision || 0 }
      : { configured: false },
    azureBlob: azureBlob.configuration
      ? { configured: true, ...azureBlob.configuration, revision: azureBlob.record?.revision || 0 }
      : { configured: false }
  }
  const selected = defaultProvider === AZURE_BLOB ? providers.azureBlob : providers.cloudinary
  return {
    configured: Boolean(selected.configured),
    solution: normalizedSolution,
    defaultProvider,
    providers,
    policyRevision: storageDefaults.record?.revision || 0,
    updatedAt: storageDefaults.record?.updatedAt || null
  }
}

function cloudinaryFromEnvironment(environment) {
  const url = clean(environment.CLOUDINARY_URL, 4_000)
  if (url) {
    try {
      const configuration = parseCloudinaryEnvironmentVariable(url)
      if (configuration) return configuration
    } catch { /* Fall through to the separate variables. */ }
  }
  return {
    cloudName: clean(environment.CLOUDINARY_CLOUD_NAME, 300),
    apiKey: clean(environment.CLOUDINARY_API_KEY, 500),
    apiSecret: clean(environment.CLOUDINARY_API_SECRET)
  }
}

function azureSpeechFromEnvironment(environment) {
  return {
    speechKey: clean(environment.AZURE_SPEECH_KEY || environment.AZURE_VOICELIVE_API_KEY),
    region: clean(environment.AZURE_SPEECH_REGION || environment.AZURE_LOCATION, 100),
    ttsEndpoint: clean(environment.AZURE_SPEECH_TTS_ENDPOINT),
    language: clean(environment.AZURE_AI_INTERVIEW_SPEECH_LANGUAGE || environment.AZURE_SPEECH_LANGUAGE, 50),
    voice: clean(environment.AZURE_AI_INTERVIEW_SPEECH_VOICE || environment.AZURE_SPEECH_VOICE, 200),
    outputFormat: clean(environment.AZURE_SPEECH_OUTPUT_FORMAT, 200)
  }
}

export async function seedMediaConfigurationFromEnvironment(adminId, environment = process.env) {
  const result = { cloudinary: false, azureSpeech: false }
  const cloudinary = cloudinaryFromEnvironment(environment)
  const azureSpeech = azureSpeechFromEnvironment(environment)
  const [cloudinaryExists, azureExists] = await Promise.all([
    PlatformIntegrationCredential.exists({ integration: CLOUDINARY }),
    PlatformIntegrationCredential.exists({ integration: AZURE_SPEECH })
  ])
  if (!cloudinaryExists && cloudinary.cloudName && cloudinary.apiKey && cloudinary.apiSecret) {
    await save(CLOUDINARY, normalizeCloudinaryConfiguration(cloudinary), adminId)
    result.cloudinary = true
  }
  if (!azureExists && azureSpeech.speechKey && azureSpeech.region) {
    await save(AZURE_SPEECH, normalizeAzureSpeechConfiguration(azureSpeech), adminId)
    result.azureSpeech = true
  }
  return result
}

export function applyMediaConfigurationEnvironment({ cloudinary, azureSpeech }, environment = process.env) {
  if (cloudinary?.cloudName && cloudinary?.apiKey && cloudinary?.apiSecret) {
    environment.CLOUDINARY_CLOUD_NAME = cloudinary.cloudName
    environment.CLOUDINARY_API_KEY = cloudinary.apiKey
    environment.CLOUDINARY_API_SECRET = cloudinary.apiSecret
    environment.CLOUDINARY_URL = buildCloudinaryUrl(cloudinary)
  }
  if (azureSpeech?.speechKey && azureSpeech?.region) {
    environment.AZURE_SPEECH_KEY = azureSpeech.speechKey
    environment.AZURE_SPEECH_REGION = azureSpeech.region
    if (azureSpeech.ttsEndpoint) environment.AZURE_SPEECH_TTS_ENDPOINT = azureSpeech.ttsEndpoint
    if (azureSpeech.language) environment.AZURE_SPEECH_LANGUAGE = azureSpeech.language
    if (azureSpeech.voice) environment.AZURE_SPEECH_VOICE = azureSpeech.voice
    if (azureSpeech.outputFormat) environment.AZURE_SPEECH_OUTPUT_FORMAT = azureSpeech.outputFormat
  }
}

export async function hydrateMediaConfigurationEnvironment(environment = process.env) {
  const [cloudinary, azureSpeech] = await Promise.all([stored(CLOUDINARY), stored(AZURE_SPEECH)])
  applyMediaConfigurationEnvironment({ cloudinary: cloudinary.configuration, azureSpeech: azureSpeech.configuration }, environment)
  return { cloudinary: Boolean(cloudinary.configuration), azureSpeech: Boolean(azureSpeech.configuration) }
}
