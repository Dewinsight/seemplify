import { expect, Page, test } from '@playwright/test';

// Browser interaction contracts use fictional staff and intercepted API responses.
// Persistence, locking, long-idle state and authorization are verified separately
// by the real Mongo-backed conversation integration tests.
const appraisalId = 'conversation-resume-review';
const oldActivity = '2026-10-22T09:00:00Z';
const questions = [
  { key: 'reflection:outcomes', sectionId: 'reflection', sectionTitle: 'Review reflections', questionId: 'outcomes', prompt: 'What changed because of your work?', responseType: 'long_text', required: true, options: [], ratingMin: 1, ratingMax: 5 },
  { key: 'reflection:learning', sectionId: 'reflection', sectionTitle: 'Review reflections', questionId: 'learning', prompt: 'What did you learn from that work?', responseType: 'long_text', required: true, options: [], ratingMin: 1, ratingMax: 5 },
  { key: 'reflection:next', sectionId: 'reflection', sectionTitle: 'Review reflections', questionId: 'next', prompt: 'What will you focus on next?', responseType: 'long_text', required: true, options: [], ratingMin: 1, ratingMax: 5 },
];
const savedReport = { overallSummary: { achievements: 'Fictional planning improved delivery.', challenges: 'Balanced fictional delivery and documentation.', learnings: 'Used clear fictional evidence.', improvements: 'Document fictional outcomes sooner.', goals: 'Continue fictional delivery planning.' }, okrAssessment: [], suggestedOverallRating: 3, ratingJustification: 'Fictional evidence for browser verification.', aiInsights: { strengths: ['Planning'], developmentAreas: [], suggestions: [], sentiment: 'neutral' } };

type Body = { message: string; cycleResponse?: { sectionId: string; questionId: string; value: unknown } };
type SavedResponse = { sectionId: string; questionId: string; respondentRole: string; value: unknown; lastSavedAt: string };

