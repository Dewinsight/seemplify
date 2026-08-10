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

test.beforeEach(async ({ page, request }) => {
  await request.delete(`${mockApi}/__e2e__/requests`);
  await signIn(page);
});

test('separates Nigerian company and UK subsidiary tax presence', async ({ page }, testInfo) => {
  await page.goto('/admin/settings/employer-entities');
  await dismissPageGuide(page);

  await expect(page.getByRole('heading', { name: 'Legal employers' })).toBeVisible();
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
  await page.getByRole('button', { name: 'Add legal employer' }).click();
  await page.getByLabel('Code', { exact: true }).fill('NG-BRANCH');
  await page.getByLabel('Registered legal name').fill('Synthetic Nigeria Branch Limited');
  await page.getByLabel('Tax authority code').fill('LIRS');
  await page.getByLabel('Registration reference').fill('SYN-REG-001');
  await page.getByLabel('Evidence reference').fill('SYN-EVIDENCE-001');
  await page.getByRole('button', { name: 'Save draft' }).click();

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

test('runs Nigeria and UK payroll separately and blocks preview finalization', async ({ page, request }, testInfo) => {
  await page.goto('/admin/run');
  await dismissPageGuide(page);
  const employer = page.getByLabel('Employer for this run');
  const currency = page.getByLabel('Statutory run currency');

  await employer.selectOption('entity-ng');
  await expect(currency).toHaveValue('NGN');
  await expect(currency).toBeDisabled();
  await expect(page.getByText(/Preview-only: calculations can be inspected/)).toBeVisible();

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
