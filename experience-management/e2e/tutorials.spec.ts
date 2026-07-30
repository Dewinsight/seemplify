import { expect, test, type Page } from '@playwright/test';

const qaEmail = 'qa@seemplify.local';
const qaPassword = 'Playwright-Test-Password-2026!';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(qaEmail);
  await page.getByLabel('Password').fill(qaPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();
}

async function resetTutorial(page: Page, tutorialKey = 'overview') {
  const response = await page.request.post('/__e2e__/tutorials/reset', { data: { tutorialKey } });
  expect(response.status(), await response.text()).toBe(200);
}

async function expectFirstVisitTutorial(page: Page) {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const progress = dialog.getByText(/^Step 1 of \d+$/);
  await expect(progress).toBeVisible();
  const match = (await progress.textContent())?.match(/^Step 1 of (\d+)$/);
  expect(match, 'the tutorial should expose its total number of steps').toBeTruthy();
  const total = Number(match![1]);
  expect(total).toBeGreaterThan(1);
  const lessonImage = dialog.getByRole('img');
  await expect(lessonImage).toBeVisible();
  await expect.poll(() => lessonImage.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0), {
    message: 'the tutorial illustration should load rather than falling back to text'
  }).toBe(true);
  return { dialog, total };
}

test.describe('guided tutorials', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'One browser project exercises persistent account tutorial state.');
    test.skip(Boolean(process.env.PLAYWRIGHT_EXTERNAL_URL), 'Tutorial reset is intentionally available only in the isolated local E2E server.');
    await login(page);
    await resetTutorial(page);
    await page.reload();
  });

  test('auto-opens on first visit, exposes every step, persists completion, and supports replay', async ({ page }) => {
    const { dialog, total } = await expectFirstVisitTutorial(page);
    await expect(dialog.getByRole('button', { name: 'Previous' })).toBeDisabled();

    for (let step = 2; step <= total; step += 1) {
      await dialog.getByRole('button', { name: 'Next' }).click();
      await expect(dialog.getByText(`Step ${step} of ${total}`, { exact: true })).toBeVisible();
    }

    await expect(dialog.getByRole('button', { name: 'Finish tutorial' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Finish tutorial' }).click();
    await expect(dialog).toBeHidden();

    await page.reload();
    await expect(page.getByRole('dialog')).toBeHidden();

    const replay = page.getByRole('button', { name: 'Tutorial', exact: true });
    await expect(replay).toBeVisible();
    await replay.click();
    await expectFirstVisitTutorial(page);
  });

  test('persists Maybe later dismissal while keeping Tutorial replay available', async ({ page }) => {
    const { dialog } = await expectFirstVisitTutorial(page);
    await dialog.getByRole('button', { name: 'Maybe later' }).click();
    await expect(dialog).toBeHidden();

    await page.reload();
    await expect(page.getByRole('dialog')).toBeHidden();

    const replay = page.getByRole('button', { name: 'Tutorial', exact: true });
    await expect(replay).toBeVisible();
    await replay.click();
    const replayed = await expectFirstVisitTutorial(page);
    await expect(replayed.dialog.getByRole('button', { name: 'Previous' })).toBeDisabled();
  });
});