async function setup(page: Page, options: { freeChat?: boolean; completedCount?: number; reportReady?: boolean } = {}) {
  const user = { id: 'resume-employee', sub: 'resume-employee', name: 'Jordan Ellis', email: 'jordan@example.test' };
  const organization = { id: 'resume-org', name: 'Fictional resume QA', role: 'staff' };
  const state = {
    accountReads: 0, contextReads: 0, startCalls: 0, messageBodies: [] as Body[],
    responses: questions.slice(0, options.completedCount || 0).map(question => ({ sectionId: question.sectionId, questionId: question.questionId, respondentRole: 'employee', value: `Saved fictional response for ${question.questionId}.`, lastSavedAt: oldActivity })) as SavedResponse[],
    holdAccount: null as Promise<void> | null,
    holdMessage: null as Promise<void> | null,
    holdAppraisal: null as Promise<void> | null,
    failMessageOnce: false,
    failAccountOnce: false,
    failContext: false,
    staleMessageOnce: false,
    staleFinalMessageOnce: false,
    closeMessageOnce: false,
    closed: false,
    reportReady: options.reportReady === true,
    reportCalls: 0,
  };
  const thread = [{ messageId: 'resume-prompt-0', sender: { userId: 'ai', name: 'Assistant', role: 'ai' }, message: options.freeChat ? 'Tell me about your achievements.' : questions[options.completedCount || 0]?.prompt || 'Your fictional report draft is ready.', messageType: 'prompt', phase: options.freeChat ? 'achievements' : 'cycle_questions', createdAt: oldActivity }];
  const payload = () => {
    const current = questions[state.responses.length] || null;
    const phase = options.freeChat ? 'achievements' : state.reportReady ? 'review' : current ? 'cycle_questions' : 'report_generation';
    return {
      cycle: { settings: { allowSelfRating: false } },
      conversationState: { mode: 'conversation', currentPhase: phase, currentOkrIndex: 0, completedPhases: [], extractedData: { achievements: [], challenges: [], skills: [], goals: [] }, messageCount: thread.length, lastActivity: oldActivity },
      currentPhase: phase,
      chatThread: state.reportReady ? [...structuredClone(thread), { messageId: 'resume-report-draft', sender: { userId: 'ai', name: 'Assistant', role: 'ai' }, message: 'Your fictional report draft is ready.', messageType: 'report_draft', phase: 'review', structuredData: { type: 'report', data: structuredClone(savedReport) }, createdAt: oldActivity }] : structuredClone(thread), okrs: [],
      ...(options.freeChat ? {} : {
        cycleQuestions: questions, activeCycleQuestion: current, cycleResponses: structuredClone(state.responses),
        cycleQuestionProgress: { currentIndex: state.responses.length, total: questions.length, answered: state.responses.length, skipped: 0, requiredTotal: questions.length, requiredAnswered: state.responses.length, completed: current === null },
      }),
    };
  };
  const appraisal = () => ({
    _id: appraisalId, status: state.closed ? 'manager_review_pending' : 'self_assessment_in_progress', employee: { userId: user.id, name: user.name }, manager: { userId: 'reviewer', name: 'Robin Reviewer' },
    cycleId: { name: 'Fictional review reflections', settings: { enableAiAssist: true, allowSelfRating: false }, competencies: [] },
    cycleConfigurationSnapshot: {
      cvRequired: false,
      ...(options.freeChat ? {} : { workflowDefinition: { version: 1, sections: [{ id: 'reflection', title: 'Review reflections', type: 'evidence', respondent: 'employee', required: true, scored: false, questions: questions.map(question => ({ ...question, id: question.questionId })) }] } }),
    },
    selfAssessment: state.closed ? { submittedAt: oldActivity } : {}, customResponses: structuredClone(state.responses), documents: [], deadlines: {}, viewerCapabilities: { isEmployee: true, canManage: false },
  });
  await page.addInitScript(() => localStorage.setItem('accessToken', 'synthetic-conversation-resume'));
  await page.context().route('**/__mock-api/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/__mock-api', '');
    const method = route.request().method();
    let data: unknown = [];
    if (path === '/auth/me') { await route.fulfill({ json: { success: true, user: { ...user, organizations: [organization] }, currentOrganization: organization, currentOrganizationId: organization.id } }); return; }
    if (path === '/user/context') data = { user, organization, role: { name: 'staff', isManager: false, isHRAdmin: false }, teams: [], features: {}, stats: {} };
    if (path === '/competency/bootstrap') data = { enabled: false, capabilities: {}, people: [], roles: [], frameworks: [], strategies: [], cycles: [] };
    if (path === `/competency/appraisal-links/${appraisalId}`) { await route.fulfill({ status: 403, json: { error: { code: 'COMPETENCY_DISABLED', message: 'Competency assessments are not enabled.' } } }); return; }
    if (path === `/appraisals/${appraisalId}`) { if (state.holdAppraisal) await state.holdAppraisal; data = appraisal(); }
    if (path === '/ai-account') {
      state.accountReads++;
      if (state.holdAccount) await state.holdAccount;
      if (state.failAccountOnce) { state.failAccountOnce = false; await route.fulfill({ status: 503, json: { error: 'Synthetic connection check unavailable.' } }); return; }
      data = { policy: { chatgptEnabled: true }, account: { status: 'connected', routable: true, lastError: null } };
    }
    if (path === `/appraisals/${appraisalId}/conversation/context`) {
      state.contextReads++;
      if (state.failContext) { await route.fulfill({ status: 503, json: { error: 'Synthetic conversation read unavailable.' } }); return; }
      data = payload();
    }
    if (path === `/appraisals/${appraisalId}/conversation/start`) { state.startCalls++; data = payload(); }
    if (path === `/appraisals/${appraisalId}/conversation/generate-report`) {
      state.reportCalls++; state.reportReady = true;
      data = { ...payload(), aiAvailable: true, report: structuredClone(savedReport) };
    }
    if (path === `/appraisals/${appraisalId}/conversation/message` && method === 'POST') {
      const body = route.request().postDataJSON() as Body;
      state.messageBodies.push(body);
      if (state.holdMessage) await state.holdMessage;
      if (state.closeMessageOnce) {
        state.closeMessageOnce = false; state.closed = true;
        await route.fulfill({ status: 409, json: { success: false, code: 'APPRAISAL_NOT_EDITABLE', error: 'This self-assessment was submitted in another session.', data: { ...payload(), editable: false, appraisalStatus: 'manager_review_pending', selfAssessment: { submittedAt: oldActivity } } } });
        return;
      }
      if (state.failMessageOnce) { state.failMessageOnce = false; await route.fulfill({ status: 503, json: { error: 'The assistant is temporarily busy. Your answer has not been saved.' } }); return; }
      if (state.staleFinalMessageOnce) {
        state.staleFinalMessageOnce = false;
        const current = questions[state.responses.length];
        state.responses.push({ sectionId: current.sectionId, questionId: current.questionId, respondentRole: 'employee', value: 'The final fictional answer was saved in another tab.', lastSavedAt: oldActivity });
        await route.fulfill({ status: 409, json: { success: false, code: 'CYCLE_QUESTION_STALE', error: 'Conversation has moved beyond this question.', data: payload() } });
        return;
      }
      if (state.staleMessageOnce) {
        state.staleMessageOnce = false;
        state.responses.push({ sectionId: questions[0].sectionId, questionId: questions[0].questionId, respondentRole: 'employee', value: 'A fictional result was already saved in another tab.', lastSavedAt: oldActivity });
        thread.push({ messageId: 'other-tab-answer', sender: { userId: user.id, name: user.name, role: 'employee' }, message: 'A fictional result was already saved in another tab.', messageType: 'text', phase: 'cycle_questions', createdAt: oldActivity });
        thread.push({ messageId: 'other-tab-prompt', sender: { userId: 'ai', name: 'Assistant', role: 'ai' }, message: questions[1].prompt, messageType: 'prompt', phase: 'cycle_questions', createdAt: oldActivity });
        await route.fulfill({ status: 409, json: { success: false, code: 'CYCLE_QUESTION_STALE', error: 'Conversation has moved beyond this question.', data: payload() } });
        return;
      }
      if (body.cycleResponse) {
        const current = questions[state.responses.length];
        expect(body.cycleResponse.sectionId).toBe(current.sectionId);
        expect(body.cycleResponse.questionId).toBe(current.questionId);
        state.responses.push({ ...body.cycleResponse, respondentRole: 'employee', lastSavedAt: new Date().toISOString() });
      }
      thread.push({ messageId: `resume-user-${state.messageBodies.length}`, sender: { userId: user.id, name: user.name, role: 'employee' }, message: body.message, messageType: 'text', phase: options.freeChat ? 'achievements' : 'cycle_questions', createdAt: new Date().toISOString() });
      thread.push({ messageId: `resume-prompt-${state.messageBodies.length}`, sender: { userId: 'ai', name: 'Assistant', role: 'ai' }, message: options.freeChat ? 'What helped you achieve that result?' : questions[state.responses.length]?.prompt || 'Reflections complete.', messageType: 'prompt', phase: options.freeChat ? 'achievements' : 'cycle_questions', createdAt: new Date().toISOString() });
      data = { ...payload(), fallback: false, aiAvailable: true };
    }
    if (path === `/appraisals/${appraisalId}/custom-responses` && method === 'PUT') {
      const body = route.request().postDataJSON();
      for (const response of body.responses) {
        if (response.value === undefined || response.value === null || response.value === '') continue;
        const index = state.responses.findIndex(item => item.sectionId === response.sectionId && item.questionId === response.questionId);
        const saved = { ...response, respondentRole: 'employee', lastSavedAt: new Date().toISOString() };
        if (index >= 0) state.responses[index] = saved;
        else state.responses.push(saved);
      }
      data = appraisal();
    }
    await route.fulfill({ json: { success: true, data } });
  });
  return state;
}

