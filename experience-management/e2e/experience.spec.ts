import { expect, test } from '@playwright/test';

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
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  expect(chunkRequests).toBe(2);
  expect(loginDocuments).toBe(2);
});

test('authenticated live refresh stream connects and emits its handshake', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'One browser project verifies the shared event stream');
  await page.goto('/login');
  await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password').fill('Playwright-Test-Password-2026!');
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

test('account signup and forgot-password entry points are complete', async ({ page }, testInfo) => {
  const email = `experience-${testInfo.project.name}-${Date.now()}@example.com`;
  await page.goto('/login');
  await expect(page.getByRole('link', { name: 'Create an account' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Forgot password?' })).toBeVisible();
  await page.getByRole('link', { name: 'Create an account' }).click();
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  await page.getByLabel('Name').fill('Experience Researcher');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Experience-Account-2026');
  await page.getByLabel('Confirm password').fill('Experience-Account-2026');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();
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
  await page.getByLabel('Password').fill('Playwright-Test-Password-2026!');
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
  await page.getByLabel('Password').fill('Playwright-Test-Password-2026!');
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
  await page.getByLabel('Password').fill('Playwright-Test-Password-2026!');
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
  await page.locator('#campaign-settings-survey').selectOption(setup.alternateSurveyId);
  await page.getByRole('tab', { name: /Schedule/ }).click();
  await expect(page.getByText('Start time required')).toBeVisible();
  await page.getByRole('tab', { name: /Setup/ }).click();
  await page.getByRole('button', { name: 'Save setup' }).click();
  await expect(page.locator('.page-description')).toContainText(setup.alternateSurveyTitle);
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
  await page.getByRole('button', { name: 'Launch campaign' }).click();
  await expect(page.getByText('active', { exact: true }).first()).toBeVisible();
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
  await page.getByLabel('Email').fill('qa@seemplify.local'); await page.getByLabel('Password').fill('Playwright-Test-Password-2026!'); await page.getByRole('button', { name: 'Sign in' }).click();
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
  await page.getByLabel('Password').fill('Playwright-Test-Password-2026!');
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

test('X social listening setup and journey maps remain visible while Terra work waits durably', async ({ page }, testInfo) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password').fill('Playwright-Test-Password-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();

  await page.goto('/social-listening');
  await expect(page.getByRole('heading', { name: 'Social listening' })).toBeVisible();
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  await expect(page.getByText('X connection')).toBeVisible();
  await expect(page.getByText('Setup required')).toBeVisible();
  await page.route('**/api/integrations/x/mentions?limit=1000', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Test mentions outage.' }) }));
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByText(/Some live data could not refresh/)).toBeVisible();
  await expect(page.getByText('Setup required')).toBeVisible();
  await page.unroute('**/api/integrations/x/mentions?limit=1000');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText(/Some live data could not refresh/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Configure X API' }).click();
  await expect(page.getByRole('dialog').getByText('Configure the X developer app')).toBeVisible();
  await expect(page.getByRole('dialog').getByText('http://127.0.0.1:5412/api/integrations/x/callback')).toBeVisible();
  await expect(page.getByLabel('API / Consumer key')).toHaveValue('');
  await expect(page.getByLabel('Bearer token')).toHaveValue('');
  await page.getByLabel('API / Consumer key').fill('incomplete-key');
  await expect(page.getByText('Enter the consumer key and consumer secret together.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save securely' })).toBeDisabled();
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Configure X API' }).click();
  await expect(page.getByLabel('API / Consumer key')).toHaveValue('');
  await page.getByRole('button', { name: 'Close' }).click();

  await page.evaluate(async () => {
    const update = (body: Record<string, string>) => fetch('/api/integrations/x/app', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    await update({ consumerKey: 'playwright-consumer-key', consumerSecret: 'playwright-consumer-secret', accessToken: 'playwright-access-token', accessTokenSecret: 'playwright-access-secret' });
    await update({ consumerKey: 'playwright-consumer-key-rotated', consumerSecret: 'playwright-consumer-secret-rotated' });
  });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Reconnect with X' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sync now' })).toHaveCount(0);
  await page.evaluate(() => fetch('/api/integrations/x/connection', { method: 'DELETE' }));
  await page.reload();
  await expect(page.getByText('OAuth access is off')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reconnect with X' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete history' })).toBeDisabled();
  if (process.env.CAPTURE_VISUALS) await page.screenshot({ path: testInfo.outputPath('social-listening-disconnected.png'), fullPage: true });
  await page.getByRole('button', { name: 'API settings' }).click();
  await expect(page.getByRole('button', { name: 'Remove X developer app' })).toBeVisible();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Remove X developer app' }).click();
  await expect(page.getByText('Setup required')).toBeVisible();
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
  await expect(page.getByText(journey.name).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Discover' })).toBeVisible();
  await expect(page.getByText('Time to value')).toBeVisible();
  if (process.env.CAPTURE_VISUALS) await page.screenshot({ path: testInfo.outputPath('journey-map.png'), fullPage: true });
  await page.getByRole('button', { name: 'Audit and improve' }).click();
  await expect(page.getByText('Journey audit queued with Terra.')).toBeVisible();

  await page.goto('/ai-queue');
  await expect(page.getByText('Journey optimization').first()).toBeVisible();
});
