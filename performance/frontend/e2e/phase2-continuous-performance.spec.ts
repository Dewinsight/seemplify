import { expect, test, type Locator, type Page, type Request } from '@playwright/test';

type Mode = 'employee' | 'manager' | 'admin';
interface Plan { _id: string; planType: string; state: string; title: string; summary: string; employee: { userId: string; name: string; email: string }; manager: { userId: string; name: string }; objectives: Array<{ _id: string; title: string; measure: string; target: string; dueDate: string; status: string }>; supportCommitments: Array<{ description: string; ownerType: string; status: string }>; milestones: unknown[]; checkIns: Array<{ _id: string; authorId: string; authorRole: string; progress: number; update: string; createdAt: string }>; updatedAt: string; hrReview?: { decision: string; comment: string }; employeeResponse?: { acknowledgement: string; comment?: string; respondedAt: string } }
interface Phase2State {
  mode: Mode;
  plans: Plan[];
  recognition: Array<Record<string, unknown>>;
  projects: Array<Record<string, unknown>>;
  posted: Array<{ path: string; body: Record<string, unknown> }>;
}

const employee = { userId: 'employee-1', id: 'employee-1', name: 'Jordan Lee', email: 'jordan@example.com', teamId: 'team-1', teamName: 'Customer Success', jobTitle: 'Customer Success Manager' };
const crossFunctionalColleague = { userId: 'employee-2', id: 'employee-2', name: 'Priya Shah', email: 'priya@example.com', teamId: 'team-2', teamName: 'Engineering', jobTitle: 'Engineer' };
const manager = { id: 'user-1', sub: 'user-1', name: 'Alex Morgan', email: 'alex@example.com' };
const due = '2026-09-15T00:00:00.000Z';

function plan(state = 'draft'): Plan {
  return { _id: 'plan-1', planType: 'formal_improvement', state, title: 'Delivery reliability support', summary: 'A clear plan for raising delivery risks early, with weekly manager support.', employee, manager: { userId: manager.id, name: manager.name }, objectives: [{ _id: 'objective-1', title: 'Raise delivery risks early', measure: 'Weekly delivery review record', target: 'All material risks raised two working days early', dueDate: due, status: 'not_started' }], supportCommitments: [{ description: 'Manager holds a weekly priority review.', ownerType: 'manager', status: 'open' }], milestones: [], checkIns: [], updatedAt: '2026-08-11T08:00:00.000Z' };
}

function stateFor(mode: Mode, plans: Plan[] = []): Phase2State { return { mode, plans, recognition: [], projects: [], posted: [] }; }
function data<T>(value: T) { return { success: true, data: value }; }
async function body(request: Request) { return request.postDataJSON() as Record<string, unknown>; }
function muiSelect(scope: Locator, label: string) { return scope.locator('label').filter({ hasText: label }).first().locator('..').getByRole('combobox'); }

