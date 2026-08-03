import { expect, test } from '@playwright/test';
import { accountPassword, signUpAndOnboard, submitSignup, verifyEmailAndOnboard } from './auth';

test('space settings renders safely when stored timestamps are malformed', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'One desktop browser covers malformed legacy timestamps.');
  test.skip(Boolean(process.env.PLAYWRIGHT_EXTERNAL_URL), 'This test replaces local API responses with malformed legacy data.');

  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/login');
  await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password', { exact: true }).fill('Playwright-Test-Password-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();

  await page.route(/\/api\/spaces\/[^/]+\/members(?:\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([{
      id: 'legacy-member', name: 'Legacy member', email: 'legacy-member@example.com', role: 'member', joinedAt: 'not-a-timestamp'
    }])
  }));
  await page.route(/\/api\/spaces\/[^/]+\/invitations(?:\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([{
      id: 'legacy-invitation', email: 'legacy-invitation@example.com', role: 'member', expiresAt: '',
      acceptedAt: null, revokedAt: null, createdAt: 'not-a-timestamp', invitedBy: 'Legacy owner'
    }])
  }));
  await page.route(/\/api\/subscriptions\/requests(?:\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ requests: [{
      id: 'legacy-request', requestType: 'change', requestedPlanCode: 'team',
      requestedPlan: { code: 'team', name: 'Legacy team', description: '', requestable: true, features: {}, limits: {} },
      requestNote: 'Legacy request', status: 'rejected', reviewNote: '', version: 1,
      createdAt: 'invalid', decisionAt: 'invalid'
    }] })
  }));

  await page.goto('/settings/space');
  await expect(page.getByRole('heading', { name: 'Space settings' })).toBeVisible();

  const memberRow = page.getByRole('row').filter({ hasText: 'legacy-member@example.com' });
  await expect(memberRow.getByText('Not recorded', { exact: true })).toBeVisible();

  const invitationRow = page.getByRole('row').filter({ hasText: 'legacy-invitation@example.com' });
  await expect(invitationRow.getByText('Unavailable', { exact: true })).toBeVisible();
  await expect(invitationRow.getByText('Not recorded', { exact: true })).toBeVisible();

  const requestRow = page.getByRole('row').filter({ hasText: 'Legacy team' });
  await expect(requestRow.getByText('Not recorded', { exact: true })).toHaveCount(2);
  expect(pageErrors.filter((message) => message.includes('Invalid time value'))).toEqual([]);
});

test('reloads once and recovers when a lazy chunk is stale during deployment', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'One browser project exercises deployment recovery');
  let chunkRequests = 0;
  let loginDocuments = 0;
  page.on('request', (request) => {
    if (request.isNavigationRequest() && new URL(request.url()).pathname === '/login') loginDocuments += 1;
  });
  await page.route('**/assets/LoginPage-*.js', async (route) => {
    chunkRequests += 1;
    if (chunkRequests === 1) {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        headers: { 'cache-control': 'no-store' },
        body: '<!doctype html><title>Retired deployment shell</title>'
      });
      return;
    }
    await route.continue();
  });

  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
  expect(chunkRequests).toBe(2);
  expect(loginDocuments).toBe(2);
});

test('authenticated live refresh stream connects and emits its handshake', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'One browser project verifies the shared event stream');
  await page.goto('/login');
  await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password', { exact: true }).fill('Playwright-Test-Password-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();
  const result = await page.evaluate(() => new Promise<{ connected: boolean; readyState: number }>((resolve) => {
    const stream = new EventSource('/api/events');
    const finish = (connected: boolean) => { window.clearTimeout(timer); const readyState = stream.readyState; stream.close(); resolve({ connected, readyState }); };
    const timer = window.setTimeout(() => finish(false), 5000);
    stream.addEventListener('connected', () => finish(true), { once: true });
    stream.addEventListener('error', () => finish(false), { once: true });
  }));
  expect(result.connected, `Event stream failed with readyState ${result.readyState}`).toBe(true);
});

test('sidebar runtime identity stays readable and opens the AI queue', async ({ page }, testInfo) => {
  const providerLabel = 'Terra (Codex local-cloud through managed Local Control Center)';
  const mobile = testInfo.project.name === 'mobile-chromium';
  if (!mobile) await page.setViewportSize({ width: 768, height: 800 });
  await page.route('**/api/runtime', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ terra: { ready: true, reachable: true, providerLabel }, worker: { active: 0, concurrency: 1 } })
  }));
  await page.goto('/login');
  await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password', { exact: true }).fill('Playwright-Test-Password-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();

  if (mobile) {
    await page.getByRole('main').evaluate((element) => { element.style.minHeight = '3000px'; });
    await page.getByRole('button', { name: 'Open navigation' }).click();
    expect(await page.evaluate(() => window.getComputedStyle(document.body).overflow)).toBe('hidden');
  }
  const sidebar = page.getByRole('complementary');
  const runtimeStatus = sidebar.getByTestId('sidebar-runtime-status');
  const provider = runtimeStatus.getByTestId('sidebar-runtime-provider');
  await expect(runtimeStatus).toHaveAccessibleName(`Open AI queue. ${providerLabel}. Ready.`);
  await expect(runtimeStatus.getByText('AI runtime')).toBeVisible();
  await expect(runtimeStatus.getByText('Ready', { exact: true })).toBeVisible();
  await expect(provider).toHaveAttribute('title', providerLabel);
  await expect(sidebar.getByRole('button', { name: 'Sign out' })).toBeVisible();
  const dimensions = await runtimeStatus.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  const providerStyle = await provider.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return { overflow: style.overflow, textOverflow: style.textOverflow, whiteSpace: style.whiteSpace };
  });
  expect(providerStyle).toEqual({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
  const sidebarBox = await sidebar.boundingBox();
  expect(sidebarBox).not.toBeNull();
  for (const control of [runtimeStatus, sidebar.getByRole('button', { name: 'Sign out' }), sidebar.getByRole('link', { name: 'Terms' }), sidebar.getByRole('link', { name: 'Privacy' })]) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(sidebarBox!.x);
    expect(box!.x + box!.width).toBeLessThanOrEqual(sidebarBox!.x + sidebarBox!.width + 0.5);
  }
  const runtimeReceivesPointer = await runtimeStatus.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const target = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    return target === element || (target ? element.contains(target) : false);
  });
  expect(runtimeReceivesPointer).toBe(true);
  if (process.env.CAPTURE_VISUALS) await page.screenshot({ path: testInfo.outputPath('sidebar-runtime.png'), fullPage: true });

  const runtimeBox = await runtimeStatus.boundingBox();
  expect(runtimeBox).not.toBeNull();
  await page.mouse.click(runtimeBox!.x + runtimeBox!.width / 2, runtimeBox!.y + runtimeBox!.height / 2);
  await expect(page.getByRole('heading', { name: 'Experience AI queue' })).toBeVisible();
  if (mobile) expect(await page.evaluate(() => window.getComputedStyle(document.body).overflow)).not.toBe('hidden');
});

