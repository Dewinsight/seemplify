import crypto from 'node:crypto';
import fs from 'node:fs';
import { z } from 'zod';
import {
  azureKnowledgeEmbeddingProfile, azureKnowledgeRerankerProfile, bgeKnowledgeRerankerProfile, config,
  gteKnowledgeEmbeddingProfile, qwenKnowledgeEmbeddingProfile,
  type KnowledgeEmbeddingProfile
} from './config.js';
import { getKnowledgeDocument, KnowledgeError, type KnowledgeBaseRef, type KnowledgeCitation } from './knowledgeRepository.js';

function readSecret() {
  try {
    const secret = fs.readFileSync(config.knowledgeRuntimeSecretFile, 'utf8').trim();
    if (secret.length < 32) throw new Error('secret is too short');
    return secret;
  } catch {
    throw new KnowledgeError('The local knowledge runtime secret is not configured.', 503, 'KNOWLEDGE_RUNTIME_NOT_CONFIGURED', true);
  }
}

function signedHeaders(secret: string, body: string, requestPath: string) {
  const timestamp = String(Date.now());
  const nonce = crypto.randomBytes(24).toString('base64url');
  const signature = crypto.createHmac('sha256', secret)
    .update(`${timestamp}\n${nonce}\nPOST\n${requestPath}\n${body}`)
    .digest('base64url');
  return {
    'content-type': 'application/json',
    'x-seemplify-timestamp': timestamp,
    'x-seemplify-nonce': nonce,
    'x-seemplify-signature': signature
  };
}

