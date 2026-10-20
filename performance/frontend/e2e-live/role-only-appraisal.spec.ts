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
  const configuration = await call(request, 'admin', 'POST', 'competency/cycles', { name: `Role-only competency cycle ${stamp}`, period: { start: '2020-01-01', end: '2020-03-31' }, selectedInputTypes: ['internal'], frameworkVersionIds: [source.id], strategyVersionIds: [], roleVersionIds: [roleVersion.id], scoringConfig: { version: 1, method: 'weighted_mean', weightMode: 'relative', inputWeights: { internal: 1 }, ratingScales: [], normalization: [{ sourceVersionId: source.id, criterionId: 'delivery', method: 'level_map', levelScores: { independent: 80 } }], thresholds: [{ id: 'development', label: 'Development needed', minInclusive: 0, maxExclusive: 75 }, { id: 'suitable', label: 'Suitable', minInclusive: 75, maxInclusive: 100 }], missingPolicy: 'block_unless_authorised_exception', exceptionPolicy: 'retain_as_unscored' }, rankingConfig: { enabled: false } });
  await call(request, 'admin', 'POST', `competency/cycles/${configuration.id}/publish`, {}, 1);
  const templates = await call(request, 'admin', 'GET', 'appraisals/cycle-templates');
  const template = templates.find((value: { id: string }) => value.id === 'balanced_performance');
  const pageErrors: string[] = []; page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:5014/__test/login/admin?path=${encodeURIComponent('/appraisals/start')}`);
  await expect(page.getByRole('heading', { name: 'Choose staff', exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: /Acceptance employee/ }).check();
  await select(page, 'Reviewer for Acceptance employee', 'Acceptance manager · line manager');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await select(page, 'Review cycle', 'New one-off review');
  await page.getByRole('textbox', { name: 'Review name', exact: true }).fill(title);
  await page.getByLabel(/^Assessment period starts/).fill('2020-01-01');
  await page.getByLabel(/^Assessment period ends/).fill('2020-03-31');
  await page.getByRole('checkbox', { name: 'Assess against an occupational role', exact: true }).check();
  await select(page, 'Competency assessment cycle', `Role-only competency cycle ${stamp}`);
  await select(page, 'Assessment role for Acceptance employee', `Role-only occupational role ${stamp} v1`);
  await expect(page.getByRole('checkbox', { name: 'Include approved goals', exact: true })).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'Include approved goals', exact: true }).check();
  await expect(page.getByText(/No eligible approved goal for this period/)).toBeVisible();
  await page.getByRole('switch', { name: 'AI conversation for employee assessment', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Remove Performance discussion', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review details', exact: true })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: /Set up approved goals for each selected person/ })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Include approved goals', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Review without goals', { exact: true })).toBeVisible();
  const created = page.waitForResponse(response => response.url() === `${API}/appraisals/cycles` && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Start appraisals', exact: true }).click();
  const response = await created; expect(response.status()).toBe(201);
  const result = (await response.json()).data, parentId = result.launchSummary.appraisals[0]._id;
  await expect(page.getByText('Role assessment linked. Open this appraisal to review the frozen role expectations.', { exact: true })).toBeVisible();
  expect(result.launchSummary.launched).toBe(1); expect(result.cycle.settings.requireOkrAlignment).toBe(false);
  // Goal choice does not silently alter the independent AI-assistance policy.
  expect(result.cycle.settings.enableAiAssist).toBe(true);
  const parent = await call(request, 'admin', 'GET', `appraisals/${parentId}`);
  expect(parent.manager.userId).toBe('acceptance-manager'); expect(parent.goalSnapshots).toHaveLength(0);
  const design = parent.cycleConfigurationSnapshot.workflowDefinition;
  expect(design.scoring).toEqual({ goalsWeight: 0, competenciesWeight: 100 });
  expect(design.sections).toEqual(template.design.sections.filter((section: { type: string }) => section.type !== 'goals').map((section: { type: string; weight: number }) => section.type === 'competencies' ? { ...section, weight: 100 } : section));
  const links = await call(request, 'admin', 'GET', `competency/appraisal-links/${parentId}`); expect(links.assessments).toHaveLength(1);
  await page.screenshot({ path: info.outputPath('role-only-launch-receipt.png'), fullPage: true });
  // Disable optional analysis explicitly through the supported HR settings API
  // for this isolated scoring exercise; the goal-policy UI did not change it.
  await call(request, 'admin', 'PUT', `appraisals/cycles/${result.cycle._id}`, { settings: { enableAiAssist: false } });
  for (const [actor, respondent] of [['employee', 'employee'], ['manager', 'manager']]) {
    const responses = design.sections.filter((section: { respondent: string }) => [respondent, 'both'].includes(section.respondent)).flatMap((section: { id: string; questions: Array<{ id: string; responseType: string; options: string[] }> }) => section.questions.map(question => ({ sectionId: section.id, questionId: question.id, value: ['number', 'rating'].includes(question.responseType) ? 4 : question.responseType === 'boolean' ? true : question.responseType === 'multi_select' ? [question.options[0]] : question.responseType === 'single_select' ? question.options[0] : 'Synthetic role exercise evidence and development response.' })));
    await call(request, actor, 'PUT', `appraisals/${parentId}/custom-responses`, { respondentRole: respondent, submit: true, responses });
    if (actor === 'employee') await call(request, actor, 'POST', `appraisals/${parentId}/self-assessment`, { submit: true, selfAssessment: { overallSelfRating: 4, overallSummary: { achievements: 'Delivered the synthetic work independently.', challenges: 'Resolved an invented dependency.', learnings: 'Applied the synthetic evidence checklist.', improvements: 'Improve the next fictional handover.', goals: 'Practise the next synthetic capability.' } } });
    else await call(request, actor, 'POST', `appraisals/${parentId}/manager-review`, { submit: true, managerReview: { overallManagerRating: 4, competencyRatings: parent.cycleId.competencies.map((criterion: { id: string; name: string }) => ({ competencyId: criterion.id, competencyName: criterion.name, managerRating: 4, managerComments: 'Observed synthetic role evidence.' })), overallSummary: { achievements: 'Completed the fictional role exercise.', strengths: 'Clear structured explanation.' } } });
  }
  const scored = await call(request, 'manager', 'GET', `appraisals/${parentId}/scoring`);
  expect(scored.compositeScore).toBe(4); expect(scored.breakdown).toMatchObject({ okrWeight: 0, competencyWeight: 100 });
  expect(pageErrors).toEqual([]);
});
