const cloudinary = require('cloudinary').v2;
const { createStorageService, inferProvider } = require('./storageService');
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

function snapshotUrls(snapshot) {
  return [snapshot?.url, snapshot?.downloadUrl].filter(Boolean);
}

function privateSnapshotUrl(snapshot) {
  if (!snapshot?.publicId || inferProvider(snapshot) !== 'cloudinary') return '';

  const originalName = String(snapshot.originalName || 'document.pdf');
  const inferredFormat = originalName.includes('.') ? originalName.split('.').pop() : '';
  const format = snapshot.format || inferredFormat || 'pdf';

  return cloudinary.utils.private_download_url(snapshot.publicId, format, {
    resource_type: snapshot.resourceType || 'raw',
    type: snapshot.deliveryType || 'upload',
    expires_at: Math.floor(Date.now() / 1000) + 5 * 60
  });
}

async function downloadBuffer(snapshot, { fetchImpl = global.fetch, download } = {}) {
  if (!snapshot) throw new Error('A file snapshot is required');
  const downloadUrl = download || (async (url) => {
    if (typeof fetchImpl !== 'function') throw new Error('PDF download is unavailable');
    const response = await fetchImpl(url);
    if (!response.ok) throw new Error(`Failed to download PDF: ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  });

  let lastError = null;
  for (const url of snapshotUrls(snapshot)) {
    try {
      return await downloadUrl(url);
    } catch (error) {
      lastError = error;
    }
  }

  // Cloudinary delivery URLs can become unusable after account delivery settings
  // change. The public ID is the durable asset identity, so use a short-lived,
  // server-only authenticated download as the recovery path.
  try {
    const recoveryUrl = privateSnapshotUrl(snapshot);
    if (recoveryUrl) {
      return await downloadUrl(recoveryUrl);
    }
  } catch (error) {
    lastError = error;
  }

  throw lastError || new Error('PDF snapshot URL is missing');
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
    deliveryType: result.deliveryType || result.type || 'upload',
    renderedAt: new Date()
  };
}

module.exports = {
  uploadBuffer,
  toFileSnapshot,
  getDownloadUrl,
  downloadBuffer,
  privateSnapshotUrl
};
