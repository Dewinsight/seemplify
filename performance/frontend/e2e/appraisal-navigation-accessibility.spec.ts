import { expect, test, type Locator, type Page } from '@playwright/test';

// UI geometry/keyboard contracts with synthetic transport; real persistence and
// role authorization remain covered by the fullstack suites and live audit.
const appraisalId = '0123456789abcdef01234568';
const phases = ['Goal Setting', 'Self-Assessment', 'Manager Review', 'Discussion', 'Calibration', 'Final Review'];
const cycle = { _id: 'mobile-cycle', name: 'Synthetic mobile cycle', status: 'active', currentPhase: 'managerReview',
  periodStart: '2026-01-01', periodEnd: '2026-09-30', settings: { enableAiAssist: false, requireOkrAlignment: false }, competencies: [] };
function record() {
  return { _id: appraisalId, organizationId: 'mobile-org', cycleId: cycle, status: 'manager_review_pending',
    employee: { userId: 'employee', name: 'Synthetic Employee', email: 'employee@example.test' },
    manager: { userId: 'mobile-reviewer', name: 'Synthetic Reviewer', email: 'reviewer@example.test' },
    selfAssessment: { submittedAt: '2026-10-01', overallSelfRating: 4, overallSummary: {}, competencyRatings: [], okrAssessment: [] },
    managerReview: { overallSummary: {}, competencyRatings: [], okrAssessment: [] }, documents: [], customResponses: [] };
}
async function install(page: Page, appraisal: Record<string, unknown> = record(), manager = true) {
  const user = { id: 'mobile-reviewer', sub: 'mobile-reviewer', name: 'Synthetic Reviewer', email: 'reviewer@example.test' };
  const organization = { id: 'mobile-org', name: 'Synthetic navigation audit', role: manager ? 'owner' : 'staff' };
  const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
  let currentOkrIndex = 0;
  const conversationState = () => ({ mode: 'conversation', currentPhase: 'okr_reflection', currentOkrIndex, completedPhases: [], extractedData: {}, messageCount: 1 });
  const chatThread = [{ sender: { userId: 'ai', name: 'Synthetic assistant', role: 'ai' }, message: 'Discuss the documented outcome.', messageType: 'text', createdAt: '2026-10-01' }];
  await page.addInitScript(() => localStorage.setItem('accessToken', 'synthetic-mobile-navigation'));
  await page.route('**/__mock-api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname.replace('/__mock-api', '');
    const body = req.method() === 'POST' ? req.postDataJSON() || {} : {};
    if (req.method() === 'POST') writes.push({ path, body });
    if (path === '/auth/me') return route.fulfill({ json: { success: true, user: { ...user, organizations: [organization] }, currentOrganization: organization, currentOrganizationId: organization.id } });
    let data: unknown = [];
    if (path === '/user/context') data = { user, organization, role: { name: manager ? 'owner' : 'employee', isManager: manager, isHRAdmin: manager }, teams: [], features: { canonicalAppraisals: true }, stats: {} };
    if (path === '/user/current-team') data = { currentTeam: null, availableTeams: [] };
    if (path === '/competency/bootstrap') data = { enabled: false, capabilities: {}, people: [], settings: {} };
    if (path === '/appraisals/cycles') data = [cycle];
    if (['/appraisals/my', '/appraisals/team', '/appraisals/organization'].includes(path)) data = [appraisal];
    if (path === `/appraisals/${appraisalId}`) data = appraisal;
    if (path === '/ai-account') data = { account: { status: 'connected', routable: true, lastError: null }, policy: { chatgptEnabled: true } };
    if (path.endsWith('/conversation/context')) data = { conversationState: conversationState(), chatThread,
      cycle: { settings: { allowSelfRating: true } }, okrs: [{ _id: 'first', title: 'First delivery goal', progress: 25 }, { _id: 'second', title: 'Second delivery goal', progress: 50 }] };
    if (path.endsWith('/conversation/message')) {
      currentOkrIndex = String(body.message).includes('Second delivery goal') ? 1 : 0;
      data = { conversationState: conversationState(), chatThread };
    }
    return route.fulfill({ json: { success: true, data } });
  });
  return writes;
}
async function labelsFit(group: Locator, labels: string[]) {
  let previousTop = -1;
  for (const label of labels) {
    const text = group.getByText(label, { exact: true });
    await expect(text).toBeVisible();
    const bounds = await text.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    expect(bounds!.y).toBeGreaterThan(previousTop);
    previousTop = bounds!.y;
  }
}

