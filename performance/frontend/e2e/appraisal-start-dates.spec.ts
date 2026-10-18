import { expect, test, type Page } from '@playwright/test';

test.use({ locale: 'en-GB' });

async function install(page: Page, existingCycle = false) {
  const posts: Record<string, unknown>[] = [];
  await page.clock.setFixedTime(new Date('2026-10-17T12:00:00Z'));
  await page.addInitScript(() => {
    localStorage.setItem('accessToken', 'appraisal-date-qa');
    localStorage.setItem('performance-workspace:org-1:manager-1', 'manager');
    localStorage.setItem('seemplify_theme', 'dark');
    document.cookie = 'seemplify_theme=dark; Path=/';
  });
  await page.route('**/__mock-api/**', async route => {
    const path = new URL(route.request().url()).pathname.slice('/__mock-api'.length);
    const data = (value: unknown) => ({ success: true, data: value });
    let response: unknown = data([]);
    const manager = { id: 'manager-1', sub: 'manager-1', name: 'Alex Morgan', email: 'alex@example.test' };
    const teams = [{ id: 'team-1', name: 'Product', organizationId: 'org-1', role: 'line_manager', isManager: true }];
    if (path === '/auth/me') response = { success: true, user: { ...manager, idpOrganizations: [{ id: 'org-1', name: 'QA Product', role: 'employee' }], organizations: [{ id: 'org-1', name: 'QA Product', role: 'employee' }] }, currentOrganizationId: 'org-1', currentOrganization: { id: 'org-1', name: 'QA Product' } };
    else if (path === '/user/context') response = data({ user: manager, role: { name: 'line_manager', displayName: 'Line Manager', isManager: true, isTeamLead: true, isHRAdmin: false }, organization: { id: 'org-1', name: 'QA Product' }, teams, currentTeam: teams[0], managerData: { directReportCount: 1 }, features: { canonicalAppraisals: true }, stats: {} });
    else if (path === '/user/current-team') response = data({ currentTeam: teams[0], availableTeams: teams });
    else if (path === '/appraisals/colleague-roster') response = data({ employees: [{ userId: 'employee-1', name: 'Jordan Lee', email: 'jordan@example.test', managerName: 'Alex Morgan', isSelectableForAppraisal: true }] });
    else if (path === '/appraisals/cycle-templates') response = data([{ id: 'balanced_performance', name: 'Balanced performance review', version: 1, description: 'Review completed work and plan development.', design: { version: 1, sections: [] } }]);
    else if (path === '/appraisals/cycles' && route.request().method() === 'GET') response = data(existingCycle ? [{ _id: 'existing-cycle', name: 'Completed quarter', status: 'active', periodStart: '2026-07-01', periodEnd: '2026-09-30', responseDeadlines: { selfAssessmentDue: '2026-10-24', managerReviewDue: '2026-10-31' } }] : []);
    else if (route.request().method() === 'POST' && path.startsWith('/appraisals/cycles')) {
      posts.push({ path, ...route.request().postDataJSON() });
      response = data({ launchSummary: { launched: 1, replayed: 0, errors: 0 } });
    } else if (path === '/notifications/count') response = data({ unread: 0, actionable: 0 });
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) });
  });
  await page.goto('/appraisals/start?employeeId=employee-1');
  await expect(page.getByRole('checkbox', { name: /Jordan Lee/ })).toBeChecked();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review details', exact: true })).toBeVisible();
  return posts;
}

test('explains future assessment dates, focuses the error, and recovers without moving deadlines', async ({ page }, testInfo) => {
  const posts = await install(page);
  const end = page.getByLabel('Assessment period ends', { exact: false });
  await expect(page.getByText('This review starts today, 17 Oct 2026.')).toBeVisible();
  await expect(end).toHaveAttribute('max', '2026-10-16');
  await page.getByLabel('Assessment period starts', { exact: false }).fill('2026-10-10');
  await end.fill('2026-11-24');
  await expect(end).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Choose 16 Oct 2026 or earlier. The work period must finish before this review starts today.')).toBeVisible();
  await expect(page.getByText('Need to assess work that ends in the future? Start the review after that work period has ended.')).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(end).toBeFocused();
  expect(posts).toHaveLength(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('appraisal-date-guidance-error.png'), fullPage: true });
  await page.getByRole('button', { name: /Set assessment end to yesterday/ }).click();
  await expect(end).toHaveValue('2026-10-16');
  await expect(end).toHaveAttribute('aria-invalid', 'false');
  await expect(page.getByLabel('Employee response due', { exact: false })).toHaveValue('2026-10-24');
  await expect(page.getByLabel('Reviewer response due', { exact: false })).toHaveValue('2026-10-31');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('appraisal-date-guidance-fixed.png'), fullPage: true });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Review starts: 17 Oct 2026 (today)')).toBeVisible();
  await page.getByRole('button', { name: 'Start appraisals', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Appraisal launch results' })).toBeVisible();
  expect(posts[0]).toMatchObject({ periodStart: '2026-10-10', periodEnd: '2026-10-16', launchNow: true, responseDeadlines: { selfAssessmentDue: '2026-10-24T23:59:59.000Z', managerReviewDue: '2026-10-31T23:59:59.000Z' } });
});

test('guides empty and reversed dates and deadline order on mobile', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const posts = await install(page);
  const start = page.getByLabel('Assessment period starts', { exact: false });
  const end = page.getByLabel('Assessment period ends', { exact: false });
  const employee = page.getByLabel('Employee response due', { exact: false });
  const manager = page.getByLabel('Reviewer response due', { exact: false });
  await start.fill('2026-10-17');
  await expect(start).toHaveAttribute('aria-invalid', 'true');
  await start.fill('2026-10-10'); await end.fill('2026-10-09');
  await expect(page.getByText('Choose an end date on or after the assessment start date.')).toBeVisible();
  await end.fill('2026-10-16'); await employee.clear();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(employee).toBeFocused();
  await expect(page.getByText('Choose an employee response deadline.')).toBeVisible();
  await employee.fill('2026-10-16');
  await expect(page.getByText('Choose 17 Oct 2026 or later so employees have time to respond.')).toBeVisible();
  await employee.fill('2026-10-24'); await manager.fill('2026-10-24');
  await expect(manager).toHaveAttribute('min', '2026-10-25');
  await expect(page.getByText('Choose a date after 24 Oct 2026. Employees respond before you complete your review.')).toBeVisible();
  await manager.fill('2026-10-31');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('appraisal-dates-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Confirm and start' })).toBeVisible();
  expect(posts).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('retains the existing cycle launch flow', async ({ page }) => {
  const posts = await install(page, true);
  await expect(page.getByText('Completed quarter', { exact: true }).last()).toBeVisible();
  await expect(page.getByLabel('Assessment period ends', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Start appraisals', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Appraisal launch results' })).toBeVisible();
  expect(posts).toEqual([{ path: '/appraisals/cycles/existing-cycle/launch', reviewerMode: 'initiator', employees: [{ userId: 'employee-1' }], responseDeadlines: { selfAssessmentDue: '2026-10-24T23:59:59.000Z', managerReviewDue: '2026-10-31T23:59:59.000Z' } }]);
});
