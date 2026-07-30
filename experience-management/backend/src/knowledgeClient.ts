import crypto from 'node:crypto';
import fs from 'node:fs';
import { z } from 'zod';
import { config } from './config.js';
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

const retrieveResponse = z.object({
  citations: z.array(citationSchema).max(20),
  metrics: z.record(z.string(), z.unknown()).optional().default({})
});

const graphResponse = z.object({
  nodes: z.array(z.object({
    id: z.string().trim().min(1).max(300), type: z.string().trim().min(1).max(100),
    name: z.string().trim().min(1).max(500), aliases: z.array(z.string().trim().min(1).max(500)).max(50).optional().default([])
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

function invalidRuntimeOutput(name: string, error: z.ZodError) {
  return new KnowledgeError(`The local knowledge runtime returned invalid ${name}: ${error.issues.slice(0, 5).map((issue) => issue.message).join('; ')}`,
    502, 'KNOWLEDGE_RUNTIME_INVALID_RESPONSE', false);
}

export async function indexKnowledgeDocument(input: {
  jobId: string;
  spaceId: string;
  knowledgeBase: KnowledgeBaseRef;
  targetVersion: number;
  document: {
    id: string; sourcePath: string; originalName: string; mimeType: string; sizeBytes: number; sha256: string;
    metadata?: Record<string, unknown>;
  };
}) {
  const raw = await postRuntime('/v1/index', {
    jobId: input.jobId,
    spaceId: input.spaceId,
    knowledgeBase: { ...input.knowledgeBase, indexVersion: input.targetVersion },
    document: input.document
  }, 30 * 60_000);
  const parsed = indexResponse.safeParse(raw);
  if (!parsed.success) throw invalidRuntimeOutput('index result', parsed.error);
  return parsed.data;
}

export async function retrieveKnowledge(input: {
  requestId: string; spaceId: string; knowledgeBases: KnowledgeBaseRef[]; query: string;
  topK?: number; graphDepth?: 1 | 2;
}) {
  const raw = await postRuntime('/v1/retrieve', {
    requestId: input.requestId,
    spaceId: input.spaceId,
    knowledgeBases: input.knowledgeBases,
    query: input.query,
    topK: input.topK ?? config.knowledgeRetrieveTopK,
    graphDepth: input.graphDepth ?? 2,
    retrieval: { vector: true, bm25: true, fusion: 'rrf', rerank: true }
  }, 120_000);
  const parsed = retrieveResponse.safeParse(raw);
  if (!parsed.success) throw invalidRuntimeOutput('retrieval result', parsed.error);
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

export async function deleteKnowledgeIndex(input: {
  jobId: string; spaceId: string; knowledgeBaseId: string; targetVersion: number;
  documentId?: string | null;
}) {
  return postRuntime('/v1/delete', {
    jobId: input.jobId, spaceId: input.spaceId, knowledgeBaseId: input.knowledgeBaseId,
    documentId: input.documentId || undefined, indexVersion: input.targetVersion
  }, 10 * 60_000);
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
      metadata: node.aliases.length ? { aliases: node.aliases } : undefined })),
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
    return { reachable: true, ready: result.ready === true, components: result.components || {}, queue: result.queue || {}, version: result.version || null };
  } catch (error) {
    return { reachable: false, ready: false, error: error instanceof Error ? error.message : String(error) };
  }
}
