import crypto from 'node:crypto';
import { BlobSASPermissions, BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob';
import { v2 as cloudinary } from 'cloudinary';
import { resolveStoragePlatformConfiguration } from './storagePlatformConfiguration.js';

export type StoredFile = {
  storageProvider: 'cloudinary' | 'azure-blob'; storageKey: string; storageContainer?: string;
  storageResourceType?: string; storageUrl: string; size: number;
};

type ManagedStorageTestAdapter = {
  storeBuffer: (buffer: Buffer, input: { fileName: string; mimeType: string; folder: string }) => Promise<StoredFile>;
  removeStoredFile: (file: Partial<StoredFile>) => Promise<boolean>;
  downloadStoredFile: (file: Partial<StoredFile>) => Promise<Buffer>;
};

let testAdapter: ManagedStorageTestAdapter | null = null;

export function setManagedStorageTestAdapter(adapter: ManagedStorageTestAdapter | null) {
  if (String(process.env.NODE_ENV || '').toLowerCase() !== 'test') {
    throw new Error('Managed storage test adapters are available only in the test runtime.');
  }
  testAdapter = adapter;
}

const safe = (value: unknown, fallback = 'file') => String(value || fallback).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 180) || fallback;

export async function storeBuffer(buffer: Buffer, input: { fileName: string; mimeType: string; folder: string }): Promise<StoredFile> {
  if (testAdapter) return testAdapter.storeBuffer(buffer, input);
  const policy = await resolveStoragePlatformConfiguration();
  if (!policy) throw new Error('Managed file storage is unavailable.');
  if (policy.defaultProvider === 'azure-blob') {
    const configuration = policy.providers.azureBlob;
    if (!configuration.configured || !configuration.accountName || !configuration.accountKey || !configuration.containerName || !configuration.endpoint) throw new Error('Azure Blob Storage is not configured.');
    const credential = new StorageSharedKeyCredential(configuration.accountName, configuration.accountKey);
    const service = new BlobServiceClient(configuration.endpoint, credential);
    const storageKey = `${input.folder.split('/').map((part) => safe(part)).join('/')}/${crypto.randomUUID()}-${safe(input.fileName)}`;
    const blob = service.getContainerClient(configuration.containerName).getBlockBlobClient(storageKey);
    await blob.uploadData(buffer, { blobHTTPHeaders: { blobContentType: input.mimeType } });
    const storageUrl = await blob.generateSasUrl({ permissions: BlobSASPermissions.parse('r'), expiresOn: new Date(Date.now() + 10 * 365 * 24 * 60 * 60_000) });
    return { storageProvider: 'azure-blob', storageKey, storageContainer: configuration.containerName, storageResourceType: 'blob', storageUrl, size: buffer.length };
  }
  const configuration = policy.providers.cloudinary;
  if (!configuration.configured || !configuration.cloudName || !configuration.apiKey || !configuration.apiSecret) throw new Error('Cloudinary is not configured.');
  cloudinary.config({ cloud_name: configuration.cloudName, api_key: configuration.apiKey, api_secret: configuration.apiSecret });
  const result: any = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder: input.folder, resource_type: 'auto' }, (error, value) => error ? reject(error) : resolve(value));
    stream.end(buffer);
  });
  return { storageProvider: 'cloudinary', storageKey: result.public_id, storageResourceType: result.resource_type, storageUrl: result.secure_url, size: Number(result.bytes || buffer.length) };
}

export async function removeStoredFile(file: Partial<StoredFile>) {
  if (testAdapter) return testAdapter.removeStoredFile(file);
  if (!file.storageKey) return false;
  const policy = await resolveStoragePlatformConfiguration();
  if (!policy) return false;
  if (file.storageProvider === 'azure-blob') {
    const configuration = policy.providers.azureBlob;
    if (!configuration.accountName || !configuration.accountKey || !configuration.containerName || !configuration.endpoint) return false;
    const credential = new StorageSharedKeyCredential(configuration.accountName, configuration.accountKey);
    const service = new BlobServiceClient(configuration.endpoint, credential);
    return Boolean((await service.getContainerClient(file.storageContainer || configuration.containerName).getBlockBlobClient(file.storageKey).deleteIfExists({ deleteSnapshots: 'include' })).succeeded);
  }
  const configuration = policy.providers.cloudinary;
  if (!configuration.cloudName || !configuration.apiKey || !configuration.apiSecret) return false;
  cloudinary.config({ cloud_name: configuration.cloudName, api_key: configuration.apiKey, api_secret: configuration.apiSecret });
  const result = await cloudinary.uploader.destroy(file.storageKey, { resource_type: file.storageResourceType || 'raw', invalidate: true });
  return result?.result === 'ok' || result?.result === 'not found';
}

export async function downloadStoredFile(file: Partial<StoredFile>) {
  if (testAdapter) return testAdapter.downloadStoredFile(file);
  if (!file.storageKey) throw new Error('Stored file key is missing.');
  const policy = await resolveStoragePlatformConfiguration();
  if (!policy) throw new Error('Managed file storage is unavailable.');
  if (file.storageProvider === 'azure-blob') {
    const configuration = policy.providers.azureBlob;
    if (!configuration.accountName || !configuration.accountKey || !configuration.containerName || !configuration.endpoint) throw new Error('Azure Blob Storage is not configured.');
    const credential = new StorageSharedKeyCredential(configuration.accountName, configuration.accountKey);
    const service = new BlobServiceClient(configuration.endpoint, credential);
    return service.getContainerClient(file.storageContainer || configuration.containerName)
      .getBlockBlobClient(file.storageKey).downloadToBuffer();
  }
  const configuration = policy.providers.cloudinary;
  if (!configuration.cloudName || !configuration.apiKey || !configuration.apiSecret) throw new Error('Cloudinary is not configured.');
  cloudinary.config({ cloud_name: configuration.cloudName, api_key: configuration.apiKey, api_secret: configuration.apiSecret });
  const resourceType = file.storageResourceType || 'raw';
  const url = file.storageUrl || cloudinary.url(file.storageKey, { resource_type: resourceType, secure: true });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Stored file download failed (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}
