import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const date = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const API = 'http://127.0.0.1:5014/api';
async function api(request: APIRequestContext, actor: string, method: string, path: string, data?: unknown, revision?: number) {
  const response = await request.fetch(`${API}/${path}`, {
    method, headers: { 'x-acceptance-actor': actor, 'Idempotency-Key': randomUUID(), ...(revision !== undefined ? { 'If-Match': String(revision) } : {}) }, data,
  });
  expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBeTruthy();
  return (await response.json()).data;
}
async function loginHR(page: Page, path: string) {
  await page.goto(`http://127.0.0.1:5014/__test/login/hr_manager?path=${encodeURIComponent(path)}`);
  await expect(page.getByRole('button', { name: 'Account menu', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^(Personal|Manager|Admin)$/ }).click();
  await page.getByRole('menuitemradio', { name: /^Admin/ }).click();
  await page.goto(path);
}
async function select(page: Page, label: string, option: string) {
  await page.locator('label').filter({ hasText: label }).first().locator('..').getByRole('combobox').click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
async function disableGoals(page: Page) {
  // The default can be unchecked before it has ever been set in the payload.
  // Exercise a deliberate choice so this test verifies the saved false value.
  await page.getByRole('checkbox', { name: 'Include approved goals', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Include approved goals', exact: true }).uncheck();
  await page.locator('#section-fields-goals').getByRole('spinbutton', { name: 'Weight %', exact: true }).fill('0');
  await page.locator('#section-fields-competencies').getByRole('spinbutton', { name: 'Weight %', exact: true }).fill('100');
  await expect(page.getByText('Scored weight 100%', { exact: true })).toBeVisible();
}

test('HR creates, publishes and launches a goals-disabled cycle for a person without approved goals', async ({ page, request }) => {
  const goals = await api(request, 'teamless', 'GET', 'okrs');
  expect(goals.filter((item: { ownerId: string }) => item.ownerId === 'acceptance-teamless')).toHaveLength(0);
  await loginHR(page, '/admin/appraisal-cycles/new');
  const name = `Goals disabled UI launch ${Date.now()}`;
  await select(page, 'Review type', 'Regular appraisal');
  await page.getByRole('textbox', { name: 'Cycle name', exact: true }).fill(name);
  await page.getByLabel('Assessment period starts', { exact: true }).fill(date(-90));
  await page.getByLabel('Assessment period ends', { exact: true }).fill(date(-1));
  await disableGoals(page);
  const createdResponse = page.waitForResponse(value => value.request().method() === 'POST' && value.url().endsWith('/api/competency/cycles'));
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  const created = await createdResponse;
  expect(created.status()).toBe(201);
  expect(created.request().postDataJSON()).toMatchObject({ includeApprovedGoals: false, workflowDefinition: { scoring: { goalsWeight: 0, competenciesWeight: 100 } } });
  const configuration = (await created.json()).data;
  await expect(page).toHaveURL(new RegExp(`/competency/cycles/${configuration.id}$`));
  await page.getByText('Review', { exact: true }).click();
  await page.getByRole('button', { name: 'Check readiness', exact: true }).click();
  await expect(page.getByText('Configuration is valid and ready to publish.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Publish cycle', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publish cycle', exact: true }).click();
  await expect(page.getByText('Cycle published. Select it when starting an appraisal.', { exact: true })).toBeVisible();
  const published = await api(request, 'hr_manager', 'GET', `competency/cycles/${configuration.id}`);
  expect(published).toMatchObject({ name, status: 'published', reviewMode: 'regular', includeApprovedGoals: false,
    workflowDefinition: { scoring: { goalsWeight: 0, competenciesWeight: 100 } } });

  // Reusable published setup is the current entry point; launch keeps a frozen
  // occurrence and still exercises real staff, reviewer and deadline controls.
  await page.getByRole('link', { name: 'Start appraisals', exact: true }).click();
  await page.getByRole('textbox', { name: 'Find staff', exact: true }).fill('teamless');
  await page.getByRole('checkbox', { name: 'Select Acceptance teamless', exact: true }).check();
  await select(page, 'Reviewer for Acceptance teamless', 'Acceptance hr manager');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('switch', { name: 'AI conversation for employee assessment', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const launchResponse = page.waitForResponse(value => value.request().method() === 'POST' && value.url().endsWith(`/api/competency/cycles/${configuration.id}/start-appraisals`));
  await page.getByRole('button', { name: 'Start 1 appraisal', exact: true }).click();
  const launched = await launchResponse;
  expect(launched.status()).toBe(201);
  const receipt = (await launched.json()).data;
  expect(receipt.launched).toBe(1);
  await expect(page.getByRole('heading', { name: 'Appraisals started', exact: true })).toBeVisible();
  const appraisal = await api(request, 'teamless', 'GET', `appraisals/${receipt.appraisals[0]._id}`);
  expect(appraisal.manager.userId).toBe('acceptance-hr_manager');
  expect(appraisal.goalSnapshots).toHaveLength(0);
  expect(appraisal.cycleConfigurationSnapshot).toMatchObject({ assessmentCycleId: configuration.id, settings: { requireOkrAlignment: false },
    workflowDefinition: { stages: { goalSetting: { enabled: false } }, scoring: { goalsWeight: 0, competenciesWeight: 100 } } });
  expect(appraisal.cycleConfigurationSnapshot.workflowDefinition.sections.some((section: { type: string }) => section.type === 'goals')).toBe(false);
  await page.goto(`/competency/cycles/${configuration.id}`);
  await expect(page.getByRole('checkbox', { name: 'Include approved goals', exact: true })).toBeDisabled();
  await expect(page.getByText('Published configuration — read only', { exact: true })).toBeVisible();
});

test('HR draft-cycle edit persists the visible disabled goal inclusion setting before publication', async ({ page, request }) => {
  const templates = await api(request, 'hr_manager', 'GET', 'appraisals/cycle-templates');
  const design = structuredClone(templates[0].design);
  const cycle = await api(request, 'hr_manager', 'POST', 'competency/cycles', {
    name: `Goal inclusion draft edit ${Date.now()}`, reviewMode: 'regular', period: { start: date(-90), end: date(-1) },
    workflowDefinition: design, includeApprovedGoals: true,
  });
  expect(cycle).toMatchObject({ status: 'draft', includeApprovedGoals: true });
  await loginHR(page, `/competency/cycles/${cycle.id}`);
  await expect(page.getByRole('checkbox', { name: 'Include approved goals', exact: true })).toBeChecked();
  await disableGoals(page);
  const response = page.waitForResponse(value => value.request().method() === 'PATCH' && value.url().endsWith(`/api/competency/cycles/${cycle.id}`));
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  const saved = await response;
  expect(saved.status()).toBe(200);
  expect(saved.request().postDataJSON().includeApprovedGoals).toBe(false);
  await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
  const persisted = await api(request, 'hr_manager', 'GET', `competency/cycles/${cycle.id}`);
  expect(persisted).toMatchObject({ status: 'draft', includeApprovedGoals: false,
    workflowDefinition: { scoring: { goalsWeight: 0, competenciesWeight: 100 } } });
  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'Include approved goals', exact: true })).not.toBeChecked();
  // Saving reusable setup must not start an appraisal for anybody.
  const mine = await api(request, 'teamless', 'GET', 'appraisals/my');
  expect(mine.some((appraisal: { cycleConfigurationSnapshot?: { assessmentCycleId?: string } }) => appraisal.cycleConfigurationSnapshot?.assessmentCycleId === cycle.id)).toBe(false);
});
