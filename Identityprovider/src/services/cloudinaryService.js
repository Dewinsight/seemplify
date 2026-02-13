import dotenv from 'dotenv'
import { v2 as cloudinary } from 'cloudinary'
import { existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ENV_PATH_CANDIDATES = [
  resolve(__dirname, '../../.env'),
  resolve(__dirname, '../../../.env'),
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), 'Identityprovider/.env')
]

const normalizeEnvValue = (value) => (typeof value === 'string' ? value.trim() : '')

const applyDotenvFromKnownLocations = () => {
  for (const envPath of ENV_PATH_CANDIDATES) {
    if (!existsSync(envPath)) continue
    dotenv.config({ path: envPath, override: false })
  }
}

const readCloudinaryEnvSnapshot = () => ({
  cloudinaryUrl: normalizeEnvValue(process.env.CLOUDINARY_URL || process.env.CLOUDINARY_URI || ''),
  cloudName: normalizeEnvValue(process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUD_NAME || process.env.CLOUDINARY_CLOUD || ''),
  apiKey: normalizeEnvValue(process.env.CLOUDINARY_API_KEY || process.env.CLOUDINARY_KEY || ''),
  apiSecret: normalizeEnvValue(process.env.CLOUDINARY_API_SECRET || process.env.CLOUDINARY_SECRET || '')
})

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
    // Ensure SDK picks up the normalized URL value.
    process.env.CLOUDINARY_URL = cloudinaryUrl
    // Instruct the SDK to (re)load configuration from CLOUDINARY_URL.
    cloudinary.config(true)
    return true
  }

  if (cloudName && apiKey && apiSecret) {
    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret
    })
    return true
  }

  return hasRuntimeCloudinaryConfig()
}

export const isCloudinaryConfigured = () => ensureCloudinaryConfigured()

export const uploadBufferToCloudinary = ({
  buffer,
  filename,
  folder,
  resourceType = 'auto'
}) => {
  if (!ensureCloudinaryConfigured()) {
    throw new Error('Cloudinary configuration missing')
  }

  return new Promise((resolve, reject) => {
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
}

export const deleteFromCloudinary = async ({ publicId, resourceType = 'raw' }) => {
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

if (!isCloudinaryConfigured()) {
  console.warn('Cloudinary is not fully configured. Uploads will fail until env vars are set.')
}
