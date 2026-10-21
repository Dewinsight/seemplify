import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// These are actual browser rendering contracts with synthetic final-report
// transport. They do not prove API authorization or external AI execution.
const appraisalId = 'synthetic-analytical-result';
const employeeNarrative = 'Employee reflection remains available alongside the recorded measures.';
const reviewerNarrative = 'Reviewer rationale is human evidence, not a score inferred from AI prose.';
const discussionNarrative = 'Retain the agreed mentoring session and next-quarter support plan.';

type RecordedNumber = number | string | null;
interface ReportFixture {
  id: string; status: string;
  employee: { name: string; jobTitle: string; department: string };
  manager: { name: string };
  cycle: { name: string; periodStart: string; periodEnd: string };
  ratingScale: { min?: number; max?: number };
  finalRating: { overall: RecordedNumber; ratingLabel?: string; justification?: string; finalizedAt?: string };
  employeeReflection: Record<string, string>; managerSummary: Record<string, string>;
  discussion: Record<string, string | string[]>;
  acknowledgedAt: string; documents: [];
  goals: Array<{ title: string; score: RecordedNumber }>;
  competencies: Array<{ name: string; selfRating: RecordedNumber; managerRating: RecordedNumber; managerComments: string }>;
  answers: Array<{ section: string; question: string; respondent: string; answer: string }>;
  managerFeedback: { author: { userId: string; name: string }; submittedAt: string; overallRating: RecordedNumber;
    goals: Array<{ id: string; title: string; comments: string; verifiedCompletion: RecordedNumber; qualityRating: RecordedNumber }> } | null;
  canGenerateAIReport: boolean;
  aiReport: { state: string; content?: string; errorCode?: string; retryScheduled?: boolean;
    coverage?: { meetings: number; transcripts: number; missingTranscripts: string[]; documents: number; pendingDocuments: number; roleResults: number; excerptedCategories: string[];
      sources: Array<{ id: string; ref: string; title: string; state: string; category?: string }>; gaps: string[] } };
}

function populatedReport(): ReportFixture {
  return {
    id: appraisalId, status: 'employee_acknowledged',
    employee: { name: 'Synthetic Participant', jobTitle: 'Customer success manager', department: 'Customer success' },
    manager: { name: 'Synthetic Reviewer' },
    cycle: { name: 'Synthetic completed quarter', periodStart: '2026-07-01', periodEnd: '2026-09-30' },
    ratingScale: { min: 1, max: 5 },
    finalRating: { overall: 4, ratingLabel: 'Strong contribution', justification: 'Published final human decision remains unchanged.', finalizedAt: '2026-10-18T12:00:00Z' },
    employeeReflection: { achievements: employeeNarrative }, managerSummary: { strengths: reviewerNarrative },
    discussion: { developmentPlan: discussionNarrative }, acknowledgedAt: '2026-10-19T12:00:00Z', documents: [],
    goals: [{ title: 'Saved adoption goal', score: 75 }, { title: 'Saved retention goal', score: 50 }],
    competencies: [{ name: 'Customer communication', selfRating: 3, managerRating: 4, managerComments: 'Evidence includes specific customer conversations.' }],
    answers: [{ section: 'Quarter reflection', question: 'What support is useful?', respondent: 'employee', answer: 'Keep the recorded coaching and workload support.' }],
    managerFeedback: { author: { userId: 'synthetic-reviewer', name: 'Synthetic Reviewer' }, submittedAt: '2026-10-17T12:00:00Z', overallRating: 3,
      goals: [{ id: 'saved-goal-1', title: 'Saved adoption goal', comments: 'Reviewer evidence remains separate from the saved achievement.', verifiedCompletion: 60, qualityRating: 4 }] },
    canGenerateAIReport: true, aiReport: { state: 'ready', content: '## Assessment overview\nSynthetic AI narrative mentions 99% and 5/5; neither is a recorded measure. [DOC1]\n\n## Development priorities\nRetain the full generated narrative and its limitations.',
      coverage: { meetings: 1, transcripts: 0, missingTranscripts: ['Synthetic meeting'], documents: 1, pendingDocuments: 0, roleResults: 1, excerptedCategories: [],
        sources: [{ id: 'source-document', ref: 'DOC1', title: 'Synthetic retained document', state: 'available', category: 'documents' }, { id: 'source-meeting', ref: 'MEETING1', title: 'Synthetic meeting', state: 'transcript_missing', category: 'meetings' }], gaps: ['Synthetic meeting transcript is unavailable.'] } },
  };
}

