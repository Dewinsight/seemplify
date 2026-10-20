import { expect, test, type Page } from '@playwright/test';

async function install(page: Page, role: 'employee' | 'manager' | 'hr' = 'employee', denied = false, mood: number | undefined = undefined, formerManager = false) {
  const actor = role === 'employee' && !formerManager ? 'employee-1' : 'manager-1';
  const org = { id: 'org-1', name: 'Fictional QA', role: role === 'hr' ? 'hr_manager' : 'employee', authorization: formerManager ? undefined : { permissionsByApp: { 'performance-management': denied ? [] : ['support_plan:manage:direct_reports'] } } };
  const user = { id: actor, sub: actor, name: 'Alex QA', email: 'qa@example.test', organizations: [org], idpOrganizations: [org] };
  const employee = { userId: 'employee-1', name: 'Employee QA' };
  const plan = { _id: 'development-1', userId: 'employee-1', managerId: 'manager-1', title: 'Fictional development', status: 'active', overallProgress: 0, startDate: '2026-01-01', targetDate: '2026-12-31', careerGoals: [{ _id: 'goal-1', title: 'Lead a milestone', targetRole: 'Delivery lead', progress: 0 }], skillDevelopment: [{ _id: 'skill-1', skillName: 'Planning', category: 'soft_skills', currentLevel: 'beginner', targetLevel: 'advanced', progress: 0 }], learningActivities: [], checkIns: [] };
  const support = { _id: 'support-1', planType: 'formal_improvement', state: 'active', title: 'Fictional support', summary: 'Agreed fictional support.', employee, manager: { userId: 'manager-1', name: 'Manager QA' }, objectives: [], supportCommitments: [], milestones: [{ _id: 'milestone-1', title: 'First review', status: 'upcoming', dueDate: '2026-12-01' }], checkIns: [], updatedAt: '2026-10-20T08:00:00Z', outcome: undefined as { decision: string; reason: string } | undefined };
  const meeting = { _id: 'meeting-1', employeeId: 'employee-1', managerId: 'manager-1', employeeInfo: employee, managerInfo: { name: 'Manager QA' }, status: 'scheduled', scheduledDate: '2026-12-01T10:00:00Z', duration: 30, location: 'Virtual', agendaItems: [], actionItems: [], employeeMood: mood === undefined ? {} : { score: mood }, call: { source: 'one_on_one', mode: 'in_app' } };
  let progressFailures = 1, milestoneFailures = 1, outcomeFailures = 1;
  const requests: string[] = [];
  await page.addInitScript(({ actor, role }) => { localStorage.setItem('accessToken', 'local-qa-only'); localStorage.setItem(`performance-workspace:org-1:${actor}`, role === 'employee' ? 'personal' : role === 'hr' ? 'admin' : 'manager'); }, { actor, role });
  await page.route('**/__mock-api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.slice('/__mock-api'.length), method = request.method();
    const send = (data: unknown, status = 200) => route.fulfill({ status, json: { success: status < 400, data, ...(status >= 400 ? { error: 'Temporary save failure. Retry with your retained changes.' } : {}) } });
    if (path === '/auth/me') return route.fulfill({ json: { user, currentOrganization: org, currentOrganizationId: org.id } });
    if (path === '/user/context') return send({ user, organization: org, role: { name: role === 'hr' ? 'hr_admin' : role === 'manager' ? 'line_manager' : 'employee', isManager: role !== 'employee', isHRAdmin: role === 'hr' }, teams: role === 'manager' ? [{ id: 'team-1', organizationId: 'org-1', role: 'line_manager', isManager: true }] : [], features: { continuousPerformance: true, performanceSupportPlans: true, notifications: true } });
    if (path === '/user/my-team-members') return send({ directReports: role === 'employee' ? [] : [employee], totalDirectReports: role === 'employee' ? 0 : 1 });
    if (path === '/user/current-team') return send({ currentTeam: null, availableTeams: [] });
    if (path === '/notifications/counts') return send({ unread: 0, actionable: 0 });
    if (path.startsWith('/learning')) return send({ records: [], learners: [], summary: {} });
    if (path === '/development-plans' && method === 'GET') return send([plan]);
    if (path === '/development-plans/development-1' && method === 'GET') return send(plan);
    if (path === '/development-plans/development-1' && method === 'PUT') { requests.push('goal'); if (progressFailures-- > 0) return send(null, 503); plan.careerGoals = request.postDataJSON().careerGoals; return send(plan); }
    if (path === '/support-plans' && method === 'GET') return send([support]);
    if (path === '/support-plans/support-1' && method === 'GET') return send(support);
    if (path.includes('/milestones/') && method === 'PATCH') { requests.push('milestone'); if (milestoneFailures-- > 0) return send(null, 503); Object.assign(support.milestones[0], request.postDataJSON()); return send(support); }
    if (path.endsWith('/outcome') && method === 'POST') { requests.push('outcome'); if (outcomeFailures-- > 0) return send(null, 503); const outcome = request.postDataJSON() as { decision: string; reason: string }; support.outcome = outcome; support.state = outcome.decision; return send(support); }
    if (path.startsWith('/one-on-ones')) return send([meeting]);
    return send([]);
  });
  return { plan, support, requests };
}

