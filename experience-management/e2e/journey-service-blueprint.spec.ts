import { expect, test, type Page, type Route } from '@playwright/test';

const password = 'Playwright-Test-Password-2026!';
const now = '2026-08-07T12:00:00.000Z';
let lifecycle = 'draft';
let sessionRole = 'admin';
let lastPortfolioLinks: unknown[] = [];
let measurementRevision = 1;
let measurementOutcomes: any[] = [];
let workspaceViews: any[] = [];
const digest = 'a'.repeat(64);
const blueprint = () => ({ id: 'bp-1', spaceId: 'space', journeyDefinitionId: 'journey-1', name: 'Account opening operations', lifecycle, ownerUserId: null, ownerTeamId: null, currentVersionId: 'version-1', revision: lifecycle === 'draft' ? 1 : 2, createdAt: now, updatedAt: now });
const resources = [{ id: 'team-1', spaceId: 'space', kind: 'team', name: 'Operations', description: 'Account operations', lifecycle: 'active', ownerUserId: null, revision: 1, createdAt: now, updatedAt: now }];
const elements = [{ id: 'customer-1', stageKey: 'apply', lane: 'customer', kind: 'action', title: 'Submit application', description: '', ownerTeamId: null, actorId: null, systemId: null, vendorId: null, controlId: null, slaMinutes: null, unitCost: null, riskProbability: null, riskImpact: null, ordinal: 0, evidenceRefs: [], metricRefs: [] }, { id: 'front-1', stageKey: 'apply', lane: 'frontstage', kind: 'touchpoint', title: 'Check application', description: '', ownerTeamId: 'team-1', actorId: null, systemId: null, vendorId: null, controlId: null, slaMinutes: 30, unitCost: 4, riskProbability: 0.2, riskImpact: 0.6, ordinal: 0, evidenceRefs: [], metricRefs: [] }];
const version = () => ({ schemaVersion: 'journey-service-blueprint/v1', blueprintId: 'bp-1', spaceId: 'space', journeyDefinitionId: 'journey-1', journeyVersionId: 'map-version-1', state: 'current', versionId: 'version-1', versionNumber: 1, reviewState: 'draft', stages: [{ stageKey: 'apply', name: 'Apply', ordinal: 0 }, { stageKey: 'decision', name: 'Decision', ordinal: 1 }], elements, relationships: [{ id: 'supports-1', kind: 'supports', fromElementId: 'front-1', toElementId: 'customer-1', label: 'Assists' }], resources, portfolioLinks: [], changeReason: 'Initial operating model', createdAt: now, gaps: [{ id: 'gap-1', blueprintVersionId: 'version-1', gapType: 'support_missing', targetElementId: 'front-1', targetRelationshipId: null, severity: 'warning', state: 'open', reasonCode: 'FRONTSTAGE_SUPPORT_MISSING', detail: { message: 'Support is incomplete' }, reviewerUserId: null, reviewedAt: null, createdAt: now }] });
const analysis = { valid: true, issues: [{ severity: 'warning', code: 'FRONTSTAGE_SUPPORT_MISSING', message: 'Frontstage support is incomplete.', elementId: 'front-1', gapType: 'support_missing', gapSeverity: 'warning' }], crossings: [{ relationshipId: 'supports-1', lines: ['interaction'] }], risk: [{ elementId: 'front-1', score: 0.12, probability: 0.2, impact: 0.6 }], coverage: { frontstageElements: 1, supportedFrontstageElements: 0, backstageElements: 0, systemSupportedBackstageElements: 0, failurePoints: 0, mitigatedFailurePoints: 0 }, causality: { linkedPortfolioItems: 0, painPointTraces: [], fullyTracedPainPoints: 0 }, resourceValidation: { enforced: true, catalogueSize: 1 } };

