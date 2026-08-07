/**
 * Turning an AI failure into something a person can act on.
 *
 * The backend already answers AI failures with `{ msg, code, error }` — a
 * generic headline, a machine code, and the runtime's own words. The runtime's
 * own words are the part that matters ("you've hit your usage limit, try again
 * at ..."), and they were being thrown away: services threw the raw payload,
 * which has no `.message`, so every catch fell through to "Network error
 * occurred" and the user was told nothing at all.
 *
 * Everything that calls an AI endpoint goes through here so that never happens
 * again.
 */

export interface AiErrorPayload {
  msg?: string
  message?: string
  code?: string
  error?: string
  details?: string
}

export interface AiError extends Error {
  code?: string
  status?: number
  /** The runtime's unedited words, kept for logs and detail views. */
  detail?: string
}

/** Codes whose cause is specific enough to say something better than the
 * generic headline the endpoint attached. */
const CODE_GUIDANCE: Record<string, string> = {
  CHATGPT_NOT_CONNECTED:
    "Connect your ChatGPT account in Settings → ChatGPT account to use AI features.",
  CHATGPT_SUBJECT_UNRESOLVED:
    "Connect your ChatGPT account in Settings → ChatGPT account to use AI features.",
  CHATGPT_CONSENT_REQUIRED:
    "Confirm data sharing for your ChatGPT account before AI features can run.",
  CHATGPT_CANDIDATE_ACCOUNT_REQUIRED:
    "This interview runs on the candidate's own ChatGPT account, which is not connected yet.",
  CHATGPT_GATEWAY_UNAVAILABLE:
    "The AI runtime is temporarily unreachable. Your work is saved — try again shortly.",
  AI_ACTIVITY_DISABLED:
    "This AI feature has been turned off by an administrator.",
  AI_PROVIDER_DISABLED:
    "AI is currently turned off for this workspace.",
  REQUIRED_RUNTIME_UNAVAILABLE:
    "The AI runtime this workspace requires is not available right now."
}

/** A usage-limit refusal already names the reset time, so it is quoted rather
 * than replaced — the date is the only useful part and we must not lose it. */
function usageLimitMessage(detail: string) {
  return `ChatGPT usage limit reached. ${detail}`
}

function looksLikeUsageLimit(text: string) {
  return /usage limit|rate limit|quota|too many requests/i.test(text)
}

/**
 * The best user-facing sentence available for a failed AI call. Prefers the
 * runtime's own explanation over the endpoint's generic headline, because the
 * headline ("Failed to generate job description") only restates what the user
 * already knows.
 */
export function aiErrorMessage(
  payload: AiErrorPayload | null | undefined,
  fallback = "The AI request could not be completed."
): string {
  const detail = String(payload?.error || payload?.details || "").trim()
  const headline = String(payload?.msg || payload?.message || "").trim()
  const code = String(payload?.code || "")

  if (detail && looksLikeUsageLimit(detail)) return usageLimitMessage(detail)
  if (CODE_GUIDANCE[code]) return CODE_GUIDANCE[code]
  if (detail && detail !== headline) return headline ? `${headline}: ${detail}` : detail
  return headline || detail || fallback
}

/** Build the Error to throw from a service, carrying the code so callers (and
 * the runtime gate) can still route on it. */
export function aiError(
  payload: AiErrorPayload | null | undefined,
  status?: number,
  fallback?: string
): AiError {
  const error = new Error(aiErrorMessage(payload, fallback)) as AiError
  error.code = payload?.code
  error.status = status
  error.detail = payload?.error || payload?.details
  return error
}

/** Read a failed AI response and return the Error to throw. A body that is not
 * JSON must not mask the failure, so the status stands in for it. */
export async function readAiError(response: Response, fallback?: string): Promise<AiError> {
  const payload = await response.json().catch(() => ({} as AiErrorPayload))
  if (!payload.msg && !payload.message && !payload.error) {
    payload.msg = `The AI request failed (HTTP ${response.status}).`
  }
  return aiError(payload, response.status, fallback)
}

/**
 * For catch blocks: whatever was thrown — an Error, a raw payload object, a
 * network failure — reduced to one sentence worth showing.
 */
export function messageFromAiFailure(reason: any, fallback?: string): string {
  if (!reason) return fallback || "The AI request could not be completed."
  if (reason.code || reason.msg || reason.error || reason.details) {
    return aiErrorMessage(reason, fallback ?? reason.message)
  }
  return reason.message || fallback || "The AI request could not be completed."
}
