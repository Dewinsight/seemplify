import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

const date = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const summary = {
  achievements: 'Delivered the synthetic review milestone with documented human evidence.',
  challenges: 'Resolved a fictional dependency through early planning and clear ownership.',
  learnings: 'Applied a structured discovery method to the synthetic delivery.',
  improvements: 'Improve the next fictional handover with a shared checklist.',
  goals: 'Complete the next synthetic milestone with measurable evidence.'
};
async function api(request: APIRequestContext, actor: string, method: string, path: string, data?: unknown) {
  const response = await request.fetch(`http://127.0.0.1:5014/api/${path}`, {
    method, headers: { 'x-acceptance-actor': actor }, data
  });
  expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBeTruthy();
  return (await response.json()).data;
}
async function launch(request: APIRequestContext) {
  const templates = await api(request, 'hr_manager', 'GET', 'appraisals/cycle-templates');
  const design = structuredClone(templates[0].design);
  design.stages.calibration.enabled = false;
  design.sections.forEach((section: { questions: Array<{ required: boolean }> }) =>
    section.questions.forEach(question => { question.required = false; }));
  design.sections.push({ id: 'manual-draft-proof', title: 'Required manual draft evidence', type: 'custom',
    respondent: 'employee', required: true, scored: false, weight: 0, evidenceRequired: false,
    questions: [{ id: 'outcome', prompt: 'Describe the synthetic outcome for this manual draft.',
      responseType: 'long_text', required: true }] });
  const { cycle } = await api(request, 'hr_manager', 'POST', 'appraisals/cycles', {
    name: `Manual unrated draft ${Date.now()}`, periodStart: date(-90), periodEnd: date(-1),
    settings: { enableAiAssist: true, allowSelfRating: true, requireOkrAlignment: false },
    workflowDefinition: design, launchNow: true, reviewerMode: 'selected',
    employees: [{ userId: 'acceptance-employee', reviewerId: 'acceptance-manager' }]
  });
  const items = await api(request, 'employee', 'GET', 'appraisals/my');
  const listed = items.find((item: { cycleId: { _id: string } }) => item.cycleId._id === cycle._id);
  expect(listed).toBeTruthy();
  const appraisal = await api(request, 'employee', 'GET', `appraisals/${listed._id}`);
  expect(appraisal.cycleConfigurationSnapshot.settings.enableAiAssist).toBe(true);
  expect(appraisal.cycleId.competencies.length).toBeGreaterThan(0);
  return appraisal;
}
async function login(page: Page, actor: string, path: string) {
  await page.goto(`http://127.0.0.1:5014/__test/login/${actor}?path=${encodeURIComponent(path)}`);
  await expect(page).toHaveURL(new RegExp(`${path.split('?')[0]}(?:\\?|#|$)`));
}
async function chooseManual(page: Page) {
  const gate = page.getByRole('dialog', { name: 'ChatGPT is required', exact: true });
  await expect(gate).toBeVisible();
  await gate.getByRole('button', { name: 'Use manual form', exact: true }).click();
  await expect(page.getByText('Manual Mode', { exact: true })).toBeVisible();
  await expect(gate).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('assessmentMode')).toBe('form');
}
async function saveDraft(page: Page, id: string) {
  const response = page.waitForResponse(value => value.request().method() === 'POST' &&
    value.url().endsWith(`/api/appraisals/${id}/self-assessment`));
  await page.getByRole('button', { name: 'Save Draft', exact: true }).click();
  const saved = await response;
  expect(saved.status()).toBe(200);
  expect(saved.request().postDataJSON()).toMatchObject({ assessmentMode: 'form', submit: false });
  // Custom sections save first; await the main form receipt before reloading.
  await expect(page.getByText('Progress saved.', { exact: true })).toBeVisible();
}
async function clickStar(scope: Locator, value: number) {
  const id = await scope.locator(`input[value="${value}"]`).getAttribute('id');
  expect(id).toBeTruthy();
  await scope.locator(`label[for="${id}"]`).click();
}
const chosenStars = (scope: Locator) => scope.getByRole('radio', { name: /^[1-5] Stars?$/, checked: true });

