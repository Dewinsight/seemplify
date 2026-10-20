import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
const date = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
function muiSelect(scope: Page | Locator, label: string) {
  return scope.locator('label').filter({ hasText: label }).first().locator('..').getByRole('combobox');
}
async function login(page: Page, actor: string, path: string) {
  await page.goto(`http://127.0.0.1:5014/__test/login/${actor}?path=${encodeURIComponent(path)}`);
  await expect(page.getByRole('button', { name: 'A', exact: true })).toBeVisible();
  if (['manager', 'team_lead', 'department_head', 'hr_manager', 'admin', 'owner'].includes(actor)) {
    await page.getByRole('button', { name: /^(Personal|Manager|Admin)$/ }).click();
    await page.getByRole('menuitemradio', { name: ['hr_manager', 'admin', 'owner'].includes(actor) ? /^Admin/ : /^Manager/ }).click();
    await page.goto(path);
  }
}
async function api(request: APIRequestContext, actor: string, method: string, path: string, data?: unknown) {
  const response = await request.fetch(`http://127.0.0.1:5014/api/${path}`, { method, headers: { 'x-acceptance-actor': actor }, data });
  expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBeTruthy();
  return (await response.json()).data;
}
async function reviewReadyForCalibration(request: APIRequestContext, calibration = true) {
  const { employees: roster } = await api(request, 'hr_manager', 'GET', 'appraisals/colleague-roster');
  expect(roster.find((person: { userId: string }) => person.userId === 'acceptance-employee').reviewerOptions.map((reviewer: { userId: string }) => reviewer.userId)).toContain('acceptance-manager');
  const templates = await api(request, 'hr_manager', 'GET', 'appraisals/cycle-templates');
  const design = structuredClone(templates[0].design);
  design.stages.calibration.enabled = calibration;
  design.sections.forEach((section: { questions: Array<{ required: boolean }> }) => { section.questions.forEach(question => { question.required = false; }); });
  const created = await api(request, 'hr_manager', 'POST', 'appraisals/cycles', {
    name: `Browser calibration ${Date.now()}`, periodStart: date(-90), periodEnd: date(-1), workflowDefinition: design,
    settings: { enableAiAssist: false, requireOkrAlignment: false }, launchNow: true,
    // Match the current Start appraisal contract: a reviewer is selected from
    // the current directory, rather than inferred from legacy mirrored fields.
    reviewerMode: 'selected', employees: [{ userId: 'acceptance-employee', reviewerId: 'acceptance-manager' }]
  });
  const appraisals = await api(request, 'employee', 'GET', 'appraisals/my');
  const appraisal = appraisals.find((item: { cycleId: { _id: string } }) => item.cycleId._id === created.cycle._id);
  expect(appraisal.manager.userId).toBe('acceptance-manager');
  await api(request, 'employee', 'POST', `appraisals/${appraisal._id}/self-assessment`, { submit: true, selfAssessment: { overallSelfRating: 4, overallSummary: {
    achievements: 'Delivered a synthetic project with measured results.', challenges: 'Resolved a synthetic dependency through planning.', learnings: 'Applied a structured discovery method to the project.', goals: 'Complete the next milestone with clear evidence.'
  } } });
  await api(request, 'manager', 'POST', `appraisals/${appraisal._id}/manager-review/start`);
  // An overall opinion alone is not scored evidence. Rate the actual frozen
  // competencies so the real scoring endpoint can calculate this result.
  const competencies = appraisal.cycleConfigurationSnapshot.competencies as Array<{ id: string; name: string }>;
  expect(competencies.length).toBeGreaterThan(0);
  await api(request, 'manager', 'POST', `appraisals/${appraisal._id}/manager-review`, { submit: true, managerReview: {
    overallManagerRating: 4,
    competencyRatings: competencies.map(competency => ({ competencyId: competency.id, competencyName: competency.name,
      managerRating: 4, managerComments: 'Synthetic delivery evidence demonstrates this capability.' }))
  } });
  expect(await api(request, 'manager', 'GET', `appraisals/${appraisal._id}/scoring`)).toMatchObject({
    competencyScore: 4, suggestedRating: 4, breakdown: { unavailable: { competency: false } }
  });
  await api(request, 'manager', 'PUT', `appraisals/${appraisal._id}/discussion`, { markCompleted: true });
  return { cycle: created.cycle, appraisal };
}

