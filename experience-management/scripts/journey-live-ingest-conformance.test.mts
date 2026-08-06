import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http, { type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from '@playwright/test';
import { build } from 'esbuild';
import request from 'supertest';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDirectory, '..');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'seemplify-live-ingest-'));
const passwordFile = path.join(temporaryRoot, 'admin-password');
const sessionFile = path.join(temporaryRoot, 'session-secret');
const terraSecretFile = path.join(temporaryRoot, 'terra-secret');
const xKeyFile = path.join(temporaryRoot, 'x-key');
const esignKeyFile = path.join(temporaryRoot, 'esign-key');
const identityKeyFile = path.join(temporaryRoot, 'journey-identity-key');
const browserBundle = path.join(temporaryRoot, 'journey-live-browser.mjs');

fs.writeFileSync(passwordFile, 'Journey-Live-Ingest-2026!');
fs.writeFileSync(sessionFile, 'journey-live-ingest-session-secret-that-is-long-enough');
fs.writeFileSync(terraSecretFile, 'journey-live-ingest-terra-secret-that-is-long-enough');
fs.writeFileSync(xKeyFile, Buffer.alloc(32, 51).toString('base64url'));
fs.writeFileSync(esignKeyFile, Buffer.alloc(32, 52).toString('base64url'));
fs.writeFileSync(identityKeyFile, crypto.randomBytes(48));
Object.assign(process.env, {
  DATABASE_PATH: path.join(temporaryRoot, 'live-ingest.sqlite'),
  UPLOAD_DIR: path.join(temporaryRoot, 'uploads'),
  FRONTEND_DIST: path.join(temporaryRoot, 'missing-frontend'),
  PUBLIC_URL: 'http://127.0.0.1:5412',
  ADMIN_EMAIL: 'journey-live@seemplify.local',
  ADMIN_PASSWORD_FILE: passwordFile,
  SESSION_SECRET_FILE: sessionFile,
  TERRA_GATEWAY_SHARED_SECRET_FILE: terraSecretFile,
  LOCAL_LLM_SHARED_SECRET_FILE: terraSecretFile,
  EMAIL_MODE: 'log',
  X_CREDENTIAL_ENCRYPTION_KEY_FILE: xKeyFile,
  ESIGN_STORAGE_DIR: path.join(temporaryRoot, 'esign'),
  ESIGN_ENCRYPTION_KEY_FILE: esignKeyFile,
  JOURNEY_IDENTITY_HASH_KEY_FILE: identityKeyFile,
  X_SEED_CONSUMER_KEY_FILE: path.join(temporaryRoot, 'missing-x-key'),
  X_SEED_CONSUMER_SECRET_FILE: path.join(temporaryRoot, 'missing-x-secret'),
  X_SEED_BEARER_TOKEN_FILE: path.join(temporaryRoot, 'missing-x-bearer'),
  X_SEED_ACCESS_TOKEN_FILE: path.join(temporaryRoot, 'missing-x-token'),
  X_SEED_ACCESS_TOKEN_SECRET_FILE: path.join(temporaryRoot, 'missing-x-token-secret')
});

const { app } = await import('../backend/src/app.js');
const { db } = await import('../backend/src/database.js');
const { createBrowserJourneySdk } = await import('@seemplify/journey-browser-sdk');
const { createNodeJourneySdk } = await import('@seemplify/journey-node');

let ingestServer: Server | undefined;
let browserHost: Server | undefined;
let browser: Browser | undefined;

function closeServer(server: Server | undefined) {
  return new Promise<void>((resolve, reject) => {
    if (!server) return resolve();
    server.closeAllConnections();
    server.close((error) => error ? reject(error) : resolve());
  });
}

