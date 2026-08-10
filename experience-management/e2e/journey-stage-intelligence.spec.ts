import { expect, test, type Page, type Route } from '@playwright/test';

const password = 'Playwright-Test-Password-2026!';
const stamp = '2026-08-07T10:00:00.000Z';
const window = { from: '2026-07-08T00:00:00.000Z', to: '2026-08-07T23:59:59.999Z', asOf: stamp };
const policy = { revision: 1, minimumSampleSize: 5,
  dimensions: ['persona','segment','cohort','channel'], maximumRows: 500 };
const shares = { negative: 10, neutral: 20, positive: 70, mixed: 0, unknown: 0 };
const emotions = { anger: 0, anxiety: 0, confusion: 0, delight: 60, disappointment: 0,
  frustration: 10, relief: 0, sadness: 0, trust: 30, unknown: 0 };
const result = { schemaVersion: 'journey-stage-intelligence/v1', purpose: 'analytics', window,
  minimumSampleSize: 5, exclusions: { total: null, suppressed: true }, fingerprint: 'c'.repeat(64), rows: [{
    stageId: 'discover', dimension: 'persona', dimensionId: 'buyer', metricDefinitionId: 'nps',
    metricDefinitionVersionId: 'nps-v3', metricDefinitionVersionSha256: 'a'.repeat(64), metricName: 'NPS',
    metricUnit: 'score', window, calculationVersion: 'journey-stage-comparison/v1', sampleSize: 24, value: 48,
    sentiment: shares, emotions, suppression: { suppressed: false, kind: null, reason: null, minimumSampleSize: 5 },
    lineage: [{ sourceType: 'survey', sourceIdSha256: 'b'.repeat(64), sourceVersion: '3',
      schemaVersion: 'survey/v1', projectionVersion: 'metric/v3' }], lineageTruncated: false
  }, {
    stageId: 'purchase', dimension: 'persona', dimensionId: 'new-customer', metricDefinitionId: 'nps',
    metricDefinitionVersionId: 'nps-v3', metricDefinitionVersionSha256: 'a'.repeat(64), metricName: 'NPS',
    metricUnit: 'score', window, calculationVersion: 'journey-stage-comparison/v1', sampleSize: null, value: null,
    sentiment: Object.fromEntries(Object.keys(shares).map((key) => [key, null])),
    emotions: Object.fromEntries(Object.keys(emotions).map((key) => [key, null])),
    suppression: { suppressed: true, kind: 'primary', reason: 'BELOW_MINIMUM_SAMPLE', minimumSampleSize: 5 },
    lineage: [], lineageTruncated: false
  }] };
const trend = { schemaVersion: 'journey-stage-trends/v1', purpose: 'analytics', window, bucketDays: 7,
  minimumSampleSize: 5, fingerprint: 'f'.repeat(64), buckets: [{ from: window.from, to: window.to,
    fingerprint: '1'.repeat(64), exclusions: { total: null, suppressed: true }, rows: result.rows }] };

function json(route: Route, value: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
}

async function fixtures(page: Page, role: 'owner' | 'member') {
  await page.route('**/api/auth/session', async (route) => {
    const response = await route.fetch(); const body = await response.json();
    if (body?.authenticated && body.activeSpace) body.activeSpace.role = role;
    await route.fulfill({ response, json: body });
  });
  await page.route('**/api/journey-maps', (route) => json(route, { journeyMaps: [{ id: 'journey-one',
    name: 'Checkout journey' }], personas: [], rollout: { enabled: true } }));
  await page.route('**/api/journey-stage-intelligence/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/policy')) return json(route, { policy });
    if (path.endsWith('/comparisons')) return json(route, result);
    if (path.endsWith('/trends')) return json(route, trend);
    return json(route, { error: `Unhandled stage intelligence fixture: ${path}` }, 500);
  });
  await page.route('**/api/journey-event-intelligence/mappings**', (route) => json(route, { mappings: [{
    id: '11111111-2222-4333-8444-555555555555', source_id: 'checkout-sdk', environment: 'production',
    event_name: 'checkout_completed', state: 'active', revision: 2, version_number: 2, schema_version_id: 'checkout-schema-v3',
    journey_definition_id: 'journey-one', journey_map_version_id: 'journey-map-v4', stage_key: 'purchase',
    stage_rule_version_id: 'purchase-rule-v2', metric_definition_id: 'checkout-completion', metric_definition_version_id: 'checkout-completion-v1',
    metric_definition_version_sha256: 'd'.repeat(64), metric_unit: 'count', value_mode: 'count', constant_value: null,
    numeric_property_path: null, dimension_keys_json: ['channel','environment'], consent_requirement: 'granted_or_not_required',
    purpose: 'analytics', retention_days: 30, projection_version: 'journey-event-stage/v1', content_sha256: 'e'.repeat(64)
  }] }));
}

async function signIn(page: Page) {
  await page.goto('/login'); await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click(); await expect(page).toHaveURL('/');
}

test('manager compares governed stage cohorts and configures privacy on desktop', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop manager coverage.');
  await fixtures(page, 'owner'); await signIn(page); await page.goto('/journey-stage-intelligence');
  await expect(page.getByRole('heading', { name: 'Journey stage intelligence' })).toBeVisible();
  await expect(page.getByTestId('journey-stage-intelligence-page').locator(':scope > label select')).toHaveValue('journey-one');
  await expect(page.getByTestId('journey-stage-comparison-table')).toBeVisible();
  await expect(page.getByTestId('journey-stage-trend-table')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sentiment and emotion trends' })).toBeVisible();
  await expect(page.getByText('Positive 70% · Negative 10%')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Privacy policy' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Suppressed' }).first()).toBeVisible();
  await expect(page.getByTestId('journey-event-mappings')).toBeVisible();
  await expect(page.getByText('checkout_completed')).toBeVisible();
  await page.getByRole('button', { name: 'New version' }).click();
  await expect(page.getByRole('heading', { name: 'Append mapping version' })).toBeVisible();
});

test('member receives mobile-safe comparisons without policy mutations', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'Mobile member coverage.');
  await page.setViewportSize({ width: 390, height: 844 }); await fixtures(page, 'member'); await signIn(page);
  await page.goto('/journey-stage-intelligence');
  await expect(page.getByTestId('journey-stage-intelligence-page')).toBeVisible();
  await expect(page.getByTestId('journey-stage-comparison-table')).toBeVisible();
  await expect(page.getByTestId('journey-stage-trend-table')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Privacy policy' })).toHaveCount(0);
  await expect(page.getByText('checkout_completed')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Add event mapping' })).toHaveCount(0);
  await expect(page.getByText(/suppression hide values, samples, sentiment, and emotions/i)).toBeVisible();
});
