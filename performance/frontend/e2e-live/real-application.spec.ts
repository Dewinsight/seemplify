import { expect, test, type Page } from '@playwright/test';

const actors = ['employee', 'team_lead', 'manager', 'hr_manager', 'admin', 'owner', 'department_head', 'teamless'];
const hrRoles = new Set(['hr_manager', 'admin', 'owner']);
const managerRoles = new Set(['team_lead', 'manager', 'department_head', ...hrRoles]);
async function login(page: Page, actor: string, path = '/recognition') {
  await page.goto(`http://127.0.0.1:5014/__test/login/${actor}?path=${encodeURIComponent(path)}`);
  await expect(page.getByRole('button', { name: 'A', exact: true })).toBeVisible();
}
for (const actor of actors) {
  test(`${actor}: real colleague picker, private persistence and audience recovery`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await login(page, actor);
    await page.getByRole('button', { name: 'Recognize a colleague', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Recognize a colleague' });
    await dialog.getByLabel('Search organization').fill('peer');
    await dialog.getByRole('button', { name: 'Acceptance peer', exact: true }).click();
    await expect(dialog.getByRole('combobox', { name: 'Audience' })).toHaveText('Recipient only');
    const message = `Real browser appreciation ${actor} ${Date.now()}`;
    await dialog.getByLabel('Recognition message').fill(message);
    const response = page.waitForResponse(response => response.url().endsWith('/api/recognition') && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Send recognition', exact: true }).click();
    const sentResponse = await response;
    expect(sentResponse.status()).toBe(201);
    expect(sentResponse.request().postDataJSON()).toMatchObject({ recipient: { userId: 'acceptance-peer' }, message, visibility: 'private' });
    expect(sentResponse.request().postDataJSON().recipient).toEqual({ userId: 'acceptance-peer' });
    const created = (await sentResponse.json()).data;
    expect(created.visibility).toBe('private');
    await expect(page.getByText(/Recognition sent\./)).toBeVisible();
    await page.getByRole('tab', { name: 'Sent', exact: true }).click();
    await expect(page.getByText(message, { exact: true })).toBeVisible();
    await expect(page.locator(`#recognition-${created._id}`).getByText(/Private/)).toBeVisible();
    await page.reload();
    await page.getByRole('tab', { name: 'Sent', exact: true }).click();
    await expect(page.getByText(message, { exact: true })).toBeVisible();
    await expect(page.locator(`#recognition-${created._id}`).getByText(/Private/)).toBeVisible();
    await page.getByRole('button', { name: 'Recognize a colleague', exact: true }).click();
    await dialog.getByLabel('Search organization').fill('teamless');
    await dialog.getByRole('button', { name: 'Acceptance teamless', exact: true }).click();
    await expect(dialog.getByRole('combobox', { name: 'Audience' })).toHaveText('Recipient only');
    await expect(dialog.getByText(/recipient's team is checked when you send/i)).toBeVisible();
    await expect(dialog.getByText(/has no assigned team/i)).toHaveCount(0);
    const recoveryMessage = `Audience recovery draft ${actor} ${Date.now()}`;
    await dialog.getByLabel('Recognition message').fill(recoveryMessage);
    await dialog.getByRole('combobox', { name: 'Audience' }).click();
    await page.getByRole('option', { name: "Recipient's team", exact: true }).click();
    const rejectedResponse = page.waitForResponse(response => response.url().endsWith('/api/recognition') && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Send recognition', exact: true }).click();
    const rejected = await rejectedResponse;
    expect(rejected.status()).toBe(400);
    expect(rejected.request().postDataJSON()).toMatchObject({ recipient: { userId: 'acceptance-teamless' }, message: recoveryMessage, visibility: 'team' });
    const error = actor === 'teamless' ? 'Recognition must be sent to another person' : 'Recipient team could not be verified. Choose Recipient only or Organization.';
    expect((await rejected.json()).error).toBe(error);
    await expect(dialog.getByRole('alert')).toContainText(error);
    await expect(dialog.getByLabel('Recognition message')).toHaveValue(recoveryMessage);
    await expect(dialog.getByRole('combobox', { name: 'Audience' })).toHaveText("Recipient's team");
    const beforeRetry = await page.request.get('http://127.0.0.1:5014/api/recognition?view=sent');
    expect(beforeRetry.status()).toBe(200);
    expect((await beforeRetry.json()).data.filter((item: { message: string }) => item.message === recoveryMessage)).toHaveLength(0);
    if (actor === 'teamless') {
      // This fixture selects the signed-in actor: self-recognition must remain
      // forbidden. Its earlier real peer send proves private sending works.
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    } else {
      await dialog.getByRole('combobox', { name: 'Audience' }).click();
      await page.getByRole('option', { name: 'Recipient only', exact: true }).click();
      const retryResponse = page.waitForResponse(response => response.url().endsWith('/api/recognition') && response.request().method() === 'POST');
      await dialog.getByRole('button', { name: 'Send recognition', exact: true }).click();
      const retried = await retryResponse;
      expect(retried.status()).toBe(201);
      expect(retried.request().postDataJSON()).toMatchObject({ message: recoveryMessage, visibility: 'private' });
      expect(retried.request().postDataJSON().recipient).toEqual({ userId: 'acceptance-teamless' });
      const recovered = (await retried.json()).data;
      expect(recovered.visibility).toBe('private');
      await expect(dialog).not.toBeVisible();
      await page.reload();
      await page.getByRole('tab', { name: 'Sent', exact: true }).click();
      const persisted = page.locator(`#recognition-${recovered._id}`);
      await expect(persisted.getByText(recoveryMessage, { exact: true })).toBeVisible();
      await expect(persisted.getByText(/Private/)).toBeVisible();
    }
    expect(pageErrors).toEqual([]);
  });

  test(`${actor}: all available feature pages load against real APIs`, async ({ page }) => {
    test.setTimeout(180_000);
    await login(page, actor, '/dashboard');
    const failures: string[] = [];
    page.on('pageerror', error => failures.push(error.message));
    page.on('response', response => {
      if (response.url().startsWith('http://127.0.0.1:5014/api/') && response.status() >= 500 && !response.url().includes('/presence/')) failures.push(`${response.status()} ${response.url()}`);
    });
    // The disposable IdP exposes the actual role catalogue and scoped directory
    // contracts. Verify them before navigation, including self-only employees;
    // never hide bootstrap failures or grant every fixture administrative access.
    const bootstrap = await page.evaluate(async () => {
      const response = await fetch('http://127.0.0.1:5014/api/competency/bootstrap', { credentials: 'include' });
      return { status: response.status, body: await response.json() };
    });
    expect(bootstrap.status).toBe(200);
    const { data } = bootstrap.body;
    expect(data.scope).toBe(hrRoles.has(actor) ? 'organization' : managerRoles.has(actor) ? 'managed_teams' : 'self');
    expect(data.capabilities.roleManage).toBe(hrRoles.has(actor));
    expect(data.capabilities.retentionManage).toBe(hrRoles.has(actor));
    expect(data.capabilities.assessmentLaunch).toBe(managerRoles.has(actor));
    expect(data.people.some((person: { userId: string }) => person.userId === 'acceptance-foreign')).toBe(false);
    if (!managerRoles.has(actor)) {
      expect(data.people.map((person: { userId: string }) => person.userId)).toEqual([`acceptance-${actor}`]);
      expect(data.reviewers).toEqual([]);
    }
    const paths = ['/dashboard', '/okrs?view=my', '/appraisals?view=personal', '/feedback', '/one-on-ones', '/check-ins', '/development', '/support-plans', '/recognition', '/project-feedback', '/action-centre', '/tutorial'];
    if (managerRoles.has(actor)) paths.push('/team', '/appraisals?view=team', '/appraisals/start', '/okrs?view=team', '/analytics', '/coaching', '/talent');
    if (hrRoles.has(actor)) paths.push('/admin', '/admin/appraisal-cycles', '/admin/appraisal-cycles/new', '/admin/calibration', '/admin/reports', '/okrs?view=organization');
    for (const path of paths) {
      // These waits include Next's cold route compilation, so use the navigation
      // budget rather than the shorter action timeout. Await them together so a
      // rejected response wait cannot become an unhandled promise during goto.
      const navigationTimeout = 30_000;
      await Promise.all([
        page.waitForResponse(response => response.url().endsWith('/api/user/context') && response.status() === 200, { timeout: navigationTimeout }),
        ...(path === '/admin/reports' ? [page.waitForResponse(response => response.url().endsWith('/api/reports/org-summary') && response.status() === 200, { timeout: navigationTimeout })] : []),
        page.goto(path, { waitUntil: 'domcontentloaded', timeout: navigationTimeout }),
      ]);
      if (path === '/team') {
        await expect(page.getByRole('button', { name: 'All Members', exact: true })).toBeVisible();
      }
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
