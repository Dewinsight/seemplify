import { expect, test, type Page } from '@playwright/test';

const appraisalId = '507f1f77bcf86cd799439011';
const assessmentId = '507f1f77bcf86cd799439012';
const meetingId = '507f1f77bcf86cd799439013';
const user = { id: 'recovery-manager', sub: 'recovery-manager', name: 'Synthetic Reviewer', email: 'reviewer@example.test' };
const organization = { id: 'recovery-org', name: 'Recovery QA', role: 'owner' };

async function setup(page: Page, options: { summary?: string; competencyDisabled?: boolean } = {}) {
  let starts = 0, finalized = false, completed = false;
  const presence: string[] = [], completions: unknown[] = [], outcomes: unknown[] = [];
  await page.addInitScript(() => localStorage.setItem('accessToken', 'synthetic-recovery-qa'));
  await page.route(/\/(?:__mock-api|api)\//, async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/(?:__mock-api|api)/, '');
    const method = route.request().method();
    const finish = (data: unknown) => route.fulfill({ json: { success: true, data } });
    if (path === '/auth/me') return route.fulfill({ json: { success: true, user: { ...user, organizations: [organization] }, currentOrganization: organization } });
    if (path === '/user/context') return finish({ user, organization, role: { name: 'hr_admin', isManager: true, isHRAdmin: true }, teams: [], features: {}, stats: {} });
    if (path === '/user/current-team') return finish({ currentTeam: null, availableTeams: [] });
    if (path === '/presence/sessions') return route.fulfill({ status: 201, json: { sessionId: `session-${++starts}` } });
    if (path.startsWith('/presence/sessions/')) {
      presence.push(path);
      return route.fulfill({ status: path.includes('/session-1/') ? 404 : 200, json: { accepted: true } });
    }
    if (path === `/appraisals/${appraisalId}`) return finish({ _id: appraisalId, status: 'final_review_pending', employee: { userId: 'employee', name: 'Synthetic Employee' }, manager: user, viewerCapabilities: { isEmployee: false, canManage: true }, cycleId: { settings: { enableAiAssist: false } }, selfAssessment: { overallSelfRating: 4 }, managerReview: { overallManagerRating: 4 } });
    if (path.endsWith('/scoring')) return finish({ suggestedRating: 4 });
    if (path === `/competency/appraisal-links/${appraisalId}`) {
      if (options.competencyDisabled) return route.fulfill({ status: 403, json: { error: { code: 'COMPETENCY_DISABLED', message: 'Assessments disabled' } } });
      return finish({ assessments: [{ id: assessmentId, status: finalized ? 'published' : 'in_progress', role: { name: 'Delivery reviewer', version: 1 }, allowedActions: ['assessment.edit'] }] });
    }
    if (path.endsWith('/finalize') && method === 'POST') {
      outcomes.push(route.request().postDataJSON());
      if (!finalized) return route.fulfill({ status: 409, json: { code: 'ROLE_ASSESSMENT_REQUIRED', assessmentId, error: 'Finish and finalise the linked role assessment using the current submitted reviewer feedback before completing this appraisal.' } });
      return finish({});
    }
    if (path === `/one-on-ones/${meetingId}`) return finish({ _id: meetingId, title: 'Synthetic notes check', managerId: user.id, employeeId: 'employee', managerInfo: user, employeeInfo: { name: 'Synthetic Employee' }, status: completed ? 'completed' : 'scheduled', scheduledDate: '2026-01-01T12:00:00Z', duration: 30, call: { mode: 'calendar' } });
    if (path === `/one-on-ones/${meetingId}/call`) return finish([{ _id: meetingId, title: 'Synthetic notes check', mode: 'calendar', scheduledDate: '2026-01-01T12:00:00Z', duration: 30, status: completed ? 'completed' : 'scheduled', summary: options.summary, conferenceUrl: 'https://meet.google.com/aaa-bbbb-ccc', integration: { recordingRequested: false } }]);
    if (path.endsWith('/connection')) return finish({ connected: true, email: user.email, provider: 'google', connectUrl: 'https://app.seemplifyai.com/settings/calendar' });
    if (path.endsWith('/complete') && method === 'POST') { completions.push(route.request().postDataJSON()); completed = true; return finish({}); }
    return finish([]);
  });
  return { presence, completions, outcomes, starts: () => starts, publish: () => { finalized = true; } };
}

