import { expect, Page, test } from '@playwright/test';

// Rendered UI contracts with fictional files. Actual storage/scanning and tenant
// permissions are proved by the backend integration and live acceptance suites.
const role = { name: 'Product operations lead', version: 2 };
const cv = { id: 'cv-source', documentType: 'cv', kind: 'file', status: 'ready', originalName: 'jordan-fictional-cv.txt', title: 'jordan-fictional-cv.txt', size: 80, mimeType: 'text/plain', criterionIds: ['delivery'], visibility: 'participant', createdBy: { userId: 'employee', name: 'Jordan Ellis' }, createdAt: '2026-10-20T10:00:00Z' };
const record = { id: 'assessment', cvRequested: true, revision: 1, status: 'in_progress', cycleId: 'cycle', cycleVersion: 1, appraisalId: 'appraisal', participant: { userId: 'employee', name: 'Jordan Ellis' }, assessors: [{ userId: 'reviewer', name: 'Robin Reviewer' }], definitionSnapshot: { cvRequested: true, role, selectedInputTypes: ['strategy'], criteria: [{ id: 'delivery', criterionId: 'native-delivery', name: 'Delivery outcomes', sourceType: 'strategy', sourceVersionId: 'strategy-v1', levels: [], weight: 1, required: false, evidenceRequired: false, rationaleRequired: false }], scoringConfig: { ratingScales: [], normalization: [], thresholds: [] }, rankingConfig: { enabled: false, scope: 'role' } }, items: [], managerFeedback: [], evidence: [] as typeof cv[], oralSessions: [], aiSuggestions: [], allowedActions: ['competency.assessment.view', 'competency.evidence.view', 'competency.evidence.create'], createdAt: '2026-10-20T09:00:00Z', updatedAt: '2026-10-20T09:00:00Z' };

async function setup(page: Page, options: { requested?: boolean; existing?: boolean; closed?: boolean; denied?: boolean; failUpload?: boolean } = {}) {
  const assessment = structuredClone(record);
  assessment.cvRequested = assessment.definitionSnapshot.cvRequested = options.requested !== false;
  if (options.existing) assessment.evidence.push(structuredClone(cv));
  if (options.closed) assessment.status = 'published';
  let deny = options.denied === true;
  const posts: { key: string; body: string }[] = [];
  let assessmentReads = 0;
  const user = { id: 'employee', sub: 'employee', name: 'Jordan Ellis', email: 'jordan@example.test' };
  const organization = { id: 'org', name: 'Atlas Fictional QA', role: 'employee' };
  await page.addInitScript(() => localStorage.setItem('accessToken', 'synthetic-cv-ui-contract'));
  await page.route('**/__mock-api/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/__mock-api', '');
    const method = route.request().method(); let data: unknown = [];
    if (path === '/auth/me') { await route.fulfill({ json: { success: true, user: { ...user, organizations: [organization] }, currentOrganization: organization, currentOrganizationId: organization.id } }); return; }
    if (path === '/user/context') data = { user, organization, role: { name: 'employee', isManager: false, isHRAdmin: false }, teams: [], features: {}, stats: {} };
    if (path === '/competency/bootstrap') data = { enabled: true, capabilities: {}, people: [], roles: [], frameworks: [], strategies: [], cycles: [] };
    if (path === '/appraisals/appraisal') data = { _id: 'appraisal', status: 'self_assessment_pending', employee: { userId: 'employee', name: 'Jordan Ellis' }, manager: { userId: 'reviewer', name: 'Robin Reviewer' }, cycleId: { name: 'Fictional review', settings: {}, competencies: [] }, selfAssessment: {}, customSections: [] };
    if (path === '/competency/appraisal-links/appraisal') {
      if (deny) { await route.fulfill({ status: 403, json: { error: { code: 'ACTION_DENIED', message: 'This appraisal is outside your permitted scope.' } } }); return; }
      data = { assessments: [{ assessmentId: assessment.id, cvRequested: assessment.cvRequested, role, status: assessment.status }] };
    }
    if (path === '/competency/assessments/assessment') { assessmentReads++; data = assessment; }
    if (path === '/competency/assessments/assessment/evidence' && method === 'POST') {
      posts.push({ key: route.request().headers()['idempotency-key'], body: route.request().postDataBuffer()?.toString() || '' });
      if (options.failUpload && posts.length === 1) { await route.fulfill({ status: 503, json: { error: { code: 'SCAN_UNAVAILABLE', message: 'The file check is temporarily unavailable. Retry this upload.' } } }); return; }
      assessment.evidence = [structuredClone(cv)]; assessment.revision++; data = cv;
    }
    if (path === '/competency/assessments/assessment/evidence/cv-source/source') { await route.fulfill({ contentType: 'text/plain', body: 'Jordan Ellis — fictional CV for UI testing only.' }); return; }
    await route.fulfill({ json: { success: true, data } });
  });
  return { assessment, posts, allowRead: () => { deny = false; }, reads: () => assessmentReads };
}

