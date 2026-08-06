import { expect, test, type Page, type Route } from '@playwright/test';

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
      }), features: { ...(session.subscription?.features || {}), journeyDesign: true, journeyMetrics: true } };
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
  const summary = { id: 'journey-metric-map', legacyJourneyId: null, name: 'Onboarding journey', purpose: '',
    experienceType: 'customer', mapType: 'current_state', mode: 'connected', status: 'published',
    currentVersionId: 'journey-map-version', publishedVersionId: 'journey-map-version', revision: 2,
    stageCount: 2, cardCount: 1, evidenceLinkCount: 1, personaCount: 1, createdAt: now, updatedAt: now };
  const map = { definition: summary, version: { id: 'journey-map-version', versionNumber: 1, schemaVersion: 2,
    state: 'published', publishedAt: now, createdAt: now, mapType: 'current_state', mode: 'connected',
    experienceType: 'customer', objective: '', industry: '', summary: '', legacyAudience: '' },
  stages: [{ id: 'stage-discover', stageKey: 'discover', name: 'Discover', goal: '', description: '', ordinal: 0 },
    { id: 'stage-activate', stageKey: 'activate', name: 'Activate', goal: '', description: '', ordinal: 1 }],
  lanes: [{ id: 'lane-touchpoint', laneType: 'touchpoints', title: 'Touchpoints', description: '', ordinal: 0, visible: true }],
  cards: [{ id: 'touchpoint-welcome', stageKey: 'activate', laneType: 'touchpoints', kind: 'touchpoint', title: 'Welcome email',
    content: '', ordinal: 0, personaId: null, status: 'active', origin: 'workspace',
    evidence: { state: 'supported', supporting: 1, contradicting: 0, neutral: 0, stale: 0, inaccessible: 0, reason: 'Linked' }, evidenceLinkCount: 1 }],
  personas: [{ id: 'persona-new-customer', name: 'New customer', summary: '', lifecycleState: 'active', ownerUserId: null,
    source: 'workspace', attributes: {}, goals: [], behaviours: [], needs: [], barriers: [], reviewAt: null,
    revision: 1, createdAt: now, updatedAt: now }],
  versions: [{ id: 'journey-map-version', versionNumber: 1, state: 'published', publishedAt: now, createdAt: now }],
  researchGaps: [], evidenceSummary: { supported: 1 } };
  void page.route(/\/api\/journey-maps(?:\/[^?]+)?(?:\?.*)?$/u, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/journey-maps') await route.fulfill({ json: { journeyMaps: [summary], personas: map.personas,
      limits: { stages: 50, lanes: 20, cards: 500, cardsPerCell: 100, titleChars: 240, contentChars: 20_000 },
      catalog: { mapTypes: ['current_state'], experienceTypes: ['customer'], laneTypes: ['touchpoints'], cardKinds: ['touchpoint'],
        evidenceSourceTypes: ['survey_analysis'], evidenceAssessments: ['supports'], personaLifecycleStates: ['active'] } } });
    else await route.fulfill({ json: map });
  });
}

function surveyFixtures(page: Page) {
  const survey = { id: 'survey-onboarding', title: 'Onboarding NPS', description: '', purpose: 'customer_experience', audience: '',
    status: 'live', primaryMetric: 'nps', language: 'en', thankYouMessage: '', theme: {}, settings: {}, createdAt: now,
    updatedAt: now, publishedAt: now, responseCount: 84, collectorCount: 1 };
  const detail = { survey: { ...survey, questions: [{ id: 'question-nps', surveyId: survey.id, page: 1, position: 0,
    type: 'nps', title: 'How likely are you to recommend us?', description: '', required: true, options: [], settings: {}, logic: [] }] },
  collectors: [{ id: 'collector-web', surveyId: survey.id, name: 'Website', type: 'web', slug: 'website', status: 'open',
    settings: {}, createdAt: now, publicUrl: 'http://example.test', responseCount: 84, recipientCount: 0 }], insights: [] };
  void page.route(/\/api\/surveys(?:\/[^?]+)?(?:\?.*)?$/u, async (route) => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({ json: path === '/api/surveys' ? [survey] : detail });
  });
}

