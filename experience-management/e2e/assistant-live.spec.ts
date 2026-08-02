import { expect, test, type Page } from '@playwright/test';

test.skip(Boolean(process.env.PLAYWRIGHT_EXTERNAL_URL), 'The live assistant flow uses isolated local Nylas and Terra test services.');

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password').fill('Playwright-Test-Password-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();
}

async function openAssistant(page: Page) {
  const navigation = page.getByRole('button', { name: 'Open navigation' });
  if (await navigation.isVisible()) await navigation.click();
  await page.getByLabel('Primary navigation').getByRole('link', { name: 'Personal assistant' }).click();
  await expect(page.getByRole('heading', { name: 'Personal assistant' })).toBeVisible();
}

test('real assistant backend completes OAuth, reads a thread, and durably saves Terra summary and draft work', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'The real provider flow is covered once on desktop; mobile mailbox navigation has an isolated browser test.');
  await signIn(page);
  await openAssistant(page);

  await page.getByRole('button', { name: 'Connect Google' }).click();
  await expect(page).toHaveURL(/\/assistant(?:\?|$)/u);
  await expect(
    page.getByRole('main').getByRole('status').filter({ hasText: 'Mailbox connected successfully.' })
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /connected@example\.test/u })).toBeVisible();
  await expect(page.getByTestId('assistant-thread-playwright-thread')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Open assistant' }).click();

  await page.getByRole('button', { name: 'Summarise' }).click();
  await expect(page.getByText('Ada needs confirmation of the revised customer-risk section by Friday.')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('222 tokens')).toBeVisible();

  await page.getByRole('tab', { name: 'Reply' }).click();
  await page.getByRole('button', { name: 'Draft reply' }).click();
  await expect(page.getByText('Review required')).toBeVisible({ timeout: 20_000 });
  const draft = page.getByLabel('Reply', { exact: true });
  await expect(draft).toHaveValue(/confirm by Friday/u);
  await draft.fill('Hi Ada,\n\nI reviewed the revised section and will confirm by Friday.\n\nRegards');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText(/Revision 2/)).toBeVisible();
  await page.getByRole('button', { name: 'Close assistant' }).click();

  await page.getByRole('tab', { name: /History/ }).click();
  await expect(page.getByRole('button', { name: /Email summary/ }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Email draft/ }).first()).toBeVisible();

  const runs = await page.request.get('/api/assistant/runs');
  expect(runs.ok()).toBe(true);
  const history = await runs.json() as any[];
  const savedDraft = history.find((run) => run.kind === 'assistant.email_draft');
  expect(savedDraft.state).toBe('completed');
  expect(savedDraft.draft.body).toContain('I reviewed the revised section');
  expect(savedDraft.generatedDraft.body).toContain('I will review the revised section');
  expect(savedDraft.advisoryOnly).toBe(true);
  expect(savedDraft.externalDispatched).toBe(false);
});
