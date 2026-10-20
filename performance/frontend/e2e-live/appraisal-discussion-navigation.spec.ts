import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

async function api(request: APIRequestContext, actor: string, method: string, path: string, data?: unknown) {
  const response = await request.fetch(`http://127.0.0.1:5014/api/${path}`, { method, headers: { 'x-acceptance-actor': actor }, data });
  expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBeTruthy();
  return (await response.json()).data;
}
async function login(page: Page, actor: string, path: string) {
  await page.goto(`http://127.0.0.1:5014/__test/login/${actor}?path=${encodeURIComponent(path)}`);
  await expect(page.getByRole('button', { name: 'A', exact: true })).toBeVisible();
}

test('custom manual appraisal exposes its actual discussion stage and preserves completed discussion reading', async ({ page, request }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const templates = await api(request, 'hr_manager', 'GET', 'appraisals/cycle-templates');
  const design = structuredClone(templates[0].design);
  design.stages.calibration.enabled = false;
  design.sections.forEach((section: { questions: Array<{ required: boolean }> }) => section.questions.forEach(question => { question.required = false; }));
  const date = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
  const created = await api(request, 'hr_manager', 'POST', 'appraisals/cycles', {
    name: `Discussion navigation ${Date.now()}`, periodStart: date(-90), periodEnd: date(-1), workflowDefinition: design,
    settings: { enableAiAssist: false, requireOkrAlignment: false }, launchNow: true,
    reviewerMode: 'selected', employees: [{ userId: 'acceptance-employee', reviewerId: 'acceptance-manager' }],
    appraisalFlow: { assessmentMode: 'form', steps: ['selfAssessment', 'managerReview', 'discussion', 'finalReview', 'acknowledgement'].map((type, index) => ({ id: `${type}_${index}`, type, label: type })) }
  });
  const appraisal = (await api(request, 'employee', 'GET', 'appraisals/my')).find((item: { cycleId: { _id: string } }) => item.cycleId._id === created.cycle._id);
  const detail = `/appraisals/${appraisal._id}`;
  await login(page, 'employee', detail);
  await expect(page.getByRole('button', { name: 'Open Discussion', exact: true })).toHaveCount(0);
  await api(request, 'employee', 'POST', `appraisals/${appraisal._id}/self-assessment`, { assessmentMode: 'form', submit: true, selfAssessment: { overallSelfRating: 4, overallSummary: {
    achievements: 'Delivered the fictional milestone.', challenges: 'Resolved a documented dependency.', learnings: 'Practised structured discovery.', goals: 'Record the next milestone evidence.'
  } } });
  await api(request, 'manager', 'POST', `appraisals/${appraisal._id}/manager-review/start`);
  await api(request, 'manager', 'POST', `appraisals/${appraisal._id}/manager-review`, { assessmentMode: 'form', submit: true, managerReview: {
    overallManagerRating: 4, competencyRatings: appraisal.cycleConfigurationSnapshot.competencies.map((criterion: { id: string; name: string }) => ({ competencyId: criterion.id, competencyName: criterion.name, managerRating: 4, managerComments: 'Observed documented fictional evidence.' }))
  } });
  expect(await api(request, 'employee', 'GET', `appraisals/${appraisal._id}`)).toMatchObject({ status: 'discussion_scheduled' });
  for (const actor of ['employee', 'manager']) {
    await login(page, actor, detail);
    await page.getByRole('button', { name: 'Open Discussion', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/appraisals/${appraisal._id}/discussion$`));
    if (actor === 'employee') await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  }
  const notes = { agreedStrengths: ['Synthetic discussion evidence retained.'], nextSteps: 'Confirm the next fictional milestone.' };
  expect((await request.put(`http://127.0.0.1:5014/api/appraisals/${appraisal._id}/discussion`, { headers: { 'x-acceptance-actor': 'employee' }, data: { notes: { nextSteps: 'Must not persist.' } } })).status()).toBe(403);
  await api(request, 'manager', 'PUT', `appraisals/${appraisal._id}/discussion`, { notes, markCompleted: true });
  expect(await api(request, 'employee', 'GET', `appraisals/${appraisal._id}`)).toMatchObject({ status: 'final_review_pending', discussion: { notes, completedDate: expect.any(String) } });
  for (const actor of ['employee', 'manager']) {
    await login(page, actor, detail);
    await expect(page.getByRole('button', { name: 'Open Discussion', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'View Discussion', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Agreed Strengths' })).toHaveValue(notes.agreedStrengths[0]);
    await expect(page.getByRole('textbox', { name: 'Agreed Strengths' })).toBeDisabled();
  }
  await page.screenshot({ path: info.outputPath('completed-custom-discussion-mobile.png'), fullPage: true });
  // A finished custom stage is locked before its route handler; foreign
  // tenant IDs remain absent at the resource lookup.
  for (const [actor, status] of [['employee', 409], ['foreign', 404]] as const) {
    const denied = await request.put(`http://127.0.0.1:5014/api/appraisals/${appraisal._id}/discussion`, { headers: { 'x-acceptance-actor': actor }, data: { notes: { nextSteps: 'Must not persist.' } } });
    expect(denied.status()).toBe(status);
  }
  expect((await request.get(`http://127.0.0.1:5014/api/appraisals/${appraisal._id}`, { headers: { 'x-acceptance-actor': 'foreign' } })).status()).toBe(404);
  expect((await api(request, 'employee', 'GET', `appraisals/${appraisal._id}`)).discussion.notes.nextSteps).toBe(notes.nextSteps);
});
