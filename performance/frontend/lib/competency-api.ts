'use client';
import api from './api';

export type CompetencyFailure = { message: string; code: string; status: number; fields?: Array<{ path: string; code: string; message: string }> };
export function competencyError(error: unknown): CompetencyFailure {
  const value = error as { response?: { status?: number; data?: { error?: string | { message?: string; code?: string; fields?: CompetencyFailure['fields'] }; code?: string } }; message?: string };
  const body = value.response?.data;
  const detail = typeof body?.error === 'object' ? body.error : undefined;
  return { message: detail?.message || (typeof body?.error === 'string' ? body.error : 'We could not complete this request. Please try again.'), code: detail?.code || body?.code || 'REQUEST_FAILED', status: value.response?.status || 0, fields: detail?.fields };
}
export const newIdempotencyKey = () => crypto.randomUUID();
export async function competencyRequest<T>(method: string, path: string, data?: unknown, revision?: number, idempotencyKey?: string): Promise<T> {
  const multipart = typeof FormData !== 'undefined' && data instanceof FormData;
  const response = await api.request({ method, url: `/competency${path.startsWith('/') ? path : `/${path}`}`, data, headers: {
    ...(multipart ? { 'Content-Type': undefined } : {}),
    ...(revision !== undefined ? { 'If-Match': `"${revision}"` } : {}),
    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
  } });
  return response.data.data as T;
}
export async function competencyDownload(path: string, filename = 'assessment-report.pdf'): Promise<void> {
  const response = await api.get(`/competency${path.startsWith('/') ? path : `/${path}`}`, { responseType: 'blob' });
  if (String(response.headers['content-type'] || '').includes('application/json')) throw new Error('This download is not ready yet.');
  const url = URL.createObjectURL(response.data);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename.replace(/[\\/\r\n]/g, '_');
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export interface CompetencyBootstrap {
  enabled?: boolean;
  canEnable?: boolean;
  scope?: string;
  settings?: CompetencySettings;
  capabilities: Record<string, boolean>;
  people: Array<{ userId: string; name: string; departmentId?: string; teamIds?: string[] }>;
  roles: Array<{ id: string; versionId: string; name: string; version: number; status: string }>;
  frameworks: Array<{ id: string; versionId: string; sourceType: 'sfia' | 'internal'; name: string; version: number; criteria: Array<{ id: string; name: string; description?: string; levelIds: string[] }>; levels: Array<{ id: string; label: string; description: string; order: number }> }>;
  strategies: Array<{ id: string; versionId: string; name?: string; title: string; version: number; criteria: Array<{ id: string; name: string; description?: string; levelIds: string[] }>; levels: Array<{ id: string; label: string; description: string; order: number }> }>;
  cycles?: Array<{ id: string; name: string; revision: number; status: string; roleVersionIds: string[] }>;
}
export interface CompetencySettings {
  revision: number;
  callEvidenceEnabled: boolean;
  aiDraftsEnabled: boolean;
  mediaRetentionDays: number | null;
  evidenceRetentionDays: number | null;
  exportRetentionHours: number;
  noticeText: string;
  noticeVersion?: string;
  policyVersion?: string;
}
