const crypto = require('crypto');
const { BlobSASPermissions, BlobServiceClient, StorageSharedKeyCredential } = require('@azure/storage-blob');
const cloudinary = require('cloudinary').v2;
const { resolveStoragePlatformConfiguration } = require('./platformConfigurationClient');

const safe = (value, fallback = 'file') => String(value || fallback).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 180) || fallback;
const inferProvider = (snapshot = {}) => snapshot.storageProvider === 'azure-blob' || /\.blob\.core\.windows\.net\//i.test(String(snapshot.storageUrl || snapshot.url || '')) ? 'azure-blob' : 'cloudinary';

function createStorageService({ configurationResolver = resolveStoragePlatformConfiguration } = {}) {
  return {
    async uploadBuffer(buffer, { fileName, mimeType, folder = 'performance' } = {}) {
      const policy = await configurationResolver({ force: true });
      if (!policy?.configured) throw new Error('Managed file storage is unavailable.');
      if (policy.defaultProvider === 'azure-blob') {
        const configuration = policy.providers.azureBlob;
        const credential = new StorageSharedKeyCredential(configuration.accountName, configuration.accountKey);
        const service = new BlobServiceClient(configuration.endpoint, credential);
        const storageKey = `${String(folder).split('/').map((part) => safe(part)).join('/')}/${crypto.randomUUID()}-${safe(fileName)}`;
        const blob = service.getContainerClient(configuration.containerName).getBlockBlobClient(storageKey);
        await blob.uploadData(buffer, { blobHTTPHeaders: { blobContentType: mimeType || 'application/octet-stream' } });
        const url = await blob.generateSasUrl({ permissions: BlobSASPermissions.parse('r'), expiresOn: new Date(Date.now() + 10 * 365 * 24 * 60 * 60_000) });
        return { storageProvider: 'azure-blob', storageKey, storageContainer: configuration.containerName, storageResourceType: 'blob', storageUrl: url, size: buffer.length };
      }
      const configuration = policy.providers.cloudinary;
      cloudinary.config({ cloud_name: configuration.cloudName, api_key: configuration.apiKey, api_secret: configuration.apiSecret });
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream({ folder, resource_type: 'auto' }, (error, value) => error ? reject(error) : resolve(value));
        stream.end(buffer);
      });
      return { storageProvider: 'cloudinary', storageKey: result.public_id, storageResourceType: result.resource_type, storageUrl: result.secure_url, size: result.bytes };
    },
    async remove(snapshot = {}) {
      if (!snapshot.storageKey) return false;
      const policy = await configurationResolver();
      if (inferProvider(snapshot) === 'azure-blob') {
        const configuration = policy.providers.azureBlob;
        const credential = new StorageSharedKeyCredential(configuration.accountName, configuration.accountKey);
        const service = new BlobServiceClient(configuration.endpoint, credential);
        return Boolean((await service.getContainerClient(snapshot.storageContainer || configuration.containerName).getBlockBlobClient(snapshot.storageKey).deleteIfExists({ deleteSnapshots: 'include' })).succeeded);
      }
      const configuration = policy.providers.cloudinary;
      cloudinary.config({ cloud_name: configuration.cloudName, api_key: configuration.apiKey, api_secret: configuration.apiSecret });
      const result = await cloudinary.uploader.destroy(snapshot.storageKey, { resource_type: snapshot.storageResourceType || 'raw', invalidate: true });
      return result?.result === 'ok' || result?.result === 'not found';
    }
  };
}

module.exports = { createStorageService, inferProvider };
