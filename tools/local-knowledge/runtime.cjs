const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { AQL } = require('./aql.cjs');
const { CONFIG } = require('./config.cjs');
const { assertId, assertStagedSource, signRequest, tenantDatabaseName } = require('./auth.cjs');

const COLLECTIONS = Object.freeze([
  ['documents', 2], ['chunks', 2], ['entities', 2], ['claims', 2], ['relations', 3], ['operation_receipts', 2],
]);
const INDEXES = Object.freeze([
  ['documents', ['spaceId', 'knowledgeBaseId', 'documentId', 'indexVersion']],
  ['chunks', ['spaceId', 'knowledgeBaseId', 'indexVersion', 'activeUntil']],
  ['entities', ['spaceId', 'knowledgeBaseId', 'canonicalName']],
  ['operation_receipts', ['spaceId', 'operationId'], true],
]);
const SEARCH_INDEX_NAME = 'chunks_text_inverted';
const SEARCH_VIEW_NAME = 'chunks_search';
const VECTOR_INDEX_NAME = 'chunks_embedding_vector';
const ANALYZER_NAME = 'knowledge_segmentation';
const BENCHMARK_SPACE_PATTERN = /^knowledge-live-benchmark-[a-f0-9]{32}$/;
const BENCHMARK_CLEANUP_CONFIRMATION = 'PURGE_SYNTHETIC_KNOWLEDGE_BENCHMARK';

function runtimeError(message, { code = 'KNOWLEDGE_RUNTIME_ERROR', status = 500, retryable = false } = {}) {
  return Object.assign(new Error(message), { code, status, retryable });
}

function upstreamResponseError(service, response, message) {
  const prefix = String(service || 'upstream').toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  const retryable = response.status === 429 || response.status >= 500;
  return runtimeError(message || `${service} returned HTTP ${response.status}.`, {
    code: retryable ? `${prefix}_UNAVAILABLE` : `${prefix}_REQUEST_REJECTED`,
    status: retryable ? 503 : (response.status === 413 ? 413 : 422),
    retryable,
  });
}

function boundedText(value, max, name, { required = true } = {}) {
  const text = String(value ?? '').replace(/[\u0000\u007f]/g, '').trim();
  if (required && !text) throw runtimeError(`${name} is required.`, { code: 'INVALID_REQUEST', status: 400 });
  if (text.length > max) throw runtimeError(`${name} exceeds its limit.`, { code: 'INVALID_REQUEST', status: 400 });
  return text;
}

function positiveInteger(value, name, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > max) {
    throw runtimeError(`${name} must be a positive integer.`, { code: 'INVALID_REQUEST', status: 400 });
  }
  return number;
}

function stableKey(...parts) {
  return crypto.createHash('sha256').update(parts.map(String).join('\u001f')).digest('hex');
}

