let csrfToken = "";

export function setCsrf(value: string) { csrfToken = value; }

export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(!["GET", "HEAD"].includes(String(init.method || "GET").toUpperCase()) && csrfToken ? { "X-Seemplify-CSRF": csrfToken } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  const body = (() => { try { return text ? JSON.parse(text) : null; } catch { return text; } })();
  if (!response.ok) {
    const error = new Error(body?.error || `Request failed with ${response.status}.`) as Error & { code?: string; details?: unknown };
    error.code = body?.code; error.details = body?.details;
    throw error;
  }
  return body as T;
}

export const mutate = <T = any>(path: string, method: string, body?: unknown) => api<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
