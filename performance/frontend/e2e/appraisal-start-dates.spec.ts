import { expect, test, type Page } from '@playwright/test';

test.use({ locale: 'en-GB' });

async function install(page: Page, existingCycle = false, selectedCycle = '') {
  const posts: Record<string, unknown>[] = [];
  await page.clock.setFixedTime(new Date('2026-10-17T12:00:00Z'));
  await page.addInitScript(() => {
    localStorage.setItem('accessToken', 'appraisal-date-qa');
    localStorage.setItem('performance-workspace:org-1:manager-1', 'manager');
    localStorage.setItem('seemplify_theme', 'dark');
    document.cookie = 'seemplify_theme=dark; Path=/';
  });
  await page.route('**/__mock-api/**', async route => {
    const path = new URL(route.request().url()).pathname.slice('/__mock-api'.length);
    const data = (value: unknown) => ({ success: true, data: value });
    let response: unknown = data([]);
    const manager = { id: 'manager-1', sub: 'manager-1', name: 'Alex Morgan', email: 'alex@example.test' };
    const teams = [{ id: 'team-1', name: 'Product', organizationId: 'org-1', role: 'line_manager', isManager: true }];
    if (path === '/auth/me') response = { success: true, user: { ...manager, idpOrganizations: [{ id: 'org-1', name: 'QA Product', role: 'employee' }], organizations: [{ id: 'org-1', name: 'QA Product', role: 'employee' }] }, currentOrganizationId: 'org-1', currentOrganization: { id: 'org-1', name: 'QA Product' } };
    else if (path === '/user/context') response = data({ user: manager, role: { name: 'line_manager', displayName: 'Line Manager', isManager: true, isTeamLead: true, isHRAdmin: false }, organization: { id: 'org-1', name: 'QA Product' }, teams, currentTeam: teams[0], managerData: { directReportCount: 1 }, features: { canonicalAppraisals: true }, stats: {} });
    else if (path === '/user/current-team') response = data({ currentTeam: teams[0], availableTeams: teams });
    else if (path === '/appraisals/colleague-roster') response = data({ employees: [{ userId: 'employee-1', name: 'Jordan Lee', email: 'jordan@example.test', managerName: 'Alex Morgan', isSelectableForAppraisal: true, reviewerOptions: [{ userId: manager.id, name: manager.name, email: manager.email, role: 'team_manager' }] }] });
    else if (path === '/appraisals/cycle-templates') {
      const design = { version: 1, scoring: { goalsWeight: 40, competenciesWeight: 60 }, stages: {}, sections: [
        { id: 'goals', title: 'Goals', description: '', type: 'goals', respondent: 'both', required: true, scored: true, weight: 40, evidenceRequired: false, questions: [] },
        { id: 'competencies', title: 'Competencies', description: '', type: 'competencies', respondent: 'both', required: true, scored: true, weight: 60, evidenceRequired: false, questions: [] },
        { id: 'outcomes', title: 'Outcomes', description: 'Describe completed work.', type: 'custom', respondent: 'employee', required: true, scored: false, weight: 0, evidenceRequired: false, questions: [{ id: 'impact', prompt: 'What impact did your work have?', helpText: '', responseType: 'long_text', required: true, options: [], ratingMin: 1, ratingMax: 5 }] },
      ] };
      response = data([{ id: 'balanced_performance', name: 'Balanced performance review', version: 1, description: 'Review completed work and plan development.', design }, { id: 'project_review', name: 'Project review', version: 1, design }]);
    }
    else if (path === '/appraisals/goal-readiness') response = data({ ready: true, participants: [{ userId: 'employee-1', name: 'Jordan Lee', ready: true, goals: [{ id: 'goal-1', title: 'Launch customer portal' }] }] });
    else if (path === '/appraisals/cycles' && route.request().method() === 'GET') response = data(existingCycle ? [{ _id: 'existing-cycle', name: 'Completed quarter', status: 'active', periodStart: '2026-07-01', periodEnd: '2026-09-30', responseDeadlines: { selfAssessmentDue: '2026-10-24', managerReviewDue: '2026-10-31' } }, { _id: 'previous-cycle', name: 'Previous quarter', status: 'draft', periodStart: '2026-04-01', periodEnd: '2026-06-30' }] : []);
    else if (route.request().method() === 'POST' && path.startsWith('/appraisals/cycles')) {
      posts.push({ path, ...route.request().postDataJSON() });
      response = data({ launchSummary: { launched: 1, replayed: 0, errors: 0 } });
    } else if (path === '/notifications/count') response = data({ unread: 0, actionable: 0 });
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) });
  });
  await page.goto(`/appraisals/start?employeeId=employee-1${selectedCycle ? `&cycleId=${selectedCycle}` : ''}`);
  await expect(page.getByRole('checkbox', { name: /Jordan Lee/ })).toBeChecked();
  await page.getByRole('combobox', { name: /Reviewer for Jordan Lee/ }).click(); await page.getByRole('option', { name: /Alex Morgan/ }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review details', exact: true })).toBeVisible();
  return posts;
}

