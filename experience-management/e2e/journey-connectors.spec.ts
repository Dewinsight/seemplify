import { expect, test, type Page, type Route } from '@playwright/test';

const password = 'Playwright-Test-Password-2026!';
const stamp = '2026-08-07T10:00:00.000Z';
const connector = { id: 'connector-orders', kind: 'approved_object_store', name: 'Approved order archive', state: 'active', deletionMode: 'tombstone',
  maximumAttempts: 3, baseRetrySeconds: 10, revision: 1, createdAt: stamp, updatedAt: stamp };
const openRun = { id: 'run-orders', connectorId: connector.id, state: 'open', checkpointRevision: 1, expectedCursor: null, attemptCount: 0,
  retryAt: null, acceptedCount: 0, rejectedCount: 0, tombstoneCount: 0, lastErrorCode: null, createdAt: stamp, updatedAt: stamp };
const completedRun = { ...openRun, state: 'completed', checkpointRevision: 2, acceptedCount: 1, rejectedCount: 1, tombstoneCount: 1 };
const receipts = [
  { id: 'receipt-a', externalIdSha256: 'a'.repeat(64), operation: 'upsert', outcome: 'accepted', code: 'ITEM_ACCEPTED', itemChecksum: '1'.repeat(64), checkpointRevision: 1, createdAt: stamp },
  { id: 'receipt-b', externalIdSha256: 'b'.repeat(64), operation: 'invalid', outcome: 'rejected', code: 'ITEM_CHECKSUM_MISMATCH', itemChecksum: '0'.repeat(64), checkpointRevision: 1, createdAt: stamp },
  { id: 'receipt-c', externalIdSha256: 'c'.repeat(64), operation: 'delete', outcome: 'tombstoned', code: 'ITEM_TOMBSTONED', itemChecksum: '2'.repeat(64), checkpointRevision: 1, createdAt: stamp }
];
const audit = [{ id: 'audit-1', actorUserId: 'qa-user', action: 'import.page_committed', targetType: 'import', targetId: openRun.id,
  detail: { accepted: 1, rejected: 1, tombstones: 1, revision: 2, complete: true }, detailSha256: 'd'.repeat(64), createdAt: stamp }];
function json(route: Route, value: unknown, status = 200) { return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) }); }

async function signIn(page: Page, role: 'manager' | 'member') {
  await page.route('**/api/auth/session', async (route) => { const response = await route.fetch(); const body = await response.json();
    if (body?.authenticated && body.subscription?.features) { body.subscription.features.journeyConnectors = true;
      if (body.activeSpace) body.activeSpace.role = role === 'manager' ? 'owner' : 'member'; }
    await route.fulfill({ response, json: body }); });
  await page.goto('/login'); await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password', { exact: true }).fill(password); await page.getByRole('button', { name: 'Sign in' }).click(); await expect(page).toHaveURL('/');
}

async function installFixtures(page: Page, mode: 'manager' | 'member') {
  let exists = mode === 'member'; let current = { ...connector }; let run = mode === 'member' ? { ...completedRun } : null;
  await page.route(/\/api\/journey-connectors\/(?:.*)$/, async (route) => { const url = new URL(route.request().url());
    const path = url.pathname; const method = route.request().method();
    if (path.endsWith('/connectors') && method === 'GET') return json(route, { connectors: exists ? [current] : [] });
    if (path.endsWith('/connectors') && method === 'POST') { exists = true; current = { ...connector }; return json(route, { connector: current, replayed: false }, 201); }
    if (path.endsWith(`/${connector.id}`) && method === 'PATCH') { current = { ...current, state: current.state === 'active' ? 'disabled' : 'active', revision: current.revision + 1 }; return json(route, { connector: current, replayed: false }); }
    if (path.endsWith('/imports') && method === 'POST') { run = { ...openRun }; return json(route, { run, replayed: false }, 201); }
    if (path.endsWith(`/${openRun.id}`) && method === 'GET') return json(route, { run: run || completedRun });
    if (path.endsWith('/pages') && method === 'POST') { run = { ...completedRun }; return json(route, { run, receipts, replayed: false }); }
    if (path.endsWith('/receipts') && method === 'GET') return json(route, { items: run?.state === 'completed' ? receipts : [], nextCursor: null });
    if (path.endsWith('/audit') && method === 'GET') return json(route, { events: exists ? audit : [] });
    return json(route, { error: `Unhandled connector fixture: ${method} ${path}`, code: 'FIXTURE_UNHANDLED' }, 500);
  });
}

test('owner creates approved staging, imports a partial page and inspects tombstone evidence', async ({ page }) => {
  await installFixtures(page, 'manager'); await signIn(page, 'manager'); await page.goto('/journey-connectors');
  await expect(page.getByRole('heading', { name: 'Journey connectors' })).toBeVisible();
  await expect(page.getByText('No live provider connections or credentials.')).toBeVisible();
  await expect(page.getByText('No approved staging connectors have been created.')).toBeVisible();
  await page.getByLabel('Staging source').selectOption('approved_object_store'); await page.getByLabel('Name').fill('Approved order archive');
  await page.getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Approved order archive' })).toBeVisible();
  await page.getByRole('button', { name: 'Start import' }).click(); await expect(page.getByText('Revision 1', { exact: true })).toBeVisible();
  await page.getByLabel('Staged items (JSON)').fill('[{"externalId":"order-1","operation":"upsert","checksum":"' + '1'.repeat(64) + '","occurredAt":"2026-08-07T10:00:00.000Z","payload":{}}]');
  await page.getByRole('button', { name: 'Submit page' }).click(); await expect(page.getByText('1 accepted · 1 rejected')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Tombstoned', exact: true })).toBeVisible(); await expect(page.getByRole('cell', { name: 'Item Checksum Mismatch', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Retry and deletion policy' }).click(); await expect(page.getByText('Tombstone only')).toBeVisible();
  await page.getByRole('tab', { name: 'Audit history' }).click(); await expect(page.getByText('Import Page Committed')).toBeVisible();
  await page.getByRole('button', { name: 'Disable connector' }).click(); await expect(page.getByRole('button', { name: 'Enable connector' })).toBeVisible();
});

test('member can inspect a known run and receipts but cannot mutate on mobile or desktop', async ({ page }) => {
  await installFixtures(page, 'member'); await signIn(page, 'member'); await page.goto('/journey-connectors');
  await expect(page.getByText(/Read-only: connector creation/)).toBeVisible(); await expect(page.getByLabel('Staging source')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start import' })).toHaveCount(0); await page.getByLabel('Import run ID').fill(openRun.id);
  await page.getByRole('button', { name: 'Load run' }).click(); await expect(page.getByText('1 accepted · 1 rejected')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Tombstoned', exact: true })).toBeVisible(); await page.getByRole('tab', { name: 'Audit history' }).click();
  await expect(page.getByText('Import Page Committed')).toBeVisible(); await expect(page.getByTestId('journey-connectors-workspace')).toBeVisible();
});
