import { expect, test } from '@playwright/test';

test('settings connects ChatGPT, records consent, selects a Codex model, and returns to local AI', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'One desktop browser covers the AI provider settings flow.');
  test.skip(Boolean(process.env.PLAYWRIGHT_EXTERNAL_URL), 'This test uses a deterministic fake ChatGPT device flow.');

  await page.goto('/login');
  await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password', { exact: true }).fill('Playwright-Test-Password-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();

  let provider: 'terra' | 'codex' = 'terra';
  let runtimeChoice: 'local' | 'chatgpt' | null = 'local';
  let connected = false;
  let pendingLogin = false;
  let finishLogin = false;
  let acknowledgedAt: string | null = null;
  let selectedModel = 'gpt-test-codex';
  let defaultEffort: string | null = null;
  let actionOverrides: Record<string, { model: string | null; reasoningEffort: string | null }> = {};
  let userDefaultsCleared = false;
  let adminDefaultModel: string | null = null;
  let adminDefaultEffort: string | null = null;
  let defaultsReset = false;
  const patches: unknown[] = [];
  const expectPatch = async (expected: unknown) => {
    await expect.poll(() => patches).toContainEqual(expected);
  };
  const models = [
    {
      id: 'gpt-test-codex', model: 'gpt-test-codex', displayName: 'GPT Test Codex', hidden: false, isDefault: true,
      defaultReasoningEffort: 'medium', supportedReasoningEfforts: [
        { reasoningEffort: 'medium', description: 'Balanced' }, { reasoningEffort: 'high', description: 'Deep' },
        { reasoningEffort: 'max', description: 'Maximum' }, { reasoningEffort: 'ultra', description: 'Delegated' }
      ]
    },
    {
      id: 'gpt-test-codex-fast', model: 'gpt-test-codex-fast', displayName: 'GPT Test Codex Fast', hidden: false, isDefault: false,
      defaultReasoningEffort: 'low', supportedReasoningEfforts: [
        { reasoningEffort: 'low', description: 'Fast' }, { reasoningEffort: 'max', description: 'Maximum' }
      ]
    },
    {
      id: 'gpt-test-codex-minimal', model: 'gpt-test-codex-minimal', displayName: 'GPT Test Codex Minimal', hidden: false, isDefault: false,
      defaultReasoningEffort: 'minimal', supportedReasoningEfforts: []
    }
  ];
  const actions = [
    { id: 'analyst.chat', group: 'Research intelligence', label: 'Analyst chat', description: 'Answer from survey evidence.', defaultReasoningEffort: 'medium' },
    { id: 'report.generate', group: 'Research intelligence', label: 'Executive report', description: 'Prepare a decision-ready report.', defaultReasoningEffort: 'high' }
  ];
  const state = () => ({
    preference: {
      provider, runtimeChoice, codexModel: acknowledgedAt && !userDefaultsCleared ? selectedModel : null,
      codexReasoningEffort: userDefaultsCleared ? null : defaultEffort,
      codexActionOverrides: userDefaultsCleared ? {} : actionOverrides,
      codexDataSharingAcknowledgedAt: acknowledgedAt, updatedAt: acknowledgedAt
    },
    codex: {
      available: true,
      account: {
        connected, email: connected ? 'codex@example.test' : null,
        planType: connected ? 'plus' : null, authMode: connected ? 'chatgpt' : null,
        pendingLogin, loginError: null
      },
      models: connected ? models : [], actions,
      adminDefaults: {
        codexModel: adminDefaultModel, codexReasoningEffort: adminDefaultEffort,
        codexActionOverrides: {}, updatedAt: adminDefaultModel ? new Date().toISOString() : null
      },
      effectiveConfiguration: {
        default: {
          model: {
            value: selectedModel,
            source: acknowledgedAt && !userDefaultsCleared ? 'user_default' : adminDefaultModel ? 'admin_default' : 'connected_model_default',
            inherited: userDefaultsCleared
          },
          reasoningEffort: {
            value: userDefaultsCleared ? (adminDefaultEffort || 'medium') : (defaultEffort || 'medium'),
            source: !userDefaultsCleared && defaultEffort ? 'user_default' : adminDefaultEffort ? 'admin_default' : 'model_default',
            inherited: userDefaultsCleared || !defaultEffort
          }
        },
        actions: {}
      },
      selectedModel: connected
        ? (models.some((model) => model.id === selectedModel)
          ? selectedModel
          : (models.find((model) => model.isDefault)?.id || models[0]?.id || null))
        : null,
      error: null
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
      runtimeChoice = body.provider === 'codex' ? 'chatgpt' : 'local';
      if (body.codexModel) selectedModel = body.codexModel;
      if ('codexModel' in body || 'codexReasoningEffort' in body || 'codexActionOverrides' in body) userDefaultsCleared = false;
      if ('codexReasoningEffort' in body) defaultEffort = body.codexReasoningEffort;
      if ('codexActionOverrides' in body) actionOverrides = body.codexActionOverrides;
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
    provider = 'terra'; runtimeChoice = 'local'; connected = false; pendingLogin = false; acknowledgedAt = null;
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
  await expect(settings.getByTestId('chatgpt-runtime-attribution').first()).toContainText('Powered by ChatGPT');
  await expect(localChoice).toHaveAttribute('aria-pressed', 'true');
  await expect(codexChoice).toBeDisabled();

  await settings.getByRole('button', { name: 'Connect ChatGPT' }).click();
  await expect(settings.getByLabel('ChatGPT sign-in code')).toHaveValue('TEST-CODE');
  await expect(settings.getByRole('link', { name: 'Open OpenAI' })).toHaveAttribute('href', 'https://auth.openai.com/codex/device');

  finishLogin = true;
  await expect(settings.getByText(/Connected as codex@example\.test · plus/)).toBeVisible();
  await expect(settings.getByLabel('Default Codex model')).toHaveValue('gpt-test-codex');
  await expect(codexChoice).toHaveAttribute('aria-pressed', 'true');
  await expect(settings.getByRole('checkbox', { name: /Allow OpenAI processing for this space/ })).toBeChecked();
  await expectPatch({ provider: 'codex', codexDataSharingAcknowledged: true });
  await page.route('**/api/ai-provider/reset-codex-defaults', async (route) => {
    defaultsReset = true;
    userDefaultsCleared = true;
    defaultEffort = null;
    actionOverrides = {};
    adminDefaultModel = 'gpt-test-codex';
    adminDefaultEffort = 'medium';
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state()) });
  });

  await settings.getByTestId('codex-action-settings').locator('summary').click();
  await settings.getByLabel('Codex model for Analyst chat').selectOption('gpt-test-codex-fast');
  await expectPatch({
    provider: 'codex', codexModel: 'gpt-test-codex', codexReasoningEffort: null,
    codexActionOverrides: {
      'analyst.chat': { model: 'gpt-test-codex-fast', reasoningEffort: 'low', reasoningEffortAuto: true }
    },
    codexDataSharingAcknowledged: true
  });
  await expect(settings.getByLabel('Reasoning effort for Analyst chat')).toHaveValue('');
  await expect(settings.getByLabel('Reasoning effort for Analyst chat').locator('option:checked')).toContainText('uses Low');

  await settings.getByLabel('Default reasoning effort').selectOption('max');
  await expectPatch({
    provider: 'codex', codexModel: 'gpt-test-codex', codexReasoningEffort: 'max',
    codexActionOverrides: { 'analyst.chat': { model: 'gpt-test-codex-fast', reasoningEffort: null } },
    codexDataSharingAcknowledged: true
  });
  await expect(settings.getByLabel('Reasoning effort for Analyst chat')).toHaveValue('');
  await expect(settings.getByLabel('Reasoning effort for Analyst chat').locator('option:checked')).toContainText('default (Max)');

  await settings.getByLabel('Reasoning effort for Analyst chat').selectOption('max');
  await expectPatch({
    provider: 'codex', codexModel: 'gpt-test-codex', codexReasoningEffort: 'max',
    codexActionOverrides: { 'analyst.chat': { model: 'gpt-test-codex-fast', reasoningEffort: 'max' } },
    codexDataSharingAcknowledged: true
  });

  await page.setViewportSize({ width: 1024, height: 900 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });

  await localChoice.click();
  await expect(localChoice).toHaveAttribute('aria-pressed', 'true');
  await settings.getByLabel('Default Codex model').selectOption('gpt-test-codex-fast');
  await expect(localChoice).toHaveAttribute('aria-pressed', 'true');
  await expectPatch({
    provider: 'terra', codexModel: 'gpt-test-codex-fast', codexReasoningEffort: 'max',
    codexActionOverrides: { 'analyst.chat': { model: 'gpt-test-codex-fast', reasoningEffort: 'max' } }
  });
  await codexChoice.click();
  await expect(codexChoice).toHaveAttribute('aria-pressed', 'true');

  models.splice(models.findIndex((model) => model.id === 'gpt-test-codex-fast'), 1);
  await page.reload();
  await expect(settings.getByText(/saved default model is no longer available/i)).toBeVisible();
  await settings.getByTestId('codex-action-settings').locator('summary').click();
  await expect(settings.getByLabel('Codex model for Analyst chat')).toHaveValue('gpt-test-codex-fast');
  await expect(settings.getByLabel('Codex model for Analyst chat').locator('option:checked')).toContainText('unavailable');
  await settings.getByLabel('Default reasoning effort').selectOption('high');
  await expectPatch({
    provider: 'codex', codexModel: 'gpt-test-codex', codexReasoningEffort: 'high',
    codexActionOverrides: { 'analyst.chat': { model: null, reasoningEffort: 'max' } },
    codexDataSharingAcknowledged: true
  });

  models[0].supportedReasoningEfforts = models[0].supportedReasoningEfforts
    .filter((effort) => effort.reasoningEffort !== 'high');
  await page.reload();
  await expect(settings.getByText(/saved default effort is no longer available/i)).toBeVisible();
  await expect(settings.getByLabel('Default reasoning effort')).toHaveValue('high');
  await expect(settings.getByLabel('Default reasoning effort').locator('option:checked')).toContainText('unavailable');
  await settings.getByTestId('codex-action-settings').locator('summary').click();
  await settings.getByLabel('Reasoning effort for Analyst chat').selectOption('medium');
  await expectPatch({
    provider: 'codex', codexModel: 'gpt-test-codex', codexReasoningEffort: 'medium',
    codexActionOverrides: { 'analyst.chat': { model: null, reasoningEffort: 'medium' } },
    codexDataSharingAcknowledged: true
  });

  await settings.getByLabel('Default reasoning effort').selectOption('');
  await settings.getByLabel('Default Codex model').selectOption('gpt-test-codex-minimal');
  await expectPatch({
    provider: 'codex', codexModel: 'gpt-test-codex-minimal', codexReasoningEffort: null,
    codexActionOverrides: {
      'analyst.chat': { model: null, reasoningEffort: 'minimal', reasoningEffortAuto: true },
      'report.generate': { model: null, reasoningEffort: 'minimal', reasoningEffortAuto: true }
    },
    codexDataSharingAcknowledged: true
  });
  await expect(settings.getByTestId('codex-action-settings').locator('summary')).toContainText('Using defaults');
  await expect(settings.getByRole('button', { name: 'Reset overrides' })).toHaveCount(0);

  page.once('dialog', (dialog) => dialog.accept());
  await settings.getByRole('button', { name: 'Use platform defaults' }).click();
  await expect.poll(() => defaultsReset).toBe(true);
  await expect(settings.getByTestId('codex-default-provenance')).toContainText('Platform default');
  await expect(settings.getByRole('button', { name: 'Using platform defaults' })).toBeDisabled();

  await settings.getByRole('checkbox', { name: /Allow OpenAI processing for this space/ }).uncheck();
  await expect(localChoice).toHaveAttribute('aria-pressed', 'true');
  await expectPatch({ provider: 'terra', codexDataSharingAcknowledged: false });

  page.once('dialog', (dialog) => dialog.accept());
  await settings.getByRole('button', { name: 'Disconnect' }).click();
  await expect(localChoice).toHaveAttribute('aria-pressed', 'true');
  await expect(settings.getByRole('button', { name: 'Connect ChatGPT' })).toBeVisible();
});
