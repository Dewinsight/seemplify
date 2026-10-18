import { expect, test, type Page } from '@playwright/test';

const actors = ['employee', 'team_lead', 'manager', 'hr_manager', 'admin', 'owner', 'department_head', 'teamless'];
const hrRoles = new Set(['hr_manager', 'admin', 'owner']);
const managerRoles = new Set(['team_lead', 'manager', 'department_head', ...hrRoles]);
async function login(page: Page, actor: string, path = '/recognition') {
  await page.goto(`http://127.0.0.1:5014/__test/login/${actor}?path=${encodeURIComponent(path)}`);
  await expect(page.getByRole('button', { name: 'A', exact: true })).toBeVisible();
}
for (const actor of actors) {
  test(`${actor}: real colleague picker, send, persisted sent tab and teamless audience`, async ({ page }) => {
    await login(page, actor);
    await page.getByRole('button', { name: 'Recognize a colleague', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Recognize a colleague' });
    await dialog.getByLabel('Search organization').fill('peer');
    await dialog.getByRole('button', { name: 'Acceptance peer', exact: true }).click();
    const message = `Real browser appreciation ${actor} ${Date.now()}`;
    await dialog.getByLabel('Recognition message').fill(message);
    const response = page.waitForResponse(response => response.url().endsWith('/api/recognition') && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Send recognition', exact: true }).click();
    expect((await response).status()).toBe(201);
    await expect(page.getByText(/Recognition sent\./)).toBeVisible();
    await page.getByRole('tab', { name: 'Sent', exact: true }).click();
    await expect(page.getByText(message, { exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole('tab', { name: 'Sent', exact: true }).click();
    await expect(page.getByText(message, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Recognize a colleague', exact: true }).click();
    await dialog.getByLabel('Search organization').fill('teamless');
    await dialog.getByRole('button', { name: 'Acceptance teamless', exact: true }).click();
    await expect(dialog.getByRole('combobox', { name: 'Audience' })).toHaveText('Recipient only');
    await expect(dialog.getByText(/has no assigned team/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  });

  test(`${actor}: all available feature pages load against real APIs`, async ({ page }) => {
    test.setTimeout(180_000);
    await login(page, actor, '/dashboard');
    const failures: string[] = [];
    page.on('pageerror', error => failures.push(error.message));
    page.on('response', response => {
      if (response.url().startsWith('http://127.0.0.1:5014/api/') && response.status() >= 500 && !response.url().includes('/presence/')) failures.push(`${response.status()} ${response.url()}`);
    });
    const paths = ['/dashboard', '/okrs?view=my', '/appraisals?view=personal', '/feedback', '/one-on-ones', '/check-ins', '/development', '/support-plans', '/recognition', '/project-feedback', '/action-centre', '/tutorial'];
    if (managerRoles.has(actor)) paths.push('/team', '/appraisals?view=team', '/appraisals/start', '/okrs?view=team', '/analytics', '/coaching', '/talent');
    if (hrRoles.has(actor)) paths.push('/admin', '/admin/appraisal-cycles', '/admin/appraisal-cycles/new', '/admin/calibration', '/admin/reports', '/okrs?view=organization');
    for (const path of paths) {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('main').getByRole('heading').first(), path).toBeVisible();
      await expect(page.getByText('Application error: a client-side exception has occurred', { exact: false })).toHaveCount(0);
    }
    expect(failures).toEqual([]);
  });
}

test('employee receives and acknowledges a browser-created recognition', async ({ page }) => {
  await login(page, 'manager');
  await page.getByRole('button', { name: 'Recognize a colleague', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Recognize a colleague' });
  await dialog.getByLabel('Search organization').fill('employee');
  await dialog.getByRole('button', { name: 'Acceptance employee', exact: true }).click();
  const message = `Acknowledgement browser journey ${Date.now()}`;
  await dialog.getByLabel('Recognition message').fill(message);
  await dialog.getByRole('button', { name: 'Send recognition', exact: true }).click();
  await expect(page.getByText(/Recognition sent\./)).toBeVisible();
  await login(page, 'employee');
  await page.getByRole('tab', { name: 'Received', exact: true }).click();
  const item = page.locator('[id^="recognition-"]').filter({ hasText: message });
  await item.getByRole('button', { name: 'Acknowledge', exact: true }).click();
  await expect(item.getByText('Acknowledged', { exact: true })).toBeVisible();
});
