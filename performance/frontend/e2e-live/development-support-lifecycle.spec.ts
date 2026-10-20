import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
async function api(request: APIRequestContext, actor: string, method: string, path: string, data?: unknown, status?: number) {
  const response = await request.fetch(`http://127.0.0.1:5014/api/${path}`, { method, headers: { 'x-acceptance-actor': actor }, data });
  if (status) expect(response.status(), `${method} ${path}`).toBe(status);
  else expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBeTruthy();
  return (await response.json()).data;
}
async function login(page: Page, actor: string, path: string) {
  const entry = path.split('?')[0];
  await page.goto(`http://127.0.0.1:5014/__test/login/${actor}?path=${encodeURIComponent(entry)}`);
  await expect(page.getByRole('button', { name: 'A', exact: true })).toBeVisible();
  if (['manager', 'hr_manager'].includes(actor)) {
    await page.getByRole('button', { name: /^(Personal|Manager|Admin)$/ }).click();
    await page.getByRole('menuitemradio', { name: actor === 'hr_manager' ? /^Admin/ : /^Manager/ }).click();
  }
  await page.goto(path);
}

for (const finalizer of ['manager', 'hr_manager']) test(`employee edits development categories and ${finalizer} completes the saved plan`, async ({ page, request }) => {
  const created = await api(request, 'manager', 'POST', 'development-plans', {
    userId: 'acceptance-employee', title: `Development lifecycle ${finalizer} ${Date.now()}`, startDate: day(-1), targetDate: day(30),
    careerGoals: [{ title: 'Lead a fictional milestone', targetRole: 'Delivery lead', progress: 0 }, { title: 'Untouched goal', progress: 20 }],
    skillDevelopment: [{ skillName: 'Planning', currentLevel: 'beginner', targetLevel: 'advanced', category: 'soft_skills', progress: 0, notes: 'Original notes' }],
    learningActivities: [{ title: 'Practice the delivery review', type: 'other', status: 'not_started' }]
  });
  await api(request, 'manager', 'POST', `development-plans/${created._id}/activate`, {});
  await login(page, 'employee', `/development?plan=${created._id}`);
  const details = page.getByRole('dialog', { name: created.title });
  await expect(details).toBeVisible();
  const goals = details.getByRole('button', { name: /Career Goals/ });
  if (await goals.getAttribute('aria-expanded') !== 'true') await goals.click();
  await details.getByRole('button', { name: 'Update progress', exact: true }).first().click();
  const goal = page.getByRole('dialog', { name: 'Update goal progress' });
  await goal.getByLabel('Progress %').fill('80'); await goal.getByRole('button', { name: 'Save progress' }).click(); await expect(goal).toBeHidden();
  await details.getByRole('button', { name: /^Skills/ }).click();
  await details.getByRole('button', { name: 'Update skill' }).click();
  const skill = page.getByRole('dialog', { name: 'Update skill', exact: true });
  await skill.getByLabel('Progress %').fill('40'); await skill.getByLabel('Progress notes').fill('Practised planning using a fictional project.');
  await skill.getByLabel('Current level').click(); await page.getByRole('option', { name: 'Intermediate', exact: true }).click();
  await skill.getByRole('button', { name: 'Save progress' }).click(); await expect(skill).toBeHidden();
  await details.getByRole('button', { name: /^Learning Activities/ }).click();
  await details.getByRole('button', { name: 'Mark complete', exact: true }).click();
  await expect(details.getByRole('button', { name: 'Mark complete', exact: true })).toHaveCount(0);
  await expect(details.getByRole('button', { name: 'Complete plan', exact: true })).toHaveCount(0);
  const saved = await api(request, 'employee', 'GET', `development-plans/${created._id}`);
  expect(saved.careerGoals.map((row: { progress: number }) => row.progress)).toEqual([80, 20]);
  expect(saved.careerGoals[0].targetRole).toBe('Delivery lead');
  expect(saved.skillDevelopment[0]).toMatchObject({ progress: 40, currentLevel: 'intermediate', targetLevel: 'advanced' });
  expect(saved.overallProgress).toBe(63); // mean of goal mean50, skill40, learning100
  await api(request, 'employee', 'POST', `development-plans/${created._id}/complete`, {}, 403);
  await api(request, 'peer', 'GET', `development-plans/${created._id}`, undefined, 403);
  await api(request, 'foreign', 'GET', `development-plans/${created._id}`, undefined, 404);
  await login(page, finalizer, `/development?plan=${created._id}`);
  await page.getByRole('dialog', { name: created.title }).getByRole('button', { name: 'Complete plan', exact: true }).click();
  const complete = page.getByRole('dialog', { name: 'Complete development plan?' });
  await complete.getByRole('button', { name: 'Complete plan', exact: true }).click(); await expect(complete).toBeHidden();
  await page.reload(); await expect(page.getByRole('dialog', { name: created.title }).getByText('completed', { exact: true })).toBeVisible();
  expect(await api(request, 'employee', 'GET', `development-plans/${created._id}`)).toMatchObject({ status: 'completed', overallProgress: 63 });
});

