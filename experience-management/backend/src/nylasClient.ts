import crypto from 'node:crypto';
import { config } from './config.js';
import { normalizeEmailDraftHtml } from './emailDraftHtml.js';
import { resolveNylasPlatformConfiguration, type NylasPlatformConfiguration } from './nylasPlatformConfiguration.js';
import { deriveNylasPkceVerifier } from './nylasSecrets.js';

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
    'openid',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/calendar.readonly'
  ],
  microsoft: ['offline_access', 'openid', 'profile', 'User.Read', 'Mail.Read', 'Mail.ReadWrite', 'Mail.Send', 'Calendars.Read']
};

const defaultScopes: Record<NylasProvider, readonly string[]> = {
  google: [
    'openid', 'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/calendar.readonly'
  ],
  microsoft: ['offline_access', 'openid', 'profile', 'User.Read', 'Mail.Read', 'Mail.ReadWrite', 'Mail.Send', 'Calendars.Read']
};

export async function nylasRedirectUri(configuration?: NylasPlatformConfiguration | null) {
  const runtime = configuration === undefined ? await resolveNylasPlatformConfiguration() : configuration;
  return runtime?.redirectUri || `${config.publicUrl}/api/integrations/nylas/callback`;
}

export function configuredNylasScopes(provider: NylasProvider, configuration?: NylasPlatformConfiguration | null) {
  const allowed = new Map(safeScopes[provider].map((scope) => [scope.toLocaleLowerCase('en-US'), scope]));
  const requested = (configuration?.connectScopes || config.nylasConnectScopes)
    .map((scope) => allowed.get(scope.toLocaleLowerCase('en-US')))
    .filter((scope): scope is string => Boolean(scope));
  return [...new Set([...defaultScopes[provider], ...requested])];
}

export async function nylasConfigured() {
  const runtime = await resolveNylasPlatformConfiguration();
  return Boolean(runtime?.clientId && runtime?.apiKey);
}

async function requireConfiguration() {
  const runtime = await resolveNylasPlatformConfiguration();
  if (!runtime?.clientId || !runtime.apiKey) throw new NylasError('Nylas is not configured in Seemplify Identity.', 503, 'NYLAS_NOT_CONFIGURED', true);
  return runtime;
}

export async function createNylasAuthorizeUrl(provider: NylasProvider, state: string) {
  const runtime = await requireConfiguration();
  const codeVerifier = deriveNylasPkceVerifier(state);
  const url = new URL(`${runtime.apiUri}/v3/connect/auth`);
  url.searchParams.set('client_id', runtime.clientId);
  url.searchParams.set('redirect_uri', await nylasRedirectUri(runtime));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('access_type', 'online');
  url.searchParams.set('provider', provider);
  url.searchParams.set('state', state);
  url.searchParams.set('scope', configuredNylasScopes(provider, runtime).join(' '));
  url.searchParams.set('code_challenge', crypto.createHash('sha256').update(codeVerifier).digest('base64url'));
  url.searchParams.set('code_challenge_method', 'S256');
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
  const runtime = await requireConfiguration();
  let response: Response;
  try {
    const headers = new Headers(init.headers);
    if (headers.has('authorization')) headers.set('authorization', `Bearer ${runtime.apiKey}`);
    response = await fetch(`${runtime.apiUri}${path}`, {
      ...init,
      headers: { accept: 'application/json', ...Object.fromEntries(headers.entries()) },
      signal: AbortSignal.timeout(config.nylasRequestTimeoutMs)
    });
  } catch {
    throw new NylasError('Nylas is temporarily unavailable.', 503, 'NYLAS_UNAVAILABLE', true);
  }
  const payload = await boundedJson(response, maximumBytes);
  if (!response.ok) {
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    const authorizationFailed = response.status === 401 || response.status === 403;
    throw new NylasError(
      retryable ? 'Nylas is temporarily unavailable.' : 'Nylas rejected the request.',
      retryable ? 503 : authorizationFailed ? 409 : response.status,
      authorizationFailed ? 'NYLAS_AUTHORIZATION_FAILED' : 'NYLAS_REQUEST_FAILED',
      retryable
    );
  }
  return payload;
}

function payloadData(value: any) { return value?.data ?? value ?? {}; }