test('employee sees optional requested CV in the normal appraisal without a submission blocker', async ({ page }) => {
  await setup(page);
  await page.goto('/appraisals/appraisal/self-assessment?assessmentMode=form');
  await expect(page.getByRole('heading', { name: 'CV (optional)', exact: true })).toBeVisible();
  await expect(page.getByText('Product operations lead · Version 2', { exact: true })).toBeVisible();
  await expect(page.getByText(/A missing CV does not block submission/)).toBeVisible();
  await expect(page.getByText('No CV uploaded. You can continue without one.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit Self-Assessment', exact: true })).toBeEnabled();
});

test('failed CV upload keeps the file and retry key, then allows an authorised file download', async ({ page }, info) => {
  const state = await setup(page, { failUpload: true });
  await page.goto('/appraisals/appraisal/self-assessment?assessmentMode=form');
  await page.getByLabel('Choose CV file', { exact: true }).setInputFiles({ name: cv.originalName, mimeType: 'text/plain', buffer: Buffer.from('Jordan Ellis\nFictional CV. Delivery planning experience for synthetic testing.') });
  await page.getByRole('button', { name: 'Upload CV', exact: true }).click();
  await expect(page.getByText('The file check is temporarily unavailable. Retry this upload.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retry CV upload', exact: true }).click();
  await expect(page.getByText('CV saved. Your reviewer can use it as supporting evidence.', { exact: true })).toBeVisible();
  expect(state.posts).toHaveLength(2); expect(state.posts[1].key).toBe(state.posts[0].key);
  expect(state.posts[0].body).toContain('name="documentType"\r\n\r\ncv');
  expect(state.posts[0].body).toContain('name="visibility"\r\n\r\nparticipant');
  expect(state.posts[0].body).not.toContain('name="criterionIds"');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: `Download CV ${cv.originalName}`, exact: true }).click();
  expect((await download).suggestedFilename()).toBe(cv.originalName);
  await page.screenshot({ path: info.outputPath('optional-cv-saved.png'), fullPage: true });
});

test('invalid CV file is explained before any upload request', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/appraisals/appraisal/self-assessment?assessmentMode=form');
  await page.getByLabel('Choose CV file', { exact: true }).setInputFiles({ name: 'fictional-profile.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('not a CV') });
  await expect(page.getByText('Choose a PDF, DOCX or TXT file for the CV.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upload CV', exact: true })).toBeDisabled();
  expect(state.posts).toHaveLength(0);
});

test('unrequested old appraisals stay quiet, but an existing typed CV remains visible', async ({ page }) => {
  const state = await setup(page, { requested: false });
  await page.goto('/appraisals/appraisal/self-assessment?assessmentMode=form');
  await expect.poll(state.reads).toBeGreaterThan(0);
  await expect(page.getByRole('heading', { name: 'CV (optional)', exact: true })).toHaveCount(0);
  state.assessment.evidence.push(structuredClone(cv));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'CV (optional)', exact: true })).toBeVisible();
  await expect(page.getByText(cv.originalName, { exact: true })).toBeVisible();
});

