'use client'

export type MarketingConsentChoice = 'accepted' | 'declined'

const CONSENT_COOKIE = 'seemplify_marketing_consent'
const CONSENT_STORAGE_KEY = 'seemplify-marketing-consent'

let memoryChoice: MarketingConsentChoice | null = null

function isConsentChoice(value: string | null): value is MarketingConsentChoice {
  return value === 'accepted' || value === 'declined'
}

function readCookie(name: string) {
  if (typeof document === 'undefined') return null

  try {
    const prefix = `${name}=`
    const entry = document.cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(prefix))
    return entry ? decodeURIComponent(entry.slice(prefix.length)) : null
  } catch {
    return null
  }
}

export function readMarketingConsent(): MarketingConsentChoice | null {
  if (memoryChoice) return memoryChoice
  if (typeof window === 'undefined') return memoryChoice

  const cookieChoice = readCookie(CONSENT_COOKIE)
  if (isConsentChoice(cookieChoice)) {
    memoryChoice = cookieChoice
    return cookieChoice
  }

  try {
    const storedChoice = window.localStorage.getItem(CONSENT_STORAGE_KEY)
    if (isConsentChoice(storedChoice)) {
      memoryChoice = storedChoice
      return storedChoice
    }
  } catch {
    // The in-memory choice still protects the current page when storage is blocked.
  }

  return memoryChoice
}

export function writeMarketingConsent(choice: MarketingConsentChoice) {
  memoryChoice = choice
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, choice)
  } catch {
    // Consent storage can be blocked; the current page still respects the choice.
  }

  try {
    const sharedDomain =
      window.location.hostname === 'seemplifyai.com' ||
      window.location.hostname.endsWith('.seemplifyai.com')
    const domain = sharedDomain ? '; Domain=.seemplifyai.com' : ''
    const secure = window.location.protocol === 'https:' ? '; Secure' : ''
    document.cookie = `${CONSENT_COOKIE}=${choice}; Max-Age=31536000; Path=/; SameSite=Lax${domain}${secure}`
  } catch {
    // The local or in-memory copy remains available when cookies are blocked.
  }
}

export function hasAcceptedMarketingConsent() {
  return readMarketingConsent() === 'accepted'
}
