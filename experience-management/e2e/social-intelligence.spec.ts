import { expect, test, type Page } from '@playwright/test';

const now = '2026-07-29T12:00:00.000Z';
const alphaId = '11111111-1111-4111-8111-111111111111';
const betaId = '22222222-2222-4222-8222-222222222222';
const knowledgeBaseId = '33333333-3333-4333-8333-333333333333';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password').fill('Playwright-Test-Password-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();
}

function connection(id: string, username: string, name: string, collected: number) {
  return {
    id, status: 'connected', authType: 'oauth2', scopes: ['tweet.read', 'users.read', 'offline.access'],
    tokenExpiresAt: '2026-08-01T12:00:00.000Z', account: { id: `${id}-x`, username, name, profileImageUrl: null },
    autoSync: true, syncIntervalMinutes: 60, nextSyncAt: '2026-07-29T13:00:00.000Z', lastSyncAt: now,
    lastSuccessAt: now, lastError: null, rateLimits: {}, createdAt: now, updatedAt: now,
    counts: { collected, accountPosts: Math.max(0, collected - 4), mentions: 3, searchResults: 1, analyzed: collected }
  };
}

function mention(id: string, connectionId: string, author: string, content: string) {
  return {
    id, source: 'x', externalId: `${id}-external`, xConnectionId: connectionId, ingestionKind: 'mention', author, content,
    url: `https://x.com/${author.replace('@', '')}/status/${id}`, language: 'en', publishedAt: now,
    metadata: { x: { streams: ['mention'], queryIds: [] } },
    analysis: { sentiment: 'negative', themes: ['onboarding'], urgency: 'medium' }, createdAt: now
  };
}