export async function exchangeNylasCode(code: string, expectedProvider: NylasProvider, oauthState: string) {
  const runtime = await requireConfiguration();
  const payload = await nylasRequest('/v3/connect/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: runtime.clientId,
      client_secret: runtime.apiKey,
      grant_type: 'authorization_code',
      redirect_uri: await nylasRedirectUri(runtime),
      code,
      code_verifier: deriveNylasPkceVerifier(oauthState)
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
  return { grantId, email, provider: expectedProvider, scopes: configuredNylasScopes(expectedProvider, runtime) };
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
  unread: boolean;
  starred: boolean;
  hasAttachments: boolean;
  folderIds: string[];
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
    lastMessageAt: isoTimestamp(thread.last_message_timestamp || latest.date || thread.updated_at),
    unread: Boolean(thread.unread ?? latest.unread),
    starred: Boolean(thread.starred ?? latest.starred),
    hasAttachments: Boolean(thread.has_attachments ?? thread.hasAttachments
      ?? (Array.isArray(latest.attachments) && latest.attachments.length)),
    folderIds: (Array.isArray(thread.folders) ? thread.folders : Array.isArray(thread.folder_ids) ? thread.folder_ids : [])
      .map((folder: any) => cleanText(typeof folder === 'string' ? folder : folder?.id, 300)).filter(Boolean).slice(0, 30)
  };
}

export async function listNylasThreadPage(grantId: string, input: {
  limit: number;
  cursor?: string;
  search?: string;
  folder?: string;
  unread?: boolean;
  hasAttachment?: boolean;
}) {
  const boundedLimit = Math.max(1, Math.min(50, Math.floor(input.limit)));
  const query = new URLSearchParams({
    limit: String(boundedLimit),
    select: 'id,subject,participants,snippet,message_count,last_message_timestamp,unread,starred,has_attachments,folders,latest_draft_or_message'
  });
  if (input.cursor) query.set('page_token', cleanText(input.cursor, 1_000));
  if (input.search) query.set('search_query_native', cleanText(input.search, 500));
  if (input.folder) query.set('in', cleanText(input.folder, 300));
  if (input.unread !== undefined) query.set('unread', String(input.unread));
  if (input.hasAttachment !== undefined) query.set('has_attachment', String(input.hasAttachment));
  const payload = await nylasRequest(`/v3/grants/${encodeURIComponent(grantId)}/threads?${query}`, {
    method: 'GET', headers: { authorization: `Bearer ${config.nylasApiKey}` }
  });
  const raw = payloadData(payload); const rows = Array.isArray(raw) ? raw : Array.isArray(raw.data) ? raw.data : [];
  const items = rows.map(normalizeThread)
    .filter((thread: AssistantThreadSummary | null): thread is AssistantThreadSummary => Boolean(thread))
    .slice(0, boundedLimit);
  const nextCursor = cleanText(payload?.next_cursor || raw?.next_cursor || '', 1_000) || null;
  return { items, nextCursor };
}

export async function listNylasThreads(grantId: string, limit: number) {
  return (await listNylasThreadPage(grantId, { limit })).items;
}

export interface AssistantMailboxFolder {
  id: string;
  name: string;
  systemName: string | null;
  unreadCount: number | null;
  totalCount: number | null;
}

function optionalCount(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? Math.min(1_000_000_000, Math.floor(count)) : null;
}

export async function listNylasFolders(grantId: string) {
  const query = new URLSearchParams({
    limit: '100',
    select: 'id,name,system_folder,unread_count,total_count'
  });
  const payload = await nylasRequest(`/v3/grants/${encodeURIComponent(grantId)}/folders?${query}`, {
    method: 'GET', headers: { authorization: `Bearer ${config.nylasApiKey}` }
  });
  const raw = payloadData(payload); const rows = Array.isArray(raw) ? raw : Array.isArray(raw.data) ? raw.data : [];
  return rows.map((folder: any): AssistantMailboxFolder | null => {
    const id = cleanText(folder?.id, 300);
    if (!id) return null;
    return {
      id,
      name: cleanText(folder?.name || folder?.display_name || 'Folder', 300) || 'Folder',
      systemName: cleanText(folder?.system_folder || folder?.systemName, 100) || null,
      unreadCount: optionalCount(folder?.unread_count),
      totalCount: optionalCount(folder?.total_count)
    };
  }).filter((folder: AssistantMailboxFolder | null): folder is AssistantMailboxFolder => Boolean(folder)).slice(0, 100);
}

