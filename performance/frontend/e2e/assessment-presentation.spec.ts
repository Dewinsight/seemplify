import { expect, test, type Page } from '@playwright/test';
const appraisalId = '507f1f77bcf86cd799439017';
const sources = [
  { ref: 'SELF1', category: 'employee_assessment', title: 'Employee reflection', state: 'submitted' },
  { ref: 'REVIEWER1', category: 'manager_review', title: 'Reviewer feedback', state: 'draft' },
  { ref: 'CV1', category: 'cv', title: 'Curriculum vitae', state: 'ready' },
  { ref: 'MEETING1', category: 'meetings', title: 'Release review meeting', state: 'transcript_ready' },
  { ref: 'OKR1', category: 'personal_okrs', title: 'Release quality snapshot', state: 'frozen_scoring_evidence' },
  { ref: 'OKR2', category: 'personal_okrs', title: 'Unmeasured goal', state: 'live_context' },
  { ref: 'ALIGN1', category: 'aligned_okrs', title: 'Reliable team releases', state: 'live_context' },
  ...Array.from({ length: 13 }, (_, i) => ({ ref: `ANSWER${i + 1}`, category: 'review_answers', title: `Review question ${i + 1}`, state: 'submitted' })),
  ...Array.from({ length: 9 }, (_, i) => ({ ref: `CHAT${i + 1}`, category: 'ai_conversation', title: `Discussion ${i + 1}`, state: 'conversation' })),
].map(source => ({ ...source, id: `private-id-${source.ref}`, characters: 1200, includedCharacters: 1200 }));
const content = `Current assessment and confidence
Delivery improved during the review period. The employee and reviewer agree on ownership, while verification of the quality metric is still needed. [SELF1] [REVIEWER1]

The discussion provides useful examples, but these remain self-reported until corroborated. [CHAT1]

CV and role-fit evidence
The CV describes platform delivery experience. This is a claim to verify against the appraisal evidence, not an automatic performance score. [CV1]

Outcomes and individual OKRs
The preserved release goal reached 62%. An unmeasured goal remains unrated. [OKR1] [OKR2]

Team and organizational alignment
The team reached 90%; that result is not assigned to this individual. [ALIGN1]

Employee AI discussion and configured assessment answers
The employee explained the handover sequence. [ANSWER1] [CHAT1]

Manager assessment and differences in perspective
The reviewer identified one remaining verification step. [REVIEWER1]

Meetings, transcripts, decisions and commitments
The participants agreed to attach the release evidence. [MEETING1]

Competencies, strengths and development needs
- Ownership is supported by the review examples. [SELF1]
- Quality checks need corroboration. [REVIEWER1]

Evidence contradictions and gaps
The two ratings differ by one point. Compare the original examples before reaching an outcome. [SELF1] [REVIEWER1]

Focused follow-up questions
1. Which release check demonstrates the improvement? [OKR1]
2. Who verified the final handover? [MEETING1]
3. What changed after the review discussion? [CHAT1]

Prioritized development actions
1. Attach the release check and verify the baseline before the next review. [OKR1]
2. Confirm the handover owner and completion date. [MEETING1]

What changed since the previous evidence review
The meeting transcript was added. This is an evidence update, not proof of a change in performance. [MEETING1]`;
function assessment() {
  return { state: 'ready', enabled: true, cancelled: false, isCurrent: true, observedHash: 'fixture-evidence', phase: 'manager_review_in_progress', generatedAt: '2026-10-21T00:00:00Z', model: 'gpt-6.1-sol', reasoningEffort: 'max', requestedModel: 'gpt-6.1-sol', requestedReasoningEffort: 'max', content,
    coverage: { sources, counts: {}, gaps: ['Quality check has not been independently verified.'], excerpted: 0 }, history: [],
    sourcePreviews: sources.map(source => ({ ref: source.ref, text: source.ref === 'CV1' ? 'Platform delivery experience. <script>window.untrustedSourceExecuted=true</script>' : `Original evidence from ${source.title}.`, truncated: false })),
    analytics: { scale: { min: 1, max: 5 }, ratings: { employee: { value: 4, state: 'submitted', ref: 'SELF1' }, reviewer: { value: 3, state: 'draft', ref: 'REVIEWER1' } },
      competencies: [{ title: 'Delivery', employee: 4, reviewer: 3, refs: ['SELF1', 'REVIEWER1'] }, { title: 'Communication', employee: 5, reviewer: null, refs: ['SELF1'] }],
      goals: [{ title: 'Release quality', ref: 'OKR1', scope: 'individual', basis: 'appraisal_snapshot', progress: 62, status: 'rated' },
        { title: 'Unmeasured goal', ref: 'OKR2', scope: 'individual', basis: 'live_context', progress: null, status: 'active' },
        { title: 'Reliable team releases', ref: 'ALIGN1', scope: 'team', basis: 'live_context', progress: 90, status: 'active' }] } };
}
async function setup(page: Page, theme = 'light') {
  const data = assessment(); let unavailable = false, failedWrite = false;
  const writes: unknown[] = [], errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(theme => { localStorage.setItem('accessToken', 'synthetic-report-qa'); localStorage.setItem('seemplify_theme', theme); }, theme);
  await page.route(/\/(?:__mock-api|api)\//, async route => {
    const request = route.request(), path = new URL(request.url()).pathname.replace(/^\/(?:__mock-api|api)/, '');
    const finish = (value: unknown) => route.fulfill({ json: { success: true, data: value } });
    const user = { id: 'report-manager', sub: 'report-manager', name: 'Morgan Manager', email: 'manager@example.test' }, org = { id: 'report-org', name: 'Report QA', role: 'owner' };
    if (path === '/auth/me') return route.fulfill({ json: { success: true, user: { ...user, organizations: [org] }, currentOrganization: org } });
    if (path === '/user/context') return finish({ user, organization: org, role: { name: 'line_manager', isManager: true }, teams: [], stats: {}, features: {} });
    if (path === '/user/current-team') return finish({ currentTeam: null, availableTeams: [] });
    if (path === `/appraisals/${appraisalId}`) return finish({ _id: appraisalId, status: 'completed', employee: { userId: 'employee', name: 'Alex Employee' }, manager: { userId: user.id }, cycleId: { name: 'Quarterly review', ratingScale: { min: 1, max: 5 } }, selfAssessment: {}, managerReview: {}, finalRating: { overall: 4 }, viewerCapabilities: { canManage: true } });
    if (path.endsWith('/current-assessment')) {
      if (request.method() === 'POST') { writes.push(request.postDataJSON()); if (failedWrite) return route.fulfill({ status: 503, json: { error: 'Synthetic update outage. Retry later.' } }); return finish({ queued: true }); }
      if (unavailable) return route.fulfill({ status: 503, json: { error: 'Synthetic loading outage' } });
      return finish(data);
    }
    return finish([]);
  });
  const open = async () => { await page.goto(`/appraisals/${appraisalId}`); await page.getByRole('tab', { name: 'Current AI assessment', exact: true }).click(); };
  return { data, writes, errors, open, outage: (value: boolean) => { unavailable = value; }, failWrite: () => { failedWrite = true; } };
}

