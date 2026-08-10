import { expect, test, type Page, type Route } from '@playwright/test';

const password = 'Playwright-Test-Password-2026!';
const settings = { enabled: true, commentsEnabled: true, sharingEnabled: true, externalDownloadsEnabled: false,
  commentRetentionDays: 365, viewRetentionDays: 90, maximumShareDays: 30, securityReviewReference: 'SEC-204',
  securityReviewedAt: '2026-08-01T09:00:00.000Z', revision: 2, updatedAt: '2026-08-01T09:00:00.000Z' };
const limits = { commentCharacters: 8000, commentBodyBytes: 65536, mentionsPerComment: 50, threadReplies: 500,
  viewNameCharacters: 160, viewConfigurationBytes: 65536, viewFilterValues: 100, shareSnapshotBytes: 1048576,
  shareTokenBytes: 32, shareRequestsPerMinute: 60, pageSize: 100, commentRetentionDays: { minimum: 1, maximum: 3650 },
  viewRetentionDays: { minimum: 1, maximum: 3650 }, maximumShareDays: { minimum: 1, maximum: 365 } };
const target = { targetType: 'journey_map', targetId: 'journey-checkout', title: 'Checkout recovery', revision: 7,
  checksum: '9b4619e7c4d63a8fa22a69d54baca5e33d746f2142b1a97d7b33976797c104b2', journeyDefinitionId: 'journey-checkout' };
const plan = { enabledByPlan: true, limits: { collaborators: 25, shares: 50, views: 100 }, settings, readOnly: false };

function json(route: Route, value: unknown, status = 200) { return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) }); }

async function signIn(page: Page, role: 'manager' | 'member') {
  await page.route('**/api/auth/session', async (route) => {
    const response = await route.fetch(); const body = await response.json();
    if (body?.authenticated && body.subscription?.features) {
      body.subscription.features.journeyCollaboration = true;
      body.subscription.features.journeyPortfolio = true;
      if (body.activeSpace) body.activeSpace.role = role === 'manager' ? 'owner' : 'member';
    }
    await route.fulfill({ response, json: body });
  });
  await page.goto('/login');
  await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/');
}

