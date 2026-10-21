import { expect, test, type Page } from '@playwright/test';

// User-visible state contracts with synthetic transport. Server transition
// enforcement and persisted production history are verified separately.
const appraisalId = '0123456789abcdef01234568';
async function install(page: Page, status: string, rating = 3) {
  const user = { id: 'reviewer', sub: 'reviewer', name: 'Synthetic Reviewer', email: 'reviewer@example.test' };
  const organization = { id: 'calibration-org', name: 'Synthetic calibration audit', role: 'owner' };
  const appraisal = {
    _id: appraisalId, organizationId: organization.id, status,
    employee: { userId: 'employee', name: 'Synthetic Employee' }, manager: { userId: user.id, name: user.name },
    cycleId: { _id: 'calibration-cycle', name: 'Synthetic calibration cycle', ratingScale: { min: 0, max: 5 }, settings: { enableAiAssist: false } },
    selfAssessment: { submittedAt: '2026-10-01', overallSelfRating: 4 },
    managerReview: { submittedAt: '2026-10-02', overallManagerRating: 4 },
    calibration: { calibratedRating: rating, justification: 'Retained human calibration evidence.', calibratedAt: '2026-10-03' },
    finalRating: { overall: rating, justification: 'Published human outcome.' }, viewerCapabilities: { isEmployee: false, canManage: true },
  };
  const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
  await page.addInitScript(() => localStorage.setItem('accessToken', 'synthetic-calibration-state'));
  await page.route('**/__mock-api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/__mock-api', '');
    if (request.method() === 'POST' && path.startsWith('/appraisals/')) writes.push({ path, body: request.postDataJSON() || {} });
    if (path === '/auth/me') return route.fulfill({ json: { success: true, user: { ...user, organizations: [organization] }, currentOrganization: organization, currentOrganizationId: organization.id } });
    let data: unknown = [];
    if (path === '/user/context') data = { user, organization, role: { name: 'owner', isManager: true, isHRAdmin: true }, teams: [], features: { canonicalAppraisals: true }, stats: {} };
    if (path === '/user/current-team') data = { currentTeam: null, availableTeams: [] };
    if (path === '/competency/bootstrap') data = { enabled: false, capabilities: {}, people: [], settings: {} };
    if (path === `/appraisals/${appraisalId}`) data = appraisal;
    if (path === `/appraisals/${appraisalId}/scoring`) data = { suggestedRating: 4 };
    return route.fulfill({ json: { success: true, data } });
  });
  return writes;
}

for (const status of ['completed', 'employee_acknowledged', 'cancelled', 'discussion_scheduled']) {
  test(`${status} calibration retains saved evidence without editable controls or writes`, async ({ page }, info) => {
    const writes = await install(page, status);
    await page.goto(`/appraisals/${appraisalId}/calibration`);
    await expect(page.getByText('Calibration is read-only at this appraisal stage. Saved ratings and justification remain available.', { exact: true })).toBeVisible();
    const justification = page.getByRole('textbox', { name: 'Calibration Justification', exact: true });
    await expect(justification).toHaveValue('Retained human calibration evidence.');
    await expect(justification).toHaveAttribute('readonly', '');
    await expect(page.getByText('Current Calibrated: 3', { exact: true })).toBeVisible();
    await expect(page.getByRole('radio')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save Draft', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Submit Calibration', exact: true })).toHaveCount(0);
    await page.reload();
    await expect(justification).toHaveValue('Retained human calibration evidence.');
    expect(writes).toEqual([]);
    if (status === 'employee_acknowledged') await page.screenshot({ path: info.outputPath('acknowledged-calibration-readonly.png'), fullPage: true });
  });
}

for (const status of ['calibration_pending', 'calibration_in_progress', 'final_review_pending']) {
  test(`${status} calibration still permits explicit draft and submitted decisions`, async ({ page }) => {
    const writes = await install(page, status);
    await page.goto(`/appraisals/${appraisalId}/calibration`);
    const justification = page.getByRole('textbox', { name: 'Calibration Justification', exact: true });
    await expect(justification).toBeEditable();
    await page.getByRole('radio', { name: '4 Stars', exact: true }).press('Space');
    await justification.fill('Human calibration confirms the documented evidence.');
    await page.getByRole('button', { name: 'Save Draft', exact: true }).click();
    await expect(page.getByText('Calibration progress saved.', { exact: true })).toBeVisible();
    expect(writes).toEqual([{ path: `/appraisals/${appraisalId}/calibration`, body: { calibration: { calibratedRating: 4, justification: 'Human calibration confirms the documented evidence.' }, submit: false } }]);
    await page.getByRole('button', { name: 'Submit Calibration', exact: true }).click();
    await expect.poll(() => writes.length).toBe(2);
    expect(writes[1].body).toMatchObject({ calibration: { calibratedRating: 4 }, submit: true });
  });
}

test('a saved calibrated zero remains zero in a completed read-only appraisal', async ({ page }) => {
  const writes = await install(page, 'completed', 0);
  await page.goto(`/appraisals/${appraisalId}/calibration`);
  await expect(page.getByText('Current Calibrated: 0', { exact: true })).toBeVisible();
  await expect(page.getByText('0/5', { exact: true })).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(0);
  expect(writes).toEqual([]);
});

test('the existing final-review page keeps completed decision controls disabled', async ({ page }) => {
  const writes = await install(page, 'employee_acknowledged');
  await page.goto(`/appraisals/${appraisalId}/final-review`);
  await expect(page.getByText(/current status: employee_acknowledged/)).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Justification (required when overriding evidence rating)', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Complete Appraisal', exact: true })).toBeDisabled();
  for (const radio of await page.getByRole('radio').all()) await expect(radio).toBeDisabled();
  expect(writes).toEqual([]);
});
