import { expect, test, type Locator, type Page } from '@playwright/test';
import { createJourneyMapFixture, installJourneyMapFixture } from './fixtures/journey-map-scale-fixture';

const password = 'Playwright-Test-Password-2026!';
const provisionalBudget = {
  initialUsableMs: 2_500,
  moveFeedbackMs: 100,
  authoritativeMoveAcknowledgementMs: 500,
  ordinaryLongTaskMs: 200
} as const;

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();
}

async function pointerDrag(page: Page, source: Locator, target: Locator) {
  await source.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error('The pointer drag source or destination is not visible.');
  const from = { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 };
  const to = { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 9, from.y + 1, { steps: 2 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

test('50-stage/500-card surface stays within the proposed render and interaction budgets', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  test.skip(testInfo.project.name !== 'desktop-chromium', 'The reference scale profile is the desktop visual editor.');
  await signIn(page);
  const fixture = createJourneyMapFixture({ stageCount: 50, laneCount: 20, cardCount: 500 });
  await installJourneyMapFixture(page, fixture);
  await page.addInitScript(() => {
    (window as Window & { __journeyDocumentStartedAt?: number }).__journeyDocumentStartedAt = performance.now();
  });
  await page.goto('/journey-maps');
  const grid = page.getByTestId('journey-grid');
  await expect(grid).toBeVisible();
  await expect(grid.getByRole('columnheader')).toHaveCount(51);
  await expect(page.locator('[data-testid^="journey-card-"]')).toHaveCount(500);
  await expect(grid.getByRole('table')).toHaveAccessibleName(/Journey map grid/u);
  const initialUsableMs = await page.evaluate(() => performance.now()
    - ((window as Window & { __journeyDocumentStartedAt: number }).__journeyDocumentStartedAt || 0));

  await page.evaluate(() => {
    const scope = window as Window & {
      __journeyLongTasks?: number[];
      __journeyLongTaskObserver?: PerformanceObserver;
      __journeyOriginalFetch?: typeof window.fetch;
      __journeyMoveRequestStartedAt?: number;
      __journeyMoveResponseHeadersAt?: number;
    };
    scope.__journeyLongTasks = [];
    try {
      scope.__journeyLongTaskObserver = new PerformanceObserver((list) => {
        scope.__journeyLongTasks?.push(...list.getEntries().map((entry) => entry.duration));
      });
      scope.__journeyLongTaskObserver.observe({ entryTypes: ['longtask'] });
    } catch { /* Long-task observation is optional in non-Chromium engines. */ }
    scope.__journeyOriginalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const requestUrl = String(args[0] instanceof Request ? args[0].url : args[0]);
      const measured = /\/api\/journey-maps\/[^/]+\/cards\/[^/]+\/move(?:\?|$)/u.test(requestUrl);
      if (measured) scope.__journeyMoveRequestStartedAt = performance.now();
      const response = await scope.__journeyOriginalFetch!(...args);
      if (measured) scope.__journeyMoveResponseHeadersAt = performance.now();
      return response;
    };
  });

  const cell = page.getByTestId('cell-s01-stage-1-stage_goal');
  const moveFeedbackSamples: number[] = [];
  const authoritativeMoveSamples: number[] = [];
  const phaseSamples: Array<{ dispatchMs: number; responseHeadersMs: number; acknowledgeAfterHeadersMs: number }> = [];
  for (let sample = 0; sample < 20; sample += 1) {
    const cards = cell.locator('[data-card-focus]');
    await expect(cards).toHaveCount(2);
    const target = cards.nth(0);
    const source = cards.nth(1);
    const sourceTitle = (await source.locator('p').first().innerText()).trim();
    const startRevision = await grid.getAttribute('data-map-revision');
    if (!startRevision) throw new Error('The map revision is missing before the measured move.');

    await page.evaluate(({ expectedTitle, revision }) => {
      const scope = window as Window & {
        __journeyAuthoritativeMoveMs?: number;
        __journeyMoveFeedbackMs?: number;
        __journeyPointerReleasedAt?: number;
        __journeyMoveObserver?: MutationObserver;
        __journeyObserveAuthoritativeRender?: () => void;
      };
      scope.__journeyAuthoritativeMoveMs = undefined;
      scope.__journeyMoveFeedbackMs = undefined;
      scope.__journeyPointerReleasedAt = undefined;
      (scope as typeof scope & { __journeyMoveRequestStartedAt?: number }).__journeyMoveRequestStartedAt = undefined;
      (scope as typeof scope & { __journeyMoveResponseHeadersAt?: number }).__journeyMoveResponseHeadersAt = undefined;
      scope.__journeyMoveObserver?.disconnect();
      document.addEventListener('pointerup', () => { scope.__journeyPointerReleasedAt = performance.now(); }, {
        capture: true, once: true
      });
      const observeAuthoritativeRender = () => {
        const currentGrid = document.querySelector('[data-testid="journey-grid"]');
        const currentStatus = document.querySelector('[data-testid="journey-drag-status"]');
        const authoritativeRevision = currentGrid?.getAttribute('data-map-revision');
        if (!scope.__journeyPointerReleasedAt) return;
        if (!Number.isFinite(scope.__journeyMoveFeedbackMs)
          && currentStatus?.textContent?.includes(`Saving ${expectedTitle}`)) {
          scope.__journeyMoveFeedbackMs = performance.now() - scope.__journeyPointerReleasedAt;
        }
        if (authoritativeRevision === revision
          || !currentStatus?.textContent?.includes(`Moved ${expectedTitle}`)) return;
        scope.__journeyAuthoritativeMoveMs = performance.now() - scope.__journeyPointerReleasedAt;
        scope.__journeyMoveObserver?.disconnect();
      };
      scope.__journeyObserveAuthoritativeRender = observeAuthoritativeRender;
      scope.__journeyMoveObserver = new MutationObserver(observeAuthoritativeRender);
      scope.__journeyMoveObserver.observe(document.body, {
        attributes: true, attributeFilter: ['data-map-revision'], childList: true, subtree: true
      });
    }, { expectedTitle: sourceTitle, revision: startRevision });

    await pointerDrag(page, source.locator('[data-testid^="card-drag-"]'), target);
    await expect(page.getByTestId('journey-drag-status')).toContainText(`Moved ${sourceTitle}`);
    await page.evaluate(() => (
      window as Window & { __journeyObserveAuthoritativeRender?: () => void }
    ).__journeyObserveAuthoritativeRender?.());
    await page.waitForFunction(() => Number.isFinite(
      (window as Window & { __journeyAuthoritativeMoveMs?: number }).__journeyAuthoritativeMoveMs
    ), undefined, { timeout: 10_000 });
    moveFeedbackSamples.push(await page.evaluate(() => (
      window as Window & { __journeyMoveFeedbackMs: number }
    ).__journeyMoveFeedbackMs));
    authoritativeMoveSamples.push(await page.evaluate(() => (
      window as Window & { __journeyAuthoritativeMoveMs: number }
    ).__journeyAuthoritativeMoveMs));
    phaseSamples.push(await page.evaluate(() => {
      const scope = window as Window & {
        __journeyPointerReleasedAt: number;
        __journeyMoveRequestStartedAt: number;
        __journeyMoveResponseHeadersAt: number;
        __journeyAuthoritativeMoveMs: number;
      };
      const responseHeadersMs = scope.__journeyMoveResponseHeadersAt - scope.__journeyPointerReleasedAt;
      return {
        dispatchMs: scope.__journeyMoveRequestStartedAt - scope.__journeyPointerReleasedAt,
        responseHeadersMs,
        acknowledgeAfterHeadersMs: scope.__journeyAuthoritativeMoveMs - responseHeadersMs
      };
    }));
    await expect(cell.locator('[data-card-focus]').first()).toContainText(sourceTitle);
    console.log(`JOURNEY_SCALE_PROGRESS ${sample + 1}/20`);
  }

  const sortedMoveSamples = [...authoritativeMoveSamples].sort((left, right) => left - right);
  const sortedFeedbackSamples = [...moveFeedbackSamples].sort((left, right) => left - right);
  const percentile = (fraction: number) => sortedMoveSamples[Math.ceil(sortedMoveSamples.length * fraction) - 1];
  const feedbackPercentile = (fraction: number) => (
    sortedFeedbackSamples[Math.ceil(sortedFeedbackSamples.length * fraction) - 1]
  );
  const interaction = await page.evaluate(() => {
    const scope = window as Window & { __journeyLongTasks?: number[] };
    return { longestOrdinaryTaskMs: Math.max(0, ...(scope.__journeyLongTasks || [])) };
  });
  const authoritativeMoveMs = {
    samples: authoritativeMoveSamples,
    p50: percentile(0.5),
    p95: percentile(0.95),
    max: Math.max(...authoritativeMoveSamples)
  };
  const moveFeedbackMs = {
    samples: moveFeedbackSamples,
    p50: feedbackPercentile(0.5),
    p95: feedbackPercentile(0.95),
    max: Math.max(...moveFeedbackSamples)
  };
  const phaseSummary = Object.fromEntries((['dispatchMs', 'responseHeadersMs', 'acknowledgeAfterHeadersMs'] as const)
    .map((key) => {
      const values = phaseSamples.map((sample) => sample[key]).sort((left, right) => left - right);
      return [key, {
        p50: values[Math.ceil(values.length * 0.5) - 1],
        p95: values[Math.ceil(values.length * 0.95) - 1],
        max: Math.max(...values)
      }];
    }));

  await page.evaluate(() => {
    (window as Window & { __journeyOutlineStartedAt?: number }).__journeyOutlineStartedAt = performance.now();
  });
  await page.getByTestId('tab-outline').click();
  const outline = page.getByTestId('journey-outline');
  await expect(outline).toBeVisible();
  await expect(outline.locator('[data-testid^="outline-card-"]')).toHaveCount(500);
  await expect(outline.getByRole('table')).toHaveAccessibleName(/Journey map outline/u);
  const outlineUsableMs = await page.evaluate(() => performance.now()
    - ((window as Window & { __journeyOutlineStartedAt: number }).__journeyOutlineStartedAt || 0));
  const documentOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const environment = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
    viewport: { width: window.innerWidth, height: window.innerHeight }
  }));
  const report = {
    dataset: { stages: 50, lanes: 20, cards: 500 },
    assets: 'frontend production build served by the local E2E server',
    network: 'local deterministic API-shaped route fixture; no artificial latency',
    measurement: 'pointer release to honest pending feedback, then matching server-revision acknowledgement and live status; full card-order reconciliation is awaited before the next sample',
    provisionalBudget,
    observed: {
      initialUsableMs,
      moveFeedbackMs,
      authoritativeMoveMs,
      authoritativeMovePhases: phaseSummary,
      ...interaction,
      outlineUsableMs,
      documentOverflow
    },
    environment
  };
  console.log(`JOURNEY_SCALE_METRICS ${JSON.stringify(report)}`);
  await testInfo.attach('journey-scale-metrics.json', {
    body: Buffer.from(JSON.stringify(report, null, 2)), contentType: 'application/json'
  });

  expect(initialUsableMs).toBeLessThanOrEqual(provisionalBudget.initialUsableMs);
  expect(moveFeedbackSamples).toHaveLength(20);
  expect(moveFeedbackMs.p95).toBeLessThanOrEqual(provisionalBudget.moveFeedbackMs);
  expect(authoritativeMoveSamples).toHaveLength(20);
  expect(authoritativeMoveMs.p95).toBeLessThanOrEqual(provisionalBudget.authoritativeMoveAcknowledgementMs);
  expect(interaction.longestOrdinaryTaskMs).toBeLessThanOrEqual(provisionalBudget.ordinaryLongTaskMs);
  expect(outlineUsableMs).toBeLessThanOrEqual(provisionalBudget.initialUsableMs);
  expect(documentOverflow).toBeLessThanOrEqual(1);
});