test('support milestone replies, extension progress and HR-only formal outcome persist through real API', async ({ page, request }) => {
  const plan = await api(request, 'manager', 'POST', 'support-plans', {
    employee: { userId: 'acceptance-employee' }, planType: 'formal_improvement', title: `Support outcomes ${Date.now()}`, summary: 'Fictional delivery support.',
    objectives: [{ title: 'Raise risks early', measure: 'Delivery log', target: 'Every milestone', dueDate: day(20) }],
    supportCommitments: [{ description: 'Weekly manager support', ownerType: 'manager' }],
    milestones: [{ title: 'First delivery review', dueDate: day(10) }], reviewDates: [day(20)]
  });
  await api(request, 'manager', 'POST', `support-plans/${plan._id}/submit-for-hr-review`, {});
  await api(request, 'hr_manager', 'POST', `support-plans/${plan._id}/hr-decision`, { decision: 'approve' });
  await api(request, 'employee', 'POST', `support-plans/${plan._id}/employee-response`, { acknowledgement: 'acknowledged' });
  await login(page, 'employee', '/support-plans'); await page.getByRole('button', { name: 'Open plan' }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Update milestone' }).click();
  let milestone = page.getByRole('dialog', { name: 'Update milestone', exact: true });
  await milestone.getByLabel('Employee update').fill('The first fictional delivery review is complete.');
  await milestone.getByLabel('Milestone status').click(); await page.getByRole('option', { name: 'Completed', exact: true }).click();
  await milestone.getByRole('button', { name: 'Save milestone' }).click(); await expect(milestone).toBeHidden();
  await expect(page.getByRole('button', { name: 'Record outcome', exact: true })).toHaveCount(0);
  await api(request, 'employee', 'POST', `support-plans/${plan._id}/outcome`, { decision: 'completed', reason: 'Not an authorized employee action.' }, 403);
  await api(request, 'manager', 'POST', `support-plans/${plan._id}/outcome`, { decision: 'escalated', reason: 'Formal decisions belong to HR.' }, 403);
  await login(page, 'manager', '/support-plans'); await page.getByRole('button', { name: 'Open plan' }).first().click();
  await page.getByRole('button', { name: 'Update milestone' }).click(); milestone = page.getByRole('dialog', { name: 'Update milestone', exact: true });
  await milestone.getByLabel('Manager response').fill('Reviewed the fictional record and agreed the milestone.');
  await milestone.getByRole('button', { name: 'Save milestone' }).click(); await expect(milestone).toBeHidden();
  await page.getByRole('button', { name: 'Record outcome', exact: true }).click();
  let outcome = page.getByRole('dialog', { name: 'Record support plan outcome' });
  await expect(outcome.getByRole('button', { name: 'Record outcome', exact: true })).toBeDisabled();
  await outcome.getByLabel('Outcome', { exact: true }).click(); await expect(page.getByRole('option', { name: 'Escalated', exact: true })).toHaveCount(0);
  await page.getByRole('option', { name: 'Extended', exact: true }).click(); await outcome.getByLabel('Outcome reason').fill('Continue the agreed support for another fictional milestone.');
  await outcome.getByLabel('Next review date (optional)').fill(day(30)); await outcome.getByRole('button', { name: 'Record outcome', exact: true }).click(); await expect(outcome).toBeHidden();
  await login(page, 'employee', '/support-plans'); await page.getByRole('button', { name: 'Open plan' }).first().click();
  await page.getByLabel('Progress update', { exact: true }).fill('Progress remains available after the extension.');
  await page.getByRole('button', { name: 'Add check-in', exact: true }).click(); await expect(page.getByText('Progress remains available after the extension.', { exact: true })).toBeVisible();
  await login(page, 'hr_manager', '/support-plans?view=team');
  // Admin workspace defaults to HR review; choose manager/team via the existing
  // UI only where available, otherwise follow the actual plan deep link.
  await page.goto(`/support-plans?plan=${plan._id}`);
  await expect(page.getByRole('button', { name: 'Record outcome', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Record outcome', exact: true }).click(); outcome = page.getByRole('dialog', { name: 'Record support plan outcome' });
  await outcome.getByLabel('Outcome', { exact: true }).click(); await page.getByRole('option', { name: 'Escalated', exact: true }).click();
  await outcome.getByLabel('Outcome reason').fill('HR recorded the fictional escalation after a human review.');
  await outcome.getByRole('button', { name: 'Record outcome', exact: true }).click(); await expect(outcome).toBeHidden();
  const saved = await api(request, 'hr_manager', 'GET', `support-plans/${plan._id}`);
  expect(saved).toMatchObject({ state: 'escalated', outcome: { decision: 'escalated', decidedBy: 'acceptance-hr_manager' } });
  expect(saved.milestones[0]).toMatchObject({ status: 'completed', employeeUpdate: 'The first fictional delivery review is complete.', managerResponse: 'Reviewed the fictional record and agreed the milestone.' });
  expect(saved.audit.map((row: { action: string }) => row.action)).toEqual(expect.arrayContaining(['milestone_updated', 'outcome_extended', 'outcome_escalated']));
  await api(request, 'peer', 'GET', `support-plans/${plan._id}`, undefined, 403);
  await api(request, 'foreign', 'GET', `support-plans/${plan._id}`, undefined, 404);
});