async function signIn(page: Page) { await page.goto('/login'); await page.getByLabel('Email').fill('qa@seemplify.local'); await page.getByLabel('Password', { exact: true }).fill(password); await page.getByRole('button', { name: 'Sign in' }).click(); await expect(page).toHaveURL('/'); }
async function enableFeature(page: Page) { await page.route('**/api/auth/session', async (route) => { const response = await route.fetch(); const body = await response.json(); if (body?.subscription?.features) { body.subscription.features.journeyBlueprints = true; body.subscription.features.journeyMetrics = true; body.subscription.features.journeyExports = true; body.subscription.features.journeyPortfolio = true; } if(body?.activeSpace)body.activeSpace.role=sessionRole; await route.fulfill({ response, json: body }); }); }
async function mockBlueprints(page: Page) {
  await page.route(/\/api\/journey-blueprints(?:\/.*)?(?:\?.*)?$/u, async (route: Route) => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname; const method = request.method();
    if (path === '/api/journey-blueprints' && method === 'GET') return route.fulfill({ json: { blueprints: [blueprint()] } });
    if (path === '/api/journey-blueprints/resources/catalogue' && method === 'GET') return route.fulfill({ json: { resources } });
    if (path === '/api/journey-blueprints/bp-1/versions' && method === 'GET') return route.fulfill({ json: { versions: [{ id: 'version-1', blueprint_id: 'bp-1', journey_definition_id: 'journey-1', journey_version_id: 'map-version-1', version_number: 1, blueprint_state: 'current', review_state: 'draft', schema_version: 'journey-service-blueprint/v1', change_reason: 'Initial operating model', created_at: now, approved_by_user_id: null, approved_at: null }] } });
    if (path === '/api/journey-blueprints/bp-1/versions' && method === 'POST') { const body = request.postDataJSON(); lastPortfolioLinks = body.portfolioLinks || []; return route.fulfill({ status: 201, json: { version: { ...version(), portfolioLinks: lastPortfolioLinks }, analysis } }); }
    if (path === '/api/journey-blueprints/versions/version-1/export.json' && method === 'GET') return route.fulfill({
      status: 200, contentType: 'application/json; charset=utf-8',
      headers: { 'Content-Disposition': 'attachment; filename="journey-service-blueprint-bp-1-v1.json"',
        'X-Content-SHA256': 'a'.repeat(64) },
      body: JSON.stringify({ schemaVersion: 'journey-service-blueprint-export/v1', version: version(), analysis })
    });
    if (path === '/api/journey-blueprints/versions/version-1' && method === 'GET') return route.fulfill({ json: { version: version() } });
    if (path === '/api/journey-blueprints/versions/version-1/analysis' && method === 'GET') return route.fulfill({ json: { analysis } });
    if (path === '/api/journey-blueprints/bp-1' && method === 'PATCH') { lifecycle = request.postDataJSON().lifecycle; return route.fulfill({ json: { blueprint: blueprint() } }); }
    if (path === '/api/journey-blueprints/gaps/gap-1' && method === 'PATCH') return route.fulfill({ json: { gap: { ...version().gaps[0], state: request.postDataJSON().state, reviewerUserId: 'qa-user', reviewedAt: now } } });
    return route.fulfill({ status: 404, json: { error: `Unexpected ${method} ${path}` } });
  });
}

const metricVersion={id:'metric-version-1',definitionId:'metric-1',versionNumber:1,sourceKind:'operational_import',nativeSource:null,
  bindingId:null,calculatorKind:'operational',aggregation:'average',direction:'higher_is_better',windowSeconds:604800,timezone:'UTC',
  minimumSampleSize:10,freshnessMaxAgeSeconds:86400,baselineValue:50,targetValue:80,population:{},filters:{},formula:{kind:'average'},
  configuration:{},contentSha256:digest,createdByUserId:'qa-user',createdAt:now};
const metricDefinition={id:'metric-1',journeyDefinitionId:'journey-1',targetType:'journey',targetId:'journey-1',name:'Completion quality',
  state:'active',currentVersionId:'metric-version-1',revision:1,currentVersion:metricVersion,createdByUserId:'qa-user',createdAt:now,updatedAt:now};
const privacy={suppressed:false,reasonCode:null,minimumSampleSize:10,privacyVersion:1};
const metricObservations=[{id:'observation-after',definitionId:'metric-1',definitionVersionId:'metric-version-1',revision:2,
  supersedesObservationId:'observation-baseline',status:'available',value:85,unit:'points',numerator:85,denominator:100,sampleSize:100,
  period:{start:'2026-07-08T00:00:00.000Z',end:'2026-07-15T00:00:00.000Z',timezone:'UTC'},asOf:now,calculatedAt:now,
  freshnessStatus:'fresh',latestObservedAt:now,minimumSampleWarning:false,sourceCount:1,result:{},sentiment:null,privacy,rebuildRunId:'run-after'},
{id:'observation-baseline',definitionId:'metric-1',definitionVersionId:'metric-version-1',revision:1,supersedesObservationId:null,
  status:'available',value:50,unit:'points',numerator:50,denominator:100,sampleSize:100,
  period:{start:'2026-07-01T00:00:00.000Z',end:'2026-07-08T00:00:00.000Z',timezone:'UTC'},asOf:now,calculatedAt:now,
  freshnessStatus:'fresh',latestObservedAt:now,minimumSampleWarning:false,sourceCount:1,result:{},sentiment:null,privacy,rebuildRunId:'run-baseline'}];
