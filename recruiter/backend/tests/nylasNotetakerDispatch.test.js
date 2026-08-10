const test = require('node:test');
const assert = require('node:assert/strict');
const nylasV3Service = require('../services/nylasV3Service');

test('dispatches the existing standalone Nyla bot with PATCH instead of creating another', async () => {
  const originalFetch = global.fetch;
  let capturedRequest;

  global.fetch = async (url, options) => {
    capturedRequest = { url, options };
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: { id: 'nyla-original', state: 'scheduled' } })
    };
  };

  try {
    const result = await nylasV3Service.dispatchStandaloneNotetakerNow(
      'nyla-original',
      {
        apiKey: 'test-key',
        apiUri: 'https://api.test.nylas.com'
      },
      {
        name: 'Nyla',
        now: new Date('2026-08-10T08:00:00.000Z')
      }
    );

    assert.equal(capturedRequest.url, 'https://api.test.nylas.com/v3/notetakers/nyla-original');
    assert.equal(capturedRequest.options.method, 'PATCH');
    assert.deepEqual(JSON.parse(capturedRequest.options.body), {
      name: 'Nyla',
      join_time: 1786348802
    });
    assert.equal(result.notetakerId, 'nyla-original');
  } finally {
    global.fetch = originalFetch;
  }
});

test('reports a missing original bot so a caller may safely create one replacement', async () => {
  const originalFetch = global.fetch;
  const originalConsoleError = console.error;

  global.fetch = async () => ({
    ok: false,
    status: 404,
    text: async () => 'Not found'
  });
  console.error = () => {};

  try {
    await assert.rejects(
      () => nylasV3Service.dispatchStandaloneNotetakerNow(
        'missing-bot',
        { apiKey: 'test-key', apiUri: 'https://api.test.nylas.com' },
        { now: 0 }
      ),
      /NOTETAKER_NOT_FOUND/
    );
  } finally {
    global.fetch = originalFetch;
    console.error = originalConsoleError;
  }
});
