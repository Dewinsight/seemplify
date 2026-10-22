import { expect, test } from '@playwright/test';

test('directory refresh preserves an explicit keyboard recipient choice and persists feedback to that person', async ({ page, request }) => {
  await page.goto('http://127.0.0.1:5014/__test/login/department_head?path=/feedback');
  await expect(page.getByRole('button', { name: 'Account menu', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Give feedback', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Give feedback' });
  const recipient = dialog.getByRole('combobox', { name: /Recipient/ });
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let received!: () => void;
  const serverResponded = new Promise<void>(resolve => { received = resolve; });
  // All data and authorization come from the real API. Delay only delivery of
  // this actual response, so it arrives after the user highlights the roster.
  await page.route('**/api/user/search?q=employee%40example.test', async route => {
    const response = await route.fetch();
    received();
    await held;
    await route.fulfill({ response });
  });
  try {
    await recipient.fill('employee@example.test');
    await serverResponded;
    await expect(page.getByRole('option')).toHaveCount(1);
    await expect(page.getByRole('option')).toContainText('Acceptance employee');
    await recipient.press('ArrowDown');
    await expect(recipient).toHaveAttribute('aria-activedescendant', /option-0$/);
    release();
    await expect(dialog.getByRole('progressbar')).not.toBeVisible();
    await recipient.press('Enter');
    await expect(recipient).toHaveValue('Acceptance employee');
    await expect(page.getByRole('listbox')).not.toBeVisible();
    const message = `Keyboard directory refresh ${Date.now()}`;
    await dialog.getByRole('textbox', { name: /^Feedback/ }).fill(message);
    const sent = page.waitForResponse(response => response.url().endsWith('/api/feedback') && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Send feedback', exact: true }).click();
    const response = await sent;
    expect(response.ok()).toBeTruthy();
    expect(response.request().postDataJSON().receiverId).toBe('acceptance-employee');
    await expect(dialog).not.toBeVisible();
    const saved = await request.get('http://127.0.0.1:5014/api/feedback', { headers: { 'x-acceptance-actor': 'employee' } });
    expect(saved.ok()).toBeTruthy();
    expect((await saved.json()).data.find((item: { content?: string; message?: string }) => (item.content || item.message) === message)).toMatchObject({
      receiverId: 'acceptance-employee', senderId: 'acceptance-department_head',
    });
  } finally {
    release();
  }
});

test('changing the search clears the earlier keyboard choice even when the same person still matches', async ({ page }) => {
  await page.goto('http://127.0.0.1:5014/__test/login/department_head?path=/feedback');
  await expect(page.getByRole('button', { name: 'Account menu', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Give feedback', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Give feedback' });
  const recipient = dialog.getByRole('combobox', { name: /Recipient/ });
  await recipient.fill('employee@example.test');
  await expect(dialog.getByRole('progressbar')).not.toBeVisible();
  await expect(page.getByRole('option')).toHaveCount(1);
  await recipient.press('ArrowDown');
  await expect(recipient).toHaveAttribute('aria-activedescendant', /option-0$/);
  await recipient.fill('employee@');
  await expect(dialog.getByRole('progressbar')).not.toBeVisible();
  await expect(page.getByRole('option')).toContainText('Acceptance employee');
  await recipient.press('Enter');
  await expect(recipient).toHaveValue('employee@');
  await dialog.getByRole('textbox', { name: /^Feedback/ }).fill('A fictional handover was clearly documented.');
  await expect(dialog.getByRole('button', { name: 'Send feedback', exact: true })).toBeDisabled();
});
