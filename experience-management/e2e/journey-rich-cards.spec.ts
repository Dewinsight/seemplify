import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ retries: 0 });

const password = 'Playwright-Test-Password-2026!';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();
}

async function createEmotionJourney(page: Page, name: string, withRichDetail = false) {
  const created = await page.request.post('/api/journey-maps', {
    data: { name, mapType: 'current_state', stageNames: ['Consider'] }
  });
  expect(created.status(), 'journey fixture creation failed').toBe(201);
  const definition = await created.json() as { id: string };
  const read = await page.request.get(`/api/journey-maps/${definition.id}`);
  expect(read.status()).toBe(200);
  let map = await read.json() as {
    definition: { revision: number }; version: { id: string };
    stages: Array<{ stageKey: string }>; cards: Array<{ id: string }>;
  };
  const added = await page.request.post(`/api/journey-maps/${definition.id}/cards`, {
    data: {
      expectedRevision: map.definition.revision, stageKey: map.stages[0]!.stageKey,
      laneType: 'emotions', kind: 'emotion', title: 'Unsure before confirming', content: 'Needs reassurance'
    }
  });
  expect(added.status(), 'emotion-card fixture creation failed').toBe(201);
  map = await added.json();
  const card = map.cards.find((item) => item.id) as { id: string };
  if (withRichDetail) {
    const saved = await page.request.put(`/api/journey-rich-cards/maps/${definition.id}/cards/${card.id}`, {
      data: {
        expectedRevision: map.definition.revision, expectedDetailRevision: 0,
        richText: { version: 1, blocks: [
          { type: 'heading', text: 'Confirmation confidence', marks: [{ type: 'bold', start: 0, end: 12 }] },
          { type: 'paragraph', text: 'Show the final charge and cancellation terms.', marks: [] }
        ] },
        emotion: { valence: -2, intensity: 4, label: 'Cautiously uncertain' }
      }
    });
    expect(saved.status(), 'rich-detail fixture creation failed').toBe(200);
  }
  return { definitionId: definition.id, cardId: card.id };
}

async function openJourney(page: Page, definitionId: string) {
  await page.goto('/journey-maps');
  await expect(page.getByTestId('journey-maps-page')).toBeVisible();
  await page.getByTestId(`journey-map-item-${definitionId}`).click();
  await expect(page.getByTestId('journey-map-name')).toBeVisible();
}

async function overrideSessionRole(page: Page, role: 'owner' | 'member') {
  await page.route('**/api/auth/session', async (route) => {
    const response = await route.fetch();
    const session = await response.json();
    if (session.authenticated) {
      session.activeSpace = { ...session.activeSpace, role };
      session.subscription = {
        ...(session.subscription || { planCode: 'enterprise', planName: 'Enterprise', status: 'active', limits: {} }),
        features: { ...(session.subscription?.features || {}), journeyDesign: true, journeyRichCards: true }
      };
    }
    await route.fulfill({ response, json: session });
  });
}

test('owner authors rich blocks, exact emotion, reusable touchpoints, governed media, inspector and presentation', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'The complete authoring path is covered on desktop.');
  await overrideSessionRole(page, 'owner');
  await signIn(page);
  const name = `Rich journey ${Date.now()}`;
  const fixture = await createEmotionJourney(page, name);
  await openJourney(page, fixture.definitionId);
  await page.getByTestId('tab-rich-cards').click();
  await expect(page.getByTestId('journey-rich-card-workspace')).toBeVisible();

  await page.getByRole('button', { name: 'Add block' }).click();
  await page.getByLabel('Paragraph text').fill('Explain the final charge before the customer confirms.');
  await page.getByLabel('Label').fill('Concerned but informed');
  await page.getByLabel('Valence (−5 to +5)').fill('-2');
  await page.getByLabel('Intensity (0 to 5)').fill('4');
  await page.getByTestId('save-journey-rich-detail').click();
  await expect(page.getByTestId('journey-emotional-curve')).toContainText('Concerned but informed');

  const catalog = page.getByTestId('journey-touchpoint-catalog');
  await catalog.getByText('Reusable channels and touchpoints').click();
  await catalog.getByLabel('Name').first().fill('Customer portal');
  await catalog.getByLabel('Category').selectOption('web');
  await catalog.getByRole('button', { name: 'Add channel' }).click();
  await expect(catalog).toContainText('Customer portal');
  await catalog.getByLabel('Name').nth(1).fill('Review order');
  await catalog.getByLabel('Channel', { exact: true }).selectOption({ label: 'Customer portal' });
  await catalog.getByRole('button', { name: 'Add touchpoint' }).click();
  await expect(catalog).toContainText('Review order');

  const touchpointSelect = page.getByLabel('Touchpoint to link');
  const touchpointValue = await touchpointSelect.locator('option').filter({ hasText: 'Review order' }).getAttribute('value');
  expect(touchpointValue, 'created touchpoint was not offered for linking').toBeTruthy();
  await touchpointSelect.selectOption(touchpointValue!);
  await page.getByRole('button', { name: 'Link', exact: true }).click();
  await expect(page.getByText('Review order · Customer portal')).toBeVisible();

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  await page.getByLabel('Image or PDF').setInputFiles({ name: 'checkout-state.png', mimeType: 'image/png', buffer: png });
  await page.getByLabel('Alternative text').fill('Order confirmation showing the final charge');
  await page.getByLabel('Caption (optional)').fill('Reviewed checkout state');
  await page.getByRole('button', { name: 'Attach file' }).click();
  await expect(page.getByRole('img', { name: 'Order confirmation showing the final charge' })).toBeVisible();

  await page.getByTestId('tab-map').click();
  await page.getByTestId(`card-inspect-${fixture.cardId}`).click();
  const inspector = page.getByTestId('card-inspector');
  await expect(inspector).toContainText('Explain the final charge before the customer confirms.');
  await expect(inspector).toContainText('Concerned but informed');
  await expect(inspector.getByRole('img', { name: 'Order confirmation showing the final charge' })).toBeVisible();
  await inspector.getByText('Close', { exact: true }).click();

  await page.getByTestId('open-presentation').click();
  const presentation = page.getByTestId('journey-presentation');
  await expect(presentation.getByTestId('journey-emotional-curve')).toBeVisible();
  await expect(presentation).toContainText('Explain the final charge before the customer confirms.');
  await expect(presentation).toContainText('Concerned but informed');
  await page.getByTestId('exit-presentation').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test('member receives a mobile read-only rich-card outline with exact emotion and no mutation controls', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'The member path is covered at the mobile breakpoint.');
  await overrideSessionRole(page, 'member');
  await signIn(page);
  const fixture = await createEmotionJourney(page, `Member rich journey ${Date.now()}`, true);
  await openJourney(page, fixture.definitionId);
  await page.getByTestId('tab-rich-cards').click();
  const workspace = page.getByTestId('journey-rich-card-workspace');
  await expect(workspace).toContainText('Confirmation confidence');
  await expect(workspace).toContainText('Show the final charge and cancellation terms.');
  await expect(workspace.getByTestId('journey-emotional-curve')).toContainText('Cautiously uncertain');
  for (const forbidden of ['Save rich details', 'Add channel', 'Add touchpoint', 'Attach file', 'Attach link']) {
    await expect(workspace.getByRole('button', { name: forbidden })).toHaveCount(0);
  }
  await expect(workspace.getByLabel('Touchpoint to link')).toHaveCount(0);
  await expect(workspace.getByLabel('Image or PDF')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