const measurementPlan=()=>({id:'measurement-1',space_id:'space',blueprint_id:'bp-1',blueprint_version_id:'version-1',element_id:'front-1',
  metric_definition_id:'metric-1',metric_definition_version_id:'metric-version-1',target_value:80,target_direction:'higher_is_better',
  baseline_observation_id:'observation-baseline',baseline_value:50,baseline_unit:'points',baseline_sample_size:100,
  baseline_period_start:'2026-07-01T00:00:00.000Z',baseline_period_end:'2026-07-08T00:00:00.000Z',baseline_as_of:now,
  baseline_result_sha256:digest,baseline_source_snapshot_sha256:digest,state:'active',current_outcome_id:measurementOutcomes[0]?.id||null,
  revision:measurementRevision,idempotency_key:'plan-key',intent_sha256:digest,created_by_user_id:'qa-user',created_at:now,updated_at:now});
async function mockMeasurements(page:Page){
  await page.route(/\/api\/journey-metrics\/(?:definitions|observations)(?:\?.*)?$/u,(route)=>{
    const path=new URL(route.request().url()).pathname;if(path.endsWith('/definitions'))return route.fulfill({json:{definitions:[metricDefinition]}});
    return route.fulfill({json:{observations:metricObservations,appliedFilters:{journeyDefinitionId:'journey-1',definitionId:null,
      window:{from:null,to:null},targetTypes:[],personas:[],segments:[],channels:[],cohortsSupported:false,
      selection:'materialised_authorised_observations',limit:100,offset:0,truncated:false}}});
  });
  await page.route(/\/api\/journey-blueprint-measurements\/plans(?:\/.*)?(?:\?.*)?$/u,(route)=>{
    const request=route.request(),path=new URL(request.url()).pathname,method=request.method();
    if(path==='/api/journey-blueprint-measurements/plans'&&method==='GET')return route.fulfill({json:{plans:[measurementPlan()]}});
    if(path==='/api/journey-blueprint-measurements/plans/measurement-1'&&method==='GET')return route.fulfill({json:{plan:measurementPlan(),outcomes:measurementOutcomes}});
    if(path.endsWith('/outcomes')&&method==='POST'){measurementRevision=2;const outcome={id:'outcome-1',plan_id:'measurement-1',space_id:'space',
      after_observation_id:'observation-after',after_value:85,after_sample_size:100,after_period_start:'2026-07-08T00:00:00.000Z',
      after_period_end:'2026-07-15T00:00:00.000Z',after_as_of:now,after_result_sha256:digest,after_source_snapshot_sha256:digest,
      absolute_delta:35,relative_delta:.7,target_distance:5,target_met:true,comparability_code:'same_metric_version_unit_nonoverlapping_periods',
      interpretation:'descriptive_non_causal',causal_claim:false,snapshot_json:{causalClaim:false},snapshot_sha256:digest,plan_revision:2,
      idempotency_key:'outcome-key',intent_sha256:digest,created_by_user_id:'qa-user',created_at:now};measurementOutcomes=[outcome];
      return route.fulfill({status:201,json:{outcome}});}
    return route.fulfill({status:404,json:{error:`Unexpected ${method} ${path}`}});
  });
}

async function mockWorkspaceViews(page: Page) {
  await page.route(/\/api\/journey-workspace-saved-views(?:\/.*)?(?:\?.*)?$/u, async (route) => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    if (url.pathname === '/api/journey-workspace-saved-views' && method === 'GET') return route.fulfill({ json: {
      views: workspaceViews, defaultViewId: null, preferenceRevision: 0
    } });
    if (url.pathname === '/api/journey-workspace-saved-views' && method === 'POST') {
      const body = request.postDataJSON(); const saved = { id: 'blueprint-view-1', surface: 'service_blueprint', audience: body.audience,
        name: body.name, state: 'active', revision: 1, versionId: 'blueprint-view-version-1', versionNumber: 1,
        configuration: body.configuration, configurationSha256: digest, createdAt: now, updatedAt: now };
      workspaceViews = [saved]; return route.fulfill({ status: 201, json: { viewId: saved.id, replayed: false } });
    }
    return route.fulfill({ status: 404, json: { error: `Unexpected saved-view fixture ${method} ${url.pathname}` } });
  });
}

test.beforeEach(() => { lifecycle = 'draft'; sessionRole='admin'; measurementRevision=1;measurementOutcomes=[];lastPortfolioLinks = [];workspaceViews=[]; });

