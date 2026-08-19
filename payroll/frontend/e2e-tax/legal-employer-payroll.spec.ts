import { expect, test } from '@playwright/test';

const mockApi = 'http://127.0.0.1:5006/api';

async function signIn(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    localStorage.setItem('accessToken', 'synthetic-e2e-token');
    localStorage.setItem('payroll:viewMode', 'admin');
  });
}

async function dismissPageGuide(page: import('@playwright/test').Page) {
  const close = page.getByRole('button', { name: 'Close page guide' });
  try {
    await close.waitFor({ state: 'visible', timeout: 2_000 });
    await close.click();
  } catch {
    // Some routes do not have a guide. Its absence is not an E2E failure.
  }
}

async function requests(request: import('@playwright/test').APIRequestContext) {
  const response = await request.get(`${mockApi}/__e2e__/requests`);
  return (await response.json()).requests as Array<{ method: string; path: string; body: any }>;
}

function employeeCard(page: import('@playwright/test').Page, name: string) {
  return page.locator('div.group').filter({ has: page.getByRole('heading', { name }) });
}

test.beforeEach(async ({ page, request }) => {
  await request.delete(`${mockApi}/__e2e__/requests`);
  await signIn(page);
});

test('separates Nigerian company and UK subsidiary tax presence', async ({ page }, testInfo) => {
  await page.goto('/admin/settings/employer-entities');
  await dismissPageGuide(page);

  await expect(page.getByRole('heading', { name: 'Employer setup' })).toBeVisible();
  await expect(page.getByText('Seemplify Nigeria Limited (synthetic)')).toBeVisible();
  await expect(page.getByText('Seemplify UK Subsidiary Limited (synthetic)')).toBeVisible();
  await expect(page.getByText('NG-LA', { exact: true })).toBeVisible();
  await expect(page.getByText('GB', { exact: true })).toBeVisible();
  await expect(page.getByText('preview only', { exact: true })).toHaveCount(2);

  await page.screenshot({
    path: `reports/tax-legal-employers-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

test('creates a blocked legal-employer draft without self-certifying it', async ({ page, request }) => {
  await page.goto('/admin/settings/employer-entities');
  await dismissPageGuide(page);
  await page.getByRole('button', { name: 'Add employer' }).click();
  await page.getByLabel('Internal reference').fill('NG-BRANCH');
  await page.getByLabel('Registered legal name').fill('Synthetic Nigeria Branch Limited');
  await page.getByLabel('Tax authority').fill('LIRS');
  await page.getByLabel('Registration reference').fill('SYN-REG-001');
  await page.getByLabel('Evidence reference').fill('SYN-EVIDENCE-001');
  await page.getByRole('button', { name: 'Save employer setup' }).click();

  await expect(page.getByText('Synthetic Nigeria Branch Limited')).toBeVisible();
  await expect(page.getByText('blocked', { exact: true })).toBeVisible();

  const logged = await requests(request);
  const create = logged.find((entry) => entry.method === 'POST' && entry.path === '/payroll/employer-entities');
  expect(create?.body).toMatchObject({
    code: 'NG-BRANCH',
    countryCode: 'NG',
    jurisdictionCode: 'NG-LA',
    defaultCurrency: 'NGN',
    status: 'draft',
    taxAdapterCandidateId: 'NG_2026_WAVE_1',
  });
});

test('assigns employees to the correct legal employer and jurisdiction', async ({ page, request }) => {
  await page.goto('/admin/employees/employee-uk');
  await dismissPageGuide(page);
  await expect(page.getByText('Ben United Kingdom (synthetic)')).toBeVisible();

  await page.getByLabel('Legal employer').selectOption('entity-uk');
  await page.getByLabel('Determination evidence reference').fill('SYN-UK-CONTRACT-REVIEW-002');
  await page.getByLabel('Why this tax jurisdiction applies').fill('Works for and is paid by the UK subsidiary under UK PAYE.');

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Save Changes' }).click();

  await expect.poll(async () => {
    const logged = await requests(request);
    return logged.find((entry) => entry.method === 'PUT' && entry.path === '/payroll/profiles/employee-uk')?.body;
  }).toMatchObject({
    employerEntityId: 'entity-uk',
    currency: 'GBP',
    taxAssignment: {
      workCountryCode: 'GB',
      workJurisdictionCode: 'GB',
      taxJurisdictionCode: 'GB',
      evidenceReference: 'SYN-UK-CONTRACT-REVIEW-002',
    },
  });
});

test('persists next-run exclusion and re-includes a payroll-ready onboarded employee', async ({ page, request }) => {
  await page.goto('/admin/employees');
  await dismissPageGuide(page);

  const card = employeeCard(page, 'Ada Nigeria (synthetic)');
  const exclusion = card.getByRole('checkbox', { name: /Exclude from payroll run/i });
  await expect(exclusion).not.toBeChecked();
  await expect(card.getByText('This employee is included in the next payroll run.')).toBeVisible();

  await exclusion.check();
  await expect(exclusion).toBeChecked();
  await expect.poll(async () => {
    const logged = await requests(request);
    return logged.filter((entry) => entry.method === 'PUT' && entry.path === '/payroll/profiles/user-ng').at(-1)?.body;
  }).toMatchObject({
    payrollFlags: {
      includeInNextRun: false,
      excludeFromNextRun: true,
    },
  });

  await exclusion.uncheck();
  await expect(exclusion).not.toBeChecked();
  await expect(card.getByText('This employee is included in the next payroll run.')).toBeVisible();
  await expect.poll(async () => {
    const logged = await requests(request);
    return logged.filter((entry) => entry.method === 'PUT' && entry.path === '/payroll/profiles/user-ng').at(-1)?.body;
  }).toMatchObject({
    payrollFlags: {
      includeInNextRun: true,
      excludeFromNextRun: false,
    },
  });
});

test('configures an existing IDP member manually without creating a second employee', async ({ page, request }) => {
  await page.goto('/admin/employees');
  await dismissPageGuide(page);

  const card = employeeCard(page, 'Chidi Existing IDP Member (synthetic)');
  await expect(card).toBeVisible();
  await expect(card.getByRole('button', { name: 'Resolve Onboarding' })).toBeVisible();
  await card.getByRole('button', { name: 'Resolve Onboarding' }).click();

  const dialog = page.getByRole('dialog', { name: 'Chidi Existing IDP Member (synthetic)' });
  await expect(dialog.getByRole('button', { name: 'Request Details' })).toBeVisible();
  const enterManually = dialog.getByRole('link', { name: 'Enter Manually' });
  await expect(enterManually).toHaveAttribute('href', '/admin/employees/configure/user-unconfigured');

  await enterManually.click();
  await expect(page).toHaveURL(/\/admin\/employees\/user-unconfigured$/);
  await dismissPageGuide(page);
  await expect(page.getByText('Chidi Existing IDP Member (synthetic)')).toBeVisible();

  const logged = await requests(request);
  expect(logged).toContainEqual(expect.objectContaining({
    method: 'POST',
    path: '/payroll/profiles/sync-from-idp',
    body: { userId: 'user-unconfigured' },
  }));
  expect(logged.some((entry) => entry.method === 'POST' && entry.path === '/payroll/profiles')).toBe(false);
});

test('starts required onboarding in Recruiter or allows the same member to be entered manually', async ({ page, request }) => {
  const browserErrors: string[] = [];
  const serverErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`);
  });

  await page.goto('/admin/employees');
  await dismissPageGuide(page);

  const card = employeeCard(page, 'Dayo New Hire (synthetic)');
  await expect(card).toBeVisible();
  await expect(card.getByText('Not Started', { exact: true }).first()).toBeVisible();
  await card.getByRole('button', { name: 'Resolve Onboarding' }).click();

  const dialog = page.getByRole('dialog', { name: 'Dayo New Hire (synthetic)' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Request Details' })).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Enter Manually' }))
    .toHaveAttribute('href', '/admin/employees/configure/user-onboarding-new');
  await expect(page.getByText('Mark Onboarded', { exact: true })).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Request Details' }).click();
  await expect(dialog).toBeHidden();

  await expect.poll(async () => {
    const logged = await requests(request);
    return logged.find((entry) => entry.method === 'POST' && entry.path === '/payroll/idp/onboarding/assign')?.body;
  }).toMatchObject({
    memberId: 'member-onboarding-new',
    email: 'dayo.new-hire@example.invalid',
    name: 'Dayo New Hire (synthetic)',
    employeeId: 'SYN-NG-003',
    designation: 'People Operations Associate',
    departmentId: 'department-operations',
    departmentName: 'Operations',
  });

  const logged = await requests(request);
  expect(logged.some((entry) => entry.method === 'PATCH' && entry.path.includes('/payroll/idp/onboarding/'))).toBe(false);
  expect(browserErrors).toEqual([]);
  expect(serverErrors).toEqual([]);
});

