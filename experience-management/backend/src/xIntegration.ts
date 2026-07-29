import crypto from 'node:crypto';
import fs from 'node:fs';
import type { SessionUser } from './auth.js';
import { aiJobRunner } from './aiJobs.js';
import { config } from './config.js';
import { createJob, db, listSocialMentionsByIds } from './database.js';
import { publishEvent } from './events.js';
import { decryptSecret, encryptSecret } from './secureSecrets.js';
import {
  exchangeOAuth2Code, exchangeOAuthToken, getXJson, refreshOAuth2Token, requestOAuthToken, revokeOAuth2Token,
  XApiError, type XOAuth2Token, type XRateLimit
} from './xClient.js';

const appId = 'workspace-x-app';
const oauthCookieName = 'seemplify_x_oauth';
const oauthLifetimeMs = 10 * 60_000;
const manualSyncCooldownMs = 60_000;
const allowedSyncIntervals = new Set([15, 30, 60, 180, 360, 720, 1440]);

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
  id: string; user_id: string; app_id: string; access_token_enc: string; access_token_secret_enc: string | null;
  refresh_token_enc: string | null; auth_type: 'oauth1' | 'oauth2'; scopes_json: string; token_expires_at: string | null;
  x_user_id: string | null; username: string | null; display_name: string | null; profile_image_url: string | null;
  status: string; generation: number; auto_sync: number; sync_interval_minutes: number; next_sync_at: string | null; last_sync_at: string | null;
  last_success_at: string | null; last_post_id: string | null; last_mention_id: string | null; last_error: string | null;
  rate_limit_json: string; created_at: string; updated_at: string;
};

