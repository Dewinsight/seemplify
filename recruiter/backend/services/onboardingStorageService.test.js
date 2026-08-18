const test = require('node:test');
const assert = require('node:assert/strict');
const cloudinary = require('cloudinary').v2;

const onboardingStorageService = require('./onboardingStorageService');

test('downloadBuffer recovers a PDF from its Cloudinary public ID when stored URLs fail', async (t) => {
  const originalPrivateDownloadUrl = cloudinary.utils.private_download_url;
  t.after(() => {
    cloudinary.utils.private_download_url = originalPrivateDownloadUrl;
  });

  cloudinary.utils.private_download_url = (publicId, format, options) => {
    assert.equal(publicId, 'onboarding/envelopes/test-document');
    assert.equal(format, 'pdf');
    assert.equal(options.resource_type, 'raw');
    assert.equal(options.type, 'upload');
    return 'https://cloudinary.test/recovery';
  };

  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url);
    if (url === 'https://cloudinary.test/stale.pdf') {
      return { ok: false, status: 404 };
    }
    return {
      ok: true,
      arrayBuffer: async () => Buffer.from('%PDF-1.7 recovered')
    };
  };

  const buffer = await onboardingStorageService.downloadBuffer({
    url: 'https://cloudinary.test/stale.pdf',
    publicId: 'onboarding/envelopes/test-document',
    resourceType: 'raw',
    originalName: 'test-document.pdf'
  }, { fetchImpl });

  assert.deepEqual(requests, [
    'https://cloudinary.test/stale.pdf',
    'https://cloudinary.test/recovery'
  ]);
  assert.match(buffer.toString(), /^%PDF-1.7/);
});

test('downloadBuffer uses a working stored URL without generating a recovery URL', async (t) => {
  const originalPrivateDownloadUrl = cloudinary.utils.private_download_url;
  t.after(() => {
    cloudinary.utils.private_download_url = originalPrivateDownloadUrl;
  });

  let generatedRecoveryUrl = false;
  cloudinary.utils.private_download_url = () => {
    generatedRecoveryUrl = true;
    return 'https://cloudinary.test/recovery';
  };

  const buffer = await onboardingStorageService.downloadBuffer({
    url: 'https://cloudinary.test/current.pdf',
    publicId: 'onboarding/documents/current'
  }, {
    fetchImpl: async () => ({
      ok: true,
      arrayBuffer: async () => Buffer.from('%PDF-1.7 current')
    })
  });

  assert.equal(generatedRecoveryUrl, false);
  assert.match(buffer.toString(), /^%PDF-1.7/);
});
