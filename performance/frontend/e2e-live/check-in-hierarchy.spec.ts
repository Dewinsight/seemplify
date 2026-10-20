import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

async function api(request: APIRequestContext, actor: string, method: string, path: string, data?: unknown) {
  const response = await request.fetch(`http://127.0.0.1:5014/api/${path}`, { method, headers: { 'x-acceptance-actor': actor }, data });
  expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBeTruthy();
  return (await response.json()).data;
}
async function login(page: Page, actor: string) {
  await page.goto(`http://127.0.0.1:5014/__test/login/${actor}?path=/check-ins`);
  await expect(page.getByRole('button', { name: 'A', exact: true })).toBeVisible();
}

test('a parent manager reads and responds to a child-team lead while private and unmanaged check-ins remain protected', async ({ page, request }, info) => {
  const date = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
  const create = (actor: string, day: number, visibility = 'employee_manager') => api(request, actor, 'POST', 'check-ins', {
    employeeId: `acceptance-${actor}`, cadence: 'ad_hoc', periodStart: date(day), periodEnd: date(day), wins: [`Synthetic hierarchy update ${actor} ${day}`], visibility
  });
  const shared = await create('child_lead', -7);
  const privateNote = await create('child_lead', -6, 'employee_only');
  const unmanaged = await create('unmanaged', -5);
  await api(request, 'child_lead', 'POST', `check-ins/${shared._id}/submit`, {});
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 'parent_manager');
  await page.getByRole('combobox', { name: /^Employee/ }).click();
  await page.getByRole('option', { name: 'Acceptance child lead', exact: true }).click();
  const card = page.locator(`#check-in-${shared._id}`);
  await expect(card.getByText(shared.wins[0], { exact: true })).toBeVisible();
  await expect(page.locator(`#check-in-${privateNote._id}`)).toHaveCount(0);
  await card.getByRole('button', { name: 'Respond', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Respond to check-in', exact: true });
  const reply = 'Reviewed the child-team handover; I will resolve the fictional dependency.';
  await dialog.getByRole('textbox', { name: 'Manager response', exact: true }).fill(reply);
  const response = page.waitForResponse(value => value.request().method() === 'PATCH' && value.url().endsWith(`/api/check-ins/${shared._id}`));
  await dialog.getByRole('button', { name: 'Send response', exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(dialog).toBeHidden();
  await expect(card.getByText(reply, { exact: true })).toBeVisible();
  await page.reload();
  // The page's existing default after reload is My check-ins. Re-select the
  // same child employee before checking persisted manager-view content.
  await page.getByRole('combobox', { name: /^Employee/ }).click();
  await page.getByRole('option', { name: 'Acceptance child lead', exact: true }).click();
  await expect(page.locator(`#check-in-${shared._id}`).getByText(reply, { exact: true })).toBeVisible();
  await login(page, 'child_lead');
  await expect(page.locator(`#check-in-${shared._id}`).getByText(reply, { exact: true })).toBeVisible();
  await expect(page.locator(`#check-in-${privateNote._id}`)).toBeVisible();
  const saved = (await api(request, 'child_lead', 'GET', 'check-ins')).find((item: { _id: string }) => item._id === shared._id);
  expect(saved).toMatchObject({ wins: shared.wins, managerResponse: { text: reply, authorId: 'acceptance-parent_manager' } });
  await page.screenshot({ path: info.outputPath('child-lead-receives-parent-response-mobile.png'), fullPage: true, animations: 'disabled' });
  const headers = { 'x-acceptance-actor': 'parent_manager' };
  expect((await request.patch(`http://127.0.0.1:5014/api/check-ins/${privateNote._id}`, { headers, data: { managerResponse: 'Must not read or alter private notes.' } })).status()).toBe(403);
  expect((await request.get('http://127.0.0.1:5014/api/check-ins?employeeId=acceptance-unmanaged', { headers })).status()).toBe(403);
  expect((await request.patch(`http://127.0.0.1:5014/api/check-ins/${unmanaged._id}`, { headers, data: { managerResponse: 'Outside hierarchy.' } })).status()).toBe(403);
  expect((await request.post(`http://127.0.0.1:5014/api/check-ins/${shared._id}/submit`, { headers, data: {} })).status()).toBe(403);
  const foreign = await request.patch(`http://127.0.0.1:5014/api/check-ins/${shared._id}`, { headers: { 'x-acceptance-actor': 'foreign' }, data: { managerResponse: 'Foreign tenant.' } });
  expect(foreign.status()).toBe(403); // Existing assertResourceTenant contract.
  expect(await foreign.json()).toMatchObject({ success: false, error: 'Access denied' });
  const finalPrivate = (await api(request, 'child_lead', 'GET', 'check-ins')).find((item: { _id: string }) => item._id === privateNote._id);
  expect(finalPrivate.managerResponse?.text).toBeUndefined();
});
