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

type RuntimeChoice = 'chatgpt';

async function installProviderMocks(page: Page, options: { chatgptEnabled?: boolean } = {}) {
  const chatgptEnabled = options.chatgptEnabled ?? true;
  let provider: 'codex' = 'codex';
  let runtimeChoice: RuntimeChoice = 'chatgpt';
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
      chatgptEnabled,
      defaultRuntime: 'chatgpt',
      effectiveProvider: chatgptEnabled ? provider : null
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
      provider = 'codex';
      runtimeChoice = 'chatgpt';
      if (body.codexDataSharingAcknowledged === true) acknowledgedAt = '2026-08-04T12:00:00.000Z';
      if (body.codexDataSharingAcknowledged === false) acknowledgedAt = null;
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

test('an unconnected ChatGPT account blocks protected content and links to connection settings', async ({ page }) => {
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
  await expect(settings.getByRole('button', { name: 'Connect ChatGPT' })).toBeVisible();
  await expect(mocks.patches).toEqual([]);
});

test('a platform-disabled ChatGPT runtime never exposes an alternate AI provider', async ({ page }) => {
  await installProviderMocks(page, { chatgptEnabled: false });
  await login(page);

  await expect(page.getByRole('button', { name: /Use another provider/i })).toHaveCount(0);
});

test('the blocking ChatGPT gate lets the application user sign out', async ({ page }) => {
  await installProviderMocks(page);
  await login(page);

  const gate = page.getByTestId('chatgpt-connection-gate');
  await expect(gate).toBeVisible();
  await gate.getByTestId('chatgpt-gate-sign-out').click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(gate).toHaveCount(0);
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
