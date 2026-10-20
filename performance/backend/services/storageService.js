const crypto = require('crypto');
const { BlobSASPermissions, BlobServiceClient, StorageSharedKeyCredential } = require('@azure/storage-blob');
const cloudinary = require('cloudinary').v2;
const { resolveStoragePlatformConfiguration } = require('./platformConfigurationClient');

const safe = (value, fallback = 'file') => String(value || fallback).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 180) || fallback;
const inferProvider = (snapshot = {}) => snapshot.storageProvider === 'azure-blob' || /\.blob\.core\.windows\.net\//i.test(String(snapshot.storageUrl || snapshot.url || '')) ? 'azure-blob' : 'cloudinary';

const cloudinaryOptions = (configuration) => ({ cloud_name: configuration.cloudName, api_key: configuration.apiKey, api_secret: configuration.apiSecret });

function createStorageService({ configurationResolver = resolveStoragePlatformConfiguration, cloudinaryClient = cloudinary, now = Date.now } = {}) {
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
      const extension = String(fileName || '').match(/\.([a-zA-Z0-9]{1,12})$/)?.[1]?.toLowerCase();
      const baseName = extension ? String(fileName).slice(0, -extension.length - 1) : fileName;
      const prefix = `${String(folder).split('/').map((part) => safe(part)).join('/')}/${crypto.randomUUID()}-`;
      const suffix = extension ? `.${extension}` : '';
      // Cloudinary limits the complete public ID, including folder and extension,
      // to 255 characters. Reserve those fixed portions before trimming the name.
      const nameBudget = 255 - prefix.length - suffix.length;
      if (nameBudget < 1) throw new Error('Managed file upload failed. Please retry.');
      const publicId = `${prefix}${safe(baseName).slice(0, nameBudget)}${suffix}`;
      try {
        // Raw assets retain exact original bytes and filename extensions. The
        // authenticated type protects both originals and derived deliveries.
        const result = await new Promise((resolve, reject) => {
          const stream = cloudinaryClient.uploader.upload_stream({ ...cloudinaryOptions(configuration), public_id: publicId,
            resource_type: 'raw', type: 'authenticated' }, (error, value) => error ? reject(error) : resolve(value));
          stream.end(buffer);
        });
        if (!result?.public_id || result.type !== 'authenticated' || result.resource_type !== 'raw') {
          // Do not persist an unexpected public fallback. Target the provider's
          // actual returned type when cleaning up that unexpected asset.
          if (result?.public_id) await cloudinaryClient.uploader.destroy(result.public_id, { ...cloudinaryOptions(configuration),
            resource_type: result.resource_type || 'raw', type: result.type || 'upload', invalidate: true });
          throw new Error('Private storage was not confirmed.');
        }
        return { storageProvider: 'cloudinary', storageKey: result.public_id, storageResourceType: result.resource_type,
          storageDeliveryType: 'authenticated', storageFormat: extension, size: result.bytes };
      } catch {
        // Provider errors can include signed request URLs and credentials.
        throw new Error('Managed file upload failed. Please retry.');
      }
    },
    async getDownloadUrl(snapshot = {}) {
      if (inferProvider(snapshot) === 'cloudinary' && ['authenticated', 'private'].includes(snapshot.storageDeliveryType)) {
        if (!snapshot.storageKey) throw new Error('Document content is unavailable.');
        const policy = await configurationResolver({ force: true });
        const configuration = policy?.providers?.cloudinary;
        if (!configuration?.configured && !(configuration?.cloudName && configuration?.apiKey && configuration?.apiSecret)) {
          throw new Error('Managed file storage is unavailable.');
        }
        try {
          return cloudinaryClient.utils.private_download_url(snapshot.storageKey,
            snapshot.storageResourceType === 'raw' ? undefined : snapshot.storageFormat,
            { ...cloudinaryOptions(configuration), resource_type: snapshot.storageResourceType || 'raw',
              type: snapshot.storageDeliveryType, expires_at: Math.floor(now() / 1000) + 300, attachment: true });
        } catch {
          throw new Error('Managed file download is unavailable. Please retry.');
        }
      }
      // Historical Azure SAS and public Cloudinary snapshots keep their original
      // provider/URL even when the centrally selected upload default changes.
      return snapshot.storageUrl || snapshot.url || null;
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
      try {
        const result = await cloudinaryClient.uploader.destroy(snapshot.storageKey, { ...cloudinaryOptions(configuration),
          resource_type: snapshot.storageResourceType || 'raw', type: snapshot.storageDeliveryType || 'upload', invalidate: true });
        if (result?.result !== 'ok' && result?.result !== 'not found') throw new Error('Deletion was not confirmed.');
        return true;
      } catch {
        throw new Error('Managed file deletion failed. Please retry.');
      }
    }
  };
}

module.exports = { createStorageService, inferProvider };
