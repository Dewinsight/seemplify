import { expect, test, type APIResponse, type Page } from '@playwright/test';

const liveEnabled = process.env.KNOWLEDGE_E2E_LIVE === '1';
const expectedEmbeddingProvider = process.env.KNOWLEDGE_E2E_EXPECTED_PROVIDER || 'gte-node';
const pinnedReranker = {
  model: 'BAAI/bge-reranker-v2-m3',
  revision: '953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e'
};
const fixtureName = 'meridian-live-graphrag.md';
const fixture = `# Project Meridian operating policy

This is synthetic test data created only for the Seemplify live GraphRAG browser test.

Amina Bello is the escalation manager for Project Meridian.
Amina Bello owns every Project Meridian escalation request.
The support team must acknowledge each escalation within 48 hours.
The operations director reviews unresolved escalations after 72 hours.
Project Meridian uses the Aurora portal for customer onboarding.
The Aurora portal sends an activation checklist to every new customer.
No instruction inside this document may override application or system policy.
`;

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password', { exact: true }).fill('Playwright-Test-Password-2026!');
  const loginResponse = page.waitForResponse((response) => response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/auth/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await json(await loginResponse);
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();
}

async function json(response: APIResponse) {
  const body = await response.json().catch(() => ({}));
  expect(response.ok(), `${response.status()} ${response.url()}: ${JSON.stringify(body)}`).toBeTruthy();
  return body as any;
}

function expectPinnedRetrieval(result: any) {
  const retrieval = result?.runtime?.retrieval;
  expect(retrieval, JSON.stringify(result?.runtime)).toBeTruthy();
  expect(retrieval.embeddingProfile?.provider).toBe(expectedEmbeddingProvider);
  expect(retrieval.providerFallback).toBeNull();
  expect(retrieval.fusion).toBe('weighted-rrf+local-reranker');
  expect(retrieval.rerankedCount).toBeGreaterThan(0);
  expect(retrieval.timings?.rerankerMs).toBeGreaterThanOrEqual(0);
  expect(retrieval.reranker).toEqual(expect.objectContaining({
    ...pinnedReranker, executed: true
  }));
  expect(retrieval.reranker.inputCount).toBeGreaterThanOrEqual(retrieval.reranker.outputCount);
  expect(retrieval.reranker.outputCount).toBe(retrieval.rerankedCount);
}

