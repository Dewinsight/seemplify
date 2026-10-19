import { expect, test, type Page } from '@playwright/test';

// UI transport contracts only. Real role/tenant/score persistence is verified separately.
const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => { const errors: string[] = []; pageErrors.set(page, errors); page.on('pageerror', error => errors.push(error.name)); });
test.afterEach(({ page }) => { expect(pageErrors.get(page) || []).toEqual([]); });
async function setup(page: Page, final = false) {
  const criterion = (id: string, name: string) => ({ id, criterionId: id, name, sourceType: 'internal', sourceVersionId: 'framework', sourceName: 'Synthetic internal framework', description: 'Use documented evidence.', required: true, rationaleRequired: true, evidenceRequired: false, levels: [{ id: 'guided', label: 'Guided' }, { id: 'independent', label: 'Independent' }], expectedLevel: { id: 'independent', label: 'Independent' }, weight: 1 });
  const record = { id: 'assessment', revision: 1, status: final ? 'published' : 'in_progress', cycleId: 'cycle', cycleVersion: 1, participant: { userId: 'employee', name: 'Synthetic Employee' }, assessors: [{ userId: 'reviewer', name: 'Synthetic Reviewer' }], definitionSnapshot: { role: { name: 'Synthetic occupational role', version: 1 }, selectedInputTypes: ['internal'], criteria: [criterion('delivery', 'Delivery outcomes'), criterion('risk', 'Risk judgement')], scoringConfig: { ratingScales: [], normalization: ['delivery', 'risk'].map(id => ({ sourceVersionId: 'framework', criterionId: id, method: 'level_map', levelScores: { guided: 40, independent: 80 } })), thresholds: [] } }, items: [{ criterionId: 'delivery', status: 'assessed', observedLevelId: 'independent', rationale: 'Previously saved delivery evidence.', evidenceIds: [], reviewedSuggestionIds: [] }, { criterionId: 'risk', status: 'not_started', rationale: '', evidenceIds: [], reviewedSuggestionIds: [] }], managerFeedback: [], evidence: [], oralSessions: [], aiSuggestions: [], allowedActions: ['competency.assessment.view', 'competency.assessment.edit', 'competency.evidence.view', 'competency.evidence.create'], createdAt: '2026-10-18T12:00:00Z', updatedAt: '2026-10-18T12:00:00Z' };
  const writes: Array<{ items: Array<{ criterionId: string; observedLevelId: string; rationale: string }> }> = [];
  await page.addInitScript(() => localStorage.setItem('accessToken', 'synthetic-filter-contract'));
  await page.route('**/__mock-api/**', async route => {
    const endpoint = new URL(route.request().url()).pathname.replace('/__mock-api', '');
    const user = { id: 'reviewer', sub: 'reviewer', name: 'Synthetic Reviewer', email: 'reviewer@example.test' }, organization = { id: 'org', role: 'hr_manager', name: 'Synthetic organisation' };
    let data: unknown = [];
    if (endpoint === '/auth/me') { await route.fulfill({ json: { success: true, user: { ...user, organizations: [organization] }, currentOrganization: organization, currentOrganizationId: 'org' } }); return; }
    if (endpoint === '/user/context') data = { user, organization, role: { name: 'hr_admin', isManager: true, isHRAdmin: true }, teams: [], features: {}, stats: {} };
    if (endpoint === '/competency/bootstrap') data = { enabled: true, capabilities: {}, people: [], roles: [], frameworks: [], strategies: [], cycles: [] };
    if (endpoint.endsWith('/evidence') && route.request().method() === 'POST') { record.revision += 1; data = { id: 'evidence', ...route.request().postDataJSON() }; }
    if (endpoint === '/competency/assessments/assessment') {
      if (route.request().method() === 'PATCH') {
        const input = route.request().postDataJSON(); writes.push(input);
        record.items = record.items.map(item => input.items.find((next: { criterionId: string }) => next.criterionId === item.criterionId) || item); record.revision += 1;
      }
      data = record;
    }
    await route.fulfill({ json: { success: true, data } });
  });
  return { writes, record };
}
async function filter(page: Page, name: string) { await page.getByRole('combobox', { name: /^Filter criteria/ }).click(); await page.getByRole('option', { name, exact: true }).click(); }
for (const mobile of [false, true]) test(`criterion filters select matching native findings and preserve the correct save target (${mobile ? 'mobile' : 'desktop'})`, async ({ page }, info) => {
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  else await page.setViewportSize({ width: 1440, height: 1000 });
  const state = await setup(page); await page.goto('/competency/assessments/assessment');
  await filter(page, 'Needs attention');
  await expect(page.getByRole('heading', { name: 'Risk judgement', exact: true })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Assessment criteria', exact: true });
  if (mobile) { await page.getByRole('combobox', { name: /^Assessment criterion/ }).click(); await expect(page.getByRole('option', { name: 'Risk judgement', exact: true })).toBeVisible(); await expect(page.getByRole('option', { name: 'Delivery outcomes', exact: true })).toHaveCount(0); await page.keyboard.press('Escape'); }
  else { await expect(nav.getByRole('button', { name: /Risk judgement/ })).toBeVisible(); await expect(nav.getByRole('button', { name: /Delivery outcomes/ })).toHaveCount(0); }
  await page.getByRole('combobox', { name: /^Finding status/ }).click(); await page.getByRole('option', { name: 'Assessed', exact: true }).click();
  // Finishing a status must not switch away while the assessor is still entering its evidence/rationale.
  await expect(page.getByRole('heading', { name: 'Risk judgement', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: /^Observed level/ }).click(); await page.getByRole('option', { name: 'Independent', exact: true }).click();
  await page.getByRole('textbox', { name: 'Assessor rationale (required)', exact: true }).fill('Retain this synthetic risk evidence on its own criterion.');
  await page.getByRole('button', { name: 'Save draft', exact: true }).first().click();
  await expect.poll(() => state.writes.length).toBe(1);
  expect(state.writes[0].items).toEqual([{ criterionId: 'risk', status: 'assessed', observedLevelId: 'independent', rationale: 'Retain this synthetic risk evidence on its own criterion.', evidenceIds: [], reviewedSuggestionIds: [] }]);
  expect(state.record.items[0].rationale).toBe('Previously saved delivery evidence.');
  await filter(page, 'Assessed');
  await expect(page.getByRole('heading', { name: 'Risk judgement', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next criterion', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Delivery outcomes', exact: true })).toBeVisible();
  await filter(page, 'Needs attention');
  await expect(page.getByText('No criteria match this filter.', { exact: true })).toBeVisible();
  await expect(page.getByText('Choose another filter to continue reviewing criteria.', { exact: true })).toBeVisible();
  if (mobile) await expect(page.getByRole('combobox', { name: /^Assessment criterion/ })).toBeDisabled();
  await expect(page.getByRole('textbox', { name: 'Assessor rationale (required)', exact: true })).toHaveCount(0);
  // A later evidence refresh must not restore a hidden/unmatched default criterion.
  await page.getByRole('tab', { name: 'Evidence', exact: true }).click();
  await page.getByRole('textbox', { name: 'Evidence title', exact: true }).fill('Synthetic supporting note');
  await page.getByRole('textbox', { name: 'Manual evidence or context', exact: true }).fill('Additional fictional delivery context.');
  await page.getByRole('checkbox', { name: 'Delivery outcomes (Synthetic internal framework)', exact: true }).check();
  await page.getByRole('button', { name: 'Save evidence', exact: true }).click();
  await expect(page.getByText('Evidence saved. Link it to the relevant finding in Assessment.', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Assessment', exact: true }).click();
  await expect(page.getByText('Choose another filter to continue reviewing criteria.', { exact: true })).toBeVisible();
  await filter(page, 'All');
  await expect(page.getByRole('heading', { name: 'Delivery outcomes', exact: true })).toBeVisible();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(page.locator('.MuiPopover-root')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath(`criterion-filter-${mobile ? 'mobile' : 'desktop'}.png`), fullPage: true });
});

test('published findings can be filtered without exposing editable native levels or save controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const state = await setup(page, true);
  await page.goto('/competency/assessments/assessment'); await filter(page, 'Needs attention');
  await expect(page.getByRole('heading', { name: 'Risk judgement', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: /^Finding status/ })).toBeDisabled();
  await expect(page.getByRole('combobox', { name: /^Observed level/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toHaveCount(0);
  expect(state.writes).toHaveLength(0);
});
