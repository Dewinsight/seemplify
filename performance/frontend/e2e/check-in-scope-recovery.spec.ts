import { expect, test } from '@playwright/test';

test('named employee selection keeps a denied check-in load distinct from an empty list and retries the same person', async ({ page }, info) => {
  const organization = { id: 'check-in-recovery-org', name: 'Synthetic hierarchy', role: 'staff' };
  const user = { id: 'parent-manager', sub: 'parent-manager', name: 'Synthetic Parent', email: 'parent@example.test', organizations: [organization] };
  let denied = true;
  const selectedReads: string[] = [];
  await page.addInitScript(() => localStorage.setItem('accessToken', 'synthetic-check-in-recovery'));
  await page.route('**/__mock-api/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname.replace('/__mock-api', '');
    if (path === '/auth/me') return route.fulfill({ json: { success: true, user, currentOrganization: organization, currentOrganizationId: organization.id } });
    let data: unknown = [];
    if (path === '/user/context') data = { user, organization, role: { name: 'line_manager', isManager: true, isHRAdmin: false }, teams: [], features: {}, stats: {} };
    if (path === '/user/current-team') data = { currentTeam: null, availableTeams: [] };
    if (path === '/competency/bootstrap') data = { enabled: false, capabilities: {}, people: [], settings: {} };
    if (path === '/user/my-team-members') data = { directReports: [{ userId: 'child-lead', name: 'Synthetic Child Lead' }] };
    if (path === '/check-ins') {
      const employee = url.searchParams.get('employeeId') || '';
      selectedReads.push(employee);
      if (employee === 'child-lead') {
        if (denied) return route.fulfill({ status: 403, json: { error: 'Synthetic scoped access unavailable' } });
        data = [{ _id: 'synthetic-check-in', employeeId: 'child-lead', cadence: 'weekly', periodStart: '2026-10-01', periodEnd: '2026-10-07', wins: ['Restored shared child-team check-in'], visibility: 'employee_manager', status: 'submitted' }];
      }
    }
    return route.fulfill({ json: { success: true, data } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/check-ins');
  const employee = page.getByRole('combobox', { name: /^Employee/ });
  await employee.click(); await page.getByRole('option', { name: 'Synthetic Child Lead', exact: true }).click();
  await expect(page.getByRole('listbox')).toBeHidden();
  await expect(page.getByRole('alert').filter({ hasText: 'Synthetic scoped access unavailable' })).toBeVisible();
  await expect(page.getByText('No check-ins yet', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('check-in-access-retry-mobile.png'), fullPage: true, animations: 'disabled' });
  denied = false;
  await page.getByRole('button', { name: 'Retry check-ins', exact: true }).click();
  await expect(page.getByText('Restored shared child-team check-in', { exact: true })).toBeVisible();
  await expect(page.getByText('Synthetic scoped access unavailable', { exact: true })).toHaveCount(0);
  await expect(employee).toContainText('Synthetic Child Lead');
  expect(selectedReads.slice(-2)).toEqual(['child-lead', 'child-lead']);
  await expect(page.getByRole('button', { name: 'Respond', exact: true })).toBeVisible();
});
