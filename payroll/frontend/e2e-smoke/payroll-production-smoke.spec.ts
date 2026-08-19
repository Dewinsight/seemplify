import { expect, test } from '@playwright/test';

const payrollOrigin = process.env.PAYROLL_SMOKE_BASE_URL || 'https://payroll.seemplifyai.com';
const payrollApi = process.env.PAYROLL_SMOKE_API_URL || 'https://api-payroll.seemplifyai.com';
const recruiterApi = process.env.RECRUITER_SMOKE_API_URL || 'https://api.seemplifyai.com';
const identityOrigin = process.env.IDENTITY_SMOKE_URL || 'https://auth.seemplifyai.com';

test('@smoke Payroll, Recruiter, and Identity health contracts are available', async ({ request }) => {
  const [payroll, recruiter, discovery] = await Promise.all([
    request.get(`${payrollApi}/health`),
    request.get(`${recruiterApi}/api/health`),
    request.get(`${identityOrigin}/.well-known/openid-configuration`),
  ]);

  expect(payroll.status(), await payroll.text()).toBe(200);
  expect(recruiter.status(), await recruiter.text()).toBe(200);
  expect(discovery.status(), await discovery.text()).toBe(200);

  const oidc = await discovery.json();
  expect(oidc.issuer).toBe(identityOrigin);
  expect(oidc.authorization_endpoint).toMatch(/^https:\/\/auth\.seemplifyai\.com\//);
});

test('@smoke Payroll onboarding and presence preflights allow the production frontend', async ({ request }) => {
  const checks = [
    {
      path: '/api/payroll/idp/onboarding/members/playwright-smoke-member/status',
      method: 'PATCH',
    },
    { path: '/api/payroll/idp/onboarding/assign', method: 'POST' },
    { path: '/api/presence/sessions', method: 'POST' },
  ];

  for (const check of checks) {
    const response = await request.fetch(`${payrollApi}${check.path}`, {
      method: 'OPTIONS',
      headers: {
        Origin: payrollOrigin,
        'Access-Control-Request-Method': check.method,
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });

    expect(response.status(), `${check.method} ${check.path}`).toBe(204);
    expect(response.headers()['access-control-allow-origin']).toBe(payrollOrigin);
    expect(response.headers()['access-control-allow-methods']).toContain(check.method);
  }
});

test('@smoke Payroll employee management route never returns a server failure', async ({ page }) => {
  const serverFailures: string[] = [];
  page.on('response', (response) => {
    if (response.status() >= 500) serverFailures.push(`${response.status()} ${response.url()}`);
  });

  const response = await page.goto('/admin/employees', { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBeLessThan(500);
  await page.waitForTimeout(3_000);
  await expect(page.locator('body')).not.toContainText('Internal Server Error');
  expect(serverFailures).toEqual([]);
});
