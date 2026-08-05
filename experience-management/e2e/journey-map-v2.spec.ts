import { expect, test, type Page } from '@playwright/test';

const password = 'Playwright-Test-Password-2026!';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();
}

async function openWorkspace(page: Page, name: string) {
  await page.goto('/journey-maps');
  await expect(page.getByTestId('journey-maps-page')).toBeVisible();
  await page.getByTestId('new-map-name').fill(name);
  await page.getByTestId('create-map').click();
  await expect(page.getByTestId('journey-map-name')).toHaveText(name);
  return page.getByTestId('journey-workspace');
}

async function createKnowledgeEvidence(page: Page, suffix: string) {
  const created = await page.request.post('/api/knowledge-bases', {
    data: {
      name: `Journey research ${suffix}`,
      description: 'Playwright evidence source for Journey Map 2.0.',
      privacy: 'space'
    }
  });
  expect(created.status(), 'the knowledge base fixture could not be created').toBe(201);
  const knowledgeBase = (await created.json()).knowledgeBase;
  const filename = `journey-evidence-${suffix}.md`;
  const uploaded = await page.request.post(`/api/knowledge-bases/${knowledgeBase.id}/documents`, {
    multipart: {
      files: {
        name: filename,
        mimeType: 'text/markdown',
        buffer: Buffer.from('Customers report that setup instructions take too long to follow.')
      }
    }
  });
  expect(uploaded.status(), 'the knowledge document fixture could not be uploaded').toBe(202);
  const documentId = String((await uploaded.json()).documents[0].id);
  return { filename, documentId };
}

test('a designed map becomes evidence-backed only when a claim cites a real source', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'The stage/lane grid is exercised on one desktop browser.');
  await signIn(page);
  const suffix = String(Date.now());
  const source = await createKnowledgeEvidence(page, suffix);
  const workspace = await openWorkspace(page, `Evidence journey ${suffix}`);

  // A new map is a hypothesis until evidence exists. The mode badge is derived,
  // so it must not be possible to set it by hand.
  await expect(page.getByTestId('journey-mode')).toHaveText('Designed');

  await page.getByTestId('new-stage-name').fill('Onboard');
  await page.getByTestId('add-stage').click();
  await expect(page.getByTestId('stage-header-s01-onboard')).toBeVisible();

  await page.getByTestId('add-card-s01-onboard-pain_points').click();
  await expect(page.getByTestId('add-card-dialog')).toBeVisible();
  await page.getByTestId('card-title').fill('Setup takes too long');
  await page.getByTestId('save-card').click();
  await expect(page.getByTestId('add-card-dialog')).toBeHidden();

  const card = workspace.locator('[data-testid^="card-evidence-"][data-evidence-state]').first();
  await expect(card).toHaveAttribute('data-evidence-state', 'hypothesis');
  await expect(page.getByTestId('tab-gaps')).toHaveText('Research gaps (1)');

  await page.locator('[data-testid^="card-evidence-open-"]').first().click();
  await expect(page.getByTestId('evidence-drawer')).toBeVisible();
  await page.getByTestId('evidence-source-search').fill(source.filename);
  await page.getByTestId('search-evidence-sources').click();
  const sourceResults = page.getByTestId('evidence-source-results');
  await expect(sourceResults).toContainText(source.filename);
  await expect(sourceResults).toContainText(`knowledge-document:${source.documentId}`);
  await sourceResults.getByRole('radio', { name: `Select ${source.filename}` }).check();
  await page.getByTestId('attach-evidence').click();
  const evidenceLinks = page.getByTestId('evidence-links');
  await expect(evidenceLinks.locator('li')).toHaveCount(1);
  await expect(evidenceLinks).toContainText(source.filename);
  await expect(evidenceLinks).toContainText(`knowledge-document:${source.documentId}`);
  await expect(evidenceLinks.getByRole('link', { name: 'Open source' })).toHaveAttribute(
    'href', /\/knowledge-bases\//u
  );
  await page.getByTestId('close-evidence').click();
  await expect(page.getByTestId('evidence-drawer')).toBeHidden();

  await expect(card).toHaveAttribute('data-evidence-state', 'anecdotal');
  await expect(page.getByTestId('journey-mode')).toHaveText('Evidence-backed');
  await expect(page.getByTestId('tab-gaps')).toHaveText('Research gaps (1)');
});

