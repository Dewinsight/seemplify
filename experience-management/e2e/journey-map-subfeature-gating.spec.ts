import { expect, test, type Page } from '@playwright/test';

const password = 'Playwright-Test-Password-2026!';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();
}

test('disabled Journey Map subfeatures render no controls and make no persona, evidence, or export requests', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Plan-gated Journey Map controls are covered on one desktop browser.');
  const subfeatureRequests: string[] = [];
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith('/api/journey-personas') || pathname.startsWith('/api/journey-evidence')
      || /\/api\/journey-maps\/[^/]+\/personas(?:\/|$)/u.test(pathname)
      || /\/api\/journey-maps\/[^/]+\/export\.[a-z]+$/u.test(pathname)) {
      subfeatureRequests.push(`${request.method()} ${pathname}`);
    }
  });
  await page.route('**/api/auth/session', async (route) => {
    const response = await route.fetch();
    const session = await response.json();
    if (session.authenticated) {
      const subscription = session.subscription || {
        planCode: 'team', planName: 'Test plan', limits: {}, status: 'active', source: 'managed'
      };
      session.subscription = {
        ...subscription,
        features: {
          ...(subscription.features || {}),
          journeyDesign: true,
          journeyTemplates: true,
          journeyPersonas: false,
          journeyEvidence: false,
          journeyExports: false
        }
      };
    }
    await route.fulfill({ response, json: session });
  });

  await signIn(page);
  await page.goto('/journey-maps');
  await expect(page.getByTestId('journey-maps-page')).toBeVisible();
  await page.getByTestId('new-map-name').fill(`Core-only journey ${Date.now()}`);
  await page.getByTestId('create-map').click();
  await expect(page.getByTestId('journey-workspace')).toBeVisible();

  await expect(page.getByTestId('tab-map')).toBeVisible();
  await expect(page.getByTestId('tab-outline')).toBeVisible();
  await expect(page.getByTestId('publish-map')).toBeVisible();
  await expect(page.getByTestId('tab-personas')).toHaveCount(0);
  await expect(page.getByTestId('tab-persona-compare')).toHaveCount(0);
  await expect(page.getByTestId('tab-gaps')).toHaveCount(0);
  await expect(page.getByTestId('convert-audience')).toHaveCount(0);
  await expect(page.getByTestId('journey-export-menu')).toHaveCount(0);

  await expect(page.getByTestId('new-stage-name')).toBeVisible();
  await expect(page.getByTestId('add-stage')).toBeVisible();
  await expect(page.locator('[data-testid^="card-evidence-open-"]')).toHaveCount(0);
  await expect(page.locator('[data-evidence-state]')).toHaveCount(0);
  await page.getByTestId('tab-outline').click();
  await expect(page.getByTestId('journey-outline').getByRole('columnheader', { name: 'Evidence state' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /export/i })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /export/i })).toHaveCount(0);

  expect(subfeatureRequests).toEqual([]);
});