test('closed CV evidence stays readable and unavailable files cannot be downloaded on mobile', async ({ page }, info) => {
  const state = await setup(page, { existing: true, closed: true });
  state.assessment.evidence[0].status = 'expired';
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/competency/assessments/assessment');
  await expect(page.getByRole('heading', { name: 'CV (optional)', exact: true })).toBeVisible();
  await expect(page.getByText('This assessment is read-only. Existing CVs remain available to authorised viewers.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Choose CV file', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Download CV/ })).toHaveCount(0);
  await expect(page.getByText('Participant and assessors · Source no longer available', { exact: true })).toBeVisible();
  const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  expect(width.scroll).toBeLessThanOrEqual(width.viewport + 1);
  await page.screenshot({ path: info.outputPath('optional-cv-readonly-mobile.png'), fullPage: true });
});

test('denied appraisal link never fetches another assessment and offers a read retry', async ({ page }) => {
  const state = await setup(page, { denied: true });
  await page.goto('/appraisals/appraisal/self-assessment?assessmentMode=form');
  await expect(page.getByText(/CV evidence could not be loaded/)).toBeVisible();
  expect(state.reads()).toBe(0);
  await expect(page.getByLabel('Choose CV file', { exact: true })).toHaveCount(0);
  state.allowRead(); await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'CV (optional)', exact: true })).toBeVisible();
});

test('CV remains unavailable while its file check is pending and refresh reveals the ready file', async ({ page }) => {
  const state = await setup(page, { existing: true });
  state.assessment.evidence[0].status = 'scanning';
  await page.goto('/appraisals/appraisal/self-assessment?assessmentMode=form');
  await expect(page.getByText(/File check in progress/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Download CV/ })).toHaveCount(0);
  state.assessment.evidence[0].status = 'ready';
  await page.getByRole('button', { name: 'Refresh CV status', exact: true }).click();
  await expect(page.getByRole('button', { name: `Download CV ${cv.originalName}`, exact: true })).toBeVisible();
});