function normalizeName(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

function safeMetadata(value) {
  if (value == null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw runtimeError('document.metadata must be an object.', { code: 'INVALID_REQUEST', status: 400 });
  }
  const raw = JSON.stringify(value);
  if (Buffer.byteLength(raw) > 16 * 1024) {
    throw runtimeError('document.metadata is too large.', { code: 'INVALID_REQUEST', status: 400 });
  }
  return JSON.parse(raw);
}

function validateIndexInput(input, config = CONFIG) {
  if (!input || typeof input !== 'object') throw runtimeError('A JSON object is required.', { code: 'INVALID_REQUEST', status: 400 });
  const sourcePath = assertStagedSource(input.document?.sourcePath, config.paths.staging, {
    maxBytes: config.limits.sourceBytes,
  });
  const stat = fs.statSync(sourcePath);
  const sizeBytes = positiveInteger(input.document?.sizeBytes, 'document.sizeBytes', config.limits.sourceBytes);
  if (sizeBytes !== stat.size) throw runtimeError('The staged file size does not match document.sizeBytes.', { code: 'SOURCE_CHANGED', status: 409 });
  const embeddingDimension = positiveInteger(input.knowledgeBase?.embeddingDimension, 'knowledgeBase.embeddingDimension', 10_000);
  if (boundedText(input.knowledgeBase?.embeddingModel, 200, 'knowledgeBase.embeddingModel') !== config.models.embedding.id
      || embeddingDimension !== config.models.embedding.dimension) {
    throw runtimeError('The request does not match the pinned embedding profile.', { code: 'EMBEDDING_PROFILE_MISMATCH', status: 409 });
  }
  const mimeType = boundedText(input.document?.mimeType, 120, 'document.mimeType').toLowerCase();
  if (!config.supportedMimeTypes.includes(mimeType)) {
    throw runtimeError('This document type is not supported by the local knowledge runtime.', { code: 'UNSUPPORTED_DOCUMENT_TYPE', status: 415 });
  }
  return {
    jobId: assertId(input.jobId, 'jobId'),
    spaceId: assertId(input.spaceId, 'spaceId'),
    knowledgeBase: {
      id: assertId(input.knowledgeBase?.id, 'knowledgeBase.id'),
      indexVersion: positiveInteger(input.knowledgeBase?.indexVersion, 'knowledgeBase.indexVersion'),
      embeddingModel: config.models.embedding.id,
      embeddingDimension,
      chunkerVersion: boundedText(input.knowledgeBase?.chunkerVersion, 80, 'knowledgeBase.chunkerVersion'),
    },
    document: {
      id: assertId(input.document?.id, 'document.id'),
      sourcePath,
      originalName: boundedText(input.document?.originalName, 260, 'document.originalName'),
      mimeType,
      sizeBytes,
      sha256: boundedText(input.document?.sha256, 64, 'document.sha256').toLowerCase(),
      metadata: safeMetadata(input.document?.metadata),
    },
  };
}

function validateRetrieveInput(input, config = CONFIG) {
  const references = Array.isArray(input?.knowledgeBases) ? input.knowledgeBases : [];
  if (!references.length || references.length > 5) throw runtimeError('knowledgeBases must contain 1 to 5 pinned bases.', { code: 'INVALID_REQUEST', status: 400 });
  const unique = new Set();
  const knowledgeBases = references.map((reference) => {
    const item = { id: assertId(reference?.id, 'knowledgeBases.id'), indexVersion: positiveInteger(reference?.indexVersion, 'knowledgeBases.indexVersion') };
    if (unique.has(item.id)) throw runtimeError('knowledgeBases contains a duplicate base.', { code: 'INVALID_REQUEST', status: 400 });
    unique.add(item.id);
    return item;
  });
  return {
    requestId: assertId(input.requestId, 'requestId'),
    spaceId: assertId(input.spaceId, 'spaceId'),
    knowledgeBases,
    query: boundedText(input.query, 8_000, 'query'),
    topK: positiveInteger(input.topK, 'topK', config.limits.citations),
    graphDepth: Number.isInteger(Number(input.graphDepth)) && Number(input.graphDepth) >= 0 && Number(input.graphDepth) <= 2
      ? Number(input.graphDepth)
      : (() => { throw runtimeError('graphDepth must be between 0 and 2.', { code: 'INVALID_REQUEST', status: 400 }); })(),
  };
}

function validateDeleteInput(input) {
  return {
    jobId: assertId(input?.jobId, 'jobId'),
    spaceId: assertId(input?.spaceId, 'spaceId'),
    knowledgeBaseId: assertId(input?.knowledgeBaseId, 'knowledgeBaseId'),
    documentId: input?.documentId == null ? null : assertId(input.documentId, 'documentId'),
    indexVersion: input?.indexVersion == null ? null : positiveInteger(input.indexVersion, 'indexVersion'),
  };
}

function validateTestCleanupInput(input) {
  const spaceId = assertId(input?.spaceId, 'spaceId');
  if (input?.source !== 'knowledge-live-benchmark'
      || !BENCHMARK_SPACE_PATTERN.test(spaceId)
      || input?.confirmation !== BENCHMARK_CLEANUP_CONFIRMATION) {
    throw runtimeError('Only a confirmed synthetic live-benchmark tenant can be cleaned up.', { code: 'TEST_CLEANUP_NOT_ALLOWED', status: 403 });
  }
  return { spaceId };
}

function validateGraphInput(input) {
  return {
    requestId: assertId(input?.requestId, 'requestId'),
    spaceId: assertId(input?.spaceId, 'spaceId'),
    knowledgeBaseId: assertId(input?.knowledgeBase?.id || input?.knowledgeBaseId, 'knowledgeBase.id'),
    indexVersion: positiveInteger(input?.knowledgeBase?.indexVersion ?? input?.indexVersion, 'knowledgeBase.indexVersion'),
    limit: positiveInteger(input?.limit || 200, 'limit', 500),
  };
}

class WorkQueue {
  constructor({ maxDepth = 256, limits = { index: 1, retrieve: 2, delete: 1 } } = {}) {
    this.maxDepth = maxDepth;
    this.limits = { graph: 2, ...limits };
    this.pending = [];
    this.active = new Map();
    this.completed = 0;
    this.failed = 0;
    this.oldestWaitStartedAt = null;
  }

  schedule(kind, id, task) {
    if (!Object.hasOwn(this.limits, kind)) return Promise.reject(runtimeError('Unsupported work type.', { status: 400 }));
    if (this.pending.length >= this.maxDepth) return Promise.reject(runtimeError('Knowledge runtime queue is full.', { code: 'QUEUE_FULL', status: 503, retryable: true }));
    return new Promise((resolve, reject) => {
      this.pending.push({ kind, id, task, resolve, reject, queuedAt: Date.now() });
      this.drain();
    });
  }

  drain() {
    for (let index = 0; index < this.pending.length; index += 1) {
      const job = this.pending[index];
      const active = this.active.get(job.kind) || 0;
      if (active >= this.limits[job.kind]) continue;
      this.pending.splice(index, 1);
      index -= 1;
      this.active.set(job.kind, active + 1);
      Promise.resolve().then(job.task).then((value) => {
        this.completed += 1;
        job.resolve(value);
      }, (error) => {
        this.failed += 1;
        job.reject(error);
      }).finally(() => {
        this.active.set(job.kind, Math.max(0, (this.active.get(job.kind) || 1) - 1));
        this.drain();
      });
    }
  }

  snapshot() {
    const now = Date.now();
    return {
      waiting: this.pending.length,
      active: Object.fromEntries(this.active),
      limits: { ...this.limits },
      completed: this.completed,
      failed: this.failed,
      oldestWaitMs: this.pending.length ? Math.max(...this.pending.map((job) => now - job.queuedAt)) : 0,
      jobs: this.pending.slice(0, 20).map((job) => ({ id: job.id, type: job.kind, queuedAt: new Date(job.queuedAt).toISOString() })),
    };
  }
}

class ArangoClient {
  constructor({ baseUrl, username, password, fetchImpl = fetch }) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    this.fetch = fetchImpl;
  }

  async request(database, requestPath, { method = 'GET', body, timeoutMs = 15_000 } = {}) {
    const prefix = database ? `/_db/${encodeURIComponent(database)}` : '';
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}${prefix}${requestPath}`, {
        method,
        headers: { authorization: this.authorization, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw runtimeError(`ArangoDB is unavailable: ${error.message}`, { code: 'ARANGO_UNAVAILABLE', status: 503, retryable: true });
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw runtimeError(payload.errorMessage || `ArangoDB returned HTTP ${response.status}.`, {
      code: 'ARANGO_REQUEST_FAILED', status: response.status === 401 || response.status === 403 ? 503 : response.status, retryable: response.status === 429 || response.status >= 500,
    });
    return payload;
  }

  async query(database, query, bindVars = {}) {
    const declaredBindVars = selectDeclaredBindVars(query, bindVars);
    const payload = await this.request(database, '/_api/cursor', { method: 'POST', body: { query, bindVars: declaredBindVars, batchSize: 1000, count: false }, timeoutMs: 60_000 });
    return payload.result || [];
  }
}

function selectDeclaredBindVars(query, bindVars = {}) {
  const declared = new Set();
  const pattern = /@([A-Za-z_][A-Za-z0-9_]*)/g;
  for (let match = pattern.exec(String(query)); match; match = pattern.exec(String(query))) {
    if (match.index > 0 && query[match.index - 1] === '@') continue;
    declared.add(match[1]);
  }
  const selected = {};
  for (const name of declared) {
    if (!Object.prototype.hasOwnProperty.call(bindVars, name)) {
      throw runtimeError(`AQL query is missing required bind parameter '${name}'.`, { code: 'AQL_BIND_PARAMETER_MISSING', status: 500 });
    }
    selected[name] = bindVars[name];
  }
  return selected;
}

async function ensureTenantDatabase({ provisioner, app, appUser, appPassword, spaceId, prefix }) {
  const database = tenantDatabaseName(spaceId, prefix);
  const listed = await provisioner.request('_system', '/_api/database/user');
  if (!(listed.result || []).includes(database)) {
    try {
      await provisioner.request('_system', '/_api/database', {
        method: 'POST',
        body: { name: database, users: [{ username: appUser, passwd: appPassword, active: true }] },
      });
    } catch (error) {
      if (error.status !== 409) throw error;
    }
  }
  await provisioner.request('_system', `/_api/user/${encodeURIComponent(appUser)}/database/${encodeURIComponent(database)}`, {
    method: 'PUT', body: { grant: 'rw' },
  });
  const current = await app.request(database, '/_api/collection');
  const existing = new Set((current.result || []).map((collection) => collection.name));
  for (const [name, type] of COLLECTIONS) {
    if (!existing.has(name)) await app.request(database, '/_api/collection', { method: 'POST', body: { name, type } });
  }
  for (const [collection, fields, unique = false] of INDEXES) {
    await app.request(database, `/_api/index?collection=${encodeURIComponent(collection)}`, {
      method: 'POST', body: { type: 'persistent', fields, unique, sparse: false },
    });
  }
  const analyzers = await app.request(database, '/_api/analyzer');
  if (!(analyzers.result || []).some((analyzer) => analyzer.name === ANALYZER_NAME || analyzer.name.endsWith(`::${ANALYZER_NAME}`))) {
    await app.request(database, '/_api/analyzer', {
      method: 'POST',
      body: { name: ANALYZER_NAME, type: 'segmentation', properties: { break: 'alpha', case: 'lower' }, features: ['frequency', 'norm', 'position'] },
    });
  }
  const chunkIndexes = await app.request(database, '/_api/index?collection=chunks');
  if (!(chunkIndexes.indexes || []).some((index) => index.name === SEARCH_INDEX_NAME)) {
    await app.request(database, '/_api/index?collection=chunks', {
      method: 'POST',
      body: { type: 'inverted', name: SEARCH_INDEX_NAME, fields: [{ name: 'text', analyzer: ANALYZER_NAME }], includeAllFields: false },
    });
  }
  const views = await app.request(database, '/_api/view');
  if (!(views.result || []).some((view) => view.name === SEARCH_VIEW_NAME)) {
    await app.request(database, '/_api/view', {
      method: 'POST',
      body: { name: SEARCH_VIEW_NAME, type: 'search-alias', indexes: [{ collection: 'chunks', index: SEARCH_INDEX_NAME }] },
    });
  }
  return database;
}

async function vectorIndexState(app, database) {
  const indexes = await app.request(database, '/_api/index?collection=chunks');
  const index = (indexes.indexes || []).find((candidate) => candidate.name === VECTOR_INDEX_NAME);
  if (!index) return { exists: false, ready: false, training: false, mode: 'exact' };
  const trainingState = String(index.trainingState || index.figures?.trainingState || '').toLowerCase() || 'unknown';
  const ready = trainingState === 'ready';
  const training = ['training', 'building', 'loading', 'ingesting'].includes(trainingState) || index.isBuilding === true;
  return { exists: true, ready, training, trainingState, error: index.errorMessage || index.figures?.errorMessage || null, mode: ready ? 'ann' : training ? 'exact-training' : 'exact', progress: index.progress ?? null, id: index.id || null, nLists: Number(index.params?.nLists || 0) || null };
}

async function ensureVectorIndex(app, database, dimension, eligibleCount) {
  let state = await vectorIndexState(app, database);
  if (state.exists || eligibleCount < 100) {
    const trainedAtCount = state.nLists ? Math.max(100, Math.round((state.nLists / 15) ** 2)) : null;
    return { ...state, eligibleCount, minimumTrainingChunks: 100, trainedAtCount, rebuildRecommended: Boolean(trainedAtCount && eligibleCount > trainedAtCount * 4) };
  }
  const nLists = Math.max(1, Math.min(2048, eligibleCount - 1, Math.round(15 * Math.sqrt(eligibleCount))));
  try {
    await app.request(database, '/_api/index?collection=chunks', {
      method: 'POST', timeoutMs: 120_000,
      body: { type: 'vector', name: VECTOR_INDEX_NAME, fields: ['embedding'], params: { metric: 'cosine', dimension, nLists, trainingIterations: 25, defaultNProbe: Math.max(1, Math.min(32, Math.ceil(Math.sqrt(nLists)))) } },
    });
  } catch (error) {
    return { exists: false, ready: false, training: false, mode: 'exact', eligibleCount, minimumTrainingChunks: 100, error: error.message };
  }
  state = await vectorIndexState(app, database);
  return { ...state, eligibleCount, minimumTrainingChunks: 100, trainedAtCount: eligibleCount, rebuildRecommended: false };
}

async function fileSha256(filename) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

function extractDoclingText(payload) {
  const candidates = [
    payload?.document?.md_content, payload?.document?.text_content, payload?.document?.markdown,
    payload?.documents?.[0]?.md_content, payload?.documents?.[0]?.text_content,
    payload?.result?.document?.md_content, payload?.result?.document?.text_content,
  ];
  return candidates.find((value) => typeof value === 'string' && value.trim())?.trim() || '';
}

async function extractDocument(input, { config = CONFIG, fetchImpl = fetch, doclingApiKey }) {
  if (/^(text\/plain|text\/markdown)$/i.test(input.document.mimeType)) {
    return { text: (await fs.promises.readFile(input.document.sourcePath, 'utf8')).slice(0, config.limits.extractedCharacters), pageCount: null };
  }
  const form = new FormData();
  const bytes = await fs.promises.readFile(input.document.sourcePath);
  form.append('files', new Blob([bytes], { type: input.document.mimeType }), input.document.originalName);
  form.append('to_formats', 'md');
  form.append('do_ocr', 'true');
  let response;
  try {
    response = await fetchImpl(`http://${config.host}:${config.ports.docling}/v1/convert/file`, {
      method: 'POST',
      headers: { authorization: `Bearer ${doclingApiKey}`, 'x-api-key': doclingApiKey },
      body: form,
      signal: AbortSignal.timeout(5 * 60_000),
    });
  } catch (error) {
    throw runtimeError(`Docling is unavailable: ${error.message}`, { code: 'DOCLING_UNAVAILABLE', status: 503, retryable: true });
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw upstreamResponseError('docling', response, payload.detail || `Docling returned HTTP ${response.status}.`);
  const text = extractDoclingText(payload).slice(0, config.limits.extractedCharacters);
  if (!text) throw runtimeError('Docling returned no extractable text.', { code: 'EMPTY_DOCUMENT', status: 422 });
  return { text, pageCount: Number(payload?.document?.pages || payload?.pages || 0) || null };
}

