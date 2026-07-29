import { expect, test, type Page } from '@playwright/test';

const now = '2026-07-29T12:00:00.000Z';
const alphaId = '11111111-1111-4111-8111-111111111111';
const betaId = '22222222-2222-4222-8222-222222222222';

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
      provider: 'x', callbackUrl: 'http://127.0.0.1:5412/api/integrations/x/callback', canManageAppCredentials: true,
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

test('Intelligence combines immutable survey and social report snapshots into saved analysis', async ({ page }, testInfo) => {
  const surveyRef = 'survey:insight-q2';
  const secondSurveyRef = 'survey:executive-retention';
  const socialRef = 'social:x-onboarding';
  const sources = [
    { ref: surveyRef, type: 'survey', title: 'Q2 onboarding insights', kind: 'insights', createdAt: now, preview: 'Customers struggle to find the first setup milestone.' },
    { ref: secondSurveyRef, type: 'survey', title: 'Retention executive report', kind: 'report', createdAt: now, preview: 'Retention improves after teams invite a colleague.' },
    { ref: socialRef, type: 'social', title: 'X onboarding intelligence', kind: 'social', createdAt: now, preview: 'Recent X posts mention setup guidance and unclear roles.' }
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
  await page.getByText('Evidence (1)').click();
  await expect(page.getByText('I did not know what to configure first.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Where sources converge' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Where sources diverge' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Limitations' })).toBeVisible();
  await expect(page.getByText(/1840 tokens/)).toBeVisible();

  const runAnalysis = page.getByRole('button', { name: 'Run analysis' });
  await expect(runAnalysis).toBeDisabled();
  await page.getByRole('button', { name: /Q2 onboarding insights/ }).click();
  await expect(runAnalysis).toBeDisabled();
  await page.getByRole('button', { name: /X onboarding intelligence/ }).click();
  await expect(page.getByText('2 of 12 selected')).toBeVisible();
  await expect(runAnalysis).toBeEnabled();
  await runAnalysis.click();

  await expect(page.getByText('Combined intelligence queued durably.')).toBeVisible();
  expect(createPayload.sourceRefs).toEqual([surveyRef, socialRef]);
  await expect(page.getByRole('heading', { name: 'Combined experience intelligence' })).toBeVisible();
  await expect(page.getByText('Terra analysis is queued or processing. It will remain available after navigation or restart.')).toBeVisible();
  await expect(page.getByText('0 of 12 selected')).toBeVisible();

  const viewport = await page.evaluate(() => ({ documentWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth }));
  expect(viewport.documentWidth).toBeLessThanOrEqual(viewport.viewportWidth + 1);
  if (process.env.CAPTURE_VISUALS) await page.screenshot({ path: testInfo.outputPath('combined-intelligence.png'), fullPage: true });
});
