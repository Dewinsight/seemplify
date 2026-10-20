import { expect, test, type Page } from '@playwright/test';
const id = '507f1f77bcf86cd799439011', meetingId = '507f1f77bcf86cd799439012';
const manager = { id: 'manager-qa', sub: 'manager-qa', name: 'Synthetic Reviewer', email: 'reviewer@example.test' };
const employee = { id: 'employee-qa', sub: 'employee-qa', name: 'Synthetic Employee', email: 'employee@example.test' };
const org = { id: 'current-task-org', name: 'Current task QA', role: 'owner' };
async function setup(page: Page, options: { call?: boolean; employee?: boolean; repeat?: boolean } = {}) {
  const user = options.employee ? employee : manager;
  const steps = [{ id: 'self', type: 'selfAssessment', label: 'Employee assessment' }, { id: 'call', type: 'oneOnOne', label: 'One-on-one meeting' }, ...(options.repeat ? [{ id: 'call-2', type: 'oneOnOne', label: 'Follow-up call' }] : []), { id: 'review', type: 'managerReview', label: 'Reviewer assessment' }, { id: 'final', type: 'finalReview', label: 'Final outcome' }];
  const appraisal = { _id: id, status: options.call ? 'meeting_pending' : 'manager_review_pending', employee: { userId: employee.id, ...employee }, manager: { userId: manager.id, ...manager }, cycleId: { name: 'Focused review', competencies: [{ id: 'communication', name: 'Communication' }], settings: { enableAiAssist: false } }, cycleConfigurationSnapshot: { appraisalFlow: { version: 1, steps }, assessmentSections: [] }, completedMeetingSteps: options.call ? [] : ['call'], selfAssessment: { submittedAt: '2026-10-20T12:00:00Z', overallSummary: { keyAchievements: 'Historical employee achievement' }, competencyRatings: [{ competencyId: 'communication', rating: 4 }] }, managerReview: {}, documents: [], deadlines: {} };
  const meeting = { _id: meetingId, stepId: 'call', title: 'One-on-one meeting', scheduledDate: new Date(Date.now() - 5 * 60000).toISOString(), duration: 30, status: options.call ? 'scheduled' : 'completed', mode: 'calendar', conferenceUrl: 'https://meet.google.com/aaa-bbbb-ccc', integration: { recordingRequested: false } };
  const writes: { path: string; body: any }[] = [];
  await page.addInitScript(() => localStorage.setItem('accessToken', 'synthetic-current-task'));
  await page.route(/\/(?:__mock-api|api)\//, async route => {
    const request = route.request(), path = new URL(request.url()).pathname.replace(/^\/(?:__mock-api|api)/, '');
    const finish = (data: unknown) => route.fulfill({ json: { success: true, data } });
    if (path === '/auth/me') return route.fulfill({ json: { success: true, user: { ...user, organizations: [org] }, currentOrganization: org } });
    if (path === '/user/context') return finish({ user, organization: org, role: { name: options.employee ? 'member' : 'line_manager', isManager: !options.employee, isHRAdmin: false }, teams: [], features: {}, stats: {} });
    if (path === '/user/current-team') return finish({ currentTeam: null, availableTeams: [] });
    if (path === '/presence/sessions') return route.fulfill({ json: { sessionId: 'current-task-presence' } });
    if (path === `/appraisals/${id}`) return finish(appraisal);
    if (path === `/appraisals/${id}/meetings`) return finish([meeting]);
    if (path.endsWith('/connection')) return finish({ connected: true, email: 'calendar@example.test', provider: 'google' });
    if (path === '/competency/bootstrap') return finish({ enabled: false });
    if (path.startsWith('/competency/appraisal-links/')) return finish([]);
    if (path.endsWith('/manager-review/start')) { writes.push({ path, body: request.postDataJSON() }); appraisal.status = 'manager_review_in_progress'; return finish(appraisal); }
    if (path.endsWith(`/meetings/${meetingId}/complete`)) { writes.push({ path, body: request.postDataJSON() }); appraisal.completedMeetingSteps = ['call']; appraisal.status = options.repeat ? 'meeting_pending' : 'manager_review_pending'; meeting.status = 'completed'; return finish(meeting); }
    if (path.endsWith('/scoring')) return finish({ okrScore: null, competencyScore: null, compositeScore: null, breakdown: { okrWeight: 50, competencyWeight: 50 } });
    if (path.endsWith('/manager-review') && request.method() === 'POST') { writes.push({ path, body: request.postDataJSON() }); Object.assign(appraisal.managerReview, request.postDataJSON().managerReview); return finish(appraisal); }
    return finish([]);
  });
  return { appraisal, meeting, writes };
}

test('review opens inline and retains draft while viewing previous work', async ({ page }, info) => {
  const state = await setup(page); await page.goto(`/appraisals/${id}`);
  await expect(page.getByRole('tab', { name: 'Current task', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Reviewer assessment', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Rate Competencies', exact: true })).toBeVisible();
  await expect(page.getByText('Historical employee achievement', { exact: true })).toBeHidden();
  await expect(page.getByText('Appraisal details & dates', { exact: true })).toBeHidden();
  await page.getByLabel('Your Comments & Evidence').fill('Preserve unsaved evidence while checking context.');
  await page.getByRole('tab', { name: 'Previous work & analytics', exact: true }).click();
  await expect(page.getByText('Appraisal Progress', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Return to current task', exact: true }).click();
  await expect(page.getByLabel('Your Comments & Evidence')).toHaveValue('Preserve unsaved evidence while checking context.');
  await page.getByRole('button', { name: 'Save Progress', exact: true }).click();
  await expect.poll(() => state.writes.some(write => write.path.endsWith('/manager-review'))).toBe(true);
  expect(state.writes.find(write => write.path.endsWith('/manager-review'))?.body.managerReview.competencyRatings[0].managerComments).toContain('Preserve unsaved evidence');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('current-review-mobile.png'), fullPage: true });
});

test('completing call reveals reviewer form without route detour', async ({ page }) => {
  const state = await setup(page, { call: true }); await page.goto(`/appraisals/${id}`);
  await page.getByLabel('Agreed meeting notes', { exact: true }).fill('Agreed delivery priorities and follow-up actions.');
  await page.getByRole('button', { name: 'Complete call step', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Reviewer assessment', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Rate Competencies', exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/appraisals/${id}$`));
  expect(state.writes.filter(write => write.path.endsWith('/complete'))).toHaveLength(1);
});

test('respects another configured call before reviewer stage', async ({ page }) => {
  await setup(page, { call: true, repeat: true }); await page.goto(`/appraisals/${id}`);
  await page.getByLabel('Agreed meeting notes', { exact: true }).fill('First discussion complete.');
  await page.getByRole('button', { name: 'Complete call step', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Follow-up call', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Rate Competencies', exact: true })).toHaveCount(0);
  await expect(page.getByText('No calls scheduled yet', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Schedule a call', exact: true }).click();
  await expect(page.getByLabel('Appraisal call step')).toContainText('Follow-up call');
});

test('employee waits and cancelled appraisal never starts reviewer work', async ({ page }) => {
  const state = await setup(page, { employee: true }); await page.goto(`/appraisals/${id}`);
  await expect(page.getByText(/Your reviewer is completing this stage/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Rate Competencies', exact: true })).toHaveCount(0);
  expect(state.writes).toEqual([]);
  state.appraisal.status = 'cancelled'; await page.reload();
  await expect(page.getByRole('heading', { name: 'Appraisal cancelled', exact: true })).toBeVisible();
  expect(state.writes).toEqual([]);
});
