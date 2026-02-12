import dotenv from 'dotenv'
import { v2 as cloudinary } from 'cloudinary'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

// Load Identityprovider/.env regardless of where the process was started from.
// This fixes cases where the service is launched from the repo root, which would
// otherwise make dotenv look for `<repo>/.env` instead of `Identityprovider/.env`.
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
dotenv.config({ path: resolve(__dirname, '../../.env') })

const readCloudinaryEnv = () => ({
  cloudinaryUrl: process.env.CLOUDINARY_URL,
  cloudName: process.env.CLOUDINARY_CLOUD_NAME,
  apiKey: process.env.CLOUDINARY_API_KEY,
  apiSecret: process.env.CLOUDINARY_API_SECRET
})

const ensureCloudinaryConfigured = () => {
  const { cloudinaryUrl, cloudName, apiKey, apiSecret } = readCloudinaryEnv()

  if (cloudinaryUrl) {
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

  return false
}

export const isCloudinaryConfigured = () => {
  const { cloudinaryUrl, cloudName, apiKey, apiSecret } = readCloudinaryEnv()
  return !!(cloudinaryUrl || (cloudName && apiKey && apiSecret))
}

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
  console.warn('?? Cloudinary is not fully configured. Uploads will fail until env vars are set.')
}