const reviewUrl = `/appraisals/${appraisalId}/self-assessment`;

test('returning after a hundred days resumes the same unanswered question without starting over', async ({ page }) => {
  const state = await setup(page);
  await page.clock.setFixedTime(new Date(oldActivity));
  await page.goto(reviewUrl);
  const card = page.getByTestId('cycle-question-card');
  await card.getByRole('textbox', { name: questions[0].prompt }).fill('A fictional delivery plan reduced avoidable handovers.');
  await card.getByRole('button', { name: 'Save and continue' }).click();
  await expect(card).toContainText(questions[1].prompt);
  await page.goto('about:blank');
  await page.clock.setFixedTime(new Date('2027-01-30T09:00:00Z'));
  await page.goto(reviewUrl);
  await expect(card).toContainText('Question 2 of 3');
  await expect(card).toContainText(questions[1].prompt);
  expect(state.messageBodies).toHaveLength(1); expect(state.startCalls).toBe(0);
  await card.getByRole('textbox', { name: questions[1].prompt }).fill('Clear owners and weekly evidence improved the fictional plan.');
  await card.getByRole('button', { name: 'Save and continue' }).click();
  await expect(card).toContainText(questions[2].prompt);
  expect(state.responses.map(item => item.questionId)).toEqual(['outcomes', 'learning']);
});

