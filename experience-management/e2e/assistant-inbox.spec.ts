import { expect, test, type Page, type Route } from '@playwright/test';

const now = '2026-07-31T09:30:00.000Z';
const firstConnectionId = '10111111-1111-4111-8111-111111111111';
const secondConnectionId = '20222222-2222-4222-8222-222222222222';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password', { exact: true }).fill('Playwright-Test-Password-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();
}

async function openAssistant(page: Page) {
  const openNavigation = page.getByRole('button', { name: 'Open navigation' });
  if (await openNavigation.isVisible()) await openNavigation.click();
  await page.getByLabel('Primary navigation').getByRole('link', { name: 'Personal assistant' }).click();
  await expect(page.getByRole('heading', { name: 'Personal assistant' })).toBeVisible();
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function thread(id: string, subject: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    subject,
    snippet: `Preview for ${subject}`,
    participants: [{ name: 'Ada Okafor', email: 'ada@example.test' }],
    messageCount: 2,
    lastMessageAt: now,
    unread: false,
    starred: false,
    hasAttachments: false,
    attachmentCount: 0,
    labels: ['inbox'],
    ...overrides
  };
}

function detail(item: ReturnType<typeof thread>, marker = item.id) {
  return {
    thread: item,
    loadedMessageCount: 2,
    totalMessageCount: item.messageCount,
    messagesTruncated: item.messageCount > 2,
    bytesTruncated: item.messageCount > 2,
    loadedMessageBytes: item.messageCount > 2 ? 84 * 1024 : 8 * 1024,
    messageBodyByteLimit: 12 * 1024,
    threadByteLimit: 96 * 1024,
    messages: [
      {
        id: `${marker}-message-1`,
        subject: item.subject,
        from: [{ name: 'Ada Okafor', email: 'ada@example.test' }],
        to: [{ name: 'Michael Egbo', email: 'michael@example.test' }],
        cc: [],
        sentAt: '2026-07-31T08:45:00.000Z',
        body: `Full first message for ${item.subject}. <img src=x onerror="window.__mailInjected=true">`,
        bodyTruncated: item.messageCount > 2,
        attachments: [{
          id: `${marker}-attachment-1`,
          filename: 'board-risk-register.pdf',
          contentType: 'application/pdf',
          size: 24_576
        }]
      },
      {
        id: `${marker}-message-2`,
        subject: `Re: ${item.subject}`,
        from: [{ name: 'Michael Egbo', email: 'michael@example.test' }],
        to: [{ name: 'Ada Okafor', email: 'ada@example.test' }],
        cc: [{ name: 'Risk Office', email: 'risk@example.test' }],
        sentAt: now,
        body: `Full second message for ${item.subject}.`,
        bodyTruncated: false,
        attachments: []
      }
    ]
  };
}

function overview(connections = [{
  id: firstConnectionId,
  email: 'michael@example.test',
  displayName: 'Executive mailbox',
  provider: 'google',
  status: 'connected',
  scopes: ['email.read_only']
}]) {
  return {
    configured: true,
    callbackUrl: 'http://127.0.0.1:5412/api/integrations/nylas/callback',
    connections,
    worker: { running: true, active: 0, queued: 0, concurrency: 4 },
    ai: { ready: true, providerLabel: 'ChatGPT Connect' }
  };
}

async function routeAssistantFoundation(page: Page, connections?: ReturnType<typeof overview>['connections']) {
  await page.route(/\/api\/assistant\/overview(?:\?.*)?$/, (route) => json(route, overview(connections)));
  await page.route(/\/api\/assistant\/runs(?:\?.*)?$/, (route) => json(route, []));
  await page.route(/\/api\/intelligence\/sources(?:\?.*)?$/, (route) => json(route, []));
}

