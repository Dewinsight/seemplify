const sdk = require('microsoft-cognitiveservices-speech-sdk');

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

class AzureSpeechSttService {
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
      initialSilenceTimeoutMs: parseInteger(process.env.AZURE_SPEECH_INITIAL_SILENCE_TIMEOUT_MS, 12000, 1000, 60000),
      endSilenceTimeoutMs: parseInteger(process.env.AZURE_SPEECH_END_SILENCE_TIMEOUT_MS, 2200, 400, 8000),
      segmentationMaximumTimeMs: parseInteger(process.env.AZURE_SPEECH_SEGMENTATION_MAXIMUM_TIME_MS, 45000, 5000, 120000)
    };
  }

  isConfigured() {
    const config = this.getConfig();
    return Boolean(config.apiKey && config.region);
  }

  buildSpeechConfig(config) {
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
      String(config.segmentationMaximumTimeMs)
    );
    return speechConfig;
  }

  async transcribeWav(audioBuffer) {
    const config = this.getConfig();
    if (!this.isConfigured()) {
      const error = new Error('Azure Speech STT is not configured for the standalone app.');
      error.statusCode = 503;
      error.code = 'STT_NOT_CONFIGURED';
      throw error;
    }
    if (!Buffer.isBuffer(audioBuffer) || audioBuffer.length < 44) {
      const error = new Error('A valid WAV audio payload is required.');
      error.statusCode = 400;
      error.code = 'INVALID_AUDIO';
      throw error;
    }

    const speechConfig = this.buildSpeechConfig(config);
    const audioConfig = sdk.AudioConfig.fromWavFileInput(audioBuffer, 'candidate-response.wav');
    const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
    const durationMs = getWavDurationMs(audioBuffer);
    const timeoutMs = Math.min(240000, Math.max(25000, durationMs * 4 + 15000));

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
        resolve({
          transcript: segments.join(' ').replace(/\s+/g, ' ').trim(),
          language: config.language,
          durationMs
        });
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
          error.code = 'STT_FAILED';
          finish(error);
          return;
        }
        finish();
      };

      recognizer.sessionStopped = () => finish();

      guardTimer = setTimeout(() => {
        const error = new Error('Azure Speech transcription timed out.');
        error.statusCode = 504;
        error.code = 'STT_TIMEOUT';
        finish(error);
      }, timeoutMs);

      recognizer.startContinuousRecognitionAsync(
        () => {},
        (error) => {
          const wrapped = new Error(String(error || 'Azure Speech transcription failed.'));
          wrapped.statusCode = 502;
          wrapped.code = 'STT_FAILED';
          finish(wrapped);
        }
      );
    });
  }
}

module.exports = new AzureSpeechSttService();
