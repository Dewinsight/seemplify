const test = require('node:test');
const assert = require('node:assert/strict');
const { createStorageService, inferProvider } = require('../services/storageService');

test('Azure uploads return immutable provider coordinates and delete through the captured provider', async () => {
  const calls = [];
  let uploadResolutionOptions;
  const service = createStorageService({
    configurationResolver: async (options) => {
      uploadResolutionOptions = options;
      return ({
      configured: true, defaultProvider: 'azure-blob',
      providers: { azureBlob: { configured: true, accountName: 'account', accountKey: 'test-key',
        containerName: 'files', endpoint: 'https://account.blob.core.windows.net' } }
      });
    },
    azureClientFactory: (_configuration, container, key) => ({
      async uploadData(buffer, options) { calls.push(['upload', container, key, buffer.length, options.blobHTTPHeaders.blobContentType]); },
      async generateSasUrl() { return `https://account.blob.core.windows.net/${container}/${key}?sig=test`; },
      async deleteIfExists() { calls.push(['delete', container, key]); return { succeeded: true }; }
    })
  });
  const stored = await service.uploadBuffer(Buffer.from('resume'), {
    fileName: 'candidate.pdf', mimeType: 'application/pdf', folder: 'recruiter/cv'
  });
  assert.equal(stored.storageProvider, 'azure-blob');
  assert.equal(stored.storageContainer, 'files');
  assert.match(stored.storageKey, /^recruiter\/cv\//u);
  assert.equal(inferProvider(stored), 'azure-blob');
  assert.deepEqual(uploadResolutionOptions, { force: true });
  assert.equal(await service.remove(stored), true);
  assert.deepEqual(calls.map((call) => call[0]), ['upload', 'delete']);
});

test('Cloudinary uploads and deletes retain the original resource type after defaults can change', async () => {
  const calls = [];
  const cloudinaryClient = {
    config() {},
    uploader: {
      upload_stream(options, callback) {
        return { end(buffer) { calls.push(['upload', options.resource_type, buffer.length]); callback(null,
          { public_id: 'recruiter/avatar/one', resource_type: 'image', secure_url: 'https://res.cloudinary.com/demo/image/upload/one', bytes: buffer.length }); } };
      },
      async destroy(key, options) { calls.push(['delete', key, options.resource_type]); return { result: 'ok' }; }
    }
  };
  const service = createStorageService({
    configurationResolver: async () => ({ configured: true, defaultProvider: 'cloudinary',
      providers: { cloudinary: { configured: true, cloudName: 'demo', apiKey: 'key', apiSecret: 'secret' } } }),
    cloudinaryClient
  });
  const stored = await service.uploadBuffer(Buffer.from('avatar'), { fileName: 'avatar.png', resourceType: 'image' });
  assert.equal(stored.storageProvider, 'cloudinary');
  assert.equal(await service.remove(stored), true);
  assert.deepEqual(calls, [['upload', 'image', 6], ['delete', 'recruiter/avatar/one', 'image']]);
});