test('390px reviewer progress shows every label and Next retains manual persistence before changing stages', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const writes = await install(page);
  await page.goto(`/appraisals/${appraisalId}/manager-review`);
  const progress = page.getByRole('group', { name: 'Review form progress', exact: true });
  await labelsFit(progress, ['Review Self-Assessment', 'Competency Ratings', 'OKR Verification', 'Overall Assessment']);
  await expect(progress.locator('[aria-current="step"]')).toContainText('Review Self-Assessment');
  await progress.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('reviewer-progress-mobile.png') });
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Rate Competencies', exact: true })).toBeVisible();
  expect(writes.find(write => write.path.endsWith('/manager-review'))?.body).toMatchObject({ assessmentMode: 'form', submit: false });
  await expect(progress.locator('[aria-current="step"]')).toContainText('Competency Ratings');
});

test('390px cycle and fallback appraisal phases fit and Final Rating is reachable by keyboard', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const appraisal = { ...record(), status: 'completed', managerReview: { submittedAt: '2026-10-02', overallManagerRating: 4, overallSummary: {}, competencyRatings: [] },
    finalRating: { overall: 4, ratingLabel: 'Exceeds expectations', finalizedAt: '2026-10-03' } };
  await install(page, appraisal);
  await page.goto('/appraisals');
  await page.getByRole('combobox', { name: /^Cycle/ }).click();
  await page.getByRole('option', { name: /Synthetic mobile cycle/ }).click();
  await labelsFit(page.getByRole('group', { name: 'Cycle phases', exact: true }), ['Self-Assessment', 'Manager Review', 'Discussion', 'Calibration', 'Final Review']);
  await page.goto(`/appraisals/${appraisalId}`);
  await page.getByRole('tab', { name: 'Previous work & analytics', exact: true }).click();
  await labelsFit(page.getByRole('group', { name: 'Appraisal progress', exact: true }), phases);
  const selfTab = page.getByRole('tab', { name: 'Self-Assessment', exact: true });
  await selfTab.focus();
  await selfTab.press('End');
  const finalTab = page.getByRole('tab', { name: 'Final Rating', exact: true });
  await expect(finalTab).toBeFocused();
  await finalTab.press('Enter');
  await expect(finalTab).toHaveAttribute('aria-selected', 'true');
  await finalTab.scrollIntoViewIfNeeded();
  await expect(finalTab).toBeInViewport();
  const bounds = await finalTab.boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await expect(page.getByText('Final Performance Rating', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('final-rating-tab-mobile.png') });
});

test('conversational OKR selection supports Enter and Space with the same existing context requests', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const appraisal = { ...record(), status: 'self_assessment_in_progress', employee: { userId: 'mobile-reviewer', name: 'Synthetic Reviewer', email: 'reviewer@example.test' },
    cycleId: { ...cycle, settings: { enableAiAssist: true, requireOkrAlignment: false } }, selfAssessment: {} };
  const writes = await install(page, appraisal, false);
  await page.goto(`/appraisals/${appraisalId}/self-assessment`);
  const second = page.getByRole('button', { name: 'Reflect on Second delivery goal', exact: true });
  await second.focus(); await second.press('Enter');
  await expect(second).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => writes.filter(write => write.path.endsWith('/conversation/message')).length).toBe(1);
  const first = page.getByRole('button', { name: 'Reflect on First delivery goal', exact: true });
  await first.focus(); await first.press('Space');
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => writes.filter(write => write.path.endsWith('/conversation/message')).length).toBe(2);
  expect(writes.filter(write => write.path.endsWith('/conversation/message')).map(write => write.body.message)).toEqual([
    'I want to discuss the OKR: "Second delivery goal"', 'I want to discuss the OKR: "First delivery goal"',
  ]);
});