test('the evidence drawer redacts inaccessible sources and explicitly refreshes changed snapshots', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'The evidence lifecycle drawer is exercised on one desktop browser.');
  await signIn(page);
  await openWorkspace(page, `Evidence lifecycle ${Date.now()}`);
  await page.getByTestId('new-stage-name').fill('Resolve');
  await page.getByTestId('add-stage').click();
  await page.getByTestId('add-card-s01-resolve-pain_points').click();
  await page.getByTestId('card-title').fill('Support context is incomplete');
  await page.getByTestId('save-card').click();

  const now = '2026-08-04T12:00:00.000Z';
  const baseLink = {
    targetType: 'card', targetId: 'mock-card', sourceType: 'knowledge_document',
    assessment: 'supports', confidence: 0.8, population: 'Active customers', sampleSize: 12,
    collectedAt: '2026-08-01T12:00:00.000Z', windowStart: null, windowEnd: null, freshnessDays: 30,
    sourceUpdatedAt: '2026-08-02T12:00:00.000Z', lastValidatedAt: '2026-08-02T12:00:00.000Z',
    invalidatedAt: null, invalidatedReason: null, createdBy: 'mock-user', createdAt: now, updatedAt: now
  };
  let changedLink = {
    ...baseLink, id: 'mock-changed', sourceRef: 'knowledge-document:mock', sourceLabel: 'Stored source title',
    excerpt: 'Stored evidence snapshot.', sourceAccess: 'available', refreshStatus: 'changed',
    changedFields: ['sourceLabel', 'excerpt'], snapshotFingerprint: 'stored-fingerprint'
  };
  const inaccessibleLink = {
    ...baseLink, id: 'mock-inaccessible', sourceRef: 'restricted', sourceLabel: 'Linked source unavailable',
    excerpt: '', population: '', sampleSize: null, collectedAt: null, sourceUpdatedAt: null,
    sourceAccess: 'inaccessible', refreshStatus: 'unavailable', changedFields: [], snapshotFingerprint: 'hidden-fingerprint'
  };
  const sourceReads: string[] = [];
  let refreshBody: unknown = null;

  await page.route(/\/api\/journey-evidence\?.*/u, async (route) => {
    await route.fulfill({ json: { links: [changedLink, inaccessibleLink] } });
  });
  await page.route('**/api/journey-evidence/*/source', async (route) => {
    const linkId = new URL(route.request().url()).pathname.split('/').at(-2) || '';
    sourceReads.push(linkId);
    await route.fulfill({ json: { source: {
      sourceType: 'knowledge_document', sourceRef: 'knowledge-document:mock', sourceId: 'mock',
      label: 'Updated source title', excerpt: 'Updated source evidence.', collectedAt: now, sampleSize: 12,
      population: 'Active customers', windowStart: null, windowEnd: null, state: 'ready', updatedAt: now,
      path: '/knowledge-bases/mock', metadata: {}
    } } });
  });
  await page.route('**/api/journey-evidence/mock-changed/refresh', async (route) => {
    refreshBody = route.request().postDataJSON();
    changedLink = {
      ...changedLink, sourceLabel: 'Updated source title', excerpt: 'Updated source evidence.',
      sourceUpdatedAt: now, lastValidatedAt: now, refreshStatus: 'current', changedFields: [],
      snapshotFingerprint: 'refreshed-fingerprint'
    };
    await route.fulfill({ json: changedLink });
  });

  await page.locator('[data-testid^="card-evidence-open-"]').first().click();
  await expect(page.getByTestId('evidence-drawer')).toBeVisible();
  await expect(page.getByTestId('evidence-unavailable-mock-inaccessible')).toContainText('Linked source unavailable');
  await expect(page.getByTestId('evidence-unavailable-mock-inaccessible')).not.toContainText('hidden-fingerprint');
  await expect(page.getByTestId('evidence-changed-mock-changed')).toContainText('Source name, Excerpt');
  expect(sourceReads).toEqual(['mock-changed']);

  await page.getByTestId('refresh-evidence-mock-changed').click();
  await expect(page.getByTestId('evidence-changed-mock-changed')).toBeHidden();
  await expect(page.getByTestId('evidence-validated-mock-changed')).not.toContainText('not recorded');
  expect(refreshBody).toEqual({ expectedFingerprint: 'stored-fingerprint' });
  expect(sourceReads).not.toContain('mock-inaccessible');
});

