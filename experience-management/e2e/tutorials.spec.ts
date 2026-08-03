import { expect, test, type Page } from '@playwright/test';

const qaEmail = 'qa@seemplify.local';
const qaPassword = 'Playwright-Test-Password-2026!';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(qaEmail);
  await page.getByLabel('Password', { exact: true }).fill(qaPassword);
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

async function tutorialLayout(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const bodyStyle = getComputedStyle(document.body);
    const dialog = document.querySelector<HTMLElement>('[data-testid="section-tutorial-dialog"]');
    return {
      innerWidth: window.innerWidth,
      rootClientWidth: root.clientWidth,
      rootScrollWidth: root.scrollWidth,
      documentOverflow: root.scrollWidth - root.clientWidth,
      dialogOverflow: dialog ? dialog.scrollWidth - dialog.clientWidth : null,
      bodyMarginRight: bodyStyle.marginRight,
      bodyPaddingRight: bodyStyle.paddingRight,
      removedScrollBarSize: bodyStyle.getPropertyValue('--removed-body-scroll-bar-size'),
      scrollLocked: document.body.hasAttribute('data-scroll-locked'),
      tutorialOpen: root.hasAttribute('data-section-tutorial-open'),
      coarsePointer: matchMedia('(hover: none) and (pointer: coarse)').matches
    };
  });
}

test.describe('tutorial dialog layout', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(Boolean(process.env.PLAYWRIGHT_EXTERNAL_URL), 'Tutorial reset is intentionally available only in the isolated local E2E server.');
    await login(page);
    await resetTutorial(page);
    await page.reload();
  });

  test('uses the available desktop width and stacks without horizontal overflow on mobile', async ({ page }, testInfo) => {
    const seededSurveyIds: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      const response = await page.request.post('/api/surveys', { data: {
        title: `Width-stress-${index}-${'Evidence'.repeat(18)}`,
        purpose: 'customer_experience', primaryMetric: 'custom', questions: []
      } });
      expect(response.ok(), await response.text()).toBe(true);
      seededSurveyIds.push((await response.json()).id);
    }
    await resetTutorial(page);
    await page.reload();
    const { dialog } = await expectFirstVisitTutorial(page);
    await page.evaluate(() => document.fonts.ready);
    const bounds = await dialog.boundingBox();
    const viewport = page.viewportSize();
    expect(bounds).not.toBeNull();
    expect(viewport).not.toBeNull();

    const openLayout = await tutorialLayout(page);
    expect(openLayout.scrollLocked).toBe(true);
    expect(openLayout.tutorialOpen).toBe(true);
    expect(openLayout.dialogOverflow, JSON.stringify(openLayout)).toBeLessThanOrEqual(1);
    expect(openLayout.documentOverflow, JSON.stringify(openLayout)).toBeLessThanOrEqual(1);

    const visual = await dialog.getByRole('region', { name: 'Lesson visual' }).boundingBox();
    const detail = await dialog.locator('[aria-live="polite"]').boundingBox();
    expect(visual).not.toBeNull();
    expect(detail).not.toBeNull();
    if (testInfo.project.name === 'desktop-chromium') {
      expect(bounds!.width).toBeGreaterThanOrEqual(900);
      expect(bounds!.width).toBeLessThanOrEqual(970);
      expect(detail!.x).toBeGreaterThan(visual!.x + visual!.width - 2);
    } else {
      expect(bounds!.width).toBeLessThanOrEqual(viewport!.width - 20);
      expect(detail!.y).toBeGreaterThanOrEqual(visual!.y + visual!.height - 2);
    }

    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => tutorialLayout(page).then((layout) => layout.scrollLocked)).toBe(false);
    const closedLayout = await tutorialLayout(page);
    expect(closedLayout.tutorialOpen).toBe(false);
    expect(closedLayout.documentOverflow, JSON.stringify(closedLayout)).toBeLessThanOrEqual(1);
    const createSurvey = page.getByRole('link', { name: 'New survey', exact: true });
    const createSurveyBounds = await createSurvey.boundingBox();
    expect(createSurveyBounds).not.toBeNull();
    if (testInfo.project.name === 'mobile-chromium') expect(createSurveyBounds!.width).toBeLessThanOrEqual(36);

    await page.getByRole('button', { name: 'Tutorial', exact: true }).click();
    await expect(dialog).toBeVisible();
    const reopenedLayout = await tutorialLayout(page);
    expect(reopenedLayout.scrollLocked).toBe(true);
    expect(reopenedLayout.tutorialOpen).toBe(true);
    expect(reopenedLayout.dialogOverflow, JSON.stringify(reopenedLayout)).toBeLessThanOrEqual(1);
    expect(reopenedLayout.documentOverflow, JSON.stringify(reopenedLayout)).toBeLessThanOrEqual(1);
    for (const surveyId of seededSurveyIds) await page.request.delete(`/api/surveys/${surveyId}`);
  });
});

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
