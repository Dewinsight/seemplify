const crypto = require('crypto');
const https = require('https');
const WebSocket = require('ws');
const sdk = require('microsoft-cognitiveservices-speech-sdk');
const AIInterviewSession = require('../models/AIInterviewSession');

function hashPublicToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function normalizeRegion(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

function normalizeEnglishLanguage(value, fallback = 'en-US') {
  const language = String(value || '').trim();
  return /^en(?:-|$)/i.test(language) ? language : fallback;
}

function parseInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function writeSilence(pushStream, sampleRate, milliseconds) {
  const sampleCount = Math.max(0, Math.round((sampleRate * milliseconds) / 1000));
  if (!sampleCount) return;
  pushStream.write(Buffer.alloc(sampleCount * 2));
}

function getWavDurationMs(audioBuffer) {
  if (!Buffer.isBuffer(audioBuffer) || audioBuffer.length < 44) return 0;
  if (audioBuffer.toString('ascii', 0, 4) !== 'RIFF' || audioBuffer.toString('ascii', 8, 12) !== 'WAVE') {
    return 0;
  }

  let byteRate = 0;
  let dataSize = 0;
  let offset = 12;

  while (offset + 8 <= audioBuffer.length) {
    const chunkId = audioBuffer.toString('ascii', offset, offset + 4);
    const chunkSize = audioBuffer.readUInt32LE(offset + 4);
    const chunkDataOffset = offset + 8;

    if (chunkId === 'fmt ' && chunkSize >= 16 && chunkDataOffset + 12 <= audioBuffer.length) {
      byteRate = audioBuffer.readUInt32LE(chunkDataOffset + 8);
    } else if (chunkId === 'data') {
      dataSize = Math.min(chunkSize, Math.max(0, audioBuffer.length - chunkDataOffset));
    }

    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }

  return byteRate > 0 && dataSize > 0 ? Math.round((dataSize / byteRate) * 1000) : 0;
}

function buildSpeechConfig(config) {
  const speechConfig = sdk.SpeechConfig.fromSubscription(config.apiKey, config.region);
  speechConfig.speechRecognitionLanguage = config.language;
  speechConfig.setProperty(
    sdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs,
    String(config.initialSilenceTimeoutMs)
  );
  speechConfig.setProperty(
    sdk.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs,
    String(config.endSilenceTimeoutMs)
  );
  speechConfig.setProperty(
    sdk.PropertyId.SpeechServiceResponse_RequestWordLevelTimestamps,
    'true'
  );
  speechConfig.setProperty(
    sdk.PropertyId.Speech_SegmentationSilenceTimeoutMs,
    String(config.endSilenceTimeoutMs)
  );
  speechConfig.setProperty(
    sdk.PropertyId.Speech_SegmentationMaximumTimeMs,
    '30000'
  );
  return speechConfig;
}

async function findPublicSession(token) {
  const tokenHash = hashPublicToken(token);
  return AIInterviewSession.findOne({ tokenHash })
    .populate({
      path: 'aiInterview',
      populate: [
        { path: 'job', select: 'title description organization' },
        { path: 'organization', select: 'name' }
      ]
    })
    .populate('job', 'title description')
    .populate('candidate', 'firstName lastName email');
}

class AIInterviewVoiceLiveService {
  constructor() {
    this.wss = null;
  }

  getConfig() {
    const region = normalizeRegion(
      process.env.AZURE_SPEECH_REGION ||
      process.env.AZURE_LOCATION ||
      process.env.AZURE_VOICELIVE_REGION ||
      'swedencentral'
    );

    return {
      apiKey: process.env.AZURE_SPEECH_KEY || process.env.AZURE_VOICELIVE_API_KEY,
      region,
      language: normalizeEnglishLanguage(
        process.env.AZURE_AI_INTERVIEW_SPEECH_LANGUAGE ||
        process.env.AZURE_SPEECH_LANGUAGE ||
        process.env.AZURE_VOICELIVE_LANGUAGE ||
        'en-US'
      ),
      sampleRate: parseInteger(process.env.AZURE_SPEECH_STT_SAMPLE_RATE, 16000, 8000, 48000),
      initialSilenceTimeoutMs: parseInteger(process.env.AZURE_SPEECH_INITIAL_SILENCE_TIMEOUT_MS, 10000, 1000, 60000),
      endSilenceTimeoutMs: parseInteger(process.env.AZURE_SPEECH_END_SILENCE_TIMEOUT_MS, 900, 200, 5000),
      noSpeechTimeoutMs: parseInteger(process.env.AZURE_SPEECH_NO_SPEECH_TIMEOUT_MS, 4500, 1000, 12000),
      voice: process.env.AZURE_SPEECH_VOICE || process.env.AZURE_VOICELIVE_VOICE || 'en-US-AvaNeural'
    };
  }

  isConfigured() {
    const config = this.getConfig();
    return Boolean(config.apiKey && config.region);
  }

  getPublicConfig() {
    const config = this.getConfig();
    return {
      enabled: this.isConfigured(),
      provider: 'azure-speech',
      model: 'azure-speech',
      language: config.language,
      sampleRate: config.sampleRate,
      voice: config.voice
    };
  }

  issueClientToken() {
    const config = this.getConfig();
    if (!this.isConfigured()) {
      const error = new Error('Azure Speech STT is not configured on the backend.');
      error.statusCode = 503;
      error.code = 'SPEECH_NOT_CONFIGURED';
      throw error;
    }

    return new Promise((resolve, reject) => {
      const req = https.request({
        method: 'POST',
        hostname: `${config.region}.api.cognitive.microsoft.com`,
        path: '/sts/v1.0/issueToken',
        headers: {
          'Ocp-Apim-Subscription-Key': config.apiKey,
          'Content-Length': 0
        }
      }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8').trim();
          if (response.statusCode >= 200 && response.statusCode < 300 && body) {
            resolve({
              token: body,
              region: config.region,
              language: config.language,
              expiresInSeconds: 540
            });
            return;
          }

          const error = new Error(body || `Azure Speech token request failed (${response.statusCode})`);
          error.statusCode = 502;
          error.code = 'SPEECH_TOKEN_FAILED';
          reject(error);
        });
      });

      req.on('error', (error) => {
        error.statusCode = 502;
        error.code = 'SPEECH_TOKEN_FAILED';
        reject(error);
      });

      req.end();
    });
  }

  sendJson(ws, payload) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  createRecognizer(clientWs, config) {
    const speechConfig = buildSpeechConfig(config);
    const audioFormat = sdk.AudioStreamFormat.getWaveFormatPCM(config.sampleRate, 16, 1);
    const pushStream = sdk.AudioInputStream.createPushStream(audioFormat);
    const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);
    const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);

    return { recognizer, pushStream };
  }

  startRecognizer(recognizer) {
    return new Promise((resolve, reject) => {
      recognizer.startContinuousRecognitionAsync(resolve, reject);
    });
  }

  stopRecognizer(recognizer) {
    return new Promise((resolve) => {
      recognizer.stopContinuousRecognitionAsync(resolve, resolve);
    });
  }

  transcribeWav(audioBuffer) {
    const config = this.getConfig();
    if (!this.isConfigured()) {
      const error = new Error('Azure Speech STT is not configured on the backend.');
      error.statusCode = 503;
      error.code = 'SPEECH_NOT_CONFIGURED';
      throw error;
    }

    if (!Buffer.isBuffer(audioBuffer) || audioBuffer.length < 44) {
      const error = new Error('A valid WAV audio payload is required.');
      error.statusCode = 400;
      error.code = 'INVALID_AUDIO';
      throw error;
    }

    const speechConfig = buildSpeechConfig(config);
    const audioConfig = sdk.AudioConfig.fromWavFileInput(audioBuffer, 'candidate-response.wav');
    const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
    const durationMs = getWavDurationMs(audioBuffer);
    const timeoutMs = Math.min(180000, Math.max(20000, durationMs * 4 + 10000));

    return new Promise((resolve, reject) => {
      const segments = [];
      let settled = false;
      let guardTimer = null;

      const close = () => {
        try { recognizer.close(); } catch { /* ignore */ }
        try { audioConfig.close?.(); } catch { /* ignore */ }
      };

      const finish = (error = null) => {
        if (settled) return;
        settled = true;
        if (guardTimer) clearTimeout(guardTimer);
        close();

        if (error) {
          reject(error);
          return;
        }

        resolve(segments.join(' ').replace(/\s+/g, ' ').trim());
      };

      recognizer.recognized = (_sender, event) => {
        if (event.result?.reason === sdk.ResultReason.RecognizedSpeech) {
          const text = String(event.result.text || '').trim();
          if (text) segments.push(text);
        }
      };

      recognizer.canceled = (_sender, event) => {
        if (event.reason === sdk.CancellationReason.Error) {
          const error = new Error(event.errorDetails || 'Azure Speech could not transcribe the audio.');
          error.statusCode = 502;
          error.code = 'SPEECH_TRANSCRIPTION_FAILED';
          finish(error);
          return;
        }
        finish();
      };

      recognizer.sessionStopped = () => finish();

      guardTimer = setTimeout(() => {
        const error = new Error('Azure Speech transcription timed out.');
        error.statusCode = 504;
        error.code = 'SPEECH_TRANSCRIPTION_TIMEOUT';
        finish(error);
      }, timeoutMs);

      recognizer.startContinuousRecognitionAsync(
        () => {},
        (error) => {
          const wrapped = new Error(String(error || 'Azure Speech transcription failed.'));
          wrapped.statusCode = 502;
          wrapped.code = 'SPEECH_TRANSCRIPTION_FAILED';
          finish(wrapped);
        }
      );
    });
  }

  initialize(server) {
    if (this.wss) return;

    this.wss = new WebSocket.Server({ noServer: true });

    server.on('upgrade', (req, socket, head) => {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (pathname !== '/ws/ai-interview-voice') return;

      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.wss.emit('connection', ws, req);
      });
    });

    this.wss.on('connection', async (clientWs, req) => {
      let recognizer = null;
      let pushStream = null;
      let currentTurnId = null;
      let finalTurnId = null;
      let noSpeechTimer = null;
      let closed = false;

      const clearNoSpeechTimer = () => {
        if (noSpeechTimer) {
          clearTimeout(noSpeechTimer);
          noSpeechTimer = null;
        }
      };

      const cleanup = async () => {
        if (closed) return;
        closed = true;
        clearNoSpeechTimer();
        try { pushStream?.close(); } catch { /* ignore */ }
        if (recognizer) {
          await this.stopRecognizer(recognizer).catch(() => {});
          recognizer.close();
        }
      };

      try {
        const requestUrl = new URL(req.url, 'http://localhost');
        const token = requestUrl.searchParams.get('token');

        if (!this.isConfigured()) {
          this.sendJson(clientWs, { type: 'voice.error', message: 'Azure Speech STT is not configured on the backend.' });
          clientWs.close(1011, 'Azure Speech not configured');
          return;
        }

        if (!token) {
          this.sendJson(clientWs, { type: 'voice.error', message: 'Interview token is required.' });
          clientWs.close(1008, 'Missing token');
          return;
        }

        let session = await findPublicSession(token);
        if (!session || !session.aiInterview) {
          this.sendJson(clientWs, { type: 'voice.error', message: 'Interview link not found.' });
          clientWs.close(1008, 'Invalid token');
          return;
        }

        const interview = session.aiInterview;
        const now = new Date();
        if (new Date(interview.schedule.expiresAt) <= now || ['completed', 'expired', 'cancelled'].includes(session.status)) {
          this.sendJson(clientWs, { type: 'voice.error', message: 'This interview is no longer accepting voice responses.' });
          clientWs.close(1008, 'Interview closed');
          return;
        }

        if (session.status !== 'in_progress') {
          this.sendJson(clientWs, { type: 'voice.error', message: 'Start the interview before enabling voice mode.' });
          clientWs.close(1008, 'Interview not started');
          return;
        }

        const config = this.getConfig();
        const recognizerPair = this.createRecognizer(clientWs, config);
        recognizer = recognizerPair.recognizer;
        pushStream = recognizerPair.pushStream;

        recognizer.recognizing = (_sender, event) => {
          const transcript = event?.result?.text;
          if (!transcript) return;
          this.sendJson(clientWs, {
            type: 'voice.transcript.delta',
            transcript,
            turnId: currentTurnId
          });
        };

        recognizer.recognized = (_sender, event) => {
          const transcript = event?.result?.text;
          if (event?.result?.reason === sdk.ResultReason.RecognizedSpeech && transcript) {
            finalTurnId = currentTurnId;
            clearNoSpeechTimer();
            this.sendJson(clientWs, {
              type: 'voice.transcript.final',
              transcript,
              turnId: currentTurnId
            });
            return;
          }

          if (event?.result?.reason === sdk.ResultReason.NoMatch && currentTurnId && finalTurnId !== currentTurnId) {
            this.sendJson(clientWs, {
              type: 'voice.transcript.failed',
              message: 'No speech was recognized.',
              turnId: currentTurnId
            });
          }
        };

        recognizer.canceled = (_sender, event) => {
          const details = event?.errorDetails || 'Azure Speech recognition was cancelled.';
          console.error('AI interview Azure Speech STT cancelled:', details);
          this.sendJson(clientWs, { type: 'voice.error', message: details });
        };

        recognizer.sessionStopped = () => {
          this.sendJson(clientWs, { type: 'voice.stt.closed' });
        };

        await this.startRecognizer(recognizer);

        this.sendJson(clientWs, {
          type: 'voice.proxy.ready',
          provider: 'azure-speech',
          language: config.language,
          sampleRate: config.sampleRate
        });

        clientWs.on('message', async (data, isBinary) => {
          try {
            if (isBinary) {
              if (pushStream && currentTurnId) {
                pushStream.write(Buffer.from(data));
              }
              return;
            }

            const message = JSON.parse(Buffer.isBuffer(data) ? data.toString('utf8') : String(data));

            if (message.type === 'voice.refresh_session') {
              session = await findPublicSession(token);
              this.sendJson(clientWs, { type: 'voice.session.refreshed' });
              return;
            }

            if (message.type === 'voice.audio.start') {
              currentTurnId = message.turnId || crypto.randomUUID();
              finalTurnId = null;
              clearNoSpeechTimer();
              this.sendJson(clientWs, {
                type: 'voice.audio.ready',
                turnId: currentTurnId
              });
              return;
            }

            if (message.type === 'voice.audio.end_turn') {
              const turnId = message.turnId || currentTurnId;
              writeSilence(pushStream, config.sampleRate, config.endSilenceTimeoutMs + 300);
              clearNoSpeechTimer();
              noSpeechTimer = setTimeout(() => {
                if (turnId && finalTurnId !== turnId) {
                  this.sendJson(clientWs, {
                    type: 'voice.transcript.failed',
                    message: 'No speech was recognized.',
                    turnId
                  });
                }
              }, config.noSpeechTimeoutMs);
              return;
            }

            this.sendJson(clientWs, {
              type: 'voice.command.ignored',
              message: 'Unsupported voice command ignored.',
              command: message.type || null
            });
          } catch (error) {
            console.error('AI interview Azure Speech client message error:', error.message);
            this.sendJson(clientWs, { type: 'voice.error', message: 'Invalid voice message.' });
          }
        });

        clientWs.on('close', cleanup);
        clientWs.on('error', (error) => {
          console.error('AI interview Azure Speech client WebSocket error:', error.message);
        });
      } catch (error) {
        console.error('AI interview Azure Speech connection error:', error.message);
        this.sendJson(clientWs, { type: 'voice.error', message: 'Unable to start voice mode.' });
        await cleanup();
        clientWs.close(1011, 'Voice setup failed');
      }
    });

    console.log('AI Interview Azure Speech STT bridge initialized on /ws/ai-interview-voice');
  }
}

module.exports = new AIInterviewVoiceLiveService();
