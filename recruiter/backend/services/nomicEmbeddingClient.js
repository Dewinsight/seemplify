const crypto = require('node:crypto');
const fs = require('node:fs');
const { requireEmbeddingRuntimeConfig, NOMIC_PROFILE } = require('../config/embeddingRuntimeConfig');
const NOMIC_PREPROCESSING_VERSION = 'recruiter-chunk-mean-v1';
const MAX_CHUNK_CHARACTERS = 1024;
const MAX_INPUT_CHARACTERS = 24000;

function splitEmbeddingText(text) {
  const input = String(text || '').slice(0, MAX_INPUT_CHARACTERS);
  if (!input.trim()) throw new Error('Embedding text is empty.');
  const chunks = [];
  for (let offset = 0; offset < input.length;) {
    let end = Math.min(offset + MAX_CHUNK_CHARACTERS, input.length);
    if (end < input.length) {
      const boundary = input.lastIndexOf(' ', end - 1);
      if (boundary > offset + MAX_CHUNK_CHARACTERS / 2) end = boundary + 1;
    }
    chunks.push(input.slice(offset, end)); offset = end;
  }
  return chunks;
}

function embeddingSourceHash(text) {
  return crypto.createHash('sha256').update(`${NOMIC_PREPROCESSING_VERSION}\0${text}`).digest('hex');
}

async function generateNomicEmbedding(text, { purpose = 'document', fetchImpl = fetch, config = requireEmbeddingRuntimeConfig() } = {}) {
  if (!['document', 'query'].includes(purpose)) throw new Error('Invalid embedding purpose.');
  const chunks = splitEmbeddingText(text);
  const endpoint = new URL(config.url);
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !['http:', 'https:'].includes(endpoint.protocol)) throw new Error('Invalid Nomic endpoint.');
  const secret = fs.readFileSync(config.secretFile, 'utf8').trim();
  if (secret.length < 32) throw new Error('Nomic service credential is unavailable.');
  const signal = AbortSignal.timeout(125000);
  const vectors = [];
  // The shared 2 GiB CPU worker must never receive a whole long CV as one
  // attention sequence. Preserve the existing 24,000-character input budget
  // through bounded chunks and a length-weighted, L2-normalized mean.
  for (let offset = 0; offset < chunks.length; offset += 8) {
    const texts = chunks.slice(offset, offset + 8);
    const body = JSON.stringify({ source: 'recruiter', texts, purpose });
    const timestamp = String(Date.now());
    const nonce = crypto.randomBytes(24).toString('base64url');
    const signature = crypto.createHmac('sha256', secret).update(`${timestamp}\n${nonce}\nPOST\n${endpoint.pathname}\n${body}`).digest('base64url');
    const response = await fetchImpl(endpoint, { method: 'POST', signal,
      headers: { 'content-type': 'application/json', 'x-seemplify-client': 'recruiter-embeddings', 'x-seemplify-timestamp': timestamp, 'x-seemplify-nonce': nonce, 'x-seemplify-signature': signature }, body });
    if (!response.ok) throw Object.assign(new Error(`Local Nomic embedding request failed (HTTP ${response.status}).`), { status: response.status, retryable: [429, 503, 504].includes(response.status) });
    const result = await response.json();
    for (const key of Object.keys(NOMIC_PROFILE)) if (result.profile?.[key] !== NOMIC_PROFILE[key]) throw new Error('Nomic embedding profile mismatch.');
    if (!Array.isArray(result.vectors) || result.vectors.length !== texts.length || result.vectors.some(vector => !Array.isArray(vector) || vector.length !== 768 || vector.some(value => typeof value !== 'number' || !Number.isFinite(value)))) throw new Error('Invalid Nomic embedding vector.');
    vectors.push(...result.vectors);
  }
  const pooled = Array(768).fill(0);
  vectors.forEach((vector, i) => vector.forEach((value, dim) => { pooled[dim] += value * chunks[i].length; }));
  const norm = Math.hypot(...pooled);
  if (!Number.isFinite(norm) || norm <= 0) throw new Error('Invalid Nomic embedding norm.');
  return pooled.map(value => value / norm);
}
module.exports = { generateNomicEmbedding, splitEmbeddingText, embeddingSourceHash, NOMIC_PREPROCESSING_VERSION, MAX_CHUNK_CHARACTERS };
