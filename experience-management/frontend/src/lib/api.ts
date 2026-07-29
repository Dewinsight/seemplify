import type { AiJob } from '@/types';

export class ApiError extends Error {
  status: number;
  details: unknown;
  constructor(message: string, status: number, details?: unknown) { super(message); this.name = 'ApiError'; this.status = status; this.details = details; }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: options.body instanceof FormData ? options.headers : { 'content-type': 'application/json', ...options.headers }
  });
  if (response.status === 401 && !path.startsWith('/api/auth/') && window.location.pathname !== '/login') {
    window.location.assign('/login');
    throw new ApiError('Authentication required.', 401);
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data.error || `Request failed with ${response.status}`, response.status, data.details);
  return data as T;
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
