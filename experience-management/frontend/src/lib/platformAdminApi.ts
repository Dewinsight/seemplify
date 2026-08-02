export class PlatformAdminApiError extends Error {
  status: number;
  code: string | null;
  details: unknown;

  constructor(message: string, status: number, code?: string | null, details?: unknown) {
    super(message);
    this.name = 'PlatformAdminApiError';
    this.status = status;
    this.code = code || null;
    this.details = details;
  }
}

function assertPlatformPath(path: string) {
  if (!path.startsWith('/api/platform-admin/')) {
    throw new Error(`Platform administrator requests must use /api/platform-admin/: ${path}`);
  }
}

export async function platformAdminApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  assertPlatformPath(path);
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData) && !headers.has('content-type')) headers.set('content-type', 'application/json');
  headers.set('accept', 'application/json');
  const response = await fetch(path, { ...options, headers, credentials: 'same-origin' });
  if (response.status === 401) {
    window.location.assign('/login');
    throw new PlatformAdminApiError('Authentication required.', 401, 'AUTH_REQUIRED');
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new PlatformAdminApiError(
      String(data.error || `Request failed with ${response.status}.`),
      response.status,
      data.code,
      data.details
    );
  }
  return data as T;
}

export function platformAdminJson(method: string, body: unknown, idempotencyKey?: string): RequestInit {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (idempotencyKey) headers.set('idempotency-key', idempotencyKey);
  return { method, headers, body: JSON.stringify(body) };
}

export function platformAdminQuery(path: string, values: Record<string, string | number | boolean | null | undefined>) {
  assertPlatformPath(path);
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(values)) {
    if (value !== null && value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
  return `${url.pathname}${url.search}`;
}

export interface PlatformAdminPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export function normalizePlatformAdminPage<T>(value: unknown, fallbackPage = 1, fallbackPageSize = 25): PlatformAdminPage<T> {
  const source = value as Record<string, unknown> | null;
  const pagination = source?.pagination as Record<string, unknown> | null | undefined;
  const namedItems = ['users', 'spaces', 'requests', 'subscriptions', 'events']
    .map((key) => source?.[key])
    .find(Array.isArray);
  const items = Array.isArray(value)
    ? value as T[]
    : Array.isArray(source?.items)
      ? source.items as T[]
      : Array.isArray(source?.rows)
        ? source.rows as T[]
      : Array.isArray(source?.data)
          ? source.data as T[]
          : Array.isArray(namedItems)
            ? namedItems as T[]
            : [];
  const total = Number(pagination?.total ?? source?.total ?? source?.count ?? items.length);
  const pageSize = Math.max(1, Number(pagination?.limit ?? source?.pageSize ?? source?.limit ?? fallbackPageSize));
  const offset = Math.max(0, Number(pagination?.offset ?? 0));
  const page = Math.max(1, Number(source?.page ?? (offset ? Math.floor(offset / pageSize) + 1 : fallbackPage)));
  return {
    items,
    total: Number.isFinite(total) ? total : items.length,
    page,
    pageSize,
    hasMore: Boolean(pagination?.hasMore ?? source?.hasMore ?? source?.nextCursor ?? page * pageSize < total)
  };
}

export function platformAdminErrorMessage(reason: unknown, fallback: string) {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}