test('manager can optionally request a CV and the launch confirmation and link retain that choice', async ({ page }) => {
  const manager = { id: 'manager-1', sub: 'manager-1', name: 'Alex Morgan', email: 'alex@example.test' };
  const organization = { id: 'org-1', name: 'Atlas Fictional QA', role: 'employee' };
  const teams = [{ id: 'team-1', name: 'Product', organizationId: organization.id, role: 'line_manager', isManager: true }];
  const linkBodies: Record<string, unknown>[] = [];
  const validations: { assignments: { cvRequested?: boolean }[] }[] = [];
  await page.clock.setFixedTime(new Date('2026-10-20T12:00:00Z'));
  await page.addInitScript(() => { localStorage.setItem('accessToken', 'synthetic-cv-launch-contract'); localStorage.setItem('performance-workspace:org-1:manager-1', 'manager'); });
  await page.route('**/__mock-api/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/__mock-api', '');
    const method = route.request().method(); let data: unknown = [];
    if (path === '/auth/me') { await route.fulfill({ json: { success: true, user: { ...manager, organizations: [organization] }, currentOrganization: organization, currentOrganizationId: organization.id } }); return; }
    if (path === '/user/context') data = { user: manager, role: { name: 'line_manager', isManager: true, isHRAdmin: false }, organization, teams, currentTeam: teams[0], features: { canonicalAppraisals: true }, stats: {} };
    if (path === '/user/current-team') data = { currentTeam: teams[0], availableTeams: teams };
    if (path === '/appraisals/colleague-roster') data = { employees: [{ userId: 'employee-1', name: 'Jordan Lee', email: 'jordan@example.test', isSelectableForAppraisal: true, reviewerOptions: [{ userId: manager.id, name: manager.name, role: 'team_manager' }] }] };
    if (path === '/appraisals/cycle-templates') data = [{ id: 'balanced_performance', name: 'Balanced performance review', version: 1, description: 'Review completed work.', design: { version: 1, scoring: { goalsWeight: 0, competenciesWeight: 100 }, stages: {}, sections: [{ id: 'competencies', type: 'competencies', title: 'Competency ratings', scored: true, weight: 100, questions: [], respondent: 'both', required: true }] } }];
    if (path === '/competency/bootstrap') data = { enabled: true, capabilities: { assessmentLaunch: true }, people: [], roles: [{ id: 'role', versionId: 'role-v2', ...role, status: 'published' }], frameworks: [], strategies: [], cycles: [{ id: 'competency-cycle', name: 'Competency pilot', revision: 3, status: 'published', roleVersionIds: ['role-v2'] }], settings: {} };
    if (path === '/competency/appraisal-links/validate') { validations.push(route.request().postDataJSON()); data = { valid: true }; }
    if (method === 'POST' && path.startsWith('/appraisals/cycles')) data = { launchSummary: { launched: 1, replayed: 0, errors: 0, appraisals: [{ _id: 'created-review', employee: { userId: 'employee-1', name: 'Jordan Lee' }, manager: { name: manager.name }, status: 'self_assessment_pending', createdAt: '2026-10-20T12:00:00Z', cycleId: { name: 'Fictional review' } }], existingAppraisals: [] } };
    if (path === '/competency/appraisal-links' && method === 'POST') { linkBodies.push(route.request().postDataJSON()); data = { assessmentId: 'assessment', status: 'linked' }; }
    await route.fulfill({ json: { success: true, data, meta: { schemaVersion: '1' } } });
  });
  await page.goto('/appraisals/start?employeeId=employee-1');
  await page.getByRole('combobox', { name: /Reviewer for Jordan Lee/ }).click();
  await page.getByRole('option', { name: /Alex Morgan/ }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Request a CV for this appraisal', exact: true })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Assess against an occupational role', exact: true }).check();
  const request = page.getByRole('checkbox', { name: 'Request a CV for this appraisal', exact: true });
  await expect(request).not.toBeChecked(); await request.check();
  await page.getByRole('combobox', { name: 'Competency assessment cycle', exact: true }).click();
  await page.getByRole('option', { name: 'Competency pilot', exact: true }).click();
  await page.getByRole('combobox', { name: 'Assessment role for Jordan Lee', exact: true }).click();
  await page.getByRole('option', { name: 'Product operations lead v2', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText(/CV: Requested/)).toBeVisible();
  await page.getByRole('button', { name: 'Start appraisals', exact: true }).click();
  await expect(page.getByText('Role assessment linked. Open this appraisal to review the frozen role expectations.', { exact: true })).toBeVisible();
  expect(linkBodies).toHaveLength(1); expect(linkBodies[0].cvRequested).toBe(true);
  expect(validations[0].assignments[0].cvRequested).toBe(true);
});

test('participant can download an assessor-uploaded CV without an unusable remove control', async ({ page }) => {
  const state = await setup(page, { existing: true });
  state.assessment.allowedActions.push('competency.evidence.delete');
  state.assessment.evidence[0].createdBy = { userId: 'reviewer', name: 'Robin Reviewer' };
  await page.goto('/appraisals/appraisal/self-assessment?assessmentMode=form');
  await expect(page.getByRole('button', { name: `Download CV ${cv.originalName}`, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove CV', exact: true })).toHaveCount(0);
});

test('ordinary appraisal stays quiet when competency assessments are disabled', async ({ page }) => {
  const state = await setup(page);
  let checked = false;
  await page.route('**/__mock-api/competency/appraisal-links/appraisal', async route => {
    checked = true;
    await route.fulfill({ status: 403, json: { error: { code: 'COMPETENCY_DISABLED', message: 'Competency assessments are not enabled.' } } });
  });
  await page.goto('/appraisals/appraisal/self-assessment?assessmentMode=form');
  await expect.poll(() => checked).toBe(true);
  await expect(page.getByRole('heading', { name: 'CV (optional)', exact: true })).toHaveCount(0);
  await expect(page.getByText(/CV evidence could not be loaded/)).toHaveCount(0);
  expect(state.reads()).toBe(0);
  await expect(page.getByRole('button', { name: 'Submit Self-Assessment', exact: true })).toBeEnabled();
});