async function postRuntime(path: string, payload: Record<string, unknown>, timeoutMs: number) {
  const secret = readSecret(); const body = JSON.stringify(payload);
  let response: Response;
  try {
    response = await fetch(`${config.knowledgeRuntimeBaseUrl}${path}`, {
      method: 'POST', headers: signedHeaders(secret, body, path), body, signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    throw new KnowledgeError(`The local knowledge runtime is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      503, 'KNOWLEDGE_RUNTIME_UNAVAILABLE', true);
  }
  const data = await response.json().catch(() => ({})) as any;
  if (!response.ok) {
    throw new KnowledgeError(data.message || data.error || `Knowledge runtime returned HTTP ${response.status}`,
      response.status, data.code || 'KNOWLEDGE_RUNTIME_REQUEST_FAILED', data.retryable !== false && response.status >= 429);
  }
  return data;
}

const indexResponse = z.object({
  document: z.object({
    pageCount: z.number().int().nonnegative().nullable().optional(),
    chunkCount: z.number().int().nonnegative().max(1_000_000).default(0),
    entityCount: z.number().int().nonnegative().max(1_000_000).default(0),
    relationshipCount: z.number().int().nonnegative().max(2_000_000).optional().default(0),
    language: z.string().trim().max(80).nullable().optional()
  }),
  metrics: z.record(z.string(), z.unknown()).optional().default({})
});

const citationSchema = z.object({
  sourceRef: z.string().trim().min(1).max(300),
  knowledgeBaseId: z.string().trim().min(1).max(100),
  documentId: z.string().trim().min(1).max(100),
  documentName: z.string().trim().min(1).max(255),
  excerpt: z.string().trim().min(1).max(4_000),
  page: z.number().int().positive().nullable().optional(),
  section: z.string().trim().max(500).nullable().optional(),
  score: z.number().finite().nullable().optional(),
  entityRefs: z.array(z.string().trim().min(1).max(300)).max(50).optional()
});

const rerankerTelemetrySchema = z.object({
  model: z.union([z.literal(bgeKnowledgeRerankerProfile.model), z.literal(azureKnowledgeRerankerProfile.model)]),
  revision: z.union([z.literal(bgeKnowledgeRerankerProfile.revision), z.literal(azureKnowledgeRerankerProfile.revision)]),
  executed: z.literal(true),
  inputCount: z.number().int().nonnegative(),
  outputCount: z.number().int().nonnegative()
}).strict().refine((value) => value.outputCount <= value.inputCount, {
  message: 'Reranker output count cannot exceed its input count.'
}).refine((value) => (value.model === bgeKnowledgeRerankerProfile.model
  && value.revision === bgeKnowledgeRerankerProfile.revision)
  || (value.model === azureKnowledgeRerankerProfile.model
    && value.revision === azureKnowledgeRerankerProfile.revision), {
  message: 'Reranker model and revision must identify the same pinned profile.'
});

const retrievalMetricsSchema = z.object({
  fusion: z.literal('weighted-rrf+local-reranker'),
  rerankedCount: z.number().int().nonnegative(),
  timings: z.object({ rerankerMs: z.number().finite().nonnegative() }).passthrough(),
  reranker: rerankerTelemetrySchema,
  embeddingProfile: z.unknown()
}).passthrough().superRefine((value, context) => {
  if (value.rerankedCount !== value.reranker.outputCount) {
    context.addIssue({ code: z.ZodIssueCode.custom,
      message: 'Reranker output telemetry does not match the reported reranked count.', path: ['reranker', 'outputCount'] });
  }
});

const retrieveResponse = z.object({
  citations: z.array(citationSchema).max(20),
  metrics: retrievalMetricsSchema
});

const scanResponse = z.object({
  requestId: z.string().trim().min(1).max(300),
  items: z.array(z.object({
    sourceRef: z.string().trim().min(1).max(300),
    knowledgeBaseId: z.string().trim().min(1).max(100),
    documentId: z.string().trim().min(1).max(100),
    documentName: z.string().trim().min(1).max(255),
    indexVersion: z.number().int().positive(),
    ordinal: z.number().int().nonnegative(),
    text: z.string().min(1).max(20_000),
    tokenEstimate: z.number().int().nonnegative().max(20_000),
    page: z.number().int().positive().nullable().optional(),
    section: z.string().trim().max(500).nullable().optional(),
    contentHash: z.string().trim().max(128)
  }).strict()).max(50),
  offset: z.number().int().nonnegative(),
  nextOffset: z.number().int().positive().nullable(),
  complete: z.boolean()
}).strict();

const graphResponse = z.object({
  nodes: z.array(z.object({
    id: z.string().trim().min(1).max(300), type: z.string().trim().min(1).max(100),
    name: z.string().trim().min(1).max(500), aliases: z.array(z.string().trim().min(1).max(500)).max(50).optional().default([]),
    supportingSourceCount: z.number().int().nonnegative().optional().default(0)
  })).max(500),
  edges: z.array(z.object({
    id: z.string().trim().min(1).max(300), source: z.string().trim().min(1).max(300),
    target: z.string().trim().min(1).max(300), type: z.string().trim().min(1).max(200),
    confidence: z.number().min(0).max(1).nullable().optional(),
    documentId: z.string().trim().min(1).max(100).nullable().optional(),
    documentName: z.string().trim().min(1).max(255).nullable().optional(),
    sourceRef: z.string().trim().min(1).max(300).nullable().optional(),
    quote: z.string().trim().min(1).max(2_000).nullable().optional(),
    page: z.number().int().positive().nullable().optional(),
    section: z.string().trim().min(1).max(500).nullable().optional(),
    supports: z.array(z.object({
      documentId: z.string().trim().min(1).max(100).nullable().optional(),
      documentName: z.string().trim().min(1).max(255).nullable().optional(),
      sourceRef: z.string().trim().min(1).max(300).nullable().optional(),
      quote: z.string().trim().min(1).max(2_000).nullable().optional(),
      page: z.number().int().positive().nullable().optional(),
      section: z.string().trim().min(1).max(500).nullable().optional()
    })).max(5).optional()
  })).max(2_000),
  metrics: z.record(z.string(), z.unknown()).optional().default({})
});

const embeddingProfileSchema = z.object({
  provider: z.enum(['azure-openai', 'qwen-tei', 'gte-node']),
  model: z.string().trim().min(1).max(300),
  revision: z.string().regex(/^[a-f0-9]{40}$/u),
  dtype: z.string().trim().min(1).max(40),
  dimensions: z.number().int().min(128).max(8192),
  vectorIndexVersion: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,99}$/u)
}).strict();

function profileIdentity(profile: KnowledgeEmbeddingProfile) {
  return JSON.stringify([profile.provider, profile.model, profile.revision, profile.dtype,
    profile.dimensions, profile.vectorIndexVersion]);
}

function assertPinnedProfile(profile: KnowledgeEmbeddingProfile, expected?: KnowledgeEmbeddingProfile) {
  const pinned = profile.provider === 'azure-openai' ? azureKnowledgeEmbeddingProfile
    : profile.provider === 'qwen-tei' ? qwenKnowledgeEmbeddingProfile : gteKnowledgeEmbeddingProfile;
  if (profileIdentity(profile) !== profileIdentity(pinned)
      || (expected && profileIdentity(profile) !== profileIdentity(expected))) {
    throw new KnowledgeError('The local knowledge runtime reported an unpinned embedding profile.',
      502, 'KNOWLEDGE_RUNTIME_PROFILE_MISMATCH', false);
  }
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => [key, canonicalValue(item)]));
  }
  return value;
}

const backfillCoverageSchema = z.object({
  canonicalCount: z.number().int().nonnegative(),
  validSourceCount: z.number().int().nonnegative(),
  validTargetCount: z.number().int().nonnegative(),
  targetCount: z.number().int().nonnegative(),
  exact: z.boolean()
}).strict();

const backfillResponse = z.object({
  jobId: z.string().trim().min(1).max(200),
  spaceId: z.string().trim().min(1).max(100),
  knowledgeBaseId: z.string().trim().min(1).max(100),
  documentId: z.string().trim().min(1).max(100),
  sourceIndexVersion: z.number().int().positive(),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  sourceChunkerVersion: z.string().trim().min(1).max(80),
  sourceEmbeddingProfile: embeddingProfileSchema,
  embeddingProfile: embeddingProfileSchema,
  provider: z.literal('gte-node'),
  vectorIndexVersion: z.string().trim().min(1).max(100),
  processed: z.number().int().nonnegative(),
  written: z.number().int().nonnegative(),
  afterKey: z.string().max(128),
  remaining: z.number().int().nonnegative(),
  complete: z.boolean(),
  coverage: backfillCoverageSchema,
  vectorIndex: z.record(z.string(), z.unknown()).optional().default({}),
  metrics: z.record(z.string(), z.unknown()).optional().default({}),
  attestation: z.object({
    version: z.literal(1),
    jobId: z.string().trim().min(1).max(200),
    spaceId: z.string().trim().min(1).max(100),
    knowledgeBaseId: z.string().trim().min(1).max(100),
    documentId: z.string().trim().min(1).max(100),
    sourceIndexVersion: z.number().int().positive(),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    sourceChunkerVersion: z.string().trim().min(1).max(80),
    sourceEmbeddingProfile: embeddingProfileSchema,
    embeddingProfile: embeddingProfileSchema,
    afterKeyBefore: z.string().max(128),
    afterKeyAfter: z.string().max(128),
    processed: z.number().int().nonnegative(),
    written: z.number().int().nonnegative(),
    remaining: z.number().int().nonnegative(),
    complete: z.boolean(),
    coverage: backfillCoverageSchema,
    issuedAt: z.string().datetime(),
    payloadSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    signature: z.string().regex(/^[A-Za-z0-9_-]{43}$/u)
  }).strict()
});

function invalidRuntimeOutput(name: string, error: z.ZodError) {
  return new KnowledgeError(`The local knowledge runtime returned invalid ${name}: ${error.issues.slice(0, 5).map((issue) => issue.message).join('; ')}`,
    502, 'KNOWLEDGE_RUNTIME_INVALID_RESPONSE', false);
}

export async function indexKnowledgeDocument(input: {
  jobId: string;
  spaceId: string;
  aiIdentity: { sub: string; email: string; displayName: string; organizationId?: string; organizationName?: string };
  knowledgeBase: KnowledgeBaseRef;
  targetEmbeddingProfiles: KnowledgeEmbeddingProfile[];
  dualWrite: boolean;
  targetVersion: number;
  document: {
    id: string; sourcePath: string; originalName: string; mimeType: string; sizeBytes: number; sha256: string;
    metadata?: Record<string, unknown>;
  };
}) {
  const raw = await postRuntime('/v1/index', {
    jobId: input.jobId,
    spaceId: input.spaceId,
    aiIdentity: input.aiIdentity,
    knowledgeBase: { ...input.knowledgeBase, indexVersion: input.targetVersion,
      targetEmbeddingProfiles: input.targetEmbeddingProfiles, dualWrite: input.dualWrite },
    document: input.document
  }, 30 * 60_000);
  const parsed = indexResponse.safeParse(raw);
  if (!parsed.success) throw invalidRuntimeOutput('index result', parsed.error);
  const reportedProfiles = z.array(embeddingProfileSchema).min(1).max(4)
    .safeParse(parsed.data.metrics.embeddingProfiles);
  if (!reportedProfiles.success) {
    throw new KnowledgeError('The local knowledge runtime did not attest every embedding profile written during indexing.',
      502, 'KNOWLEDGE_RUNTIME_PROFILE_MISSING', false);
  }
  const expectedProfiles = [...input.targetEmbeddingProfiles].map(profileIdentity).sort();
  const actualProfiles = reportedProfiles.data.map((profile) => {
    assertPinnedProfile(profile as KnowledgeEmbeddingProfile);
    return profileIdentity(profile as KnowledgeEmbeddingProfile);
  }).sort();
  if (JSON.stringify(actualProfiles) !== JSON.stringify(expectedProfiles)) {
    throw new KnowledgeError('The local knowledge runtime indexed a different embedding profile set than requested.',
      502, 'KNOWLEDGE_RUNTIME_PROFILE_MISMATCH', false);
  }
  return parsed.data;
}

export async function retrieveKnowledge(input: {
  requestId: string; spaceId: string; knowledgeBases: KnowledgeBaseRef[]; query: string;
  topK?: number; graphDepth?: 1 | 2;
}) {
  const profileKeys = new Set(input.knowledgeBases.map((base) => JSON.stringify([
    base.embeddingProfile.provider, base.embeddingProfile.model, base.embeddingProfile.revision,
    base.embeddingProfile.dtype, base.embeddingProfile.dimensions, base.embeddingProfile.vectorIndexVersion
  ])));
  if (profileKeys.size !== 1) {
    throw new KnowledgeError('Selected knowledge bases use different embedding spaces and cannot be queried together.',
      409, 'KNOWLEDGE_EMBEDDING_PROFILE_MISMATCH', false);
  }
  const embeddingProfile = input.knowledgeBases[0]?.embeddingProfile;
  const raw = await postRuntime('/v1/retrieve', {
    requestId: input.requestId,
    spaceId: input.spaceId,
    knowledgeBases: input.knowledgeBases,
    query: input.query,
    embeddingProfile,
    topK: input.topK ?? config.knowledgeRetrieveTopK,
    graphDepth: input.graphDepth ?? 2,
    retrieval: { vector: true, bm25: true, fusion: 'rrf', rerank: true }
  }, 120_000);
  const parsed = retrieveResponse.safeParse(raw);
  if (!parsed.success) throw invalidRuntimeOutput('retrieval result', parsed.error);
  const servedProfileResult = embeddingProfileSchema.safeParse(parsed.data.metrics.embeddingProfile);
  if (!servedProfileResult.success) {
    throw new KnowledgeError('The local knowledge runtime did not attest the embedding profile used for retrieval.',
      502, 'KNOWLEDGE_RUNTIME_PROFILE_MISSING', false);
  }
  const servedProfile = servedProfileResult.data as KnowledgeEmbeddingProfile;
  assertPinnedProfile(servedProfile);
  if (profileIdentity(servedProfile) !== profileIdentity(embeddingProfile!)) {
    const fallback = parsed.data.metrics.providerFallback as Record<string, unknown> | null | undefined;
    const routing = parsed.data.metrics.providerRouting as Record<string, unknown> | null | undefined;
    const validFallback = embeddingProfile?.provider === 'gte-node' && servedProfile.provider === 'qwen-tei'
      && fallback?.from === 'gte-node' && fallback?.to === 'qwen-tei'
      && typeof fallback.code === 'string' && Boolean(fallback.code);
    const validRollback = embeddingProfile?.provider === 'gte-node' && servedProfile.provider === 'qwen-tei'
      && routing?.type === 'rollback' && routing.from === 'gte-node' && routing.to === 'qwen-tei'
      && (routing.code === 'FORCED_QWEN_ROLLBACK' || routing.code === 'MIGRATION_GATE_PAUSED');
    const validRollout = embeddingProfile?.provider === 'qwen-tei' && servedProfile.provider === 'gte-node'
      && routing?.type === 'rollout' && routing.from === 'qwen-tei' && routing.to === 'gte-node'
      && Number.isFinite(routing.rolloutPercent) && Number(routing.rolloutPercent) > 0
      && Number(routing.rolloutPercent) <= 100;
    if (!validFallback && !validRollback && !validRollout) {
      throw new KnowledgeError('The local knowledge runtime served a different embedding space without an approved Qwen fallback.',
        502, 'KNOWLEDGE_RUNTIME_PROFILE_MISMATCH', false);
    }
  }
  const allowedBases = new Map(input.knowledgeBases.map((base) => [base.id, base]));
  const seen = new Set<string>(); const citations: KnowledgeCitation[] = [];
  for (const citation of parsed.data.citations) {
    const pinnedBase = allowedBases.get(citation.knowledgeBaseId);
    if (!pinnedBase) {
      throw new KnowledgeError('The local knowledge runtime returned evidence from outside the authorized knowledge bases.',
        502, 'KNOWLEDGE_RUNTIME_SCOPE_VIOLATION', false);
    }
    const document = getKnowledgeDocument(citation.documentId, citation.knowledgeBaseId, input.spaceId);
    if (!document || document.state !== 'ready' || document.indexVersion < 1
      || document.indexVersion > pinnedBase.indexVersion) {
      throw new KnowledgeError('The local knowledge runtime returned evidence from an unavailable or unpinned document version.',
        502, 'KNOWLEDGE_RUNTIME_DOCUMENT_SCOPE_VIOLATION', false);
    }
    if (seen.has(citation.sourceRef)) continue;
    seen.add(citation.sourceRef);
    citations.push({ ...citation, documentName: document.originalName });
  }
  return { citations, metrics: parsed.data.metrics };
}

export async function scanKnowledgeDocument(input: {
  requestId: string; spaceId: string; knowledgeBaseId: string; documentId: string;
  indexVersion: number; offset: number; limit: number;
}) {
  const raw = await postRuntime('/v1/scan', input, 120_000);
  const parsed = scanResponse.safeParse(raw);
  if (!parsed.success) throw invalidRuntimeOutput('knowledge scan result', parsed.error);
  if (parsed.data.requestId !== input.requestId || parsed.data.offset !== input.offset) {
    throw new KnowledgeError('The local knowledge runtime returned a mismatched corpus scan response.',
      502, 'KNOWLEDGE_RUNTIME_OUTPUT_INVALID', false);
  }
  return parsed.data;
}

export async function deleteKnowledgeIndex(input: {
  jobId: string; spaceId: string; knowledgeBaseId: string; targetVersion: number;
  documentId?: string | null;
  embeddingProfile: KnowledgeEmbeddingProfile;
  targetEmbeddingProfiles: KnowledgeEmbeddingProfile[];
}) {
  return postRuntime('/v1/delete', {
    jobId: input.jobId, spaceId: input.spaceId, knowledgeBaseId: input.knowledgeBaseId,
    documentId: input.documentId || undefined, indexVersion: input.targetVersion,
    embeddingProfile: input.embeddingProfile, targetEmbeddingProfiles: input.targetEmbeddingProfiles
  }, 10 * 60_000);
}

export async function backfillKnowledgeIndex(input: {
  jobId: string;
  spaceId: string;
  knowledgeBaseId: string;
  documentId: string;
  sourceIndexVersion: number;
  sourceSha256: string;
  sourceChunkerVersion: string;
  sourceEmbeddingProfile: KnowledgeEmbeddingProfile;
  afterKey?: string;
  batchSize: number;
  targetEmbeddingProfile: KnowledgeEmbeddingProfile;
}) {
  if (input.targetEmbeddingProfile.provider !== 'gte-node') {
    throw new KnowledgeError('Only the pinned GTE profile supports corpus backfill.',
      409, 'KNOWLEDGE_BACKFILL_PROFILE_UNSUPPORTED');
  }
  assertPinnedProfile(input.sourceEmbeddingProfile, qwenKnowledgeEmbeddingProfile);
  assertPinnedProfile(input.targetEmbeddingProfile, gteKnowledgeEmbeddingProfile);
  const raw = await postRuntime('/v1/backfill', {
    jobId: input.jobId,
    spaceId: input.spaceId,
    knowledgeBaseId: input.knowledgeBaseId,
    documentId: input.documentId,
    sourceIndexVersion: input.sourceIndexVersion,
    sourceSha256: input.sourceSha256,
    sourceChunkerVersion: input.sourceChunkerVersion,
    sourceEmbeddingProfile: input.sourceEmbeddingProfile,
    afterKey: input.afterKey || '',
    batchSize: Math.max(1, Math.min(128, Math.floor(input.batchSize))),
    embeddingProfile: input.targetEmbeddingProfile
  }, 30 * 60_000);
  const parsed = backfillResponse.safeParse(raw);
  if (!parsed.success) throw invalidRuntimeOutput('backfill result', parsed.error);
  assertPinnedProfile(parsed.data.sourceEmbeddingProfile as KnowledgeEmbeddingProfile, input.sourceEmbeddingProfile);
  assertPinnedProfile(parsed.data.embeddingProfile as KnowledgeEmbeddingProfile, input.targetEmbeddingProfile);
  const expectedAfterKey = input.afterKey || '';
  const scopeMatches = parsed.data.jobId === input.jobId && parsed.data.spaceId === input.spaceId
    && parsed.data.knowledgeBaseId === input.knowledgeBaseId && parsed.data.documentId === input.documentId
    && parsed.data.sourceIndexVersion === input.sourceIndexVersion && parsed.data.sourceSha256 === input.sourceSha256
    && parsed.data.sourceChunkerVersion === input.sourceChunkerVersion
    && parsed.data.vectorIndexVersion === input.targetEmbeddingProfile.vectorIndexVersion;
  if (!scopeMatches) {
    throw new KnowledgeError('The local knowledge runtime returned a backfill result for a different embedding scope.',
      502, 'KNOWLEDGE_RUNTIME_SCOPE_VIOLATION', false);
  }
  const attestation = parsed.data.attestation;
  const { payloadSha256, signature, ...attestedPayload } = attestation;
  const calculatedSha256 = crypto.createHash('sha256')
    .update(JSON.stringify(canonicalValue(attestedPayload))).digest('hex');
  const calculatedSignature = crypto.createHmac('sha256', readSecret()).update(calculatedSha256).digest('base64url');
  const signatureMatches = calculatedSignature.length === signature.length
    && crypto.timingSafeEqual(Buffer.from(calculatedSignature), Buffer.from(signature));
  const attestationMatches = payloadSha256 === calculatedSha256 && signatureMatches
    && attestation.jobId === input.jobId && attestation.spaceId === input.spaceId
    && attestation.knowledgeBaseId === input.knowledgeBaseId && attestation.documentId === input.documentId
    && attestation.sourceIndexVersion === input.sourceIndexVersion && attestation.sourceSha256 === input.sourceSha256
    && attestation.sourceChunkerVersion === input.sourceChunkerVersion && attestation.afterKeyBefore === expectedAfterKey
    && attestation.afterKeyAfter === parsed.data.afterKey && attestation.processed === parsed.data.processed
    && attestation.written === parsed.data.written && attestation.remaining === parsed.data.remaining
    && attestation.complete === parsed.data.complete
    && JSON.stringify(attestation.coverage) === JSON.stringify(parsed.data.coverage)
    && profileIdentity(attestation.sourceEmbeddingProfile as KnowledgeEmbeddingProfile)
      === profileIdentity(input.sourceEmbeddingProfile)
    && profileIdentity(attestation.embeddingProfile as KnowledgeEmbeddingProfile)
      === profileIdentity(input.targetEmbeddingProfile);
  if (!attestationMatches) {
    throw new KnowledgeError('The local knowledge runtime returned an invalid backfill attestation.',
      502, 'KNOWLEDGE_RUNTIME_ATTESTATION_INVALID', false);
  }
  const coverage = parsed.data.coverage;
  const coverageConsistent = coverage.validSourceCount <= coverage.canonicalCount
    && coverage.validTargetCount <= coverage.validSourceCount && coverage.targetCount <= coverage.canonicalCount
    && parsed.data.remaining === coverage.canonicalCount - coverage.validTargetCount
    && coverage.exact === (coverage.canonicalCount === coverage.validSourceCount
      && coverage.validSourceCount === coverage.validTargetCount
      && coverage.validTargetCount === coverage.targetCount)
    && parsed.data.complete === coverage.exact;
  if (parsed.data.processed > input.batchSize || parsed.data.written > parsed.data.processed
      || (parsed.data.complete && parsed.data.remaining !== 0)
      || (!parsed.data.complete && parsed.data.remaining === 0) || !coverageConsistent) {
    throw new KnowledgeError('The local knowledge runtime returned inconsistent backfill counters.',
      502, 'KNOWLEDGE_RUNTIME_BACKFILL_COUNTERS_INVALID', false);
  }
  return parsed.data;
}

export async function getKnowledgeGraph(input: {
  requestId: string; spaceId: string; knowledgeBase: KnowledgeBaseRef; limit?: number;
}) {
  const raw = await postRuntime('/v1/graph', {
    requestId: input.requestId, spaceId: input.spaceId,
    knowledgeBase: { id: input.knowledgeBase.id, indexVersion: input.knowledgeBase.indexVersion },
    limit: Math.max(1, Math.min(500, Math.floor(input.limit || 500)))
  }, 60_000);
  const parsed = graphResponse.safeParse(raw);
  if (!parsed.success) throw invalidRuntimeOutput('knowledge graph', parsed.error);
  const nodeIds = new Set(parsed.data.nodes.map((node) => node.id));
  if (parsed.data.edges.some((edge) => !nodeIds.has(edge.source) || !nodeIds.has(edge.target))) {
    throw new KnowledgeError('The local knowledge runtime returned graph edges outside the authorized node set.',
      502, 'KNOWLEDGE_RUNTIME_GRAPH_INVALID', false);
  }
  return {
    nodes: parsed.data.nodes.map((node) => ({ id: node.id, label: node.name, kind: node.type,
      metadata: { aliases: node.aliases, supportingSourceCount: node.supportingSourceCount } })),
    edges: parsed.data.edges.map((edge) => {
      const support = edge.supports?.[0];
      return {
        id: edge.id, source: edge.source, target: edge.target, label: edge.type,
        confidence: edge.confidence ?? null,
        documentId: edge.documentId ?? support?.documentId ?? null,
        documentName: edge.documentName ?? support?.documentName ?? null,
        page: edge.page ?? support?.page ?? null,
        excerpt: edge.quote ?? support?.quote ?? null,
        metadata: { sourceRef: edge.sourceRef ?? support?.sourceRef ?? null,
          section: edge.section ?? support?.section ?? null, supports: edge.supports || [] }
      };
    }),
    metrics: parsed.data.metrics
  };
}

export async function getKnowledgeRuntimeStatus() {
  try {
    const result = await postRuntime('/v1/status', { source: 'experience-management' }, 8_000);
    // Preserve provider, migration, resource, service and search telemetry for
    // the authenticated admin projection instead of narrowing it away here.
    return { ...result, reachable: true, ready: result.ready === true,
      components: result.components || {}, queue: result.queue || {}, version: result.version || null };
  } catch (error) {
    return { reachable: false, ready: false, error: error instanceof Error ? error.message : String(error) };
  }
}
