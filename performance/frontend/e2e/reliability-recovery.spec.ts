import { expect, test, type Page } from '@playwright/test';

// Synthetic UI transport contracts. These tests do not certify live Identity,
// backend persistence or the cause of a production outage.
type Endpoint = '/user/search' | '/calibration' | '/appraisals/cycles' | `/reviews/${string}` | '/okrs' | '/goal-periods' | '/okrs/hierarchy';
interface ResponseState { fail: boolean; data: unknown; hold?: Promise<void>; reads: number }

async function install(page: Page, overrides: Partial<Record<Endpoint, ResponseState>> = {}, hr = true) {
  const user = { id: 'reliability-reviewer', sub: 'reliability-reviewer', name: 'Synthetic Reviewer', email: 'reviewer@example.test' };
  const organization = { id: 'reliability-org', name: 'Synthetic reliability audit', role: hr ? 'owner' : 'employee' };
  const writes: string[] = [];
  await page.addInitScript(() => localStorage.setItem('accessToken', 'synthetic-reliability-recovery'));
  await page.route('**/__mock-api/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/__mock-api', '');
    if (route.request().method() !== 'GET' && (path === '/recognition' || path.startsWith('/calibration') || path.startsWith('/reviews/'))) writes.push(path);
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

test('feedback recipient queries exclude unrelated reports and editing or clearing removes the old selection', async ({ page }) => {
  await install(page);
  const target = { id: 'target-colleague', name: 'Target Colleague', email: 'target@example.test' };
  const unrelated = { id: 'unrelated-report', name: 'Another Report', email: 'another@example.test' };
  const aliasMatch = { id: 'directory-alias', name: 'Directory Colleague', email: 'directory@example.test' };
  await page.route('**/__mock-api/user/my-team-members', route => route.fulfill({ json: {
    success: true, data: { isManager: true, directReports: [unrelated, target] },
  } }));
  await page.route('**/__mock-api/user/search?*', route => {
    const query = new URL(route.request().url()).searchParams.get('q')?.toLowerCase();
    const data = query === target.email ? [target] : query === 'directory-alias' ? [aliasMatch] : [];
    return route.fulfill({ json: { success: true, data } });
  });
  await page.goto('/feedback');
  await page.getByRole('button', { name: 'Give feedback', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Give feedback' });
  const recipient = dialog.getByRole('combobox', { name: /Recipient/ });
  const send = dialog.getByRole('button', { name: 'Send feedback', exact: true });
  await dialog.getByRole('textbox', { name: /^Feedback/ }).fill('A synthetic feedback draft retained across recipient searches.');
  await recipient.fill('TARGET@EXAMPLE.TEST');
  await expect(page.getByRole('option')).toHaveCount(1);
  await expect(page.getByRole('option')).toContainText('Target Colleague');
  await recipient.press('ArrowDown');
  await recipient.press('Enter');
  await expect(send).toBeEnabled();
  await recipient.fill('nobody@example.test');
  await expect(send).toBeDisabled();
  await expect(page.getByRole('option')).toHaveCount(0);
  await expect(page.getByText('No people found', { exact: true })).toBeVisible();
  // Trust the current server query even when it matched an undisplayed alias.
  await recipient.fill('directory-alias');
  await expect(page.getByRole('option')).toHaveCount(1);
  await page.getByRole('option', { name: /Directory Colleague/ }).click();
  await expect(send).toBeEnabled();
  await dialog.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(recipient).toHaveValue('');
  await expect(send).toBeDisabled();
  await recipient.fill('z');
  await expect(page.getByRole('option')).toHaveCount(0);
  await expect(dialog.getByRole('textbox', { name: /^Feedback/ })).toHaveValue('A synthetic feedback draft retained across recipient searches.');
});

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

test('old review lists and administration bookmarks still enter canonical appraisal screens', async ({ page, request }) => {
  const { writes } = await install(page);
  for (const [oldPath, destination] of [
    ['/admin/review-cycles?section=history', '/admin/appraisal-cycles?section=history'],
    ['/team/reviews', '/team/appraisals'],
    ['/reviews?section=history', '/appraisals?section=history'],
  ]) {
    const response = await request.get(oldPath, { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(new URL(response.headers().location, response.url()).pathname + new URL(response.headers().location, response.url()).search).toBe(destination);
  }
  await page.goto('/admin/review-cycles');
  await expect(page).toHaveURL(/\/admin\/appraisal-cycles$/);
  await expect(page.getByRole('button', { name: 'Create Cycle', exact: true })).toHaveCount(0);
  expect(writes).toEqual([]);
});

const historicalId = '0123456789abcdef01234567';
const historicalRecord = {
  _id: historicalId, cycleName: 'Synthetic historical cycle', status: 'Completed', dueDate: '2024-12-31',
  selfEvaluation: { content: 'Preserved historical employee reflection.', rating: 0, submittedAt: '2024-12-10' },
  managerEvaluation: { content: 'Preserved historical manager feedback.', rating: 4, submittedAt: '2024-12-11' },
  peerReviews: [{ content: 'Preserved anonymous peer feedback.', rating: 3, status: 'submitted' }],
};

test('a historical review bookmark reads the original engine without submission or AI actions', async ({ page }, info) => {
  const state: ResponseState = { fail: false, data: historicalRecord, reads: 0 };
  const { writes } = await install(page, { [`/reviews/${historicalId}`]: state }, false);
  const canonicalReads: string[] = [];
  page.on('request', request => { if (request.url().includes(`/__mock-api/appraisals/${historicalId}`)) canonicalReads.push(request.url()); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/reviews/${historicalId}`);
  await expect(page).toHaveURL(new RegExp(`/reviews/${historicalId}$`));
  await expect(page.getByRole('heading', { name: 'Historical review', exact: true })).toBeVisible();
  await expect(page.getByText(/retained as a read-only historical record/)).toBeVisible();
  for (const text of ['Preserved historical employee reflection.', 'Preserved historical manager feedback.', 'Preserved anonymous peer feedback.']) await expect(page.getByText(text, { exact: true })).toBeVisible();
  await expect(page.getByText(/Recorded rating: 0/)).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Submit|AI Suggest|AI Assist/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Back to appraisal history', exact: true })).toHaveAttribute('href', '/appraisals?section=history');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('historical-review-read-only-mobile.png'), fullPage: true });
  expect(state.reads).toBeGreaterThan(0);
  expect(canonicalReads).toEqual([]);
  expect(writes).toEqual([]);
});

test('historical review load failure retries without rewriting its record ID', async ({ page }) => {
  const state: ResponseState = { fail: true, data: historicalRecord, reads: 0 };
  const { writes } = await install(page, { [`/reviews/${historicalId}`]: state }, false);
  await page.goto(`/reviews/${historicalId}`);
  await expect(page.getByText('Could not load this historical review. Try again.', { exact: true })).toBeVisible();
  await expect(page.getByText('Preserved historical manager feedback.', { exact: true })).toHaveCount(0);
  state.fail = false;
  await page.getByRole('button', { name: 'Retry historical review', exact: true }).click();
  await expect(page.getByText('Preserved historical manager feedback.', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/reviews/${historicalId}$`));
  expect(writes).toEqual([]);
});

function goalPeriod() {
  const today = new Date(), quarter = Math.floor(today.getMonth() / 3);
  return { _id: 'synthetic-current-period', name: `Q${quarter + 1} ${today.getFullYear()}`, status: 'open',
    startDate: new Date(today.getFullYear(), quarter * 3, 1).toISOString(),
    endDate: new Date(today.getFullYear(), quarter * 3 + 3, 0, 23, 59, 59).toISOString() };
}

async function installGoalContext(page: Page, overrides: Partial<Record<Endpoint, ResponseState>>) {
  await install(page, overrides);
  await page.route('**/__mock-api/user/context', route => route.fulfill({ json: { success: true, data: {
    user: { id: 'reliability-reviewer', name: 'Synthetic Reviewer' }, role: { name: 'hr_admin', isManager: true, isHRAdmin: true },
    organization: { id: 'reliability-org', name: 'Synthetic reliability audit' },
    teams: [{ id: 'synthetic-team', name: 'Synthetic Team', organizationId: 'reliability-org', departmentId: 'synthetic-department', departmentName: 'Synthetic Department' }], stats: {}, features: {},
  } } }));
}

for (const delayedEndpoint of ['/okrs', '/goal-periods'] as const) {
  test(`goal creation waits for ${delayedEndpoint} and exposes named period, scope and metric controls`, async ({ page }) => {
    const period = goalPeriod();
    const delayed = heldResponse(delayedEndpoint === '/okrs' ? [] : [period]);
    delayed.state.fail = false;
    delayed.state.hold = delayed.hold;
    await installGoalContext(page, {
      '/okrs': delayedEndpoint === '/okrs' ? delayed.state : { fail: false, data: [], reads: 0 },
      '/goal-periods': delayedEndpoint === '/goal-periods' ? delayed.state : { fail: false, data: [period], reads: 0 },
    });
    await page.goto('/okrs?view=my');
    await expect.poll(() => delayed.state.reads).toBeGreaterThan(0);
    const create = page.getByRole('button', { name: 'Create goal', exact: true }).first();
    await expect(create).toBeDisabled();
    await expect(page.getByRole('dialog', { name: 'Create goal', exact: true })).toHaveCount(0);
    delayed.release();
    await expect(create).toBeEnabled();
    await expect(page.getByRole('combobox', { name: /^Period\s/ })).toContainText(period.name);
    await create.click();
    const dialog = page.getByRole('dialog', { name: 'Create goal', exact: true });
    await expect(dialog.getByRole('combobox', { name: /^Period\s/ })).toContainText(period.name);
    await expect(dialog.getByRole('textbox', { name: 'Period', exact: true })).toHaveCount(0);
    const scope = dialog.getByRole('combobox', { name: /^Scope\s/ });
    await expect(scope).toBeEnabled();
    await expect(dialog.getByRole('combobox', { name: /^Metric\s/ })).toContainText('Percentage');
    await scope.click(); await page.getByRole('option', { name: 'Team', exact: true }).click();
    await expect(dialog.getByRole('combobox', { name: /^Team(?:\s|$)/ })).toBeEnabled();
    await scope.click(); await page.getByRole('option', { name: 'Department', exact: true }).click();
    await expect(dialog.getByRole('combobox', { name: /^Department\s/ })).toContainText('Synthetic Department');
    await dialog.getByRole('button', { name: 'Add key result', exact: true }).click();
    const metrics = dialog.getByRole('combobox', { name: /^Metric\s/ });
    await expect(metrics).toHaveCount(2);
    expect(await metrics.nth(0).getAttribute('aria-labelledby')).not.toBe(await metrics.nth(1).getAttribute('aria-labelledby'));
  });
}

test('a failed goal load retains a working Retry before creation becomes available', async ({ page }) => {
  const goals: ResponseState = { fail: true, data: [], reads: 0 };
  await installGoalContext(page, { '/okrs': goals, '/goal-periods': { fail: false, data: [goalPeriod()], reads: 0 } });
  await page.goto('/okrs?view=my');
  const retry = page.getByRole('button', { name: 'Retry', exact: true });
  await expect(retry).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create goal', exact: true }).first()).toBeDisabled();
  goals.fail = false;
  await retry.click();
  await expect(page.getByRole('button', { name: 'Create goal', exact: true }).first()).toBeEnabled();
  await expect(retry).toHaveCount(0);
});

function graphGoal(id: string, title: string, type: 'organization' | 'team' | 'individual', parentId?: string) {
  return { _id: id, title, type, ownerId: 'reliability-reviewer', period: 'Synthetic graph period', status: 'active', progress: null,
    objectives: [{ title, keyResults: [{ title: `${title} result`, targetValue: 100 }] }],
    ...(parentId ? { alignment: { parentOKRId: parentId } } : {}), children: [] as ReturnType<typeof graphGoal>[] };
}

test('alignment goal deep links expand the authorized organization-to-child path', async ({ page }) => {
  const parent = graphGoal('visible-organization', 'Visible organization direction', 'organization');
  const child = graphGoal('visible-team', 'Visible team delivery', 'team', parent._id);
  parent.children = [child];
  await install(page, { '/okrs/hierarchy': { fail: false, reads: 0, data: { organization: [parent], unalignedDepartment: [], unalignedTeam: [], unalignedIndividual: [], tree: [parent] } } }, false);
  await page.goto(`/okrs/alignment?goal=${child._id}&period=${encodeURIComponent(child.period)}`);
  await expect(page.getByRole('button', { name: 'Collapse Visible organization direction', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator(`#goal-${child._id}`)).toBeVisible();
  await expect(page.locator(`#goal-${child._id}`)).toHaveCSS('outline-style', 'solid');
  await expect(page.getByText('Visible team delivery result', { exact: true })).toBeVisible();
});

test('alignment retains a visible linked root and descendants when its parent is unavailable without fetching that parent', async ({ page }, info) => {
  const linkedRoot = graphGoal('visible-linked-team', 'Visible linked team goal', 'team', 'unavailable-parent-id');
  const child = graphGoal('visible-linked-employee', 'Visible employee contribution', 'individual', linkedRoot._id);
  linkedRoot.children = [child];
  const goalReads: string[] = [];
  await install(page, { '/okrs/hierarchy': { fail: false, reads: 0, data: { organization: [], unalignedDepartment: [], unalignedTeam: [], unalignedIndividual: [], tree: [linkedRoot] } } }, false);
  page.on('request', request => { const path = new URL(request.url()).pathname; if (path.startsWith('/__mock-api/okrs')) goalReads.push(path); });
  await page.goto(`/okrs/alignment?goal=${child._id}`);
  await expect(page.getByText('Linked goals with an unavailable parent', { exact: true })).toBeVisible();
  await expect(page.getByText(/their parent goal is not available in this view/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Collapse Visible linked team goal', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator(`#goal-${linkedRoot._id}`)).toBeVisible();
  await expect(page.locator(`#goal-${child._id}`)).toBeVisible();
  await expect(page.getByText('unavailable-parent-id', { exact: false })).toHaveCount(0);
  await expect(page.getByText('Unaligned OKRs', { exact: true })).toHaveCount(0);
  expect(goalReads.length).toBeGreaterThan(0);
  expect(goalReads.every(path => path === '/__mock-api/okrs/hierarchy')).toBe(true);
  await page.screenshot({ path: info.outputPath('authorized-alignment-unavailable-parent.png'), fullPage: true });
});
