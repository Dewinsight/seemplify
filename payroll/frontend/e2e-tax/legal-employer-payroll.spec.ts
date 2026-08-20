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

test('employee requests a bank account change in Payroll while the approved account remains active', async ({ page }) => {
  let proposedAccount: any = null;
  let hasPendingRequest = false;
  await page.route('**/api/payroll/banking/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        account: {
          country: 'United Kingdom', countryCode: 'GB', accountName: 'Ava Stone',
          accountNumber: '12345678', bankName: 'Existing Bank', accountType: 'current', isVerified: true,
        },
        payrollCountryCode: 'NG',
        pendingRequest: hasPendingRequest ? {
          _id: 'bank-request-1', status: 'pending', createdAt: '2026-08-20T10:00:00.000Z',
          proposedAccountSummary: { bankName: 'Access Bank', countryCode: 'NG', accountLast4: '7890' },
        } : null,
        history: [],
      }),
    });
  });
  await page.route('**/api/payroll/banking/requests', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    proposedAccount = (await route.request().postDataJSON()).account;
    hasPendingRequest = true;
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ request: { _id: 'bank-request-1' } }) });
  });

  await page.goto('/banking');
  await dismissPageGuide(page);
  await expect(page.getByRole('heading', { name: 'Banking and direct deposit' })).toBeVisible();
  await expect(page.getByText('Existing Bank')).toBeVisible();
  await page.getByRole('button', { name: 'Request account change' }).click();
  await page.getByLabel('Country').selectOption('Nigeria');
  await page.getByLabel('Account holder name').fill('Ava Stone');
  await page.getByLabel('Bank').selectOption('044');
  await page.getByLabel('Account Number').fill('1234567890');
  await page.getByRole('button', { name: 'Send for HR approval' }).click();

  await expect(page.getByRole('heading', { name: 'Change awaiting HR approval' })).toBeVisible();
  await expect(page.getByText(/current salary account remains active/i)).toBeVisible();
  expect(proposedAccount).toMatchObject({
    country: 'Nigeria', bankName: 'Access Bank', branchCode: '044', accountNumber: '1234567890',
  });
});

test('employee adds and removes a Payroll dependent with field-level validation', async ({ page }) => {
  let dependents: any[] = [];
  const payload = () => ({ dependents, declaration: { status: dependents.length ? 'provided' : 'pending' }, taxDependentCount: dependents.filter((item) => item.taxDependent).length });
  await page.route('**/api/payroll/dependents/me', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload()) }));
  await page.route('**/api/payroll/dependents', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const body = await route.request().postDataJSON();
    if (!body.name || !body.relationship || !body.dateOfBirth) {
      return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: 'Check the highlighted dependent fields and try again.', fieldErrors: { name: 'Enter the dependent’s full name.', relationship: 'Select a valid relationship.', dateOfBirth: 'Enter a valid date of birth.' } }) });
    }
    dependents = [{ _id: 'dependent-1', ...body, dateOfBirth: `${body.dateOfBirth}T00:00:00.000Z` }];
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ...payload(), message: 'Dependent saved and included in Payroll tax and benefits data.' }) });
  });
  await page.route('**/api/payroll/dependents/dependent-1', async (route) => {
    if (route.request().method() !== 'DELETE') return route.continue();
    dependents = [];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...payload(), message: 'Dependent removed from Payroll.' }) });
  });

  await page.goto('/dependents');
  await dismissPageGuide(page);
  await expect(page.getByRole('heading', { name: 'Dependents', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add dependent' }).click();
  await page.getByRole('button', { name: 'Save dependent' }).click();
  await expect(page.getByText('Enter the dependent’s full name.')).toBeVisible();
  await expect(page.getByText('Select a valid relationship.')).toBeVisible();
  await page.getByLabel('Full name').fill('Jamie Stone');
  await page.getByLabel('Relationship').selectOption('child');
  await page.getByLabel('Date of birth').fill('2018-03-12');
  await page.getByRole('button', { name: 'Save dependent' }).click();
  await expect(page.getByText('Jamie Stone')).toBeVisible();
  await expect(page.getByText('1 included in the current tax-dependent count')).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Remove Jamie Stone' }).click();
  await expect(page.getByText('No dependents recorded.')).toBeVisible();
  await expect(page.getByText('Dependent removed from Payroll.')).toBeVisible();
});

test('HR approves an employee bank account request from the Payroll review queue', async ({ page }) => {
  let reviewedAction = '';
  let pending = true;
  await page.route('**/api/payroll/banking/requests?status=pending', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ requests: pending ? [{
        _id: 'bank-request-1', userName: 'Ava Stone', status: 'pending', reason: 'New salary account',
        createdAt: '2026-08-20T10:00:00.000Z',
        previousAccountSummary: { bankName: 'Existing Bank', countryCode: 'GB', accountLast4: '5678' },
        proposedAccountSummary: { bankName: 'Access Bank', countryCode: 'NG', accountLast4: '7890' },
        proposedAccount: { bankName: 'Access Bank', countryCode: 'NG', accountName: 'Ava Stone', branchCode: '044', accountType: 'current' },
      }] : [] }),
    });
  });
  await page.route('**/api/payroll/banking/requests/bank-request-1/action', async (route) => {
    reviewedAction = (await route.request().postDataJSON()).action;
    pending = false;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ request: { _id: 'bank-request-1', status: 'approved' } }) });
  });

  await page.goto('/admin/banking-approvals');
  await dismissPageGuide(page);
  await expect(page.getByRole('heading', { name: 'Bank account changes' })).toBeVisible();
  await expect(page.getByText('Ava Stone', { exact: true })).toBeVisible();
  await expect(page.getByText('Access Bank', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('No pending bank account requests.')).toBeVisible();
  expect(reviewedAction).toBe('approve');
});

