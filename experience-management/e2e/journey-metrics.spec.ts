import { expect, test, type Page, type Route } from '@playwright/test';

test.describe.configure({ retries: 0 });

const password = 'Playwright-Test-Password-2026!';
const now = '2026-08-04T12:00:00.000Z';
const digest = 'a'.repeat(64);

async function enableMetrics(page: Page, role: 'owner' | 'member', actualPaths = false) {
  await page.route('**/api/auth/session', async (route) => {
    const response = await route.fetch(); const session = await response.json();
    if (session.authenticated) {
      session.activeSpace = { ...session.activeSpace, role };
      session.subscription = { ...(session.subscription || {
        planCode: 'enterprise', planName: 'Enterprise', limits: {}, status: 'active', source: 'managed_fallback'
      }), features: { ...(session.subscription?.features || {}), journeyDesign: true, journeyMetrics: true,
        journeyActualPaths: actualPaths, journeyConnected: actualPaths } };
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
  const emptySuppression = { applied: false, minimumCohortSize: 10, reason: null };
  const actualPath = { analytics: { analyticsVersion: 'journey-path-analytics/v1', lineage: { journeyId: 'journey-metric-map',
    journeyVersion: 'journey-map-version', ruleSetVersion: 'rules-v1', projectionVersion: 'projection-v1',
    period: { start: '2026-07-04T00:00:00.000Z', end: now, timezone: 'UTC' }, asOf: now, cohortId: null,
    designedStageOrder: ['stage-discover', 'stage-activate'] }, sample: { inputRecordCount: 40, acceptedVisitCount: 40,
    acceptedInstanceCount: 20, distinctProfileCount: 20, distinctAccountCount: 0, suppressed: false }, dataQuality: [],
    tables: { pathSignatures: { rows: [], suppression: emptySuppression }, transitionMatrix: { rows: [], suppression: emptySuppression },
      funnel: { rows: [], suppression: emptySuppression }, loops: { rows: [], suppression: emptySuppression },
      repeats: { rows: [], suppression: emptySuppression }, skippedTransitions: { rows: [], suppression: emptySuppression },
      unexpectedTransitions: { rows: [], suppression: emptySuppression }, entryExit: { rows: [], suppression: emptySuppression },
      stageDurations: { rows: [], suppression: emptySuppression } },
    interpretation: { mode: 'descriptive_only', statement: 'Observed paths are descriptive only.' } },
  designedVsObserved: { stageRows: [], summary: { unobservedStageCount: 0, atRiskStageCount: 0,
    skippedForwardTransitionCount: 0, loopTransitionCount: 0 } }, scope: { subjectKind: 'anonymous_only',
    identityModel: 'anonymous_instance_scoped', designVersionSource: 'published', designVersionId: 'journey-map-version',
    notes: ['Anonymous journey instances only.'] } };
  const recommendationContent = { key: 'stage-discover->stage-activate', kind: 'review_stage_inference_rule',
    fromStageId: 'stage-discover', inferredStageId: 'stage-activate', evidence: { occurrenceCount: 4, sampleSize: 20, percentage: 20 },
    confidence: { sampleSufficiency: { observed: 20, required: 10, met: true }, recurrence: { observed: 4, required: 3, met: true },
      visibility: { suppressed: false } }, rationale: 'Review whether deterministic rules should recognise this transition.',
    limitations: ['Descriptive evidence only.'], applyMode: 'human_review_only' };
  const intelligence = { detectorVersion: 'journey-path-intelligence/v1', provenance: { journeyDefinitionId: 'journey-metric-map',
    journeyMapVersionId: 'journey-map-version', subjectScope: 'anonymous_only', identityModel: 'anonymous_instance_scoped',
    window: { start: '2026-07-04T00:00:00.000Z', end: now, asOf: now }, analyticsVersion: 'journey-path-analytics/v1' },
  sample: { acceptedInstanceCount: 20, acceptedVisitCount: 40, minimumSampleSize: 10,
    secondarySuppressionThreshold: 3, sufficient: true, suppressed: false }, status: 'detected', abstentionReasons: [],
  indicators: [{ code: 'UNEXPECTED_TRANSITION', severity: 'warning', stageId: null, fromStageId: 'stage-discover',
    toStageId: 'stage-activate', observed: { count: 4, denominator: 20, percentage: 20, durationMs: null },
    threshold: { kind: 'count', value: 3 }, explanation: 'An observed transition is not adjacent in the selected design.',
    limitations: ['Descriptive evidence only.'] }], recommendations: [recommendationContent],
  limitations: ['Indicators are descriptive, not causal or predictive.'], interpretation: { mode: 'descriptive_rules_only',
    statement: 'Fixed versioned rules describe observed conditions only.' } };
  const pathComparison = { comparisonVersion: 'journey-actual-path-comparison/v2', status: 'compared', abstentionReasons: [],
    provenance: { journeyDefinitionId: 'journey-metric-map', journeyMapVersionId: 'journey-map-version',
      subjectScope: 'anonymous_only', identityModel: 'anonymous_instance_scoped',
      baselineWindow: { start: '2026-06-03T00:00:00.000Z', end: '2026-07-04T00:00:00.000Z', timezone: 'UTC' },
      currentWindow: { start: '2026-07-04T00:00:00.000Z', end: now, timezone: 'UTC' },
      baselineAsOf: '2026-07-04T00:00:00.000Z', currentAsOf: now, ruleSetVersion: 'rules-v1', projectionVersion: 'projection-v1',
      baselineRuleSetVersion: 'rules-v1', currentRuleSetVersion: 'rules-v1',
      baselineProjectionVersion: 'projection-v1', currentProjectionVersion: 'projection-v1',
      baselineIdentityModel: 'anonymous_instance_scoped', currentIdentityModel: 'anonymous_instance_scoped',
      sourceCitations: [{ window: 'baseline', analyticsContentSha256: 'b'.repeat(64), correction: {
        projectionFreshness: 'current_as_of_window', latestCompletedReprojection: null } },
      { window: 'current', analyticsContentSha256: 'c'.repeat(64), correction: { projectionFreshness: 'corrected_after_window',
        latestCompletedReprojection: { id: 'reprojection-1', completedAt: now, sourceScopeSha256: 'd'.repeat(64), windowStart: null, windowEnd: null } } }] },
    sample: { baselineAcceptedInstanceCount: 20, currentAcceptedInstanceCount: 20, minimumSampleSize: 10, secondarySuppressionThreshold: 3 },
    cohorts: { gaps: [{ stageId: 'stage-activate', cohort: 'observed_gap' }], loops: [],
      abandonment: [{ stageId: 'stage-discover', cohort: 'window_drop_off', percentage: 55 }],
      deterioration: [{ stageId: 'stage-discover', baselineDropOffPercentage: 30, currentDropOffPercentage: 55,
        percentagePointDelta: 25, cohort: 'deteriorated', interpretation: 'descriptive_change_only' }] },
    comparisons: { paths: [{ signatureSha256: 'e'.repeat(64), stageIds: ['stage-discover', 'stage-activate'],
      baseline: { value: 8, suppression: 'none' }, current: { value: 13, suppression: 'none' }, delta: 5,
      status: 'descriptive_change' }], stages: [{ stageId: 'stage-discover', baselineDropOffPercentage: 30,
      currentDropOffPercentage: 55, percentagePointDelta: 25, cohort: 'deteriorated', interpretation: 'descriptive_change_only' },
    { stageId: 'stage-activate', baselineDropOffPercentage: null, currentDropOffPercentage: null,
      percentagePointDelta: null, cohort: 'unknown', interpretation: 'descriptive_change_only' }],
    bounds: { requestedLimit: 20, appliedLimit: 20, maximumLimit: 50, maximumCandidatePathCount: 10_000,
      totalCandidatePathCount: null, omittedPathCount: null, suppressedPathCells: true, suppressedStageCells: true } },
    interpretation: { mode: 'descriptive_comparison_only', statement: 'Observed version-matched changes only; not causal or predictive.' } };
  const run = { id: 'intelligence-run-1', journeyDefinitionId: 'journey-metric-map', journeyMapVersionId: 'journey-map-version',
    subjectScope: 'anonymous_only', period: { start: '2026-07-04T00:00:00.000Z', end: now }, asOf: now,
    minimumSampleSize: 10, secondarySuppressionThreshold: 3, detectorVersion: intelligence.detectorVersion,
    contentSha256: digest, result: intelligence, freshness: { status: 'stale', staleReasons: ['newer_completed_reprojection'],
      latestObservedAt: now, latestCorrectionAt: now, currentJourneyMapVersionId: 'journey-map-version' },
    createdByUserId: 'qa-user', createdAt: now };
  let recommendations: any[] = [{ id: 'recommendation-1', runId: run.id, journeyDefinitionId: 'journey-metric-map',
    journeyMapVersionId: 'journey-map-version', recommendation: recommendationContent, contentSha256: digest,
    state: 'draft', revision: 1, reviewedByUserId: null, reviewReason: null, reviewedAt: null, createdAt: now, updatedAt: now }];
  const governedContent = { deterministicRuleId: 'stage-rule-governed', signalKey: 'transition.abcdef123456',
    proposedStageId: 'stage-activate', evidence: { occurrenceCount: 18, eligibleObservationCount: 20,
      supportingInstanceCount: 18, coverage: 0.9, winningMargin: 0.9, evidenceContentSha256: digest },
    lineage: { designVersionId: 'journey-map-version', ruleSetVersion: 'rules-v1', projectionVersion: 'projection-v1',
      baseline: { start: '2026-06-03T00:00:00.000Z', end: '2026-07-04T00:00:00.000Z', asOf: '2026-07-04T00:00:00.000Z',
        analyticsContentSha256: digest, correction: { latestCompletedAt: null, correctionRunContentSha256: null } },
      current: { start: '2026-07-04T00:00:00.000Z', end: now, asOf: now, analyticsContentSha256: digest,
        correction: { latestCompletedAt: now, correctionRunContentSha256: digest } } },
    confidence: { method: 'measured_coverage_and_recurrence', coverage: 0.9, recurrence: 18, winningMargin: 0.9 },
    explanation: 'The reviewed taxonomy signal recurred in 18 of 20 eligible observations across 18 journey instances.',
    limitations: ['Measured recurrence is descriptive evidence, not proof that the proposed stage is correct.'],
    review: { applyMode: 'never_automatic', minimumDistinctReviewers: 2, proposerMayApprove: false } };
  let governedRecommendations: any[] = [{ id: 'governed-recommendation-1', runId: 'governed-run-1',
    journeyDefinitionId: 'journey-metric-map', journeyMapVersionId: 'journey-map-version', content: governedContent,
    contentSha256: digest, state: 'draft', revision: 1, reviewedByRefSha256: null, reviewReasonProof: null,
    reviewEligibility: role === 'member' ? { isProposer: false, isFirstReviewer: false, canSubmit: true, canDecide: false, canRetire: true }
      : { isProposer: false, isFirstReviewer: false, canSubmit: true, canDecide: false, canRetire: true },
    reviewedAt: null, createdAt: now, updatedAt: now }];
  let intelligenceSaveCount = 0; let recommendationReviewCount = 0; let governedGenerateCount = 0; let governedReviewCount = 0;
  let correctionRequestCount = 0;
  let correctionRuns: any[] = [{ id: 'correction-completed-1', reason: 'manual', journeyDefinitionId: 'journey-metric-map',
    journeyMapVersionId: 'journey-map-version', state: 'completed', attemptCount: 1, maxAttempts: 5,
    requestReasonProof: { sha256: digest, length: 42 }, progress: { processedCount: 40, matchedCount: 32,
      noMatchCount: 8, changedCurrentStageCount: 6, changedTerminalStateCount: 1, noChangeCount: 34 },
    errorCode: null, createdAt: now, updatedAt: now, completedAt: now }];
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
    if (method === 'GET' && relative === '/actual-paths') { await route.fulfill({ json: actualPath }); return; }
    if (method === 'GET' && relative === '/actual-path-rollups/latest') { await route.fulfill({ json: { rollup: null } }); return; }
    if (method === 'GET' && relative === '/actual-path-snapshots/latest') { await route.fulfill({ json: { snapshot: null } }); return; }
    if (method === 'GET' && relative === '/actual-path-snapshots') { await route.fulfill({ json: { snapshots: [] } }); return; }
    if (method === 'GET' && relative === '/actual-path-intelligence') { await route.fulfill({ json: { intelligence } }); return; }
    if (method === 'GET' && relative === '/actual-path-comparisons') { await route.fulfill({ json: { comparison: pathComparison } }); return; }
    if (method === 'GET' && relative === '/actual-path-corrections') { await route.fulfill({ json: { runs: correctionRuns } }); return; }
    if (method === 'POST' && relative === '/actual-path-corrections') {
      correctionRequestCount += 1; const body = request.postDataJSON();
      const requested = { id: `correction-pending-${correctionRequestCount}`, reason: 'manual',
        journeyDefinitionId: body.journeyDefinitionId, journeyMapVersionId: body.journeyMapVersionId,
        state: 'pending', attemptCount: 0, maxAttempts: 5, requestReasonProof: { sha256: digest,
          length: String(body.requestReason).length }, progress: { processedCount: 0, matchedCount: 0, noMatchCount: 0,
          changedCurrentStageCount: 0, changedTerminalStateCount: 0, noChangeCount: 0 }, errorCode: null,
        createdAt: now, updatedAt: now, completedAt: null };
      correctionRuns = [requested, ...correctionRuns];
      await route.fulfill({ status: 202, json: { run: requested, replayed: false } }); return;
    }
    if (method === 'GET' && relative === '/actual-path-intelligence/runs') { await route.fulfill({ json: { runs: [run] } }); return; }
    if (method === 'GET' && relative === '/actual-path-intelligence/recommendations') { await route.fulfill({ json: { recommendations } }); return; }
    if (method === 'GET' && relative === '/actual-path-stage-inference/recommendations') {
      await route.fulfill({ json: { recommendations: governedRecommendations,
        permissions: { canRequestReview: role !== 'member', canReview: role !== 'member' } } }); return;
    }
    if (method === 'POST' && relative === '/actual-path-stage-inference/runs') {
      governedGenerateCount += 1; await route.fulfill({ status: 201,
        json: { run: { id: 'governed-run-1' }, recommendations: governedRecommendations, replayed: false } }); return;
    }
    if (method === 'POST' && relative === '/actual-path-stage-inference/recommendations/governed-recommendation-1/review') {
      const body = request.postDataJSON(); governedReviewCount += 1;
      governedRecommendations = governedRecommendations.map((item) => ({ ...item, state: 'in_review', revision: item.revision + 1,
        reviewReasonProof: { sha256: digest, length: String(body.reason).length },
        reviewEligibility: { ...item.reviewEligibility, canSubmit: false, canDecide: false, isFirstReviewer: true }, updatedAt: now }));
      await route.fulfill({ json: { recommendation: governedRecommendations[0] } }); return;
    }
    if (method === 'POST' && relative === '/actual-path-intelligence/runs') {
      intelligenceSaveCount += 1; await route.fulfill({ status: 201, json: { run, recommendations, replayed: false } }); return;
    }
    if (method === 'PATCH' && relative === '/actual-path-intelligence/recommendations/recommendation-1') {
      const body = request.postDataJSON(); recommendationReviewCount += 1;
      recommendations = recommendations.map((item) => item.id === 'recommendation-1' ? { ...item, state: body.state,
        revision: item.revision + 1, reviewedByUserId: 'qa-user', reviewReason: body.reason, reviewedAt: now, updatedAt: now } : item);
      await route.fulfill({ json: { recommendation: recommendations[0] } }); return;
    }
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
    alertEvaluateCount: () => alertEvaluateCount, alertActionCount: () => alertActionCount,
    intelligenceSaveCount: () => intelligenceSaveCount, recommendationReviewCount: () => recommendationReviewCount,
    governedGenerateCount: () => governedGenerateCount, governedReviewCount: () => governedReviewCount,
    correctionRequestCount: () => correctionRequestCount };
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

test('manager saves deterministic path intelligence and records a human-only recommendation review on desktop', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Path-intelligence management is covered on desktop.');
  await enableMetrics(page, 'owner', true); journeyFixtures(page); surveyFixtures(page); const metrics = metricFixtures(page);
  await signIn(page); await page.goto('/journey-metrics');
  const workspace = page.getByTestId('journey-path-intelligence');
  await expect(workspace).toContainText('do not predict outcomes, establish causes');
  await expect(workspace).toContainText('UNEXPECTED TRANSITION');
  await expect(workspace).toContainText('Newer Completed Reprojection');
  await page.getByRole('button', { name: 'Compare periods' }).click();
  await expect(page.getByTestId('actual-path-comparison')).toContainText('+25 pp');
  await expect(page.getByTestId('actual-path-comparison')).toContainText('corrected after window');
  const paths = page.getByTestId('actual-path-flow-table');
  await expect(paths.getByRole('row', { name: /Discover then Activate 8 13 \+5/u })).toBeVisible();
  const corrections = page.getByTestId('actual-path-corrections');
  await expect(corrections).toContainText('40 processed · 1/5 attempts');
  await corrections.getByLabel('Reason for correction').fill('Correct the reviewed historical stage assignment.');
  await corrections.getByRole('button', { name: 'Request correction' }).click();
  await expect.poll(metrics.correctionRequestCount).toBe(1);
  await expect(corrections).toContainText('Pending');
  await workspace.getByRole('button', { name: 'Save review run' }).click();
  await expect.poll(metrics.intelligenceSaveCount).toBe(1);
  const legacyRecommendations = page.getByTestId('stage-inference-recommendations');
  await legacyRecommendations.getByLabel('Review reason').fill('Reviewed against the deterministic rule evidence.');
  await legacyRecommendations.getByRole('button', { name: 'Record review' }).click();
  await expect.poll(metrics.recommendationReviewCount).toBe(1);
  await expect(page.getByTestId('stage-inference-recommendations')).toContainText('In Review');
  await expect(workspace).toContainText('No automatic stage application');
  const governed = page.getByTestId('governed-stage-inference-review');
  await expect(governed).toContainText('18 observations across 18 journeys');
  await expect(governed).toContainText('Approval records a recommendation only');
  await governed.getByRole('button', { name: 'Generate review candidates' }).click();
  await expect.poll(metrics.governedGenerateCount).toBe(1);
  await governed.getByLabel('Review reason').fill('Independent evidence review completed.');
  await governed.getByRole('button', { name: 'Submit for independent review' }).click();
  await expect.poll(metrics.governedReviewCount).toBe(1);
  await expect(governed).toContainText('distinct second reviewer');
});

test('member sees suppression, confidence and stale history without review controls on mobile', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'Path-intelligence read-only behavior is covered on mobile.');
  await enableMetrics(page, 'member', true); journeyFixtures(page); surveyFixtures(page); metricFixtures(page, 'member');
  await signIn(page); await page.goto('/journey-metrics');
  const workspace = page.getByTestId('journey-path-intelligence');
  await expect(workspace).toContainText('Secondary threshold');
  await expect(workspace).toContainText('Sample sufficiency');
  await page.getByRole('button', { name: 'Compare periods' }).click();
  await expect(page.getByTestId('actual-path-comparison')).toContainText('Unknown / suppressed');
  await expect(page.getByTestId('actual-path-comparison')).toContainText('complementary cell');
  await expect(page.getByTestId('actual-path-flow-table').getByRole('row', { name: /Discover then Activate 8 13 \+5/u })).toBeVisible();
  const corrections = page.getByTestId('actual-path-corrections');
  await expect(corrections).toContainText('40 processed · 1/5 attempts');
  await expect(corrections.getByRole('button', { name: 'Request correction' })).toHaveCount(0);
  await expect(corrections).toContainText('Editing permission is required');
  await expect(page.getByTestId('path-intelligence-history-stacked')).toContainText('Stale');
  await expect(workspace.getByRole('button', { name: 'Save review run' })).toHaveCount(0);
  await expect(workspace.getByRole('button', { name: 'Record review' })).toHaveCount(0);
  const governed = page.getByTestId('governed-stage-inference-review');
  await expect(governed).toContainText('18 observations across 18 journeys');
  await expect(governed.getByRole('button', { name: 'Generate review candidates' })).toHaveCount(0);
  await expect(governed.getByRole('button', { name: 'Submit for independent review' })).toHaveCount(0);
  await expect(governed.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