export interface AssistantAttachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
}

function attachments(value: any): AssistantAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.map((attachment) => {
    const id = cleanText(attachment?.id, 300);
    if (!id) return null;
    return {
      id,
      filename: cleanText(attachment?.filename || attachment?.name || 'Attachment', 300) || 'Attachment',
      contentType: cleanText(attachment?.content_type || attachment?.contentType || 'application/octet-stream', 200),
      size: Math.max(0, Math.min(1024 * 1024 * 1024, Number(attachment?.size || 0) || 0))
    };
  }).filter((attachment): attachment is AssistantAttachment => Boolean(attachment)).slice(0, 50);
}

export interface AssistantThreadSnapshot {
  thread: AssistantThreadSummary;
  messages: Array<{
    id: string; subject: string; from: AssistantParticipant[]; to: AssistantParticipant[]; cc: AssistantParticipant[];
    sentAt: string | null; body: string; bodyTruncated: boolean;
    unread: boolean; starred: boolean; attachments: AssistantAttachment[];
  }>;
  loadedMessageCount: number;
  totalMessageCount: number;
  messagesTruncated: boolean;
  bytesTruncated: boolean;
  loadedMessageBytes: number;
  messageBodyByteLimit: number;
  threadByteLimit: number;
}

async function mapWithProviderConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(items.length, Math.max(1, Math.floor(concurrency))) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index], index);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

function truncateUtf8(value: string, maximumBytes: number) {
  const encoded = Buffer.from(value, 'utf8');
  if (encoded.length <= maximumBytes) return { value, truncated: false };
  return {
    value: encoded.subarray(0, maximumBytes).toString('utf8').replace(/\uFFFD+$/gu, ''),
    truncated: true
  };
}

