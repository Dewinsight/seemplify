import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { Client } from 'pg';

const accountPassword = 'Experience-Usage-2026!';

type AccountIdentity = { userId: string; spaceId: string };

function postgresClient() {
  const runId = String(process.env.EXPERIENCE_POSTGRES_E2E_RUN_ID || '');
  const host = String(process.env.POSTGRES_HOST || '');
  const database = String(process.env.POSTGRES_DATABASE || '');
  const user = String(process.env.POSTGRES_USER || '');
  const passwordFile = path.resolve(String(process.env.POSTGRES_PASSWORD_FILE || ''));
  const temporaryRoot = path.resolve(os.tmpdir());

  expect(runId).toMatch(/^[a-f0-9]{12}$/u);
  expect(['127.0.0.1', '::1', 'localhost']).toContain(host);
  expect(database).toBe(`experience_e2e_${runId}`);
  expect(user).toBe(`experience_e2e_app_${runId}`);
  expect(passwordFile.startsWith(`${temporaryRoot}${path.sep}experience-pg-e2e-`)).toBe(true);
  return new Client({
    host,
    port: Number(process.env.POSTGRES_PORT),
    database,
    user,
    password: fs.readFileSync(passwordFile, 'utf8').trim(),
    ssl: false
  });
}

async function signUpVerifyAndOnboard(
  api: APIRequestContext,
  input: { name: string; email: string; spaceName: string }
): Promise<AccountIdentity> {
  const signup = await api.post('/api/auth/signup', {
    data: { name: input.name, email: input.email, password: accountPassword }
  });
  expect(signup.status(), await signup.text()).toBe(202);
  const issued = await api.post('/__e2e__/auth/verification-token', { data: { email: input.email } });
  expect(issued.status(), await issued.text()).toBe(200);
  const { token } = await issued.json() as { token: string };
  const verified = await api.post('/api/auth/verify-email', { data: { token } });
  expect(verified.status(), await verified.text()).toBe(200);
  const onboarded = await api.post('/api/account/onboarding', {
    data: {
      name: input.name,
      email: input.email,
      jobTitle: 'PostgreSQL usage tester',
      organizationName: input.spaceName,
      timezone: 'Europe/London',
      primaryGoal: 'customer_experience',
      spaceName: input.spaceName
    }
  });
  expect(onboarded.status(), await onboarded.text()).toBe(200);
  const session = await onboarded.json() as { user: { id: string }; activeSpace: { id: string } };
  return { userId: session.user.id, spaceId: session.activeSpace.id };
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

type AdmissionProbeResult = {
  ok: boolean;
  operation: 'direct' | 'durable';
  code?: string | null;
  status?: number | null;
  jobId?: string;
  receipt?: { id: string; replayed: boolean };
};

function startAdmissionProbe(
  operation: 'direct' | 'durable',
  identity: AccountIdentity,
  requestKey: string
) {
  const probePath = path.resolve(process.cwd(), 'e2e', 'support', 'ai-admission-probe.mjs');
  const child = spawn(process.execPath, [probePath, operation, identity.spaceId, identity.userId, requestKey], {
    cwd: process.cwd(), env: process.env, stdio: ['pipe', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  let readySettled = false;
  let resultSettled = false;
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  let resolveResult!: (value: AdmissionProbeResult) => void;
  let rejectResult!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const result = new Promise<AdmissionProbeResult>((resolve, reject) => {
    resolveResult = resolve; rejectResult = reject;
  });
  const parseOutput = () => {
    const lines = stdout.split(/\r?\n/u);
    stdout = lines.pop() || '';
    for (const line of lines) {
      let parsed: any;
      try { parsed = JSON.parse(line); } catch { continue; }
      if (parsed?.ready === true && !readySettled) {
        readySettled = true;
        resolveReady();
      } else if (typeof parsed?.ok === 'boolean' && !resultSettled) {
        resultSettled = true;
        resolveResult(parsed as AdmissionProbeResult);
      }
    }
  };
  child.stdout.on('data', (chunk) => { stdout += String(chunk); parseOutput(); });
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  child.once('error', (error) => {
    if (!readySettled) { readySettled = true; rejectReady(error); }
    if (!resultSettled) { resultSettled = true; rejectResult(error); }
  });
  child.once('exit', (code) => {
    parseOutput();
    const error = new Error(`AI admission probe exited ${code}: ${stderr.slice(0, 1_000)}`);
    if (!readySettled) { readySettled = true; rejectReady(error); }
    if (!resultSettled) { resultSettled = true; rejectResult(error); }
  });
  return {
    ready,
    result,
    go: () => child.stdin.end('GO\n'),
    stop: () => { if (!child.killed) child.kill(); }
  };
}

test('monthlyJourneyExports serializes quota and idempotency decisions behind a PostgreSQL space mutex', async ({ request }) => {
  test.skip(process.env.EXPERIENCE_E2E_DATABASE_PROVIDER !== 'postgres',
    'This concurrency regression requires the isolated PostgreSQL gate.');
  const suffix = crypto.randomUUID();
  const owner = await signUpVerifyAndOnboard(request, {
    name: 'Usage Ledger Owner',
    email: `usage-ledger-${suffix}@example.test`,
    spaceName: `Usage ledger ${suffix.slice(0, 8)}`
  });
  const blocker = postgresClient();
  const observer = postgresClient();
  await Promise.all([blocker.connect(), observer.connect()]);
  try {
    const subscription = await observer.query<{ plan_code: string }>(
      'SELECT plan_code FROM platform_subscriptions WHERE space_id=$1', [owner.spaceId]
    );
    expect(subscription.rows).toHaveLength(1);
    const updated = await observer.query(`UPDATE platform_subscription_plans
      SET limits_json=(limits_json::jsonb || $1::jsonb)::text,version=version+1,updated_at=$2
      WHERE code=$3`, [
      JSON.stringify({ monthlyJourneyExports: 2 }), new Date().toISOString(), subscription.rows[0].plan_code
    ]);
    expect(updated.rowCount).toBe(1);
    const current = await request.get('/api/subscriptions/current', {
      headers: { 'X-Seemplify-Space': owner.spaceId }
    });
    expect(current.status(), await current.text()).toBe(200);
    const exportUsage = ((await current.json() as { meteredUsage: Array<{ quota: string; limit: number }> }).meteredUsage)
      .find((item) => item.quota === 'monthlyJourneyExports');
    expect(exportUsage?.limit).toBe(2);
    const created = await request.post('/api/journey-maps', {
      headers: { 'X-Seemplify-Space': owner.spaceId },
      data: { name: `Metered concurrency ${suffix}`, stageNames: ['Discover'] }
    });
    expect(created.status(), await created.text()).toBe(201);
    const definitionId = String((await created.json() as { id: string }).id);
    const exportUrl = `/api/journey-maps/${definitionId}/export.json`;

    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM spaces WHERE id=$1 FOR UPDATE', [owner.spaceId]);
    let settled = 0;
    const sameKeyRequests = [0, 1].map(() => request.get(exportUrl, {
      headers: { 'X-Seemplify-Space': owner.spaceId, 'Idempotency-Key': `same-${suffix}` }
    }).finally(() => { settled += 1; }));
    await delay(150);
    expect(settled, 'the production usage transaction must wait on a mutex held by another DB session').toBe(0);
    await blocker.query('COMMIT');
    const sameKey = await Promise.all(sameKeyRequests);
    expect(sameKey.map((response) => response.status()).sort()).toEqual([200, 200]);
    expect(sameKey.map((response) => response.headers()['x-seemplify-usage-replayed']).sort()).toEqual(['false', 'true']);
    expect(new Set(sameKey.map((response) => response.headers()['x-seemplify-usage-receipt'])).size).toBe(1);

    const firstAccounting = await observer.query<{ events: string; bucket: string }>(`SELECT
      (SELECT COUNT(*)::text FROM platform_usage_events
        WHERE space_id=$1 AND meter='monthlyJourneyExports') events,
      (SELECT quantity::text FROM platform_usage_buckets
        WHERE space_id=$1 AND meter='monthlyJourneyExports') bucket`, [owner.spaceId]);
    expect(firstAccounting.rows[0]).toEqual({ events: '1', bucket: '1' });

    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM spaces WHERE id=$1 FOR UPDATE', [owner.spaceId]);
    settled = 0;
    const finalAllowanceRequests = ['second', 'third'].map((key) => request.get(exportUrl, {
      headers: { 'X-Seemplify-Space': owner.spaceId, 'Idempotency-Key': `${key}-${suffix}` }
    }).finally(() => { settled += 1; }));
    await delay(150);
    expect(settled).toBe(0);
    await blocker.query('COMMIT');
    const finalAllowance = await Promise.all(finalAllowanceRequests);
    expect(finalAllowance.map((response) => response.status()).sort()).toEqual([200, 409]);
    const denied = finalAllowance.find((response) => response.status() === 409)!;
    expect((await denied.json() as { code: string }).code).toBe('SUBSCRIPTION_QUOTA_EXCEEDED');

    const finalAccounting = await observer.query<{ events: string; bucket: string }>(`SELECT
      (SELECT COUNT(*)::text FROM platform_usage_events
        WHERE space_id=$1 AND meter='monthlyJourneyExports') events,
      (SELECT quantity::text FROM platform_usage_buckets
        WHERE space_id=$1 AND meter='monthlyJourneyExports') bucket`, [owner.spaceId]);
    expect(finalAccounting.rows[0]).toEqual({ events: '2', bucket: '2' });
  } finally {
    try { await blocker.query('ROLLBACK'); } catch { /* transaction may already be closed */ }
    await Promise.all([blocker.end(), observer.end()]);
  }
});

test('direct and durable AI admissions share one PostgreSQL quota mutex and cannot overshoot', async ({ request }) => {
  test.skip(process.env.EXPERIENCE_E2E_DATABASE_PROVIDER !== 'postgres',
    'This concurrency regression requires the isolated PostgreSQL gate.');
  const suffix = crypto.randomUUID();
  const owner = await signUpVerifyAndOnboard(request, {
    name: 'Mixed AI Admission Owner',
    email: `mixed-ai-${suffix}@example.test`,
    spaceName: `Mixed AI ${suffix.slice(0, 8)}`
  });
  const blocker = postgresClient();
  const observer = postgresClient();
  await Promise.all([blocker.connect(), observer.connect()]);
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const directProbe = startAdmissionProbe('direct', owner, `mixed-direct-${suffix}`);
  const durableProbe = startAdmissionProbe('durable', owner, `mixed-durable-${suffix}`);
  try {
    const subscription = await observer.query<{ plan_code: string }>(
      'SELECT plan_code FROM platform_subscriptions WHERE space_id=$1', [owner.spaceId]
    );
    expect(subscription.rows).toHaveLength(1);
    const updated = await observer.query(`UPDATE platform_subscription_plans
      SET limits_json=(limits_json::jsonb || $1::jsonb)::text,version=version+1,updated_at=$2
      WHERE code=$3`, [JSON.stringify({ monthlyAiActions: 1 }), now.toISOString(), subscription.rows[0].plan_code]);
    expect(updated.rowCount).toBe(1);

    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM spaces WHERE id=$1 FOR UPDATE', [owner.spaceId]);
    await Promise.all([directProbe.ready, durableProbe.ready]);
    let settled = 0;
    void directProbe.result.then(() => { settled += 1; }, () => { settled += 1; });
    void durableProbe.result.then(() => { settled += 1; }, () => { settled += 1; });
    directProbe.go();
    durableProbe.go();
    await delay(150);
    expect(settled, 'both production admission transactions must wait behind the space mutex').toBe(0);
    await blocker.query('COMMIT');

    const results = await Promise.all([directProbe.result, durableProbe.result]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      expect.objectContaining({ code: 'SUBSCRIPTION_QUOTA_EXCEEDED', status: 409 })
    ]);
    const winner = results.find((result) => result.ok)!;
    const accounting = await observer.query<{
      events: string; bucket: string; jobs: string; source_type: string;
    }>(`SELECT
      (SELECT COUNT(*)::text FROM platform_usage_events
        WHERE space_id=$1 AND meter='monthlyAiActions' AND period_start=$2) events,
      COALESCE((SELECT quantity::text FROM platform_usage_buckets
        WHERE space_id=$1 AND meter='monthlyAiActions' AND period_start=$2),'0') bucket,
      (SELECT COUNT(*)::text FROM ai_jobs WHERE space_id=$1) jobs,
      (SELECT source_type FROM platform_usage_events
        WHERE space_id=$1 AND meter='monthlyAiActions' AND period_start=$2 LIMIT 1) source_type`,
    [owner.spaceId, periodStart]);
    expect(accounting.rows[0]).toEqual({
      events: '1',
      bucket: '1',
      jobs: winner.operation === 'durable' ? '1' : '0',
      source_type: winner.operation === 'durable' ? 'durable_ai_job_attempt' : 'direct_ai_action'
    });

    const current = await request.get('/api/subscriptions/current', {
      headers: { 'X-Seemplify-Space': owner.spaceId }
    });
    expect(current.status(), await current.text()).toBe(200);
    const usage = ((await current.json() as { meteredUsage: Array<{ quota: string; used: number; limit: number }> })
      .meteredUsage).find((item) => item.quota === 'monthlyAiActions');
    expect(usage).toEqual(expect.objectContaining({ used: 1, limit: 1 }));
  } finally {
    directProbe.stop();
    durableProbe.stop();
    try { await blocker.query('ROLLBACK'); } catch { /* transaction may already be closed */ }
    await Promise.all([blocker.end(), observer.end()]);
  }
});
