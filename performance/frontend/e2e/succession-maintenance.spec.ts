import { expect, test, type Page } from '@playwright/test';

async function install(page: Page, role: 'hr' | 'manager' | 'employee' = 'hr', denied = false) {
  const org = { id: 'org-1', name: 'Fictional QA', role: role === 'hr' ? 'hr_manager' : 'staff', authorization: { permissionsByApp: { 'performance-management': denied ? [] : ['succession:manage'] } } };
  const user = { id: 'hr-1', sub: 'hr-1', name: 'HR QA', email: 'qa@example.test', organizations: [org], idpOrganizations: [org] };
  const candidate = { _id: 'candidate-1', employee: { userId: 'employee-1', name: 'Fictional employee' }, readiness: 'ready_now', rationale: 'Observed fictional evidence supports the nominated readiness.', strengths: ['Planning'], developmentGaps: ['Practice handover'], state: 'proposed', confirmedAt: undefined as string | undefined };
  const plan = { _id: 'plan-1', role: { title: 'Fictional critical role', criticality: 'standard', departmentName: 'Delivery' }, state: 'active', reviewDate: '2026-12-01', candidates: [candidate] };
  const review = { _id: 'review-1', name: 'Closed fictional review', state: 'closed', sourceCycle: { name: 'Fictional final cycle' }, entries: [{ _id: 'entry-1', employee: candidate.employee, evidenceSnapshot: { finalRating: 4, finalizedAt: '2026-10-19' }, performanceBand: 'strong', potential: 'high', readiness: 'ready_now', rationale: candidate.rationale, strengths: ['Planning'], decisionState: 'calibrated', aiBriefs: [] }] };
  let candidateFailures = 1, coverageFailures = 1;
  const writes: string[] = [];
  await page.addInitScript(({ role }) => { localStorage.setItem('accessToken', 'synthetic-local-only'); localStorage.setItem('performance-workspace:org-1:hr-1', role === 'hr' ? 'admin' : role === 'manager' ? 'manager' : 'personal'); }, { role });
  await page.route('**/__mock-api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname.slice('/__mock-api'.length);
    const send = (data: unknown, status = 200, error = '') => route.fulfill({ status, json: { success: status < 400, data, ...(error ? { error } : {}) } });
    if (path === '/auth/me') return route.fulfill({ json: { user, currentOrganization: org, currentOrganizationId: org.id } });
    if (path === '/user/context') return send({ user, organization: org, role: { name: role === 'hr' ? 'hr_admin' : role === 'manager' ? 'line_manager' : 'employee', isManager: role !== 'employee', isHRAdmin: role === 'hr' }, teams: [], features: { talentPlanning: true, canonicalAppraisals: true, notifications: true } });
    if (path === '/user/current-team') return send({ currentTeam: null, availableTeams: [] });
    if (path === '/notifications/counts') return send({ unread: 0, actionable: 0 });
    if (path === '/talent/reviews') return req.method() === 'GET' ? send([review]) : send(null, 400, 'Final source evidence is required.');
    if (path === '/talent/signals') return send({ signals: [] });
    if (path === '/talent/succession-plans') return send([plan]);
    if (path === '/appraisals/cycles') return send([{ _id: 'cycle-1', name: 'Fictional final cycle' }]);
    if (req.method() === 'PATCH' && path.endsWith('/candidates/candidate-1')) { writes.push('candidate'); if (candidateFailures-- > 0) return send(null, 503, 'Candidate save failed. Retry.'); Object.assign(candidate, req.postDataJSON(), { confirmedAt: '2026-10-20T08:30:00Z' }); return send(plan); }
    if (req.method() === 'PATCH' && path === '/talent/succession-plans/plan-1') { writes.push('coverage'); if (coverageFailures-- > 0) return send(null, 503, 'Coverage save failed. Retry.'); const body = req.postDataJSON(); plan.state = body.state; plan.reviewDate = body.reviewDate; plan.role.criticality = body.criticality; return send(plan); }
    return send([]);
  });
  return { plan, writes };
}

