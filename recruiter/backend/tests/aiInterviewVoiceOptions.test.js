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