export async function getNylasThreadSnapshot(grantId: string, threadId: string): Promise<AssistantThreadSnapshot> {
  const encodedGrant = encodeURIComponent(grantId); const encodedThread = encodeURIComponent(threadId);
  const maxThreadMessages = Math.floor(config.nylasMaxThreadMessages);
  const maxMessageBodyBytes = Math.floor(config.nylasMaxMessageBodyBytes);
  const maxThreadBytes = Math.floor(config.nylasMaxThreadBytes);
  const threadPayload = await nylasRequest(`/v3/grants/${encodedGrant}/threads/${encodedThread}`, {
    method: 'GET', headers: { authorization: `Bearer ${config.nylasApiKey}` }
  });
  const thread = normalizeThread(payloadData(threadPayload));
  if (!thread || thread.id !== threadId) throw new NylasError('The requested email thread was not found.', 404, 'NYLAS_THREAD_NOT_FOUND');

  const summaries: Array<{ summary: any; id: string }> = [];
  const seenMessageIds = new Set<string>();
  const seenCursors = new Set<string>();
  let nextCursor: string | null = null;
  let providerHasMore = false;
  do {
    const remaining = maxThreadMessages - summaries.length;
    if (remaining <= 0) { providerHasMore = Boolean(nextCursor); break; }
    const query = new URLSearchParams({
      thread_id: threadId,
      limit: String(Math.min(50, remaining)),
      select: 'id,subject,date,from,to,cc,unread,starred,attachments'
    });
    if (nextCursor) query.set('page_token', nextCursor);
    const messagesPayload = await nylasRequest(`/v3/grants/${encodedGrant}/messages?${query}`, {
      method: 'GET', headers: { authorization: `Bearer ${config.nylasApiKey}` }
    });
    const raw = payloadData(messagesPayload);
    const rows = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : [];
    for (const summary of rows) {
      const id = cleanText(summary?.id, 300);
      if (!id || seenMessageIds.has(id)) continue;
      seenMessageIds.add(id);
      summaries.push({ summary, id });
      if (summaries.length >= maxThreadMessages) break;
    }
    const candidate = cleanText(messagesPayload?.next_cursor || raw?.next_cursor || '', 1_000) || null;
    if (!candidate || seenCursors.has(candidate)) {
      providerHasMore = Boolean(candidate);
      nextCursor = null;
      break;
    }
    seenCursors.add(candidate);
    nextCursor = candidate;
    providerHasMore = true;
  } while (summaries.length < maxThreadMessages);

  const messageRows = summaries;
  const detailedRows = await mapWithProviderConcurrency(
    messageRows,
    config.nylasMessageDetailConcurrency,
    async ({ summary, id }: any) => {
    const payload = await nylasRequest(`/v3/grants/${encodedGrant}/messages/${encodeURIComponent(id)}`, {
      method: 'GET', headers: { authorization: `Bearer ${config.nylasApiKey}` }
    }, 1024 * 1024);
    const detail = payloadData(payload);
    if (cleanText(detail?.id, 300) !== id) throw new NylasError('Nylas returned an invalid email message.', 502, 'NYLAS_MESSAGE_INVALID');
    return { ...summary, ...detail, id };
    }
  );
  const normalized = detailedRows.map((message: any) => {
    const sanitizedBody = providerHtmlToText(
      message.body || message.snippet || '',
      maxMessageBodyBytes + 1
    );
    const boundedBody = truncateUtf8(sanitizedBody, maxMessageBodyBytes);
    return {
      id: cleanText(message.id, 300),
      subject: providerHtmlToText(message.subject || thread.subject, 500),
      from: participants(message.from), to: participants(message.to), cc: participants(message.cc),
      sentAt: isoTimestamp(message.date || message.created_at),
      body: boundedBody.value,
      bodyTruncated: boundedBody.truncated,
      unread: Boolean(message.unread),
      starred: Boolean(message.starred),
      attachments: attachments(message.attachments)
    };
  }).filter((message: any) => message.id && (message.body || message.attachments.length))
    .sort((left: any, right: any) => String(left.sentAt || '').localeCompare(String(right.sentAt || '')));
  const messages: AssistantThreadSnapshot['messages'] = []; let bytes = 0;
  let responseBytesTruncated = false;
  for (const message of normalized) {
    const next = Buffer.byteLength(JSON.stringify(message), 'utf8');
    if (bytes + next > maxThreadBytes) { responseBytesTruncated = true; break; }
    messages.push(message); bytes += next;
  }
  if (!messages.length) throw new NylasError('The requested email thread does not contain readable messages.', 409, 'NYLAS_THREAD_EMPTY');
  const totalMessageCount = Math.max(thread.messageCount, detailedRows.length);
  const bodyBytesTruncated = normalized.some((message) => message.bodyTruncated);
  const bytesTruncated = responseBytesTruncated || bodyBytesTruncated;
  const messagesTruncated = bytesTruncated || providerHasMore || totalMessageCount > messages.length
    || normalized.length > messages.length;
  return {
    thread: { ...thread, messageCount: totalMessageCount },
    messages,
    loadedMessageCount: messages.length,
    totalMessageCount,
    messagesTruncated,
    bytesTruncated,
    loadedMessageBytes: bytes,
    messageBodyByteLimit: maxMessageBodyBytes,
    threadByteLimit: maxThreadBytes
  };
}

export interface NylasReplyRecipient {
  name?: string;
  email: string;
}

function normalizeNylasRecipients(values: NylasReplyRecipient[] = []) {
  const seen = new Set<string>();
  return values
    .map((value) => ({
      email: cleanText(value.email, 254).toLocaleLowerCase('en-US'),
      ...(cleanText(value.name, 200) ? { name: cleanText(value.name, 200) } : {})
    }))
    .filter((value) => {
      if (!value.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value.email) || seen.has(value.email)) return false;
      seen.add(value.email); return true;
    });
}