async function setup(page: Page, report: ReportFixture, role: 'manager' | 'employee' = 'manager') {
  const user = { id: 'synthetic-result-viewer', sub: 'synthetic-result-viewer', name: 'Synthetic Result Viewer', email: 'result-viewer@example.test' };
  const organization = { id: 'synthetic-result-org', name: 'Synthetic report audit', role: role === 'manager' ? 'manager' : 'employee' };
  const requests: Array<{ method: string; path: string }> = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('accessToken', 'synthetic-appraisal-result-analytics'));
  await page.route('**/__mock-api/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/__mock-api', '');
    const method = route.request().method();
    requests.push({ method, path });
    if (path === '/auth/me') {
      await route.fulfill({ json: { success: true, user: { ...user, organizations: [organization] }, currentOrganization: organization, currentOrganizationId: organization.id } }); return;
    }
    let data: unknown = [];
    if (path === '/user/context') data = { user, organization, role: { name: role, isManager: role === 'manager', isHRAdmin: false }, teams: [], features: { canonicalAppraisals: true }, stats: {} };
    if (path === '/user/current-team') data = { currentTeam: null, availableTeams: [] };
    if (path === '/competency/bootstrap') data = { enabled: false, capabilities: {}, people: [], settings: {} };
    if (path === `/appraisals/${appraisalId}/report`) data = report;
    // Unexpected appraisal endpoints fail rather than silently returning data
    // that could mask accidental live/current-assessment score substitution.
    if (path.startsWith('/appraisals/') && path !== `/appraisals/${appraisalId}/report`) {
      await route.fulfill({ status: 501, json: { error: 'Unexpected synthetic report request.' } }); return;
    }
    await route.fulfill({ json: { success: true, data } });
  });
  return {
    assertReadOnly() {
      expect(requests.filter(request => request.path.startsWith('/appraisals/'))).not.toEqual([]);
      expect(requests.filter(request => request.path.startsWith('/appraisals/')).every(request => request.method === 'GET' && request.path === `/appraisals/${appraisalId}/report`)).toBe(true);
      expect(errors).toEqual([]);
    },
  };
}

async function openReport(page: Page) {
  await page.goto(`/appraisals/${appraisalId}/report`);
  await expect(page.getByRole('heading', { name: 'Appraisal result report', exact: true })).toBeVisible();
}