test('dashboard calls out pending bank account changes and links to the review queue', async ({ page }) => {
  await page.route('**/api/payroll/banking/requests*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ requests: [{ _id: 'bank-request-1' }, { _id: 'bank-request-2' }] }),
    });
  });

  await page.goto('/dashboard');
  await dismissPageGuide(page);

  const notice = page.getByRole('alert').filter({ hasText: 'Bank account changes need review' });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('2 employee requests are waiting for HR approval');
  await notice.getByRole('link', { name: 'Review bank changes' }).click();
  await expect(page).toHaveURL(/\/admin\/banking-approvals$/);
  await expect(page.getByRole('heading', { name: 'Bank account changes' })).toBeVisible();
});

test('dashboard does not show a bank-change alert when the approval queue is empty', async ({ page }) => {
  await page.route('**/api/payroll/banking/requests*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ requests: [] }) });
  });

  await page.goto('/dashboard');
  await dismissPageGuide(page);
  await expect(page.getByText('Bank account changes need review')).toHaveCount(0);
});

test('leaves Payroll through local logout before returning to the App Hub', async ({ page, request }) => {
  let hubReached = false;
  await page.route('http://localhost:4000/**', async (route) => {
    hubReached = true;
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<title>App Hub</title><main>App Hub</main>' });
  });
  await page.goto('/dashboard');
  await dismissPageGuide(page);
  await page.getByRole('link', { name: 'App Hub', exact: true }).click();
  await expect.poll(() => hubReached).toBe(true);
  const logged = await requests(request);
  expect(logged.some((entry) => entry.method === 'POST' && entry.path === '/auth/logout')).toBe(true);
});

