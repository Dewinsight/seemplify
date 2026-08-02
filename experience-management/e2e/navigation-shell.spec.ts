import { expect, test, type Request, type Route } from '@playwright/test';

test('cold sidebar chunks keep the current shell mounted without a document navigation', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'One desktop browser exercises the cold lazy-route transition.');
  test.skip(Boolean(process.env.PLAYWRIGHT_EXTERNAL_URL), 'Chunk timing is deterministic only against the local built E2E application.');

  let releaseChunk!: () => void;
  const chunkGate = new Promise<void>((resolve) => { releaseChunk = resolve; });
  let reportChunkRequested!: () => void;
  const chunkRequested = new Promise<void>((resolve) => { reportChunkRequested = resolve; });
  let interceptedChunk = false;

  await page.route('**/assets/SurveysPage-*.js', async (route: Route) => {
    interceptedChunk = true;
    reportChunkRequested();
    await chunkGate;
    await route.continue();
  });

  await page.goto('/login');
  await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password').fill('Playwright-Test-Password-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();

  const sidebar = page.getByRole('complementary');
  const previousHeading = page.getByRole('heading', { name: 'Experience overview' });
  await expect(sidebar).toBeVisible();
  await expect(previousHeading).toBeVisible();

  await page.evaluate(() => {
    const state = window as typeof window & {
      __experienceSpaWindowSentinel?: object;
      __experienceSpaSidebarSentinel?: Element | null;
      __experienceSpaShellSentinel?: Element | null;
    };
    const sidebarElement = document.querySelector('aside');
    state.__experienceSpaWindowSentinel = { mounted: true };
    state.__experienceSpaSidebarSentinel = sidebarElement;
    state.__experienceSpaShellSentinel = sidebarElement?.closest('.min-h-screen') || null;
  });

  const documentRequests: string[] = [];
  const recordDocumentRequest = (request: Request) => {
    if (request.frame() === page.mainFrame() && request.isNavigationRequest() && request.resourceType() === 'document') {
      documentRequests.push(request.url());
    }
  };
  page.on('request', recordDocumentRequest);

  const navigation = page.getByRole('navigation', { name: 'Primary navigation' });
  const surveysLink = navigation.getByRole('link', { name: 'Surveys', exact: true });
  const click = surveysLink.click();

  try {
    await chunkRequested;
    expect(interceptedChunk).toBe(true);
    await expect(page).toHaveURL(/\/surveys$/);
    await expect(sidebar).toBeVisible();
    const retainedPreviousContent = await previousHeading.isVisible();
    if (!retainedPreviousContent) {
      await expect(page.getByRole('main').getByRole('status')).toHaveText('Loading page…');
    }

    const duringTransition = await page.evaluate(() => {
      const state = window as typeof window & {
        __experienceSpaWindowSentinel?: object;
        __experienceSpaSidebarSentinel?: Element | null;
        __experienceSpaShellSentinel?: Element | null;
      };
      const sidebarElement = document.querySelector('aside');
      return {
        windowSentinel: state.__experienceSpaWindowSentinel?.mounted === true,
        sameSidebar: state.__experienceSpaSidebarSentinel === sidebarElement,
        sameShell: state.__experienceSpaShellSentinel === sidebarElement?.closest('.min-h-screen')
      };
    });
    expect(duringTransition).toEqual({ windowSentinel: true, sameSidebar: true, sameShell: true });
    expect(documentRequests).toEqual([]);
  } finally {
    releaseChunk();
    await click;
    page.off('request', recordDocumentRequest);
  }

  await expect(page.getByRole('heading', { name: 'Surveys' })).toBeVisible();
  const afterTransition = await page.evaluate(() => {
    const state = window as typeof window & {
      __experienceSpaWindowSentinel?: object;
      __experienceSpaSidebarSentinel?: Element | null;
    };
    return {
      windowSentinel: state.__experienceSpaWindowSentinel?.mounted === true,
      sameSidebar: state.__experienceSpaSidebarSentinel === document.querySelector('aside')
    };
  });
  expect(afterTransition).toEqual({ windowSentinel: true, sameSidebar: true });
  expect(documentRequests).toEqual([]);
});
