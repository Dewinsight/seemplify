const assert = require('node:assert/strict');
const test = require('node:test');
const { applyAzureSpeechConfiguration } = require('../src/platformConfigurationClient');

test('Identity Azure Speech configuration hydrates the runtime environment', () => {
  const environment = {};
  assert.equal(applyAzureSpeechConfiguration({
    configured: true,
    speechKey: 'speech-key',
    region: 'westeurope',
    ttsEndpoint: 'https://speech.example.com',
    language: 'en-GB',
    voice: 'en-GB-SoniaNeural',
    outputFormat: 'audio-24khz-48kbitrate-mono-mp3'
  }, environment), true);
  assert.equal(environment.AZURE_SPEECH_KEY, 'speech-key');
  assert.equal(environment.AZURE_SPEECH_REGION, 'westeurope');
  assert.equal(environment.AZURE_AI_INTERVIEW_SPEECH_VOICE, 'en-GB-SoniaNeural');
});

test('incomplete Azure Speech configuration does not replace the environment', () => {
  const environment = { AZURE_SPEECH_KEY: 'existing' };
  assert.equal(applyAzureSpeechConfiguration({ configured: false }, environment), false);
  assert.equal(environment.AZURE_SPEECH_KEY, 'existing');
});
