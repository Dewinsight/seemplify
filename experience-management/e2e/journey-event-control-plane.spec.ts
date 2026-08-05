import { expect, test, type Page, type Route } from '@playwright/test';

const password = 'Playwright-Test-Password-2026!';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();
}

const source = {
  id: 'src-checkout-web', spaceId: 'space-fixture', name: 'Checkout web', environment: 'production', status: 'active',
  validationMode: 'enforce', allowedOrigins: ['https://shop.example.test'], allowedBundleIds: [],
  eventsPerMinute: 5000, bytesPerMinute: 10_000_000, credentialCount: 1, activeSchemaCount: 1,
  revision: 1, createdByUserId: 'user-1',
  createdAt: '2026-08-01T10:00:00.000Z', updatedAt: '2026-08-04T09:30:00.000Z'
};

const credential = {
  id: 'credential-1', sourceId: source.id, kind: 'public_write', displayPrefix: 'jpk_live.checkout1',
  status: 'active', scope: 'events:write', createdAt: '2026-08-01T10:10:00.000Z', expiresAt: null,
  revokedAt: null, rotatedFromId: null
};

const schema = {
  id: 'schema-checkout-completed', sourceId: source.id, spaceId: source.spaceId, eventName: 'checkout_completed',
  createdByUserId: 'user-1', createdAt: '2026-08-03T09:00:00.000Z', updatedAt: '2026-08-03T11:00:00.000Z',
  versions: [{
    id: 'schema-version-1', schemaId: 'schema-checkout-completed', sourceId: source.id, spaceId: source.spaceId,
    version: '1.0', state: 'published',
    properties: [{ name: 'order_value', type: 'number', required: true, dataClass: 'operational', description: 'Order total after discounts.' }],
    compatibility: { compatible: true, issues: [] }, contentSha256: 'a'.repeat(64),
    createdByUserId: 'user-1', publishedByUserId: 'user-1', deprecatedByUserId: null,
    createdAt: '2026-08-03T10:00:00.000Z', publishedAt: '2026-08-03T11:00:00.000Z', deprecatedAt: null
  }]
};

const debugEvent = {
  receiptId: 'receipt-safe-001', receivedAt: '2026-08-04T09:45:00.000Z', eventId: 'event-public-001',
  outcome: 'quarantined', call: 'batch', eventName: 'checkout_completed', version: 1,
  schemaVersionId: 'schema-version-1', code: 'EVENT_SCHEMA_QUARANTINED', requestId: 'request-safe-001',
  batchId: 'batch-safe-001', payloadBytes: 768, sdkName: '@seemplify/journey-browser', sdkVersion: '1.0.0',
  issues: [{ code: 'UNKNOWN_PROPERTY', path: '$.properties.legacy_field' }], processingState: null,
  identityId: 'PRIVATE-IDENTITY-MUST-NOT-RENDER',
  payload: { password: 'PRIVATE-PAYLOAD-MUST-NOT-RENDER' },
  context: { authorization: 'PRIVATE-CONTEXT-MUST-NOT-RENDER' },
  envelopeSha256: 'PRIVATE-HASH-MUST-NOT-RENDER'
};

const deadLetter = {
  id: 'dead-letter-001', failedAt: '2026-08-04T09:50:00.000Z',
  eventId: 'event-public-002', eventName: 'checkout_completed', processor: 'journey-stage-router', state: 'pending',
  failure: { code: 'PROCESSOR_TIMEOUT', message: 'The stage router exceeded its bounded processing window.' },
  attempts: 2, replayEligible: true, replayIneligibleReason: null,
  rawPayload: 'PRIVATE-DEAD-LETTER-PAYLOAD-MUST-NOT-RENDER', credentialSecret: 'PRIVATE-SECRET-MUST-NOT-RENDER'
};

async function enableFeature(page: Page, role: 'owner' | 'member' = 'owner', enabled = true) {
  await page.route('**/api/auth/session', async (route) => {
    const response = await route.fetch();
    const session = await response.json();
    if (session.authenticated) {
      session.activeSpace = { ...session.activeSpace, role };
      session.subscription = {
        ...(session.subscription || { planCode: 'enterprise', planName: 'Enterprise', limits: {}, status: 'active', source: 'managed_fallback' }),
        features: { ...(session.subscription?.features || {}), journeyConnected: enabled }
      };
    }
    await route.fulfill({ response, json: session });
  });
}