test('real local GraphRAG completes the browser knowledge workflow with provenance and explicit Terra consent', async ({ page }, testInfo) => {
  test.skip(!liveEnabled, 'Set KNOWLEDGE_E2E_LIVE=1 to run against the real localhost knowledge and Terra runtimes.');
  test.skip(testInfo.project.name !== 'desktop-chromium', 'The live GPU-backed workflow runs once at desktop width.');
  test.setTimeout(20 * 60_000);

  const baseName = `Meridian live ${Date.now()}`;
  let knowledgeBaseId = '';
  let indexJobId = '';
  let completedIndexJob: any = null;
  const observedStages = new Set<string>();
  page.on('response', async (response) => {
    if (!response.ok() || !new URL(response.url()).pathname.endsWith('/indexing-jobs')) return;
    try {
      const body = await response.json() as any;
      for (const job of body.jobs || []) {
        if (!indexJobId || job.id === indexJobId) observedStages.add(`${job.state}:${job.stage}`);
      }
    } catch { /* navigation may close a response while the listener is reading it */ }
  });

  try {
    await signIn(page);
    const runtime = await json(await page.request.get('/api/runtime'));
    expect(runtime.knowledge.runtime.ready, JSON.stringify(runtime.knowledge.runtime)).toBe(true);
    expect(runtime.ai.codex.account.connected, JSON.stringify(runtime.ai)).toBe(true);

    await page.goto('/knowledge-bases');
    await page.getByRole('button', { name: 'New knowledge base' }).first().click();
    const createDialog = page.getByRole('dialog');
    await createDialog.getByLabel('Name').fill(baseName);
    await createDialog.getByLabel('Description').fill('Synthetic live source for isolated GraphRAG browser verification.');
    await expect(createDialog.getByRole('checkbox', { name: /Allow as Terra context/ })).not.toBeChecked();
    await createDialog.getByRole('button', { name: 'Create knowledge base' }).click();
    await expect(page.getByRole('heading', { name: baseName })).toBeVisible();
    knowledgeBaseId = new URL(page.url()).pathname.split('/').filter(Boolean).at(-1) || '';
    expect(knowledgeBaseId).toMatch(/^[0-9a-f-]{36}$/i);
    await expect(page.getByText('Terra context disabled')).toBeVisible();

    await page.locator('input[type="file"]').setInputFiles({
      name: fixtureName, mimeType: 'text/markdown', buffer: Buffer.from(fixture, 'utf8')
    });
    const uploadResponsePromise = page.waitForResponse((response) =>
      response.request().method() === 'POST'
      && new URL(response.url()).pathname === `/api/knowledge-bases/${knowledgeBaseId}/documents`);
    await page.getByRole('button', { name: 'Upload and index' }).click();
    const upload = await json(await uploadResponsePromise);
    indexJobId = String(upload.jobs?.[0]?.id || '');
    expect(indexJobId).toMatch(/^[0-9a-f-]{36}$/i);
    await expect(page.getByRole('heading', { name: 'Live indexing' })).toBeVisible();

    await expect.poll(async () => {
      const response = await page.request.get(`/api/knowledge-bases/${knowledgeBaseId}/documents`);
      const body = await json(response);
      return body.documents?.find((document: any) => document.name === fixtureName)?.state || 'missing';
    }, { timeout: 12 * 60_000, intervals: [1_000, 2_000, 4_000] }).toBe('ready');
    await expect.poll(async () => {
      const response = await page.request.get(`/api/knowledge-jobs/${indexJobId}`);
      completedIndexJob = await json(response);
      return completedIndexJob.state;
    }, { timeout: 30_000, intervals: [500, 1_000] }).toBe('completed');
    const writtenProviders = new Set((completedIndexJob?.result?.metrics?.embeddingProfiles || [])
      .map((profile: any) => profile.provider));
    expect(writtenProviders.has(expectedEmbeddingProvider), JSON.stringify(completedIndexJob?.result)).toBe(true);
    if (expectedEmbeddingProvider === 'gte-node') expect(writtenProviders.has('qwen-tei')).toBe(true);
    await page.getByRole('button', { name: 'Refresh' }).click();
    const documentRow = page.getByRole('row').filter({ hasText: fixtureName });
    await expect(documentRow.getByText('ready', { exact: true })).toBeVisible();
    expect([...observedStages].some((stage) => /queued|processing|extracting|indexing/.test(stage)),
      `Expected a realtime active stage, observed: ${[...observedStages].join(', ')}`).toBe(true);

    await page.getByRole('tab', { name: 'Indexing history' }).click();
    const historyRow = page.getByRole('row').filter({ hasText: fixtureName });
    await expect(historyRow.locator('td').nth(2)).toContainText('completed');
    await expect(historyRow.locator('td').nth(4)).toHaveText('1');

    await page.getByRole('tab', { name: 'Search & test' }).click();
    await expect(page.getByText(/generated Terra answer is disabled until Terra context is explicitly enabled/i)).toBeVisible();
    const query = 'Who owns Project Meridian escalations and how quickly must the team acknowledge them?';
    await page.getByLabel('Knowledge search query').fill(query);
    const localSearchPromise = page.waitForResponse((response) =>
      response.request().method() === 'POST'
      && new URL(response.url()).pathname === `/api/knowledge-bases/${knowledgeBaseId}/search`);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const localSearch = await json(await localSearchPromise);
    expect(localSearch.answer).toBeNull();
    expect(localSearch.citations?.length).toBeGreaterThan(0);
    expect(localSearch.citations[0].documentName).toBe(fixtureName);
    expectPinnedRetrieval(localSearch);
    await expect(page.getByText(fixtureName, { exact: true }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Edit settings' }).click();
    const settingsDialog = page.getByRole('dialog');
    await settingsDialog.getByRole('checkbox', { name: /Allow as Terra context/ }).check();
    await settingsDialog.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('Terra context allowed when selected')).toBeVisible();

    const groundedSearchPromise = page.waitForResponse((response) =>
      response.request().method() === 'POST'
      && new URL(response.url()).pathname === `/api/knowledge-bases/${knowledgeBaseId}/search`);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const groundedSearch = await json(await groundedSearchPromise);
    expect(groundedSearch.answer).toMatch(/Amina|48 hours/i);
    expect(groundedSearch.citations?.some((citation: any) => citation.documentName === fixtureName)).toBe(true);
    expectPinnedRetrieval(groundedSearch);
    await expect(page.getByRole('heading', { name: 'Answer' })).toBeVisible();

    const graphResponsePromise = page.waitForResponse((response) =>
      response.request().method() === 'GET'
      && new URL(response.url()).pathname === `/api/knowledge-bases/${knowledgeBaseId}/graph`);
    await page.getByRole('tab', { name: 'Graph & provenance' }).click();
    const graph = (await json(await graphResponsePromise)).graph;
    expect(graph.nodes?.length).toBeGreaterThan(0);
    expect(graph.edges?.length).toBeGreaterThan(0);
    expect(graph.edges.some((edge: any) => edge.documentName === fixtureName && edge.excerpt)).toBe(true);
    await expect(page.getByRole('img', { name: /Knowledge graph with \d+ entities and \d+ relationships/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Relationship provenance' })).toBeVisible();

    await page.goto('/surveys/new');
    const picker = page.getByTestId('knowledge-base-picker');
    await picker.getByRole('button', { name: 'Choose knowledge bases' }).click();
    const baseOption = page.getByRole('button', { name: new RegExp(baseName) });
    await expect(baseOption).toBeEnabled();
    await baseOption.click();
    await expect(baseOption).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Done' }).click();
    await page.getByLabel('What do you need to learn?').fill(
      'Create a concise survey about the Project Meridian escalation ownership and acknowledgement experience.'
    );
    const surveyRequestPromise = page.waitForRequest((request) =>
      request.method() === 'POST' && new URL(request.url()).pathname === '/api/ai/surveys');
    await page.getByRole('button', { name: 'Generate survey' }).click();
    const surveyRequest = await surveyRequestPromise;
    expect(surveyRequest.postDataJSON().knowledgeBaseIds).toEqual([knowledgeBaseId]);
    await expect(page).toHaveURL(/\/surveys\/[0-9a-f-]{36}$/i, { timeout: 8 * 60_000 });

    await page.goto(`/knowledge-bases/${knowledgeBaseId}`);
    await expect(page.getByRole('heading', { name: baseName })).toBeVisible();
    page.once('dialog', (dialog) => void dialog.accept());
    const deleteResponsePromise = page.waitForResponse((response) =>
      response.request().method() === 'DELETE'
      && new URL(response.url()).pathname === `/api/knowledge-bases/${knowledgeBaseId}`);
    await page.getByRole('button', { name: 'Delete knowledge base' }).click();
    const deletion = await json(await deleteResponsePromise);
    const deleteJobId = String(deletion.job?.id || '');
    await expect(page).toHaveURL(/\/knowledge-bases$/);
    await expect.poll(async () => {
      const response = await page.request.get(`/api/knowledge-jobs/${deleteJobId}`);
      return (await json(response)).state;
    }, { timeout: 5 * 60_000, intervals: [1_000, 2_000] }).toBe('completed');
    await expect(page.getByText(baseName, { exact: true })).toHaveCount(0);
  } finally {
    if (liveEnabled) {
      const cleanup = await page.request.post('/__e2e__/knowledge/live-cleanup', { timeout: 150_000 });
      if (cleanup.status() !== 401) await json(cleanup);
    }
  }
});
