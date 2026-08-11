import { expect, test, type Locator, type Page, type Request } from '@playwright/test';

type Mode = 'manager' | 'admin';
type Entry = {
  _id: string;
  employee: { userId: string; name: string; email: string; jobTitle: string; teamId: string; teamName: string };
  evidenceSnapshot: { finalRating: number; ratingLabel: string; goalAchievement: number; competencyScore: number; finalizedAt: string };
  performanceBand: 'strong';
  potential: 'not_assessed' | 'limited' | 'moderate' | 'high';
  readiness: 'not_assessed' | 'ready_now' | 'ready_1_2_years' | 'ready_3_plus_years';
  decisionState: string;
  rationale?: string;
  aiBriefs: Array<{ _id: string; status: string; output: { summary: string; evidenceHighlights: string[]; evidenceGaps: string[]; discussionQuestions: string[] } }>;
};
type Review = { _id: string; name: string; state: 'draft' | 'open' | 'calibration' | 'closed'; sourceCycle: { name: string }; entries: Entry[]; updatedAt: string };
type Plan = { _id: string; role: { title: string; departmentName: string; criticality: string }; state: string; reviewDate?: string; candidates: Array<{ _id: string; employee: { userId: string; name: string }; readiness: string; rationale: string; state: string }> };
type State = { mode: Mode; reviews: Review[]; plans: Plan[]; posts: Array<{ method: string; path: string; body: Record<string, unknown> }> };

const employee = { userId: 'employee-1', name: 'Jordan Lee', email: 'jordan@example.com', jobTitle: 'Customer Success Manager', teamId: 'team-1', teamName: 'Customer Success' };
const manager = { id: 'manager-1', sub: 'manager-1', name: 'Alex Morgan', email: 'alex@example.com' };

function entry(): Entry {
  return { _id: 'entry-1', employee, evidenceSnapshot: { finalRating: 4.2, ratingLabel: 'Exceeds expectations', goalAchievement: 88, competencyScore: 4, finalizedAt: '2026-07-05T00:00:00.000Z' }, performanceBand: 'strong', potential: 'not_assessed', readiness: 'not_assessed', decisionState: 'unassessed', aiBriefs: [] };
}
function review(state: Review['state'] = 'open'): Review { return { _id: 'review-1', name: 'FY26 talent review', state, sourceCycle: { name: 'FY26 mid-year' }, entries: [entry()], updatedAt: '2026-08-11T08:00:00.000Z' }; }
function data<T>(value: T) { return { success: true, data: value }; }
async function requestBody(request: Request) { return (request.postDataJSON() || {}) as Record<string, unknown>; }
function muiSelect(scope: Locator, label: string) { return scope.locator('label').filter({ hasText: label }).first().locator('..').getByRole('combobox'); }

