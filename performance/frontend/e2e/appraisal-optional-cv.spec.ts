import { expect, Page, test } from '@playwright/test';

// Rendered browser contracts with fictional files and mocked API responses.
// Real persistence, extraction, audience enforcement and denials are covered
// separately by the backend appraisalCv integration suite.
const appraisalId = 'ordinary-cv-review';
const filename = 'jordan-fictional-cv.txt';
const savedCv = { _id: 'ordinary-cv-document', originalName: filename, category: 'cv', status: 'active', uploadedBy: { userId: 'employee' }, textExtraction: { status: 'completed', extractedText: 'Jordan Ellis. Fictional CV. Delivery planning experience for synthetic testing only.', wordCount: 11 } };

async function setup(page: Page, options: { disabledFeature?: boolean; existing?: boolean; failUpload?: boolean; failRefresh?: boolean; extractionFailed?: boolean; submitted?: boolean; closed?: boolean; reviewer?: boolean; required?: boolean; conversationReady?: boolean } = {}) {
  const user = options.reviewer ? { id: 'reviewer', sub: 'reviewer', name: 'Robin Reviewer', email: 'robin@example.test' } : { id: 'employee', sub: 'employee', name: 'Jordan Ellis', email: 'jordan@example.test' };
  const organization = { id: 'ordinary-cv-org', name: 'Fictional CV QA', role: 'staff' };
  const documents = options.existing ? [{ ...structuredClone(savedCv), textExtraction: { ...structuredClone(savedCv.textExtraction), ...(options.extractionFailed ? { status: 'failed', extractedText: '', wordCount: 0 } : {}) } }] : [];
  let failRead = false;
  const posts: string[] = [];
  const removed: string[] = [];
  let downloadChecks = 0, contentReads = 0, roleReads = 0;
  await page.addInitScript(() => localStorage.setItem('accessToken', 'synthetic-ordinary-cv-contract'));
  await page.context().route('**/__mock-api/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/__mock-api', '');
    const method = route.request().method();
    let data: unknown = [];
    if (path === '/auth/me') { await route.fulfill({ json: { success: true, user: { ...user, organizations: [organization] }, currentOrganization: organization, currentOrganizationId: organization.id } }); return; }
    if (path === '/user/context') data = { user, organization, role: { name: options.reviewer ? 'line_manager' : 'staff', isManager: options.reviewer === true, isHRAdmin: false }, teams: [], features: {}, stats: {} };
    if (path === '/competency/bootstrap') data = { enabled: !options.disabledFeature, capabilities: {}, people: [], roles: [], frameworks: [], strategies: [], cycles: [] };
    if (path === `/competency/appraisal-links/${appraisalId}`) {
      if (options.disabledFeature) { await route.fulfill({ status: 403, json: { error: { code: 'COMPETENCY_DISABLED', message: 'Competency assessments are not enabled.' } } }); return; }
      data = { assessments: [] };
    }
    if (path.startsWith('/competency/assessments/')) roleReads++;
    if (path === `/appraisals/${appraisalId}`) {
      if (failRead) { await route.fulfill({ status: 503, json: { error: 'Synthetic list refresh unavailable.' } }); return; }
      data = { _id: appraisalId, status: options.closed ? 'employee_acknowledged' : options.reviewer ? 'manager_review_pending' : 'self_assessment_pending', employee: { userId: 'employee', name: 'Jordan Ellis' }, manager: { userId: 'reviewer', name: 'Robin Reviewer' }, cycleId: { name: 'Fictional ordinary appraisal', settings: { enableAiAssist: !options.reviewer, allowSelfRating: false }, competencies: [] }, cycleConfigurationSnapshot: { cvRequired: options.required === true }, cvRequirement: { required: options.required === true, fulfilled: documents.some(document => document.category === 'cv' && document.status === 'active') }, selfAssessment: options.submitted || options.reviewer ? { submittedAt: '2026-10-20T12:00:00Z' } : {}, managerReview: {}, customSections: [], documents, deadlines: {}, viewerCapabilities: { isEmployee: !options.reviewer, canManage: options.reviewer === true } };
    }
    if (path === `/appraisals/${appraisalId}/scoring`) data = { okrScore: null, competencyScore: null, compositeScore: null, breakdown: { okrWeight: 0, competencyWeight: 0 } };
    if (path === '/ai-account') data = { policy: { chatgptEnabled: true }, account: { status: 'connected', routable: true } };
    if (path === `/appraisals/${appraisalId}/conversation/context`) data = { cycle: { settings: { allowSelfRating: false } }, conversationState: options.conversationReady ? { mode: 'conversation', currentPhase: 'review', currentOkrIndex: 0, completedPhases: ['report_generation'], extractedData: {}, messageCount: 1 } : null, chatThread: options.conversationReady ? [{ messageId: 'synthetic-ready-report', sender: { userId: 'ai', name: 'Synthetic assistant', role: 'ai' }, message: 'Your synthetic report is ready.', messageType: 'report_draft', phase: 'review', structuredData: { type: 'report', data: { overallSummary: { achievements: 'Completed fictional delivery planning and handover.', challenges: 'Balanced fictional delivery work and documentation.', learnings: 'Used clearer fictional evidence and priorities.', improvements: 'Document fictional outcomes throughout the period.', goals: 'Continue the fictional delivery planning practice.' }, okrAssessment: [], suggestedOverallRating: 3, ratingJustification: 'Synthetic review evidence for browser testing.', aiInsights: { strengths: ['Planning'], developmentAreas: [], suggestions: [], sentiment: 'neutral' } } }, createdAt: '2026-10-20T12:00:00Z' }] : [] };
    if (path === `/appraisals/${appraisalId}/documents` && method === 'POST') {
      posts.push(route.request().postDataBuffer()?.toString() || '');
      if (options.failUpload && posts.length === 1) { await route.fulfill({ status: 503, json: { error: 'File storage is temporarily unavailable. Try again.' } }); return; }
      documents.push(structuredClone(savedCv));
      failRead = options.failRefresh === true;
      data = structuredClone(savedCv);
    }
    if (path === `/appraisals/${appraisalId}/documents/${savedCv._id}` && method === 'GET') { downloadChecks++; data = savedCv; }
    if (path === `/appraisals/${appraisalId}/documents/${savedCv._id}/content`) { contentReads++; await route.fulfill({ contentType: 'text/plain', headers: { 'Content-Disposition': `attachment; filename="${filename}"` }, body: 'Fictional CV. Delivery planning experience.' }); return; }
    if (path === `/appraisals/${appraisalId}/documents/${savedCv._id}` && method === 'DELETE') { removed.push(savedCv._id); documents.splice(0); data = { deleted: true }; }
    await route.fulfill({ json: { success: true, data } });
  });
  return { posts, removed, documents, roleReads: () => roleReads, contentReads: () => contentReads, downloadChecks: () => downloadChecks, restoreRead: () => { failRead = false; } };
}

