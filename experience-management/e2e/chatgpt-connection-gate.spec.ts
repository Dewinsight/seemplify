import { expect, test, type Page } from '@playwright/test';

const qaEmail = 'qa@seemplify.local';
const qaPassword = 'Playwright-Test-Password-2026!';
const codexModel = {
  id: 'gpt-test-codex',
  displayName: 'GPT Test Codex',
  isDefault: true,
  defaultReasoningEffort: 'medium',
  supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Balanced' }]
};

type RuntimeChoice = 'local' | 'chatgpt' | null;

async function installProviderMocks(page: Page, options: { localEnabled?: boolean } = {}) {
  const localEnabled = options.localEnabled ?? true;
  let provider: 'terra' | 'codex' = 'codex';
  let runtimeChoice: RuntimeChoice = null;
  let connected = false;
  let pendingLogin = false;
  let finishLogin = false;
  let acknowledgedAt: string | null = null;
  const patches: Array<Record<string, unknown>> = [];

  const state = () => ({
    preference: {
      provider,
      runtimeChoice,
      codexModel: null,
      codexReasoningEffort: null,
      codexActionOverrides: {},
      codexDataSharingAcknowledgedAt: acknowledgedAt,
      updatedAt: acknowledgedAt
    },
    runtimePolicy: {
      localEnabled,
      chatgptEnabled: true,
      defaultRuntime: 'chatgpt',
      effectiveProvider: provider
    },
    codex: {
      available: true,
      account: {
        connected,
        email: connected ? 'gate-user@example.test' : null,
        planType: connected ? 'plus' : null,
        authMode: connected ? 'chatgpt' : null,
        pendingLogin,
        loginError: null
      },
      models: connected ? [codexModel] : [],
      actions: [],
      adminDefaults: {
        codexModel: null,
        codexReasoningEffort: null,
        codexActionOverrides: {},
        updatedAt: null
      },
      effectiveConfiguration: {
        default: {
          model: {
            value: connected ? codexModel.id : null,
            source: connected ? 'connected_model_default' : null,
            inherited: true
          },
          reasoningEffort: {
            value: connected ? 'medium' : null,
            source: connected ? 'model_default' : null,
            inherited: true
          }
        },
        actions: {}
      },
      selectedModel: connected ? codexModel.id : null,
      error: null
    }
  });

  await page.route(/\/api\/ai-provider(?:\?.*)?$/, async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      if (pendingLogin && finishLogin) {
        connected = true;
        pendingLogin = false;
      }
    } else if (method === 'PATCH') {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      patches.push(body);
      if (body.provider === 'terra') {
        provider = 'terra';
        runtimeChoice = 'local';
        acknowledgedAt = null;
      } else if (body.provider === 'codex') {
        provider = 'codex';
        runtimeChoice = 'chatgpt';
        if (body.codexDataSharingAcknowledged === true) acknowledgedAt = '2026-08-04T12:00:00.000Z';
      }
    } else {
      await route.fulfill({ status: 405, contentType: 'application/json', body: JSON.stringify({ error: 'Unexpected method' }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state()) });
  });

  await page.route('**/api/ai-provider/codex/device-login', async (route) => {
    pendingLogin = true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        connected: false,
        loginId: 'gate-login',
        verificationUrl: 'https://auth.openai.com/codex/device',
        userCode: 'GATE-CODE'
      })
    });
  });

  await page.route('**/api/ai-provider/codex/device-login/cancel', async (route) => {
    pendingLogin = false;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ cancelled: true })
    });
  });

  await page.route('**/api/runtime', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        terra: { ready: true, reachable: true, providerLabel: 'Terra test runtime' },
        ai: state(),
        worker: { active: 0, concurrency: 1 }
      })
    });
  });

  return {
    patches,
    completeDeviceLogin() { finishLogin = true; }
  };
}

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(qaEmail);
  await page.getByLabel('Password', { exact: true }).fill(qaPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test.beforeEach(async () => {
  test.skip(Boolean(process.env.PLAYWRIGHT_EXTERNAL_URL), 'The ChatGPT gate uses deterministic local route mocks.');
});

test('an unresolved ChatGPT choice blocks protected content until settings explicitly selects local AI', async ({ page }) => {
  const mocks = await installProviderMocks(page);
  await login(page);

  const gate = page.getByTestId('chatgpt-connection-gate');
  await expect(gate).toBeVisible();
  await expect(gate.getByRole('heading', { name: 'Connect ChatGPT' })).toBeVisible();
  await expect(gate.getByTestId('chatgpt-runtime-attribution')).toContainText('Powered by ChatGPT');
  await expect(gate.getByTestId('openai-brand-mark')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(gate).toBeVisible();
  await expect(gate.getByRole('button', { name: /close/i })).toHaveCount(0);

  await gate.getByTestId('chatgpt-gate-settings').click();
  await expect(page).toHaveURL(/\/settings\/space#ai-runtime$/);
  await expect(gate).toHaveCount(0);

  const settings = page.getByTestId('ai-provider-settings');
  await expect(settings.getByRole('heading', { name: 'AI runtime' })).toBeVisible();
  await settings.getByRole('button', { name: /Local AI runtime/ }).click();
  await expect.poll(() => mocks.patches).toContainEqual({ provider: 'terra' });

  await page.goto('/');
  await expect(page.getByTestId('chatgpt-connection-gate')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();
});

test('the ChatGPT gate does not offer local AI when the platform disables it', async ({ page }) => {
  await installProviderMocks(page, { localEnabled: false });
  await login(page);

  const gate = page.getByTestId('chatgpt-connection-gate');
  await expect(gate).toBeVisible();
  await expect(gate.getByTestId('chatgpt-gate-settings')).toHaveCount(0);
  await expect(gate.getByText('You can choose the local AI runtime in Space settings instead.')).toHaveCount(0);
  await expect(gate.getByTestId('chatgpt-gate-connect')).toBeVisible();
});

test('device sign-in activates ChatGPT, records acknowledgement, and reveals branded protected content', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop verifies the full device flow and visible top-bar attribution.');
  const mocks = await installProviderMocks(page);
  await login(page);

  const gate = page.getByTestId('chatgpt-connection-gate');
  await expect(gate).toBeVisible();
  await gate.getByTestId('chatgpt-gate-connect').click();
  await expect(gate.getByTestId('chatgpt-gate-device-code')).toHaveValue('GATE-CODE');
  await expect(gate.getByRole('link', { name: 'Open OpenAI' }))
    .toHaveAttribute('href', 'https://auth.openai.com/codex/device');

  mocks.completeDeviceLogin();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => mocks.patches).toContainEqual({
    provider: 'codex',
    codexDataSharingAcknowledged: true
  });

  await expect(gate).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();
  const attribution = page.getByTestId('chatgpt-runtime-attribution');
  await expect(attribution).toBeVisible();
  await expect(attribution).toContainText('Powered by ChatGPT');
  await expect(attribution).toContainText('gpt-test-codex');
  await expect(attribution.getByTestId('openai-brand-mark')).toBeVisible();
});
