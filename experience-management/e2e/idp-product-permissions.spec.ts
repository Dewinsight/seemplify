import { expect, test } from '@playwright/test';
import { signInE2eBootstrap } from './auth';

test('Experience denies a direct route when the IdP matrix omits its permission', async ({ page }) => {
  await signInE2eBootstrap(page);
  const session = await page.evaluate(async () => (await fetch('/api/auth/session')).json());
  await page.route(/\/api\/auth\/session(?:\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ...session, productPermissions: ['spaces.read'] })
  }));

  await page.goto('/settings/space');

  await expect(page.getByRole('heading', { name: 'Your role does not include this area' })).toBeVisible();
  await expect(page.getByText('Required: spaces.manage', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open Identity administration' }))
    .toHaveAttribute('href', 'https://auth.seemplifyai.com/organizations');
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })
    .getByRole('link', { name: 'Space settings' })).toHaveCount(0);
});
