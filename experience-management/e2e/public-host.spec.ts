import { expect, test } from '@playwright/test';

test('public Cloudflare host serves the secured application', async ({ page }, testInfo) => {
  test.skip(!process.env.PLAYWRIGHT_EXTERNAL_URL, 'Runs only against the deployed hostname');
  const password = process.env.EXPERIENCE_E2E_PASSWORD;
  if (!password) throw new Error('EXPERIENCE_E2E_PASSWORD is required.');
  const unauthenticated = await page.goto('/api/bootstrap');
  expect(unauthenticated?.status()).toBe(401);
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Admin sign in' })).toBeVisible();
  await page.getByLabel('Email').fill('admin@seemplify.local');
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();
  await expect(page.getByText(/Terra (ready|unavailable)/)).toBeVisible();
  if (process.env.CAPTURE_VISUALS) await page.screenshot({ path: testInfo.outputPath('public-dashboard.png'), fullPage: true });
  await page.getByRole('button', { name: 'Sign out' }).click().catch(async () => {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('button', { name: 'Sign out' }).click();
  });
  await expect(page).toHaveURL(/\/login$/);
});
