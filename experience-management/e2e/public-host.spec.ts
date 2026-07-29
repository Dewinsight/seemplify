import { expect, test } from '@playwright/test';

test('public Cloudflare host serves the secured application', async ({ page }, testInfo) => {
  test.skip(!process.env.PLAYWRIGHT_EXTERNAL_URL, 'Runs only against the deployed hostname');
  const password = process.env.EXPERIENCE_E2E_PASSWORD;
  if (!password) throw new Error('EXPERIENCE_E2E_PASSWORD is required.');
  const missingAsset = await page.request.get(`/assets/intentionally-missing-${testInfo.project.name}-${Date.now()}.js`);
  expect(missingAsset.status()).toBe(404);
  expect(missingAsset.headers()['content-type']).toContain('text/plain');
  expect(missingAsset.headers()['cache-control']).toBe('no-store');
  expect(await missingAsset.text()).not.toContain('<!doctype html>');
  const unauthenticated = await page.goto('/api/bootstrap');
  expect(unauthenticated?.status()).toBe(401);
  const terms = await page.goto('/legal/terms'); expect(terms?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Terms of Service' })).toBeVisible();
  const privacy = await page.goto('/legal/privacy'); expect(privacy?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible();
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Create an account' }).click();
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to sign in' }).click();
  await page.getByLabel('Email').fill('admin@seemplify.local');
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();
  const liveRefresh = await page.evaluate(() => new Promise<{ connected: boolean; readyState: number }>((resolve) => {
    const stream = new EventSource('/api/events');
    const finish = (connected: boolean) => { window.clearTimeout(timer); const readyState = stream.readyState; stream.close(); resolve({ connected, readyState }); };
    const timer = window.setTimeout(() => finish(false), 5000);
    stream.addEventListener('connected', () => finish(true), { once: true });
    stream.addEventListener('error', () => finish(false), { once: true });
  }));
  expect(liveRefresh.connected, `Event stream failed with readyState ${liveRefresh.readyState}`).toBe(true);
  const mobile = testInfo.project.name === 'mobile-chromium';
  if (mobile) await page.getByRole('button', { name: 'Open navigation' }).click();
  const sidebar = page.getByRole('complementary');
  const runtimeStatus = sidebar.getByTestId('sidebar-runtime-status');
  await expect(runtimeStatus).toBeVisible();
  await expect(runtimeStatus).toHaveAccessibleName(/Open AI queue\..*\.\s*(Ready|Unavailable)\./i);
  const runtimeBounds = await runtimeStatus.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
  expect(runtimeBounds.scrollWidth).toBeLessThanOrEqual(runtimeBounds.clientWidth);
  if (mobile) await page.getByRole('button', { name: 'Close navigation' }).click();
  if (process.env.CAPTURE_VISUALS) await page.screenshot({ path: testInfo.outputPath('public-dashboard.png'), fullPage: true });

  if (mobile) await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Agreements' }).click();
  await expect(page.getByRole('heading', { name: 'Agreements', exact: true })).toBeVisible();
  await expect(page.getByRole('main').getByRole('link', { name: 'New agreement' }).first()).toBeVisible();
  const envelopes = await page.request.get('/api/esign/envelopes');
  expect(envelopes.status()).toBe(200);
  expect(await envelopes.json()).toEqual(expect.any(Array));

  if (mobile) await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Social listening' }).click();
  await expect(page.getByRole('heading', { name: 'Social listening' })).toBeVisible();
  if (process.env.CAPTURE_VISUALS) await page.screenshot({ path: testInfo.outputPath('public-social-listening.png'), fullPage: true });

  if (mobile) await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Intelligence' }).click();
  await expect(page.getByRole('heading', { name: 'Intelligence', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Build an analysis' })).toBeVisible();
  const intelligenceSources = await page.request.get('/api/intelligence/sources');
  const intelligenceReports = await page.request.get('/api/intelligence/reports');
  expect(intelligenceSources.status()).toBe(200);
  expect(intelligenceReports.status()).toBe(200);
  expect(await intelligenceSources.json()).toEqual(expect.any(Array));
  expect(await intelligenceReports.json()).toEqual(expect.any(Array));
  if (process.env.CAPTURE_VISUALS) await page.screenshot({ path: testInfo.outputPath('public-intelligence.png'), fullPage: true });

  if (mobile) await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Journey maps' }).click();
  await expect(page.getByRole('heading', { name: 'Journey maps', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'How this workspace works' })).toBeVisible();
  const journeys = await page.request.get('/api/journeys');
  expect(journeys.status()).toBe(200);
  const journeyList = await journeys.json();
  if (journeyList.length > 0) {
    await expect(page.getByText('Evidence level: hypothesis')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Version history' })).toBeVisible();
  }
  const journeyViewport = await page.evaluate(() => ({ documentWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth }));
  expect(journeyViewport.documentWidth).toBeLessThanOrEqual(journeyViewport.viewportWidth + 1);
  if (process.env.CAPTURE_VISUALS) await page.screenshot({ path: testInfo.outputPath('public-journeys.png'), fullPage: true });

  if (mobile) await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
});
