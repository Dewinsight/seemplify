const assert = require('node:assert/strict');
const test = require('node:test');

const azureSpeechTtsService = require('../src/azureSpeechTtsService');
const voiceCatalog = require('../src/aiInterviewVoiceOptions');
const { addMessage } = require('../src/interviewEngine');
const { makePublicState } = require('../src/store');

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

test('canonical question stays visible while its speech rendition remains private', () => {
  const canonicalQuestion = 'How would you balance reliability, delivery speed, and cost during a high-risk migration?';
  const speechRendition = 'How would you balance reliability, delivery speed, and cost, during a high-risk migration?';
  const session = {
    aiInterview: 'interview-1',
    candidateId: 'candidate-1',
    candidateSnapshot: { name: 'Candidate' },
    currentQuestionIndex: 0,
    messages: [],
    answers: [],
    proctoring: {}
  };

  const storedMessage = addMessage(session, 'ai', canonicalQuestion, 0, 'question', speechRendition);
  assert.equal(storedMessage.content, canonicalQuestion);
  assert.equal(storedMessage.speechContent, speechRendition);

  const state = makePublicState({
    interviews: [{
      _id: 'interview-1',
      title: 'Architecture interview',
      questionSnapshots: [{ question: canonicalQuestion, type: 'technical', difficulty: 'hard' }],
      timers: { perQuestionMinutes: 10 },
      voice: { language: 'en-NG', voiceId: 'en-NG-EzinneNeural' }
    }],
    jobs: []
  }, session);

  assert.equal(state.session.messages[0].content, canonicalQuestion);
  assert.equal(Object.hasOwn(state.session.messages[0], 'speechContent'), false);

  session.messages[0].content = 'Let us discuss a migration. How would you approach it?';
  const legacyState = makePublicState({
    interviews: [{
      _id: 'interview-1',
      title: 'Architecture interview',
      questionSnapshots: [{ question: canonicalQuestion, type: 'technical', difficulty: 'hard' }],
      timers: { perQuestionMinutes: 10 }
    }],
    jobs: []
  }, session);
  assert.equal(legacyState.session.messages[0].content, canonicalQuestion);
});