test('a keyboard-only author can add and reorder stages without a pointer', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Keyboard operation is verified on one desktop browser.');
  await signIn(page);
  await openWorkspace(page, `Keyboard journey ${Date.now()}`);

  for (const stageName of ['Discover', 'Decide']) {
    await page.getByTestId('new-stage-name').focus();
    await page.keyboard.type(stageName);
    // Tab from the field to its submit control and activate it with the
    // keyboard: no click, no drag, no pointer of any kind.
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('add-stage')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId(`stage-header-${stageName === 'Discover' ? 's01-discover' : 's02-decide'}`)).toBeVisible();
  }

  const headers = page.locator('[data-testid^="stage-header-"]');
  await expect(headers).toHaveCount(2);
  await expect(headers.first()).toContainText('Discover');

  const moveLater = page.getByRole('button', { name: 'Move stage Discover later' });
  await moveLater.focus();
  await expect(moveLater).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-testid^="stage-header-"]').first()).toContainText('Decide');
});

test('the outline gives a complete text alternative to the visual grid', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'One desktop browser covers the accessible outline.');
  await signIn(page);
  await openWorkspace(page, `Outline journey ${Date.now()}`);

  await page.getByTestId('new-stage-name').fill('Renew');
  await page.getByTestId('add-stage').click();
  await page.getByTestId('add-card-s01-renew-emotions').click();
  await page.getByTestId('card-title').fill('Anxious about the price change');
  await page.getByTestId('save-card').click();
  await expect(page.getByTestId('add-card-dialog')).toBeHidden();

  await page.getByTestId('tab-outline').click();
  const outline = page.getByTestId('journey-outline');
  await expect(outline).toBeVisible();
  const row = outline.getByRole('row').filter({ hasText: 'Anxious about the price change' });
  await expect(row).toContainText('Renew');
  await expect(row).toContainText('Emotions');
  await expect(row).toContainText('Hypothesis');
  // Every state has to explain itself; a bare label would read as a verdict.
  await expect(row).toContainText('no evidence attached');
});

test('publishing freezes the reviewed version and opens the next draft', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'One desktop browser covers the publication flow.');
  await signIn(page);
  await openWorkspace(page, `Publishable journey ${Date.now()}`);

  await page.getByTestId('new-stage-name').fill('Sign up');
  await page.getByTestId('add-stage').click();
  await expect(page.getByTestId('journey-version')).toHaveText('v1 · draft');

  await page.getByTestId('publish-map').click();
  await expect(page.getByTestId('journey-version')).toHaveText('v2 · draft');
  await expect(page.getByTestId('stage-header-s01-sign-up')).toBeVisible();
});