test('multi-account X listening shows billing waits and keeps reply drafts human-reviewed', async ({ page }, testInfo) => {
  const alpha = connection(alphaId, 'researchalpha', 'Research Alpha', 18);
  const beta = connection(betaId, 'researchbeta', 'Research Beta', 7);
  const mentionsByConnection = {
    [alphaId]: [mention('alpha-post', alphaId, '@alpha_customer', 'The onboarding guide was difficult to follow.')],
    [betaId]: [mention('beta-post', betaId, '@beta_customer', 'I am blocked during workspace setup and need help.')]
  };
  let replyDrafts: any[] = [];
  let replyRequest: any = null;
  let savedReply = '';
  let syncConnectionId = '';

  await page.route(/\/api\/integrations\/x(?:\?.*)?$/, async (route) => {
    const requestedId = new URL(route.request().url()).searchParams.get('connectionId') || alphaId;
    const selected = requestedId === betaId ? beta : alpha;
    const collected = selected.counts.collected;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      provider: 'x', callbackUrl: 'http://127.0.0.1:5412/api/integrations/x/callback', canManageAppCredentials: true, canManagePaidCollection: true,
      app: { configured: true, oauth2Configured: true, consumerCredentialsConfigured: false, bearerTokenConfigured: true,
        credentialVersion: 3, updatedAt: now, billing: { status: 'credits_depleted', problemType: 'usage-capped', checkedAt: now } },
      connections: [alpha, beta], selectedConnectionId: selected.id, connection: selected,
      queries: selected.id === betaId ? [{ id: 'query-beta', label: 'Beta help', query: '@researchbeta help', enabled: true,
        sinceId: null, lastSyncAt: now, lastSuccessAt: now, lastError: null, createdAt: now, updatedAt: now }] : [],
      syncJobs: selected.id === alphaId ? [{ id: 'sync-alpha', connectionId: alphaId, trigger: 'manual', state: 'waiting_billing',
        stage: 'waiting_for_x_credits', progress: 10, attempt: 2, runAfter: null, postsFetched: 0, mentionsFetched: 0,
        searchFetched: 0, importedCount: 0, analysisJobId: null, error: 'X returned HTTP 402.', createdAt: now,
        startedAt: now, completedAt: null, updatedAt: now }] : [],
      counts: selected.counts,
      aggregateCounts: { collected: 25, accountPosts: 17, mentions: 6, searchResults: 2, analyzed: 25 }
    }) });
  });
  await page.route(/\/api\/integrations\/x\/mentions(?:\?.*)?$/, async (route) => {
    const requestedId = new URL(route.request().url()).searchParams.get('connectionId') || alphaId;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mentionsByConnection[requestedId as keyof typeof mentionsByConnection] || []) });
  });
  await page.route(/\/api\/integrations\/x\/connections\/[^/]+\/sync$/, async (route) => {
    syncConnectionId = route.request().url().split('/').at(-2) || '';
    await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ created: false, resumed: true }) });
  });
  await page.route(/\/api\/social\/reports(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route(/\/api\/social\/reply-drafts$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(replyDrafts) });
  });
  await page.route(/\/api\/social\/mentions\/[^/]+\/reply-drafts$/, async (route) => {
    replyRequest = route.request().postDataJSON();
    replyDrafts = [{ id: 'draft-beta', mentionId: 'beta-post', connectionId: betaId, tone: replyRequest.tone,
      instructions: replyRequest.instructions, state: 'ready', generatedContent: 'Sorry about the setup trouble. We can help you get unblocked.',
      content: 'Sorry about the setup trouble. We can help you get unblocked.', rationale: 'Acknowledges the issue and offers help.',
      safetyFlags: [], runtime: { provider: 'terra' }, aiJobId: 'reply-job', error: null, createdAt: now, completedAt: now, updatedAt: now }];
    await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ draft: replyDrafts[0] }) });
  });
  await page.route(/\/api\/social\/reply-drafts\/[^/]+$/, async (route) => {
    const body = route.request().postDataJSON(); savedReply = body.content;
    replyDrafts = replyDrafts.map((draft) => ({ ...draft, state: 'edited', content: body.content, updatedAt: now }));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(replyDrafts[0]) });
  });

  await signIn(page);
  await page.goto('/social-listening');
  await expect(page.getByRole('heading', { name: 'Social listening' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'X accounts' })).toBeVisible();
  await expect(page.getByRole('alert').getByText('X API credits are depleted')).toBeVisible();
  await expect(page.getByRole('alert').getByRole('link', { name: 'Open X Developer Console' })).toHaveAttribute('href', 'https://console.x.com');
  await expect(page.getByText('Collected', { exact: true }).locator('..')).toContainText('18');

  const alphaRow = page.getByRole('button').filter({ hasText: '@researchalpha' });
  const betaRow = page.getByRole('button').filter({ hasText: '@researchbeta' });
  await expect(alphaRow).toHaveAttribute('aria-pressed', 'true');
  await expect(betaRow).toHaveAttribute('aria-pressed', 'false');
  await betaRow.click();
  await expect(betaRow).toHaveAttribute('aria-pressed', 'true');
  await expect(alphaRow).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByText('Collected', { exact: true }).locator('..')).toContainText('7');
  await expect(page.getByRole('button', { name: 'Queries (1)' })).toBeVisible();

  await page.getByRole('button', { name: 'Check credits and retry' }).click();
  await expect(page.getByText('Checking X credits and resuming the saved sync.')).toBeVisible();
  expect(syncConnectionId).toBe(betaId);

  await expect(page.getByText('I am blocked during workspace setup and need help.')).toBeVisible();
  await page.getByRole('button', { name: 'Draft reply' }).click();
  const replyDialog = page.getByRole('dialog', { name: 'Draft a reply with Terra' });
  await expect(replyDialog.getByText('Nothing is posted to X.')).toBeVisible();
  await replyDialog.getByLabel('Tone').selectOption('empathetic');
  await replyDialog.getByLabel('Optional guidance').fill('Acknowledge the delay and offer a setup call.');
  await replyDialog.getByRole('button', { name: 'Generate draft' }).click();
  await expect(page.getByRole('heading', { name: 'Reply assistant' })).toBeVisible();
  await expect(page.getByText('Seemplify does not post, like, follow, or message on X.')).toBeVisible();
  expect(replyRequest).toEqual({ tone: 'empathetic', instructions: 'Acknowledge the delay and offer a setup call.' });

  const editor = page.getByLabel('Editable draft');
  await expect(editor).toHaveValue('Sorry about the setup trouble. We can help you get unblocked.');
  await editor.fill('Sorry about the setup trouble. Our team can help you get unblocked today.');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Reply draft saved.')).toBeVisible();
  expect(savedReply).toBe('Sorry about the setup trouble. Our team can help you get unblocked today.');
  await expect(page.getByText(/Draft only .* never posted automatically/)).toBeVisible();

  const viewport = await page.evaluate(() => ({ documentWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth }));
  expect(viewport.documentWidth).toBeLessThanOrEqual(viewport.viewportWidth + 1);
  if (process.env.CAPTURE_VISUALS) await page.screenshot({ path: testInfo.outputPath('social-multi-account-replies.png'), fullPage: true });
});

