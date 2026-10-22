import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

// Actual app.js, current IdP permissions/directory and disposable Mongo replica set.
// The loopback identity fixture supplies synthetic users; no product response is mocked.
const API = 'http://127.0.0.1:5014/api';
async function call(request: APIRequestContext, actor: string, method: string, path: string, data?: unknown, revision?: number) {
  const response = await request.fetch(`${API}/${path}`, { method, headers: { 'x-acceptance-actor': actor, 'Idempotency-Key': randomUUID(), ...(revision !== undefined ? { 'If-Match': String(revision) } : {}) }, data });
  expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBeTruthy();
  return (await response.json()).data;
}
async function select(page: Page, label: string, option: string) {
  await page.locator('label').filter({ hasText: label }).first().locator('..').getByRole('combobox').click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

test('a new role-only appraisal explicitly waives goals while preserving questions, selected reviewer and final scoring', async ({ page, request }, info) => {
  test.setTimeout(180_000);
  const stamp = Date.now(), title = `Role-only ordinary review ${stamp}`;
  await call(request, 'admin', 'PATCH', 'organization-features', { features: { competencyAssessments: true } });
  const framework = await call(request, 'admin', 'POST', 'competency/frameworks', { name: `Role-only source ${stamp}`, sourceType: 'internal', source: 'Authored synthetic acceptance material.', levels: [{ id: 'independent', label: 'Independent', order: 1, description: 'Delivers agreed work independently.' }], criteria: [{ id: 'delivery', name: 'Delivery', code: 'DEL', description: 'Reliable delivery.', levelIds: ['independent'] }] });
  const source = await call(request, 'admin', 'POST', `competency/frameworks/${framework.id}/versions/${framework.draftVersion.id}/publish`, {}, 1);
  const role = await call(request, 'admin', 'POST', 'competency/roles', { name: `Role-only occupational role ${stamp}`, description: 'Synthetic work expectations.', responsibilities: [{ id: 'r', text: 'Deliver agreed work.' }], requirements: [], criteria: [{ id: 'delivery', sourceType: 'internal', criterionId: 'delivery', frameworkVersionId: source.id, expectedLevelId: 'independent', weight: 1, required: true, evidenceRequired: false, rationaleRequired: true, responsibilityIds: ['r'], requirementIds: [] }] });
  const roleVersion = await call(request, 'admin', 'POST', `competency/roles/${role.id}/versions/${role.draftVersion.id}/publish`, {}, 1);
  const configuration = await call(request, 'admin', 'POST', 'competency/cycles', { name: title, reviewMode: 'combined', includeApprovedGoals: true, regularTemplateId: 'balanced_performance', period: { start: '2020-01-01', end: '2020-03-31' }, selectedInputTypes: ['internal'], frameworkVersionIds: [source.id], strategyVersionIds: [], roleVersionIds: [roleVersion.id], scoringConfig: { version: 1, method: 'weighted_mean', weightMode: 'relative', inputWeights: { internal: 1 }, ratingScales: [], normalization: [{ sourceVersionId: source.id, criterionId: 'delivery', method: 'level_map', levelScores: { independent: 80 } }], thresholds: [{ id: 'development', label: 'Development needed', minInclusive: 0, maxExclusive: 75 }, { id: 'suitable', label: 'Suitable', minInclusive: 75, maxInclusive: 100 }], missingPolicy: 'block_unless_authorised_exception', exceptionPolicy: 'retain_as_unscored' }, rankingConfig: { enabled: false } });
  const templates = await call(request, 'admin', 'GET', 'appraisals/cycle-templates');
  const template = templates.find((value: { id: string }) => value.id === 'balanced_performance');
  const pageErrors: string[] = []; page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:5014/__test/login/admin?path=${encodeURIComponent(`/competency/cycles/${configuration.id}`)}`);
  await expect(page.getByRole('button', { name: 'Account menu', exact: true })).toBeVisible();
  // Combined is the current equivalent of an ordinary appraisal with a linked
  // occupational assessment. Its native role result remains a separate score.
  await expect(page.getByRole('checkbox', { name: 'Include approved goals', exact: true })).toBeChecked();
  await page.getByRole('checkbox', { name: 'Include approved goals', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
  await page.getByText('Review', { exact: true }).click();
  await page.getByRole('button', { name: 'Check readiness', exact: true }).click();
  await expect(page.getByText('Configuration is valid and ready to publish.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Publish cycle', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publish cycle', exact: true }).click();
  await expect(page.getByText('Cycle published. Select it when starting an appraisal.', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Start appraisals', exact: true }).click();
  await page.getByRole('textbox', { name: 'Find staff', exact: true }).fill('employee');
  await page.getByRole('checkbox', { name: 'Select Acceptance employee', exact: true }).check();
  await select(page, 'Reviewer for Acceptance employee', 'Acceptance manager');
  await select(page, 'Role for Acceptance employee', `Role-only occupational role ${stamp} · v1`);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('switch', { name: 'AI conversation for employee assessment', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Remove One-on-one meeting', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const created = page.waitForResponse(response => response.url() === `${API}/competency/cycles/${configuration.id}/start-appraisals` && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Start 1 appraisal', exact: true }).click();
  const response = await created; expect(response.status()).toBe(201);
  const result = (await response.json()).data, parentId = result.appraisals[0]._id;
  await expect(page.getByRole('heading', { name: 'Appraisals started', exact: true })).toBeVisible();
  expect(result.launched).toBe(1);
  const parent = await call(request, 'admin', 'GET', `appraisals/${parentId}`);
  expect(parent.cycleConfigurationSnapshot.settings.requireOkrAlignment).toBe(false);
  // Goal inclusion and the independently chosen assessment mode stay separate.
  expect(parent.cycleConfigurationSnapshot.appraisalFlow.assessmentMode).toBe('form');
  expect(parent.cycleId.settings.enableAiAssist).toBe(true);
  expect(parent.manager.userId).toBe('acceptance-manager'); expect(parent.goalSnapshots).toHaveLength(0);
  const design = parent.cycleConfigurationSnapshot.workflowDefinition;
  expect(design.scoring).toEqual({ goalsWeight: 0, competenciesWeight: 100 });
  expect(design.sections.filter((section: { id: string }) => !section.id.startsWith('role_evidence_'))).toEqual(template.design.sections.filter((section: { type: string }) => section.type !== 'goals').map((section: { type: string; weight: number }) => section.type === 'competencies' ? { ...section, weight: 100 } : section));
  expect(design.sections.find((section: { id: string }) => section.id.startsWith('role_evidence_')).questions[0]).toMatchObject({ responseType: 'long_text', required: true, prompt: expect.stringContaining('Delivery') });
  const links = await call(request, 'admin', 'GET', `competency/appraisal-links/${parentId}`); expect(links.assessments).toHaveLength(1);
  await page.screenshot({ path: info.outputPath('role-only-launch-receipt.png'), fullPage: true });
  // Each manual submission opts out of optional AI analysis while preserving
  // the published cycle's independently enabled AI setting.
  for (const [actor, respondent] of [['employee', 'employee'], ['manager', 'manager']]) {
    const responses = design.sections.filter((section: { respondent: string }) => [respondent, 'both'].includes(section.respondent)).flatMap((section: { id: string; questions: Array<{ id: string; responseType: string; options: string[] }> }) => section.questions.map(question => ({ sectionId: section.id, questionId: question.id, value: ['number', 'rating'].includes(question.responseType) ? 4 : question.responseType === 'boolean' ? true : question.responseType === 'multi_select' ? [question.options[0]] : question.responseType === 'single_select' ? question.options[0] : 'Synthetic role exercise evidence and development response.' })));
    await call(request, actor, 'PUT', `appraisals/${parentId}/custom-responses`, { respondentRole: respondent, submit: true, responses });
    if (actor === 'employee') await call(request, actor, 'POST', `appraisals/${parentId}/self-assessment`, { assessmentMode: 'form', submit: true, selfAssessment: { overallSelfRating: 4, overallSummary: { achievements: 'Delivered the synthetic work independently.', challenges: 'Resolved an invented dependency.', learnings: 'Applied the synthetic evidence checklist.', improvements: 'Improve the next fictional handover.', goals: 'Practise the next synthetic capability.' } } });
    else await call(request, actor, 'POST', `appraisals/${parentId}/manager-review`, { assessmentMode: 'form', submit: true, managerReview: { overallManagerRating: 4, competencyRatings: parent.cycleId.competencies.map((criterion: { id: string; name: string }) => ({ competencyId: criterion.id, competencyName: criterion.name, managerRating: 4, managerComments: 'Observed synthetic role evidence.' })), overallSummary: { achievements: 'Completed the fictional role exercise.', strengths: 'Clear structured explanation.' } } });
  }
  const scored = await call(request, 'manager', 'GET', `appraisals/${parentId}/scoring`);
  expect(scored.compositeScore).toBe(4); expect(scored.breakdown).toMatchObject({ okrWeight: 0, competencyWeight: 100 });
  expect(pageErrors).toEqual([]);
});
