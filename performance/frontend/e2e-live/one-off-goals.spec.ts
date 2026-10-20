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
async function setup(page: Page, actor: string, title: string, year = 2020) {
  await page.goto(`http://127.0.0.1:5014/__test/login/${actor}?path=${encodeURIComponent('/appraisals/start')}`);
  await page.getByRole('checkbox', { name: /Acceptance employee/ }).check();
  await select(page, page, 'Reviewer for Acceptance employee', 'Acceptance manager · line manager');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await select(page, page, 'Review cycle', 'New one-off review');
  await page.getByRole('textbox', { name: 'Review name', exact: true }).fill(title);
  await page.getByLabel(/^Assessment period starts/).fill(`${year}-01-01`);
  await page.getByLabel(/^Assessment period ends/).fill(`${year}-03-31`);
  await page.getByRole('switch', { name: 'AI conversation for employee assessment', exact: true }).uncheck();
}

for (const actor of ['manager', 'hr_manager']) test(`${actor} starts an ordinary one-off review without goals or an occupational role`, async ({ page, request }, info) => {
  await api(request, 'admin', 'PATCH', 'organization-features', { features: { competencyAssessments: false } });
  await setup(page, actor, `Ordinary no-goal ${actor} ${Date.now()}`);
  await expect(page.getByRole('checkbox', { name: 'Include approved goals', exact: true })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Assess against an occupational role' })).toHaveCount(0);
  if (actor === 'manager') {
    await page.getByRole('checkbox', { name: 'Include approved goals', exact: true }).check();
    await page.getByRole('button', { name: 'Create or link goals', exact: true }).click();
    const workspace = page.getByRole('dialog', { name: 'Set up goals for this review', exact: true });
    await workspace.getByRole('button', { name: 'Create goal', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Create goal', exact: true });
    await editor.locator('label').filter({ hasText: 'Scope' }).first().locator('..').getByRole('combobox').click();
    await expect(page.getByRole('option', { name: 'Organization', exact: true })).toHaveCount(0);
    await page.getByRole('option', { name: 'Individual', exact: true }).click();
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    await workspace.getByRole('button', { name: 'Done — return to review', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Include approved goals', exact: true }).uncheck();
  }
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Review without goals', { exact: true })).toBeVisible();
  const created = page.waitForResponse(response => response.url() === `${API}/appraisals/cycles` && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Start appraisals', exact: true }).click();
  const response = await created; expect(response.status()).toBe(201);
  const result = (await response.json()).data;
  expect(result.launchSummary.launched).toBe(1);
  expect(result.cycle.settings.requireOkrAlignment).toBe(false);
  expect(result.cycle.workflowDefinition.scoring).toEqual({ goalsWeight: 0, competenciesWeight: 100 });
  expect(result.cycle.workflowDefinition.sections.some((section: { type: string }) => section.type === 'goals')).toBe(false);
  await expect(page.getByRole('heading', { name: 'Appraisal launch results' })).toBeVisible();
  await page.screenshot({ path: info.outputPath(`one-off-${actor}-without-goals.png`), fullPage: true });
});

test('HR creates and links organization, team and staff goals inside setup, then launches after the employee acknowledges', async ({ page, request }, info) => {
  test.setTimeout(180_000);
  const stamp = Date.now(), reviewTitle = `Inline goal review ${stamp}`;
  const period = await api(request, 'hr_manager', 'POST', 'goal-periods', { name: `Review goals ${stamp}`, code: `REVIEW-${stamp}`, startDate: '2021-01-01', endDate: '2021-03-31', planningEndDate: '2020-12-31', status: 'open' });
  await setup(page, 'hr_manager', reviewTitle, 2021);
  await page.getByRole('checkbox', { name: 'Include approved goals', exact: true }).check();
  await expect(page.getByText(/No eligible approved goal for this period/)).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review details', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create or link goals', exact: true }).click();
  const workspace = page.getByRole('dialog', { name: 'Set up goals for this review', exact: true });
  await expect(workspace.getByRole('heading', { name: 'Goals', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/appraisals\/start$/);
  async function create(scope: string, title: string, parent?: string) {
    await workspace.getByRole('button', { name: 'Create goal', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Create goal', exact: true });
    await editor.getByRole('textbox', { name: 'Goal title', exact: true }).fill(title);
    await select(page, editor, 'Period', period.name);
    await select(page, editor, 'Scope', scope);
    if (scope === 'Team') await select(page, editor, 'Team', 'Acceptance team');
    if (parent) {
      await editor.getByRole('combobox', { name: 'Align to parent goal (optional)' }).click();
      await page.getByRole('option', { name: `${parent} · ${period.name}`, exact: true }).click();
    }
    await editor.getByRole('textbox', { name: 'Objective', exact: true }).fill('Document the fictional review exercise');
    await editor.getByRole('textbox', { name: 'Key result 1', exact: true }).fill('Complete all five fictional checklist steps');
    if (scope === 'Individual') {
      await editor.getByRole('checkbox', { name: 'Include this late goal in appraisal scoring', exact: true }).check();
      await editor.getByLabel('Reason for including a late goal').fill('Reconstructed fictional evidence for this one-off review.');
    }
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
  await expect(page).toHaveURL(/\/appraisals\/start$/);
  await workspace.getByRole('button', { name: 'Done — return to review', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Review name', exact: true })).toHaveValue(reviewTitle);
  await expect(page.getByText(/No eligible approved goal for this period/)).toBeVisible();
  await api(request, 'employee', 'POST', `okrs/${staff._id}/acknowledge`, { comment: 'Acknowledged fictional test evidence.' });
  await page.getByRole('button', { name: 'Refresh goal readiness', exact: true }).click();
  await expect(page.getByText(/1 eligible approved goal/)).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: /Set up approved goals for each selected person/ })).toHaveCount(0);
  await page.locator('section[aria-labelledby="review-goals-heading"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('one-off-inline-goals-ready.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('section[aria-labelledby="review-goals-heading"]').scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('one-off-inline-goals-mobile.png') });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Approved goals included', { exact: true })).toBeVisible();
  const created = page.waitForResponse(response => response.url() === `${API}/appraisals/cycles` && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Start appraisals', exact: true }).click();
  const response = await created; expect(response.status()).toBe(201);
  const result = (await response.json()).data;
  expect(result.cycle.settings.requireOkrAlignment).toBe(true);
  const appraisal = await api(request, 'hr_manager', 'GET', `appraisals/${result.launchSummary.appraisals[0]._id}`);
  expect(appraisal.goalSnapshots).toHaveLength(1);
  expect(String(appraisal.goalSnapshots[0].sourceGoalId)).toBe(staff._id);
  expect(String(appraisal.goalSnapshots[0].alignment.parentOKRId)).toBe(team._id);
});