async function install(page: Page, state: State) {
  await page.addInitScript((mode: Mode) => {
    localStorage.setItem('accessToken', 'phase3-playwright-token');
    localStorage.setItem('performance-workspace:org-1:manager-1', mode === 'admin' ? 'admin' : 'manager');
    const NativeWebSocket = window.WebSocket;
    class MockSocket { static OPEN = 1; readyState = 1; onopen: ((event: Event) => void) | null = null; constructor() { window.setTimeout(() => this.onopen?.(new Event('open')), 0); } send() {} close() {} }
    Object.defineProperty(window, 'WebSocket', { configurable: true, value: new Proxy(NativeWebSocket, { construct(Target, args) { if (String(args[0]).includes('/__mock-ws')) return new MockSocket(); return Reflect.construct(Target, args); } }) });
  }, state.mode);

  await page.route('**/__mock-api/**', async route => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname.slice('/__mock-api'.length); const method = request.method();
    const fulfill = (payload: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
    const role = state.mode === 'admin'
      ? { name: 'hr_admin', displayName: 'HR Administrator', isManager: true, isHRAdmin: true, isTeamLead: true }
      : { name: 'line_manager', displayName: 'Line Manager', isManager: true, isHRAdmin: false, isTeamLead: true };
    const teams = [{ id: 'team-1', name: 'Customer Success', organizationId: 'org-1', role: 'line_manager', isManager: true, directReports: ['employee-1'] }];
    if (method === 'GET' && path === '/auth/me') return fulfill({ success: true, user: { ...manager, idpOrganizations: [{ id: 'org-1', name: 'Acme Ltd', role: state.mode === 'admin' ? 'admin' : 'employee' }], organizations: [{ id: 'org-1', name: 'Acme Ltd', role: state.mode === 'admin' ? 'admin' : 'employee' }] }, currentOrganizationId: 'org-1', currentOrganization: { id: 'org-1', name: 'Acme Ltd' } });
    if (method === 'GET' && path === '/user/context') return fulfill(data({ user: manager, role, organization: { id: 'org-1', name: 'Acme Ltd' }, teams, currentTeam: teams[0], managerData: { directReportCount: 1 }, stats: {}, features: { canonicalAppraisals: true, continuousPerformance: true, notifications: true, goalPeriods: true, talentPlanning: true } }));
    if (method === 'GET' && path === '/user/current-team') return fulfill(data({ currentTeam: teams[0], availableTeams: teams }));
    if (method === 'GET' && path === '/dashboard/summary') return fulfill({ okrProgress: 75, pendingReviews: 0, recentFeedback: 0 });
    if (method === 'GET' && path === '/appraisals/notifications/manager') return fulfill(data({ notifications: [] }));
    if (method === 'GET' && path === '/notifications/count') return fulfill(data({ unread: 0, actionable: 0 }));
    if (method === 'GET' && path === '/talent/reviews') return fulfill(data(state.reviews));
    if (method === 'GET' && path === '/talent/signals') return fulfill(data({ signals: [{ type: 'cycle_completion_risk', severity: 'high', employee, appraisalId: 'appraisal-stalled', status: 'manager_review_pending', reasons: ['Manager review has had no completion for 15 days'], definition: 'Deterministic workflow-age signal.' }], methodology: 'Explainable rules use workflow state and elapsed time only. No protected characteristics, attendance, leave, or hidden productivity data are used.', machineLearning: { enabled: false } }));
    if (method === 'GET' && path === '/talent/succession-plans') return fulfill(data(state.plans));
    if (method === 'GET' && path === '/appraisals/cycles') return fulfill(data([{ _id: 'cycle-1', name: 'FY26 mid-year', status: 'completed' }]));
    if (method === 'GET' && path === '/user/search') return fulfill(data([employee]));
    if (method === 'POST' && path === '/talent/reviews') {
      const body = await requestBody(request); state.posts.push({ method, path, body }); const created = review('draft'); created.name = String(body.name); state.reviews = [created]; return fulfill(data(created), 201);
    }
    if (method === 'POST' && path.endsWith('/transition')) {
      const body = await requestBody(request); state.posts.push({ method, path, body }); state.reviews[0].state = String(body.state) as Review['state']; return fulfill(data(state.reviews[0]));
    }
    if (method === 'PATCH' && path.includes('/talent/reviews/') && path.includes('/entries/')) {
      const body = await requestBody(request); state.posts.push({ method, path, body }); Object.assign(state.reviews[0].entries[0], { potential: body.potential, readiness: body.readiness, rationale: body.rationale, decisionState: state.mode === 'admin' && state.reviews[0].state === 'calibration' ? 'hr_calibrated' : 'manager_proposed' }); return fulfill(data(state.reviews[0]));
    }
    if (method === 'POST' && path.endsWith('/ai-brief')) {
      state.posts.push({ method, path, body: {} }); const brief = { _id: 'brief-1', status: 'suggested', output: { summary: 'Documented cross-team delivery with a delegation development area.', evidenceHighlights: ['Led a cross-team delivery'], evidenceGaps: ['Only one review period'], discussionQuestions: ['What broader scope has been sustained?'] } }; state.reviews[0].entries[0].aiBriefs.push(brief); return fulfill(data(brief));
    }
    if (method === 'POST' && path.includes('/ai-briefs/')) { const body = await requestBody(request); state.posts.push({ method, path, body }); state.reviews[0].entries[0].aiBriefs[0].status = String(body.decision); return fulfill(data(state.reviews[0].entries[0].aiBriefs[0])); }
    if (method === 'POST' && path === '/talent/succession-plans') {
      const body = await requestBody(request); state.posts.push({ method, path, body }); const role = body.role as Plan['role']; const plan: Plan = { _id: 'plan-1', role, state: 'active', reviewDate: String(body.reviewDate || ''), candidates: [] }; state.plans.push(plan); return fulfill(data(plan), 201);
    }
    if (method === 'POST' && path.endsWith('/candidates')) {
      const body = await requestBody(request); state.posts.push({ method, path, body }); state.plans[0].candidates.push({ _id: 'candidate-1', employee, readiness: String(body.readiness), rationale: String(body.rationale), state: 'proposed' }); return fulfill(data(state.plans[0]), 201);
    }
    if (path === '/presence') return fulfill({ success: true });
    return fulfill(data([]));
  });
}

