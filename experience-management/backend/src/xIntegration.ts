import crypto from 'node:crypto';
import fs from 'node:fs';
import type { SessionUser } from './auth.js';
import { createAdmittedAiJob } from './aiJobAdmission.js';
import { aiJobRunner } from './aiJobs.js';
import { config } from './config.js';
import { db, listSocialMentionsByIdsForSpace } from './database.js';
import { publishEvent } from './events.js';
import { SubscriptionEntitlementError } from './subscriptionEntitlements.js';
import { decryptSecret, encryptSecret } from './secureSecrets.js';
import {
  exchangeOAuth2Code, exchangeOAuthToken, getXJson, postXJson, refreshOAuth2Token, requestOAuthToken, revokeOAuth2Token,
  XApiError, type XOAuth2Token, type XRateLimit
} from './xClient.js';

const appId = 'workspace-x-app';
const oauthCookieName = 'seemplify_x_oauth';
const oauthLifetimeMs = 10 * 60_000;
const manualSyncCooldownMs = 60_000;
const allowedSyncIntervals = new Set([15, 30, 60, 180, 360, 720, 1440]);
const normalSyncLimit = 50;
const minimumExpansionLimit = 51;
const maximumExpansionLimit = 500;
const maximumEmptyPageHops = 3;
const standardPostReadUsd = 0.005;
const ownedPostReadUsd = 0.001;
const collectionStreams = ['account_posts', 'mentions', 'searches'] as const;
type XCollectionStream = typeof collectionStreams[number];

function canManagePlatformXApp(user: SessionUser) {
  return user.email.trim().toLowerCase() === config.adminEmail.trim().toLowerCase();
}

function canManageSpaceXAccounts(user: SessionUser, spaceId: string) {
  const row = db.prepare(`SELECT role FROM space_memberships WHERE space_id=? AND user_id=?`)
    .get(spaceId, user.id) as { role: string } | undefined;
  return row?.role === 'owner' || row?.role === 'admin';
}

function requireSpaceXManager(user: SessionUser, spaceId: string, action = 'manage this X integration') {
  if (!canManageSpaceXAccounts(user, spaceId)) {
    throw new XIntegrationError(`Space owner or admin access is required to ${action}.`, 403);
  }
}

export class XIntegrationError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.name = 'XIntegrationError'; this.status = status; }
}
class XSyncCancelledError extends Error {
  constructor() { super('The X connection changed while this sync was running. Results from the old credentials were discarded.'); this.name = 'XSyncCancelledError'; }
}
class XQueryChangedError extends Error {
  constructor() { super('The listening query changed while this search was running, so results from the old query were discarded.'); this.name = 'XQueryChangedError'; }
}

type XAppRow = {
  id: string; consumer_key_enc: string | null; consumer_secret_enc: string | null; bearer_token_enc: string | null;
  client_id_enc: string | null; client_secret_enc: string | null; billing_status: string; billing_problem_type: string | null; billing_checked_at: string | null;
  credential_version: number; configured_by: string | null; created_at: string; updated_at: string;
};
type XConnectionRow = {
  id: string; space_id: string; user_id: string; app_id: string; access_token_enc: string; access_token_secret_enc: string | null;
  refresh_token_enc: string | null; auth_type: 'oauth1' | 'oauth2'; scopes_json: string; token_expires_at: string | null;
  x_user_id: string | null; username: string | null; display_name: string | null; profile_image_url: string | null;
  status: string; generation: number; auto_sync: number; sync_interval_minutes: number; next_sync_at: string | null; last_sync_at: string | null;
  last_success_at: string | null; last_post_id: string | null; last_mention_id: string | null; oldest_post_id: string | null; oldest_mention_id: string | null; last_error: string | null;
  post_backlog_token: string | null; post_backlog_since_id: string | null; post_backlog_newest_id: string | null; post_backlog_low_id: string | null; post_history_exhausted: number;
  mention_backlog_token: string | null; mention_backlog_since_id: string | null; mention_backlog_newest_id: string | null; mention_backlog_low_id: string | null; mention_history_exhausted: number;
  rate_limit_json: string; created_at: string; updated_at: string;
};

