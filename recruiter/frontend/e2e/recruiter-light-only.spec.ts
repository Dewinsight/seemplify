import { expect, test } from '@playwright/test';
import { createRecruiterApiState, installRecruiterApiMocks } from './fixtures/recruiter-api';

const INTERVIEW_ID = 'interview-light-only';
const AI_MESSAGE = 'Explain how you would compare the options, document the decision, and verify the outcome.';
const CANDIDATE_MESSAGE = 'I would begin with customer impact and delivery risk.';

const interviewDetail = {
  aiInterview: {
    _id: INTERVIEW_ID,
    title: 'Product Manager AI Interview',
    job: { _id: 'job-product', title: 'Product Manager' },
    status: 'completed',
    questionSnapshots: [{
      questionId: 'question-1',
      question: 'How would you prioritise three competing roadmap items?',
      type: 'situational',
    }],
    timers: { perQuestionMinutes: 10, totalMinutes: 45 },
    schedule: {
      sendAt: '2026-08-19T08:58:00.000Z',
      expiresAt: '2026-08-26T08:53:00.000Z',
    },
    candidateCount: 1,
    creditCostPerCandidate: 9,
    voice: { name: 'Abeo', displayName: 'Abeo', tierLabel: 'Standard' },
    costEstimate: { totalCredits: 9, estimatedUsdValue: 2.25 },
    stats: { sent: 1, opened: 1, inProgress: 0, completed: 1, blocked: 0, failed: 0 },
    createdAt: '2026-08-19T08:50:00.000Z',
    updatedAt: '2026-08-19T09:00:00.000Z',
  },
  sessions: [{
    _id: 'session-light-only',
    aiInterview: INTERVIEW_ID,
    publicInterviewPath: '/public/ai-interview/light-only-token',
    candidateSnapshot: { name: 'Michael Egbo', email: 'michael@example.test' },
    status: 'completed',
    currentQuestionIndex: 0,
    completedAt: '2026-08-19T08:57:37.000Z',
    messages: [
      {
        _id: 'message-ai',
        role: 'ai',
        content: AI_MESSAGE,
        questionIndex: 0,
        messageType: 'clarification',
        createdAt: '2026-08-19T08:56:06.000Z',
      },
      {
        _id: 'message-candidate',
        role: 'candidate',
        content: CANDIDATE_MESSAGE,
        questionIndex: 0,
        messageType: 'answer',
        createdAt: '2026-08-19T08:57:20.000Z',
      },
    ],
    answers: [{ questionIndex: 0, status: 'answered', timeSpentSeconds: 172 }],
    scoring: { status: 'completed', overallScore: 20, recommendation: 'no' },
    email: { sentAt: '2026-08-19T08:58:00.000Z', attempts: 0 },
    credits: { charged: true, cost: 9 },
    proctoring: { enabled: true, focusViolationCount: 0, pasteAttemptCount: 0, violations: [] },
    createdAt: '2026-08-19T08:50:00.000Z',
    updatedAt: '2026-08-19T08:57:37.000Z',
  }],
};

test('@smoke @deep Recruiter stays light when the suite preference is dark', async ({ page }) => {
  const state = createRecruiterApiState();
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.addInitScript(() => {
    localStorage.setItem('seemplify_theme', 'dark');
    localStorage.setItem('theme', 'dark');
    document.cookie = 'seemplify_theme=dark; Path=/; SameSite=Lax';
  });
  await installRecruiterApiMocks(page, state);
  await page.route(`**/api/ai-interviews/${INTERVIEW_ID}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'cache-control': 'no-store' },
      body: JSON.stringify(interviewDetail),
    });
  });

  await page.goto(`/ai-interviews/${INTERVIEW_ID}`);

  await expect(page.locator('html')).toHaveClass(/light/);
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
  await expect(page.getByRole('heading', { name: 'Product Manager AI Interview' })).toBeVisible();

  const interviewerText = page.getByText(AI_MESSAGE, { exact: true });
  await expect(interviewerText).toBeVisible();
  await expect(interviewerText).toHaveCSS('color', 'rgb(25, 24, 22)');
  await expect(interviewerText.locator('..')).toHaveCSS('background-color', 'rgb(255, 253, 250)');

  const answerCount = page.getByText('1 answers', { exact: true }).first();
  await expect(answerCount).toHaveCSS('color', 'rgb(93, 88, 79)');
  await expect(answerCount).toHaveCSS('background-color', 'rgb(247, 244, 238)');

  const candidateText = page.getByText(CANDIDATE_MESSAGE, { exact: true });
  await expect(candidateText).toBeVisible();
  await expect(candidateText).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(candidateText.locator('..')).toHaveCSS('background-color', 'rgb(112, 71, 235)');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('seemplify_theme'))).toBe('dark');
  await expect.poll(() => page.evaluate(() => document.cookie)).toContain('seemplify_theme=dark');

  await page.route('**/api/candidates?*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ candidates: [], totalPages: 0, currentPage: 1, total: 0 }),
    });
  });
  await page.route('**/api/candidate-shortlists', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ candidateShortlists: {}, totalCandidatesWithShortlists: 0 }),
    });
  });
  await page.goto('/candidates');
  await expect(page.getByRole('heading', { name: 'Candidate Management' })).toBeVisible();
  await expect(page.locator('[data-tutorial="candidates-table"]')).toHaveCSS(
    'background-color',
    'rgba(255, 255, 255, 0.8)',
  );
  await page.evaluate(() => {
    const root = document.documentElement;
    root.classList.remove('light');
    root.classList.add('dark');
    root.dataset.theme = 'dark';
    root.dataset.themePreference = 'dark';
    root.style.colorScheme = 'dark';
  });
  await expect(page.locator('html')).toHaveClass(/light/);
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  expect(pageErrors).toEqual([]);
  expect(state.unhandledRequests).toEqual([]);
});