test('failed career goal save retains the draft and succeeds once on retry then reload', async ({ page }, testInfo) => {
  const state = await install(page);
  await page.goto('/development?plan=development-1');
  await page.getByRole('button', { name: 'Update progress', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Update goal progress' });
  await dialog.getByLabel('Progress %').fill('70'); await dialog.getByRole('button', { name: 'Save progress' }).click();
  await expect(dialog.getByText('Temporary save failure. Retry with your retained changes.')).toBeVisible();
  await expect(dialog.getByLabel('Progress %')).toHaveValue('70'); expect(state.plan.careerGoals[0].progress).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('goal-retry-retained.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Save progress' }).click(); await expect(dialog).toBeHidden();
  expect(state.plan.careerGoals[0]).toMatchObject({ progress: 70, targetRole: 'Delivery lead' }); expect(state.requests).toEqual(['goal', 'goal']);
  await page.reload(); await page.getByRole('button', { name: 'Update progress', exact: true }).click(); await expect(page.getByLabel('Progress %')).toHaveValue('70');
});

test('milestone and HR outcome failures preserve comments, decision and reason for retry', async ({ page }, testInfo) => {
  const state = await install(page, 'hr');
  await page.goto('/support-plans?plan=support-1'); await page.getByRole('button', { name: 'Update milestone' }).click();
  const milestone = page.getByRole('dialog', { name: 'Update milestone', exact: true });
  await milestone.getByLabel('Manager response').fill('Retain the agreed manager response.'); await milestone.getByRole('button', { name: 'Save milestone' }).click();
  await expect(milestone.getByRole('alert')).toBeVisible(); await expect(milestone.getByLabel('Manager response')).toHaveValue('Retain the agreed manager response.');
  await milestone.getByRole('button', { name: 'Save milestone' }).click(); await expect(milestone).toBeHidden();
  await page.getByRole('button', { name: 'Record outcome', exact: true }).click(); const outcome = page.getByRole('dialog', { name: 'Record support plan outcome' });
  await outcome.getByLabel('Outcome', { exact: true }).click(); await page.getByRole('option', { name: 'Escalated', exact: true }).click();
  await outcome.getByLabel('Outcome reason').fill('A human HR review recorded this fictional decision.');
  await outcome.getByRole('button', { name: 'Record outcome', exact: true }).click(); await expect(outcome.getByRole('alert')).toBeVisible();
  await expect(outcome.getByLabel('Outcome reason')).toHaveValue('A human HR review recorded this fictional decision.');
  await expect(outcome.getByLabel('Outcome', { exact: true })).toContainText('Escalated');
  await page.screenshot({ path: testInfo.outputPath('support-outcome-retry-retained.png'), fullPage: true });
  await outcome.getByRole('button', { name: 'Record outcome', exact: true }).click(); await expect(outcome).toBeHidden();
  expect(state.support.state).toBe('escalated'); expect(state.requests).toEqual(['milestone', 'milestone', 'outcome', 'outcome']);
  await page.reload(); await expect(page.getByText('A human HR review recorded this fictional decision.', { exact: false })).toBeVisible();
});

for (const actor of ['manager', 'hr'] as const) test(`${actor} explicit denied manage grant hides milestone and outcome actions`, async ({ page }) => {
  await install(page, actor, true); await page.goto('/support-plans?plan=support-1');
  await expect(page.getByRole('dialog').getByText('Fictional support', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Update milestone' })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Record outcome', exact: true })).toHaveCount(0);
});

for (const score of [undefined, 0, 4]) test(`one-to-one mood ${score ?? 'unshared'} uses truthful empty or numeric display`, async ({ page }) => {
  await install(page, 'manager', false, score); await page.goto('/one-on-ones'); await page.getByRole('button', { name: 'Agenda & actions' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(score === undefined ? 'Not shared yet' : `${score}/5`, { exact: true })).toBeVisible();
  await expect(dialog.getByText('undefined/5', { exact: true })).toHaveCount(0);
});

test('former manager without current authority cannot update another employee support plan', async ({ page }) => {
  await install(page, 'employee', false, undefined, true); await page.goto('/support-plans?plan=support-1');
  await expect(page.getByRole('dialog').getByText('Fictional support', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Update milestone' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Record outcome', exact: true })).toHaveCount(0);
});
