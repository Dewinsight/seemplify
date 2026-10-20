import { expect, test, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import path from 'node:path';

// Real appraisal routes and persistence; only local synthetic identity/chrome is supplied by this fixture.
const backend = createRequire(path.resolve(process.cwd(), '../backend/package.json'));
const express = backend('express'), mongoose = backend('mongoose');
const { MongoMemoryServer } = backend('mongodb-memory-server');
const Appraisal = backend('./models/Appraisal'), Cycle = backend('./models/AppraisalCycle'), User = backend('./models/User');
let mongo: { stop: () => Promise<void> }, server: import('node:http').Server, apiURL: string;
const organization = { id: 'draft-browser-org', name: 'Local draft QA', role: 'staff', appAccess: { mode: 'all', appIds: [] } };
function actor(who: string) { return { id: who, sub: who, name: who === 'reviewer' ? 'Morgan Reviewer' : 'Emery Employee', email: `${who}@example.test`, organizations: [organization], currentOrganization: organization,
  idpTeams: [{ id: 'team', name: 'Product', organizationId: organization.id, role: who === 'reviewer' ? 'line_manager' : 'member' }] }; }
test.beforeAll(async () => {
  mongo = await MongoMemoryServer.create(); await mongoose.connect((mongo as unknown as { getUri: () => string }).getUri());
  for (const who of ['reviewer', 'employee']) await User.create({ idpSub: who, email: actor(who).email, profile: { displayName: actor(who).name }, currentOrganizationId: organization.id, idpTeams: actor(who).idpTeams });
  const app = express(); app.use(express.json());
  app.use((req: { session: unknown; get: (key: string) => string }, _res: unknown, next: () => void) => { req.session = { user: actor(req.get('x-draft-actor') || 'reviewer'), currentOrganizationId: organization.id }; next(); });
  app.use('/api/appraisals', backend('./routes/appraisals'));
  server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  apiURL = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
});
test.afterAll(async () => { if (server) await new Promise<void>(resolve => server.close(() => resolve())); await mongoose.disconnect(); if (mongo) await mongo.stop(); });
async function record(who: 'reviewer' | 'employee') {
  const cycle = await Cycle.create({ name: 'Draft retention review', organizationId: organization.id, periodStart: '2026-01-01', periodEnd: '2026-03-31', status: 'active', settings: { requireOkrAlignment: false, enableAiAssist: false }, competencies: [{ id: 'communication', name: 'Communication', weight: 100 }], createdBy: { userId: 'reviewer', name: 'Morgan Reviewer' } });
  return Appraisal.create({ cycleId: cycle._id, organizationId: organization.id, employee: { userId: 'employee', name: 'Emery Employee', email: 'employee@example.test' }, manager: { userId: 'reviewer', name: 'Morgan Reviewer', email: 'reviewer@example.test' }, status: who === 'reviewer' ? 'manager_review_in_progress' : 'self_assessment_in_progress', selfAssessment: { ...(who === 'reviewer' ? { submittedAt: new Date(), overallSelfRating: 4 } : {}), overallSummary: { achievements: 'Saved employee reflection.' }, competencyRatings: [{ competencyId: 'communication', competencyName: 'Communication', selfRating: 4 }] } });
}
async function setup(page: Page, who: string) {
  const user = actor(who);
  let reads = 0, startComplete = false;
  let hold: { captured: () => void; released: Promise<void> } | null = null;
  const writes: unknown[] = [];
  await page.addInitScript(() => localStorage.setItem('accessToken', 'isolated-draft-qa'));
  await page.route('**/__mock-api/**', async route => {
    const url = new URL(route.request().url()), endpoint = url.pathname.slice('/__mock-api'.length);
    if (endpoint.startsWith('/appraisals/')) {
      if (route.request().method() === 'POST' && /\/(manager-review|self-assessment)$/.test(endpoint)) writes.push(route.request().postDataJSON());
      const response = await route.fetch({ url: `${apiURL}/api${endpoint}${url.search}`, headers: { ...route.request().headers(), 'x-draft-actor': who } });
      if (hold && route.request().method() === 'GET' && /^\/appraisals\/[^/]+$/.test(endpoint)) { const pending = hold; hold = null; pending.captured(); await pending.released; }
      await route.fulfill({ response });
      if (route.request().method() === 'GET' && /^\/appraisals\/[^/]+$/.test(endpoint)) reads += 1;
      if (endpoint.endsWith('/manager-review/start')) startComplete = true;
      return;
    }
    let response: unknown = { success: true, data: [] };
    if (endpoint === '/auth/me') response = { success: true, user, currentOrganization: organization, currentOrganizationId: organization.id };
    if (endpoint === '/user/context') response = { success: true, data: { user, organization, role: { name: who === 'reviewer' ? 'line_manager' : 'employee', isManager: who === 'reviewer', isHRAdmin: false }, teams: user.idpTeams, features: {}, stats: {} } };
    if (endpoint === '/user/current-team') response = { success: true, data: { currentTeam: user.idpTeams[0], availableTeams: user.idpTeams } };
    await route.fulfill({ json: response });
  });
  return { writes, get ready() { return startComplete && reads >= 2; }, holdNextRead() { let captured!: () => void, release!: () => void, seen = false; const pending = new Promise<void>(resolve => { captured = () => { seen = true; resolve(); }; }); const released = new Promise<void>(resolve => { release = resolve; }); hold = { captured, released }; return { pending, release, get captured() { return seen; } }; } };
}
async function reconnect(page: Page) { await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); }); }
async function chooseFour(page: Page) { for (const radio of await page.getByRole('radio', { name: '4 Stars', exact: true }).all()) { await radio.focus(); await radio.press('Space'); await expect(radio).toBeChecked(); } }