test('a converted legacy journey keeps its content and labels its audience as unvalidated', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'One desktop browser covers legacy conversion.');
  await signIn(page);

  const name = `Legacy conversion ${Date.now()}`;
  const created = await page.request.post('/api/journeys', {
    data: {
      name, audience: 'Operations managers', objective: 'Reduce effort', industry: 'Logistics',
      summary: 'A legacy planning hypothesis.',
      stages: [{
        name: 'Request', goal: 'Raise a request', touchpoints: ['Portal'], customerActions: ['Submit a form'],
        emotions: ['Uncertain'], painPoints: ['Unclear status'], metrics: ['Time to resolution'],
        opportunities: ['Show progress'], recommendedActions: ['Publish a status page']
      }]
    }
  });
  expect(created.status(), 'the legacy journey fixture could not be created').toBe(201);

  await page.goto('/journey-maps');
  await page.getByRole('button', { name: new RegExp(name) }).click();
  await expect(page.getByTestId('journey-map-name')).toHaveText(name);
  await expect(page.getByTestId('journey-mode')).toHaveText('Designed');

  // Legacy stage arrays land in their lanes, and metric strings stay proposals.
  await expect(page.getByTestId('cell-s01-request-touchpoints')).toContainText('Portal');
  await expect(page.getByTestId('cell-s01-request-pain_points')).toContainText('Unclear status');
  await expect(page.getByTestId('cell-s01-request-metrics')).toContainText('Proposed measure');

  await expect(page.getByTestId('convert-audience')).toBeVisible();
  await page.getByTestId('convert-audience').click();
  await page.getByTestId('tab-personas').click();
  const personas = page.getByTestId('journey-personas');
  await expect(personas).toContainText('Operations managers');
  await expect(personas).toContainText('From legacy audience');
  await expect(personas).toContainText('draft');
});

test('rich reusable personas can own card layers and compare on one map', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'The persona editor and comparison table are covered on desktop.');
  await signIn(page);
  await openWorkspace(page, `Persona comparison ${Date.now()}`);

  await page.getByTestId('new-stage-name').fill('Adopt');
  await page.getByTestId('add-stage').click();
  await page.getByTestId('add-card-s01-adopt-pain_points').click();
  await page.getByTestId('card-title').fill('Approval takes too long');
  await page.getByTestId('save-card').click();

  await page.getByTestId('tab-personas').click();
  for (const [name, summary, goal] of [
    ['Operations lead', 'Owns the rollout and operating outcome.', 'Complete rollout safely'],
    ['Frontline colleague', 'Uses the new process every day.', 'Finish work with less effort']
  ]) {
    await page.getByTestId('create-persona').click();
    await expect(page.getByTestId('persona-editor')).toBeVisible();
    await page.getByTestId('persona-name').fill(name);
    await page.getByLabel('Summary').fill(summary);
    await page.getByLabel(/Goals/).fill(goal);
    await page.getByTestId('save-persona').click();
    await expect(page.getByTestId('persona-editor')).toBeHidden();
  }

  const personaList = page.getByTestId('journey-personas');
  await expect(personaList).toContainText('Operations lead');
  await expect(personaList).toContainText('Frontline colleague');
  await page.getByTestId('tab-map').click();

  await page.locator('[data-testid^="card-edit-"]').first().click();
  await expect(page.getByTestId('edit-card-dialog')).toBeVisible();
  await page.getByTestId('edit-card-persona').selectOption({ label: 'Operations lead' });
  await page.getByTestId('save-card-edit').click();
  await expect(page.getByTestId('edit-card-dialog')).toBeHidden();

  await page.getByTestId('tab-persona-compare').click();
  const comparison = page.getByTestId('persona-comparison');
  await expect(comparison).toBeVisible();
  const row = comparison.getByRole('row').filter({ hasText: 'Approval takes too long' });
  await expect(row).toContainText('Approval takes too long');
  await expect(row).toContainText('No applicable cards');
});

