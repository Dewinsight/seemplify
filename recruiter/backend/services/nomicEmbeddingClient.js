const crypto = require('node:crypto');
const fs = require('node:fs');
const { requireEmbeddingRuntimeConfig, NOMIC_PROFILE } = require('../config/embeddingRuntimeConfig');

async function generateNomicEmbedding(text, { purpose = 'document', fetchImpl = fetch, config = requireEmbeddingRuntimeConfig() } = {}) {
  if (!['document', 'query'].includes(purpose)) throw new Error('Invalid embedding purpose.');
  const body = JSON.stringify({ source: 'recruiter', texts: [String(text || '').slice(0, 24000)], purpose });
  const endpoint = new URL(config.url);
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !['http:', 'https:'].includes(endpoint.protocol)) throw new Error('Invalid Nomic endpoint.');
  const secret = fs.readFileSync(config.secretFile, 'utf8').trim();
  if (secret.length < 32) throw new Error('Nomic service credential is unavailable.');
  const timestamp = String(Date.now());
  const nonce = crypto.randomBytes(24).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${timestamp}\n${nonce}\nPOST\n${endpoint.pathname}\n${body}`).digest('base64url');
  const response = await fetchImpl(endpoint, { method: 'POST', signal: AbortSignal.timeout(125000),
    headers: { 'content-type': 'application/json', 'x-seemplify-client': 'recruiter-embeddings', 'x-seemplify-timestamp': timestamp, 'x-seemplify-nonce': nonce, 'x-seemplify-signature': signature }, body });
  if (!response.ok) throw new Error(`Local Nomic embedding request failed (HTTP ${response.status}).`);
  const result = await response.json();
  for (const key of Object.keys(NOMIC_PROFILE)) {
    if (result.profile?.[key] !== NOMIC_PROFILE[key]) throw new Error('Nomic embedding profile mismatch.');
  }
  const vector = result.vectors?.[0];
  if (result.vectors?.length !== 1 || !Array.isArray(vector) || vector.length !== 768 || vector.some(value => typeof value !== 'number' || !Number.isFinite(value))) throw new Error('Invalid Nomic embedding vector.');
  return vector;
}
module.exports = { generateNomicEmbedding };
