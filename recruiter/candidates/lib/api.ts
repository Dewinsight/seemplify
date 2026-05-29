"use client"

import type {
  AuthResponse,
  CandidateAccount,
  CandidateDocumentPayload,
  CandidateOnboarding,
} from "./types"

const API_BASE_URL = (process.env.NEXT_PUBLIC_RECRUITER_API_BASE_URL || "").replace(/\/$/, "")
const ACCESS_TOKEN_KEY = "seemplify_candidate_access_token"
const REFRESH_TOKEN_KEY = "seemplify_candidate_refresh_token"
const ACCOUNT_KEY = "seemplify_candidate_account"

function buildUrl(path: string) {
  if (path.startsWith("http")) return path
  return API_BASE_URL ? `${API_BASE_URL}${path}` : path
}

function hasWindow() {
  return typeof window !== "undefined"
}

export function getAccessToken() {
  return hasWindow() ? window.localStorage.getItem(ACCESS_TOKEN_KEY) : null
}

export function getStoredAccount(): CandidateAccount | null {
  if (!hasWindow()) return null
  const raw = window.localStorage.getItem(ACCOUNT_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as CandidateAccount
  } catch {
    return null
  }
}

export function storeAuth(result: AuthResponse) {
  if (!hasWindow()) return
  window.localStorage.setItem(ACCESS_TOKEN_KEY, result.token)
  window.localStorage.setItem(REFRESH_TOKEN_KEY, result.refreshToken)
  window.localStorage.setItem(ACCOUNT_KEY, JSON.stringify(result.account))
}

export function clearAuth() {
  if (!hasWindow()) return
  window.localStorage.removeItem(ACCESS_TOKEN_KEY)
  window.localStorage.removeItem(REFRESH_TOKEN_KEY)
  window.localStorage.removeItem(ACCOUNT_KEY)
}

async function parseResponse<T>(response: Response, fallback: string): Promise<T> {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload.msg || payload.error || fallback)
  }
  return payload as T
}

async function parseFileError(response: Response, fallback: string) {
  const contentType = response.headers.get("content-type") || ""
  if (contentType.includes("application/json")) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.msg || payload.error || fallback)
  }

  const text = await response.text().catch(() => "")
  throw new Error(text || fallback)
}

async function refreshAccessToken() {
  if (!hasWindow()) return null
  const refreshToken = window.localStorage.getItem(REFRESH_TOKEN_KEY)
  if (!refreshToken) return null

  const response = await fetch(buildUrl("/api/candidate-portal/auth/refresh"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  })

  if (!response.ok) {
    clearAuth()
    return null
  }

  const result = await response.json() as Omit<AuthResponse, "account">
  window.localStorage.setItem(ACCESS_TOKEN_KEY, result.token)
  window.localStorage.setItem(REFRESH_TOKEN_KEY, result.refreshToken)
  return result.token
}

export async function candidateRequest<T>(
  path: string,
  options: RequestInit = {},
  retryAfterRefresh = true,
): Promise<T> {
  const token = getAccessToken()
  const isFormData = options.body instanceof FormData
  const headers = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  }

  const response = await fetch(buildUrl(path), {
    ...options,
    headers,
  })

  if (response.status === 401 && retryAfterRefresh) {
    const refreshed = await refreshAccessToken()
    if (refreshed) {
      return candidateRequest<T>(path, options, false)
    }
  }

  return parseResponse<T>(response, "Request failed")
}

async function candidateFileRequest(
  path: string,
  options: RequestInit = {},
  retryAfterRefresh = true,
): Promise<Response> {
  const token = getAccessToken()
  const headers = {
    Accept: "application/pdf",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  }

  const response = await fetch(buildUrl(path), {
    ...options,
    headers,
  })

  if (response.status === 401 && retryAfterRefresh) {
    const refreshed = await refreshAccessToken()
    if (refreshed) {
      return candidateFileRequest(path, options, false)
    }
  }

  if (!response.ok) {
    await parseFileError(response, "File request failed")
  }

  return response
}

function filenameFromDisposition(disposition: string | null, fallback: string) {
  if (!disposition) return fallback

  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1].replace(/"/g, ""))
  }

  const plainMatch = disposition.match(/filename="?([^";]+)"?/i)
  return plainMatch?.[1] || fallback
}

export async function acceptInvite(token: string, password: string) {
  const result = await candidateRequest<AuthResponse>("/api/candidate-portal/auth/accept-invite", {
    method: "POST",
    body: JSON.stringify({ token, password }),
  }, false)
  storeAuth(result)
  return result
}

export async function login(email: string, password: string) {
  const result = await candidateRequest<AuthResponse>("/api/candidate-portal/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  }, false)
  storeAuth(result)
  return result
}

export async function logout() {
  try {
    await candidateRequest<{ msg: string }>("/api/candidate-portal/auth/logout", { method: "POST" })
  } finally {
    clearAuth()
  }
}

export async function getMe() {
  return candidateRequest<{ account: CandidateAccount }>("/api/candidate-portal/me")
}

export async function getOnboardingList() {
  return candidateRequest<{ data: CandidateOnboarding[] }>("/api/candidate-portal/onboarding")
}

export async function getOnboarding(id: string) {
  return candidateRequest<{ data: CandidateOnboarding }>(`/api/candidate-portal/onboarding/${id}`)
}

export async function getDocument(id: string) {
  return candidateRequest<{ data: CandidateDocumentPayload }>(`/api/candidate-portal/documents/${id}`)
}

export async function getDocumentPreviewBlob(id: string) {
  const response = await candidateFileRequest(`/api/candidate-portal/documents/${id}/preview`)
  return response.blob()
}

export async function signDocument(id: string, signatureDataUrl: string) {
  return candidateRequest<{ data: unknown }>(`/api/candidate-portal/documents/${id}/sign`, {
    method: "POST",
    body: JSON.stringify({ signatureDataUrl }),
  })
}

export async function downloadDocumentBlob(id: string) {
  const response = await candidateFileRequest(`/api/candidate-portal/documents/${id}/download`)
  const fallbackName = `onboarding-document-${id}.pdf`
  return {
    blob: await response.blob(),
    fileName: filenameFromDisposition(response.headers.get("content-disposition"), fallbackName),
  }
}

export function candidateDocumentDownloadPath(id: string) {
  return buildUrl(`/api/candidate-portal/documents/${id}/download`)
}

export function fullName(account?: CandidateAccount | null) {
  const name = `${account?.profile?.firstName || ""} ${account?.profile?.lastName || ""}`.trim()
  return name || account?.email || "Candidate"
}
