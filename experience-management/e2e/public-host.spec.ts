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
  const mobile = testInfo.project.name === 'mobile-chromium';
  if (mobile) await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('complementary').getByText(/Terra .* (ready|unavailable)/)).toBeVisible();
  if (mobile) await page.getByRole('button', { name: 'Close navigation' }).click();
  if (process.env.CAPTURE_VISUALS) await page.screenshot({ path: testInfo.outputPath('public-dashboard.png'), fullPage: true });

  if (mobile) await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Social listening' }).click();
  await expect(page.getByRole('heading', { name: 'Social listening' })).toBeVisible();
  if (process.env.CAPTURE_VISUALS) await page.screenshot({ path: testInfo.outputPath('public-social-listening.png'), fullPage: true });

  if (mobile) await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Journey maps' }).click();
  await expect(page.getByRole('heading', { name: 'Journey maps', exact: true })).toBeVisible();
  if (process.env.CAPTURE_VISUALS) await page.screenshot({ path: testInfo.outputPath('public-journeys.png'), fullPage: true });

  if (mobile) await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
});
