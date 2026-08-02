import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { Client } from 'pg';

const accountPassword = 'Experience-Retry-2026!';

type AccountIdentity = {
  userId: string;
  spaceId: string;
};

type RetryResponse = {
  jobId: string;
  restarted: boolean;
  state: string;
};

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

  const issued = await api.post('/__e2e__/auth/verification-token', {
    data: { email: input.email }
  });
  expect(issued.status(), await issued.text()).toBe(200);
  const { token } = await issued.json() as { token: string };

  const verified = await api.post('/api/auth/verify-email', { data: { token } });
  expect(verified.status(), await verified.text()).toBe(200);

  const onboarded = await api.post('/api/account/onboarding', {
    data: {
      name: input.name,
      email: input.email,
      jobTitle: 'PostgreSQL retry tester',
      organizationName: input.spaceName,
      timezone: 'Europe/London',
      primaryGoal: 'customer_experience',
      spaceName: input.spaceName
    }
  });
  expect(onboarded.status(), await onboarded.text()).toBe(200);
  const session = await onboarded.json() as {
    user: { id: string };
    activeSpace: { id: string };
  };
  expect(session.user.id).toBeTruthy();
  expect(session.activeSpace.id).toBeTruthy();
  return { userId: session.user.id, spaceId: session.activeSpace.id };
}

test('PostgreSQL retry is atomic, idempotent, and tenant scoped', async ({ request, playwright }, testInfo) => {
  test.skip(
    process.env.EXPERIENCE_E2E_DATABASE_PROVIDER !== 'postgres',
    'This regression requires the isolated test:e2e:postgres database.'
  );

  const suffix = crypto.randomUUID();
  const owner = await signUpVerifyAndOnboard(request, {
    name: 'Postgres Retry Owner',
    email: `retry-owner-${suffix}@example.test`,
    spaceName: `Retry owner ${suffix.slice(0, 8)}`
  });
  const baseURL = String(testInfo.project.use.baseURL || '');
  expect(baseURL).toMatch(/^http:\/\/127\.0\.0\.1:5412$/u);
  const outsiderApi = await playwright.request.newContext({ baseURL });
  const outsider = await signUpVerifyAndOnboard(outsiderApi, {
    name: 'Postgres Retry Outsider',
    email: `retry-outsider-${suffix}@example.test`,
    spaceName: `Retry outsider ${suffix.slice(0, 8)}`
  });

  const client = postgresClient();
  await client.connect();
  try {
    const mentionId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    const timestamp = new Date(Date.now() - 60_000).toISOString();
    await client.query(`INSERT INTO social_mentions
      (id,space_id,source,external_id,author,content,url,language,published_at,metadata_json,created_at)
      VALUES ($1,$2,'other',$3,'@postgres-retry','The saved source reports a retry-safe service issue.','','en',$4,'{}',$4)`,
      [mentionId, owner.spaceId, crypto.randomUUID(), timestamp]);
    await client.query(`INSERT INTO ai_jobs
      (id,space_id,kind,requested_by,state,stage,progress,attempt,input_json,error,created_at,completed_at,updated_at)
      VALUES ($1,$2,'social.analyze',$3,'failed','failed',100,3,$4,$5,$6,$6,$6)`, [
      jobId,
      owner.spaceId,
      owner.userId,
      JSON.stringify({ mentionIds: [mentionId] }),
      'Synthetic terminal failure for the PostgreSQL retry regression.',
      timestamp
    ]);

    const hiddenDetail = await outsiderApi.get(`/api/ai/jobs/${jobId}`);
    expect(hiddenDetail.status()).toBe(404);
    const hiddenRetry = await outsiderApi.post(`/api/ai/jobs/${jobId}/retry`, { data: {} });
    expect(hiddenRetry.status()).toBe(404);

    const [first, second] = await Promise.all([
      request.post(`/api/ai/jobs/${jobId}/retry`, { data: {} }),
      request.post(`/api/ai/jobs/${jobId}/retry`, { data: {} })
    ]);
    expect([first.status(), second.status()].sort()).toEqual([202, 202]);
    const retries = await Promise.all([
      first.json() as Promise<RetryResponse>,
      second.json() as Promise<RetryResponse>
    ]);
    expect(retries.map((retry) => retry.restarted).sort()).toEqual([false, true]);
    expect(new Set(retries.map((retry) => retry.jobId))).toEqual(new Set([jobId]));

    const persisted = await client.query<{
      id: string;
      space_id: string;
      input_json: string;
      row_count: string;
    }>(`SELECT id,space_id,input_json,COUNT(*) OVER ()::text row_count
      FROM ai_jobs WHERE id=$1`, [jobId]);
    expect(persisted.rows).toHaveLength(1);
    expect(persisted.rows[0].row_count).toBe('1');
    expect(persisted.rows[0].space_id).toBe(owner.spaceId);
    expect(persisted.rows[0].space_id).not.toBe(outsider.spaceId);
    const input = JSON.parse(persisted.rows[0].input_json) as {
      terraExecutionGeneration?: number;
      terraManualRetryCount?: number;
      terraManualRetryHistory?: unknown[];
    };
    expect(input.terraExecutionGeneration).toBe(1);
    expect(input.terraManualRetryCount).toBe(1);
    expect(input.terraManualRetryHistory).toHaveLength(1);
  } finally {
    await client.end();
    await outsiderApi.dispose();
  }
});
