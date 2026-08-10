import { expect, Page, Route, test } from '@playwright/test';

const adminOrganization = {
  id: 'org-1', name: 'Acme Limited', role: 'admin', appPermissions: { 'leave-management': ['*'] },
};
const admin = {
  id: 'admin-1', name: 'HR Admin', email: 'hr@example.com', organizations: [adminOrganization], currentOrganization: adminOrganization, teams: [],
};
const employeeOrganization = { ...adminOrganization, role: 'staff', appPermissions: { 'leave-management': ['request_leaves'] } };
const employee = {
  id: 'employee-1', name: 'Amina Bello', email: 'amina@example.com', organizations: [employeeOrganization], currentOrganization: employeeOrganization, teams: [],
};
const ownRequest = {
  _id: 'request-1', userId: 'employee-1', userName: 'Amina Bello', userEmail: 'amina@example.com', organizationId: 'org-1', organizationName: 'Acme Limited',
  teamId: 'team-a', teamIds: ['team-a'], teamName: 'Operations', leaveType: 'annual', leaveTypeName: 'Annual Leave', startDate: '2026-08-10T00:00:00.000Z', endDate: '2026-08-12T00:00:00.000Z', numberOfDays: 3, timezone: 'Europe/London', status: 'approved', auditLog: [], createdAt: '2026-07-20T00:00:00.000Z', updatedAt: '2026-07-20T00:00:00.000Z',
};
const otherRequest = {
  ...ownRequest, _id: 'request-2', userId: 'employee-2', userName: 'Chidi Okafor', userEmail: 'chidi@example.com', status: 'pending', startDate: '2026-08-11T00:00:00.000Z', endDate: '2026-08-11T00:00:00.000Z', numberOfDays: 1,
};

async function authenticate(page: Page) {
  await page.addInitScript(() => localStorage.setItem('accessToken', 'e2e-token'));
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

test('personal calendar shows only the signed-in employee requests', async ({ page }) => {
  await authenticate(page);
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/me')) return json(route, { user: employee, currentOrganizationId: 'org-1' });
    if (path.endsWith('/leave-requests/calendar')) return json(route, { requests: [ownRequest] });
    if (path.endsWith('/leave-policies/holidays')) return json(route, { holidays: [] });
    return json(route, {});
  });

  await page.goto('/calendar');
  await expect(page.getByRole('heading', { name: 'My leave calendar' })).toBeVisible();
  await expect(page.getByText('Other employees’ requests are not shown here.')).toBeVisible();
  await expect(page.getByText('Annual Leave').first()).toBeVisible();
  await expect(page.getByText('Chidi Okafor')).toHaveCount(0);
});

test('admin workforce calendar shows organization percentages and team coverage', async ({ page }) => {
  await authenticate(page);
  const dailyCoverage = [
    { date: '2026-08-10', approvedAway: 1, pendingAway: 0, approvedAwayPercent: 25 },
    { date: '2026-08-11', approvedAway: 1, pendingAway: 1, approvedAwayPercent: 25 },
  ];
  const summary = {
    totalWorkforce: 4, peopleOnApprovedLeave: 1, workforcePercentOnLeaveInPeriod: 25,
    approvedRequests: 1, pendingRequests: 1, peakAwayCount: 1, peakAwayPercent: 25, peakDate: '2026-08-10',
  };
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/me')) return json(route, { user: admin, currentOrganizationId: 'org-1' });
    if (path.endsWith('/leave-requests/calendar/organization')) return json(route, {
      requests: [ownRequest, otherRequest], summary, dailyCoverage,
      teamCoverage: [{ teamId: 'team-a', teamName: 'Operations', ...summary, totalWorkforce: 2, workforcePercentOnLeaveInPeriod: 50, peakAwayPercent: 50, dailyCoverage: dailyCoverage.map((day) => ({ ...day, approvedAwayPercent: 50 })) }],
    });
    if (path.endsWith('/leave-policies/holidays')) return json(route, { holidays: [] });
    return json(route, {});
  });

  await page.goto('/admin?tab=calendar');
  await expect(page.getByRole('heading', { name: 'Workforce calendar' })).toBeVisible();
  await expect(page.getByText('Active workforce').locator('..').getByText('4')).toBeVisible();
  await expect(page.getByText('1 (25%)').first()).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Operations' })).toBeVisible();
  await page.getByRole('combobox').selectOption('team-a');
  await expect(page.getByText('2', { exact: true }).first()).toBeVisible();
});
