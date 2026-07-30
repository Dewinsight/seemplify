const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { monitorEventLoopDelay } = require('node:perf_hooks');
const { AQL } = require('./aql.cjs');
const { CONFIG } = require('./config.cjs');
const { assertId, assertStagedSource, signRequest, tenantDatabaseName } = require('./auth.cjs');
const { EmbeddingMigrationController } = require('./migration-controller.cjs');

const COLLECTIONS = Object.freeze([
  ['documents', 2], ['chunks', 2], ['experience_chunks_gte_v1', 2], ['entities', 2], ['claims', 2], ['relations', 3], ['operation_receipts', 2],
]);
const INDEXES = Object.freeze([
  ['documents', ['spaceId', 'knowledgeBaseId', 'documentId', 'indexVersion']],
  ['chunks', ['spaceId', 'knowledgeBaseId', 'indexVersion', 'activeUntil']],
  ['experience_chunks_gte_v1', ['spaceId', 'knowledgeBaseId', 'indexVersion', 'activeUntil']],
  ['entities', ['spaceId', 'knowledgeBaseId', 'canonicalName']],
  ['operation_receipts', ['spaceId', 'operationId'], true],
]);
const SEARCH_INDEX_NAME = 'chunks_text_inverted';
const SEARCH_VIEW_NAME = 'chunks_search';
const VECTOR_INDEX_NAME = 'chunks_embedding_vector';
const GTE_VECTOR_INDEX_NAME = 'experience_chunks_gte_v1_vector';
const GTE_COLLECTION_NAME = 'experience_chunks_gte_v1';
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

