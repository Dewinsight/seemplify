'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { transcribeWav, validateWav } = require('../services/performanceTranscriptionService');

function wav(seconds = 1) {
  const audio = Buffer.alloc(44 + seconds * 32000);
  audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(16000, 24); audio.writeUInt32LE(32000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34);
  audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);
  return audio;
}
const result = transcript => Response.json({ results: { channels: [{ alternatives: [{ transcript }] }] } });

test('native audio uses a mounted Deepgram key, fixed Nova-3 endpoint and bounded WAV', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepgram-contract-'));
  const file = path.join(dir, 'key'); fs.writeFileSync(file, 'test-secret\n', { mode: 0o600 });
  try {
    const audio = wav();
    const transcript = await transcribeWav(audio, { environment: { DEEPGRAM_API_KEY_FILE: file, DEEPGRAM_API_KEY: 'must-not-override-file' }, fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.deepgram.com/v1/listen?model=nova-3&language=en&smart_format=true&punctuate=true');
      assert.equal(options.headers.Authorization, 'Token test-secret'); assert.equal(options.headers['Content-Type'], 'audio/wav');
      assert.equal(options.body, audio); assert.equal(options.redirect, 'error'); assert.ok(options.signal);
      return result(' We agreed to document the release. ');
    } });
    assert.equal(transcript, 'We agreed to document the release.');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('malformed, truncated, oversized and non-PCM WAVs are rejected before sending audio', async () => {
  for (const input of [Buffer.alloc(100), wav(31), wav().subarray(0, 100), Buffer.from('RIFF....WAVE')]) assert.throws(() => validateWav(input), TypeError);
  const stereo = wav(); stereo.writeUInt16LE(2, 22); assert.throws(() => validateWav(stereo), TypeError);
  const encoded = wav(); encoded.writeUInt16LE(3, 20); assert.throws(() => validateWav(encoded), TypeError);
  const invalidChunk = wav(); invalidChunk.writeUInt32LE(0xffffffff, 40); assert.throws(() => validateWav(invalidChunk), TypeError);
  assert.doesNotThrow(() => validateWav(wav(30)));
});

test('missing Deepgram configuration never falls back to Azure', async () => {
  let called = false;
  await assert.rejects(transcribeWav(wav(), { environment: { AZURE_SPEECH_KEY: 'irrelevant' }, fetchImpl: async () => { called = true; } }), { code: 'DEEPGRAM_NOT_CONFIGURED', statusCode: 503 });
  await assert.rejects(transcribeWav(wav(), { environment: { DEEPGRAM_API_KEY_FILE: '/missing/deepgram/key', DEEPGRAM_API_KEY: 'unused' } }), { code: 'DEEPGRAM_NOT_CONFIGURED' });
  assert.equal(called, false);
});

test('provider rejection and network failures never expose credentials or provider bodies', async () => {
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(transcribeWav(wav(), { environment: { DEEPGRAM_API_KEY: 'private-test-key' }, fetchImpl: async () => new Response('private-test-key provider diagnostics', { status }) }), error => {
      assert.equal(error.statusCode, 503); assert.equal(error.message.includes('private-test-key'), false);
      assert.equal(error.code, status < 429 ? 'DEEPGRAM_AUTH_FAILED' : 'DEEPGRAM_UNAVAILABLE'); return true;
    });
  }
  await assert.rejects(transcribeWav(wav(), { environment: { DEEPGRAM_API_KEY: 'private-test-key' }, fetchImpl: async () => { throw new Error('private-test-key request headers'); } }), error => !error.message.includes('private-test-key') && error.retryable === true);
});

test('no speech is distinct from invalid provider output', async () => {
  const options = { environment: { DEEPGRAM_API_KEY: 'test' }, fetchImpl: async () => result('') };
  assert.equal(await transcribeWav(wav(), options), '');
  await assert.rejects(transcribeWav(wav(), { ...options, fetchImpl: async () => Response.json({}) }), { code: 'DEEPGRAM_INVALID_RESPONSE' });
  await assert.rejects(transcribeWav(wav(), { ...options, fetchImpl: async () => new Response('invalid json') }), { code: 'DEEPGRAM_INVALID_RESPONSE' });
});
