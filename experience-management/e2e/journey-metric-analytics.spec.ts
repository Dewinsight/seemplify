import { expect, test, type Page } from '@playwright/test';

/** Scope note: this spec covers the analytics *presentation* contract — that a
 * suppressed observation renders no number, that the emotional lane has a table
 * alternative, that the filter echo comes from the server response, and that
 * desktop owner and mobile member layouts stay usable and free of overflow.
 *
 * Backend authority (filter resolution, suppression, export governance, tenant
 * isolation) is proved in `backend/test/journey-metric-analytics.test.ts`
 * against the real database. The routes here are stubbed because the Playwright
 * harness boots `app.js` without the metric rebuild runner, so a genuinely
 * suppressed observation cannot be materialised in-process; asserting backend
 * behaviour through these stubs would prove nothing. */

test.describe.configure({ retries: 0 });

const password = 'Playwright-Test-Password-2026!';
const now = '2026-08-04T12:00:00.000Z';
const digest = 'a'.repeat(64);

async function enableMetrics(page: Page, role: 'owner' | 'member') {
  await page.route('**/api/auth/session', async (route) => {
    const response = await route.fetch(); const session = await response.json();
    if (session.authenticated) {
      session.activeSpace = { ...session.activeSpace, role };
      session.subscription = { ...(session.subscription || {
        planCode: 'enterprise', planName: 'Enterprise', limits: {}, status: 'active', source: 'managed_fallback'
      }), features: { ...(session.subscription?.features || {}), journeyDesign: true, journeyMetrics: true,
        journeyExports: true } };
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
  const summary = { id: 'analytics-map', legacyJourneyId: null, name: 'Onboarding journey', purpose: '',
    experienceType: 'customer', mapType: 'current_state', mode: 'connected', status: 'published',
    currentVersionId: 'analytics-version', publishedVersionId: 'analytics-version', revision: 2,
    stageCount: 1, cardCount: 0, evidenceLinkCount: 0, personaCount: 1, createdAt: now, updatedAt: now };
  const map = { definition: summary, version: { id: 'analytics-version', versionNumber: 1, schemaVersion: 2,
    state: 'published', publishedAt: now, createdAt: now, mapType: 'current_state', mode: 'connected',
    experienceType: 'customer', objective: '', industry: '', summary: '', legacyAudience: '' },
  stages: [{ id: 'stage-activate', stageKey: 'activate', name: 'Activate', goal: '', description: '', ordinal: 0 }],
  lanes: [{ id: 'lane-touchpoint', laneType: 'touchpoints', title: 'Touchpoints', description: '', ordinal: 0, visible: true }],
  cards: [],
  personas: [{ id: 'persona-new', name: 'New customer', summary: '', lifecycleState: 'active', ownerUserId: null,
    source: 'workspace', attributes: {}, goals: [], behaviours: [], needs: [], barriers: [], reviewAt: null,
    revision: 1, createdAt: now, updatedAt: now }],
  versions: [{ id: 'analytics-version', versionNumber: 1, state: 'published', publishedAt: now, createdAt: now }],
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

function metricVersion(id: string, minimumSampleSize: number) {
  return { id, definitionId: `${id}-definition`, versionNumber: 1, sourceKind: 'operational_import',
    bindingId: null, calculatorKind: 'operational', aggregation: 'sentiment', direction: 'neutral',
    windowSeconds: 2_592_000, timezone: 'Europe/London', minimumSampleSize, freshnessMaxAgeSeconds: 172_800,
    baselineValue: null, targetValue: null, population: {}, filters: {}, formula: {},
    configuration: { label: 'lane' }, contentSha256: digest, createdByUserId: 'qa-user', createdAt: now };
}

function analyticsFixtures(page: Page) {
  const sentimentVersion = metricVersion('sentiment-version', 30);
  const suppressedVersion = metricVersion('suppressed-version', 30);
  const definitions = [
    { id: 'sentiment-version-definition', journeyDefinitionId: 'analytics-map', targetType: 'journey',
      targetId: 'analytics-map', name: 'Social sentiment', state: 'active', currentVersionId: sentimentVersion.id,
      revision: 1, currentVersion: sentimentVersion, createdByUserId: 'qa-user', createdAt: now, updatedAt: now },
    { id: 'suppressed-version-definition', journeyDefinitionId: 'analytics-map', targetType: 'segment',
      targetId: 'segment-enterprise', name: 'Enterprise NPS', state: 'active', currentVersionId: suppressedVersion.id,
      revision: 1, currentVersion: suppressedVersion, createdByUserId: 'qa-user', createdAt: now, updatedAt: now }
  ];
  const period = { start: '2026-07-05T12:00:00.000Z', end: now, timezone: 'Europe/London' };
  const observations = [
    { id: 'observation-sentiment', definitionId: definitions[0]!.id, definitionVersionId: sentimentVersion.id,
      revision: 1, supersedesObservationId: null, status: 'available', value: 12, unit: 'percent', numerator: 48,
      denominator: 400, sampleSize: 400, period, asOf: now, calculatedAt: now, freshnessStatus: 'fresh',
      latestObservedAt: '2026-08-04T11:30:00.000Z', minimumSampleWarning: false, sourceCount: 400,
      result: { formula: 'current sentiment percentage minus comparison-period sentiment percentage' },
      sentiment: { kind: 'sentiment_trend', rows: [
        { key: 'negative', label: 'Negative', currentValue: 12, currentUnit: 'percent', previousValue: 18,
          changeValue: -6, changeUnit: 'percentage_points' },
        { key: 'neutral', label: 'Neutral', currentValue: 20, currentUnit: 'percent', previousValue: 22,
          changeValue: -2, changeUnit: 'percentage_points' },
        { key: 'positive', label: 'Positive', currentValue: 65, currentUnit: 'percent', previousValue: 57,
          changeValue: 8, changeUnit: 'percentage_points' },
        { key: 'unknown', label: 'Unknown', currentValue: 3, currentUnit: 'percent', previousValue: 3,
          changeValue: 0, changeUnit: 'percentage_points' }
      ], period, comparisonPeriod: { start: '2026-06-05T12:00:00.000Z', end: period.start, timezone: 'Europe/London' },
      formula: 'current sentiment percentage minus comparison-period sentiment percentage',
      subjectType: 'social_post', aggregateOnly: true },
      privacy: { suppressed: false, reasonCode: null, minimumSampleSize: 30, privacyVersion: 1 },
      rebuildRunId: null },
    { id: 'observation-suppressed', definitionId: definitions[1]!.id, definitionVersionId: suppressedVersion.id,
      revision: 1, supersedesObservationId: null, status: 'available', value: null, unit: 'percent',
      numerator: null, denominator: null, sampleSize: null, period, asOf: now, calculatedAt: now,
      freshnessStatus: 'fresh', latestObservedAt: '2026-08-04T11:30:00.000Z', minimumSampleWarning: true,
      sourceCount: null, result: { privacy: { suppressed: true } }, sentiment: null,
      privacy: { suppressed: true, reasonCode: 'SMALL_SAMPLE_SUPPRESSED', minimumSampleSize: 30, privacyVersion: 1 },
      rebuildRunId: null }
  ];
  const segments = [{ id: 'segment-enterprise', journeyDefinitionId: 'analytics-map', name: 'Enterprise',
    description: '', rule: {}, state: 'active', revision: 1, createdByUserId: 'qa-user',
    createdAt: now, updatedAt: now }];
  const emptySuppression = { applied: false, minimumCohortSize: 10, reason: null };
  const actualPath = { analytics: { analyticsVersion: 'journey-path-analytics/v1', lineage: {
    journeyId: 'analytics-map', journeyVersion: 'analytics-version', ruleSetVersion: 'rules-v1',
    projectionVersion: 'projection-v1', period: { start: '2026-07-05T12:00:00.000Z', end: now, timezone: 'UTC' },
    asOf: now, cohortId: null, designedStageOrder: ['stage-activate'] }, sample: { inputRecordCount: 0,
    acceptedVisitCount: 0, acceptedInstanceCount: 0, distinctProfileCount: 0, distinctAccountCount: 0,
    suppressed: false }, dataQuality: [], tables: {
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
    identityModel: 'anonymous_instance_scoped', designVersionSource: 'published', designVersionId: 'analytics-version',
    notes: ['No accepted journey instances were available in this fixture.'] } };
  const intelligence = { detectorVersion: 'journey-path-intelligence/v1', provenance: {
    journeyDefinitionId: 'analytics-map', journeyMapVersionId: 'analytics-version', subjectScope: 'anonymous_only',
    identityModel: 'anonymous_instance_scoped', window: { start: '2026-07-05T12:00:00.000Z', end: now, asOf: now },
    analyticsVersion: 'journey-path-analytics/v1' }, sample: { acceptedInstanceCount: 0, acceptedVisitCount: 0,
    minimumSampleSize: 10, secondarySuppressionThreshold: 3, sufficient: false, suppressed: false },
  status: 'abstained', abstentionReasons: ['INSUFFICIENT_SAMPLE'], indicators: [], recommendations: [],
  limitations: ['No accepted journey instances were available.'], interpretation: { mode: 'descriptive_rules_only',
    statement: 'Fixed versioned rules describe observed conditions only.' } };
  const requestedFilters: string[] = [];

  void page.route(/\/api\/journey-metrics(?:\/.*)?(?:\?.*)?$/u, async (route) => {
    const url = new URL(route.request().url());
    const relative = url.pathname.replace('/api/journey-metrics', '') || '/';
    if (relative.startsWith('/analytics-export.')) {
      requestedFilters.push(url.search);
      await route.fulfill({ status: 200, headers: { 'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="journey-metric-analytics-analytics-map.csv"',
        'x-seemplify-usage-replayed': 'false' },
      body: '# {"selection":"materialised_authorised_observations"}\r\n"metricDefinitionId"\r\n' });
      return;
    }
    if (relative === '/definitions') { await route.fulfill({ json: { definitions } }); return; }
    if (relative === '/segments') { await route.fulfill({ json: { segments } }); return; }
    if (relative === '/bindings') { await route.fulfill({ json: { bindings: [] } }); return; }
    if (relative === '/observations') {
      requestedFilters.push(url.search);
      const segmentIds = url.searchParams.get('segmentIds');
      const rows = segmentIds ? observations.filter((row) => row.definitionId === definitions[1]!.id) : observations;
      await route.fulfill({ json: { observations: rows, appliedFilters: {
        journeyDefinitionId: 'analytics-map', definitionId: null,
        window: { from: null, to: null }, targetTypes: [], personas: [],
        segments: segmentIds ? [{ id: 'segment-enterprise', name: 'Enterprise' }] : [],
        channels: [], cohortsSupported: false, selection: 'materialised_authorised_observations',
        limit: 100, offset: 0, truncated: false } } });
      return;
    }
    if (relative === '/rebuilds') { await route.fulfill({ json: { rebuilds: [] } }); return; }
    if (relative === '/actual-paths') { await route.fulfill({ json: actualPath }); return; }
    if (relative === '/actual-path-rollups/latest') { await route.fulfill({ json: { rollup: null } }); return; }
    if (relative === '/actual-path-snapshots/latest') { await route.fulfill({ json: { snapshot: null } }); return; }
    if (relative === '/actual-path-snapshots') { await route.fulfill({ json: { snapshots: [] } }); return; }
    if (relative === '/actual-path-intelligence') { await route.fulfill({ json: { intelligence } }); return; }
    if (relative === '/actual-path-intelligence/runs') { await route.fulfill({ json: { runs: [] } }); return; }
    if (relative === '/actual-path-intelligence/recommendations') {
      await route.fulfill({ json: { recommendations: [] } }); return;
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
  return { requestedFilters };
}

test('desktop owner compares authorised observations, reads the sentiment lane and exports the exact scope',
  async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop owner flow.');
    await enableMetrics(page, 'owner');
    journeyFixtures(page);
    const { requestedFilters } = analyticsFixtures(page);
    await signIn(page);
    await page.goto('/journey-metrics');
    await expect(page.getByRole('heading', { name: 'Journey Metrics' })).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Filters applied by the server' })).toBeVisible();
    // The workspace states plainly that it selects materialised observations
    // rather than recomputing them.
    await expect(page.getByTestId('journey-metrics-applied-filters'))
      .toContainText('not recomputed when you change a filter');
    await expect(page.getByTestId('journey-metrics-applied-filters'))
      .toContainText('no governed cohort catalogue');

    // A suppressed measure shows its warning and no number anywhere.
    const suppressionNote = page.getByTestId('journey-metrics-suppression-note');
    await expect(suppressionNote).toContainText('privacy suppressed');
    const currentMeasures = page.getByRole('region', { name: 'Current measures and comparisons' });
    const enterpriseRow = currentMeasures.getByRole('row', { name: /Enterprise NPS/u });
    await expect(enterpriseRow).toContainText('Suppressed');
    await expect(enterpriseRow).not.toContainText('%');
    // The suppressed row keeps its window and freshness, so the reader can see
    // what was measured without seeing the measurement.
    await expect(enterpriseRow).toContainText('fresh');

    // The emotional lane is announced as an image with a text summary, and the
    // exact table alternative carries the same labelled shares.
    const lane = page.getByTestId('journey-metrics-sentiment');
    await expect(lane.getByRole('img', { name: /sentiment trend/u })).toBeVisible();
    await expect(lane.getByRole('img', { name: /aggregated social posts/u })).toBeVisible();
    await expect(lane.getByRole('row', { name: /Positive/u })).toContainText('65%');
    await expect(lane.getByRole('row', { name: /Negative/u })).toContainText('12%');
    await expect(lane).toContainText('Individual posts are never shown');
    await expect(lane).toContainText('400 social posts');

    // Applying a segment facet re-queries the server with that exact facet.
    await page.getByLabel('Enterprise', { exact: true }).check();
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect.poll(() => requestedFilters.some((search) => search.includes('segmentIds=segment-enterprise')))
      .toBe(true);
    await expect(page.getByTestId('journey-metrics-applied-filters')).toContainText('Enterprise');

    // The export is scoped to the same filters and arrives as a real download.
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV' }).click();
    expect((await download).suggestedFilename()).toBe('journey-metric-analytics-analytics-map.csv');
    expect(requestedFilters.some((search) => search.includes('analytics') || search.includes('segmentIds'))).toBe(true);
  });

test('mobile member reads suppressed and sentiment states without overflow and without management controls',
  async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'Mobile member flow.');
    await enableMetrics(page, 'member');
    journeyFixtures(page);
    analyticsFixtures(page);
    await signIn(page);
    await page.goto('/journey-metrics');
    await expect(page.getByRole('heading', { name: 'Journey Metrics' })).toBeVisible();

    await expect(page.getByTestId('journey-metrics-read-only')).toBeVisible();
    // Members can read, and cannot reach the management affordances.
    await expect(page.getByRole('button', { name: 'New definition' })).toHaveCount(0);

    // The stacked alternative replaces the horizontally scrolling table.
    const stacked = page.getByTestId('journey-metrics-current-stacked');
    await expect(stacked).toBeVisible();
    await expect(stacked).toContainText('Suppressed');
    await expect(stacked).toContainText('Enterprise NPS');

    // Nothing overflows the viewport horizontally.
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    // The sentiment table alternative is reachable and readable on mobile.
    const lane = page.getByTestId('journey-metrics-sentiment');
    await expect(lane.getByRole('row', { name: /Positive/u })).toContainText('65%');

    // Keyboard reachability: the facet checkboxes take focus in order.
    await page.getByLabel('Enterprise', { exact: true }).focus();
    await expect(page.getByLabel('Enterprise', { exact: true })).toBeFocused();
    await page.keyboard.press('Space');
    await expect(page.getByLabel('Enterprise', { exact: true })).toBeChecked();
  });