test('compact moves reconcile research gaps and malformed responses recover the full authoritative map', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Compact pointer reconciliation contract.');
  await signIn(page);
  const fixture = createJourneyMapFixture({ stageCount: 2, laneCount: 2, cardCount: 1, name: 'Compact contract map' });
  const movedCard = fixture.map.cards[0];
  (fixture.map as any).researchGaps = [{
    stageKey: fixture.map.stages[0].stageKey,
    stageName: fixture.map.stages[0].name,
    laneType: fixture.map.lanes[0].laneType,
    cardId: movedCard.id,
    cardTitle: movedCard.title,
    state: 'hypothesis',
    reason: 'no_evidence'
  }];
  const api = await installJourneyMapFixture(page, fixture);
  await page.goto('/journey-maps');
  await pointerDrag(
    page,
    page.getByTestId(`journey-card-${movedCard.id}`).getByRole('button', { name: /Drag Scale card 001 from/u }),
    page.getByTestId(`cell-${fixture.map.stages[1].stageKey}-${fixture.map.lanes[0].laneType}`)
  );
  await expect(page.getByTestId('journey-drag-status')).toContainText('Moved Scale card 001');
  expect(api.moveRequestBodies()[0].responseMode).toBe('affected_cells');
  await page.getByTestId('tab-gaps').click();
  await expect(page.getByTestId('research-gaps')).toContainText('Stage 2');

  await page.unrouteAll({ behavior: 'wait' });
  const malformed = createJourneyMapFixture({ stageCount: 2, laneCount: 2, cardCount: 1, name: 'Malformed compact map' });
  const malformedApi = await installJourneyMapFixture(page, malformed);
  malformedApi.malformNextCompactResponse();
  await page.goto('/journey-maps');
  await expect.poll(() => malformedApi.fullMapReadCount()).toBeGreaterThan(0);
  const readsBeforeMove = malformedApi.fullMapReadCount();
  await pointerDrag(
    page,
    page.getByTestId(`journey-card-${malformed.map.cards[0].id}`).getByRole('button', { name: /Drag Scale card 001 from/u }),
    page.getByTestId(`cell-${malformed.map.stages[1].stageKey}-${malformed.map.lanes[0].laneType}`)
  );
  await expect(page.getByTestId('journey-drag-status')).toContainText('Moved Scale card 001');
  await expect(page.getByTestId(
    `cell-${malformed.map.stages[1].stageKey}-${malformed.map.lanes[0].laneType}`
  )).toContainText('Scale card 001');
  expect(malformedApi.fullMapReadCount()).toBe(readsBeforeMove + 1);
});