function now() { return new Date().toISOString(); }
function sha256(value: string) { return crypto.createHash('sha256').update(value).digest('hex'); }
function safeEqual(left: string, right: string) {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function parseJson<T>(value: unknown, fallback: T): T { try { return value ? JSON.parse(String(value)) as T : fallback; } catch { return fallback; } }
function parseCollectionStreams(value: unknown): XCollectionStream[] {
  const parsed = Array.isArray(value) ? value : parseJson<unknown[]>(value, []);
  const selected = collectionStreams.filter((stream) => parsed.includes(stream));
  return selected.length ? selected : [...collectionStreams];
}
function appContext(field: string) { return `x-app:${appId}:${field}:v1`; }
function connectionContext(id: string, field: string) { return `x-connection:${id}:${field}:v1`; }
function oauthContext(id: string) { return `x-oauth-request:${id}:secret:v1`; }
function callbackUrl() { return `${config.publicUrl}/api/integrations/x/callback`; }
function readOptional(path: string) { try { const value = fs.readFileSync(path, 'utf8').trim(); return value || null; } catch { return null; } }
function removeOptional(path: string) { try { fs.rmSync(path, { force: true }); } catch { /* the encrypted database copy remains authoritative */ } }
function getApp() { return db.prepare('SELECT * FROM x_apps WHERE id=?').get(appId) as XAppRow | undefined; }
function connectionsForSpace(spaceId: string) { return db.prepare('SELECT * FROM x_connections WHERE space_id=? ORDER BY created_at').all(spaceId) as XConnectionRow[]; }
function connectionForSpace(spaceId: string, connectionId?: string | null) {
  if (connectionId) return db.prepare('SELECT * FROM x_connections WHERE id=? AND space_id=?').get(connectionId, spaceId) as XConnectionRow | undefined;
  return db.prepare(`SELECT * FROM x_connections WHERE space_id=? ORDER BY
    CASE status WHEN 'connected' THEN 0 WHEN 'action_required' THEN 1 WHEN 'pending_verification' THEN 2 ELSE 3 END,created_at LIMIT 1`).get(spaceId) as XConnectionRow | undefined;
}
function cleanSecret(value: unknown, label: string) {
  const secret = String(value ?? '').trim();
  if (!secret || secret.length > 2000 || /configured|\u2022{3}|\u25cf{3}/iu.test(secret)) throw new XIntegrationError(`Enter a valid ${label}.`);
  return secret;
}
function appCredentials(row = getApp()) {
  if (!row?.consumer_key_enc || !row.consumer_secret_enc) throw new XIntegrationError('Configure the X API consumer key and secret first.', 409);
  return {
    consumerKey: decryptSecret(row.consumer_key_enc, appContext('consumer-key')),
    consumerSecret: decryptSecret(row.consumer_secret_enc, appContext('consumer-secret')),
    bearerToken: row.bearer_token_enc ? decryptSecret(row.bearer_token_enc, appContext('bearer-token')) : undefined
  };
}
function oauth2AppCredentials(row = getApp()) {
  if (!row?.client_id_enc || !row.client_secret_enc) throw new XIntegrationError('Configure the X OAuth 2 client ID and client secret first.', 409);
  return {
    clientId: decryptSecret(row.client_id_enc, appContext('client-id')),
    clientSecret: decryptSecret(row.client_secret_enc, appContext('client-secret'))
  };
}
function connectionCredentials(row: XConnectionRow) {
  return {
    accessToken: decryptSecret(row.access_token_enc, connectionContext(row.id, 'access-token')),
    accessTokenSecret: row.access_token_secret_enc ? decryptSecret(row.access_token_secret_enc, connectionContext(row.id, 'access-token-secret')) : null,
    refreshToken: row.refresh_token_enc ? decryptSecret(row.refresh_token_enc, connectionContext(row.id, 'refresh-token')) : null
  };
}
function spaceOwnsConnection(spaceId: string, connectionId: string) {
  const row = db.prepare('SELECT * FROM x_connections WHERE id=? AND space_id=?').get(connectionId, spaceId) as XConnectionRow | undefined;
  if (!row) throw new XIntegrationError('X connection not found.', 404);
  return row;
}
function pendingUserCanManageSpaceX(pending: { space_id: string; user_id: string }) {
  const membership = db.prepare('SELECT role FROM space_memberships WHERE space_id=? AND user_id=?')
    .get(pending.space_id, pending.user_id) as { role: string } | undefined;
  return membership?.role === 'owner' || membership?.role === 'admin';
}
function connectionHasCreditProbe(connectionId: string) {
  return Boolean(db.prepare(`SELECT 1 FROM x_sync_jobs WHERE connection_id=? AND credit_probe=1
    AND state IN ('queued','processing','waiting_rate_limit','waiting_billing') LIMIT 1`).get(connectionId));
}
function cancelConnectionSyncs(connectionId: string, reason: string, timestamp = now()) {
  const cancellingCreditProbe = getApp()?.billing_status === 'checking_credits' && connectionHasCreditProbe(connectionId);
  db.prepare(`UPDATE x_sync_jobs SET state='cancelled',stage='cancelled',error=?,run_after=NULL,completed_at=?,updated_at=?
    WHERE connection_id=? AND state IN ('queued','waiting_rate_limit','waiting_billing')`).run(reason, timestamp, timestamp, connectionId);
  db.prepare(`UPDATE x_sync_jobs SET stage='cancellation_requested',error=?,updated_at=?
    WHERE connection_id=? AND state='processing'`).run(reason, timestamp, connectionId);
  if (cancellingCreditProbe) db.prepare(`UPDATE x_apps SET billing_status='credits_depleted',billing_checked_at=?,updated_at=?
    WHERE id=? AND billing_status='checking_credits'`).run(timestamp, timestamp, appId);
}
function assertSyncGeneration(connectionId: string, generation: number, credentialVersion: number) {
  const current = db.prepare(`SELECT c.generation,c.status,a.credential_version FROM x_connections c
    JOIN x_apps a ON a.id=c.app_id WHERE c.id=?`).get(connectionId) as { generation: number; status: string; credential_version: number } | undefined;
  if (!current || Number(current.generation) !== generation || Number(current.credential_version) !== credentialVersion
    || ['disconnected', 'reauthorization_required'].includes(current.status)) throw new XSyncCancelledError();
}

function rowQuery(row: any) {
  return { id: row.id, label: row.label, query: row.query, enabled: Boolean(row.enabled), sinceId: row.since_id,
    oldestId: row.oldest_id, catchUpPending: Boolean(row.backlog_token || row.backlog_low_id), historyExhausted: Boolean(row.history_exhausted),
    configurationVersion: Number(row.configuration_version || 1),
    lastSyncAt: row.last_sync_at, lastSuccessAt: row.last_success_at, lastError: row.last_error,
    createdAt: row.created_at, updatedAt: row.updated_at };
}
function rowSyncJob(row: any) {
  const targets = (db.prepare(`SELECT target_key,stream,query_id,budget,fetched_count,state,has_more,empty_page_hops,page_requests,token_fallback_used,updated_at,completed_at
    FROM x_sync_target_checkpoints WHERE job_id=? ORDER BY target_order`).all(row.id) as any[]).map((target) => ({
    key: target.target_key, stream: target.stream, queryId: target.query_id, budget: Number(target.budget),
    fetchedCount: Number(target.fetched_count), remaining: Math.max(0, Number(target.budget) - Number(target.fetched_count)),
    state: target.state, hasMore: Boolean(target.has_more), emptyPageHops: Number(target.empty_page_hops || 0),
    pageRequests: Number(target.page_requests || 0), tokenFallbackUsed: Boolean(target.token_fallback_used),
    updatedAt: target.updated_at, completedAt: target.completed_at
  }));
  return { id: row.id, connectionId: row.connection_id, trigger: row.trigger_type, state: row.state, stage: row.stage,
    mode: row.trigger_type === 'expansion' ? 'expansion' : 'incremental', requestedLimit: Number(row.requested_limit || normalSyncLimit),
    streams: parseCollectionStreams(row.streams_json),
    progress: Number(row.progress), attempt: Number(row.attempt), creditProbe: Boolean(row.credit_probe), runAfter: row.run_after,
    postsFetched: Number(row.posts_fetched), mentionsFetched: Number(row.mentions_fetched), searchFetched: Number(row.search_fetched),
    importedCount: Number(row.imported_count), newCount: Number(row.imported_count), reusedCount: Number(row.reused_count || 0),
    providerRequests: Number(row.provider_requests || 0), maximumPostsRead: Number(row.maximum_posts_read || row.requested_limit || normalSyncLimit),
    hasMore: Boolean(row.has_more),
    deferredSearchQueries: Number(row.deferred_search_queries || 0), selectedQueryIds: parseJson<string[]>(row.selected_query_ids_json, []), targets,
    estimate: parseJson(row.estimate_json, null),
    analysisJobId: row.analysis_job_id, error: row.error,
    createdAt: row.created_at, startedAt: row.started_at, completedAt: row.completed_at, updatedAt: row.updated_at };
}
function publicConnection(row: XConnectionRow | undefined) {
  if (!row) return null;
  const scopes = parseJson<string[]>(row.scopes_json, []);
  const canPublishReplies = row.status === 'connected' && scopes.includes('tweet.write');
  return {
    id: row.id, status: row.status, authType: row.auth_type, scopes, tokenExpiresAt: row.token_expires_at,
    canPublishReplies,
    publishBlockedReason: canPublishReplies ? null : row.status !== 'connected'
      ? 'Reconnect this X account before posting replies.'
      : 'Reconnect this X account to grant the tweet.write permission.',
    account: row.x_user_id ? { id: row.x_user_id, username: row.username,
      name: row.display_name, profileImageUrl: row.profile_image_url } : null,
    autoSync: Boolean(row.auto_sync), syncIntervalMinutes: Number(row.sync_interval_minutes), nextSyncAt: row.next_sync_at,
    lastSyncAt: row.last_sync_at, lastSuccessAt: row.last_success_at, lastError: row.last_error,
    cursors: { latestPostId: row.last_post_id, latestMentionId: row.last_mention_id,
      oldestPostId: row.oldest_post_id, oldestMentionId: row.oldest_mention_id },
    catchUp: {
      accountPosts: { pending: Boolean(row.post_backlog_token || row.post_backlog_low_id), lowId: row.post_backlog_low_id },
      mentions: { pending: Boolean(row.mention_backlog_token || row.mention_backlog_low_id), lowId: row.mention_backlog_low_id }
    },
    history: { accountPostsExhausted: Boolean(row.post_history_exhausted), mentionsExhausted: Boolean(row.mention_history_exhausted) },
    rateLimits: parseJson(row.rate_limit_json, {}), createdAt: row.created_at, updatedAt: row.updated_at
  };
}

export function seedXIntegrationForAdmin() {
  const user = db.prepare(`SELECT u.id,u.email,u.active_space_id space_id FROM users u WHERE u.email=?`).get(config.adminEmail) as { id: string; email: string; space_id: string } | undefined;
  if (!user) return false;
  const consumerKey = readOptional(config.xSeedConsumerKeyFile); const consumerSecret = readOptional(config.xSeedConsumerSecretFile);
  const bearerToken = readOptional(config.xSeedBearerTokenFile); const accessToken = readOptional(config.xSeedAccessTokenFile);
  const accessTokenSecret = readOptional(config.xSeedAccessTokenSecretFile);
  const clientId = readOptional(config.xSeedClientIdFile); const clientSecret = readOptional(config.xSeedClientSecretFile);
  if ((!consumerKey || !consumerSecret) && (!clientId || !clientSecret)) return false;
  const timestamp = now();
  const transaction = db.transaction(() => {
    let app = getApp();
    if (!app) {
      db.prepare(`INSERT INTO x_apps (id,consumer_key_enc,consumer_secret_enc,bearer_token_enc,client_id_enc,client_secret_enc,credential_version,configured_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,1,?,?,?)`).run(appId, consumerKey ? encryptSecret(consumerKey, appContext('consumer-key')) : null,
        consumerSecret ? encryptSecret(consumerSecret, appContext('consumer-secret')) : null, bearerToken ? encryptSecret(bearerToken, appContext('bearer-token')) : null,
        clientId ? encryptSecret(clientId, appContext('client-id')) : null, clientSecret ? encryptSecret(clientSecret, appContext('client-secret')) : null,
        user.id, timestamp, timestamp);
      app = getApp();
    } else {
      db.prepare(`UPDATE x_apps SET consumer_key_enc=COALESCE(consumer_key_enc,?),consumer_secret_enc=COALESCE(consumer_secret_enc,?),
        bearer_token_enc=COALESCE(bearer_token_enc,?),client_id_enc=COALESCE(client_id_enc,?),client_secret_enc=COALESCE(client_secret_enc,?),configured_by=?,updated_at=? WHERE id=?`)
        .run(consumerKey ? encryptSecret(consumerKey, appContext('consumer-key')) : null,
          consumerSecret ? encryptSecret(consumerSecret, appContext('consumer-secret')) : null,
          bearerToken ? encryptSecret(bearerToken, appContext('bearer-token')) : null,
          clientId ? encryptSecret(clientId, appContext('client-id')) : null,
          clientSecret ? encryptSecret(clientSecret, appContext('client-secret')) : null, user.id, timestamp, appId);
    }
    if (accessToken && accessTokenSecret && user.space_id && !connectionForSpace(user.space_id)) {
      const id = crypto.randomUUID();
      db.prepare(`INSERT INTO x_connections (id,space_id,user_id,app_id,access_token_enc,access_token_secret_enc,status,auto_sync,sync_interval_minutes,next_sync_at,rate_limit_json,created_at,updated_at)
        VALUES (?,?,?,?,?,?,'pending_verification',0,60,NULL,'{}',?,?)`).run(id, user.space_id, user.id, appId,
        encryptSecret(accessToken, connectionContext(id, 'access-token')), encryptSecret(accessTokenSecret, connectionContext(id, 'access-token-secret')), timestamp, timestamp);
    }
  });
  transaction();
  // Seed files are a one-shot handoff into the encrypted store, never a second
  // long-lived plaintext credential store. Incomplete token pairs are retained
  // so an operator can correct them without losing the supplied half.
  removeOptional(config.xSeedConsumerKeyFile); removeOptional(config.xSeedConsumerSecretFile);
  if (bearerToken) removeOptional(config.xSeedBearerTokenFile);
  if (accessToken && accessTokenSecret) {
    removeOptional(config.xSeedAccessTokenFile); removeOptional(config.xSeedAccessTokenSecretFile);
  }
  if (clientId && clientSecret) { removeOptional(config.xSeedClientIdFile); removeOptional(config.xSeedClientSecretFile); }
  return true;
}

function connectionCounts(connectionId: string) {
  const counts = db.prepare(`SELECT COUNT(*) collected,
    SUM(CASE WHEN cm.streams_json LIKE '%"account_post"%' THEN 1 ELSE 0 END) posts,
    SUM(CASE WHEN cm.streams_json LIKE '%"mention"%' THEN 1 ELSE 0 END) mentions,
    SUM(CASE WHEN cm.streams_json LIKE '%"search"%' THEN 1 ELSE 0 END) searches,
    SUM(CASE WHEN m.analysis_json IS NOT NULL THEN 1 ELSE 0 END) analyzed
    FROM x_connection_mentions cm JOIN social_mentions m ON m.id=cm.mention_id WHERE cm.connection_id=?`).get(connectionId) as any;
  return { collected: Number(counts?.collected || 0), accountPosts: Number(counts?.posts || 0), mentions: Number(counts?.mentions || 0),
    searchResults: Number(counts?.searches || 0), analyzed: Number(counts?.analyzed || 0) };
}

export function getXIntegrationStatus(user: SessionUser, spaceId: string, selectedConnectionId?: string | null) {
  const app = getApp();
  const ownedConnections = connectionsForSpace(spaceId);
  const connection = selectedConnectionId
    ? ownedConnections.find((item) => item.id === selectedConnectionId) || (() => { throw new XIntegrationError('X connection not found.', 404); })()
    : connectionForSpace(spaceId);
  const queries = connection ? (db.prepare('SELECT * FROM x_listening_queries WHERE connection_id=? ORDER BY created_at').all(connection.id) as any[]).map(rowQuery) : [];
  const syncJobs = connection ? (db.prepare('SELECT * FROM x_sync_jobs WHERE connection_id=? ORDER BY created_at DESC LIMIT 50').all(connection.id) as any[]).map(rowSyncJob) : [];
  const counts = connection ? connectionCounts(connection.id) : { collected: 0, accountPosts: 0, mentions: 0, searchResults: 0, analyzed: 0 };
  const aggregateCounts = ownedConnections.reduce((total, item) => {
    const value = connectionCounts(item.id);
    return { collected: total.collected + value.collected, accountPosts: total.accountPosts + value.accountPosts,
      mentions: total.mentions + value.mentions, searchResults: total.searchResults + value.searchResults, analyzed: total.analyzed + value.analyzed };
  }, { collected: 0, accountPosts: 0, mentions: 0, searchResults: 0, analyzed: 0 });
  return {
    provider: 'x', callbackUrl: callbackUrl(), canManageAppCredentials: canManagePlatformXApp(user),
    canManagePaidCollection: canManageSpaceXAccounts(user, spaceId),
    collectionPolicy: { normalSyncLimit, minimumExpansionLimit, maximumExpansionLimit,
      cacheStrategy: 'durable-pagination-with-low-boundary-fallback', alreadyStoredPostsAreNotReanalyzed: true,
      incrementalSearchStrategy: 'one-oldest-or-catch-up-query-per-run' },
    app: { configured: Boolean(app?.client_id_enc && app.client_secret_enc || app?.consumer_key_enc && app.consumer_secret_enc),
      oauth2Configured: Boolean(app?.client_id_enc && app.client_secret_enc), consumerCredentialsConfigured: Boolean(app?.consumer_key_enc && app.consumer_secret_enc),
      bearerTokenConfigured: Boolean(app?.bearer_token_enc), credentialVersion: Number(app?.credential_version || 0), updatedAt: app?.updated_at || null,
      billing: { status: app?.billing_status || 'unknown', problemType: app?.billing_problem_type || null, checkedAt: app?.billing_checked_at || null } },
    connections: ownedConnections.map((item) => ({ ...publicConnection(item)!, counts: connectionCounts(item.id) })),
    selectedConnectionId: connection?.id || null, connection: publicConnection(connection), queries, syncJobs, counts, aggregateCounts
  };
}

export function saveXConfiguration(user: SessionUser, spaceId: string, input: Record<string, unknown>) {
  const consumerSupplied = input.consumerKey !== undefined || input.consumerSecret !== undefined;
  const clientSupplied = input.clientId !== undefined || input.clientSecret !== undefined;
  const accessSupplied = input.accessToken !== undefined || input.accessTokenSecret !== undefined;
  const appCredentialsSupplied = consumerSupplied || clientSupplied || input.bearerToken !== undefined;
  if (appCredentialsSupplied && !canManagePlatformXApp(user)) {
    throw new XIntegrationError('Platform administrator access is required to change the shared X developer app.', 403);
  }
  if (accessSupplied && !canManageSpaceXAccounts(user, spaceId)) {
    throw new XIntegrationError('Space owner or admin access is required to add static X account credentials.', 403);
  }
  if (!appCredentialsSupplied && !accessSupplied) throw new XIntegrationError('No X credential changes were supplied.');
  const current = getApp(); const timestamp = now();
  if (consumerSupplied && (input.consumerKey === undefined || input.consumerSecret === undefined)) throw new XIntegrationError('Update the consumer key and consumer secret together.');
  if (clientSupplied && (input.clientId === undefined || input.clientSecret === undefined)) throw new XIntegrationError('Update the OAuth 2 client ID and client secret together.');
  if (accessSupplied && (input.accessToken === undefined || input.accessTokenSecret === undefined)) throw new XIntegrationError('Update the access token and access-token secret together.');
  const consumerKey = consumerSupplied ? cleanSecret(input.consumerKey, 'consumer key') : null;
  const consumerSecret = consumerSupplied ? cleanSecret(input.consumerSecret, 'consumer secret') : null;
  const clientId = clientSupplied ? cleanSecret(input.clientId, 'OAuth 2 client ID') : null;
  const clientSecret = clientSupplied ? cleanSecret(input.clientSecret, 'OAuth 2 client secret') : null;
  const bearerToken = input.bearerToken !== undefined ? cleanSecret(input.bearerToken, 'bearer token') : null;
  const accessToken = accessSupplied ? cleanSecret(input.accessToken, 'access token') : null;
  const accessTokenSecret = accessSupplied ? cleanSecret(input.accessTokenSecret, 'access-token secret') : null;
  const existingUserConnections = connectionsForSpace(spaceId);
  if (accessSupplied && (existingUserConnections.length > 1 || existingUserConnections.some((connection) => connection.status !== 'disconnected'))) {
    throw new XIntegrationError('Static OAuth 1 account tokens cannot replace or ambiguously select a connected account. Use Add X account so each identity is authorized separately.', 409);
  }
  const replaceableDisconnected = accessSupplied && existingUserConnections.length === 1 ? existingUserConnections[0] : null;
  if (replaceableDisconnected) {
    const retained = db.prepare(`SELECT
      EXISTS(SELECT 1 FROM x_connection_mentions WHERE connection_id=?)
      OR EXISTS(SELECT 1 FROM x_listening_queries WHERE connection_id=?)
      OR EXISTS(SELECT 1 FROM x_sync_jobs WHERE connection_id=?)
      OR EXISTS(SELECT 1 FROM social_reply_drafts WHERE connection_id=?)
      OR EXISTS(SELECT 1 FROM social_intelligence_reports WHERE connection_id=?) retained`)
      .get(...Array(5).fill(replaceableDisconnected.id)) as { retained: number };
    if (retained.retained) {
      throw new XIntegrationError('This disconnected X account still has retained history. Reconnect it with X OAuth, or delete its history before adding static credentials for another account.', 409);
    }
  }
  if (!current && !consumerSupplied && !clientSupplied) throw new XIntegrationError('Enter the X OAuth 2 client ID and client secret.');
  const appCredentialChanged = consumerSupplied || clientSupplied || input.bearerToken !== undefined;
  const version = Number(current?.credential_version || 0) + (appCredentialChanged ? 1 : 0) || 1;
  const transaction = db.transaction(() => {
    if (!current) {
      db.prepare(`INSERT INTO x_apps (id,consumer_key_enc,consumer_secret_enc,bearer_token_enc,client_id_enc,client_secret_enc,credential_version,configured_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(appId,
        consumerKey ? encryptSecret(consumerKey, appContext('consumer-key')) : null,
        consumerSecret ? encryptSecret(consumerSecret, appContext('consumer-secret')) : null,
        bearerToken ? encryptSecret(bearerToken, appContext('bearer-token')) : null,
        clientId ? encryptSecret(clientId, appContext('client-id')) : null,
        clientSecret ? encryptSecret(clientSecret, appContext('client-secret')) : null,
        version, user.id, timestamp, timestamp);
    } else {
      db.prepare(`UPDATE x_apps SET consumer_key_enc=?,consumer_secret_enc=?,bearer_token_enc=?,client_id_enc=?,client_secret_enc=?,credential_version=?,configured_by=?,updated_at=? WHERE id=?`).run(
        consumerSupplied ? encryptSecret(consumerKey!, appContext('consumer-key')) : current.consumer_key_enc,
        consumerSupplied ? encryptSecret(consumerSecret!, appContext('consumer-secret')) : current.consumer_secret_enc,
        input.bearerToken !== undefined ? encryptSecret(bearerToken!, appContext('bearer-token')) : current.bearer_token_enc,
        clientSupplied ? encryptSecret(clientId!, appContext('client-id')) : current.client_id_enc,
        clientSupplied ? encryptSecret(clientSecret!, appContext('client-secret')) : current.client_secret_enc,
        version, user.id, timestamp, appId);
    }
    if (appCredentialChanged && current) {
      db.prepare('UPDATE x_oauth_requests SET consumed_at=? WHERE consumed_at IS NULL').run(timestamp);
      const connections = db.prepare('SELECT id FROM x_connections').all() as Array<{ id: string }>;
      if (consumerSupplied) db.prepare("UPDATE x_connections SET status='reauthorization_required',generation=generation+1,auto_sync=0,next_sync_at=NULL,last_error='X app credentials changed. Reconnect this account.',updated_at=? WHERE auth_type='oauth1'").run(timestamp);
      if (clientSupplied) db.prepare("UPDATE x_connections SET status='reauthorization_required',generation=generation+1,auto_sync=0,next_sync_at=NULL,last_error='X OAuth client credentials changed. Reconnect this account.',updated_at=? WHERE auth_type='oauth2'").run(timestamp);
      if (!consumerSupplied && !clientSupplied) db.prepare('UPDATE x_connections SET generation=generation+1,updated_at=?').run(timestamp);
      for (const connection of connections) cancelConnectionSyncs(connection.id, consumerSupplied || clientSupplied ? 'X app credentials changed.' : 'X bearer token changed.', timestamp);
    }
    if (accessToken && accessTokenSecret) {
      // A disconnected row may still own posts, reports, drafts, and queries
      // for account A. Never relabel that history by putting unverified static
      // credentials for account B onto the same row; start with a clean,
      // provisional identity instead.
      if (replaceableDisconnected) db.prepare('DELETE FROM x_connections WHERE id=? AND space_id=?').run(replaceableDisconnected.id, spaceId);
      const id = crypto.randomUUID();
      db.prepare(`INSERT INTO x_connections (id,space_id,user_id,app_id,access_token_enc,access_token_secret_enc,status,auto_sync,sync_interval_minutes,rate_limit_json,created_at,updated_at)
        VALUES (?,?,?,?,?,?,'pending_verification',0,60,'{}',?,?)`).run(id, spaceId, user.id, appId,
        encryptSecret(accessToken, connectionContext(id, 'access-token')), encryptSecret(accessTokenSecret, connectionContext(id, 'access-token-secret')), timestamp, timestamp);
    }
  });
  transaction(); publishEvent('data-changed', { reason: 'x-configuration-updated' }, spaceId);
  return getXIntegrationStatus(user, spaceId);
}

export function deleteXConfiguration(user: SessionUser) {
  if (!canManagePlatformXApp(user)) throw new XIntegrationError('Platform administrator access is required.', 403);
  const app = getApp();
  if (!app) return;
  const oauth2Credentials = app.client_id_enc && app.client_secret_enc ? (() => { try { return oauth2AppCredentials(app); } catch { return null; } })() : null;
  const revocations = (db.prepare("SELECT * FROM x_connections WHERE app_id=? AND auth_type='oauth2' AND status<>'disconnected'").all(appId) as XConnectionRow[])
    .map((connection) => { try { return connectionCredentials(connection).accessToken; } catch { return null; } }).filter((token): token is string => Boolean(token));
  const timestamp = now();
  db.transaction(() => {
    const connections = db.prepare('SELECT id FROM x_connections WHERE app_id=?').all(appId) as Array<{ id: string }>;
    for (const connection of connections) {
      db.prepare(`UPDATE x_connections SET access_token_enc=?,access_token_secret_enc=NULL,refresh_token_enc=NULL,token_expires_at=NULL,
        status='disconnected',generation=generation+1,auto_sync=0,next_sync_at=NULL,last_error=NULL,updated_at=? WHERE id=?`).run(
        encryptSecret(`revoked-${crypto.randomUUID()}`, connectionContext(connection.id, 'access-token')), timestamp, connection.id);
      cancelConnectionSyncs(connection.id, 'X developer credentials removed.', timestamp);
    }
    db.prepare('UPDATE x_oauth_requests SET consumed_at=? WHERE app_id=? AND consumed_at IS NULL').run(timestamp, appId);
    db.prepare(`UPDATE x_apps SET consumer_key_enc=NULL,consumer_secret_enc=NULL,bearer_token_enc=NULL,client_id_enc=NULL,client_secret_enc=NULL,
      billing_status='unknown',billing_problem_type=NULL,billing_checked_at=NULL,credential_version=credential_version+1,configured_by=?,updated_at=? WHERE id=?`)
      .run(user.id, timestamp, appId);
  })();
  if (oauth2Credentials) for (const token of revocations) void revokeOAuth2Token(oauth2Credentials, token);
  publishEvent('data-changed', { reason: 'x-configuration-removed' });
}

export function disconnectXAccount(user: SessionUser, spaceId: string, connectionId?: string | null) {
  requireSpaceXManager(user, spaceId, 'disconnect X accounts');
  const connection = connectionForSpace(spaceId, connectionId);
  if (!connection) throw new XIntegrationError('X connection not found.', 404);
  const timestamp = now();
  // Keep the connection row as the user's durable history association, but
  // cryptographically replace the OAuth credentials so disconnect really
  // removes access. A future OAuth callback safely reuses this row.
  const revocationToken = connection.auth_type === 'oauth2' ? (() => { try { return connectionCredentials(connection).accessToken; } catch { return null; } })() : null;
  const oauth2Credentials = connection.auth_type === 'oauth2' ? (() => { try { return oauth2AppCredentials(); } catch { return null; } })() : null;
  db.transaction(() => {
    db.prepare(`UPDATE x_connections SET access_token_enc=?,access_token_secret_enc=NULL,refresh_token_enc=NULL,token_expires_at=NULL,status='disconnected',generation=generation+1,auto_sync=0,next_sync_at=NULL,
      last_error=NULL,updated_at=? WHERE id=? AND space_id=?`).run(
      encryptSecret(`revoked-${crypto.randomUUID()}`, connectionContext(connection.id, 'access-token')),
      timestamp, connection.id, spaceId);
    db.prepare('UPDATE x_oauth_requests SET consumed_at=? WHERE space_id=? AND consumed_at IS NULL').run(timestamp, spaceId);
    cancelConnectionSyncs(connection.id, 'X account disconnected.', timestamp);
  })();
  if (oauth2Credentials && revocationToken) void revokeOAuth2Token(oauth2Credentials, revocationToken);
  publishEvent('data-changed', { reason: 'x-account-disconnected' }, spaceId);
}

export function deleteXCollectedHistory(user: SessionUser, spaceId: string, connectionId?: string | null) {
  requireSpaceXManager(user, spaceId, 'delete X history');
  const connection = connectionForSpace(spaceId, connectionId);
  if (!connection) throw new XIntegrationError('X connection history not found.', 404);
  const transaction = db.transaction(() => {
    const deletingCreditProbe = getApp()?.billing_status === 'checking_credits' && connectionHasCreditProbe(connection.id);
    const ids = (db.prepare('SELECT mention_id id FROM x_connection_mentions WHERE connection_id=?').all(connection.id) as Array<{ id: string }>).map((row) => row.id);
    const replyJobIds = (db.prepare('SELECT ai_job_id id FROM social_reply_drafts WHERE connection_id=? AND ai_job_id IS NOT NULL').all(connection.id) as Array<{ id: string }>).map((row) => row.id);
    const socialReports = db.prepare('SELECT id,ai_job_id FROM social_intelligence_reports WHERE connection_id=?').all(connection.id) as Array<{ id: string; ai_job_id: string | null }>;
    const socialRefs = socialReports.map((row) => `social-report:${row.id}`);
    const combinedReports = socialRefs.length ? (db.prepare(`SELECT id,ai_job_id FROM intelligence_reports WHERE ${socialRefs.map(() => 'source_refs_json LIKE ?').join(' OR ')}`)
      .all(...socialRefs.map((ref) => `%${ref}%`)) as Array<{ id: string; ai_job_id: string | null }>) : [];
    for (const jobId of [...replyJobIds, ...socialReports.map((row) => row.ai_job_id), ...combinedReports.map((row) => row.ai_job_id)].filter(Boolean)) {
      db.prepare('DELETE FROM ai_jobs WHERE id=?').run(jobId);
    }
    for (const report of combinedReports) db.prepare('DELETE FROM intelligence_reports WHERE id=?').run(report.id);
    db.prepare('DELETE FROM social_intelligence_reports WHERE connection_id=?').run(connection.id);
    db.prepare('DELETE FROM social_reply_drafts WHERE connection_id=?').run(connection.id);
    const syncIds = new Set((db.prepare('SELECT id FROM x_sync_jobs WHERE connection_id=?').all(connection.id) as Array<{ id: string }>).map((row) => row.id));
    const derivedJobIds = (db.prepare("SELECT id,input_json FROM ai_jobs WHERE kind='social.analyze'").all() as Array<{ id: string; input_json: string }>).filter((row) => {
      const input = parseJson<{ xSyncJobId?: string }>(row.input_json, {}); return Boolean(input.xSyncJobId && syncIds.has(input.xSyncJobId));
    }).map((row) => row.id);
    for (const id of derivedJobIds) db.prepare('DELETE FROM ai_jobs WHERE id=?').run(id);
    db.prepare('DELETE FROM x_sync_jobs WHERE connection_id=?').run(connection.id);
    if (deletingCreditProbe) db.prepare(`UPDATE x_apps SET billing_status='credits_depleted',billing_checked_at=?,updated_at=?
      WHERE id=? AND billing_status='checking_credits'`).run(now(), now(), appId);
    db.prepare('DELETE FROM x_connection_mentions WHERE connection_id=?').run(connection.id);
    let deleted = 0;
    const remaining = db.prepare('SELECT 1 FROM x_connection_mentions WHERE mention_id=? LIMIT 1');
    const removeMention = db.prepare("DELETE FROM social_mentions WHERE id=? AND source='x'");
    for (const id of ids) if (!remaining.get(id)) deleted += removeMention.run(id).changes;
    const connectionDeleted = connection.status === 'disconnected';
    if (connectionDeleted) {
      // Once a disconnected account's history is purged there is no durable
      // identity association left to preserve. Deleting the row also removes
      // its listening queries and prevents anonymous tombstones accumulating.
      db.prepare('DELETE FROM x_connections WHERE id=? AND space_id=?').run(connection.id, spaceId);
    } else {
      db.prepare(`UPDATE x_connections SET last_post_id=NULL,last_mention_id=NULL,oldest_post_id=NULL,oldest_mention_id=NULL,
        post_backlog_token=NULL,post_backlog_since_id=NULL,post_backlog_newest_id=NULL,post_backlog_low_id=NULL,post_history_exhausted=0,
        mention_backlog_token=NULL,mention_backlog_since_id=NULL,mention_backlog_newest_id=NULL,mention_backlog_low_id=NULL,mention_history_exhausted=0,
        last_sync_at=NULL,last_success_at=NULL,last_error=NULL,rate_limit_json='{}',generation=generation+1,auto_sync=0,next_sync_at=NULL,updated_at=? WHERE id=?`)
        .run(now(), connection.id);
      for (const query of db.prepare('SELECT id FROM x_listening_queries WHERE connection_id=?').all(connection.id) as Array<{ id: string }>) {
        db.prepare(`UPDATE x_listening_queries SET since_id=NULL,oldest_id=NULL,backlog_token=NULL,backlog_since_id=NULL,
          backlog_newest_id=NULL,backlog_low_id=NULL,history_exhausted=0,last_sync_at=NULL,last_success_at=NULL,last_error=NULL,updated_at=? WHERE id=?`).run(now(), query.id);
      }
    }
    return { unlinked: ids.length, deleted, deletedAnalysisJobs: derivedJobIds.length,
      deletedReplyDrafts: replyJobIds.length, deletedSocialReports: socialReports.length, deletedCombinedReports: combinedReports.length,
      connectionDeleted };
  });
  const result = transaction(); publishEvent('data-changed', { reason: 'x-history-deleted', ...result }, spaceId); return result;
}

export function listXCollectedMentions(_user: SessionUser, spaceId: string, limit = 500, connectionId?: string | null) {
  const connection = connectionForSpace(spaceId, connectionId); if (!connection) return [];
  const links = db.prepare(`SELECT m.id,cm.streams_json,cm.query_ids_json FROM x_connection_mentions cm JOIN social_mentions m ON m.id=cm.mention_id
    WHERE cm.connection_id=? ORDER BY m.published_at DESC LIMIT ?`).all(connection.id, Math.max(1, Math.min(1000, Math.floor(limit)))) as Array<{ id: string; streams_json: string; query_ids_json: string }>;
  const byId = new Map(links.map((row) => [row.id, row]));
  return listSocialMentionsByIdsForSpace(links.map((row) => row.id), spaceId).map((mention) => {
    const link = byId.get(mention.id); const x = (mention.metadata as any)?.x || {};
    return { ...mention, xConnectionId: connection.id, metadata: { ...mention.metadata, x: { ...x,
      streams: parseJson<string[]>(link?.streams_json, []), queryIds: parseJson<string[]>(link?.query_ids_json, []) } } };
  });
}

export function updateXConnectionSettings(_user: SessionUser, spaceId: string, input: { autoSync?: boolean; syncIntervalMinutes?: number }, connectionId?: string | null) {
  requireSpaceXManager(_user, spaceId, 'change X synchronisation settings');
  const connection = connectionForSpace(spaceId, connectionId);
  if (!connection) throw new XIntegrationError('Connect an X account first.', 409);
  const interval = input.syncIntervalMinutes ?? Number(connection.sync_interval_minutes);
  if (!allowedSyncIntervals.has(interval)) throw new XIntegrationError('Choose a supported synchronisation interval.');
  const enabled = input.autoSync ?? Boolean(connection.auto_sync); const timestamp = now();
  if (enabled && connection.status !== 'connected') throw new XIntegrationError('Verify or reconnect the X account before enabling automatic sync.', 409);
  const next = enabled ? new Date(Date.now() + interval * 60_000).toISOString() : null;
  db.prepare('UPDATE x_connections SET auto_sync=?,sync_interval_minutes=?,next_sync_at=?,updated_at=? WHERE id=? AND space_id=?')
    .run(enabled ? 1 : 0, interval, next, timestamp, connection.id, spaceId);
  publishEvent('data-changed', { reason: 'x-sync-settings-updated' }, spaceId);
  return publicConnection(connectionForSpace(spaceId, connection.id));
}

function oauthRequestCookieName(requestToken?: string) {
  return requestToken ? `${oauthCookieName}_${sha256(requestToken).slice(0, 16)}` : oauthCookieName;
}

function oauthCookie(value: string, maxAge: number, requestToken?: string) {
  const secure = config.publicUrl.startsWith('https://') ? '; Secure' : '';
  return `${oauthRequestCookieName(requestToken)}=${encodeURIComponent(value)}; Path=/api/integrations/x/callback; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
export function clearXOAuthCookie(requestToken?: string) { return oauthCookie('', 0, requestToken); }
export function xOAuthCookieFromHeader(cookieHeader: string | undefined, requestToken?: string) {
  const values = Object.fromEntries(String(cookieHeader || '').split(';').map((part) => part.trim().split('='))
    .filter((parts) => parts.length === 2).map(([key, value]) => [key, decodeURIComponent(value)]));
  // The legacy cookie fallback keeps callbacks already in flight during an
  // upgrade working, while request-specific cookies allow concurrent logins.
  return values[oauthRequestCookieName(requestToken)] || values[oauthCookieName] || '';
}

function connectionMutationSnapshot(spaceId: string) {
  return connectionsForSpace(spaceId).map((row) => `${row.id}:${row.generation}:${row.status}`).sort();
}

function connectionSnapshotUnchanged(spaceId: string, snapshot: string[]) {
  const current = new Set(connectionMutationSnapshot(spaceId));
  // New rows are allowed so separate OAuth windows can add different accounts
  // concurrently. Any mutation/removal of a row that existed when exchange
  // began invalidates the callback (for example, disconnect during exchange).
  return snapshot.every((entry) => current.has(entry));
}

function oauthRequestCleanup(timestamp: string) {
  db.prepare('DELETE FROM x_oauth_requests WHERE expires_at<? OR consumed_at IS NOT NULL AND consumed_at<?')
    .run(new Date(Date.now() - 24 * 60 * 60_000).toISOString(), new Date(Date.now() - 24 * 60 * 60_000).toISOString());
}

export async function startXOAuth(user: SessionUser, spaceId: string) {
  requireSpaceXManager(user, spaceId, 'connect X accounts');
  const app = getApp(); const handshake = crypto.randomBytes(32).toString('base64url');
  const callback = callbackUrl(); const id = crypto.randomUUID(); const timestamp = now(); const expiresAt = new Date(Date.now() + oauthLifetimeMs).toISOString();
  if (app?.client_id_enc && app.client_secret_enc) {
    const credentials = oauth2AppCredentials(app); const state = crypto.randomBytes(32).toString('base64url');
    const verifier = crypto.randomBytes(48).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    db.transaction(() => {
      db.prepare(`INSERT INTO x_oauth_requests (id,space_id,user_id,app_id,credential_version,request_token_hash,request_secret_enc,handshake_hash,expires_at,created_at,flow)
        VALUES (?,?,?,?,?,?,?,?,?,?,'oauth2')`).run(id, spaceId, user.id, appId, Number(app.credential_version), sha256(state),
        encryptSecret(verifier, oauthContext(id)), sha256(handshake), expiresAt, timestamp);
      oauthRequestCleanup(timestamp);
    })();
    const parameters = new URLSearchParams({
      response_type: 'code', client_id: credentials.clientId, redirect_uri: callback,
      scope: 'tweet.read tweet.write users.read offline.access', state, code_challenge: challenge, code_challenge_method: 'S256'
    });
    return { authorizeUrl: `${config.xOAuth2AuthorizeBaseUrl}/i/oauth2/authorize?${parameters}`, cookie: oauthCookie(handshake, Math.floor(oauthLifetimeMs / 1000), state), flow: 'oauth2' as const };
  }
  const credentials = appCredentials(app); const requested = await requestOAuthToken(credentials, callback);
  db.transaction(() => {
    db.prepare(`INSERT INTO x_oauth_requests (id,space_id,user_id,app_id,credential_version,request_token_hash,request_secret_enc,handshake_hash,expires_at,created_at,flow)
      VALUES (?,?,?,?,?,?,?,?,?,?,'oauth1')`).run(id, spaceId, user.id, appId, Number(app!.credential_version), sha256(requested.token),
      encryptSecret(requested.secret, oauthContext(id)), sha256(handshake), expiresAt, timestamp);
    oauthRequestCleanup(timestamp);
  })();
  return { authorizeUrl: `${config.xOAuthBaseUrl}/oauth/authenticate?oauth_token=${encodeURIComponent(requested.token)}`, cookie: oauthCookie(handshake, Math.floor(oauthLifetimeMs / 1000), requested.token), flow: 'oauth1' as const };
}

function storeOAuth2Connection(input: { pending: any; account: { id: string; username: string; name?: string; profile_image_url?: string }; token: XOAuth2Token; snapshot: string[] }) {
  return db.transaction(() => {
    const currentApp = getApp();
    if (!currentApp || Number(currentApp.credential_version) !== Number(input.pending.credential_version)
      || !connectionSnapshotUnchanged(input.pending.space_id, input.snapshot) || !pendingUserCanManageSpaceX(input.pending)) throw new XSyncCancelledError();
    const timestamp = now();
    const existing = db.prepare('SELECT * FROM x_connections WHERE space_id=? AND x_user_id=?').get(input.pending.space_id, input.account.id) as XConnectionRow | undefined;
    const id = existing?.id || crypto.randomUUID();
    const access = encryptSecret(input.token.accessToken, connectionContext(id, 'access-token'));
    const refresh = input.token.refreshToken ? encryptSecret(input.token.refreshToken, connectionContext(id, 'refresh-token')) : null;
    const expiresAt = new Date(Date.now() + input.token.expiresIn * 1000).toISOString();
    if (existing) {
      db.prepare(`UPDATE x_connections SET app_id=?,access_token_enc=?,access_token_secret_enc=NULL,refresh_token_enc=?,auth_type='oauth2',scopes_json=?,token_expires_at=?,
        username=?,display_name=?,profile_image_url=?,status='connected',generation=generation+1,auto_sync=0,next_sync_at=NULL,last_error=NULL,updated_at=? WHERE id=?`)
        .run(appId, access, refresh, JSON.stringify(input.token.scopes), expiresAt, input.account.username, input.account.name || input.account.username,
          input.account.profile_image_url || null, timestamp, id);
      cancelConnectionSyncs(id, 'X account credentials changed.', timestamp);
    } else {
      db.prepare(`INSERT INTO x_connections (id,space_id,user_id,app_id,access_token_enc,access_token_secret_enc,refresh_token_enc,auth_type,scopes_json,token_expires_at,
        x_user_id,username,display_name,profile_image_url,status,auto_sync,sync_interval_minutes,rate_limit_json,created_at,updated_at)
        VALUES (?,?,?,?,?,NULL,?,'oauth2',?,?,?,?,?,?, 'connected',0,60,'{}',?,?)`)
        .run(id, input.pending.space_id, input.pending.user_id, appId, access, refresh, JSON.stringify(input.token.scopes), expiresAt, input.account.id, input.account.username,
          input.account.name || input.account.username, input.account.profile_image_url || null, timestamp, timestamp);
    }
    return true;
  })();
}

export async function finishXOAuth(input: { oauthToken?: string; oauthVerifier?: string; denied?: string; code?: string; state?: string; error?: string; handshake: string }) {
  if (input.state) {
    const pending = db.prepare("SELECT * FROM x_oauth_requests WHERE request_token_hash=? AND consumed_at IS NULL AND flow='oauth2'").get(sha256(input.state)) as any;
    if (!pending || pending.expires_at <= now() || !input.handshake || !safeEqual(String(pending.handshake_hash), sha256(input.handshake))) return 'failed' as const;
    const timestamp = now();
    if (!db.prepare('UPDATE x_oauth_requests SET consumed_at=? WHERE id=? AND consumed_at IS NULL').run(timestamp, pending.id).changes) return 'failed' as const;
    if (input.error) return input.error === 'access_denied' ? 'denied' as const : 'failed' as const;
    const code = String(input.code || ''); if (!code || code.length > 2000) return 'failed' as const;
    try {
      if (!pendingUserCanManageSpaceX(pending)) return 'failed' as const;
      const app = getApp(); if (!app || Number(app.credential_version) !== Number(pending.credential_version)) return 'failed' as const;
      const snapshot = connectionMutationSnapshot(pending.space_id); const credentials = oauth2AppCredentials(app);
      const verifier = decryptSecret(pending.request_secret_enc, oauthContext(pending.id));
      const token = await exchangeOAuth2Code(credentials, { code, redirectUri: callbackUrl(), codeVerifier: verifier });
      const profile = await getXJson<{ data?: { id?: string; username?: string; name?: string; profile_image_url?: string } }>({
        path: '/2/users/me?user.fields=id,name,username,profile_image_url', bearerToken: token.accessToken
      });
      const account = profile.data.data;
      if (!account?.id || !account.username) return 'failed' as const;
      storeOAuth2Connection({ pending, account: { id: account.id, username: account.username, name: account.name, profile_image_url: account.profile_image_url }, token, snapshot });
      publishEvent('data-changed', { reason: 'x-account-connected', connectionCount: connectionsForSpace(pending.space_id).length }, pending.space_id);
      return 'connected' as const;
    } catch { return 'failed' as const; }
  }
  const requestToken = String(input.oauthToken || input.denied || '');
  if (!/^[A-Za-z0-9_-]{8,300}$/.test(requestToken) || !input.handshake) return 'failed' as const;
  const pending = db.prepare("SELECT * FROM x_oauth_requests WHERE request_token_hash=? AND consumed_at IS NULL AND flow='oauth1'").get(sha256(requestToken)) as any;
  if (!pending || pending.expires_at <= now() || !safeEqual(String(pending.handshake_hash), sha256(input.handshake))) return 'failed' as const;
  const timestamp = now();
  const claimed = db.prepare('UPDATE x_oauth_requests SET consumed_at=? WHERE id=? AND consumed_at IS NULL').run(timestamp, pending.id).changes;
  if (!claimed) return 'failed' as const;
  if (input.denied) return 'denied' as const;
  const verifier = String(input.oauthVerifier || '');
  if (!/^[A-Za-z0-9_-]{4,300}$/.test(verifier)) return 'failed' as const;
  try {
    if (!pendingUserCanManageSpaceX(pending)) return 'failed' as const;
    const app = getApp();
    if (!app || Number(app.credential_version) !== Number(pending.credential_version)) return 'failed' as const;
    const snapshot = connectionMutationSnapshot(pending.space_id);
    const credentials = appCredentials(app); const oauthApp = { consumerKey: credentials.consumerKey, consumerSecret: credentials.consumerSecret };
    const requestSecret = decryptSecret(pending.request_secret_enc, oauthContext(pending.id));
    const exchanged = await exchangeOAuthToken(oauthApp, requestToken, requestSecret, verifier);
    const profile = await getXJson<{ data?: { id?: string; username?: string; name?: string; profile_image_url?: string } }>({
      path: '/2/users/me?user.fields=id,name,username,profile_image_url', ...oauthApp,
      accessToken: exchanged.accessToken, accessTokenSecret: exchanged.accessTokenSecret
    });
    const account = profile.data.data;
    if (!account?.id || !account.username || exchanged.xUserId && exchanged.xUserId !== account.id) return 'failed' as const;
    const stored = db.transaction(() => {
      const currentApp = getApp(); const existing = db.prepare('SELECT * FROM x_connections WHERE space_id=? AND x_user_id=?').get(pending.space_id, account.id) as XConnectionRow | undefined;
      if (!currentApp || Number(currentApp.credential_version) !== Number(pending.credential_version)) throw new XSyncCancelledError();
      if (!connectionSnapshotUnchanged(pending.space_id, snapshot) || !pendingUserCanManageSpaceX(pending)) throw new XSyncCancelledError();
      const finalTimestamp = now(); const id = existing?.id || crypto.randomUUID();
      if (existing) {
        db.prepare(`UPDATE x_connections SET app_id=?,access_token_enc=?,access_token_secret_enc=?,refresh_token_enc=NULL,auth_type='oauth1',scopes_json='["tweet.read","tweet.write","users.read"]',token_expires_at=NULL,x_user_id=?,username=?,display_name=?,profile_image_url=?,status='connected',generation=generation+1,auto_sync=0,next_sync_at=NULL,last_error=NULL,updated_at=? WHERE id=?`)
          .run(appId, encryptSecret(exchanged.accessToken, connectionContext(id, 'access-token')), encryptSecret(exchanged.accessTokenSecret, connectionContext(id, 'access-token-secret')),
            account.id, account.username, account.name || account.username, account.profile_image_url || null, finalTimestamp, id);
        cancelConnectionSyncs(id, 'X account credentials changed.', finalTimestamp);
      } else db.prepare(`INSERT INTO x_connections (id,space_id,user_id,app_id,access_token_enc,access_token_secret_enc,auth_type,scopes_json,x_user_id,username,display_name,profile_image_url,status,auto_sync,sync_interval_minutes,rate_limit_json,created_at,updated_at)
        VALUES (?,?,?,?,?,?,'oauth1','["tweet.read","tweet.write","users.read"]',?,?,?,?,'connected',0,60,'{}',?,?)`).run(id, pending.space_id, pending.user_id, appId,
        encryptSecret(exchanged.accessToken, connectionContext(id, 'access-token')), encryptSecret(exchanged.accessTokenSecret, connectionContext(id, 'access-token-secret')),
        account.id, account.username, account.name || account.username, account.profile_image_url || null, finalTimestamp, finalTimestamp);
      return true;
    })();
    if (!stored) return 'failed' as const;
    publishEvent('data-changed', { reason: 'x-account-connected' }, pending.space_id);
    return 'connected' as const;
  } catch { return 'failed' as const; }
}

export function listXQueries(_user: SessionUser, spaceId: string, connectionId?: string | null) {
  const connection = connectionForSpace(spaceId, connectionId); if (!connection) return [];
  return (db.prepare('SELECT * FROM x_listening_queries WHERE connection_id=? ORDER BY created_at').all(connection.id) as any[]).map(rowQuery);
}

function unlinkQueryAssociations(connectionId: string, queryId: string) {
  const rows = db.prepare(`SELECT mention_id,streams_json,query_ids_json FROM x_connection_mentions
    WHERE connection_id=? AND query_ids_json LIKE ?`).all(connectionId, `%${queryId}%`) as Array<{
      mention_id: string; streams_json: string; query_ids_json: string;
    }>;
  const update = db.prepare(`UPDATE x_connection_mentions SET streams_json=?,query_ids_json=?,last_seen_at=?
    WHERE connection_id=? AND mention_id=?`);
  const timestamp = now();
  for (const row of rows) {
    const queryIds = parseJson<string[]>(row.query_ids_json, []).filter((id) => id !== queryId);
    if (queryIds.length === parseJson<string[]>(row.query_ids_json, []).length) continue;
    const streams = parseJson<string[]>(row.streams_json, []);
    update.run(JSON.stringify(queryIds.length ? streams : streams.filter((stream) => stream !== 'search')),
      JSON.stringify(queryIds), timestamp, connectionId, row.mention_id);
  }
}

export function createXQuery(_user: SessionUser, spaceId: string, input: { label: string; query: string; enabled?: boolean }, connectionId?: string | null) {
  requireSpaceXManager(_user, spaceId, 'create X listening queries');
  const connection = connectionForSpace(spaceId, connectionId); if (!connection) throw new XIntegrationError('Connect an X account first.', 409);
  const count = Number((db.prepare('SELECT COUNT(*) count FROM x_listening_queries WHERE connection_id=?').get(connection.id) as any).count);
  if (count >= 10) throw new XIntegrationError('A maximum of 10 listening queries can be active for one account.');
  const id = crypto.randomUUID(); const timestamp = now();
  db.prepare(`INSERT INTO x_listening_queries (id,connection_id,label,query,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
    .run(id, connection.id, input.label.trim(), input.query.trim(), input.enabled === false ? 0 : 1, timestamp, timestamp);
  publishEvent('data-changed', { reason: 'x-query-created', id }, spaceId);
  return rowQuery(db.prepare('SELECT * FROM x_listening_queries WHERE id=?').get(id));
}
export function updateXQuery(_user: SessionUser, spaceId: string, id: string, input: { label?: string; query?: string; enabled?: boolean }) {
  requireSpaceXManager(_user, spaceId, 'change X listening queries');
  const current = db.prepare(`SELECT q.* FROM x_listening_queries q JOIN x_connections c ON c.id=q.connection_id
    WHERE q.id=? AND c.space_id=?`).get(id, spaceId) as any;
  if (!current) throw new XIntegrationError('Listening query not found.', 404);
  const queryChanged = input.query !== undefined && input.query.trim() !== current.query;
  db.transaction(() => {
    if (queryChanged) unlinkQueryAssociations(current.connection_id, id);
    db.prepare(`UPDATE x_listening_queries SET label=?,query=?,enabled=?,since_id=?,oldest_id=?,backlog_token=?,backlog_since_id=?,
      backlog_newest_id=?,backlog_low_id=?,history_exhausted=?,configuration_version=configuration_version+1,updated_at=? WHERE id=? AND connection_id=?`)
      .run(input.label?.trim() ?? current.label, input.query?.trim() ?? current.query, input.enabled === undefined ? current.enabled : input.enabled ? 1 : 0,
        queryChanged ? null : current.since_id, queryChanged ? null : current.oldest_id,
        queryChanged ? null : current.backlog_token, queryChanged ? null : current.backlog_since_id,
        queryChanged ? null : current.backlog_newest_id, queryChanged ? null : current.backlog_low_id,
        queryChanged ? 0 : current.history_exhausted, now(), id, current.connection_id);
  })();
  publishEvent('data-changed', { reason: 'x-query-updated', id }, spaceId);
  return rowQuery(db.prepare('SELECT * FROM x_listening_queries WHERE id=?').get(id));
}
export function deleteXQuery(_user: SessionUser, spaceId: string, id: string) {
  requireSpaceXManager(_user, spaceId, 'delete X listening queries');
  const current = db.prepare(`SELECT q.id,q.connection_id FROM x_listening_queries q JOIN x_connections c ON c.id=q.connection_id
    WHERE q.id=? AND c.space_id=?`).get(id, spaceId) as { id: string; connection_id: string } | undefined;
  if (!current) throw new XIntegrationError('Listening query not found.', 404);
  db.transaction(() => {
    unlinkQueryAssociations(current.connection_id, id);
    if (!db.prepare('DELETE FROM x_listening_queries WHERE id=?').run(id).changes) throw new XIntegrationError('Listening query not found.', 404);
  })();
  publishEvent('data-changed', { reason: 'x-query-deleted', id }, spaceId);
}

function stableMentionId(postId: string, spaceId = 'legacy') {
  const hash = crypto.createHash('sha256').update(`x:${spaceId}:${postId}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
function greatestId(values: Array<string | null | undefined>) {
  return values.filter((value): value is string => Boolean(value && /^\d+$/.test(value)))
    .reduce<string | null>((largest, value) => !largest || BigInt(value) > BigInt(largest) ? value : largest, null);
}
function lowestId(values: Array<string | null | undefined>) {
  return values.filter((value): value is string => Boolean(value && /^\d+$/.test(value)))
    .reduce<string | null>((lowest, value) => !lowest || BigInt(value) < BigInt(lowest) ? value : lowest, null);
}
function previousId(value: string | null | undefined) {
  if (!value || !/^\d+$/.test(value) || BigInt(value) <= 0n) return null;
  return (BigInt(value) - 1n).toString();
}
type XPost = { id: string; text?: string; created_at?: string; lang?: string; author_id?: string; public_metrics?: Record<string, number>; note_tweet?: { text?: string } };
type XPostPage = { data?: XPost[]; includes?: { users?: Array<{ id: string; username?: string; name?: string; profile_image_url?: string }> }; meta?: { newest_id?: string; next_token?: string; result_count?: number } };
type CollectedPost = { post: XPost; stream: 'account_post' | 'mention' | 'search'; queryId?: string; users?: NonNullable<XPostPage['includes']>['users'] };
type XFetchTarget = {
  stream: XCollectionStream; budget: number; minimumPageSize: number;
  query?: { id: string; query: string; since_id: string | null; oldest_id: string | null; updated_at: string; last_sync_at: string | null;
    backlog_token: string | null; backlog_since_id: string | null; backlog_newest_id: string | null; backlog_low_id: string | null;
    history_exhausted: number; configuration_version: number };
};

function collectionPlan(connection: XConnectionRow, requestedLimit: number, streams: XCollectionStream[], mode: 'incremental' | 'expansion') {
  const candidates: Array<Omit<XFetchTarget, 'budget'>> = [];
  const exhaustedTargets: string[] = [];
  if (streams.includes('account_posts')) {
    if (mode === 'expansion' && connection.post_history_exhausted) exhaustedTargets.push('account_posts');
    else candidates.push({ stream: 'account_posts', minimumPageSize: 5 });
  }
  if (streams.includes('mentions')) {
    if (mode === 'expansion' && connection.mention_history_exhausted) exhaustedTargets.push('mentions');
    else candidates.push({ stream: 'mentions', minimumPageSize: 5 });
  }
  let allQueryRows: NonNullable<XFetchTarget['query']>[] = []; let deferredQueryIds: string[] = [];
  if (streams.includes('searches')) {
    allQueryRows = db.prepare(`SELECT id,query,since_id,oldest_id,updated_at,last_sync_at,backlog_token,backlog_since_id,
        backlog_newest_id,backlog_low_id,history_exhausted,configuration_version FROM x_listening_queries
      WHERE connection_id=? AND enabled=1 ORDER BY
        CASE WHEN backlog_token IS NOT NULL OR backlog_low_id IS NOT NULL THEN 0 WHEN last_sync_at IS NULL THEN 1 ELSE 2 END,
        last_sync_at,created_at`)
      .all(connection.id) as NonNullable<XFetchTarget['query']>[];
    // Incremental sync rotates through one listening query per run so account
    // posts and mentions retain useful capacity inside the 50-post ceiling.
    // Explicit expansion may include every query that fits its larger budget.
    const eligible = mode === 'expansion' ? allQueryRows.filter((query) => {
      if (query.history_exhausted) exhaustedTargets.push(`query:${query.id}`);
      return !query.history_exhausted;
    }) : allQueryRows;
    const selected = mode === 'incremental' ? eligible.slice(0, 1) : eligible;
    if (mode === 'incremental') deferredQueryIds = eligible.slice(1).map((query) => query.id);
    for (const query of selected) candidates.push({ stream: 'searches', minimumPageSize: 10, query });
  }
  const selected: Array<Omit<XFetchTarget, 'budget'>> = [];
  let minimumTotal = 0;
  for (const candidate of candidates) {
    if (minimumTotal + candidate.minimumPageSize > requestedLimit) {
      if (mode === 'expansion') throw new XIntegrationError(`Increase the expansion limit to include every requested search query (minimum ${minimumTotal + candidate.minimumPageSize}).`, 422);
      continue;
    }
    selected.push(candidate); minimumTotal += candidate.minimumPageSize;
  }
  if (!selected.length) throw new XIntegrationError(mode === 'expansion' && exhaustedTargets.length
    ? 'All requested X history streams are exhausted.' : 'No enabled X collection stream fits the requested limit.', 409);
  const budgets = selected.map((candidate) => candidate.minimumPageSize);
  let remaining = requestedLimit - minimumTotal;
  for (let index = 0; remaining > 0; index = (index + 1) % selected.length) {
    budgets[index] += 1; remaining -= 1;
  }
  const targets = selected.map((candidate, index): XFetchTarget => ({ ...candidate, budget: budgets[index] }));
  return { targets, maximumPostsRead: budgets.reduce((total, value) => total + value, 0),
    // X accepts up to 100 posts per collection page. This is a request-count
    // estimate, not the minimum allocation used by our fair budget splitter.
    providerRequests: targets.reduce((total, target) => total + Math.ceil(target.budget / 100), connection.x_user_id ? 0 : 1),
    selectedQueryIds: targets.flatMap((target) => target.query ? [target.query.id] : []), deferredQueryIds, exhaustedTargets,
    activeSearchQueryCount: allQueryRows.length };
}

type XCollectionPlan = ReturnType<typeof collectionPlan>;

function expansionPlanFingerprint(connection: XConnectionRow, boundedLimit: number, streams: XCollectionStream[], plan: XCollectionPlan) {
  const app = getApp();
  const targetSnapshot = plan.targets.map((target) => ({
    key: target.query ? `query:${target.query.id}` : target.stream,
    stream: target.stream,
    budget: target.budget,
    startUntilId: target.stream === 'account_posts' ? connection.oldest_post_id
      : target.stream === 'mentions' ? connection.oldest_mention_id : target.query!.oldest_id,
    historyExhausted: target.stream === 'account_posts' ? Boolean(connection.post_history_exhausted)
      : target.stream === 'mentions' ? Boolean(connection.mention_history_exhausted) : Boolean(target.query!.history_exhausted),
    queryId: target.query?.id || null,
    queryText: target.query?.query || null,
    queryVersion: target.query?.configuration_version || null
  }));
  const snapshot = JSON.stringify({
    connectionId: connection.id,
    connectionGeneration: Number(connection.generation),
    appCredentialVersion: Number(app?.credential_version || 0),
    boundedLimit,
    streams,
    selectedQueryIds: plan.selectedQueryIds,
    deferredQueryIds: plan.deferredQueryIds,
    exhaustedTargets: plan.exhaustedTargets,
    targets: targetSnapshot
  });
  // Salt the public fingerprint with encrypted app material. Clients can hold
  // and replay the opaque value but cannot forge a different accepted plan.
  const salt = `${app?.consumer_key_enc || app?.client_id_enc || appId}:${app?.credential_version || 0}`;
  return `xplan_${sha256(`${salt}\n${snapshot}`)}`;
}

function expansionEstimateFromPlan(connection: XConnectionRow, requestedLimit: number, boundedLimit: number,
  selectedStreams: XCollectionStream[], plan: XCollectionPlan, canManagePaidCollection = false) {
  const budgets = plan.targets.reduce<Record<string, number>>((result, target) => {
    const key = target.query ? `query:${target.query.id}` : target.stream;
    result[key] = target.budget; return result;
  }, {});
  return {
    connectionId: connection.id, mode: 'expansion' as const, requestedLimit, boundedLimit, canManagePaidCollection,
    planFingerprint: expansionPlanFingerprint(connection, boundedLimit, selectedStreams, plan),
    minimumLimit: minimumExpansionLimit, maximumLimit: maximumExpansionLimit, normalSyncLimit,
    streams: selectedStreams, storedCount: connectionCounts(connection.id).collected, alreadyStoredExcluded: false,
    cachedPostsDeduplicatedAfterFetch: true,
    estimated: {
      maximumNewPosts: plan.maximumPostsRead, maximumProviderRows: plan.maximumPostsRead, maximumUniqueNewPosts: plan.maximumPostsRead,
      providerRequests: plan.providerRequests,
      payablePostsUpperBound: plan.maximumPostsRead, standardPostReadUsd,
      maximumEstimatedCostUsd: Number((plan.maximumPostsRead * standardPostReadUsd).toFixed(3)),
      ownedPostReadUsd, pricingBasis: 'standard-post-read-upper-bound', budgets
    },
    cache: {
      strategy: 'since-and-until-cursors', incrementalHighWater: Boolean(connection.last_post_id || connection.last_mention_id),
      historicalLowWater: Boolean(connection.oldest_post_id || connection.oldest_mention_id),
      providerCursorAvoidance: true, crossStreamOverlapPossible: true
    },
    selectedQueryIds: plan.selectedQueryIds, selectedQueryCount: plan.selectedQueryIds.length,
    deferredSearchQueryIds: plan.deferredQueryIds, deferredQueryCount: plan.deferredQueryIds.length,
    exhaustedTargets: plan.exhaustedTargets, historyExhaustedStreams: plan.exhaustedTargets,
    eligibleTargets: plan.targets.map((target) => target.query ? `query:${target.query.id}` : target.stream),
    pricingCheckedAt: '2026-07-30',
    disclaimer: 'Upper-bound estimate only. X may return fewer posts; exact availability is intentionally not probed because an estimate request can itself consume paid API capacity.',
    ownedReadNote: 'The lower owned-read rate applies only when X determines the authenticated account is the developer-app owner; Seemplify does not assume eligibility.',
    generatedAt: now()
  };
}

function expansionEstimate(connection: XConnectionRow, requestedLimit: number, streams: XCollectionStream[], canManagePaidCollection = false) {
  const boundedLimit = Math.max(minimumExpansionLimit, Math.min(maximumExpansionLimit, Math.floor(requestedLimit)));
  const selectedStreams = parseCollectionStreams(streams);
  return expansionEstimateFromPlan(connection, requestedLimit, boundedLimit, selectedStreams,
    collectionPlan(connection, boundedLimit, selectedStreams, 'expansion'), canManagePaidCollection);
}

export function estimateXExpansion(user: SessionUser, spaceId: string, connectionId: string, requestedLimit: number, streams: XCollectionStream[]) {
  const connection = spaceOwnsConnection(spaceId, connectionId);
  return expansionEstimate(connection, requestedLimit, streams, canManageSpaceXAccounts(user, spaceId));
}

function upsertCollectedPosts(connection: XConnectionRow, collected: CollectedPost[]) {
  const grouped = new Map<string, CollectedPost[]>();
  for (const item of collected) if (/^\d+$/.test(String(item.post.id || ''))) grouped.set(item.post.id, [...(grouped.get(item.post.id) || []), item]);
  const insertedIds: string[] = []; let reusedCount = 0; const timestamp = now();
  for (const [postId, discoveries] of grouped) {
    const first = discoveries[0]; const post = first.post;
    const users = discoveries.flatMap((item) => item.users || []); const author = users.find((item) => item.id === post.author_id);
    const username = String(author?.username || (post.author_id === connection.x_user_id ? connection.username : '') || '').replace(/^@/, '');
    const validUsername = /^[A-Za-z0-9_]{1,15}$/.test(username) ? username : '';
    const streams = [...new Set(discoveries.map((item) => item.stream))];
    const queryIds = [...new Set(discoveries.map((item) => item.queryId).filter((value): value is string => Boolean(value)))];
    const existing = db.prepare("SELECT * FROM social_mentions WHERE space_id=? AND source='x' AND external_id=?").get(connection.space_id, postId) as any;
    const priorMetadata = parseJson<Record<string, any>>(existing?.metadata_json, {}); const priorX = priorMetadata.x || {};
    // Discovery streams and listening-query IDs are connection-scoped and live
    // in x_connection_mentions. Keeping them out of the shared post metadata
    // prevents one connected account from seeing another account's query setup.
    const { streams: _priorStreams, queryIds: _priorQueries, ...safePriorX } = priorX;
    const metadata = { ...priorMetadata, x: { ...safePriorX, postId, authorId: post.author_id || null,
      authorUsername: validUsername || null, authorName: author?.name || connection.display_name || null,
      profileImageUrl: author?.profile_image_url || null, publicMetrics: post.public_metrics || priorX.publicMetrics || {} } };
    const content = String(post.note_tweet?.text || post.text || '').slice(0, 5000); if (!content) continue;
    const published = post.created_at && !Number.isNaN(Date.parse(post.created_at)) ? new Date(post.created_at).toISOString() : timestamp;
    const url = `https://x.com/${validUsername || 'i'}/status/${postId}`;
    if (existing) {
      reusedCount += 1;
      db.prepare(`UPDATE social_mentions SET author=?,content=?,url=?,language=?,published_at=?,metadata_json=? WHERE id=?`)
        .run(validUsername ? `@${validUsername}` : author?.name || connection.display_name || '', content, url, post.lang || '', published, JSON.stringify(metadata), existing.id);
    } else {
      const id = stableMentionId(postId, connection.space_id);
      db.prepare(`INSERT INTO social_mentions (id,space_id,source,external_id,x_connection_id,ingestion_kind,author,content,url,language,published_at,metadata_json,analysis_json,created_at)
        VALUES (?,?,'x',?,?,?,?,?,?,?,?,?,NULL,?)`).run(id, connection.space_id, postId, connection.id, streams[0], validUsername ? `@${validUsername}` : author?.name || connection.display_name || '',
        content, url, post.lang || '', published, JSON.stringify(metadata), timestamp);
      insertedIds.push(id);
    }
    const mentionId = existing?.id || stableMentionId(postId, connection.space_id);
    const currentLink = db.prepare('SELECT * FROM x_connection_mentions WHERE connection_id=? AND mention_id=?').get(connection.id, mentionId) as any;
    const linkStreams = [...new Set([...(parseJson<string[]>(currentLink?.streams_json, [])), ...streams])];
    const linkQueries = [...new Set([...(parseJson<string[]>(currentLink?.query_ids_json, [])), ...queryIds])];
    db.prepare(`INSERT INTO x_connection_mentions (connection_id,mention_id,streams_json,query_ids_json,discovered_at,last_seen_at)
      VALUES (?,?,?,?,?,?) ON CONFLICT(connection_id,mention_id) DO UPDATE SET streams_json=excluded.streams_json,query_ids_json=excluded.query_ids_json,last_seen_at=excluded.last_seen_at`)
      .run(connection.id, mentionId, JSON.stringify(linkStreams), JSON.stringify(linkQueries), currentLink?.discovered_at || timestamp, timestamp);
  }
  return { insertedIds, reusedCount };
}

function persistCollectedBatch(input: {
  connection: XConnectionRow; collected: CollectedPost[]; jobId: string; generation: number; credentialVersion: number;
  assertBatchCurrent?: () => void; afterPersist?: () => void; autoAnalyze?: boolean;
}) {
  return db.transaction(() => {
    assertSyncGeneration(input.connection.id, input.generation, input.credentialVersion);
    input.assertBatchCurrent?.();
    const latestConnection = db.prepare('SELECT * FROM x_connections WHERE id=?').get(input.connection.id) as XConnectionRow;
    const { insertedIds, reusedCount } = upsertCollectedPosts(latestConnection, input.collected);
    // Automatic Terra work is intentionally limited to posts inserted by this
    // bounded incremental run. Cached historical gaps are never silently
    // drained, and an explicit expansion stores posts without triggering a
    // potentially large analysis bill.
    const analysisIds = input.autoAnalyze === false ? [] : insertedIds.slice(0, normalSyncLimit);
    const analysisJobs: ReturnType<typeof createAdmittedAiJob>[] = [];
    for (let index = 0; index < analysisIds.length; index += normalSyncLimit) {
      try {
        analysisJobs.push(createAdmittedAiJob('social.analyze', {
          mentionIds: analysisIds.slice(index, index + normalSyncLimit), source: 'x-sync', xSyncJobId: input.jobId
        }, input.connection.space_id, null, null, input.connection.user_id));
      } catch (error) {
        // Preserve the collected posts when the AI allowance is exhausted;
        // only their automatic analysis is deferred.
        if (error instanceof SubscriptionEntitlementError && error.code === 'SUBSCRIPTION_QUOTA_EXCEEDED') break;
        throw error;
      }
    }
    input.afterPersist?.();
    db.prepare('UPDATE x_sync_jobs SET imported_count=imported_count+?,reused_count=reused_count+?,analysis_job_id=COALESCE(analysis_job_id,?),updated_at=? WHERE id=?')
      .run(insertedIds.length, reusedCount, analysisJobs[0]?.id || null, now(), input.jobId);
    return { insertedIds, reusedCount, analysisJobs };
  })();
}

function dispatchAnalysisJobs(jobs: ReturnType<typeof createAdmittedAiJob>[]) {
  for (const job of jobs) publishEvent('ai-job', job, job.spaceId);
  if (jobs.length) void aiJobRunner.pump();
}

function apiPath(path: string, parameters: Record<string, string | null | undefined>) {
  const query = new URLSearchParams(); for (const [key, value] of Object.entries(parameters)) if (value) query.set(key, value);
  return `${path}?${query.toString()}`;
}
type XDataAuth = { bearerToken: string } | { consumerKey: string; consumerSecret: string; accessToken: string; accessTokenSecret: string };
function appBearerToken(row: XAppRow) {
  return row.bearer_token_enc ? decryptSecret(row.bearer_token_enc, appContext('bearer-token')) : null;
}
async function oauth2ConnectionAuth(connection: XConnectionRow, app: XAppRow): Promise<XDataAuth> {
  const current = connectionCredentials(connection);
  const expiresSoon = !connection.token_expires_at || Date.parse(connection.token_expires_at) <= Date.now() + 2 * 60_000;
  if (!expiresSoon) return { bearerToken: current.accessToken };
  if (!current.refreshToken) throw new XApiError('The X account session expired. Reconnect the account.', 401, 'authentication');
  const refreshed = await refreshOAuth2Token(oauth2AppCredentials(app), current.refreshToken);
  const timestamp = now(); const nextRefresh = refreshed.refreshToken || current.refreshToken;
  const changed = db.prepare(`UPDATE x_connections SET access_token_enc=?,refresh_token_enc=?,scopes_json=?,token_expires_at=?,updated_at=?
    WHERE id=? AND generation=? AND status<>'disconnected'`).run(
      encryptSecret(refreshed.accessToken, connectionContext(connection.id, 'access-token')),
      encryptSecret(nextRefresh, connectionContext(connection.id, 'refresh-token')),
      JSON.stringify(refreshed.scopes.length ? refreshed.scopes : parseJson<string[]>(connection.scopes_json, [])),
      new Date(Date.now() + refreshed.expiresIn * 1000).toISOString(), timestamp, connection.id, connection.generation).changes;
  if (!changed) throw new XSyncCancelledError();
  return { bearerToken: refreshed.accessToken };
}
async function connectionDataAuth(connection: XConnectionRow, app: XAppRow): Promise<XDataAuth> {
  if (connection.auth_type === 'oauth2') return oauth2ConnectionAuth(connection, app);
  const appSecrets = appCredentials(app); const accountSecrets = connectionCredentials(connection);
  if (!accountSecrets.accessTokenSecret) throw new XApiError('The X account credentials are incomplete. Reconnect the account.', 401, 'authentication');
  return { consumerKey: appSecrets.consumerKey, consumerSecret: appSecrets.consumerSecret,
    accessToken: accountSecrets.accessToken, accessTokenSecret: accountSecrets.accessTokenSecret };
}

function replyPublication(spaceId: string, draftId: string) {
  const row = db.prepare(`SELECT after_json,created_at FROM platform_audit_events
    WHERE space_id=? AND target_type='social_reply_draft' AND target_id=? AND action='social_reply.published'
    ORDER BY created_at DESC,id DESC LIMIT 1`).get(spaceId, draftId) as { after_json: string; created_at: string } | undefined;
  if (!row) return null;
  const detail = parseJson<Record<string, unknown>>(row.after_json, {});
  return {
    tweetId: String(detail.tweetId || ''), url: String(detail.url || ''),
    postedBy: String(detail.postedBy || ''), postedAt: row.created_at
  };
}

function recordReplyPublicationAudit(input: {
  user: SessionUser; spaceId: string; draftId: string; action: string; reason?: string;
  before?: Record<string, unknown>; after?: Record<string, unknown>;
  requestId?: string; ipAddress?: string; userAgent?: string;
}) {
  const membership = db.prepare('SELECT role FROM space_memberships WHERE space_id=? AND user_id=?')
    .get(input.spaceId, input.user.id) as { role: string } | undefined;
  db.prepare(`INSERT INTO platform_audit_events
    (id,actor_user_id,actor_role,action,target_type,target_id,space_id,reason,before_json,after_json,request_id,ip_address,user_agent,created_at)
    VALUES (?,?,?,?, 'social_reply_draft',?,?,?,?,?,?,?,?,?)`).run(
    crypto.randomUUID(), input.user.id, membership?.role || input.user.role, input.action, input.draftId, input.spaceId,
    String(input.reason || '').slice(0, 1000), JSON.stringify(input.before || {}), JSON.stringify(input.after || {}),
    String(input.requestId || '').slice(0, 120) || crypto.randomUUID(), String(input.ipAddress || '').slice(0, 100),
    String(input.userAgent || '').slice(0, 500), now()
  );
}

export async function publishSocialReplyDraft(user: SessionUser, spaceId: string, draftId: string, input: {
  content: string; requestId?: string; ipAddress?: string; userAgent?: string;
}) {
  requireSpaceXManager(user, spaceId, 'publish replies on X');
  const draft = db.prepare(`SELECT d.*,m.external_id,c.username,c.status connection_status,c.auth_type,c.scopes_json
    FROM social_reply_drafts d
    JOIN social_mentions m ON m.id=d.mention_id AND m.space_id=d.space_id
    JOIN x_connections c ON c.id=d.connection_id AND c.space_id=d.space_id
    WHERE d.id=? AND d.space_id=? AND m.source='x'`).get(draftId, spaceId) as any;
  if (!draft) throw new XIntegrationError('Reply draft not found for this X account.', 404);
  if (draft.state === 'published') {
    const publication = replyPublication(spaceId, draftId);
    if (!publication) throw new XIntegrationError('This reply was posted, but its publication receipt is unavailable. Check the account on X.', 409);
    return { publication, replayed: true };
  }
  if (draft.state === 'publishing') throw new XIntegrationError('This reply is already being posted. Wait for its publication status.', 409);
  if (draft.state === 'publish_unknown') {
    throw new XIntegrationError('X did not confirm the previous publication result. Check the account on X before taking any further action.', 409);
  }
  if (!['ready', 'edited', 'publish_failed'].includes(String(draft.state))) {
    throw new XIntegrationError('Only a completed, reviewed reply draft can be posted.', 409);
  }
  const content = String(input.content || '').trim();
  if (!content || Array.from(content).length > 280) throw new XIntegrationError('The reviewed reply must contain between 1 and 280 characters.');
  if (!draft.external_id) throw new XIntegrationError('The saved X post has no provider identifier and cannot be replied to.', 409);
  if (draft.connection_status !== 'connected') throw new XIntegrationError('Reconnect this X account before posting replies.', 409);
  const scopes = parseJson<string[]>(draft.scopes_json, []);
  if (!scopes.includes('tweet.write')) throw new XIntegrationError('Reconnect this X account to grant the tweet.write permission before posting replies.', 409);

  const timestamp = now();
  const claimed = db.prepare(`UPDATE social_reply_drafts SET content=?,state='publishing',error=NULL,updated_at=?
    WHERE id=? AND space_id=? AND state IN ('ready','edited','publish_failed')`).run(content, timestamp, draftId, spaceId).changes;
  if (!claimed) throw new XIntegrationError('This reply draft changed before it could be posted. Refresh and review its status.', 409);
  const auditBase = {
    user, spaceId, draftId, requestId: input.requestId, ipAddress: input.ipAddress, userAgent: input.userAgent,
    before: { state: draft.state, connectionId: draft.connection_id, sourceTweetId: draft.external_id, contentSha256: sha256(content) }
  };
  let postStarted = false;
  try {
    const connection = spaceOwnsConnection(spaceId, draft.connection_id); const app = getApp();
    if (!app) throw new XIntegrationError('The X developer app is not configured.', 409);
    const auth = await connectionDataAuth(connection, app);
    postStarted = true;
    const posted = await postXJson<{ data?: { id?: string; text?: string } }>({
      path: '/2/tweets', body: { text: content, reply: { in_reply_to_tweet_id: String(draft.external_id) } }, ...auth
    });
    const tweetId = String(posted.data.data?.id || '').trim();
    if (!tweetId) throw new XApiError('X accepted the request but did not return a reply identifier. Check the account on X before retrying.', 502, 'provider');
    const url = draft.username ? `https://x.com/${encodeURIComponent(String(draft.username))}/status/${encodeURIComponent(tweetId)}`
      : `https://x.com/i/web/status/${encodeURIComponent(tweetId)}`;
    db.transaction(() => {
      const updated = db.prepare("UPDATE social_reply_drafts SET state='published',error=NULL,updated_at=? WHERE id=? AND space_id=? AND state='publishing'")
        .run(now(), draftId, spaceId).changes;
      if (!updated) throw new Error('The reply publication state changed unexpectedly.');
      recordReplyPublicationAudit({ ...auditBase, action: 'social_reply.published', after: {
        state: 'published', tweetId, url, postedBy: user.id, connectionId: draft.connection_id,
        sourceTweetId: draft.external_id, contentSha256: sha256(content)
      } });
    })();
    publishEvent('data-changed', { reason: 'social-reply-published', draftId, tweetId }, spaceId);
    return { publication: replyPublication(spaceId, draftId), replayed: false };
  } catch (error) {
    const xError = error instanceof XApiError ? error : null;
    const ambiguous = postStarted && Boolean(xError && (xError.code === 'network' || xError.status >= 500));
    const state = ambiguous ? 'publish_unknown' : 'publish_failed';
    const message = ambiguous
      ? 'X did not confirm whether the reply was posted. Check the account on X before taking any further action.'
      : error instanceof Error ? error.message : 'X could not publish this reply.';
    db.transaction(() => {
      db.prepare("UPDATE social_reply_drafts SET state=?,error=?,updated_at=? WHERE id=? AND space_id=? AND state='publishing'")
        .run(state, message.slice(0, 1000), now(), draftId, spaceId);
      recordReplyPublicationAudit({ ...auditBase, action: ambiguous ? 'social_reply.publication_unknown' : 'social_reply.publication_failed',
        reason: message, after: { state, providerCode: xError?.code || null, providerStatus: xError?.status || null } });
    })();
    publishEvent('data-changed', { reason: `social-reply-${state}`, draftId }, spaceId);
    const responseStatus = error instanceof XIntegrationError ? error.status
      : xError?.status && xError.status < 500 ? xError.status : 502;
    throw new XIntegrationError(message, ambiguous ? 409 : responseStatus);
  }
}
async function fetchPostPage(input: {
  path: string; parameters: Record<string, string | null | undefined>; auth: XDataAuth;
  maximumResults: number; onRequest?: () => void; assertCurrent?: () => void;
}) {
  input.onRequest?.();
  const result = await getXJson<XPostPage>({ path: apiPath(input.path, {
    ...input.parameters, max_results: String(input.maximumResults)
  }), ...input.auth });
  input.assertCurrent?.();
  const posts = (result.data.data || []).slice(0, input.maximumResults);
  return { posts, users: result.data.includes?.users || [],
    newestId: greatestId([result.data.meta?.newest_id, ...posts.map((post) => post.id)]),
    nextToken: result.data.meta?.next_token || null, rate: result.rate };
}
function retryTime(attempt: number) { return new Date(Date.now() + Math.min(60, 2 ** Math.max(0, attempt - 1)) * 60_000).toISOString(); }
function nextSchedule(connection: XConnectionRow) { return connection.auto_sync && connection.status === 'connected' ? new Date(Date.now() + Number(connection.sync_interval_minutes) * 60_000).toISOString() : null; }
function syncProgress(jobId: string, stage: string, progress: number, _counts: { posts?: number; mentions?: number; search?: number } = {}) {
  // Counts are checkpointed only with the corresponding endpoint cursor. This
  // keeps retry telemetry exact; stage/progress still stream after every page.
  db.prepare('UPDATE x_sync_jobs SET stage=?,progress=?,updated_at=? WHERE id=?').run(stage, progress, now(), jobId);
  const row = db.prepare(`SELECT c.space_id FROM x_sync_jobs j JOIN x_connections c ON c.id=j.connection_id WHERE j.id=?`).get(jobId) as { space_id: string } | undefined;
  if (row) publishEvent('data-changed', { reason: 'x-sync-progress', jobId, stage, progress }, row.space_id);
}

function recordProviderRequest(jobId: string) {
  db.prepare('UPDATE x_sync_jobs SET provider_requests=provider_requests+1,updated_at=? WHERE id=?').run(now(), jobId);
}

function recordTargetProviderRequest(jobId: string, targetKey: string) {
  const timestamp = now();
  db.transaction(() => {
    db.prepare('UPDATE x_sync_jobs SET provider_requests=provider_requests+1,updated_at=? WHERE id=?').run(timestamp, jobId);
    db.prepare('UPDATE x_sync_target_checkpoints SET page_requests=page_requests+1,updated_at=? WHERE job_id=? AND target_key=?')
      .run(timestamp, jobId, targetKey);
  })();
}

type XTargetCheckpoint = {
  job_id: string; target_key: string; target_order: number; stream: XCollectionStream; query_id: string | null;
  query_text: string | null; query_updated_at: string | null; query_version: number | null; budget: number; fetched_count: number; state: string;
  pagination_token: string | null; start_since_id: string | null; start_until_id: string | null;
  target_newest_id: string | null; last_low_id: string | null; token_fallback_used: number;
  empty_page_hops: number; page_requests: number; has_more: number;
};

function targetCheckpoints(jobId: string) {
  return db.prepare('SELECT * FROM x_sync_target_checkpoints WHERE job_id=? ORDER BY target_order').all(jobId) as XTargetCheckpoint[];
}

function insertTargetCheckpointRows(jobId: string, connection: XConnectionRow, mode: 'incremental' | 'expansion', plan: XCollectionPlan, timestamp: string) {
  for (const [index, target] of plan.targets.entries()) {
    const key = target.query ? `query:${target.query.id}` : target.stream;
    let paginationToken: string | null = null; let startSince: string | null = null;
    let startUntil: string | null = null; let targetNewest: string | null = null; let lastLow: string | null = null;
    if (mode === 'incremental') {
      if (target.stream === 'account_posts') {
        paginationToken = connection.post_backlog_token; startSince = connection.post_backlog_since_id ?? connection.last_post_id;
        targetNewest = connection.post_backlog_newest_id; lastLow = connection.post_backlog_low_id;
      } else if (target.stream === 'mentions') {
        paginationToken = connection.mention_backlog_token; startSince = connection.mention_backlog_since_id ?? connection.last_mention_id;
        targetNewest = connection.mention_backlog_newest_id; lastLow = connection.mention_backlog_low_id;
      } else {
        paginationToken = target.query!.backlog_token; startSince = target.query!.backlog_since_id ?? target.query!.since_id;
        targetNewest = target.query!.backlog_newest_id; lastLow = target.query!.backlog_low_id;
      }
    } else {
      startUntil = target.stream === 'account_posts' ? connection.oldest_post_id
        : target.stream === 'mentions' ? connection.oldest_mention_id : target.query!.oldest_id;
    }
    db.prepare(`INSERT INTO x_sync_target_checkpoints
        (job_id,target_key,target_order,stream,query_id,query_text,query_updated_at,query_version,budget,fetched_count,state,pagination_token,
         start_since_id,start_until_id,target_newest_id,last_low_id,token_fallback_used,has_more,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,0,'queued',?,?,?,?,?,0,0,?,?)`).run(
      jobId, key, index, target.stream, target.query?.id || null, target.query?.query || null, target.query?.updated_at || null,
      target.query?.configuration_version || null, target.budget, paginationToken, startSince, startUntil, targetNewest, lastLow, timestamp, timestamp);
  }
}

function initializeTargetCheckpoints(job: any, connection: XConnectionRow, mode: 'incremental' | 'expansion', requestedLimit: number, streams: XCollectionStream[]) {
  const existing = targetCheckpoints(job.id); if (existing.length) return existing;
  const plan = collectionPlan(connection, requestedLimit, streams, mode); const timestamp = now();
  db.transaction(() => {
    insertTargetCheckpointRows(job.id, connection, mode, plan, timestamp);
    db.prepare(`UPDATE x_sync_jobs SET requested_limit=?,maximum_posts_read=?,streams_json=?,deferred_search_queries=?,
      selected_query_ids_json=?,updated_at=? WHERE id=?`).run(requestedLimit, plan.maximumPostsRead, JSON.stringify(streams),
      plan.deferredQueryIds.length, JSON.stringify(plan.selectedQueryIds), timestamp, job.id);
  })();
  return targetCheckpoints(job.id);
}

function endpointUntilBoundary(stream: XCollectionStream, boundary: string | null) {
  return stream === 'searches' ? boundary : previousId(boundary);
}

function clearExpiredPagination(checkpoint: XTargetCheckpoint, mode: 'incremental' | 'expansion') {
  const timestamp = now();
  db.transaction(() => {
    db.prepare("UPDATE x_sync_target_checkpoints SET pagination_token=NULL,token_fallback_used=1,state='queued',updated_at=? WHERE job_id=? AND target_key=?")
      .run(timestamp, checkpoint.job_id, checkpoint.target_key);
    if (mode !== 'incremental') return;
    if (checkpoint.stream === 'account_posts') db.prepare('UPDATE x_connections SET post_backlog_token=NULL,updated_at=? WHERE id=(SELECT connection_id FROM x_sync_jobs WHERE id=?)')
      .run(timestamp, checkpoint.job_id);
    else if (checkpoint.stream === 'mentions') db.prepare('UPDATE x_connections SET mention_backlog_token=NULL,updated_at=? WHERE id=(SELECT connection_id FROM x_sync_jobs WHERE id=?)')
      .run(timestamp, checkpoint.job_id);
    else db.prepare('UPDATE x_listening_queries SET backlog_token=NULL,updated_at=? WHERE id=?').run(timestamp, checkpoint.query_id);
  })();
}

async function executeSyncJob(job: any) {
  let connection: XConnectionRow | undefined;
  const rates: Record<string, XRateLimit> = {};
  try {
    connection = db.prepare('SELECT * FROM x_connections WHERE id=?').get(job.connection_id) as XConnectionRow | undefined;
    if (!connection) return;
    const app = getApp();
    if (!app) throw new XIntegrationError('X app configuration is missing.', 409);
    const syncGeneration = Number(connection.generation); const appCredentialVersion = Number(app.credential_version);
    assertSyncGeneration(connection.id, syncGeneration, appCredentialVersion);
    const oauthCredentials = await connectionDataAuth(connection, app);
    syncProgress(job.id, connection.x_user_id ? 'planning_collection' : 'verifying_account', 10);
    // OAuth connection already verifies and stores the account identity. Reuse
    // that cache on every ordinary sync instead of paying for /users/me again;
    // legacy static credentials are verified once and then follow the same path.
    let profile: { id?: string; username?: string; name?: string; profile_image_url?: string } | undefined = connection.x_user_id
      ? { id: connection.x_user_id, username: connection.username || undefined, name: connection.display_name || undefined, profile_image_url: connection.profile_image_url || undefined }
      : undefined;
    if (!profile?.id || !profile.username) {
      recordProviderRequest(job.id);
      const profileResult = await getXJson<{ data?: { id?: string; username?: string; name?: string; profile_image_url?: string } }>({
        path: '/2/users/me?user.fields=id,name,username,profile_image_url', ...oauthCredentials
      });
      assertSyncGeneration(connection.id, syncGeneration, appCredentialVersion);
      rates.profile = profileResult.rate; profile = profileResult.data.data;
    }
    if (!profile?.id || !profile.username || connection.x_user_id && connection.x_user_id !== profile.id) throw new XApiError('The connected X account identity changed. Reconnect the account.', 401, 'authentication');
    const timestamp = now();
    db.prepare(`UPDATE x_connections SET x_user_id=?,username=?,display_name=?,profile_image_url=?,status='connected',last_error=NULL,last_sync_at=?,updated_at=? WHERE id=?`)
      .run(profile.id, profile.username, profile.name || profile.username, profile.profile_image_url || null, timestamp, timestamp, connection.id);
    const refreshed = db.prepare('SELECT * FROM x_connections WHERE id=?').get(connection.id) as XConnectionRow;
    const mode = job.trigger_type === 'expansion' ? 'expansion' as const : 'incremental' as const;
    const requestedLimit = mode === 'expansion'
      ? Math.max(minimumExpansionLimit, Math.min(maximumExpansionLimit, Number(job.requested_limit || minimumExpansionLimit)))
      : normalSyncLimit;
    const streams = parseCollectionStreams(job.streams_json);
    const checkpoints = initializeTargetCheckpoints(job, refreshed, mode, requestedLimit, streams);
    const queryOutcomes: Array<{ id: string; cursor: string | null; error: string | null; successful: boolean }> = [];
    const persistedCounts = db.prepare('SELECT posts_fetched,mentions_fetched,search_fetched FROM x_sync_jobs WHERE id=?').get(job.id) as any;
    const fetched = { posts: Number(persistedCounts.posts_fetched), mentions: Number(persistedCounts.mentions_fetched), search: Number(persistedCounts.search_fetched) };
    for (let index = 0; index < checkpoints.length; index += 1) {
      let checkpoint = (db.prepare('SELECT * FROM x_sync_target_checkpoints WHERE job_id=? AND target_key=?').get(job.id, checkpoints[index].target_key) as XTargetCheckpoint);
      if (checkpoint.state === 'completed' || checkpoint.state === 'skipped') continue;
      const progress = 18 + Math.floor((index / Math.max(1, checkpoints.length)) * 66);
      const stage = checkpoint.stream === 'account_posts' ? 'fetching_posts' : checkpoint.stream === 'mentions' ? 'fetching_mentions' : 'running_searches';
      syncProgress(job.id, stage, progress, fetched);
      try {
        const searchAuth: XDataAuth | null = checkpoint.stream !== 'searches' || connection.auth_type === 'oauth2'
          ? oauthCredentials : appBearerToken(app) ? { bearerToken: appBearerToken(app)! } : null;
        if (!searchAuth) throw new XApiError('A bearer token is required for recent search.', 403, 'permission');
        const minimumPageSize = checkpoint.stream === 'searches' ? 10 : 5;
        while (checkpoint.state !== 'completed' && checkpoint.state !== 'skipped') {
          const remaining = Number(checkpoint.budget) - Number(checkpoint.fetched_count);
          if (remaining < minimumPageSize) {
            db.prepare("UPDATE x_sync_target_checkpoints SET state='completed',completed_at=?,updated_at=? WHERE job_id=? AND target_key=?")
              .run(now(), now(), job.id, checkpoint.target_key);
            break;
          }
          const maximumTargetRequests = Math.ceil(Number(checkpoint.budget) / minimumPageSize) + maximumEmptyPageHops + 2;
          if (Number(checkpoint.page_requests) >= maximumTargetRequests) {
            throw new XIntegrationError('X pagination exceeded the safe per-target request limit. Start a new sync to continue from the last committed cursor.', 502);
          }
          const path = checkpoint.stream === 'account_posts' ? `/2/users/${profile.id}/tweets`
            : checkpoint.stream === 'mentions' ? `/2/users/${profile.id}/mentions` : '/2/tweets/search/recent';
          const fallbackBoundary = checkpoint.pagination_token ? null : checkpoint.last_low_id;
          const assertQueryCurrent = checkpoint.query_id ? () => {
            const current = db.prepare('SELECT query,configuration_version,enabled FROM x_listening_queries WHERE id=? AND connection_id=?')
              .get(checkpoint.query_id, connection!.id) as { query: string; configuration_version: number; enabled: number } | undefined;
            if (!current || !current.enabled || current.query !== checkpoint.query_text
              || Number(current.configuration_version) !== Number(checkpoint.query_version)) throw new XQueryChangedError();
          } : undefined;
          // Check immediately before every billable call. The post-response
          // check remains as the second half of the optimistic concurrency
          // guard in case a query changes while X is serving the page.
          assertSyncGeneration(connection.id, syncGeneration, appCredentialVersion);
          assertQueryCurrent?.();
          let result;
          try {
            result = await fetchPostPage({ path, maximumResults: Math.min(100, remaining), parameters: {
              query: checkpoint.query_text, since_id: mode === 'incremental' ? checkpoint.start_since_id : null,
              until_id: fallbackBoundary ? endpointUntilBoundary(checkpoint.stream, fallbackBoundary)
                : mode === 'expansion' ? endpointUntilBoundary(checkpoint.stream, checkpoint.start_until_id) : null,
              pagination_token: checkpoint.pagination_token, exclude: checkpoint.stream === 'account_posts' ? 'retweets' : null,
              'tweet.fields': 'id,text,created_at,lang,author_id,public_metrics,note_tweet', expansions: 'author_id', 'user.fields': 'id,name,username,profile_image_url'
            }, auth: searchAuth, assertCurrent: () => assertSyncGeneration(connection!.id, syncGeneration, appCredentialVersion),
              onRequest: () => recordTargetProviderRequest(job.id, checkpoint.target_key) });
          } catch (error) {
            // X pagination tokens are opaque and can expire. Once only, drop an
            // invalid token and continue below the last committed low boundary;
            // this avoids both a permanent gap and replaying the first page.
            if (checkpoint.pagination_token && !checkpoint.token_fallback_used
              && error instanceof XApiError && error.code === 'provider' && error.status === 400) {
              clearExpiredPagination(checkpoint, mode);
              checkpoint = db.prepare('SELECT * FROM x_sync_target_checkpoints WHERE job_id=? AND target_key=?').get(job.id, checkpoint.target_key) as XTargetCheckpoint;
              continue;
            }
            throw error;
          }
          assertSyncGeneration(connection.id, syncGeneration, appCredentialVersion);
          const found = result.posts; const resultIds = found.map((post) => post.id); const pageCompletedAt = now();
          if (result.nextToken && result.nextToken === checkpoint.pagination_token) {
            if (!checkpoint.token_fallback_used) {
              clearExpiredPagination(checkpoint, mode);
              checkpoint = db.prepare('SELECT * FROM x_sync_target_checkpoints WHERE job_id=? AND target_key=?').get(job.id, checkpoint.target_key) as XTargetCheckpoint;
              continue;
            }
            throw new XIntegrationError('X returned a repeating pagination token. Start a new sync to continue from the last committed cursor.', 502);
          }
          const nextFetched = Number(checkpoint.fetched_count) + found.length;
          const nextNewest = greatestId([checkpoint.target_newest_id, result.newestId, ...resultIds]);
          const nextLow = lowestId([checkpoint.last_low_id, ...resultIds]); const hasMore = Boolean(result.nextToken);
          const nextEmptyPageHops = found.length ? 0 : Number(checkpoint.empty_page_hops || 0) + 1;
          if (hasMore && !found.length && nextEmptyPageHops > maximumEmptyPageHops) {
            throw new XIntegrationError('X returned too many empty pagination pages. Start a new sync to continue safely.', 502);
          }
          const canContinue = hasMore && Number(checkpoint.budget) - nextFetched >= minimumPageSize;
          const nextState = canContinue ? 'processing' : 'completed';
          if (result.rate) rates[checkpoint.query_id ? `search:${checkpoint.query_id}` : checkpoint.stream] = result.rate;
          const savedBatch = persistCollectedBatch({ connection: refreshed,
            collected: found.map((post) => ({ post,
              stream: checkpoint.stream === 'account_posts' ? 'account_post' as const : checkpoint.stream === 'mentions' ? 'mention' as const : 'search' as const,
              queryId: checkpoint.query_id || undefined, users: result.users })),
            jobId: job.id, generation: syncGeneration, credentialVersion: appCredentialVersion, autoAnalyze: mode === 'incremental',
            assertBatchCurrent: assertQueryCurrent,
            afterPersist: () => {
              if (checkpoint.stream === 'account_posts') {
                const current = db.prepare('SELECT last_post_id,oldest_post_id,post_history_exhausted FROM x_connections WHERE id=?').get(connection!.id) as any;
                const highWater = mode === 'incremental' && !hasMore ? greatestId([current.last_post_id, nextNewest])
                  : mode === 'expansion' && !current.last_post_id ? nextNewest : current.last_post_id;
                db.prepare(`UPDATE x_connections SET last_post_id=?,oldest_post_id=?,post_backlog_token=?,post_backlog_since_id=?,
                  post_backlog_newest_id=?,post_backlog_low_id=?,post_history_exhausted=?,updated_at=? WHERE id=?`).run(
                  highWater, lowestId([current.oldest_post_id, ...resultIds]), mode === 'incremental' && hasMore ? result.nextToken : null,
                  mode === 'incremental' && hasMore ? checkpoint.start_since_id : null, mode === 'incremental' && hasMore ? nextNewest : null,
                  mode === 'incremental' && hasMore ? nextLow : null,
                  mode === 'expansion' ? hasMore ? 0 : 1 : current.post_history_exhausted, pageCompletedAt, connection!.id);
              } else if (checkpoint.stream === 'mentions') {
                const current = db.prepare('SELECT last_mention_id,oldest_mention_id,mention_history_exhausted FROM x_connections WHERE id=?').get(connection!.id) as any;
                const highWater = mode === 'incremental' && !hasMore ? greatestId([current.last_mention_id, nextNewest])
                  : mode === 'expansion' && !current.last_mention_id ? nextNewest : current.last_mention_id;
                db.prepare(`UPDATE x_connections SET last_mention_id=?,oldest_mention_id=?,mention_backlog_token=?,mention_backlog_since_id=?,
                  mention_backlog_newest_id=?,mention_backlog_low_id=?,mention_history_exhausted=?,updated_at=? WHERE id=?`).run(
                  highWater, lowestId([current.oldest_mention_id, ...resultIds]), mode === 'incremental' && hasMore ? result.nextToken : null,
                  mode === 'incremental' && hasMore ? checkpoint.start_since_id : null, mode === 'incremental' && hasMore ? nextNewest : null,
                  mode === 'incremental' && hasMore ? nextLow : null,
                  mode === 'expansion' ? hasMore ? 0 : 1 : current.mention_history_exhausted, pageCompletedAt, connection!.id);
              } else {
                const current = db.prepare('SELECT since_id,oldest_id,history_exhausted FROM x_listening_queries WHERE id=? AND connection_id=?').get(checkpoint.query_id, connection!.id) as any;
                const highWater = mode === 'incremental' && !hasMore ? greatestId([current.since_id, nextNewest])
                  : mode === 'expansion' && !current.since_id ? nextNewest : current.since_id;
                db.prepare(`UPDATE x_listening_queries SET since_id=?,oldest_id=?,backlog_token=?,backlog_since_id=?,backlog_newest_id=?,backlog_low_id=?,
                  history_exhausted=?,last_sync_at=?,last_success_at=?,last_error=NULL,updated_at=? WHERE id=? AND connection_id=?`).run(
                  highWater, lowestId([current.oldest_id, ...resultIds]), mode === 'incremental' && hasMore ? result.nextToken : null,
                  mode === 'incremental' && hasMore ? checkpoint.start_since_id : null, mode === 'incremental' && hasMore ? nextNewest : null,
                  mode === 'incremental' && hasMore ? nextLow : null,
                  mode === 'expansion' ? hasMore ? 0 : 1 : current.history_exhausted,
                  pageCompletedAt, pageCompletedAt, pageCompletedAt, checkpoint.query_id, connection!.id);
              }
              const countColumn = checkpoint.stream === 'account_posts' ? 'posts_fetched' : checkpoint.stream === 'mentions' ? 'mentions_fetched' : 'search_fetched';
              db.prepare(`UPDATE x_sync_jobs SET ${countColumn}=${countColumn}+?,updated_at=? WHERE id=?`).run(found.length, pageCompletedAt, job.id);
              db.prepare(`UPDATE x_sync_target_checkpoints SET fetched_count=?,state=?,pagination_token=?,target_newest_id=?,last_low_id=?,
                empty_page_hops=?,has_more=?,completed_at=?,updated_at=? WHERE job_id=? AND target_key=?`).run(nextFetched, nextState, result.nextToken,
                nextNewest, nextLow, nextEmptyPageHops, hasMore ? 1 : 0, nextState === 'completed' ? pageCompletedAt : null, pageCompletedAt, job.id, checkpoint.target_key);
            } });
          dispatchAnalysisJobs(savedBatch.analysisJobs);
          if (checkpoint.stream === 'account_posts') fetched.posts += found.length;
          else if (checkpoint.stream === 'mentions') fetched.mentions += found.length;
          else fetched.search += found.length;
          checkpoint = db.prepare('SELECT * FROM x_sync_target_checkpoints WHERE job_id=? AND target_key=?').get(job.id, checkpoint.target_key) as XTargetCheckpoint;
          syncProgress(job.id, stage, Math.min(86, progress + 1), fetched);
        }
      } catch (error) {
        if (error instanceof XSyncCancelledError) throw error;
        if (!(error instanceof XQueryChangedError) && !(error instanceof XApiError)) throw error;
        if (!checkpoint.query_id) throw error;
        const message = error instanceof Error ? error.message : 'Search failed.';
        queryOutcomes.push({ id: checkpoint.query_id, cursor: checkpoint.start_since_id, error: message.slice(0, 500), successful: false });
        if (error instanceof XApiError && (error.code === 'rate_limit' || error.retryable)) throw error;
        if (error instanceof XApiError && ['authentication', 'billing', 'permission'].includes(error.code)) throw error;
        db.prepare("UPDATE x_sync_target_checkpoints SET state='skipped',completed_at=?,updated_at=? WHERE job_id=? AND target_key=?")
          .run(now(), now(), job.id, checkpoint.target_key);
      }
    }

    syncProgress(job.id, 'finalizing', 90, fetched);
    const completedAt = now();
    const saved = db.transaction(() => {
      assertSyncGeneration(connection!.id, syncGeneration, appCredentialVersion);
      const latestConnection = db.prepare('SELECT * FROM x_connections WHERE id=?').get(connection!.id) as XConnectionRow;
      for (const outcome of queryOutcomes) {
        if (!outcome.successful) db.prepare('UPDATE x_listening_queries SET last_sync_at=?,last_error=?,updated_at=? WHERE id=? AND connection_id=?')
          .run(completedAt, outcome.error, completedAt, outcome.id, connection!.id);
      }
      db.prepare(`UPDATE x_connections SET last_sync_at=?,last_success_at=?,last_error=NULL,rate_limit_json=?,next_sync_at=?,status='connected',updated_at=? WHERE id=?`)
        .run(completedAt, completedAt, JSON.stringify(rates), nextSchedule({ ...latestConnection, status: 'connected' }), completedAt, connection!.id);
      const hasMore = Boolean(db.prepare("SELECT 1 FROM x_sync_target_checkpoints WHERE job_id=? AND state='completed' AND has_more=1 LIMIT 1").get(job.id));
      db.prepare(`UPDATE x_sync_jobs SET state='completed',stage='completed',progress=100,has_more=?,error=NULL,run_after=NULL,completed_at=?,updated_at=? WHERE id=?`)
        .run(hasMore ? 1 : 0, completedAt, completedAt, job.id);
      db.prepare("UPDATE x_apps SET billing_status='ready',billing_problem_type=NULL,billing_checked_at=?,updated_at=? WHERE id=?")
        .run(completedAt, completedAt, appId);
      db.prepare(`UPDATE x_sync_jobs SET state='queued',stage='credits_restored',error=NULL,run_after=NULL,updated_at=?
        WHERE state='waiting_billing' AND id<>?`).run(completedAt, job.id);
      const completed = db.prepare('SELECT imported_count FROM x_sync_jobs WHERE id=?').get(job.id) as { imported_count: number };
      return { importedCount: Number(completed.imported_count) };
    })();
    publishEvent('data-changed', { reason: 'x-sync-completed', jobId: job.id, importedCount: saved.importedCount }, connection.space_id);
  } catch (error) {
    if (error instanceof XSyncCancelledError) {
      const timestamp = now();
      db.prepare("UPDATE x_sync_jobs SET state='cancelled',stage='cancelled',error=?,run_after=NULL,completed_at=?,updated_at=? WHERE id=?")
        .run(error.message, timestamp, timestamp, job.id);
      if (connection) publishEvent('data-changed', { reason: 'x-sync-state-changed', jobId: job.id, state: 'cancelled', stage: 'cancelled' }, connection.space_id);
      return;
    }
    const apiError = error instanceof XApiError ? error
      : error instanceof XIntegrationError ? new XApiError(error.message, error.status, 'provider')
        : new XApiError('X synchronisation failed.', 500, 'provider', true);
    const timestamp = now(); const attempt = Number(job.attempt || 1); const wasCreditProbe = Boolean(job.credit_probe);
    let state = 'failed'; let stage: string = apiError.code; let runAfter: string | null = null; let completedAt: string | null = timestamp;
    if (apiError.code === 'rate_limit') { state = 'waiting_rate_limit'; stage = 'waiting_rate_limit'; runAfter = apiError.retryAt || new Date(Date.now() + 15 * 60_000).toISOString(); completedAt = null; }
    else if (apiError.code === 'billing') { state = 'waiting_billing'; stage = 'credits_required'; completedAt = null; }
    else if (apiError.retryable && attempt < 5) { state = 'queued'; stage = 'retrying'; runAfter = retryTime(attempt); completedAt = null; }
    db.prepare('UPDATE x_sync_jobs SET state=?,stage=?,error=?,run_after=?,completed_at=?,updated_at=? WHERE id=?')
      .run(state, stage, apiError.message.slice(0, 500), runAfter, completedAt, timestamp, job.id);
    if (connection) {
      const connectionStatus = apiError.code === 'authentication' ? 'reauthorization_required' : apiError.code === 'billing' || apiError.code === 'permission' ? 'action_required' : connection.status;
      // Billing is an app-wide dispatch pause, not an account preference. Keep
      // the user's auto-sync choice so a successful probe can resume its cadence.
      const pauseAutomatic = ['authentication', 'permission'].includes(apiError.code);
      db.prepare('UPDATE x_connections SET status=?,auto_sync=?,last_sync_at=?,last_error=?,next_sync_at=?,updated_at=? WHERE id=?')
        .run(connectionStatus, pauseAutomatic ? 0 : connection.auto_sync, timestamp, apiError.message.slice(0, 500),
          pauseAutomatic ? null : nextSchedule(connection), timestamp, connection.id);
    }
    if (apiError.code === 'billing') db.transaction(() => {
      db.prepare("UPDATE x_apps SET billing_status='credits_depleted',billing_problem_type=?,billing_checked_at=?,updated_at=? WHERE id=?")
        .run(apiError.problemType || 'credits-depleted', timestamp, timestamp, appId);
      db.prepare(`UPDATE x_sync_jobs SET state='waiting_billing',stage='credits_required',error=?,run_after=NULL,completed_at=NULL,updated_at=?
        WHERE id<>? AND state IN ('queued','waiting_rate_limit')`).run(apiError.message.slice(0, 500), timestamp, job.id);
    })();
    else if (wasCreditProbe && completedAt) {
      // A terminal authentication/provider failure did not prove that credits
      // are available. Keep every other account durably blocked and allow a
      // later manual retry from this or another valid connection.
      db.prepare(`UPDATE x_apps SET billing_status='credits_depleted',billing_checked_at=?,updated_at=?
        WHERE id=? AND billing_status='checking_credits'`).run(timestamp, timestamp, appId);
    }
    if (connection) publishEvent('data-changed', { reason: 'x-sync-state-changed', jobId: job.id, state, stage }, connection.space_id);
  }
}

const claimNextSync = db.transaction(() => {
  const timestamp = now();
  const billingStatus = getApp()?.billing_status || 'unknown';
  if (billingStatus === 'credits_depleted') return null;
  const lock = db.provider === 'postgres' ? ' FOR UPDATE SKIP LOCKED' : '';
  const row = db.prepare(`SELECT * FROM x_sync_jobs WHERE state IN ('queued','waiting_rate_limit') AND (run_after IS NULL OR run_after<=?)
    AND (?<>'checking_credits' OR credit_probe=1) ORDER BY created_at LIMIT 1${lock}`).get(timestamp, billingStatus) as any;
  if (!row) return null;
  const changed = db.prepare(`UPDATE x_sync_jobs SET state='processing',stage='starting',progress=5,attempt=attempt+1,run_after=NULL,started_at=COALESCE(started_at,?),updated_at=? WHERE id=? AND state IN ('queued','waiting_rate_limit')`)
    .run(timestamp, timestamp, row.id).changes;
  return changed ? db.prepare('SELECT * FROM x_sync_jobs WHERE id=?').get(row.id) as any : null;
});

function enqueueForConnection(connection: XConnectionRow, trigger: 'manual' | 'scheduled', creditProbe = false) {
  const existing = db.prepare(`SELECT * FROM x_sync_jobs WHERE connection_id=? AND state IN ('queued','processing','waiting_rate_limit','waiting_billing') ORDER BY created_at LIMIT 1`).get(connection.id) as any;
  if (existing) return { job: rowSyncJob(existing), created: false };
  const id = crypto.randomUUID(); const timestamp = now();
  const billingBlocked = ['credits_depleted', 'checking_credits'].includes(getApp()?.billing_status || '') && !creditProbe;
  db.prepare(`INSERT INTO x_sync_jobs (id,connection_id,trigger_type,state,stage,progress,attempt,credit_probe,requested_limit,streams_json,maximum_posts_read,error,created_at,updated_at)
    VALUES (?,?,?,?,?,0,0,?,50,?,50,?,?,?)`)
    .run(id, connection.id, trigger, billingBlocked ? 'waiting_billing' : 'queued', billingBlocked ? 'credits_required' : creditProbe ? 'checking_credits' : 'queued',
      creditProbe ? 1 : 0, JSON.stringify(collectionStreams),
      billingBlocked ? 'X API credits are depleted. Add credits in the X Developer Console, then retry this sync.' : null, timestamp, timestamp);
  const job = db.prepare('SELECT * FROM x_sync_jobs WHERE id=?').get(id) as any;
  publishEvent('data-changed', { reason: 'x-sync-queued', jobId: id }, connection.space_id);
  return { job: rowSyncJob(job), created: true };
}

export function enqueueXExpansion(_user: SessionUser, spaceId: string, connectionId: string, input: {
  limit: number; streams: XCollectionStream[]; planFingerprint: string; idempotencyKey?: string;
}) {
  const connection = spaceOwnsConnection(spaceId, connectionId);
  requireSpaceXManager(_user, spaceId, 'load paid X history');
  if (!input.idempotencyKey) throw new XIntegrationError('An Idempotency-Key header is required when loading more X history.', 400);
  const streams = parseCollectionStreams(input.streams);
  const boundedLimit = Math.max(minimumExpansionLimit, Math.min(maximumExpansionLimit, Math.floor(input.limit)));
  // Resolve the immutable request before looking at mutable cursors or query
  // configuration. A replay must return the originally accepted plan even if
  // that plan has since exhausted history or the account was disconnected.
  const replay = db.prepare('SELECT * FROM x_sync_jobs WHERE connection_id=? AND idempotency_key=?').get(connection.id, input.idempotencyKey) as any;
  if (replay) {
    if (replay.trigger_type !== 'expansion' || Number(replay.requested_limit) !== boundedLimit
      || JSON.stringify(parseCollectionStreams(replay.streams_json)) !== JSON.stringify(streams)) {
      throw new XIntegrationError('This idempotency key was already used for a different X history request.', 409);
    }
    const storedEstimate = parseJson<any>(replay.estimate_json, null);
    if (!storedEstimate) throw new XIntegrationError('The original expansion predates immutable estimates and cannot be replayed safely.', 409);
    if (storedEstimate.planFingerprint !== input.planFingerprint) {
      throw new XIntegrationError('This expansion confirmation does not match the originally accepted estimate.', 409);
    }
    return { job: rowSyncJob(replay), created: false, estimate: storedEstimate };
  }
  if (!['connected', 'pending_verification', 'action_required'].includes(connection.status)) throw new XIntegrationError('Reconnect the X account before loading more posts.', 409);
  const created = db.transaction(() => {
    const current = spaceOwnsConnection(spaceId, connectionId);
    const active = db.prepare(`SELECT id FROM x_sync_jobs WHERE connection_id=?
      AND state IN ('queued','processing','waiting_rate_limit','waiting_billing') LIMIT 1`).get(current.id) as { id: string } | undefined;
    if (active) throw new XIntegrationError('Wait for the active X collection job before loading more history.', 409);
    const plan = collectionPlan(current, boundedLimit, streams, 'expansion');
    const estimate = expansionEstimateFromPlan(current, input.limit, boundedLimit, streams, plan, true);
    if (estimate.planFingerprint !== input.planFingerprint) {
      throw new XIntegrationError('The X collection plan changed. Refresh the cost estimate before confirming paid history.', 409);
    }
    const id = crypto.randomUUID(); const timestamp = now();
    const billingBlocked = ['credits_depleted', 'checking_credits'].includes(getApp()?.billing_status || '');
    db.prepare(`INSERT INTO x_sync_jobs
        (id,connection_id,trigger_type,state,stage,progress,attempt,credit_probe,requested_limit,streams_json,maximum_posts_read,
         deferred_search_queries,selected_query_ids_json,idempotency_key,estimate_json,error,created_at,updated_at)
      VALUES (?,?,'expansion',?,?,0,0,0,?,?,?,?,?,?,?,?,?,?)`).run(
      id, current.id, billingBlocked ? 'waiting_billing' : 'queued', billingBlocked ? 'credits_required' : 'queued',
      boundedLimit, JSON.stringify(streams), plan.maximumPostsRead, plan.deferredQueryIds.length, JSON.stringify(plan.selectedQueryIds),
      input.idempotencyKey, JSON.stringify(estimate),
      billingBlocked ? 'X API credits are depleted. Add credits in the X Developer Console, then retry this sync.' : null,
      timestamp, timestamp);
    insertTargetCheckpointRows(id, current, 'expansion', plan, timestamp);
    return { id, billingBlocked, estimate };
  })();
  const job = db.prepare('SELECT * FROM x_sync_jobs WHERE id=?').get(created.id) as any;
  publishEvent('data-changed', { reason: 'x-expansion-queued', jobId: created.id, requestedLimit: boundedLimit }, spaceId);
  if (!created.billingBlocked) void xSyncRunner.pump();
  return { job: rowSyncJob(job), created: true, estimate: created.estimate };
}

export function enqueueXSync(_user: SessionUser, spaceId: string, connectionId?: string | null) {
  requireSpaceXManager(_user, spaceId, 'run paid X synchronisation');
  const connection = connectionForSpace(spaceId, connectionId); if (!connection) throw new XIntegrationError('Connect an X account first.', 409);
  if (!['connected', 'pending_verification', 'action_required'].includes(connection.status)) throw new XIntegrationError('Reconnect the X account before synchronising.', 409);
  const active = db.prepare(`SELECT * FROM x_sync_jobs WHERE connection_id=? AND state IN ('queued','processing','waiting_rate_limit','waiting_billing') ORDER BY created_at LIMIT 1`).get(connection.id) as any;
  if (active?.state === 'waiting_billing') {
    const timestamp = now();
    const resumed = db.transaction(() => {
      if (getApp()?.billing_status === 'checking_credits') return false;
      db.prepare(`UPDATE x_sync_jobs SET credit_probe=0 WHERE credit_probe=1
        AND state IN ('queued','processing','waiting_rate_limit','waiting_billing')`).run();
      const selected = db.prepare("UPDATE x_sync_jobs SET state='queued',stage='checking_credits',credit_probe=1,error=NULL,run_after=NULL,completed_at=NULL,updated_at=? WHERE id=? AND state='waiting_billing'")
        .run(timestamp, active.id).changes;
      if (!selected) return false;
      db.prepare(`UPDATE x_sync_jobs SET state='waiting_billing',stage='credits_required',run_after=NULL,completed_at=NULL,updated_at=?
        WHERE id<>? AND state IN ('queued','waiting_rate_limit')`).run(timestamp, active.id);
      db.prepare("UPDATE x_apps SET billing_status='checking_credits',billing_checked_at=?,updated_at=? WHERE id=?").run(timestamp, timestamp, appId);
      return true;
    })();
    const queued = db.prepare('SELECT * FROM x_sync_jobs WHERE id=?').get(active.id) as any;
    if (resumed) void xSyncRunner.pump();
    return { job: rowSyncJob(queued), created: false, resumed };
  }
  if (active) return { job: rowSyncJob(active), created: false };
  const latest = db.prepare("SELECT created_at FROM x_sync_jobs WHERE connection_id=? AND trigger_type='manual' ORDER BY created_at DESC LIMIT 1").get(connection.id) as { created_at: string } | undefined;
  const elapsed = latest ? Date.now() - Date.parse(latest.created_at) : Number.POSITIVE_INFINITY;
  if (Number.isFinite(elapsed) && elapsed < manualSyncCooldownMs) {
    throw new XIntegrationError(`Wait ${Math.max(1, Math.ceil((manualSyncCooldownMs - elapsed) / 1000))} seconds before starting another manual sync.`, 429);
  }
  const result = db.transaction(() => {
    const shouldProbe = getApp()?.billing_status === 'credits_depleted';
    if (!shouldProbe) return { ...enqueueForConnection(connection, 'manual'), resumed: false };
    const timestamp = now();
    db.prepare(`UPDATE x_sync_jobs SET credit_probe=0 WHERE credit_probe=1
      AND state IN ('queued','processing','waiting_rate_limit','waiting_billing')`).run();
    const created = enqueueForConnection(connection, 'manual', true);
    if (!created.created) throw new XIntegrationError('An X sync is already active for this account.', 409);
    db.prepare(`UPDATE x_sync_jobs SET state='waiting_billing',stage='credits_required',run_after=NULL,completed_at=NULL,updated_at=?
      WHERE id<>? AND state IN ('queued','waiting_rate_limit')`).run(timestamp, created.job.id);
    db.prepare("UPDATE x_apps SET billing_status='checking_credits',billing_checked_at=?,updated_at=? WHERE id=? AND billing_status='credits_depleted'")
      .run(timestamp, timestamp, appId);
    return { ...created, resumed: true };
  })();
  void xSyncRunner.pump();
  return result;
}

export const xSyncRunner = {
  timer: null as NodeJS.Timeout | null,
  running: false,
  async pump() {
    if (this.running) return; this.running = true;
    try {
      let job;
      while ((job = claimNextSync())) {
        try { await executeSyncJob(job); }
        catch {
          // Last-resort containment for database/key failures outside the normal
          // provider boundary. Never leave a claimed row invisibly processing.
          const timestamp = now();
          try {
            db.prepare("UPDATE x_sync_jobs SET state='failed',stage='internal_error',error='The sync worker stopped unexpectedly.',completed_at=?,updated_at=? WHERE id=? AND state='processing'")
              .run(timestamp, timestamp, job.id);
            const failedConnection = db.prepare('SELECT space_id FROM x_connections WHERE id=?').get(job.connection_id) as { space_id: string } | undefined;
            if (failedConnection) publishEvent('data-changed', { reason: 'x-sync-state-changed', jobId: job.id, state: 'failed', stage: 'internal_error' }, failedConnection.space_id);
          } catch { /* database recovery will reconcile processing rows on restart */ }
        }
      }
    }
    finally { this.running = false; }
  },
  scheduleDue() {
    const due = db.prepare("SELECT * FROM x_connections WHERE auto_sync=1 AND status='connected' AND (next_sync_at IS NULL OR next_sync_at<=?)").all(now()) as XConnectionRow[];
    for (const connection of due) {
      try { enqueueForConnection(connection, 'scheduled'); }
      catch { /* another dispatcher already queued the durable job */ }
    }
    void this.pump();
  },
  start() {
    if (this.timer) return; this.scheduleDue();
    this.timer = setInterval(() => this.scheduleDue(), config.xSyncPollSeconds * 1000); this.timer.unref();
  },
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
};

export const xIntegrationTest = { stableMentionId, greatestId, executeSyncJob };