test('saved X history defaults reports to 50 and requires confirmation before a larger provider read', async ({ page }) => {
  const account = {
    ...connection(alphaId, 'researchalpha', 'Research Alpha', 211),
    catchUp: {
      accountPosts: { pending: true, lowId: '8999950' },
      mentions: { pending: false, lowId: null }
    }
  };
  const savedPosts = Array.from({ length: 211 }, (_, index) => mention(
    `30000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    alphaId,
    `@saved_${index + 1}`,
    `Saved X post ${String(index + 1).padStart(3, '0')}`
  )).map((item, index) => ({
    ...item,
    analysis: null,
    externalId: String(9_000_000 - index),
    publishedAt: new Date(Date.parse(now) - index * 60_000).toISOString()
  })).reverse();
  const expectedLatestIds = [...savedPosts]
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))
    .slice(0, 50)
    .map((item) => item.id);
  const estimateRequests: Array<{ limit: number; streams: string }> = [];
  const expansionRequests: any[] = [];
  const expansionIdempotencyKeys: string[] = [];
  const reportRequests: any[] = [];
  const analysisRequests: any[] = [];
  let reports: any[] = [];
  let canManagePaidCollection = true;

  await page.route(/\/api\/integrations\/x(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    provider: 'x', callbackUrl: 'http://127.0.0.1:5412/api/integrations/x/callback', canManageAppCredentials: true, canManagePaidCollection,
    collectionPolicy: { normalSyncLimit: 50, minimumExpansionLimit: 51, maximumExpansionLimit: 500,
      cacheStrategy: 'since-and-until-cursors', alreadyStoredPostsAreNotReanalyzed: true,
      incrementalSearchStrategy: 'one-oldest-or-catch-up-query-per-run' },
    app: { configured: true, oauth2Configured: true, consumerCredentialsConfigured: false, bearerTokenConfigured: true,
      credentialVersion: 3, updatedAt: now, billing: { status: 'ready', problemType: null, checkedAt: now } },
    connections: [account], selectedConnectionId: account.id, connection: account, queries: [], syncJobs: [],
    counts: account.counts, aggregateCounts: account.counts
  }) }));
  await page.route(/\/api\/integrations\/x\/mentions(?:\?.*)?$/, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(savedPosts)
  }));
  await page.route(/\/api\/integrations\/x\/connections\/[^/]+\/expansion-estimate(?:\?.*)?$/, (route) => {
    const url = new URL(route.request().url());
    const limit = Number(url.searchParams.get('limit'));
    const streams = url.searchParams.get('streams') || '';
    estimateRequests.push({ limit, streams });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      connectionId: alphaId, mode: 'expansion', requestedLimit: limit, boundedLimit: limit,
      planFingerprint: `xplan_${String(limit).padStart(64, '0')}`,
      minimumLimit: 51, maximumLimit: 500, normalSyncLimit: 50,
      streams: streams.split(','), storedCount: savedPosts.length, canManagePaidCollection,
      alreadyStoredExcluded: false, cachedPostsDeduplicatedAfterFetch: true,
      estimated: { maximumNewPosts: limit, maximumProviderRows: limit, maximumUniqueNewPosts: limit,
        providerRequests: Math.ceil(limit / 100) * 3, payablePostsUpperBound: limit,
        standardPostReadUsd: 0.005, maximumEstimatedCostUsd: limit * 0.005,
        pricingBasis: 'standard-post-read-upper-bound' },
      cache: { strategy: 'since-and-until-cursors', incrementalHighWater: true, historicalLowWater: true,
        providerCursorAvoidance: true, crossStreamOverlapPossible: true },
      selectedQueryCount: 0, deferredQueryCount: 0, historyExhaustedStreams: [],
      disclaimer: 'Upper-bound estimate only. X may return fewer posts; exact availability is intentionally not probed because an estimate request can itself consume paid API capacity.',
      generatedAt: now
    }) });
  });
  await page.route(/\/api\/integrations\/x\/connections\/[^/]+\/expand$/, async (route) => {
    const body = route.request().postDataJSON(); expansionRequests.push(body);
    expansionIdempotencyKeys.push(await route.request().headerValue('idempotency-key') || '');
    await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({
      created: true,
      estimate: {
        connectionId: alphaId, mode: 'expansion', requestedLimit: body.limit, boundedLimit: body.limit,
        planFingerprint: body.planFingerprint,
        minimumLimit: 51, maximumLimit: 500, normalSyncLimit: 50, streams: body.streams,
        storedCount: savedPosts.length, canManagePaidCollection: true,
        alreadyStoredExcluded: false, cachedPostsDeduplicatedAfterFetch: true,
        estimated: { maximumNewPosts: body.limit, maximumProviderRows: body.limit, maximumUniqueNewPosts: body.limit,
          providerRequests: 6, payablePostsUpperBound: body.limit },
        selectedQueryCount: 0, deferredQueryCount: 0, historyExhaustedStreams: [], generatedAt: now
      }
    }) });
  });
  await page.route(/\/api\/social\/reports(?:\?.*)?$/, async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON(); reportRequests.push(body);
      const report = { id: `report-${reportRequests.length}`, connectionId: alphaId, title: body.title,
        mentionIds: body.mentionIds, state: 'queued', result: null, runtime: null, aiJobId: `job-${reportRequests.length}`,
        error: null, createdAt: now, completedAt: null, updatedAt: now };
      reports = [report, ...reports];
      await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ report, jobId: report.aiJobId, state: 'queued' }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reports) });
  });
  await page.route(/\/api\/social\/analyze$/, async (route) => {
    analysisRequests.push(route.request().postDataJSON());
    await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ jobId: 'analysis-job', state: 'queued' }) });
  });
  await page.route(/\/api\/knowledge-bases(?:\?.*)?$/, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ knowledgeBases: [{
      id: knowledgeBaseId, name: 'Support playbook', description: 'Approved support and escalation policy',
      privacy: 'space', terraContextEnabled: true, state: 'ready', documentCount: 2, readyDocumentCount: 2,
      chunkCount: 18, entityCount: 4, relationshipCount: 3, storageBytes: 2048, createdAt: now, updatedAt: now,
      lastIndexedAt: now
    }] })
  }));
  await page.route(/\/api\/social\/reply-drafts$/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

  await signIn(page);
  await page.goto('/social-listening');
  await expect(page.getByRole('button', { name: 'Sync latest 50' })).toBeVisible();
  await expect(page.getByText('211 posts saved in this space')).toBeVisible();
  await expect(page.getByText(/Each routine sync reads at most 50 provider results/)).toBeVisible();
  await expect(page.getByText('Catch-up pending', { exact: true })).toBeVisible();
  await expect(page.getByText('Next sync resumes account posts from the saved checkpoint.')).toBeVisible();
  await expect(page.locator('article')).toHaveCount(50);
  await expect(page.getByText('Saved X post 001')).toBeVisible();
  await expect(page.getByText('Saved X post 051')).toHaveCount(0);
  await expect(page.getByText('Not analyzed')).toHaveCount(50);
  await expect(page.getByText('Terra analysis queued')).toHaveCount(0);

  await page.getByRole('button', { name: 'Show 50 more saved' }).click();
  await expect(page.locator('article')).toHaveCount(100);
  await expect(page.getByText('Saved X post 100')).toBeVisible();
  expect(estimateRequests).toHaveLength(0);
  expect(expansionRequests).toHaveLength(0);

  const reportScope = page.getByLabel('Posts for analysis and reporting');
  await expect(reportScope).toHaveValue('50');
  await expect(reportScope.locator('option')).toHaveCount(3);
  await expect(page.getByText('Reports use all 50 selected saved posts.')).toBeVisible();

  await page.getByRole('button', { name: 'Choose knowledge bases' }).click();
  const knowledgeDialog = page.getByRole('dialog', { name: 'Select knowledge bases' });
  await knowledgeDialog.getByRole('button', { name: /Support playbook/ }).click();
  await knowledgeDialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByLabel('Selected knowledge bases')).toContainText('Support playbook');

  await page.getByRole('button', { name: 'Analyze 50 posts' }).click();
  await expect(page.getByText('50 saved posts queued for grounded analysis.')).toBeVisible();
  expect(analysisRequests).toEqual([{ mentionIds: expectedLatestIds, knowledgeBaseIds: [knowledgeBaseId] }]);

  await page.getByRole('button', { name: 'Estimate & fetch older' }).click();
  const expansionDialog = page.getByRole('dialog', { name: 'Fetch older posts from X' });
  await expect(expansionDialog).toBeVisible();
  await expect(expansionDialog.getByLabel('Maximum X results to read').getByRole('option', { name: 'Up to 100 provider results' })).toHaveCount(1);
  await expect(expansionDialog.getByText('Already saved').locator('..')).toContainText('211');
  await expect(expansionDialog.getByText('Maximum provider results').last().locator('..')).toContainText('100');
  await expect(expansionDialog.getByText('At most 100 can be newly saved')).toBeVisible();
  await expect(expansionDialog.getByText('Stored IDs are deduplicated after fetch, but X can return overlap across streams before Seemplify removes it.')).toBeVisible();
  await expect(expansionDialog.getByText(/Upper-bound estimate only\. X may return fewer posts/)).toBeVisible();
  expect(expansionRequests).toHaveLength(0);
  await expansionDialog.getByLabel('Maximum X results to read').selectOption('200');
  await expect(expansionDialog.getByRole('button', { name: 'Confirm & read up to 200' })).toBeEnabled();
  await expansionDialog.getByRole('button', { name: 'Confirm & read up to 200' }).click();
  await expect(page.getByText('Expansion queued for up to 200 X results. Saved IDs will be deduplicated locally.')).toBeVisible();
  expect(estimateRequests.at(-1)).toEqual({ limit: 200, streams: 'account_posts,mentions,searches' });
  expect(expansionRequests).toEqual([{
    limit: 200, streams: ['account_posts', 'mentions', 'searches'], planFingerprint: `xplan_${String(200).padStart(64, '0')}`
  }]);
  expect(expansionIdempotencyKeys).toHaveLength(1);
  expect(expansionIdempotencyKeys[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

  await page.getByRole('button', { name: 'Generate report' }).click();
  await expect(page.getByText('Social-intelligence report queued with 50 saved posts.')).toBeVisible();
  expect(reportRequests).toHaveLength(1);
  expect(reportRequests[0].mentionIds).toEqual(expectedLatestIds);
  expect(reportRequests[0].knowledgeBaseIds).toEqual([knowledgeBaseId]);
  await expect(page.getByText('50 posts', { exact: false })).toBeVisible();

  canManagePaidCollection = false;
  await page.reload();
  await expect(page.getByRole('button', { name: 'Estimate & fetch older' })).toHaveCount(0);
  await expect(page.getByText('A space owner or admin can approve additional paid history reads.')).toBeVisible();
});

test('social report history shows terminal failures, retries the same report, and rejects empty completions', async ({ page }) => {
  const account = connection(alphaId, 'researchalpha', 'Research Alpha', 50);
  const reportId = '44444444-4444-4444-8444-444444444444';
  const error = 'Terra returned evidence that was not present in the saved sources.';
  let report = {
    id: reportId,
    connectionId: alphaId,
    title: 'X listening intelligence',
    mentionIds: ['saved-post-1', 'saved-post-2'],
    knowledgeBaseIds: [],
    state: 'queued',
    result: null,
    runtime: null,
    aiJobId: '55555555-5555-4555-8555-555555555555',
    error: null,
    createdAt: now,
    completedAt: null,
    updatedAt: now
  };
  const retryRequests: Array<{ method: string; url: string }> = [];

  await page.route(/\/api\/integrations\/x(?:\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      provider: 'x',
      callbackUrl: 'http://127.0.0.1:5412/api/integrations/x/callback',
      canManageAppCredentials: true,
      canManagePaidCollection: true,
      collectionPolicy: {
        normalSyncLimit: 50,
        minimumExpansionLimit: 51,
        maximumExpansionLimit: 500,
        cacheStrategy: 'since-and-until-cursors',
        alreadyStoredPostsAreNotReanalyzed: true,
        incrementalSearchStrategy: 'one-oldest-or-catch-up-query-per-run'
      },
      app: {
        configured: true,
        oauth2Configured: true,
        consumerCredentialsConfigured: false,
        bearerTokenConfigured: true,
        credentialVersion: 3,
        updatedAt: now,
        billing: { status: 'ready', problemType: null, checkedAt: now }
      },
      connections: [account],
      selectedConnectionId: account.id,
      connection: account,
      queries: [],
      syncJobs: [],
      counts: account.counts,
      aggregateCounts: account.counts
    })
  }));
  await page.route(/\/api\/integrations\/x\/mentions(?:\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '[]'
  }));
  await page.route(new RegExp(`/api/social/reports/${reportId}/retry$`), async (route) => {
    retryRequests.push({ method: route.request().method(), url: route.request().url() });
    report = { ...report, state: 'queued', error: null, completedAt: null, updatedAt: '2026-07-29T12:01:00.000Z' };
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ report, jobId: report.aiJobId, state: report.state })
    });
  });
  await page.route(/\/api\/social\/reports(?:\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([report])
  }));
  await page.route(/\/api\/social\/reply-drafts$/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '[]'
  }));

  await signIn(page);
  await page.goto('/social-listening');
  await page.getByRole('button', { name: 'Intelligence (1)' }).click();

  await expect(page.getByRole('status').filter({ hasText: 'Waiting for Terra. This report is durable.' })).toBeVisible();
  await expect(page.getByText(error, { exact: true })).toHaveCount(0);

  report = { ...report, state: 'failed', error, completedAt: now, updatedAt: now };
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();

  const failureAlert = page.getByRole('alert').filter({ hasText: 'Report could not be completed' });
  await expect(failureAlert).toBeVisible();
  await expect(failureAlert.getByText(error, { exact: true })).toBeVisible();
  await expect(page.getByText('Waiting for Terra. This report is durable.', { exact: true })).toHaveCount(0);

  await failureAlert.getByRole('button', { name: 'Retry report' }).click();
  await expect.poll(() => retryRequests).toEqual([{
    method: 'POST',
    url: `http://127.0.0.1:5412/api/social/reports/${reportId}/retry`
  }]);
  await expect(page.getByText('Retry queued with the same 2 saved posts and durable job.', { exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Waiting for Terra. This report is durable.' })).toBeVisible();
  await expect(failureAlert).toHaveCount(0);

  report = { ...report, state: 'completed', result: null, completedAt: now, updatedAt: '2026-07-29T12:02:00.000Z' };

  const integrityAlert = page.getByRole('alert').filter({ hasText: 'The completed report has no readable result' });
  await expect(integrityAlert).toBeVisible({ timeout: 7_000 });
  await expect(integrityAlert).toContainText('The saved sources are intact. Refresh once; if this remains, share the report ID with support.');
  await expect(integrityAlert.getByRole('button', { name: 'Retry report' })).toHaveCount(0);
  await expect(page.getByText('Waiting for Terra. This report is durable.', { exact: true })).toHaveCount(0);
});

test('Intelligence combines immutable survey and social report snapshots into saved analysis', async ({ page }, testInfo) => {
  const surveyRef = 'survey:insight-q2';
  const secondSurveyRef = 'survey:executive-retention';
  const socialRef = 'social:x-onboarding';
  const knowledgeRef = 'knowledge-base:customer-policy';
  const sources = [
    { ref: surveyRef, type: 'survey', title: 'Q2 onboarding insights', kind: 'insights', createdAt: now, preview: 'Customers struggle to find the first setup milestone.' },
    { ref: secondSurveyRef, type: 'survey', title: 'Retention executive report', kind: 'report', createdAt: now, preview: 'Retention improves after teams invite a colleague.' },
    { ref: socialRef, type: 'social', title: 'X onboarding intelligence', kind: 'social', createdAt: now, preview: 'Recent X posts mention setup guidance and unclear roles.' },
    { ref: knowledgeRef, type: 'knowledge', title: 'Customer policy library', kind: 'knowledge_base', createdAt: now, preview: 'Approved customer onboarding and support policies.', knowledgeBaseId: 'customer-policy', documentCount: 8, terraContextEnabled: true }
  ];
  let reports: any[] = [{
    id: 'combined-existing', title: 'Onboarding evidence review', objective: 'Compare onboarding friction across research channels.',
    sourceRefs: { survey: [surveyRef], social: [socialRef] }, state: 'completed',
    result: {
      confidence: 0.86, executiveSummary: 'Survey and social evidence both point to unclear setup guidance.',
      themes: [{ title: 'Setup clarity', detail: 'People need clearer first steps.', confidence: 0.91,
        evidence: [{ sourceRef: surveyRef, excerpt: 'I did not know what to configure first.', relevance: 'Direct evidence of unclear setup.' }] }],
      convergence: [{ title: 'Guidance gap', detail: 'Both channels describe difficulty finding the next step.', confidence: 0.88, evidence: [] }],
      divergence: [{ title: 'Role permissions', detail: 'Only social posts raise role-permission confusion.', confidence: 0.72, evidence: [] }],
      risks: [{ title: 'Delayed activation', detail: 'Setup confusion delays first value.', priority: 'high', evidence: [] }],
      opportunities: [{ title: 'Guided checklist', detail: 'Show a role-aware setup checklist.', confidence: 0.84, evidence: [] }],
      recommendations: [{ action: 'Ship a role-aware setup checklist', rationale: 'Addresses the strongest shared signal.', priority: 'high', evidence: [] }],
      limitations: ['The social report covers a seven-day recent-search window.']
    }, runtime: { provider: 'terra', usage: { totalTokens: 1840 }, latencyMs: 12100 }, aiJobId: 'combined-job', error: null,
    createdAt: now, completedAt: now, updatedAt: now
  }];
  let createPayload: any = null;

  await page.route(/\/api\/intelligence\/sources$/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sources) }));
  await page.route(/\/api\/intelligence\/reports$/, async (route) => {
    if (route.request().method() === 'POST') {
      createPayload = route.request().postDataJSON();
      const queued = { id: 'combined-new', title: createPayload.title, objective: createPayload.objective,
        sourceRefs: { survey: createPayload.sourceRefs.filter((ref: string) => ref.startsWith('survey:')),
          social: createPayload.sourceRefs.filter((ref: string) => ref.startsWith('social:')) },
        knowledgeBaseIds: createPayload.sourceRefs.filter((ref: string) => ref.startsWith('knowledge-base:')).map((ref: string) => ref.replace('knowledge-base:', '')),
        state: 'queued', result: null, runtime: null, aiJobId: 'combined-new-job', error: null, createdAt: now,
        completedAt: null, updatedAt: now };
      reports = [queued, ...reports];
      await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ report: queued }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reports) });
  });

  await signIn(page);
  await page.goto('/intelligence');
  await expect(page.getByRole('heading', { name: 'Intelligence', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Build an analysis' })).toBeVisible();
  await expect(page.getByText('Source snapshots are captured before the Terra job is queued.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Onboarding evidence review' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Executive summary' })).toBeVisible();
  await expect(page.getByText('Survey and social evidence both point to unclear setup guidance.')).toBeVisible();
  if (process.env.CAPTURE_VISUALS) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath('completed-intelligence-workspace.png'), fullPage: true });
  }
  await page.getByRole('button', { name: 'Ask Terra', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ask this analysis', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'What is the strongest finding?', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to report', exact: true }).click();
  await page.getByRole('button', { name: 'Findings', exact: true }).click();
  await page.getByText('Evidence (1)').click();
  await expect(page.getByText('I did not know what to configure first.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Where sources converge' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Where sources diverge' })).toBeVisible();
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Limitations' })).toBeVisible();
  await page.getByRole('button', { name: 'Sources (2)', exact: true }).click();
  await expect(page.getByText('1,840')).toBeVisible();

  const runAnalysis = page.getByRole('button', { name: 'Run analysis' });
  await expect(runAnalysis).toBeDisabled();
  await page.getByRole('button', { name: /Q2 onboarding insights/ }).click();
  await expect(runAnalysis).toBeDisabled();
  await page.getByRole('button', { name: /Customer policy library/ }).click();
  await expect(page.getByText('2 of 12 selected')).toBeVisible();
  await expect(runAnalysis).toBeEnabled();
  await runAnalysis.click();

  await expect(page.getByText('Combined intelligence queued durably.')).toBeVisible();
  expect(createPayload.sourceRefs).toEqual([surveyRef, knowledgeRef]);
  await expect(page.getByRole('heading', { name: 'Combined experience intelligence' })).toBeVisible();
  await expect(page.getByText('Terra analysis is queued or processing. It will remain available after navigation or restart.')).toBeVisible();
  await expect(page.getByText('0 of 12 selected')).toBeVisible();

  const viewport = await page.evaluate(() => ({ documentWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth }));
  expect(viewport.documentWidth).toBeLessThanOrEqual(viewport.viewportWidth + 1);
  if (process.env.CAPTURE_VISUALS) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath('combined-intelligence.png'), fullPage: true });
  }
});
