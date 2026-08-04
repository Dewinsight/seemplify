import crypto from 'node:crypto';
import { config } from './config.js';

const maximumResponseBytes = 2 * 1024 * 1024;
const requestTimeoutMs = 20_000;

export type XRateLimit = { limit: number | null; remaining: number | null; resetAt: string | null; observedAt: string };

export class XApiError extends Error {
  status: number;
  code: 'authentication' | 'billing' | 'permission' | 'rate_limit' | 'network' | 'provider';
  retryAt: string | null;
  retryable: boolean;
  problemType: string | null;
  constructor(message: string, status: number, code: XApiError['code'], retryable = false, retryAt: string | null = null, problemType: string | null = null) {
    super(message); this.name = 'XApiError'; this.status = status; this.code = code; this.retryable = retryable; this.retryAt = retryAt; this.problemType = problemType;
  }
}

export function oauthPercentEncode(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function normalizedOAuthParameters(parameters: Array<[string, string]>) {
  const ordinal = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
  return parameters.map(([key, value]) => [oauthPercentEncode(key), oauthPercentEncode(value)] as const)
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => ordinal(leftKey, rightKey) || ordinal(leftValue, rightValue))
    .map(([key, value]) => `${key}=${value}`).join('&');
}

export function buildOAuthAuthorization(input: {
  method: string;
  url: string;
  consumerKey: string;
  consumerSecret: string;
  token?: string;
  tokenSecret?: string;
  oauth?: Record<string, string>;
  parameters?: Array<[string, string]>;
  nonce?: string;
  timestamp?: string;
  includeVersion?: boolean;
}) {
  const url = new URL(input.url);
  const oauth: Record<string, string> = {
    oauth_consumer_key: input.consumerKey,
    oauth_nonce: input.nonce || crypto.randomBytes(18).toString('base64url'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: input.timestamp || String(Math.floor(Date.now() / 1000)),
    ...(input.includeVersion === false ? {} : { oauth_version: '1.0' }),
    ...(input.token ? { oauth_token: input.token } : {}),
    ...(input.oauth || {})
  };
  const baseUrl = `${url.protocol}//${url.host}${url.pathname}`;
  const parameters: Array<[string, string]> = [...url.searchParams.entries(), ...(input.parameters || []), ...Object.entries(oauth)];
  const signatureBase = [input.method.toUpperCase(), oauthPercentEncode(baseUrl), oauthPercentEncode(normalizedOAuthParameters(parameters))].join('&');
  const signingKey = `${oauthPercentEncode(input.consumerSecret)}&${oauthPercentEncode(input.tokenSecret || '')}`;
  oauth.oauth_signature = crypto.createHmac('sha1', signingKey).update(signatureBase).digest('base64');
  return `OAuth ${Object.entries(oauth).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${oauthPercentEncode(key)}="${oauthPercentEncode(value)}"`).join(', ')}`;
}

function rateLimit(response: Response): XRateLimit {
  const numberOrNull = (value: string | null) => value != null && Number.isFinite(Number(value)) ? Number(value) : null;
  const reset = numberOrNull(response.headers.get('x-rate-limit-reset'));
  return {
    limit: numberOrNull(response.headers.get('x-rate-limit-limit')),
    remaining: numberOrNull(response.headers.get('x-rate-limit-remaining')),
    resetAt: reset ? new Date(reset * 1000).toISOString() : null,
    observedAt: new Date().toISOString()
  };
}

async function readBounded(response: Response) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maximumResponseBytes) throw new XApiError('X returned a response that was too large.', 502, 'provider');
  const body = await response.text();
  if (Buffer.byteLength(body) > maximumResponseBytes) throw new XApiError('X returned a response that was too large.', 502, 'provider');
  return body;
}

function providerProblem(body: string) {
  try {
    const parsed = JSON.parse(body) as { type?: unknown; title?: unknown; detail?: unknown; error?: unknown; error_description?: unknown };
    return {
      type: String(parsed.type || parsed.error || '').slice(0, 200),
      detail: String(parsed.detail || parsed.error_description || parsed.title || '').slice(0, 500)
    };
  } catch { return { type: '', detail: '' }; }
}

function providerError(response: Response, rate: XRateLimit, body = '') {
  const problem = providerProblem(body); const problemType = problem.type || null;
  if (response.status === 401 || problem.type === 'invalid_grant') return new XApiError('X rejected or expired this account connection. Reconnect the X account.', 401, 'authentication', false, null, problemType);
  if (response.status === 402 || /credits-depleted|payment/i.test(`${problem.type} ${problem.detail}`)) {
    return new XApiError('X API credits are depleted. Add credits in the X Developer Console, then retry this sync.', 402, 'billing', false, null, problemType || 'credits-depleted');
  }
  if (response.status === 403) return new XApiError('The X app does not have permission for this data. Confirm read access, OAuth scopes, and the X API plan.', 403, 'permission', false, null, problemType);
  if (response.status === 429) return new XApiError('The X API rate limit has been reached. Synchronisation will resume after the reset time.', 429, 'rate_limit', true, rate.resetAt, problemType);
  return new XApiError(problem.detail || 'X is temporarily unavailable. The request will be retried when safe.', response.status, 'provider', response.status >= 500, null, problemType);
}

async function xFetch(url: string, authorization: string, accept = 'application/json') {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(requestTimeoutMs),
      headers: { accept, authorization, 'user-agent': 'Seemplify-Experience/1.0' }
    });
  } catch { throw new XApiError('X could not be reached. The synchronisation will be retried.', 503, 'network', true); }
  const rate = rateLimit(response);
  const body = await readBounded(response);
  if (!response.ok) throw providerError(response, rate, body);
  return { body, rate };
}

async function xPost(url: string, authorization: string) {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(requestTimeoutMs),
      headers: { accept: 'application/x-www-form-urlencoded', authorization, 'content-length': '0', 'user-agent': 'Seemplify-Experience/1.0' }
    });
  } catch { throw new XApiError('X could not be reached. Try connecting again.', 503, 'network', true); }
  const rate = rateLimit(response); const body = await readBounded(response);
  if (!response.ok) throw providerError(response, rate, body);
  if (Buffer.byteLength(body) > 16 * 1024) throw new XApiError('X returned an invalid authentication response.', 502, 'provider');
  return { body, rate };
}

function parseForm(body: string) { return Object.fromEntries(new URLSearchParams(body).entries()); }

export async function requestOAuthToken(credentials: { consumerKey: string; consumerSecret: string }, callbackUrl: string) {
  // X defines x_auth_access_type as a request parameter. Keeping it in the URL
  // also makes it part of the OAuth signature base while avoiding a
  // provider-specific extension inside the OAuth Authorization header.
  const url = `${config.xOAuthBaseUrl}/oauth/request_token?x_auth_access_type=write`;
  const authorization = buildOAuthAuthorization({ method: 'POST', url, ...credentials, oauth: { oauth_callback: callbackUrl } });
  const result = await xPost(url, authorization); const parsed = parseForm(result.body);
  if (!parsed.oauth_token || !parsed.oauth_token_secret || parsed.oauth_callback_confirmed !== 'true') {
    throw new XApiError('X did not confirm the configured callback URL.', 502, 'provider');
  }
  return { token: parsed.oauth_token, secret: parsed.oauth_token_secret };
}

export async function exchangeOAuthToken(credentials: { consumerKey: string; consumerSecret: string }, requestToken: string, requestSecret: string, verifier: string) {
  const url = `${config.xOAuthBaseUrl}/oauth/access_token`;
  const authorization = buildOAuthAuthorization({ method: 'POST', url, ...credentials, token: requestToken, tokenSecret: requestSecret, oauth: { oauth_verifier: verifier } });
  const result = await xPost(url, authorization); const parsed = parseForm(result.body);
  if (!parsed.oauth_token || !parsed.oauth_token_secret) throw new XApiError('X did not return account credentials.', 502, 'provider');
  return { accessToken: parsed.oauth_token, accessTokenSecret: parsed.oauth_token_secret, xUserId: parsed.user_id || null, username: parsed.screen_name || null };
}

export type XOAuth2Token = {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  scopes: string[];
  tokenType: string;
};

async function oauth2TokenRequest(credentials: { clientId: string; clientSecret: string }, fields: Record<string, string>) {
  const url = `${config.xApiBaseUrl}/2/oauth2/token`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(requestTimeoutMs),
      headers: {
        accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`, 'utf8').toString('base64')}`,
        'user-agent': 'Seemplify-Experience/1.0'
      },
      body: new URLSearchParams(fields).toString()
    });
  } catch { throw new XApiError('X could not be reached. Try connecting again.', 503, 'network', true); }
  const rate = rateLimit(response); const body = await readBounded(response);
  if (!response.ok) throw providerError(response, rate, body);
  let parsed: any;
  try { parsed = JSON.parse(body); } catch { throw new XApiError('X returned malformed OAuth credentials.', 502, 'provider'); }
  if (!parsed.access_token || String(parsed.token_type || '').toLowerCase() !== 'bearer') throw new XApiError('X did not return a usable account access token.', 502, 'provider');
  return {
    accessToken: String(parsed.access_token), refreshToken: parsed.refresh_token ? String(parsed.refresh_token) : null,
    expiresIn: Math.max(60, Math.min(86_400, Number(parsed.expires_in || 7200))),
    scopes: String(parsed.scope || '').split(/\s+/).filter(Boolean), tokenType: String(parsed.token_type)
  } satisfies XOAuth2Token;
}

export function exchangeOAuth2Code(credentials: { clientId: string; clientSecret: string }, input: { code: string; redirectUri: string; codeVerifier: string }) {
  return oauth2TokenRequest(credentials, {
    code: input.code, grant_type: 'authorization_code', redirect_uri: input.redirectUri, code_verifier: input.codeVerifier
  });
}

export function refreshOAuth2Token(credentials: { clientId: string; clientSecret: string }, refreshToken: string) {
  return oauth2TokenRequest(credentials, { refresh_token: refreshToken, grant_type: 'refresh_token' });
}

export async function revokeOAuth2Token(credentials: { clientId: string; clientSecret: string }, token: string) {
  const url = `${config.xApiBaseUrl}/2/oauth2/revoke`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(requestTimeoutMs),
      headers: {
        accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`, 'utf8').toString('base64')}`,
        'user-agent': 'Seemplify-Experience/1.0'
      }, body: new URLSearchParams({ token }).toString()
    });
  } catch { return false; }
  await readBounded(response); return response.ok;
}

export async function getXJson<T>(input: {
  path: string;
  consumerKey?: string;
  consumerSecret?: string;
  accessToken?: string;
  accessTokenSecret?: string;
  bearerToken?: string;
}) {
  const url = `${config.xApiBaseUrl}${input.path.startsWith('/') ? input.path : `/${input.path}`}`;
  let authorization = '';
  if (input.bearerToken) authorization = `Bearer ${input.bearerToken}`;
  else if (input.consumerKey && input.consumerSecret && input.accessToken && input.accessTokenSecret) {
    authorization = buildOAuthAuthorization({ method: 'GET', url, consumerKey: input.consumerKey, consumerSecret: input.consumerSecret, token: input.accessToken, tokenSecret: input.accessTokenSecret });
  } else throw new XApiError('X authentication is not configured for this request.', 503, 'authentication');
  const result = await xFetch(url, authorization);
  try { return { data: JSON.parse(result.body) as T, rate: result.rate }; }
  catch { throw new XApiError('X returned malformed data.', 502, 'provider'); }
}

export async function postXJson<T>(input: {
  path: string;
  body: Record<string, unknown>;
  consumerKey?: string;
  consumerSecret?: string;
  accessToken?: string;
  accessTokenSecret?: string;
  bearerToken?: string;
}) {
  const url = `${config.xApiBaseUrl}${input.path.startsWith('/') ? input.path : `/${input.path}`}`;
  let authorization = '';
  if (input.bearerToken) authorization = `Bearer ${input.bearerToken}`;
  else if (input.consumerKey && input.consumerSecret && input.accessToken && input.accessTokenSecret) {
    authorization = buildOAuthAuthorization({
      method: 'POST', url, consumerKey: input.consumerKey, consumerSecret: input.consumerSecret,
      token: input.accessToken, tokenSecret: input.accessTokenSecret
    });
  } else throw new XApiError('X authentication is not configured for this request.', 503, 'authentication');

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(requestTimeoutMs),
      headers: {
        accept: 'application/json', 'content-type': 'application/json', authorization,
        'user-agent': 'Seemplify-Experience/1.0'
      },
      body: JSON.stringify(input.body)
    });
  } catch {
    throw new XApiError('X could not confirm whether the reply was posted. Check the account on X before taking any further action.', 503, 'network', false);
  }
  const rate = rateLimit(response); const body = await readBounded(response);
  if (!response.ok) throw providerError(response, rate, body);
  try { return { data: JSON.parse(body) as T, rate }; }
  catch { throw new XApiError('X accepted the request but returned malformed reply data. Check the account on X before retrying.', 502, 'provider'); }
}