test('tutorial explains scoped launch organization OKRs manual forms and historical results with working destinations', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await install(page);
  await page.goto('/tutorial');
  await labelsFit(page.getByRole('group', { name: 'Example appraisal workflow', exact: true }), [...phases, 'Acknowledgement']);
  await expect(page.getByText(/Employees and reviewers can complete manual forms without ChatGPT/)).toBeVisible();
  await expect(page.getByText(/Automatic transcript analysis and scoring/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Manager Guide', exact: true }).click();
  await expect(page.getByText('Managers and HR can begin reviews for staff in their authorized scope', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start appraisal', exact: true }).click();
  await expect(page).toHaveURL(/\/appraisals\/start$/);
  await page.goto('/tutorial');
  await page.getByRole('button', { name: 'HR Admin Guide', exact: true }).click();
  await page.getByRole('button', { name: /Set Organization-wide OKRs/ }).click();
  await expect(page.getByText('HR managers and organization administrators set shared organization goals', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Organization goals', exact: true }).click();
  await expect(page).toHaveURL(/\/okrs\?view=organization$/);
  await page.goto('/tutorial');
  await page.getByRole('button', { name: /Find Historical Appraisals and Results/ }).click();
  await page.getByRole('button', { name: 'History & results', exact: true }).click();
  await expect(page).toHaveURL(/\/appraisals\?section=history$/);
});

test('employee tutorial keeps manager and HR launch controls outside the employee guide', async ({ page }) => {
  await install(page, record(), false);
  await page.goto('/tutorial');
  await expect(page.getByRole('button', { name: 'Manager Guide', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'HR Admin Guide', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start appraisal', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /Complete Self-Assessment/ }).click();
  await expect(page.getByText('Choose Use manual form to complete the review without ChatGPT', { exact: true })).toBeVisible();
});

test('discussion action follows the actual custom step for employee and reviewer instead of a fixed index', async ({ page }) => {
  for (const employee of [false, true]) {
    for (const prefix of [[], ['selfAssessment', 'managerReview'], ['oneOnOne', 'oneOnOne', 'selfAssessment', 'managerReview']]) {
      const types = [...prefix, 'discussion', 'finalReview', 'acknowledgement'];
      const steps = types.map((type, index) => ({ id: `step-${index}`, type, label: `${type} ${index}` }));
      const appraisal = { ...record(), status: 'discussion_scheduled', managerReview: { submittedAt: '2026-10-02', overallManagerRating: 4 },
        ...(employee ? { employee: { userId: 'mobile-reviewer', name: 'Synthetic Reviewer', email: 'reviewer@example.test' } } : {}),
        completedMeetingSteps: steps.filter(step => step.type === 'oneOnOne').map(step => step.id),
        cycleConfigurationSnapshot: { appraisalFlow: { version: 1, assessmentMode: 'form', steps } } };
      await install(page, appraisal, !employee);
      await page.goto(`/appraisals/${appraisalId}`);
      await page.getByRole('button', { name: 'Open Discussion', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/appraisals/${appraisalId}/discussion$`));
      await page.unroute('**/__mock-api/**');
    }
  }
});

test('future or omitted discussion stays hidden while a completed discussion remains readable during final review', async ({ page }) => {
  const steps = ['selfAssessment', 'managerReview', 'discussion', 'finalReview', 'acknowledgement'].map(type => ({ id: type, type, label: type }));
  for (const [status, flow, completed] of [
    ['manager_review_pending', steps, false],
    ['final_review_pending', steps.filter(step => step.type !== 'discussion'), false],
    ['final_review_pending', steps, true],
  ] as const) {
    await install(page, { ...record(), status,
      managerReview: status === 'manager_review_pending' ? {} : { submittedAt: '2026-10-02' },
      discussion: completed ? { completedDate: '2026-10-03' } : {},
      cycleConfigurationSnapshot: { appraisalFlow: { version: 1, assessmentMode: 'form', steps: flow } } });
    await page.goto(`/appraisals/${appraisalId}`);
    await page.getByRole('tab', { name: 'Previous work & analytics', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Appraisal progress', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open Discussion', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'View Discussion', exact: true })).toHaveCount(completed ? 1 : 0);
    await page.unroute('**/__mock-api/**');
  }
});