test('configures every supported tax rule shape without raw JSON', async ({ page, request }) => {
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.goto('/admin/settings/tax');
  await dismissPageGuide(page);

  expect(browserErrors).toEqual([]);
  await expect(page.getByRole('heading', { name: 'Tax Rules' })).toBeVisible();
  await page.getByText('Advanced rule definition', { exact: true }).click();
  const advancedRules = page.locator('details').filter({ hasText: 'Advanced rule definition' });
  await expect(advancedRules.getByRole('heading', { name: 'Official sources' })).toBeVisible();
  await expect(page.getByText(/\(JSON\)/i)).toHaveCount(0);

  const incomeTaxType = advancedRules.getByLabel('Rule type').first();
  await expect(incomeTaxType.locator('option')).toHaveCount(6);
  await incomeTaxType.selectOption('conditional');
  await expect(advancedRules.locator('textarea').first()).toHaveValue('false');

  const statutoryType = advancedRules.getByLabel('Rule type').nth(1);
  await expect(statutoryType.locator('option')).toHaveCount(4);
  await statutoryType.selectOption('fixed_amount');
  await expect(advancedRules.locator('input[value="New statutory contribution"]')).toBeVisible();

  await page.getByRole('button', { name: 'Save' }).click();
  await expect.poll(async () => {
    const logged = await requests(request);
    return logged.find((entry) => entry.method === 'PUT' && entry.path === '/payroll/tax/jurisdictions/tax-ng')?.body?.version;
  }).toMatchObject({
    incomeTax: { strategy: 'conditional' },
    statutoryRules: [{ strategy: 'fixed_amount' }],
  });
  expect(browserErrors).toEqual([]);
});