function metricFixtures(page: Page, role: 'owner' | 'member' = 'owner') {
  const version = { id: 'metric-version-1', definitionId: 'metric-definition-1', versionNumber: 1, sourceKind: 'survey',
    bindingId: 'metric-binding-1', calculatorKind: 'nps', aggregation: 'net_promoter_score', direction: 'higher_is_better',
    windowSeconds: 2_592_000, timezone: 'Europe/London', minimumSampleSize: 30, freshnessMaxAgeSeconds: 172_800,
    baselineValue: 20, targetValue: 50, population: { status: 'completed' }, filters: {}, formula: { kind: 'net_promoter_score' },
    configuration: { label: 'Onboarding NPS', scale: { minimum: 0, maximum: 10, step: 1 }, decimalPlaces: 1,
      formula: { kind: 'net_promoter_score', detractorMaximum: 6, promoterMinimum: 9 } }, contentSha256: digest,
    createdByUserId: 'qa-user', createdAt: now };
  const definition = { id: 'metric-definition-1', journeyDefinitionId: 'journey-metric-map', targetType: 'stage',
    targetId: 'stage-activate', name: 'Onboarding NPS', state: 'active', currentVersionId: version.id, revision: 1,
    currentVersion: version, createdByUserId: 'qa-user', createdAt: now, updatedAt: now };
  const binding = { id: 'metric-binding-1', journeyDefinitionId: 'journey-metric-map', targetType: 'stage', targetId: 'stage-activate',
    surveyId: 'survey-onboarding', collectorId: 'collector-web', questionId: 'question-nps',
    sourceRef: 'survey:survey-onboarding/collector:collector-web/question:question-nps', sourceState: 'available', state: 'active',
    revision: 1, createdByUserId: 'qa-user', createdAt: now, updatedAt: now };
  const open = { suppressed: false, reasonCode: null, minimumSampleSize: 30, privacyVersion: 1 };
  const observations = [{ id: 'observation-current', definitionId: definition.id, definitionVersionId: version.id, revision: 2,
    supersedesObservationId: 'observation-prior', status: 'available', value: 42.5, unit: 'percent', numerator: 34,
    denominator: 80, sampleSize: 80, period: { start: '2026-07-05T12:00:00.000Z', end: now, timezone: 'Europe/London' },
    asOf: now, calculatedAt: now, freshnessStatus: 'fresh', latestObservedAt: '2026-08-04T11:30:00.000Z',
    minimumSampleWarning: false, sourceCount: 80, result: {}, sentiment: null, privacy: open,
    rebuildRunId: 'rebuild-complete' },
  { id: 'observation-prior', definitionId: definition.id, definitionVersionId: version.id, revision: 1,
    supersedesObservationId: null, status: 'available', value: 35, unit: 'percent', numerator: 28,
    denominator: 80, sampleSize: 80, period: { start: '2026-06-05T12:00:00.000Z', end: '2026-07-05T12:00:00.000Z', timezone: 'Europe/London' },
    asOf: '2026-07-05T12:00:00.000Z', calculatedAt: '2026-07-05T12:00:00.000Z', freshnessStatus: 'stale',
    latestObservedAt: '2026-07-05T11:30:00.000Z', minimumSampleWarning: false, sourceCount: 80, result: {},
    sentiment: null, privacy: open, rebuildRunId: 'rebuild-prior' }];
  const appliedFilters = { journeyDefinitionId: 'journey-metric-map', definitionId: null,
    window: { from: null, to: null }, targetTypes: [], personas: [], segments: [], channels: [],
    cohortsSupported: false, selection: 'materialised_authorised_observations',
    limit: 100, offset: 0, truncated: false };
  const alertVersion = { id: 'alert-version-1', definitionId: 'alert-definition-1', metricDefinitionId: definition.id,
    versionNumber: 1, ruleKind: 'falling_metric', direction: 'decrease', thresholdValue: 5,
    windowSeconds: 2_592_000, cooldownSeconds: 86_400, minimumSampleSize: 30,
    staleAfterSeconds: 172_800, contradictionMinRatio: 0.25, contentSha256: digest,
    createdByUserId: 'qa-user', createdAt: now };
  const alertDefinitions: any[] = [{ id: 'alert-definition-1', journeyDefinitionId: 'journey-metric-map',
    metricDefinitionId: definition.id, name: 'NPS deterioration', state: 'active', revision: 1,
    currentVersion: alertVersion, createdByUserId: 'qa-user', createdAt: now, updatedAt: now }];
  let alerts: any[] = [{ id: 'alert-1', journeyDefinitionId: 'journey-metric-map',
    alertDefinitionId: 'alert-definition-1', alertDefinitionVersionId: alertVersion.id,
    metricDefinitionId: definition.id, metricDefinitionVersionId: version.id, observationId: observations[0]!.id,
    definitionName: 'NPS deterioration', severity: 'strong', reasonCode: 'METRIC_FELL_BEYOND_THRESHOLD',
    state: 'open', lineage: { observationIds: observations.map((row) => row.id) }, observedValue: 42.5,
    baselineValue: 50, deltaValue: -7.5, sampleSize: 80, privacySuppressed: false,
    openedAt: now, lastEvaluatedAt: now, updatedAt: now,
    acknowledgedAt: null, snoozedUntil: null, resolvedAt: null, resolvedReason: null, revision: 1 }];
  let alertRuns: any[] = []; let rebuildCount = 0; let alertCreateCount = 0; let alertEvaluateCount = 0; let alertActionCount = 0;
  void page.route(/\/api\/journey-metrics(?:\/.*)?(?:\?.*)?$/u, async (route: Route) => {
    const request = route.request(); const url = new URL(request.url());
    const relative = url.pathname.replace('/api/journey-metrics', '') || '/'; const method = request.method();
    if (method === 'GET' && relative === '/definitions') { await route.fulfill({ json: { definitions: [definition] } }); return; }
    if (method === 'GET' && relative === `/definitions/${definition.id}`) { await route.fulfill({ json: { definition, versions: [version] } }); return; }
    if (method === 'GET' && relative === '/bindings') { await route.fulfill({ json: { bindings: [binding] } }); return; }
    if (method === 'GET' && relative === '/segments') { await route.fulfill({ json: { segments: [] } }); return; }
    if (method === 'GET' && relative === '/observations') { await route.fulfill({ json: { observations, appliedFilters } }); return; }
    if (method === 'GET' && relative === `/observations/${observations[0]!.id}/lineage`) {
      await route.fulfill({ json: { observation: { ...observations[0], lineage: [{ sourceType: 'survey_response',
        sourceRecordId: 'response-42', sourceRevisionSha256: 'b'.repeat(64), occurredAt: '2026-08-04T11:30:00.000Z',
        included: true, exclusionCode: null }] } } }); return;
    }
    if (method === 'GET' && relative === '/rebuilds') { await route.fulfill({ json: { rebuilds: [] } }); return; }
    if (method === 'GET' && relative === '/alert-definitions') { await route.fulfill({ json: { definitions: alertDefinitions } }); return; }
    if (method === 'GET' && relative === '/alerts') { await route.fulfill({ json: { alerts } }); return; }
    if (method === 'GET' && relative === '/alert-runs') { await route.fulfill({ json: { runs: alertRuns } }); return; }
    if (method === 'GET' && relative === '/alert-notifications') { await route.fulfill({ json: { notifications: [] } }); return; }
    if (method === 'GET' && relative === '/alert-notification-preference') {
      await route.fulfill({ json: { preference: { enabled: role !== 'member', eligible: role !== 'member',
        revision: 0, updatedAt: null } } }); return;
    }
    if (method === 'POST' && relative === '/alert-definitions') {
      const body = request.postDataJSON(); alertCreateCount += 1; const id = `alert-definition-${alertCreateCount + 1}`;
      const nextVersion = { ...body.version, id: `${id}-version-1`, definitionId: id,
        metricDefinitionId: body.metricDefinitionId, versionNumber: 1, contentSha256: digest,
        createdByUserId: 'qa-user', createdAt: now };
      const created = { id, journeyDefinitionId: body.journeyDefinitionId, metricDefinitionId: body.metricDefinitionId,
        name: body.name, state: 'active', revision: 1, currentVersion: nextVersion,
        createdByUserId: 'qa-user', createdAt: now, updatedAt: now };
      alertDefinitions.push(created); await route.fulfill({ status: 201, json: { definition: created, replayed: false } }); return;
    }
    if (method === 'POST' && relative === '/alert-evaluations') {
      alertEvaluateCount += 1; const run = { id: `alert-run-${alertEvaluateCount}`,
        journeyDefinitionId: 'journey-metric-map', asOf: now, state: 'completed',
        evaluatedCount: alertDefinitions.length, triggeredCount: 1, warningCount: 0, resolvedCount: 0,
        errorCode: null, createdAt: now, completedAt: now };
      alertRuns = [run, ...alertRuns]; await route.fulfill({ status: 201, json: { run, replayed: false } }); return;
    }
    if (method === 'POST' && relative === '/alerts/alert-1/actions') {
      const body = request.postDataJSON(); alertActionCount += 1;
      alerts = alerts.map((item) => item.id === 'alert-1' ? { ...item,
        state: body.action === 'acknowledge' ? 'acknowledged' : body.action === 'snooze' ? 'snoozed' : 'resolved',
        acknowledgedAt: body.action === 'acknowledge' ? now : item.acknowledgedAt,
        snoozedUntil: body.action === 'snooze' ? body.snoozedUntil : null,
        resolvedAt: body.action === 'resolve' ? now : null,
        resolvedReason: body.action === 'resolve' ? 'MANUALLY_RESOLVED' : null,
        updatedAt: now, revision: item.revision + 1 } : item);
      await route.fulfill({ json: { alert: alerts.find((item) => item.id === 'alert-1') } }); return;
    }
    if (method === 'POST' && relative === '/rebuilds') {
      rebuildCount += 1; await route.fulfill({ status: 202, json: { run: { id: `rebuild-${rebuildCount}`, definitionId: definition.id,
        definitionVersionId: version.id, reason: 'manual', asOf: now, state: 'pending', availableAt: now, attemptCount: 0,
        maxAttempts: 5, observationId: null, errorCode: null, createdAt: now, updatedAt: now, completedAt: null }, replayed: false } }); return;
    }
    await route.fulfill({ status: 404, json: { error: `Unexpected journey metric fixture route ${method} ${relative}` } });
  });
  return { rebuildCount: () => rebuildCount, alertCreateCount: () => alertCreateCount,
    alertEvaluateCount: () => alertEvaluateCount, alertActionCount: () => alertActionCount };
}

