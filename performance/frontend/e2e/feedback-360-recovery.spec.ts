import { expect, test, type Page } from '@playwright/test';

// Explicit UI transport substitutes for dependency recovery and grant rendering.
async function install(page: Page, mode: 'retry' | 'lost-response' | 'denied' | 'recovery-conflict' | 'revoked-after-unknown') {
  const user = { id: 'subject', sub: 'subject', name: 'Synthetic Subject', email: 'subject@example.test' };
  const organization = { id: 'cohort-ui-org', name: 'Synthetic cohort UI', role: 'staff' };
  const people = Array.from({ length: 5 }, (_, index) => ({ id: `reviewer-${index}`, name: `Synthetic Reviewer ${index}`, email: `reviewer${index}@example.test` }));
  let posts = 0, requestedReads = 0, statusFailed = false, searchFailed = false;
  const keys: string[] = [];
  const items: Array<Record<string, unknown>> = [];
  await page.addInitScript(() => localStorage.setItem('accessToken', 'synthetic-cohort-recovery'));
  await page.route('**/__mock-api/**', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname.replace('/__mock-api', '');
    if (path === '/auth/me') return route.fulfill({ json: { success: true, user: { ...user, organizations: [organization] }, currentOrganization: organization, currentOrganizationId: organization.id } });
    let data: unknown = [];
    if (path === '/user/context') data = { user, organization, role: { name: 'employee', isManager: false, isHRAdmin: false }, features: { canRequestFeedback: mode !== 'denied' }, teams: [], stats: {} };
    if (path === '/user/current-team') data = { currentTeam: null, availableTeams: [] };
    if (path === '/competency/bootstrap') data = { enabled: false, capabilities: {}, settings: {}, people: [] };
    if (path === '/user/my-team-members') data = { directReports: [] };
    if (path === '/user/search') {
      if (searchFailed) return route.fulfill({ status: 503, json: { error: 'Synthetic directory outage' } });
      data = people.filter(person => person.email.includes(url.searchParams.get('q') || ''));
    }
    if (path === '/feedback/requests' && req.method() === 'GET' && url.searchParams.get('view') === 'requested') {
      requestedReads++;
      if (statusFailed) return route.fulfill({ status: 503, json: { error: 'Synthetic request status outage' } });
      data = items;
    }
    if (path === '/feedback/requests' && req.method() === 'POST') {
      posts++;
      keys.push(req.headers()['idempotency-key']);
      const body = req.postDataJSON();
      if (mode === 'revoked-after-unknown' && posts === 2) return route.fulfill({ status: 403, json: { error: 'Synthetic request grant revoked' } });
      if (!items.length && (mode === 'lost-response' || posts > 1)) items.push({ kind: 'cohort', cohortId: 'synthetic-cohort', subjectId: body.subjectId, subjectInfo: user,
        contextType: body.contextType, contextLabel: body.contextLabel, questions: body.questions, dueDate: body.dueDate, visibility: body.visibility,
        anonymity: body.anonymity, reviewerCount: 5, minimumCohortSize: 5, responseCount: null, reportable: false, state: 'collecting' });
      if (posts === 1) return route.fulfill({ status: mode === 'recovery-conflict' ? 409 : 503, json: { error: 'Synthetic ambiguous send failure', ...(mode === 'recovery-conflict' ? { code: 'REQUEST_RECOVERY_REQUIRED' } : {}) } });
      return route.fulfill({ status: 201, json: { success: true, data: items } });
    }
    return route.fulfill({ json: { success: true, data } });
  });
  return { keys, get posts() { return posts; }, get batches() { return items.length; }, get requestedReads() { return requestedReads; }, failStatus: () => { statusFailed = true; }, recoverStatus: () => { statusFailed = false; }, failSearch: () => { searchFailed = true; }, recoverSearch: () => { searchFailed = false; } };
}
async function draft(page: Page) {
  await page.goto('/feedback');
  await page.getByRole('button', { name: 'Request feedback', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Request feedback', exact: true });
  for (let index = 0; index < 5; index++) {
    await dialog.getByRole('combobox', { name: 'Reviewers', exact: true }).fill(`reviewer${index}@example.test`);
    await page.getByRole('option', { name: new RegExp(`Synthetic Reviewer ${index}`) }).click();
  }
  await dialog.getByRole('combobox', { name: /^Reviewer identity/ }).click();
  await page.getByRole('option', { name: /Anonymous/ }).click();
  await dialog.getByRole('textbox', { name: 'Due date', exact: true }).fill(new Date(Date.now() + 86400000 * 7).toISOString().slice(0, 10));
  await dialog.getByRole('textbox', { name: 'Request label', exact: true }).fill('Preserved 360 request draft');
  await dialog.getByRole('button', { name: 'Review request', exact: true }).click();
  return page.getByRole('dialog', { name: 'Review feedback request', exact: true });
}

test('failed 360 send reconciles status before retry and retains exact reviewers on mobile', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fixture = await install(page, 'retry');
  const dialog = await draft(page);
  await dialog.getByRole('button', { name: 'Send request', exact: true }).click();
  await expect(dialog.getByText(/The request is not yet confirmed/)).toBeVisible();
  expect(fixture.posts).toBe(1); expect(fixture.requestedReads).toBeGreaterThanOrEqual(2);
  await expect(dialog.getByText('Reviewers (5)', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Preserved 360 request draft', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('360-send-retry-mobile.png'), fullPage: true });
  await expect(dialog.getByRole('button', { name: 'Edit request', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Retry request', exact: true }).click();
  await expect(dialog).toBeHidden(); expect(fixture.posts).toBe(2);
  expect(fixture.keys[0]).toMatch(/^[a-f0-9-]{36}$/); expect(fixture.keys[1]).toBe(fixture.keys[0]); expect(fixture.batches).toBe(1);
  await expect(page.getByText(/5 invited · Collecting responses/)).toBeVisible();
  await expect(page.getByText(/Synthetic Reviewer/, { exact: false })).toHaveCount(0);
  fixture.failStatus();
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await expect(page.getByText('Could not load feedback request status. Please retry.', { exact: true })).toBeVisible();
  await expect(page.getByText('No feedback requests yet.', { exact: true })).toHaveCount(0);
  fixture.recoverStatus();
  await page.getByRole('button', { name: 'Retry status', exact: true }).click();
  await expect(page.getByText('Could not load feedback request status. Please retry.', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/5 invited · Collecting responses/)).toBeVisible();
});

test('a lost successful POST response replays the same operation without creating duplicate invitations', async ({ page }) => {
  const fixture = await install(page, 'lost-response');
  const dialog = await draft(page);
  await dialog.getByRole('button', { name: 'Send request', exact: true }).click();
  await expect(dialog.getByText(/A matching request is visible/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Retry request', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(fixture.posts).toBe(2); expect(fixture.requestedReads).toBeGreaterThanOrEqual(2); expect(fixture.batches).toBe(1);
  expect(fixture.keys[1]).toBe(fixture.keys[0]);
  await expect(page.getByText(/5 invited · Collecting responses/)).toBeVisible();
});

test('effective denied request grant hides creation while ordinary feedback remains available', async ({ page }) => {
  await install(page, 'denied'); await page.goto('/feedback');
  await expect(page.getByRole('button', { name: 'Give feedback', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Request feedback', exact: true })).toHaveCount(0);
});

test('partial-operation conflict retains the reviewed request and original retry key', async ({ page }) => {
  const fixture = await install(page, 'recovery-conflict');
  const dialog = await draft(page);
  await dialog.getByRole('button', { name: 'Send request', exact: true }).click();
  await expect(dialog.getByText('Synthetic ambiguous send failure', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Edit request', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Retry request', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(fixture.keys[1]).toBe(fixture.keys[0]); expect(fixture.batches).toBe(1);
});

test('reviewer directory outage has an explicit retry and retains previously chosen people', async ({ page }) => {
  const fixture = await install(page, 'retry');
  await page.goto('/feedback');
  await page.getByRole('button', { name: 'Request feedback', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Request feedback', exact: true });
  const reviewers = dialog.getByRole('combobox', { name: 'Reviewers', exact: true });
  await reviewers.fill('reviewer0@example.test');
  await page.getByRole('option', { name: /Synthetic Reviewer 0/ }).click();
  fixture.failSearch(); await reviewers.fill('reviewer1@example.test');
  await expect(dialog.getByText('Could not search reviewers. Your selections are preserved.', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Synthetic Reviewer 0 · reviewer0@example.test', { exact: true })).toBeVisible();
  fixture.recoverSearch(); await dialog.getByRole('button', { name: 'Retry search', exact: true }).click();
  await expect(dialog.getByText('Could not search reviewers. Your selections are preserved.', { exact: true })).toHaveCount(0);
  await reviewers.click();
  await page.getByRole('option', { name: /Synthetic Reviewer 1/ }).click();
  await expect(dialog.getByText('Synthetic Reviewer 0 · reviewer0@example.test', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Synthetic Reviewer 1 · reviewer1@example.test', { exact: true })).toBeVisible();
  expect(fixture.posts).toBe(0);
});

test('a revoked grant after an unknown send cannot reset the operation into a new request', async ({ page }) => {
  const fixture = await install(page, 'revoked-after-unknown');
  const dialog = await draft(page);
  await dialog.getByRole('button', { name: 'Send request', exact: true }).click();
  await expect(dialog.getByText(/The request is not yet confirmed/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Retry request', exact: true }).click();
  await expect(dialog.getByText('Synthetic request grant revoked', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Edit request', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Retry request', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(fixture.keys).toHaveLength(3); expect(new Set(fixture.keys).size).toBe(1); expect(fixture.batches).toBe(1);
});
