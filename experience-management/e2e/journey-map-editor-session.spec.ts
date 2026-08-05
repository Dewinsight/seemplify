import { expect, test, type Locator, type Page } from '@playwright/test';

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
}

async function addStage(page: Page, name: string) {
  await page.getByTestId('new-stage-name').fill(name);
  const addButton = page.getByTestId('add-stage');
  await expect(addButton).toBeEnabled();
  await addButton.click();
  await expect(page.getByTestId('new-stage-name')).toHaveValue('');
}

async function addPainPoint(page: Page, stageKey: string, title: string) {
  await page.getByTestId(`add-card-${stageKey}-pain_points`).click();
  await page.getByTestId('card-title').fill(title);
  await page.getByTestId('save-card').click();
  await expect(page.getByTestId('add-card-dialog')).toBeHidden();
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
}

async function pointerDrag(page: Page, source: Locator, target: Locator) {
  await source.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error('The pointer drag source or destination is not visible.');
  const from = { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 };
  const to = { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 9, from.y + 1, { steps: 2 });
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

test('desktop editor supports keyboard inspection, redacted copy/paste, bulk edit, undo, redo, and autosave', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop interaction contract.');
  await signIn(page);
  const mapName = `Editor session ${Date.now()}`;
  await openWorkspace(page, mapName);
  await addStage(page, 'Discover');
  await addStage(page, 'Decide');

  const emptyCell = page.getByTestId('cell-s01-discover-pain_points');
  await emptyCell.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('add-card-dialog')).toBeVisible();
  await page.getByTestId('card-title').fill('Pricing is unclear');
  await page.getByTestId('save-card').click();
  await expect(page.getByTestId('journey-grid')).not.toHaveAttribute('aria-busy', 'true');

  const sourceCard = emptyCell.locator('[data-card-focus]').filter({ hasText: 'Pricing is unclear' });
  await sourceCard.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('card-inspector')).toContainText('Pricing is unclear');
  await page.getByTestId('card-inspector').getByText('Close', { exact: true }).click();

  await sourceCard.getByRole('checkbox', { name: 'Select card Pricing is unclear' }).check();
  await page.getByTestId('copy-selected-cards').click();
  await page.getByTestId('paste-card-stage').selectOption('s02-decide');
  await page.getByTestId('paste-card-lane').selectOption('pain_points');
  await page.getByTestId('paste-cards').click();
  const targetCell = page.getByTestId('cell-s02-decide-pain_points');
  await expect(targetCell).toContainText('Pricing is unclear');

  await page.getByTestId('journey-undo').click();
  await expect(targetCell).not.toContainText('Pricing is unclear');
  await page.getByTestId('journey-redo').click();
  await expect(targetCell).toContainText('Pricing is unclear');

  await page.getByTestId('bulk-card-status').selectOption('draft');
  await page.getByTestId('apply-bulk-status').click();
  await sourceCard.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('card-inspector')).toContainText('draft');
  await page.getByTestId('inspect-edit-card').click();
  await page.getByTestId('edit-card-title').fill('Pricing needs context');
  await expect(page.getByTestId('card-autosave-state')).toHaveText('Changes saved.', { timeout: 10_000 });
  await page.getByTestId('edit-card-dialog').getByText('Close', { exact: true }).click();
  await expect(emptyCell).toContainText('Pricing needs context');

  const movedCard = emptyCell.locator('[data-card-focus]').filter({ hasText: 'Pricing needs context' });
  const dragHandle = movedCard.getByRole('button', { name: /Drag Pricing needs context from/u });
  const copiedCard = targetCell.locator('[data-card-focus]').filter({ hasText: 'Pricing is unclear' });
  await pointerDrag(page, dragHandle, copiedCard);
  await expect(page.getByTestId('journey-drag-status')).toContainText(
    'Moved Pricing needs context to Decide, Pain points and moments of truth, position 1 of 2.'
  );
  await expect(targetCell.locator('[data-card-focus]').first()).toContainText('Pricing needs context');
  const indexAfterPointer = await page.request.get('/api/journey-maps');
  const definitionAfterPointer = (await indexAfterPointer.json()).journeyMaps.find((item: { name: string }) => item.name === mapName);
  const mapAfterPointer = await (await page.request.get(`/api/journey-maps/${definitionAfterPointer.id}`)).json();
  expect(mapAfterPointer.cards.filter((card: { stageKey: string; laneType: string }) => (
    card.stageKey === 's02-decide' && card.laneType === 'pain_points'
  )).map((card: { title: string }) => card.title)).toEqual(['Pricing needs context', 'Pricing is unclear']);

  await page.getByTestId('journey-undo').click();
  await expect(emptyCell).toContainText('Pricing needs context');
  await movedCard.focus();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(targetCell).toContainText('Pricing needs context');
  await page.getByTestId('journey-undo').click();
  await expect(emptyCell).toContainText('Pricing needs context');
});

