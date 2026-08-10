import { expect, test, type Page } from '@playwright/test';

/** Scope note: this spec covers the *presentation* contract of the bounded
 * actual-path comparison — that a visible path renders as an ordered flow with a
 * real row header, that a suppressed cell renders no number, that the bound and
 * the correction proof stay on screen, and that the panel offers no affordance
 * the backend cannot honour.
 *
 * The comparison route is stubbed. Its arithmetic, suppression and abstention
 * are proved against the real database in
 * `backend/test/journey-actual-path-comparison.test.ts` and
 * `backend/test/journey-actual-path-intelligence-routes.test.ts`; asserting
 * those through a stub would prove nothing. */

test.describe.configure({ retries: 0 });

const password = 'Playwright-Test-Password-2026!';
const now = '2026-08-04T12:00:00.000Z';
const windowStart = '2026-07-05T12:00:00.000Z';

async function enableActualPaths(page: Page, role: 'owner' | 'member') {
  await page.route('**/api/auth/session', async (route) => {
    const response = await route.fetch(); const session = await response.json();
    if (session.authenticated) {
      session.activeSpace = { ...session.activeSpace, role };
      session.subscription = { ...(session.subscription || {
        planCode: 'enterprise', planName: 'Enterprise', limits: {}, status: 'active', source: 'managed_fallback'
      }), features: { ...(session.subscription?.features || {}), journeyDesign: true, journeyMetrics: true,
        journeyActualPaths: true, journeyConnected: true } };
    }
    await route.fulfill({ response, json: session });
  });
}

async function signIn(page: Page) {
  await page.goto('/login'); await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();
}

function journeyFixtures(page: Page) {
  const summary = { id: 'comparison-map', legacyJourneyId: null, name: 'Onboarding journey', purpose: '',
    experienceType: 'customer', mapType: 'current_state', mode: 'connected', status: 'published',
    currentVersionId: 'comparison-version', publishedVersionId: 'comparison-version', revision: 2,
    stageCount: 2, cardCount: 0, evidenceLinkCount: 0, personaCount: 1, createdAt: now, updatedAt: now };
  const map = { definition: summary, version: { id: 'comparison-version', versionNumber: 1, schemaVersion: 2,
    state: 'published', publishedAt: now, createdAt: now, mapType: 'current_state', mode: 'connected',
    experienceType: 'customer', objective: '', industry: '', summary: '', legacyAudience: '' },
  stages: [{ id: 'stage-discover', stageKey: 'discover', name: 'Discover', goal: '', description: '', ordinal: 0 },
    { id: 'stage-activate', stageKey: 'activate', name: 'Activate', goal: '', description: '', ordinal: 1 }],
  lanes: [{ id: 'lane-touchpoint', laneType: 'touchpoints', title: 'Touchpoints', description: '', ordinal: 0, visible: true }],
  cards: [],
  personas: [{ id: 'persona-new', name: 'New customer', summary: '', lifecycleState: 'active', ownerUserId: null,
    source: 'workspace', attributes: {}, goals: [], behaviours: [], needs: [], barriers: [], reviewAt: null,
    revision: 1, createdAt: now, updatedAt: now }],
  versions: [{ id: 'comparison-version', versionNumber: 1, state: 'published', publishedAt: now, createdAt: now }],
  researchGaps: [], evidenceSummary: {} };
  void page.route(/\/api\/journey-maps(?:\/[^?]+)?(?:\?.*)?$/u, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/journey-maps') await route.fulfill({ json: { journeyMaps: [summary], personas: map.personas,
      limits: { stages: 50, lanes: 20, cards: 500, cardsPerCell: 100, titleChars: 240, contentChars: 20_000 },
      catalog: { mapTypes: ['current_state'], experienceTypes: ['customer'], laneTypes: ['touchpoints'],
        cardKinds: ['touchpoint'], evidenceSourceTypes: ['survey_analysis'], evidenceAssessments: ['supports'],
        personaLifecycleStates: ['active'] } } });
    else await route.fulfill({ json: map });
  });
  void page.route(/\/api\/surveys(?:\/[^?]+)?(?:\?.*)?$/u, (route) => route.fulfill({ json: [] }));
}

/** One visible path pair, and a stage whose drop-off is suppressed in both
 * windows, so the same render has to show a number and an unknown side by side. */