test('desktop inbox searches, paginates, scrolls independently, reads full messages, and keeps AI work human-reviewed', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop verifies the independent three-pane mailbox layout.');

  const primary = thread('board-risk-pack', 'Board risk pack', {
    unread: true, starred: true, hasAttachments: true, attachmentCount: 1, messageCount: 5
  });
  const firstPage = [
    primary,
    ...Array.from({ length: 34 }, (_, index) => thread(`inbox-${index + 1}`, `Inbox conversation ${index + 1}`))
  ];
  const nextPage = [
    thread('inbox-next-1', 'Quarterly operating review'),
    thread('inbox-next-2', 'Customer remediation update')
  ];
  const searchResult = thread('board-search-result', 'Executive update', {
    snippet: 'Routine preview without the native-search phrase.',
    hasAttachments: true, attachmentCount: 1
  });
  const listRequests: URL[] = [];
  let runs: any[] = [];

  await routeAssistantFoundation(page, [
    {
      id: firstConnectionId,
      email: 'michael@example.test',
      displayName: 'Executive mailbox',
      provider: 'google',
      status: 'connected',
      scopes: ['email.read_only']
    },
    {
      id: secondConnectionId,
      email: 'second@example.test',
      displayName: 'Second mailbox',
      provider: 'microsoft',
      status: 'connected',
      scopes: ['email.read_only']
    }
  ]);
  await page.unroute(/\/api\/assistant\/runs(?:\?.*)?$/);
  await page.route(/\/api\/assistant\/runs(?:\?.*)?$/, (route) => json(route, runs));
  await page.route(/\/api\/assistant\/mailbox\/threads(?:\?.*)?$/, (route) => {
    const url = new URL(route.request().url());
    listRequests.push(url);
    if (url.searchParams.get('search') === 'mercury') {
      return json(route, { items: [searchResult], nextCursor: null });
    }
    if (url.searchParams.get('cursor') === 'page-2') {
      return json(route, { items: nextPage, nextCursor: null });
    }
    return json(route, { items: firstPage, nextCursor: 'page-2' });
  });
  await page.route(/\/api\/assistant\/mailbox\/threads\/[^?]+(?:\?.*)?$/, (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1) || '');
    const selected = [...firstPage, ...nextPage, searchResult].find((item) => item.id === id);
    return selected ? json(route, detail(selected)) : json(route, { error: 'Not found' }, 404);
  });
  await page.route(/\/api\/assistant\/runs\/email-summary$/, async (route) => {
    expect(await route.request().postDataJSON()).toEqual({
      connectionId: firstConnectionId,
      threadId: searchResult.id
    });
    const run = {
      id: '30333333-3333-4333-8333-333333333333',
      jobId: '40444444-4444-4444-8444-444444444444',
      kind: 'assistant.email_summary',
      state: 'completed',
      stage: 'completed',
      progress: 100,
      connectionId: firstConnectionId,
      subjectRef: searchResult.id,
      output: {
        summary: 'The board paper needs human approval before distribution.',
        keyPoints: ['The risk register is attached.'],
        actionItems: [],
        openQuestions: ['Who is the final approver?']
      },
      runtime: { provider: 'codex', model: 'gpt-5.6-sol', usage: { totalTokens: 260 } },
      advisoryOnly: true,
      externalDispatched: false,
      error: null,
      createdAt: now,
      completedAt: now,
      updatedAt: now
    };
    runs = [run, ...runs];
    return json(route, { run, jobId: run.jobId, state: run.state, statusUrl: `/api/assistant/runs/${run.id}` }, 202);
  });
  await page.route(/\/api\/assistant\/runs\/email-draft$/, async (route) => {
    const input = await route.request().postDataJSON();
    expect(input.connectionId).toBe(firstConnectionId);
    expect(input.threadId).toBe(searchResult.id);
    const run = {
      id: '50555555-5555-4555-8555-555555555555',
      jobId: '60666666-6666-4666-8666-666666666666',
      kind: 'assistant.email_draft',
      state: 'completed',
      stage: 'completed',
      progress: 100,
      connectionId: firstConnectionId,
      subjectRef: searchResult.id,
      output: {
        subject: 'Re: Board paper approval',
        body: 'Thank you. I will review the board paper.',
        rationale: 'Drafted for human review.',
        safetyFlags: []
      },
      generatedDraft: {
        subject: 'Re: Board paper approval',
        body: 'Thank you. I will review the board paper.'
      },
      draft: {
        subject: 'Re: Board paper approval',
        body: 'Thank you. I will review the board paper.',
        revision: 1,
        updatedAt: now
      },
      runtime: { provider: 'codex', model: 'gpt-5.6-sol', usage: { totalTokens: 240 } },
      advisoryOnly: true,
      externalDispatched: false,
      error: null,
      createdAt: now,
      completedAt: now,
      updatedAt: now
    };
    runs = [run, ...runs];
    return json(route, { run, jobId: run.jobId, state: run.state, statusUrl: `/api/assistant/runs/${run.id}` }, 202);
  });

  await signIn(page);
  await openAssistant(page);

  const conversations = page.getByRole('region', { name: 'Mailbox conversations' });
  const reader = page.getByTestId('assistant-conversation-reader');
  await expect(conversations).toBeVisible();
  await expect(reader).toContainText('Board risk pack');
  await expect(page.getByTestId('assistant-message-board-risk-pack-message-1')).toContainText('Full first message');
  await expect(page.getByTestId('assistant-message-board-risk-pack-message-2')).toContainText('Full second message');
  await expect(page.getByTestId('assistant-thread-load-metadata')).toContainText('Loaded 2 of 5 messages');
  await expect(page.getByTestId('assistant-thread-load-metadata')).toContainText('Some messages were omitted');
  await expect(page.getByTestId('assistant-thread-load-metadata')).toContainText('response-size safety limit');
  await expect(page.getByTestId('assistant-message-board-risk-pack-message-1')).toContainText('12 KB safety limit');
  await expect(reader.getByText('board-risk-register.pdf')).toBeVisible();
  await expect(reader.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__mailInjected)).toBeUndefined();

  const scroll = await conversations.evaluate((element) => {
    const style = getComputedStyle(element);
    return { overflowY: style.overflowY, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight };
  });
  expect(['auto', 'scroll']).toContain(scroll.overflowY);
  expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);
  const pageScroll = await page.evaluate(() => window.scrollY);
  await conversations.evaluate((element) => { element.scrollTop = Math.max(1, element.scrollHeight - element.clientHeight); });
  await expect.poll(() => conversations.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(pageScroll);

  await page.getByRole('button', { name: 'Load more conversations' }).click();
  await expect(page.getByTestId('assistant-thread-inbox-next-1')).toBeVisible();
  expect(listRequests.some((request) => request.searchParams.get('cursor') === 'page-2')).toBe(true);

  await page.getByLabel('Search mail').fill('mercury');
  await expect.poll(() => listRequests.some((request) => request.searchParams.get('search') === 'mercury')).toBe(true);
  await expect(page.getByTestId('assistant-thread-board-search-result')).toBeVisible();
  await expect(page.getByTestId('assistant-thread-inbox-next-1')).toHaveCount(0);
  await page.getByTestId('assistant-thread-board-search-result').click();
  await expect(reader).toContainText('Executive update');

  const openAssistantPanel = page.getByRole('button', { name: 'Open assistant' });
  if (await openAssistantPanel.isVisible()) await openAssistantPanel.click();
  await page.getByRole('button', { name: 'Summarise' }).click();
  await expect(page.getByText('The board paper needs human approval before distribution.')).toBeVisible();
  await page.getByRole('tab', { name: 'Reply' }).click();
  await page.getByRole('button', { name: 'Draft reply' }).click();
  await expect(
    page.getByTestId('assistant-run-detail').getByText('Review required', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Reply', { exact: true })).toHaveText('Thank you. I will review the board paper.');
  await page.getByLabel('Reply', { exact: true }).fill('Unsaved executive response.');

  let accountGuardSeen = false;
  page.once('dialog', async (dialog) => {
    accountGuardSeen = true;
    expect(dialog.message()).toContain('Discard the unsaved changes');
    await dialog.dismiss();
  });
  await page.getByLabel('Connected mailbox').selectOption(secondConnectionId);
  expect(accountGuardSeen).toBe(true);
  await expect(reader).toContainText('Executive update');
  await expect(page.getByLabel('Reply', { exact: true })).toHaveText('Unsaved executive response.');

  let tabGuardSeen = false;
  page.once('dialog', async (dialog) => {
    tabGuardSeen = true;
    expect(dialog.message()).toContain('Discard the unsaved changes');
    await dialog.dismiss();
  });
  await page.getByRole('tab', { name: 'Work products' }).click();
  expect(tabGuardSeen).toBe(true);
  await expect(page.getByRole('tab', { name: 'Mailbox' })).toHaveAttribute('data-state', 'active');
  await expect(page.getByLabel('Reply', { exact: true })).toHaveText('Unsaved executive response.');
});

test('mailbox switching rejects late list and conversation responses from the previous account', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop verifies concurrent mailbox panes; mobile stale state is covered by the same request guards.');

  const first = thread('first-account-thread', 'First account confidential thread');
  const second = thread('second-account-thread', 'Second account current thread');
  let releaseFirstList!: () => void;
  let markFirstListStarted!: () => void;
  const firstListStarted = new Promise<void>((resolve) => { markFirstListStarted = resolve; });
  const firstListReleased = new Promise<void>((resolve) => { releaseFirstList = resolve; });
  let firstListRequests = 0;
  let releaseFirstDetail!: () => void;
  let markFirstDetailStarted!: () => void;
  let firstDetailStarted = new Promise<void>((resolve) => { markFirstDetailStarted = resolve; });
  let firstDetailReleased = new Promise<void>((resolve) => { releaseFirstDetail = resolve; });

  const connections = [
    { id: firstConnectionId, email: 'first@example.test', displayName: 'First mailbox', provider: 'google', status: 'connected' },
    { id: secondConnectionId, email: 'second@example.test', displayName: 'Second mailbox', provider: 'microsoft', status: 'connected' }
  ];
  await routeAssistantFoundation(page, connections);
  await page.route(/\/api\/assistant\/mailbox\/threads(?:\?.*)?$/, async (route) => {
    const connectionId = new URL(route.request().url()).searchParams.get('connectionId');
    if (connectionId === firstConnectionId) {
      firstListRequests += 1;
      if (firstListRequests === 1) {
        markFirstListStarted();
        await firstListReleased;
      }
      return json(route, { items: [first], nextCursor: null });
    }
    return json(route, { items: [second], nextCursor: null });
  });
  await page.route(/\/api\/assistant\/mailbox\/threads\/[^?]+(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const id = decodeURIComponent(url.pathname.split('/').at(-1) || '');
    if (id === first.id) {
      markFirstDetailStarted();
      await firstDetailReleased;
      return json(route, detail(first, 'late-first'));
    }
    return json(route, detail(second, 'current-second'));
  });

  await signIn(page);
  await openAssistant(page);
  await firstListStarted;
  await page.getByLabel('Connected mailbox').selectOption(secondConnectionId);
  await expect(page.getByTestId('assistant-thread-second-account-thread')).toBeVisible();
  releaseFirstList();
  await expect(page.getByTestId('assistant-thread-first-account-thread')).toHaveCount(0);
  await expect(page.getByTestId('assistant-conversation-reader')).toContainText('Second account current thread');

  firstDetailStarted = new Promise<void>((resolve) => { markFirstDetailStarted = resolve; });
  firstDetailReleased = new Promise<void>((resolve) => { releaseFirstDetail = resolve; });
  await page.getByLabel('Connected mailbox').selectOption(firstConnectionId);
  await firstDetailStarted;
  await page.getByLabel('Connected mailbox').selectOption(secondConnectionId);
  await expect(page.getByTestId('assistant-conversation-reader')).toContainText('Full first message for Second account current thread');
  releaseFirstDetail();
  await expect(page.getByText('Full first message for First account confidential thread')).toHaveCount(0);
  await expect(page.getByTestId('assistant-conversation-reader')).toContainText('Second account current thread');
});