test('presence replaces a missing session and stops sending activity to the old ID', async ({ page }) => {
  await page.clock.install();
  const state = await setup(page);
  await page.goto('/support-plans');
  await expect(page.getByRole('heading', { name: 'Support plans', exact: true })).toBeVisible();
  await page.clock.runFor(1500);
  await expect.poll(state.starts).toBe(1);
  await page.clock.runFor(15_000);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await expect.poll(state.starts).toBe(2);
  const oldRequests = state.presence.filter(path => path.includes('/session-1/')).length;
  await page.clock.runFor(120_000);
  await expect.poll(() => state.presence.some(path => path === '/presence/sessions/session-2/heartbeat')).toBe(true);
  expect(state.presence.filter(path => path.includes('/session-1/'))).toHaveLength(oldRequests);
});

test('call completion requires written notes and submits trimmed content', async ({ page }) => {
  const state = await setup(page);
  await page.goto(`/one-on-ones/${meetingId}`);
  const complete = page.getByRole('button', { name: 'Complete meeting', exact: true });
  await expect(complete).toBeDisabled();
  await expect(page.getByText('Add agreed meeting notes or generate AI notes before completing the call. Recording is optional.')).toBeVisible();
  const notes = page.getByRole('textbox', { name: 'Agreed meeting notes', exact: true });
  await notes.fill('   '); await expect(complete).toBeDisabled();
  await notes.fill('  Agreed to document the next delivery.  ');
  await expect(complete).toBeEnabled(); await complete.click();
  await expect.poll(() => state.completions).toEqual([{ notes: 'Agreed to document the next delivery.' }]);
});

test('generated notes allow call completion without requiring another transcription', async ({ page }) => {
  await setup(page, { summary: 'Generated discussion notes.' });
  await page.goto(`/one-on-ones/${meetingId}`);
  await expect(page.getByRole('button', { name: 'Complete meeting', exact: true })).toBeEnabled();
});

test('blocked finalisation links to the exact assessment and preserves the rating decision', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await setup(page);
  await page.goto(`/appraisals/${appraisalId}/final-review`);
  await expect(page.getByText('Finalise each linked role assessment using the latest submitted reviewer feedback before completing this appraisal.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open assessment workspace' })).toHaveAttribute('href', `/competency/assessments/${assessmentId}`);
  const reason = page.getByRole('textbox', { name: 'Justification (required when overriding evidence rating)' });
  await reason.fill('Agreed final outcome after the review.');
  const complete = page.getByRole('button', { name: 'Complete Appraisal', exact: true });
  await complete.click();
  const recovery = page.getByRole('link', { name: 'Open linked role assessment (new tab)' });
  await expect(recovery).toHaveAttribute('href', `/competency/assessments/${assessmentId}`);
  await expect(recovery).toHaveAttribute('target', '_blank');
  await expect(reason).toHaveValue('Agreed final outcome after the review.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  state.publish(); await complete.click();
  await expect(page).toHaveURL(new RegExp(`/appraisals/${appraisalId}$`));
  expect(state.outcomes).toEqual([{ finalRating: 4, justification: 'Agreed final outcome after the review.' }, { finalRating: 4, justification: 'Agreed final outcome after the review.' }]);
});

test('ordinary appraisals stay quiet when the optional competency feature is disabled', async ({ page }) => {
  await setup(page, { competencyDisabled: true });
  await page.goto(`/appraisals/${appraisalId}/final-review`);
  await expect(page.getByText('Calculated evidence rating: 4/5', { exact: true })).toBeVisible();
  await expect(page.getByText('Checking linked competency assessment…')).toHaveCount(0);
  await expect(page.getByText('Assessments disabled')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Complete Appraisal', exact: true })).toBeEnabled();
});