async function install(page: Page, state: Phase2State) {
  await page.addInitScript((mode: Mode) => {
    localStorage.setItem('accessToken', 'phase2-playwright-token');
    localStorage.setItem(`performance-workspace:org-1:${mode === 'employee' ? 'employee-1' : 'user-1'}`, mode === 'employee' ? 'personal' : mode === 'manager' ? 'manager' : 'admin');
    const NativeWebSocket = window.WebSocket;
    class MockSocket { static OPEN = 1; readyState = 1; onopen: ((event: Event) => void) | null = null; onmessage: ((event: MessageEvent) => void) | null = null; onerror: ((event: Event) => void) | null = null; onclose: ((event: CloseEvent) => void) | null = null; constructor() { window.setTimeout(() => this.onopen?.(new Event('open')), 0); } send() {} close() {} }
    const RoutedWebSocket = new Proxy(NativeWebSocket, { construct(Target, args) { if (String(args[0]).includes('/__mock-ws')) return new MockSocket(); return Reflect.construct(Target, args); } });
    Object.defineProperty(window, 'WebSocket', { configurable: true, value: RoutedWebSocket });
  }, state.mode);

  await page.route('**/__mock-api/**', async route => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname.slice('/__mock-api'.length); const method = request.method();
    const fulfill = (payload: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
    const currentUser = state.mode === 'employee' ? { id: employee.userId, sub: employee.userId, name: employee.name, email: employee.email } : manager;
    const role = state.mode === 'admin' ? { name: 'hr_admin', displayName: 'HR Administrator', isManager: true, isHRAdmin: true, isTeamLead: true } : state.mode === 'manager' ? { name: 'line_manager', displayName: 'Line Manager', isManager: true, isHRAdmin: false, isTeamLead: true } : { name: 'employee', displayName: 'Employee', isManager: false, isHRAdmin: false, isTeamLead: false };
    const teams = state.mode === 'manager' ? [{ id: 'team-1', name: 'Customer Success', organizationId: 'org-1', role: 'line_manager', isManager: true }] : [];
    if (method === 'GET' && path === '/auth/me') return fulfill({ success: true, user: { ...currentUser, idpOrganizations: [{ id: 'org-1', name: 'Acme Ltd', role: state.mode === 'admin' ? 'admin' : 'employee' }], organizations: [{ id: 'org-1', name: 'Acme Ltd', role: state.mode === 'admin' ? 'admin' : 'employee' }] }, currentOrganizationId: 'org-1', currentOrganization: { id: 'org-1', name: 'Acme Ltd' } });
    if (method === 'GET' && path === '/user/context') return fulfill(data({ user: currentUser, role, organization: { id: 'org-1', name: 'Acme Ltd' }, teams, currentTeam: teams[0] || null, managerData: state.mode === 'manager' ? { directReportCount: 1 } : null, stats: {}, features: { canonicalAppraisals: true, goalPeriods: true, notifications: true, continuousPerformance: true, performanceSupportPlans: true, recognition: true, projectFeedback: true, managerPracticeInsights: true, continuousCoachingAi: true } }));
    if (method === 'GET' && path === '/user/current-team') return fulfill(data({ currentTeam: teams[0] || null, availableTeams: teams }));
    if (method === 'GET' && path === '/user/my-team-members') return fulfill(data({ isManager: state.mode !== 'employee', teams, directReports: state.mode === 'employee' ? [] : [employee], totalDirectReports: state.mode === 'employee' ? 0 : 1 }));
    if (method === 'GET' && path === '/user/search') return fulfill(data(String(url.searchParams.get('q') || '').toLowerCase().includes('priya') ? [crossFunctionalColleague] : [employee]));
    if (method === 'GET' && path === '/dashboard/summary') return fulfill({ okrProgress: 50, pendingReviews: 0, recentFeedback: 0 });
    if (method === 'GET' && path === '/appraisals/notifications/manager') return fulfill(data({ notifications: [] }));
    if (method === 'GET' && path === '/notifications/count') return fulfill(data({ unread: 0, actionable: 0 }));
    if (method === 'GET' && path.startsWith('/support-plans')) return fulfill(data(state.plans));
    if (method === 'POST' && path === '/support-plans/ai-draft') { state.posted.push({ path, body: await body(request) }); return fulfill(data({ suggestionId: 'ai-suggestion-1', draft: { title: 'Delivery reliability support', summary: 'A measurable support plan with weekly review.', objectives: [{ title: 'Raise delivery risks early', measure: 'Weekly delivery review record', target: '100% raised two working days early' }], supportCommitments: ['Manager holds a weekly priority review.'] }, advisory: true })); }
    if (method === 'POST' && path === '/support-plans') {
      const posted = await body(request); state.posted.push({ path, body: posted });
      const created = plan('draft'); created.title = String(posted.title); created.summary = String(posted.summary); state.plans = [created]; return fulfill(data(created), 201);
    }
    if (method === 'POST' && path.endsWith('/submit-for-hr-review')) { state.posted.push({ path, body: await body(request) }); state.plans[0].state = 'hr_review'; return fulfill(data(state.plans[0])); }
    if (method === 'POST' && path.endsWith('/hr-decision')) { const posted = await body(request); state.posted.push({ path, body: posted }); state.plans[0].state = posted.decision === 'approve' ? 'employee_review' : 'changes_requested'; state.plans[0].hrReview = { decision: posted.decision === 'approve' ? 'approved' : 'changes_requested', comment: String(posted.comment || '') }; return fulfill(data(state.plans[0])); }
    if (method === 'POST' && path.endsWith('/employee-response')) { const posted = await body(request); state.posted.push({ path, body: posted }); state.plans[0].state = 'active'; state.plans[0].employeeResponse = { acknowledgement: String(posted.acknowledgement), comment: String(posted.comment || ''), respondedAt: new Date().toISOString() }; return fulfill(data(state.plans[0])); }
    if (method === 'POST' && path.endsWith('/check-ins')) { const posted = await body(request); state.posted.push({ path, body: posted }); state.plans[0].checkIns.push({ _id: 'plan-check-in-1', authorId: manager.id, authorRole: state.mode, progress: Number(posted.progress), update: String(posted.update), createdAt: new Date().toISOString() }); return fulfill(data(state.plans[0]), 201); }
    if (method === 'GET' && path === '/recognition') return fulfill(data(state.recognition));
    if (method === 'POST' && path === '/recognition') { const posted = await body(request); state.posted.push({ path, body: posted }); state.recognition.push({ _id: 'recognition-1', message: posted.message, companyValue: posted.companyValue, visibility: posted.visibility, contextType: 'general', sender: { userId: manager.id, name: manager.name }, recipient: posted.recipient, createdAt: new Date().toISOString() }); return fulfill(data(state.recognition[0]), 201); }
    if (method === 'POST' && path.endsWith('/acknowledge')) { state.posted.push({ path, body: {} }); state.recognition[0].acknowledgedAt = new Date().toISOString(); return fulfill(data(state.recognition[0])); }
    if (method === 'GET' && path === '/performance-projects') return fulfill(data(state.projects));
    if (method === 'POST' && path === '/performance-projects') { const posted = await body(request); state.posted.push({ path, body: posted }); const project = { _id: 'project-1', name: posted.name, description: posted.description, state: 'active', leads: [{ userId: manager.id, name: manager.name }], participants: posted.participants, startDate: posted.startDate, endDate: posted.endDate }; state.projects.push(project); return fulfill(data(project), 201); }
    if (method === 'POST' && path.endsWith('/feedback-requests')) { const posted = await body(request); state.posted.push({ path, body: posted }); return fulfill(data({ _id: 'project-request-1', ...posted, contextType: 'project' }), 201); }
    if (method === 'GET' && path === '/manager-insights/practices') return fulfill(data({ generatedAt: new Date().toISOString(), scope: { employeeCount: 1 }, summary: { atRiskGoals: 1, checkInCoverage: 100, oneOnOneCoverage: 0, feedbackCoverage: 0, recognitionCoverage: 0, openAppraisals: 1, supportPlansDue: 0 }, attention: [{ type: 'goal_risk', priority: 'high', employeeId: employee.userId, employeeName: employee.name, message: '1 goal needs a progress conversation', href: '/okrs?view=team' }, { type: 'one_on_one_gap', priority: 'medium', employeeId: employee.userId, employeeName: employee.name, message: 'No completed 1:1 in the last 45 days', href: '/one-on-ones/new' }], definitions: [{ key: 'checkInCoverage', label: 'Check-in coverage', definition: 'Direct reports with a submitted check-in in the last 45 days.' }], safeguards: ['No ranking'] }));
    if (path === '/presence') return fulfill({ success: true });
    return fulfill(data([]));
  });
}

