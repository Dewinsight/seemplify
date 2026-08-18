const cloudinary = require('cloudinary').v2;
const { createStorageService } = require('./storageService');
const { resolveStoragePlatformConfiguration } = require('./platformConfigurationClient');

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

  const result = await createStorageService({
    configurationResolver: () => resolveStoragePlatformConfiguration({ solution: 'people-transitions' })
  }).uploadBuffer(buffer, {
    mimeType,
    fileName,
    folder: normalizeFolder(folder),
    resourceType,
    cloudinaryOptions: {
      access_mode: 'public',
      public_id: fileName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 90),
      overwrite: true
    }
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
    url: result.url,
    downloadUrl: result.storageProvider === 'azure-blob' ? result.url : getDownloadUrl(result.storageKey, result.resourceType || 'raw'),
    provider: result.storageProvider,
    storageProvider: result.storageProvider,
    storageKey: result.storageKey,
    storageContainer: result.storageContainer || null,
    publicId: result.storageKey,
    resourceType: result.resourceType,
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
