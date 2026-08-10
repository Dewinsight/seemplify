import { expect, Page, Route, test } from '@playwright/test';

const organization = {
  id: 'org-1',
  name: 'Acme Limited',
  role: 'admin',
  appPermissions: { 'leave-management': ['*'] },
};

const admin = {
  id: 'admin-1',
  name: 'HR Admin',
  email: 'hr@example.com',
  organizations: [organization],
  currentOrganization: organization,
  teams: [],
};

const pendingRequest = {
  _id: 'request-1',
  userId: 'employee-1',
  userName: 'Michael Tony Egbo',
  userEmail: 'michael@example.com',
  organizationId: 'org-1',
  organizationName: 'Acme Limited',
  teamId: 'team-1',
  teamName: 'JOEVEES',
  leaveType: 'personal',
  leaveTypeName: 'Personal Leave',
  startDate: '2026-12-12T00:00:00.000Z',
  endDate: '2026-12-12T00:00:00.000Z',
  numberOfDays: 1,
  timezone: 'Europe/London',
  status: 'pending',
  assignedApprover: {
    userId: 'organization-approver',
    userName: 'Organization approver',
    assignedAt: '2026-08-10T07:09:00.000Z',
    assignmentType: 'organization',
  },
  auditLog: [{
    action: 'created',
    performedBy: 'employee-1',
    performedByName: 'Michael Tony Egbo',
    performedAt: '2026-08-10T07:09:00.000Z',
  }],
  createdAt: '2026-08-10T07:09:00.000Z',
  updatedAt: '2026-08-10T07:09:00.000Z',
};

async function authenticate(page: Page) {
  await page.addInitScript(() => localStorage.setItem('accessToken', 'e2e-token'));
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

test('eligible administrator approves from the request detail page', async ({ page }) => {
  await authenticate(page);
  let approveCalled = false;

  await page.route('**/api/**', async (route) => {
    const apiRequest = route.request();
    const path = new URL(apiRequest.url()).pathname;
    if (path.endsWith('/auth/me')) return json(route, { user: admin, currentOrganizationId: 'org-1' });
    if (path.endsWith('/leave-requests/request-1') && apiRequest.method() === 'GET') {
      return json(route, {
        request: pendingRequest,
        permissions: { canApprove: true, canReject: true },
      });
    }
    if (path.endsWith('/leave-requests/request-1/approve') && apiRequest.method() === 'POST') {
      approveCalled = true;
      return json(route, {
        success: true,
        request: {
          ...pendingRequest,
          status: 'approved',
          approvedBy: {
            userId: admin.id,
            userName: admin.name,
            approvedAt: '2026-08-10T08:00:00.000Z',
            approvalType: 'organization_role',
          },
        },
      });
    }
    return json(route, {});
  });

  await page.goto('/leave-requests/request-1');
  await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reject' })).toBeVisible();
  await page.getByRole('button', { name: 'Approve' }).click();

  await expect(page.getByText('Approved', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  expect(approveCalled).toBe(true);
});
