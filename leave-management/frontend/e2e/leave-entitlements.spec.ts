import { expect, Page, Route, test } from '@playwright/test';

const organization = {
  id: 'org-1',
  name: 'Acme Limited',
  role: 'admin',
  appPermissions: { 'leave-management': ['*'] },
};
const user = {
  id: 'employee-1',
  sub: 'employee-1',
  name: 'Amina Bello',
  email: 'amina@example.com',
  organizations: [organization],
  currentOrganization: organization,
  teams: [],
};
const baseTypes = [
  { key: 'annual', name: 'Annual Leave', description: '', defaultDays: 20, paid: true, active: true, requiresApproval: null, order: 10 },
  { key: 'study', name: 'Study Leave', description: 'Time for approved study and examinations', defaultDays: 8, paid: true, active: true, requiresApproval: true, order: 20 },
];

function balance(total = 8) {
  return {
    _id: 'balance-1', userId: 'employee-1', userEmail: 'amina@example.com', userName: 'Amina Bello',
    organizationId: 'org-1', year: 2026, timezone: 'Europe/London', version: 2,
    entitlements: [{ leaveTypeKey: 'study', leaveTypeName: 'Study Leave', total, used: 1, pending: 0, remaining: total - 1, available: total - 1, policyDefault: 8, source: total === 8 ? 'policy' : 'override', active: true }],
  };
}

async function authenticate(page: Page) {
  await page.addInitScript(() => localStorage.setItem('accessToken', 'e2e-token'));
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

test('administrator creates an organization leave type', async ({ page }) => {
  await authenticate(page);
  const types = [...baseTypes];
  let createPayload: Record<string, unknown> | null = null;
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/auth/me')) return json(route, { user, currentOrganizationId: 'org-1' });
    if (path.endsWith('/leave-types') && request.method() === 'GET') return json(route, { leaveTypes: types });
    if (path.endsWith('/leave-types') && request.method() === 'POST') {
      createPayload = request.postDataJSON();
      types.push({ key: 'volunteer', name: String(createPayload?.name), description: '', defaultDays: Number(createPayload?.defaultDays), paid: true, active: true, requiresApproval: null, order: 30 });
      return json(route, { success: true, leaveType: types[types.length - 1] }, 201);
    }
    return json(route, {});
  });

  await page.goto('/admin?tab=leave-types');
  await expect(page.getByRole('heading', { name: 'Leave administration' })).toBeVisible();
  await page.getByRole('button', { name: 'Add leave type' }).click();
  await page.getByLabel('Name').fill('Volunteer Leave');
  await page.getByLabel('Default days per year').fill('3');
  await page.getByRole('button', { name: 'Save leave type' }).click();
  await expect(page.getByText('Volunteer Leave')).toBeVisible();
  expect(createPayload).toMatchObject({ name: 'Volunteer Leave', defaultDays: 3, paid: true });
});

test('administrator adds days to one employee with a required audit reason', async ({ page }) => {
  await authenticate(page);
  let adjustmentPayload: Record<string, unknown> | null = null;
  let currentBalance = balance();
  const adjustment = {
    _id: 'adjustment-1', organizationId: 'org-1', userId: 'employee-1', userName: 'Amina Bello', userEmail: 'amina@example.com', year: 2026,
    leaveTypeKey: 'study', leaveTypeName: 'Study Leave', previousTotal: 8, newTotal: 10, delta: 2,
    reason: 'Approved examination period', actorId: 'admin-1', actorName: 'HR Admin', createdAt: '2026-08-10T10:00:00.000Z',
  };
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/auth/me')) return json(route, { user, currentOrganizationId: 'org-1' });
    if (path.endsWith('/leave-balances/members')) return json(route, { members: [{ ...user, userId: user.id, role: 'staff', employeeId: 'EMP-001', teamIds: [], status: 'active', balance: currentBalance }], pagination: { page: 1, limit: 20, total: 1, pages: 1 } });
    if (path.endsWith('/leave-balances/user/employee-1/history')) return json(route, { member: user, adjustments: adjustmentPayload ? [adjustment] : [] });
    if (path.endsWith('/leave-balances/user/employee-1/entitlements/study') && request.method() === 'PATCH') {
      adjustmentPayload = request.postDataJSON();
      currentBalance = { ...balance(10), version: 3 };
      return json(route, { success: true, balance: currentBalance, adjustment });
    }
    return json(route, {});
  });

  await page.goto('/admin?tab=people');
  await page.getByRole('button', { name: 'Manage leave' }).click();
  await page.getByRole('button', { name: 'Adjust' }).click();
  await page.getByLabel('Days to add (use a negative number to remove)').fill('2');
  await page.getByLabel('Reason').fill('Approved examination period');
  await page.getByRole('button', { name: 'Save adjustment' }).click();
  await expect(page.getByText('Study Leave: 8 → 10 days')).toBeVisible();
  expect(adjustmentPayload).toMatchObject({ year: 2026, delta: 2, reason: 'Approved examination period', expectedVersion: 2 });
});