test('reviewer can cancel a reset or submit its audited reason through the real reset route', async ({ page }, testInfo) => {
  const item = await record('reviewer');
  await setup(page, 'reviewer');
  await page.setViewportSize({ width: 390, height: 844 });
  const resetBodies: unknown[] = [];
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith(`/appraisals/${item._id}/reset`)) resetBodies.push(request.postDataJSON()); });
  await page.goto('/appraisals?section=conducting');
  const reset = page.getByRole('button', { name: 'Reset appraisal for Emery Employee', exact: true });
  await reset.click();
  const dialog = page.getByRole('dialog', { name: 'Reset appraisal?', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Reset appraisal', exact: true })).toBeDisabled();
  await dialog.getByRole('textbox', { name: 'Reason for resetting' }).fill('short');
  await expect(dialog.getByRole('button', { name: 'Reset appraisal', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(resetBodies).toHaveLength(0);
  expect((await Appraisal.findById(item._id).lean()).status).toBe('manager_review_in_progress');
  await reset.click();
  const reason = 'A fictional exercise needs corrected employee evidence before the reviewer continues.';
  await dialog.getByRole('textbox', { name: 'Reason for resetting' }).fill(reason);
  await page.screenshot({ path: testInfo.outputPath('mobile-reset-confirmation.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Reset appraisal', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(resetBodies).toEqual([{ resetLevel: 'full', reason }]);
  const saved = await Appraisal.findById(item._id).lean();
  expect(saved.status).toBe('not_started');
  expect(saved.managerReview.competencyRatings).toHaveLength(0);
  expect(saved.auditLog.some((row: { action: string; performedBy: { userId: string }; details: { reason: string } }) => row.action === 'appraisal_reset' && row.performedBy.userId === 'reviewer' && row.details.reason === reason)).toBe(true);
  await expect(page.getByRole('article').filter({ has: page.getByText('Not Started', { exact: true }) })).toHaveCount(1);
});

test('manager Next waits for persistence and refresh, then retains typed feedback across a delayed same-review refresh', async ({ page }, testInfo) => {
  const item = await record('reviewer'), fixture = await setup(page, 'reviewer');
  await page.goto(`/appraisals/${item._id}/manager-review`);
  await expect(page.getByRole('heading', { name: 'Review: Emery Employee', exact: true })).toBeVisible();
  // Wait for the actual review-start refresh before deliberately delaying the next save refresh.
  await expect.poll(() => fixture.ready).toBe(true);
  const saved = fixture.holdNextRead();
  await page.getByRole('button', { name: 'Next', exact: true }).click(); await saved.pending;
  try { await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled(); await expect(page.getByRole('button', { name: 'Save Progress', exact: true })).toBeDisabled(); } finally { saved.release(); }
  await expect(page.getByRole('heading', { name: 'Rate Competencies', exact: true })).toBeVisible();
  expect(fixture.writes).toHaveLength(1);
  await chooseFour(page); await page.getByRole('textbox', { name: 'Your Comments & Evidence' }).fill('Observed clear delivery and documented evidence.');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Key Achievements Observed' })).toBeVisible();
  const pending = fixture.holdNextRead();
  await Appraisal.updateOne({ _id: item._id }, { $set: { 'employee.name': 'Emery Employee (refreshed)' } });
  await expect.poll(async () => { await reconnect(page); return pending.captured; }).toBe(true);
  await chooseFour(page);
  const feedback = { 'Key Achievements Observed': 'Delivered the agreed synthetic project.', 'Key Strengths': 'Clear communication and reliable execution.', 'Areas for Improvement': 'Improve the next synthetic handover.', 'Development Recommendations': 'Practice the synthetic mentoring exercise.' };
  for (const [label, value] of Object.entries(feedback)) await page.getByRole('textbox', { name: label, exact: true }).fill(value);
  pending.release();
  await expect(page.getByRole('heading', { name: 'Review: Emery Employee (refreshed)', exact: true })).toBeVisible();
  for (const [label, value] of Object.entries(feedback)) await expect(page.getByRole('textbox', { name: label, exact: true })).toHaveValue(value);
  await expect(page.getByRole('radio', { name: '4 Stars', exact: true })).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath('manager-draft-retained.png'), fullPage: true });
  const submitted = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/appraisals/${item._id}/manager-review`) && response.request().postDataJSON()?.submit === true);
  await page.getByRole('button', { name: 'Submit Review', exact: true }).click(); expect((await submitted).status()).toBe(200);
  const stored = await Appraisal.findById(item._id); expect(stored.managerReview.overallManagerRating).toBe(4); expect(stored.managerReview.overallSummary.achievements).toBe(feedback['Key Achievements Observed']); expect(stored.managerReview.competencyRatings[0].managerRating).toBe(4);
});

test('employee mobile draft survives same-review refresh and initializes the next review independently', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const item = await record('employee'), fixture = await setup(page, 'employee');
  await page.goto(`/appraisals/${item._id}/self-assessment`);
  await expect(page.getByRole('textbox', { name: 'Key Achievements', exact: true })).toHaveValue('Saved employee reflection.');
  const pending = fixture.holdNextRead();
  await Appraisal.updateOne({ _id: item._id }, { $set: { 'selfAssessment.overallSummary.challenges': 'Fresh server challenge.', 'deadlines.selfAssessmentDue': new Date('2040-01-02T12:00:00Z') } });
  await expect.poll(async () => { await reconnect(page); return pending.captured; }).toBe(true);
  await page.getByRole('textbox', { name: 'Key Achievements', exact: true }).fill('Unsaved mobile employee achievement.'); await chooseFour(page);
  pending.release();
  // The newly rendered deadline proves SWR delivered the held response before checking the draft.
  await expect(page.getByText(/Due: .*2040/)).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Challenges Faced', exact: true })).toHaveValue('');
  await expect(page.getByRole('textbox', { name: 'Key Achievements', exact: true })).toHaveValue('Unsaved mobile employee achievement.');
  await page.screenshot({ path: testInfo.outputPath('employee-mobile-draft-retained.png'), fullPage: true });
  for (const label of ['Challenges Faced', 'Key Learnings', 'Goals for Next Period', 'Areas for Improvement']) await page.getByRole('textbox', { name: label, exact: true }).fill(`Completed synthetic reflection: ${label}.`);
  const submitted = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/appraisals/${item._id}/self-assessment`) && response.request().postDataJSON()?.submit === true);
  await page.getByRole('button', { name: 'Submit Self-Assessment', exact: true }).click(); expect((await submitted).status()).toBe(200);
  const stored = await Appraisal.findById(item._id); expect(stored.selfAssessment.overallSelfRating).toBe(4); expect(stored.selfAssessment.overallSummary.achievements).toBe('Unsaved mobile employee achievement.');
  const other = await record('employee'); await page.goto(`/appraisals/${other._id}/self-assessment`);
  await expect(page.getByRole('textbox', { name: 'Key Achievements', exact: true })).toHaveValue('Saved employee reflection.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

for (const connection of ['disconnected', 'consent-pending'] as const) test(`employee can complete the manual form with ${connection} ChatGPT without bypassing required questions`, async ({ page }, info) => {
  const item = await record('employee');
  const design = { version: 1, scoring: { goalsWeight: 40, competenciesWeight: 60 },
    stages: { selfAssessment: { enabled: true }, managerReview: { enabled: true }, finalReview: { enabled: true } },
    sections: [{ id: 'required-reflection', title: 'Required cycle reflection', type: 'custom', respondent: 'employee', required: true, scored: false, weight: 0,
      questions: [{ id: 'impact', prompt: 'Describe the required synthetic outcome.', responseType: 'long_text', required: true }] }] };
  await Cycle.updateOne({ _id: item.cycleId }, { $set: { 'settings.enableAiAssist': true } });
  await Appraisal.updateOne({ _id: item._id }, { $set: { cycleConfigurationSnapshot: { settings: { enableAiAssist: true }, workflowDefinition: design } } });
  const fixture = await setup(page, 'employee');
  const aiCalls: string[] = [];
  page.on('request', request => { if (/\/appraisals\/[^/]+\/(?:conversation|ai-)/.test(request.url())) aiCalls.push(request.url()); });
  await page.route('**/__mock-api/ai-account', route => route.fulfill({ json: { success: true, data: {
    account: { status: connection === 'disconnected' ? 'disconnected' : 'connected', connectedEmail: connection === 'disconnected' ? null : 'employee@example.test',
      routable: false, dataSharingAcknowledgedAt: null, lastError: null }, policy: { chatgptEnabled: true },
  } } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/appraisals/${item._id}/self-assessment?source=history`);
  const gate = page.getByRole('dialog', { name: 'ChatGPT is required', exact: true });
  await expect(gate).toBeVisible();
  await expect(gate.getByRole('button', { name: connection === 'disconnected' ? 'Connect ChatGPT' : 'Finish ChatGPT setup', exact: true })).toBeVisible();
  await gate.getByRole('button', { name: 'Use manual form', exact: true }).click();
  await expect(gate).toHaveCount(0);
  await expect(page.getByText('Manual Mode', { exact: true })).toBeVisible();
  const reflection = { 'Key Achievements': 'Saved manual completion with an optional AI account.', 'Challenges Faced': 'A synthetic dependency needed replanning.',
    'Key Learnings': 'Raised the dependency earlier.', 'Goals for Next Period': 'Plan the next synthetic handover.', 'Areas for Improvement': 'Improve the handover notes.' };
  for (const [label, value] of Object.entries(reflection)) await page.getByRole('textbox', { name: label, exact: true }).fill(value);
  await chooseFour(page);
  await page.getByRole('button', { name: 'Submit Self-Assessment', exact: true }).click();
  await expect(page.getByText(/Complete the required cycle questions:/)).toBeVisible();
  expect(fixture.writes).toHaveLength(0);
  const requiredAnswer = page.getByRole('textbox', { name: 'Describe the required synthetic outcome.', exact: false });
  await requiredAnswer.fill('The synthetic outcome is evidenced and ready for a human reviewer.');
  const saved = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/appraisals/${item._id}/self-assessment`) && response.request().postDataJSON()?.submit === false);
  await page.getByRole('button', { name: 'Save Draft', exact: true }).click();
  expect((await saved).status()).toBe(200);
  expect(fixture.writes.at(-1)).toMatchObject({ assessmentMode: 'form', submit: false });
  await expect(page.getByText('Progress saved.', { exact: true })).toBeVisible();
  const draft = await Appraisal.findById(item._id).lean();
  expect(draft.selfAssessment.overallSummary.achievements).toBe(reflection['Key Achievements']);
  expect(draft.customResponses[0].value).toBe('The synthetic outcome is evidenced and ready for a human reviewer.');
  expect(draft.selfAssessment.submittedAt).toBeFalsy();
  await page.reload();
  await expect(page.getByText('Manual Mode', { exact: true })).toBeVisible();
  await expect(gate).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('assessmentMode')).toBe('form');
  expect(new URL(page.url()).searchParams.get('source')).toBe('history');
  for (const [label, value] of Object.entries(reflection)) await expect(page.getByRole('textbox', { name: label, exact: true })).toHaveValue(value);
  await expect(requiredAnswer).toHaveValue('The synthetic outcome is evidenced and ready for a human reviewer.');
  await page.screenshot({ path: info.outputPath(`manual-form-${connection}-saved.png`), fullPage: true, animations: 'disabled' });
  const submitted = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/appraisals/${item._id}/self-assessment`) && response.request().postDataJSON()?.submit === true);
  await page.getByRole('button', { name: 'Submit Self-Assessment', exact: true }).click();
  expect((await submitted).status()).toBe(200);
  expect(fixture.writes.at(-1)).toMatchObject({ assessmentMode: 'form', submit: true });
  const stored = await Appraisal.findById(item._id).lean();
  expect(stored.selfAssessment.submittedAt).toBeTruthy();
  expect(stored.selfAssessment.overallSelfRating).toBe(4);
  expect(stored.customResponses[0].submittedAt).toBeTruthy();
  expect(aiCalls).toEqual([]);
});

test('manual URL choice does not become a stored preference for another appraisal or actor', async ({ page }) => {
  const disconnectedAccount = () => page.route('**/__mock-api/ai-account', route => route.fulfill({ json: { success: true, data: {
    account: { status: 'disconnected', routable: false, connectedEmail: null }, policy: { chatgptEnabled: true }
  } } }));
  const first = await record('employee');
  await Cycle.updateOne({ _id: first.cycleId }, { $set: { 'settings.enableAiAssist': true } });
  await setup(page, 'employee');
  await disconnectedAccount();
  await page.goto(`/appraisals/${first._id}/self-assessment`);
  const gate = page.getByRole('dialog', { name: 'ChatGPT is required', exact: true });
  await gate.getByRole('button', { name: 'Use manual form', exact: true }).click();
  await expect(page.getByText('Manual Mode', { exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('assessmentMode')).toBe('form');
  const another = await record('employee');
  await Cycle.updateOne({ _id: another.cycleId }, { $set: { 'settings.enableAiAssist': true } });
  await page.goto(`/appraisals/${another._id}/self-assessment`);
  await expect(gate).toBeVisible();
  expect(new URL(page.url()).searchParams.has('assessmentMode')).toBe(false);
  await Appraisal.updateOne({ _id: another._id }, { $set: { 'employee.userId': 'reviewer', 'employee.email': 'reviewer@example.test', 'manager.userId': 'employee' } });
  await setup(page, 'reviewer');
  await disconnectedAccount();
  await page.goto(`/appraisals/${another._id}/self-assessment`);
  await expect(gate).toBeVisible();
  expect(new URL(page.url()).searchParams.has('assessmentMode')).toBe(false);
});

async function reviewerWithOptionalAI(page: Page, explicitBiasResult = false) {
  const item = await record('reviewer');
  const design = { version: 1, scoring: { goalsWeight: 0, competenciesWeight: 100 },
    stages: { selfAssessment: { enabled: true }, managerReview: { enabled: true }, finalReview: { enabled: true } },
    sections: [{ id: 'reviewer-required', title: 'Required reviewer questions', type: 'custom', respondent: 'manager', required: true, scored: false, weight: 0,
      questions: [{ id: 'evidence', prompt: 'Explain the required reviewer evidence.', responseType: 'long_text', required: true }] }] };
  await Cycle.updateOne({ _id: item.cycleId }, { $set: { 'settings.enableAiAssist': true } });
  await Appraisal.updateOne({ _id: item._id }, { $set: { cycleConfigurationSnapshot: { settings: { enableAiAssist: true }, workflowDefinition: design } } });
  const fixture = await setup(page, 'reviewer');
  const aiRequests: string[] = [];
  page.on('request', request => { if (/\/appraisals\/[^/]+\/(?:check-bias|ai-)/.test(request.url())) aiRequests.push(request.url()); });
  await page.route(`**/__mock-api/appraisals/${item._id}/check-bias`, route => route.fulfill(explicitBiasResult
    ? { json: { success: true, hasPotentialBias: true, biasType: 'Synthetic review warning', suggestion: 'Review the fictional wording before confirming.' } }
    : { status: 409, json: { code: 'CHATGPT_NOT_CONNECTED', error: 'Connect ChatGPT before running the optional AI bias check.' } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/appraisals/${item._id}/manager-review`);
  await expect.poll(() => fixture.ready).toBe(true);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Rate Competencies', exact: true })).toBeVisible();
  await chooseFour(page);
  await page.getByRole('textbox', { name: 'Your Comments & Evidence', exact: true }).fill('Observed clear, specific synthetic delivery evidence.');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Verify OKR Achievement', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Overall Assessment', exact: true })).toBeVisible();
  await chooseFour(page);
  for (const [label, value] of Object.entries({ 'Key Achievements Observed': 'Delivered the synthetic review objective.', 'Key Strengths': 'Specific evidence and clear communication.',
    'Areas for Improvement': 'Improve the next synthetic handover.', 'Development Recommendations': 'Practice the next fictional coaching exercise.' })) await page.getByRole('textbox', { name: label, exact: true }).fill(value);
  return { item, fixture, aiRequests, requiredAnswer: page.getByRole('textbox', { name: 'Explain the required reviewer evidence.', exact: false }) };
}

test('reviewer manual submit validates required questions and finishes without automatically invoking optional AI', async ({ page }, info) => {
  const { item, fixture, aiRequests, requiredAnswer } = await reviewerWithOptionalAI(page);
  const priorSaves = fixture.writes.length;
  await page.getByRole('button', { name: 'Submit Review', exact: true }).click();
  await expect(page.getByText(/Complete the required cycle questions:/)).toBeVisible();
  expect(fixture.writes).toHaveLength(priorSaves);
  expect(aiRequests).toEqual([]);
  await requiredAnswer.fill('The required evidence supports the human reviewer judgment.');
  await expect(page.getByText('Optional. You can submit your review without connecting ChatGPT.', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('reviewer-manual-submit-no-ai.png'), fullPage: true });
  const submitted = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/appraisals/${item._id}/manager-review`) && response.request().postDataJSON()?.submit === true);
  await page.getByRole('button', { name: 'Submit Review', exact: true }).click();
  expect((await submitted).status()).toBe(200);
  expect(fixture.writes.at(-1)).toMatchObject({ assessmentMode: 'form', submit: true });
  const stored = await Appraisal.findById(item._id).lean();
  expect(stored.managerReview.submittedAt).toBeTruthy();
  expect(stored.managerReview.overallManagerRating).toBe(4);
  expect(stored.managerReview.aiAssist?.generatedAt).toBeFalsy();
  expect(stored.customResponses.find((answer: { questionId: string }) => answer.questionId === 'evidence').submittedAt).toBeTruthy();
  expect(aiRequests).toEqual([]);
});

test('an explicitly requested AI bias warning still requires human confirmation before manual submission', async ({ page }) => {
  const { item, fixture, aiRequests, requiredAnswer } = await reviewerWithOptionalAI(page, true);
  await requiredAnswer.fill('A synthetic human reviewer evaluated the required evidence.');
  await page.getByRole('button', { name: 'Run AI Bias Check', exact: true }).click();
  await expect(page.getByText('Potential Bias Detected', { exact: true })).toBeVisible();
  expect(aiRequests).toHaveLength(1);
  const priorSaves = fixture.writes.length;
  await page.getByRole('button', { name: 'Submit Review', exact: true }).click();
  await expect(page.getByText('Potential bias detected. Review it, then click submit again to confirm.', { exact: true })).toBeVisible();
  expect(fixture.writes).toHaveLength(priorSaves);
  const submitted = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/appraisals/${item._id}/manager-review`) && response.request().postDataJSON()?.submit === true);
  await page.getByRole('button', { name: 'Submit Review', exact: true }).click();
  expect((await submitted).status()).toBe(200);
  expect(aiRequests).toHaveLength(1);
  expect(fixture.writes.at(-1)).toMatchObject({ assessmentMode: 'form', submit: true });
});