async function expectNarratives(page: Page) {
  const reviewRecord = page.getByRole('button', { name: /^Review record\b/ });
  if (await reviewRecord.getAttribute('aria-expanded') === 'false') await reviewRecord.click();
  for (const narrative of [employeeNarrative, reviewerNarrative, discussionNarrative]) {
    await expect(page.getByText(narrative, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByText('Keep the recorded coaching and workload support.', { exact: true })).toBeVisible();
}

const analytics = (page: Page) => page.getByRole('region', { name: 'Appraisal analytics', exact: true });
const competencyChart = (page: Page) => analytics(page).getByRole('figure', { name: 'Competency ratings', exact: true });
async function expectValidMeters(page: Page) {
  const values = await analytics(page).getByRole('meter').evaluateAll(elements => elements.map(element => ({
    value: Number(element.getAttribute('aria-valuenow')), min: Number(element.getAttribute('aria-valuemin')), max: Number(element.getAttribute('aria-valuemax')),
  })));
  for (const { value, min, max } of values) {
    expect(Number.isFinite(value) && Number.isFinite(min) && Number.isFinite(max)).toBe(true);
    expect(max).toBeGreaterThan(min); expect(value).toBeGreaterThanOrEqual(min); expect(value).toBeLessThanOrEqual(max);
  }
}

for (const mode of [
  { name: 'desktop light', width: 1440, height: 1000, theme: 'light' },
  { name: 'desktop dark', width: 1440, height: 1000, theme: 'dark' },
  { name: 'mobile light', width: 390, height: 844, theme: 'light' },
  { name: 'mobile dark', width: 390, height: 844, theme: 'dark' },
] as const) {
  test(`keeps recorded analytics and narrative usable in ${mode.name}`, async ({ page }, info) => {
    await page.setViewportSize({ width: mode.width, height: mode.height });
    await page.emulateMedia({ colorScheme: mode.theme });
    await page.addInitScript(theme => localStorage.setItem('seemplify_theme', theme), mode.theme);
    const state = await setup(page, populatedReport()); await openReport(page);
    await expect(analytics(page)).toBeVisible();
    for (const label of ['Published outcome', 'Reviewed goals', 'Report evidence']) await expect(analytics(page).getByRole('heading', { name: label, exact: true })).toBeVisible();
    await expect(competencyChart(page)).toContainText('Customer communication');
    await expect(competencyChart(page)).toContainText('Employee');
    await expect(competencyChart(page)).toContainText('Reviewer');
    await expect(analytics(page).getByRole('meter', { name: 'Saved adoption goal: saved achievement', exact: true })).toHaveAttribute('aria-valuenow', '75');
    await expect(analytics(page).getByRole('meter', { name: 'Saved retention goal: saved achievement', exact: true })).toHaveAttribute('aria-valuenow', '50');
    const barGeometry = await analytics(page).getByRole('meter', { name: 'Saved adoption goal: saved achievement', exact: true }).evaluate(element => {
      const rectangles = element.querySelectorAll('rect');
      return { available: element.getBoundingClientRect().width, track: rectangles[0].getBoundingClientRect().width, fill: rectangles[1].getBoundingClientRect().width };
    });
    expect(barGeometry.track / barGeometry.available).toBeCloseTo(1, 2);
    expect(barGeometry.fill / barGeometry.track).toBeCloseTo(0.75, 2);
    const pairedPlot = competencyChart(page).getByRole('img', { name: /^Customer communication:/ });
    await expect(pairedPlot.locator('circle[cy="12"]')).toHaveAttribute('cx', '150');
    await expect(pairedPlot.locator('circle[cy="22"]')).toHaveAttribute('cx', '221');
    const evidence = analytics(page).getByRole('figure', { name: 'Report evidence', exact: true });
    await expect(evidence).toContainText('2 sources');
    await expect(evidence.getByRole('img', { name: 'CV and documents: 1 sources', exact: true })).toBeVisible();
    await expect(evidence.getByRole('img', { name: 'Meetings and notes: 1 sources', exact: true })).toBeVisible();
    await expect(evidence).toContainText('not performance or AI confidence');
    await expectValidMeters(page);
    await expect(page.getByRole('button', { name: /^Review record\b/ })).toHaveAttribute('aria-expanded', 'false');
    await page.screenshot({ path: info.outputPath(`analytical-result-${mode.name.replaceAll(' ', '-')}-initial.png`), fullPage: true, animations: 'disabled' });
    await expectNarratives(page);
    await expect(page.getByRole('button', { name: 'Download CSV', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Print / save PDF', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`analytical-result-${mode.name.replaceAll(' ', '-')}.png`), fullPage: true, animations: 'disabled' });
    state.assertReadOnly();
  });
}

test('duplicate goal titles retain separate saved and reviewer evidence without a title-based score join', async ({ page }) => {
  const report = populatedReport();
  report.goals = [{ title: 'Repeated goal title', score: 20 }, { title: 'Repeated goal title', score: 80 }];
  report.managerFeedback!.goals = [{ id: 'reviewer-source-only', title: 'Repeated goal title', comments: 'Separate reviewer source record.', verifiedCompletion: 45, qualityRating: 2 }];
  const state = await setup(page, report); await openReport(page);
  const savedMeters = analytics(page).getByRole('meter', { name: 'Repeated goal title: saved achievement', exact: true });
  await expect(savedMeters).toHaveCount(2);
  expect(await savedMeters.evaluateAll(elements => elements.map(element => element.getAttribute('aria-valuenow')))).toEqual(['20', '80']);
  await expectNarratives(page);
  await expect(page.locator('#review-record-content').getByText(/Verified completion: 45%.*Quality rating: 2/)).toBeVisible();
  await expect(page.locator('#review-record-content').getByText('Separate reviewer source record.', { exact: true })).toBeVisible();
  state.assertReadOnly();
});

test('keeps valid recorded zero distinct from missing ratings and unrated goal evidence', async ({ page }) => {
  const report = populatedReport(); report.ratingScale = { min: 0, max: 5 }; report.finalRating.overall = 0;
  report.goals = [{ title: 'Recorded zero goal', score: 0 }, { title: 'Unrated goal', score: null }];
  report.competencies = [{ name: 'Recorded zero competency', selfRating: 0, managerRating: null, managerComments: '' }];
  report.managerFeedback!.overallRating = 0;
  const state = await setup(page, report); await openReport(page);
  await expect(analytics(page)).toContainText('Recorded zero goal'); await expect(analytics(page)).toContainText('Unrated goal');
  await expect(analytics(page)).toContainText('Not rated');
  await expect(competencyChart(page)).toContainText(/Employee[\s\S]*0/);
  expect(await analytics(page).getByRole('meter').evaluateAll(elements => elements.some(element => element.getAttribute('aria-valuenow') === '0'))).toBe(true);
  await expectValidMeters(page); state.assertReadOnly();
});

test('empty report does not fabricate zero scores, comparisons or evidence counts', async ({ page }) => {
  const report = populatedReport(); report.finalRating.overall = null; report.goals = []; report.competencies = []; report.managerFeedback = null;
  report.aiReport = { state: 'not_generated' };
  const state = await setup(page, report); await openReport(page);
  await expect(analytics(page)).toContainText('No goal evidence was attached to this appraisal.');
  await expect(analytics(page).getByRole('meter')).toHaveCount(0);
  await expect(analytics(page).getByRole('figure', { name: 'Report evidence', exact: true })).toContainText('Not available');
  await expect(analytics(page).getByRole('figure', { name: 'Report evidence', exact: true })).not.toContainText('0 sources');
  await expect(analytics(page)).not.toContainText('NaN');
  await expectNarratives(page); state.assertReadOnly();
});

test('custom fractional range is used for ratings while reviewer goal quality remains on its own scale', async ({ page }) => {
  const report = populatedReport(); report.ratingScale = { min: 0, max: 0.5 }; report.finalRating.overall = 0.5;
  report.managerFeedback!.overallRating = 0.25;
  report.competencies = [{ name: 'Fractional-range competency', selfRating: 0, managerRating: 0.5, managerComments: '' }];
  const state = await setup(page, report); await openReport(page);
  await expect(competencyChart(page)).toContainText('Fractional-range competency');
  await expect(competencyChart(page)).toContainText('0.5');
  // The upper-bound point must reach the end of the actual plot axis even when
  // the configured span is less than one; no Math.max(1, span) normalization.
  const outcomePlot = analytics(page).getByRole('img', { name: /^Published outcome:/ });
  await expect(outcomePlot.locator('circle')).toHaveCount(1);
  await expect(outcomePlot.locator('circle')).toHaveAttribute('cx', '292');
  const competencyPlot = competencyChart(page).getByRole('img', { name: /^Fractional-range competency:/ });
  await expect(competencyPlot.locator('circle[cy="22"]')).toHaveAttribute('cx', '292');
  await expect(competencyPlot.locator('circle[cy="12"]')).toHaveAttribute('cx', '8');
  await expectValidMeters(page); await expectNarratives(page);
  await expect(analytics(page).getByText('Quality rating: 4 / 5 · Separate 1–5 scale', { exact: true })).toBeVisible();
  await expect(analytics(page).getByRole('img', { name: /^Saved adoption goal: reviewer quality rating 4;/ }).locator('circle')).toHaveAttribute('cx', '221');
  await expect(analytics(page).getByRole('meter', { name: 'Saved adoption goal: reviewer verified completion', exact: true })).toHaveAttribute('aria-valuenow', '60');
  // The 75% snapshot and 60% reviewer verification must not be normalized to .5.
  await expect(analytics(page)).toContainText('75');
  state.assertReadOnly();
});

test('out-of-range recorded values cannot create invalid accessible meters', async ({ page }) => {
  const report = populatedReport(); report.finalRating.overall = 8; report.managerFeedback!.overallRating = -1;
  report.goals = [{ title: 'Above-range saved goal', score: 140 }, { title: 'Below-range saved goal', score: -20 }];
  report.competencies = [{ name: 'Outside configured range', selfRating: -2, managerRating: 9, managerComments: '' }];
  report.managerFeedback!.goals[0].verifiedCompletion = 125; report.managerFeedback!.goals[0].qualityRating = 8;
  const state = await setup(page, report); await openReport(page);
  await expectValidMeters(page);
  await expect(analytics(page).getByRole('meter')).toHaveCount(0);
  await expect(competencyChart(page).getByRole('img', { name: /^Outside configured range:/ }).locator('circle')).toHaveCount(0);
  await expect(analytics(page).getByRole('img', { name: /^Published outcome:/ }).locator('circle')).toHaveCount(0);
  await expect(analytics(page).getByRole('img', { name: /^Saved adoption goal: reviewer quality rating 8;/ }).locator('circle')).toHaveCount(0);
  await expect(analytics(page).getByText(/Unweighted mean:/)).toHaveCount(0);
  await expect(analytics(page)).not.toContainText('NaN');
  await expectNarratives(page); state.assertReadOnly();
});

test('string values and absent scale are not coerced into numeric ratings or an invented range', async ({ page }) => {
  const report = populatedReport(); report.ratingScale = {}; report.finalRating.overall = '4';
  report.managerFeedback = null; report.goals = [{ title: 'String-valued goal', score: '75' }];
  report.competencies = [{ name: 'Invalid wire rating', selfRating: '0', managerRating: '4', managerComments: '' }];
  const state = await setup(page, report); await openReport(page);
  await expect(analytics(page).getByRole('meter')).toHaveCount(0);
  await expect(analytics(page)).not.toContainText('Scale 1–5');
  await expect(analytics(page)).not.toContainText('NaN');
  await expectNarratives(page); state.assertReadOnly();
});

for (const aiState of ['pending', 'failed'] as const) {
  test(`keeps recorded human results and narrative available when AI is ${aiState}`, async ({ page }) => {
    const report = populatedReport(); report.aiReport = { state: aiState };
    const state = await setup(page, report); await openReport(page); await expectNarratives(page);
    const ai = page.getByRole('region', { name: 'AI appraisal report', exact: true });
    await expect(ai.getByRole('status')).toContainText(aiState === 'pending' ? 'queued or being generated' : 'could not be generated');
    const generate = ai.getByRole('button', { name: 'Generate with my ChatGPT account', exact: true });
    if (aiState === 'pending') await expect(generate).toBeDisabled();
    else await expect(generate).toBeEnabled();
    state.assertReadOnly();
  });
}

test('stale generated content is hidden while saved human data and review evidence remain available', async ({ page }) => {
  const report = populatedReport(); report.aiReport = { state: 'stale', content: 'Stale generated narrative must remain hidden.' };
  const state = await setup(page, report); await openReport(page);
  await expect(page.getByText('Stale generated narrative must remain hidden.', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'AI appraisal report', exact: true }).getByRole('status')).toContainText('previous report is hidden');
  await expect(analytics(page).getByRole('meter', { name: 'Saved adoption goal: saved achievement', exact: true })).toHaveAttribute('aria-valuenow', '75');
  await expectNarratives(page); state.assertReadOnly();
});

test('source exploration and keyboard narrative expansion expose the retained evidence and complete analysis', async ({ page }) => {
  const state = await setup(page, populatedReport()); await openReport(page);
  const sourceDisclosure = page.getByRole('button', { name: 'Report sources and evidence gaps', exact: true });
  await expect(sourceDisclosure).toHaveAttribute('aria-expanded', 'false');
  await analytics(page).getByRole('button', { name: 'Explore report sources', exact: true }).click();
  await expect(sourceDisclosure).toHaveAttribute('aria-expanded', 'true');
  await expect(sourceDisclosure).toBeFocused();
  const sources = page.getByRole('region', { name: 'Report sources and evidence gaps', exact: true });
  await expect(sources).toContainText('Synthetic retained document');
  await expect(sources).toContainText('Synthetic meeting transcript is unavailable.');
  // aria-controls must resolve one region, rather than duplicate IDs on the
  // MUI-generated region and its nested AccordionDetails.
  for (const id of ['final-report-sources-content', 'review-record-content', 'final-analysis-0-content']) await expect(page.locator(`[id="${id}"]`)).toHaveCount(1);
  const priorities = page.getByRole('region', { name: 'AI appraisal report', exact: true }).getByRole('button', { name: 'Development priorities', exact: true });
  await expect(priorities).toHaveAttribute('aria-expanded', 'false');
  await priorities.focus(); await expect(priorities).toBeFocused(); await priorities.press('Enter');
  await expect(priorities).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('Retain the full generated narrative and its limitations.', { exact: true })).toBeVisible();
  state.assertReadOnly();
});

test('employee can read the published result without AI generation or connection controls', async ({ page }) => {
  const report = populatedReport(); report.canGenerateAIReport = false;
  const state = await setup(page, report, 'employee'); await openReport(page); await expectNarratives(page);
  await expect(page.getByRole('button', { name: /(?:Re)?generate with my ChatGPT account/i })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'My ChatGPT connection', exact: true })).toHaveCount(0);
  state.assertReadOnly();
});

test('long unstructured AI and saved rationale remain compact initially and fully keyboard/print accessible', async ({ page }) => {
  const report = populatedReport();
  const longAI = 'A long unstructured synthetic analysis preserves the source limitations and the human decision. '.repeat(35) + 'Final AI sentence is retained. [DOC1]';
  const rationale = 'The published human rationale retains the employee context and recorded reviewer reasoning. '.repeat(25) + 'Final rationale sentence is retained.';
  report.aiReport.content = longAI; delete report.aiReport.coverage; report.finalRating.justification = rationale;
  const state = await setup(page, report); await openReport(page);
  const ai = page.getByRole('region', { name: 'AI appraisal report', exact: true });
  const analysisDisclosure = ai.getByRole('button', { name: 'Current assessment', exact: true });
  await expect(analysisDisclosure).toHaveAttribute('aria-expanded', 'false');
  const fullAI = ai.getByText(longAI.replace(' [DOC1]', ''), { exact: true }).filter({ visible: true }); await expect(fullAI).toHaveCount(0);
  await analysisDisclosure.focus(); await expect(analysisDisclosure).toBeFocused(); await analysisDisclosure.press('Enter');
  await expect(analysisDisclosure).toHaveAttribute('aria-expanded', 'true'); await expect(fullAI).toBeVisible();
  await expect(ai.getByText('Source details are not available for this report.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^View sources/ })).toHaveCount(0);
  await expect(analytics(page).getByRole('button', { name: 'Read full analysis', exact: true })).toBeVisible();
  const readRationale = analytics(page).getByRole('button', { name: 'Read full final rationale', exact: true });
  await expect(readRationale).toHaveAttribute('aria-expanded', 'false');
  const controls = await readRationale.getAttribute('aria-controls'); expect(controls).toBeTruthy();
  const rationaleText = page.locator(`[id="${controls}"]`);
  await expect(rationaleText).toHaveText(rationale); await expect(rationaleText).toHaveCSS('-webkit-line-clamp', '5');
  await readRationale.focus(); await expect(readRationale).toBeFocused(); await readRationale.press('Enter');
  const collapseRationale = analytics(page).getByRole('button', { name: 'Show less final rationale', exact: true });
  await expect(collapseRationale).toBeFocused(); await expect(collapseRationale).toHaveAttribute('aria-expanded', 'true');
  expect(await rationaleText.evaluate(element => element.clientHeight >= element.scrollHeight)).toBe(true);
  await collapseRationale.press('Enter'); await expect(rationaleText).toHaveCSS('-webkit-line-clamp', '5');
  await analysisDisclosure.click(); await expect(analysisDisclosure).toHaveAttribute('aria-expanded', 'false');
  await page.emulateMedia({ media: 'print' });
  await expect(rationaleText).not.toHaveCSS('-webkit-line-clamp', '5');
  expect(await rationaleText.evaluate(element => element.clientHeight >= element.scrollHeight)).toBe(true);
  await expect(ai.getByText(longAI, { exact: true }).filter({ visible: true })).toHaveCount(1); state.assertReadOnly();
});

test('CSV and print retain raw evidence, narratives and the published human result', async ({ page }, info) => {
  const report = populatedReport(); report.managerSummary.strengths = '=SYNTHETIC formula-like reviewer narrative';
  for (let index = 2; index <= 6; index++) {
    report.goals.push({ title: `Print-only full goal row ${index}`, score: index * 10 });
    report.competencies.push({ name: `Print full competency row ${index}`, selfRating: 2, managerRating: 4, managerComments: `Retained row ${index} reviewer evidence.` });
  }
  const state = await setup(page, report); await openReport(page);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download CSV', exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('appraisal-result-report.csv');
  const csv = await readFile((await download.path())!, 'utf8');
  for (const value of [employeeNarrative, discussionNarrative, '4 / 5', 'Saved adoption goal', '75%', '60', 'Customer communication', 'Reviewer evidence remains separate']) expect(csv).toContain(value);
  expect(csv).toContain("'=SYNTHETIC formula-like reviewer narrative");
  expect(csv).toContain(report.aiReport.content!);
  await page.evaluate(() => { window.print = () => { document.body.dataset.reportPrinted = 'true'; }; });
  await page.getByRole('button', { name: 'Print / save PDF', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-report-printed', 'true');
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByText(employeeNarrative, { exact: true })).toBeVisible();
  await expect(page.getByText(discussionNarrative, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download CSV', exact: true })).not.toBeVisible();
  await expect(page.getByText('Print-only full goal row 6', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Print full competency row 6', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(report.aiReport.content!, { exact: true }).filter({ visible: true })).toHaveCount(1);
  await expect(page.getByText(report.aiReport.content!, { exact: true }).filter({ visible: true })).toContainText('[DOC1]');
  await expect(page.locator('#final-report-sources-content')).toContainText('[DOC1]');
  await expect(page.getByRole('button', { name: /^View sources/ })).toHaveCount(0);
  const visibleMarks = await analytics(page).locator('[role="meter"] > *, svg circle, svg rect').evaluateAll(elements => elements.filter(element => {
    const box = element.getBoundingClientRect(); const style = getComputedStyle(element);
    const colors = [style.fill, style.backgroundColor];
    return box.width > 0 && box.height > 0 && colors.some(color => !['none', 'transparent', 'rgba(0, 0, 0, 0)', 'rgb(255, 255, 255)'].includes(color));
  }).length);
  expect(visibleMarks).toBeGreaterThan(0);
  await page.pdf({ path: info.outputPath('synthetic-analytical-result-print.pdf'), format: 'A4', printBackground: true });
  state.assertReadOnly();
});
