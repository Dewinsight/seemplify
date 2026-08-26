import dotenv from 'dotenv'
import crypto from 'crypto'
import { BlobSASPermissions, BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob'
import { v2 as cloudinary } from 'cloudinary'
import { existsSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { getStorageRuntimeConfiguration } from './mediaPlatformConfigurationService.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ENV_PATH_CANDIDATES = [
  resolve(__dirname, '../../.env'),
  resolve(__dirname, '../../../.env'),
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), 'Identityprovider/.env')
]

const normalizeEnvValue = (value) => {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

const firstNonEmpty = (...values) => {
  for (const value of values) {
    const normalized = normalizeEnvValue(value)
    if (normalized) return normalized
  }
  return ''
}

const parseEnvFile = (envPath) => {
  try {
    const raw = readFileSync(envPath, 'utf8')
    return dotenv.parse(raw)
  } catch {
    return {}
  }
}

const readCloudinaryEnvFromFiles = () => {
  // Prefer the first non-empty value found in known .env locations.
  const fileValues = {
    cloudinaryUrl: '',
    cloudName: '',
    apiKey: '',
    apiSecret: ''
  }

  for (const envPath of ENV_PATH_CANDIDATES) {
    if (!existsSync(envPath)) continue
    const parsed = parseEnvFile(envPath)

    fileValues.cloudinaryUrl = firstNonEmpty(
      fileValues.cloudinaryUrl,
      parsed.CLOUDINARY_URL,
      parsed.CLOUDINARY_URI
    )
    fileValues.cloudName = firstNonEmpty(
      fileValues.cloudName,
      parsed.CLOUDINARY_CLOUD_NAME,
      parsed.CLOUD_NAME,
      parsed.CLOUDINARY_CLOUD
    )
    fileValues.apiKey = firstNonEmpty(
      fileValues.apiKey,
      parsed.CLOUDINARY_API_KEY,
      parsed.CLOUDINARY_KEY
    )
    fileValues.apiSecret = firstNonEmpty(
      fileValues.apiSecret,
      parsed.CLOUDINARY_API_SECRET,
      parsed.CLOUDINARY_SECRET
    )
  }

  return fileValues
}

const parseCloudinaryUrl = (cloudinaryUrl) => {
  const normalizedUrl = normalizeEnvValue(cloudinaryUrl)
  if (!normalizedUrl) return null

  try {
    const parsed = new URL(normalizedUrl)
    if (parsed.protocol !== 'cloudinary:') return null

    const cloudName = normalizeEnvValue(parsed.hostname)
    const apiKey = normalizeEnvValue(decodeURIComponent(parsed.username || ''))
    const apiSecret = normalizeEnvValue(decodeURIComponent(parsed.password || ''))

    if (!cloudName || !apiKey || !apiSecret) return null
    return { cloudName, apiKey, apiSecret }
  } catch {
    return null
  }
}

const buildCloudinaryUrl = ({ apiKey, apiSecret, cloudName }) =>
  `cloudinary://${encodeURIComponent(apiKey)}:${encodeURIComponent(apiSecret)}@${cloudName}`

const applyDotenvFromKnownLocations = () => {
  for (const envPath of ENV_PATH_CANDIDATES) {
    if (!existsSync(envPath)) continue
    dotenv.config({ path: envPath, override: false })
  }
}

const readCloudinaryEnvSnapshot = () => {
  const fileValues = readCloudinaryEnvFromFiles()

  return {
    cloudinaryUrl: firstNonEmpty(
      process.env.CLOUDINARY_URL,
      process.env.CLOUDINARY_URI,
      fileValues.cloudinaryUrl
    ),
    cloudName: firstNonEmpty(
      process.env.CLOUDINARY_CLOUD_NAME,
      process.env.CLOUD_NAME,
      process.env.CLOUDINARY_CLOUD,
      fileValues.cloudName
    ),
    apiKey: firstNonEmpty(
      process.env.CLOUDINARY_API_KEY,
      process.env.CLOUDINARY_KEY,
      fileValues.apiKey
    ),
    apiSecret: firstNonEmpty(
      process.env.CLOUDINARY_API_SECRET,
      process.env.CLOUDINARY_SECRET,
      fileValues.apiSecret
    )
  }
}

applyDotenvFromKnownLocations()

const readCloudinaryEnv = () => {
  let env = readCloudinaryEnvSnapshot()

  if (!env.cloudinaryUrl && !(env.cloudName && env.apiKey && env.apiSecret)) {
    // Try loading .env again at runtime in case env values were added after boot
    // or the process started from a different working directory/layout.
    applyDotenvFromKnownLocations()
    env = readCloudinaryEnvSnapshot()
  }

  return env
}

const hasRuntimeCloudinaryConfig = () => {
  const config = cloudinary.config()
  return !!(
    normalizeEnvValue(config.cloud_name) &&
    normalizeEnvValue(config.api_key) &&
    normalizeEnvValue(config.api_secret)
  )
}

const ensureCloudinaryConfigured = () => {
  const { cloudinaryUrl, cloudName, apiKey, apiSecret } = readCloudinaryEnv()

  if (cloudinaryUrl) {
    const parsedFromUrl = parseCloudinaryUrl(cloudinaryUrl)
    if (parsedFromUrl) {
      cloudinary.config({
        cloud_name: parsedFromUrl.cloudName,
        api_key: parsedFromUrl.apiKey,
        api_secret: parsedFromUrl.apiSecret
      })
      process.env.CLOUDINARY_CLOUD_NAME = parsedFromUrl.cloudName
      process.env.CLOUDINARY_API_KEY = parsedFromUrl.apiKey
      process.env.CLOUDINARY_API_SECRET = parsedFromUrl.apiSecret
      process.env.CLOUDINARY_URL = buildCloudinaryUrl(parsedFromUrl)
      return true
    }
  }

  if (cloudName && apiKey && apiSecret) {
    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret
    })
    process.env.CLOUDINARY_CLOUD_NAME = cloudName
    process.env.CLOUDINARY_API_KEY = apiKey
    process.env.CLOUDINARY_API_SECRET = apiSecret
    process.env.CLOUDINARY_URL = buildCloudinaryUrl({ apiKey, apiSecret, cloudName })
    return true
  }

  return hasRuntimeCloudinaryConfig()
}

