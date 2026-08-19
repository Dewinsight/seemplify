const https = require('https');

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const DELIVERY_BY_MESSAGE_TYPE = {
  greeting: { sentencePauseMs: 340, paragraphPauseMs: 520, trailingPauseMs: 220, rateDelta: -1 },
  question: { sentencePauseMs: 380, paragraphPauseMs: 560, trailingPauseMs: 260, rateDelta: -2 },
  clarification: { sentencePauseMs: 320, paragraphPauseMs: 500, trailingPauseMs: 220, rateDelta: -1 },
  acknowledgement: { sentencePauseMs: 260, paragraphPauseMs: 420, trailingPauseMs: 180, rateDelta: 1 },
  transition: { sentencePauseMs: 300, paragraphPauseMs: 460, trailingPauseMs: 220, rateDelta: 0 },
  system: { sentencePauseMs: 320, paragraphPauseMs: 500, trailingPauseMs: 240, rateDelta: -1 },
  preview: { sentencePauseMs: 340, paragraphPauseMs: 520, trailingPauseMs: 220, rateDelta: -1 },
  default: { sentencePauseMs: 320, paragraphPauseMs: 500, trailingPauseMs: 220, rateDelta: -1 }
};

function normalizeMessageType(value) {
  const type = String(value || '').trim().toLowerCase();
  return DELIVERY_BY_MESSAGE_TYPE[type] ? type : 'default';
}

function normalizeSpokenText(value) {
  let text = String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/```(?:[^\n]*)\n?([\s\S]*?)```/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/[–—]+/g, ', ')
    .replace(/\s+&\s+/g, ' and ')
    .replace(/\s+\/\s+/g, ' or ')
    .replace(/\b(?:e\.g\.|e\.g)\s*/gi, 'for example, ')
    .replace(/\b(?:i\.e\.|i\.e)\s*/gi, 'that is, ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  text = text
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,;:!?])(?=[A-Za-z])/g, '$1 ');

  if (text && !/[.!?]$/.test(text)) text += '.';
  return text;
}

function getBaseRateForVoice(voice) {
  if (/^en-NG-/i.test(String(voice || ''))) return -3;
  if (/(?:DragonHD|MAI-Voice)/i.test(String(voice || ''))) return -1;
  return -2;
}

function pickSpeechRate(configuredRate, voice, messageType) {
  const configured = String(configuredRate || '').trim();
  if (configured && configured.toLowerCase() !== 'default') return configured;
  const delivery = DELIVERY_BY_MESSAGE_TYPE[normalizeMessageType(messageType)];
  const rate = Math.max(-8, Math.min(4, getBaseRateForVoice(voice) + delivery.rateDelta));
  return rate === 0 ? 'default' : `${rate > 0 ? '+' : ''}${rate}%`;
}

function buildSpeechMarkup(value, messageType) {
  const text = normalizeSpokenText(value);
  if (!text) return '';
  const delivery = DELIVERY_BY_MESSAGE_TYPE[normalizeMessageType(messageType)];
  const parts = text.split(/(\n{2,}|[.!?]+(?=\s|$)|[;:]+(?=\s|$))/g);
  const markup = parts.map((part) => {
    if (!part) return '';
    if (/^\n{2,}$/.test(part)) return `<break time='${delivery.paragraphPauseMs}ms'/>`;
    if (/^[.!?]+$/.test(part)) return `${escapeXml(part)}<break time='${delivery.sentencePauseMs}ms'/>`;
    if (/^[;:]+$/.test(part)) return `${escapeXml(part)}<break time='180ms'/>`;
    return escapeXml(part.replace(/\n/g, ' '));
  }).join('');
  return `<break time='80ms'/>${markup}<break time='${delivery.trailingPauseMs}ms'/>`;
}

