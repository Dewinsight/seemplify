const crypto = require('crypto');
const fs = require('fs/promises');
const { BlobSASPermissions, BlobServiceClient, StorageSharedKeyCredential } = require('@azure/storage-blob');
const cloudinary = require('cloudinary').v2;
const { resolveStoragePlatformConfiguration } = require('./platformConfigurationClient');

const safeSegment = (value, fallback = 'file') => String(value || fallback)
  .normalize('NFKC')
  .replace(/[^a-zA-Z0-9._-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 180) || fallback;

const safePath = (value, fallback = 'file') => String(value || fallback)
  .split('/')
  .filter(Boolean)
  .map((part) => safeSegment(part))
  .join('/') || fallback;

function configureCloudinary(configuration, client) {
  client.config({ cloud_name: configuration.cloudName, api_key: configuration.apiKey, api_secret: configuration.apiSecret });
}

function defaultAzureClient(configuration, containerName, storageKey) {
  const credential = new StorageSharedKeyCredential(configuration.accountName, configuration.accountKey);
  const service = new BlobServiceClient(configuration.endpoint, credential);
  return service.getContainerClient(containerName).getBlockBlobClient(storageKey);
}

function inferProvider(snapshot = {}) {
  if (snapshot.storageProvider === 'azure-blob' || snapshot.provider === 'azure-blob') return 'azure-blob';
  if (snapshot.storageProvider === 'cloudinary' || snapshot.provider === 'cloudinary') return 'cloudinary';
  return /\.blob\.core\.windows\.net\//i.test(String(snapshot.url || snapshot.resumeUrl || snapshot.downloadUrl || '')) ? 'azure-blob' : 'cloudinary';
}

function createStorageService({
  configurationResolver = resolveStoragePlatformConfiguration,
  cloudinaryClient = cloudinary,
  azureClientFactory = defaultAzureClient
} = {}) {
  return {
    async uploadBuffer(buffer, { fileName = 'file', mimeType = 'application/octet-stream', folder = 'recruiter', resourceType = 'auto', storageKey: requestedStorageKey, cloudinaryOptions = {} } = {}) {
      if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('A non-empty file buffer is required.');
      const policy = await configurationResolver();
      if (!policy?.configured) throw new Error('File storage has not been configured by an administrator.');
      if (policy.defaultProvider === 'azure-blob') {
        const configuration = policy.providers?.azureBlob;
        if (!configuration?.configured) throw new Error('Azure Blob Storage is not configured.');
        const storageKey = requestedStorageKey
          ? String(requestedStorageKey).split('/').filter(Boolean).map((part) => safeSegment(part)).join('/')
          : `${safePath(folder, 'recruiter')}/${crypto.randomUUID()}-${safeSegment(fileName)}`;
        const blob = azureClientFactory(configuration, configuration.containerName, storageKey);
        await blob.uploadData(buffer, { blobHTTPHeaders: { blobContentType: mimeType } });
        const url = await blob.generateSasUrl({ permissions: BlobSASPermissions.parse('r'), expiresOn: new Date(Date.now() + 10 * 365 * 24 * 60 * 60_000) });
        return { provider: 'azure-blob', storageProvider: 'azure-blob', storageKey, storageContainer: configuration.containerName, resourceType: 'blob', url, bytes: buffer.length };
      }
      const configuration = policy.providers?.cloudinary;
      if (!configuration?.configured) throw new Error('Cloudinary is not configured.');
      configureCloudinary(configuration, cloudinaryClient);
      const upload = await new Promise((resolve, reject) => {
        const stream = cloudinaryClient.uploader.upload_stream({ folder, resource_type: resourceType, ...cloudinaryOptions }, (error, result) => error ? reject(error) : resolve(result));
        stream.end(buffer);
      });
      return {
        provider: 'cloudinary', storageProvider: 'cloudinary', storageKey: upload.public_id,
        resourceType: upload.resource_type || resourceType, url: upload.secure_url,
        format: upload.format, bytes: Number(upload.bytes || buffer.length), deliveryType: upload.type || cloudinaryOptions.type || 'upload'
      };
    },

    async uploadFile(filePath, options = {}) {
      return this.uploadBuffer(await fs.readFile(filePath), { fileName: options.fileName || filePath.split(/[\\/]/).pop(), ...options });
    },

    async remove(snapshot = {}) {
      if (!snapshot.storageKey) return false;
      const policy = await configurationResolver();
      if (inferProvider(snapshot) === 'azure-blob') {
        const configuration = policy?.providers?.azureBlob;
        if (!configuration?.configured) return false;
        const blob = azureClientFactory(configuration, snapshot.storageContainer || configuration.containerName, snapshot.storageKey);
        return Boolean((await blob.deleteIfExists({ deleteSnapshots: 'include' })).succeeded);
      }
      const configuration = policy?.providers?.cloudinary;
      if (!configuration?.configured) return false;
      configureCloudinary(configuration, cloudinaryClient);
      const result = await cloudinaryClient.uploader.destroy(snapshot.storageKey, {
        resource_type: snapshot.resourceType || 'raw', type: snapshot.deliveryType || 'upload', invalidate: true
      });
      return result?.result === 'ok' || result?.result === 'not found';
    }
  };
}

module.exports = { createStorageService, inferProvider };
