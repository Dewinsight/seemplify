import { api, json, multipart } from '@/lib/api';
import type {
  KnowledgeBase,
  KnowledgeBaseDocument,
  KnowledgeBasePrivacy,
  KnowledgeGraph,
  KnowledgeIndexingJob,
  KnowledgeSearchResult
} from '@/types';

type RecordValue = Record<string, any>;

function record(value: unknown): RecordValue {
  return value && typeof value === 'object' ? value as RecordValue : {};
}

function list<T>(value: unknown, key: string): T[] {
  if (Array.isArray(value)) return value as T[];
  const nested = record(value)[key];
  return Array.isArray(nested) ? nested as T[] : [];
}

function count(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

export function normalizeKnowledgeBase(value: unknown): KnowledgeBase {
  const item = record(record(value).knowledgeBase || value);
  const privacy = item.privacy === 'private' || item.visibility === 'private' || item.isPrivate === true
    ? 'private'
    : 'space';
  const reportedState = item.state || item.status;
  const state = ['empty', 'indexing', 'ready', 'degraded', 'failed', 'deleting'].includes(reportedState)
    ? reportedState
    : count(item.documentCount) > 0 ? 'ready' : 'empty';
  return {
    id: String(item.id || ''),
    name: String(item.name || 'Untitled knowledge base'),
    description: String(item.description || ''),
    privacy,
    terraContextEnabled: item.terraContextEnabled === true || item.allowTerraContext === true,
    state,
    documentCount: count(item.documentCount),
    readyDocumentCount: count(item.readyDocumentCount),
    chunkCount: count(item.chunkCount),
    entityCount: count(item.entityCount),
    relationshipCount: count(item.relationshipCount),
    storageBytes: count(item.storageBytes),
    createdBy: item.createdBy ? String(item.createdBy) : null,
    embeddingProfile: item.embeddingProfile && typeof item.embeddingProfile === 'object' ? item.embeddingProfile : undefined,
    createdAt: String(item.createdAt || ''),
    updatedAt: String(item.updatedAt || ''),
    lastIndexedAt: item.lastIndexedAt ? String(item.lastIndexedAt) : null
  } as KnowledgeBase;
}

export async function getKnowledgeBases() {
  const response = await api<unknown>('/api/knowledge-bases');
  return list<unknown>(response, 'knowledgeBases').map(normalizeKnowledgeBase).filter((item) => item.id);
}

export async function getKnowledgeBase(id: string) {
  return normalizeKnowledgeBase(await api<unknown>(`/api/knowledge-bases/${encodeURIComponent(id)}`));
}

export async function createKnowledgeBase(input: { name: string; description: string; privacy: KnowledgeBasePrivacy; terraContextEnabled: boolean }) {
  return normalizeKnowledgeBase(await api<unknown>('/api/knowledge-bases', json('POST', input)));
}

export async function updateKnowledgeBase(id: string, input: Partial<Pick<KnowledgeBase, 'name' | 'description' | 'privacy' | 'terraContextEnabled'>>) {
  return normalizeKnowledgeBase(await api<unknown>(`/api/knowledge-bases/${encodeURIComponent(id)}`, json('PATCH', input)));
}

export async function deleteKnowledgeBase(id: string) {
  await api(`/api/knowledge-bases/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function getKnowledgeDocuments(id: string) {
  const response = await api<unknown>(`/api/knowledge-bases/${encodeURIComponent(id)}/documents`);
  return list<KnowledgeBaseDocument>(response, 'documents');
}

export async function uploadKnowledgeDocuments(id: string, files: File[]) {
  const body = new FormData();
  for (const file of files) body.append('files', file, file.name);
  return api<unknown>(`/api/knowledge-bases/${encodeURIComponent(id)}/documents`, multipart('POST', body));
}

export async function addSignedAgreementToKnowledge(input: {
  knowledgeBaseId: string; envelopeId: string; artifactId: string;
}) {
  return api<unknown>(
    `/api/knowledge-bases/${encodeURIComponent(input.knowledgeBaseId)}/agreements/${encodeURIComponent(input.envelopeId)}/artifacts/${encodeURIComponent(input.artifactId)}`,
    {
      method: 'POST',
      headers: { 'idempotency-key': `agreement:${input.envelopeId}:${input.artifactId}:${input.knowledgeBaseId}` }
    }
  );
}

export async function deleteKnowledgeDocument(knowledgeBaseId: string, documentId: string) {
  await api(`/api/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/documents/${encodeURIComponent(documentId)}`, { method: 'DELETE' });
}

export async function retryKnowledgeDocument(knowledgeBaseId: string, documentId: string) {
  return api<unknown>(`/api/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/documents/${encodeURIComponent(documentId)}/retry`, { method: 'POST' });
}

export async function getKnowledgeIndexingJobs(id: string) {
  const response = await api<unknown>(`/api/knowledge-bases/${encodeURIComponent(id)}/indexing-jobs?limit=100`);
  return list<KnowledgeIndexingJob>(response, 'jobs').length
    ? list<KnowledgeIndexingJob>(response, 'jobs')
    : list<KnowledgeIndexingJob>(response, 'indexingJobs');
}

export async function searchKnowledgeBase(id: string, query: string, includeAnswer = true) {
  const response = await api<KnowledgeSearchResult | { result: KnowledgeSearchResult }>(
    `/api/knowledge-bases/${encodeURIComponent(id)}/search`,
    json('POST', { query, limit: 10, includeAnswer })
  );
  return 'result' in response ? response.result : response;
}

export async function getKnowledgeGraph(id: string) {
  const response = await api<KnowledgeGraph | { graph: KnowledgeGraph }>(`/api/knowledge-bases/${encodeURIComponent(id)}/graph`);
  return 'graph' in response ? response.graph : response;
}
