import { expect, test, type Page } from '@playwright/test';
// UI contract fixtures only. Persistence/rollback/scope are verified in the
// backend replica-set integration suite; these fixtures never contact live HR.
async function setup(page: Page, enabled = true) {
  const org = { id: 'unified-qa', name: 'Synthetic organisation', role: 'hr_manager' };
  const user = { id: 'manager', sub: 'manager', name: 'Synthetic Manager', organizations: [org] };
  const cycle = { id: 'unified-cycle', name: 'Architecture review', status: 'published', revision: 2, reviewMode: enabled ? 'competency' : 'regular', cadence: { type: 'periodic', frequency: 'quarterly' }, roleVersionIds: ['solution-architect-v1', 'product-manager-v1'], period: { start: '2024-01-01', end: '2024-03-31' } };
  const calls: Array<{ path: string; body: any }> = [];
  await page.addInitScript(() => localStorage.setItem('accessToken', 'synthetic-unified-ui'));
  await page.route('**/__mock-api/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/__mock-api', '');
    const method = route.request().method(); let data: unknown = [];
    if (method === 'POST' && (path.startsWith('/competency/') || path.startsWith('/appraisals/'))) calls.push({ path, body: route.request().postDataJSON() });
    if (path === '/auth/me') { await route.fulfill({ json: { success: true, user, currentOrganization: org, currentOrganizationId: org.id } }); return; }
    if (path === '/user/context') data = { user, organization: org, role: { name: 'line_manager', isManager: true, isHRAdmin: false }, teams: [], features: {}, stats: {} };
    if (path === '/competency/bootstrap') data = { enabled, capabilities: { cycleManage: true, assessmentLaunch: true }, roles: [{ id: 'architect', versionId: 'solution-architect-v1', name: 'Solution Architect', version: 1 }, { id: 'product', versionId: 'product-manager-v1', name: 'Product Manager', version: 1 }], frameworks: [], strategies: [], cycles: [cycle], people: [] };
    if (path === '/appraisals/colleague-roster') data = { employees: [{ userId: 'employee', name: 'Synthetic Employee', email: 'employee@example.test', teamName: 'Product', reviewerOptions: [{ userId: 'manager', name: 'Synthetic Manager' }], isSelectableForAppraisal: true }] };
    if (path === '/competency/cycles/unified-cycle/start-appraisals') data = { launched: 1, replayed: 0, appraisals: [{ _id: 'created-appraisal', employee: { name: 'Synthetic Employee' }, manager: { name: 'Synthetic Manager' } }], existingAppraisals: [] };
    await route.fulfill({ json: { success: true, data } });
  });
  return calls;
}
test('one cycle choice launches appraisal and role together, with next-period selection', async ({ page }) => {
  const calls = await setup(page);
  await page.goto('/appraisals/start?assessmentCycleId=unified-cycle');
  await page.getByRole('checkbox', { name: 'Select Synthetic Employee' }).check();
  await page.getByRole('combobox', { name: 'Role for Synthetic Employee' }).click();
  await page.getByRole('option', { name: 'Solution Architect · v1' }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Period starts', { exact: true }).fill('2024-04-01');
  await page.getByLabel('Period ends', { exact: true }).fill('2024-06-30');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('AI questions will use each selected role’s published criteria and expected levels.', { exact: false })).toBeVisible();
  await page.screenshot({ path: 'test-results/unified-appraisal-confirmation.png', fullPage: true });
  await page.getByRole('button', { name: 'Start 1 appraisal', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Appraisals started' })).toBeVisible();
  expect(calls).toHaveLength(1);
  expect(calls[0].path).toBe('/competency/cycles/unified-cycle/start-appraisals');
  expect(calls[0].body.assignments).toEqual([{ participantId: 'employee', reviewerId: 'manager', roleVersionId: 'solution-architect-v1', cvRequested: false }]);
  expect(calls[0].body.period).toEqual({ start: '2024-04-01', end: '2024-06-30' });
});
test('regular appraisals remain available when competency assessment is disabled', async ({ page }) => {
  await setup(page, false);
  await page.goto('/appraisals/start?assessmentCycleId=unified-cycle');
  await page.getByRole('checkbox', { name: 'Select Synthetic Employee' }).check();
  await expect(page.getByRole('combobox', { name: 'Role for Synthetic Employee' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByLabel('Period starts', { exact: true })).toBeVisible();
});
test('mobile cycle setup exposes review type and cadence without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.goto('/competency/cycles/new');
  await expect(page.getByRole('combobox', { name: /^Review type/ })).toBeVisible();
  await page.getByRole('combobox', { name: /^Schedule/ }).click();
  await page.getByRole('option', { name: 'Periodic', exact: true }).click();
  await expect(page.getByRole('combobox', { name: /^Repeat every/ })).toBeVisible();
  await page.getByRole('listbox', { includeHidden: true }).waitFor({ state: 'detached' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/unified-cycle-mobile.png', fullPage: true, animations: 'disabled' });
});

test('optional CV request and the established workflow reach the atomic launch together', async ({ page }) => {
  const calls = await setup(page);
  await page.goto('/appraisals/start?assessmentCycleId=unified-cycle');
  await page.getByRole('checkbox', { name: 'Select Synthetic Employee' }).check();
  await page.getByRole('combobox', { name: 'Role for Synthetic Employee' }).click();
  await page.getByRole('option', { name: 'Product Manager · v1' }).click();
  await page.getByRole('checkbox', { name: 'Request a CV for this appraisal' }).check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Optional CV requested for the selected roles.')).toBeVisible();
  await page.getByRole('button', { name: 'Start 1 appraisal', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Appraisals started' })).toBeVisible();
  expect(calls[0].body.assignments[0].cvRequested).toBe(true);
  expect(calls[0].body.appraisalFlow.steps.map((step: { type: string }) => step.type)).toEqual(['selfAssessment', 'oneOnOne', 'managerReview', 'finalReview']);
});

test('staff deep links preserve the eligible participant and block invalid period/deadline order', async ({ page }) => {
  const calls = await setup(page);
  await page.goto('/appraisals/start?assessmentCycleId=unified-cycle&employeeId=employee');
  await expect(page.getByRole('checkbox', { name: 'Select Synthetic Employee' })).toBeChecked();
  await page.getByRole('combobox', { name: 'Role for Synthetic Employee' }).click();
  await page.getByRole('option', { name: 'Solution Architect · v1' }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Period starts', { exact: true }).fill('2099-01-01');
  await page.getByLabel('Period ends', { exact: true }).fill('2099-03-31');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Choose a completed review period. The end date must be before today.')).toBeVisible();
  await page.getByLabel('Period starts', { exact: true }).fill('2024-04-01');
  await page.getByLabel('Period ends', { exact: true }).fill('2024-06-30');
  await page.getByLabel('Employee response deadline', { exact: true }).fill('2099-03-02');
  await page.getByLabel('Reviewer deadline', { exact: true }).fill('2099-03-01');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Set the employee deadline first, then a later reviewer deadline.')).toBeVisible();
  expect(calls).toHaveLength(0);
});