test('reminds active onboarding and exposes retirement closeout in People Transitions', async ({ page, request }) => {
  const browserErrors: string[] = [];
  const serverErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`);
  });

  await page.goto('/admin/employees');
  await dismissPageGuide(page);

  const onboardingCard = employeeCard(page, 'Imani Active Transition (synthetic)');
  await expect(onboardingCard.getByText('In Progress', { exact: true }).first()).toBeVisible();
  await onboardingCard.getByRole('button', { name: 'Resolve Onboarding' }).click();

  const dialog = page.getByRole('dialog', { name: 'Imani Active Transition (synthetic)' });
  await expect(dialog.getByRole('button', { name: 'Send Reminder' })).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Open People Transition' })).toHaveAttribute(
    'href',
    'https://app.seemplifyai.com/people-transitions/tasks?transitionId=transition-onboarding-active',
  );
  await dialog.getByRole('button', { name: 'Send Reminder' }).click();
  await expect(dialog).toBeHidden();

  await expect.poll(async () => {
    const logged = await requests(request);
    return logged.some((entry) => (
      entry.method === 'POST'
      && entry.path === '/payroll/idp/onboarding/members/member-onboarding-active/reminder'
    ));
  }).toBe(true);

  const retirementCard = employeeCard(page, 'Ravi Retirement Closeout (synthetic)');
  await expect(retirementCard.getByText('Retirement Pending', { exact: true })).toBeVisible();
  await expect(retirementCard.getByRole('link', { name: 'Open Retirement' })).toHaveAttribute(
    'href',
    'https://app.seemplifyai.com/people-transitions/tasks?transitionId=transition-retirement-active',
  );
  expect(browserErrors).toEqual([]);
  expect(serverErrors).toEqual([]);
});

test('captures off-system overtime with business context before payroll approval', async ({ page, request }) => {
  await page.goto('/requests');
  await dismissPageGuide(page);

  await expect(page.getByRole('heading', { name: 'My Requests' })).toBeVisible();
  await page.getByRole('button', { name: 'New Request' }).click();
  await page.getByLabel('Work activity').selectOption('field_sales');
  await page.getByLabel('Date').fill('2026-08-10');
  await page.getByLabel('Started').fill('17:00');
  await page.getByLabel('Ended').fill('19:00');
  await expect(page.getByLabel('Payable hours')).toHaveValue('2');
  await page.getByLabel('Client or project').fill('Northwest field-sales visit');
  await page.getByLabel('Work location').fill('Manchester customer site');
  await page.getByLabel('Supporting reference').fill('CRM-ACTIVITY-421');
  await page.getByPlaceholder(/Describe the meeting, field activity/).fill('Customer renewal meeting completed after normal working hours.');
  await page.getByLabel(/I confirm these hours are not already included/).check();
  await page.getByRole('button', { name: 'Submit overtime' }).click();

  await expect(page.getByText('2h @ 1.5x')).toBeVisible();
  await expect(page.getByText(/Field sales · Northwest field-sales visit/)).toBeVisible();

  const logged = await requests(request);
  const create = logged.find((entry) => entry.method === 'POST' && entry.path === '/compensation/request');
  expect(create?.body).toMatchObject({
    userId: 'owner-e2e',
    type: 'overtime',
    overtimeHours: '2',
    overtimeMultiplier: '1.5',
    overtimeContext: {
      captureMethod: 'manual_external_work',
      activityType: 'field_sales',
      workLocation: 'Manchester customer site',
      clientOrProject: 'Northwest field-sales visit',
      evidenceReference: 'CRM-ACTIVITY-421',
      confirmedNotInTimesheet: true,
    },
  });
});

test('runs Nigeria and UK payroll separately and blocks preview finalization', async ({ page, request }, testInfo) => {
  await page.goto('/admin/run');
  await dismissPageGuide(page);
  const employer = page.getByLabel('Employer for this run');
  const currency = page.getByLabel('Statutory run currency');

  await employer.selectOption('entity-ng');
  await expect(currency).toHaveValue('NGN');
  await expect(currency).toBeDisabled();
  await expect(page.getByText('Preview-only calculation', { exact: true })).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: /^Calculate / }).click();
  await expect(page).toHaveURL(/\/admin\/runs\/run-ng$/);
  await dismissPageGuide(page);
  await expect(page.getByLabel('Legal employer for this run')).toContainText('Seemplify Nigeria Limited (synthetic)');
  await expect(page.getByLabel('Legal employer for this run')).toContainText('NG-LA');
  await expect(page.getByLabel('Legal employer for this run')).toContainText('NGN');
  await expect(page.getByText('This run was created against a preview-only tax pack and cannot be finalized.')).toBeVisible();

  await page.goto('/admin/run');
  await dismissPageGuide(page);
  await employer.selectOption('entity-uk');
  await expect(currency).toHaveValue('GBP');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: /^Calculate / }).click();
  await expect(page).toHaveURL(/\/admin\/runs\/run-uk$/);
  await dismissPageGuide(page);
  await expect(page.getByLabel('Legal employer for this run')).toContainText('Seemplify UK Subsidiary Limited (synthetic)');
  await expect(page.getByLabel('Legal employer for this run')).toContainText('GB');
  await expect(page.getByLabel('Legal employer for this run')).toContainText('GBP');
  await expect(page.getByText('This run was created against a preview-only tax pack and cannot be finalized.')).toBeVisible();

  const logged = await requests(request);
  const posts = logged.filter((entry) => entry.method === 'POST' && entry.path === '/payroll/runs');
  expect(posts.map((entry) => ({ entity: entry.body.employerEntityId, currency: entry.body.settings.reportingCurrency }))).toEqual([
    { entity: 'entity-ng', currency: 'NGN' },
    { entity: 'entity-uk', currency: 'GBP' },
  ]);

  await page.screenshot({
    path: `reports/tax-uk-run-${testInfo.project.name}.png`,
    fullPage: true,
  });
});
