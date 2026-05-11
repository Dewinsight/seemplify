const https = require('https');

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function normalizeRegion(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

function normalizeEndpoint(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function pickSpeechVoice() {
  if (process.env.AZURE_SPEECH_VOICE) {
    return process.env.AZURE_SPEECH_VOICE;
  }

  const voiceLiveVoice = process.env.AZURE_VOICELIVE_VOICE || '';
  if (voiceLiveVoice && !voiceLiveVoice.includes(':')) {
    return voiceLiveVoice;
  }

  return 'en-US-AvaNeural';
}

class AzureSpeechTtsService {
  getConfig() {
    const region = normalizeRegion(
      process.env.AZURE_SPEECH_REGION ||
      process.env.AZURE_LOCATION ||
      process.env.AZURE_VOICELIVE_REGION ||
      'swedencentral'
    );
    const endpoint = normalizeEndpoint(process.env.AZURE_SPEECH_TTS_ENDPOINT);
    const apiKey = process.env.AZURE_SPEECH_KEY || process.env.AZURE_VOICELIVE_API_KEY;
    const language = process.env.AZURE_SPEECH_LANGUAGE || 'en-US';

    return {
      apiKey,
      region,
      endpoint: endpoint || (region ? `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1` : ''),
      voice: pickSpeechVoice(),
      language,
      outputFormat: process.env.AZURE_SPEECH_OUTPUT_FORMAT || 'audio-24khz-48kbitrate-mono-mp3',
      rate: process.env.AZURE_SPEECH_RATE || 'default',
      userAgent: process.env.AZURE_SPEECH_USER_AGENT || 'SeemplifyAIInterviewer'
    };
  }

  isConfigured() {
    const config = this.getConfig();
    return Boolean(config.apiKey && config.endpoint && config.voice && config.language);
  }

  buildSsml(text) {
    const config = this.getConfig();
    const safeText = escapeXml(text);
    const safeVoice = escapeXml(config.voice);
    const safeLanguage = escapeXml(config.language);
    const safeRate = escapeXml(config.rate);

    return [
      `<speak version='1.0' xml:lang='${safeLanguage}'>`,
      `<voice xml:lang='${safeLanguage}' name='${safeVoice}'>`,
      `<prosody rate='${safeRate}'>${safeText}</prosody>`,
      '</voice>',
      '</speak>'
    ].join('');
  }

  synthesize(text) {
    const config = this.getConfig();
    const content = String(text || '').trim();

    if (!this.isConfigured()) {
      const error = new Error('Azure Speech text-to-speech is not configured.');
      error.statusCode = 503;
      error.code = 'TTS_NOT_CONFIGURED';
      throw error;
    }

    if (!content) {
      const error = new Error('Speech text is required.');
      error.statusCode = 400;
      error.code = 'EMPTY_SPEECH_TEXT';
      throw error;
    }

    const ssml = this.buildSsml(content);
    const url = new URL(config.endpoint);

    return new Promise((resolve, reject) => {
      const request = https.request({
        method: 'POST',
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        headers: {
          'Ocp-Apim-Subscription-Key': config.apiKey,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': config.outputFormat,
          'User-Agent': config.userAgent,
          'Content-Length': Buffer.byteLength(ssml)
        }
      }, (response) => {
        const chunks = [];

        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const buffer = Buffer.concat(chunks);
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve({
              buffer,
              contentType: response.headers['content-type'] || 'audio/mpeg',
              outputFormat: config.outputFormat
            });
            return;
          }

          const message = buffer.toString('utf8').slice(0, 500) || 'Azure Speech text-to-speech request failed.';
          const error = new Error(`Azure Speech text-to-speech failed (${response.statusCode}): ${message}`);
          error.statusCode = 502;
          error.code = 'TTS_REQUEST_FAILED';
          reject(error);
        });
      });

      request.on('error', (error) => {
        error.statusCode = 502;
        error.code = 'TTS_REQUEST_FAILED';
        reject(error);
      });

      request.write(ssml);
      request.end();
    });
  }
}

module.exports = new AzureSpeechTtsService();
