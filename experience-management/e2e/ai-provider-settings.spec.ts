import { expect, test } from '@playwright/test';

test('settings connects ChatGPT, records consent, selects a Codex model, and returns to local AI', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'One desktop browser covers the AI provider settings flow.');
  test.skip(Boolean(process.env.PLAYWRIGHT_EXTERNAL_URL), 'This test uses a deterministic fake ChatGPT device flow.');

  await page.goto('/login');
  await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password').fill('Playwright-Test-Password-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();

  let provider: 'terra' | 'codex' = 'terra';
  let connected = false;
  let pendingLogin = false;
  let finishLogin = false;
  let acknowledgedAt: string | null = null;
  let selectedModel = 'gpt-test-codex';
  const patches: unknown[] = [];
  const models = [
    { id: 'gpt-test-codex', model: 'gpt-test-codex', displayName: 'GPT Test Codex', hidden: false, isDefault: true },
    { id: 'gpt-test-codex-fast', model: 'gpt-test-codex-fast', displayName: 'GPT Test Codex Fast', hidden: false, isDefault: false }
  ];
  const state = () => ({
    preference: {
      provider, codexModel: acknowledgedAt ? selectedModel : null,
      codexDataSharingAcknowledgedAt: acknowledgedAt, updatedAt: acknowledgedAt
    },
    codex: {
      available: true,
      account: {
        connected, email: connected ? 'codex@example.test' : null,
        planType: connected ? 'plus' : null, authMode: connected ? 'chatgpt' : null,
        pendingLogin, loginError: null
      },
      models: connected ? models : [], selectedModel: connected ? selectedModel : null, error: null
    }
  });

  await page.route('**/api/ai-provider', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      if (pendingLogin && finishLogin) { connected = true; pendingLogin = false; }
    } else if (method === 'PATCH') {
      const body = route.request().postDataJSON();
      patches.push(body);
      provider = body.provider;
      if (body.codexModel) selectedModel = body.codexModel;
      if (body.codexDataSharingAcknowledged === true) acknowledgedAt = new Date().toISOString();
      if (body.codexDataSharingAcknowledged === false) acknowledgedAt = null;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state()) });
  });
  await page.route('**/api/ai-provider/codex/device-login', async (route) => {
    pendingLogin = true;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      connected: false, loginId: 'test-login', verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'TEST-CODE'
    }) });
  });
  await page.route('**/api/ai-provider/codex/device-login/cancel', async (route) => {
    pendingLogin = false;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ cancelled: true }) });
  });
  await page.route('**/api/ai-provider/codex/disconnect', async (route) => {
    provider = 'terra'; connected = false; pendingLogin = false; acknowledgedAt = null;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state()) });
  });
  await page.route('**/api/runtime', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ terra: { ready: true, providerLabel: 'Terra test runtime' }, ai: { preference: { provider: 'terra' }, codex: null } })
  }));

  await page.goto('/settings/space');
  const settings = page.getByTestId('ai-provider-settings');
  await expect(settings.getByRole('heading', { name: 'AI runtime' })).toBeVisible();
  const localChoice = settings.getByRole('button', { name: /Local AI runtime/ });
  const codexChoice = settings.getByRole('button', { name: /ChatGPT \/ Codex/ });
  await expect(localChoice).toHaveAttribute('aria-pressed', 'true');
  await expect(codexChoice).toBeDisabled();

  await settings.getByRole('button', { name: 'Connect ChatGPT' }).click();
  await expect(settings.getByLabel('ChatGPT sign-in code')).toHaveValue('TEST-CODE');
  await expect(settings.getByRole('link', { name: 'Open OpenAI' })).toHaveAttribute('href', 'https://auth.openai.com/codex/device');

  finishLogin = true;
  await expect(settings.getByText(/Connected as codex@example\.test · plus/)).toBeVisible();
  await expect(settings.getByLabel('Codex model for this space')).toHaveValue('gpt-test-codex');
  await settings.getByRole('checkbox', { name: /Allow OpenAI processing for this space/ }).check();
  await codexChoice.click();
  await expect(codexChoice).toHaveAttribute('aria-pressed', 'true');
  expect(patches).toContainEqual({
    provider: 'codex', codexModel: 'gpt-test-codex', codexDataSharingAcknowledged: true
  });

  await settings.getByLabel('Codex model for this space').selectOption('gpt-test-codex-fast');
  expect(patches).toContainEqual({
    provider: 'codex', codexModel: 'gpt-test-codex-fast', codexDataSharingAcknowledged: true
  });

  await localChoice.click();
  await expect(localChoice).toHaveAttribute('aria-pressed', 'true');
  await settings.getByLabel('Codex model for this space').selectOption('gpt-test-codex');
  await expect(localChoice).toHaveAttribute('aria-pressed', 'true');
  expect(patches).toContainEqual({ provider: 'terra', codexModel: 'gpt-test-codex' });
  await codexChoice.click();
  await expect(codexChoice).toHaveAttribute('aria-pressed', 'true');

  await settings.getByRole('checkbox', { name: /Allow OpenAI processing for this space/ }).uncheck();
  await expect(localChoice).toHaveAttribute('aria-pressed', 'true');
  expect(patches).toContainEqual({ provider: 'terra', codexDataSharingAcknowledged: false });

  page.once('dialog', (dialog) => dialog.accept());
  await settings.getByRole('button', { name: 'Disconnect' }).click();
  await expect(localChoice).toHaveAttribute('aria-pressed', 'true');
  await expect(settings.getByRole('button', { name: 'Connect ChatGPT' })).toBeVisible();
});