test('owner can inspect exact metric lineage and queue a rebuild on desktop', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'The management path is covered on the desktop project.');
  await enableMetrics(page, 'owner'); journeyFixtures(page); surveyFixtures(page); const metrics = metricFixtures(page);
  await signIn(page); await page.goto('/journey-metrics');
  await expect(page.getByTestId('journey-metrics-page')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Journey Metrics' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Onboarding NPS current value/u })).toHaveText('42.5%');
  await page.getByRole('button', { name: /Onboarding NPS current value/u }).click();
  await expect(page.getByTestId('journey-metric-lineage-dialog')).toContainText('response-42');
  await expect(page.getByTestId('journey-metric-lineage-dialog')).toContainText(digest);
  await page.getByTestId('close-journey-metric-lineage').click();
  await page.getByRole('tab', { name: /Definitions/u }).click();
  await expect(page.getByRole('button', { name: 'New definition' })).toBeVisible();
  await page.getByRole('button', { name: 'Rebuild' }).click();
  await expect.poll(metrics.rebuildCount).toBe(1);
});

test('member gets responsive read-only analytics and can still inspect lineage on mobile', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'The member path is covered on the mobile project.');
  await enableMetrics(page, 'member'); journeyFixtures(page); surveyFixtures(page); metricFixtures(page, 'member');
  await signIn(page); await page.goto('/journey-metrics');
  await expect(page.getByTestId('journey-metrics-read-only')).toBeVisible();
  await expect(page.getByRole('button', { name: /Onboarding NPS current value/u })).toBeVisible();
  await page.getByRole('button', { name: /Onboarding NPS current value/u }).click();
  await expect(page.getByTestId('journey-metric-lineage-dialog')).toContainText('response-42');
  await page.getByTestId('close-journey-metric-lineage').click();
  await page.getByRole('tab', { name: /Definitions/u }).click();
  await expect(page.getByRole('button', { name: 'New definition' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Rebuild' })).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('owner configures, evaluates, and acknowledges a metric alert', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Alert management is covered on desktop.');
  await enableMetrics(page, 'owner'); journeyFixtures(page); surveyFixtures(page); const metrics = metricFixtures(page);
  await signIn(page); await page.goto('/journey-metrics'); await page.getByRole('tab', { name: /Alerts/u }).click();
  await expect(page.getByTestId('journey-metric-alerts')).toContainText('NPS deterioration');
  await page.getByRole('button', { name: 'New alert' }).click();
  await page.getByLabel('Name').fill('Small-sample guard');
  await page.getByLabel('Rule').selectOption('small_sample');
  await page.getByRole('button', { name: 'Save version' }).click();
  await expect.poll(metrics.alertCreateCount).toBe(1);
  await expect(page.getByTestId('journey-metric-alerts')).toContainText('Small-sample guard');
  await page.getByTestId('evaluate-alerts').click(); await expect.poll(metrics.alertEvaluateCount).toBe(1);
  await page.getByTestId('ack-alert-alert-1').click(); await expect.poll(metrics.alertActionCount).toBe(1);
  await expect(page.getByTestId('journey-metric-alerts')).toContainText('Acknowledged');
});

test('member sees alert evidence without mutation controls on mobile', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'Alert read-only behavior is covered on mobile.');
  await enableMetrics(page, 'member'); journeyFixtures(page); surveyFixtures(page); metricFixtures(page, 'member');
  await signIn(page); await page.goto('/journey-metrics'); await page.getByRole('tab', { name: /Alerts/u }).click();
  await expect(page.getByTestId('journey-metric-alerts')).toContainText('NPS deterioration');
  await expect(page.getByRole('button', { name: 'New alert' })).toHaveCount(0);
  await expect(page.getByTestId('evaluate-alerts')).toHaveCount(0);
  await expect(page.getByTestId('ack-alert-alert-1')).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