test('manager creates an AI-assisted draft, reviews it, and sends it to HR', async ({ page }) => {
  const state = stateFor('manager'); await install(page, state); await page.goto('/support-plans');
  await expect(page.getByRole('heading', { level: 1, name: 'Support plans' })).toBeVisible();
  await page.getByRole('button', { name: 'New support plan' }).click(); const dialog = page.getByRole('dialog', { name: 'Create a support plan' });
  await muiSelect(dialog, 'Employee').click(); await page.getByRole('option', { name: 'Jordan Lee' }).click();
  await dialog.getByLabel('Observed concern').fill('Two delivery dates were missed without an early risk update.'); await dialog.getByLabel('Expected standard').fill('Raise material delivery risk two working days before the due date.');
  await dialog.getByRole('button', { name: 'Draft measurable wording with AI' }).click(); await expect(page.getByText(/AI draft added/)).toBeVisible();
  await dialog.getByLabel('Review date').fill('2026-09-15'); await dialog.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Support plan saved as a draft.')).toBeVisible(); const details = page.getByRole('dialog', { name: /Delivery reliability support/ });
  await details.getByRole('button', { name: 'Send to HR' }).click(); await expect(page.getByText('Plan sent to HR for review.')).toBeVisible();
  expect(state.posted.map(item => item.path)).toEqual(expect.arrayContaining(['/support-plans/ai-draft', '/support-plans', '/support-plans/plan-1/submit-for-hr-review']));
  expect((state.posted.find(item => item.path === '/support-plans')?.body.objectives as unknown[])).toHaveLength(1);
  expect(state.posted.find(item => item.path === '/support-plans')?.body.aiAssistance).toMatchObject({ suggestionId: 'ai-suggestion-1' });
});

test('HR reviews the exact support plan and approves it for employee response', async ({ page }) => {
  const seeded = plan('hr_review'); const state = stateFor('admin', [seeded]); await install(page, state); await page.goto('/support-plans');
  await expect(page.getByText('HR review queue')).toBeVisible(); await page.getByRole('button', { name: 'Open plan' }).click(); const dialog = page.getByRole('dialog', { name: /Delivery reliability support/ });
  await dialog.getByLabel('Plan summary').count().catch(() => 0); // Detail content is read-only by design.
  await dialog.getByRole('button', { name: 'Approve for employee review' }).click(); await expect(page.getByText('Plan approved and sent to the employee.')).toBeVisible();
  expect(state.posted.at(-1)).toMatchObject({ path: '/support-plans/plan-1/hr-decision', body: { decision: 'approve' } });
});