async function fixtureControlPlane(page: Page, onMutation?: (route: Route) => void) {
  await page.route('**/api/journey-event-control-plane/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/journey-event-control-plane', '');
    const method = request.method();
    if (method !== 'GET') onMutation?.(route);
    if (method === 'GET' && path === '/sources') return route.fulfill({ json: { sources: [source], quota: { used: 1, limit: 5, remaining: 4 } } });
    if (method === 'GET' && path === `/sources/${source.id}/credentials`) return route.fulfill({ json: { credentials: [credential] } });
    if (method === 'POST' && path === `/sources/${source.id}/credentials`) return route.fulfill({ json: { secret: 'jpk_live.checkout2.secret-only-once', credential: { ...credential, id: 'credential-2', displayPrefix: 'jpk_live.checkout2' }, replayed: false } });
    if (method === 'GET' && path === `/sources/${source.id}/schemas`) return route.fulfill({ json: { schemas: [schema] } });
    if (method === 'GET' && path === `/schemas/${schema.id}`) return route.fulfill({ json: { schema } });
    if (method === 'GET' && path === `/sources/${source.id}/audit`) return route.fulfill({ json: { events: [{ id: 'audit-1', spaceId: source.spaceId, sourceId: source.id, actorUserId: 'user-1', action: 'credential.issued', targetType: 'credential', targetKind: 'credential', targetId: 'credential-1', actor: { id: 'user-1', name: 'QA Admin' }, summary: 'Created public write credential jpk_live.checkout1. Secret redacted.', detail: {}, beforeFingerprint: null, afterFingerprint: 'b'.repeat(64), createdAt: '2026-08-01T10:10:00.000Z' }], nextCursor: null } });
    if (method === 'GET' && path === `/sources/${source.id}/debug-events`) return route.fulfill({ json: { events: [debugEvent], nextCursor: null } });
    if (method === 'GET' && path === `/sources/${source.id}/dead-letters`) return route.fulfill({ json: { deadLetters: [deadLetter], nextCursor: null } });
    if (method === 'POST' && path === `/dead-letters/${deadLetter.id}/replay`) return route.fulfill({ json: { deadLetter: { ...deadLetter, state: 'replay_scheduled', replayEligible: false, replayIneligibleReason: 'already_scheduled' }, replayed: false } });
    if (method === 'GET' && path === `/sources/${source.id}/ingestion-usage`) return route.fulfill({ json: { monthlyTrackedEvents: { quota: 'monthlyTrackedEvents', kind: 'metered', periodStart: '2026-08-01T00:00:00.000Z', periodEnd: '2026-09-01T00:00:00.000Z', resetAt: '2026-09-01T00:00:00.000Z', used: 742, limit: 1000, remaining: 258, percentUsed: 74.2, projectedPeriodEnd: 810, warningLevel: 'approaching' } } });
    return route.fulfill({ status: 404, json: { error: `${method} ${path} is not part of this fixture` } });
  });
  await page.route('**/api/journey-event-control-plane/sources', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') return route.fulfill({ json: { sources: [source], quota: { used: 1, limit: 5, remaining: 4 } } });
    onMutation?.(route);
    return route.fulfill({ status: 404, json: { error: 'Source creation is not exercised here.' } });
  });
}

