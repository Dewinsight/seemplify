import { expect, test, type Page } from '@playwright/test';

const password = 'Playwright-Test-Password-2026!';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();
}

test('a space administrator publishes a governed template and creates a version-pinned map', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'The governed authoring flow is covered on one desktop browser.');
  await signIn(page);
  const suffix = String(Date.now());
  const name = `Renewal template ${suffix}`;
  const key = `renewal-template-${suffix}`;

  const createdResponse = await page.request.post('/api/journey-templates', { data: {
    key,
    content: {
      name,
      description: 'A governed starting point for a subscription renewal journey.',
      industry: 'Software',
      useCase: 'Subscription renewal',
      experienceType: 'customer',
      mapType: 'current_state',
      lanes: [
        { laneType: 'customer_actions', title: 'Customer actions', description: '', ordinal: 0, blueprintOnly: false },
        { laneType: 'pain_points', title: 'Pain points', description: '', ordinal: 1, blueprintOnly: false }
      ],
      stages: [{
        key: 'review-renewal', name: 'Review renewal', goal: 'Understand the new terms',
        cards: [{ laneType: 'customer_actions', kind: 'action', title: 'Review renewal notice', content: '' }]
      }]
    }
  } });
  const template = await createdResponse.json();
  expect(createdResponse.status(), JSON.stringify(template)).toBe(201);
  const draft = template.versions[0];

  const publishedResponse = await page.request.post(
    `/api/journey-templates/${template.id}/versions/${draft.id}/publish`,
    { data: {
      expectedTemplateRevision: template.revision,
      expectedVersionRevision: draft.revision,
      reason: 'Approved for workspace use.'
    } }
  );
  const published = await publishedResponse.json();
  expect(publishedResponse.status(), JSON.stringify(published)).toBe(200);

  await page.goto('/journey-maps');
  await expect(page.getByTestId('journey-maps-page')).toBeVisible();
  await page.getByTestId('open-journey-templates').click();
  const manager = page.getByTestId('journey-template-manager');
  await expect(manager).toBeVisible();
  await manager.getByPlaceholder('Search by name, industry, or use case').fill(suffix);
  await manager.getByRole('listitem').filter({ hasText: name }).click();
  await expect(manager.getByTestId('journey-template-preview')).toContainText('Review renewal');

  const mapName = `Renewal map ${suffix}`;
  await manager.getByLabel('New map name').fill(mapName);
  await manager.getByTestId('create-map-from-template').click();
  await expect(manager).toBeHidden();
  await expect(page.getByTestId('journey-map-name')).toHaveText(mapName);
  await expect(page.getByTestId('journey-mode')).toHaveText('Designed');
  await expect(page.getByTestId('stage-header-review-renewal')).toContainText('Review renewal');
});

test('platform administrators can open system-template governance with truthful draft controls', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'The system governance surface is covered on one desktop browser.');
  await signIn(page);
  await page.goto('/admin/journey-templates');
  const pageRoot = page.getByTestId('platform-journey-templates');
  await expect(pageRoot).toBeVisible();
  await expect(pageRoot.getByRole('heading', { name: 'Journey templates', exact: true })).toBeVisible();
  const governance = page.getByTestId('system-journey-template-governance');
  await expect(governance).toBeVisible();
  await expect(page.getByTestId('create-system-journey-template')).toBeVisible();
  await expect(governance.getByText('Draft', { exact: true }).first()).toBeVisible();
  await expect(governance.getByRole('button', { name: 'Submit for review' })).toBeVisible();
  await expect(governance.getByRole('button', { name: 'Publish reviewed version' })).toHaveCount(0);
});