test('HR reads evidence, retries explicit decisions, removes candidate and closes retained coverage', async ({ page }, testInfo) => {
  const state = await install(page); await page.goto('/talent'); await page.getByRole('tab', { name: 'Succession coverage' }).click();
  await expect(page.getByText('Pipeline only', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Manage coverage' }).click();
  const details = page.getByRole('dialog', { name: 'Succession coverage: Fictional critical role' });
  await expect(details.getByText('Practice handover', { exact: false })).toBeVisible();
  await details.getByRole('button', { name: 'Confirm candidate', exact: true }).click();
  const decision = page.getByRole('dialog', { name: 'Confirm succession candidate?' });
  await expect(decision.getByText(state.plan.candidates[0].rationale)).toBeVisible();
  await decision.getByRole('button', { name: 'Confirm candidate', exact: true }).click(); await expect(decision.getByRole('alert')).toContainText('Candidate save failed');
  expect(state.plan.candidates[0].state).toBe('proposed');
  await decision.getByRole('button', { name: 'Confirm candidate', exact: true }).click(); await expect(decision).toBeHidden();
  await expect(details.getByText('Confirmed', { exact: true })).toBeVisible();
  await details.getByRole('button', { name: 'Remove candidate', exact: true }).click();
  const remove = page.getByRole('dialog', { name: 'Remove succession candidate?' }); await remove.getByRole('button', { name: 'Remove candidate', exact: true }).click(); await expect(remove).toBeHidden();
  await expect(details.getByText('Removed', { exact: true })).toBeVisible();
  await details.getByRole('button', { name: 'Edit coverage' }).click(); const edit = page.getByRole('dialog', { name: 'Edit succession coverage' });
  await edit.getByLabel('Criticality', { exact: true }).click(); await page.getByRole('option', { name: 'Critical', exact: true }).click();
  await edit.getByLabel('Review date').fill('2027-02-01'); await edit.getByLabel('Coverage state').click(); await page.getByRole('option', { name: 'Closed', exact: true }).click();
  await edit.getByRole('button', { name: 'Close coverage', exact: true }).click(); await expect(edit.getByRole('alert').filter({ hasText: 'Coverage save failed' })).toBeVisible();
  await expect(edit.getByLabel('Review date')).toHaveValue('2027-02-01');
  await page.screenshot({ path: testInfo.outputPath('succession-retained-decision.png'), animations: 'disabled' });
  await edit.getByRole('button', { name: 'Close coverage', exact: true }).click(); await expect(edit).toBeHidden();
  expect(state.plan).toMatchObject({ state: 'closed', reviewDate: '2027-02-01', role: { criticality: 'critical' } });
  await page.reload(); await page.getByRole('tab', { name: 'Succession coverage' }).click(); await page.getByRole('button', { name: 'Manage coverage' }).click();
  await expect(details.getByText('Removed', { exact: true })).toBeVisible(); await expect(details.getByText('This coverage is closed.', { exact: false })).toBeVisible();
  await expect(details.getByRole('button', { name: 'Confirm candidate' })).toHaveCount(0); await expect(details.getByRole('button', { name: 'Remove candidate' })).toHaveCount(0);
  expect(state.writes).toEqual(['candidate', 'candidate', 'candidate', 'coverage', 'coverage']);
});

for (const role of ['manager', 'employee'] as const) test(`${role} has no succession management controls`, async ({ page }) => {
  await install(page, role); await page.goto('/talent');
  if (role === 'employee') await expect(page.getByText('Talent planning is available in Manager or Admin workspace.')).toBeVisible();
  else await expect(page.getByRole('tab', { name: 'Talent reviews' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Succession coverage' })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Manage coverage' })).toHaveCount(0);
});

test('HR explicit denied succession grant hides actions', async ({ page }) => {
  await install(page, 'hr', true); await page.goto('/talent'); await page.getByRole('tab', { name: 'Succession coverage' }).click();
  await expect(page.getByText('Your current permissions do not allow succession management.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add critical role' })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Manage coverage' })).toHaveCount(0);
});

test('closed talent review details retain saved values without editing or AI actions', async ({ page }) => {
  await install(page); await page.goto('/talent'); await page.getByRole('button', { name: /Fictional employee.*Ready now/ }).click();
  const dialog = page.getByRole('dialog', { name: 'View Fictional employee' });
  await expect(dialog.getByText('Its saved decisions and evidence are read-only.', { exact: false })).toBeVisible();
  await expect(dialog.getByLabel('Evidence-based rationale')).toHaveValue('Observed fictional evidence supports the nominated readiness.');
  await expect(dialog.getByLabel('Evidence-based rationale')).toBeDisabled();
  await expect(dialog.getByRole('button', { name: /Save proposal|Save calibrated decision|Create evidence brief|Accept as discussion|Reject/ })).toHaveCount(0);
});

test('opening role creation clears unrelated review creation error', async ({ page }) => {
  await install(page); await page.goto('/talent'); await page.getByRole('button', { name: 'New talent review' }).click();
  const create = page.getByRole('dialog', { name: /Create talent review/ });
  await create.getByLabel('Review name').fill('Fictional new review'); await create.getByLabel('Completed appraisal cycle').click(); await page.getByRole('option', { name: /Fictional final cycle/ }).click();
  await create.getByRole('button', { name: 'Create review' }).click(); await expect(create.getByRole('alert').filter({ hasText: 'Final source evidence is required.' })).toBeVisible();
  await create.getByRole('button', { name: 'Cancel' }).click(); await page.getByRole('tab', { name: 'Succession coverage' }).click(); await page.getByRole('button', { name: 'Add critical role' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveCount(0);
});
