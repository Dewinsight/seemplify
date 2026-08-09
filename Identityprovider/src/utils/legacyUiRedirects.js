const LEGACY_IDP_ONBOARDING_UI_PATHS = [
  /^\/documents\/?$/,
  /^\/documents\/(?:my|workspace)\/?$/,
  /^\/profile\/documents\/?$/,
  /^\/onboarding\/?$/,
  /^\/organizations\/[^/]+\/onboarding\/?$/,
  /^\/organizations\/[^/]+\/onboarding\/assignments\/[^/]+\/?$/
]

export function isLegacyIdpOnboardingUiPath(pathname) {
  const normalizedPath = String(pathname || '').trim()
  return LEGACY_IDP_ONBOARDING_UI_PATHS.some(pattern => pattern.test(normalizedPath))
}

export function buildRecruiterLaunchUrl(issuerUrl) {
  const baseUrl = String(issuerUrl || '').trim() || 'http://localhost:4000'
  try {
    return new URL('/launch/smarthr', baseUrl).toString()
  } catch (_) {
    return 'https://auth.seemplifyai.com/launch/smarthr'
  }
}
