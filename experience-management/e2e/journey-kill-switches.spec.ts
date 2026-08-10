import { expect, test, type Page, type Route } from '@playwright/test';

const password = 'Playwright-Test-Password-2026!';
const stamp = '2026-08-07T10:00:00.000Z';
const levels = ['platform','space','workflow','adapter','profile'] as const;
const levelSummary = () => levels.map((level) => ({ level, decision: 'allow', state: 'enabled',
  reasonCode: 'KILL_SWITCH_DEFAULT_ENABLED', source: 'default' }));
const effective = () => ({ decision: 'allow', blockedLevel: null, reasonCode: 'KILL_SWITCH_ALL_LEVELS_ENABLED',
  levels: levelSummary() });
const state = (scopeLevel: typeof levels[number], scopeKey: string, value: 'enabled' | 'disabled', revision = 1) => ({
  scopeLevel, spaceId: scopeLevel === 'platform' ? null : 'qa-space', scopeKey, state: value,
  reasonCode: value === 'enabled' ? 'recovery_verified' : 'operational_incident', revision,
  gateKey: `${scopeLevel}_kill_switch`, updatedAt: stamp
});
function json(route: Route, value: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
}

async function signIn(page: Page, role: 'manager' | 'member') {
  await page.route('**/api/auth/session', async (route) => { const response = await route.fetch(); const body = await response.json();
    if (body?.authenticated && body.activeSpace) { body.activeSpace.role = role === 'manager' ? 'owner' : 'member';
      body.permissions = { ...(body.permissions || {}), platformAdmin: role === 'manager' }; }
    await route.fulfill({ response, json: body }); });
  await page.goto('/login'); await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click(); await expect(page).toHaveURL('/');
}

async function fixtures(page: Page, role: 'manager' | 'member') {
  let space = role === 'member' ? state('space', 'qa-space', 'disabled') : null;
  let platform = null as ReturnType<typeof state> | null; let scopes: ReturnType<typeof state>[] = space ? [space] : [];
  const pauses = [{ id: 'pause-1', queueId: 'queue-1', previousState: 'leased', leaseReleased: true,
    fencingToken: 4, reasonCode: 'space_kill_switch', createdAt: stamp, resumption: null }];
  await page.route('**/api/journey-kill-switches**', async (route) => {
    const url = new URL(route.request().url()); const method = route.request().method(); const path = url.pathname;
    if (path.endsWith('/platform') && method === 'GET') return json(route, { switch: platform, effective: effective() });
    if (path.endsWith('/platform') && method === 'PUT') { platform = state('platform','platform','disabled');
      return json(route, { switch: platform, replayed: false, changed: true, mutationId: 'mutation-platform',
        idempotencyKey: 'fixture-platform', pausedCount: 0, releasedLeaseCount: 0, resumedCount: 0,
        stillDisabledCount: 0, createdAt: stamp }); }
    if (path.endsWith('/pauses')) return json(route, { pauses });
    if (path.endsWith('/audit')) return json(route, { events: [{ id: 'audit-1', authority: 'space_manager',
      action: 'kill_switch.disabled', scopeLevel: 'space', scopeKey: 'qa-space', detail: { pausedCount: 1 },
      detailSha256: 'a'.repeat(64), createdAt: stamp }] });
    if (path.endsWith('/space') && method === 'PUT') { space = state('space','qa-space','disabled');
      scopes = [space, ...scopes.filter((item) => item.scopeLevel !== 'space')];
      return json(route, { switch: space, replayed: false, changed: true, mutationId: 'mutation-space',
        idempotencyKey: 'fixture-space', pausedCount: 1, releasedLeaseCount: 1, resumedCount: 0,
        stillDisabledCount: 0, createdAt: stamp }); }
    if (path.includes('/scopes/') && method === 'PUT') { const [, level, key] = path.match(/\/scopes\/([^/]+)\/([^/]+)$/u) || [];
      const record = state(level as typeof levels[number], decodeURIComponent(key), 'disabled'); scopes.push(record);
      return json(route, { switch: record, replayed: false, changed: true, mutationId: 'mutation-scope',
        idempotencyKey: 'fixture-scope', pausedCount: 1, releasedLeaseCount: 0, resumedCount: 0,
        stillDisabledCount: 0, createdAt: stamp }); }
    if (path === '/api/journey-kill-switches' && method === 'GET') return json(route, { platform, scopes, effective: effective() });
    return json(route, { error: `Unhandled kill-switch fixture: ${method} ${path}` }, 500);
  });
}

test('platform administrator pauses space and workflow scopes on desktop', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop operator coverage.');
  await fixtures(page, 'manager'); await signIn(page, 'manager'); await page.goto('/journey-safety');
  await expect(page.getByRole('heading', { name: 'Journey safety switches' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Platform switch' })).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept()); await page.getByRole('button', { name: 'Disable space' }).click();
  await expect(page.getByRole('button', { name: 'Enable space' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Scope' }).fill('workflow-checkout'); page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Disable scope' }).click();
  await expect(page.getByText('workflow-checkout')).toBeVisible();
  await expect(page.getByText('Lease released')).toBeVisible();
});

test('member sees read-only evidence on a mobile viewport', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'Mobile read-only coverage.');
  await page.setViewportSize({ width: 390, height: 844 }); await fixtures(page, 'member'); await signIn(page, 'member');
  await page.goto('/journey-safety'); await expect(page.getByTestId('journey-kill-switch-workspace')).toBeVisible();
  await expect(page.getByText(/Read-only: only space owners/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Disable scope' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Platform switch' })).toHaveCount(0);
  await expect(page.getByText('Lease released')).toBeVisible();
});