test('employee requests a newly configured leave type', async ({ page }) => {
  await authenticate(page);
  let requestPayload: Record<string, unknown> | null = null;
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/auth/me')) return json(route, { user: { ...user, organizations: [{ ...organization, role: 'staff', appPermissions: {} }], currentOrganization: { ...organization, role: 'staff', appPermissions: {} } }, currentOrganizationId: 'org-1' });
    if (path.endsWith('/leave-balances/me')) return json(route, { balance: balance() });
    if (path.endsWith('/leave-policies')) return json(route, { policy: { organizationId: 'org-1', timezone: 'Europe/London', leaveTypes: baseTypes } });
    if (path.endsWith('/leave-requests') && request.method() === 'POST') {
      requestPayload = request.postDataJSON();
      return json(route, { success: true, request: { _id: 'request-1', ...requestPayload } }, 201);
    }
    return json(route, {});
  });

  await page.goto('/leave-requests/new');
  await page.getByLabel('Leave type').selectOption('study');
  await page.getByLabel('Start date').fill('2026-09-14');
  await page.getByLabel('End date').fill('2026-09-15');
  await page.getByLabel('Reason (optional)').fill('Professional certification exams');
  await page.getByRole('button', { name: 'Submit request' }).click();
  await expect(page.getByRole('heading', { name: 'Leave request submitted' })).toBeVisible();
  expect(requestPayload).toMatchObject({ leaveType: 'study', startDate: '2026-09-14', endDate: '2026-09-15', reason: 'Professional certification exams' });
});

test('leave request page title remains readable in light mode', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('accessToken', 'e2e-token');
    localStorage.setItem('seemplify_theme', 'light');
  });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/auth/me')) return json(route, { user, currentOrganizationId: 'org-1' });
    if (path.endsWith('/leave-policies')) return json(route, { policy: { organizationId: 'org-1', timezone: 'Europe/London', leaveTypes: baseTypes } });
    if (path.endsWith('/leave-requests') && request.method() === 'GET') {
      return json(route, { requests: [], pagination: { page: 1, limit: 10, total: 0, pages: 1 } });
    }
    return json(route, {});
  });

  await page.goto('/leave-requests');
  await expect(page.locator('html')).toHaveClass(/light/);
  const heading = page.getByRole('heading', { name: 'My Leave Requests' });
  await expect(heading).toBeVisible();

  const appearance = await heading.evaluate((element) => {
    const parseRgb = (value: string) => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const luminance = (rgb: number[]) => rgb.map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    }).reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const titleColor = getComputedStyle(element).color;
    const surface = element.closest('.bg-card') || element.parentElement || document.body;
    const surfaceColor = getComputedStyle(surface).backgroundColor;
    const foreground = luminance(parseRgb(titleColor));
    const background = luminance(parseRgb(surfaceColor));
    return {
      titleColor,
      contrast: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
    };
  });

  expect(appearance.titleColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(appearance.contrast).toBeGreaterThanOrEqual(4.5);
});