test('shows a published platform pack as fully payroll-ready without human review placeholders', async ({ page }) => {
  await page.goto('/admin/settings/tax');
  await dismissPageGuide(page);

  const platformPack = page.getByRole('button', { name: /Nigeria statutory platform release/i });
  await expect(platformPack).toContainText('Payroll ready');
  await platformPack.click();

  await expect(page.getByText('Published platform pack', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Platform release certification' })).toBeVisible();
  await expect(page.getByText('Published and certified')).toBeVisible();
  await expect(page.getByText('production release approved')).toBeVisible();
  await expect(page.getByText('PAYROLL-NG-2026-RELEASE')).toBeVisible();
  await expect(page.getByText('Not submitted')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Jurisdiction review team' })).toHaveCount(0);
});

test('keeps every payroll jurisdiction in the ready list and moves non-runnable resources out of it', async ({ page }) => {
  await page.goto('/admin/settings/tax');
  await dismissPageGuide(page);

  await expect(page.getByRole('button', { name: /Nigeria statutory platform release.*Payroll ready/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Canada 2026 implementation template/i })).toHaveCount(0);
  await page.getByRole('button', { name: 'Implementation resources (4)' }).click();
  await expect(page.getByRole('button', { name: /Canada 2026 implementation template.*Certification pending/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /EU country-pack template.*Setup template/i })).toBeVisible();

  const readyList = page.getByRole('button', { name: /Payroll ready/i });
  await expect(readyList).toHaveCount(1);
  await expect(readyList.first()).toContainText('Nigeria statutory platform release');
});

test('creates an editable organization copy of a protected platform pack', async ({ page, request }) => {
  await page.goto('/admin/settings/tax');
  await dismissPageGuide(page);

  await page.getByRole('button', { name: /Nigeria statutory platform release/i }).click();
  await expect(page.getByPlaceholder('Display name')).toBeDisabled();
  await page.getByRole('button', { name: 'Customize editable copy' }).click();

  await expect(page.getByPlaceholder('Display name')).toBeEnabled();
  await expect(page.getByPlaceholder('Display name')).toHaveValue('Nigeria statutory platform release Override');
  await page.getByText('Advanced rule definition', { exact: true }).click();
  await expect(page.locator('details').filter({ hasText: 'Advanced rule definition' }).getByLabel('Rule type').first()).toBeEnabled();

  const logged = await requests(request);
  expect(logged).toContainEqual(expect.objectContaining({
    method: 'POST',
    path: '/payroll/tax/jurisdictions',
    body: expect.objectContaining({ cloneFromId: 'tax-ng-platform' }),
  }));
});

test('creates a new governed jurisdiction draft from the global backlog', async ({ page, request }) => {
  await page.goto('/admin/settings/tax');
  await dismissPageGuide(page);

  await page.getByRole('button', { name: 'New jurisdiction' }).click();
  await page.getByLabel('Rollout backlog item').selectOption('GLOBAL_COUNTRY_OR_TERRITORY_PACKS:JP');
  await page.getByLabel('Display name').fill('Japan payroll research draft');
  await page.getByPlaceholder('ISO 4217').fill('JPY');
  await page.getByRole('button', { name: 'Create blocked draft' }).click();

  await expect(page.getByText('Created a blocked organization draft. It cannot run payroll until its legal and certification gates pass.')).toBeVisible();
  await expect(page.getByPlaceholder('Display name')).toHaveValue('Japan payroll research draft');
  await expect(page.getByPlaceholder('Display name')).toBeEnabled();

  const logged = await requests(request);
  expect(logged).toContainEqual(expect.objectContaining({
    method: 'POST',
    path: '/payroll/tax/jurisdictions',
    body: expect.objectContaining({
      backlogReference: { groupId: 'GLOBAL_COUNTRY_OR_TERRITORY_PACKS', entryCode: 'JP' },
      displayName: 'Japan payroll research draft',
      version: expect.objectContaining({ calculationCurrency: 'JPY' }),
    }),
  }));
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
  const payrollCountry = page.getByText('Payroll Country', { exact: true }).locator('..').locator('select');
  await expect(payrollCountry.locator('option[value="JP"]')).toHaveText('Japan');

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
  await expect.poll(async () => {
    const logged = await requests(request);
    return logged.filter((entry) => entry.method === 'PUT' && entry.path === '/payroll/profiles/user-ng').at(-1)?.body;
  }).toMatchObject({
    payrollFlags: {
      includeInNextRun: true,
      excludeFromNextRun: false,
      requiresReview: false,
      reviewReason: '',
    },
  });

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

test('shows an active payroll-ready employer setup for every released platform jurisdiction', async ({ page }) => {
  const released = [
    ['GB', 'GBP'], ['US', 'USD'], ['NG', 'NGN'], ['GH', 'GHS'],
    ['KE', 'KES'], ['ZA', 'ZAR'], ['CM', 'XAF'], ['MZ', 'MZN'],
  ];
  await page.route('**/api/payroll/employer-entities', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        entities: released.map(([countryCode, currency]) => ({
          _id: `entity-${countryCode.toLowerCase()}`,
          organizationId: 'org-e2e',
          code: `${countryCode}-DEFAULT`,
          legalName: `Seemplify Test Organization - ${countryCode}`,
          employerType: 'company',
          countryCode,
          jurisdictionCode: countryCode === 'NG' ? 'NG-LA' : countryCode,
          defaultCurrency: currency,
          status: 'active',
          taxJurisdictionConfigId: `tax-${countryCode.toLowerCase()}`,
          taxJurisdictionVersionId: `tax-${countryCode.toLowerCase()}-published`,
          taxAdapterCandidateId: '',
          taxRegistrations: [],
          payrollReadiness: {
            payrollRunnable: true,
            mode: 'runnable',
            blockingIssues: [],
            warnings: ['Employer registration reference has not been added.'],
            taxPack: { label: `${countryCode} platform release`, calculationStatus: 'runnable' },
          },
        })),
      }),
    });
  });

  await page.goto('/admin/settings/employer-entities');
  await dismissPageGuide(page);

  await expect(page.getByRole('row')).toHaveCount(9);
  await expect(page.getByText('runnable', { exact: true })).toHaveCount(8);
  await expect(page.getByText('Built into released tax pack', { exact: true })).toHaveCount(8);
  for (const [countryCode] of released) {
    await expect(page.getByText(`${countryCode}-DEFAULT - company`, { exact: true })).toBeVisible();
  }
});