function comparisonFixtures(page: Page) {
  const emptySuppression = { applied: false, minimumCohortSize: 10, reason: null };
  const actualPath = { analytics: { analyticsVersion: 'journey-path-analytics/v1', lineage: {
    journeyId: 'comparison-map', journeyVersion: 'comparison-version', ruleSetVersion: 'rules-v1',
    projectionVersion: 'projection-v1', period: { start: windowStart, end: now, timezone: 'UTC' },
    asOf: now, cohortId: null, designedStageOrder: ['stage-discover', 'stage-activate'] },
  sample: { inputRecordCount: 0, acceptedVisitCount: 0, acceptedInstanceCount: 0, distinctProfileCount: 0,
    distinctAccountCount: 0, suppressed: false }, dataQuality: [], tables: {
    pathSignatures: { rows: [], suppression: emptySuppression },
    transitionMatrix: { rows: [], suppression: emptySuppression },
    funnel: { rows: [], suppression: emptySuppression },
    loops: { rows: [], suppression: emptySuppression },
    repeats: { rows: [], suppression: emptySuppression },
    skippedTransitions: { rows: [], suppression: emptySuppression },
    unexpectedTransitions: { rows: [], suppression: emptySuppression },
    entryExit: { rows: [], suppression: emptySuppression },
    stageDurations: { rows: [], suppression: emptySuppression }
  }, interpretation: { mode: 'descriptive_only', statement: 'Observed paths are descriptive only.' } },
  designedVsObserved: { stageRows: [], summary: { unobservedStageCount: 1, atRiskStageCount: 0,
    skippedForwardTransitionCount: 0, loopTransitionCount: 0 } }, scope: { subjectKind: 'anonymous_only',
    identityModel: 'anonymous_instance_scoped', designVersionSource: 'published', designVersionId: 'comparison-version',
    notes: ['No accepted journey instances were available in this fixture.'] } };
  const intelligence = { detectorVersion: 'journey-path-intelligence/v1', provenance: {
    journeyDefinitionId: 'comparison-map', journeyMapVersionId: 'comparison-version', subjectScope: 'anonymous_only',
    identityModel: 'anonymous_instance_scoped', window: { start: windowStart, end: now, asOf: now },
    analyticsVersion: 'journey-path-analytics/v1' }, sample: { acceptedInstanceCount: 0, acceptedVisitCount: 0,
    minimumSampleSize: 10, secondarySuppressionThreshold: 3, sufficient: false, suppressed: false },
  status: 'abstained', abstentionReasons: ['INSUFFICIENT_SAMPLE'], indicators: [], recommendations: [],
  limitations: ['No accepted journey instances were available.'], interpretation: { mode: 'descriptive_rules_only',
    statement: 'Fixed versioned rules describe observed conditions only.' } };
  const comparison = { comparisonVersion: 'journey-actual-path-comparison/v2', status: 'compared',
    abstentionReasons: [], provenance: { journeyDefinitionId: 'comparison-map',
      journeyMapVersionId: 'comparison-version', subjectScope: 'anonymous_only',
      identityModel: 'anonymous_instance_scoped',
      baselineWindow: { start: '2026-06-05T12:00:00.000Z', end: windowStart, timezone: 'UTC' },
      currentWindow: { start: windowStart, end: now, timezone: 'UTC' },
      baselineAsOf: windowStart, currentAsOf: now, ruleSetVersion: 'rules-v1', projectionVersion: 'projection-v1',
      baselineRuleSetVersion: 'rules-baseline', currentRuleSetVersion: 'rules-current',
      baselineProjectionVersion: 'projection-baseline', currentProjectionVersion: 'projection-current',
      baselineIdentityModel: 'anonymous_instance_scoped', currentIdentityModel: 'anonymous_instance_scoped',
      sourceCitations: [{ window: 'baseline', analyticsContentSha256: 'b'.repeat(64),
        correction: { projectionFreshness: 'current_as_of_window', latestCompletedReprojection: null } },
      { window: 'current', analyticsContentSha256: 'c'.repeat(64),
        correction: { projectionFreshness: 'corrected_after_window', latestCompletedReprojection: {
          id: 'reprojection-1', completedAt: now, sourceScopeSha256: 'd'.repeat(64), windowStart: null, windowEnd: null } } }] },
    sample: { baselineAcceptedInstanceCount: 20, currentAcceptedInstanceCount: 20, minimumSampleSize: 10,
      secondarySuppressionThreshold: 3 },
    cohorts: { gaps: [{ stageId: 'stage-activate', cohort: 'observed_gap' }], loops: [],
      abandonment: [{ stageId: 'stage-discover', cohort: 'window_drop_off', percentage: 55 }],
      deterioration: [{ stageId: 'stage-discover', percentagePointDelta: 25, cohort: 'deteriorated' }] },
    comparisons: { paths: [{ signatureSha256: 'e'.repeat(64), stageIds: ['stage-discover', 'stage-activate'],
      baseline: { value: 8, suppression: 'none' }, current: { value: 13, suppression: 'none' }, delta: 5,
      status: 'descriptive_change' }],
    stages: [{ stageId: 'stage-discover', baselineDropOffPercentage: 30, currentDropOffPercentage: 55,
      percentagePointDelta: 25, cohort: 'deteriorated', interpretation: 'descriptive_change_only' },
    { stageId: 'stage-activate', baselineDropOffPercentage: null, currentDropOffPercentage: null,
      percentagePointDelta: null, cohort: 'unknown', interpretation: 'descriptive_change_only' }],
    bounds: { requestedLimit: 20, appliedLimit: 20, maximumLimit: 50, maximumCandidatePathCount: 10_000,
      totalCandidatePathCount: null, omittedPathCount: null, suppressedPathCells: true, suppressedStageCells: true } },
    interpretation: { mode: 'descriptive_comparison_only',
      statement: 'These are bounded comparisons of observed, version-matched windows. Unknown and suppressed cells are not zero.' } };
  const comparisonQueries: string[] = [];

  void page.route(/\/api\/journey-metrics(?:\/.*)?(?:\?.*)?$/u, async (route) => {
    const url = new URL(route.request().url());
    const relative = url.pathname.replace('/api/journey-metrics', '') || '/';
    if (relative === '/actual-path-comparisons') {
      comparisonQueries.push(url.search);
      await route.fulfill({ json: { comparison } }); return;
    }
    if (relative === '/actual-paths') { await route.fulfill({ json: actualPath }); return; }
    if (relative === '/actual-path-intelligence') { await route.fulfill({ json: { intelligence } }); return; }
    if (relative === '/actual-path-intelligence/runs') { await route.fulfill({ json: { runs: [] } }); return; }
    if (relative === '/actual-path-intelligence/recommendations') {
      await route.fulfill({ json: { recommendations: [] } }); return;
    }
    if (relative === '/actual-path-stage-inference/recommendations') {
      await route.fulfill({ json: { recommendations: [],
        permissions: { canRequestReview: false, canReview: false } } }); return;
    }
    if (relative === '/actual-path-rollups/latest') { await route.fulfill({ json: { rollup: null } }); return; }
    if (relative === '/actual-path-snapshots/latest') { await route.fulfill({ json: { snapshot: null } }); return; }
    if (relative === '/actual-path-snapshots') { await route.fulfill({ json: { snapshots: [] } }); return; }
    if (relative === '/definitions') { await route.fulfill({ json: { definitions: [] } }); return; }
    if (relative === '/segments') { await route.fulfill({ json: { segments: [] } }); return; }
    if (relative === '/bindings') { await route.fulfill({ json: { bindings: [] } }); return; }
    if (relative === '/rebuilds') { await route.fulfill({ json: { rebuilds: [] } }); return; }
    if (relative === '/observations') {
      await route.fulfill({ json: { observations: [], appliedFilters: { journeyDefinitionId: 'comparison-map',
        definitionId: null, window: { from: null, to: null }, targetTypes: [], personas: [], segments: [],
        channels: [], cohortsSupported: false, selection: 'materialised_authorised_observations',
        limit: 100, offset: 0, truncated: false } } }); return;
    }
    if (relative === '/alert-definitions') { await route.fulfill({ json: { definitions: [] } }); return; }
    if (relative === '/alerts') { await route.fulfill({ json: { alerts: [] } }); return; }
    if (relative === '/alert-runs') { await route.fulfill({ json: { runs: [] } }); return; }
    if (relative === '/alert-notifications') { await route.fulfill({ json: { notifications: [] } }); return; }
    if (relative === '/alert-notification-preference') {
      await route.fulfill({ json: { preference: { enabled: false, eligible: false, revision: 0, updatedAt: null } } });
      return;
    }
    await route.fulfill({ json: {} });
  });
  return { comparisonQueries };
}

