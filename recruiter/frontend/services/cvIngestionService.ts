import { apiRequest } from "./apiConfig";
import type { CVIngestionJob } from "./candidateService";

export type CVIngestionState = "queued" | "waiting_for_chatgpt" | "processing" | "completed" | "failed" | "cancelled" | "deleted";

export type CVIngestionListFilters = {
  page?: number;
  limit?: number;
  state?: CVIngestionState | "";
  source?: "private" | "public" | "bulk" | "replacement" | "ai-interview" | "";
  search?: string;
  from?: string;
  to?: string;
  organizationId?: string;
};

export type CVIngestionJobList = {
  page: number;
  limit: number;
  total: number;
  pages: number;
  jobs: CVIngestionJob[];
  retentionDays?: number;
  coverageStartedAt?: string | null;
  processingSummary?: {
    mode: "sequential" | "parallel";
    concurrency: number;
    active: number;
    queued: number;
    waitingForRuntime: number;
    reanalysis: number;
    currentJobId?: string | null;
    nextJobId?: string | null;
  };
  measuredAt?: string | null;
};

export type CVIngestionOrganizationOption = {
  id: string;
  name: string;
};

function queryString(filters: CVIngestionListFilters) {
  const query = new URLSearchParams();
  if (filters.page) query.set("page", String(filters.page));
  if (filters.limit) query.set("limit", String(filters.limit));
  if (filters.state) query.set("state", filters.state);
  if (filters.source) query.set("source", filters.source);
  if (filters.search?.trim()) query.set("search", filters.search.trim());
  if (filters.from) query.set("from", filters.from);
  if (filters.to) query.set("to", filters.to);
  if (filters.organizationId) query.set("organizationId", filters.organizationId);
  return query.toString();
}

async function json<T>(path: string, init?: RequestInit, admin = false): Promise<T> {
  const adminToken = admin && typeof window !== "undefined" ? localStorage.getItem("adminToken") : null;
  const response = await apiRequest(path, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers as Record<string, string> | undefined),
      ...(adminToken ? { "x-admin-auth-token": adminToken } : {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.msg || payload.message || "CV processing request failed");
    (error as Error & { status?: number; code?: string }).status = response.status;
    (error as Error & { status?: number; code?: string }).code = payload.code;
    throw error;
  }
  return payload as T;
}

export function getCVIngestionJobs(filters: CVIngestionListFilters = {}) {
  return json<CVIngestionJobList>(`/api/cv-ingestion/jobs?${queryString(filters)}`);
}

export function getCVIngestionJob(jobId: string) {
  return json<CVIngestionJob>(`/api/cv-ingestion/jobs/${encodeURIComponent(jobId)}`);
}

export function getAdminCVIngestionJobs(filters: CVIngestionListFilters = {}) {
  return json<CVIngestionJobList>(`/api/admin/cv-ingestion/jobs?${queryString(filters)}`, undefined, true);
}

export function getAdminCVIngestionJob(jobId: string) {
  return json<CVIngestionJob>(`/api/admin/cv-ingestion/jobs/${encodeURIComponent(jobId)}`, undefined, true);
}

export function getAdminCVIngestionOrganizations(search = "", limit = 200) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (search.trim()) query.set("search", search.trim());
  return json<{ organizations: CVIngestionOrganizationOption[] }>(
    `/api/admin/cv-ingestion/organizations?${query.toString()}`,
    undefined,
    true,
  );
}

export function retryAdminCVIngestionJob(
  jobId: string,
  stage: "failed" | "parsing" | "analysis" = "failed",
) {
  return json<{
    job: CVIngestionJob;
    queueAvailable?: boolean;
    requestedStage?: string;
    effectiveStage?: string;
    requestedAt?: string;
  }>(`/api/admin/cv-ingestion/jobs/${encodeURIComponent(jobId)}/retry`, {
    method: "POST",
    body: JSON.stringify({ stage }),
  }, true);
}
