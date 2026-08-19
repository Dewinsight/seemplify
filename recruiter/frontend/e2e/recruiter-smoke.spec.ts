import { expect, test } from '@playwright/test';
import { createRecruiterApiState, installRecruiterApiMocks, JOB_ID } from './fixtures/recruiter-api';

test('@smoke authenticated recruiter shell loads a job without browser errors', async ({ page }) => {
  const state = createRecruiterApiState();
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await installRecruiterApiMocks(page, state);

  await page.goto(`/jobs/${JOB_ID}`);

  await expect(page.getByRole('heading', { name: 'Senior Platform Engineer' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Overview', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Candidates', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Questions', exact: true })).toBeVisible();
  await expect(page.getByText('Build reliable distributed services for a growing recruitment platform.')).toBeVisible();

  expect(pageErrors).toEqual([]);
  expect(state.unhandledRequests).toEqual([]);
});