test('a late pagination response cannot contaminate a newer mailbox search', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop exercises the paginated mailbox list.');

  const initial = thread('initial-thread', 'Initial conversation');
  const stalePage = thread('stale-page-thread', 'Stale page from the old search');
  const searchResult = thread('current-search-thread', 'Current search result');
  let releaseStalePage!: () => void;
  let markStalePageStarted!: () => void;
  const stalePageStarted = new Promise<void>((resolve) => { markStalePageStarted = resolve; });
  const stalePageReleased = new Promise<void>((resolve) => { releaseStalePage = resolve; });

  await routeAssistantFoundation(page);
  await page.route(/\/api\/assistant\/mailbox\/threads(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('cursor') === 'old-page') {
      markStalePageStarted();
      await stalePageReleased;
      return json(route, { items: [stalePage], nextCursor: null });
    }
    if (url.searchParams.get('search') === 'current') {
      return json(route, { items: [searchResult], nextCursor: null });
    }
    return json(route, { items: [initial], nextCursor: 'old-page' });
  });
  await page.route(/\/api\/assistant\/mailbox\/threads\/[^?]+(?:\?.*)?$/, (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1) || '');
    const selected = [initial, stalePage, searchResult].find((item) => item.id === id);
    return selected ? json(route, detail(selected)) : json(route, { error: 'Not found' }, 404);
  });

  await signIn(page);
  await openAssistant(page);
  await expect(page.getByTestId('assistant-thread-initial-thread')).toBeVisible();
  await page.getByRole('button', { name: 'Load more conversations' }).click();
  await stalePageStarted;
  await page.getByLabel('Search mail').fill('current');
  await expect(page.getByTestId('assistant-thread-current-search-thread')).toBeVisible();
  releaseStalePage();
  await expect(page.getByTestId('assistant-thread-stale-page-thread')).toHaveCount(0);
  await expect(page.getByTestId('assistant-thread-current-search-thread')).toBeVisible();
});

