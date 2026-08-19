import { expect, test } from '@playwright/test';
import { createRecruiterApiState, installRecruiterApiMocks, JOB_ID } from './fixtures/recruiter-api';

test('@deep @workflow standard and optimized question generation preserve quality controls', async ({ page }) => {
  const state = createRecruiterApiState();
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await installRecruiterApiMocks(page, state);

  await page.goto(`/jobs/${JOB_ID}`);
  await page.getByRole('button', { name: 'Questions', exact: true }).click();
  await expect(page.getByText('Interview Questions', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Generate Advanced Questions' }).first().click();
  await expect(page.getByRole('dialog')).toContainText('Advanced AI Question Generator');
  await page.getByRole('button', { name: 'Generate Questions', exact: true }).click();

  await expect(page.getByText('How would you diagnose and reduce tail latency in a distributed Node.js service?')).toBeVisible();
  expect(state.questionGenerationRequests[0]).toMatchObject({
    path: `/api/jobs/${JOB_ID}/interview-questions/generate`,
    body: {
      stage: 'first_round',
      questionCount: 10,
      difficulty: 'medium',
      includeTypes: ['technical', 'behavioral', 'situational'],
      focusAreas: [],
      ensureDiversity: true,
      maxBiasScore: 0.3,
    },
  });

  await page.getByRole('button', { name: 'Generate Advanced Questions' }).first().click();
  await page.getByRole('tab', { name: 'Optimized Suite' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('spinbutton').fill('12');
  await dialog.getByRole('button', { name: 'Generate Questions', exact: true }).click();

  await expect(page.getByText('Tell us about a time you improved reliability while aligning several engineering teams.')).toBeVisible();
  expect(state.questionGenerationRequests[1]).toMatchObject({
    path: `/api/jobs/${JOB_ID}/interview-questions/generate-optimized`,
    body: {
      totalQuestions: 12,
      stages: ['screening', 'first_round', 'technical'],
      ensureDiversity: true,
      maxBiasScore: 0.3,
    },
  });

  expect(pageErrors).toEqual([]);
  expect(state.unhandledRequests).toEqual([]);
});