function normalizeRegion(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

function normalizeEndpoint(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function isEnglishAzureVoice(value) {
  const voice = String(value || '').trim();
  return /^en-[A-Z]{2}[-:]/i.test(voice);
}

function voiceLocale(voice) {
  const match = String(voice || '').trim().match(/^([a-z]{2}-[A-Z]{2})-/i);
  return match?.[1] || '';
}

function pickSpeechLanguage(preferredLanguage, preferredVoice) {
  const configured = preferredLanguage || process.env.AZURE_AI_INTERVIEW_SPEECH_LANGUAGE || process.env.AZURE_SPEECH_LANGUAGE || voiceLocale(preferredVoice) || 'en-NG';
  return /^en(?:-|$)/i.test(String(configured).trim()) ? String(configured).trim() : 'en-US';
}

function pickSpeechVoice(preferredVoice) {
  if (isEnglishAzureVoice(preferredVoice)) {
    return preferredVoice.trim();
  }

  if (isEnglishAzureVoice(process.env.AZURE_AI_INTERVIEW_SPEECH_VOICE)) {
    return process.env.AZURE_AI_INTERVIEW_SPEECH_VOICE.trim();
  }

  if (isEnglishAzureVoice(process.env.AZURE_SPEECH_VOICE)) {
    return process.env.AZURE_SPEECH_VOICE.trim();
  }

  const voiceLiveVoice = process.env.AZURE_VOICELIVE_VOICE || '';
  if (isEnglishAzureVoice(voiceLiveVoice)) {
    return voiceLiveVoice.trim();
  }

  return 'en-NG-EzinneNeural';
}

class AzureSpeechTtsService {
  getConfig(overrides = {}) {
    const region = normalizeRegion(
      process.env.AZURE_SPEECH_REGION ||
      process.env.AZURE_LOCATION ||
      process.env.AZURE_VOICELIVE_REGION ||
      'swedencentral'
    );
    const endpoint = normalizeEndpoint(process.env.AZURE_SPEECH_TTS_ENDPOINT);
    const apiKey = process.env.AZURE_SPEECH_KEY || process.env.AZURE_VOICELIVE_API_KEY;
    const voice = pickSpeechVoice(overrides.voice || overrides.voiceId);
    const language = pickSpeechLanguage(overrides.language, voice);

    return {
      apiKey,
      region,
      endpoint: endpoint || (region ? `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1` : ''),
      voice,
      language,
      outputFormat: process.env.AZURE_SPEECH_OUTPUT_FORMAT || 'audio-24khz-48kbitrate-mono-mp3',
      rate: pickSpeechRate(overrides.rate || process.env.AZURE_SPEECH_RATE, voice, overrides.messageType),
      userAgent: process.env.AZURE_SPEECH_USER_AGENT || 'SeemplifyAIInterviewer'
    };
  }

  isConfigured() {
    const config = this.getConfig();
    return Boolean(config.apiKey && config.endpoint && config.voice && config.language);
  }

  buildSsml(text, overrides = {}) {
    const config = this.getConfig(overrides);
    const speechMarkup = buildSpeechMarkup(text, overrides.messageType);
    const safeVoice = escapeXml(config.voice);
    const safeLanguage = escapeXml(config.language);
    const safeRate = escapeXml(config.rate);

    return [
      `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${safeLanguage}'>`,
      `<voice xml:lang='${safeLanguage}' name='${safeVoice}'>`,
      `<prosody rate='${safeRate}'>${speechMarkup}</prosody>`,
      '</voice>',
      '</speak>'
    ].join('');
  }

  synthesize(text, overrides = {}) {
    const config = this.getConfig(overrides);
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

    const ssml = this.buildSsml(content, overrides);
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
          const contentType = response.headers['content-type'] || 'audio/mpeg';

          if (response.statusCode >= 200 && response.statusCode < 300) {
            // Azure occasionally returns a 200 with a non-audio body (HTML or
            // JSON error pages from edge nodes). Treat that as a failure so
            // the client never tries to "play" static.
            if (!/^audio\//i.test(contentType)) {
              const preview = buffer.toString('utf8').slice(0, 500);
              const error = new Error(`Azure Speech returned non-audio content (${contentType}): ${preview}`);
              error.statusCode = 502;
              error.code = 'TTS_BAD_RESPONSE';
              reject(error);
              return;
            }
            if (buffer.length < 200) {
              const error = new Error(`Azure Speech returned a suspiciously small response (${buffer.length} bytes).`);
              error.statusCode = 502;
              error.code = 'TTS_EMPTY_RESPONSE';
              reject(error);
              return;
            }
            resolve({
              buffer,
              contentType,
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