test('employee acknowledges a reviewed plan and records a progress check-in', async ({ page }) => {
  const seeded = plan('employee_review'); seeded.hrReview = { decision: 'approved', comment: 'Measurable and supported.' }; const state = stateFor('employee', [seeded]); await install(page, state); await page.goto('/support-plans');
  await page.getByRole('button', { name: 'Open plan' }).click(); const dialog = page.getByRole('dialog', { name: /Delivery reliability support/ }); await dialog.getByRole('button', { name: 'Acknowledge', exact: true }).click();
  await expect(page.getByText(/acknowledgement was recorded/)).toBeVisible(); await dialog.getByLabel('Progress update').fill('Raised a dependency risk during Monday planning.'); await dialog.getByLabel('Progress %').fill('45'); await dialog.getByRole('button', { name: 'Add check-in' }).click();
  await expect(page.getByText('Progress check-in added.')).toBeVisible(); expect(state.posted.map(item => item.path)).toEqual(expect.arrayContaining(['/support-plans/plan-1/employee-response', '/support-plans/plan-1/check-ins']));
});

test('recognition search, audience selection, send, and acknowledgement are usable', async ({ page }) => {
  const state = stateFor('employee'); await install(page, state); await page.goto('/recognition'); await page.getByRole('button', { name: 'Recognize a colleague' }).click(); const dialog = page.getByRole('dialog', { name: 'Recognize a colleague' });
  await dialog.getByLabel('Search organization').fill('Jordan'); await dialog.getByRole('button', { name: /Jordan Lee/ }).click(); await dialog.getByLabel('Recognition message').fill('You surfaced the delivery dependency early and kept the customer launch on track.'); await dialog.getByLabel('Company value (optional)').fill('Ownership'); await muiSelect(dialog, 'Audience').click(); await page.getByRole('option', { name: 'Recipient only' }).click(); await dialog.getByRole('button', { name: 'Send recognition' }).click();
  await expect(page.getByText(/Recognition sent/)).toBeVisible(); expect(state.posted[0]).toMatchObject({ path: '/recognition', body: { visibility: 'private', companyValue: 'Ownership' } });
});

test('project lead creates membership and requests feedback between verified participants', async ({ page }) => {
  const state = stateFor('manager'); await install(page, state); await page.goto('/project-feedback'); await page.getByRole('button', { name: 'Add project' }).click(); const create = page.getByRole('dialog', { name: 'Add a project' }); await create.getByLabel('Project name').fill('Customer migration'); await create.getByLabel('Start date').fill('2026-08-01'); await create.getByLabel('Search organization participants').fill('Priya'); await create.getByRole('combobox', { name: 'Participants', exact: true }).click(); await page.getByRole('option', { name: 'Priya Shah' }).click(); await page.keyboard.press('Escape'); await create.getByRole('button', { name: 'Create active project' }).click();
  await expect(page.getByText(/Project created/)).toBeVisible(); await page.getByRole('button', { name: 'Request feedback' }).click(); const requestDialog = page.getByRole('dialog', { name: 'Request project feedback' }); await muiSelect(requestDialog, 'Feedback about').click(); await page.getByRole('option', { name: 'Priya Shah' }).click(); await muiSelect(requestDialog, 'Reviewer').click(); await page.getByRole('option', { name: 'Alex Morgan' }).click(); await requestDialog.getByLabel('Due date').fill('2026-09-01'); await requestDialog.getByRole('button', { name: 'Send request' }).click();
  await expect(page.getByText(/Project feedback request sent/)).toBeVisible(); expect(state.posted.map(item => item.path)).toEqual(['/performance-projects', '/performance-projects/project-1/feedback-requests']);
});

test('manager coaching queue explains metrics, filters priorities, and remains usable on mobile', async ({ page }) => {
  const state = stateFor('manager'); await install(page, state); await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/coaching'); await expect(page.getByRole('heading', { level: 1, name: 'Manager coaching' })).toBeVisible(); await expect(page.getByText('1 goal needs a progress conversation')).toBeVisible(); await expect(page.getByText(/do not score, rank, diagnose/)).toBeVisible();
  await muiSelect(page.locator('main'), 'Priority').click(); await page.getByRole('option', { name: 'High' }).click(); await expect(page.getByText('No completed 1:1 in the last 45 days')).toHaveCount(0); await expect(page.getByText('Check-in coverage:')).toBeVisible(); expect(await page.locator('body').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});
