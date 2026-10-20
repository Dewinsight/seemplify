import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

async function api(request: APIRequestContext, actor: string, method: string, path: string, data?: unknown, status = 200) {
  const response = await request.fetch(`http://127.0.0.1:5014/api/${path}`, { method, headers: { 'x-acceptance-actor': actor }, data });
  expect(response.status(), `${method} ${path}`).toBe(status); return (await response.json()).data;
}
async function login(page: Page) {
  await page.goto('http://127.0.0.1:5014/__test/login/hr_manager?path=%2Ftalent');
  await page.getByRole('button', { name: /^(Personal|Manager|Admin)$/ }).click(); await page.getByRole('menuitemradio', { name: /^Admin/ }).click(); await page.goto('/talent');
}

test('HR succession decisions, coverage updates and closure persist with audit and role denial', async ({ page, request }) => {
  const title = `Fictional succession ${Date.now()}`;
  const plan = await api(request, 'hr_manager', 'POST', 'talent/succession-plans', { role: { title, departmentName: 'Delivery', criticality: 'standard' }, state: 'active' }, 201);
  const nominated = await api(request, 'hr_manager', 'POST', `talent/succession-plans/${plan._id}/candidates`, { employeeId: 'acceptance-employee', readiness: 'ready_now', rationale: 'A human HR reviewer assessed the fictional delivery evidence.', strengths: ['Planning'], developmentGaps: ['Practice handover'] }, 201);
  const candidate = nominated.candidates[0];
  await api(request, 'employee', 'GET', 'talent/succession-plans', undefined, 403);
  await api(request, 'manager', 'PATCH', `talent/succession-plans/${plan._id}/candidates/${candidate._id}`, { state: 'confirmed' }, 403);
  await api(request, 'foreign', 'PATCH', `talent/succession-plans/${plan._id}`, { state: 'closed' }, 403);
  await login(page); await page.getByRole('tab', { name: 'Succession coverage' }).click();
  const row = page.getByRole('row').filter({ hasText: title }); await expect(row.getByText('Pipeline only', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Manage coverage' }).click();
  let details = page.getByRole('dialog', { name: `Succession coverage: ${title}` });
  await expect(details.getByText(candidate.rationale, { exact: true })).toBeVisible();
  await details.getByRole('button', { name: 'Confirm candidate', exact: true }).click();
  let decision = page.getByRole('dialog', { name: 'Confirm succession candidate?' }); await decision.getByRole('button', { name: 'Confirm candidate', exact: true }).click(); await expect(decision).toBeHidden();
  await expect(details.getByText('Confirmed', { exact: true })).toBeVisible(); await details.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(row.getByText('1 ready now', { exact: true })).toBeVisible();
  await page.reload(); await page.getByRole('tab', { name: 'Succession coverage' }).click(); await page.getByRole('row').filter({ hasText: title }).getByRole('button', { name: 'Manage coverage' }).click();
  details = page.getByRole('dialog', { name: `Succession coverage: ${title}` });
  await details.getByRole('button', { name: 'Remove candidate', exact: true }).click(); decision = page.getByRole('dialog', { name: 'Remove succession candidate?' }); await decision.getByRole('button', { name: 'Remove candidate', exact: true }).click(); await expect(decision).toBeHidden();
  await details.getByRole('button', { name: 'Edit coverage' }).click(); const edit = page.getByRole('dialog', { name: 'Edit succession coverage' });
  await edit.getByLabel('Criticality', { exact: true }).click(); await page.getByRole('option', { name: 'Critical', exact: true }).click();
  await edit.getByLabel('Review date').fill('2027-02-01'); await edit.getByLabel('Coverage state').click(); await page.getByRole('option', { name: 'Closed', exact: true }).click();
  await edit.getByRole('button', { name: 'Close coverage', exact: true }).click(); await expect(edit).toBeHidden();
  await page.reload(); await page.getByRole('tab', { name: 'Succession coverage' }).click();
  const closed = page.getByRole('row').filter({ hasText: title }); await expect(closed.getByText('Closed', { exact: true })).toBeVisible(); await expect(closed.getByRole('button', { name: 'Add candidate' })).toHaveCount(0);
  await closed.getByRole('button', { name: 'Manage coverage' }).click(); await expect(page.getByRole('dialog').getByText('Removed', { exact: true })).toBeVisible();
  const records = await api(request, 'hr_manager', 'GET', 'talent/succession-plans');
  const saved = records.find((record: { _id: string }) => record._id === plan._id);
  expect(saved).toMatchObject({ state: 'closed', role: { title, criticality: 'critical' }, reviewDate: '2027-02-01T00:00:00.000Z' });
  expect(saved.candidates[0]).toMatchObject({ _id: candidate._id, state: 'removed', readiness: 'ready_now', rationale: candidate.rationale, confirmedBy: 'acceptance-hr_manager' });
  expect(saved.candidates[0].confirmedAt).toBeTruthy();
  expect(saved.audit.map((event: { action: string }) => event.action)).toEqual(expect.arrayContaining(['created', 'candidate_nominated', 'candidate_confirmed', 'candidate_removed', 'plan_updated']));
  expect(saved.audit.every((event: { actorId: string }) => event.actorId === 'acceptance-hr_manager')).toBeTruthy();
});
