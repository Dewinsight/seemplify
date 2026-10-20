import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const date = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
async function api(request: APIRequestContext, actor: string, method: string, path: string, data?: unknown) {
  const response = await request.fetch(`http://127.0.0.1:5014/api/${path}`, {
    method, headers: { 'x-acceptance-actor': actor }, data
  });
  expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBeTruthy();
  return (await response.json()).data;
}
async function loginHR(page: Page, path: string) {
  await page.goto(`http://127.0.0.1:5014/__test/login/hr_manager?path=${encodeURIComponent(path)}`);
  await expect(page.getByRole('button', { name: 'A', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^(Personal|Manager|Admin)$/ }).click();
  await page.getByRole('menuitemradio', { name: /^Admin/ }).click();
  await page.goto(path);
}
async function disableGoals(page: Page) {
  await page.getByLabel('Goal alignment enabled', { exact: true }).uncheck();
  await page.locator('#section-fields-goals').getByRole('spinbutton', { name: 'Weight %', exact: true }).fill('0');
  await page.locator('#section-fields-competencies').getByRole('spinbutton', { name: 'Weight %', exact: true }).fill('100');
  await expect(page.getByText('Scored weight 100%', { exact: true })).toBeVisible();
}

test('HR creates and launches a goals-disabled cycle for a person without approved goals', async ({ page, request }) => {
  const goals = await api(request, 'teamless', 'GET', 'okrs');
  expect(goals.filter((item: { ownerId: string }) => item.ownerId === 'acceptance-teamless')).toHaveLength(0);
  await loginHR(page, '/admin/appraisal-cycles/new');
  const name = `Goals disabled UI launch ${Date.now()}`;
  await page.getByRole('textbox', { name: 'Cycle Name', exact: true }).fill(name);
  await page.getByLabel('Period Start', { exact: true }).fill(date(-90));
  await page.getByLabel('Period End', { exact: true }).fill(date(-1));
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await disableGoals(page);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('tab', { name: 'List View', exact: true }).click();
  await page.getByPlaceholder('Search by name, team, department, or manager').fill('teamless');
  await page.getByText('Acceptance teamless', { exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('combobox', { name: 'Reviewer for Acceptance teamless' }).click();
  await page.getByRole('option', { name: /Acceptance hr manager ·/ }).click();
  const response = page.waitForResponse(value => value.request().method() === 'POST' && value.url().endsWith('/api/appraisals/cycles'));
  await page.getByRole('button', { name: 'Launch Review Cycle', exact: true }).click();
  const launched = await response;
  expect(launched.status()).toBe(201);
  expect(launched.request().postDataJSON()).toMatchObject({ settings: { requireOkrAlignment: false },
    workflowDefinition: { stages: { goalSetting: { enabled: false } }, scoring: { goalsWeight: 0, competenciesWeight: 100 } } });
  const cycle = (await launched.json()).data.cycle;
  await expect(page).toHaveURL(/\/admin\/appraisal-cycles$/);
  const persisted = await api(request, 'hr_manager', 'GET', `appraisals/cycles/${cycle._id}`);
  expect(persisted).toMatchObject({ name, settings: { requireOkrAlignment: false },
    workflowDefinition: { stages: { goalSetting: { enabled: false } }, scoring: { goalsWeight: 0, competenciesWeight: 100 } } });
  const items = await api(request, 'teamless', 'GET', 'appraisals/my');
  const listed = items.find((item: { cycleId: { _id: string } }) => item.cycleId._id === cycle._id);
  expect(listed).toBeTruthy();
  const appraisal = await api(request, 'teamless', 'GET', `appraisals/${listed._id}`);
  expect(appraisal.manager.userId).toBe('acceptance-hr_manager');
  expect(appraisal.goalSnapshots).toHaveLength(0);
  expect(appraisal.cycleConfigurationSnapshot).toMatchObject({ settings: { requireOkrAlignment: false },
    workflowDefinition: { stages: { goalSetting: { enabled: false } }, scoring: { goalsWeight: 0, competenciesWeight: 100 } } });
  await page.goto(`/admin/appraisal-cycles/${cycle._id}/edit`);
  await expect(page.getByLabel('Goal alignment enabled', { exact: true })).toBeDisabled();
  await expect(page.getByText('This design is frozen because the cycle has launched. Duplicate the cycle to create a revised version.', { exact: true })).toBeVisible();
});

test('HR draft-cycle edit persists the visible disabled goal alignment setting before launch', async ({ page, request }) => {
  const templates = await api(request, 'hr_manager', 'GET', 'appraisals/cycle-templates');
  const design = structuredClone(templates[0].design);
  design.stages.goalSetting.enabled = true;
  const cycle = await api(request, 'hr_manager', 'POST', 'appraisals/cycles', {
    name: `Goal alignment draft edit ${Date.now()}`, periodStart: date(-90), periodEnd: date(-1),
    workflowDefinition: design, settings: { requireOkrAlignment: true, enableAiAssist: false }
  });
  expect(cycle).toMatchObject({ status: 'draft', settings: { requireOkrAlignment: true } });
  await loginHR(page, `/admin/appraisal-cycles/${cycle._id}/edit`);
  await expect(page.getByLabel('Goal alignment enabled', { exact: true })).toBeChecked();
  await disableGoals(page);
  const response = page.waitForResponse(value => value.request().method() === 'PUT' && value.url().endsWith(`/api/appraisals/cycles/${cycle._id}`));
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  const saved = await response;
  expect(saved.status()).toBe(200);
  expect(saved.request().postDataJSON().settings.requireOkrAlignment).toBe(false);
  await expect(page).toHaveURL(/\/admin\/appraisal-cycles$/);
  const persisted = await api(request, 'hr_manager', 'GET', `appraisals/cycles/${cycle._id}`);
  expect(persisted).toMatchObject({ status: 'draft', settings: { requireOkrAlignment: false },
    workflowDefinition: { stages: { goalSetting: { enabled: false } }, scoring: { goalsWeight: 0, competenciesWeight: 100 } } });
  await page.goto(`/admin/appraisal-cycles/${cycle._id}/edit`);
  await expect(page.getByLabel('Goal alignment enabled', { exact: true })).not.toBeChecked();
  expect((await api(request, 'hr_manager', 'GET', `appraisals/cycles/${cycle._id}`)).stats?.totalEmployees || 0).toBe(0);
});
