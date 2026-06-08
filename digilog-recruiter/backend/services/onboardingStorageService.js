const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const normalizeFolder = (folder = 'onboarding/documents') =>
  String(folder || 'onboarding/documents').replace(/^\/+|\/+$/g, '');

async function uploadBuffer(buffer, {
  folder = 'onboarding/documents',
  fileName = `document-${Date.now()}.pdf`,
  mimeType = 'application/pdf',
  resourceType = 'raw'
} = {}) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new Error('A file buffer is required for onboarding upload');
  }

  const dataUri = `data:${mimeType};base64,${buffer.toString('base64')}`;
  const result = await cloudinary.uploader.upload(dataUri, {
    resource_type: resourceType,
    access_mode: 'public',
    folder: normalizeFolder(folder),
    public_id: fileName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 90),
    overwrite: true
  });

  return toFileSnapshot(result, fileName, mimeType);
}

function getDownloadUrl(publicId, resourceType = 'raw') {
  if (!publicId) return '';
  return cloudinary.url(publicId, {
    resource_type: resourceType,
    flags: 'attachment',
    secure: true
  });
}

function toFileSnapshot(result, originalName, mimeType) {
  if (!result) return null;

  return {
    url: result.secure_url,
    downloadUrl: getDownloadUrl(result.public_id, result.resource_type || 'raw'),
    publicId: result.public_id,
    resourceType: result.resource_type,
    format: result.format,
    bytes: result.bytes,
    originalName,
    mimeType,
    renderedAt: new Date()
  };
}

module.exports = {
  uploadBuffer,
  toFileSnapshot,
  getDownloadUrl
};
