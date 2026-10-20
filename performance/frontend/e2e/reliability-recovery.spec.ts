import { expect, test, type Page } from '@playwright/test';

// Synthetic UI transport contracts. These tests do not certify live Identity,
// backend persistence or the cause of a production outage.
type Endpoint = '/user/search' | '/calibration' | '/appraisals/cycles';
interface ResponseState { fail: boolean; data: unknown; hold?: Promise<void>; reads: number }

async function install(page: Page, overrides: Partial<Record<Endpoint, ResponseState>> = {}, hr = true) {
  const user = { id: 'reliability-reviewer', sub: 'reliability-reviewer', name: 'Synthetic Reviewer', email: 'reviewer@example.test' };
  const organization = { id: 'reliability-org', name: 'Synthetic reliability audit', role: hr ? 'owner' : 'employee' };
  const writes: string[] = [];
  await page.addInitScript(() => localStorage.setItem('accessToken', 'synthetic-reliability-recovery'));
  await page.route('**/__mock-api/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/__mock-api', '');
    if (route.request().method() !== 'GET' && (path === '/recognition' || path.startsWith('/calibration'))) writes.push(path);
    if (path === '/auth/me') return route.fulfill({ json: { success: true, user: { ...user, organizations: [organization] }, currentOrganization: organization, currentOrganizationId: organization.id } });
    const controlled = overrides[path as Endpoint];
    if (controlled) {
      controlled.reads++;
      if (controlled.hold) await controlled.hold;
      if (controlled.fail) return route.fulfill({ status: 503, json: { error: 'Synthetic dependency unavailable.' } });
      return route.fulfill({ json: { success: true, data: controlled.data } });
    }
    let data: unknown = [];
    if (path === '/user/context') data = { user, organization, role: { name: hr ? 'owner' : 'employee', isManager: hr, isHRAdmin: hr }, teams: [], stats: {}, features: { recognition: true, canonicalAppraisals: true } };
    if (path === '/user/current-team') data = { currentTeam: null, availableTeams: [] };
    if (path === '/competency/bootstrap') data = { enabled: false, capabilities: {}, people: [], settings: {} };
    return route.fulfill({ json: { success: true, data } });
  });
  return { writes };
}

function heldResponse(data: unknown) {
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const state: ResponseState = { fail: true, data, reads: 0 };
  return { state, hold, release };
}

test('recognition search failure preserves the draft and supports an explicit pending retry', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const search = heldResponse([{ id: 'synthetic-colleague', name: 'Synthetic Colleague' }]);
  const { writes } = await install(page, { '/user/search': search.state }, false);
  await page.goto('/recognition');
  await page.getByRole('button', { name: 'Recognize a colleague', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Recognize a colleague', exact: true });
  await dialog.getByLabel('Recognition message').fill('Retain this draft while colleague search recovers.');
  await dialog.getByLabel('Search organization').fill('Synthetic');
  await expect(dialog.getByText(/Could not search colleagues/)).toBeVisible();
  await expect(dialog.getByText('No colleagues found.', { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Send recognition', exact: true })).toBeDisabled();
  search.state.hold = search.hold;
  search.state.fail = false;
  await dialog.getByRole('button', { name: 'Retry search', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Retrying…', exact: true })).toBeDisabled();
  await expect(dialog.getByLabel('Recognition message')).toHaveValue('Retain this draft while colleague search recovers.');
  await page.screenshot({ path: info.outputPath('recognition-search-retry-mobile.png'), fullPage: true });
  search.release();
  await dialog.getByRole('button', { name: 'Synthetic Colleague', exact: true }).click();
  await expect(dialog.getByText(/Could not search colleagues/)).toHaveCount(0);
  await expect(dialog.getByLabel('Recognition message')).toHaveValue('Retain this draft while colleague search recovers.');
  await expect(dialog.getByRole('combobox', { name: 'Audience', exact: true })).toContainText('Recipient only');
  expect(search.state.reads).toBeGreaterThanOrEqual(2);
  expect(writes).toEqual([]);
});

test('a successful empty colleague search is distinct from search failure', async ({ page }) => {
  await install(page, { '/user/search': { fail: false, data: [], reads: 0 } }, false);
  await page.goto('/recognition');
  await page.getByRole('button', { name: 'Recognize a colleague', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Recognize a colleague', exact: true });
  await dialog.getByLabel('Search organization').fill('Nobody');
  await expect(dialog.getByText('No colleagues found.', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Retry search', exact: true })).toHaveCount(0);
});

test('calibration load failure does not invent empty totals and retries to the actual empty result', async ({ page }, info) => {
  const sessions = heldResponse([]);
  const { writes } = await install(page, { '/calibration': sessions.state });
  await page.goto('/admin/calibration');
  await expect(page.getByText(/Could not load calibration sessions/)).toBeVisible();
  await expect(page.getByText(/No calibration sessions yet/)).toHaveCount(0);
  await expect(page.getByText('Total Sessions', { exact: true })).toHaveCount(0);
  sessions.state.fail = false;
  sessions.state.hold = sessions.hold;
  await page.getByRole('button', { name: 'Retry sessions', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retrying…', exact: true })).toBeDisabled();
  await page.screenshot({ path: info.outputPath('calibration-session-retry.png'), fullPage: true });
  sessions.release();
  await expect(page.getByText(/No calibration sessions yet/)).toBeVisible();
  await expect(page.getByText('Total Sessions', { exact: true })).toBeVisible();
  await expect(page.getByText(/Could not load calibration sessions/)).toHaveCount(0);
  expect(writes).toEqual([]);
});

test('calibration cycle retry retains session details and blocks creation until the picker recovers', async ({ page }) => {
  const cycles = heldResponse([{ _id: 'synthetic-cycle', title: 'Synthetic active cycle', status: 'active' }]);
  const { writes } = await install(page, { '/appraisals/cycles': cycles.state });
  await page.goto('/admin/calibration');
  await page.getByRole('button', { name: 'New Session', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create Calibration Session', exact: true });
  await dialog.getByLabel('Session Title (optional)').fill('Retained synthetic session');
  await expect(dialog.getByText(/Could not load review cycles/)).toBeVisible();
  await expect(dialog.getByText('No active review cycles are available for calibration.', { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeDisabled();
  cycles.state.fail = false;
  cycles.state.hold = cycles.hold;
  await dialog.getByRole('button', { name: 'Retry cycles', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Retrying…', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeDisabled();
  cycles.release();
  const cyclePicker = dialog.getByRole('combobox', { name: 'Review Cycle', exact: true });
  await expect(cyclePicker).toBeEnabled();
  await cyclePicker.selectOption('synthetic-cycle');
  await expect(dialog.getByLabel('Session Title (optional)')).toHaveValue('Retained synthetic session');
  await expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeEnabled();
  expect(writes).toEqual([]);
});

test('a successfully empty cycle list explains why calibration creation is unavailable', async ({ page }) => {
  await install(page);
  await page.goto('/admin/calibration');
  await page.getByRole('button', { name: 'New Session', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create Calibration Session', exact: true });
  await expect(dialog.getByText('No active review cycles are available for calibration.', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Retry cycles', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeDisabled();
});

test('calibration failure recovery does not expose HR controls to an employee', async ({ page }) => {
  await install(page, { '/calibration': { fail: true, data: [], reads: 0 } }, false);
  await page.goto('/admin/calibration');
  await expect(page.getByText('Access denied. Only HR Administrators can access calibration.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New Session', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry sessions', exact: true })).toHaveCount(0);
});