test('AI-enabled manual partial draft and cleared competency stay unrated across actual API saves and reload', async ({ page, request }, info) => {
  const appraisal = await launch(request);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 'employee', `/appraisals/${appraisal._id}/self-assessment?source=history`);
  await chooseManual(page);
  const achievement = page.getByRole('textbox', { name: 'Key Achievements', exact: true });
  await achievement.fill(summary.achievements);
  const overall = page.getByText('Overall Self-Rating', { exact: true }).locator('..');
  await expect(chosenStars(overall)).toHaveCount(0);
  const competencies = page.getByText('Competency Self-Ratings', { exact: true }).locator('..');
  const firstCompetency = competencies.locator('.MuiPaper-outlined').first();
  await expect(firstCompetency.locator('input[value="3"]')).toBeChecked();
  await saveDraft(page, appraisal._id);
  let stored = await api(request, 'employee', 'GET', `appraisals/${appraisal._id}`);
  expect(stored.status).toBe('self_assessment_in_progress');
  expect(stored.selfAssessment.submittedAt).toBeFalsy();
  expect(stored.selfAssessment.overallSelfRating).toBeUndefined();
  expect(stored.selfAssessment.overallSummary.achievements).toBe(summary.achievements);
  expect(stored.selfAssessment.competencyRatings[0].selfRating).toBe(3);
  await page.reload();
  await expect(page.getByText('Manual Mode', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'ChatGPT is required', exact: true })).toHaveCount(0);
  await expect(achievement).toHaveValue(summary.achievements);
  await expect(chosenStars(overall)).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('source')).toBe('history');
  // Clicking the selected star clears it using the real MUI interaction.
  await clickStar(firstCompetency, 3);
  await expect(chosenStars(firstCompetency)).toHaveCount(0);
  await saveDraft(page, appraisal._id);
  stored = await api(request, 'employee', 'GET', `appraisals/${appraisal._id}`);
  expect(stored.selfAssessment.competencyRatings[0].selfRating).toBeUndefined();
  expect(stored.selfAssessment.overallSelfRating).toBeUndefined();
  await page.reload();
  await expect(achievement).toHaveValue(summary.achievements);
  await expect(chosenStars(firstCompetency)).toHaveCount(0);
  await page.getByRole('button', { name: 'Submit Self-Assessment', exact: true }).click();
  await expect(page.getByText('Please choose your overall self-rating before submitting.', { exact: true })).toBeVisible();
  await clickStar(overall, 4);
  await page.getByRole('button', { name: 'Submit Self-Assessment', exact: true }).click();
  await expect(page.getByText(/Complete the required cycle questions:/)).toBeVisible();
  for (const [label, value] of Object.entries({ 'Challenges Faced': summary.challenges, 'Key Learnings': summary.learnings,
    'Goals for Next Period': summary.goals, 'Areas for Improvement': summary.improvements }))
    await page.getByRole('textbox', { name: label, exact: true }).fill(value);
  await page.getByRole('textbox', { name: /Describe the synthetic outcome for this manual draft/ }).fill('The documented synthetic outcome is ready for the human reviewer.');
  await page.screenshot({ path: info.outputPath('manual-unrated-draft-mobile.png'), fullPage: true, animations: 'disabled' });
  const response = page.waitForResponse(value => value.request().method() === 'POST' &&
    value.url().endsWith(`/api/appraisals/${appraisal._id}/self-assessment`) && value.request().postDataJSON()?.submit === true);
  await page.getByRole('button', { name: 'Submit Self-Assessment', exact: true }).click();
  expect((await response).status()).toBe(200);
  stored = await api(request, 'employee', 'GET', `appraisals/${appraisal._id}`);
  expect(stored.status).toBe('manager_review_pending');
  expect(stored.selfAssessment.submittedAt).toBeTruthy();
  expect(stored.selfAssessment.overallSelfRating).toBe(4);
  expect(stored.selfAssessment.competencyRatings[0].selfRating).toBeUndefined();
  expect(stored.selfAssessment.overallSummary).toMatchObject(summary);
  expect(stored.customResponses.find((item: { sectionId: string }) => item.sectionId === 'manual-draft-proof').submittedAt).toBeTruthy();
});

test('reviewer API draft omits unchosen ratings and manual browser reload retains the draft without hidden writes', async ({ page, request }) => {
  const appraisal = await launch(request);
  await api(request, 'employee', 'PUT', `appraisals/${appraisal._id}/custom-responses`, {
    respondentRole: 'employee', submit: true, responses: [{ sectionId: 'manual-draft-proof', questionId: 'outcome',
      value: 'The documented synthetic outcome is ready for manual review.' }]
  });
  await api(request, 'employee', 'POST', `appraisals/${appraisal._id}/self-assessment`, {
    assessmentMode: 'form', submit: true, selfAssessment: { overallSelfRating: 4, overallSummary: summary }
  });
  await api(request, 'manager', 'POST', `appraisals/${appraisal._id}/manager-review/start`, {});
  const note = 'Retained reviewer notes before choosing an overall human rating.';
  await api(request, 'manager', 'POST', `appraisals/${appraisal._id}/manager-review`, {
    assessmentMode: 'form', submit: false, managerReview: { overallSummary: { strengths: note },
      competencyRatings: [{ competencyId: appraisal.cycleId.competencies[0].id, managerRating: null }] }
  });
  const readDraft = async () => {
    const stored = await api(request, 'manager', 'GET', `appraisals/${appraisal._id}`);
    expect(stored.managerReview.overallManagerRating).toBeUndefined();
    expect(stored.managerReview.competencyRatings[0].managerRating).toBeUndefined();
    expect(stored.managerReview.submittedAt).toBeFalsy();
    expect(stored.managerReview.overallSummary.strengths).toBe(note);
  };
  await readDraft();
  await login(page, 'manager', `/appraisals/${appraisal._id}/manager-review`);
  await expect(page.getByRole('group', { name: 'Review form progress', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('group', { name: 'Review form progress', exact: true })).toBeVisible();
  await readDraft();
  // The existing reviewer UI visibly starts at3. Viewing it is not a save.
  for (let index = 0; index < 3; index++) await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Key Strengths', exact: true })).toHaveValue(note);
});