after(async () => {
  await browser?.close();
  await closeServer(browserHost);
  await closeServer(ingestServer);
  db.close();
  const resolved = path.resolve(temporaryRoot);
  const systemTemporary = path.resolve(os.tmpdir());
  if (!resolved.startsWith(`${systemTemporary}${path.sep}`)
    || !path.basename(resolved).startsWith('seemplify-live-ingest-')) {
    throw new Error(`Refusing to remove unexpected temporary path: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
});

const controlBase = '/api/journey-event-control-plane';

function idempotency(value: string) { return { 'Idempotency-Key': value }; }

function address(server: Server) {
  const value = server.address();
  if (!value || typeof value === 'string') throw new Error('Expected an ephemeral TCP listener.');
  return `http://127.0.0.1:${value.port}`;
}

function listen(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function scalar(sql: string, ...parameters: unknown[]) {
  const row = db.prepare(sql).get(...parameters) as { value: number | string | null };
  return Number(row.value || 0);
}

function envelope(eventId: string, input: {
  channel?: string;
  event?: string;
  occurredAt?: string;
  consent?: 'granted' | 'denied' | null;
  subject?: boolean;
} = {}) {
  const occurredAt = input.occurredAt || new Date().toISOString();
  const consent = input.consent === null ? undefined : {
    analytics: input.consent || 'granted', source: 'live_conformance', updatedAt: occurredAt
  };
  return {
    protocolVersion: '1.0',
    eventId,
    call: 'track',
    event: input.event || 'live_conformance_event',
    eventVersion: 1,
    occurredAt,
    ...(input.subject === false ? {} : { anonymousId: 'live-direct-subject' }),
    properties: { channel: input.channel || 'direct' },
    context: { library: { name: 'live-conformance-gate', version: '1.0.0' } },
    ...(consent ? { consent } : {})
  };
}

async function postJson(baseUrl: string, pathName: string, secret: string, body: unknown, origin?: string) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/json',
      ...(origin ? { origin } : {})
    },
    body: JSON.stringify(body)
  });
  return {
    status: response.status,
    headers: response.headers,
    body: await response.json() as Record<string, any>
  };
}

interface OwnerContext {
  agent: ReturnType<typeof request.agent>;
  spaceId: string;
}

async function ownerContext(): Promise<OwnerContext> {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({
    email: 'journey-live@seemplify.local', password: 'Journey-Live-Ingest-2026!'
  }).expect(200);
  const session = await agent.get('/api/auth/session').expect(200);
  const spaceId = String(session.body.activeSpace.id);
  db.prepare("UPDATE platform_subscriptions SET plan_code='enterprise' WHERE space_id=?").run(spaceId);
  return { agent, spaceId };
}

interface SourceFixture {
  sourceId: string;
  publicCredentialId: string;
  publicKey: string;
  serverSecret: string;
}

async function createSource(owner: OwnerContext, input: {
  key: string;
  name: string;
  origin: string;
  eventsPerMinute?: number;
}): Promise<SourceFixture> {
  const created = await owner.agent.post(`${controlBase}/sources`)
    .set(idempotency(`${input.key}-source`)).send({
      name: input.name,
      environment: 'production',
      validationMode: 'enforce',
      allowedOrigins: [input.origin],
      allowedBundleIds: [],
      eventsPerMinute: input.eventsPerMinute || 100_000,
      bytesPerMinute: 1_000_000_000
    }).expect(201);
  const sourceId = String(created.body.source.id);
  const publicCredential = await owner.agent.post(`${controlBase}/sources/${sourceId}/credentials`)
    .set(idempotency(`${input.key}-public`)).send({ kind: 'public_write' }).expect(201);
  const serverCredential = await owner.agent.post(`${controlBase}/sources/${sourceId}/credentials`)
    .set(idempotency(`${input.key}-server`)).send({ kind: 'server_secret' }).expect(201);
  const schema = await owner.agent.post(`${controlBase}/sources/${sourceId}/schemas`)
    .set(idempotency(`${input.key}-schema`)).send({ eventName: 'live_conformance_event' }).expect(201);
  const version = await owner.agent.post(`${controlBase}/schemas/${schema.body.schema.id}/versions`)
    .set(idempotency(`${input.key}-schema-v1`)).send({
      version: '1.0',
      properties: [{
        name: 'channel',
        type: 'string',
        required: true,
        dataClass: 'operational',
        description: 'Bounded conformance emitter kind.',
        enumValues: ['direct', 'browser', 'react', 'offline', 'rate', 'quota', 'load', 'rotation', 'late', 'server']
      }]
    }).expect(201);
  await owner.agent.post(`${controlBase}/schema-versions/${version.body.version.id}/publish`).send({}).expect(200);
  return {
    sourceId,
    publicCredentialId: String(publicCredential.body.credential.id),
    publicKey: String(publicCredential.body.secret),
    serverSecret: String(serverCredential.body.secret)
  };
}

