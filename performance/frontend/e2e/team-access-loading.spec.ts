import { expect, test, type Page } from '@playwright/test';

async function install(page: Page, contextResponse: () => Promise<{ status?: number; body: unknown }>) {
  await page.addInitScript(() => localStorage.setItem('accessToken', 'team-loading-qa'));
  const user = { id: 'manager-1', sub: 'manager-1', name: 'Alex Morgan', email: 'alex@example.test' };
  await page.route('**/__mock-api/**', async route => {
    const path = new URL(route.request().url()).pathname.slice('/__mock-api'.length);
    let body: unknown = { success: true, data: [] };
    let status = 200;
    if (path === '/auth/me') body = { success: true, user: { ...user, organizations: [{ id: 'org-1', name: 'QA', role: 'employee' }], idpOrganizations: [{ id: 'org-1', name: 'QA', role: 'employee' }] }, currentOrganizationId: 'org-1', currentOrganization: { id: 'org-1', name: 'QA' } };
    if (path === '/user/context') ({ body, status = 200 } = await contextResponse());
    if (path === '/user/my-team-members') body = { success: true, data: { directReports: [], teams: [] } };
    if (path === '/notifications/count') body = { success: true, data: { unread: 0, actionable: 0 } };
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

const context = (isManager: boolean) => ({ success: true, data: { user: { id: 'manager-1', name: 'Alex Morgan' }, role: { isManager, isHRAdmin: false }, teams: [], features: {}, stats: {} } });
const denied = "This page is for managers and HR administrators. You don't have direct reports to manage.";

test('pending permissions show loading, then the authorized team page', async ({ page }, testInfo) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await install(page, async () => { await gate; return { body: context(true) }; });
  await page.goto('/team');
  await expect(page.getByRole('status').filter({ hasText: 'Loading your team' })).toBeVisible();
  await expect(page.getByText(denied)).toHaveCount(0);
  release();
  await expect(page.getByRole('heading', { name: 'My Team', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'All Members', exact: true })).toBeVisible();
  await expect(page.getByText('Loading your team…')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('team-loaded.png'), fullPage: true });
});

test('failed permissions offer retry without incorrectly denying access', async ({ page }) => {
  let failed = true;
  await install(page, async () => failed ? { status: 503, body: { message: 'Temporary outage' } } : { body: context(true) });
  await page.goto('/team');
  await expect(page.getByText("We couldn't load your team access. Please try again.")).toBeVisible();
  await expect(page.getByText(denied)).toHaveCount(0);
  failed = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('button', { name: 'All Members', exact: true })).toBeVisible();
});

test('confirmed non-managers still receive the access explanation', async ({ page }) => {
  await install(page, async () => ({ body: context(false) }));
  await page.goto('/team');
  await expect(page.getByText(denied)).toBeVisible();
  await expect(page.getByRole('button', { name: 'All Members', exact: true })).toHaveCount(0);
});