function now() { return new Date().toISOString(); }
function sha256(value: string) { return crypto.createHash('sha256').update(value).digest('hex'); }
function safeEqual(left: string, right: string) {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function parseJson<T>(value: unknown, fallback: T): T { try { return value ? JSON.parse(String(value)) as T : fallback; } catch { return fallback; } }
function appContext(field: string) { return `x-app:${appId}:${field}:v1`; }
function connectionContext(id: string, field: string) { return `x-connection:${id}:${field}:v1`; }
function oauthContext(id: string) { return `x-oauth-request:${id}:secret:v1`; }
function callbackUrl() { return `${config.publicUrl}/api/integrations/x/callback`; }
function readOptional(path: string) { try { const value = fs.readFileSync(path, 'utf8').trim(); return value || null; } catch { return null; } }
function removeOptional(path: string) { try { fs.rmSync(path, { force: true }); } catch { /* the encrypted database copy remains authoritative */ } }
function getApp() { return db.prepare('SELECT * FROM x_apps WHERE id=?').get(appId) as XAppRow | undefined; }
function connectionsForUser(userId: string) { return db.prepare('SELECT * FROM x_connections WHERE user_id=? ORDER BY created_at').all(userId) as XConnectionRow[]; }
function connectionForUser(userId: string, connectionId?: string | null) {
  if (connectionId) return db.prepare('SELECT * FROM x_connections WHERE id=? AND user_id=?').get(connectionId, userId) as XConnectionRow | undefined;
  return db.prepare(`SELECT * FROM x_connections WHERE user_id=? ORDER BY
    CASE status WHEN 'connected' THEN 0 WHEN 'action_required' THEN 1 WHEN 'pending_verification' THEN 2 ELSE 3 END,created_at LIMIT 1`).get(userId) as XConnectionRow | undefined;
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
function userOwnsConnection(userId: string, connectionId: string) {
  const row = db.prepare('SELECT * FROM x_connections WHERE id=? AND user_id=?').get(connectionId, userId) as XConnectionRow | undefined;
  if (!row) throw new XIntegrationError('X connection not found.', 404);
  return row;
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
    lastSyncAt: row.last_sync_at, lastSuccessAt: row.last_success_at, lastError: row.last_error,
    createdAt: row.created_at, updatedAt: row.updated_at };
}
function rowSyncJob(row: any) {
  return { id: row.id, connectionId: row.connection_id, trigger: row.trigger_type, state: row.state, stage: row.stage,
    progress: Number(row.progress), attempt: Number(row.attempt), creditProbe: Boolean(row.credit_probe), runAfter: row.run_after,
    postsFetched: Number(row.posts_fetched), mentionsFetched: Number(row.mentions_fetched), searchFetched: Number(row.search_fetched),
    importedCount: Number(row.imported_count), analysisJobId: row.analysis_job_id, error: row.error,
    createdAt: row.created_at, startedAt: row.started_at, completedAt: row.completed_at, updatedAt: row.updated_at };
}
function publicConnection(row: XConnectionRow | undefined) {
  if (!row) return null;
  return {
    id: row.id, status: row.status, authType: row.auth_type, scopes: parseJson<string[]>(row.scopes_json, []), tokenExpiresAt: row.token_expires_at,
    account: row.x_user_id ? { id: row.x_user_id, username: row.username,
      name: row.display_name, profileImageUrl: row.profile_image_url } : null,
    autoSync: Boolean(row.auto_sync), syncIntervalMinutes: Number(row.sync_interval_minutes), nextSyncAt: row.next_sync_at,
    lastSyncAt: row.last_sync_at, lastSuccessAt: row.last_success_at, lastError: row.last_error,
    rateLimits: parseJson(row.rate_limit_json, {}), createdAt: row.created_at, updatedAt: row.updated_at
  };
}

export function seedXIntegrationForAdmin() {
  const user = db.prepare('SELECT id,email FROM users WHERE email=?').get(config.adminEmail) as { id: string; email: string } | undefined;
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
    if (accessToken && accessTokenSecret && !connectionForUser(user.id)) {
      const id = crypto.randomUUID();
      db.prepare(`INSERT INTO x_connections (id,user_id,app_id,access_token_enc,access_token_secret_enc,status,auto_sync,sync_interval_minutes,next_sync_at,rate_limit_json,created_at,updated_at)
        VALUES (?,?,?,?,?,'pending_verification',0,60,NULL,'{}',?,?)`).run(id, user.id, appId,
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

export function getXIntegrationStatus(user: SessionUser, selectedConnectionId?: string | null) {
  const app = getApp();
  const ownedConnections = connectionsForUser(user.id);
  const connection = selectedConnectionId
    ? ownedConnections.find((item) => item.id === selectedConnectionId) || (() => { throw new XIntegrationError('X connection not found.', 404); })()
    : connectionForUser(user.id);
  const queries = connection ? (db.prepare('SELECT * FROM x_listening_queries WHERE connection_id=? ORDER BY created_at').all(connection.id) as any[]).map(rowQuery) : [];
  const syncJobs = connection ? (db.prepare('SELECT * FROM x_sync_jobs WHERE connection_id=? ORDER BY created_at DESC LIMIT 50').all(connection.id) as any[]).map(rowSyncJob) : [];
  const counts = connection ? connectionCounts(connection.id) : { collected: 0, accountPosts: 0, mentions: 0, searchResults: 0, analyzed: 0 };
  const aggregateCounts = ownedConnections.reduce((total, item) => {
    const value = connectionCounts(item.id);
    return { collected: total.collected + value.collected, accountPosts: total.accountPosts + value.accountPosts,
      mentions: total.mentions + value.mentions, searchResults: total.searchResults + value.searchResults, analyzed: total.analyzed + value.analyzed };
  }, { collected: 0, accountPosts: 0, mentions: 0, searchResults: 0, analyzed: 0 });
  return {
    provider: 'x', callbackUrl: callbackUrl(), canManageAppCredentials: user.role === 'owner',
    app: { configured: Boolean(app?.client_id_enc && app.client_secret_enc || app?.consumer_key_enc && app.consumer_secret_enc),
      oauth2Configured: Boolean(app?.client_id_enc && app.client_secret_enc), consumerCredentialsConfigured: Boolean(app?.consumer_key_enc && app.consumer_secret_enc),
      bearerTokenConfigured: Boolean(app?.bearer_token_enc), credentialVersion: Number(app?.credential_version || 0), updatedAt: app?.updated_at || null,
      billing: { status: app?.billing_status || 'unknown', problemType: app?.billing_problem_type || null, checkedAt: app?.billing_checked_at || null } },
    connections: ownedConnections.map((item) => ({ ...publicConnection(item)!, counts: connectionCounts(item.id) })),
    selectedConnectionId: connection?.id || null, connection: publicConnection(connection), queries, syncJobs, counts, aggregateCounts
  };
}

export function saveXConfiguration(user: SessionUser, input: Record<string, unknown>) {
  if (user.role !== 'owner') throw new XIntegrationError('Workspace owner access is required.', 403);
  const current = getApp(); const timestamp = now();
  const consumerSupplied = input.consumerKey !== undefined || input.consumerSecret !== undefined;
  const clientSupplied = input.clientId !== undefined || input.clientSecret !== undefined;
  const accessSupplied = input.accessToken !== undefined || input.accessTokenSecret !== undefined;
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
  const existingUserConnections = connectionsForUser(user.id);
  if (accessSupplied && (existingUserConnections.length > 1 || existingUserConnections.some((connection) => connection.status !== 'disconnected'))) {
    throw new XIntegrationError('Static OAuth 1 account tokens cannot replace or ambiguously select a connected account. Use Add X account so each identity is authorized separately.', 409);
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
      const existing = connectionForUser(user.id); const id = existing?.id || crypto.randomUUID();
      if (existing) {
        db.prepare(`UPDATE x_connections SET app_id=?,access_token_enc=?,access_token_secret_enc=?,refresh_token_enc=NULL,auth_type='oauth1',scopes_json='[]',token_expires_at=NULL,status='pending_verification',generation=generation+1,auto_sync=0,next_sync_at=NULL,last_error=NULL,updated_at=? WHERE id=?`)
          .run(appId, encryptSecret(accessToken, connectionContext(id, 'access-token')), encryptSecret(accessTokenSecret, connectionContext(id, 'access-token-secret')), timestamp, id);
        cancelConnectionSyncs(id, 'X account credentials changed.', timestamp);
      }
      else db.prepare(`INSERT INTO x_connections (id,user_id,app_id,access_token_enc,access_token_secret_enc,status,auto_sync,sync_interval_minutes,rate_limit_json,created_at,updated_at)
        VALUES (?,?,?,?,?,'pending_verification',0,60,'{}',?,?)`).run(id, user.id, appId,
        encryptSecret(accessToken, connectionContext(id, 'access-token')), encryptSecret(accessTokenSecret, connectionContext(id, 'access-token-secret')), timestamp, timestamp);
    }
  });
  transaction(); publishEvent('data-changed', { reason: 'x-configuration-updated' });
  return getXIntegrationStatus(user);
}

export function deleteXConfiguration(user: SessionUser) {
  if (user.role !== 'owner') throw new XIntegrationError('Workspace owner access is required.', 403);
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

export function disconnectXAccount(user: SessionUser, connectionId?: string | null) {
  const connection = connectionForUser(user.id, connectionId);
  if (!connection) throw new XIntegrationError('X connection not found.', 404);
  const timestamp = now();
  // Keep the connection row as the user's durable history association, but
  // cryptographically replace the OAuth credentials so disconnect really
  // removes access. A future OAuth callback safely reuses this row.
  const revocationToken = connection.auth_type === 'oauth2' ? (() => { try { return connectionCredentials(connection).accessToken; } catch { return null; } })() : null;
  const oauth2Credentials = connection.auth_type === 'oauth2' ? (() => { try { return oauth2AppCredentials(); } catch { return null; } })() : null;
  db.transaction(() => {
    db.prepare(`UPDATE x_connections SET access_token_enc=?,access_token_secret_enc=NULL,refresh_token_enc=NULL,token_expires_at=NULL,status='disconnected',generation=generation+1,auto_sync=0,next_sync_at=NULL,
      last_error=NULL,updated_at=? WHERE id=? AND user_id=?`).run(
      encryptSecret(`revoked-${crypto.randomUUID()}`, connectionContext(connection.id, 'access-token')),
      timestamp, connection.id, user.id);
    db.prepare('UPDATE x_oauth_requests SET consumed_at=? WHERE user_id=? AND consumed_at IS NULL').run(timestamp, user.id);
    cancelConnectionSyncs(connection.id, 'X account disconnected.', timestamp);
  })();
  if (oauth2Credentials && revocationToken) void revokeOAuth2Token(oauth2Credentials, revocationToken);
  publishEvent('data-changed', { reason: 'x-account-disconnected' });
}

export function deleteXCollectedHistory(user: SessionUser, connectionId?: string | null) {
  const connection = connectionForUser(user.id, connectionId);
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
      db.prepare('DELETE FROM x_connections WHERE id=? AND user_id=?').run(connection.id, user.id);
    } else {
      db.prepare(`UPDATE x_connections SET last_post_id=NULL,last_mention_id=NULL,generation=generation+1,auto_sync=0,next_sync_at=NULL,updated_at=? WHERE id=?`)
        .run(now(), connection.id);
      for (const query of db.prepare('SELECT id FROM x_listening_queries WHERE connection_id=?').all(connection.id) as Array<{ id: string }>) {
        db.prepare('UPDATE x_listening_queries SET since_id=NULL,updated_at=? WHERE id=?').run(now(), query.id);
      }
    }
    return { unlinked: ids.length, deleted, deletedAnalysisJobs: derivedJobIds.length,
      deletedReplyDrafts: replyJobIds.length, deletedSocialReports: socialReports.length, deletedCombinedReports: combinedReports.length,
      connectionDeleted };
  });
  const result = transaction(); publishEvent('data-changed', { reason: 'x-history-deleted', ...result }); return result;
}

