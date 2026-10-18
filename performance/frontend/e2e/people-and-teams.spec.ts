import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page, admin: boolean) {
  const user = { id: 'owner', sub: 'owner', email: 'owner@example.test', name: 'Owner' };
  const organization = { id: 'org', name: 'Team QA', role: admin ? 'owner' : 'employee' };
  const membership = { id: 'product', name: 'Delivery', organizationId: 'org', role: 'line_manager', isManager: true };
  const members = [
    { userId: 'one', name: 'Product Person', email: 'one@example.test', teamId: 'product', teamIds: ['product'], teamName: 'Delivery' },
    { userId: 'two', name: 'Operations Person', email: 'two@example.test', teamId: 'operations', teamIds: ['operations'], teamName: 'Delivery' },
    { userId: 'shared', name: 'Shared Person', email: 'shared@example.test', teamId: 'product', teamIds: ['product','operations'], teamName: 'Delivery' },
  ];
  await page.addInitScript(({ user, organization, admin }) => {
    localStorage.setItem('accessToken', 'isolated-team-filter-test');
    const key = `performance-workspace:${organization.id}:${user.id}`;
    if (!localStorage.getItem(key)) localStorage.setItem(key, admin ? 'admin' : 'manager');
  }, { user, organization, admin });
  const scopes: string[] = [];
  await page.route('**/__mock-api/**', async route => {
    const url = new URL(route.request().url()); const path = url.pathname.replace('/__mock-api','');
    let response: unknown = { success: true, data: [] };
    if (path === '/auth/me') response = { success: true, user: { ...user, organizations: [organization] }, currentOrganization: organization, currentOrganizationId: organization.id };
    if (path === '/user/context') response = { success: true, data: { user, organization, role: { name: admin ? 'hr_admin' : 'line_manager', isHRAdmin: admin, isManager: true }, teams: [membership], features: {}, stats: {} } };
    if (path === '/user/current-team') response = { success: true, data: { currentTeam: membership, availableTeams: [membership] } };
    if (path === '/user/my-team-members') {
      scopes.push(url.searchParams.get('scope') || '');
      const all = url.searchParams.get('scope') === 'organization';
      response = { success: true, data: { isManager: true, directReports: all ? members : members.filter(person => person.teamIds.includes('product')),
        teams: all ? [{ id:'product', name:'Delivery' }, { id:'operations', name:'Delivery' }, { id:'empty', name:'Empty team' }] : [{ id:'product', name:'Delivery' }] } };
    }
    if (/\/user\/[^/]+\/stats$/.test(path)) response = { success: true, data: { okrProgress: path.includes('/one/') ? 100 : path.includes('/shared/') ? 50 : 0, pendingAppraisals: 0, feedbackCount: 0, last1on1Date: new Date().toISOString() } };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) });
  });
  return scopes;
}

test('Admin uses the complete team directory and filters by IDs even when team names match', async ({ page }) => {
  const scopes = await setup(page, true); await page.goto('/team');
  await expect(page.getByRole('heading', { name:'People & teams', exact:true })).toBeVisible();
  await expect(page.getByText('Organization-wide access · 3 teams · 3 people')).toBeVisible();
  const filter = page.getByRole('combobox', { name:'Filter by team', exact:true });
  await filter.selectOption('product');
  await expect(page.getByRole('heading', { name:'Product Person', exact:true })).toBeVisible();
  await expect(page.getByRole('heading', { name:'Operations Person', exact:true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name:'Shared Person', exact:true })).toBeVisible();
  await expect(page.getByLabel('Team summary').getByText('75%', { exact:true })).toBeVisible();
  await filter.selectOption('operations');
  await expect(page.getByRole('heading', { name:'Operations Person', exact:true })).toBeVisible();
  await expect(page.getByRole('heading', { name:'Product Person', exact:true })).toHaveCount(0);
  await expect(page.getByLabel('Team summary').getByText('25%', { exact:true })).toBeVisible();
  await filter.selectOption('empty'); await expect(page.getByRole('heading', { level:3 })).toHaveCount(0);
  expect(scopes).toContain('organization');
  await page.getByRole('button', { name:'Admin', exact:true }).click();
  await page.getByRole('menuitemradio', { name:/^Manager/ }).click(); await page.goto('/team');
  await expect(page.getByRole('heading', { name:'My teams', exact:true })).toBeVisible();
  await expect(page.getByRole('combobox', { name:'Filter by team' })).toHaveValue('all');
  await expect(page.getByRole('heading', { name:'Operations Person', exact:true })).toHaveCount(0);
  expect(scopes).toContain('managed');
});

test('Manager view explains its scope and keeps the team filter available for a single team', async ({ page }) => {
  const scopes = await setup(page, false); await page.setViewportSize({ width:390, height:844 }); await page.goto('/team');
  await expect(page.getByRole('heading', { name:'My teams', exact:true })).toBeVisible();
  await expect(page.getByText('Your managed team hierarchy · 1 team · 2 people')).toBeVisible();
  await expect(page.getByRole('combobox', { name:'Filter by team' })).toBeVisible();
  await expect(page.getByRole('heading', { name:'Operations Person', exact:true })).toHaveCount(0);
  expect(scopes).toContain('managed'); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
