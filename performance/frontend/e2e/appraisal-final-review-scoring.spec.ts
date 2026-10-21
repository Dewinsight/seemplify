import { expect, test, type Page } from '@playwright/test';

// Synthetic response contracts; persistence and role-publication guards are
// exercised separately by the API integration suites and live acceptance.
const id = '0123456789abcdef01234568';
async function setup(page: Page, scoring: 'none' | 'rated' | 'failed' | 'malformed', blocked = false) {
  const user = { id: 'reviewer', sub: 'reviewer', name: 'Synthetic Reviewer', email: 'reviewer@example.test' };
  const organization = { id: 'score-org', name: 'Synthetic scoring audit', role: 'owner' };
  const writes: Record<string, unknown>[] = [];
  await page.addInitScript(() => localStorage.setItem('accessToken', 'synthetic-score-test'));
  await page.route('**/__mock-api/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/__mock-api', '');
    if (path === '/auth/me') return route.fulfill({ json: { success: true, user: { ...user, organizations: [organization] }, currentOrganization: organization, currentOrganizationId: organization.id } });
    if (path === `/appraisals/${id}/scoring`) return route.fulfill({ status: scoring === 'failed' ? 503 : 200, json: scoring === 'malformed' ? { success: true, data: {} } : { success: scoring !== 'failed', data: { suggestedRating: scoring === 'rated' ? 4 : null } } });
    if (path === `/appraisals/${id}/finalize`) {
      writes.push(route.request().postDataJSON());
      return route.fulfill({ status: blocked ? 409 : 200, json: blocked ? { success: false, code: 'ROLE_ASSESSMENT_REQUIRED', assessmentId: '0123456789abcdef01234569', error: 'Publish the linked role assessment before completing this appraisal.' } : { success: true, data: {} } });
    }
    let data: unknown = [];
    if (path === '/user/context') data = { user, organization, role: { name: 'owner', isManager: true, isHRAdmin: true }, teams: [], features: { canonicalAppraisals: true }, stats: {} };
    if (path === '/user/current-team') data = { currentTeam: null, availableTeams: [] };
    if (path === '/competency/bootstrap') data = { enabled: true, capabilities: {}, people: [], settings: {} };
    if (path === `/appraisals/${id}`) data = { _id: id, status: 'final_review_pending', employee: { userId: 'employee', name: 'Synthetic Employee' }, manager: { userId: user.id, name: user.name }, cycleId: { settings: { enableAiAssist: false } }, managerReview: { overallManagerRating: 3 }, viewerCapabilities: { isEmployee: false, canManage: true } };
    if (path === `/appraisals/${id}/report`) data = { id, status: 'completed', employee: { name: 'Synthetic Employee' }, manager: { name: user.name }, cycle: { name: 'Synthetic role review' }, ratingScale: { min: 1, max: 5 }, finalRating: { overall: 4 }, goals: [], competencies: [], answers: [], documents: [], employeeReflection: {}, managerSummary: {}, discussion: {}, aiReport: { state: 'not_requested' } };
    return route.fulfill({ json: { success: true, data } });
  });
  await page.goto(`/appraisals/${id}/final-review`);
  return writes;
}

test('a successful null score allows the human decision without inventing a calculated rating', async ({ page }, info) => {
  const writes = await setup(page, 'none');
  await expect(page.getByText(/No calculated 1–5 rating is available/)).toBeVisible();
  await expect(page.getByText('Calculated evidence rating: 0/5')).toHaveCount(0);
  await page.getByRole('radio', { name: '4 Stars', exact: true }).press('Space');
  await page.getByRole('textbox', { name: 'Justification (required when overriding evidence rating)', exact: true }).fill('The separate role result and submitted evidence support this decision.');
  await page.screenshot({ path: info.outputPath('competency-final-review-no-calculated-rating.png'), fullPage: true });
  await page.getByRole('button', { name: 'Complete Appraisal', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/appraisals/${id}/report$`));
  expect(writes).toEqual([{ finalRating: 4, justification: 'The separate role result and submitted evidence support this decision.' }]);
});

for (const scoring of ['failed', 'malformed'] as const) {
  test(`${scoring} scoring still blocks finalisation`, async ({ page }) => {
    const writes = await setup(page, scoring);
    await expect(page.getByText(/Refresh before finalizing/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Complete Appraisal', exact: true })).toBeDisabled();
    expect(writes).toEqual([]);
  });
}

test('an actual calculated rating still requires a meaningful override reason', async ({ page }) => {
  await setup(page, 'rated');
  await expect(page.getByText('Calculated evidence rating: 4/5')).toBeVisible();
  await page.getByRole('radio', { name: '3 Stars', exact: true }).press('Space');
  const complete = page.getByRole('button', { name: 'Complete Appraisal', exact: true });
  await expect(complete).toBeDisabled();
  await page.getByRole('textbox', { name: 'Justification (required when overriding evidence rating)', exact: true }).fill('Verified evidence warrants a different final decision.');
  await expect(complete).toBeEnabled();
});

test('a null calculated score does not bypass the linked role publication guard', async ({ page }) => {
  await setup(page, 'none', true);
  await page.getByRole('button', { name: 'Complete Appraisal', exact: true }).click();
  await expect(page.getByText('Publish the linked role assessment before completing this appraisal.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open linked role assessment (new tab)' })).toHaveAttribute('href', '/competency/assessments/0123456789abcdef01234569');
  await expect(page).toHaveURL(new RegExp(`/appraisals/${id}/final-review$`));
});
