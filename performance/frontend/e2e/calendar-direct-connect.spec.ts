import { expect, test, type Page } from '@playwright/test';
const meetingId = '507f1f77bcf86cd799439011';
const user = { id: 'calendar-manager', sub: 'calendar-manager', name: 'Synthetic Manager', email: 'manager@example.test' };
const org = { id: 'calendar-org', name: 'Calendar QA', role: 'owner' };
async function setup(page: Page, connected = false, fail = false) {
  const attempts: { path: string; body: unknown }[] = [];
  await page.addInitScript(() => localStorage.setItem('accessToken', 'synthetic-calendar-qa'));
  await page.context().route('https://api.us.nylas.com/v3/connect/auth?**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Nylas calendar authorization</h1>' }));
  await page.route(/\/(?:__mock-api|api)\//, async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/(?:__mock-api|api)/, '');
    const finish = (data: unknown) => route.fulfill({ json: { success: true, data } });
    if (path === '/auth/me') return route.fulfill({ json: { success: true, user: { ...user, organizations: [org] }, currentOrganization: org } });
    if (path === '/user/context') return finish({ user, organization: org, role: { name: 'line_manager', isManager: true, isHRAdmin: false }, teams: [], features: {}, stats: {} });
    if (path === '/user/current-team') return finish({ currentTeam: null, availableTeams: [] });
    if (path === '/presence/sessions') return route.fulfill({ json: { sessionId: 'calendar-presence' } });
    if (path === `/one-on-ones/${meetingId}`) return finish({ _id: meetingId, title: 'Calendar connection QA', managerId: user.id, employeeId: 'employee', managerInfo: user, employeeInfo: { name: 'Synthetic Employee' }, scheduledDate: '2026-12-01T12:00:00Z', duration: 30, status: 'scheduled', call: { mode: 'calendar' } });
    if (path === `/one-on-ones/${meetingId}/call`) return finish([{ _id: meetingId, title: 'Calendar connection QA', scheduledDate: '2026-12-01T12:00:00Z', duration: 30, status: 'scheduled', mode: 'calendar', conferenceUrl: 'https://meet.google.com/aaa-bbbb-ccc', integration: { recordingRequested: false } }]);
    if (path.endsWith('/connection')) return finish({ connected, email: connected ? 'chosen-calendar@example.test' : null, provider: 'google', connectUrl: 'https://app.seemplifyai.com/settings/calendar' });
    if (path.endsWith('/connection/connect')) {
      attempts.push({ path, body: route.request().postDataJSON() });
      if (fail) return route.fulfill({ status: 503, json: { error: 'No calendar connection slots are available.' } });
      return finish({ authUrl: 'https://api.us.nylas.com/v3/connect/auth?client_id=synthetic&state=opaque-synthetic' });
    }
    return finish([]);
  });
  return { attempts };
}

test('manager connects directly to Nylas without visiting Recruiter or OIDC', async ({ page }) => {
  const state = await setup(page);
  await page.goto(`/one-on-ones/${meetingId}`);
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Connect my calendar (opens Nylas)', exact: true }).click();
  const authorization = await popup;
  await expect(authorization.getByRole('heading', { name: 'Nylas calendar authorization' })).toBeVisible();
  expect(new URL(authorization.url()).hostname).toBe('api.us.nylas.com');
  expect(state.attempts).toEqual([{ path: `/one-on-ones/${meetingId}/call/connection/connect`, body: { provider: 'google', returnPath: `/one-on-ones/${meetingId}` } }]);
  await expect(page.getByText('Choose your calendar account and approve access in Nylas. Then return here and check the connection again.')).toBeVisible();
});

test('changing a connected email starts Nylas with the manager identity', async ({ page }) => {
  await setup(page, true);
  await page.goto(`/one-on-ones/${meetingId}`);
  await expect(page.getByText('chosen-calendar@example.test · Google Calendar', { exact: true })).toBeVisible();
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Change connected email (opens Nylas)' }).click();
  const authorization = await popup;
  await expect(authorization.getByRole('heading', { name: 'Nylas calendar authorization' })).toBeVisible();
});

test('failed calendar initiation closes the blank tab and shows a retryable error', async ({ page }) => {
  await setup(page, false, true);
  await page.goto(`/one-on-ones/${meetingId}`);
  await page.getByRole('button', { name: 'Connect my calendar (opens Nylas)', exact: true }).click();
  await expect(page.getByText('No calendar connection slots are available.', { exact: true })).toBeVisible();
  await expect.poll(() => page.context().pages().length).toBe(1);
  await expect(page.getByRole('button', { name: 'Connect my calendar (opens Nylas)', exact: true })).toBeEnabled();
});