test('focus connection checks cannot unmount a pending answer or restore an older question', async ({ page }) => {
  const state = await setup(page);
  await page.goto(reviewUrl);
  const card = page.getByTestId('cycle-question-card');
  const answer = 'Customer evidence improved the fictional delivery plan.';
  await card.getByRole('textbox', { name: questions[0].prompt }).fill(answer);
  const contextReads = state.contextReads, accountReads = state.accountReads;
  let releaseMessage!: () => void, releaseAccount!: () => void;
  state.holdMessage = new Promise<void>(resolve => { releaseMessage = resolve; });
  state.holdAccount = new Promise<void>(resolve => { releaseAccount = resolve; });
  try {
    await card.getByRole('button', { name: 'Save and continue' }).click();
    await expect.poll(() => state.messageBodies.length).toBe(1);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => state.accountReads).toBeGreaterThan(accountReads);
    await expect(card.getByRole('textbox', { name: questions[0].prompt })).toHaveValue(answer);
    releaseAccount(); state.holdAccount = null;
    await expect(page.getByRole('dialog', { name: 'Checking ChatGPT' })).toHaveCount(0);
    releaseMessage(); state.holdMessage = null;
    await expect(card).toContainText(questions[1].prompt);
    expect(state.contextReads).toBe(contextReads);
    await card.getByRole('textbox', { name: questions[1].prompt }).fill('Regular evidence reviews helped the fictional team learn.');
    await card.getByRole('button', { name: 'Save and continue' }).click();
    await expect(card).toContainText(questions[2].prompt);
    expect(state.messageBodies).toHaveLength(2);
    expect(state.startCalls).toBe(0);
  } finally { releaseAccount(); releaseMessage(); }
});

test('failed question saves retain the answer and allow retry in the same chat', async ({ page }) => {
  const state = await setup(page); state.failMessageOnce = true;
  await page.goto(reviewUrl);
  const card = page.getByTestId('cycle-question-card');
  const answer = 'A fictional delivery plan reduced avoidable handovers.';
  await card.getByRole('textbox', { name: questions[0].prompt }).fill(answer);
  await card.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByText('The assistant is temporarily busy. Your answer has not been saved.', { exact: true })).toBeVisible();
  await expect(card.getByRole('textbox', { name: questions[0].prompt })).toHaveValue(answer);
  await expect(card.getByRole('button', { name: 'Save and continue' })).toBeEnabled();
  await card.getByRole('button', { name: 'Save and continue' }).click();
  await expect(card).toContainText(questions[1].prompt);
  expect(state.responses).toHaveLength(1);
});

test('a failed background connection check preserves the active question and draft through reconnect', async ({ page }) => {
  const state = await setup(page);
  await page.goto(reviewUrl);
  const card = page.getByTestId('cycle-question-card');
  const draft = 'Preserve this unfinished fictional reflection while the connection recovers.';
  await card.getByRole('textbox', { name: questions[0].prompt }).fill(draft);
  const contextReads = state.contextReads;
  state.failAccountOnce = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const gate = page.getByRole('dialog', { name: 'ChatGPT is unavailable', exact: true });
  await expect(gate).toBeVisible();
  await gate.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(gate).toHaveCount(0);
  await expect(card.getByRole('textbox', { name: questions[0].prompt })).toHaveValue(draft);
  expect(state.contextReads).toBe(contextReads);
  expect(state.messageBodies).toHaveLength(0); expect(state.startCalls).toBe(0);
});

test('an unavailable conversation read offers resume retry instead of starting over', async ({ page }) => {
  const state = await setup(page); state.failContext = true;
  await page.goto(reviewUrl);
  await expect(page.getByText('Your conversation could not be loaded. Try again to resume where you left off.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Begin Conversation', exact: true })).toHaveCount(0);
  state.failContext = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByTestId('cycle-question-card')).toContainText(questions[0].prompt);
  expect(state.startCalls).toBe(0);
});

