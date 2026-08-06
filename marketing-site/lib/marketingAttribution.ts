'use client'

export const ATTRIBUTION_QUERY_PARAM = 'sa_ct'
const STORAGE_KEY = 'seemplify-marketing-attribution'

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

export function readAttributionState(): MarketingAttributionState {
  if (typeof window === 'undefined') return defaultState()

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultState()
    return { ...defaultState(), ...JSON.parse(raw) }
  } catch {
    return defaultState()
  }
}

export function writeAttributionState(state: MarketingAttributionState) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function ensureAttributionState(search = window.location.search): MarketingAttributionState {
  const current = readAttributionState()
  const params = new URLSearchParams(search)

  const next: MarketingAttributionState = {
    ...current,
    visitorId: current.visitorId || randomId(),
    sessionId: current.sessionId || randomId(),
    attributionToken: params.get(ATTRIBUTION_QUERY_PARAM) || current.attributionToken || '',
    utmSource: params.get('utm_source') || current.utmSource || '',
    utmMedium: params.get('utm_medium') || current.utmMedium || '',
    utmCampaign: params.get('utm_campaign') || current.utmCampaign || '',
    utmTerm: params.get('utm_term') || current.utmTerm || '',
    utmContent: params.get('utm_content') || current.utmContent || '',
    landingPage: current.landingPage || window.location.href,
    referrer: document.referrer || current.referrer || '',
  }

  writeAttributionState(next)
  return next
}

export function buildAttributedUrl(urlInput: string, state = ensureAttributionState()) {
  const url = new URL(urlInput, window.location.origin)
  if (state.attributionToken) url.searchParams.set(ATTRIBUTION_QUERY_PARAM, state.attributionToken)
  if (state.utmSource) url.searchParams.set('utm_source', state.utmSource)
  if (state.utmMedium) url.searchParams.set('utm_medium', state.utmMedium)
  if (state.utmCampaign) url.searchParams.set('utm_campaign', state.utmCampaign)
  if (state.utmTerm) url.searchParams.set('utm_term', state.utmTerm)
  if (state.utmContent) url.searchParams.set('utm_content', state.utmContent)
  url.searchParams.set('visitorId', state.visitorId)
  url.searchParams.set('sessionId', state.sessionId)
  return url.toString()
}

export async function trackMarketingVisit(endpoint: string, payload: Record<string, unknown>) {
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