test('event-source workspace drives the real governed source, credential, schema, and audit routes', async ({ page }) => {
  let credentialCreateHeader = '';
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/api\/journey-event-control-plane\/sources\/[^/]+\/credentials$/u.test(new URL(request.url()).pathname)) {
      credentialCreateHeader = request.headers()['idempotency-key'] || '';
    }
  });
  await signIn(page);
  await page.goto('/settings/developer');
  await expect(page.getByRole('heading', { name: 'Event sources' })).toBeVisible();

  const sourceName = `Checkout web ${Date.now()}`;
  await page.getByRole('button', { name: 'Create source' }).first().click();
  const sourceDialog = page.getByRole('dialog', { name: 'Create event source' });
  await sourceDialog.getByLabel('Source name').fill(sourceName);
  await sourceDialog.getByRole('button', { name: 'Create source' }).click();
  await expect(page.getByRole('heading', { name: sourceName })).toBeVisible();
  await expect(page.getByText('development · observe validation')).toBeVisible();

  const revisedName = `${sourceName} revised`;
  await page.getByLabel('Source name').fill(revisedName);
  await page.getByRole('button', { name: 'Save policy' }).click();
  await expect(page.getByText('Source settings saved.')).toBeVisible();
  await expect(page.getByRole('heading', { name: revisedName })).toBeVisible();

  await page.getByRole('tab', { name: 'Credentials' }).click();
  await page.getByRole('button', { name: 'Create credential' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Create credential' }).click();
  const secretDialog = page.getByRole('dialog', { name: 'Save this credential now' });
  await expect(secretDialog.getByLabel('New credential')).toHaveValue(/^jpk_dev\.[^.]+\.[A-Za-z0-9_-]+$/u);
  await expect(secretDialog.getByRole('button', { name: 'Dismiss secret' })).toBeDisabled();
  await secretDialog.getByRole('checkbox').check();
  await secretDialog.getByRole('button', { name: 'Dismiss secret' }).click();
  expect(credentialCreateHeader).toMatch(/^journey-credential-create-[a-z0-9-]+$/u);
  expect(credentialCreateHeader.length).toBeLessThanOrEqual(96);

  await page.getByRole('tab', { name: 'Tracking plan' }).click();
  await page.getByRole('button', { name: 'Add event' }).click();
  const schemaDialog = page.getByRole('dialog', { name: 'Add tracked event' });
  await schemaDialog.getByLabel('Event name').fill(`checkout_completed_${Date.now()}`);
  await schemaDialog.getByRole('button', { name: 'Add event and draft' }).click();
  await expect(page.getByText('Compatible with the preceding version')).toBeVisible();
  await page.getByRole('button', { name: 'Publish' }).click();
  await page.getByRole('dialog', { name: 'Publish version 1.0?' }).getByRole('button', { name: 'Publish version' }).click();
  await expect(page.getByText('published', { exact: true }).first()).toBeVisible();

  await page.getByRole('tab', { name: 'Audit' }).click();
  await expect(page.locator('td:visible, p:visible').filter({ hasText: /Published .* version 1\.0\./u }).first()).toBeVisible();
  await expect(page.locator('td:visible, p:visible').filter({ hasText: /Public write credential .* was issued\./u }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('ingestion operations are redacted, responsive, and replay only after confirmation', async ({ page }) => {
  let replayBody: unknown = null;
  const debuggerRequests: string[] = [];
  await enableFeature(page, 'owner', true);
  await fixtureControlPlane(page, (route) => {
    if (route.request().method() === 'POST' && new URL(route.request().url()).pathname.endsWith(`/dead-letters/${deadLetter.id}/replay`)) {
      replayBody = route.request().postDataJSON();
    }
  });
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith(`/sources/${source.id}/debug-events`)) debuggerRequests.push(request.url());
  });
  await signIn(page);
  await page.goto('/settings/developer');

  await page.getByRole('tab', { name: 'Debugger' }).click();
  await expect(page.getByText('Privacy-safe metadata only.')).toBeVisible();
  await expect(page.locator('p:visible').filter({ hasText: /^checkout_completed$/u })).toBeVisible();
  await expect(page.locator('code:visible').filter({ hasText: /^EVENT_SCHEMA_QUARANTINED$/u })).toBeVisible();
  await expect(page.getByLabel('Auto-refresh')).toHaveValue('0');
  for (const forbidden of ['PRIVATE-IDENTITY-MUST-NOT-RENDER', 'PRIVATE-PAYLOAD-MUST-NOT-RENDER', 'PRIVATE-CONTEXT-MUST-NOT-RENDER', 'PRIVATE-HASH-MUST-NOT-RENDER']) {
    await expect(page.getByText(forbidden, { exact: false })).toHaveCount(0);
  }
  await page.getByLabel('Outcome').selectOption('quarantined');
  await expect.poll(() => debuggerRequests.some((url) => new URL(url).searchParams.get('outcome') === 'quarantined')).toBe(true);
  await expect(page.locator(`button:visible[aria-label="Copy receipt ${debugEvent.receiptId}"]`)).toBeVisible();

  await page.getByRole('tab', { name: 'Dead letters' }).click();
  await expect(page.locator('code:visible').filter({ hasText: /^PROCESSOR_TIMEOUT$/u })).toBeVisible();
  for (const forbidden of ['PRIVATE-DEAD-LETTER-PAYLOAD-MUST-NOT-RENDER', 'PRIVATE-SECRET-MUST-NOT-RENDER']) {
    await expect(page.getByText(forbidden, { exact: false })).toHaveCount(0);
  }
  await page.locator('button:visible').filter({ hasText: /^Replay$/u }).click();
  const confirmation = page.getByRole('dialog', { name: 'Replay this dead letter?' });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Replay dead letter' }).click();
  await expect.poll(() => replayBody).toEqual({ confirmation: true });

  await page.getByRole('tab', { name: 'Usage' }).click();
  await expect(page.getByText('742', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('1,000', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('258', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('No per-source allocation or estimated breakdown is shown.')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('viewer access is read-only and a disabled plan makes no control-plane request', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Permission and plan gating need one browser project.');
  await enableFeature(page, 'member', true);
  await fixtureControlPlane(page);
  await signIn(page);
  await page.goto('/settings/developer');
  await expect(page.getByText(/You have viewer access/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create source' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Credentials' }).click();
  await expect(page.getByRole('button', { name: 'Create credential' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Dead letters' }).click();
  await expect(page.getByRole('button', { name: 'Replay', exact: true })).toHaveCount(0);

  await page.unrouteAll({ behavior: 'wait' });
  let controlPlaneRequests = 0;
  await enableFeature(page, 'member', false);
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/journey-event-control-plane')) controlPlaneRequests += 1;
  });
  await page.goto('/settings/developer');
  await expect(page).toHaveURL('/');
  expect(controlPlaneRequests).toBe(0);
});
