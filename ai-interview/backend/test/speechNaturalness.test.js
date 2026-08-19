const assert = require('node:assert/strict');
const test = require('node:test');

const azureSpeechTtsService = require('../src/azureSpeechTtsService');
const voiceCatalog = require('../src/aiInterviewVoiceOptions');

test('standalone voice catalog includes both Nigerian voices and defaults to Ezinne', () => {
  const voices = voiceCatalog.getAIInterviewVoiceOptions();
  assert.equal(voiceCatalog.getDefaultAIInterviewVoiceOption().id, 'en-NG-EzinneNeural');
  assert.deepEqual(
    voices.filter((voice) => voice.language === 'en-NG').map((voice) => voice.id),
    ['en-NG-EzinneNeural', 'en-NG-AbeoNeural']
  );
});

test('standalone SSML applies spoken cleanup, pauses, and Nigerian question pacing', () => {
  const ssml = azureSpeechTtsService.buildSsml(
    '### Question\nDescribe the trade-off; what did you learn?\n\nAnswer when ready.',
    { voice: 'en-NG-EzinneNeural', language: 'en-NG', messageType: 'question' }
  );

  assert.doesNotMatch(ssml, /###/);
  assert.match(ssml, /<prosody rate='-5%'>/);
  assert.match(ssml, /<break time='180ms'\/>/);
  assert.match(ssml, /<break time='380ms'\/>/);
  assert.match(ssml, /<break time='560ms'\/>/);
});
