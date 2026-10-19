import { expect, Page, Route, test } from '@playwright/test';

// UI state/race contracts with controlled API transport; no production network,
// scoring, authentication or provider proof is claimed by these fixtures.
const pageErrors = new WeakMap<Page, string[]>();
test.afterEach(async ({ page }) => { expect(pageErrors.get(page) || []).toEqual([]); });
function cohort(cycle: string) {
  return { cycleId: cycle, scope: 'organization', total: 1, completed: 1, statusCounts: { published: 1 },
    rows: [{ assessmentId: `assessment-${cycle}`, participant: { name: `Participant ${cycle}` }, role: { name: 'Synthetic role', version: 1 }, status: 'published', score: 80 }],
    rankings: [], gaps: [], filters: { departmentIds: [], teamIds: ['team'], teams: [{ id: 'team', name: 'Permitted team' }], roles: [] }, generatedAt: '2026-10-19T12:00:00Z' };
}
async function setup(page: Page) {
  const errors: string[] = []; pageErrors.set(page, errors); page.on('pageerror', error => errors.push(error.name));
  const user = { id: 'reviewer', sub: 'reviewer', name: 'Synthetic Reviewer', email: 'reviewer@example.test' };
  const organization = { id: 'org', name: 'Synthetic organization', role: 'hr_manager' };
  const calls: { path: string; method: string; key?: string; body?: unknown }[] = [];
  await page.addInitScript(() => localStorage.setItem('accessToken', 'synthetic-cohort-ui-contract'));
  await page.route('**/__mock-api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace('/__mock-api', '');
    calls.push({ path, method: request.method(), key: request.headers()['idempotency-key'], ...(request.postData() ? { body: request.postDataJSON() } : {}) });
    if (path === '/auth/me') return route.fulfill({ json: { success: true, user: { ...user, organizations: [organization] }, currentOrganization: organization, currentOrganizationId: 'org' } });
    if (path === '/user/context') return route.fulfill({ json: { success: true, data: { user, organization, role: { name: 'hr_admin', isManager: true, isHRAdmin: true }, teams: [], features: {}, stats: {} } } });
    if (path === '/competency/bootstrap') return route.fulfill({ json: { data: { enabled: true, capabilities: { cohortReport: true, reportExport: true }, people: [], roles: [], frameworks: [], strategies: [], cycles: ['A', 'B'].map(id => ({ id, name: `Cycle ${id}`, revision: 1, status: 'published', roleVersionIds: [] })) } } });
    const report = path.match(/^\/competency\/cycles\/([AB])\/report$/);
    if (report) return route.fulfill({ json: { data: cohort(report[1]) } });
    if (path.endsWith('/exports')) return route.fulfill({ json: { data: { id: 'export', status: 'pending' } } });
    return route.fulfill({ json: { data: [] } });
  });
  await page.goto('/competency/reports');
  await expect(page.getByRole('combobox', { name: 'Select assessment cycle' })).toBeVisible();
  return calls;
}
async function chooseCycle(page: Page, cycle: string) {
  await page.getByRole('combobox', { name: 'Select assessment cycle' }).click();
  await page.getByRole('option', { name: cycle ? `Cycle ${cycle}` : 'Choose a cycle', exact: true }).click();
}
async function ready(page: Page, cycle: string) {
  await expect(page.getByRole('link', { name: `Participant ${cycle}`, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download cohort PDF', exact: true })).toBeEnabled();
}
async function release(page: Page, route: Route, data: unknown, contentType?: string) {
  const received = page.waitForResponse(route.request().url());
  await route.fulfill(contentType ? { contentType, body: data as string } : { json: { data } });
  await (await received).finished();
  // Flush the delivered transport response and its React update without a sleep.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

test('clearing the selected cycle removes the old report and pending PDF actions', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page); await chooseCycle(page, 'A'); await ready(page, 'A');
  await page.getByRole('button', { name: 'Download cohort PDF', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check PDF status' })).toBeVisible();
  await chooseCycle(page, '');
  await expect(page.getByRole('heading', { name: 'Cohort overview', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Download cohort PDF|Check PDF status/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Participant A', exact: true })).toHaveCount(0);
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath('cleared-cycle-mobile.png'), fullPage: true });
});

test('a delayed previous cycle cannot replace the current report', async ({ page }) => {
  await setup(page); let held: Route | undefined;
  await page.route('**/__mock-api/competency/cycles/A/report?*', route => { held = route; });
  await chooseCycle(page, 'A'); await expect.poll(() => Boolean(held)).toBe(true);
  await chooseCycle(page, 'B'); await ready(page, 'B');
  await release(page, held!, cohort('A'));
  await ready(page, 'B');
  await expect(page.getByRole('link', { name: 'Participant A', exact: true })).toHaveCount(0);
});

test('cycle changes and clear filters discard late filtered results and reset request scope', async ({ page }) => {
  const calls = await setup(page); await chooseCycle(page, 'A'); await ready(page, 'A'); let held: Route | undefined;
  await page.route('**/__mock-api/competency/cycles/A/report?teamId=team', route => { held = route; });
  await page.getByRole('combobox', { name: 'Team', exact: true }).click();
  await page.getByRole('option', { name: 'Permitted team', exact: true }).click();
  await expect.poll(() => Boolean(held)).toBe(true);
  await chooseCycle(page, 'B'); await ready(page, 'B'); await release(page, held!, cohort('A'));
  await ready(page, 'B');
  const requests: string[] = [];
  page.on('request', req => { if (req.url().includes('/cycles/B/report')) requests.push(new URL(req.url()).search); });
  await page.getByRole('combobox', { name: 'Team', exact: true }).click();
  await page.getByRole('option', { name: 'Permitted team', exact: true }).click(); await ready(page, 'B');
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click(); await ready(page, 'B');
  expect(requests).toContain('?teamId=team'); expect(requests.at(-1)).toBe('');
  await page.getByRole('button', { name: 'Download cohort PDF', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check PDF status' })).toBeVisible();
  expect(calls.filter(c => c.method === 'POST' && c.path.endsWith('/exports')).at(-1)?.body).toEqual({ filters: {} });
});

test('late export creation and status responses cannot restore an old job or start its download', async ({ page }) => {
  const calls = await setup(page); await chooseCycle(page, 'A'); await ready(page, 'A'); let created: Route | undefined, checked: Route | undefined;
  const downloads: string[] = []; page.on('download', download => downloads.push(download.suggestedFilename()));
  await page.route('**/__mock-api/competency/cycles/A/exports', route => { created = route; });
  await page.getByRole('button', { name: 'Download cohort PDF', exact: true }).click(); await expect.poll(() => Boolean(created)).toBe(true);
  const firstKey = created!.request().headers()['idempotency-key'];
  await chooseCycle(page, 'B'); await ready(page, 'B'); await release(page, created!, { id: 'old-ready', status: 'ready' });
  await expect(page.getByRole('button', { name: 'Check PDF status' })).toHaveCount(0); expect(downloads).toEqual([]);
  expect(calls.filter(c => c.path.includes('/exports/old-ready'))).toEqual([]);
  await page.getByRole('button', { name: 'Download cohort PDF', exact: true }).click(); await expect(page.getByRole('button', { name: 'Check PDF status' })).toBeVisible();
  expect(calls.filter(c => c.method === 'POST' && c.path.endsWith('/exports')).at(-1)?.key).not.toBe(firstKey);
  await page.route('**/__mock-api/competency/exports/export', route => { checked = route; });
  await page.getByRole('button', { name: 'Check PDF status' }).click(); await expect.poll(() => Boolean(checked)).toBe(true);
  await chooseCycle(page, ''); await release(page, checked!, { id: 'export', status: 'ready' });
  await expect(page.getByRole('heading', { name: 'Cohort overview', exact: true })).toHaveCount(0); expect(downloads).toEqual([]);
  expect(calls.filter(c => c.path.endsWith('/exports/export/download'))).toEqual([]);
});

test('a PDF blob finishing after the cycle is cleared does not trigger a stale download', async ({ page }) => {
  await setup(page); await chooseCycle(page, 'A'); await ready(page, 'A'); let blob: Route | undefined;
  const downloads: string[] = []; page.on('download', download => downloads.push(download.suggestedFilename()));
  await page.route('**/__mock-api/competency/cycles/A/exports', route => route.fulfill({ json: { data: { id: 'blob-job', status: 'ready' } } }));
  await page.route('**/__mock-api/competency/exports/blob-job/download', route => { blob = route; });
  await page.getByRole('button', { name: 'Download cohort PDF', exact: true }).click(); await expect.poll(() => Boolean(blob)).toBe(true);
  await chooseCycle(page, ''); await release(page, blob!, '%PDF-1.4\nSynthetic controlled UI blob\n%%EOF', 'application/pdf');
  await expect(page.getByRole('heading', { name: 'Cohort overview', exact: true })).toHaveCount(0); expect(downloads).toEqual([]);
  await chooseCycle(page, 'B'); await ready(page, 'B');
  await expect(page.getByRole('button', { name: 'Check PDF status' })).toHaveCount(0);
});

test('clearing a failed cycle clears its error and a late failure cannot replace the next view', async ({ page }) => {
  await setup(page);
  await page.route('**/__mock-api/competency/cycles/A/report?*', route => route.fulfill({ status: 503, json: { error: { message: 'Synthetic cycle A unavailable.' } } }));
  await chooseCycle(page, 'A'); await expect(page.getByText('Synthetic cycle A unavailable.', { exact: true })).toBeVisible();
  await chooseCycle(page, ''); await expect(page.getByText('Synthetic cycle A unavailable.', { exact: true })).toHaveCount(0);
  let held: Route | undefined;
  await page.route('**/__mock-api/competency/cycles/A/report?*', route => { held = route; });
  await chooseCycle(page, 'A'); await expect.poll(() => Boolean(held)).toBe(true);
  await chooseCycle(page, 'B'); await ready(page, 'B');
  const received = page.waitForResponse(held!.request().url());
  await held!.fulfill({ status: 503, json: { error: { message: 'Late old cycle failure.' } } }); await (await received).finished();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await ready(page, 'B'); await expect(page.getByText('Late old cycle failure.', { exact: true })).toHaveCount(0);
});

test('the current selected report still downloads its ready PDF', async ({ page }, info) => {
  await setup(page); await chooseCycle(page, 'A'); await ready(page, 'A');
  await page.route('**/__mock-api/competency/cycles/A/exports', route => route.fulfill({ json: { data: { id: 'current-job', status: 'ready' } } }));
  await page.route('**/__mock-api/competency/exports/current-job/download', route => route.fulfill({ contentType: 'application/pdf', body: '%PDF-1.4\nSynthetic controlled UI blob\n%%EOF' }));
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download cohort PDF', exact: true }).click()]);
  expect(download.suggestedFilename()).toBe('competency-cohort-report.pdf');
  await ready(page, 'A');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath('current-cohort-desktop.png'), fullPage: true });
});