test('explains future assessment dates, focuses the error, and recovers without moving deadlines', async ({ page }, testInfo) => {
  const posts = await install(page);
  const end = page.getByLabel('Assessment period ends', { exact: false });
  await expect(page.getByText('This review starts today, 17 Oct 2026.')).toBeVisible();
  await expect(end).toHaveAttribute('max', '2026-10-16');
  await page.getByLabel('Assessment period starts', { exact: false }).fill('2026-10-10');
  await end.fill('2026-11-24');
  await expect(end).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Choose 16 Oct 2026 or earlier. The work period must finish before this review starts today.')).toBeVisible();
  await expect(page.getByText('Need to assess work that ends in the future? Start the review after that work period has ended.')).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(end).toBeFocused();
  expect(posts).toHaveLength(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('appraisal-date-guidance-error.png'), fullPage: true });
  await page.getByRole('button', { name: /Set assessment end to yesterday/ }).click();
  await expect(end).toHaveValue('2026-10-16');
  await expect(end).toHaveAttribute('aria-invalid', 'false');
  await expect(page.getByLabel('Employee response due', { exact: false })).toHaveValue('2026-10-24');
  await expect(page.getByLabel('Reviewer response due', { exact: false })).toHaveValue('2026-10-31');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('appraisal-date-guidance-fixed.png'), fullPage: true });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Review starts: 17 Oct 2026 (today)')).toBeVisible();
  await page.getByRole('button', { name: 'Start appraisals', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Appraisal launch results' })).toBeVisible();
  expect(posts[0]).toMatchObject({ periodStart: '2026-10-10', periodEnd: '2026-10-16', launchNow: true, responseDeadlines: { selfAssessmentDue: '2026-10-24T23:59:59.000Z', managerReviewDue: '2026-10-31T23:59:59.000Z' } });
});

test('guides empty and reversed dates and deadline order on mobile', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const posts = await install(page);
  const start = page.getByLabel('Assessment period starts', { exact: false });
  const end = page.getByLabel('Assessment period ends', { exact: false });
  const employee = page.getByLabel('Employee response due', { exact: false });
  const manager = page.getByLabel('Reviewer response due', { exact: false });
  await start.fill('2026-10-17');
  await expect(start).toHaveAttribute('aria-invalid', 'true');
  await start.fill('2026-10-10'); await end.fill('2026-10-09');
  await expect(page.getByText('Choose an end date on or after the assessment start date.')).toBeVisible();
  await end.fill('2026-10-16'); await employee.clear();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(employee).toBeFocused();
  await expect(page.getByText('Choose an employee response deadline.')).toBeVisible();
  await employee.fill('2026-10-16');
  await expect(page.getByText('Choose 17 Oct 2026 or later so employees have time to respond.')).toBeVisible();
  await employee.fill('2026-10-24'); await manager.fill('2026-10-24');
  await expect(manager).toHaveAttribute('min', '2026-10-25');
  await expect(page.getByText('Choose a date after 24 Oct 2026. Employees respond before you complete your review.')).toBeVisible();
  await manager.fill('2026-10-31');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('appraisal-dates-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Confirm and start' })).toBeVisible();
  expect(posts).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('retains the existing cycle launch flow', async ({ page }) => {
  const posts = await install(page, true);
  await expect(page.getByText('Completed quarter', { exact: true }).last()).toBeVisible();
  await expect(page.getByLabel('Assessment period ends', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Start appraisals', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Appraisal launch results' })).toBeVisible();
  expect(posts).toMatchObject([{ path: '/appraisals/cycles/existing-cycle/launch', reviewerMode: 'selected', employees: [{ userId: 'employee-1', reviewerId: 'manager-1' }], responseDeadlines: { selfAssessmentDue: '2026-10-24T23:59:59.000Z', managerReviewDue: '2026-10-31T23:59:59.000Z' } }]);
});

