import { expect, test } from '@playwright/test';

test('admin builds, publishes and receives a survey response through the public experience', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password').fill('Playwright-Test-Password-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();

  await page.getByRole('link', { name: 'New survey' }).click();
  await page.getByRole('tab', { name: 'Templates' }).click();
  const template = page.getByRole('heading', { name: 'Customer relationship NPS' }).locator('../..');
  await template.getByRole('button', { name: 'Use template' }).click();
  await expect(page.getByRole('heading', { name: 'Customer relationship NPS' })).toBeVisible();
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Live', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'Collect' }).click();
  const publicUrl = await page.getByLabel('Survey URL').inputValue();
  expect(publicUrl).toMatch(/\/s\//);
  const studioUrl = page.url();

  await page.goto(publicUrl);
  await expect(page.getByRole('heading', { name: 'Customer relationship NPS' })).toBeVisible();
  await page.getByRole('button', { name: '4', exact: true }).click();
  await page.locator('textarea').first().fill('The setup was confusing and I could not find the integration settings.');
  await page.getByRole('button', { name: 'Submit response' }).click();
  await expect(page.getByRole('heading', { name: 'Thank you' })).toBeVisible();

  await page.goto(studioUrl);
  await page.getByRole('tab', { name: 'Responses' }).click();
  await expect(page.getByText('Individual responses')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open' }).first()).toBeVisible();
  await page.goto('/ai-queue');
  await expect(page.getByText('Response analysis').first()).toBeVisible();
});

test('admin surface and public survey remain usable at a narrow mobile viewport', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'Dedicated responsive check');
  await page.goto('/login');
  await page.getByLabel('Email').fill('qa@seemplify.local'); await page.getByLabel('Password').fill('Playwright-Test-Password-2026!'); await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Surveys', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Surveys' })).toBeVisible();
  await expect(page.locator('body')).not.toHaveCSS('overflow-x', 'scroll');
});
