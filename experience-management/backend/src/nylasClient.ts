import { config } from './config.js';

export type NylasProvider = 'google' | 'microsoft';

export class NylasError extends Error {
  status: number;
  code: string;
  retryable: boolean;

  constructor(message: string, status = 502, code = 'NYLAS_REQUEST_FAILED', retryable = false) {
    super(message);
    this.name = 'NylasError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

const safeScopes: Record<NylasProvider, readonly string[]> = {
  google: [
    'openid', 'email', 'profile',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/gmail.readonly'
  ],
  microsoft: ['offline_access', 'openid', 'profile', 'User.Read', 'Mail.Read']
};

const defaultScopes: Record<NylasProvider, readonly string[]> = {
  google: ['openid', 'email', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/gmail.readonly'],
  microsoft: ['offline_access', 'openid', 'profile', 'User.Read', 'Mail.Read']
};

export function nylasRedirectUri() {
  return config.nylasRedirectUri || `${config.publicUrl}/api/integrations/nylas/callback`;
}

export function configuredNylasScopes(provider: NylasProvider) {
  const allowed = new Map(safeScopes[provider].map((scope) => [scope.toLocaleLowerCase('en-US'), scope]));
  const requested = config.nylasConnectScopes
    .map((scope) => allowed.get(scope.toLocaleLowerCase('en-US')))
    .filter((scope): scope is string => Boolean(scope));
  return [...new Set(requested.length ? requested : defaultScopes[provider])];
}

export function nylasConfigured() {
  return Boolean(config.nylasClientId && config.nylasApiKey);
}

function requireConfiguration() {
  if (!nylasConfigured()) throw new NylasError('Nylas is not configured.', 503, 'NYLAS_NOT_CONFIGURED', true);
}

export function createNylasAuthorizeUrl(provider: NylasProvider, state: string) {
  requireConfiguration();
  const url = new URL(`${config.nylasApiUri}/v3/connect/auth`);
  url.searchParams.set('client_id', config.nylasClientId);
  url.searchParams.set('redirect_uri', nylasRedirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('access_type', 'online');
  url.searchParams.set('provider', provider);
  url.searchParams.set('state', state);
  url.searchParams.set('scope', configuredNylasScopes(provider).join(' '));
  return url.toString();
}

async function boundedJson(response: Response, maximumBytes = 4 * 1024 * 1024) {
  if (!response.body) return {};
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new NylasError('Nylas returned an unexpectedly large response.', 502, 'NYLAS_RESPONSE_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
  try { return body ? JSON.parse(body) as any : {}; }
  catch { throw new NylasError('Nylas returned an invalid response.', 502, 'NYLAS_INVALID_RESPONSE'); }
}

async function nylasRequest(path: string, init: RequestInit, maximumBytes?: number) {
  requireConfiguration();
  let response: Response;
  try {
    response = await fetch(`${config.nylasApiUri}${path}`, {
      ...init,
      headers: { accept: 'application/json', ...(init.headers || {}) },
      signal: AbortSignal.timeout(config.nylasRequestTimeoutMs)
    });
  } catch {
    throw new NylasError('Nylas is temporarily unavailable.', 503, 'NYLAS_UNAVAILABLE', true);
  }
  const payload = await boundedJson(response, maximumBytes);
  if (!response.ok) {
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    throw new NylasError(
      retryable ? 'Nylas is temporarily unavailable.' : 'Nylas rejected the request.',
      retryable ? 503 : response.status,
      response.status === 401 || response.status === 403 ? 'NYLAS_AUTHORIZATION_FAILED' : 'NYLAS_REQUEST_FAILED',
      retryable
    );
  }
  return payload;
}

function payloadData(value: any) { return value?.data ?? value ?? {}; }

export async function exchangeNylasCode(code: string, expectedProvider: NylasProvider) {
  const payload = await nylasRequest('/v3/connect/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: config.nylasClientId,
      client_secret: config.nylasApiKey,
      grant_type: 'authorization_code',
      redirect_uri: nylasRedirectUri(),
      code,
      code_verifier: 'nylas'
    })
  });
  const grant = payloadData(payload);
  const grantId = String(grant.grant_id || grant.grantId || grant.id || '').trim();
  if (!grantId || grantId.length > 500) throw new NylasError('Nylas did not return a valid grant.', 502, 'NYLAS_GRANT_INVALID');
  const reportedProvider = String(grant.provider || '').toLocaleLowerCase('en-US');
  if (reportedProvider && !reportedProvider.includes(expectedProvider === 'microsoft' ? 'microsoft' : 'google')) {
    throw new NylasError('Nylas returned a grant for a different provider.', 502, 'NYLAS_PROVIDER_MISMATCH');
  }
  let email = cleanText(grant.email || grant.email_address || '', 254);
  if (!email) {
    const detail = payloadData(await nylasRequest(`/v3/grants/${encodeURIComponent(grantId)}`, {
      method: 'GET', headers: { authorization: `Bearer ${config.nylasApiKey}` }
    }));
    email = cleanText(detail.email || detail.email_address || '', 254);
  }
  return { grantId, email, provider: expectedProvider, scopes: configuredNylasScopes(expectedProvider) };
}

export async function revokeNylasGrant(grantId: string) {
  await nylasRequest(`/v3/grants/${encodeURIComponent(grantId)}`, {
    method: 'DELETE', headers: { authorization: `Bearer ${config.nylasApiKey}` }
  }, 256 * 1024);
}

function decodeEntities(value: string) {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/giu, (_token, entity: string) => {
    if (entity[0] !== '#') return named[entity.toLowerCase()] ?? '';
    const numeric = entity[1].toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
    return Number.isFinite(numeric) && numeric > 0 && numeric <= 0x10ffff ? String.fromCodePoint(numeric) : '';
  });
}

export function redactProviderSecrets(value: string) {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/giu, 'Bearer [REDACTED]')
    .replace(/\b(sk|gsk|key)-[A-Za-z0-9_-]{16,}/gu, '[REDACTED]')
    .replace(/\b(api[ _-]?key|client[ _-]?secret|password|passwd|authorization|access[ _-]?token|refresh[ _-]?token)\s*[:=]\s*([^\s,;]+)/giu, '$1: [REDACTED]')
    .replace(/([?&](?:token|api_key|access_token|refresh_token)=)[^&#\s]+/giu, '$1[REDACTED]');
}

export function providerHtmlToText(value: unknown, maximum = 12_000) {
  const html = String(value || '').slice(0, Math.max(maximum * 8, 16_000));
  const text = html
    .replace(/<!--([\s\S]*?)-->/gu, ' ')
    .replace(/<(script|style|head|svg|form|object|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, ' ')
    .replace(/<(br|p|div|li|tr|h[1-6])\b[^>]*>/giu, '\n')
    .replace(/<[^>]+>/gu, ' ');
  return redactProviderSecrets(decodeEntities(text))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
    .replace(/[ \t]+/gu, ' ').replace(/\n{3,}/gu, '\n\n').trim().slice(0, maximum);
}

function cleanText(value: unknown, maximum: number) {
  return redactProviderSecrets(String(value || ''))
    .replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, maximum);
}

export interface AssistantParticipant {
  email: string;
  name?: string;
}

function participant(value: any): AssistantParticipant | null {
  if (typeof value === 'string') {
    const text = cleanText(value, 320);
    const addressed = text.match(/^(.*?)\s*<([^<>\s]+@[^<>\s]+)>$/u);
    if (addressed) {
      const name = cleanText(addressed[1], 160); const email = cleanText(addressed[2], 254).toLowerCase();
      return { email, ...(name ? { name } : {}) };
    }
    return text.includes('@') ? { email: text.toLowerCase() } : null;
  }
  const email = cleanText(value?.email || '', 254).toLowerCase(); const name = cleanText(value?.name || '', 160);
  return email ? { email, ...(name ? { name } : {}) } : null;
}

function participants(...values: any[]) {
  const flattened = values.flatMap((value) => Array.isArray(value) ? value : value ? [value] : [])
    .map(participant).filter(Boolean);
  const unique = new Map<string, AssistantParticipant>();
  for (const item of flattened as AssistantParticipant[]) if (!unique.has(item.email)) unique.set(item.email, item);
  return [...unique.values()].slice(0, 30);
}

function isoTimestamp(value: unknown) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    const date = new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  const date = new Date(String(value || ''));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export interface AssistantThreadSummary {
  id: string;
  subject: string;
  participants: AssistantParticipant[];
  snippet: string;
  messageCount: number;
  lastMessageAt: string | null;
}

function normalizeThread(thread: any): AssistantThreadSummary | null {
  const id = cleanText(thread?.id || '', 300); if (!id) return null;
  const latest = thread.latest_draft_or_message || thread.latest_message || {};
  const messageIds = Array.isArray(thread.message_ids) ? thread.message_ids : [];
  return {
    id,
    subject: providerHtmlToText(thread.subject || latest.subject || '(No subject)', 500) || '(No subject)',
    participants: participants(thread.participants, latest.from, latest.to, latest.cc),
    snippet: providerHtmlToText(thread.snippet || latest.snippet || '', 500),
    messageCount: Math.max(0, Math.min(10_000, Number(thread.message_count ?? messageIds.length ?? 0) || 0)),
    lastMessageAt: isoTimestamp(thread.last_message_timestamp || latest.date || thread.updated_at)
  };
}

export async function listNylasThreads(grantId: string, limit: number) {
  const boundedLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  const payload = await nylasRequest(`/v3/grants/${encodeURIComponent(grantId)}/threads?limit=${boundedLimit}`, {
    method: 'GET', headers: { authorization: `Bearer ${config.nylasApiKey}` }
  });
  const raw = payloadData(payload); const rows = Array.isArray(raw) ? raw : Array.isArray(raw.data) ? raw.data : [];
  return rows.map(normalizeThread).filter((thread: AssistantThreadSummary | null): thread is AssistantThreadSummary => Boolean(thread)).slice(0, boundedLimit);
}

export interface AssistantThreadSnapshot {
  thread: AssistantThreadSummary;
  messages: Array<{
    id: string; subject: string; from: AssistantParticipant[]; to: AssistantParticipant[]; cc: AssistantParticipant[];
    sentAt: string | null; body: string;
  }>;
}

export async function getNylasThreadSnapshot(grantId: string, threadId: string): Promise<AssistantThreadSnapshot> {
  const encodedGrant = encodeURIComponent(grantId); const encodedThread = encodeURIComponent(threadId);
  const [threadPayload, messagesPayload] = await Promise.all([
    nylasRequest(`/v3/grants/${encodedGrant}/threads/${encodedThread}`, {
      method: 'GET', headers: { authorization: `Bearer ${config.nylasApiKey}` }
    }),
    nylasRequest(`/v3/grants/${encodedGrant}/messages?thread_id=${encodeURIComponent(threadId)}&limit=${config.nylasMaxThreadMessages}`, {
      method: 'GET', headers: { authorization: `Bearer ${config.nylasApiKey}` }
    })
  ]);
  const thread = normalizeThread(payloadData(threadPayload));
  if (!thread || thread.id !== threadId) throw new NylasError('The requested email thread was not found.', 404, 'NYLAS_THREAD_NOT_FOUND');
  const raw = payloadData(messagesPayload); const rows = Array.isArray(raw) ? raw : Array.isArray(raw.data) ? raw.data : [];
  const messageRows = rows.slice(0, config.nylasMaxThreadMessages)
    .map((message: any) => ({ summary: message, id: cleanText(message?.id, 300) })).filter((message: any) => message.id);
  const detailedRows = await Promise.all(messageRows.map(async ({ summary, id }: any) => {
    const payload = await nylasRequest(`/v3/grants/${encodedGrant}/messages/${encodeURIComponent(id)}`, {
      method: 'GET', headers: { authorization: `Bearer ${config.nylasApiKey}` }
    }, 1024 * 1024);
    const detail = payloadData(payload);
    if (cleanText(detail?.id, 300) !== id) throw new NylasError('Nylas returned an invalid email message.', 502, 'NYLAS_MESSAGE_INVALID');
    return { ...summary, ...detail, id };
  }));
  const normalized = detailedRows.map((message: any) => ({
    id: cleanText(message.id, 300),
    subject: providerHtmlToText(message.subject || thread.subject, 500),
    from: participants(message.from), to: participants(message.to), cc: participants(message.cc),
    sentAt: isoTimestamp(message.date || message.created_at),
    body: providerHtmlToText(message.body || message.snippet || '', 12_000)
  })).filter((message: any) => message.id && message.body)
    .sort((left: any, right: any) => String(left.sentAt || '').localeCompare(String(right.sentAt || '')));
  const messages: AssistantThreadSnapshot['messages'] = []; let bytes = 0;
  for (const message of normalized) {
    const next = Buffer.byteLength(JSON.stringify(message), 'utf8');
    if (bytes + next > 96 * 1024) break;
    messages.push(message); bytes += next;
  }
  if (!messages.length) throw new NylasError('The requested email thread does not contain readable messages.', 409, 'NYLAS_THREAD_EMPTY');
  return { thread: { ...thread, messageCount: Math.max(thread.messageCount, messages.length) }, messages };
}