for (const theme of ['light', 'dark']) test(`visual overview, readable analysis and source drill-down in ${theme}`, async ({ page }, info) => {
  const state = await setup(page, theme); await state.open();
  await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Evidence at a glance', exact: true })).toBeVisible();
  await expect(page.getByRole('meter', { name: 'employee overall rating', exact: true })).toHaveAttribute('aria-valuenow', '4');
  await expect(page.getByRole('meter', { name: 'Release quality progress', exact: true })).toHaveAttribute('aria-valuenow', '62');
  await expect(page.getByText('The CV describes platform delivery experience.', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Current assessment analysis', exact: true })).not.toContainText('[SELF1]');
  await page.screenshot({ path: info.outputPath(`assessment-overview-${theme}.png`), fullPage: true });
  await page.getByRole('button', { name: /^View 2 sources for: Delivery improved/ }).click();
  const reader = page.getByRole('dialog', { name: 'Assessment sources', exact: true });
  await expect(reader.getByText('Original evidence from Employee reflection.', { exact: true })).toBeVisible();
  await reader.getByRole('button', { name: 'Reviewer feedback', exact: true }).click();
  await expect(reader.getByText('Original evidence from Reviewer feedback.', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(reader).toHaveCount(0);
  await page.getByRole('tab', { name: 'Detailed analysis', exact: true }).click();
  await page.getByRole('button', { name: 'CV and role fit', exact: true }).click();
  await expect(page.getByText(/The CV describes platform delivery experience/)).toBeVisible();
  await page.getByRole('tab', { name: 'Sources (29)', exact: true }).click();
  await page.getByRole('textbox', { name: 'Find a source', exact: true }).fill('Curriculum');
  await page.getByRole('button', { name: 'View source: Curriculum vitae', exact: true }).click();
  await expect(reader.getByText(/<script>window.untrustedSourceExecuted=true<\/script>/)).toBeVisible();
  expect(await page.evaluate(() => 'untrustedSourceExecuted' in window)).toBe(false);
  await reader.getByRole('button', { name: 'Back to assessment', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(state.errors).toEqual([]); expect(state.writes).toEqual([]);
});

test('mobile keeps real ratings, unrated goals and source excerpts readable', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  const state = await setup(page, 'dark'); await state.open();
  await page.getByRole('button', { name: 'Live context', exact: true }).click();
  await expect(page.getByText('Unmeasured goal', { exact: true })).toBeVisible();
  await expect(page.getByRole('meter', { name: 'Unmeasured goal progress' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Team & company', exact: true }).click();
  await expect(page.getByRole('meter', { name: 'Reliable team releases progress', exact: true })).toHaveAttribute('aria-valuenow', '90');
  await expect(page.getByText(/these results are not attributed to this employee/)).toBeVisible();
  await page.screenshot({ path: info.outputPath('assessment-overview-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: /^View 2 sources for: Delivery improved/ }).click();
  const reader = page.getByRole('dialog', { name: 'Assessment sources', exact: true });
  await reader.getByRole('combobox', { name: /^Cited source/ }).click();
  await page.getByRole('option', { name: 'Reviewer feedback', exact: true }).click();
  await expect(reader.getByText('Original evidence from Reviewer feedback.', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('assessment-source-mobile.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(state.errors).toEqual([]);
});

test('load failures, update failures and paused assessment controls preserve the saved analysis', async ({ page }) => {
  const state = await setup(page); state.outage(true); await state.open();
  await expect(page.getByText('The current AI assessment could not be loaded.', { exact: true })).toBeVisible();
  state.outage(false); await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Assessment summary', exact: true })).toBeVisible();
  state.failWrite(); await page.getByRole('button', { name: 'Update assessment now', exact: true }).click();
  await expect(page.getByText('Synthetic update outage. Retry later.', { exact: true })).toBeVisible();
  await expect(page.getByRole('meter', { name: 'employee overall rating', exact: true })).toBeVisible();
  state.data.state = 'paused'; state.data.enabled = false;
  await page.reload(); await page.getByRole('tab', { name: 'Current AI assessment', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume assessment', exact: true })).toBeVisible();
  await expect(page.getByText(/Automatic updates are paused/)).toBeVisible();
  expect(state.errors).toEqual([]);
});

test('an open citation cannot switch to another document after evidence is withdrawn and references change', async ({ page }) => {
  const state = await setup(page); await state.open();
  await page.getByRole('tab', { name: 'Sources (29)', exact: true }).click();
  await page.getByRole('textbox', { name: 'Find a source', exact: true }).fill('Curriculum');
  await page.getByRole('button', { name: 'View source: Curriculum vitae', exact: true }).click();
  const reader = page.getByRole('dialog', { name: 'Assessment sources', exact: true });
  await expect(reader.getByText(/Platform delivery experience/)).toBeVisible();
  state.data.state = 'stale'; state.data.enabled = false; state.data.isCurrent = false; state.data.content = undefined; state.data.observedHash = 'withdrawn-evidence';
  state.data.coverage.sources = state.data.coverage.sources.map(source => source.ref === 'CV1' ? { ...source, id: 'different-document', title: 'Replacement document' } : source);
  state.data.sourcePreviews = [{ ref: 'CV1', text: 'Replacement private content must not appear in the previous citation.', truncated: false }];
  await expect(reader.getByText(/These sources are no longer available/)).toBeVisible({ timeout: 20000 });
  await expect(reader.getByText(/Replacement private content/)).toHaveCount(0);
  expect(state.errors).toEqual([]);
});