test('edits, removes, and restores a legal employer without deleting payroll history', async ({ page, request }) => {
  await page.goto('/admin/settings/employer-entities');
  await dismissPageGuide(page);

  const row = page.getByRole('row').filter({ hasText: 'Seemplify Nigeria Limited (synthetic)' });
  await row.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByRole('heading', { name: 'Edit employer' })).toBeVisible();
  await page.getByLabel('Registered legal name').fill('Seemplify Nigeria Payroll Limited (synthetic)');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Seemplify Nigeria Payroll Limited (synthetic)')).toBeVisible();

  const updatedRow = page.getByRole('row').filter({ hasText: 'Seemplify Nigeria Payroll Limited (synthetic)' });
  page.once('dialog', (dialog) => dialog.accept());
  await updatedRow.getByRole('button', { name: 'Remove' }).click();
  await expect(updatedRow.getByText('blocked', { exact: true })).toBeVisible();
  await updatedRow.getByRole('button', { name: 'Restore' }).click();

  const logged = await requests(request);
  const updates = logged.filter((entry) => entry.method === 'PUT' && entry.path === '/payroll/employer-entities/entity-ng');
  expect(updates.map((entry) => entry.body)).toEqual(expect.arrayContaining([
    expect.objectContaining({ legalName: 'Seemplify Nigeria Payroll Limited (synthetic)' }),
    { status: 'inactive' },
    { status: 'active' },
  ]));
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

test('configures payroll approval policy and scoped accounting delivery contact', async ({ page }) => {
  const policies: any[] = [];
  const contacts: any[] = [];
  await page.route('**/api/payroll/approval-policies', async route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON(); policies.push({ _id: 'policy-e2e', active: true, ...body });
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(policies[0]) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(policies) });
  });
  await page.route('**/api/payroll/accounting-contacts', async route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON(); contacts.push({ _id: 'contact-e2e', active: true, ...body });
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(contacts[0]) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(contacts) });
  });
  await page.route('**/api/payroll/employer-entities', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entities: [{ _id: 'entity-ng', legalName: 'Nigeria Limited', jurisdictionCode: 'NG-LA' }] }) }));
  await page.goto('/admin/settings/payroll-workflow');
  await dismissPageGuide(page);
  await page.getByPlaceholder('Policy name').fill('Two-level payroll approval');
  await page.getByText('Approval levels').locator('select').selectOption('2');
  await page.getByRole('button', { name: 'Add policy' }).click();
  await expect(page.getByText('Two-level payroll approval · Default')).toBeVisible();
  await page.getByPlaceholder('Contact name').fill('Nigeria accounting');
  await page.getByPlaceholder('accounting@example.com').fill('accounts.ng@example.invalid');
  await page.getByLabel('Accounting contact legal employer').selectOption('entity-ng');
  await page.getByRole('button', { name: 'Add contact' }).click();
  await expect(page.getByText('accounts.ng@example.invalid')).toBeVisible();
  expect(policies[0]).toMatchObject({ approvalRequired: true, requireSeparationOfDuties: true, levels: [{ minimumApprovals: 1 }, { minimumApprovals: 1 }] });
  expect(contacts[0]).toMatchObject({ employerEntityId: 'entity-ng', email: 'accounts.ng@example.invalid' });
});