export const isCloudinaryConfigured = () => ensureCloudinaryConfigured()

export const uploadBufferToCloudinary = async ({
  buffer,
  filename,
  folder,
  resourceType = 'auto',
  mimeType = ''
}) => {
  const policy = await getStorageRuntimeConfiguration('identity-provider')
  if (!policy?.configured || !['cloudinary', 'azure-blob'].includes(policy.defaultProvider)) {
    throw new Error('Managed file storage is unavailable')
  }
  if (policy.defaultProvider === 'azure-blob') {
    const configuration = policy.providers.azureBlob
    const credential = new StorageSharedKeyCredential(configuration.accountName, configuration.accountKey)
    const service = new BlobServiceClient(configuration.endpoint, credential)
    const safeFolder = String(folder || 'identity-provider').split('/').filter(Boolean)
      .map((part) => part.replace(/[^a-zA-Z0-9._-]+/gu, '-').slice(0, 80)).join('/')
    const safeFilename = String(filename || 'file').replace(/[^a-zA-Z0-9._-]+/gu, '-').slice(-180)
    const storageKey = `${safeFolder}/${crypto.randomUUID()}-${safeFilename}`
    const blob = service.getContainerClient(configuration.containerName).getBlockBlobClient(storageKey)
    await blob.uploadData(buffer, { blobHTTPHeaders: { blobContentType: mimeType || (resourceType === 'image' ? 'image/jpeg' : 'application/octet-stream') } })
    const url = await blob.generateSasUrl({
      permissions: BlobSASPermissions.parse('r'),
      expiresOn: new Date(Date.now() + 10 * 365 * 24 * 60 * 60_000)
    })
    return {
      secure_url: url,
      public_id: storageKey,
      resource_type: 'blob',
      bytes: buffer.length,
      storageProvider: 'azure-blob',
      storageKey,
      storageContainer: configuration.containerName
    }
  }
  const cloudinaryConfiguration = policy.providers?.cloudinary
  if (!cloudinaryConfiguration?.configured) {
    throw new Error('Cloudinary configuration missing')
  }
  cloudinary.config({
    cloud_name: cloudinaryConfiguration.cloudName,
    api_key: cloudinaryConfiguration.apiKey,
    api_secret: cloudinaryConfiguration.apiSecret
  })

  const uploaded = await new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: resourceType,
        public_id: filename ? filename.replace(/\.[^/.]+$/, '') : undefined
      },
      (error, result) => {
        if (error) {
          return reject(error)
        }
        resolve(result)
      }
    )

    uploadStream.end(buffer)
  })
  return {
    ...uploaded,
    storageProvider: 'cloudinary',
    storageKey: uploaded.public_id
  }
}

export const deleteFromCloudinary = async ({ publicId, storageKey, storageProvider, provider, storageContainer, resourceType = 'raw' }) => {
  if (storageProvider === 'azure-blob' || provider === 'azure-blob') {
    const policy = await getStorageRuntimeConfiguration('identity-provider')
    const configuration = policy.providers?.azureBlob
    if (!configuration?.configured) throw new Error('Azure Blob Storage is not configured')
    const credential = new StorageSharedKeyCredential(configuration.accountName, configuration.accountKey)
    const service = new BlobServiceClient(configuration.endpoint, credential)
    return service.getContainerClient(storageContainer || configuration.containerName)
      .getBlockBlobClient(storageKey || publicId)
      .deleteIfExists({ deleteSnapshots: 'include' })
  }
  if (!ensureCloudinaryConfigured()) {
    throw new Error('Cloudinary configuration missing')
  }
  if (!publicId) {
    throw new Error('Cloudinary publicId is required')
  }

  return cloudinary.uploader.destroy(publicId, {
    resource_type: resourceType,
    invalidate: true
  })
}

export default cloudinary