function canonicalJson(value) {
  const normalize = (item) => {
    if (Array.isArray(item)) return item.map(normalize);
    if (!item || typeof item !== 'object') return item;
    return Object.fromEntries(Object.keys(item).sort().map((key) => [key, normalize(item[key])]));
  };
  return JSON.stringify(normalize(value));
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

function embeddingProfiles(config = CONFIG) {
  return Object.freeze({
    'qwen-tei': Object.freeze({
      provider: 'qwen-tei', model: config.models.embedding.id, revision: config.models.embedding.revision,
      dtype: 'float16', dimensions: config.models.embedding.dimension, vectorIndexVersion: 'qwen-v1',
      collection: 'chunks', vectorIndexName: VECTOR_INDEX_NAME,
    }),
    'gte-node': Object.freeze({
      provider: 'gte-node', model: config.models.gteEmbedding.id, revision: config.models.gteEmbedding.revision,
      dtype: config.models.gteEmbedding.dtype, dimensions: config.models.gteEmbedding.dimension,
      vectorIndexVersion: config.models.gteEmbedding.vectorIndexVersion,
      collection: GTE_COLLECTION_NAME, vectorIndexName: GTE_VECTOR_INDEX_NAME,
    }),
  });
}

function embeddingProfileContract(profile) {
  return {
    provider: profile.provider,
    model: profile.model,
    revision: profile.revision,
    dtype: profile.dtype,
    dimensions: profile.dimensions,
    vectorIndexVersion: profile.vectorIndexVersion,
  };
}

function resolveEmbeddingProfile(value, config = CONFIG, { fallback = 'qwen-tei' } = {}) {
  const profiles = embeddingProfiles(config);
  const provider = typeof value === 'string' ? value : (value?.provider || fallback);
  const profile = profiles[provider];
  if (!profile) throw runtimeError('The embedding provider is not supported.', { code: 'EMBEDDING_PROFILE_MISMATCH', status: 409 });
  if (value && typeof value === 'object') {
    const checks = [
      ['model', profile.model], ['revision', profile.revision], ['dtype', profile.dtype],
      ['dimensions', profile.dimensions], ['vectorIndexVersion', profile.vectorIndexVersion],
    ];
    for (const [name, expected] of checks) {
      if (value[name] != null && String(value[name]) !== String(expected)) {
        throw runtimeError(`The ${name} does not match the pinned ${provider} profile.`, { code: 'EMBEDDING_PROFILE_MISMATCH', status: 409 });
      }
    }
  }
  return profile;
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
  const embeddingModel = boundedText(input.knowledgeBase?.embeddingModel, 200, 'knowledgeBase.embeddingModel');
  const inferredProvider = Object.values(embeddingProfiles(config)).find((profile) => profile.model === embeddingModel && profile.dimensions === embeddingDimension)?.provider;
  const primaryEmbeddingProfile = resolveEmbeddingProfile(input.knowledgeBase?.embeddingProfile || inferredProvider || 'qwen-tei', config);
  if (embeddingModel !== primaryEmbeddingProfile.model || embeddingDimension !== primaryEmbeddingProfile.dimensions) {
    throw runtimeError('The request does not match the pinned embedding profile.', { code: 'EMBEDDING_PROFILE_MISMATCH', status: 409 });
  }
  const targetEmbeddingProfilesExplicit = Array.isArray(input.knowledgeBase?.targetEmbeddingProfiles);
  const requestedTargets = targetEmbeddingProfilesExplicit
    ? input.knowledgeBase.targetEmbeddingProfiles
    : [primaryEmbeddingProfile];
  if (!requestedTargets.length || requestedTargets.length > 2) {
    throw runtimeError('targetEmbeddingProfiles must contain one or two profiles.', { code: 'INVALID_REQUEST', status: 400 });
  }
  const targetEmbeddingProfiles = requestedTargets.map((profile) => resolveEmbeddingProfile(profile, config));
  if (new Set(targetEmbeddingProfiles.map((profile) => profile.provider)).size !== targetEmbeddingProfiles.length) {
    throw runtimeError('targetEmbeddingProfiles contains a duplicate provider.', { code: 'INVALID_REQUEST', status: 400 });
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
      embeddingModel,
      embeddingDimension,
      embeddingProfile: primaryEmbeddingProfile,
      targetEmbeddingProfiles,
      targetEmbeddingProfilesExplicit,
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
  const embeddingProfileExplicit = input?.embeddingProfile != null;
  const requestedProfile = resolveEmbeddingProfile(input?.embeddingProfile || 'qwen-tei', config);
  const knowledgeBases = references.map((reference) => {
    const referenceProfileExplicit = reference?.embeddingProfile != null;
    const referenceProfile = referenceProfileExplicit ? resolveEmbeddingProfile(reference.embeddingProfile, config) : requestedProfile;
    if (referenceProfile.provider !== requestedProfile.provider || referenceProfile.vectorIndexVersion !== requestedProfile.vectorIndexVersion) {
      throw runtimeError('Every selected knowledge base must use the same embedding profile as the query.', { code: 'MIXED_EMBEDDING_SPACES', status: 409 });
    }
    const item = { id: assertId(reference?.id, 'knowledgeBases.id'), indexVersion: positiveInteger(reference?.indexVersion, 'knowledgeBases.indexVersion'), embeddingProfile: referenceProfile, embeddingProfileExplicit: referenceProfileExplicit };
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
    embeddingProfile: requestedProfile,
    embeddingProfileExplicit,
    evaluation: input?.evaluation === true,
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

function validateBackfillInput(input, config = CONFIG) {
  const documentId = input?.documentId == null ? null : assertId(input.documentId, 'documentId');
  const sourceIndexVersion = input?.sourceIndexVersion == null ? null
    : positiveInteger(input.sourceIndexVersion, 'sourceIndexVersion');
  if (documentId && sourceIndexVersion == null) {
    throw runtimeError('sourceIndexVersion is required for a document backfill.', { code: 'INVALID_REQUEST', status: 400 });
  }
  const sourceSha256 = boundedText(input?.sourceSha256, 64, 'sourceSha256').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sourceSha256)) {
    throw runtimeError('sourceSha256 must be a lowercase SHA-256 digest.', { code: 'INVALID_REQUEST', status: 400 });
  }
  const sourceEmbeddingProfile = resolveEmbeddingProfile(input?.sourceEmbeddingProfile, config);
  const embeddingProfile = resolveEmbeddingProfile(input?.embeddingProfile, config);
  if (sourceEmbeddingProfile.provider !== 'qwen-tei' || embeddingProfile.provider !== 'gte-node') {
    throw runtimeError('Backfill must migrate the pinned Qwen profile into the pinned GTE profile.', { code: 'EMBEDDING_PROFILE_MISMATCH', status: 409 });
  }
  if (canonicalJson(input?.sourceEmbeddingProfile) !== canonicalJson(embeddingProfileContract(sourceEmbeddingProfile))
      || canonicalJson(input?.embeddingProfile) !== canonicalJson(embeddingProfileContract(embeddingProfile))) {
    throw runtimeError('Backfill embedding profiles must match the complete pinned contracts exactly.', { code: 'EMBEDDING_PROFILE_MISMATCH', status: 409 });
  }
  return {
    jobId: assertId(input?.jobId, 'jobId'),
    spaceId: assertId(input?.spaceId, 'spaceId'),
    knowledgeBaseId: input?.knowledgeBaseId == null ? null : assertId(input.knowledgeBaseId, 'knowledgeBaseId'),
    documentId,
    sourceIndexVersion,
    sourceSha256,
    sourceChunkerVersion: boundedText(input?.sourceChunkerVersion, 80, 'sourceChunkerVersion'),
    sourceEmbeddingProfile,
    embeddingProfile,
    afterKey: input?.afterKey == null || input.afterKey === '' ? '' : boundedText(input.afterKey, 128, 'afterKey'),
    batchSize: positiveInteger(input?.batchSize || 32, 'batchSize', 128),
  };
}

function validateMigrationControlInput(input) {
  const source = boundedText(input?.source, 80, 'source');
  if (!['experience-management', 'control-center'].includes(source)) {
    throw runtimeError('A recognized migration control source is required.', { code: 'INVALID_REQUEST', status: 400 });
  }
  const action = boundedText(input?.action || 'status', 40, 'action').toLowerCase();
  if (!['status', 'pause', 'resume'].includes(action)) {
    throw runtimeError('Migration action must be status, pause, or resume.', { code: 'INVALID_REQUEST', status: 400 });
  }
  return { source, action, reason: action === 'pause' ? boundedText(input?.reason || 'manual-pause', 200, 'reason') : null };
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
  constructor({
    maxDepth = 256,
    limits = { index: 1, retrieve: 8, delete: 1, backfill: 1 },
    groups = { index: 'document-mutation', backfill: 'document-mutation', delete: 'document-mutation' },
    groupLimits = { 'document-mutation': 1 },
  } = {}) {
    this.maxDepth = maxDepth;
    this.limits = { graph: 2, ...limits };
    this.groups = { ...groups };
    this.groupLimits = { ...groupLimits };
    this.pending = [];
    this.active = new Map();
    this.activeGroups = new Map();
    this.completed = 0;
    this.failed = 0;
    this.oldestWaitStartedAt = null;
    this.accepting = true;
    this.closeWaiters = [];
  }

  schedule(kind, id, task) {
    if (!this.accepting) return Promise.reject(runtimeError('Knowledge runtime is shutting down.', { code: 'RUNTIME_DRAINING', status: 503, retryable: true }));
    if (!Object.hasOwn(this.limits, kind)) return Promise.reject(runtimeError('Unsupported work type.', { status: 400 }));
    if (this.pending.length >= this.maxDepth) return Promise.reject(runtimeError('Knowledge runtime queue is full.', { code: 'QUEUE_FULL', status: 503, retryable: true }));
    return new Promise((resolve, reject) => {
      const job = { kind, id, task, resolve, reject, queuedAt: Date.now() };
      if (kind === 'backfill') this.pending.push(job);
      else {
        const firstBackfill = this.pending.findIndex((candidate) => candidate.kind === 'backfill');
        if (firstBackfill === -1) this.pending.push(job);
        else this.pending.splice(firstBackfill, 0, job);
      }
      this.drain();
    });
  }

  drain() {
    for (let index = 0; index < this.pending.length; index += 1) {
      const job = this.pending[index];
      const active = this.active.get(job.kind) || 0;
      if (active >= this.limits[job.kind]) continue;
      const group = this.groups[job.kind];
      if (group && (this.activeGroups.get(group) || 0) >= (this.groupLimits[group] || 1)) continue;
      this.pending.splice(index, 1);
      index -= 1;
      this.active.set(job.kind, active + 1);
      if (group) this.activeGroups.set(group, (this.activeGroups.get(group) || 0) + 1);
      Promise.resolve().then(job.task).then((value) => {
        this.completed += 1;
        job.resolve(value);
      }, (error) => {
        this.failed += 1;
        job.reject(error);
      }).finally(() => {
        this.active.set(job.kind, Math.max(0, (this.active.get(job.kind) || 1) - 1));
        if (group) this.activeGroups.set(group, Math.max(0, (this.activeGroups.get(group) || 1) - 1));
        this.drain();
        this.notifyDrained();
      });
    }
  }

  notifyDrained() {
    if (this.pending.length || [...this.active.values()].some((count) => count > 0)) return;
    for (const resolve of this.closeWaiters.splice(0)) resolve();
  }

  async close({ timeoutMs = 30_000, force = false } = {}) {
    this.accepting = false;
    if (force) {
      const error = runtimeError('Knowledge runtime stopped before queued work started.', { code: 'RUNTIME_STOPPED', status: 503, retryable: true });
      for (const job of this.pending.splice(0)) job.reject(error);
    }
    if (!this.pending.length && ![...this.active.values()].some((count) => count > 0)) return;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(runtimeError('Knowledge runtime drain timed out.', { code: 'DRAIN_TIMEOUT', status: 503, retryable: true })), timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
      this.closeWaiters.push(() => { clearTimeout(timer); resolve(); });
    });
  }

  snapshot() {
    const now = Date.now();
    return {
      waiting: this.pending.length,
      accepting: this.accepting,
      active: Object.fromEntries(this.active),
      activeGroups: Object.fromEntries(this.activeGroups),
      limits: { ...this.limits },
      groupLimits: { ...this.groupLimits },
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

async function vectorIndexState(app, database, { collection = 'chunks', indexName = VECTOR_INDEX_NAME } = {}) {
  const indexes = await app.request(database, `/_api/index?collection=${encodeURIComponent(collection)}`);
  const index = (indexes.indexes || []).find((candidate) => candidate.name === indexName);
  if (!index) return { exists: false, ready: false, training: false, mode: 'exact' };
  const trainingState = String(index.trainingState || index.figures?.trainingState || '').toLowerCase() || 'unknown';
  const ready = trainingState === 'ready';
  const training = ['training', 'building', 'loading', 'ingesting'].includes(trainingState) || index.isBuilding === true;
  return { exists: true, ready, training, trainingState, error: index.errorMessage || index.figures?.errorMessage || null, mode: ready ? 'ann' : training ? 'exact-training' : 'exact', progress: index.progress ?? null, id: index.id || null, nLists: Number(index.params?.nLists || 0) || null };
}

async function ensureVectorIndex(app, database, dimension, eligibleCount, { collection = 'chunks', indexName = VECTOR_INDEX_NAME } = {}) {
  let state = await vectorIndexState(app, database, { collection, indexName });
  if (state.exists || eligibleCount < 100) {
    const trainedAtCount = state.nLists ? Math.max(100, Math.round((state.nLists / 15) ** 2)) : null;
    return { ...state, eligibleCount, minimumTrainingChunks: 100, trainedAtCount, rebuildRecommended: Boolean(trainedAtCount && eligibleCount > trainedAtCount * 4) };
  }
  const nLists = Math.max(1, Math.min(2048, eligibleCount - 1, Math.round(15 * Math.sqrt(eligibleCount))));
  try {
    await app.request(database, `/_api/index?collection=${encodeURIComponent(collection)}`, {
      method: 'POST', timeoutMs: 120_000,
      body: { type: 'vector', name: indexName, fields: ['embedding'], storedValues: ['spaceId', 'knowledgeBaseId', 'indexVersion'], params: { metric: 'cosine', dimension, nLists, trainingIterations: 25, defaultNProbe: Math.max(1, Math.min(32, Math.ceil(Math.sqrt(nLists)))) } },
    });
  } catch (error) {
    return { exists: false, ready: false, training: false, mode: 'exact', eligibleCount, minimumTrainingChunks: 100, error: error.message };
  }
  state = await vectorIndexState(app, database, { collection, indexName });
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
        body: JSON.stringify({ query, texts: batch.map((candidate) => candidate.text), truncate: true, raw_scores: true }), signal: AbortSignal.timeout(120_000),
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

function normalizeRawRerankerScore(score) {
  const numeric = Number(score);
  if (!Number.isFinite(numeric)) return 0;
  if (numeric >= 0) return 1 / (1 + Math.exp(-numeric));
  const exponential = Math.exp(numeric);
  return exponential / (1 + exponential);
}

function blendRetrievalScore(rawRerankerScore, fusionScore) {
  const boundedReranker = normalizeRawRerankerScore(rawRerankerScore);
  const boundedFusion = Math.min(1, Math.max(0, Number(fusionScore) || 0) * 60);
  return (0.7 * boundedReranker) + (0.3 * boundedFusion);
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
  const [gteBefore = 0] = await app.query(database, AQL.purgeGteTargetCount, variables);
  await app.query(database, AQL.purgeRelations, variables);
  await app.query(database, AQL.purgeClaims, variables);
  await app.query(database, AQL.purgeChunks, variables);
  await app.query(database, AQL.purgeGteChunks, variables);
  await app.query(database, AQL.purgeDocuments, variables);
  await app.query(database, AQL.pruneEntityMentions, variables);
  await app.query(database, AQL.removeUnsupportedEntities, variables);
  await app.query(database, AQL.purgeIndexReceipts, variables);
  const [remaining = {}] = await app.query(database, AQL.purgeTargetCounts, variables);
  const [gteRemaining = 0] = await app.query(database, AQL.purgeGteTargetCount, variables);
  const remainingCounts = normalizePurgeCounts(remaining);
  if (Object.values(remainingCounts).some((count) => count !== 0) || Number(gteRemaining || 0) !== 0) {
    throw runtimeError('Physical knowledge purge verification failed.', { code: 'KNOWLEDGE_PURGE_INCOMPLETE', status: 503, retryable: true });
  }
  return {
    removed: normalizePurgeCounts(before), remaining: remainingCounts, verified: true,
    embeddingProfiles: { qwen: Number(before.chunks || 0), gte: Number(gteBefore || 0), gteRemaining: Number(gteRemaining || 0) },
  };
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
  const migrationConfig = config.embeddingMigration || {};
  const migrationStatePath = config.paths?.migrationState || null;
  let persistedMigrationState = null;
  if (!options.migrationController && migrationStatePath) {
    try { persistedMigrationState = JSON.parse(fs.readFileSync(migrationStatePath, 'utf8')); } catch {}
  }
  const migration = options.migrationController || new EmbeddingMigrationController({
    provider: migrationConfig.provider || 'qwen-tei',
    rolloutPercent: migrationConfig.rolloutPercent || 0,
    shadowPercent: migrationConfig.shadowPercent || 0,
  });
  if (persistedMigrationState?.paused === true) migration.pause(persistedMigrationState.pauseReason || 'persisted-operating-gate');
  function persistMigrationState() {
    if (!migrationStatePath || options.migrationController) return;
    const state = migration.status();
    fs.mkdirSync(path.dirname(migrationStatePath), { recursive: true });
    const temporary = `${migrationStatePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ paused: state.paused, pauseReason: state.pauseReason, pausedAt: state.pausedAt, updatedAt: new Date().toISOString() }), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, migrationStatePath);
  }
  function recordMigration(sample) {
    const before = migration.status();
    const after = migration.record(sample);
    if (before.paused !== after.paused || before.pauseReason !== after.pauseReason) persistMigrationState();
    return after;
  }
  const eventLoopDelay = options.eventLoopDelay || monitorEventLoopDelay({ resolution: 20 });
  if (typeof eventLoopDelay.enable === 'function') eventLoopDelay.enable();
  let gteClient = options.gteClient || null;
  let gteStartPromise = null;
  const shadowDiagnostics = [];
  const shadowTasks = new Set();
  let shadowActive = 0;
  const providerMetrics = {
    'qwen-tei': { embeddings: 0, texts: 0, failures: 0, totalMs: 0 },
    'gte-node': { embeddings: 0, texts: 0, failures: 0, totalMs: 0 },
  };
  let previousCpu = process.cpuUsage();
  let previousCpuAt = Date.now();

  async function ensureGteClient() {
    if (!gteClient) {
      const { createGteEmbeddingClient } = require('./gte-embedding-client.cjs');
      gteClient = createGteEmbeddingClient({
        cacheDir: migrationConfig.cacheDir || path.join(config.paths.models, 'transformers'),
        maxLogicalConcurrency: migrationConfig.concurrency || 8,
        maxQueueDepth: migrationConfig.queueDepth || config.limits.queueDepth,
        requestTimeoutMs: migrationConfig.timeoutMs || 120_000,
      });
    }
    if (!gteStartPromise) gteStartPromise = Promise.resolve(gteClient.start()).catch((error) => { gteStartPromise = null; throw error; });
    await gteStartPromise;
    return gteClient;
  }

  async function embedForProfile(profile, texts, { priority = 'live-index', requestId = crypto.randomUUID() } = {}) {
    const started = Date.now();
    const metrics = providerMetrics[profile.provider];
    try {
      let vectors;
      if (options.embedByProfile) {
        vectors = await options.embedByProfile(profile, texts, { priority, requestId });
      } else if (profile.provider === 'qwen-tei') {
        vectors = await (options.embedTexts || embedTexts)(texts, { config, fetchImpl, apiKey: embeddingApiKey });
      } else {
        const client = await ensureGteClient();
        vectors = [];
        for (let offset = 0; offset < texts.length; offset += 32) {
          const result = await client.embed(texts.slice(offset, offset + 32), { priority, requestId: `${requestId}:${offset}`, timeoutMs: migrationConfig.timeoutMs || 120_000 });
          vectors.push(...result.vectors);
        }
      }
      if (!Array.isArray(vectors) || vectors.length !== texts.length || vectors.some((vector) => !Array.isArray(vector) || vector.length !== profile.dimensions || vector.some((value) => !Number.isFinite(Number(value))))) {
        throw runtimeError(`Embedding dimensions do not match the pinned ${profile.provider} profile.`, { code: 'INVALID_EMBEDDING_RESPONSE', status: 422 });
      }
      metrics.embeddings += 1;
      metrics.texts += texts.length;
      metrics.totalMs += Date.now() - started;
      return vectors;
    } catch (error) {
      metrics.failures += 1;
      metrics.totalMs += Date.now() - started;
      throw error;
    }
  }

  async function gteCoverage(database, input) {
    const profile = embeddingProfiles(config)['gte-node'];
    const watermarkByBase = Object.fromEntries(input.knowledgeBases.map((base) => [base.id, base.indexVersion]));
    const coverage = await app.query(database, AQL.gteCoverageByBase, {
      spaceId: input.spaceId,
      knowledgeBaseIds: input.knowledgeBases.map((base) => base.id),
      watermarkByBase,
      embeddingProvider: profile.provider,
      embeddingModel: profile.model,
      embeddingRevision: profile.revision,
      embeddingDtype: profile.dtype,
      embeddingDimensions: profile.dimensions,
      vectorIndexVersion: profile.vectorIndexVersion,
    });
    return { complete: coverage.length === input.knowledgeBases.length && coverage.every((base) => base.complete === true), bases: coverage };
  }
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
      const targets = [...input.knowledgeBase.targetEmbeddingProfiles];
      if (!input.knowledgeBase.targetEmbeddingProfilesExplicit && migrationConfig.dualWrite && !targets.some((profile) => profile.provider === 'gte-node')) targets.push(embeddingProfiles(config)['gte-node']);
      if (!targets.some((profile) => profile.provider === 'qwen-tei')) {
        throw runtimeError('Qwen must remain a target during the configured rollback window.', { code: 'QWEN_ROLLBACK_PROFILE_REQUIRED', status: 409 });
      }
      const vectorsByProvider = new Map();
      for (const profile of targets) {
        vectorsByProvider.set(profile.provider, await embedForProfile(profile, chunks.map((chunk) => chunk.text), { priority: 'live-index', requestId: `${input.jobId}:${profile.provider}` }));
      }
      const graph = await (options.extractGraph || extractGraph)(extracted.text, { jobId: input.jobId, config, fetchImpl, gatewaySecret });
      const canonical = canonicalizeGraph(graph, input, chunks);
      const now = new Date().toISOString();
      const revisionKey = stableKey(input.document.id, input.knowledgeBase.indexVersion);
      const receiptKey = stableKey(input.spaceId, input.jobId);
      const canonicalClaims = canonical.claims.map((item) => ({ ...item, receiptKey, operationId: input.jobId }));
      const canonicalRelations = canonical.relations.map((item) => ({ ...item, receiptKey, operationId: input.jobId }));
      const closeVariables = { spaceId: input.spaceId, knowledgeBaseId: input.knowledgeBase.id, documentId: input.document.id, indexVersion: input.knowledgeBase.indexVersion, receiptKey, now };
      await app.query(database, AQL.closeDocumentRevision, closeVariables);
      await app.query(database, AQL.closeChunkRevision, closeVariables);
      await app.query(database, AQL.closeGteChunkRevision, closeVariables);
      await app.query(database, AQL.closeClaimRevision, closeVariables);
      await app.query(database, AQL.closeRelationRevision, closeVariables);
      await app.query(database, AQL.pruneEntityMentions, { spaceId: input.spaceId, knowledgeBaseId: input.knowledgeBase.id, documentId: input.document.id, now });
      await app.query(database, AQL.upsertDocument, { key: revisionKey, document: { _key: revisionKey, spaceId: input.spaceId, knowledgeBaseId: input.knowledgeBase.id, documentId: input.document.id, documentName: input.document.originalName, mimeType: input.document.mimeType, sizeBytes: input.document.sizeBytes, sha256: input.document.sha256, metadata: input.document.metadata, indexVersion: input.knowledgeBase.indexVersion, embeddingModel: input.knowledgeBase.embeddingModel, embeddingDimension: input.knowledgeBase.embeddingDimension, chunkerVersion: input.knowledgeBase.chunkerVersion, receiptKey, operationId: input.jobId, activeUntil: null, pageCount: extracted.pageCount, createdAt: now, updatedAt: now } });
      const qwenProfile = embeddingProfiles(config)['qwen-tei'];
      const baseRecords = chunks.map((chunk, index) => ({ _key: stableKey(revisionKey, chunk.contentHash, index), spaceId: input.spaceId, knowledgeBaseId: input.knowledgeBase.id, documentId: input.document.id, documentName: input.document.originalName, indexVersion: input.knowledgeBase.indexVersion, ordinal: index, text: chunk.text, contentHash: chunk.contentHash, sourceSha256: input.document.sha256, receiptKey, operationId: input.jobId, tokenEstimate: chunk.tokenEstimate, start: chunk.start, end: chunk.end, section: chunk.section, page: chunk.page, entityRefs: chunk.entityRefs || [], activeUntil: null, createdAt: now, updatedAt: now }));
      const records = baseRecords.map((record, index) => ({ ...record, embedding: vectorsByProvider.get('qwen-tei')[index], embeddingProvider: qwenProfile.provider, embeddingModel: qwenProfile.model, embeddingRevision: qwenProfile.revision, embeddingDtype: qwenProfile.dtype, embeddingDimensions: qwenProfile.dimensions, vectorIndexVersion: qwenProfile.vectorIndexVersion }));
      await app.query(database, AQL.upsertChunks, { chunks: records });
      if (vectorsByProvider.has('gte-node')) {
        const gteProfile = embeddingProfiles(config)['gte-node'];
        const gteRecords = baseRecords.map((record, index) => ({ ...record, embedding: vectorsByProvider.get('gte-node')[index], embeddingProvider: gteProfile.provider, embeddingModel: gteProfile.model, embeddingRevision: gteProfile.revision, embeddingDtype: gteProfile.dtype, embeddingDimensions: gteProfile.dimensions, vectorIndexVersion: gteProfile.vectorIndexVersion }));
        await app.query(database, AQL.upsertGteChunks, { chunks: gteRecords });
      }
      if (canonical.entities.length) await app.query(database, AQL.upsertEntities, { entities: canonical.entities });
      if (canonicalClaims.length) await app.query(database, AQL.upsertClaims, { claims: canonicalClaims });
      if (canonicalRelations.length) await app.query(database, AQL.upsertRelations, { relations: canonicalRelations });
      await app.query(database, AQL.removeUnsupportedEntities, { spaceId: input.spaceId, knowledgeBaseId: input.knowledgeBase.id, documentId: input.document.id, now });
      const [counts = {}] = await app.query(database, AQL.collectionCounts);
      const vectorIndexes = {};
      vectorIndexes.qwen = await ensureVectorIndex(app, database, qwenProfile.dimensions, Number(counts.chunks || 0), { collection: qwenProfile.collection, indexName: qwenProfile.vectorIndexName });
      indexStates.set(`${database}:qwen-tei`, vectorIndexes.qwen);
      if (vectorsByProvider.has('gte-node')) {
        const gteProfile = embeddingProfiles(config)['gte-node'];
        const [gteCount = 0] = await app.query(database, AQL.gteCollectionCount);
        vectorIndexes.gte = Number(gteCount || 0) === Number(counts.chunks || 0)
          ? await ensureVectorIndex(app, database, gteProfile.dimensions, Number(gteCount || 0), { collection: gteProfile.collection, indexName: gteProfile.vectorIndexName })
          : { exists: false, ready: false, training: false, mode: 'exact', eligibleCount: Number(gteCount || 0), deferredUntilBackfillComplete: true };
        indexStates.set(`${database}:gte-node`, vectorIndexes.gte);
      }
      const response = { document: { pageCount: extracted.pageCount, chunkCount: chunks.length, entityCount: canonical.entities.length, relationshipCount: canonical.relations.length, language: null }, metrics: { durationMs: Date.now() - started, graphWindows: graph.windows, claimCount: canonical.claims.length, relationCount: canonical.relations.length, embeddingModel: input.knowledgeBase.embeddingProfile.model, embeddingDimension: input.knowledgeBase.embeddingProfile.dimensions, embeddingProfiles: targets.map((profile) => ({ provider: profile.provider, model: profile.model, revision: profile.revision, dtype: profile.dtype, dimensions: profile.dimensions, vectorIndexVersion: profile.vectorIndexVersion })), rerankerModel: config.models.reranker.id, vectorIndex: input.knowledgeBase.embeddingProfile.provider === 'gte-node' ? vectorIndexes.gte : vectorIndexes.qwen, vectorIndexes } };
      await app.query(database, AQL.upsertReceipt, { key: receiptKey, receipt: { _key: receiptKey, spaceId: input.spaceId, knowledgeBaseId: input.knowledgeBase.id, documentId: input.document.id, operationId: input.jobId, type: 'index', response, completedAt: new Date().toISOString() } });
      return response;
    });
  }

  async function backfill(rawInput) {
    const input = validateBackfillInput(rawInput, config);
    return queue.schedule('backfill', input.jobId, async () => {
      const started = Date.now();
      const database = await tenant(input.spaceId);
      const profile = embeddingProfiles(config)['gte-node'];
      const sourceProfile = embeddingProfiles(config)['qwen-tei'];
      const profileVariables = {
        embeddingProvider: profile.provider,
        embeddingModel: profile.model,
        embeddingRevision: profile.revision,
        embeddingDtype: profile.dtype,
        embeddingDimensions: profile.dimensions,
        vectorIndexVersion: profile.vectorIndexVersion,
      };
      const sourceProfileVariables = {
        sourceEmbeddingProvider: sourceProfile.provider,
        sourceEmbeddingModel: sourceProfile.model,
        sourceEmbeddingRevision: sourceProfile.revision,
        sourceEmbeddingDtype: sourceProfile.dtype,
        sourceEmbeddingDimensions: sourceProfile.dimensions,
        sourceVectorIndexVersion: sourceProfile.vectorIndexVersion,
      };
      const candidateVariables = {
        spaceId: input.spaceId,
        knowledgeBaseId: input.knowledgeBaseId,
        documentId: input.documentId,
        sourceIndexVersion: input.sourceIndexVersion,
        sourceSha256: input.sourceSha256,
        sourceChunkerVersion: input.sourceChunkerVersion,
        afterKey: input.afterKey,
        batchSize: input.batchSize,
        ...profileVariables,
        ...sourceProfileVariables,
      };
      const [sourceDocument] = await app.query(database, AQL.gteBackfillSourceDocument, candidateVariables);
      if (!sourceDocument) {
        throw runtimeError('The pinned Qwen source document no longer matches the queued backfill snapshot.', {
          code: 'BACKFILL_SOURCE_INVALID', status: 409, retryable: false,
        });
      }
      const normalizeCoverage = (value = {}) => {
        const canonicalCount = Math.max(0, Number(value.canonicalCount) || 0);
        const validSourceCount = Math.max(0, Number(value.validSourceCount) || 0);
        const validTargetCount = Math.max(0, Number(value.validTargetCount) || 0);
        const targetCount = Math.max(0, Number(value.targetCount) || 0);
        return {
          canonicalCount, validSourceCount, validTargetCount, targetCount,
          exact: value.exact === true && canonicalCount === validSourceCount
            && validSourceCount === validTargetCount && validTargetCount === targetCount,
        };
      };
      const [rawSourceCoverage = {}] = await app.query(database, AQL.gteBackfillCoverage, candidateVariables);
      const sourceCoverage = normalizeCoverage(rawSourceCoverage);
      if (sourceCoverage.validSourceCount !== sourceCoverage.canonicalCount) {
        throw runtimeError('The canonical Qwen chunk set does not match the pinned source profile and document snapshot.', {
          code: 'BACKFILL_SOURCE_INVALID', status: 409, retryable: false,
        });
      }
      if (sourceCoverage.targetCount > sourceCoverage.canonicalCount) {
        throw runtimeError('The GTE target contains chunks outside the canonical source manifest.', {
          code: 'BACKFILL_TARGET_INVALID', status: 409, retryable: false,
        });
      }
      let candidates = await app.query(database, AQL.gteBackfillCandidates, candidateVariables);
      let cursorWrapped = false;
      if (!candidates.length && input.afterKey) {
        candidates = await app.query(database, AQL.gteBackfillCandidates, { ...candidateVariables, afterKey: '' });
        cursorWrapped = true;
      }
      let written = 0;
      let nextAfterKey = input.afterKey;
      if (candidates.length) {
        if (new Set(candidates.map((chunk) => chunk._key)).size !== candidates.length
            || candidates.some((chunk) => !chunk.contentHash || !chunk.sourceSha256)) {
          throw runtimeError('Canonical backfill metadata is incomplete or duplicated.', { code: 'BACKFILL_SOURCE_INVALID', status: 409, retryable: false });
        }
        const vectors = await embedForProfile(profile, candidates.map((chunk) => chunk.text), { priority: 'backfill', requestId: input.jobId });
        const now = new Date().toISOString();
        const records = candidates.map((chunk, index) => ({
          ...chunk,
          embedding: vectors[index],
          embeddingProvider: profile.provider,
          embeddingModel: profile.model,
          embeddingRevision: profile.revision,
          embeddingDtype: profile.dtype,
          embeddingDimensions: profile.dimensions,
          vectorIndexVersion: profile.vectorIndexVersion,
          backfilledAt: now,
          updatedAt: now,
        }));
        const writtenKeys = await app.query(database, AQL.upsertGteBackfillChunks, {
          chunks: records,
          sourceIndexVersion: input.sourceIndexVersion,
          sourceSha256: input.sourceSha256,
          sourceChunkerVersion: input.sourceChunkerVersion,
          ...sourceProfileVariables,
        });
        written = writtenKeys.length;
        nextAfterKey = records[records.length - 1]._key;
      }
      const [rawCoverage = {}] = await app.query(database, AQL.gteBackfillCoverage, candidateVariables);
      const coverage = normalizeCoverage(rawCoverage);
      if (coverage.validSourceCount !== coverage.canonicalCount) {
        throw runtimeError('The canonical Qwen chunk set changed during backfill.', {
          code: 'BACKFILL_SOURCE_INVALID', status: 409, retryable: false,
        });
      }
      if (coverage.targetCount > coverage.canonicalCount) {
        throw runtimeError('The GTE target contains chunks outside the canonical source manifest.', {
          code: 'BACKFILL_TARGET_INVALID', status: 409, retryable: false,
        });
      }
      const remaining = Math.max(0, coverage.canonicalCount - coverage.validTargetCount);
      let vectorIndex = { exists: false, ready: false, training: false, mode: 'exact', deferredUntilBackfillComplete: Number(remaining || 0) > 0 };
      if (Number(remaining || 0) === 0) {
        const [tenantRemaining = 0] = await app.query(database, AQL.gteBackfillRemaining, {
          spaceId: input.spaceId,
          knowledgeBaseId: null,
          documentId: null,
          sourceIndexVersion: null,
          sourceSha256: null,
          sourceChunkerVersion: null,
          ...profileVariables,
          ...sourceProfileVariables,
        });
        if (Number(tenantRemaining || 0) === 0) {
          const [gteCount = 0] = await app.query(database, AQL.gteCollectionCount);
          vectorIndex = await ensureVectorIndex(app, database, profile.dimensions, Number(gteCount || 0), { collection: profile.collection, indexName: profile.vectorIndexName });
          indexStates.set(`${database}:gte-node`, vectorIndex);
        } else {
          vectorIndex = { ...vectorIndex, deferredUntilTenantBackfillComplete: true, tenantRemaining: Number(tenantRemaining || 0) };
        }
      }
      const sourceEmbeddingProfile = embeddingProfileContract(input.sourceEmbeddingProfile);
      const embeddingProfile = embeddingProfileContract(input.embeddingProfile);
      const issuedAt = new Date().toISOString();
      const attestationPayload = {
        version: 1,
        jobId: input.jobId,
        spaceId: input.spaceId,
        knowledgeBaseId: input.knowledgeBaseId,
        documentId: input.documentId,
        sourceIndexVersion: input.sourceIndexVersion,
        sourceSha256: input.sourceSha256,
        sourceChunkerVersion: input.sourceChunkerVersion,
        sourceEmbeddingProfile,
        embeddingProfile,
        afterKeyBefore: input.afterKey,
        afterKeyAfter: nextAfterKey,
        processed: candidates.length,
        written,
        remaining: Number(remaining || 0),
        complete: coverage.exact,
        coverage,
        issuedAt,
      };
      const payloadSha256 = crypto.createHash('sha256').update(canonicalJson(attestationPayload)).digest('hex');
      const attestation = {
        ...attestationPayload,
        payloadSha256,
        signature: crypto.createHmac('sha256', gatewaySecret).update(payloadSha256).digest('base64url'),
      };
      return {
        jobId: input.jobId,
        spaceId: input.spaceId,
        knowledgeBaseId: input.knowledgeBaseId,
        documentId: input.documentId,
        sourceIndexVersion: input.sourceIndexVersion,
        sourceSha256: input.sourceSha256,
        sourceChunkerVersion: input.sourceChunkerVersion,
        sourceEmbeddingProfile,
        embeddingProfile,
        provider: profile.provider,
        vectorIndexVersion: profile.vectorIndexVersion,
        processed: candidates.length,
        written,
        afterKey: nextAfterKey,
        cursorWrapped,
        madeProgress: written > 0 || coverage.exact,
        remaining: Number(remaining || 0),
        complete: coverage.exact,
        coverage,
        vectorIndex,
        attestation,
        metrics: { durationMs: Date.now() - started, priority: 'backfill', idempotent: true },
      };
    });
  }

  async function retrieve(rawInput) {
    const input = validateRetrieveInput(rawInput, config);
    const queuedAt = Date.now();
    return queue.schedule('retrieve', input.requestId, async () => {
      const queueWaitMs = Date.now() - queuedAt;
      const started = queuedAt;
      const database = await tenant(input.spaceId);
      const watermarkByBase = Object.fromEntries(input.knowledgeBases.map((base) => [base.id, base.indexVersion]));
      const common = { spaceId: input.spaceId, knowledgeBaseIds: input.knowledgeBases.map((base) => base.id), watermarkByBase, candidateLimit: config.limits.candidateChunks, analyzer: `${database}::${ANALYZER_NAME}` };
      const timings = {};
      const timed = async (name, work) => {
        const channelStarted = Date.now();
        try { return await work(); } finally { timings[`${name}Ms`] = Date.now() - channelStarted; }
      };
      let coverage = null;
      const canRouteFromConfig = !input.embeddingProfileExplicit && input.knowledgeBases.every((base) => !base.embeddingProfileExplicit);
      const migrationStatus = migration.status();
      const globalGteRouting = !input.evaluation && migrationStatus.configuredProvider === 'gte-node';
      if (input.embeddingProfile.provider === 'gte-node' || canRouteFromConfig || globalGteRouting || migrationStatus.shadowPercent > 0) {
        coverage = await timed('gteCoverage', () => gteCoverage(database, input));
      }
      let servedProfile = input.embeddingProfile;
      let rollbackCode = null;
      if (!input.evaluation && migrationConfig.forceQwenRollback === true) {
        rollbackCode = 'FORCED_QWEN_ROLLBACK';
        servedProfile = embeddingProfiles(config)['qwen-tei'];
      } else if (!input.evaluation && migrationStatus.paused === true) {
        rollbackCode = 'MIGRATION_GATE_PAUSED';
        servedProfile = embeddingProfiles(config)['qwen-tei'];
      } else if (!input.evaluation && servedProfile.provider === 'qwen-tei'
          && migrationStatus.configuredProvider === 'gte-node') {
        servedProfile = embeddingProfiles(config)[migration.choose(input.requestId, { gteReady: coverage?.complete === true })];
      } else if (canRouteFromConfig) {
        servedProfile = embeddingProfiles(config)[migration.choose(input.requestId, { gteReady: coverage?.complete === true })];
      }
      if (servedProfile.provider === 'gte-node' && coverage?.complete !== true) {
        if (input.embeddingProfileExplicit) throw runtimeError('The GTE profile is not fully indexed for every selected knowledge base.', { code: 'EMBEDDING_PROFILE_NOT_READY', status: 409, retryable: true });
        servedProfile = embeddingProfiles(config)['qwen-tei'];
      }
      let providerRouting = null;
      if (servedProfile.provider !== input.embeddingProfile.provider) {
        providerRouting = servedProfile.provider === 'gte-node'
          ? { type: 'rollout', from: input.embeddingProfile.provider, to: servedProfile.provider, rolloutPercent: migrationStatus.rolloutPercent }
          : { type: 'rollback', from: input.embeddingProfile.provider, to: servedProfile.provider, code: rollbackCode || 'GTE_NOT_READY' };
      }

      const executeVector = async (profile, timingPrefix = '', { priority = 'query', requestId = input.requestId, recordTimings = true } = {}) => {
        const measure = recordTimings ? timed : async (_name, work) => work();
        const [queryVector] = await measure(`${timingPrefix}embedding`, () => embedForProfile(profile, [input.query], { priority, requestId }));
        const gte = profile.provider === 'gte-node';
        const eligibleQuery = gte ? AQL.eligibleGteChunkCount : AQL.eligibleChunkCount;
        const [eligibleCount = 0] = await measure(`${timingPrefix}eligibility`, () => app.query(database, eligibleQuery, { ...common, vectorIndexVersion: profile.vectorIndexVersion }));
        const vectorIndex = await ensureVectorIndex(app, database, profile.dimensions, Number(eligibleCount), { collection: profile.collection, indexName: profile.vectorIndexName });
        indexStates.set(`${database}:${profile.provider}`, vectorIndex);
        let vectorMode = vectorIndex.ready ? 'ann' : 'exact';
        const annQuery = gte ? AQL.annGteVectorChunks : AQL.annVectorChunks;
        const exactQuery = gte ? AQL.exactGteVectorChunks : AQL.exactVectorChunks;
        let vectorItems;
        try {
          vectorItems = await measure(`${timingPrefix}vector`, () => app.query(database, vectorIndex.ready ? annQuery : exactQuery, {
            ...common, vectorIndexVersion: profile.vectorIndexVersion, queryVector, annProbeLimit: Math.min(1_000, config.limits.candidateChunks * 5),
          }));
        } catch (error) {
          if (!vectorIndex.ready) throw error;
          vectorMode = 'exact-fallback';
          vectorItems = await measure(`${timingPrefix}vectorFallback`, () => app.query(database, exactQuery, { ...common, vectorIndexVersion: profile.vectorIndexVersion, queryVector }));
        }
        return { profile, eligibleCount: Number(eligibleCount), vectorIndex, vectorMode, vectorItems };
      };

      let vectorResult;
      let providerFallback = null;
      try {
        vectorResult = await executeVector(servedProfile);
      } catch (error) {
        if (servedProfile.provider !== 'gte-node') throw error;
        recordMigration({ provider: 'gte-node', durationMs: Date.now() - started, failed: true, queueDepth: gteClient?.status?.().queue?.waiting || 0 });
        providerFallback = { from: 'gte-node', to: 'qwen-tei', code: error.code || 'GTE_UNAVAILABLE' };
        providerRouting = null;
        servedProfile = embeddingProfiles(config)['qwen-tei'];
        vectorResult = await executeVector(servedProfile, 'fallback');
      }
      const { eligibleCount, vectorIndex, vectorMode, vectorItems } = vectorResult;
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
        return { ...item, fusion, finalScore: blendRetrievalScore(item.score, fusion?.score) };
      }).sort((left, right) => right.finalScore - left.finalScore);
      const citations = ranked.slice(0, input.topK).map(({ candidate, finalScore, fusion }) => ({
        sourceRef: `${candidate.documentId}:${candidate._key}`, knowledgeBaseId: candidate.knowledgeBaseId, documentId: candidate.documentId, documentName: candidate.documentName,
        excerpt: String(candidate.text || '').slice(0, config.limits.excerptCharacters), page: candidate.page ?? undefined, section: candidate.section ?? undefined,
        score: Math.round(finalScore * 1_000_000) / 1_000_000, entityRefs: input.graphDepth > 0 ? (candidate.entityRefs || []).slice(0, 40) : undefined,
        channels: Object.keys(fusion?.channels || {}),
      }));
      const durationMs = Date.now() - started;
      if (servedProfile.provider === 'gte-node') {
        recordMigration({ provider: 'gte-node', durationMs, failed: false, queueDepth: gteClient?.status?.().queue?.waiting || 0 });
      }
      if (migration.shouldShadow(input.requestId, { gteReady: coverage?.complete === true, servedProvider: servedProfile.provider })) {
        const servedKeys = ranked.slice(0, 20).map((item) => item.candidate._key);
        const gteQueueWaiting = gteClient?.status?.().queue?.waiting || 0;
        if (shadowActive >= 1 || gteQueueWaiting > 0) {
          shadowDiagnostics.push({
            at: new Date().toISOString(),
            requestHash: crypto.createHmac('sha256', gatewaySecret).update(`${input.spaceId}:${input.requestId}:${input.query}`).digest('hex'),
            servedProvider: servedProfile.provider, shadowProvider: 'gte-node', dropped: true,
            reason: shadowActive >= 1 ? 'shadow-concurrency-budget' : 'live-queue-busy',
          });
          if (shadowDiagnostics.length > 100) shadowDiagnostics.splice(0, shadowDiagnostics.length - 100);
        } else {
          shadowActive += 1;
          const shadowTask = new Promise((resolve) => setImmediate(resolve)).then(async () => {
          const shadowStarted = Date.now();
          const shadowProfile = embeddingProfiles(config)['gte-node'];
          const shadowVector = await executeVector(shadowProfile, 'shadow', {
            priority: 'shadow', requestId: `${input.requestId}:shadow`, recordTimings: false,
          });
          const shadowFused = weightedReciprocalRankFusion([
            { name: 'vector', weight: 0.45, items: shadowVector.vectorItems },
            { name: 'lexical', weight: 0.30, items: lexicalItems },
            { name: 'graph', weight: 0.25, items: graphItems },
          ]).slice(0, 80);
          const shadowReranked = await (options.rerank || rerank)(input.query, shadowFused.map((item) => item.candidate), { config, fetchImpl, apiKey: embeddingApiKey });
          const shadowKeys = shadowReranked.slice(0, 20).map((item) => item.candidate._key);
          const overlap = shadowKeys.filter((key) => servedKeys.includes(key)).length;
          shadowDiagnostics.push({
            at: new Date().toISOString(),
            requestHash: crypto.createHmac('sha256', gatewaySecret).update(`${input.spaceId}:${input.requestId}:${input.query}`).digest('hex'),
            servedProvider: servedProfile.provider,
            shadowProvider: 'gte-node',
            durationMs: Date.now() - shadowStarted,
            overlapAt20: overlap / Math.max(1, Math.min(20, servedKeys.length)),
            top1Same: servedKeys[0] != null && servedKeys[0] === shadowKeys[0],
            failed: false,
          });
          recordMigration({ provider: 'gte-node', durationMs: Date.now() - shadowStarted, failed: false, queueDepth: gteClient?.status?.().queue?.waiting || 0 });
          if (shadowDiagnostics.length > 100) shadowDiagnostics.splice(0, shadowDiagnostics.length - 100);
          }).catch((error) => {
          shadowDiagnostics.push({
            at: new Date().toISOString(),
            requestHash: crypto.createHmac('sha256', gatewaySecret).update(`${input.spaceId}:${input.requestId}:${input.query}`).digest('hex'),
            servedProvider: servedProfile.provider, shadowProvider: 'gte-node', durationMs: 0, overlapAt20: null, top1Same: null,
            failed: true, code: error.code || 'GTE_SHADOW_FAILED',
          });
          recordMigration({ provider: 'gte-node', durationMs: 0, failed: true, queueDepth: gteClient?.status?.().queue?.waiting || 0 });
          if (shadowDiagnostics.length > 100) shadowDiagnostics.splice(0, shadowDiagnostics.length - 100);
          }).finally(() => {
            shadowActive = Math.max(0, shadowActive - 1);
            shadowTasks.delete(shadowTask);
          });
          shadowTasks.add(shadowTask);
        }
      }
      return { citations, metrics: {
        durationMs, eligibleCount: Number(eligibleCount), rerankedCount: reranked.length, graphDepth: input.graphDepth,
        channels: { vector: vectorItems.length, lexical: lexicalItems.length, graph: graphItems.length, graphSeeds: seedKeys.length, graphEntities: graphKeys.length },
        timings: { queueWaitMs, ...timings }, vectorIndex: { ...vectorIndex, mode: vectorMode }, fusion: 'weighted-rrf+local-reranker', tenantIsolation: 'database-per-space',
        reranker: { model: config.models.reranker.id, revision: config.models.reranker.revision,
          executed: true, inputCount: fused.length, outputCount: reranked.length },
        embeddingProfile: { provider: servedProfile.provider, model: servedProfile.model, revision: servedProfile.revision, dtype: servedProfile.dtype, dimensions: servedProfile.dimensions, vectorIndexVersion: servedProfile.vectorIndexVersion },
        providerFallback, providerRouting,
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
      for (const key of [...indexStates.keys()]) if (key.startsWith(`${database}:`)) indexStates.delete(key);
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
        for (const key of [...indexStates.keys()]) if (key.startsWith(`${database}:`)) indexStates.delete(key);
        return { cleaned: true, dropped: false, scope: 'synthetic-live-benchmark-tenant' };
      }
      await provisioner.request('_system', `/_api/database/${encodeURIComponent(database)}`, { method: 'DELETE', timeoutMs: 120_000 });
      tenantPromises.delete(database);
      for (const key of [...indexStates.keys()]) if (key.startsWith(`${database}:`)) indexStates.delete(key);
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
    const gteRequired = migrationConfig.provider === 'gte-node' || migrationConfig.dualWrite === true
      || Number(migrationConfig.shadowPercent || 0) > 0 || Number(migrationConfig.rolloutPercent || 0) > 0;
    const gteStatus = gteClient?.status?.() || { state: 'stopped', ready: false, accepting: false, queue: { waiting: 0, capacity: migrationConfig.queueDepth || config.limits.queueDepth, oldestWaitMs: 0, byPriority: { query: 0, 'live-index': 0, backfill: 0 } }, metrics: null };
    services.gteEmbedding = { healthy: gteStatus.ready === true || !gteRequired, required: gteRequired, ready: gteStatus.ready === true, state: gteStatus.state };
    let tenantDatabases = null;
    try { tenantDatabases = ((await provisioner.request('_system', '/_api/database/user')).result || []).filter((name) => name.startsWith(config.database.prefix)).length; } catch {}
    const vectorIndexes = [...indexStates.values()];
    const ready = Object.values(services).every((service) => service.healthy);
    const checkedAt = Date.now();
    const cpu = process.cpuUsage(previousCpu);
    const elapsedMicros = Math.max(1, (checkedAt - previousCpuAt) * 1_000);
    previousCpu = process.cpuUsage();
    previousCpuAt = checkedAt;
    const memory = process.memoryUsage();
    const eventLoop = {
      meanMs: Number.isFinite(eventLoopDelay.mean) ? eventLoopDelay.mean / 1e6 : 0,
      p50Ms: eventLoopDelay.percentile?.(50) / 1e6 || 0,
      p95Ms: eventLoopDelay.percentile?.(95) / 1e6 || 0,
      p99Ms: eventLoopDelay.percentile?.(99) / 1e6 || 0,
      maxMs: Number.isFinite(eventLoopDelay.max) ? eventLoopDelay.max / 1e6 : 0,
    };
    eventLoopDelay.reset?.();
    return {
      ready, healthy: ready, checkedAt: new Date(checkedAt).toISOString(), pid: process.pid, uptimeSeconds: Math.round(process.uptime()), tenantIsolation: 'database-per-space', tenantDatabases,
      models: config.models, embeddingProfiles: embeddingProfiles(config), activeEmbeddingProvider: migration.status().configuredProvider,
      uploadMaxBytes: config.limits.sourceBytes, supportedMimeTypes: config.supportedMimeTypes, maxKnowledgeBasesPerQuery: 5, maxGraphDepth: 2,
      search: { lexical: 'arangosearch-bm25', vector: vectorIndexes.some((item) => item.ready) ? 'ann+exact-fallback' : 'exact-fallback', vectorIndexes: { observed: vectorIndexes.length, observedTenants: new Set([...indexStates.keys()].map((key) => key.split(':')[0])).size, ready: vectorIndexes.filter((item) => item.ready).length, training: vectorIndexes.filter((item) => item.training).length, byProfile: Object.fromEntries(indexStates) } },
      services,
      queue: queue.snapshot(),
      gte: gteStatus,
      migration: { ...migration.status(), dualWrite: migrationConfig.dualWrite === true, shadowDiagnostics: { active: shadowActive, retained: shadowDiagnostics.length, failures: shadowDiagnostics.filter((item) => item.failed).length, dropped: shadowDiagnostics.filter((item) => item.dropped).length, recent: shadowDiagnostics.slice(-20) } },
      providers: Object.fromEntries(Object.entries(providerMetrics).map(([provider, metrics]) => [provider, { ...metrics, averageEmbeddingMs: metrics.embeddings ? metrics.totalMs / metrics.embeddings : 0 }])),
      resources: { memory: { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed, heapTotalBytes: memory.heapTotal, externalBytes: memory.external }, cpuPercent: ((cpu.user + cpu.system) / elapsedMicros) * 100, eventLoop },
    };
  }

  async function migrationControl(rawInput) {
    const input = validateMigrationControlInput(rawInput);
    if (input.action === 'pause') migration.pause(input.reason);
    if (input.action === 'resume') migration.resume();
    if (input.action !== 'status') persistMigrationState();
    return { ...migration.status(), action: input.action, controlledBy: input.source };
  }

  async function start() {
    const needed = migrationConfig.provider === 'gte-node' || migrationConfig.dualWrite === true
      || Number(migrationConfig.shadowPercent || 0) > 0 || Number(migrationConfig.rolloutPercent || 0) > 0;
    if (needed) await ensureGteClient();
    return status();
  }

  async function close({ timeoutMs = 30_000, force = false } = {}) {
    let drained = true;
    try { await queue.close({ timeoutMs, force }); } catch (error) { drained = false; if (!force) throw error; }
    if (shadowTasks.size && !force) {
      const shadowDrain = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), timeoutMs);
        timer.unref?.();
        Promise.allSettled([...shadowTasks]).then(() => { clearTimeout(timer); resolve(true); });
      });
      drained = drained && shadowDrain === true;
    }
    if (gteClient) {
      const result = await gteClient.close({ drainTimeoutMs: force ? 0 : timeoutMs });
      drained = drained && result.drained !== false;
    }
    eventLoopDelay.disable?.();
    return { closed: true, drained };
  }

  return { index, backfill, retrieve, remove, graph, status, migrationControl, start, close, cleanupTestTenant, queue, tenantDatabaseName: (spaceId) => tenantDatabaseName(spaceId, config.database.prefix) };
}

module.exports = {
  ArangoClient, BENCHMARK_CLEANUP_CONFIRMATION, BENCHMARK_SPACE_PATTERN, GRAPH_SCHEMA, WorkQueue, canonicalizeGraph, chunkText, createKnowledgeRuntime, ensureTenantDatabase,
  blendRetrievalScore, embeddingProfiles, extractDocument, extractGraph, groundedMentions, normalizeRawRerankerScore, purgeKnowledgeEvidence, rerank, resolveEmbeddingProfile, runtimeError, selectDeclaredBindVars, upstreamResponseError, validateBackfillInput, validateDeleteInput, validateGraphInput, validateIndexInput, validateMigrationControlInput, validateRetrieveInput, validateTestCleanupInput,
  vectorIndexState, weightedReciprocalRankFusion,
};
