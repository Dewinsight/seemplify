import crypto from 'crypto'

const DISCOVERY_TTL_MS = 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 12_000
let discoveryCache = null

const trimTrailingSlash = (value) => String(value || '').trim().replace(/\/+$/, '')
const base64Url = (value) => Buffer.from(value).toString('base64url')

const requestJson = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      accept: 'application/json',
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(
      payload?.error_description
      || payload?.error
      || `Identity service returned ${response.status}.`
    )
    error.statusCode = response.status
    error.code = payload?.error || 'IDP_REQUEST_FAILED'
    throw error
  }
  return payload
}

export function getIdpOidcConfig() {
  const issuer = trimTrailingSlash(
    process.env.IDP_ISSUER_URL
    || process.env.OIDC_ISSUER_URL
    || process.env.OIDC_ISSUER
    || 'https://auth.seemplifyai.com'
  )
  const clientId = String(process.env.OIDC_CLIENT_ID || 'seemplify-learning').trim()
  const clientSecret = String(
    process.env.OIDC_CLIENT_SECRET
    || (process.env.NODE_ENV === 'production' ? '' : 'seemplify-learning-secret')
  ).trim()
  return { issuer, clientId, clientSecret }
}

export function isIdpOidcConfigured() {
  const config = getIdpOidcConfig()
  return Boolean(config.issuer && config.clientId && config.clientSecret)
}

export function buildOidcRedirectUri(req) {
  const configured = String(process.env.OIDC_REDIRECT_URI || '').trim()
  if (configured) return configured
  return `${req.protocol}://${req.get('host')}/auth/seemplify/callback`
}

export async function discoverIdp() {
  const { issuer } = getIdpOidcConfig()
  if (!issuer) throw new Error('The Seemplify identity issuer is not configured.')

  if (
    discoveryCache
    && discoveryCache.issuer === issuer
    && (Date.now() - discoveryCache.loadedAt) < DISCOVERY_TTL_MS
  ) {
    return discoveryCache.document
  }

  const document = await requestJson(`${issuer}/.well-known/openid-configuration`)
  if (!document.authorization_endpoint || !document.token_endpoint || !document.userinfo_endpoint) {
    throw new Error('The Seemplify identity service returned incomplete OIDC metadata.')
  }
  discoveryCache = { issuer, loadedAt: Date.now(), document }
  return document
}

export function createOidcTransaction(returnTo = '/simple-lms') {
  const codeVerifier = base64Url(crypto.randomBytes(48))
  const codeChallenge = base64Url(crypto.createHash('sha256').update(codeVerifier).digest())
  return {
    state: base64Url(crypto.randomBytes(32)),
    nonce: base64Url(crypto.randomBytes(32)),
    codeVerifier,
    codeChallenge,
    returnTo,
    createdAt: Date.now()
  }
}

export async function buildIdpAuthorizationUrl({ req, transaction, hubToken = '' }) {
  const metadata = await discoverIdp()
  const { clientId } = getIdpOidcConfig()
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: buildOidcRedirectUri(req),
    response_type: 'code',
    scope: 'openid email profile offline_access',
    state: transaction.state,
    nonce: transaction.nonce,
    code_challenge: transaction.codeChallenge,
    code_challenge_method: 'S256'
  })
  if (hubToken) params.set('hub_token', String(hubToken).trim())
  return `${metadata.authorization_endpoint}?${params.toString()}`
}

const tokenAuthorizationHeader = () => {
  const { clientId, clientSecret } = getIdpOidcConfig()
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
}

export async function exchangeAuthorizationCode({ req, code, codeVerifier }) {
  const metadata = await discoverIdp()
  const { clientId } = getIdpOidcConfig()
  return requestJson(metadata.token_endpoint, {
    method: 'POST',
    headers: {
      authorization: tokenAuthorizationHeader(),
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: String(code || ''),
      redirect_uri: buildOidcRedirectUri(req),
      client_id: clientId,
      code_verifier: String(codeVerifier || '')
    }).toString()
  })
}

export async function refreshIdpTokens(refreshToken) {
  const metadata = await discoverIdp()
  const { clientId } = getIdpOidcConfig()
  return requestJson(metadata.token_endpoint, {
    method: 'POST',
    headers: {
      authorization: tokenAuthorizationHeader(),
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: String(refreshToken || ''),
      client_id: clientId
    }).toString()
  })
}

export async function fetchIdpUserInfo(accessToken) {
  const metadata = await discoverIdp()
  return requestJson(metadata.userinfo_endpoint, {
    headers: { authorization: `Bearer ${String(accessToken || '').trim()}` }
  })
}

export async function fetchIdpOrganizationMembers({ accessToken, organizationId }) {
  const { issuer } = getIdpOidcConfig()
  const normalizedOrganizationId = String(organizationId || '').trim()
  if (!normalizedOrganizationId) throw new Error('Organization id is required for IdP member sync.')
  return requestJson(
    `${issuer}/api/organizations/${encodeURIComponent(normalizedOrganizationId)}/members`,
    { headers: { authorization: `Bearer ${String(accessToken || '').trim()}` } }
  )
}

export function toSessionTokenSet(tokenSet = {}, previousRefreshToken = '') {
  const expiresIn = Math.max(60, Number(tokenSet.expires_in || 3600))
  return {
    accessToken: String(tokenSet.access_token || '').trim(),
    refreshToken: String(tokenSet.refresh_token || previousRefreshToken || '').trim(),
    idToken: String(tokenSet.id_token || '').trim(),
    expiresAt: Date.now() + (expiresIn * 1000)
  }
}

export async function getFreshSessionAccessToken(session) {
  const tokens = session?.idpTokens || null
  if (!tokens?.accessToken) throw new Error('Reconnect your Seemplify account to sync staff.')
  if (Number(tokens.expiresAt || 0) > Date.now() + 30_000) return tokens.accessToken
  if (!tokens.refreshToken) throw new Error('Your Seemplify session has expired. Sign in with Seemplify again.')

  const refreshed = await refreshIdpTokens(tokens.refreshToken)
  session.idpTokens = toSessionTokenSet(refreshed, tokens.refreshToken)
  return session.idpTokens.accessToken
}