export async function sendNylasMessage(grantId: string, input: {
  to: NylasReplyRecipient[];
  cc?: NylasReplyRecipient[];
  bcc?: NylasReplyRecipient[];
  subject: string;
  body: string;
  idempotencyKey: string;
}) {
  const subject = cleanText(input.subject, 500);
  const body = normalizeEmailDraftHtml(input.body);
  const to = normalizeNylasRecipients(input.to);
  const cc = normalizeNylasRecipients(input.cc);
  const bcc = normalizeNylasRecipients(input.bcc);
  if (!subject || !body || !to.length || to.length + cc.length + bcc.length > 50) {
    throw new NylasError('The email is missing a recipient, subject, or body.', 400, 'NYLAS_MESSAGE_INVALID');
  }
  const payload = await nylasRequest(
    `/v3/grants/${encodeURIComponent(grantId)}/messages/send?fields=include_basic_headers`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.nylasApiKey}`,
        'content-type': 'application/json',
        'idempotency-key': cleanText(input.idempotencyKey, 256)
      },
      body: JSON.stringify({
        to, ...(cc.length ? { cc } : {}), ...(bcc.length ? { bcc } : {}),
        subject, body, is_plaintext: false
      })
    },
    512 * 1024
  );
  const message = payloadData(payload);
  const id = cleanText(message?.id || message?.message_id, 300);
  if (!id) throw new NylasError('Nylas accepted the email but returned no message identifier.', 502, 'NYLAS_MESSAGE_RESPONSE_INVALID');
  return { id, threadId: cleanText(message?.thread_id, 300) || null };
}

export async function sendNylasReply(grantId: string, input: {
  replyToMessageId: string;
  to: NylasReplyRecipient[];
  cc?: NylasReplyRecipient[];
  subject: string;
  body: string;
  idempotencyKey: string;
}) {
  const replyToMessageId = cleanText(input.replyToMessageId, 300);
  const subject = cleanText(input.subject, 500);
  const body = normalizeEmailDraftHtml(input.body);
  const to = normalizeNylasRecipients(input.to);
  const cc = normalizeNylasRecipients(input.cc);
  if (!replyToMessageId || !subject || !body || !to.length) {
    throw new NylasError('The reply is missing a recipient, subject, body, or source message.', 400, 'NYLAS_REPLY_INVALID');
  }
  const payload = await nylasRequest(
    `/v3/grants/${encodeURIComponent(grantId)}/messages/send?fields=include_basic_headers`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.nylasApiKey}`,
        'content-type': 'application/json',
        'idempotency-key': cleanText(input.idempotencyKey, 256)
      },
      body: JSON.stringify({
        to,
        ...(cc.length ? { cc } : {}),
        subject,
        body,
        is_plaintext: false,
        reply_to_message_id: replyToMessageId
      })
    },
    512 * 1024
  );
  const message = payloadData(payload);
  const id = cleanText(message?.id || message?.message_id, 300);
  if (!id) throw new NylasError('Nylas accepted the reply but returned no message identifier.', 502, 'NYLAS_REPLY_RESPONSE_INVALID');
  return { id, threadId: cleanText(message?.thread_id, 300) || null };
}

export interface AssistantCalendar {
  id: string;
  name: string;
  description: string;
  readOnly: boolean;
  primary: boolean;
  timezone: string | null;
}

function normalizeCalendar(value: any): AssistantCalendar | null {
  const id = cleanText(value?.id, 300);
  if (!id) return null;
  return {
    id,
    name: cleanText(value?.name || value?.summary || 'Calendar', 300) || 'Calendar',
    description: providerHtmlToText(value?.description || '', 1_000),
    readOnly: Boolean(value?.read_only ?? value?.readOnly ?? true),
    primary: Boolean(value?.is_primary ?? value?.primary),
    timezone: cleanText(value?.timezone || value?.time_zone, 100) || null
  };
}

export async function listNylasCalendars(grantId: string) {
  const query = new URLSearchParams({
    limit: '50',
    select: 'id,name,description,read_only,is_primary,timezone'
  });
  const payload = await nylasRequest(`/v3/grants/${encodeURIComponent(grantId)}/calendars?${query}`, {
    method: 'GET', headers: { authorization: `Bearer ${config.nylasApiKey}` }
  });
  const raw = payloadData(payload); const rows = Array.isArray(raw) ? raw : Array.isArray(raw.data) ? raw.data : [];
  return rows.map(normalizeCalendar)
    .filter((calendar: AssistantCalendar | null): calendar is AssistantCalendar => Boolean(calendar))
    .slice(0, 50);
}

