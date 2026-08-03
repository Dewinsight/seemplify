import { expect, test, type Page, type Route } from '@playwright/test';

const now = '2026-07-30T10:00:00.000Z';
const knowledgeBase = {
  id: 'kb-product',
  name: 'Product playbook',
  description: 'Approved onboarding, account ownership, and support guidance.',
  privacy: 'space',
  terraContextEnabled: true,
  state: 'ready',
  documentCount: 2,
  readyDocumentCount: 1,
  chunkCount: 84,
  entityCount: 12,
  relationshipCount: 9,
  storageBytes: 24000,
  createdBy: 'qa-user',
  createdAt: now,
  updatedAt: now,
  lastIndexedAt: now
};

const readyDocument = {
  id: 'doc-playbook', knowledgeBaseId: knowledgeBase.id, name: 'onboarding-playbook.pdf', mimeType: 'application/pdf',
  size: 18000, state: 'ready', progress: 100, pageCount: 16, chunkCount: 62, entityCount: 12,
  error: null, createdAt: now, updatedAt: now, indexedAt: now
};

const processingDocument = {
  id: 'doc-faq', knowledgeBaseId: knowledgeBase.id, name: 'support-faq.docx',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 6000,
  state: 'embedding', progress: 64, pageCount: 5, chunkCount: 22, entityCount: 0,
  error: null, createdAt: now, updatedAt: now, indexedAt: null
};

const processingJob = {
  id: 'index-faq', knowledgeBaseId: knowledgeBase.id, documentId: processingDocument.id, documentName: processingDocument.name,
  state: 'processing', stage: 'embedding', progress: 64, attempt: 1, error: null,
  createdAt: now, startedAt: now, completedAt: null, updatedAt: now
};

const completedJob = {
  id: 'index-playbook', knowledgeBaseId: knowledgeBase.id, documentId: readyDocument.id, documentName: readyDocument.name,
  state: 'completed', stage: 'completed', progress: 100, attempt: 1, error: null,
  createdAt: '2026-07-30T09:55:00.000Z', startedAt: '2026-07-30T09:55:01.000Z',
  completedAt: '2026-07-30T09:55:04.500Z', updatedAt: '2026-07-30T09:55:04.500Z'
};

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password', { exact: true }).fill('Playwright-Test-Password-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();
}

async function mockKnowledgeApi(page: Page) {
  let uploaded = false;
  let retried = false;

  await page.route('**/api/knowledge-bases**', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const fulfill = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/api/knowledge-bases' && method === 'GET') {
      await fulfill({ knowledgeBases: [knowledgeBase, {
        ...knowledgeBase, id: 'kb-private', name: 'Leadership notes', privacy: 'private',
        terraContextEnabled: false, state: 'empty', documentCount: 0, readyDocumentCount: 0
      }] });
      return;
    }
    if (path === `/api/knowledge-bases/${knowledgeBase.id}` && method === 'GET') {
      await fulfill({ knowledgeBase: { ...knowledgeBase, documentCount: uploaded ? 3 : 2 } });
      return;
    }
    if (path === `/api/knowledge-bases/${knowledgeBase.id}` && method === 'PATCH') {
      await fulfill({ knowledgeBase: { ...knowledgeBase, ...request.postDataJSON() } });
      return;
    }
    if (path === `/api/knowledge-bases/${knowledgeBase.id}/documents` && method === 'GET') {
      const documents = [readyDocument, processingDocument];
      if (uploaded) documents.push({
        ...processingDocument, id: 'doc-notes', name: 'research-notes.md', mimeType: 'text/markdown',
        size: 54, state: 'queued', progress: 0, pageCount: null, chunkCount: 0
      });
      await fulfill({ documents });
      return;
    }
    if (path === `/api/knowledge-bases/${knowledgeBase.id}/documents` && method === 'POST') {
      uploaded = true;
      await fulfill({ accepted: 1, jobs: [{ id: 'index-notes' }] }, 202);
      return;
    }
    if (path === `/api/knowledge-bases/${knowledgeBase.id}/documents/${processingDocument.id}/retry` && method === 'POST') {
      retried = true;
      await fulfill({ jobId: 'index-faq-retry' }, 202);
      return;
    }
    if (path === `/api/knowledge-bases/${knowledgeBase.id}/indexing-jobs` && method === 'GET') {
      const jobs = [processingJob, completedJob];
      if (uploaded) jobs.unshift({ ...processingJob, id: 'index-notes', documentId: 'doc-notes', documentName: 'research-notes.md', state: 'queued', stage: 'queued', progress: 0 });
      if (retried) jobs.unshift({ ...processingJob, id: 'index-faq-retry', state: 'queued', stage: 'queued', progress: 0, attempt: 2 });
      await fulfill({ jobs });
      return;
    }
    if (path === `/api/knowledge-bases/${knowledgeBase.id}/search` && method === 'POST') {
      await fulfill({ result: {
        query: request.postDataJSON().query,
        answer: 'Account ownership transfers only after an authorised administrator confirms the request.',
        tookMs: 31,
        matches: [{ sourceRef: 'doc:playbook:p4', documentId: readyDocument.id, documentName: readyDocument.name, page: 4, section: 'Account ownership', excerpt: 'An authorised administrator must confirm ownership transfers.', score: 0.97 }],
        citations: [{ sourceRef: 'doc:playbook:p4', documentId: readyDocument.id, documentName: readyDocument.name, page: 4, section: 'Account ownership', excerpt: 'An authorised administrator must confirm ownership transfers.' }]
      } });
      return;
    }
    if (path === `/api/knowledge-bases/${knowledgeBase.id}/graph` && method === 'GET') {
      await fulfill({ graph: {
        stats: { documents: 2, chunks: 84, entities: 2, relationships: 1 }, updatedAt: now,
        nodes: [{ id: 'account', label: 'Account', kind: 'concept' }, { id: 'administrator', label: 'Administrator', kind: 'role' }],
        edges: [{ id: 'edge-1', source: 'administrator', target: 'account', label: 'authorises ownership transfer', confidence: 0.94, documentId: readyDocument.id, documentName: readyDocument.name, page: 4, excerpt: 'An authorised administrator must confirm ownership transfers.' }]
      } });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: `Unmocked ${method} ${path}` }) });
  });
}