export function listXCollectedMentions(user: SessionUser, limit = 500, connectionId?: string | null) {
  const connection = connectionForUser(user.id, connectionId); if (!connection) return [];
  const links = db.prepare(`SELECT m.id,cm.streams_json,cm.query_ids_json FROM x_connection_mentions cm JOIN social_mentions m ON m.id=cm.mention_id
    WHERE cm.connection_id=? ORDER BY m.published_at DESC LIMIT ?`).all(connection.id, Math.max(1, Math.min(1000, Math.floor(limit)))) as Array<{ id: string; streams_json: string; query_ids_json: string }>;
  const byId = new Map(links.map((row) => [row.id, row]));
  return listSocialMentionsByIds(links.map((row) => row.id)).map((mention) => {
    const link = byId.get(mention.id); const x = (mention.metadata as any)?.x || {};
    return { ...mention, xConnectionId: connection.id, metadata: { ...mention.metadata, x: { ...x,
      streams: parseJson<string[]>(link?.streams_json, []), queryIds: parseJson<string[]>(link?.query_ids_json, []) } } };
  });
}

export function updateXConnectionSettings(user: SessionUser, input: { autoSync?: boolean; syncIntervalMinutes?: number }, connectionId?: string | null) {
  const connection = connectionForUser(user.id, connectionId);
  if (!connection) throw new XIntegrationError('Connect an X account first.', 409);
  const interval = input.syncIntervalMinutes ?? Number(connection.sync_interval_minutes);
  if (!allowedSyncIntervals.has(interval)) throw new XIntegrationError('Choose a supported synchronisation interval.');
  const enabled = input.autoSync ?? Boolean(connection.auto_sync); const timestamp = now();
  if (enabled && connection.status !== 'connected') throw new XIntegrationError('Verify or reconnect the X account before enabling automatic sync.', 409);
  const next = enabled ? new Date(Date.now() + interval * 60_000).toISOString() : null;
  db.prepare('UPDATE x_connections SET auto_sync=?,sync_interval_minutes=?,next_sync_at=?,updated_at=? WHERE id=? AND user_id=?')
    .run(enabled ? 1 : 0, interval, next, timestamp, connection.id, user.id);
  publishEvent('data-changed', { reason: 'x-sync-settings-updated' });
  return publicConnection(connectionForUser(user.id, connection.id));
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

function connectionMutationSnapshot(userId: string) {
  return connectionsForUser(userId).map((row) => `${row.id}:${row.generation}:${row.status}`).sort();
}

function connectionSnapshotUnchanged(userId: string, snapshot: string[]) {
  const current = new Set(connectionMutationSnapshot(userId));
  // New rows are allowed so separate OAuth windows can add different accounts
  // concurrently. Any mutation/removal of a row that existed when exchange
  // began invalidates the callback (for example, disconnect during exchange).
  return snapshot.every((entry) => current.has(entry));
}

function oauthRequestCleanup(timestamp: string) {
  db.prepare('DELETE FROM x_oauth_requests WHERE expires_at<? OR consumed_at IS NOT NULL AND consumed_at<?')
    .run(new Date(Date.now() - 24 * 60 * 60_000).toISOString(), new Date(Date.now() - 24 * 60 * 60_000).toISOString());
}

export async function startXOAuth(user: SessionUser) {
  const app = getApp(); const handshake = crypto.randomBytes(32).toString('base64url');
  const callback = callbackUrl(); const id = crypto.randomUUID(); const timestamp = now(); const expiresAt = new Date(Date.now() + oauthLifetimeMs).toISOString();
  if (app?.client_id_enc && app.client_secret_enc) {
    const credentials = oauth2AppCredentials(app); const state = crypto.randomBytes(32).toString('base64url');
    const verifier = crypto.randomBytes(48).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    db.transaction(() => {
      db.prepare(`INSERT INTO x_oauth_requests (id,user_id,app_id,credential_version,request_token_hash,request_secret_enc,handshake_hash,expires_at,created_at,flow)
        VALUES (?,?,?,?,?,?,?,?,?,'oauth2')`).run(id, user.id, appId, Number(app.credential_version), sha256(state),
        encryptSecret(verifier, oauthContext(id)), sha256(handshake), expiresAt, timestamp);
      oauthRequestCleanup(timestamp);
    })();
    const parameters = new URLSearchParams({
      response_type: 'code', client_id: credentials.clientId, redirect_uri: callback,
      scope: 'tweet.read users.read offline.access', state, code_challenge: challenge, code_challenge_method: 'S256'
    });
    return { authorizeUrl: `${config.xOAuth2AuthorizeBaseUrl}/i/oauth2/authorize?${parameters}`, cookie: oauthCookie(handshake, Math.floor(oauthLifetimeMs / 1000), state), flow: 'oauth2' as const };
  }
  const credentials = appCredentials(app); const requested = await requestOAuthToken(credentials, callback);
  db.transaction(() => {
    db.prepare(`INSERT INTO x_oauth_requests (id,user_id,app_id,credential_version,request_token_hash,request_secret_enc,handshake_hash,expires_at,created_at,flow)
      VALUES (?,?,?,?,?,?,?,?,?,'oauth1')`).run(id, user.id, appId, Number(app!.credential_version), sha256(requested.token),
      encryptSecret(requested.secret, oauthContext(id)), sha256(handshake), expiresAt, timestamp);
    oauthRequestCleanup(timestamp);
  })();
  return { authorizeUrl: `${config.xOAuthBaseUrl}/oauth/authenticate?oauth_token=${encodeURIComponent(requested.token)}`, cookie: oauthCookie(handshake, Math.floor(oauthLifetimeMs / 1000), requested.token), flow: 'oauth1' as const };
}

function storeOAuth2Connection(input: { pending: any; account: { id: string; username: string; name?: string; profile_image_url?: string }; token: XOAuth2Token; snapshot: string[] }) {
  return db.transaction(() => {
    const currentApp = getApp();
    if (!currentApp || Number(currentApp.credential_version) !== Number(input.pending.credential_version)
      || !connectionSnapshotUnchanged(input.pending.user_id, input.snapshot)) throw new XSyncCancelledError();
    const timestamp = now();
    const existing = db.prepare('SELECT * FROM x_connections WHERE user_id=? AND x_user_id=?').get(input.pending.user_id, input.account.id) as XConnectionRow | undefined;
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
      db.prepare(`INSERT INTO x_connections (id,user_id,app_id,access_token_enc,access_token_secret_enc,refresh_token_enc,auth_type,scopes_json,token_expires_at,
        x_user_id,username,display_name,profile_image_url,status,auto_sync,sync_interval_minutes,rate_limit_json,created_at,updated_at)
        VALUES (?,?,?,?,NULL,?,'oauth2',?,?,?,?,?,?, 'connected',0,60,'{}',?,?)`)
        .run(id, input.pending.user_id, appId, access, refresh, JSON.stringify(input.token.scopes), expiresAt, input.account.id, input.account.username,
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
      const app = getApp(); if (!app || Number(app.credential_version) !== Number(pending.credential_version)) return 'failed' as const;
      const snapshot = connectionMutationSnapshot(pending.user_id); const credentials = oauth2AppCredentials(app);
      const verifier = decryptSecret(pending.request_secret_enc, oauthContext(pending.id));
      const token = await exchangeOAuth2Code(credentials, { code, redirectUri: callbackUrl(), codeVerifier: verifier });
      const profile = await getXJson<{ data?: { id?: string; username?: string; name?: string; profile_image_url?: string } }>({
        path: '/2/users/me?user.fields=id,name,username,profile_image_url', bearerToken: token.accessToken
      });
      const account = profile.data.data;
      if (!account?.id || !account.username) return 'failed' as const;
      storeOAuth2Connection({ pending, account: { id: account.id, username: account.username, name: account.name, profile_image_url: account.profile_image_url }, token, snapshot });
      publishEvent('data-changed', { reason: 'x-account-connected', connectionCount: connectionsForUser(pending.user_id).length });
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
    const app = getApp();
    if (!app || Number(app.credential_version) !== Number(pending.credential_version)) return 'failed' as const;
    const snapshot = connectionMutationSnapshot(pending.user_id);
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
      const currentApp = getApp(); const existing = db.prepare('SELECT * FROM x_connections WHERE user_id=? AND x_user_id=?').get(pending.user_id, account.id) as XConnectionRow | undefined;
      if (!currentApp || Number(currentApp.credential_version) !== Number(pending.credential_version)) throw new XSyncCancelledError();
      if (!connectionSnapshotUnchanged(pending.user_id, snapshot)) throw new XSyncCancelledError();
      const finalTimestamp = now(); const id = existing?.id || crypto.randomUUID();
      if (existing) {
        db.prepare(`UPDATE x_connections SET app_id=?,access_token_enc=?,access_token_secret_enc=?,refresh_token_enc=NULL,auth_type='oauth1',scopes_json='[]',token_expires_at=NULL,x_user_id=?,username=?,display_name=?,profile_image_url=?,status='connected',generation=generation+1,auto_sync=0,next_sync_at=NULL,last_error=NULL,updated_at=? WHERE id=?`)
          .run(appId, encryptSecret(exchanged.accessToken, connectionContext(id, 'access-token')), encryptSecret(exchanged.accessTokenSecret, connectionContext(id, 'access-token-secret')),
            account.id, account.username, account.name || account.username, account.profile_image_url || null, finalTimestamp, id);
        cancelConnectionSyncs(id, 'X account credentials changed.', finalTimestamp);
      } else db.prepare(`INSERT INTO x_connections (id,user_id,app_id,access_token_enc,access_token_secret_enc,auth_type,x_user_id,username,display_name,profile_image_url,status,auto_sync,sync_interval_minutes,rate_limit_json,created_at,updated_at)
        VALUES (?,?,?,?,?,'oauth1',?,?,?,?,'connected',0,60,'{}',?,?)`).run(id, pending.user_id, appId,
        encryptSecret(exchanged.accessToken, connectionContext(id, 'access-token')), encryptSecret(exchanged.accessTokenSecret, connectionContext(id, 'access-token-secret')),
        account.id, account.username, account.name || account.username, account.profile_image_url || null, finalTimestamp, finalTimestamp);
      return true;
    })();
    if (!stored) return 'failed' as const;
    publishEvent('data-changed', { reason: 'x-account-connected' });
    return 'connected' as const;
  } catch { return 'failed' as const; }
}

export function listXQueries(user: SessionUser, connectionId?: string | null) {
  const connection = connectionForUser(user.id, connectionId); if (!connection) return [];
  return (db.prepare('SELECT * FROM x_listening_queries WHERE connection_id=? ORDER BY created_at').all(connection.id) as any[]).map(rowQuery);
}
export function createXQuery(user: SessionUser, input: { label: string; query: string; enabled?: boolean }, connectionId?: string | null) {
  const connection = connectionForUser(user.id, connectionId); if (!connection) throw new XIntegrationError('Connect an X account first.', 409);
  const count = Number((db.prepare('SELECT COUNT(*) count FROM x_listening_queries WHERE connection_id=?').get(connection.id) as any).count);
  if (count >= 10) throw new XIntegrationError('A maximum of 10 listening queries can be active for one account.');
  const id = crypto.randomUUID(); const timestamp = now();
  db.prepare(`INSERT INTO x_listening_queries (id,connection_id,label,query,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
    .run(id, connection.id, input.label.trim(), input.query.trim(), input.enabled === false ? 0 : 1, timestamp, timestamp);
  publishEvent('data-changed', { reason: 'x-query-created', id });
  return rowQuery(db.prepare('SELECT * FROM x_listening_queries WHERE id=?').get(id));
}
export function updateXQuery(user: SessionUser, id: string, input: { label?: string; query?: string; enabled?: boolean }) {
  const current = db.prepare(`SELECT q.* FROM x_listening_queries q JOIN x_connections c ON c.id=q.connection_id
    WHERE q.id=? AND c.user_id=?`).get(id, user.id) as any;
  if (!current) throw new XIntegrationError('Listening query not found.', 404);
  db.prepare('UPDATE x_listening_queries SET label=?,query=?,enabled=?,since_id=?,updated_at=? WHERE id=? AND connection_id=?')
    .run(input.label?.trim() ?? current.label, input.query?.trim() ?? current.query, input.enabled === undefined ? current.enabled : input.enabled ? 1 : 0,
      input.query !== undefined && input.query.trim() !== current.query ? null : current.since_id, now(), id, current.connection_id);
  publishEvent('data-changed', { reason: 'x-query-updated', id });
  return rowQuery(db.prepare('SELECT * FROM x_listening_queries WHERE id=?').get(id));
}
export function deleteXQuery(user: SessionUser, id: string) {
  const current = db.prepare(`SELECT q.id FROM x_listening_queries q JOIN x_connections c ON c.id=q.connection_id
    WHERE q.id=? AND c.user_id=?`).get(id, user.id) as { id: string } | undefined;
  if (!current || !db.prepare('DELETE FROM x_listening_queries WHERE id=?').run(id).changes) throw new XIntegrationError('Listening query not found.', 404);
  publishEvent('data-changed', { reason: 'x-query-deleted', id });
}

function stableMentionId(postId: string) {
  const hash = crypto.createHash('sha256').update(`x:${postId}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
function greatestId(values: Array<string | null | undefined>) {
  return values.filter((value): value is string => Boolean(value && /^\d+$/.test(value)))
    .reduce<string | null>((largest, value) => !largest || BigInt(value) > BigInt(largest) ? value : largest, null);
}
type XPost = { id: string; text?: string; created_at?: string; lang?: string; author_id?: string; public_metrics?: Record<string, number>; note_tweet?: { text?: string } };
type XPostPage = { data?: XPost[]; includes?: { users?: Array<{ id: string; username?: string; name?: string; profile_image_url?: string }> }; meta?: { newest_id?: string; next_token?: string; result_count?: number } };
type CollectedPost = { post: XPost; stream: 'account_post' | 'mention' | 'search'; queryId?: string; users?: NonNullable<XPostPage['includes']>['users'] };

function upsertCollectedPosts(connection: XConnectionRow, collected: CollectedPost[]) {
  const grouped = new Map<string, CollectedPost[]>();
  for (const item of collected) if (/^\d+$/.test(String(item.post.id || ''))) grouped.set(item.post.id, [...(grouped.get(item.post.id) || []), item]);
  const insertedIds: string[] = []; const pendingAnalysisIds: string[] = []; const timestamp = now();
  for (const [postId, discoveries] of grouped) {
    const first = discoveries[0]; const post = first.post;
    const users = discoveries.flatMap((item) => item.users || []); const author = users.find((item) => item.id === post.author_id);
    const username = String(author?.username || (post.author_id === connection.x_user_id ? connection.username : '') || '').replace(/^@/, '');
    const validUsername = /^[A-Za-z0-9_]{1,15}$/.test(username) ? username : '';
    const streams = [...new Set(discoveries.map((item) => item.stream))];
    const queryIds = [...new Set(discoveries.map((item) => item.queryId).filter((value): value is string => Boolean(value)))];
    const existing = db.prepare("SELECT * FROM social_mentions WHERE source='x' AND external_id=?").get(postId) as any;
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
      db.prepare(`UPDATE social_mentions SET author=?,content=?,url=?,language=?,published_at=?,metadata_json=? WHERE id=?`)
        .run(validUsername ? `@${validUsername}` : author?.name || connection.display_name || '', content, url, post.lang || '', published, JSON.stringify(metadata), existing.id);
    } else {
      const id = stableMentionId(postId);
      db.prepare(`INSERT INTO social_mentions (id,source,external_id,x_connection_id,ingestion_kind,author,content,url,language,published_at,metadata_json,analysis_json,created_at)
        VALUES (?,'x',?,?,?,?,?,?,?,?,?,NULL,?)`).run(id, postId, connection.id, streams[0], validUsername ? `@${validUsername}` : author?.name || connection.display_name || '',
        content, url, post.lang || '', published, JSON.stringify(metadata), timestamp);
      insertedIds.push(id);
    }
    const mentionId = existing?.id || stableMentionId(postId);
    const currentLink = db.prepare('SELECT * FROM x_connection_mentions WHERE connection_id=? AND mention_id=?').get(connection.id, mentionId) as any;
    const linkStreams = [...new Set([...(parseJson<string[]>(currentLink?.streams_json, [])), ...streams])];
    const linkQueries = [...new Set([...(parseJson<string[]>(currentLink?.query_ids_json, [])), ...queryIds])];
    db.prepare(`INSERT INTO x_connection_mentions (connection_id,mention_id,streams_json,query_ids_json,discovered_at,last_seen_at)
      VALUES (?,?,?,?,?,?) ON CONFLICT(connection_id,mention_id) DO UPDATE SET streams_json=excluded.streams_json,query_ids_json=excluded.query_ids_json,last_seen_at=excluded.last_seen_at`)
      .run(connection.id, mentionId, JSON.stringify(linkStreams), JSON.stringify(linkQueries), currentLink?.discovered_at || timestamp, timestamp);
    if (!existing?.analysis_json) pendingAnalysisIds.push(mentionId);
  }
  return { insertedIds, pendingAnalysisIds: [...new Set(pendingAnalysisIds)] };
}

function persistCollectedBatch(input: {
  connection: XConnectionRow; collected: CollectedPost[]; jobId: string; generation: number; credentialVersion: number;
  assertBatchCurrent?: () => void; afterPersist?: () => void;
}) {
  return db.transaction(() => {
    assertSyncGeneration(input.connection.id, input.generation, input.credentialVersion);
    input.assertBatchCurrent?.();
    const latestConnection = db.prepare('SELECT * FROM x_connections WHERE id=?').get(input.connection.id) as XConnectionRow;
    const { insertedIds, pendingAnalysisIds } = upsertCollectedPosts(latestConnection, input.collected);
    const recoveryIds = (db.prepare(`SELECT m.id FROM x_connection_mentions cm JOIN social_mentions m ON m.id=cm.mention_id
      WHERE cm.connection_id=? AND m.analysis_json IS NULL ORDER BY cm.discovered_at LIMIT 2000`).all(input.connection.id) as Array<{ id: string }>).map((row) => row.id);
    const activeInputs = db.prepare("SELECT input_json FROM ai_jobs WHERE kind='social.analyze' AND state IN ('queued','processing')").all() as Array<{ input_json: string }>;
    const activeIds = new Set(activeInputs.flatMap((row) => {
      const value = parseJson<{ mentionIds?: unknown[] }>(row.input_json, {}); return Array.isArray(value.mentionIds) ? value.mentionIds.map(String) : [];
    }));
    const analysisIds = [...new Set([...pendingAnalysisIds, ...recoveryIds])].filter((id) => !activeIds.has(id));
    const analysisJobs: ReturnType<typeof createJob>[] = [];
    for (let index = 0; index < analysisIds.length; index += 200) {
      analysisJobs.push(createJob('social.analyze', { mentionIds: analysisIds.slice(index, index + 200), source: 'x-sync', xSyncJobId: input.jobId }, null, null, input.connection.user_id));
    }
    input.afterPersist?.();
    db.prepare('UPDATE x_sync_jobs SET imported_count=imported_count+?,analysis_job_id=COALESCE(analysis_job_id,?),updated_at=? WHERE id=?')
      .run(insertedIds.length, analysisJobs[0]?.id || null, now(), input.jobId);
    return { insertedIds, analysisJobs };
  })();
}

function dispatchAnalysisJobs(jobs: ReturnType<typeof createJob>[]) {
  for (const job of jobs) publishEvent('ai-job', job);
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
async function fetchPostPages(input: {
  path: string; parameters: Record<string, string | null | undefined>; auth: XDataAuth;
  maxPages: number; onPage?: (count: number, page: number) => void; assertCurrent?: () => void;
}) {
  const posts: XPost[] = []; const users = new Map<string, NonNullable<NonNullable<XPostPage['includes']>['users']>[number]>();
  let paginationToken: string | undefined; let newestId: string | null = null; let rate: XRateLimit | null = null;
  // Each completed endpoint is checkpointed before the next one starts. The
  // page cap bounds memory/credit spend, and a truncated walk never advances
  // its high-water cursor.
  for (let page = 1; page <= input.maxPages; page += 1) {
    const result = await getXJson<XPostPage>({ path: apiPath(input.path, { ...input.parameters, pagination_token: paginationToken }), ...input.auth });
    input.assertCurrent?.();
    rate = result.rate; const pagePosts = result.data.data || [];
    posts.push(...pagePosts); for (const user of result.data.includes?.users || []) users.set(user.id, user);
    newestId = greatestId([newestId, result.data.meta?.newest_id, ...pagePosts.map((post) => post.id)]);
    input.onPage?.(posts.length, page);
    paginationToken = result.data.meta?.next_token;
    if (!paginationToken) return { posts, users: [...users.values()], newestId, rate, pages: page };
  }
  throw new XApiError(`The X result set exceeded ${input.maxPages * 100} posts. Narrow the listening query before trying again; no cursor was advanced.`, 422, 'provider');
}
function retryTime(attempt: number) { return new Date(Date.now() + Math.min(60, 2 ** Math.max(0, attempt - 1)) * 60_000).toISOString(); }
function nextSchedule(connection: XConnectionRow) { return connection.auto_sync && connection.status === 'connected' ? new Date(Date.now() + Number(connection.sync_interval_minutes) * 60_000).toISOString() : null; }
function syncProgress(jobId: string, stage: string, progress: number, _counts: { posts?: number; mentions?: number; search?: number } = {}) {
  // Counts are checkpointed only with the corresponding endpoint cursor. This
  // keeps retry telemetry exact; stage/progress still stream after every page.
  db.prepare('UPDATE x_sync_jobs SET stage=?,progress=?,updated_at=? WHERE id=?').run(stage, progress, now(), jobId);
  publishEvent('data-changed', { reason: 'x-sync-progress', jobId, stage, progress });
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
    syncProgress(job.id, 'verifying_account', 10);
    const profileResult = await getXJson<{ data?: { id?: string; username?: string; name?: string; profile_image_url?: string } }>({
      path: '/2/users/me?user.fields=id,name,username,profile_image_url', ...oauthCredentials
    });
    assertSyncGeneration(connection.id, syncGeneration, appCredentialVersion);
    rates.profile = profileResult.rate; const profile = profileResult.data.data;
    if (!profile?.id || !profile.username || connection.x_user_id && connection.x_user_id !== profile.id) throw new XApiError('The connected X account identity changed. Reconnect the account.', 401, 'authentication');
    const timestamp = now();
    db.prepare(`UPDATE x_connections SET x_user_id=?,username=?,display_name=?,profile_image_url=?,status='connected',last_error=NULL,last_sync_at=?,updated_at=? WHERE id=?`)
      .run(profile.id, profile.username, profile.name || profile.username, profile.profile_image_url || null, timestamp, timestamp, connection.id);
    const refreshed = db.prepare('SELECT * FROM x_connections WHERE id=?').get(connection.id) as XConnectionRow;

    syncProgress(job.id, 'fetching_posts', 20);
    const postsResult = await fetchPostPages({ path: `/2/users/${profile.id}/tweets`, maxPages: 32, parameters: {
      max_results: '100', since_id: refreshed.last_post_id, exclude: 'retweets',
      'tweet.fields': 'id,text,created_at,lang,author_id,public_metrics,note_tweet', expansions: 'author_id', 'user.fields': 'id,name,username,profile_image_url'
    }, auth: oauthCredentials, assertCurrent: () => assertSyncGeneration(connection!.id, syncGeneration, appCredentialVersion),
      onPage: (count, page) => syncProgress(job.id, 'fetching_posts', Math.min(34, 20 + page), { posts: count }) });
    assertSyncGeneration(connection.id, syncGeneration, appCredentialVersion);
    if (postsResult.rate) rates.posts = postsResult.rate; const posts = postsResult.posts;
    const savedPosts = persistCollectedBatch({ connection: refreshed,
      collected: posts.map((post) => ({ post, stream: 'account_post' as const, users: postsResult.users })),
      jobId: job.id, generation: syncGeneration, credentialVersion: appCredentialVersion,
      afterPersist: () => {
        db.prepare('UPDATE x_connections SET last_post_id=?,updated_at=? WHERE id=?').run(
          greatestId([refreshed.last_post_id, postsResult.newestId, ...posts.map((post) => post.id)]), now(), connection!.id);
        db.prepare('UPDATE x_sync_jobs SET posts_fetched=posts_fetched+?,updated_at=? WHERE id=?').run(posts.length, now(), job.id);
      } });
    dispatchAnalysisJobs(savedPosts.analysisJobs);

    syncProgress(job.id, 'fetching_mentions', 40, { posts: posts.length });
    const mentionsResult = await fetchPostPages({ path: `/2/users/${profile.id}/mentions`, maxPages: 10, parameters: {
      max_results: '100', since_id: refreshed.last_mention_id,
      'tweet.fields': 'id,text,created_at,lang,author_id,public_metrics,note_tweet', expansions: 'author_id', 'user.fields': 'id,name,username,profile_image_url'
    }, auth: oauthCredentials, assertCurrent: () => assertSyncGeneration(connection!.id, syncGeneration, appCredentialVersion),
      onPage: (count, page) => syncProgress(job.id, 'fetching_mentions', Math.min(54, 40 + page), { posts: posts.length, mentions: count }) });
    assertSyncGeneration(connection.id, syncGeneration, appCredentialVersion);
    if (mentionsResult.rate) rates.mentions = mentionsResult.rate; const mentions = mentionsResult.posts;
    const savedMentions = persistCollectedBatch({ connection: refreshed,
      collected: mentions.map((post) => ({ post, stream: 'mention' as const, users: mentionsResult.users })),
      jobId: job.id, generation: syncGeneration, credentialVersion: appCredentialVersion,
      afterPersist: () => {
        db.prepare('UPDATE x_connections SET last_mention_id=?,updated_at=? WHERE id=?').run(
          greatestId([refreshed.last_mention_id, mentionsResult.newestId, ...mentions.map((post) => post.id)]), now(), connection!.id);
        db.prepare('UPDATE x_sync_jobs SET mentions_fetched=mentions_fetched+?,updated_at=? WHERE id=?').run(mentions.length, now(), job.id);
      } });
    dispatchAnalysisJobs(savedMentions.analysisJobs);

    const queryRows = db.prepare('SELECT * FROM x_listening_queries WHERE connection_id=? AND enabled=1 ORDER BY created_at LIMIT 10').all(connection.id) as any[];
    const queryOutcomes: Array<{ id: string; cursor: string | null; error: string | null; successful: boolean }> = [];
    let searchCount = 0;
    for (let index = 0; index < queryRows.length; index += 1) {
      const queryRow = queryRows[index];
      const baseProgress = 58 + Math.floor((index / Math.max(1, queryRows.length)) * 18);
      syncProgress(job.id, 'running_searches', baseProgress, { posts: posts.length, mentions: mentions.length, search: searchCount });
      const searchAuth: XDataAuth | null = connection.auth_type === 'oauth2'
        ? oauthCredentials
        : appBearerToken(app) ? { bearerToken: appBearerToken(app)! } : null;
      if (!searchAuth) {
        queryOutcomes.push({ id: queryRow.id, cursor: queryRow.since_id, error: 'A bearer token is required for recent search.', successful: false }); continue;
      }
      try {
        const searchResult = await fetchPostPages({ path: '/2/tweets/search/recent', maxPages: 10, parameters: {
          query: queryRow.query, max_results: '100', since_id: queryRow.since_id,
          'tweet.fields': 'id,text,created_at,lang,author_id,public_metrics,note_tweet', expansions: 'author_id', 'user.fields': 'id,name,username,profile_image_url'
        }, auth: searchAuth, assertCurrent: () => assertSyncGeneration(connection!.id, syncGeneration, appCredentialVersion),
          onPage: (count, page) => syncProgress(job.id, 'running_searches', Math.min(78, baseProgress + page),
          { posts: posts.length, mentions: mentions.length, search: searchCount + count }) });
        assertSyncGeneration(connection.id, syncGeneration, appCredentialVersion);
        if (searchResult.rate) rates[`search:${queryRow.id}`] = searchResult.rate; const found = searchResult.posts; searchCount += found.length;
        const searchCompletedAt = now(); const cursor = greatestId([queryRow.since_id, searchResult.newestId, ...found.map((post) => post.id)]);
        const savedSearch = persistCollectedBatch({ connection: refreshed,
          collected: found.map((post) => ({ post, stream: 'search' as const, queryId: queryRow.id, users: searchResult.users })),
          jobId: job.id, generation: syncGeneration, credentialVersion: appCredentialVersion,
          assertBatchCurrent: () => {
            const current = db.prepare('SELECT query,updated_at FROM x_listening_queries WHERE id=? AND connection_id=?').get(queryRow.id, connection!.id) as { query: string; updated_at: string } | undefined;
            if (!current || current.query !== queryRow.query || current.updated_at !== queryRow.updated_at) throw new XQueryChangedError();
          },
          afterPersist: () => {
            db.prepare('UPDATE x_listening_queries SET since_id=?,last_sync_at=?,last_success_at=?,last_error=NULL,updated_at=? WHERE id=? AND connection_id=?')
              .run(cursor, searchCompletedAt, searchCompletedAt, searchCompletedAt, queryRow.id, connection!.id);
            db.prepare('UPDATE x_sync_jobs SET search_fetched=search_fetched+?,updated_at=? WHERE id=?').run(found.length, searchCompletedAt, job.id);
          } });
        dispatchAnalysisJobs(savedSearch.analysisJobs);
      } catch (error) {
        if (error instanceof XSyncCancelledError) throw error;
        if (!(error instanceof XQueryChangedError) && !(error instanceof XApiError)) throw error;
        const message = error instanceof Error ? error.message : 'Search failed.';
        queryOutcomes.push({ id: queryRow.id, cursor: queryRow.since_id, error: message.slice(0, 500), successful: false });
        if (error instanceof XApiError && (error.code === 'rate_limit' || error.retryable)) throw error;
        if (error instanceof XApiError && ['authentication', 'billing', 'permission'].includes(error.code)) throw error;
      }
    }

    syncProgress(job.id, 'finalizing', 90, { posts: posts.length, mentions: mentions.length, search: searchCount });
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
      db.prepare(`UPDATE x_sync_jobs SET state='completed',stage='completed',progress=100,error=NULL,run_after=NULL,completed_at=?,updated_at=? WHERE id=?`)
        .run(completedAt, completedAt, job.id);
      db.prepare("UPDATE x_apps SET billing_status='ready',billing_problem_type=NULL,billing_checked_at=?,updated_at=? WHERE id=?")
        .run(completedAt, completedAt, appId);
      db.prepare(`UPDATE x_sync_jobs SET state='queued',stage='credits_restored',error=NULL,run_after=NULL,updated_at=?
        WHERE state='waiting_billing' AND id<>?`).run(completedAt, job.id);
      const completed = db.prepare('SELECT imported_count FROM x_sync_jobs WHERE id=?').get(job.id) as { imported_count: number };
      return { importedCount: Number(completed.imported_count) };
    })();
    publishEvent('data-changed', { reason: 'x-sync-completed', jobId: job.id, importedCount: saved.importedCount });
  } catch (error) {
    if (error instanceof XSyncCancelledError) {
      const timestamp = now();
      db.prepare("UPDATE x_sync_jobs SET state='cancelled',stage='cancelled',error=?,run_after=NULL,completed_at=?,updated_at=? WHERE id=?")
        .run(error.message, timestamp, timestamp, job.id);
      publishEvent('data-changed', { reason: 'x-sync-state-changed', jobId: job.id, state: 'cancelled', stage: 'cancelled' });
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
    publishEvent('data-changed', { reason: 'x-sync-state-changed', jobId: job.id, state, stage });
  }
}

const claimNextSync = db.transaction(() => {
  const timestamp = now();
  const billingStatus = getApp()?.billing_status || 'unknown';
  if (billingStatus === 'credits_depleted') return null;
  const row = db.prepare(`SELECT * FROM x_sync_jobs WHERE state IN ('queued','waiting_rate_limit') AND (run_after IS NULL OR run_after<=?)
    AND (?<>'checking_credits' OR credit_probe=1) ORDER BY created_at LIMIT 1`).get(timestamp, billingStatus) as any;
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
  db.prepare(`INSERT INTO x_sync_jobs (id,connection_id,trigger_type,state,stage,progress,attempt,credit_probe,error,created_at,updated_at) VALUES (?,?,?,?,?,0,0,?,?,?,?)`)
    .run(id, connection.id, trigger, billingBlocked ? 'waiting_billing' : 'queued', billingBlocked ? 'credits_required' : creditProbe ? 'checking_credits' : 'queued',
      creditProbe ? 1 : 0, billingBlocked ? 'X API credits are depleted. Add credits in the X Developer Console, then retry this sync.' : null, timestamp, timestamp);
  const job = db.prepare('SELECT * FROM x_sync_jobs WHERE id=?').get(id) as any;
  publishEvent('data-changed', { reason: 'x-sync-queued', jobId: id });
  return { job: rowSyncJob(job), created: true };
}

export function enqueueXSync(user: SessionUser, connectionId?: string | null) {
  const connection = connectionForUser(user.id, connectionId); if (!connection) throw new XIntegrationError('Connect an X account first.', 409);
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
            publishEvent('data-changed', { reason: 'x-sync-state-changed', jobId: job.id, state: 'failed', stage: 'internal_error' });
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
