import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

// The loopback harness supplies synthetic signed-in identities only. Every
// product request below uses app.js, actual IdP default grants, the current IdP
// directory builder, real authorization and disposable transactional Mongo.
// No product API response is intercepted and no external AI/call is requested.
const API = 'http://127.0.0.1:5014/api';
const date = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
async function api(request: APIRequestContext, actor: string, method: string, path: string, data?: unknown) {
  const response = await request.fetch(`${API}/${path}`, { method, headers: { 'x-acceptance-actor': actor, 'Idempotency-Key': randomUUID() }, data });
  expect(response.ok(), `${actor}: ${method} ${path}: ${await response.text()}`).toBeTruthy();
  return (await response.json()).data;
}
async function login(page: Page, actor: string, path: string) {
  await page.goto(`http://127.0.0.1:5014/__test/login/${actor}?path=${encodeURIComponent(path)}`);
  await expect(page.getByRole('button', { name: 'A', exact: true })).toBeVisible();
  if (actor === 'admin' || actor === 'manager') {
    await page.getByRole('button', { name: 'Personal', exact: true }).click();
    await page.getByRole('menuitemradio', { name: actor === 'admin' ? /^Admin/ : /^Manager/ }).click();
    await page.goto(path);
  }
}
async function select(page: Page, name: string, option: string, multiple = false) {
  // MUI includes the selected value in a populated select's accessible name.
  // Locate its visible label, as the existing real-application suite does.
  await page.locator('label').filter({ hasText: name }).first().locator('..').getByRole('combobox').click();
  await page.getByRole('option', { name: option, exact: true }).click();
  if (multiple) await page.keyboard.press('Escape');
}
async function savedDraft(page: Page, kind: string) {
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/competency/${kind}/[a-f0-9]{24}$`), { timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Review and publish', exact: true })).toBeEnabled();
}
async function publishDefinition(page: Page) {
  await page.getByRole('button', { name: 'Review and publish', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publish v1', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create new version', exact: true })).toBeVisible({ timeout: 30_000 });
}
async function addEvidence(page: Page, title: string, text: string, source: string) {
  await page.getByRole('tab', { name: 'Evidence', exact: true }).click();
  await page.getByRole('textbox', { name: 'Evidence title', exact: true }).fill(title);
  await page.getByRole('textbox', { name: 'Manual evidence or context', exact: true }).fill(text);
  await page.getByRole('checkbox', { name: `Delivery (${source})`, exact: true }).check();
  await page.getByRole('button', { name: 'Save evidence', exact: true }).click();
  await expect(page.getByText('Evidence saved. Link it to the relevant finding in Assessment.', { exact: true })).toBeVisible();
}

test('admin configures a role; selected manager assesses; employee supplies evidence and receives the scoped final report', async ({ browser, request }, info) => {
  test.setTimeout(300_000);
  const stamp = Date.now();
  const names = { framework: `Role journey framework ${stamp}`, role: `Role journey role ${stamp}`, cycle: `Role journey cycle ${stamp}` };
  const admin = await browser.newPage();
  const manager = await browser.newPage();
  const employee = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const pageErrors: string[] = [];
  [admin, manager, employee].forEach(page => page.on('pageerror', error => pageErrors.push(error.message)));
  try {
    await login(admin, 'admin', '/competency');
    const initial = await api(request, 'admin', 'GET', 'competency/bootstrap');
    expect(initial.scope).toBe('organization'); expect(initial.capabilities.roleManage).toBe(true);
    if (!initial.enabled) {
      await admin.getByRole('button', { name: 'Enable competency assessments', exact: true }).click();
      await admin.getByRole('dialog').getByRole('button', { name: 'Enable for this organisation', exact: true }).click();
    }
    await expect(admin.getByRole('link', { name: 'Open assessments', exact: true })).toBeVisible();

    // Administrator publishes reusable definitions through the actual editors.
    await admin.goto('/competency/frameworks/new');
    await admin.getByRole('textbox', { name: 'Framework name', exact: true }).fill(names.framework);
    await admin.getByRole('textbox', { name: 'Source and provenance', exact: true }).fill('Synthetic authored acceptance material.');
    await admin.getByRole('tab', { name: 'Native levels (0)', exact: true }).click();
    await admin.getByRole('button', { name: 'Add level', exact: true }).click();
    await admin.getByRole('textbox', { name: 'Level 1 label', exact: true }).fill('Independent');
    await admin.getByRole('textbox', { name: 'Level 1 description', exact: true }).fill('Delivers agreed work independently.');
    await admin.getByRole('tab', { name: 'Criteria (0)', exact: true }).click();
    await admin.getByRole('button', { name: 'Add criterion', exact: true }).click();
    await admin.getByRole('textbox', { name: 'Criterion 1 code', exact: true }).fill('DEL');
    await admin.getByRole('textbox', { name: 'Criterion 1 name', exact: true }).fill('Delivery');
    await admin.getByRole('textbox', { name: 'Criterion 1 description', exact: true }).fill('Demonstrates reliable delivery with evidence.');
    await select(admin, 'Available levels for criterion 1', 'Independent', true);
    await savedDraft(admin, 'frameworks'); await publishDefinition(admin);

    await admin.goto('/competency/roles/new');
    await admin.getByRole('button', { name: 'Create manually', exact: true }).click();
    await admin.getByRole('textbox', { name: 'Role name', exact: true }).fill(names.role);
    await admin.getByRole('textbox', { name: 'Summary', exact: true }).fill('Synthetic occupational expectations, not a permission role.');
    await admin.getByRole('button', { name: 'Add responsibility', exact: true }).click();
    await admin.getByRole('textbox', { name: 'Responsibility 1', exact: true }).fill('Deliver agreed work independently.');
    await admin.getByRole('tab', { name: 'Expectations (0)', exact: true }).click();
    await admin.getByRole('button', { name: 'Add expectation', exact: true }).click();
    await select(admin, 'Source for expectation 1', `Internal competencies — ${names.framework} v1`);
    await select(admin, 'Criterion for expectation 1', 'Delivery');
    await select(admin, 'Expected level for expectation 1', 'Independent');
    await select(admin, 'Related responsibilities for expectation 1', 'Deliver agreed work independently.', true);
    await savedDraft(admin, 'roles'); await publishDefinition(admin);

    await admin.goto('/competency/cycles/new');
    await admin.getByRole('textbox', { name: 'Cycle name', exact: true }).fill(names.cycle);
    await admin.getByLabel('Assessment period starts', { exact: true }).fill(date(-90));
    await admin.getByLabel('Assessment period ends', { exact: true }).fill(date(-1));
    await admin.getByRole('checkbox', { name: 'Internal competencies', exact: true }).check();
    await select(admin, 'Internal competencies versions', `${names.framework} v1 — 1 criteria`, true);
    await select(admin, 'Assessment role versions', `${names.role} v1`, true);
    await admin.getByRole('button', { name: 'Continue', exact: true }).click();
    await admin.getByRole('spinbutton', { name: 'Internal competencies weight', exact: true }).fill('1');
    await admin.getByRole('spinbutton', { name: 'Delivery: Independent score (0–100)', exact: true }).fill('80');
    await admin.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(admin.getByRole('checkbox', { name: 'Include comparable rankings', exact: true })).not.toBeChecked();
    await admin.getByRole('button', { name: 'Continue', exact: true }).click();
    await admin.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(admin).toHaveURL(/\/competency\/cycles\/[a-f0-9]{24}$/);
    await admin.getByText('Review', { exact: true }).click();
    await admin.getByRole('button', { name: 'Check readiness', exact: true }).click();
    await expect(admin.getByText('Configuration is valid. Role mappings, native levels, scales, weights and suitability bands have been checked.', { exact: true })).toBeVisible();
    await admin.getByRole('button', { name: 'Publish cycle', exact: true }).click();
    await admin.getByRole('dialog').getByRole('button', { name: 'Publish cycle', exact: true }).click();
    await expect(admin.getByText('Cycle published. Select it when starting an appraisal.', { exact: true })).toBeVisible();
    const bootstrap = await api(request, 'admin', 'GET', 'competency/bootstrap');
    const role = bootstrap.roles.find((row: { name: string }) => row.name === names.role);
    const cycle = bootstrap.cycles.find((row: { name: string }) => row.name === names.cycle);
    expect(role.status).toBe('published'); expect(cycle.status).toBe('published');

    // An actual launch API configures a manual ordinary review with optional
    // custom questions, then links the exact reviewer/role versions. No raw DB
    // writes skip employee or reviewer submission during the journey.
    const templates = await api(request, 'admin', 'GET', 'appraisals/cycle-templates');
    const design = structuredClone(templates[0].design);
    design.sections.forEach((section: { questions: Array<{ required: boolean }> }) => section.questions.forEach(question => { question.required = false; }));
    const created = await api(request, 'admin', 'POST', 'appraisals/cycles', {
      name: `Ordinary linked review ${stamp}`, periodStart: date(-90), periodEnd: date(-1), workflowDefinition: design,
      settings: { enableAiAssist: false, requireOkrAlignment: false }, launchNow: true,
      reviewerMode: 'selected', employees: [{ userId: 'acceptance-employee', reviewerId: 'acceptance-manager' }],
      appraisalFlow: { version: 1, assessmentMode: 'form', steps: [
        { id: 'self', type: 'selfAssessment', label: 'Employee assessment' },
        { id: 'manager', type: 'managerReview', label: 'Reviewer assessment' },
        { id: 'final', type: 'finalReview', label: 'Final outcome' },
        { id: 'acknowledge', type: 'acknowledgement', label: 'Employee acknowledgement' },
      ] },
    });
    const ordinary = created.launchSummary.appraisals[0];
    expect(ordinary.manager.userId).toBe('acceptance-manager');
    const linked = await api(request, 'admin', 'POST', 'competency/appraisal-links', {
      appraisalId: ordinary._id, cycleId: cycle.id, cycleRevision: cycle.revision, roleVersionId: role.versionId, assessorIds: ['acceptance-manager'],
    });
    expect(linked.outcomes).toHaveLength(1);
    const assessmentId = linked.outcomes[0].assessmentId;
    expect(assessmentId).toMatch(/^[a-f0-9]{24}$/);
    const assessmentPath = `/competency/assessments/${assessmentId}`;

    await login(employee, 'employee', `/appraisals/${ordinary._id}`);
    const employeeBootstrap = await api(request, 'employee', 'GET', 'competency/bootstrap');
    expect(employeeBootstrap.scope).toBe('self'); expect(employeeBootstrap.capabilities.roleManage).toBe(false);
    expect(employeeBootstrap.capabilities.assessmentLaunch).toBe(false); expect(employeeBootstrap.capabilities.reportExport).toBe(false);
    await employee.goto(assessmentPath);
    await expect(employee.getByRole('heading', { name: 'Acceptance employee', exact: true })).toBeVisible();
    await employee.getByRole('tab', { name: 'Role expectations', exact: true }).click();
    await expect(employee.getByText('Your assessor is reviewing the evidence. Reviewer findings remain private until a report is published.', { exact: true })).toBeVisible();
    await expect(employee.getByRole('combobox', { name: 'Finding status', exact: true })).toHaveCount(0);
    await expect(employee.getByRole('tab', { name: 'Completion & outcome', exact: true })).toHaveCount(0);
    await expect(employee.getByRole('button', { name: 'Save draft', exact: true })).toHaveCount(0);
    await addEvidence(employee, 'Employee own delivery evidence', 'I completed the agreed synthetic delivery independently.', names.framework);
    await employee.reload(); await employee.getByRole('tab', { name: 'Evidence', exact: true }).click();
    await expect(employee.getByText('I completed the agreed synthetic delivery independently.', { exact: true })).toBeVisible();
    const forbiddenSettings = await employee.request.patch(`${API}/competency/settings`, { headers: { 'If-Match': '"0"' }, data: { aiDraftsEnabled: true } });
    expect(forbiddenSettings.status()).toBe(403);
    const before = await api(request, 'manager', 'GET', `competency/assessments/${assessmentId}`);
    const forbiddenEdit = await employee.request.patch(`${API}/competency/assessments/${assessmentId}`, { headers: { 'If-Match': `"${before.revision}"` }, data: { items: [] } });
    expect(forbiddenEdit.status()).toBe(403);
    await api(request, 'employee', 'POST', `appraisals/${ordinary._id}/self-assessment`, { submit: true, selfAssessment: { overallSelfRating: 4, overallSummary: {
      achievements: 'Completed the agreed synthetic delivery independently.', challenges: 'Resolved an acceptance dependency through planning.',
      learnings: 'Applied a clear risk review and documented the result.', goals: 'Continue evidence-led delivery and improve planning.',
    } } });

    await login(manager, 'manager', assessmentPath);
    const managerBootstrap = await api(request, 'manager', 'GET', 'competency/bootstrap');
    expect(managerBootstrap.scope).toBe('managed_teams'); expect(managerBootstrap.capabilities.roleManage).toBe(false);
    expect(managerBootstrap.capabilities.assessmentFinalise).toBe(true);
    const privateNote = `Private assessor source ${stamp}`;
    await addEvidence(manager, privateNote, 'PRIVATE_SOURCE_TEXT_MUST_NOT_REACH_EMPLOYEE', names.framework);
    await manager.getByRole('tab', { name: 'Oral assessment', exact: true }).click();
    await manager.getByRole('textbox', { name: 'Session title', exact: true }).fill('Private structured oral session');
    await manager.getByRole('textbox', { name: 'Question', exact: true }).fill('How was delivery completed?');
    await manager.getByRole('textbox', { name: 'Participant answer', exact: true }).fill('PRIVATE_ORAL_ANSWER_MUST_NOT_REACH_EMPLOYEE');
    await manager.getByRole('textbox', { name: 'Assessor notes', exact: true }).fill('Private assessor observation.');
    await select(manager, 'Oral finding status', 'Submitted — include in report');
    await manager.getByRole('button', { name: 'Save oral finding', exact: true }).click();
    await expect(manager.getByText('Oral findings submitted. They will be included in the final report.', { exact: true })).toBeVisible();
    await manager.getByRole('tab', { name: 'Assessment', exact: true }).click();
    await select(manager, 'Finding status', 'Assessed'); await select(manager, 'Observed level', 'Independent');
    await manager.getByRole('textbox', { name: 'Assessor rationale (required)', exact: true }).fill('The employee evidence demonstrates independent delivery.');
    await manager.getByRole('group', { name: 'Supporting evidence (required)', exact: true }).getByRole('checkbox', { name: 'Employee own delivery evidence', exact: true }).check();
    await manager.getByRole('button', { name: 'Save draft', exact: true }).first().click();
    await expect(manager.getByText(/Saved /).first()).toBeVisible();
    await manager.getByRole('textbox', { name: 'Assessor feedback', exact: true }).fill('Published human feedback: reliable independent delivery.');
    await manager.getByRole('button', { name: 'Save assessor feedback', exact: true }).click();
    await expect(manager.getByText('Published human feedback: reliable independent delivery.', { exact: true })).toBeVisible();

    await employee.reload(); await employee.getByRole('tab', { name: 'Evidence', exact: true }).click();
    await expect(employee.getByText(privateNote, { exact: true })).toHaveCount(0);
    const employeeDetail = await api(request, 'employee', 'GET', `competency/assessments/${assessmentId}`);
    expect(employeeDetail.items).toEqual([]); expect(employeeDetail.managerFeedback).toEqual([]); expect(employeeDetail.oralSessions).toEqual([]);
    expect(JSON.stringify(employeeDetail)).not.toContain('PRIVATE_SOURCE_TEXT'); expect(JSON.stringify(employeeDetail)).not.toContain('PRIVATE_ORAL_ANSWER');
    const managerDetail = await api(request, 'manager', 'GET', `competency/assessments/${assessmentId}`);
    const privateEvidence = managerDetail.evidence.find((source: { title: string }) => source.title === privateNote);
    const deniedSource = await employee.request.get(`${API}/competency/assessments/${assessmentId}/evidence/${privateEvidence.id}`);
    expect(deniedSource.status()).toBe(404);
    await expect(employee.getByRole('button', { name: 'Finalise assessment', exact: true })).toHaveCount(0);
    await manager.getByRole('tab', { name: 'Completion & outcome', exact: true }).click();
    await manager.getByRole('button', { name: 'Check completion', exact: true }).last().click();
    await expect(manager.getByText('Submit the linked reviewer assessment before finalising.', { exact: true })).toBeVisible();
    await select(manager, 'Final classification', 'Suitable');
    await expect(manager.getByRole('button', { name: 'Finalise assessment', exact: true })).toBeDisabled();

    await api(request, 'manager', 'POST', `appraisals/${ordinary._id}/manager-review/start`);
    await api(request, 'manager', 'POST', `appraisals/${ordinary._id}/manager-review`, { submit: true, managerReview: {
      overallManagerRating: 4, overallSummary: { strengths: 'Linked manager feedback preserved with its actual author.', recommendations: 'Continue documenting delivery evidence.' },
    } });
    await manager.getByRole('button', { name: 'Check completion', exact: true }).last().click();
    await expect(manager.getByText('All required assessment information is complete.', { exact: true })).toBeVisible();
    await expect(manager.getByText('80.00 / 100', { exact: true }).first()).toBeVisible();
    await manager.getByRole('button', { name: 'Finalise assessment', exact: true }).click();
    await manager.getByRole('dialog').getByRole('button', { name: 'Finalise assessment', exact: true }).click();
    await expect(manager.getByText('This assessment is final. Its published report preserves the role and submitted feedback used for this version.', { exact: true })).toBeVisible();
    await manager.getByRole('tab', { name: 'Report', exact: true }).click();
    await expect(manager.getByRole('heading', { name: 'Competency assessment report', exact: true })).toBeVisible();
    await expect(manager.getByText('Linked manager feedback preserved with its actual author.', { exact: true })).toBeVisible();
    await expect(manager.getByText(/Assessed by Acceptance manager/).first()).toBeVisible();
    await expect(manager.getByRole('region', { name: 'Competency assessment report', exact: true }).getByText('PRIVATE_ORAL_ANSWER_MUST_NOT_REACH_EMPLOYEE', { exact: true })).toBeVisible();
    const pendingPDF = manager.waitForEvent('download');
    await manager.getByRole('button', { name: 'Download PDF', exact: true }).click();
    const pdf = await pendingPDF; await pdf.saveAs(info.outputPath('selected-manager-report.pdf'));
    expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
    await manager.screenshot({ path: info.outputPath('manager-final-report.png'), fullPage: true });

    await employee.reload(); await employee.getByRole('tab', { name: 'Report', exact: true }).click();
    await expect(employee.getByRole('heading', { name: 'Competency assessment report', exact: true })).toBeVisible();
    await expect(employee.getByText('Published human feedback: reliable independent delivery.', { exact: true })).toBeVisible();
    await expect(employee.getByRole('button', { name: 'Download PDF', exact: true })).toHaveCount(0);
    await expect(employee.getByRole('button', { name: 'Reopen assessment', exact: true })).toHaveCount(0);
    const report = await api(request, 'employee', 'GET', `competency/assessments/${assessmentId}/report`);
    expect(report.visibilityScope).toBe('participant'); expect(report.score.overallScore).toBe(80);
    expect(report.managerSource.author.userId).toBe('acceptance-manager'); expect(report.managerSource.submittedAt).toBeTruthy();
    expect(report.oralFindings).toEqual([]); expect(JSON.stringify(report)).not.toContain(privateNote);
    expect(JSON.stringify(report)).not.toContain('PRIVATE_ORAL_ANSWER');
    const deniedExport = await employee.request.post(`${API}/competency/assessments/${assessmentId}/exports`, { headers: { 'Idempotency-Key': randomUUID() }, data: {} });
    expect(deniedExport.status()).toBe(403);
    for (const actor of ['peer', 'foreign']) {
      const denied = await request.get(`${API}/competency/assessments/${assessmentId}`, { headers: { 'x-acceptance-actor': actor } });
      expect([403, 404]).toContain(denied.status()); expect(await denied.text()).not.toContain('PRIVATE_SOURCE_TEXT');
    }
    expect(await employee.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await employee.screenshot({ path: info.outputPath('employee-mobile-scoped-report.png'), fullPage: true });
    // Finish the linked ordinary review as well; its later lifecycle state must
    // not mutate the competency report that the reviewer already published.
    const frozenHash = report.reportHash;
    await api(request, 'manager', 'POST', `appraisals/${ordinary._id}/finalize`, {
      finalRating: 4, justification: 'The submitted synthetic employee and reviewer evidence supports this final outcome.',
    });
    await employee.goto(`/appraisals/${ordinary._id}/discussion`);
    await employee.getByRole('button', { name: 'Acknowledge Final Outcome', exact: true }).click();
    await expect(employee.getByText('Discussion acknowledged!', { exact: true })).toBeVisible();
    const completed = await api(request, 'employee', 'GET', `appraisals/${ordinary._id}`);
    expect(completed.status).toBe('employee_acknowledged');
    expect(completed.discussion.employeeAcknowledgedAt).toBeTruthy();
    const afterParentCompletion = await api(request, 'employee', 'GET', `competency/assessments/${assessmentId}/report`);
    expect(afterParentCompletion.reportHash).toBe(frozenHash);
    expect(pageErrors).toEqual([]);
  } finally {
    await Promise.all([admin.close(), manager.close(), employee.close()]);
  }
});