test('keeps the quarterly cycle selected from the HR cycle list', async ({ page }) => {
  const posts = await install(page, true, 'previous-cycle');
  await expect(page.getByRole('combobox', { name: 'Review cycle' })).toContainText('Previous quarter');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Start appraisals', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Appraisal launch results' })).toBeVisible();
  expect(posts[0].path).toBe('/appraisals/cycles/previous-cycle/launch');
});

test('one-off questions survive navigation and template changes and reach the guided assessment', async ({ page }, testInfo) => {
  const posts = await install(page);
  await page.getByRole('button', { name: /Questions and scoring/ }).click();
  await page.getByLabel('Question 1', { exact: true }).fill('Which customer outcomes did you improve?');
  await page.getByLabel('Question guidance', { exact: true }).fill('Give a measurable example from this review period.');
  await page.getByLabel('Instructions', { exact: true }).last().fill('Use evidence from completed projects.');
  await expect(page.getByText('Workflow stages', { exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Review template' }).click();
  await page.getByRole('option', { name: 'Project review', exact: true }).click();
  await expect(page.getByLabel('Question 1', { exact: true })).toHaveValue('What impact did your work have?');
  await page.getByRole('combobox', { name: 'Review template' }).click();
  await page.getByRole('option', { name: 'Balanced performance review', exact: true }).click();
  await expect(page.getByLabel('Question 1', { exact: true })).toHaveValue('Which customer outcomes did you improve?');
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByLabel('Question guidance', { exact: true })).toHaveValue('Give a measurable example from this review period.');
  await page.getByRole('button', { name: /Questions and scoring/ }).click();
  await page.screenshot({ path: testInfo.outputPath('one-off-review-design.png'), fullPage: true });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Questions and scoring · Customized', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start appraisals', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Appraisal launch results' })).toBeVisible();
  const submitted = posts[0];
  expect(submitted.settings).toEqual({ requireOkrAlignment: false });
  const { validateDesign } = require('../../backend/services/appraisalCycleDesignService');
  const { getConversationQuestionQueue } = require('../../backend/services/appraisalCustomResponseService');
  const validated = validateDesign(submitted.workflowDefinition);
  expect(validated.errors).toEqual([]);
  expect(validated.design.scoring).toEqual({ goalsWeight: 0, competenciesWeight: 100 });
  const queue = getConversationQuestionQueue({ cycleConfigurationSnapshot: { workflowDefinition: validated.design } });
  expect(queue).toHaveLength(1);
  expect(queue[0]).toMatchObject({ prompt: 'Which customer outcomes did you improve?', helpText: 'Give a measurable example from this review period.', sectionDescription: 'Use evidence from completed projects.' });
});

test('one-off question validation blocks launch and goals keep their configured weights', async ({ page }) => {
  const posts = await install(page);
  await page.getByRole('button', { name: /Questions and scoring/ }).click();
  await page.getByLabel('Question 1', { exact: true }).clear();
  await page.getByRole('button', { name: /Questions and scoring/ }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByLabel('Question 1', { exact: true })).toBeVisible();
  await expect(page.getByText(/Check Questions and scoring:/)).toBeVisible();
  expect(posts).toHaveLength(0);
  await page.getByLabel('Question 1', { exact: true }).fill('What did you deliver?');
  await expect(page.getByRole('button', { name: 'Create or link goals', exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Include approved goals' }).check();
  await expect(page.getByText(/1 eligible approved goal — Launch customer portal/)).toBeVisible();
  await page.getByLabel('Weight %', { exact: true }).nth(0).fill('30');
  await page.getByLabel('Weight %', { exact: true }).nth(1).fill('70');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Start appraisals', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Appraisal launch results' })).toBeVisible();
  expect(posts[0]).toMatchObject({ settings: { requireOkrAlignment: true }, workflowDefinition: { scoring: { goalsWeight: 30, competenciesWeight: 70 } } });
});

test('one-off question editor is usable on mobile without losing the draft', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await install(page);
  await page.getByRole('button', { name: /Questions and scoring/ }).click();
  await page.getByRole('button', { name: /Outcomes · 1 question/ }).click();
  await page.getByLabel('Question 1', { exact: true }).fill('What changed for our customers?');
  await page.getByLabel('Question guidance', { exact: true }).fill('Include a concrete example.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel('Question 1', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('one-off-questions-mobile.png') });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Edit questions and scoring', exact: true }).click();
  await page.getByRole('button', { name: /Outcomes · 1 question/ }).click();
  await expect(page.getByLabel('Question 1', { exact: true })).toHaveValue('What changed for our customers?');
});