test('manager assesses a direct report from frozen evidence and the person moves into the nine-box view', async ({ page }) => {
  const state: State = { mode: 'manager', reviews: [review('open')], plans: [], posts: [] }; await install(page, state); await page.goto('/talent');
  await expect(page.getByRole('heading', { level: 1, name: 'Talent planning' })).toBeVisible();
  await expect(page.getByText('4.2/5 · Strong')).toBeVisible(); await page.getByRole('button', { name: 'Assess' }).click();
  const dialog = page.getByRole('dialog', { name: 'Assess Jordan Lee' });
  await expect(dialog.getByText('Frozen performance evidence')).toBeVisible();
  await muiSelect(dialog, 'Potential').click(); await page.getByRole('option', { name: 'Demonstrated capacity for broader scope' }).click();
  await muiSelect(dialog, 'Readiness').click(); await page.getByRole('option', { name: 'Ready in 1–2 years' }).click();
  await dialog.getByLabel('Evidence-based rationale').fill('Led two cross-team deliveries and demonstrated broader operational judgment.');
  await dialog.getByLabel('Strengths (one per line)').fill('Cross-team leadership'); await dialog.getByLabel('Development priorities (one per line)').fill('Delegation');
  await dialog.getByRole('button', { name: 'Save proposal' }).click();
  await expect(page.getByText('Manager proposal saved for HR calibration.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Jordan Lee · Ready in 1–2 years/i })).toBeVisible();
  expect(state.posts[0].body).toMatchObject({ potential: 'high', readiness: 'ready_1_2_years' });
  expect(state.posts[0].body).not.toHaveProperty('evidenceSnapshot');
});

test('AI evidence brief is reviewable and never replaces the human potential controls', async ({ page }) => {
  const state: State = { mode: 'manager', reviews: [review('open')], plans: [], posts: [] }; await install(page, state); await page.goto('/talent'); await page.getByRole('button', { name: 'Assess' }).click();
  const dialog = page.getByRole('dialog', { name: 'Assess Jordan Lee' }); await dialog.getByRole('button', { name: 'Create evidence brief with AI' }).click();
  await expect(dialog.getByText('Documented cross-team delivery with a delegation development area.')).toBeVisible();
  await expect(muiSelect(dialog, 'Potential')).toContainText('Broader scope with development');
  await dialog.getByRole('button', { name: 'Accept as discussion aid' }).click(); await expect(page.getByText('AI evidence brief accepted.')).toBeVisible();
  expect(state.posts.map((item) => item.path)).toEqual(expect.arrayContaining(['/talent/reviews/review-1/entries/employee-1/ai-brief', '/talent/reviews/review-1/entries/employee-1/ai-briefs/brief-1/review']));
});

test('HR creates a review from a completed cycle and advances the controlled states', async ({ page }) => {
  const state: State = { mode: 'admin', reviews: [], plans: [], posts: [] }; await install(page, state); await page.goto('/talent'); await page.getByRole('button', { name: 'New talent review' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create talent review' }); await muiSelect(dialog, 'Completed appraisal cycle').click(); await page.getByRole('option', { name: 'FY26 mid-year' }).click();
  await expect(dialog.getByLabel('Review name')).toHaveValue('FY26 mid-year talent review'); await dialog.getByRole('button', { name: 'Create review' }).click();
  await expect(page.getByText(/Talent review created with 1 finalized appraisal snapshots/)).toBeVisible(); await page.getByRole('button', { name: 'Open for managers' }).click();
  await expect(page.getByText('Talent review moved to Open.')).toBeVisible(); await page.getByRole('button', { name: 'Start HR calibration' }).click();
  await expect(page.getByText('Talent review moved to Calibration.')).toBeVisible(); await page.getByRole('button', { name: 'Close review' }).click();
  await expect(page.getByText('Talent review moved to Closed.')).toBeVisible();
  expect(state.posts.filter((item) => item.path.endsWith('/transition')).map((item) => item.body.state)).toEqual(['open', 'calibration', 'closed']);
});

test('HR creates critical-role coverage and nominates a searched employee with readiness evidence', async ({ page }) => {
  const state: State = { mode: 'admin', reviews: [review('closed')], plans: [], posts: [] }; await install(page, state); await page.goto('/talent'); await page.getByRole('tab', { name: 'Succession coverage' }).click();
  await page.getByRole('button', { name: 'Add critical role' }).click(); const roleDialog = page.getByRole('dialog', { name: 'Add critical role coverage' });
  await roleDialog.getByLabel('Role title').fill('Head of Customer Success'); await roleDialog.getByLabel('Department (optional)').fill('Customer Success'); await muiSelect(roleDialog, 'Criticality').click(); await page.getByRole('option', { name: 'Critical' }).click(); await roleDialog.getByRole('button', { name: 'Create coverage' }).click();
  await expect(page.getByText('Succession role coverage created.')).toBeVisible(); await page.getByRole('button', { name: 'Add candidate' }).click();
  const candidate = page.getByRole('dialog', { name: 'Add candidate for Head of Customer Success' }); await candidate.getByLabel('Search active employee').fill('Jordan'); await page.getByRole('option', { name: 'Jordan Lee' }).click();
  await candidate.getByLabel('Evidence-based rationale').fill('Demonstrated customer leadership and sustained cross-team delivery over the review period.'); await candidate.getByRole('button', { name: 'Add candidate' }).click();
  await expect(page.getByText('Succession candidate proposed with an auditable rationale.')).toBeVisible(); await expect(page.getByText('Pipeline only')).toBeVisible();
  expect(state.posts.at(-1)?.body).toMatchObject({ employeeId: 'employee-1', readiness: 'ready_1_2_years' });
});

test('explainable signals remain readable, keyboard reachable, and overflow-free on mobile', async ({ page }) => {
  const state: State = { mode: 'manager', reviews: [review('open')], plans: [], posts: [] }; await install(page, state); await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/talent');
  const signalsTab = page.getByRole('tab', { name: /Explainable signals/ }); await signalsTab.focus(); await page.keyboard.press('Enter');
  await expect(page.getByText('Manager review has had no completion for 15 days')).toBeVisible(); await expect(page.getByText(/No predictive model is enabled/)).toBeVisible();
  await expect(page.locator('main')).toHaveCount(1); await expect(page.getByRole('heading', { level: 1, name: 'Talent planning' })).toBeVisible();
  expect(await page.locator('body').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});
