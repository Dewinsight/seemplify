import { expect, test, type APIRequestContext, type Page, type Locator } from '@playwright/test';

const API = 'http://127.0.0.1:5014/api';
async function api(request: APIRequestContext, actor: string, method: string, path: string, data?: unknown) {
  const response = await request.fetch(`${API}/${path}`, { method, headers: { 'x-acceptance-actor': actor }, data });
  expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBeTruthy();
  return (await response.json()).data;
}
async function select(page: Page, within: Page | Locator, label: string, option: string) {
  await within.locator('label').filter({ hasText: label }).first().locator('..').getByRole('combobox').click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
async function login(page: Page, actor: string, path: string) {
  await page.goto(`http://127.0.0.1:5014/__test/login/${actor}?path=${encodeURIComponent(path)}`);
  await expect(page.getByRole('button', { name: 'Account menu', exact: true })).toBeVisible();
  if (actor === 'manager' || actor === 'hr_manager') {
    await page.getByRole('button', { name: /^(Personal|Manager|Admin)$/ }).click();
    await page.getByRole('menuitemradio', { name: actor === 'hr_manager' ? /^Admin/ : /^Manager/ }).click();
    await page.goto(path);
  }
}
async function publishOneTimeCycle(page: Page, actor: string, title: string, year = 2020, includeGoals = false) {
  await login(page, actor, '/competency/cycles/new');
  await select(page, page, 'Review type', 'Regular appraisal');
  await expect(page.getByRole('checkbox', { name: 'Include approved goals', exact: true })).not.toBeChecked();
  if (includeGoals) await page.getByRole('checkbox', { name: 'Include approved goals', exact: true }).check();
  await page.getByRole('textbox', { name: 'Cycle name', exact: true }).fill(title);
  await page.getByLabel('Assessment period starts', { exact: true }).fill(`${year}-01-01`);
  await page.getByLabel('Assessment period ends', { exact: true }).fill(`${year}-03-31`);
  const created = page.waitForResponse(response => response.url() === `${API}/competency/cycles` && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  const response = await created; expect(response.status()).toBe(201);
  const cycle = (await response.json()).data;
  expect(cycle).toMatchObject({ reviewMode: 'regular', includeApprovedGoals: includeGoals, cadence: { type: 'one_time' } });
  await expect(page).toHaveURL(new RegExp(`/competency/cycles/${cycle.id}$`));
  await page.getByText('Review', { exact: true }).click();
  await page.getByRole('button', { name: 'Check readiness', exact: true }).click();
  await expect(page.getByText('Configuration is valid and ready to publish.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Publish cycle', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publish cycle', exact: true }).click();
  await expect(page.getByText('Cycle published. Select it when starting an appraisal.', { exact: true })).toBeVisible();
  return cycle;
}
async function prepareLaunch(page: Page, cycleId: string) {
  await page.goto(`/appraisals/start?assessmentCycleId=${cycleId}`);
  await page.getByRole('textbox', { name: 'Find staff', exact: true }).fill('employee');
  await page.getByRole('checkbox', { name: 'Select Acceptance employee', exact: true }).check();
  await select(page, page, 'Reviewer for Acceptance employee', 'Acceptance manager');
  await expect(page.getByRole('combobox', { name: 'Role for Acceptance employee' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('switch', { name: 'AI conversation for employee assessment', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
}

for (const actor of ['manager', 'hr_manager']) test(`${actor} configures and starts an ordinary one-time review without goals or an occupational role`, async ({ page, request }, info) => {
  await api(request, 'admin', 'PATCH', 'organization-features', { features: { competencyAssessments: false } });
  if (actor === 'manager') {
    // The standalone goals workspace is the current goal-entry surface. A team
    // manager still cannot create organization goals through its actual picker.
    await login(page, actor, '/okrs?view=team');
    await page.getByRole('button', { name: 'Create goal', exact: true }).first().click();
    const editor = page.getByRole('dialog', { name: 'Create goal', exact: true });
    await editor.locator('label').filter({ hasText: 'Scope' }).first().locator('..').getByRole('combobox').click();
    await expect(page.getByRole('option', { name: 'Team', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Organization', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
  const cycle = await publishOneTimeCycle(page, actor, `Ordinary no-goal ${actor} ${Date.now()}`);
  await prepareLaunch(page, cycle.id);
  const created = page.waitForResponse(response => response.url() === `${API}/competency/cycles/${cycle.id}/start-appraisals` && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Start 1 appraisal', exact: true }).click();
  const response = await created; expect(response.status()).toBe(201);
  const result = (await response.json()).data;
  expect(result.launched).toBe(1);
  const appraisal = await api(request, actor, 'GET', `appraisals/${result.appraisals[0]._id}`);
  expect(appraisal.cycleConfigurationSnapshot.settings.requireOkrAlignment).toBe(false);
  expect(appraisal.cycleConfigurationSnapshot.workflowDefinition.scoring).toEqual({ goalsWeight: 0, competenciesWeight: 100 });
  expect(appraisal.cycleConfigurationSnapshot.workflowDefinition.sections.some((section: { type: string }) => section.type === 'goals')).toBe(false);
  expect(appraisal.goalSnapshots).toHaveLength(0);
  const disabledLinks = await request.get(`${API}/competency/appraisal-links/${appraisal._id}`, { headers: { 'x-acceptance-actor': actor } });
  expect(disabledLinks.status()).toBe(403);
  expect((await disabledLinks.json()).error.code).toBe('COMPETENCY_DISABLED');
  // The feature guard correctly denies even an empty link listing. Inspect the
  // persisted no-role result only after explicitly enabling that read surface,
  // then restore the disabled fixture policy for the remaining journey.
  await api(request, 'admin', 'PATCH', 'organization-features', { features: { competencyAssessments: true } });
  try {
    expect((await api(request, actor, 'GET', `competency/appraisal-links/${appraisal._id}`)).assessments).toHaveLength(0);
  } finally {
    await api(request, 'admin', 'PATCH', 'organization-features', { features: { competencyAssessments: false } });
  }
  await expect(page.getByRole('heading', { name: 'Appraisals started', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath(`one-time-${actor}-without-goals.png`), fullPage: true });
});

test('HR creates organization, team and staff goals in the current workspace, then launches a published cycle after employee acknowledgement', async ({ page, browser, request }, info) => {
  test.setTimeout(180_000);
  const stamp = Date.now(), reviewTitle = `Goals-backed one-time review ${stamp}`;
  // A custom open period is foundational setup. Goals themselves are created
  // through the real workspace; this period has no closed planning deadline.
  const period = await api(request, 'hr_manager', 'POST', 'goal-periods', { name: `Review goals ${stamp}`, code: `REVIEW-${stamp}`, startDate: '2021-01-01', endDate: '2021-03-31', status: 'open' });
  await login(page, 'hr_manager', '/okrs?view=organization');
  async function create(scope: string, title: string, parent?: string) {
    await page.getByRole('button', { name: 'Create goal', exact: true }).first().click();
    const editor = page.getByRole('dialog', { name: 'Create goal', exact: true });
    await editor.getByRole('textbox', { name: 'Goal title', exact: true }).fill(title);
    await select(page, editor, 'Period', period.name);
    await select(page, editor, 'Scope', scope);
    if (scope === 'Team') await select(page, editor, 'Team', 'Acceptance team');
    if (scope === 'Individual') {
      await editor.getByRole('combobox', { name: 'Assignees', exact: true }).fill('Acceptance employee');
      await page.getByRole('option', { name: 'Acceptance employee', exact: true }).click();
    }
    if (parent) {
      await editor.getByRole('combobox', { name: 'Align to parent goal (optional)' }).click();
      await page.getByRole('option', { name: `${parent} · ${period.name}`, exact: true }).click();
    }
    await editor.getByRole('textbox', { name: 'Objective', exact: true }).fill('Document the fictional review exercise');
    await editor.getByRole('textbox', { name: 'Key result 1', exact: true }).fill('Complete all five fictional checklist steps');
    const saved = page.waitForResponse(response => response.url() === `${API}/okrs` && response.request().method() === 'POST');
    await editor.getByRole('button', { name: 'Create goal', exact: true }).click();
    const response = await saved; expect(response.status()).toBe(201);
    await expect(editor).not.toBeVisible();
    await expect(page.getByText('Goal created.', { exact: true })).toBeVisible();
    return (await response.json()).data;
  }
  const organization = await create('Organization', `Fictional organization direction ${stamp}`);
  const team = await create('Team', `Fictional team delivery ${stamp}`, organization.title);
  const staff = await create('Individual', `Fictional staff outcome ${stamp}`, team.title);
  expect(staff.ownerId).toBe('acceptance-employee');
  expect(staff.assignment.acknowledgementStatus).toBe('pending');
  expect(String(team.alignment.parentOKRId)).toBe(organization._id);
  expect(String(staff.alignment.parentOKRId)).toBe(team._id);
  const cycle = await publishOneTimeCycle(page, 'hr_manager', reviewTitle, 2021, true);
  await prepareLaunch(page, cycle.id);
  await page.getByRole('button', { name: 'Start 1 appraisal', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: /Approve aligned goals for Acceptance employee/ })).toBeVisible();

  const employee = await browser.newPage();
  try {
    await login(employee, 'employee', '/okrs?view=my');
    await employee.getByRole('tab', { name: 'Past', exact: true }).click();
    await select(employee, employee, 'Period', period.name);
    const goal = employee.locator(`#goal-${staff._id}`);
    await expect(goal.getByText(staff.title, { exact: true })).toBeVisible();
    await goal.getByRole('button', { name: 'Acknowledge', exact: true }).click();
    await expect(employee.getByText('Goal acknowledged.', { exact: true })).toBeVisible();
    const acknowledged = await api(request, 'employee', 'GET', `okrs/${staff._id}`);
    expect(acknowledged.assignment.acknowledgementStatus).toBe('acknowledged');
    expect(acknowledged.lifecycle.state).toBe('active');
  } finally { await employee.close(); }

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('one-time-goals-launch-mobile.png'), fullPage: true });
  const created = page.waitForResponse(response => response.url() === `${API}/competency/cycles/${cycle.id}/start-appraisals` && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Start 1 appraisal', exact: true }).click();
  const response = await created; expect(response.status()).toBe(201);
  const result = (await response.json()).data;
  expect(result.launched).toBe(1);
  const appraisal = await api(request, 'hr_manager', 'GET', `appraisals/${result.appraisals[0]._id}`);
  expect(appraisal.cycleConfigurationSnapshot.settings.requireOkrAlignment).toBe(true);
  expect(appraisal.goalSnapshots).toHaveLength(1);
  expect(String(appraisal.goalSnapshots[0].sourceGoalId)).toBe(staff._id);
  expect(String(appraisal.goalSnapshots[0].alignment.parentOKRId)).toBe(team._id);
});
