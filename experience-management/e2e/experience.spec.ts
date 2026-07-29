import { expect, test } from '@playwright/test';

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

  await page.getByRole('tab', { name: 'Collect' }).click();
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

test('social listening and journey maps remain visible while Terra work waits durably', async ({ page }, testInfo) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password').fill('Playwright-Test-Password-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await page.goto('/social-listening');
  await expect(page.getByRole('heading', { name: 'Social listening' })).toBeVisible();
  await page.getByLabel('Mention source').selectOption('google_play');
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  await page.getByLabel('Public mentions').fill(`Setup remained confusing ${suffix}\nSupport fixed the problem quickly ${suffix}`);
  await page.getByRole('button', { name: 'Import and analyze' }).click();
  await expect(page.getByText(`Setup remained confusing ${suffix}`)).toBeVisible();
  await expect(page.getByText(`Support fixed the problem quickly ${suffix}`)).toBeVisible();
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
  await expect(page.getByRole('heading', { name: 'Customer journeys' })).toBeVisible();
  await expect(page.getByText(journey.name).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Discover' })).toBeVisible();
  await expect(page.getByText('Time to value')).toBeVisible();
  if (process.env.CAPTURE_VISUALS) await page.screenshot({ path: testInfo.outputPath('journey-map.png'), fullPage: true });
  await page.getByRole('button', { name: 'Audit and improve' }).click();
  await expect(page.getByText('Journey audit queued with Terra.')).toBeVisible();

  await page.goto('/ai-queue');
  await expect(page.getByText('Social listening analysis').first()).toBeVisible();
  await expect(page.getByText('Journey optimization').first()).toBeVisible();
});
