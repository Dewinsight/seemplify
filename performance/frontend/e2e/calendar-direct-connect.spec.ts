import { expect, test, type Page } from '@playwright/test';
const meetingId = '507f1f77bcf86cd799439011';
const user = { id: 'calendar-manager', sub: 'calendar-manager', name: 'Synthetic Manager', email: 'manager@example.test' };
const org = { id: 'calendar-org', name: 'Calendar QA', role: 'owner' };
async function setup(page: Page, connected = false, fail = false, recording = false) {
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
    if (path === `/one-on-ones/${meetingId}`) return finish({ _id: meetingId, title: 'Calendar connection QA', managerId: user.id, employeeId: 'employee', managerInfo: user, employeeInfo: { name: 'Synthetic Employee' }, scheduledDate: recording ? new Date(Date.now() - 60000).toISOString() : '2026-12-01T12:00:00Z', duration: 30, status: 'scheduled', call: { mode: 'calendar' } });
    if (path === `/one-on-ones/${meetingId}/call`) return finish([{ _id: meetingId, title: 'Calendar connection QA', scheduledDate: recording ? new Date(Date.now() - 60000).toISOString() : '2026-12-01T12:00:00Z', duration: 30, status: 'scheduled', mode: 'calendar', conferenceUrl: 'https://meet.google.com/aaa-bbbb-ccc', integration: { recordingRequested: recording } }]);
    if (path.endsWith('/connection')) return finish({ connected, email: connected ? 'chosen-calendar@example.test' : null, provider: 'google', connectUrl: 'https://app.seemplifyai.com/settings/calendar' });
    if (path.endsWith('/connection/disconnect')) { attempts.push({ path, body: route.request().postData() }); connected = false; return finish({ disconnected: true }); }
    if (path.endsWith('/recording-consent')) return finish({ required: recording, ownRole: 'manager', state: 'joining', canStart: false, canAddNow: false, canStop: true });
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


test('manager can inspect, cancel and confirm disconnect directly in Performance', async ({ page }) => {
  const state = await setup(page, true); await page.goto(`/one-on-ones/${meetingId}`);
  await page.getByRole('button', { name: 'Disconnect calendar', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Disconnect your calendar?', exact: true });
  await dialog.getByRole('button', { name: 'Keep connected', exact: true }).click();
  expect(state.attempts).toEqual([]);
  await page.getByRole('button', { name: 'Disconnect calendar', exact: true }).click();
  await dialog.getByRole('button', { name: 'Disconnect my calendar', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('No verified calendar connected to your account.', { exact: true })).toBeVisible();
  expect(state.attempts).toEqual([{ path: `/one-on-ones/${meetingId}/call/connection/disconnect`, body: null }]);
  await expect(page.getByRole('button', { name: 'Connect my calendar (opens Nylas)', exact: true })).toBeEnabled();
});

test('bot monitor follows provider lobby, recording, ended and delayed transcript states', async ({ page }, info) => {
  await setup(page, true, false, true);
  let state = 'connecting', meetingState = 'waiting_for_entry', transcriptState = 'after_call';
  let transcript = '';
  const events: { state: string; meetingState: string; observedAt: string }[] = [];
  const status = () => ({ state, meetingState, transcriptState, realtimeTranscript: false, calendarEmail: 'original-invitation@example.test', calendarProvider: 'google', checkedAt: new Date().toISOString(), events });
  await page.route('**/call/notetaker-status', route => route.fulfill({ json: { success: true, data: status() } }));
  await page.route(`**/one-on-ones/${meetingId}/call`, route => route.fulfill({ json: { success: true, data: [{ _id: meetingId, title: 'Calendar QA', mode: 'calendar', status: 'scheduled', scheduledDate: new Date(Date.now() - 60000).toISOString(), duration: 30, conferenceUrl: 'https://meet.google.com/aaa-bbbb-ccc', transcript, integration: { recordingRequested: true } }] } }));
  await page.route('**/call/sync', route => { transcript = 'Synthetic speaker: Agreed to follow up.'; return route.fulfill({ json: { success: true } }); });
  await page.goto(`/one-on-ones/${meetingId}`);
  await expect(page.getByText('Waiting in the meeting lobby', { exact: true })).toBeVisible();
  await expect(page.getByText('Invitation created using: original-invitation@example.test · google', { exact: true })).toBeVisible();
  state = 'attending'; meetingState = 'recording_active';
  events.push({ state, meetingState, observedAt: new Date().toISOString() });
  await page.getByRole('button', { name: 'Check live status', exact: true }).click();
  await expect(page.getByText('Recording confirmed by Nylas', { exact: true }).first()).toBeVisible();
  state = 'disconnected'; meetingState = 'meeting_ended'; transcriptState = 'processing';
  events.push({ state, meetingState, observedAt: new Date(Date.now() - 11 * 60000).toISOString() });
  await page.getByRole('button', { name: 'Check live status', exact: true }).click();
  await expect(page.getByText('Call ended', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Transcript delayed: more than 10 minutes/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop notetaker', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ask notetaker to join now', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Bot activity timeline (2)', exact: true }).click();
  await expect(page.getByText(/observed status changes/)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('[aria-label="Live calendar notetaker"]').screenshot({ path: info.outputPath('calendar-recording-panel-mobile.png') });
  await page.screenshot({ path: info.outputPath('calendar-bot-status-mobile.png'), fullPage: true });
  transcriptState = 'available';
  await page.getByRole('button', { name: 'Check live status', exact: true }).click();
  await expect(page.getByText('Transcript saved. Open Transcript below to read it.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Transcript', exact: true }).click();
  await expect(page.getByText('Synthetic speaker: Agreed to follow up.', { exact: true })).toBeVisible();
});

test('a confirmed failed bot has a manual retry and unknown provider failures stay unconfirmed', async ({ page }) => {
  await setup(page, true, false, true);
  let state = 'failed_entry'; let retries = 0;
  await page.route('**/call/notetaker-status', route => route.fulfill({ json: { success: true, data: { state, meetingState: state === 'failed_entry' ? 'admission_timeout' : 'waiting_for_entry', events: [], realtimeTranscript: false } } }));
  await page.route('**/call/notetaker-status/retry', route => { retries++; state = 'connecting'; return route.fulfill({ json: { success: true } }); });
  await page.goto(`/one-on-ones/${meetingId}`);
  await page.getByRole('button', { name: 'Retry bot join', exact: true }).click();
  await expect(page.getByText('Waiting in the meeting lobby', { exact: true })).toBeVisible();
  expect(retries).toBe(1);
  await page.route('**/call/notetaker-status', route => route.fulfill({ status: 503, json: { error: 'Synthetic provider outage' } }));
  await page.getByRole('button', { name: 'Check live status', exact: true }).click();
  await expect(page.getByText('Status refresh failed. The information below is from the last successful check.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry bot join', exact: true })).toHaveCount(0);
});

test('completed calls show provider history and saved transcripts without a stale lobby state', async ({ page }) => {
  await setup(page, true, false, true);
  const created = Date.now() - 20 * 60000;
  await page.route('**/call/notetaker-status', route => route.fulfill({ json: { success: true, data: {
    state: 'available', meetingState: 'no_activity', transcriptState: 'available', recordingAvailable: true, realtimeTranscript: false,
    events: [
      { state: 'connecting', meetingState: 'waiting_for_entry', observedAt: new Date(created).toISOString(), source: 'provider' },
      { state: 'attending', meetingState: 'recording_active', observedAt: new Date(created + 60000).toISOString(), source: 'provider' },
      { state: 'disconnected', meetingState: 'no_activity', observedAt: new Date(created + 10 * 60000).toISOString(), source: 'provider' },
      { state: 'available', meetingState: 'unknown', observedAt: new Date(created + 11 * 60000).toISOString(), source: 'provider' },
    ],
  } } }));
  await page.route(`**/one-on-ones/${meetingId}/call`, route => route.fulfill({ json: { success: true, data: [{ _id: meetingId, title: 'Calendar QA', mode: 'calendar', status: 'completed', scheduledDate: new Date(created).toISOString(), duration: 30, conferenceUrl: 'https://meet.google.com/aaa-bbbb-ccc', transcript: 'Saved provider transcript.', integration: { recordingRequested: true } }] } }));
  await page.goto(`/one-on-ones/${meetingId}`);
  await expect(page.getByText('Call media ready', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Reported by Nylas at/)).toBeVisible();
  await expect(page.getByText('Completed in Seemplify; the notetaker has finished', { exact: true })).toBeVisible();
  await expect(page.getByText('Transcript saved. Open Transcript below to read it.', { exact: true })).toBeVisible();
  await expect(page.getByText(/Admit the Seemplify notetaker from the meeting lobby/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Stop notetaker', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Bot activity timeline (4)', exact: true }).click();
  await expect(page.getByText(/Nylas event ·/)).toHaveCount(4);
});

test('a scheduled bot can be dispatched now from the same call controls and stopped without duplicating it', async ({ page }) => {
  await setup(page, true, false, true);
  let started = 0, stopped = 0;
  let state = 'scheduled';
  await page.route('**/call/recording-consent', route => route.fulfill({ json: { success: true, data: { ownRole: 'manager', canStart: false, canAddNow: state === 'scheduled', canStop: state !== 'revoked', windowClosed: false } } }));
  await page.route('**/call/notetaker-status', route => route.fulfill({ json: { success: true, data: { state, events: [], realtimeTranscript: false } } }));
  await page.route('**/call/recording-consent/start', route => { expect(route.request().postDataJSON()).toEqual({ joinNow: true }); started++; state = 'joining'; return route.fulfill({ json: { success: true } }); });
  await page.route('**/call/recording-consent/stop', route => { stopped++; state = 'revoked'; return route.fulfill({ json: { success: true } }); });
  await page.goto(`/one-on-ones/${meetingId}`);
  await page.getByRole('button', { name: 'Ask notetaker to join now', exact: true }).click();
  await expect(page.getByText('Notetaker joining', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ask notetaker to join now', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Stop notetaker', exact: true }).click();
  await expect(page.getByText('Notetaker stopped', { exact: true })).toBeVisible();
  expect(started).toBe(1); expect(stopped).toBe(1);
});