test('HR creates and saves two organization OKRs in the browser', async ({ page, request }) => {
  const period = await api(request, 'hr_manager', 'POST', 'goal-periods', { name: `Browser period ${Date.now()}`, code: `BROWSER-${Date.now()}`, startDate: date(-1), endDate: date(90), status: 'open' });
  await login(page, 'hr_manager', '/okrs?view=organization');
  for (const index of [1, 2]) {
    await page.getByRole('button', { name: 'Create goal', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: /Create/ });
    await muiSelect(dialog, 'Period').click();
    await page.getByRole('option', { name: period.name, exact: true }).click();
    const title = `Browser organization goal ${index} ${Date.now()}`;
    await dialog.getByLabel('Goal title').fill(title);
    await dialog.getByLabel('Objective', { exact: true }).fill('Verify organization goal creation');
    await dialog.getByLabel('Key result 1').fill('Document the acceptance result');
    await muiSelect(dialog, 'Metric').click();
    await page.getByRole('option', { name: 'Milestone', exact: true }).click();
    await dialog.getByRole('button', { name: 'Create goal', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText('Goal created.', { exact: true })).toBeVisible();
    await expect(page.getByText(title, { exact: true })).toBeVisible();
  }
  await page.getByRole('tab', { name: /Team & Department Goals/i }).click();
  await page.getByRole('tab', { name: /Organization alignment/i }).click();
});

test('employee aligns an existing draft in its own period, submits it, and manager approves it', async ({ page, request }) => {
  const stamp = Date.now();
  const period = await api(request, 'hr_manager', 'POST', 'goal-periods', { name: `Alignment ${stamp}`, code: `ALIGN-${stamp}`, startDate: date(-1), endDate: date(90), status: 'open' });
  const goalBody = (title: string, type: string) => ({ title, type, periodId: period._id, objectives: [{ title: 'Verify measured delivery', weight: 100, keyResults: [{ title: 'Document the result', targetValue: 100 }] }] });
  const parent = await api(request, 'hr_manager', 'POST', 'okrs', goalBody(`Company priority ${stamp}`, 'organization'));
  const child = await api(request, 'employee', 'POST', 'okrs', goalBody(`Employee priority ${stamp}`, 'individual'));
  await login(page, 'employee', '/okrs');
  await muiSelect(page, 'Period').click(); await page.getByRole('option', { name: period.name, exact: true }).click();
  await page.getByRole('button', { name: 'Edit goal', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit goal' });
  await expect(muiSelect(dialog, 'Period')).toHaveText(period.name);
  await dialog.getByRole('combobox', { name: 'Align to parent goal (optional)' }).click();
  await page.getByRole('option', { name: `${parent.title} · ${period.name}`, exact: true }).click();
  await expect(dialog.getByLabel('Reason for edit (optional)', { exact: true })).toHaveValue('');
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(dialog).not.toBeVisible(); await expect(page.getByText('Goal updated.', { exact: true })).toBeVisible();
  const saved = await api(request, 'employee', 'GET', `okrs/${child._id}`);
  expect(saved.alignment.parentOKRId._id || saved.alignment.parentOKRId).toBe(parent._id);
  expect(saved.lifecycle.state).toBe('draft');
  await page.getByRole('button', { name: 'Submit for approval', exact: true }).click();
  await expect(page.getByText('Goal submitted for approval.', { exact: true })).toBeVisible();
  await login(page, 'manager', '/okrs?view=approvals');
  await muiSelect(page, 'Period').click(); await page.getByRole('option', { name: period.name, exact: true }).click();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByText('Goal approved.', { exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Approvals (0)', exact: true })).toBeVisible();
  expect((await api(request, 'employee', 'GET', `okrs/${child._id}`)).lifecycle.state).toBe('active');
});

test('employee sends feedback from the real colleague picker', async ({ page }) => {
  await login(page, 'employee', '/feedback');
  await page.getByRole('button', { name: 'Give feedback', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Give feedback' });
  await dialog.getByRole('combobox', { name: /Recipient/ }).fill('peer');
  await page.getByRole('option', { name: /Acceptance peer/ }).click();
  const message = `Browser feedback: the synthetic handover was clearly documented ${Date.now()}`;
  await dialog.getByRole('textbox', { name: /^Feedback/ }).fill(message);
  await dialog.getByRole('button', { name: 'Send feedback', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('tab', { name: 'Sent', exact: true }).click();
  await expect(page.getByText(message, { exact: true })).toBeVisible();
});

for (const actor of ['hr_manager', 'department_head', 'team_lead']) {
  test(`${actor} exact-email feedback selection persists the intended recipient despite unrelated direct reports`, async ({ page, request }) => {
    const roster = await api(request, actor, 'GET', 'user/my-team-members');
    expect(roster.directReports.length).toBeGreaterThan(1);
    expect(roster.directReports.some((person: { email: string }) => person.email !== 'employee@example.test')).toBeTruthy();
    await login(page, actor, '/feedback');
    await page.getByRole('button', { name: 'Give feedback', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Give feedback' });
    const recipient = dialog.getByRole('combobox', { name: /Recipient/ });
    await recipient.fill('employee@example.test');
    await expect(page.getByRole('option')).toHaveCount(1);
    await expect(page.getByRole('option')).toContainText('Acceptance employee');
    await recipient.press('ArrowDown');
    await recipient.press('Enter');
    await expect(recipient).toHaveValue('Acceptance employee');
    const message = `Exact-email recipient proof ${actor} ${Date.now()}`;
    await dialog.getByRole('textbox', { name: /^Feedback/ }).fill(message);
    const sentRequest = page.waitForRequest(req => req.method() === 'POST' && new URL(req.url()).pathname === '/api/feedback');
    await dialog.getByRole('button', { name: 'Send feedback', exact: true }).click();
    expect((await sentRequest).postDataJSON().receiverId).toBe('acceptance-employee');
    await expect(dialog).not.toBeVisible();
    const received = await api(request, 'employee', 'GET', 'feedback');
    expect(received.find((item: { message: string; content?: string }) => item.message === message || item.content === message)).toMatchObject({
      receiverId: 'acceptance-employee', senderId: `acceptance-${actor}`,
    });
  });
}

test('manager creates a support plan and employee acknowledges the HR-reviewed plan', async ({ page }) => {
  await login(page, 'manager', '/support-plans');
  await page.getByRole('button', { name: 'New support plan', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Create a support plan' });
  await muiSelect(create, 'Employee').click(); await page.getByRole('option', { name: 'Acceptance employee', exact: true }).click();
  const title = `Browser support ${Date.now()}`;
  await create.getByLabel('Plan title').fill(title);
  await create.getByLabel('Observed concern').fill('A synthetic delivery deadline was missed without an early update.');
  await create.getByLabel('Expected standard').fill('Raise delivery risks at least two working days before the deadline.');
  await create.getByLabel('Plan summary').fill('Verify a measurable synthetic support plan with a clear support commitment.');
  await create.getByLabel('Objective').fill('Raise material risks early');
  await create.getByLabel('How it will be measured').fill('Weekly delivery review');
  await create.getByLabel('Target').fill('All material risks raised two days early');
  await create.getByLabel('Review date').fill(date(30));
  await create.getByLabel('Manager or organization support commitment').fill('Hold a weekly priority review and resolve blockers.');
  await create.getByRole('button', { name: 'Save draft', exact: true }).click();
  const details = page.getByRole('dialog', { name: new RegExp(title) });
  await details.getByRole('button', { name: 'Send to HR', exact: true }).click();
  await expect(page.getByText('Plan sent to HR for review.', { exact: true })).toBeVisible();
  await login(page, 'hr_manager', '/support-plans');
  const card = page.getByRole('article', { name: title, exact: true });
  await card.getByRole('button', { name: 'Open plan', exact: true }).click();
  await page.getByRole('button', { name: 'Approve for employee review', exact: true }).click();
  await expect(page.getByText('Plan approved and sent to the employee.', { exact: true })).toBeVisible();
  await login(page, 'employee', '/support-plans');
  await page.getByRole('article', { name: title, exact: true }).getByRole('button', { name: 'Open plan', exact: true }).click();
  await page.getByRole('button', { name: 'Acknowledge', exact: true }).click();
  await page.getByLabel('Progress update').fill('Raised a synthetic dependency risk during planning.');
  await page.getByLabel('Progress %').fill('50');
  await page.getByRole('button', { name: 'Add check-in', exact: true }).click();
  await expect(page.getByText('Progress check-in added.', { exact: true })).toBeVisible();
});

test('HR requests support-plan changes, manager amends the same plan, and employee acknowledges with comments', async ({ page, request }, info) => {
  const title = `Support revision ${Date.now()}`;
  const created = await api(request, 'manager', 'POST', 'support-plans', {
    employee: { userId: 'acceptance-employee' }, planType: 'informal_support', title, summary: 'Synthetic support with two measurable objectives and two commitments.',
    objectives: [{ title: 'Raise risks early', measure: 'Weekly risk review', target: 'Two days before the deadline', dueDate: date(30) },
      { title: 'Document the handover', measure: 'Handover checklist', target: 'Every delivery', dueDate: date(40) }],
    supportCommitments: [{ description: 'Weekly manager priority review', ownerType: 'manager' }, { description: 'Protected practice time', ownerType: 'organization' }],
    milestones: [{ title: 'Review progress', dueDate: date(30) }], reviewDates: [date(30)],
  });
  await api(request, 'manager', 'POST', `support-plans/${created._id}/submit-for-hr-review`, {});
  await login(page, 'hr_manager', '/support-plans');
  await page.getByRole('article', { name: title, exact: true }).getByRole('button', { name: 'Open plan', exact: true }).click();
  let details = page.getByRole('dialog', { name: new RegExp(title) });
  await expect(details.getByRole('button', { name: 'Request changes', exact: true })).toBeDisabled();
  await details.getByRole('textbox', { name: 'HR review comments', exact: true }).fill('Make both measures explicit and preserve the planned organization support.');
  await details.getByRole('button', { name: 'Request changes', exact: true }).click();
  const changed = await api(request, 'manager', 'GET', `support-plans/${created._id}`);
  expect(changed.state).toBe('changes_requested');
  expect((await request.get(`http://127.0.0.1:5014/api/support-plans/${created._id}`, { headers: { 'x-acceptance-actor': 'employee' } })).status()).toBe(403);
  await login(page, 'manager', '/support-plans');
  await page.getByRole('article', { name: title, exact: true }).getByRole('button', { name: 'Open plan', exact: true }).click();
  details = page.getByRole('dialog', { name: new RegExp(title) });
  await expect(details.getByText(/Make both measures explicit/)).toBeVisible();
  await details.getByRole('button', { name: 'Edit plan', exact: true }).click();
  await details.getByRole('textbox', { name: 'Plan summary', exact: false }).fill('Amended synthetic support with clearer measures and retained commitments.');
  await details.getByRole('textbox', { name: 'Target 1', exact: false }).fill('All material risks recorded two working days before delivery');
  await details.getByRole('textbox', { name: 'Measure 2', exact: false }).fill('A reviewed handover checklist for every delivery');
  await details.getByRole('textbox', { name: 'Support commitment 2', exact: false }).fill('One protected practice hour each week');
  await details.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(details.getByRole('button', { name: 'Resubmit to HR', exact: true })).toBeVisible();
  const amended = await api(request, 'manager', 'GET', `support-plans/${created._id}`);
  expect(amended._id).toBe(created._id);
  expect(amended.employee.userId).toBe(created.employee.userId);
  expect(amended.manager.userId).toBe(created.manager.userId);
  expect(amended.objectives.map((item: { _id: string }) => item._id)).toEqual(created.objectives.map((item: { _id: string }) => item._id));
  expect(amended.supportCommitments.map((item: { _id: string }) => item._id)).toEqual(created.supportCommitments.map((item: { _id: string }) => item._id));
  expect(amended.objectives[1].measure).toBe('A reviewed handover checklist for every delivery');
  expect(amended.supportCommitments[1].description).toBe('One protected practice hour each week');
  await details.getByRole('button', { name: 'Resubmit to HR', exact: true }).click();
  await login(page, 'hr_manager', '/support-plans');
  await page.getByRole('article', { name: title, exact: true }).getByRole('button', { name: 'Open plan', exact: true }).click();
  await page.getByRole('button', { name: 'Approve for employee review', exact: true }).click();
  await login(page, 'employee', '/support-plans');
  await page.getByRole('article', { name: title, exact: true }).getByRole('button', { name: 'Open plan', exact: true }).click();
  details = page.getByRole('dialog', { name: new RegExp(title) });
  await expect(details.getByRole('button', { name: 'Acknowledge with comments', exact: true })).toBeDisabled();
  await details.getByRole('textbox', { name: 'Your comments', exact: true }).fill('I understand the amended expectations and will use the protected practice time.');
  await page.screenshot({ path: info.outputPath('support-plan-employee-comments.png'), fullPage: true });
  await details.getByRole('button', { name: 'Acknowledge with comments', exact: true }).click();
  await expect(details.getByRole('textbox', { name: 'Progress update', exact: true })).toBeVisible();
  const active = await api(request, 'employee', 'GET', `support-plans/${created._id}`);
  expect(active.state).toBe('active');
  expect(active.employeeResponse).toMatchObject({ acknowledgement: 'acknowledged_with_comments', comment: 'I understand the amended expectations and will use the protected practice time.' });
  expect(active.audit.map((row: { action: string }) => row.action)).toEqual(expect.arrayContaining(['hr_requested_changes', 'updated', 'hr_approved', 'employee_acknowledged']));
});

test('manager finalizes a result and employee opens historical report and downloads CSV', async ({ page, request }) => {
  const { appraisal, cycle } = await reviewReadyForCalibration(request, false);
  await login(page, 'manager', `/appraisals/${appraisal._id}/final-review`);
  await expect(page.getByText('4/5', { exact: true })).toBeVisible();
  await page.getByLabel('Justification (required when overriding evidence rating)', { exact: true }).fill('Synthetic browser acceptance: documented evidence supports the final rating.');
  const complete = page.getByRole('button', { name: 'Complete Appraisal', exact: true });
  await expect(complete).toBeEnabled();
  await complete.click();
  await expect(page).toHaveURL(new RegExp(`/appraisals/${appraisal._id}$`), { timeout: 30_000 });
  expect(await api(request, 'manager', 'GET', `appraisals/${appraisal._id}`)).toMatchObject({
    status: 'completed', finalRating: { overall: 4 }
  });
  await login(page, 'employee', '/appraisals?section=history');
  await page.getByLabel('Search past appraisals').fill(cycle.name);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download CSV', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.csv$/);
  await page.getByRole('link', { name: 'View result report', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/appraisals/${appraisal._id}/report$`), { timeout: 30_000 });
  await expect(page.getByText(cycle.name, { exact: true })).toBeVisible();
});

test('HR nominates a synthetic succession candidate from active colleague search', async ({ page }) => {
  await login(page, 'hr_manager', '/talent');
  await page.getByRole('tab', { name: 'Succession coverage', exact: true }).click();
  await page.getByRole('button', { name: 'Add critical role', exact: true }).click();
  const role = page.getByRole('dialog', { name: 'Add critical role coverage' }); const title = `Browser role ${Date.now()}`;
  await role.getByLabel('Role title').fill(title); await role.getByRole('button', { name: 'Create coverage', exact: true }).click();
  await expect(role).not.toBeVisible();
  const card = page.getByRole('row').filter({ has: page.getByText(title, { exact: true }) });
  await card.getByRole('button', { name: 'Add candidate', exact: true }).click();
  const candidate = page.getByRole('dialog', { name: `Add candidate for ${title}` });
  await candidate.getByLabel('Search active employee').fill('employee'); await page.getByRole('option', { name: 'Acceptance employee', exact: true }).click();
  await candidate.getByLabel('Evidence-based rationale').fill('Synthetic evidence demonstrates sustained cross-team delivery and a documented learning plan.');
  await candidate.getByRole('button', { name: 'Add candidate', exact: true }).click();
  await expect(page.getByText('Succession candidate proposed with an auditable rationale.', { exact: true })).toBeVisible();
});

test('manager launches from the three-step wizard and employee submits the manual self-assessment', async ({ page, request }) => {
  const templates = await api(request, 'hr_manager', 'GET', 'appraisals/cycle-templates');
  const design = structuredClone(templates[0].design);
  design.sections.forEach((section: { questions: Array<{ required: boolean }> }) => section.questions.forEach(question => { question.required = false; }));
  const cycle = await api(request, 'hr_manager', 'POST', 'appraisals/cycles', { name: `Browser launch ${Date.now()}`, periodStart: date(-90), periodEnd: date(-1),
    workflowDefinition: design, settings: { enableAiAssist: false, requireOkrAlignment: false }, responseDeadlines: { selfAssessmentDue: date(7), managerReviewDue: date(14) } });
  await login(page, 'manager', '/appraisals/start?employeeId=acceptance-employee');
  await expect(page.getByRole('checkbox', { name: /Acceptance employee/ })).toBeChecked();
  await muiSelect(page, 'Reviewer for Acceptance employee').click(); await page.getByRole('option', { name: /Acceptance manager/ }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await muiSelect(page, 'Review cycle').click(); await page.getByRole('option', { name: cycle.cycle?.name || cycle.name, exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Start appraisals', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Appraisal launch results', exact: true })).toBeVisible();
  const href = await page.getByRole('link', { name: 'Open appraisal', exact: true }).getAttribute('href');
  expect(href).toMatch(/^\/appraisals\/[a-f0-9]{24}$/);
  await login(page, 'employee', `${href}/self-assessment`);
  await page.getByLabel('Key Achievements').fill('Delivered the synthetic acceptance project with documented measurable outcomes.');
  await page.getByLabel('Challenges Faced').fill('Resolved a synthetic delivery dependency with early planning.');
  await page.getByLabel('Key Learnings').fill('Applied structured discovery to improve delivery decisions.');
  await page.getByLabel('Goals for Next Period').fill('Complete the next synthetic milestone with clear evidence.');
  await page.getByRole('radio', { name: '4 Stars', exact: true }).first().press('Space');
  await page.getByRole('button', { name: 'Submit Self-Assessment', exact: true }).click();
  await expect(page).toHaveURL(/\/appraisals\?/, { timeout: 30_000 });
  const persisted = await api(request, 'employee', 'GET', `appraisals/${href?.split('/').pop()}`);
  expect(persisted.selfAssessment.submittedAt).toBeTruthy();
});

test('employee saves, reloads, edits and submits the same real performance check-in draft', async ({ page, request }) => {
  const existing = await api(request, 'employee', 'GET', 'check-ins');
  let offset = -9;
  while (existing.some((item: { periodStart: string }) => item.periodStart.slice(0, 10) === date(offset))) offset -= 7;
  await login(page, 'employee', '/check-ins');
  await page.getByRole('button', { name: 'New check-in', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New performance check-in' });
  await dialog.getByLabel('Period start').fill(date(offset)); await dialog.getByLabel('Period end').fill(date(offset + 6));
  const win = `Browser verified delivery ${Date.now()}`;
  await dialog.getByLabel('Wins', { exact: true }).fill(win);
  await dialog.getByLabel('Next priorities').fill('Complete the next synthetic delivery milestone');
  await dialog.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(dialog).toBeHidden();
  const saved = (await api(request, 'employee', 'GET', 'check-ins')).find((item: { wins: string[] }) => item.wins.includes(win));
  expect(saved).toMatchObject({ status: 'draft', cadence: 'weekly' });
  await page.reload();
  const card = page.locator(`#check-in-${saved._id}`);
  await card.getByRole('button', { name: 'Edit draft', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit performance check-in' });
  await expect(editor.getByLabel('Wins', { exact: true })).toHaveValue(win);
  await expect(editor.getByLabel('Period start')).toHaveValue(date(offset));
  await expect(editor.getByLabel('Period start')).toBeDisabled();
  await expect(editor.getByLabel('Period end')).toBeDisabled();
  const correctedWin = `${win} corrected`;
  await editor.getByLabel('Wins', { exact: true }).fill(correctedWin);
  await editor.getByLabel('Support needed', { exact: true }).fill('Review the synthetic handoff before the next milestone');
  await editor.getByRole('button', { name: 'Save and submit', exact: true }).click();
  await expect(page.getByText('Check-in submitted.', { exact: true })).toBeVisible();
  const final = await api(request, 'employee', 'GET', 'check-ins');
  const persisted = final.find((item: { _id: string }) => item._id === saved._id);
  expect(persisted).toMatchObject({ status: 'submitted', cadence: saved.cadence,
    periodStart: saved.periodStart, periodEnd: saved.periodEnd,
    wins: [correctedWin], supportNeeded: ['Review the synthetic handoff before the next milestone'] });
  expect(final.filter((item: { _id: string }) => !existing.some((old: { _id: string }) => old._id === item._id))).toHaveLength(1);
  const denied = await request.patch(`http://127.0.0.1:5014/api/check-ins/${saved._id}`, {
    headers: { 'x-acceptance-actor': 'employee' }, data: { wins: ['Late submitted edit'] }
  });
  expect(denied.status()).toBe(409);
  await page.reload(); await expect(card.getByText(correctedWin, { exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Edit draft', exact: true })).toHaveCount(0);
});

test('manager creates a development plan including optional skill and learning fields', async ({ page }) => {
  await login(page, 'manager', '/development');
  await page.getByRole('button', { name: /Create.*plan/i }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Team Member').selectOption('acceptance-employee');
  const title = `Browser development ${Date.now()}`;
  await dialog.getByLabel('Plan Title').fill(title);
  await dialog.getByLabel('First career goal').fill('Lead a synthetic discovery project');
  await dialog.getByLabel('First skill to develop').fill('Stakeholder communication');
  await dialog.getByLabel('First development activity').fill('Lead the next synthetic planning session');
  await dialog.getByLabel('Start Date').fill(date(0)); await dialog.getByLabel('Target Date').fill(date(30));
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByText('Development plan created.', { exact: true })).toBeVisible();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
});

test('project lead saves participants and sends a real project feedback request', async ({ page }) => {
  await login(page, 'manager', '/project-feedback');
  await page.getByRole('button', { name: 'Add project', exact: true }).click();
  const dialog = page.getByRole('dialog'); const name = `Browser project ${Date.now()}`;
  await dialog.getByLabel('Project name').fill(name); await dialog.getByLabel('Start date').fill(date(0));
  await dialog.getByLabel('Search organization participants').fill('peer');
  await dialog.getByRole('combobox', { name: 'Participants', exact: true }).click();
  await page.getByRole('option', { name: 'Acceptance peer', exact: true }).click(); await page.keyboard.press('Escape');
  await dialog.getByRole('button', { name: 'Create active project', exact: true }).click();
  await expect(page.getByText(/Project created\./)).toBeVisible();
  const project = page.locator('.MuiPaper-root').filter({ has: page.getByText(name, { exact: true }) });
  await project.getByRole('button', { name: 'Request feedback' }).click();
  const feedback = page.getByRole('dialog', { name: 'Request project feedback' });
  await muiSelect(feedback, 'Feedback about').click(); await page.getByRole('option', { name: 'Acceptance peer', exact: true }).click();
  await muiSelect(feedback, 'Reviewer').click(); await page.getByRole('option', { name: 'Acceptance manager', exact: true }).click();
  await feedback.getByLabel('Due date').fill(date(7)); await feedback.getByRole('button', { name: 'Send request', exact: true }).click();
  await expect(page.getByText(/Project feedback request sent/)).toBeVisible();
});

test('HR records calibration decisions, completes the session and downloads the report', async ({ page, request }) => {
  const { cycle } = await reviewReadyForCalibration(request);
  await login(page, 'hr_manager', '/admin/calibration');
  await page.getByRole('button', { name: 'New Session', exact: true }).click();
  const create = page.getByRole('dialog');
  await create.getByLabel('Review Cycle').selectOption(cycle._id);
  const title = `Browser calibration session ${Date.now()}`;
  await create.getByLabel('Session Title').fill(title);
  await create.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(create).not.toBeVisible();
  const card = page.locator('.MuiCard-root').filter({ has: page.getByText(title, { exact: true }) });
  await card.getByRole('button', { name: 'Start', exact: true }).click();
  await card.getByRole('button', { name: 'Continue', exact: true }).click();
  const details = page.getByRole('dialog');
  await details.getByRole('button', { name: 'Review rating', exact: true }).click();
  const review = page.getByRole('dialog', { name: /Review rating:/ });
  await review.getByLabel('Calibration reason').fill('Synthetic browser acceptance evidence reviewed.');
  await review.getByRole('button', { name: 'Save decision', exact: true }).click();
  await expect(review).not.toBeVisible();
  await details.getByRole('button', { name: 'Complete calibration', exact: true }).click();
  await expect(details.getByText('completed', { exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await details.getByRole('button', { name: 'Export Report', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/^calibration-.*\.csv$/);
});

test('HR downloads actual OKR and appraisal CSV exports', async ({ page }) => {
  await login(page, 'hr_manager', '/admin/reports');
  await page.getByRole('tab', { name: 'Export Data', exact: true }).click();
  for (const label of ['Export OKRs', 'Export Reviews']) {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: label, exact: true }).click();
    expect((await download).suggestedFilename()).toMatch(/\.csv$/);
  }
});
