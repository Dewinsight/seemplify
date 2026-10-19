import { expect, test, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import path from 'node:path';
const backend = createRequire(path.resolve(process.cwd(), '../backend/package.json'));
const express = backend('express'), mongoose = backend('mongoose');
const { MongoMemoryServer } = backend('mongodb-memory-server');
const Appraisal = backend('./models/Appraisal'), Cycle = backend('./models/AppraisalCycle'), User = backend('./models/User');
let mongo: { stop: () => Promise<void> }, server: import('node:http').Server, apiURL: string;
const organization = { id: 'lifecycle-browser-org', name: 'Local lifecycle QA', role: 'staff', appAccess: { mode: 'all', appIds: [] } };
function actor(who: string) { const currentOrganization = { ...organization, role: who === 'admin' ? 'owner' : organization.role }; return { id: who, sub: who, name: who === 'admin' ? 'Alex Administrator' : who === 'reviewer' ? 'Morgan Reviewer' : 'Emery Employee', email: `${who}@example.test`, organizations: [currentOrganization], currentOrganization,
  idpTeams: [{ id: 'team', name: 'Product', organizationId: organization.id, role: who === 'reviewer' ? 'line_manager' : 'member' }] }; }
test.beforeAll(async () => {
  mongo = await MongoMemoryServer.create(); await mongoose.connect((mongo as unknown as { getUri: () => string }).getUri());
  await Appraisal.createIndexes();
  for (const who of ['reviewer', 'employee', 'admin']) await User.create({ idpSub: who, email: actor(who).email, profile: { displayName: actor(who).name }, currentOrganizationId: organization.id, idpTeams: actor(who).idpTeams });
  const app = express(); app.use(express.json());
  app.use((req: { session: unknown; get: (key: string) => string }, _res: unknown, next: () => void) => { req.session = { user: actor(req.get('x-lifecycle-actor') || 'reviewer'), currentOrganizationId: organization.id }; next(); });
  app.use('/api/appraisals', backend('./routes/appraisals'));
  server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  apiURL = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
});
test.afterAll(async () => { if (server) await new Promise<void>(resolve => server.close(() => resolve())); await mongoose.disconnect(); if (mongo) await mongo.stop(); });
async function setup(page: Page, who: string) {
  const user = actor(who);
  await page.addInitScript(() => localStorage.setItem('accessToken', 'isolated-lifecycle-qa'));
  await page.route('**/__mock-api/**', async route => {
    const url = new URL(route.request().url()); const endpoint = url.pathname.slice('/__mock-api'.length);
    if (endpoint.startsWith('/appraisals/')) { const response = await route.fetch({ url: `${apiURL}/api${endpoint}${url.search}`, headers: { ...route.request().headers(), 'x-lifecycle-actor': who } }); await route.fulfill({ response }); return; }
    let response: unknown = { success: true, data: [] };
    if (endpoint === '/auth/me') response = { success: true, user, currentOrganization: user.currentOrganization, currentOrganizationId: organization.id };
    if (endpoint === '/user/context') response = { success: true, data: { user, organization: user.currentOrganization, role: { name: who === 'admin' ? 'owner' : who === 'reviewer' ? 'line_manager' : 'employee', isManager: who === 'reviewer' || who === 'admin', isHRAdmin: who === 'admin' }, teams: user.idpTeams, features: {}, stats: {} } };
    if (endpoint === '/user/current-team') response = { success: true, data: { currentTeam: user.idpTeams[0], availableTeams: user.idpTeams } };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) });
  });
}
for (const mobile of [false, true]) test(`cancel, remove and restore a real appraisal with participant permissions (${mobile ? 'mobile' : 'desktop'})`, async ({ page, browser }, testInfo) => {
  if (mobile) { await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme: 'dark' }); }
  const cycle = await Cycle.create({ name: 'Local lifecycle review', organizationId: organization.id, periodStart: '2026-01-01', periodEnd: '2026-03-31', status: 'active', createdBy: { userId: 'reviewer', name: 'Morgan Reviewer' } });
  const record = await Appraisal.create({ cycleId: cycle._id, organizationId: organization.id, employee: { userId: 'employee', name: 'Emery Employee', email: 'employee@example.test' }, manager: { userId: 'reviewer', name: 'Morgan Reviewer', email: 'reviewer@example.test' }, status: 'self_assessment_pending', selfAssessment: { overallSummary: { achievements: 'Retained assessment evidence.' } } });
  const url = `/appraisals/${record._id}`;
  await setup(page, 'reviewer'); await page.goto(url);
  const employeeContext = await browser.newContext(); const employee = await employeeContext.newPage(); await setup(employee, 'employee'); await employee.goto(url);
  await expect(employee.getByRole('heading', { name: 'My Appraisal', exact: true })).toBeVisible();
  await expect(employee.getByRole('button', { name: 'Manage appraisal', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Manage appraisal', exact: true }).click(); await page.getByRole('menuitem', { name: 'Cancel appraisal', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Stop this review');
  await page.getByRole('button', { name: 'Keep appraisal', exact: true }).click();
  expect((await Appraisal.findById(record._id)).status).toBe('self_assessment_pending');
  await page.getByRole('button', { name: 'Manage appraisal', exact: true }).click(); await page.getByRole('menuitem', { name: 'Cancel appraisal', exact: true }).click();
  // An optional reason must not block cancelling a mistakenly launched appraisal.
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel appraisal', exact: true }).click();
  await expect(page.getByText(/This appraisal was cancelled on/)).toBeVisible();
  expect((await Appraisal.findById(record._id)).status).toBe('cancelled');
  await employee.reload(); await expect(employee.getByText(/This appraisal was cancelled on/)).toBeVisible();
  await expect(employee.getByRole('button', { name: /Start Self-Assessment/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Manage appraisal', exact: true }).click(); await page.getByRole('menuitem', { name: 'Remove appraisal', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('assessments, recordings and notes are kept');
  await page.screenshot({ path: testInfo.outputPath('remove-appraisal-confirmation.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Move to Removed', exact: true }).click();
  await expect(page).toHaveURL(/\/appraisals\/removed$/);
  await expect(page.getByRole('heading', { name: 'Emery Employee', exact: true })).toBeVisible();
  expect(await Appraisal.findById(record._id)).toBeNull();
  await employee.reload(); await expect(employee.getByText(/Failed to load appraisal/)).toBeVisible();
  await page.getByRole('button', { name: 'Restore appraisal', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('stays cancelled');
  await page.getByRole('button', { name: 'Restore to History', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/appraisals/${record._id}$`));
  await expect(page.getByText(/This appraisal was cancelled on/)).toBeVisible();
  const restored = await Appraisal.findById(record._id); expect(restored.status).toBe('cancelled'); expect(restored.selfAssessment.overallSummary.achievements).toBe('Retained assessment evidence.');
  await expect(page.getByText('Appraisal Progress', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('restored-cancelled-appraisal.png'), fullPage: true, animations: 'disabled' });
  await employeeContext.close();
});

test('only an administrator can remove and restore a completed review, preserving its published report', async ({ page, browser }, testInfo) => {
  const cycle = await Cycle.create({ name: 'Preserved completed review', organizationId: organization.id, periodStart: '2026-01-01', periodEnd: '2026-03-31', status: 'active', createdBy: { userId: 'reviewer', name: 'Morgan Reviewer' } });
  const record = await Appraisal.create({ cycleId: cycle._id, organizationId: organization.id, employee: { userId: 'employee', name: 'Emery Employee', email: 'employee@example.test' }, manager: { userId: 'reviewer', name: 'Morgan Reviewer', email: 'reviewer@example.test' }, status: 'employee_acknowledged', selfAssessment: { submittedAt: new Date('2026-04-01'), overallSummary: { achievements: 'Original employee achievement.' } }, managerReview: { submittedAt: new Date('2026-04-02'), overallManagerRating: 4, overallSummary: { strengths: 'Original manager feedback.' } }, finalRating: { overall: 4, ratingLabel: 'Strong performance', finalizedAt: new Date('2026-04-03'), finalizedBy: { userId: 'reviewer', name: 'Morgan Reviewer' }, justification: 'Original final decision.' }, lifecycle: { cleanupPending: true } });
  const preserved = (await (await fetch(`${apiURL}/api/appraisals/${record._id}/report`, { headers: { 'x-lifecycle-actor': 'reviewer' } })).json()).data;
  const url = `/appraisals/${record._id}`;
  await setup(page, 'reviewer'); await page.goto(url);
  await expect(page.getByRole('button', { name: 'Manage appraisal', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry cancellation', exact: true })).toHaveCount(0);
  await expect(page.getByText(/Contact HR or an organization administrator to complete the cancellation/)).toBeVisible();
  const adminContext = await browser.newContext(); const admin = await adminContext.newPage(); await setup(admin, 'admin'); await admin.goto(url);
  await admin.getByRole('button', { name: 'Retry cancellation', exact: true }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Retry cancellations', exact: true }).click();
  await expect(admin.getByRole('button', { name: 'Retry cancellation', exact: true })).toHaveCount(0);
  await admin.getByRole('button', { name: 'Manage appraisal', exact: true }).click();
  await expect(admin.getByRole('menuitem', { name: 'Cancel appraisal', exact: true })).toHaveCount(0);
  await admin.getByRole('menuitem', { name: 'Remove appraisal', exact: true }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Move to Removed', exact: true }).click();
  await expect(admin).toHaveURL(/\/appraisals\/removed$/);
  await admin.getByRole('textbox', { name: 'Search by employee or reviewer' }).fill('Morgan Reviewer');
  const card = admin.getByText('Preserved completed review', { exact: true }).locator('..').locator('..');
  await card.getByRole('button', { name: 'Restore appraisal', exact: true }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Restore to History', exact: true }).click();
  await expect(admin).toHaveURL(new RegExp(`/appraisals/${record._id}$`));
  const restored = await Appraisal.findById(record._id);
  expect(restored.status).toBe('employee_acknowledged');
  const restoredReport = (await (await fetch(`${apiURL}/api/appraisals/${record._id}/report`, { headers: { 'x-lifecycle-actor': 'reviewer' } })).json()).data;
  expect(restoredReport).toEqual(preserved);
  await admin.getByRole('button', { name: 'View result report', exact: true }).click();
  await expect(admin.getByRole('heading', { name: 'Appraisal result report', exact: true })).toBeVisible();
  await expect(admin.getByText('Original final decision.', { exact: true })).toBeVisible();
  await expect(admin.getByText('Original employee achievement.', { exact: true })).toBeVisible();
  await expect(admin.getByText('Original manager feedback.', { exact: true })).toBeVisible();
  await page.reload(); await page.getByRole('button', { name: 'View result report', exact: true }).click();
  await expect(page.getByText('Original final decision.', { exact: true })).toBeVisible();
  await admin.screenshot({ path: testInfo.outputPath('restored-completed-report.png'), fullPage: true, animations: 'disabled' });
  await adminContext.close();
});

test('a closed linked competency draft explains its read-only state without implying an active review', async ({ page }) => {
  await setup(page, 'employee');
  // UI contract for the server's closed-parent flag; real mutation denial is covered by backend lifecycle integration.
  await page.route('**/__mock-api/competency/assessments/closed-linked', route => route.fulfill({ json: { success: true, data: {
    id: 'closed-linked', revision: 2, status: 'in_progress', cycleId: 'cycle', cycleVersion: 1, appraisalId: 'closed-parent', linkedAppraisalReadOnly: true,
    participant: { userId: 'employee', name: 'Emery Employee' }, assessors: [{ userId: 'reviewer', name: 'Morgan Reviewer' }],
    definitionSnapshot: { role: { name: 'Delivery specialist', version: 1 }, selectedInputTypes: ['internal'], criteria: [{ id: 'delivery', name: 'Reliable delivery', sourceType: 'internal', sourceVersionId: 'framework-v1', levels: [{ id: 'independent', label: 'Independent' }], expectedLevel: { id: 'independent', label: 'Independent', description: 'Delivers agreed outcomes independently.' }, weight: 1 }], scoringConfig: { normalization: [], ratingScales: [] } },
    items: [], managerFeedback: [], evidence: [], oralSessions: [], aiSuggestions: [], resultVersions: [],
    allowedActions: ['competency.assessment.view', 'competency.evidence.view', 'competency.report.view'], createdAt: '2026-04-01T12:00:00Z', updatedAt: '2026-04-02T12:00:00Z',
  } } }));
  await page.goto('/competency/assessments/closed-linked');
  await expect(page.getByText('This competency assessment is read-only because its linked appraisal is closed. Saved role expectations and permitted evidence remain available.', { exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Evidence', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Save evidence', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Role expectations', exact: true }).click();
  await expect(page.getByText('This review is closed. Its saved role expectations are shown below.', { exact: true })).toBeVisible();
  await expect(page.getByText('Your assessor is reviewing the evidence. Reviewer findings remain private until a report is published.')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Finding status', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Completion & outcome', exact: true })).toHaveCount(0);
});
