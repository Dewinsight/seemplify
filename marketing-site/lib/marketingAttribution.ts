'use client'

import { hasAcceptedMarketingConsent } from '@/lib/marketingConsent'

export const ATTRIBUTION_QUERY_PARAM = 'sa_ct'
const STORAGE_KEY = 'seemplify-marketing-attribution'
const SESSION_ACTIVITY_KEY = 'seemplify-marketing-session-activity'
const SESSION_INACTIVITY_MS = 30 * 60 * 1000

let memoryState: MarketingAttributionState | null = null
let memorySessionActivity = 0

function emptyState(): MarketingAttributionState {
  return {
    visitorId: '',
    sessionId: '',
    attributionToken: '',
    utmSource: '',
    utmMedium: '',
    utmCampaign: '',
    utmTerm: '',
    utmContent: '',
    landingPage: '',
    referrer: '',
  }
}

export type MarketingAttributionState = {
  visitorId: string
  sessionId: string
  attributionToken: string
  utmSource: string
  utmMedium: string
  utmCampaign: string
  utmTerm: string
  utmContent: string
  landingPage: string
  referrer: string
}

function randomId() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function defaultState(): MarketingAttributionState {
  return {
    visitorId: randomId(),
    sessionId: randomId(),
    attributionToken: '',
    utmSource: '',
    utmMedium: '',
    utmCampaign: '',
    utmTerm: '',
    utmContent: '',
    landingPage: '',
    referrer: '',
  }
}

function isBrowser() {
  return typeof window !== 'undefined'
}

function currentLocationSearch() {
  if (!isBrowser()) return ''

  try {
    return window.location.search
  } catch {
    return ''
  }
}

function currentLocationHref() {
  if (!isBrowser()) return ''

  try {
    return window.location.href
  } catch {
    return ''
  }
}

function currentLocationOrigin() {
  if (!isBrowser()) return 'https://seemplifyai.com'

  try {
    return window.location.origin
  } catch {
    return 'https://seemplifyai.com'
  }
}

function currentReferrer() {
  if (typeof document === 'undefined') return ''

  try {
    return document.referrer
  } catch {
    return ''
  }
}

function readSessionActivity() {
  if (!isBrowser()) return memorySessionActivity

  try {
    const value = Number(window.sessionStorage.getItem(SESSION_ACTIVITY_KEY))
    return Number.isFinite(value) && value > 0 ? value : 0
  } catch {
    return memorySessionActivity
  }
}

function writeSessionActivity(timestamp: number) {
  memorySessionActivity = timestamp
  if (!isBrowser()) return

  try {
    window.sessionStorage.setItem(SESSION_ACTIVITY_KEY, String(timestamp))
  } catch {
    // Storage can be unavailable in privacy-restricted or embedded contexts.
  }
}

export function readAttributionState(): MarketingAttributionState {
  if (!hasAcceptedMarketingConsent()) return emptyState()

  if (!isBrowser()) {
    memoryState ||= defaultState()
    return { ...memoryState }
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      memoryState ||= defaultState()
      return { ...memoryState }
    }

    const state = { ...defaultState(), ...JSON.parse(raw) }
    memoryState = state
    return { ...state }
  } catch {
    memoryState ||= defaultState()
    return { ...memoryState }
  }
}

export function writeAttributionState(state: MarketingAttributionState) {
  if (!hasAcceptedMarketingConsent()) return

  memoryState = { ...state }
  if (!isBrowser()) return

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // The in-memory copy keeps attribution stable when storage is blocked.
  }
}

export function ensureAttributionState(search?: string): MarketingAttributionState {
  if (!hasAcceptedMarketingConsent()) return emptyState()

  const current = readAttributionState()
  const params = new URLSearchParams(search ?? currentLocationSearch())
  const now = Date.now()
  const lastActivity = readSessionActivity()
  const sessionExpired = !lastActivity || now - lastActivity > SESSION_INACTIVITY_MS

  const next: MarketingAttributionState = {
    ...current,
    visitorId: current.visitorId || randomId(),
    sessionId: sessionExpired ? randomId() : current.sessionId || randomId(),
    attributionToken: params.get(ATTRIBUTION_QUERY_PARAM) || current.attributionToken || '',
    utmSource: params.get('utm_source') || current.utmSource || '',
    utmMedium: params.get('utm_medium') || current.utmMedium || '',
    utmCampaign: params.get('utm_campaign') || current.utmCampaign || '',
    utmTerm: params.get('utm_term') || current.utmTerm || '',
    utmContent: params.get('utm_content') || current.utmContent || '',
    landingPage: current.landingPage || currentLocationHref(),
    referrer: currentReferrer() || current.referrer || '',
  }

  writeAttributionState(next)
  writeSessionActivity(now)
  return next
}

export function buildAttributedUrl(urlInput: string, state = ensureAttributionState()) {
  if (!hasAcceptedMarketingConsent()) return urlInput

  try {
    const url = new URL(urlInput, currentLocationOrigin())
    if (state.attributionToken) url.searchParams.set(ATTRIBUTION_QUERY_PARAM, state.attributionToken)
    if (state.utmSource) url.searchParams.set('utm_source', state.utmSource)
    if (state.utmMedium) url.searchParams.set('utm_medium', state.utmMedium)
    if (state.utmCampaign) url.searchParams.set('utm_campaign', state.utmCampaign)
    if (state.utmTerm) url.searchParams.set('utm_term', state.utmTerm)
    if (state.utmContent) url.searchParams.set('utm_content', state.utmContent)
    if (state.visitorId) url.searchParams.set('visitorId', state.visitorId)
    if (state.sessionId) url.searchParams.set('sessionId', state.sessionId)
    return url.toString()
  } catch {
    return urlInput
  }
}

export async function trackMarketingVisit(endpoint: string, payload: Record<string, unknown>) {
  if (!hasAcceptedMarketingConsent()) return null

  const state = ensureAttributionState()
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-seemplify-visitor-id': state.visitorId,
      'x-seemplify-session-id': state.sessionId,
    },
    body: JSON.stringify({
      ...payload,
      visitorId: state.visitorId,
      sessionId: state.sessionId,
      attributionToken: state.attributionToken,
      utm_source: state.utmSource,
      utm_medium: state.utmMedium,
      utm_campaign: state.utmCampaign,
      utm_term: state.utmTerm,
      utm_content: state.utmContent,
      landingPage: state.landingPage,
      referrer: state.referrer,
    }),
    keepalive: true,
  })

  const json = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error((json as { error?: string } | null)?.error || 'Failed to track marketing visit')
  }
  return json
}

export function clearAttributionState() {
  memoryState = null
  memorySessionActivity = 0
  if (!isBrowser()) return

  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage may be unavailable in restricted contexts.
  }

  try {
    window.sessionStorage.removeItem(SESSION_ACTIVITY_KEY)
  } catch {
    // Storage may be unavailable in restricted contexts.
  }
}