async function patchSource(owner: OwnerContext, sourceId: string, patch: Record<string, unknown>) {
  const current = await owner.agent.get(`${controlBase}/sources/${sourceId}`).expect(200);
  return owner.agent.patch(`${controlBase}/sources/${sourceId}`).send({
    expectedRevision: Number(current.body.source.revision),
    ...patch
  }).expect(200);
}

function percentile95(values: number[]) {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * 0.95) - 1)]!;
}

test('Browser, React, and Node SDK artifacts conform to the durable live-ingest contract', { timeout: 120_000 }, async () => {
  for (const packageName of ['journey-event-protocol', 'journey-browser-sdk', 'journey-node', 'journey-react']) {
    assert.equal(fs.existsSync(path.join(workspaceRoot, 'packages', packageName, 'dist', 'index.js')), true,
      `${packageName} must be built before the live-ingest gate`);
  }

  await build({
    entryPoints: [path.join(workspaceRoot, 'scripts', 'journey-live-ingest-browser-entry.ts')],
    outfile: browserBundle,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    nodePaths: [path.join(workspaceRoot, 'node_modules')],
    logLevel: 'silent'
  });

  ingestServer = http.createServer(app);
  await listen(ingestServer);
  const ingestOrigin = address(ingestServer);

  browserHost = http.createServer((request_, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (request_.url === '/journey-live-browser.mjs') {
      response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      return fs.createReadStream(browserBundle).pipe(response);
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    return response.end('<!doctype html><html><body><script type="module" src="/journey-live-browser.mjs"></script></body></html>');
  });
  await listen(browserHost);
  const browserOrigin = address(browserHost);

  const owner = await ownerContext();
  const main = await createSource(owner, {
    key: 'live-main', name: 'Live browser and server', origin: browserOrigin
  });
  const rate = await createSource(owner, {
    key: 'live-rate', name: 'Live retry source', origin: browserOrigin, eventsPerMinute: 1
  });

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(browserOrigin);
  await page.waitForFunction(() => Boolean((window as any).seemplifyLiveIngestGate));
  const browserEventId = crypto.randomUUID();
  const browserResult = await page.evaluate(async (input) => {
    return (window as any).seemplifyLiveIngestGate.runBrowser(input);
  }, { endpoint: ingestOrigin, writeKey: main.publicKey, eventId: browserEventId, occurredAt: new Date().toISOString() });
  assert.equal(browserResult.enqueued.status, 'queued');
  assert.deepEqual(browserResult.flushed, { status: 'sent', accepted: 1, dropped: 0, retained: 0 });

  const reactEventId = crypto.randomUUID();
  const reactResult = await page.evaluate(async (input) => {
    return (window as any).seemplifyLiveIngestGate.runReact(input);
  }, { endpoint: ingestOrigin, writeKey: main.publicKey, eventId: reactEventId, occurredAt: new Date().toISOString() });
  assert.equal(reactResult.enqueued.status, 'queued');
  assert.deepEqual(reactResult.flushed, { status: 'sent', accepted: 1, dropped: 0, retained: 0 });
  assert.equal(scalar('SELECT COUNT(*) value FROM journey_raw_events WHERE event_id IN (?,?)', browserEventId, reactEventId), 2);

  const direct = envelope(crypto.randomUUID(), { consent: null });
  const accepted = await postJson(ingestOrigin, '/v1/events', main.serverSecret, direct,
    'https://server-origin-must-not-be-trusted.example.test');
  assert.equal(accepted.status, 202);
  assert.equal(accepted.body.status, 'accepted');
  assert.equal(accepted.headers.get('access-control-allow-origin'), null,
    'server credentials never produce a browser CORS grant');
  const duplicate = await postJson(ingestOrigin, '/v1/events', main.serverSecret, direct);
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.status, 'duplicate');
  const conflict = await postJson(ingestOrigin, '/v1/events', main.serverSecret, {
    ...direct, properties: { channel: 'server' }
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, 'EVENT_ID_CONFLICT');

  const wrongOriginId = crypto.randomUUID();
  const wrongOrigin = await postJson(ingestOrigin, '/v1/events', main.publicKey, envelope(wrongOriginId),
    'https://origin-not-allowed.example.test');
  assert.equal(wrongOrigin.status, 403);
  assert.equal(wrongOrigin.body.error.code, 'EVENT_CLIENT_BINDING_FORBIDDEN');
  assert.equal(wrongOrigin.headers.get('access-control-allow-origin'), null);
  assert.equal(scalar('SELECT COUNT(*) value FROM journey_event_ingest_receipts WHERE event_id=?', wrongOriginId), 0);

  const partialAcceptedId = crypto.randomUUID();
  const partialRejectedId = crypto.randomUUID();
  const partial = await postJson(ingestOrigin, '/v1/batch', main.serverSecret, {
    protocolVersion: '1.0',
    batchId: crypto.randomUUID(),
    sentAt: new Date().toISOString(),
    events: [
      envelope(partialAcceptedId, { channel: 'server', consent: null }),
      envelope(partialRejectedId, { event: 'missing_enforced_schema', consent: null })
    ]
  });
  assert.equal(partial.status, 207);
  assert.deepEqual(partial.body.results.map((entry: any) => entry.status), ['accepted', 'rejected']);
  assert.equal(partial.body.results[1].code, 'EVENT_SCHEMA_NOT_PUBLISHED');

  const deniedId = crypto.randomUUID();
  const denied = await postJson(ingestOrigin, '/v1/events', main.publicKey,
    envelope(deniedId, { consent: 'denied' }), browserOrigin);
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, 'EVENT_CONSENT_DENIED');
  assert.equal(scalar("SELECT COUNT(*) value FROM journey_event_ingest_receipts WHERE event_id=? AND outcome='consent_denied'", deniedId), 1);

  const invalidId = crypto.randomUUID();
  const invalid = await postJson(ingestOrigin, '/v1/events', main.publicKey,
    envelope(invalidId, { subject: false }), browserOrigin);
  assert.equal(invalid.status, 422);
  assert.equal(invalid.body.error.code, 'PROTOCOL_SUBJECT_REQUIRED');
  assert.equal(scalar('SELECT COUNT(*) value FROM journey_event_rejections WHERE event_id=?', invalidId), 1);
  assert.equal(scalar('SELECT COUNT(*) value FROM journey_event_deduplication WHERE event_id=?', invalidId), 0);

  const enforcedId = crypto.randomUUID();
  const enforced = await postJson(ingestOrigin, '/v1/events', main.publicKey,
    envelope(enforcedId, { event: 'missing_enforced_schema' }), browserOrigin);
  assert.equal(enforced.status, 422);
  assert.equal(enforced.body.code, 'EVENT_SCHEMA_NOT_PUBLISHED');
  assert.equal(scalar('SELECT COUNT(*) value FROM journey_raw_events WHERE event_id=?', enforcedId), 0);

  await patchSource(owner, main.sourceId, { validationMode: 'warn' });
  const quarantinedId = crypto.randomUUID();
  const quarantined = await postJson(ingestOrigin, '/v1/events', main.publicKey,
    envelope(quarantinedId, { event: 'missing_warn_schema' }), browserOrigin);
  assert.equal(quarantined.status, 202);
  assert.equal(quarantined.body.status, 'quarantined');
  const quarantinedRaw = db.prepare(`SELECT id,received_at,ingest_state FROM journey_raw_events WHERE event_id=?`)
    .get(quarantinedId) as { id: string; received_at: string; ingest_state: string };
  assert.equal(quarantinedRaw.ingest_state, 'quarantined');
  assert.equal(scalar(`SELECT COUNT(*) value FROM journey_event_processing_inbox
    WHERE raw_received_at=? AND raw_event_id=?`, quarantinedRaw.received_at, quarantinedRaw.id), 0,
  'warn-mode quarantine must remain durable but cannot enter processing before explicit authorised resolution');
  assert.equal(scalar(`SELECT COUNT(*) value FROM journey_event_processing_receipts
    WHERE raw_received_at=? AND raw_event_id=?`, quarantinedRaw.received_at, quarantinedRaw.id), 0);
  assert.equal(scalar(`SELECT COUNT(*) value FROM journey_stage_rule_decisions
    WHERE raw_received_at=? AND raw_event_id=?`, quarantinedRaw.received_at, quarantinedRaw.id), 0);
  assert.equal(scalar(`SELECT COUNT(*) value FROM journey_anonymous_stage_visits
    WHERE raw_received_at=? AND raw_event_id=?`, quarantinedRaw.received_at, quarantinedRaw.id), 0);
  assert.equal(scalar('SELECT COUNT(*) value FROM journey_event_deduplication WHERE event_id=?', quarantinedId), 1);
  await patchSource(owner, main.sourceId, { validationMode: 'enforce' });

  const debugQuarantine = await owner.agent.get(`${controlBase}/sources/${main.sourceId}/debug-events`)
    .query({ outcome: 'quarantined', limit: 10 }).expect(200);
  assert.equal(debugQuarantine.body.events.some((entry: any) => entry.eventId === quarantinedId), true);
  const serializedQuarantine = JSON.stringify(debugQuarantine.body);
  for (const forbidden of ['payload_json', 'context_json', 'consent_json', 'envelope_sha256',
    'anonymous_id_hash', 'live-direct-subject', 'channel']) {
    assert.equal(serializedQuarantine.includes(forbidden), false, `debugger exposed ${forbidden}`);
  }

  const online = { value: false };
  const offlineClient = createBrowserJourneySdk({
    writeKey: main.publicKey,
    endpoint: ingestOrigin,
    environment: 'production',
    consent: { analytics: 'granted', source: 'live_conformance', updatedAt: new Date().toISOString() },
    storage: false,
    automaticContext: false,
    batch: { maxEvents: 20, flushIntervalMs: 600_000 },
    retry: { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 100, jitterRatio: 0 },
    runtime: {
      navigator: { get onLine() { return online.value; } },
      fetch: async (url, init) => fetch(url, {
        ...init,
        headers: { ...init.headers, origin: browserOrigin }
      }),
      setTimeout: () => Object.freeze({}),
      clearTimeout: () => undefined
    }
  });
  await offlineClient.ready;
  const offlineId = crypto.randomUUID();
  assert.equal((await offlineClient.track('live_conformance_event', { channel: 'offline' }, {
    eventId: offlineId, anonymousId: 'live-offline-subject'
  })).status, 'queued');
  assert.deepEqual(await offlineClient.flush(), { status: 'offline', accepted: 0, dropped: 0, retained: 1 });
  assert.equal(scalar('SELECT COUNT(*) value FROM journey_raw_events WHERE event_id=?', offlineId), 0);
  online.value = true;
  assert.deepEqual(await offlineClient.flush(), { status: 'sent', accepted: 1, dropped: 0, retained: 0 });
  online.value = false;
  await offlineClient.track('live_conformance_event', { channel: 'offline' }, {
    eventId: crypto.randomUUID(), anonymousId: 'live-reset-subject'
  });
  assert.equal(offlineClient.status().queued, 1);
  await offlineClient.reset();
  assert.equal(offlineClient.status().queued, 0);
  online.value = true;
  assert.equal((await offlineClient.flush()).status, 'empty');
  await offlineClient.destroy();

  let retryClock = Date.now();
  const retryOutcomes: string[] = [];
  const retryClient = createNodeJourneySdk({
    serverSecret: rate.serverSecret,
    endpoint: ingestOrigin,
    environment: 'production',
    batch: { maxEvents: 20, flushIntervalMs: 600_000, maxBatchesPerFlush: 10 },
    retry: { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 100, jitterRatio: 0 },
    callbacks: { onOutcome: (outcome) => retryOutcomes.push(`${outcome.kind}:${outcome.code}`) },
    runtime: {
      now: () => retryClock,
      setTimeout: () => Object.freeze({}),
      clearTimeout: () => undefined
    }
  });
  const rateFirstId = crypto.randomUUID();
  const rateRetryId = crypto.randomUUID();
  await retryClient.track('live_conformance_event', { channel: 'rate' }, { eventId: rateFirstId, anonymousId: 'live-rate-a' });
  await retryClient.track('live_conformance_event', { channel: 'rate' }, { eventId: rateRetryId, anonymousId: 'live-rate-b' });
  const rateLimited = await retryClient.flush();
  assert.deepEqual(rateLimited, { status: 'retry_scheduled', accepted: 1, dropped: 0, retained: 1 });
  assert.equal(scalar("SELECT COUNT(*) value FROM journey_event_ingest_receipts WHERE event_id=? AND outcome='rate_limited'", rateRetryId), 1);
  assert.equal(scalar('SELECT COUNT(*) value FROM journey_event_deduplication WHERE event_id=?', rateRetryId), 0);
  await patchSource(owner, rate.sourceId, { eventsPerMinute: 100_000 });
  retryClock += 100;
  assert.deepEqual(await retryClient.flush(), { status: 'sent', accepted: 1, dropped: 0, retained: 0 });
  assert.equal(retryOutcomes.includes('retried:RETRY_SCHEDULED'), true);

  const plan = db.prepare("SELECT limits_json FROM platform_subscription_plans WHERE code='enterprise'")
    .get() as { limits_json: string };
  const originalLimits = plan.limits_json;
  const quotaId = crypto.randomUUID();
  try {
    const used = scalar(`SELECT COALESCE(SUM(quantity),0) value FROM platform_usage_events
      WHERE space_id=? AND meter='monthlyTrackedEvents'`, owner.spaceId);
    const limits = JSON.parse(originalLimits);
    limits.monthlyTrackedEvents = used;
    db.prepare("UPDATE platform_subscription_plans SET limits_json=? WHERE code='enterprise'")
      .run(JSON.stringify(limits));
    await retryClient.track('live_conformance_event', { channel: 'quota' }, {
      eventId: quotaId, anonymousId: 'live-quota-subject'
    });
    const overQuota = await retryClient.flush();
    assert.deepEqual(overQuota, { status: 'retry_scheduled', accepted: 0, dropped: 0, retained: 1 });
    assert.equal(scalar("SELECT COUNT(*) value FROM journey_event_ingest_receipts WHERE event_id=? AND outcome='over_quota'", quotaId), 1);
    assert.equal(scalar('SELECT COUNT(*) value FROM journey_event_deduplication WHERE event_id=?', quotaId), 0);
    db.prepare("UPDATE platform_subscription_plans SET limits_json=? WHERE code='enterprise'").run(originalLimits);
    retryClock += 100;
    assert.deepEqual(await retryClient.flush(), { status: 'sent', accepted: 1, dropped: 0, retained: 0 });
  } finally {
    db.prepare("UPDATE platform_subscription_plans SET limits_json=? WHERE code='enterprise'").run(originalLimits);
  }
  await retryClient.close();

  const newerId = crypto.randomUUID();
  const olderId = crypto.randomUUID();
  const now = Date.now();
  assert.equal((await postJson(ingestOrigin, '/v1/events', main.publicKey,
    envelope(newerId, { channel: 'late', occurredAt: new Date(now - 60_000).toISOString() }), browserOrigin)).status, 202);
  assert.equal((await postJson(ingestOrigin, '/v1/events', main.publicKey,
    envelope(olderId, { channel: 'late', occurredAt: new Date(now - 5 * 60_000).toISOString() }), browserOrigin)).status, 202);
  const ordered = db.prepare(`SELECT event_id,occurred_at,received_at FROM journey_raw_events
    WHERE event_id IN (?,?) ORDER BY received_at,id`).all(newerId, olderId) as Array<Record<string, string>>;
  assert.deepEqual(ordered.map((entry) => entry.event_id), [newerId, olderId]);
  assert.ok(Date.parse(ordered[1]!.occurred_at) < Date.parse(ordered[0]!.occurred_at),
    'late arrival order must not rewrite event occurrence time');
  const tooOldId = crypto.randomUUID();
  const tooOld = await postJson(ingestOrigin, '/v1/events', main.publicKey,
    envelope(tooOldId, { channel: 'late', occurredAt: new Date(now - 8 * 24 * 60 * 60_000).toISOString() }), browserOrigin);
  assert.equal(tooOld.status, 422);
  assert.equal(tooOld.body.code, 'EVENT_TIME_OUT_OF_RANGE');
  const serverLateId = crypto.randomUUID();
  assert.equal((await postJson(ingestOrigin, '/v1/events', main.serverSecret,
    envelope(serverLateId, { channel: 'late', occurredAt: new Date(now - 30 * 24 * 60 * 60_000).toISOString(), consent: null }))).status, 202);

  const batchLatenciesMs: number[] = [];
  const loadClient = createNodeJourneySdk({
    serverSecret: main.serverSecret,
    endpoint: ingestOrigin,
    environment: 'production',
    batch: { maxEvents: 100, flushIntervalMs: 600_000, maxBatchesPerFlush: 10 },
    retry: { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 100, jitterRatio: 0 },
    runtime: {
      fetch: async (url, init) => {
        const started = performance.now();
        try { return await fetch(url, init); }
        finally { batchLatenciesMs.push(performance.now() - started); }
      },
      setTimeout: () => Object.freeze({}),
      clearTimeout: () => undefined
    }
  });
  const loadIds: string[] = [];
  for (let wave = 0; wave < 3; wave += 1) {
    for (let eventIndex = 0; eventIndex < 40; eventIndex += 1) {
      const eventId = crypto.randomUUID();
      loadIds.push(eventId);
      const queued = await loadClient.track('live_conformance_event', { channel: 'load' }, {
        eventId, anonymousId: `live-load-${wave}-${eventIndex}`
      });
      assert.equal(queued.status, 'queued');
    }
    const flushed = await loadClient.flush();
    assert.deepEqual(flushed, { status: 'sent', accepted: 40, dropped: 0, retained: 0 });
  }
  await loadClient.close();
  assert.equal(scalar(`SELECT COUNT(*) value FROM journey_raw_events WHERE event_id IN (${loadIds.map(() => '?').join(',')})`, ...loadIds), 120);

  const rotated = await owner.agent.post(`${controlBase}/credentials/${main.publicCredentialId}/rotate`)
    .set(idempotency('live-main-public-rotation')).send({ overlapSeconds: 0 }).expect(201);
  const rotatedKey = String(rotated.body.secret);
  const expiredOldId = crypto.randomUUID();
  assert.equal((await postJson(ingestOrigin, '/v1/events', main.publicKey,
    envelope(expiredOldId, { channel: 'rotation' }), browserOrigin)).status, 401);
  const rotatedId = crypto.randomUUID();
  assert.equal((await postJson(ingestOrigin, '/v1/events', rotatedKey,
    envelope(rotatedId, { channel: 'rotation' }), browserOrigin)).status, 202);
  await owner.agent.post(`${controlBase}/credentials/${rotated.body.credential.id}/revoke`).send({}).expect(200);
  const revokedId = crypto.randomUUID();
  assert.equal((await postJson(ingestOrigin, '/v1/events', rotatedKey,
    envelope(revokedId, { channel: 'rotation' }), browserOrigin)).status, 401);
  assert.equal(scalar('SELECT COUNT(*) value FROM journey_raw_events WHERE event_id IN (?,?)', expiredOldId, revokedId), 0);

  const debug = await owner.agent.get(`${controlBase}/sources/${main.sourceId}/debug-events`)
    .query({ limit: 100 }).expect(200);
  const debugJson = JSON.stringify(debug.body);
  const forbiddenDebugValues: Array<[string, string]> = [
    ['raw payload column', 'payload_json'],
    ['raw context column', 'context_json'],
    ['raw consent column', 'consent_json'],
    ['envelope fingerprint', 'envelope_sha256'],
    ['identity hash column', 'anonymous_id_hash'],
    ['generated load identity', 'live-load-'],
    ['public credential', main.publicKey],
    ['server credential', main.serverSecret],
    ['rotated credential', rotatedKey]
  ];
  for (const [label, forbidden] of forbiddenDebugValues) {
    assert.equal(debugJson.includes(forbidden), false, `debugger exposed ${label}`);
  }

  const rawEvents = scalar('SELECT COUNT(*) value FROM journey_raw_events WHERE space_id=?', owner.spaceId);
  const quarantinedEvents = scalar("SELECT COUNT(*) value FROM journey_raw_events WHERE space_id=? AND ingest_state='quarantined'", owner.spaceId);
  const deduplicatedEvents = scalar('SELECT COUNT(*) value FROM journey_event_deduplication WHERE space_id=?', owner.spaceId);
  const processingInbox = scalar('SELECT COUNT(*) value FROM journey_event_processing_inbox WHERE space_id=?', owner.spaceId);
  const meteredEvents = scalar(`SELECT COALESCE(SUM(quantity),0) value FROM platform_usage_events
    WHERE space_id=? AND meter='monthlyTrackedEvents'`, owner.spaceId);
  assert.equal(deduplicatedEvents, rawEvents, 'every durable raw fact has exactly one global dedupe record');
  assert.equal(meteredEvents, rawEvents, 'accepted and quarantined unique facts reconcile exactly to metering');
  assert.equal(processingInbox, rawEvents - quarantinedEvents,
    'only accepted facts enter the processor inbox; quarantine remains fenced');

  const sdkPackages = ['journey-event-protocol', 'journey-browser-sdk', 'journey-node', 'journey-react', 'journey-react-native'];
  for (const packageName of sdkPackages) {
    const manifest = JSON.parse(fs.readFileSync(path.join(workspaceRoot, 'packages', packageName, 'package.json'), 'utf8'));
    assert.equal(manifest.private, true, `${packageName} publication safety control changed`);
  }
  assert.equal(fs.existsSync(path.resolve(workspaceRoot, '..', '.github', 'workflows', 'publish-journey-sdks.yml.disabled')), true);

  const outcomes = db.prepare(`SELECT outcome,COUNT(*) count FROM journey_event_ingest_receipts
    WHERE space_id=? GROUP BY outcome ORDER BY outcome`).all(owner.spaceId) as Array<{ outcome: string; count: number }>;
  const summary = {
    runtime: { node: process.version, browser: await browser.version(), database: 'ephemeral-sqlite' },
    consumers: { browser: 1, react: 1, nodeLoadEvents: loadIds.length },
    load: {
      waves: 3,
      eventsPerWave: 40,
      requests: batchLatenciesMs.length,
      p95BatchMs: Number(percentile95(batchLatenciesMs).toFixed(2))
    },
    reconciliation: {
      rawEvents,
      deduplicatedEvents,
      processingInbox,
      quarantinedEvents,
      meteredEvents,
      drift: 0
    },
    receipts: Object.fromEntries(outcomes.map((entry) => [entry.outcome, Number(entry.count)])),
    openReleaseBlockers: [
      'LEGAL_LICENSE_UNDECIDED',
      'NPM_SCOPE_AND_TRUSTED_PUBLISHER_UNVERIFIED',
      'SECURITY_PRIVACY_RATIFICATION_PENDING',
      'SUPPORTED_BROWSER_REACT_NODE_CI_MATRIX_PENDING',
      'PRODUCTION_POSTGRES_LOAD_SOAK_AND_SLO_RATIFICATION_PENDING'
    ]
  };
  process.stdout.write(`[journey-live-ingest] ${JSON.stringify(summary)}\n`);
});