async function installFixtures(page: Page, mode: 'manager' | 'member') {
  let comments: unknown[] = [];
  let token = 'A'.repeat(43);
  let share: Record<string, unknown> | null = null;
  const snapshot = { schemaVersion: 2, title: 'Checkout recovery', targetType: 'journey_map', targetRevision: 7,
    capturedAt: '2026-08-07T10:00:00.000Z', content: { kind: 'journey_map',
      definition: { name: 'Checkout recovery', mode: 'evidence_backed', status: 'published' },
      version: { versionNumber: 7, state: 'published', mapType: 'current_state', experienceType: 'customer', objective: 'Recover checkout' },
      stages: [{ stageKey: 'recover', name: 'Recover', goal: 'Complete purchase', ordinal: 0 }],
      cards: [{ stageKey: 'recover', laneType: 'customer_actions', kind: 'action', title: 'Retry payment', content: '', ordinal: 0 }],
      lanes: [], personas: [] } };
  await page.route(/\/api\/journey-maps(?:\?.*)?$/, (route) => json(route, { journeyMaps: [{ id: 'journey-checkout', name: 'Checkout recovery', state: 'draft' }], personas: [{ id: 'persona-buyer', name: 'Returning buyer' }], limits: {}, catalog: {} }));
  await page.route(/\/api\/journey-portfolio\/items(?:\?.*)?$/, (route) => json(route, { items: [{ id: 'initiative-recovery', title: 'Reduce checkout recovery time', state: 'active' }], page: { limit: 100, offset: 0, total: 1, hasMore: false } }));
  await page.route(/\/api\/public\/journey-shares\/([^/?]+)(?:\?.*)?$/, (route) => {
    const requested = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1) || '');
    if (!share || share.state !== 'active' || requested !== token) return json(route,
      { error: 'This Journey share is unavailable.', code: 'JOURNEY_SHARE_UNAVAILABLE' }, 404);
    return json(route, { share: { targetType: 'journey_map', targetRevision: 7, permission: 'view',
      allowExport: false, allowDownload: false, state: 'active', expiresAt: share.expiresAt }, snapshot });
  });
  await page.route(/\/api\/journey-collaboration\/(?:.*)$/, async (route) => {
    const url = new URL(route.request().url()); const path = url.pathname; const method = route.request().method();
    const capabilities = mode === 'manager' ? ['journeys.read', 'journeys.comment', 'journeys.watch', 'journeys.view_activity', 'journeys.manage_portfolio', 'journeys.request_review', 'journeys.edit', 'journeys.manage_views', 'journeys.export', 'journeys.review', 'journeys.publish', 'journeys.manage_roles', 'journeys.manage_shares'] : ['journeys.read', 'journeys.view_activity'];
    if (path.endsWith('/context')) return json(route, { role: mode === 'manager' ? 'manager' : 'viewer', roleSource: 'space_membership', readOnly: mode === 'member', capabilities, target, plan: { ...plan, readOnly: mode === 'member' }, limits });
    if (path.endsWith('/comments') && method === 'GET') return json(route, { items: comments, nextCursor: null, plan });
    if (path.endsWith('/comments') && method === 'POST') {
      const item = { id: 'comment-1', targetType: 'journey_map', targetId: target.targetId, journeyDefinitionId: target.targetId,
        parentCommentId: null, rootCommentId: 'comment-1', author: { id: 'qa-user', name: 'QA Owner' }, state: 'active', revision: 1,
        body: { type: 'doc' }, plainText: 'Check recovery evidence before approval.', mentions: [], createdAt: '2026-08-07T10:00:00.000Z',
        editedAt: null, resolvedAt: null, resolvedByUserId: null, deletedAt: null };
      comments = [item]; return json(route, { comment: item, replayed: false }, 201);
    }
    if (path.endsWith('/watchers')) return json(route, { items: [], nextCursor: null });
    if (path.endsWith('/notifications')) return json(route, { items: [{ id: 'notice-1', kind: 'governance_requested', targetType: 'journey_map', targetId: target.targetId, actor: { id: 'reviewer', name: 'Alex Reviewer' }, commentId: null, reviewId: 'review-1', state: 'unread', revision: 1, createdAt: '2026-08-07T09:00:00.000Z', readAt: null }], nextCursor: null });
    if (path.endsWith('/governance/reviews')) return json(route, { items: [{ id: 'review-1', targetType: 'journey_map', targetId: target.targetId, journeyDefinitionId: target.targetId, targetRevision: 7, targetChecksum: target.checksum, state: 'pending', revision: 1, requestedByUserId: 'requester', requestSummary: 'Validate checkout recovery evidence.', requestedAt: '2026-08-07T09:00:00.000Z', dueAt: null, decidedByUserId: null, decisionSummary: null, decidedAt: null, publishedByUserId: null, publishedAt: null }], nextCursor: null });
    if (path.endsWith('/activity')) return json(route, { items: [{ id: 'activity-1', action: 'governance.requested', targetType: 'journey_map', targetId: target.targetId, journeyDefinitionId: target.targetId, actor: { id: 'requester', name: 'Jordan Requester' }, commentId: null, reviewId: 'review-1', detail: {}, createdAt: '2026-08-07T09:00:00.000Z' }], nextCursor: null });
    if (path.endsWith('/shares') && method === 'GET') return json(route, { items: share ? [share] : [],
      page: { limit: 100, offset: 0, total: share ? 1 : 0, hasMore: false }, plan });
    if (path.endsWith('/shares') && method === 'POST') {
      const body = route.request().postDataJSON();
      share = { id: 'share-checkout', targetType: 'journey_map', targetId: target.targetId, targetRevision: 7,
        tokenPrefix: token.slice(0, 12), permission: 'view', allowExport: body.allowExport,
        allowDownload: body.allowDownload, checksum: '7'.repeat(64), state: 'active', revision: 1,
        createdAt: '2026-08-07T10:00:00.000Z', expiresAt: body.expiresAt, rotatedAt: null, revokedAt: null };
      return json(route, { share, token, url: `${url.origin}/journey-share/${token}`, replayed: false }, 201);
    }
    if (path.endsWith('/shares/share-checkout/rotate') && method === 'POST' && share) {
      token = 'B'.repeat(43); share = { ...share, tokenPrefix: token.slice(0, 12), revision: 2,
        rotatedAt: '2026-08-07T11:00:00.000Z' };
      return json(route, { share, token, url: `${url.origin}/journey-share/${token}`, replayed: false });
    }
    if (path.endsWith('/shares/share-checkout/revoke') && method === 'POST' && share) {
      share = { ...share, state: 'revoked', revision: 3, revokedAt: '2026-08-07T12:00:00.000Z' };
      return json(route, { share, replayed: false });
    }
    if (path.endsWith('/roles')) return json(route, { items: [], nextCursor: null });
    if (path.endsWith('/settings')) return json(route, { settings, plan });
    return json(route, { error: 'Unhandled collaboration fixture', code: 'FIXTURE_UNHANDLED' }, 500);
  });
}

