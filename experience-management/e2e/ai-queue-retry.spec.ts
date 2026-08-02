import { expect, test } from '@playwright/test';

test('AI queue retries an eligible failed job once and explains ineligible failures', async ({ page }, testInfo) => {
  test.skip(Boolean(process.env.PLAYWRIGHT_EXTERNAL_URL), 'This test uses deterministic mocked AI queue responses.');

  await page.goto('/login');
  await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password').fill('Playwright-Test-Password-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();

  const now = new Date().toISOString();
  const eligibleId = 'failed-social-analysis';
  const ineligibleId = 'failed-translation';
  const eligible = {
    id: eligibleId, kind: 'social.analyze', surveyId: null, responseId: null,
    state: 'failed', stage: 'failed', progress: 100, attempt: 3, input: { mentionIds: ['saved-post-1'] }, result: null,
    error: 'Terra returned evidence outside the saved sources.', retryAt: null, createdAt: now, startedAt: now,
    completedAt: now, updatedAt: now, retry: { eligible: true, reason: null }, knowledgeContext: null
  };
  const ineligible = {
    id: ineligibleId, kind: 'survey.translate', surveyId: 'survey-1', responseId: null,
    state: 'failed', stage: 'failed', progress: 100, attempt: 1, input: {}, result: null,
    error: 'The survey changed after this request.', retryAt: null, createdAt: now, startedAt: now,
    completedAt: now, updatedAt: now,
    retry: { eligible: false, reason: 'Restart this translation from the survey so it uses the current saved version.' }, knowledgeContext: null
  };
  let jobs = [eligible, ineligible];
  let listRequests = 0;
  let retryRequests = 0;
  let releaseRetry!: () => void;
  let markRetrySeen!: () => void;
  const retryRelease = new Promise<void>((resolve) => { releaseRetry = resolve; });
  const retrySeen = new Promise<void>((resolve) => { markRetrySeen = resolve; });

  await page.route(/\/api\/ai\/jobs(?:\?.*)?$/, async (route) => {
    listRequests += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(jobs) });
  });
  await page.route(/\/api\/ai\/jobs\/[^/?]+(?:\?.*)?$/, async (route) => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1);
    const job = jobs.find((item) => item.id === id);
    await route.fulfill({ status: job ? 200 : 404, contentType: 'application/json', body: JSON.stringify(job || { error: 'AI job not found.' }) });
  });
  await page.route(`**/api/ai/jobs/${eligibleId}/retry`, async (route) => {
    retryRequests += 1;
    markRetrySeen();
    await retryRelease;
    const queued = { ...eligible, state: 'queued', stage: 'queued', progress: 0, attempt: 0, error: null, startedAt: null, completedAt: null, updatedAt: new Date().toISOString(), retry: { eligible: false, reason: 'This job is already queued.' } };
    jobs = [queued, ineligible];
    await route.fulfill({
      status: 202, contentType: 'application/json',
      body: JSON.stringify({ job: queued, jobId: queued.id, state: queued.state, restarted: true, journalReused: false, statusUrl: `/api/ai/jobs/${queued.id}` })
    });
  });
  await page.route('**/api/runtime', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ terra: { ready: true, providerLabel: 'Terra test runtime' }, worker: { active: 0, concurrency: 1 } })
  }));

  await page.goto('/ai-queue');
  await expect(page.getByRole('heading', { name: 'Experience AI queue' })).toBeVisible();
  const eligibleRow = page.getByRole('row').filter({ hasText: 'Social listening analysis' }).first();
  const ineligibleRow = page.getByRole('row').filter({ hasText: 'Survey translation' }).first();

  await expect(eligibleRow.getByRole('button', { name: 'Retry', exact: true })).toBeEnabled();
  await expect(ineligibleRow.getByRole('button', { name: 'Retry', exact: true })).toBeDisabled();
  await expect(ineligibleRow.getByText('Restart this translation from the survey so it uses the current saved version.')).toBeVisible();

  await eligibleRow.getByRole('button', { name: 'Details' }).click();
  await expect(page.getByText('Recorded failure', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Retry status')).toContainText('same durable job and saved inputs');

  await eligibleRow.getByRole('button', { name: 'Retry', exact: true }).click();
  await retrySeen;
  const pending = eligibleRow.getByRole('button', { name: 'Retrying', exact: true });
  await expect(pending).toBeDisabled();
  await expect(pending).toHaveAttribute('aria-busy', 'true');
  expect(retryRequests).toBe(1);

  releaseRetry();
  await expect(page.getByText('Retry queued for the same durable job.', { exact: true })).toBeVisible();
  await expect(eligibleRow.getByText('queued', { exact: true }).first()).toBeVisible();
  await expect(eligibleRow.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  await expect.poll(() => listRequests).toBeGreaterThan(1);
  expect(retryRequests).toBe(1);
});
