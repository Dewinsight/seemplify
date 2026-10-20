import { expect, test } from '@playwright/test';

for (const path of ['/support-plans', '/appraisals?section=history', '/okrs?view=organization']) {
  test(`a missing session recovers through Identity from ${path}`, async ({ page }) => {
    const domainReads: string[] = [];
    await page.route('**/__mock-api/**', route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/auth/oidc/start')) {
        return route.fulfill({ contentType: 'text/html', body: '<h1>Identity sign-in handoff</h1>' });
      }
      domainReads.push(url.pathname.replace('/__mock-api', ''));
      return route.fulfill({ status: 401, json: { error: 'Sign in required', code: 'AUTH_REQUIRED' } });
    });
    await page.goto(path);
    await expect(page.getByRole('heading', { name: 'Identity sign-in handoff' })).toBeVisible();
    expect(domainReads).toEqual([]);
  });
}

test('private content waits for a slow identity check before rendering', async ({ page }) => {
  await page.clock.install();
  const beforeIdentity: string[] = [];
  let identityResolved = false;
  let presenceStarts = 0;
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const user = { id: 'auth-recovery-reviewer', name: 'Synthetic Reviewer', email: 'reviewer@example.test' };
  const organization = { id: 'auth-recovery-org', name: 'Synthetic organization', role: 'owner' };
  await page.addInitScript(() => localStorage.setItem('accessToken', 'synthetic-auth-route-recovery'));
  await page.route('**/__mock-api/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/__mock-api', '');
    if (path === '/auth/me') {
      await waiting;
      identityResolved = true;
      return route.fulfill({ json: { success: true, user: { ...user, organizations: [organization] }, currentOrganization: organization } });
    }
    if (!identityResolved) beforeIdentity.push(path);
    if (path === '/presence/sessions') {
      presenceStarts++;
      return route.fulfill({ json: { sessionId: 'synthetic-auth-presence' } });
    }
    const data = path === '/user/context'
      ? { user, organization, role: { name: 'hr_admin', isManager: true, isHRAdmin: true }, teams: [], features: { continuousPerformance: true } }
      : path === '/user/current-team' ? { currentTeam: null, availableTeams: [] } : [];
    return route.fulfill({ json: { success: true, data } });
  });
  await page.goto('/support-plans');
  await expect(page.getByRole('status')).toHaveText('Checking your session…');
  await expect(page.getByRole('heading', { name: 'Support plans', exact: true })).toHaveCount(0);
  await page.clock.runFor(2000);
  expect(beforeIdentity).toEqual([]);
  expect(presenceStarts).toBe(0);
  release();
  await expect(page.getByRole('heading', { name: 'Support plans', exact: true })).toBeVisible();
  await page.clock.runFor(1500);
  await expect.poll(() => presenceStarts).toBe(1);
});
