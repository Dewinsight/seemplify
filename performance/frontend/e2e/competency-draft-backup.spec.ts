import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Focused UI-contract regression. Persistence/authorization has separate real
// Mongo suites; these responses deliberately force a stale draft conflict.
test('stale role backup preserves actual unsaved fields and hidden criterion values', async ({ page }) => {
  const org = { id: 'backup-qa', name: 'Synthetic backup QA', role: 'hr_manager' };
  const user = { id: 'reviewer', sub: 'reviewer', name: 'Synthetic reviewer', organizations: [org] };
  const source = { id: 'framework-v1', versionId: 'framework-v1', name: 'Leadership', sourceType: 'internal', version: 1, criteria: [{ id: 'delivery', name: 'Delivery', levelIds: ['advanced'] }], levels: [{ id: 'advanced', label: 'Advanced', description: 'Independent delivery', order: 1 }] };
  const version = { id: 'draft-v2', versionId: 'draft-v2', name: 'Delivery lead', description: 'Saved summary', version: 2, revision: 1, status: 'draft', responsibilities: [{ id: 'resp', text: 'Saved responsibility' }], requirements: [{ id: 'req', text: 'Hidden requirement sentinel', required: true }], criteria: [{ id: 'role-criterion', sourceType: 'internal', frameworkVersionId: 'framework-v1', criterionId: 'delivery', expectedLevelId: 'advanced', weight: 1, required: true, evidenceRequired: true, rationaleRequired: true, responsibilityIds: ['resp'], requirementIds: ['req'] }] };
  let latest = false;
  await page.addInitScript(() => {
    localStorage.setItem('accessToken', 'synthetic-backup-contract');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { (window as unknown as { __qaClipboard: string }).__qaClipboard = text; } } });
  });
  await page.route('**/__mock-api/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/__mock-api', '');
    if (path === '/auth/me') return route.fulfill({ json: { success: true, user, currentOrganization: org, currentOrganizationId: org.id } });
    if (path === '/user/context') return route.fulfill({ json: { success: true, data: { user, organization: org, role: { name: 'hr_admin', isHRAdmin: true, isManager: true }, teams: [], features: {}, stats: {} } } });
    if (path === '/competency/bootstrap') return route.fulfill({ json: { data: { enabled: true, capabilities: { roleManage: true, frameworkManage: true, cycleManage: true }, roles: [], frameworks: [source], strategies: [], cycles: [], people: [], settings: {} } } });
    if (path === '/competency/roles/draft-role') return route.fulfill({ json: { data: { id: 'draft-role', name: 'Delivery lead', revision: latest ? 2 : 1, versions: [{ ...version, ...(latest ? { revision: 2, description: 'Another editor saved this summary' } : {}) }] } } });
    if (path === '/competency/roles/draft-role/versions/draft-v2' && route.request().method() === 'PATCH') { latest = true; return route.fulfill({ status: 409, json: { error: { code: 'REVISION_CONFLICT', message: 'This draft changed. Reload before saving.' } } }); }
    return route.fulfill({ json: { data: [] } });
  });
  await page.goto('/competency/roles/draft-role');
  await page.getByRole('textbox', { name: 'Summary', exact: true }).fill('My unsaved summary sentinel');
  await page.getByRole('textbox', { name: 'Responsibility 1', exact: true }).fill('My unsaved responsibility sentinel');
  await page.getByRole('tab', { name: /Expectations/ }).click();
  await page.getByRole('spinbutton', { name: 'Criterion weight for expectation 1' }).fill('3');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByText('This draft changed. Reload before saving.')).toBeVisible();
  await page.getByRole('tab', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: 'Copy my changes', exact: true }).click();
  await expect(page.getByText('Your current edits were copied.')).toBeVisible();
  const copied = JSON.parse(await page.evaluate(() => (window as unknown as { __qaClipboard: string }).__qaClipboard));
  expect(copied.description).toBe('My unsaved summary sentinel');
  expect(copied.responsibilities[0]).toEqual({ id: 'resp', text: 'My unsaved responsibility sentinel' });
  expect(copied.requirements[0].text).toBe('Hidden requirement sentinel');
  expect(copied.criteria[0]).toMatchObject({ id: 'role-criterion', frameworkVersionId: 'framework-v1', expectedLevelId: 'advanced', weight: 3, responsibilityIds: ['resp'], requirementIds: ['req'] });
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download my changes', exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('my-assessment-changes.json');
  expect(JSON.parse(await readFile((await download.path())!, 'utf8'))).toEqual(copied);
  await page.getByRole('button', { name: 'Compare latest version', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Another editor saved this summary');
  await expect(page.getByRole('dialog')).toContainText('My unsaved summary sentinel');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Responsibility 1', exact: true })).toHaveValue('My unsaved responsibility sentinel');
});
