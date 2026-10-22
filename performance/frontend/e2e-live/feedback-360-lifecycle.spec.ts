import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

async function api(request: APIRequestContext, actor: string, method: string, path: string, data?: unknown) {
  const response = await request.fetch(`http://127.0.0.1:5014/api/${path}`, { method, headers: { 'x-acceptance-actor': actor }, data });
  expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBeTruthy();
  return (await response.json()).data;
}
async function login(page: Page, actor: string, path = '/feedback') {
  await page.goto(`http://127.0.0.1:5014/__test/login/${actor}?path=${encodeURIComponent(path)}`);
  await expect(page.getByRole('button', { name: 'Account menu', exact: true })).toBeVisible();
}

test('employee requests anonymous 360 feedback and five real reviewers unlock only anonymous subject responses', async ({ page, request }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const actors = ['peer', 'team_lead', 'manager', 'hr_manager', 'department_head'];
  const contextLabel = `Real 360 cohort ${Date.now()}`;
  const cohortCard = page.getByRole('article', { name: `${contextLabel} for Acceptance employee`, exact: true });
  await login(page, 'employee');
  await page.getByRole('button', { name: 'Request feedback', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Request feedback', exact: true });
  await expect(dialog.getByRole('combobox', { name: 'Feedback about', exact: true })).toHaveValue(/Acceptance employee/);
  const reviewers = dialog.getByRole('combobox', { name: 'Reviewers', exact: true });
  for (const actor of actors.slice(0, 4)) {
    await reviewers.fill(`${actor}@example.test`);
    await page.getByRole('option', { name: new RegExp(`Acceptance ${actor.replaceAll('_', ' ')}`) }).click();
  }
  await dialog.getByRole('combobox', { name: /^Reviewer identity/ }).click();
  await page.getByRole('option', { name: /Anonymous/ }).click();
  await dialog.getByRole('textbox', { name: 'Request label', exact: true }).fill(contextLabel);
  await dialog.getByRole('textbox', { name: 'Due date', exact: true }).fill(new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
  await dialog.getByRole('button', { name: 'Review request', exact: true }).click();
  await expect(dialog.getByText('Choose at least five distinct reviewers for anonymous 360 feedback.', { exact: true })).toBeVisible();
  await reviewers.fill('employee@example.test');
  await expect(page.getByRole('option', { name: /Acceptance employee/ })).toHaveCount(0);
  await reviewers.fill('department_head@example.test');
  await page.getByRole('option', { name: /Acceptance department head/ }).click();
  await dialog.getByRole('button', { name: 'Review request', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Review feedback request', exact: true });
  await expect(dialog.getByText('Reviewers (5)', { exact: true })).toBeVisible();
  const createdResponse = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/api/feedback/requests'));
  await dialog.getByRole('button', { name: 'Send request', exact: true }).click();
  const created = await createdResponse;
  expect(created.status()).toBe(201);
  expect(created.request().headers()['idempotency-key']).toMatch(/^[a-f0-9-]{36}$/);
  const createdData = (await created.json()).data;
  expect(createdData).toHaveLength(1);
  expect(createdData[0]).toMatchObject({ kind: 'cohort', reviewerCount: 5, responseCount: null, reportable: false });
  for (const field of ['_id', 'reviewerId', 'reviewerInfo', 'fulfilledByFeedbackId', 'createdAt']) expect(createdData[0]).not.toHaveProperty(field);
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('tab', { name: 'Requested by me', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(cohortCard.getByText(/5 invited · Collecting responses/)).toBeVisible();
  await page.screenshot({ path: info.outputPath('anonymous-360-request-created-mobile.png'), fullPage: true });
  const feedbackIds: string[] = [];
  for (const [index, actor] of actors.entries()) {
    const invitation = (await api(request, actor, 'GET', 'feedback/requests?view=reviewer')).find((item: { contextLabel: string }) => item.contextLabel === contextLabel);
    expect(invitation.reviewerId).toBe(`acceptance-${actor}`);
    await login(page, actor, `/feedback?request=${invitation._id}`);
    const card = page.locator(`#feedback-${invitation._id}`);
    await card.getByRole('button', { name: 'Accept', exact: true }).click();
    await expect(card.getByText('accepted', { exact: true })).toBeVisible();
    await card.getByRole('button', { name: 'Give feedback', exact: true }).click();
    const compose = page.getByRole('dialog', { name: 'Give feedback', exact: true });
    await expect(compose.getByRole('combobox').filter({ hasText: '360 feedback' })).toBeDisabled();
    const content = `Cohort response ${index + 1}: the documented handover improved the team delivery.`;
    await compose.getByRole('textbox', { name: /^Feedback/ }).fill(content);
    await compose.getByRole('button', { name: 'Send feedback', exact: true }).click();
    await expect(compose).toBeHidden();
    const sent = (await api(request, actor, 'GET', 'feedback/sent')).find((item: { message: string }) => item.message === content);
    feedbackIds.push(sent._id);
    if (index === 3) {
      const received = await api(request, 'employee', 'GET', 'feedback/received');
      expect(received.filter((item: { contextLabel: string }) => item.contextLabel === contextLabel)).toHaveLength(0);
      const hr = await api(request, 'hr_manager', 'GET', 'feedback?userId=acceptance-employee');
      expect(hr.filter((item: { contextLabel: string }) => item.contextLabel === contextLabel)).toHaveLength(0);
      await login(page, 'employee');
      await page.getByRole('tab', { name: 'About me', exact: true }).click();
      await expect(cohortCard.getByText(/5 invited · Collecting responses/)).toBeVisible();
      const summary = (await api(request, 'employee', 'GET', 'feedback/requests?view=subject')).find((item: { contextLabel: string }) => item.contextLabel === contextLabel);
      expect(summary).toMatchObject({ responseCount: null, reportable: false, state: 'collecting' });
      await expect(cohortCard.getByRole('button', { name: 'View received responses', exact: true })).toHaveCount(0);
      expect((await request.post(`http://127.0.0.1:5014/api/feedback/${feedbackIds[0]}/acknowledge`, { headers: { 'x-acceptance-actor': 'employee' } })).status()).toBe(404);
    }
  }
  await login(page, 'employee');
  await page.getByRole('tab', { name: 'About me', exact: true }).click();
  await expect(cohortCard.getByText(/5 invited · 5 responses available/)).toBeVisible();
  await cohortCard.getByRole('button', { name: 'View received responses', exact: true }).click();
  const cohortResponses = page.locator('[id^="feedback-"]').filter({ has: page.getByText(contextLabel, { exact: true }) });
  await expect(cohortResponses).toHaveCount(5);
  await expect(cohortResponses.getByText('Anonymous', { exact: true })).toHaveCount(5);
  await expect(cohortResponses.getByText('Invalid Date', { exact: true })).toHaveCount(0);
  for (const actor of actors) await expect(cohortResponses.getByText(`Acceptance ${actor.replaceAll('_', ' ')}`, { exact: true })).toHaveCount(0);
  const received = (await api(request, 'employee', 'GET', 'feedback/received')).filter((item: { contextLabel: string }) => item.contextLabel === contextLabel);
  expect(received).toHaveLength(5);
  for (const item of received) {
    expect(item.senderId).toBeNull(); expect(item).not.toHaveProperty('requestId'); expect(item).not.toHaveProperty('date');
  }
  await page.screenshot({ path: info.outputPath('anonymous-360-published-responses-mobile.png'), fullPage: true });
  const foreign = await request.get(`http://127.0.0.1:5014/api/feedback/${feedbackIds[0]}`, { headers: { 'x-acceptance-actor': 'foreign' } });
  expect(foreign.status()).toBe(403);
  expect(await api(request, 'foreign', 'GET', 'feedback/requests?view=subject')).toEqual([]);
});

test('an employee can answer an authorized manager-audience invitation without gaining standalone manager-only sending', async ({ page, request }) => {
  const contextLabel = `Authorized employee response ${Date.now()}`;
  const invitations = await api(request, 'hr_manager', 'POST', 'feedback/requests', {
    subjectId: 'acceptance-manager', reviewerIds: ['acceptance-employee'], dueDate: new Date(Date.now() + 7 * 86400000).toISOString(),
    contextType: 'peer', contextLabel, anonymity: 'named', visibility: 'manager-only', questions: ['What helped the fictional delivery?']
  });
  expect(invitations).toHaveLength(1);
  await login(page, 'employee', `/feedback?request=${invitations[0]._id}`);
  const card = page.locator(`#feedback-${invitations[0]._id}`);
  await card.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(card.getByText('accepted', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Give feedback', exact: true }).click();
  const compose = page.getByRole('dialog', { name: 'Give feedback', exact: true });
  await expect(compose.getByRole('combobox').filter({ hasText: 'Employee and permitted managers' })).toBeDisabled();
  await expect(compose.getByRole('combobox', { name: 'Recipient', exact: true })).toBeDisabled();
  const content = 'The fictional planning handover made the review actionable.';
  await compose.getByRole('textbox', { name: /^Feedback/ }).fill(content);
  const submitted = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/api/feedback'));
  await compose.getByRole('button', { name: 'Send feedback', exact: true }).click();
  expect((await submitted).status()).toBe(201);
  await expect(compose).toBeHidden();
  const saved = (await api(request, 'employee', 'GET', 'feedback/sent')).find((item: { message: string }) => item.message === content);
  expect(saved).toMatchObject({ receiverId: 'acceptance-manager', visibility: 'manager-only', contextType: 'peer', contextLabel, requestId: invitations[0]._id });
  expect((await api(request, 'manager', 'GET', 'feedback/received')).some((item: { _id: string }) => item._id === saved._id)).toBe(true);
  expect((await request.post('http://127.0.0.1:5014/api/feedback', { headers: { 'x-acceptance-actor': 'employee' }, data: { receiverId: 'acceptance-manager', content: 'Standalone employee access remains denied.', visibility: 'manager-only' } })).status()).toBe(403);
});