test('manager can discuss a discovered target and inspect exact governance evidence', async ({ page }) => {
  await installFixtures(page, 'manager'); await signIn(page, 'manager'); await page.goto('/journey-collaboration');
  await expect(page.getByRole('heading', { name: 'Journey collaboration' })).toBeVisible();
  await expect(page.getByLabel('Working target')).toHaveValue('journey_map:journey-checkout');
  await expect(page.getByText(/Revision 7/)).toBeVisible();
  await page.getByLabel('Comment').fill('Check recovery evidence before approval.');
  await page.getByRole('button', { name: 'Post comment' }).click();
  await expect(page.getByText('Check recovery evidence before approval.')).toBeVisible();
  await page.getByRole('tab', { name: 'Governance' }).click();
  await expect(page.getByRole('cell', { name: /Revision 7/ })).toBeVisible();
  await expect(page.getByTitle(target.checksum)).toBeVisible();
  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(page.getByText('governance.requested')).toBeVisible();
  await expect(page.getByText('Check recovery evidence before approval.')).toHaveCount(0);
});

test('member read-only state remains useful on narrow and wide screens', async ({ page }) => {
  await installFixtures(page, 'member'); await signIn(page, 'member'); await page.goto('/journey-collaboration');
  await expect(page.getByText('Read-only: collaboration writes are disabled')).toBeVisible();
  await expect(page.getByLabel('Comment')).toBeDisabled();
  await expect(page.getByRole('tab', { name: 'Access' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Read-only links' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Settings' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(page.getByText('governance.requested')).toBeVisible();
  await expect(page.getByTestId('journey-collaboration-workspace')).toBeVisible();
});

test('manager public links rotate and revoke without exposing a management identifier', async ({ page }) => {
  await installFixtures(page, 'manager'); await signIn(page, 'manager'); await page.goto('/journey-collaboration');
  await page.getByRole('tab', { name: 'Read-only links' }).click();
  await page.getByRole('button', { name: 'Create link' }).click();
  const link = page.getByLabel('New link');
  await expect(link).toHaveValue(/\/journey-share\/A{43}$/u);
  const firstPath = new URL(await link.inputValue()).pathname;
  await page.goto(firstPath);
  await expect(page.getByTestId('public-journey-share')).toContainText('Checkout recovery');
  await expect(page.getByTestId('public-journey-share')).not.toContainText('share-checkout');

  await page.goto('/journey-collaboration');
  await page.getByRole('tab', { name: 'Read-only links' }).click();
  await page.getByRole('button', { name: 'Rotate' }).click();
  await expect(link).toHaveValue(/\/journey-share\/B{43}$/u);
  const rotatedPath = new URL(await link.inputValue()).pathname;
  await page.goto(firstPath);
  await expect(page.getByRole('heading', { name: 'Journey share unavailable' })).toBeVisible();
  await page.goto(rotatedPath);
  await expect(page.getByTestId('public-journey-share')).toBeVisible();

  await page.goto('/journey-collaboration');
  await page.getByRole('tab', { name: 'Read-only links' }).click();
  await page.getByRole('button', { name: 'Revoke' }).click();
  await page.goto(rotatedPath);
  await expect(page.getByRole('heading', { name: 'Journey share unavailable' })).toBeVisible();
});
