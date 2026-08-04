import { expect, type Page, type Request } from '@playwright/test';

export const accountPassword = 'Experience-Account-2026';

const tutorialKeys = [
  'overview', 'surveys', 'campaigns', 'agreements', 'social-listening', 'intelligence',
  'knowledge-bases', 'journey-maps', 'ai-queue', 'service-recovery', 'space-settings'
] as const;

export interface SignupValues {
  name: string;
  email: string;
  spaceName?: string;
  password?: string;
  jobTitle?: string;
  organizationName?: string;
}

export async function submitSignup(page: Page, values: SignupValues) {
  const password = values.password || accountPassword;
  await page.goto('/signup');
  await page.getByLabel('Full name', { exact: true }).fill(values.name);
  await page.getByLabel('Work email', { exact: true }).fill(values.email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('2 of 2', { exact: true })).toBeVisible();
  if (values.spaceName) await page.getByLabel('Personal space name (optional)', { exact: true }).fill(values.spaceName);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/verify-email\\?email=${encodeURIComponent(values.email).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}&request=[0-9a-f-]{36}`));
}

export async function verifyEmailAndOnboard(page: Page, values: SignupValues) {
  const tokenResponse = await page.request.post('/__e2e__/auth/verification-token', { data: { email: values.email } });
  expect(tokenResponse.status()).toBe(200);
  const verification = await tokenResponse.json() as { token: string };
  expect(verification.token).toMatch(/^[A-Za-z0-9_-]{40,100}$/);

  let verificationPosts = 0;
  const observeVerification = (browserRequest: Request) => {
    if (browserRequest.method() === 'POST' && new URL(browserRequest.url()).pathname === '/api/auth/verify-email') verificationPosts += 1;
  };
  page.on('request', observeVerification);
  await page.goto(`/verify-email?token=${encodeURIComponent(verification.token)}`);
  await expect(page.getByRole('heading', { name: 'Confirm your email' })).toBeVisible();
  await expect(page).toHaveURL(/\/verify-email$/);
  await page.waitForTimeout(250);
  expect(verificationPosts, 'opening a verification URL must not consume it without user confirmation').toBe(0);
  await page.getByRole('button', { name: 'Confirm email address' }).click();
  await expect(page.getByRole('heading', { name: 'Email verified' })).toBeVisible();
  expect(verificationPosts).toBe(1);
  page.off('request', observeVerification);
  await page.getByRole('link', { name: 'Continue to your profile' }).click();
  await expect(page.getByRole('heading', { name: 'Make the workspace yours' })).toBeVisible();
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue(values.email);
  await expect(page.getByLabel('Email', { exact: true })).toHaveAttribute('readonly', '');
  if (values.jobTitle) await page.getByLabel('Job title (optional)', { exact: true }).fill(values.jobTitle);
  if (values.organizationName) await page.getByLabel('Organisation (optional)', { exact: true }).fill(values.organizationName);
  await page.getByRole('radio', { name: /Customer experience/ }).check();
  // Signup tests exercise onboarding and first-visit tutorials, not the
  // ChatGPT-first runtime gate. Hold the successful onboarding response long
  // enough to make their runtime choice explicit before its redirect mounts
  // the protected application shell. Protected APIs correctly reject this
  // PATCH until the onboarding transaction itself has completed.
  await page.route('**/api/account/onboarding', async (route) => {
    const response = await route.fetch();
    if (response.ok()) {
      const runtimeResponse = await page.request.patch('/api/ai-provider', { data: { provider: 'terra' } });
      expect(runtimeResponse.status(), 'could not select the local AI runtime for the signup fixture').toBe(200);
    }
    await route.fulfill({ response });
  }, { times: 1 });
  await page.getByRole('button', { name: 'Finish setup' }).click();
  const firstVisitTutorial = page.getByRole('dialog');
  await expect(firstVisitTutorial).toBeVisible();
  await firstVisitTutorial.getByRole('button', { name: 'Maybe later' }).click();
  await expect(firstVisitTutorial).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();

  // Signup-focused tests verify the real first lesson above. Mark the full
  // curriculum complete afterwards so unrelated workflow specs are not
  // interrupted by a new modal on every section they visit.
  for (const tutorialKey of tutorialKeys) {
    const response = await page.request.put(`/api/tutorials/progress/${tutorialKey}`, {
      data: { version: 1, status: 'completed', lastStep: 2 }
    });
    expect(response.status(), `could not prepare ${tutorialKey} tutorial state`).toBe(200);
  }
}

export async function signUpAndOnboard(page: Page, values: SignupValues) {
  await submitSignup(page, values);
  await verifyEmailAndOnboard(page, values);
}