export interface AssistantCalendarEvent {
  id: string;
  calendarId: string | null;
  title: string;
  description: string;
  location: string;
  startAt: string | null;
  endAt: string | null;
  allDay: boolean;
  status: string;
  busy: boolean;
  participants: AssistantParticipant[];
}

function eventDate(value: unknown) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(cleanText(value, 40));
  if (!match) return null;
  const timestamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const date = new Date(timestamp);
  return date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() === Number(match[2]) - 1
    && date.getUTCDate() === Number(match[3])
    ? date.toISOString()
    : null;
}

function addUtcDays(value: string, days: number) {
  return new Date(Date.parse(value) + days * 24 * 60 * 60_000).toISOString();
}

function eventTimes(value: any) {
  const when = value?.when || {};
  const singleDate = eventDate(when.date);
  if (singleDate) return { startAt: singleDate, endAt: addUtcDays(singleDate, 1), allDay: true };
  const startDate = eventDate(when.start_date);
  const endDate = eventDate(when.end_date);
  if (startDate) {
    return {
      startAt: startDate,
      endAt: endDate && Date.parse(endDate) > Date.parse(startDate) ? endDate : addUtcDays(startDate, 1),
      allDay: true
    };
  }
  return {
    startAt: isoTimestamp(when.start_time ?? value?.start_time ?? value?.start),
    endAt: isoTimestamp(when.end_time ?? value?.end_time ?? value?.end),
    allDay: false
  };
}

function normalizeCalendarEvent(value: any): AssistantCalendarEvent | null {
  const id = cleanText(value?.id, 300);
  if (!id) return null;
  const times = eventTimes(value);
  return {
    id,
    calendarId: cleanText(value?.calendar_id || value?.calendarId, 300) || null,
    title: providerHtmlToText(value?.title || value?.summary || '(Untitled event)', 500) || '(Untitled event)',
    description: providerHtmlToText(value?.description || '', 4_000),
    location: providerHtmlToText(value?.location || '', 500),
    startAt: times.startAt,
    endAt: times.endAt,
    allDay: times.allDay,
    status: cleanText(value?.status || 'confirmed', 80) || 'confirmed',
    busy: value?.busy === undefined ? true : Boolean(value.busy),
    participants: participants(value?.participants, value?.attendees)
  };
}

export async function listNylasCalendarEvents(grantId: string, input: {
  calendarId: string;
  start: Date;
  end: Date;
  limit: number;
  cursor?: string;
}) {
  const query = new URLSearchParams({
    calendar_id: cleanText(input.calendarId, 300),
    start: String(Math.floor(input.start.getTime() / 1000)),
    end: String(Math.floor(input.end.getTime() / 1000)),
    limit: String(Math.max(1, Math.min(50, Math.floor(input.limit)))),
    select: 'id,calendar_id,title,description,location,when,start_time,end_time,status,busy,participants'
  });
  if (input.cursor) query.set('page_token', cleanText(input.cursor, 1_000));
  const payload = await nylasRequest(`/v3/grants/${encodeURIComponent(grantId)}/events?${query}`, {
    method: 'GET', headers: { authorization: `Bearer ${config.nylasApiKey}` }
  });
  const raw = payloadData(payload); const rows = Array.isArray(raw) ? raw : Array.isArray(raw.data) ? raw.data : [];
  const items = rows.map(normalizeCalendarEvent)
    .filter((event: AssistantCalendarEvent | null): event is AssistantCalendarEvent => Boolean(event))
    .slice(0, Math.max(1, Math.min(50, Math.floor(input.limit))));
  return { items, nextCursor: cleanText(payload?.next_cursor || raw?.next_cursor || '', 1_000) || null };
}

export async function getNylasCalendarEvent(grantId: string, eventId: string, calendarId: string) {
  const query = new URLSearchParams({ calendar_id: cleanText(calendarId, 300) });
  const payload = await nylasRequest(
    `/v3/grants/${encodeURIComponent(grantId)}/events/${encodeURIComponent(eventId)}?${query}`,
    { method: 'GET', headers: { authorization: `Bearer ${config.nylasApiKey}` } }
  );
  const event = normalizeCalendarEvent(payloadData(payload));
  if (!event || event.id !== eventId) throw new NylasError('The requested calendar event was not found.', 404, 'NYLAS_EVENT_NOT_FOUND');
  return event;
}
