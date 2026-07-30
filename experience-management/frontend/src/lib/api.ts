import type { AiJob } from '@/types';

const activeSpaceStorageKey = 'seemplify-experience:active-space';
const activeSpaceTabStorageKey = 'seemplify-experience:tab-active-space';
const activeSpaceChannelName = 'seemplify-experience:space-changes';

export function activeSpaceId() {
  try { return window.sessionStorage.getItem(activeSpaceTabStorageKey) || window.localStorage.getItem(activeSpaceStorageKey) || ''; }
  catch { return ''; }
}

export function spaceScopedApiUrl(path: string) {
  const selectedSpace = activeSpaceId();
  if (!selectedSpace || !path.startsWith('/api/') || path.startsWith('/api/public/')) return path;
  const url = new URL(path, window.location.origin);
  url.searchParams.set('spaceId', selectedSpace);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function storeActiveSpaceId(spaceId: string | null, notify = true) {
  try {
    const current = window.localStorage.getItem(activeSpaceStorageKey) || '';
    if (spaceId) {
      window.sessionStorage.setItem(activeSpaceTabStorageKey, spaceId);
      window.localStorage.setItem(activeSpaceStorageKey, spaceId);
    } else {
      window.sessionStorage.removeItem(activeSpaceTabStorageKey);
      window.localStorage.removeItem(activeSpaceStorageKey);
    }
    if (notify && current !== (spaceId || '') && 'BroadcastChannel' in window) {
      const channel = new BroadcastChannel(activeSpaceChannelName);
      channel.postMessage({ type: 'space-changed', spaceId: spaceId || null });
      channel.close();
    }
  } catch { /* Storage can be unavailable in locked-down browser contexts. */ }
}

export function subscribeToSpaceChanges(onChange: (spaceId: string | null) => void) {
  let lastSeen = activeSpaceId() || null;
  const report = (spaceId: string | null) => {
    if (spaceId === lastSeen) return;
    lastSeen = spaceId;
    onChange(spaceId);
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === activeSpaceStorageKey) report(event.newValue);
  };
  window.addEventListener('storage', onStorage);
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel(activeSpaceChannelName) : null;
  if (channel) channel.onmessage = (event) => {
    if (event.data?.type === 'space-changed') report(event.data.spaceId || null);
  };
  return () => { window.removeEventListener('storage', onStorage); channel?.close(); };
}

export class ApiError extends Error {
  status: number;
  details: unknown;
  code: string | null;
  constructor(message: string, status: number, details?: unknown, code?: string | null) { super(message); this.name = 'ApiError'; this.status = status; this.details = details; this.code = code || null; }
}

async function request<T>(path: string, options: RequestInit, canRecoverSpace: boolean): Promise<T> {
  const headers = new Headers(options.headers);
  const method = String(options.method || 'GET').toUpperCase();
  if (!(options.body instanceof FormData) && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const selectedSpace = activeSpaceId();
  if (selectedSpace && path.startsWith('/api/') && !path.startsWith('/api/auth/') && !path.startsWith('/api/public/')) {
    headers.set('x-seemplify-space', selectedSpace);
  }
  const response = await fetch(path, {
    ...options,
    headers
  });
  if (response.status === 401 && !path.startsWith('/api/auth/') && !path.startsWith('/api/public/') && window.location.pathname !== '/login') {
    window.location.assign('/login');
    throw new ApiError('Authentication required.', 401);
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({}));
  const safeToRetry = method === 'GET' || method === 'HEAD';
  if (!response.ok && canRecoverSpace && safeToRetry && response.status === 403 && data.code === 'SPACE_ACCESS_DENIED' && selectedSpace) {
    storeActiveSpaceId(null);
    return request<T>(path, options, false);
  }
  if (!response.ok) throw new ApiError(data.error || `Request failed with ${response.status}`, response.status, data.details, data.code);
  return data as T;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  return request<T>(path, options, true);
}

export function json(method: string, body?: unknown): RequestInit { return { method, body: body === undefined ? undefined : JSON.stringify(body) }; }

export async function waitForJob(jobId: string, onUpdate?: (job: AiJob) => void, timeoutMs = 360_000): Promise<AiJob> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const job = await api<AiJob>(`/api/ai/jobs/${jobId}`);
    onUpdate?.(job);
    if (job.state === 'completed') return job;
    if (job.state === 'failed') throw new ApiError(job.error || 'AI job failed', 500, job);
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  throw new ApiError('AI job is still running. You can safely leave this page and return later.', 408);
}