test('mobile inbox drills from conversations into the full reader and back without losing the list', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile validates its dedicated list-to-conversation navigation.');

  const first = thread('mobile-first', 'Mobile first conversation');
  const second = thread('mobile-second', 'Mobile board conversation', {
    unread: true, hasAttachments: true, attachmentCount: 1
  });
  await routeAssistantFoundation(page);
  await page.route(/\/api\/assistant\/mailbox\/threads(?:\?.*)?$/, (route) =>
    json(route, { items: [first, second], nextCursor: null }));
  await page.route(/\/api\/assistant\/mailbox\/threads\/[^?]+(?:\?.*)?$/, (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1) || '');
    return json(route, detail(id === second.id ? second : first, `mobile-${id}`));
  });

  await signIn(page);
  await openAssistant(page);
  const conversations = page.getByRole('region', { name: 'Mailbox conversations' });
  const reader = page.getByTestId('assistant-conversation-reader');
  await expect(conversations).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back to conversations' })).toBeHidden();

  await page.getByTestId('assistant-thread-mobile-second').click();
  await expect(reader).toBeVisible();
  await expect(reader).toContainText('Mobile board conversation');
  await expect(page.getByTestId('assistant-message-mobile-mobile-second-message-1')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back to conversations' })).toBeVisible();
  await expect(conversations).toBeHidden();

  await page.getByRole('button', { name: 'Back to conversations' }).click();
  await expect(conversations).toBeVisible();
  await expect(page.getByTestId('assistant-thread-mobile-second')).toBeVisible();
  await expect(reader).toBeHidden();
});
