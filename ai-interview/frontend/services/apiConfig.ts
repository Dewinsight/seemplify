const DEFAULT_API_BASE_URL = "http://localhost:5101";
const DEFAULT_WS_BASE_URL = "ws://localhost:5101";

export const getCurrentApiBaseUrl = () => (
  process.env.NEXT_PUBLIC_API_BASE_URL || DEFAULT_API_BASE_URL
).replace(/\/$/, "");

export const getCurrentWsBaseUrl = () => (
  process.env.NEXT_PUBLIC_WS_BASE_URL || DEFAULT_WS_BASE_URL
).replace(/\/$/, "");

export const API_BASE_URL = getCurrentApiBaseUrl();
export const WS_BASE_URL = getCurrentWsBaseUrl();

export const TOKEN_KEY = "aiInterviewToken";
export const ADMIN_TOKEN_KEY = "aiInterviewAdminToken";

export function getStoredToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY) || localStorage.getItem(ADMIN_TOKEN_KEY);
}

export async function apiRequest(path: string, options: RequestInit = {}) {
  const isAbsolute = /^https?:\/\//i.test(path);
  const url = isAbsolute ? path : `${getCurrentApiBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(options.headers || {});
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;

  if (options.body && !(options.body instanceof Blob) && !isFormData && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const token = getStoredToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return fetch(url, {
    ...options,
    headers,
    credentials: "omit"
  });
}
