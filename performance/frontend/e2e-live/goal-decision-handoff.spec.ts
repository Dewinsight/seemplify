import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
async function api(request: APIRequestContext, actor: string, method: string, path: string, data?: unknown) {
  const response = await request.fetch(`http://127.0.0.1:5014/api/${path}`, { method, headers: { 'x-acceptance-actor': actor }, data });
  expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBeTruthy();
  return (await response.json()).data;
}
async function openGoals(page: Page, actor: string, period: string, approvals = false) {
  const path = `/okrs${approvals ? '?view=approvals' : ''}`;
  await page.goto(`http://127.0.0.1:5014/__test/login/${actor}?path=${encodeURIComponent(path)}`);
  await expect(page.getByRole('button', { name: 'Account menu', exact: true })).toBeVisible();
  if (actor === 'manager') {
    if ((page.viewportSize()?.width || 1280) < 1024) {
      await page.getByRole('button', { name: 'Open menu', exact: true }).click();
      await page.getByRole('button', { name: /^Manager / }).click();
    } else {
      await page.getByRole('button', { name: /^(Personal|Manager|Admin)$/ }).click();
      await page.getByRole('menuitemradio', { name: /^Manager/ }).click();
    }
    await page.goto(path);
  }
  await page.getByRole('combobox', { name: /^Period/ }).click();
  await page.getByRole('option', { name: period, exact: true }).click();
}
async function pendingGoal(request: APIRequestContext, suffix: string) {
  const stamp = Date.now();
  const period = await api(request, 'hr_manager', 'POST', 'goal-periods', { name: `Decision handoff ${suffix} ${stamp}`, code: `HANDOFF-${stamp}`, startDate: day(-1), endDate: day(60), status: 'open' });
  const goal = await api(request, 'employee', 'POST', 'okrs', { title: `Synthetic ${suffix} decision ${stamp}`, type: 'individual', periodId: period._id,
    objectives: [{ title: 'Measure the fictional handover', weight: 100, keyResults: [{ title: 'Record agreed evidence', targetValue: 100 }] }] });
  await api(request, 'employee', 'POST', `okrs/${goal._id}/submit`, {});
  return { period, goal };
}

test('manager reason reaches the employee card and edit dialog then clears from the current handoff after resubmission', async ({ page, request }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { period, goal } = await pendingGoal(request, 'revision');
  const reason = 'Add the baseline and target for the fictional handover.\nExplain how the evidence will be measured.';
  await openGoals(page, 'manager', period.name, true);
  const card = page.locator(`#goal-${goal._id}`);
  await card.getByRole('button', { name: 'Request changes', exact: true }).click();
  const decision = page.getByRole('dialog', { name: 'Request Changes', exact: true });
  await decision.getByRole('textbox', { name: 'Reason', exact: true }).fill(reason);
  await decision.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(decision).toBeHidden();
  const changed = await api(request, 'employee', 'GET', `okrs/${goal._id}`);
  expect(changed.lifecycle).toMatchObject({ state: 'changes_requested', decision: 'request_changes', decisionComment: reason, decidedBy: { userId: 'acceptance-manager' } });
  await openGoals(page, 'employee', period.name);
  await expect(card.getByText(reason, { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('combobox', { name: /^Period/ }).click(); await page.getByRole('option', { name: period.name, exact: true }).click();
  await expect(card.getByText(reason, { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Edit goal', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit goal', exact: true });
  await expect(edit.getByText(reason, { exact: true })).toBeVisible();
  await expect(edit.getByRole('alert').filter({ hasText: 'Decision reason' })).toContainText('Acceptance manager');
  await page.screenshot({ path: info.outputPath('employee-goal-decision-edit-mobile.png'), fullPage: true, animations: 'disabled' });
  const revisedTitle = `${goal.title} clarified`;
  await edit.getByRole('textbox', { name: 'Goal title', exact: true }).fill(revisedTitle);
  await edit.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(edit).toBeHidden();
  await card.getByRole('button', { name: 'Submit for approval', exact: true }).click();
  await expect(page.getByText('Goal submitted for approval.', { exact: true })).toBeVisible();
  await expect(card.getByText(reason, { exact: true })).toHaveCount(0);
  const submitted = await api(request, 'employee', 'GET', `okrs/${goal._id}`);
  expect(submitted).toMatchObject({ title: revisedTitle, lifecycle: { state: 'pending_approval' } });
  // Existing history fields can survive resubmission, but are not the current
  // decision. A new approval without a comment resets its decision payload.
  await api(request, 'manager', 'POST', `okrs/${goal._id}/decision`, { decision: 'approve' });
  const approved = await api(request, 'employee', 'GET', `okrs/${goal._id}`);
  expect(approved.lifecycle).toMatchObject({ state: 'active', decision: 'approve' });
  expect(approved.lifecycle.decisionComment).toBeUndefined();
  await page.reload();
  await page.getByRole('combobox', { name: /^Period/ }).click(); await page.getByRole('option', { name: period.name, exact: true }).click();
  await expect(card.getByText(revisedTitle, { exact: true })).toBeVisible();
  await expect(card.getByText(reason, { exact: true })).toHaveCount(0);
  expect((await request.get(`http://127.0.0.1:5014/api/okrs/${goal._id}`, { headers: { 'x-acceptance-actor': 'foreign' } })).status()).toBe(404);
});

test('rejected goal retains its authorized decision reason after reload without adding edit permission', async ({ page, request }, info) => {
  const { period, goal } = await pendingGoal(request, 'rejection');
  const reason = 'This fictional proposal duplicates an existing agreed objective.';
  await api(request, 'manager', 'POST', `okrs/${goal._id}/decision`, { decision: 'reject', comment: reason });
  await openGoals(page, 'employee', period.name);
  const card = page.locator(`#goal-${goal._id}`);
  await expect(card.getByText(reason, { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('combobox', { name: /^Period/ }).click(); await page.getByRole('option', { name: period.name, exact: true }).click();
  await expect(card.getByText(reason, { exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Edit goal', exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('rejected-goal-decision-reason.png'), fullPage: true, animations: 'disabled' });
});