test('account signup, email verification, onboarding, and recovery entry points are complete', async ({ page }, testInfo) => {
  test.skip(Boolean(process.env.PLAYWRIGHT_EXTERNAL_URL), 'The deterministic verification-token helper exists only on the local E2E server.');
  const email = `experience-${testInfo.project.name}-${Date.now()}@example.com`;
  await page.goto('/login');
  await expect(page.getByRole('link', { name: 'Create an account' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Forgot password?' })).toBeVisible();
  await page.getByRole('link', { name: 'Create an account' }).click();
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  const account = {
    name: 'Experience Researcher', email, spaceName: 'Experience research',
    jobTitle: 'Customer insight lead', organizationName: 'Evidence Studio'
  };
  await submitSignup(page, account);

  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(accountPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

  await verifyEmailAndOnboard(page, account);
  await page.goto('/settings/profile');
  await expect(page.getByRole('heading', { name: 'Your profile' })).toBeVisible();
  await expect(page.getByLabel('Full name', { exact: true })).toHaveValue(account.name);
  await expect(page.getByLabel('Job title (optional)', { exact: true })).toHaveValue(account.jobTitle);
  await expect(page.getByLabel('Organisation (optional)', { exact: true })).toHaveValue(account.organizationName);
  await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST' }));
  await page.goto('/forgot-password');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByText('If an account exists for that email')).toBeVisible();
  await page.goto('/reset-password');
  await expect(page.getByText('missing its security token')).toBeVisible();
});

test('admin builds, publishes and receives a survey response through the public experience', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password', { exact: true }).fill('Playwright-Test-Password-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();

  await page.getByRole('link', { name: 'New survey' }).click();
  await page.getByRole('tab', { name: 'Templates' }).click();
  const template = page.getByRole('heading', { name: 'Customer relationship NPS' }).locator('../..');
  await template.getByRole('button', { name: 'Use template' }).click();
  await expect(page.getByRole('heading', { name: 'Customer relationship NPS' })).toBeVisible();
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Live', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'Distribute' }).click();
  const publicUrl = await page.getByLabel('Survey URL').inputValue();
  expect(publicUrl).toMatch(/\/s\//);
  const studioUrl = page.url();

  await page.goto(publicUrl);
  await expect(page.getByRole('heading', { name: 'Customer relationship NPS' })).toBeVisible();
  await page.getByRole('button', { name: '4', exact: true }).click();
  await page.locator('textarea').first().fill('The setup was confusing and I could not find the integration settings.');
  await page.getByRole('button', { name: 'Submit response' }).click();
  await expect(page.getByRole('heading', { name: 'Thank you' })).toBeVisible();

  await page.goto(studioUrl);
  await page.getByRole('tab', { name: 'Responses' }).click();
  await expect(page.getByText('Individual responses')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open' }).first()).toBeVisible();
  await page.goto('/ai-queue');
  await expect(page.getByText('Response analysis').first()).toBeVisible();
});

test('survey editor selects, reorders across pages, and accepts a dragged question type', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop exercises precise pointer and keyboard drag interactions');
  await page.goto('/login');
  await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password', { exact: true }).fill('Playwright-Test-Password-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();

  const suffix = `${Date.now()}`;
  const titles = {
    first: `First editor question ${suffix}`,
    second: `Second editor question ${suffix}`,
    third: `Third editor question ${suffix}`
  };
  const survey = await page.evaluate(async ({ suffix, titles }) => {
    const response = await fetch('/api/surveys', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        title: `Editor interactions ${suffix}`, purpose: 'customer_experience', primaryMetric: 'custom',
        questions: [
          { id: `editor-first-${suffix}`, page: 1, position: 0, type: 'short_text', title: titles.first, required: true, options: [], settings: {}, logic: [] },
          { id: `editor-second-${suffix}`, page: 2, position: 1, type: 'long_text', title: titles.second, required: false, options: [], settings: {}, logic: [] },
          { id: `editor-third-${suffix}`, page: 2, position: 2, type: 'rating', title: titles.third, required: true, options: [], settings: {}, logic: [] }
        ]
      })
    });
    return response.json();
  }, { suffix, titles });

  await page.goto(`/surveys/${survey.id}`);
  const questionList = page.getByRole('list', { name: 'Survey questions' });
  await expect(questionList.locator('[data-selected="true"]')).toContainText(titles.first);
  await expect(page.getByText('Question 1 settings', { exact: true })).toBeVisible();

  const secondSelection = questionList.getByRole('button', { name: new RegExp(`2\\. ${titles.second}`) });
  await secondSelection.click();
  await expect(secondSelection).toHaveAttribute('aria-pressed', 'true');
  await expect(questionList.locator('[data-selected="true"]')).toContainText(titles.second);
  await expect(page.getByText('Question 2 settings', { exact: true })).toBeVisible();
  if (process.env.CAPTURE_VISUALS) await page.screenshot({ path: testInfo.outputPath('survey-editor-selected.png'), fullPage: true });

  const secondHandle = questionList.getByRole('button', { name: `Reorder question 2: ${titles.second}` });
  await secondHandle.focus();
  await secondHandle.press('Space');
  await page.waitForTimeout(100);
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(100);
  await page.keyboard.press('Space');
  await expect(questionList.locator('li').first()).toContainText(titles.second);
  await expect(questionList.locator('li').first()).toContainText('Page 1');
  await expect(page.getByText('Question 1 settings', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible();
  await page.reload();
  await expect(questionList.locator('li').first()).toContainText(titles.second);
  await expect(questionList.locator('li').first()).toContainText('Page 1');

  const longTextHandle = page.getByRole('button', { name: 'Drag Long text into the question list' });
  await longTextHandle.dragTo(questionList.locator('li').nth(1));
  await expect(questionList.locator('li')).toHaveCount(4);
  const insertedQuestion = questionList.locator('[data-selected="true"]');
  await expect(insertedQuestion).toContainText('Untitled question');
  await expect(insertedQuestion).toContainText('long text');
  const insertedIndex = await questionList.locator('li').evaluateAll((items) => items.findIndex((item) => item.getAttribute('data-selected') === 'true'));
  await expect(page.getByText(`Question ${insertedIndex + 1} settings`, { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible();
  await page.reload();
  await expect(questionList.locator('li')).toHaveCount(4);
  await expect(questionList.locator('li').nth(insertedIndex)).toContainText('Untitled question');
  await expect(questionList.locator('li').nth(insertedIndex)).toContainText('long text');

  await page.evaluate((id) => fetch(`/api/surveys/${id}`, { method: 'DELETE' }), survey.id);

  const blankSurvey = await page.evaluate(async (id) => {
    const response = await fetch('/api/surveys', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: `Blank drag target ${id}`, purpose: 'customer_experience', primaryMetric: 'custom', questions: [] })
    });
    return response.json();
  }, suffix);
  await page.goto(`/surveys/${blankSurvey.id}`);
  const emptyTypeHandle = page.getByRole('button', { name: 'Drag Long text into the question list' });
  const emptyDropZone = page.locator('[aria-label="Question drop zone"]');
  const sourceBox = await emptyTypeHandle.boundingBox();
  const targetBox = await emptyDropZone.boundingBox();
  if (!sourceBox || !targetBox) throw new Error('Question type handle or empty drop zone is not visible.');
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 12 });
  await expect(page.getByText('Drop to add this question', { exact: true })).toBeVisible();
  await page.mouse.up();
  const blankQuestionList = page.getByRole('list', { name: 'Survey questions' });
  await expect(blankQuestionList.locator('li')).toHaveCount(1);
  await expect(blankQuestionList.locator('[data-selected="true"]')).toContainText('long text');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible();
  await page.reload();
  await expect(blankQuestionList.locator('li')).toHaveCount(1);
  await expect(blankQuestionList.locator('li')).toContainText('long text');
  await page.evaluate((id) => fetch(`/api/surveys/${id}`, { method: 'DELETE' }), blankSurvey.id);
});