test('a keyboard author can manage a distinct custom lane without losing its cards', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Custom lane authoring is exercised on one desktop browser.');
  await signIn(page);
  await openWorkspace(page, `Custom lanes ${Date.now()}`);
  await page.getByTestId('new-stage-name').fill('Commit');
  await page.getByTestId('add-stage').click();

  const manager = page.getByTestId('lane-manager');
  const summary = manager.locator('summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('lane-list')).toBeVisible();

  await page.getByTestId('new-lane-title').focus();
  await page.keyboard.type('Customer commitments');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Promises made at this stage.');
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('add-lane')).toBeFocused();
  await page.keyboard.press('Enter');

  const laneKey = 'custom_customer_commitments';
  const laneRow = page.getByTestId(`lane-row-${laneKey}`);
  await expect(laneRow).toBeVisible();
  await expect(laneRow).toContainText(laneKey);
  await expect(page.getByTestId(`cell-s01-commit-${laneKey}`)).toBeVisible();

  await page.getByTestId(`add-card-s01-commit-${laneKey}`).click();
  await page.getByTestId('card-title').fill('Call the customer tomorrow');
  await expect(page.getByTestId('card-kind')).toHaveValue('note');
  await page.getByTestId('save-card').click();
  await expect(page.getByTestId('add-card-dialog')).toBeHidden();
  await expect(laneRow).toContainText('1 card');
  await expect(page.getByTestId(`lane-delete-${laneKey}`)).toBeDisabled();

  const hide = page.getByRole('button', { name: 'Hide lane Customer commitments' });
  await hide.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId(`cell-s01-commit-${laneKey}`)).toBeHidden();
  const show = page.getByRole('button', { name: 'Show lane Customer commitments' });
  await show.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId(`cell-s01-commit-${laneKey}`)).toBeVisible();

  const edit = page.getByRole('button', { name: 'Edit lane Customer commitments' });
  await edit.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('edit-lane-dialog')).toBeVisible();
  await page.getByTestId('edit-lane-title').fill('Customer promises');
  await page.getByTestId('save-lane').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('edit-lane-dialog')).toBeHidden();
  await expect(page.getByTestId(`cell-s01-commit-${laneKey}`)).toContainText('Call the customer tomorrow');

  const rows = page.getByTestId('lane-list').locator('li');
  const initialIndex = await rows.evaluateAll((items, key) => items.findIndex((item) => item.getAttribute('data-testid') === `lane-row-${key}`), laneKey);
  const moveEarlier = page.getByRole('button', { name: 'Move lane Customer promises earlier' });
  await moveEarlier.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => rows.evaluateAll((items, key) => items.findIndex((item) => item.getAttribute('data-testid') === `lane-row-${key}`), laneKey))
    .toBe(initialIndex - 1);

  await page.getByTestId('tab-outline').click();
  const outlineRow = page.getByTestId('journey-outline').getByRole('row').filter({ hasText: 'Call the customer tomorrow' });
  await expect(outlineRow).toContainText('Customer promises');
  await page.getByTestId('open-presentation').click();
  await page.getByTestId('presentation-tab-outline').click();
  await expect(page.getByTestId('presentation-outline').getByRole('row').filter({ hasText: 'Call the customer tomorrow' }))
    .toContainText('Customer promises');
  await page.getByTestId('exit-presentation').click();

  await page.getByTestId('tab-map').click();
  await page.getByTestId('lane-manager').locator('summary').click();
  await page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId(`cell-s01-commit-${laneKey}`).locator('[data-testid^="card-delete-"]').click();
  await expect(page.getByTestId(`cell-s01-commit-${laneKey}`)).not.toContainText('Call the customer tomorrow');
  const deleteLane = page.getByRole('button', { name: 'Delete lane Customer promises' });
  await expect(deleteLane).toBeEnabled();
  await deleteLane.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId(`lane-row-${laneKey}`)).toBeHidden();
});

test('journey maps stay reachable and readable on a small screen', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'This case covers the mobile layout only.');
  await signIn(page);
  await page.goto('/journey-maps');
  await expect(page.getByTestId('journey-maps-page')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Journey maps' })).toBeVisible();
  // The page must never force the document itself to scroll sideways.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