async function openComparison(page: Page, role: 'owner' | 'member') {
  await enableActualPaths(page, role);
  journeyFixtures(page);
  const { comparisonQueries } = comparisonFixtures(page);
  await signIn(page);
  await page.goto('/journey-metrics');
  const panel = page.getByTestId('actual-path-comparison');
  await expect(panel).toContainText('Previous-period path comparison');
  await panel.getByRole('button', { name: 'Compare periods' }).click();
  return { panel, comparisonQueries };
}

test('desktop reader follows a visible path as an ordered flow with its exact counts and correction proof',
  async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop flow presentation.');
    const { panel, comparisonQueries } = await openComparison(page, 'owner');

    // The flow is a real table: the path is the row header, the counts are cells.
    const flow = page.getByTestId('actual-path-flow-table');
    await expect(flow).toBeVisible();
    await expect(flow.getByRole('row', { name: /Discover then Activate 8 13 \+5/u })).toBeVisible();
    await expect(flow.getByRole('rowheader', { name: 'Discover then Activate' })).toBeVisible();
    // The sr-only caption is the table's accessible name, not decoration.
    await expect(page.getByRole('table', { name: /Observed journey path counts/u })).toBeVisible();
    // The reading order is the observed order, not an alphabetical or scored one.
    await expect(flow.getByRole('listitem').first()).toContainText('Discover');
    await expect(flow.getByRole('listitem').last()).toContainText('Activate');

    // The stage table keeps unknown separate from zero, and the change is in points.
    await expect(panel.getByRole('row', { name: /Discover 30% 55% \+25 pp/u })).toBeVisible();
    await expect(panel.getByRole('row', { name: /Activate Unknown \/ suppressed/u })).toBeVisible();

    // Both windows keep their own source proof and correction freshness.
    await expect(panel).toContainText('Previous source proof');
    await expect(panel).toContainText('Current source proof');
    await expect(panel).toContainText('Previous processing versions');
    await expect(panel).toContainText('rules-baseline · projection-baseline');
    await expect(panel).toContainText('rules-current · projection-current');
    await expect(panel).toContainText('corrected after window');
    await expect(panel).toContainText('complementary cell');
    await expect(panel).toContainText('complementary stage cell');
    await expect(panel).toContainText('Unknown and suppressed cells are not zero');

    // The request pins one bounded, version-matched pair of windows.
    expect(comparisonQueries).toHaveLength(1);
    const query = new URLSearchParams(comparisonQueries[0] || '');
    expect(query.get('limit')).toBe('20');
    expect(query.get('journeyDefinitionId')).toBe('comparison-map');
    expect(query.get('currentFrom')).toBe(windowStart);
    expect(query.get('currentTo')).toBe(now);
    expect(query.get('baselineTo')).toBe(windowStart);
    expect(Date.parse(query.get('baselineFrom') || '')).toBeLessThan(Date.parse(windowStart));
  });

test('mobile member reads the same bounded flow without overflow and without invented affordances',
  async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'Mobile member read path.');
    const { panel } = await openComparison(page, 'member');

    // The same semantic table is the mobile presentation; it scrolls inside its
    // own container rather than being replaced by a lossy summary.
    const flow = page.getByTestId('actual-path-flow-table');
    await expect(flow.getByRole('row', { name: /Discover then Activate 8 13 \+5/u })).toBeVisible();
    await expect(panel).toContainText('Unknown / suppressed');

    // Nothing overflows the viewport horizontally.
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    // The panel offers no action the backend cannot honour: there is no alert
    // linkage and no correction or rebuild request for an actual-path window.
    for (const name of [/Create alert/u, /Raise alert/u, /Request correction/u, /Rebuild/u, /Reproject/u]) {
      await expect(panel.getByRole('button', { name })).toHaveCount(0);
    }
    // A member still reads the comparison itself.
    await expect(panel.getByRole('button', { name: 'Compare periods' })).toBeEnabled();
  });