test('knowledge workspace exposes durable live indexing, retrieval citations, and graph provenance', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'The full workspace is exercised once at desktop width.');
  await mockKnowledgeApi(page);
  await signIn(page);

  await page.goto('/knowledge-bases');
  await expect(page.getByRole('heading', { name: 'Knowledge bases' })).toBeVisible();
  await expect(page.getByText('Product playbook', { exact: true })).toBeVisible();
  await expect(page.getByText('Leadership notes', { exact: true })).toBeVisible();
  await page.getByText('Product playbook', { exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Product playbook' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Live indexing' })).toBeVisible();
  await expect(page.getByText('support-faq.docx', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('64%', { exact: true })).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({ name: 'research-notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Research notes\nApproved source.') });
  await expect(page.getByText('Ready to upload (1)')).toBeVisible();
  await page.getByRole('button', { name: 'Upload and index' }).click();
  await expect(page.getByText('research-notes.md', { exact: true }).first()).toBeVisible();

  await page.getByRole('tab', { name: 'Search & test' }).click();
  await page.getByLabel('Knowledge search query').fill('How does account ownership transfer?');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText(/Account ownership transfers only/)).toBeVisible();
  await expect(page.getByText('[doc:playbook:p4] onboarding-playbook.pdf')).toBeVisible();
  await expect(page.getByText('Page 4 · Account ownership')).toBeVisible();

  await page.getByRole('tab', { name: 'Graph & provenance' }).click();
  await expect(page.getByRole('img', { name: 'Knowledge graph with 2 entities and 1 relationships' })).toBeVisible();
  await expect(page.getByText('authorises ownership transfer')).toBeVisible();
  await expect(page.getByText(/94% confidence/)).toBeVisible();

  await page.getByRole('tab', { name: 'Indexing history' }).click();
  await expect(page.getByRole('heading', { name: 'Indexing history' })).toBeVisible();
  await expect(page.getByText('onboarding-playbook.pdf', { exact: true })).toBeVisible();
  await expect(page.getByText('completed', { exact: true }).first()).toBeVisible();
});

test('survey grounding starts empty and sends only the explicitly selected knowledge bases', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Explicit grounding payload is exercised once.');
  await mockKnowledgeApi(page);
  await page.route('**/api/templates', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  let generatedBody: Record<string, unknown> | null = null;
  await page.route('**/api/ai/surveys', async (route) => {
    generatedBody = route.request().postDataJSON();
    await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ jobId: 'grounded-survey-job' }) });
  });
  await page.route('**/api/ai/jobs/grounded-survey-job', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    id: 'grounded-survey-job', kind: 'survey.generate', surveyId: null, responseId: null, state: 'processing', stage: 'generating', progress: 20,
    attempt: 1, input: {}, result: null, error: null, retryAt: null, createdAt: now, startedAt: now, completedAt: null, updatedAt: now
  }) }));
  await signIn(page);

  await page.goto('/surveys/new');
  const picker = page.getByTestId('knowledge-base-picker');
  await expect(picker.getByText('0 of 5 selected')).toBeVisible();
  await picker.getByRole('button', { name: 'Choose knowledge bases' }).click();
  await expect(page.getByText('Nothing is selected automatically. Shared AI outputs can use only ready, space-visible knowledge bases that allow Terra context.')).toBeVisible();
  const productOption = page.getByRole('button', { name: /Product playbook/ });
  await expect(productOption).toHaveAttribute('aria-pressed', 'false');
  await productOption.click();
  await expect(productOption).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(picker.getByText('1 of 5 selected')).toBeVisible();

  await page.getByLabel('What do you need to learn?').fill('Understand why new customers abandon onboarding and what helps them finish setup.');
  await page.getByRole('button', { name: 'Generate survey' }).click();
  await expect.poll(() => generatedBody).not.toBeNull();
  expect(generatedBody?.knowledgeBaseIds).toEqual([knowledgeBase.id]);
});

test('knowledge management stays usable without page-level overflow on mobile', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'This check targets the compact workspace layout.');
  await mockKnowledgeApi(page);
  await signIn(page);

  await page.goto('/knowledge-bases');
  await expect(page.getByRole('heading', { name: 'Knowledge bases' })).toBeVisible();
  await page.getByText('Product playbook', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Product playbook' })).toBeVisible();
  await expect(page.getByText('Drop files here or choose from your computer')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Live indexing' })).toBeVisible();

  await page.getByRole('tab', { name: 'Indexing history' }).click();
  await expect(page.getByRole('heading', { name: 'Indexing history' })).toBeVisible();
  const viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth
  }));
  expect(viewport.documentWidth).toBeLessThanOrEqual(viewport.width + 1);
  expect(viewport.bodyWidth).toBeLessThanOrEqual(viewport.width + 1);
});
