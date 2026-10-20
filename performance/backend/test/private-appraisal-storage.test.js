const test = require('node:test');
const assert = require('node:assert/strict');
const { Writable } = require('node:stream');
const { createStorageService } = require('../services/storageService');

function fixture(uploadOverrides = {}) {
  const calls = { uploads: [], deletes: [], downloads: [], policies: [] };
  const policy = { configured: true, defaultProvider: 'cloudinary', providers: { cloudinary: {
    cloudName: 'synthetic-cloud', apiKey: 'synthetic-key', apiSecret: 'synthetic-secret'
  } } };
  const client = { uploader: {
    upload_stream(options, callback) {
      const parts = [];
      return new Writable({ write(chunk, _encoding, done) { parts.push(chunk); done(); },
        final(done) { calls.uploads.push({ options, bytes: Buffer.concat(parts) }); callback(null, {
          public_id: options.public_id, resource_type: 'raw', type: 'authenticated', bytes: Buffer.concat(parts).length,
          secure_url: 'https://res.cloudinary.com/synthetic/raw/authenticated/should-not-be-persisted', ...uploadOverrides
        }); done(); }
      });
    },
    async destroy(key, options) { calls.deletes.push({ key, options }); return { result: 'ok' }; }
  }, utils: { private_download_url(key, format, options) {
    calls.downloads.push({ key, format, options }); return `https://api.cloudinary.com/synthetic/download?expires_at=${options.expires_at}`;
  } } };
  const service = createStorageService({ configurationResolver: async options => { calls.policies.push(options); return policy; },
    cloudinaryClient: client, now: () => 1800000000000 });
  return { calls, service };
}

for (const name of ['evidence.txt', 'review.PDF', 'role.docx', `${'a'.repeat(250)}.pdf`]) {
  test(`new Cloudinary ${name.slice(-20)} is authenticated raw storage with original bytes and extension`, async () => {
    const { service, calls } = fixture(); const bytes = Buffer.from('Synthetic document bytes\n');
    const result = await service.uploadBuffer(bytes, { fileName: name, folder: 'performance/appraisals/synthetic' });
    assert.equal(calls.uploads.length, 1); const upload = calls.uploads[0];
    assert.equal(upload.options.type, 'authenticated'); assert.equal(upload.options.resource_type, 'raw');
    assert.match(upload.options.public_id, new RegExp(`\\.${name.split('.').pop().toLowerCase()}$`));
    assert.deepEqual(upload.bytes, bytes); assert.equal(result.storageDeliveryType, 'authenticated');
    assert.equal(result.storageResourceType, 'raw'); assert.equal(result.storageFormat, name.split('.').pop().toLowerCase());
    assert.equal(result.storageUrl, undefined); assert.equal(result.size, bytes.length);
  });
}

test('private downloads sign only after request with five-minute expiry and captured raw identifier', async () => {
  const { service, calls } = fixture(); const result = await service.uploadBuffer(Buffer.from('Private synthetic'), { fileName: 'evidence.pdf' });
  assert.equal(calls.downloads.length, 0);
  const url = await service.getDownloadUrl(result);
  assert.match(url, /expires_at=1800000300$/); const signed = calls.downloads[0];
  assert.equal(signed.key, result.storageKey); assert.equal(signed.format, undefined);
  assert.equal(signed.options.type, 'authenticated'); assert.equal(signed.options.resource_type, 'raw');
  assert.equal(signed.options.attachment, true); assert.equal(signed.options.expires_at, 1800000300);
});

test('long filename respects full public-ID limit with a real appraisal folder and retains extension', async () => {
  const { service, calls } = fixture();
  const folder = 'performance/appraisals/0123456789abcdef01234567/abcdef0123456789abcdef01';
  const result = await service.uploadBuffer(Buffer.from('Synthetic long filename'), { fileName: `${'x'.repeat(250)}.docx`, folder });
  assert.ok(result.storageKey.length <= 255); assert.match(result.storageKey, /\.docx$/);
  assert.ok(result.storageKey.startsWith(`${folder}/`)); assert.equal(calls.uploads[0].options.public_id, result.storageKey);
});

test('oversized folder fails safely before contacting storage', async () => {
  const { service, calls } = fixture();
  await assert.rejects(service.uploadBuffer(Buffer.from('Synthetic'), { fileName: 'evidence.pdf', folder: `${'x'.repeat(180)}/${'y'.repeat(180)}` }),
    error => { assert.equal(error.message, 'Managed file upload failed. Please retry.'); return true; });
  assert.equal(calls.uploads.length, 0);
});

test('private deletion uses captured delivery/resource types; legacy public remains compatible', async () => {
  const { service, calls } = fixture();
  await service.remove({ storageProvider: 'cloudinary', storageKey: 'private.txt', storageResourceType: 'raw', storageDeliveryType: 'authenticated' });
  await service.remove({ storageProvider: 'cloudinary', storageKey: 'old-pdf', storageResourceType: 'image' });
  assert.equal(calls.deletes[0].options.type, 'authenticated'); assert.equal(calls.deletes[0].options.resource_type, 'raw');
  assert.equal(calls.deletes[1].options.type, 'upload'); assert.equal(calls.deletes[1].options.resource_type, 'image');
});

test('unexpected public upload response is rejected and cleaned up with the actual returned type', async () => {
  const { service, calls } = fixture({ type: 'upload' });
  await assert.rejects(service.uploadBuffer(Buffer.from('Synthetic private bytes'), { fileName: 'evidence.txt' }), /Managed file upload failed/);
  assert.equal(calls.deletes.length, 1); assert.equal(calls.deletes[0].options.type, 'upload');
  assert.equal(calls.deletes[0].options.resource_type, 'raw');
});

test('unexpected image response is rejected rather than storing a transformed document', async () => {
  const { service, calls } = fixture({ resource_type: 'image' });
  await assert.rejects(service.uploadBuffer(Buffer.from('Synthetic private bytes'), { fileName: 'evidence.pdf' }), /Managed file upload failed/);
  assert.equal(calls.deletes[0].options.resource_type, 'image'); assert.equal(calls.deletes[0].options.type, 'authenticated');
});

test('legacy Azure and public Cloudinary download snapshots survive a default-provider change', async () => {
  const { service, calls } = fixture();
  for (const storageUrl of ['https://synthetic.blob.core.windows.net/old/file?synthetic-sas', 'https://res.cloudinary.com/synthetic/image/upload/old.pdf']) {
    assert.equal(await service.getDownloadUrl({ storageUrl }), storageUrl);
  }
  assert.equal(calls.policies.length, 0); assert.equal(calls.downloads.length, 0);
});

test('provider failures expose no request URLs, signatures or credentials', async () => {
  const service = createStorageService({ configurationResolver: async () => ({ configured: true, defaultProvider: 'cloudinary', providers: { cloudinary: {} } }),
    cloudinaryClient: { uploader: { upload_stream(_options, callback) { return new Writable({ write(_chunk, _encoding, done) { done(); }, final(done) { callback(new Error('secret signed provider request URL')); done(); } }); } } } });
  await assert.rejects(service.uploadBuffer(Buffer.from('Synthetic'), { fileName: 'evidence.txt' }), error => {
    assert.equal(error.message, 'Managed file upload failed. Please retry.'); assert.equal(error.cause, undefined); return true;
  });
});