test('published and conflict-locked surfaces ignore pointer attempts and restore the authoritative placement', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Pointer lock contract.');
  await signIn(page);
  const published = createJourneyMapFixture({ state: 'published', stageCount: 2, laneCount: 2, cardCount: 1 });
  const publishedApi = await installJourneyMapFixture(page, published);
  await page.goto('/journey-maps');
  await expect(page.getByTestId('journey-version')).toContainText('published');
  await expect(page.locator('[data-testid^="card-drag-"]')).toHaveCount(0);
  await pointerDrag(
    page,
    page.getByTestId(`journey-card-${published.map.cards[0].id}`),
    page.getByTestId(`cell-${published.map.stages[1].stageKey}-${published.map.lanes[0].laneType}`)
  );
  expect(publishedApi.moveRequestCount()).toBe(0);

  await page.unrouteAll({ behavior: 'wait' });
  const draft = createJourneyMapFixture({ stageCount: 2, laneCount: 2, cardCount: 1, name: 'Conflict pointer map' });
  const draftApi = await installJourneyMapFixture(page, draft);
  draftApi.conflictOnNextMove();
  await page.goto('/journey-maps');
  const sourceCell = page.getByTestId(`cell-${draft.map.stages[0].stageKey}-${draft.map.lanes[0].laneType}`);
  const destinationCell = page.getByTestId(`cell-${draft.map.stages[1].stageKey}-${draft.map.lanes[0].laneType}`);
  const card = page.getByTestId(`journey-card-${draft.map.cards[0].id}`);
  await pointerDrag(page, card.getByRole('button', { name: /Drag Scale card 001 from/u }), destinationCell);
  await expect(page.getByTestId('journey-conflict-recovery')).toBeVisible();
  await expect(sourceCell).toContainText('Scale card 001');
  expect(draftApi.moveRequestCount()).toBe(1);
  await expect(page.getByTestId('journey-grid')).toHaveAttribute('data-mutation-locked', 'true');
  await expect(page.getByRole('button', { name: /Drag Scale card 001 from/u })).toBeDisabled();
  await pointerDrag(page, page.getByTestId(`journey-card-${draft.map.cards[0].id}`), destinationCell);
  expect(draftApi.moveRequestCount()).toBe(1);
  await expect(page.getByTestId('journey-undo')).toBeDisabled();

  await page.getByTestId('reapply-conflict').click();
  await expect(page.getByTestId('journey-conflict-recovery')).toBeHidden();
  await expect(destinationCell).toContainText('Scale card 001');
  expect(draftApi.moveRequestCount()).toBe(2);
  await expect(page.getByTestId('journey-undo')).toBeEnabled();
  await page.getByTestId('journey-undo').click();
  await expect(sourceCell).toContainText('Scale card 001');
  expect(draftApi.moveRequestCount()).toBe(3);
});
