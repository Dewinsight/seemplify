const assert = require('node:assert/strict');
const test = require('node:test');

const voiceCatalog = require('../config/aiInterviewVoiceOptions');
const azureSpeechTtsService = require('../services/azureSpeechTtsService');

test('Nigerian Azure voices are available and Ezinne is the default', () => {
  const voices = voiceCatalog.getAIInterviewVoiceOptions();
  const nigerianVoices = voices.filter((voice) => voice.language === 'en-NG');

  assert.equal(voices.length, 15);
  assert.equal(voiceCatalog.getDefaultAIInterviewVoiceOption().id, 'en-NG-EzinneNeural');
  assert.deepEqual(
    nigerianVoices.map((voice) => [voice.id, voice.gender]),
    [
      ['en-NG-EzinneNeural', 'female'],
      ['en-NG-AbeoNeural', 'male']
    ]
  );
});

test('Azure TTS derives the Nigerian locale from the default voice', () => {
  const environmentKeys = [
    'AZURE_AI_INTERVIEW_SPEECH_VOICE',
    'AZURE_SPEECH_VOICE',
    'AZURE_VOICELIVE_VOICE',
    'AZURE_AI_INTERVIEW_SPEECH_LANGUAGE',
    'AZURE_SPEECH_LANGUAGE'
  ];
  const previousEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));

  try {
    environmentKeys.forEach((key) => delete process.env[key]);
    const config = azureSpeechTtsService.getConfig();

    assert.equal(config.voice, 'en-NG-EzinneNeural');
    assert.equal(config.language, 'en-NG');
  } finally {
    environmentKeys.forEach((key) => {
      const previousValue = previousEnvironment[key];
      if (previousValue === undefined) delete process.env[key];
      else process.env[key] = previousValue;
    });
  }
});

test('Nigerian interview questions use a measured voice-specific pace', () => {
  const question = azureSpeechTtsService.getConfig({
    voice: 'en-NG-EzinneNeural',
    language: 'en-NG',
    messageType: 'question'
  });
  const acknowledgement = azureSpeechTtsService.getConfig({
    voice: 'en-NG-EzinneNeural',
    language: 'en-NG',
    messageType: 'acknowledgement'
  });

  assert.equal(question.rate, '-5%');
  assert.equal(acknowledgement.rate, '-2%');
});

test('all voice families receive natural pacing while an explicit operator rate wins', () => {
  assert.equal(azureSpeechTtsService.getConfig({
    voice: 'en-US-JennyMultilingualNeural',
    messageType: 'question'
  }).rate, '-4%');
  assert.equal(azureSpeechTtsService.getConfig({
    voice: 'en-US-Ava:DragonHDLatestNeural',
    messageType: 'question'
  }).rate, '-3%');
  assert.equal(azureSpeechTtsService.getConfig({
    voice: 'en-us-Joy:MAI-Voice-1',
    messageType: 'question',
    rate: '+6%'
  }).rate, '+6%');
});

test('SSML turns written formatting into safe spoken phrasing and breathing points', () => {
  const ssml = azureSpeechTtsService.buildSsml(
    '## Question\n- Tell me about `Node.js`, R&D & delivery; what changed?\n\nTake your time.',
    { voice: 'en-NG-AbeoNeural', language: 'en-NG', messageType: 'question' }
  );

  assert.doesNotMatch(ssml, /##|`|•/);
  assert.match(ssml, /Node\.js, R&amp;D and delivery/);
  assert.doesNotMatch(ssml, /Node\.<break/);
  assert.match(ssml, /<prosody rate='-5%'>/);
  assert.match(ssml, /<break time='180ms'\/>/);
  assert.match(ssml, /<break time='380ms'\/>/);
  assert.match(ssml, /<break time='560ms'\/>/);
  assert.match(ssml, /<break time='260ms'\/>/);
});