test('runs a sequenced survey campaign through completion', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'One desktop project exercises campaign delivery');
  test.skip(Boolean(process.env.PLAYWRIGHT_EXTERNAL_URL), 'Outbound campaign delivery is exercised only against the local log-mode provider');
  await page.goto('/login');
  await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password', { exact: true }).fill('Playwright-Test-Password-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();

  const suffix = `${Date.now()}`;
  const setup = await page.evaluate(async (id) => {
    const json = (method: string, body: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const questionId = `campaign-question-${id}`;
    const created = await fetch('/api/surveys', json('POST', {
      title: `Campaign survey ${id}`, purpose: 'customer_experience', primaryMetric: 'csat',
      questions: [{ id: questionId, page: 1, position: 0, type: 'single_choice', title: 'How was your experience?', required: true, options: ['Great', 'Needs work'], settings: {}, logic: [] }]
    }));
    const survey = await created.json();
    await fetch(`/api/surveys/${survey.id}/publish`, json('POST', { status: 'live' }));
    const alternateResponse = await fetch('/api/surveys', json('POST', {
      title: `Alternate campaign survey ${id}`, purpose: 'market_research', primaryMetric: 'custom',
      questions: [{ id: `alternate-question-${id}`, page: 1, position: 0, type: 'short_text', title: 'What should change?', required: false, options: [], settings: {}, logic: [] }]
    }));
    const alternate = await alternateResponse.json();
    return { surveyId: survey.id, surveyTitle: survey.title, questionId, alternateSurveyId: alternate.id, alternateSurveyTitle: alternate.title };
  }, suffix);

  await page.goto('/campaigns');
  await expect(page.getByRole('heading', { name: 'Campaigns', exact: true })).toBeVisible();
  await expect(page.getByLabel('Survey', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Create campaign' })).toBeDisabled();
  await page.goto(`/campaigns?survey=${setup.surveyId}`);
  await expect(page.getByRole('heading', { name: 'Campaigns', exact: true })).toBeVisible();
  const campaignName = `Follow-up campaign ${suffix}`;
  await page.getByLabel('Name').fill(campaignName);
  await expect(page.getByLabel('Survey', { exact: true })).toHaveValue(setup.surveyId);
  await page.getByRole('button', { name: 'Create campaign' }).click();
  await expect(page.getByRole('heading', { name: campaignName })).toBeVisible();

  await page.getByRole('tab', { name: /Setup/ }).click();
  const senderName = `Research team ${suffix}`;
  await expect(page.getByLabel('Sender display name')).toBeEditable();
  const verifiedSenderEmail = await page.getByLabel('Verified sender email').inputValue();
  expect(verifiedSenderEmail).toMatch(/^[^@\s]+@[^@\s]+$/);
  await page.getByLabel('Sender display name').fill(senderName);
  await page.locator('#campaign-settings-survey').selectOption(setup.alternateSurveyId);
  await page.getByRole('tab', { name: /Schedule/ }).click();
  await expect(page.getByText('Start time required')).toBeVisible();
  await page.getByRole('tab', { name: /Setup/ }).click();
  await page.getByRole('button', { name: 'Save setup' }).click();
  await expect(page.locator('.page-description')).toContainText(setup.alternateSurveyTitle);
  await page.reload();
  await expect(page.getByLabel('Sender display name')).toHaveValue(senderName);
  await page.locator('#campaign-settings-survey').selectOption(setup.surveyId);
  await page.getByRole('button', { name: 'Save setup' }).click();
  await expect(page.locator('.page-description')).toContainText(setup.surveyTitle);

  await page.getByRole('tab', { name: /Audience/ }).click();
  await page.getByRole('button', { name: 'Add person' }).click();
  const contactDialog = page.getByRole('dialog', { name: 'Add person' });
  await contactDialog.getByLabel('Email address').fill(`ada-${suffix}@example.com`);
  await contactDialog.getByLabel('First name').fill('Ada');
  await contactDialog.getByLabel('Last name').fill('Lovelace');
  await contactDialog.getByLabel('Job title / position').fill('Chief analyst');
  await contactDialog.getByLabel('Company').fill('Analytical Engines');
  await contactDialog.getByRole('button', { name: 'Add custom field' }).click();
  await contactDialog.getByLabel('Custom field 1 name').fill('Region');
  await contactDialog.getByLabel('Custom field 1 value').fill('London');
  await contactDialog.getByRole('button', { name: 'Add person' }).click();
  await expect(page.getByText(`ada-${suffix}@example.com`)).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Chief analyst' })).toBeVisible();
  await expect(page.getByText('Region: London')).toBeVisible();

  await page.getByRole('button', { name: 'Import list' }).click();
  const importDialog = page.getByRole('dialog', { name: 'Import an audience list' });
  await importDialog.getByLabel('Contacts').fill(`email,first name,last name,position,company,customer tier\ngrace-${suffix}@example.com,Grace,Hopper,Rear admiral,US Navy,Research`);
  await expect(importDialog.getByText('Custom fields: customer tier.')).toBeVisible();
  await importDialog.getByRole('button', { name: 'Import 1 contact' }).click();
  await expect(importDialog).toBeHidden();
  const graceRow = page.getByRole('row').filter({ hasText: `grace-${suffix}@example.com` });
  await expect(graceRow).toBeVisible();
  await expect(graceRow.getByText('customer tier: Research')).toBeVisible();
  await graceRow.getByRole('button', { name: `Remove grace-${suffix}@example.com` }).click();
  await expect(graceRow.getByText('suppressed', { exact: true })).toBeVisible();
  if (process.env.CAPTURE_VISUALS) await page.screenshot({ path: testInfo.outputPath('campaign-audience.png'), fullPage: true });

  await page.getByRole('tab', { name: /Sequence/ }).click();
  await expect(page.getByText('Step 1', { exact: true })).toBeVisible();
  await expect(page.getByText('Step 2', { exact: true })).toBeVisible();
  await page.getByLabel('Step 1 embedded question').selectOption(setup.questionId);
  await page.getByRole('button', { name: 'Save sequence' }).click();
  await expect(page.getByText('Sequence saved')).toBeVisible();
  if (process.env.CAPTURE_VISUALS) await page.screenshot({ path: testInfo.outputPath('campaign-sequence.png'), fullPage: true });

  await page.getByRole('tab', { name: /Schedule/ }).click();
  const campaignStart = await page.evaluate(() => {
    const date = new Date(Date.now() - 60_000);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  await page.getByLabel(/Start time/).fill(campaignStart);
  await page.getByRole('button', { name: 'Save schedule' }).click();
  await expect(page.getByText('Campaign schedule saved')).toBeVisible();
  await page.getByRole('tab', { name: /Review/ }).click();
  await expect(page.getByText('All required steps are complete. Review the campaign before launch.')).toBeVisible();
  await expect(page.getByText(`From: ${senderName} <${verifiedSenderEmail}>`, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Launch campaign' }).click();
  await expect(page.getByText('active', { exact: true }).first()).toBeVisible();
  await page.getByRole('tab', { name: /Setup/ }).click();
  await expect(page.getByLabel('Sender display name')).toBeDisabled();
  await page.getByRole('tab', { name: 'Activity' }).click();
  const deliveryHistory = page.locator('table').filter({ has: page.getByRole('columnheader', { name: 'Lifecycle' }) });
  await expect(deliveryHistory.locator('tbody')).toContainText('accepted', { timeout: 15_000 });
  if (process.env.CAPTURE_VISUALS) await page.screenshot({ path: testInfo.outputPath('campaign-activity.png'), fullPage: true });

  const campaignId = new URL(page.url()).pathname.split('/').pop()!;
  await page.evaluate(async ({ campaignId, questionId }) => {
    const detail = await fetch(`/api/campaigns/${campaignId}`).then((response) => response.json());
    const contact = detail.contacts.find((item: any) => item.status === 'active');
    await fetch(`/api/public/collectors/${detail.collector.slug}/responses?recipient=${encodeURIComponent(contact.token)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers: { [questionId]: 'Great' }, status: 'completed' })
    });
  }, { campaignId, questionId: setup.questionId });
  await expect(page.getByText('completed', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Responses', { exact: true }).locator('..').getByText('1', { exact: true })).toBeVisible();
  await page.evaluate(async ({ surveyId, alternateSurveyId }) => {
    await fetch(`/api/surveys/${surveyId}`, { method: 'DELETE' });
    await fetch(`/api/surveys/${alternateSurveyId}`, { method: 'DELETE' });
  }, setup);
});

test('admin surface and public survey remain usable at a narrow mobile viewport', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'Dedicated responsive check');
  await page.goto('/login');
  await page.getByLabel('Email').fill('qa@seemplify.local'); await page.getByLabel('Password', { exact: true }).fill('Playwright-Test-Password-2026!'); await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Surveys', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Surveys' })).toBeVisible();
  await expect(page.locator('body')).not.toHaveCSS('overflow-x', 'scroll');
});

test('conditional respondent logic skips a page and opens a recovery case', async ({ page }, testInfo) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password', { exact: true }).fill('Playwright-Test-Password-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  const setup = await page.evaluate(async (id) => {
    const json = (method: string, body: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const source = `logic-source-${id}`; const skipped = `logic-skipped-${id}`; const target = `logic-target-${id}`;
    const sourceTitle = `Routing choice ${id}`;
    const surveyResponse = await fetch('/api/surveys', json('POST', {
      title: `Conditional journey ${id}`, purpose: 'customer_experience', primaryMetric: 'custom',
      questions: [
        { id: source, page: 1, position: 0, type: 'dropdown', title: sourceTitle, required: true, options: ['Continue', 'Escalate'], settings: {}, logic: [{ action: 'skip_to', sourceQuestionId: source, operator: 'equals', value: 'Escalate', targetQuestionId: target }] },
        { id: skipped, page: 2, position: 1, type: 'multi_text', title: 'Tell us about each product', required: true, options: ['Product A', 'Product B'], settings: {}, logic: [] },
        { id: target, page: 3, position: 2, type: 'graphical_rating', title: 'Rate the experience', required: true, options: [], settings: {}, logic: [{ action: 'create_ticket', sourceQuestionId: source, operator: 'equals', value: 'Escalate' }] }
      ]
    }));
    const survey = await surveyResponse.json();
    const collectorResponse = await fetch(`/api/surveys/${survey.id}/collectors`, json('POST', { name: 'Logic journey', type: 'web' }));
    const collector = await collectorResponse.json();
    await fetch(`/api/surveys/${survey.id}/publish`, json('POST', { status: 'live' }));
    return { surveyId: survey.id, publicUrl: collector.publicUrl, sourceTitle };
  }, suffix);

  await page.goto(setup.publicUrl);
  await page.getByLabel(setup.sourceTitle).selectOption('Escalate');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Page 3 of 3')).toBeVisible();
  await expect(page.getByText('Tell us about each product')).toHaveCount(0);
  await page.getByRole('button', { name: 'Excellent' }).click();
  await page.getByRole('button', { name: 'Submit response' }).click();
  await expect(page.getByRole('heading', { name: 'Thank you' })).toBeVisible();
  await page.goto('/tickets');
  await expect(page.getByText(`Follow up: ${setup.sourceTitle}`)).toBeVisible();
});

test('opens and tracks a manual recovery case from the service recovery workspace', async ({ page }, testInfo) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password', { exact: true }).fill('Playwright-Test-Password-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  const surveyTitle = `Recovery source ${suffix}`;
  const surveyResponse = await page.request.post('/api/surveys', { data: {
    title: surveyTitle, purpose: 'customer_experience', primaryMetric: 'custom', questions: []
  } });
  expect(surveyResponse.status()).toBe(201);

  await page.goto('/tickets');
  await expect(page.getByRole('heading', { name: 'Service recovery' })).toBeVisible();
  await page.getByRole('button', { name: 'New recovery case' }).first().click();
  const createDialog = page.getByRole('dialog', { name: 'New recovery case' });
  await createDialog.getByLabel('Survey').selectOption({ label: surveyTitle });
  await createDialog.getByLabel('Case title').fill(`Billing follow-up ${suffix}`);
  await createDialog.getByLabel('Priority').selectOption('high');
  await createDialog.getByLabel('Owner (optional)').fill('Customer success');
  await createDialog.getByLabel('Initial notes (optional)').fill('Confirm the renewal amount with finance.');
  await createDialog.getByRole('button', { name: 'Open recovery case' }).click();

  const detail = page.getByRole('dialog', { name: `Billing follow-up ${suffix}` });
  await expect(detail).toBeVisible();
  await expect(detail.getByText('This case was opened without a source response.')).toBeVisible();
  await expect(detail.getByText('Created the recovery case')).toBeVisible();
  await detail.getByRole('button', { name: 'Start work' }).click();
  await expect(detail.getByRole('button', { name: 'Close case' })).toBeVisible();
  await detail.getByRole('button', { name: 'Close case' }).click();
  await expect(detail.getByRole('button', { name: 'Reopen case' })).toBeVisible();
  await expect(detail.getByText('Closed the recovery case')).toBeVisible();
  await detail.getByRole('button', { name: 'Reopen case' }).click();
  await expect(detail.getByRole('button', { name: 'Start work' })).toBeVisible();
  await expect(detail.getByText('Reopened the recovery case')).toBeVisible();
  await detail.getByRole('button', { name: 'Close', exact: true }).click();

  await expect(page.getByText(`Billing follow-up ${suffix}`)).toBeVisible();
  await page.getByLabel('Search recovery cases').fill(`Billing follow-up ${suffix}`);
  await expect(page.getByRole('row').filter({ hasText: `Billing follow-up ${suffix}` })).toContainText('Open');
});

test('requests and approves a subscription through the workspace and platform administration', async ({ page }, testInfo) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password', { exact: true }).fill('Playwright-Test-Password-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();

  const current = await page.evaluate(async () => {
    const [planResponse, requestsResponse] = await Promise.all([
      fetch('/api/subscriptions/current'), fetch('/api/subscriptions/requests')
    ]);
    const plan = await planResponse.json();
    const requests = await requestsResponse.json();
    for (const request of requests.requests.filter((item: { status: string }) => item.status === 'pending')) {
      await fetch(`/api/subscriptions/requests/${request.id}/cancel`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'Cancelled before the deterministic browser test.', expectedVersion: request.version })
      });
    }
    return plan;
  });
  const targetPlan = current.effectivePlan.code === 'team' ? 'enterprise' : 'team';
  const targetName = targetPlan === 'enterprise' ? 'Enterprise' : 'Team';
  const suffix = `${testInfo.project.name}-${Date.now()}`;

  await page.goto('/settings/space');
  await expect(page.getByRole('heading', { name: 'Subscription' })).toBeVisible();
  await page.getByLabel('Requested plan').selectOption(targetPlan);
  await page.getByLabel('Reason for the request').fill(`Browser approval test ${suffix}`);
  await page.getByRole('button', { name: 'Request plan change' }).click();
  await expect(page.getByText('Pending review', { exact: true })).toBeVisible();

  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Platform overview' })).toBeVisible();
  if (testInfo.project.name === 'mobile-chromium') {
    await page.getByRole('button', { name: 'Open navigation' }).click();
  }
  await expect(page.getByRole('link', { name: 'Subscriptions', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Users', exact: true })).toBeVisible();
  if (testInfo.project.name === 'mobile-chromium') {
    await page.getByRole('button', { name: 'Close navigation' }).click();
  }
  await page.goto('/admin/subscription-requests');
  const pendingRow = page.getByRole('row').filter({ hasText: targetName }).filter({ hasText: 'Pending' }).first();
  await expect(pendingRow).toBeVisible();
  await pendingRow.getByRole('link', { name: 'Review' }).click();
  await page.getByLabel('Review note').fill(`Approved by browser automation for ${suffix}.`);
  const breakGlass = page.getByLabel('Use root break-glass approval');
  if (await breakGlass.isVisible()) await breakGlass.check();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Approve request' }).click();
  await expect(page.getByRole('region', { name: 'Request' }).getByText('approved', { exact: true })).toBeVisible();

  await page.goto('/admin/subscriptions');
  await expect(page.getByRole('heading', { name: 'Subscriptions', exact: true })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: targetName }).filter({ hasText: 'Active' }).first()).toBeVisible();

  await page.goto('/settings/space');
  await expect(page.getByText(targetName, { exact: true }).first()).toBeVisible();
  await expect(page.getByText('No request pending', { exact: true })).toBeVisible();
});

test('root administration manages a user role and workspace access with an audit reason', async ({ page }, testInfo) => {
  test.skip(Boolean(process.env.PLAYWRIGHT_EXTERNAL_URL), 'Account provisioning is isolated to the local E2E runtime.');
  test.skip(testInfo.project.name !== 'desktop-chromium', 'One browser covers destructive platform access controls.');
  const suffix = Date.now();
  const email = `platform-controls-${suffix}@example.com`;
  await signUpAndOnboard(page, {
    name: 'Platform Controls User',
    email,
    spaceName: `Controls workspace ${suffix}`
  });
  await page.request.post('/api/auth/logout');
  await page.goto('/login');
  await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password', { exact: true }).fill('Playwright-Test-Password-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();

  await page.goto('/admin/users');
  await page.getByLabel('Search users').fill(email);
  const userRow = page.getByRole('row').filter({ hasText: email });
  await expect(userRow).toBeVisible();
  await userRow.getByRole('link', { name: 'Open' }).click();

  await page.getByLabel('Role to grant').selectOption('analyst');
  await page.getByLabel('Required reason for role changes').fill('Temporary analytics access for the browser test.');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Grant role' }).click();
  await expect(page.getByText('analyst', { exact: true }).first()).toBeVisible();

  await page.getByLabel('Required reason for role changes').fill('Remove temporary analytics access after verification.');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Revoke analyst role' }).click();
  await expect(page.getByText('revoked', { exact: true }).first()).toBeVisible();

  await page.getByLabel('Account status').selectOption('suspended');
  await page.getByLabel('Required reason', { exact: true }).fill('Suspend briefly to verify the platform control.');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Apply status' }).click();
  await expect(page.getByText('suspended', { exact: true }).first()).toBeVisible();
  await page.getByLabel('Account status').selectOption('active');
  await page.getByLabel('Required reason', { exact: true }).fill('Restore the test account after access verification.');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Apply status' }).click();
  await expect(page.getByText('active', { exact: true }).first()).toBeVisible();

  await page.getByRole('link', { name: 'Open' }).first().click();
  await page.getByLabel('New space status').selectOption('suspended');
  await page.getByLabel('Reason for space status change').fill('Suspend briefly to verify workspace enforcement.');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Apply space status' }).click();
  await expect(page.getByText('suspended', { exact: true }).first()).toBeVisible();
  await page.getByLabel('New space status').selectOption('active');
  await page.getByLabel('Reason for space status change').fill('Restore the test workspace after enforcement verification.');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Apply space status' }).click();
  await expect(page.getByText('active', { exact: true }).first()).toBeVisible();
});

test('X social listening setup and journey maps remain visible while Terra work waits durably', async ({ page }, testInfo) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password', { exact: true }).fill('Playwright-Test-Password-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();

  await page.goto('/social-listening');
  await expect(page.getByRole('heading', { name: 'Social listening' })).toBeVisible();
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  await expect(page.getByRole('heading', { name: 'X accounts' })).toBeVisible();
  const initialXStatus = await (await page.request.get('/api/integrations/x')).json();
  if (initialXStatus.connections.length) await expect(page.getByText('disconnected', { exact: true })).toBeVisible();
  else await expect(page.getByText('No X account connected')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add X account' })).toBeDisabled();
  await page.route('**/api/integrations/x/mentions?limit=1000*', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Test mentions outage.' }) }));
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByText(/Some live data could not refresh/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'X accounts' })).toBeVisible();
  await page.unroute('**/api/integrations/x/mentions?limit=1000*');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByText(/Some live data could not refresh/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Platform X settings' }).click();
  const appDialog = page.getByRole('dialog', { name: 'Platform X developer app' });
  await expect(appDialog.getByText('http://127.0.0.1:5412/api/integrations/x/callback')).toBeVisible();
  await expect(page.getByLabel('OAuth 2 client ID')).toHaveValue('');
  await expect(page.getByLabel('Bearer token')).toHaveValue('');
  await page.getByLabel('OAuth 2 client ID').fill('incomplete-client-id');
  await expect(page.getByRole('button', { name: 'Save platform settings' })).toBeDisabled();
  await appDialog.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Platform X settings' }).click();
  await expect(page.getByLabel('OAuth 2 client ID')).toHaveValue('incomplete-client-id');
  await page.getByLabel('OAuth 2 client ID').fill('');
  await page.getByRole('dialog', { name: 'Platform X developer app' }).getByRole('button', { name: 'Cancel' }).click();

  await page.evaluate(async () => {
    const update = (body: Record<string, string>) => fetch('/api/integrations/x/app', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    await update({ consumerKey: 'playwright-consumer-key', consumerSecret: 'playwright-consumer-secret', accessToken: 'playwright-access-token', accessTokenSecret: 'playwright-access-secret' });
  });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Add X account' })).toBeEnabled();
  await expect(page.getByText('Pending account')).toBeVisible();
  await expect(page.getByText('pending verification', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sync latest 50' })).toBeVisible();
  for (const section of ['Listening (0)', 'Queries (0)', 'Intelligence (0)', 'Reply drafts (0)', 'Sync history', 'Connection']) {
    await expect(page.getByRole('button', { name: section })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Connection' }).click();
  await expect(page.getByRole('heading', { name: 'Connection settings' })).toBeVisible();
  await expect(page.getByText('Automatic sync')).toBeVisible();
  await page.evaluate(() => fetch('/api/integrations/x/app', {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ consumerKey: 'playwright-consumer-key-rotated', consumerSecret: 'playwright-consumer-secret-rotated' })
  }));
  await page.reload();
  await expect(page.getByText('reauthorization required', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sync latest 50' })).toHaveCount(0);
  await page.evaluate(() => fetch('/api/integrations/x/connection', { method: 'DELETE' }));
  await page.reload();
  await expect(page.getByText('disconnected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Connection' }).click();
  await expect(page.getByRole('button', { name: 'Reconnect through X' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete X history' })).toBeEnabled();
  if (process.env.CAPTURE_VISUALS) await page.screenshot({ path: testInfo.outputPath('social-listening-disconnected.png'), fullPage: true });
  await page.getByRole('button', { name: 'Platform X settings' }).click();
  await expect(page.getByRole('button', { name: 'Remove platform X app' })).toBeVisible();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Remove platform X app' }).click();
  await expect(page.getByText('disconnected', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add X account' })).toBeDisabled();
  if (process.env.CAPTURE_VISUALS) await page.screenshot({ path: testInfo.outputPath('social-listening.png'), fullPage: true });

  const journey = await page.evaluate(async (id) => {
    const response = await fetch('/api/journeys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      name: `Activation journey ${id}`, audience: 'New customers', objective: 'Improve activation', industry: 'B2B software', summary: 'A practical path from discovery to adoption.',
      stages: [
        { name: 'Discover', goal: 'Understand the value', touchpoints: ['Website'], customerActions: ['Compare options'], emotions: ['Curious'], painPoints: ['Unclear pricing'], metrics: ['Demo conversion'], opportunities: ['Clarify plans'], recommendedActions: ['Publish plan comparison'] },
        { name: 'Activate', goal: 'Reach first value', touchpoints: ['Product onboarding'], customerActions: ['Configure workspace'], emotions: ['Hopeful'], painPoints: ['Too many steps'], metrics: ['Time to value'], opportunities: ['Progressive setup'], recommendedActions: ['Reduce required fields'] },
        { name: 'Adopt', goal: 'Build a repeatable habit', touchpoints: ['Product', 'Email'], customerActions: ['Invite teammates'], emotions: ['Confident'], painPoints: ['Role confusion'], metrics: ['Weekly active teams'], opportunities: ['Role guidance'], recommendedActions: ['Add role-based checklist'] }
      ]
    }) });
    return response.json();
  }, suffix);
  await page.goto('/journeys');
  await expect(page.getByRole('heading', { name: 'Journey maps' })).toBeVisible();
  await expect(page.getByRole('heading', { name: journey.name, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Discover' })).toBeVisible();
  await expect(page.getByText('Evidence level: hypothesis')).toBeVisible();
  await expect(page.getByText('Clarify plans')).toBeVisible();
  await expect(page.getByText('Time to value')).toBeVisible();

  const viewportFits = await page.evaluate(() => ({ documentWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth }));
  expect(viewportFits.documentWidth).toBeLessThanOrEqual(viewportFits.viewportWidth + 1);

  const renamedJourney = `Activation evidence map ${suffix}`;
  await page.getByRole('button', { name: 'Edit details' }).click();
  const detailsDialog = page.getByRole('dialog', { name: 'Edit journey details' });
  await detailsDialog.getByLabel('Map name').fill(renamedJourney);
  await detailsDialog.getByLabel('Map summary').fill('An editable, evidence-aware path from discovery to product adoption.');
  await detailsDialog.getByRole('button', { name: 'Save details' }).click();
  await expect(page.getByRole('heading', { name: renamedJourney })).toBeVisible();

  await page.getByRole('button', { name: 'Stage 2: Activate' }).click();
  await expect(page.getByRole('heading', { name: 'Activate', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit stage' }).click();
  const stageDialog = page.getByRole('dialog', { name: 'Edit stage 2' });
  await stageDialog.getByLabel('Opportunities').fill('Progressive setup\nContextual guidance\nGuided checklist\nRole-based defaults\nSetup health score');
  await stageDialog.getByRole('button', { name: 'Save stage' }).click();
  await expect(page.getByText('Setup health score')).toBeVisible();

  await page.getByRole('button', { name: 'Move stage earlier' }).click();
  await expect(page.getByRole('button', { name: 'Stage 1: Activate' })).toHaveAttribute('aria-current', 'step');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Stage 1: Activate' })).toHaveAttribute('aria-current', 'step');
  await expect(page.getByText('Setup health score')).toBeVisible();

  await page.getByRole('button', { name: 'Add stage' }).first().click();
  const addStageDialog = page.getByRole('dialog', { name: 'Add journey stage' });
  await addStageDialog.getByLabel('Stage name').fill('Expand');
  await addStageDialog.getByLabel('Customer goal').fill('Introduce the product to another team');
  await addStageDialog.getByLabel('Opportunities').fill('Make successful adoption repeatable');
  await addStageDialog.getByLabel('Measures').fill('Teams invited per account');
  await addStageDialog.getByRole('button', { name: 'Add stage' }).click();
  await expect(page.getByRole('heading', { name: 'Expand', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stage 4: Expand' })).toHaveAttribute('aria-current', 'step');

  const csvDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const csvDownload = await csvDownloadPromise;
  expect(csvDownload.suggestedFilename()).toMatch(/journey-map-[a-f0-9]{16}\.csv$/);
  const jsonDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const jsonDownload = await jsonDownloadPromise;
  expect(jsonDownload.suggestedFilename()).toMatch(/journey-map-[a-f0-9]{16}\.json$/);

  if (process.env.CAPTURE_VISUALS) await page.screenshot({ path: testInfo.outputPath('journey-map.png'), fullPage: true });
  await expect(page.getByRole('heading', { name: 'Version history' })).toBeVisible();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: /^Restore / }).first().click();
  await expect(page.getByText('Earlier journey version restored. The displaced version is still available.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stage 4: Expand' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Audit and improve' }).click();
  await expect(page.getByText('Journey audit queued with Terra.')).toBeVisible();

  await page.goto('/ai-queue');
  await expect(page.getByText('Journey optimization').first()).toBeVisible();
  const currentJourney = await page.request.get(`/api/journeys/${journey.id}`);
  expect(currentJourney.status()).toBe(200);
  const deleted = await page.request.delete(`/api/journeys/${journey.id}`, { data: { expectedUpdatedAt: (await currentJourney.json()).updatedAt } });
  expect(deleted.status()).toBe(204);
});

test('journey live refresh never lets an older response overwrite a newer edit', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'One browser project exercises the ordered refresh guard');
  await page.goto('/login');
  await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password', { exact: true }).fill('Playwright-Test-Password-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();

  const journey = await page.evaluate(async (suffix) => {
    const response = await fetch('/api/journeys', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        name: `Refresh race journey ${suffix}`, audience: 'New customers', objective: 'Keep realtime edits ordered', industry: 'Software',
        summary: 'Summary captured by the deliberately delayed response.',
        stages: [{ name: 'Start', goal: 'Begin the journey', touchpoints: ['Website'], customerActions: ['Read'], emotions: ['Curious'], painPoints: [], metrics: ['Starts'], opportunities: [], recommendedActions: [] }]
      })
    });
    return response.json();
  }, Date.now());
  await page.goto('/journeys');
  await expect(page.getByText(journey.summary)).toBeVisible();

  let releaseOld!: () => void;
  let oldCaptured!: () => void;
  const releaseOldResponse = new Promise<void>((resolve) => { releaseOld = resolve; });
  const oldResponseCaptured = new Promise<void>((resolve) => { oldCaptured = resolve; });
  let heldOneResponse = false;
  await page.route('**/api/journeys', async (route) => {
    if (heldOneResponse) { await route.continue(); return; }
    heldOneResponse = true;
    const staleResponse = await route.fetch();
    oldCaptured();
    await releaseOldResponse;
    await route.fulfill({ response: staleResponse });
  });

  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await oldResponseCaptured;
  const newerSummary = 'This newer SSE-driven edit must remain visible.';
  const edited = await page.request.patch(`/api/journeys/${journey.id}`, { data: { expectedUpdatedAt: journey.updatedAt, summary: newerSummary } });
  expect(edited.status()).toBe(200);
  await expect(page.getByText(newerSummary)).toBeVisible();
  releaseOld();
  await expect(page.getByText(newerSummary)).toBeVisible();
  await expect(page.getByText(journey.summary)).toHaveCount(0);

  const current = await page.request.get(`/api/journeys/${journey.id}`);
  const deleted = await page.request.delete(`/api/journeys/${journey.id}`, { data: { expectedUpdatedAt: (await current.json()).updatedAt } });
  expect(deleted.status()).toBe(204);
});

test.skip('legacy survey translations remain hidden from the intelligence workspace', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'One desktop project exercises the saved-output refresh race');
  await page.goto('/login');
  await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password', { exact: true }).fill('Playwright-Test-Password-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();

  const suffix = `${Date.now()}`;
  const setup = await page.evaluate(async (value) => {
    const questionId = `translation-question-${value}`;
    const response = await fetch('/api/surveys', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        title: `Translation viewer ${value}`, description: 'A source survey for the saved translation viewer.',
        purpose: 'customer_experience', primaryMetric: 'custom', thankYouMessage: 'Thank you for responding.',
        questions: [{ id: questionId, page: 1, position: 0, type: 'single_choice', title: 'How was your visit?', description: 'Choose one answer.', required: true, options: ['Good', 'Poor'], settings: {}, logic: [] }]
      })
    });
    return { survey: await response.json(), questionId };
  }, suffix);

  const translation = {
    language: 'Spanish', title: 'Encuesta sobre la experiencia de visita',
    description: 'Una encuesta sobre la visita del cliente.', thankYouMessage: 'Gracias por responder.',
    questions: [{ questionId: setup.questionId, title: '¿Cómo fue su visita?', description: 'Elija una respuesta.', options: ['Buena', 'Mala'] }]
  };
  const savedInsight = { id: `saved-translation-${suffix}`, kind: 'translation', payload: translation, createdAt: new Date().toISOString() };
  let insightsRequestCount = 0;
  let translationQueued = false;
  let translationSubmissionCount = 0;
  let jobPollCount = 0;
  let releaseInitial!: () => void;
  let markInitialSeen!: () => void;
  let releaseTranslationPost!: () => void;
  let markTranslationPostSeen!: () => void;
  let releaseFirstJobPoll!: () => void;
  let markFirstJobPollSeen!: () => void;
  const initialRelease = new Promise<void>((resolve) => { releaseInitial = resolve; });
  const initialSeen = new Promise<void>((resolve) => { markInitialSeen = resolve; });
  const translationPostRelease = new Promise<void>((resolve) => { releaseTranslationPost = resolve; });
  const translationPostSeen = new Promise<void>((resolve) => { markTranslationPostSeen = resolve; });
  const firstJobPollRelease = new Promise<void>((resolve) => { releaseFirstJobPoll = resolve; });
  const firstJobPollSeen = new Promise<void>((resolve) => { markFirstJobPollSeen = resolve; });

  await page.route(`**/api/surveys/${setup.survey.id}/insights*`, async (route) => {
    insightsRequestCount += 1;
    if (insightsRequestCount === 1) {
      markInitialSeen();
      await initialRelease;
      await new Promise((resolve) => setTimeout(resolve, 150));
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(translationQueued ? [savedInsight] : []) });
    releaseInitial();
  });
  await page.route(`**/api/surveys/${setup.survey.id}/ai/translate`, async (route) => {
    translationSubmissionCount += 1;
    if (translationSubmissionCount > 1) {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Translation test failure.' }) });
      return;
    }
    translationQueued = true;
    markTranslationPostSeen();
    await translationPostRelease;
    await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ jobId: `translation-job-${suffix}`, state: 'queued' }) });
  });
  await page.route(`**/api/ai/jobs/translation-job-${suffix}`, async (route) => {
    jobPollCount += 1;
    if (jobPollCount === 1) {
      markFirstJobPollSeen();
      await firstJobPollRelease;
    }
    const completed = jobPollCount > 1;
    await route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({
        id: `translation-job-${suffix}`, kind: 'survey.translate', surveyId: setup.survey.id,
        state: completed ? 'completed' : 'processing', stage: completed ? 'completed' : 'running_terra', progress: completed ? 100 : 35, attempt: 1,
        input: { language: 'Spanish' }, result: completed ? { output: translation, runtime: {} } : null, error: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), completedAt: completed ? new Date().toISOString() : null
      })
    });
  });

  await page.goto(`/surveys/${setup.survey.id}`);
  await page.getByRole('tab', { name: 'Settings' }).click();
  const surveyDetails = page.getByRole('heading', { name: 'Survey details' }).locator('..').locator('..');
  await surveyDetails.getByRole('textbox').first().fill(`Translation viewer edited ${suffix}`);
  await page.getByRole('tab', { name: 'Terra AI' }).click();
  await expect(page.getByText('Save changes before using Terra so it works from the latest survey.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Translate', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: /Quality review/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Save changes before using Terra so it works from the latest survey.', { exact: true })).toHaveCount(0);
  await initialSeen;
  await page.getByLabel('Translate survey').fill('  Spanish  ');
  await page.getByRole('button', { name: 'Translate', exact: true }).click();
  const translationSection = page.getByLabel('Translate survey').locator('..').locator('..');
  await translationPostSeen;
  const queuingButton = page.getByRole('button', { name: 'Queuing', exact: true });
  await expect(queuingButton).toBeVisible();
  await expect(queuingButton).toBeDisabled();
  await expect(queuingButton).toHaveAttribute('aria-busy', 'true');
  await expect(translationSection.getByRole('status')).toContainText('Sending the Spanish translation request.');

  releaseTranslationPost();
  await firstJobPollSeen;
  await expect(page.getByRole('button', { name: 'Queued', exact: true })).toBeDisabled();
  await expect(translationSection.getByRole('status')).toContainText('Spanish translation queued. Waiting for Terra.');

  releaseFirstJobPoll();
  const translatingButton = page.getByRole('button', { name: 'Translating', exact: true });
  await expect(translatingButton).toBeVisible();
  await expect(translatingButton).toBeDisabled();
  await expect(translatingButton).toHaveAttribute('aria-busy', 'true');
  await expect(translationSection.getByRole('status')).toContainText('Translating survey into Spanish');
  await expect(translationSection.getByRole('status')).toContainText('35%');

  const savedRow = page.getByRole('button', { name: /Spanish translation/ });
  await expect(savedRow).toBeVisible();
  await expect(savedRow).toHaveAttribute('aria-expanded', 'true');
  await expect(translationSection.getByRole('status')).toContainText('Spanish translation saved.');
  const viewSavedTranslation = page.getByRole('button', { name: 'View saved translation', exact: true });
  await expect(viewSavedTranslation).toBeVisible();
  await expect(page.getByText(translation.title, { exact: true })).toBeVisible();
  await expect(page.getByText(translation.questions[0].title, { exact: false })).toBeVisible();
  await page.waitForTimeout(250);
  await expect(savedRow).toBeVisible();
  await expect(page.getByText(translation.title, { exact: true })).toBeVisible();
  if (process.env.CAPTURE_VISUALS) await page.screenshot({ path: testInfo.outputPath('saved-translation-viewer.png'), fullPage: true });

  await savedRow.click();
  await expect(savedRow).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText(translation.title, { exact: true })).toHaveCount(0);
  await viewSavedTranslation.click();
  await expect(savedRow).toBeFocused();
  await expect(savedRow).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText(translation.title, { exact: true })).toBeVisible();

  await page.getByLabel('Translate survey').fill('German');
  await page.getByRole('button', { name: 'Translate', exact: true }).click();
  await expect(translationSection.getByRole('alert')).toContainText('Translation test failure.');
  await expect(page.getByRole('button', { name: 'Translate', exact: true })).toBeEnabled();

  await page.evaluate((surveyId) => fetch(`/api/surveys/${surveyId}`, { method: 'DELETE' }), setup.survey.id);

  const emptySurvey = await page.evaluate(async (value) => {
    const response = await fetch('/api/surveys', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        title: `Empty translation guard ${value}`, purpose: 'customer_experience', primaryMetric: 'custom', questions: []
      })
    });
    return response.json();
  }, suffix);
  await page.goto(`/surveys/${emptySurvey.id}`);
  await page.getByRole('tab', { name: 'Terra AI' }).click();
  await expect(page.getByText('Add at least one question before translating.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Translate', exact: true })).toBeDisabled();
  await page.evaluate((surveyId) => fetch(`/api/surveys/${surveyId}`, { method: 'DELETE' }), emptySurvey.id);
});

test('completed survey intelligence opens from saved history and survives a stale history response', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'One desktop project exercises the saved-output refresh race');
  await page.goto('/login');
  await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password', { exact: true }).fill('Playwright-Test-Password-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();

  const suffix = `${Date.now()}`;
  const survey = await page.evaluate(async (value) => {
    const response = await fetch('/api/surveys', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        title: `Intelligence history ${value}`, description: 'A source survey for durable saved intelligence.',
        purpose: 'customer_experience', primaryMetric: 'custom', thankYouMessage: 'Thank you for responding.',
        questions: [{ id: `intelligence-question-${value}`, page: 1, position: 0, type: 'single_choice', title: 'How was your visit?', required: true, options: ['Good', 'Poor'], settings: {}, logic: [] }]
      })
    });
    return response.json();
  }, suffix);

  const intelligence = {
    executiveSummary: `Saved survey intelligence ${suffix}`,
    themes: [{ title: 'Reliable positive signal', evidence: ['response-1'] }],
    limitations: ['One completed response cannot establish a wider trend.']
  };
  const savedInsight = { id: `saved-intelligence-${suffix}`, kind: 'ai_insights', payload: intelligence, createdAt: new Date().toISOString() };
  let insightsRequestCount = 0;
  let intelligenceQueued = false;
  let jobPollCount = 0;
  let releaseInitial!: () => void;
  let markInitialSeen!: () => void;
  let releaseSubmission!: () => void;
  let markSubmissionSeen!: () => void;
  const initialRelease = new Promise<void>((resolve) => { releaseInitial = resolve; });
  const initialSeen = new Promise<void>((resolve) => { markInitialSeen = resolve; });
  const submissionRelease = new Promise<void>((resolve) => { releaseSubmission = resolve; });
  const submissionSeen = new Promise<void>((resolve) => { markSubmissionSeen = resolve; });

  await page.route(`**/api/surveys/${survey.id}/insights*`, async (route) => {
    insightsRequestCount += 1;
    if (insightsRequestCount === 1) {
      markInitialSeen();
      await initialRelease;
      await new Promise((resolve) => setTimeout(resolve, 150));
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(intelligenceQueued ? [savedInsight] : []) });
    releaseInitial();
  });
  await page.route(`**/api/surveys/${survey.id}/ai/insights`, async (route) => {
    intelligenceQueued = true;
    markSubmissionSeen();
    await submissionRelease;
    await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ jobId: `intelligence-job-${suffix}`, state: 'queued' }) });
  });
  await page.route(`**/api/ai/jobs/intelligence-job-${suffix}`, async (route) => {
    jobPollCount += 1;
    const completed = jobPollCount > 1;
    await route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({
        id: `intelligence-job-${suffix}`, kind: 'survey.insights', surveyId: survey.id,
        state: completed ? 'completed' : 'processing', stage: completed ? 'completed' : 'running_terra', progress: completed ? 100 : 45, attempt: 1,
        input: {}, result: completed ? { output: intelligence, runtime: {} } : null, error: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), completedAt: completed ? new Date().toISOString() : null
      })
    });
  });

  await page.goto(`/surveys/${survey.id}`);
  await page.getByRole('tab', { name: 'Settings' }).click();
  const surveyDetails = page.getByRole('heading', { name: 'Survey details' }).locator('..').locator('..');
  await surveyDetails.getByRole('textbox').first().fill(`Intelligence history edited ${suffix}`);
  await page.getByRole('tab', { name: 'Terra AI' }).click();
  await expect(page.getByText('Save changes before using Terra so it works from the latest survey.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Generate insights/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: /Quality review/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('Save changes before using Terra so it works from the latest survey.', { exact: true })).toHaveCount(0);
  await initialSeen;

  await page.getByRole('button', { name: /Generate insights/ }).click();
  await submissionSeen;
  await expect(page.getByRole('button', { name: /Generate insights/ })).toBeDisabled();
  releaseSubmission();

  const savedRow = page.getByRole('button', { name: /AI insights/ });
  await expect(savedRow).toBeVisible({ timeout: 20_000 });
  await expect(savedRow).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText(intelligence.executiveSummary, { exact: false })).toBeVisible();
  await page.waitForTimeout(250);
  await expect(savedRow).toBeVisible();
  await expect(page.getByText(intelligence.executiveSummary, { exact: false })).toBeVisible();

  await savedRow.click();
  await expect(savedRow).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText(intelligence.executiveSummary, { exact: false })).toHaveCount(0);
  await savedRow.click();
  await expect(savedRow).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText(intelligence.executiveSummary, { exact: false })).toBeVisible();

  await page.evaluate((surveyId) => fetch(`/api/surveys/${surveyId}`, { method: 'DELETE' }), survey.id);
});