test('a stale answer restores the saved question and keeps an editable copy of the unsent response in chat', async ({ page }) => {
  const state = await setup(page); state.staleMessageOnce = true;
  await page.goto(reviewUrl);
  const card = page.getByTestId('cycle-question-card');
  const unsent = 'Keep my more detailed fictional answer available for review.';
  await card.getByRole('textbox', { name: questions[0].prompt }).fill(unsent);
  await card.getByRole('button', { name: 'Save and continue' }).click();
  await expect(card).toContainText(questions[1].prompt);
  await expect(page.getByText('Your saved progress has been restored. This response has not been saved.', { exact: true })).toBeVisible();
  await expect(page.getByText(unsent, { exact: true })).toBeVisible();
  await expect(page.getByText('Conversation has moved beyond this question.', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Review saved answers', exact: true }).click();
  await page.getByRole('button', { name: 'Edit answer', exact: true }).click();
  await page.getByRole('textbox', { name: questions[0].prompt, exact: true }).fill(unsent);
  await page.getByRole('button', { name: 'Save change', exact: true }).click();
  await expect.poll(() => state.responses[0]?.value).toBe(unsent);
  await expect(card).toContainText(questions[1].prompt);
  await card.getByRole('textbox', { name: questions[1].prompt }).fill('Fictional evidence reviews helped the team learn.');
  await card.getByRole('button', { name: 'Save and continue' }).click();
  await expect(card).toContainText(questions[2].prompt);
  expect(state.responses).toHaveLength(2);
  expect(state.reportCalls).toBe(0); expect(state.startCalls).toBe(0);
});

test('a concurrent submission disables chat immediately while the closed appraisal is refreshed', async ({ page }) => {
  const state = await setup(page); state.closeMessageOnce = true;
  await page.goto(reviewUrl);
  const card = page.getByTestId('cycle-question-card');
  await card.getByRole('textbox', { name: questions[0].prompt }).fill('Retain this fictional answer if another tab has already submitted.');
  let releaseAppraisal!: () => void;
  state.holdAppraisal = new Promise<void>(resolve => { releaseAppraisal = resolve; });
  try {
    await card.getByRole('button', { name: 'Save and continue' }).click();
    await expect.poll(() => state.closed).toBe(true);
    await expect(card.getByRole('button', { name: 'Save and continue' })).toBeDisabled();
    releaseAppraisal(); state.holdAppraisal = null;
    await expect(page.getByText('Self-Assessment Already Submitted', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save and continue' })).toHaveCount(0);
    expect(state.messageBodies).toHaveLength(1); expect(state.responses).toHaveLength(0);
    expect(state.reportCalls).toBe(0); expect(state.startCalls).toBe(0);
  } finally { releaseAppraisal(); }
});

test('an unsent final-question response remains visible when the saved progress opens report preview', async ({ page }) => {
  const state = await setup(page, { completedCount: 2 }); state.staleFinalMessageOnce = true;
  await page.goto(reviewUrl);
  const card = page.getByTestId('cycle-question-card');
  const unsent = 'Keep my final fictional focus as an unsent response for comparison.';
  await card.getByRole('textbox', { name: questions[2].prompt }).fill(unsent);
  await card.getByRole('button', { name: 'Save and continue' }).click();
  const restored = page.getByText('Your saved progress has been restored. This response has not been saved.', { exact: true });
  await expect(restored).toBeVisible();
  await expect(page.getByText(unsent, { exact: true })).toBeVisible();
  expect(state.reportCalls).toBe(0);
  await page.getByRole('button', { name: 'Generate Report', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Self-Assessment Report', exact: true })).toBeVisible();
  await expect(restored).toBeVisible();
  await expect(page.getByText(unsent, { exact: true })).toBeVisible();
  expect(state.reportCalls).toBe(1);
  expect(state.messageBodies).toHaveLength(1);
});

for (const width of [1440, 390]) {
  test(`both assessment views are discoverable and preserve typed drafts at ${width}px`, async ({ page }, info) => {
    const state = await setup(page);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto(reviewUrl);
    const tabs = page.getByRole('tablist', { name: 'Assessment view' });
    await expect(tabs.getByRole('tab', { name: 'AI chat', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.getByRole('tab', { name: 'Answer form', exact: true })).toBeVisible();
    const card = page.getByTestId('cycle-question-card');
    const draft = 'Keep this unfinished reflection while I compare the answer form.';
    await card.getByRole('textbox', { name: questions[0].prompt }).fill(draft);
    await tabs.getByRole('tab', { name: 'Answer form', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Key Achievements', exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: 'Key Achievements', exact: true }).fill('Keep this unfinished manual summary too.');
    await tabs.getByRole('tab', { name: 'AI chat', exact: true }).click();
    await expect(card.getByRole('textbox', { name: questions[0].prompt })).toHaveValue(draft);
    await tabs.getByRole('tab', { name: 'Answer form', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Key Achievements', exact: true })).toHaveValue('Keep this unfinished manual summary too.');
    await tabs.getByRole('tab', { name: 'AI chat', exact: true }).click();
    await expect(card.getByRole('textbox', { name: questions[0].prompt })).toHaveValue(draft);
    expect(state.messageBodies).toHaveLength(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await tabs.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`assessment-view-switch-${width}-mocked.png`), fullPage: false });
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`assessment-question-draft-${width}-mocked.png`), fullPage: false });
  });
}

test('saved chat answers appear in the answer form and return to the next unanswered chat question', async ({ page }) => {
  const state = await setup(page);
  await page.goto(reviewUrl);
  const answer = 'A fictional delivery plan reduced avoidable handovers.';
  const card = page.getByTestId('cycle-question-card');
  await card.getByRole('textbox', { name: questions[0].prompt }).fill(answer);
  await card.getByRole('button', { name: 'Save and continue' }).click();
  await expect(card).toContainText(questions[1].prompt);
  await page.getByRole('tab', { name: 'Answer form', exact: true }).click();
  await expect(page.getByRole('textbox', { name: questions[0].prompt })).toHaveValue(answer);
  await page.getByRole('tab', { name: 'AI chat', exact: true }).click();
  await expect(card).toContainText(questions[1].prompt);
  expect(state.responses).toHaveLength(1); expect(state.startCalls).toBe(0);
});

test('free-text chat retains a rejected answer for retry and across view switches', async ({ page }) => {
  const state = await setup(page, { freeChat: true }); state.failMessageOnce = true;
  await page.goto(reviewUrl);
  const composer = page.getByPlaceholder('List a key achievement, what you did, and the measurable result.');
  const draft = 'I improved the fictional planning process and reduced repeated handovers.';
  await composer.fill(draft);
  await page.getByRole('button', { name: 'Send self-assessment message', exact: true }).click();
  await expect(page.getByText('The assistant is temporarily busy. Your answer has not been saved.', { exact: true })).toBeVisible();
  await expect(composer).toHaveValue(draft);
  await page.getByRole('tab', { name: 'Answer form', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Key Achievements', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'AI chat', exact: true }).click();
  await expect(composer).toBeVisible();
  await expect(composer).toHaveValue(draft);
  await page.getByRole('button', { name: 'Send self-assessment message', exact: true }).click();
  await expect(page.getByText('What helped you achieve that result?', { exact: true })).toBeVisible();
  await expect(composer).toHaveValue('');
  expect(state.messageBodies).toHaveLength(2);
});

test('switching to the unchanged form and back preserves edited report text and self-rating', async ({ page }) => {
  const state = await setup(page, { completedCount: 3, reportReady: true });
  await page.goto(reviewUrl);
  await expect(page.getByRole('heading', { name: 'Self-Assessment Report', exact: true })).toBeVisible();
  const draft = 'Keep my refined fictional achievement and specific delivery outcome.';
  await page.getByRole('button', { name: 'Refine', exact: true }).first().click();
  await page.getByPlaceholder('Describe your key accomplishments...').fill(draft);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('radio', { name: '4 Stars', exact: true }).press('Space');
  await expect(page.getByRole('radio', { name: '4 Stars', exact: true })).toBeChecked();
  await page.getByRole('tab', { name: 'Answer form', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Key Achievements', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'AI chat', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Self-Assessment Report', exact: true })).toBeVisible();
  await expect(page.getByText(draft, { exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: '4 Stars', exact: true })).toBeChecked();
  expect(state.reportCalls).toBe(0); expect(state.startCalls).toBe(0);
});