test('revision conflict loads the server version and reapplies only after explicit review', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Conflict recovery is exercised once on desktop.');
  await signIn(page);
  const name = `Conflict recovery ${Date.now()}`;
  await openWorkspace(page, name);
  await addStage(page, 'Resolve');
  await addPainPoint(page, 's01-resolve', 'Original claim');

  const indexResponse = await page.request.get('/api/journey-maps');
  const definition = (await indexResponse.json()).journeyMaps.find((item: { name: string }) => item.name === name);
  expect(definition, 'created journey map was not listed').toBeTruthy();
  const currentResponse = await page.request.get(`/api/journey-maps/${definition.id}`);
  const current = await currentResponse.json();
  const card = current.cards.find((item: { title: string }) => item.title === 'Original claim');

  await page.getByTestId(`card-edit-${card.id}`).click();
  await expect(page.getByTestId('edit-card-dialog')).toBeVisible();
  const remote = await page.request.patch(`/api/journey-maps/${definition.id}/cards/${card.id}`, {
    data: { expectedRevision: current.definition.revision, title: 'Remote claim' }
  });
  expect(remote.status()).toBe(200);

  await page.getByTestId('edit-card-title').fill('Local reviewed claim');
  await page.getByTestId('save-card-edit').click();
  await expect(page.getByTestId('card-autosave-state')).toContainText('newer server version');
  await page.getByTestId('edit-card-dialog').getByText('Close', { exact: true }).click();
  const recovery = page.getByTestId('journey-conflict-recovery');
  await expect(recovery).toBeVisible();
  await expect(page.getByTestId('cell-s01-resolve-pain_points')).toContainText('Remote claim');
  await expect(page.getByTestId('cell-s01-resolve-pain_points')).not.toContainText('Local reviewed claim');

  await page.getByTestId('reapply-conflict').click();
  await expect(recovery).toBeHidden();
  await expect(page.getByTestId('cell-s01-resolve-pain_points')).toContainText('Local reviewed claim');
});

test('mobile keeps session editing reachable without document overflow', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'Mobile editor alternative.');
  await signIn(page);
  await openWorkspace(page, `Mobile editor ${Date.now()}`);
  await addStage(page, 'Join');
  await addStage(page, 'Complete');
  await addPainPoint(page, 's01-join', 'Form is confusing');

  await expect(page.getByTestId('editor-session-toolbar')).toBeVisible();
  await expect(page.locator('[data-testid^="card-drag-"]')).toHaveCount(0);
  const mobileSource = page.getByTestId('cell-s01-join-pain_points').getByTestId(/mobile-card-/).filter({ hasText: 'Form is confusing' });
  await mobileSource.getByRole('button', { name: 'Move', exact: true }).click();
  await page.getByTestId('mobile-move-stage').selectOption('s02-complete');
  await page.getByTestId('mobile-move-submit').click();
  const mobileTarget = page.getByTestId('cell-s02-complete-pain_points');
  await expect(mobileTarget).toContainText('Form is confusing');
  const mobileMoved = mobileTarget.getByTestId(/mobile-card-/).filter({ hasText: 'Form is confusing' });
  await mobileMoved.focus();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.getByTestId('cell-s01-join-pain_points')).toContainText('Form is confusing');

  await page.getByTestId('select-all-cards').click();
  await page.getByTestId('copy-selected-cards').click();
  await page.getByTestId('paste-card-stage').selectOption('s01-join');
  await page.getByTestId('paste-card-lane').selectOption('pain_points');
  await page.getByTestId('paste-cards').click();
  await expect(page.getByTestId('cell-s01-join-pain_points').getByText('Form is confusing', { exact: true })).toHaveCount(2);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
