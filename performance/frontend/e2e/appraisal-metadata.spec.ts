import { expect, test, type Page } from '@playwright/test';

const makeReview = (id: string, title: string, createdAt?: string) => ({
  _id: id, status: 'self_assessment_pending', createdAt, updatedAt: createdAt,
  employee: { userId: 'employee', name: 'Taylor Employee', email: 'employee@example.test' },
  manager: { userId: 'reviewer', name: 'Robin Reviewer', email: 'reviewer@example.test' },
  cycleId: { _id: 'cycle', name: title, periodStart: '2026-07-01', periodEnd: '2026-09-30' },
  launchContext: createdAt ? { method: 'existing_cycle', createdBy: { userId: 'hr', name: 'Harper HR' } } : undefined,
  deadlines: createdAt ? { selfAssessmentDue: '2026-10-24T23:59:59Z', managerReviewDue: '2026-10-31T23:59:59Z' } : {},
});
const older = makeReview('older', 'Earlier review', '2026-10-01T09:15:00Z');
const latest = makeReview('latest', 'Latest review', '2026-10-18T14:30:00Z');
const legacy = { ...makeReview('legacy', 'Legacy review'), employee: undefined };
const finished = { ...makeReview('finished', 'Completed review', '2026-10-12T10:00:00Z'), status: 'completed', finalRating: { overall: 4, finalizedAt: '2026-10-17T13:00:00Z' }, discussion: { scheduledDate: '2026-10-16T12:00:00Z', employeeAcknowledgedAt: '2026-10-18T09:00:00Z' }, calibration: { calibratedAt: '2026-10-17T12:00:00Z' }, deadlines: { discussionDue: '2026-10-16', signOffDue: '2026-10-18' } };
const pastLegacy = { ...makeReview('past-legacy', 'Earlier completed review'), status: 'completed', auditLog: [{ action: 'appraisal_created', performedBy: { name: 'Original HR' }, timestamp: '2026-10-03T10:00:00Z' }] };

async function setup(page: Page, mode: 'employee' | 'reviewer' | 'hr') {
  const user = { id: mode === 'employee' ? 'employee' : mode, sub: mode, email: `${mode}@example.test`, name: mode };
  const organization = { id: 'metadata-org', name: 'Metadata QA', role: mode === 'hr' ? 'hr_manager' : 'staff' };
  await page.addInitScript(({ user, organization, mode }) => {
    localStorage.setItem('accessToken', 'isolated-metadata-test');
    localStorage.setItem(`performance-workspace:${organization.id}:${user.id}`, mode === 'employee' ? 'personal' : mode === 'hr' ? 'admin' : 'manager');
  }, { user, organization, mode });
  await page.route('**/__mock-api/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/__mock-api', '');
    let response: unknown = { success: true, data: [] };
    if (path === '/auth/me') response = { success: true, user: { ...user, organizations: [organization] }, currentOrganization: organization, currentOrganizationId: organization.id };
    if (path === '/user/context') response = { success: true, data: { user, organization, role: { name: mode === 'hr' ? 'hr_admin' : mode === 'reviewer' ? 'line_manager' : 'employee', isManager: mode !== 'employee', isHRAdmin: mode === 'hr' }, teams: [], features: {}, stats: {} } };
    if (['/appraisals/my','/appraisals/team','/appraisals/organization','/appraisals/assigned-reviews'].includes(path)) response = { success: true, data: [older, legacy, latest, pastLegacy, finished] };
    if (path === '/appraisals/latest') response = { success: true, data: latest, okrs: [] };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) });
  });
}

for (const mode of ['employee', 'reviewer', 'hr'] as const) test(`${mode} can identify newest appraisals, creator and deadlines`, async ({ page }, testInfo) => {
  if (mode === 'hr') await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, mode);
  await page.goto(mode === 'reviewer' ? '/appraisals?section=conducting' : '/appraisals');
  const cards = page.getByRole('article');
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toHaveAccessibleName('Latest review — Taylor Employee');
  await expect(cards.nth(1)).toHaveAccessibleName('Earlier review — Taylor Employee');
  await expect(cards.nth(2)).toHaveAccessibleName('Legacy review — Employee not recorded');
  await expect(cards.first().getByText('Newest active appraisal')).toBeVisible();
  await expect(cards.first().getByText('Harper HR', { exact: true })).toBeVisible();
  await expect(cards.first().getByText('Existing review cycle')).toBeVisible();
  for (const label of ['Created', 'Created by', 'Assessment period', 'Employee response due', 'Reviewer response due', 'Last updated']) await expect(cards.first().getByText(label, { exact: true })).toBeVisible();
  await expect(cards.last().getByText('Not recorded', { exact: true }).first()).toBeVisible();
  await expect(cards.last().getByText('Not set', { exact: true })).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`${mode}-appraisal-dates.png`), fullPage: true });
  await page.goto('/appraisals?section=history');
  await expect(page.getByText('Completed review', { exact: true })).toBeVisible();
  await expect(page.getByText('Finalized', { exact: true })).toBeVisible();
  await expect(page.getByText('Employee acknowledged', { exact: true })).toBeVisible();
  for (const label of ['Discussion due', 'Sign-off due', 'Discussion scheduled', 'Calibration completed']) await expect(page.getByText(label, { exact: true })).toBeVisible();
  const results = page.locator('.result-row');
  await expect(results.first().getByText('Completed review', { exact: true })).toBeVisible();
  await expect(results.last().getByText('Original HR', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Sort results' }).click();
  await page.getByRole('option', { name: 'Oldest first' }).click();
  await expect(results.first().getByText('Earlier completed review', { exact: true })).toBeVisible();
  if (mode === 'employee') {
    await page.goto('/appraisals/latest');
    await expect(page.getByText('Appraisal details & dates', { exact: true })).toBeVisible();
    await expect(page.getByText('Harper HR', { exact: true })).toBeVisible();
  }
});