function estimateTokens(value) {
  // Deterministic approximation used because the TEI tokenizer is not embedded in this Node service.
  return Math.max(1, Math.ceil(String(value || '').length / 4));
}

function markdownBlocks(text) {
  const blocks = [];
  let section = null;
  let page = null;
  let pending = null;
  const flush = () => { if (pending?.text.trim()) blocks.push(pending); pending = null; };
  for (const match of text.matchAll(/[^\n]*(?:\n|$)/g)) {
    const raw = match[0];
    if (!raw) continue;
    const line = raw.replace(/\r?\n$/, '');
    const start = match.index;
    const pageMatch = line.match(/(?:<!--\s*)?page(?:[_ -]?number)?\s*[:=]\s*(\d+)/i);
    if (pageMatch) page = Number(pageMatch[1]);
    if (line.includes('\f')) page = (page || 0) + 1;
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    const table = /^\s*\|.*\|\s*$/.test(line);
    const blank = !line.trim();
    if (heading) {
      flush();
      section = heading[1].trim().slice(0, 300);
      blocks.push({ text: raw, start, end: start + raw.length, section, page, type: 'heading' });
    } else if (blank) {
      flush();
    } else if (table) {
      if (pending?.type !== 'table') { flush(); pending = { text: '', start, end: start, section, page, type: 'table' }; }
      pending.text += raw; pending.end = start + raw.length;
    } else {
      if (pending?.type !== 'paragraph') { flush(); pending = { text: '', start, end: start, section, page, type: 'paragraph' }; }
      pending.text += raw; pending.end = start + raw.length;
    }
  }
  flush();
  return blocks.flatMap((block) => {
    const maxChars = (CONFIG.limits.chunkMaxTokens - CONFIG.limits.chunkOverlapTokens) * 4;
    if (block.text.length <= maxChars) return [block];
    const split = [];
    for (let offset = 0; offset < block.text.length; offset += maxChars) {
      const value = block.text.slice(offset, offset + maxChars);
      split.push({ ...block, text: value, start: block.start + offset, end: block.start + offset + value.length });
    }
    return split;
  });
}

