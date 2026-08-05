import { expect, test, type Page } from '@playwright/test';

// The global config sets retries: 1. Saved-view proof must be deterministic, so
// a flake here fails rather than being silently retried away.
test.describe.configure({ retries: 0 });

const password = 'Playwright-Test-Password-2026!';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();
}

/** Build a real two-card journey map through the real API. Saved-view proof is
 * worthless against mocked routes: the filtering, exact-version binding and
 * export resolution all happen on the server. */
async function seedMap(page: Page, name: string) {
  const created = await page.request.post('/api/journey-maps', {
    data: { name, purpose: 'Saved-view browser proof', stageNames: ['Discover', 'Decide'] }
  });
  expect(created.status(), await created.text()).toBe(201);
  const definition = await created.json() as { id: string; revision: number };

  const read = await page.request.get(`/api/journey-maps/${definition.id}`);
  expect(read.status()).toBe(200);
  const map = await read.json() as { definition: { revision: number }; stages: Array<{ stageKey: string }> };

  let revision = map.definition.revision;
  for (const card of [
    { stageKey: map.stages[0].stageKey, laneType: 'emotions', kind: 'emotion', title: 'Anxious about renewal cost' },
    { stageKey: map.stages[1].stageKey, laneType: 'customer_actions', kind: 'action', title: 'Confirm the renewal' }
  ]) {
    const response = await page.request.post(`/api/journey-maps/${definition.id}/cards`, {
      data: { expectedRevision: revision, ...card }
    });
    expect(response.status(), await response.text()).toBe(201);
    const body = await response.json() as { definition: { revision: number } };
    revision = body.definition.revision;
  }
  return definition.id;
}

async function openMap(page: Page, definitionId: string) {
  await page.goto(`/journey-maps?map=${definitionId}`);
  const bar = page.getByTestId('journey-saved-view-bar');
  await expect(bar).toBeVisible();
  return bar;
}

test('a saved view is created, applied, defaulted, exported and reset against the real API', async ({ page }) => {
  await signIn(page);
  const definitionId = await seedMap(page, `Saved view proof ${Date.now()}`);
  const bar = await openMap(page, definitionId);

  // Create a view that filters the map down to the emotion card only.
  await bar.getByRole('button', { name: 'Save current' }).click();
  const editor = page.getByTestId('journey-saved-view-editor');
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('heading', { name: 'Save journey view' })).toBeVisible();
  await editor.getByLabel('Name').fill('Emotions only');
  await editor.getByRole('group', { name: 'Card kind' }).getByRole('checkbox').first().check();
  await editor.getByTestId('journey-saved-view-submit').click();
  await expect(editor).toBeHidden();

  const select = bar.getByLabel('Saved view', { exact: true });
  await expect(select.locator('option', { hasText: 'Emotions only' })).toHaveCount(1);

  // Applying must narrow the rendered map through the server, and must mark the
  // map read-only rather than silently allowing edits to a filtered projection.
  await bar.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByTestId('active-journey-saved-view')).toContainText('Emotions only');
  await expect(page.getByTestId('active-journey-saved-view')).toContainText('revision 1');
  await expect(page.getByText('Anxious about renewal cost')).toBeVisible();
  await expect(page.getByText('Confirm the renewal')).toHaveCount(0);

  // A stored default must auto-apply truthfully on the next load.
  await bar.getByRole('button', { name: 'Set default' }).click();
  await expect(bar.getByText('Default view applies when this map opens.')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('active-journey-saved-view')).toContainText('Emotions only');
  await expect(page.getByText('Confirm the renewal')).toHaveCount(0);

  // Export the exact selected view and revision, end to end.
  const reopened = page.getByTestId('journey-saved-view-bar');
  await reopened.getByTestId('journey-saved-view-export-menu').click();
  const download = page.waitForEvent('download');
  await reopened.getByRole('button', { name: 'JSON', exact: true }).click();
  const artifact = await download;
  expect(artifact.suggestedFilename()).toMatch(/view-emotions-only-r1\.json$/u);

  // Reset returns the authoritative unfiltered map.
  await reopened.getByRole('button', { name: 'Reset' }).click();
  await expect(page.getByTestId('active-journey-saved-view')).toHaveCount(0);
  await expect(page.getByText('Confirm the renewal')).toBeVisible();
});

test('"Save current" creates a new view and never overwrites the selected one', async ({ page }) => {
  await signIn(page);
  const definitionId = await seedMap(page, `Saved view overwrite guard ${Date.now()}`);
  const bar = await openMap(page, definitionId);

  await bar.getByRole('button', { name: 'Save current' }).click();
  const editor = page.getByTestId('journey-saved-view-editor');
  await editor.getByLabel('Name').fill('Original view');
  await editor.getByRole('group', { name: 'Card kind' }).getByRole('checkbox').first().check();
  await editor.getByTestId('journey-saved-view-submit').click();
  await expect(editor).toBeHidden();

  // Exact, because the export menu's "Export the saved view <name>" label also
  // matches the default substring lookup once a view is selected.
  const select = bar.getByLabel('Saved view', { exact: true });
  const originalOption = select.locator('option', { hasText: 'Original view' });
  await expect(originalOption).toHaveCount(1);
  // `selectOption` types `label` as a string, so a RegExp is rejected by the
  // protocol validator rather than substring-matched. Selecting by the option's
  // own value keeps the substring intent and survives the disambiguating
  // suffixes the bar appends to shared, unavailable or colliding names.
  const originalOptionId = await originalOption.getAttribute('value');
  expect(originalOptionId, 'the saved-view option must carry its identifier').toBeTruthy();
  await select.selectOption(originalOptionId!);

  // Regression guard: with a manageable view selected, "Save current" used to
  // open a blank editor whose primary button read "Save changes" and rewrote
  // the selected view with a default, filter-free configuration.
  await bar.getByRole('button', { name: 'Save current' }).click();
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('heading', { name: 'Save journey view' })).toBeVisible();
  await expect(editor.getByTestId('journey-saved-view-submit')).toHaveText(/Create view/u);
  await expect(editor.getByRole('button', { name: 'Move to retention' })).toHaveCount(0);
  await editor.getByLabel('Name').fill('Second view');
  await editor.getByTestId('journey-saved-view-submit').click();
  await expect(editor).toBeHidden();

  // Both views must exist, and the original must keep its filter.
  await expect(select.locator('option', { hasText: 'Original view' })).toHaveCount(1);
  await expect(select.locator('option', { hasText: 'Second view' })).toHaveCount(1);

  const list = await page.request.get(`/api/journey-maps/${definitionId}/saved-views`);
  expect(list.status()).toBe(200);
  const body = await list.json() as { views: Array<{ name: string; revision: number; config: { filters: { cardKinds: string[] } } }> };
  const original = body.views.find((view) => view.name === 'Original view')!;
  expect(original.revision, 'creating a second view must not bump the original revision').toBe(1);
  expect(original.config.filters.cardKinds.length,
    'the original view must keep the filter it was saved with').toBeGreaterThan(0);
});