test('preflights, calculates, submits, and releases a multi-entity payroll cycle', async ({ page }) => {
  const employers = [
    { _id: 'entity-ng', legalName: 'Seemplify Nigeria Limited (synthetic)', status: 'active', countryCode: 'NG', jurisdictionCode: 'NG-LA', defaultCurrency: 'NGN' },
    { _id: 'entity-uk', legalName: 'Seemplify UK Subsidiary Limited (synthetic)', status: 'active', countryCode: 'GB', jurisdictionCode: 'GB', defaultCurrency: 'GBP' },
  ].map(entity => ({ ...entity, payrollReadiness: { payrollRunnable: true, mode: 'runnable', blockingIssues: [], warnings: [], taxPack: { label: 'Released pack', calculationStatus: 'runnable' } } }));
  let status = 'calculated';
  let deliveries: any[] = [];
  const cycle = () => ({
    _id: 'cycle-e2e', cycleNumber: 'PC-2026-08-001', status, revision: 1, currentApprovalLevel: 0,
    payPeriod: { month: 8, year: 2026, paymentDate: '2026-08-31T00:00:00.000Z' },
    approvalCapabilities: { canFullyApprove: true, canOverrideSeparationOfDuties: true },
    approvals: [], deliveries,
    childRuns: employers.map((entity, index) => ({
      employerEntityId: entity._id, legalName: entity.legalName, countryCode: entity.countryCode,
      currency: entity.defaultCurrency, status: status === 'released' ? 'released' : status === 'pending_approval' ? 'submitted' : 'calculated',
      payrollRunId: { _id: `cycle-run-${index}`, runNumber: `PR-2026-08-00${index + 1}`, status, summary: { processedCount: 1, currency: entity.defaultCurrency, totalGrossPayroll: index ? 5000 : 1000000, totalDeductions: index ? 900 : 150000, totalNetPayroll: index ? 4100 : 850000 } },
    })),
  });
  await page.route('**/api/payroll/employer-entities', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entities: employers }) }));
  await page.route('**/api/payroll/cycles/preflight', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ready: true, entities: employers.map(entity => ({ employerEntityId: entity._id, legalName: entity.legalName, currency: entity.defaultCurrency, employeeCount: 1, ready: true, blockers: [], warnings: [] })) }) }));
  await page.route('**/api/payroll/cycles', async route => {
    if (route.request().method() === 'POST') return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ success: true, cycle: cycle() }) });
    return route.continue();
  });
  await page.route('**/api/payroll/cycles/cycle-e2e', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cycle()) }));
  await page.route('**/api/payroll/cycles/cycle-e2e/submit', route => { status = 'pending_approval'; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, cycle: cycle() }) }); });
  await page.route('**/api/payroll/cycles/cycle-e2e/approve-and-release', route => { status = 'released'; deliveries = [{ _id: 'delivery-1', recipientEmail: 'accounts@example.invalid', status: 'sent', attemptCount: 1, expiresAt: '2026-09-07T00:00:00.000Z' }]; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, cycle: cycle(), released: true }) }); });

  await page.goto('/admin/run');
  await dismissPageGuide(page);
  await expect(page.getByRole('checkbox')).toHaveCount(2);
  await expect(page.getByRole('checkbox').nth(0)).toBeChecked();
  await expect(page.getByRole('checkbox').nth(1)).toBeChecked();
  await page.getByRole('button', { name: 'Run preflight' }).click();
  await expect(page.getByText('All selected employers are ready to calculate.')).toBeVisible();
  await page.getByRole('button', { name: 'Create cycle (2)' }).click();
  await expect(page).toHaveURL(/\/admin\/cycles\/cycle-e2e$/);
  await dismissPageGuide(page);
  await expect(page.getByText('Seemplify Nigeria Limited (synthetic)')).toBeVisible();
  await expect(page.getByText('Seemplify UK Subsidiary Limited (synthetic)')).toBeVisible();
  await expect(page.getByText('As an organization administrator, you can submit and fully approve this cycle yourself.')).toBeVisible();
  await page.getByRole('button', { name: 'Submit payroll' }).click();
  await expect(page.getByRole('button', { name: 'Approve and release' })).toBeVisible();
  await page.getByRole('button', { name: 'Approve and release' }).click();
  await expect(page.getByText('accounts@example.invalid')).toBeVisible();
  await expect(page.getByText('sent · 1 attempt')).toBeVisible();
});

test('reconciles a committed retraction when the POST response is ambiguous', async ({ page, request }) => {
  const dialogs: Array<{ type: string; message: string }> = [];
  page.on('dialog', async (dialog) => {
    dialogs.push({ type: dialog.type(), message: dialog.message() });
    if (dialog.type() === 'prompt') {
      await dialog.accept('Correct imported attendance');
      return;
    }
    await dialog.accept();
  });

  await page.goto('/admin/runs/run-ng');
  await dismissPageGuide(page);
  await page.getByRole('button', { name: 'Retract Run' }).click();

  await expect(page.getByText('This payroll run has been retracted.')).toBeVisible();
  await expect(page.getByText('Reason: Correct imported attendance')).toBeVisible();
  expect(dialogs.map((dialog) => dialog.type)).toEqual(['confirm', 'prompt']);

  const logged = await requests(request);
  expect(logged.some((entry) => entry.method === 'POST' && entry.path === '/payroll/runs/run-ng/retract')).toBe(true);
  expect(logged.filter((entry) => entry.method === 'GET' && entry.path === '/payroll/runs/run-ng/payslips')).toHaveLength(2);
});