function chunkText(text, config = CONFIG, { pageCount = null } = {}) {
  const chunks = [];
  const blocks = markdownBlocks(text);
  const target = config.limits.chunkTargetTokens;
  const maximum = config.limits.chunkMaxTokens;
  const overlap = config.limits.chunkOverlapTokens;
  let current = [];
  let tokens = 0;
  const flush = () => {
    if (!current.length) return;
    const start = current[0].start;
    const end = current[current.length - 1].end;
    const value = text.slice(start, end).trim();
    const explicitPage = current.find((block) => Number.isInteger(block.page))?.page || null;
    const estimatedPage = !explicitPage && Number(pageCount) > 0
      ? Math.min(Number(pageCount), Math.floor((start / Math.max(1, text.length)) * Number(pageCount)) + 1)
      : null;
    if (value) {
      const maxCharacters = maximum * 4;
      const stepCharacters = Math.max(4, (maximum - overlap) * 4);
      for (let offset = 0; offset < value.length; offset += stepCharacters) {
        const piece = value.slice(offset, offset + maxCharacters);
        chunks.push({
          text: piece,
          start: start + offset,
          end: start + offset + piece.length,
          section: [...current].reverse().find((block) => block.section)?.section || null,
          page: explicitPage || estimatedPage,
          tokenEstimate: estimateTokens(piece),
          contentHash: stableKey(piece),
        });
        if (offset + maxCharacters >= value.length) break;
      }
    }
    const retained = [];
    let retainedTokens = 0;
    for (let index = current.length - 1; index >= 0 && retainedTokens < overlap; index -= 1) {
      const block = current[index];
      const blockTokens = estimateTokens(block.text);
      const remaining = overlap - retainedTokens;
      if (blockTokens > remaining) {
        const characters = Math.min(block.text.length, remaining * 4);
        retained.unshift({ ...block, text: block.text.slice(-characters), start: block.end - characters, overlap: true });
        retainedTokens += remaining;
      } else {
        retained.unshift({ ...block, overlap: true }); retainedTokens += blockTokens;
      }
    }
    current = retained;
    tokens = retainedTokens;
  };
  for (const block of blocks) {
    const blockTokens = estimateTokens(block.text);
    if (current.length && tokens + blockTokens > maximum) {
      const withoutOverlap = current.filter((item) => !item.overlap);
      const withoutOverlapTokens = withoutOverlap.reduce((total, item) => total + estimateTokens(item.text), 0);
      if (withoutOverlap.length && withoutOverlapTokens + blockTokens <= maximum) {
        current = withoutOverlap; tokens = withoutOverlapTokens;
      } else if (!withoutOverlap.length && blockTokens <= maximum) {
        current = []; tokens = 0;
      } else flush();
    }
    current.push(block); tokens += blockTokens;
    if (tokens >= target) flush();
    if (chunks.length > config.limits.chunksPerDocument) throw runtimeError('The document produces too many chunks.', { code: 'DOCUMENT_TOO_COMPLEX', status: 422 });
  }
  if (current.length && (!chunks.length || current[current.length - 1].end > chunks[chunks.length - 1].end)) flush();
  return chunks;
}

async function embedTexts(texts, { config = CONFIG, fetchImpl = fetch, apiKey }) {
  const vectors = [];
  for (let offset = 0; offset < texts.length; offset += 32) {
    let response;
    try {
      response = await fetchImpl(`http://${config.host}:${config.ports.embedding}/embed`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ inputs: texts.slice(offset, offset + 32), truncate: true }), signal: AbortSignal.timeout(120_000),
      });
    } catch (error) {
      throw runtimeError(`Embedding service is unavailable: ${error.message}`, { code: 'EMBEDDING_UNAVAILABLE', status: 503, retryable: true });
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw upstreamResponseError('embedding', response, `Embedding service returned HTTP ${response.status}.`);
    if (!Array.isArray(payload)) throw runtimeError('Embedding service returned an invalid response.', { code: 'INVALID_EMBEDDING_RESPONSE', status: 422 });
    vectors.push(...payload);
  }
  return vectors;
}

const GRAPH_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false, required: ['entities', 'claims', 'relations'],
  properties: {
    entities: { type: 'array', maxItems: 160, items: { type: 'object', additionalProperties: false, required: ['localId', 'type', 'name', 'aliases', 'mentions'], properties: {
      localId: { type: 'string', maxLength: 80 }, type: { type: 'string', maxLength: 80 }, name: { type: 'string', maxLength: 300 },
      aliases: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 300 } },
      mentions: { type: 'array', minItems: 1, maxItems: 30, items: { type: 'object', additionalProperties: false, required: ['quote', 'start', 'end'], properties: { quote: { type: 'string', maxLength: 700 }, start: { type: 'integer' }, end: { type: 'integer' } } } },
    } } },
    claims: { type: 'array', maxItems: 240, items: { type: 'object', additionalProperties: false, required: ['localId', 'subjectEntityId', 'predicate', 'objectText', 'objectEntityId', 'confidence', 'mentions'], properties: {
      localId: { type: 'string', maxLength: 80 }, subjectEntityId: { type: 'string', maxLength: 80 }, predicate: { type: 'string', maxLength: 160 }, objectText: { type: ['string', 'null'], maxLength: 700 }, objectEntityId: { type: ['string', 'null'], maxLength: 80 }, confidence: { type: 'number', minimum: 0, maximum: 1 },
      mentions: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'object', additionalProperties: false, required: ['quote', 'start', 'end'], properties: { quote: { type: 'string', maxLength: 700 }, start: { type: 'integer' }, end: { type: 'integer' } } } },
    } } },
    relations: { type: 'array', maxItems: 240, items: { type: 'object', additionalProperties: false, required: ['sourceEntityId', 'type', 'targetEntityId', 'confidence', 'mentions'], properties: {
      sourceEntityId: { type: 'string', maxLength: 80 }, type: { type: 'string', maxLength: 160 }, targetEntityId: { type: 'string', maxLength: 80 }, confidence: { type: 'number', minimum: 0, maximum: 1 },
      mentions: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'object', additionalProperties: false, required: ['quote', 'start', 'end'], properties: { quote: { type: 'string', maxLength: 700 }, start: { type: 'integer' }, end: { type: 'integer' } } } },
    } } },
  },
});

function groundedMentions(items, source, windowOffset) {
  return (Array.isArray(items) ? items : []).slice(0, 30).map((mention) => {
    const quote = boundedText(mention?.quote, 700, 'mention.quote');
    let start = Number(mention?.start);
    let end = Number(mention?.end);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || source.slice(start, end) !== quote) {
      start = source.indexOf(quote);
      end = start < 0 ? -1 : start + quote.length;
    }
    if (start < 0) throw runtimeError('Terra returned an ungrounded graph span.', { code: 'UNGROUNDED_GRAPH', status: 422 });
    return { quote, start: start + windowOffset, end: end + windowOffset };
  });
}