test('service blueprint workspace is usable on desktop and mobile', async ({ page }, testInfo) => {
  await enableFeature(page); await signIn(page);
  await page.route('**/api/journey-maps', (route) => route.fulfill({ json: { journeyMaps: [{ id: 'journey-1', legacyJourneyId: null, name: 'Account opening', purpose: '', experienceType: 'customer', mapType: 'current_state', mode: 'designed', status: 'draft', currentVersionId: 'map-version-1', publishedVersionId: null, revision: 1, stageCount: 2, cardCount: 0, evidenceLinkCount: 0, personaCount: 0, createdAt: now, updatedAt: now }], personas: [], limits: { stages: 20, lanes: 20, cards: 100, cardsPerCell: 20, titleChars: 200, contentChars: 10000 }, catalog: { mapTypes: ['current_state'], experienceTypes: ['customer'], laneTypes: [], cardKinds: [], evidenceSourceTypes: [], evidenceAssessments: [], personaLifecycleStates: [] } } }));
  await page.route(/\/api\/journey-portfolio\/items(?:\?.*)?$/u, (route) => route.fulfill({ json: { items: [{ id: 'pain-1', kind: 'pain_point', title: 'Repeated document requests', description: '', lifecycle: 'validated', ownerUserId: null, ownerTeamId: null, priority: 'high', risk: 'medium', severity: 4, frequency: 'frequent', desiredOutcome: null, hypothesis: null, constraints: [], estimatedEffort: null, estimatedCost: null, expectedOutcome: null, plannedStart: null, plannedEnd: null, actualStart: null, actualEnd: null, dueDate: null, progressPercent: null, reviewCadenceDays: null, reviewState: 'approved', latestReviewId: null, targetMetrics: [], evidenceLinkIds: [], tags: [], state: 'active', revision: 3, createdByUserId: null, updatedByUserId: null, createdAt: now, updatedAt: now, deletedAt: null, retentionExpiresAt: null }], page: { limit: 100, offset: 0, total: 1, hasMore: false } } }));
  await mockBlueprints(page);await mockMeasurements(page);await mockWorkspaceViews(page); await page.goto('/journey-blueprints');
  await expect(page.getByRole('heading', { name: 'Service blueprints' })).toBeVisible();
  await page.getByLabel('Name', { exact: true }).first().fill('Operations analysis');
  await page.getByRole('button', { name: 'Save view' }).click();
  await expect(page.getByTestId('service_blueprint-saved-views')).toContainText('Revision 1 · version 1');
  await expect(page.getByTestId('journey-service-blueprint-table').first()).toContainText('Line of interaction');
  await expect(page.getByTestId('journey-service-blueprint-table').first()).toContainText('Line of visibility');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'JSON' }).click()]);
  expect(download.suggestedFilename()).toBe('journey-service-blueprint-bp-1-v1.json');
  await page.getByRole('tab', { name: 'Portfolio causality' }).click();
  await page.getByLabel('Blueprint element').selectOption('front-1');
  await page.getByLabel('Exact portfolio item').selectOption('pain-1');
  await page.getByRole('button', { name: 'Add pinned link' }).click();
  await expect(page.getByRole('table', { name: 'Pinned service blueprint links to portfolio items' })).toContainText('Repeated document requests');
  await page.getByRole('tab', { name: 'Blueprint' }).click();
  await page.getByRole('button', { name: 'Save new version' }).click();
  await expect.poll(() => lastPortfolioLinks.length).toBe(1);
  await page.getByRole('tab', { name: 'Elements' }).click(); await expect(page.getByRole('table', { name: 'Keyboard-accessible service blueprint element list' })).toContainText('Submit application');
  await page.getByRole('tab', { name: 'Analysis' }).click(); await expect(page.getByRole('heading', { name: 'Coverage' })).toBeVisible(); await expect(page.getByText('Frontstage support is incomplete.')).toBeVisible();
  await page.getByRole('tab',{name:'Measurements'}).click();
  await expect(page.getByRole('table',{name:'Governed blueprint measurement plans'})).toContainText('Completion quality');
  await page.getByTestId('journey-blueprint-measurements').getByRole('button',{name:'View',exact:true}).click();await page.getByLabel('Comparable after observation').selectOption('observation-after');
  await page.getByRole('button',{name:'Record outcome'}).click();await expect(page.getByText('Descriptive comparison only; no causal claim.')).toBeVisible();
  sessionRole='member';await page.reload();await page.getByRole('tab',{name:'Measurements'}).click();
  await expect(page.getByText('You have read-only access to measurement lineage and outcomes.')).toBeVisible();
  await expect(page.getByRole('button',{name:'Pin baseline'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Record outcome'})).toHaveCount(0);
  if (testInfo.project.name.includes('mobile')) { const bodyWidth = await page.locator('body').evaluate((node) => node.scrollWidth); const viewport = page.viewportSize(); expect(bodyWidth).toBeLessThanOrEqual(viewport!.width); }
});