async function selectCv(page: Page, name = filename) {
  await page.getByLabel('Choose CV file', { exact: true }).setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from('Jordan Ellis\nFictional CV. Delivery planning experience for synthetic testing only.') });
}

async function waitForManualFormFade(page: Page) {
  await expect.poll(() => page.getByRole('button', { name: 'Submit Self-Assessment', exact: true }).evaluate(element => {
    for (let node: Element | null = element; node; node = node.parentElement) {
      if (Number(getComputedStyle(node).opacity) < 0.99) return false;
    }
    return true;
  })).toBe(true);
}

for (const mode of ['form', 'conversation'] as const) {
  test(`ordinary appraisal asks for an optional CV in ${mode} mode without a linked role`, async ({ page }) => {
    const state = await setup(page);
    await page.goto(`/appraisals/${appraisalId}/self-assessment${mode === 'form' ? '?assessmentMode=form' : ''}`);
    await expect(page.getByRole('heading', { name: 'CV (optional)', exact: true })).toBeVisible();
    await expect(page.getByText(/Would you like to add your current CV/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Choose CV file', exact: true })).toBeVisible();
    await expect(page.getByText('No CV uploaded. You can continue without one.', { exact: true })).toBeVisible();
    if (mode === 'form') await expect(page.getByRole('button', { name: 'Submit Self-Assessment', exact: true })).toBeEnabled();
    expect(state.roleReads()).toBe(0); expect(state.posts).toHaveLength(0);
  });
}

for (const mode of ['form', 'conversation'] as const) {
  test(`required CV blocks ${mode} submission until the employee uploads one`, async ({ page }, info) => {
    const state = await setup(page, { required: true, disabledFeature: true, conversationReady: mode === 'conversation' });
    if (mode === 'form') await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/appraisals/${appraisalId}/self-assessment${mode === 'form' ? '?assessmentMode=form' : ''}`);
    await expect(page.getByRole('heading', { name: 'CV (required)', exact: true })).toBeVisible();
    await expect(page.getByText('A CV is required for this appraisal. Upload one before submitting your self-assessment.', { exact: true })).toBeVisible();
    const submit = page.getByRole('button', { name: 'Submit Self-Assessment', exact: true });
    await expect(submit).toBeDisabled();
    if (mode === 'form') {
      await waitForManualFormFade(page);
      await page.screenshot({ path: info.outputPath('required-cv-missing-mocked.png'), fullPage: false });
    }
    await selectCv(page); await page.getByRole('button', { name: 'Upload CV', exact: true }).click();
    await expect(page.getByText('CV saved. Your reviewer can use it as supporting evidence.', { exact: true })).toBeVisible();
    await expect(submit).toBeEnabled();
    await expect(page.getByText('A CV is required for this appraisal. Upload one before submitting your self-assessment.', { exact: true })).toHaveCount(0);
    if (mode === 'form') await page.screenshot({ path: info.outputPath('required-cv-uploaded-mocked.png'), fullPage: false });
    expect(state.posts).toHaveLength(1);
  });

  test(`optional CV does not block ${mode} submission when no file was uploaded`, async ({ page }) => {
    const state = await setup(page, { required: false, disabledFeature: true, conversationReady: mode === 'conversation' });
    await page.goto(`/appraisals/${appraisalId}/self-assessment${mode === 'form' ? '?assessmentMode=form' : ''}`);
    await expect(page.getByRole('heading', { name: 'CV (optional)', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Submit Self-Assessment', exact: true })).toBeEnabled();
    expect(state.posts).toHaveLength(0);
  });
}

test('an uploaded CV satisfies the file requirement even if text extraction failed', async ({ page }) => {
  await setup(page, { required: true, existing: true, extractionFailed: true, disabledFeature: true });
  await page.goto(`/appraisals/${appraisalId}/self-assessment?assessmentMode=form`);
  await expect(page.getByRole('heading', { name: 'CV (required)', exact: true })).toBeVisible();
  await expect(page.getByText(/Text could not be read/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit Self-Assessment', exact: true })).toBeEnabled();
});

for (const mode of ['regular', 'combined'] as const) {
  for (const required of [false, true]) {
    test(`${mode} launch defaults to optional CV and can launch with CV ${required ? 'required' : 'optional'}`, async ({ page }, info) => {
      const manager = { id: 'launch-manager', sub: 'launch-manager', name: 'Robin Reviewer', email: 'robin@example.test' };
      const organization = { id: 'launch-cv-org', name: 'Fictional launch QA', role: 'owner' };
      const launches: { cvRequired: boolean; assignments: { participantId: string; reviewerId: string; roleVersionId?: string; cvRequested?: boolean }[] }[] = [];
      if (required && mode === 'regular') await page.setViewportSize({ width: 1440, height: 1000 });
      await page.clock.setFixedTime(new Date('2026-10-20T12:00:00Z'));
      await page.addInitScript(() => localStorage.setItem('accessToken', 'synthetic-cv-policy-launch'));
      await page.route('**/__mock-api/**', async route => {
        const path = new URL(route.request().url()).pathname.replace('/__mock-api', '');
        let data: unknown = [];
        if (path === '/auth/me') { await route.fulfill({ json: { success: true, user: { ...manager, organizations: [organization] }, currentOrganization: organization, currentOrganizationId: organization.id } }); return; }
        if (path === '/user/context') data = { user: manager, organization, role: { name: 'owner', isManager: true, isHRAdmin: true }, teams: [], features: {}, stats: {} };
        if (path === '/competency/bootstrap') data = { enabled: true, capabilities: { assessmentLaunch: true }, people: [], roles: [{ id: 'published-role', versionId: 'role-v2', name: 'Product operations lead', version: 2, status: 'published' }], frameworks: [], strategies: [], cycles: [{ id: 'launch-cycle', name: 'Fictional policy cycle', revision: 3, status: 'published', reviewMode: mode, cadence: { type: 'one_time' }, period: { start: '2026-07-01', end: '2026-10-19' }, roleVersionIds: mode === 'regular' ? [] : ['role-v2'] }] };
        if (path === '/appraisals/colleague-roster') data = { employees: [{ userId: 'launch-employee', name: 'Jordan Ellis', email: 'jordan@example.test', isSelectableForAppraisal: true, reviewerOptions: [{ userId: manager.id, name: manager.name }] }] };
        if (path === '/competency/cycles/launch-cycle/start-appraisals' && route.request().method() === 'POST') {
          launches.push(route.request().postDataJSON());
          data = { launched: 1, replayed: 0, appraisals: [{ _id: 'policy-appraisal', employee: { name: 'Jordan Ellis' }, manager: { name: manager.name } }], existingAppraisals: [] };
        }
        await route.fulfill({ json: { success: true, data } });
      });
      await page.goto('/appraisals/start?employeeId=launch-employee');
      await page.getByRole('combobox', { name: 'Appraisal cycle', exact: true }).click();
      await page.getByRole('option', { name: `Fictional policy cycle — ${mode === 'regular' ? 'Regular appraisal' : 'Combined appraisal and competency'}`, exact: true }).click();
      const requirement = page.getByRole('combobox', { name: /^CV requirement\b/ });
      await expect(requirement).toHaveText('Optional');
      if (required) {
        await requirement.click();
        await page.getByRole('option', { name: 'Required', exact: true }).click();
      }
      if (mode === 'combined') {
        await page.getByRole('combobox', { name: 'Role for Jordan Ellis', exact: true }).click();
        await page.getByRole('option', { name: 'Product operations lead · v2', exact: true }).click();
        if (required) await expect(page.getByRole('checkbox', { name: 'Request a CV for this appraisal', exact: true })).toHaveCount(0);
      }
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await expect(page.getByText(`CV: ${required ? 'Required' : 'Optional'}`, { exact: true })).toBeVisible();
      if (required && mode === 'regular') await page.screenshot({ path: info.outputPath('required-cv-launch-confirmation-mocked.png'), fullPage: false });
      await page.getByRole('button', { name: 'Start 1 appraisal', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Appraisals started', exact: true })).toBeVisible();
      expect(launches).toHaveLength(1); expect(launches[0].cvRequired).toBe(required);
      expect(launches[0].assignments).toEqual([{ participantId: 'launch-employee', reviewerId: manager.id, ...(mode === 'combined' ? { roleVersionId: 'role-v2', cvRequested: required } : {}) }]);
    });
  }
}

test('CV upload remains available when competency assessments are disabled', async ({ page }, info) => {
  const state = await setup(page, { disabledFeature: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => localStorage.setItem('seemplify_theme', 'light'));
  await page.goto(`/appraisals/${appraisalId}/self-assessment?assessmentMode=form`);
  await expect(page.getByRole('heading', { name: 'CV (optional)', exact: true })).toBeVisible();
  await selectCv(page); await page.getByRole('button', { name: 'Upload CV', exact: true }).click();
  await expect(page.getByText('CV saved. Your reviewer can use it as supporting evidence.', { exact: true })).toBeVisible();
  expect(state.posts).toHaveLength(1); expect(state.roleReads()).toBe(0);
  expect(state.posts[0]).toContain('name="category"\r\n\r\ncv');
  expect(state.posts[0]).toContain('name="visibility"\r\n\r\nemployee_manager');
  expect(state.posts[0]).toContain('name="assessmentMode"\r\n\r\nform');
  await page.reload();
  await expect(page.getByText(filename, { exact: true })).toHaveCount(1);
  await expect(page.getByText('Ready for assessment analysis', { exact: true })).toBeVisible();
  await waitForManualFormFade(page);
  await page.screenshot({ path: info.outputPath('ordinary-cv-desktop-light-mocked.png'), fullPage: false });
  await page.getByRole('button', { name: 'Download CV', exact: true }).click();
  await expect.poll(state.downloadChecks).toBe(1); await expect.poll(state.contentReads).toBe(1);
  await page.getByRole('button', { name: 'Remove CV', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByText('No CV uploaded. You can continue without one.', { exact: true })).toBeVisible();
  expect(state.removed).toEqual([savedCv._id]);
});

test('a stalled role lookup falls back and a late role response cannot discard the selected CV', async ({ page }) => {
  const state = await setup(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.context().route(`**/__mock-api/competency/appraisal-links/${appraisalId}`, async route => {
    await gate;
    await route.fulfill({ json: { success: true, data: { assessments: [{ assessmentId: 'late-role-assessment' }] } } });
  });
  await page.goto(`/appraisals/${appraisalId}/self-assessment?assessmentMode=form`);
  await expect(page.getByRole('button', { name: 'Choose CV file', exact: true })).toBeVisible({ timeout: 12_000 });
  await selectCv(page);
  await expect(page.getByRole('button', { name: 'Upload CV', exact: true })).toBeVisible();
  release();
  await expect.poll(state.roleReads).toBeGreaterThanOrEqual(1);
  await expect(page.getByText(filename, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upload CV', exact: true })).toBeEnabled();
  await expect(page.getByRole('heading', { name: 'CV (optional)', exact: true })).toHaveCount(1);
});

for (const suffix of ['', '/manager-review']) {
  test(`reviewer sees the employee's ordinary CV in ${suffix ? 'the dedicated review' : 'the embedded current task'}`, async ({ page }) => {
    const state = await setup(page, { existing: true, reviewer: true, disabledFeature: true });
    await page.goto(`/appraisals/${appraisalId}${suffix}`);
    if (!suffix) await page.getByRole('button', { name: 'CV & supporting documents', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Supporting documents', exact: true })).toBeVisible();
    await expect(page.getByText(`${filename} · CV`, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download document', exact: true })).toBeEnabled();
    expect(state.roleReads()).toBe(0);
  });
}

test('failed upload retains the selected CV and allows retry without choosing it again', async ({ page }) => {
  const state = await setup(page, { failUpload: true });
  await page.goto(`/appraisals/${appraisalId}/self-assessment?assessmentMode=form`);
  await selectCv(page); await page.getByRole('button', { name: 'Upload CV', exact: true }).click();
  await expect(page.getByText('File storage is temporarily unavailable. Try again.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retry upload', exact: true }).click();
  await expect(page.getByText('CV saved. Your reviewer can use it as supporting evidence.', { exact: true })).toBeVisible();
  expect(state.posts).toHaveLength(2);
});

test('a saved CV with a failed list refresh retries only the list, never the upload', async ({ page }) => {
  const state = await setup(page, { failRefresh: true });
  await page.goto(`/appraisals/${appraisalId}/self-assessment?assessmentMode=form`);
  await selectCv(page); await page.getByRole('button', { name: 'Upload CV', exact: true }).click();
  await expect(page.getByText('CV saved. Your reviewer can use it as supporting evidence.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh file list', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry upload', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download CV', exact: true })).toBeVisible();
  state.restoreRead(); await page.getByRole('button', { name: 'Refresh file list', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh file list', exact: true })).toHaveCount(0);
  expect(state.posts).toHaveLength(1);
});

test('unsupported CV extension is explained before any API upload', async ({ page }) => {
  const state = await setup(page);
  await page.goto(`/appraisals/${appraisalId}/self-assessment?assessmentMode=form`);
  await selectCv(page, 'fictional-profile.exe'); await page.getByRole('button', { name: 'Upload CV', exact: true }).click();
  await expect(page.getByText('Choose a PDF, DOCX or TXT file for your CV.', { exact: true })).toBeVisible();
  expect(state.posts).toHaveLength(0);
});

test('unreadable CV remains downloadable without claiming it is usable AI evidence', async ({ page }) => {
  await setup(page, { existing: true, extractionFailed: true });
  await page.goto(`/appraisals/${appraisalId}/self-assessment?assessmentMode=form`);
  await expect(page.getByText(/Text could not be read/)).toBeVisible();
  await expect(page.getByText('Ready for assessment analysis', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download CV', exact: true })).toBeEnabled();
});

for (const theme of ['light', 'dark'] as const) {
  test(`ordinary CV is usable on mobile in ${theme} appearance`, async ({ page }, info) => {
    await setup(page, { existing: true, disabledFeature: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: theme });
    await page.addInitScript(value => localStorage.setItem('seemplify_theme', value), theme);
    await page.goto(`/appraisals/${appraisalId}/self-assessment?assessmentMode=form`);
    await expect(page.getByRole('button', { name: 'Choose CV file', exact: true })).toBeVisible();
    await waitForManualFormFade(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`ordinary-cv-mobile-${theme}-mocked.png`), fullPage: false });
  });
}

for (const state of ['submitted', 'closed'] as const) {
  test(`${state} self-assessment does not reopen CV editing`, async ({ page }) => {
    await setup(page, state === 'submitted' ? { submitted: true } : { closed: true });
    await page.goto(`/appraisals/${appraisalId}/self-assessment?assessmentMode=form`);
    await expect(page.getByText(state === 'submitted' ? 'Self-Assessment Already Submitted' : 'Self-Assessment Unavailable', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Choose CV file', exact: true })).toHaveCount(0);
  });
}