async function terraGraphWindow(source, { jobId, windowIndex, windowOffset, fetchImpl = fetch, gatewaySecret, config = CONFIG }) {
  const requestPath = '/v1/complete';
  const eventId = `usage_${stableKey('knowledge-graph', jobId, windowIndex).slice(0, 48)}`;
  const body = JSON.stringify({
    activity: 'experience.knowledge_graph_extract', executionMode: 'local-only', runtimeProfile: 'experience-management', requestSource: 'knowledge-runtime',
    metering: { record: true, eventId, gatewayExecutionId: `localexec_${stableKey(eventId).slice(0, 48)}`, requestId: `${jobId}:${windowIndex}`, sourceApp: 'experience-management' },
    messages: [
      { role: 'system', content: 'Extract only entities, factual claims, and semantic relations explicitly supported by the supplied source. Every item must cite an exact source quote and zero-based start/end offsets relative to this source window. Do not infer missing facts. Keep relation types concise and stable.' },
      { role: 'user', content: `SOURCE WINDOW ${windowIndex}\n${source}` },
    ],
    jsonSchema: GRAPH_SCHEMA, schemaName: 'experience_knowledge_graph_v1', temperature: 0, maxTokens: 8_000,
  });
  const signed = signRequest(gatewaySecret, body, requestPath);
  let response;
  try {
    response = await fetchImpl(`http://${config.host}:11435${requestPath}`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-seemplify-timestamp': signed.timestamp, 'x-seemplify-nonce': signed.nonce, 'x-seemplify-signature': signed.signature },
      body, signal: AbortSignal.timeout(6 * 60_000),
    });
  } catch (error) {
    throw runtimeError(`Terra graph extraction is unavailable: ${error.message}`, { code: 'TERRA_UNAVAILABLE', status: 503, retryable: true });
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw upstreamResponseError('terra_graph', response, payload.message || `Terra returned HTTP ${response.status}.`);
  const result = payload.data;
  if (!result || !Array.isArray(result.entities) || !Array.isArray(result.claims) || !Array.isArray(result.relations)) {
    throw runtimeError('Terra returned an invalid graph payload.', { code: 'INVALID_TERRA_GRAPH', status: 422 });
  }
  const entities = result.entities.slice(0, 160).map((entity) => ({
    localId: assertId(entity.localId, 'entity.localId'), type: boundedText(entity.type, 80, 'entity.type'), name: boundedText(entity.name, 300, 'entity.name'),
    aliases: (Array.isArray(entity.aliases) ? entity.aliases : []).slice(0, 20).map((alias) => boundedText(alias, 300, 'entity.alias')),
    mentions: groundedMentions(entity.mentions, source, windowOffset),
  }));
  const ids = new Set(entities.map((entity) => entity.localId));
  const claims = result.claims.slice(0, 240).filter((claim) => ids.has(claim.subjectEntityId) && (!claim.objectEntityId || ids.has(claim.objectEntityId))).map((claim) => ({
    localId: assertId(claim.localId, 'claim.localId'), subjectEntityId: claim.subjectEntityId, predicate: boundedText(claim.predicate, 160, 'claim.predicate'),
    objectText: claim.objectText == null ? null : boundedText(claim.objectText, 700, 'claim.objectText'), objectEntityId: claim.objectEntityId || null,
    confidence: Math.max(0, Math.min(1, Number(claim.confidence) || 0)), mentions: groundedMentions(claim.mentions, source, windowOffset),
  }));
  const relations = result.relations.slice(0, 240).filter((relation) => ids.has(relation.sourceEntityId) && ids.has(relation.targetEntityId)).map((relation) => ({
    sourceEntityId: relation.sourceEntityId, targetEntityId: relation.targetEntityId, type: boundedText(relation.type, 160, 'relation.type'), confidence: Math.max(0, Math.min(1, Number(relation.confidence) || 0)), mentions: groundedMentions(relation.mentions, source, windowOffset),
  }));
  return { entities, claims, relations, usage: payload.usage || null };
}

async function extractGraph(text, context) {
  const aggregate = { entities: [], claims: [], relations: [], windows: 0 };
  const limit = context.config.limits.graphWindowCharacters;
  for (let offset = 0, index = 0; offset < text.length; offset += limit, index += 1) {
    const source = text.slice(offset, offset + limit);
    const graph = await terraGraphWindow(source, { ...context, windowIndex: index, windowOffset: offset });
    aggregate.entities.push(...graph.entities.map((entity) => ({ ...entity, windowIndex: index })));
    aggregate.claims.push(...graph.claims.map((claim) => ({ ...claim, windowIndex: index })));
    aggregate.relations.push(...graph.relations.map((relation) => ({ ...relation, windowIndex: index })));
    aggregate.windows += 1;
  }
  return aggregate;
}

function canonicalizeGraph(graph, input, chunks) {
  const now = new Date().toISOString();
  const entityMap = new Map();
  const localMap = new Map();
  const enrichMention = (mention) => {
    const chunk = chunks.find((candidate) => mention.start < candidate.end && mention.end > candidate.start);
    return {
      ...mention,
      documentId: input.document.id,
      documentName: input.document.originalName,
      indexVersion: input.knowledgeBase.indexVersion,
      sourceRef: chunk ? `${input.document.id}:${chunk.contentHash}` : input.document.id,
      page: chunk?.page ?? null,
      section: chunk?.section ?? null,
    };
  };
  for (const entity of graph.entities) {
    const canonicalName = normalizeName(entity.name);
    if (!canonicalName) continue;
    const key = stableKey(input.spaceId, input.knowledgeBase.id, entity.type.toLowerCase(), canonicalName);
    localMap.set(`${entity.windowIndex}:${entity.localId}`, key);
    const mentions = entity.mentions.map(enrichMention);
    const existing = entityMap.get(key);
    if (existing) {
      existing.aliases = [...new Set([...existing.aliases, ...entity.aliases])].slice(0, 40);
      existing.mentions.push(...mentions);
    } else {
      entityMap.set(key, { _key: key, spaceId: input.spaceId, knowledgeBaseId: input.knowledgeBase.id, type: entity.type.toLowerCase(), name: entity.name, canonicalName, aliases: entity.aliases, mentions, createdAt: now, updatedAt: now });
    }
  }
  const entities = [...entityMap.values()];
  for (const chunk of chunks) {
    chunk.entityRefs = entities.filter((entity) => entity.mentions.some((mention) => mention.start < chunk.end && mention.end > chunk.start)).map((entity) => entity._key).slice(0, 80);
  }
  const claims = graph.claims.map((claim) => {
    const subject = localMap.get(`${claim.windowIndex}:${claim.subjectEntityId}`);
    const object = claim.objectEntityId ? localMap.get(`${claim.windowIndex}:${claim.objectEntityId}`) : null;
    if (!subject) return null;
    const key = stableKey(input.document.id, input.knowledgeBase.indexVersion, subject, claim.predicate, object || claim.objectText || '', claim.mentions[0]?.start || 0);
    return { _key: key, spaceId: input.spaceId, knowledgeBaseId: input.knowledgeBase.id, documentId: input.document.id, indexVersion: input.knowledgeBase.indexVersion, activeUntil: null, subjectEntityKey: subject, predicate: claim.predicate, objectEntityKey: object, objectText: claim.objectText, confidence: claim.confidence, mentions: claim.mentions.map(enrichMention), createdAt: now, updatedAt: now };
  }).filter(Boolean);
  const relations = graph.relations.map((relation) => {
    const source = localMap.get(`${relation.windowIndex}:${relation.sourceEntityId}`);
    const target = localMap.get(`${relation.windowIndex}:${relation.targetEntityId}`);
    if (!source || !target || source === target) return null;
    const key = stableKey(input.document.id, input.knowledgeBase.indexVersion, source, relation.type, target, relation.mentions[0]?.start || 0);
    return { _key: key, _from: `entities/${source}`, _to: `entities/${target}`, spaceId: input.spaceId, knowledgeBaseId: input.knowledgeBase.id, documentId: input.document.id, documentName: input.document.originalName, indexVersion: input.knowledgeBase.indexVersion, activeUntil: null, type: relation.type, confidence: relation.confidence, mentions: relation.mentions.map(enrichMention), createdAt: now, updatedAt: now };
  }).filter(Boolean);
  return { entities, claims, relations };
}

