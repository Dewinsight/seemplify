import { expect, test } from '@playwright/test';
import { createRecruiterApiState, installRecruiterApiMocks, JOB_ID } from './fixtures/recruiter-api';

test('@deep @workflow quick matching stays fast and deep matching retains analysis quality', async ({ page, isMobile }) => {
  const state = createRecruiterApiState();
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await installRecruiterApiMocks(page, state);

  await page.goto(`/jobs/${JOB_ID}`);
  await page.getByRole('button', { name: 'Candidates', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Top Matching Candidates' })).toBeVisible();
  await expect(page.getByText('Alex Morgan')).toBeVisible();

  await expect.poll(() => state.matchingRequests.length).toBe(1);
  expect(state.matchingRequests[0].query).toMatchObject({ topK: '10', analysisMode: 'quick' });
  await expect(page.getByLabel('Analysis:')).toHaveValue('quick');

  await page.getByRole('button', { name: 'Explain match for Alex Morgan' }).click();
  await expect(page.getByText('Why This Candidate Matches')).toBeVisible();
  await expect(page.getByText('Direct experience with the required platform stack')).toBeVisible();
  expect(state.explanationRequests).toHaveLength(1);

  const topKSelect = page.locator('select').filter({ has: page.locator('option[value="250"]') });
  await topKSelect.selectOption('250');
  await expect.poll(() => state.matchingRequests.at(-1)?.query).toMatchObject({ topK: '250', analysisMode: 'quick' });

  await page.getByLabel('Analysis:').selectOption('deep');
  await expect.poll(() => state.matchingRequests.at(-1)?.query).toMatchObject({ topK: '100', analysisMode: 'deep' });
  await expect(page.getByText('Deep analysis', { exact: true })).toBeVisible();
  await expect(page.getByText(isMobile ? 'Excellent' : 'Excellent Match', { exact: true })).toBeVisible();
  await expect(page.getByText('AI-enhanced matching', { exact: false })).toBeVisible();

  expect(pageErrors).toEqual([]);
  expect(state.unhandledRequests).toEqual([]);
});
