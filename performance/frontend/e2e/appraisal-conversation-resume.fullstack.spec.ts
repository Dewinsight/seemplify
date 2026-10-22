import { expect, test, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import path from 'node:path';

// Every browser API call is transparently forwarded to the real product
// routers; no appraisal/question/progress/report payload is fabricated here.
// The loopback helper substitutes only IdP identity/directory and the external
// account/completion boundary. Mongo and the complete save/report flow are real.
const backend = createRequire(path.resolve(process.cwd(), '../backend/package.json'));
type Hold = { entered: Promise<void>; release: () => void };
type Stored = {
  __v: number; status: string;
  conversationAssessment: { startedAt: Date; lastActivityAt: Date; currentPhase: string };
  customResponses: { questionId: string; value: string; submittedAt?: Date }[];
  chatThread: { message: string; questionRef?: { questionId: string }; sender: { role: string } }[];
  selfAssessment: { submittedAt?: Date; overallSummary?: { achievements?: string } };
};
type Fixture = {
  apiURL: string; prompts: string[]; questionIds: string[];
  stats: { accountReads: number; contextReads: number; startRequests: number; acknowledgements: number; reportProviderCalls: number };
  seed: (days?: number) => Promise<{ id: string; startedAt: string }>;
  read: (id: string) => Promise<Stored>;
  holdNextAcknowledgement: () => Hold;
  holdNextAccountRead: () => Hold;
  close: () => Promise<void>;
};
let fixture: Fixture;
test.setTimeout(120_000);
test.beforeAll(async () => { fixture = await backend('./tests/helpers/conversationBrowserFixture').startConversationBrowserFixture(); });
test.afterAll(async () => { if (fixture) await fixture.close(); });

async function setup(page: Page) {
  await page.addInitScript(() => localStorage.setItem('accessToken', 'synthetic-conversation-browser-identity'));
  await page.route('**/__mock-api/**', async route => {
    const url = new URL(route.request().url());
    const endpoint = url.pathname.slice('/__mock-api'.length);
    const response = await route.fetch({ url: `${fixture.apiURL}/api${endpoint}${url.search}` });
    await route.fulfill({ response });
  });
}
async function saveAnswer(page: Page, question: number, value: string) {
  const card = page.getByTestId('cycle-question-card');
  await card.getByRole('textbox', { name: fixture.prompts[question], exact: true }).fill(value);
  const saved = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/conversation/message'));
  await card.getByRole('button', { name: 'Save and continue', exact: true }).click();
  expect((await saved).status()).toBe(200);
}

test('real persisted unanswered question resumes after a hundred days and survives a full page revisit', async ({ page }, info) => {
  const item = await fixture.seed(100);
  const before = await fixture.read(item.id);
  const startRequests = fixture.stats.startRequests;
  await setup(page);
  const url = `/appraisals/${item.id}/self-assessment`;
  await page.goto(url);
  const card = page.getByTestId('cycle-question-card');
  await expect(card).toContainText('Question 1 of 3');
  await expect(card.getByRole('textbox', { name: fixture.prompts[0], exact: true })).toBeVisible();
  expect((await fixture.read(item.id)).__v).toBe(before.__v);
  expect((await fixture.read(item.id)).conversationAssessment.startedAt.toISOString()).toBe(item.startedAt);
  expect(fixture.stats.startRequests).toBe(startRequests);
  await saveAnswer(page, 0, 'A fictional planning change reduced unnecessary handovers by twenty percent.');
  await expect(card).toContainText('Question 2 of 3');
  await page.goto('about:blank');
  await page.goto(url);
  await expect(card).toContainText('Question 2 of 3');
  await expect(card.getByRole('textbox', { name: fixture.prompts[1], exact: true })).toBeVisible();
  await saveAnswer(page, 1, 'Weekly evidence and clear owners improved the fictional delivery plan.');
  await expect(card).toContainText('Question 3 of 3');
  const stored = await fixture.read(item.id);
  expect(stored.customResponses.map(row => row.questionId)).toEqual(['impact', 'learning']);
  expect(stored.conversationAssessment.startedAt.toISOString()).toBe(item.startedAt);
  expect(fixture.stats.startRequests).toBe(startRequests);
  await page.screenshot({ path: info.outputPath('hundred-day-resume-real-api.png'), fullPage: true, animations: 'disabled' });
});

for (const mobile of [false, true]) test(`focus during a real pending save preserves the answer, advances once, and completes the report (${mobile ? 'mobile' : 'desktop'})`, async ({ page }, info) => {
  const item = await fixture.seed(100);
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.goto(`/appraisals/${item.id}/self-assessment`);
  const card = page.getByTestId('cycle-question-card');
  const value = 'Documented customer evidence improved a fictional planning decision and reduced rework.';
  await card.getByRole('textbox', { name: fixture.prompts[0], exact: true }).fill(value);
  const reads = fixture.stats.contextReads;
  const heldSave = fixture.holdNextAcknowledgement();
  const heldAccount = fixture.holdNextAccountRead();
  try {
    const saved = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/conversation/message'));
    await card.getByRole('button', { name: 'Save and continue', exact: true }).click();
    await heldSave.entered;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await heldAccount.entered;
    await expect(card.getByRole('textbox', { name: fixture.prompts[0], exact: true })).toHaveValue(value);
    await expect(page.getByRole('dialog', { name: 'Checking ChatGPT', exact: true })).toHaveCount(0);
    expect((await fixture.read(item.id)).customResponses).toHaveLength(0);
    heldAccount.release();
    heldSave.release();
    expect((await saved).status()).toBe(200);
    await expect(card).toContainText('Question 2 of 3');
    expect(fixture.stats.contextReads).toBe(reads);
    const first = await fixture.read(item.id);
    expect(first.customResponses).toHaveLength(1);
    expect(first.customResponses[0].value).toBe(value);
    expect(first.chatThread.filter(row => row.sender.role === 'employee')).toHaveLength(1);
  } finally { heldAccount.release(); heldSave.release(); }
  await saveAnswer(page, 1, 'Frequent evidence reviews and clear owners supported the fictional team.');
  await expect(card).toContainText('Question 3 of 3');
  const generated = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/conversation/generate-report'));
  await saveAnswer(page, 2, 'Publish a documented handover and check the next fictional milestone weekly.');
  expect((await generated).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Self-Assessment Report', exact: true })).toBeVisible();
  expect((await fixture.read(item.id)).conversationAssessment.currentPhase).toBe('review');
  expect((await fixture.read(item.id)).customResponses).toHaveLength(3);
  // A custom questionnaire need not map to the legacy summary categories.
  // Exercise the employee's real report refinement controls before submitting,
  // rather than manufacturing a complete report response in the fixture.
  const summary = {
    achievements: value,
    challenges: 'Coordinated a fictional delivery dependency through early planning and regular updates.',
    learnings: 'Used weekly evidence reviews and clear owners to support the fictional delivery team.',
    improvements: 'Document fictional delivery risks earlier and review the handover with each owner.',
    goals: 'Publish a documented handover and check the next fictional milestone weekly.'
  };
  const placeholders = ['Describe your key accomplishments...', 'Describe challenges you faced...', 'Describe what you learned...', 'Describe areas for improvement...', 'Set your goals for next period...'];
  for (const [index, text] of Object.values(summary).entries()) {
    await page.getByRole('button', { name: 'Refine', exact: true }).nth(index).click();
    await page.getByPlaceholder(placeholders[index], { exact: true }).fill(text);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
  }
  await expect(page.getByText('100%', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('completed-real-api-report.png'), fullPage: true, animations: 'disabled' });
  const submitted = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/conversation/finalize-report'));
  await page.getByRole('button', { name: 'Submit Self-Assessment', exact: true }).click();
  expect((await submitted).status()).toBe(200);
  const final = await fixture.read(item.id);
  expect(final.status).toBe('manager_review_pending');
  expect(final.selfAssessment.submittedAt).toBeTruthy();
  expect(final.selfAssessment.overallSummary).toMatchObject(summary);
  expect(final.conversationAssessment.currentPhase).toBe('completed');
  expect(final.customResponses.every(row => Boolean(row.submittedAt))).toBe(true);
  expect(final.chatThread.filter(row => row.sender.role === 'employee')).toHaveLength(3);
});

test('chat and answer form share real saved answers and return to the correct unanswered question', async ({ page }, info) => {
  const item = await fixture.seed(100);
  await setup(page);
  await page.goto(`/appraisals/${item.id}/self-assessment`);
  const value = 'Fictional customer evidence supports a documented delivery result.';
  await saveAnswer(page, 0, value);
  const tabs = page.getByRole('tablist', { name: 'Assessment view' });
  await tabs.getByRole('tab', { name: 'Answer form', exact: true }).click();
  await expect(page.getByRole('textbox', { name: fixture.prompts[0], exact: false })).toHaveValue(value);
  const manual = 'A fictional lesson was applied to the next delivery milestone.';
  await page.getByRole('textbox', { name: fixture.prompts[1], exact: false }).fill(manual);
  const saved = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/self-assessment') && response.request().postDataJSON().submit === false);
  await page.getByRole('button', { name: 'Save Draft', exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByText('Progress saved.', { exact: true })).toBeVisible();
  const stored = await fixture.read(item.id);
  expect(stored.customResponses).toEqual(expect.arrayContaining([
    expect.objectContaining({ questionId: 'impact', value }),
    expect.objectContaining({ questionId: 'learning', value: manual })
  ]));
  await tabs.getByRole('tab', { name: 'AI chat', exact: true }).click();
  const card = page.getByTestId('cycle-question-card');
  await expect(card).toContainText('Question 3 of 3');
  await expect(card.getByRole('textbox', { name: fixture.prompts[2], exact: true })).toBeVisible();
  await tabs.getByRole('tab', { name: 'Answer form', exact: true }).click();
  await expect(page.getByRole('textbox', { name: fixture.prompts[0], exact: false })).toHaveValue(value);
  await expect(page.getByRole('textbox', { name: fixture.prompts[1], exact: false })).toHaveValue(manual);
  await page.screenshot({ path: info.outputPath('shared-real-api-answers.png'), fullPage: true, animations: 'disabled' });
});
