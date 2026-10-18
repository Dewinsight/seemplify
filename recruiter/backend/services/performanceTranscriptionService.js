'use strict';

const fs = require('node:fs');

function failure(message, code, statusCode = 503, retryable = false) {
  return Object.assign(new Error(message), { code, statusCode, retryable });
}

function validateWav(audio) {
  if (!Buffer.isBuffer(audio) || audio.length < 44 || audio.length > 1000000 ||
      audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE' ||
      audio.readUInt32LE(4) + 8 !== audio.length) throw new TypeError('A bounded PCM WAV segment is required.');
  let format = false;
  let dataBytes = 0;
  for (let offset = 12; offset + 8 <= audio.length;) {
    const size = audio.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > audio.length) throw new TypeError('The WAV segment is incomplete.');
    const kind = audio.toString('ascii', offset, offset + 4);
    if (kind === 'fmt ') {
      format = size >= 16 && audio.readUInt16LE(start) === 1 && audio.readUInt16LE(start + 2) === 1 &&
        audio.readUInt32LE(start + 4) === 16000 && audio.readUInt32LE(start + 8) === 32000 &&
        audio.readUInt16LE(start + 12) === 2 && audio.readUInt16LE(start + 14) === 16;
      if (!format) throw new TypeError('Use mono 16 kHz, 16-bit PCM WAV audio.');
    }
    if (kind === 'data') dataBytes += size;
    offset = start + size + (size % 2);
  }
  if (!format || !dataBytes || dataBytes > 963200 || dataBytes % 2) throw new TypeError('A PCM WAV segment of at most 30 seconds is required.');
}

async function transcribeWav(audio, { environment = process.env, fetchImpl = fetch } = {}) {
  validateWav(audio);
  let key;
  try {
    key = String(environment.DEEPGRAM_API_KEY_FILE ? fs.readFileSync(environment.DEEPGRAM_API_KEY_FILE, 'utf8') : environment.DEEPGRAM_API_KEY || '').trim();
  } catch { throw failure('Deepgram transcription is not configured.', 'DEEPGRAM_NOT_CONFIGURED'); }
  if (!key || /\s/.test(key)) throw failure('Deepgram transcription is not configured.', 'DEEPGRAM_NOT_CONFIGURED');
  try {
    // Fixed provider URL: callers cannot redirect recorded appraisal audio or credentials.
    const response = await fetchImpl('https://api.deepgram.com/v1/listen?model=nova-3&language=en&smart_format=true&punctuate=true', {
      method: 'POST', headers: { Authorization: `Token ${key}`, 'Content-Type': 'audio/wav' },
      body: audio, redirect: 'error', signal: AbortSignal.timeout(90000)
    });
    if (!response.ok) {
      await response.body?.cancel();
      if ([401, 403].includes(response.status)) throw failure('Deepgram rejected the transcription credentials.', 'DEEPGRAM_AUTH_FAILED');
      throw failure('Deepgram transcription is temporarily unavailable. Retry processing the saved recording.', 'DEEPGRAM_UNAVAILABLE', 503, true);
    }
    let bytes = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > 2000000) throw failure('Deepgram returned an unsupported transcript.', 'DEEPGRAM_INVALID_RESPONSE');
      chunks.push(Buffer.from(chunk));
    }
    let payload;
    try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw failure('Deepgram returned an unsupported transcript.', 'DEEPGRAM_INVALID_RESPONSE'); }
    const transcript = payload?.results?.channels?.[0]?.alternatives?.[0]?.transcript;
    if (typeof transcript !== 'string') throw failure('Deepgram returned an unsupported transcript.', 'DEEPGRAM_INVALID_RESPONSE');
    return transcript.trim().slice(0, 10000);
  } catch (error) {
    if (String(error.code || '').startsWith('DEEPGRAM_')) throw error;
    // Never propagate provider bodies, request headers, or credential-bearing diagnostics.
    throw failure('Deepgram transcription could not finish. Retry processing the saved recording.', 'DEEPGRAM_UNAVAILABLE', 503, true);
  }
}

module.exports = { transcribeWav, validateWav };