function cosine(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return -1;
  let dot = 0; let a = 0; let b = 0;
  for (let index = 0; index < left.length; index += 1) { dot += left[index] * right[index]; a += left[index] ** 2; b += right[index] ** 2; }
  return a && b ? dot / Math.sqrt(a * b) : -1;
}

function weightedReciprocalRankFusion(channels, { rankConstant = 60 } = {}) {
  const fused = new Map();
  for (const channel of channels) {
    const weight = Number(channel.weight) || 0;
    (channel.items || []).forEach((item, index) => {
      const key = item._key;
      if (!key) return;
      const current = fused.get(key) || { candidate: item, score: 0, channels: {} };
      const contribution = weight / (rankConstant + index + 1);
      current.score += contribution;
      current.channels[channel.name] = { rank: index + 1, score: Number(item.channelScore || 0), contribution };
      fused.set(key, current);
    });
  }
  return [...fused.values()].sort((left, right) => right.score - left.score);
}

async function rerank(query, candidates, { config = CONFIG, fetchImpl = fetch, apiKey }) {
  if (!candidates.length) return [];
  const ranked = [];
  const batchSize = 16;
  for (let offset = 0; offset < candidates.length; offset += batchSize) {
    const batch = candidates.slice(offset, offset + batchSize);
    let response;
    try {
      response = await fetchImpl(`http://${config.host}:${config.ports.reranker}/rerank`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ query, texts: batch.map((candidate) => candidate.text), truncate: true, raw_scores: false }), signal: AbortSignal.timeout(120_000),
      });
    } catch (error) {
      throw runtimeError(`Reranker is unavailable: ${error.message}`, { code: 'RERANKER_UNAVAILABLE', status: 503, retryable: true });
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw upstreamResponseError('reranker', response, `Reranker returned HTTP ${response.status}.`);
    if (!Array.isArray(payload)) throw runtimeError('Reranker returned an invalid response.', { code: 'INVALID_RERANKER_RESPONSE', status: 422 });
    ranked.push(...payload.map((item) => ({ candidate: batch[Number(item.index)], score: Number(item.score) })).filter((item) => item.candidate && Number.isFinite(item.score)));
  }
  return ranked.sort((left, right) => right.score - left.score);
}

function readSecret(filename) {
  const value = fs.readFileSync(filename, 'utf8').trim();
  if (!value) throw new Error(`Secret file is empty: ${filename}`);
  return value;
}

function normalizePurgeCounts(value) {
  return Object.fromEntries(['documents', 'chunks', 'claims', 'relations'].map((name) => [name, Number(value?.[name] || 0)]));
}

async function purgeKnowledgeEvidence(app, database, variables) {
  const [before = {}] = await app.query(database, AQL.purgeTargetCounts, variables);
  await app.query(database, AQL.purgeRelations, variables);
  await app.query(database, AQL.purgeClaims, variables);
  await app.query(database, AQL.purgeChunks, variables);
  await app.query(database, AQL.purgeDocuments, variables);
  await app.query(database, AQL.pruneEntityMentions, variables);
  await app.query(database, AQL.removeUnsupportedEntities, variables);
  await app.query(database, AQL.purgeIndexReceipts, variables);
  const [remaining = {}] = await app.query(database, AQL.purgeTargetCounts, variables);
  const remainingCounts = normalizePurgeCounts(remaining);
  if (Object.values(remainingCounts).some((count) => count !== 0)) {
    throw runtimeError('Physical knowledge purge verification failed.', { code: 'KNOWLEDGE_PURGE_INCOMPLETE', status: 503, retryable: true });
  }
  return { removed: normalizePurgeCounts(before), remaining: remainingCounts, verified: true };
}

