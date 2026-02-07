import dotenv from 'dotenv'
import { v2 as cloudinary } from 'cloudinary'

// Load env vars before config
dotenv.config()

const cloudName = process.env.CLOUDINARY_CLOUD_NAME
const apiKey = process.env.CLOUDINARY_API_KEY
const apiSecret = process.env.CLOUDINARY_API_SECRET

if (cloudName && apiKey && apiSecret) {
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret
  })
} else {
  console.warn('?? Cloudinary is not fully configured. Uploads will fail until env vars are set.')
}

export const isCloudinaryConfigured = () => {
  return !!(cloudName && apiKey && apiSecret)
}

export const uploadBufferToCloudinary = ({
  buffer,
  filename,
  folder,
  resourceType = 'auto'
}) => {
  if (!isCloudinaryConfigured()) {
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

export default cloudinary
