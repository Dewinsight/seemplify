import fs from 'node:fs';
import { parentPort } from 'node:worker_threads';
import profileModule from './embedding-profiles.cjs';

const { EMBEDDING_PROFILES, validateEmbeddingProfile, validateEmbeddingVectors } = profileModule;

if (!parentPort) throw new Error('The GTE embedding worker must run inside a Node worker thread.');

let extractor = null;
let profile = null;
let cacheDir = null;
let loading = null;
let closed = false;

function serializeError(error, fatal = false) {
  return {
    name: error?.name || 'Error',
    code: error?.code || 'GTE_WORKER_ERROR',
    message: String(error?.message || error).slice(0, 2_000),
    retryable: error?.retryable === true,
    fatal,
  };
}

async function initialize(input) {
  if (extractor) return { alreadyLoaded: true, loadMs: 0 };
  if (loading) return loading;
  loading = (async () => {
    const started = performance.now();
    profile = validateEmbeddingProfile(input?.profile || EMBEDDING_PROFILES['gte-node']);
    if (profile.id !== 'gte-node') throw new Error('The GTE worker only accepts the pinned gte-node profile.');
    cacheDir = String(input?.cacheDir || '').trim();
    if (!cacheDir) throw new Error('A persistent GTE model cache directory is required.');
    fs.mkdirSync(cacheDir, { recursive: true });
    const transformers = await import('@huggingface/transformers');
    transformers.env.cacheDir = cacheDir;
    transformers.env.allowRemoteModels = true;
    extractor = await transformers.pipeline('feature-extraction', profile.modelId, {
      revision: profile.revision,
      dtype: profile.dtype,
      device: 'cpu',
    });
    const warmup = await extractor(['Seemplify embedding readiness probe.'], {
      pooling: profile.pooling,
      normalize: profile.normalize,
    });
    const warmupVectors = typeof warmup?.tolist === 'function' ? warmup.tolist() : warmup;
    validateEmbeddingVectors(warmupVectors, { expectedCount: 1, dimension: profile.dimension, normalized: true });
    return { alreadyLoaded: false, loadMs: Math.round(performance.now() - started) };
  })();
  try { return await loading; } finally { loading = null; }
}

async function embed(input) {
  if (!extractor || !profile) throw Object.assign(new Error('The GTE model is not loaded.'), { code: 'GTE_NOT_READY' });
  const texts = Array.isArray(input?.texts) ? input.texts : [];
  if (!texts.length || texts.some((text) => typeof text !== 'string' || !text.trim())) {
    throw Object.assign(new Error('Embedding input must contain non-empty strings.'), { code: 'GTE_INPUT_INVALID' });
  }
  const started = performance.now();
  const output = await extractor(texts, { pooling: profile.pooling, normalize: profile.normalize });
  const vectors = typeof output?.tolist === 'function' ? output.tolist() : output;
  validateEmbeddingVectors(vectors, { expectedCount: texts.length, dimension: profile.dimension, normalized: true });
  return { vectors, inferenceMs: Math.round(performance.now() - started) };
}

async function shutdown() {
  closed = true;
  const current = extractor;
  extractor = null;
  if (current && typeof current.dispose === 'function') await current.dispose();
}

parentPort.on('message', async (message) => {
  if (!message || typeof message !== 'object' || closed) return;
  const requestId = String(message.requestId || '');
  try {
    if (message.type === 'initialize') {
      const result = await initialize(message);
      parentPort.postMessage({ type: 'ready', requestId, profile, cacheDir, ...result });
      return;
    }
    if (message.type === 'embed') {
      const result = await embed(message);
      parentPort.postMessage({ type: 'embedding-result', requestId, ...result });
      return;
    }
    if (message.type === 'shutdown') {
      await shutdown();
      parentPort.postMessage({ type: 'shutdown-complete', requestId });
      parentPort.close();
      return;
    }
    throw Object.assign(new Error(`Unsupported GTE worker message '${String(message.type)}'.`), { code: 'GTE_MESSAGE_INVALID' });
  } catch (error) {
    const fatal = message.type === 'initialize';
    parentPort.postMessage({ type: 'worker-error', requestId, error: serializeError(error, fatal) });
  }
});