function createKnowledgeRuntime(options = {}) {
  const config = options.config || CONFIG;
  const fetchImpl = options.fetchImpl || fetch;
  const secret = (name) => options.secrets?.[name] || readSecret(path.join(config.paths.secrets, name));
  const appPassword = secret('arango-app');
  const provisionerPassword = secret('arango-provisioner');
  const gatewaySecret = secret('llm-service');
  const embeddingApiKey = secret('tei-api');
  const doclingApiKey = secret('docling-api');
  const baseUrl = `http://${config.host}:${config.ports.arango}`;
  const app = options.appClient || new ArangoClient({ baseUrl, username: config.database.appUser, password: appPassword, fetchImpl });
  const provisioner = options.provisionerClient || new ArangoClient({ baseUrl, username: config.database.provisionerUser, password: provisionerPassword, fetchImpl });
  const queue = options.queue || new WorkQueue({ maxDepth: config.limits.queueDepth });
  const tenantPromises = new Map();
  const indexStates = new Map();
  const tenant = (spaceId) => {
    const database = tenantDatabaseName(spaceId, config.database.prefix);
    if (!tenantPromises.has(database)) {
      const promise = ensureTenantDatabase({ provisioner, app, appUser: config.database.appUser, appPassword, spaceId, prefix: config.database.prefix })
        .catch((error) => { tenantPromises.delete(database); throw error; });
      tenantPromises.set(database, promise);
    }
    return tenantPromises.get(database);
  };

  async function index(rawInput) {
    const input = validateIndexInput(rawInput, config);
    return queue.schedule('index', input.jobId, async () => {
      const started = Date.now();
      const database = await tenant(input.spaceId);
      const existing = await app.query(database, AQL.findReceipt, { spaceId: input.spaceId, operationId: input.jobId });
      if (existing[0]?.response) return existing[0].response;
      if (await fileSha256(input.document.sourcePath) !== input.document.sha256) throw runtimeError('The staged file checksum changed.', { code: 'SOURCE_CHANGED', status: 409 });
      const extracted = await (options.extractDocument || extractDocument)(input, { config, fetchImpl, doclingApiKey });
      const chunks = chunkText(extracted.text, config, { pageCount: extracted.pageCount });
      const vectors = await (options.embedTexts || embedTexts)(chunks.map((chunk) => chunk.text), { config, fetchImpl, apiKey: embeddingApiKey });
      if (vectors.length !== chunks.length || vectors.some((vector) => !Array.isArray(vector) || vector.length !== config.models.embedding.dimension)) {
        throw runtimeError('Embedding dimensions do not match the pinned profile.', { code: 'INVALID_EMBEDDING_RESPONSE', status: 422 });
      }
      const graph = await (options.extractGraph || extractGraph)(extracted.text, { jobId: input.jobId, config, fetchImpl, gatewaySecret });
      const canonical = canonicalizeGraph(graph, input, chunks);
      const now = new Date().toISOString();
      const revisionKey = stableKey(input.document.id, input.knowledgeBase.indexVersion);
      await app.query(database, AQL.closeDocumentRevision, { spaceId: input.spaceId, knowledgeBaseId: input.knowledgeBase.id, documentId: input.document.id, indexVersion: input.knowledgeBase.indexVersion, now });
      await app.query(database, AQL.closeChunkRevision, { spaceId: input.spaceId, knowledgeBaseId: input.knowledgeBase.id, documentId: input.document.id, indexVersion: input.knowledgeBase.indexVersion, now });
      await app.query(database, AQL.closeClaimRevision, { spaceId: input.spaceId, knowledgeBaseId: input.knowledgeBase.id, documentId: input.document.id, indexVersion: input.knowledgeBase.indexVersion, now });
      await app.query(database, AQL.closeRelationRevision, { spaceId: input.spaceId, knowledgeBaseId: input.knowledgeBase.id, documentId: input.document.id, indexVersion: input.knowledgeBase.indexVersion, now });
      await app.query(database, AQL.pruneEntityMentions, { spaceId: input.spaceId, knowledgeBaseId: input.knowledgeBase.id, documentId: input.document.id, now });
      await app.query(database, AQL.upsertDocument, { key: revisionKey, document: { _key: revisionKey, spaceId: input.spaceId, knowledgeBaseId: input.knowledgeBase.id, documentId: input.document.id, documentName: input.document.originalName, mimeType: input.document.mimeType, sizeBytes: input.document.sizeBytes, sha256: input.document.sha256, metadata: input.document.metadata, indexVersion: input.knowledgeBase.indexVersion, embeddingModel: input.knowledgeBase.embeddingModel, embeddingDimension: input.knowledgeBase.embeddingDimension, chunkerVersion: input.knowledgeBase.chunkerVersion, activeUntil: null, pageCount: extracted.pageCount, createdAt: now, updatedAt: now } });
      const records = chunks.map((chunk, index) => ({ _key: stableKey(revisionKey, chunk.contentHash, index), spaceId: input.spaceId, knowledgeBaseId: input.knowledgeBase.id, documentId: input.document.id, documentName: input.document.originalName, indexVersion: input.knowledgeBase.indexVersion, ordinal: index, text: chunk.text, contentHash: chunk.contentHash, tokenEstimate: chunk.tokenEstimate, start: chunk.start, end: chunk.end, section: chunk.section, page: chunk.page, entityRefs: chunk.entityRefs || [], embedding: vectors[index], activeUntil: null, createdAt: now, updatedAt: now }));
      await app.query(database, AQL.upsertChunks, { chunks: records });
      if (canonical.entities.length) await app.query(database, AQL.upsertEntities, { entities: canonical.entities });
      if (canonical.claims.length) await app.query(database, AQL.upsertClaims, { claims: canonical.claims });
      if (canonical.relations.length) await app.query(database, AQL.upsertRelations, { relations: canonical.relations });
      await app.query(database, AQL.removeUnsupportedEntities, { spaceId: input.spaceId, knowledgeBaseId: input.knowledgeBase.id, documentId: input.document.id, now });
      const [counts = {}] = await app.query(database, AQL.collectionCounts);
      const vectorIndex = await ensureVectorIndex(app, database, config.models.embedding.dimension, Number(counts.chunks || 0));
      indexStates.set(database, vectorIndex);
      const response = { document: { pageCount: extracted.pageCount, chunkCount: chunks.length, entityCount: canonical.entities.length, relationshipCount: canonical.relations.length, language: null }, metrics: { durationMs: Date.now() - started, graphWindows: graph.windows, claimCount: canonical.claims.length, relationCount: canonical.relations.length, embeddingModel: config.models.embedding.id, embeddingDimension: config.models.embedding.dimension, rerankerModel: config.models.reranker.id, vectorIndex } };
      const receiptKey = stableKey(input.spaceId, input.jobId);
      await app.query(database, AQL.upsertReceipt, { key: receiptKey, receipt: { _key: receiptKey, spaceId: input.spaceId, knowledgeBaseId: input.knowledgeBase.id, documentId: input.document.id, operationId: input.jobId, type: 'index', response, completedAt: new Date().toISOString() } });
      return response;
    });
  }

  async function retrieve(rawInput) {
    const input = validateRetrieveInput(rawInput, config);
    return queue.schedule('retrieve', input.requestId, async () => {
      const started = Date.now();
      const database = await tenant(input.spaceId);
      const [queryVector] = await (options.embedTexts || embedTexts)([input.query], { config, fetchImpl, apiKey: embeddingApiKey });
      const watermarkByBase = Object.fromEntries(input.knowledgeBases.map((base) => [base.id, base.indexVersion]));
      const common = { spaceId: input.spaceId, knowledgeBaseIds: input.knowledgeBases.map((base) => base.id), watermarkByBase, candidateLimit: config.limits.candidateChunks, analyzer: `${database}::${ANALYZER_NAME}` };
      const timings = {};
      const timed = async (name, work) => {
        const channelStarted = Date.now();
        try { return await work(); } finally { timings[`${name}Ms`] = Date.now() - channelStarted; }
      };
      const [eligibleCount = 0] = await timed('eligibility', () => app.query(database, AQL.eligibleChunkCount, common));
      const vectorIndex = await ensureVectorIndex(app, database, config.models.embedding.dimension, Number(eligibleCount));
      indexStates.set(database, vectorIndex);
      let vectorMode = vectorIndex.ready ? 'ann' : 'exact';
      let vectorItems;
      try {
        vectorItems = await timed('vector', () => app.query(database, vectorIndex.ready ? AQL.annVectorChunks : AQL.exactVectorChunks, {
          ...common, queryVector, annProbeLimit: Math.min(1_000, config.limits.candidateChunks * 5),
        }));
      } catch (error) {
        if (!vectorIndex.ready) throw error;
        vectorMode = 'exact-fallback';
        vectorItems = await timed('vectorFallback', () => app.query(database, AQL.exactVectorChunks, { ...common, queryVector }));
      }
      const lexicalItems = await timed('lexical', () => app.query(database, AQL.lexicalChunks, { ...common, query: input.query }));
      let seedKeys = [];
      let graphKeys = [];
      let graphItems = [];
      if (input.graphDepth > 0) {
        seedKeys = await timed('graphSeed', () => app.query(database, AQL.entitySeeds, { ...common, query: input.query, seedLimit: 24 }));
        if (seedKeys.length) {
          const traversalQuery = input.graphDepth === 2 ? AQL.graphNeighbors2 : AQL.graphNeighbors1;
          const neighbors = await timed('graphTraversal', () => app.query(database, traversalQuery, { ...common, seedKeys, minConfidence: 0.55, breadth: 80 }));
          graphKeys = [...new Set([...seedKeys, ...neighbors])].slice(0, 100);
          graphItems = await timed('graphEvidence', () => app.query(database, AQL.graphChunks, { ...common, entityKeys: graphKeys }));
        }
      }
      const fused = weightedReciprocalRankFusion([
        { name: 'vector', weight: 0.45, items: vectorItems },
        { name: 'lexical', weight: 0.30, items: lexicalItems },
        { name: 'graph', weight: 0.25, items: graphItems },
      ]).slice(0, 80);
      const reranked = await timed('reranker', () => (options.rerank || rerank)(input.query, fused.map((item) => item.candidate), { config, fetchImpl, apiKey: embeddingApiKey }));
      const fusedByKey = new Map(fused.map((item) => [item.candidate._key, item]));
      const ranked = reranked.map((item) => {
        const fusion = fusedByKey.get(item.candidate._key);
        const boundedReranker = 1 / (1 + Math.exp(-Number(item.score || 0)));
        return { ...item, fusion, finalScore: (0.7 * boundedReranker) + (0.3 * Math.min(1, (fusion?.score || 0) * 60)) };
      }).sort((left, right) => right.finalScore - left.finalScore);
      const citations = ranked.slice(0, input.topK).map(({ candidate, finalScore, fusion }) => ({
        sourceRef: `${candidate.documentId}:${candidate._key}`, knowledgeBaseId: candidate.knowledgeBaseId, documentId: candidate.documentId, documentName: candidate.documentName,
        excerpt: String(candidate.text || '').slice(0, config.limits.excerptCharacters), page: candidate.page ?? undefined, section: candidate.section ?? undefined,
        score: Math.round(finalScore * 1_000_000) / 1_000_000, entityRefs: input.graphDepth > 0 ? (candidate.entityRefs || []).slice(0, 40) : undefined,
        channels: Object.keys(fusion?.channels || {}),
      }));
      return { citations, metrics: {
        durationMs: Date.now() - started, eligibleCount: Number(eligibleCount), rerankedCount: fused.length, graphDepth: input.graphDepth,
        channels: { vector: vectorItems.length, lexical: lexicalItems.length, graph: graphItems.length, graphSeeds: seedKeys.length, graphEntities: graphKeys.length },
        timings, vectorIndex: { ...vectorIndex, mode: vectorMode }, fusion: 'weighted-rrf+local-reranker', tenantIsolation: 'database-per-space',
      } };
    });
  }

  async function remove(rawInput) {
    const input = validateDeleteInput(rawInput);
    return queue.schedule('delete', input.jobId, async () => {
      const database = await tenant(input.spaceId);
      const existing = await app.query(database, AQL.findReceipt, { spaceId: input.spaceId, operationId: input.jobId });
      if (existing[0]?.response) return existing[0].response;
      let indexVersion = input.indexVersion;
      if (indexVersion == null) [indexVersion] = await app.query(database, AQL.nextIndexVersion, { spaceId: input.spaceId, knowledgeBaseId: input.knowledgeBaseId });
      const now = new Date().toISOString();
      const vars = { spaceId: input.spaceId, knowledgeBaseId: input.knowledgeBaseId, documentId: input.documentId, indexVersion, now };
      const purge = await purgeKnowledgeEvidence(app, database, vars);
      indexStates.delete(database);
      const response = { deleted: true, physicallyPurged: true, indexVersion, documentId: input.documentId, removed: purge.removed, metrics: { tenantIsolation: 'database-per-space', purgeVerified: purge.verified } };
      const receiptKey = stableKey(input.spaceId, input.jobId);
      await app.query(database, AQL.upsertReceipt, { key: receiptKey, receipt: { _key: receiptKey, spaceId: input.spaceId, knowledgeBaseId: input.knowledgeBaseId, documentId: input.documentId, operationId: input.jobId, type: 'delete', response, completedAt: now } });
      return response;
    });
  }

  async function cleanupTestTenant(rawInput) {
    const input = validateTestCleanupInput(rawInput);
    const database = tenantDatabaseName(input.spaceId, config.database.prefix);
    return queue.schedule('delete', `cleanup:${input.spaceId}`, async () => {
      const listed = await provisioner.request('_system', '/_api/database/user');
      if (!(listed.result || []).includes(database)) {
        tenantPromises.delete(database);
        indexStates.delete(database);
        return { cleaned: true, dropped: false, scope: 'synthetic-live-benchmark-tenant' };
      }
      await provisioner.request('_system', `/_api/database/${encodeURIComponent(database)}`, { method: 'DELETE', timeoutMs: 120_000 });
      tenantPromises.delete(database);
      indexStates.delete(database);
      return { cleaned: true, dropped: true, scope: 'synthetic-live-benchmark-tenant' };
    });
  }

  async function graph(rawInput) {
    const input = validateGraphInput(rawInput);
    return queue.schedule('graph', input.requestId, async () => {
      const started = Date.now();
      const database = await tenant(input.spaceId);
      const [snapshot = { nodes: [], edges: [] }] = await app.query(database, AQL.graphSnapshot, {
        spaceId: input.spaceId, knowledgeBaseId: input.knowledgeBaseId, indexVersion: input.indexVersion,
        limit: input.limit, edgeLimit: Math.min(2_000, input.limit * 6),
      });
      return {
        nodes: (snapshot.nodes || []).map((node) => ({ id: node._key, type: node.type, name: node.name, aliases: node.aliases || [], supportingSourceCount: Number(node.supportingSourceCount || 0) })),
        edges: snapshot.edges || [],
        metrics: { durationMs: Date.now() - started, indexVersion: input.indexVersion, truncated: (snapshot.nodes || []).length >= input.limit, tenantIsolation: 'database-per-space' },
      };
    });
  }

  async function status() {
    const services = {};
    const checks = [
      ['arango', `${baseUrl}/_api/version`, { authorization: provisioner.authorization }],
      ['embedding', `http://${config.host}:${config.ports.embedding}/health`, { authorization: `Bearer ${embeddingApiKey}` }],
      ['reranker', `http://${config.host}:${config.ports.reranker}/health`, { authorization: `Bearer ${embeddingApiKey}` }],
      ['docling', `http://${config.host}:${config.ports.docling}/health`, { authorization: `Bearer ${doclingApiKey}`, 'x-api-key': doclingApiKey }],
      ['terra', `http://${config.host}:11435/health`, {}],
    ];
    await Promise.all(checks.map(async ([name, url, headers]) => {
      const started = Date.now();
      try {
        const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(3_000) });
        services[name] = { healthy: response.ok, statusCode: response.status, latencyMs: Date.now() - started };
      } catch (error) { services[name] = { healthy: false, statusCode: null, latencyMs: Date.now() - started, error: error.message }; }
    }));
    let tenantDatabases = null;
    try { tenantDatabases = ((await provisioner.request('_system', '/_api/database/user')).result || []).filter((name) => name.startsWith(config.database.prefix)).length; } catch {}
    const vectorIndexes = [...indexStates.values()];
    const ready = Object.values(services).every((service) => service.healthy);
    return { ready, healthy: ready, checkedAt: new Date().toISOString(), pid: process.pid, uptimeSeconds: Math.round(process.uptime()), tenantIsolation: 'database-per-space', tenantDatabases, models: config.models, uploadMaxBytes: config.limits.sourceBytes, supportedMimeTypes: config.supportedMimeTypes, maxKnowledgeBasesPerQuery: 5, maxGraphDepth: 2, search: { lexical: 'arangosearch-bm25', vector: vectorIndexes.some((item) => item.ready) ? 'ann+exact-fallback' : 'exact-fallback', vectorIndexes: { observedTenants: vectorIndexes.length, ready: vectorIndexes.filter((item) => item.ready).length, training: vectorIndexes.filter((item) => item.training).length } }, services, queue: queue.snapshot() };
  }

  return { index, retrieve, remove, graph, status, cleanupTestTenant, queue, tenantDatabaseName: (spaceId) => tenantDatabaseName(spaceId, config.database.prefix) };
}

module.exports = {
  ArangoClient, BENCHMARK_CLEANUP_CONFIRMATION, BENCHMARK_SPACE_PATTERN, GRAPH_SCHEMA, WorkQueue, canonicalizeGraph, chunkText, createKnowledgeRuntime, ensureTenantDatabase,
  extractDocument, extractGraph, groundedMentions, purgeKnowledgeEvidence, rerank, runtimeError, selectDeclaredBindVars, upstreamResponseError, validateDeleteInput, validateGraphInput, validateIndexInput, validateRetrieveInput, validateTestCleanupInput,
  vectorIndexState, weightedReciprocalRankFusion,
};
