import { expect, test, type Page, type Route } from '@playwright/test';

const now = '2026-07-30T12:00:00.000Z';
const connectionId = '11111111-1111-4111-8111-111111111111';
const summaryRunId = '22222222-2222-4222-8222-222222222222';
const summaryJobId = '33333333-3333-4333-8333-333333333333';
const draftRunId = '44444444-4444-4444-8444-444444444444';
const draftJobId = '55555555-5555-4555-8555-555555555555';
const knowledgeRunId = '66666666-6666-4666-8666-666666666666';
const knowledgeJobId = '77777777-7777-4777-8777-777777777777';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password').fill('Playwright-Test-Password-2026!');
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

function threadDetail(thread: any) {
  return {
    thread,
    loadedMessageCount: thread.messageCount,
    totalMessageCount: thread.messageCount,
    messagesTruncated: false,
    bytesTruncated: false,
    loadedMessageBytes: 512,
    messageBodyByteLimit: 12 * 1024,
    threadByteLimit: 96 * 1024,
    messages: [{
      id: `${thread.id}-message`,
      subject: thread.subject,
      from: thread.participants,
      to: [{ name: 'Michael Egbo', email: 'michael@example.com' }],
      cc: [],
      sentAt: now,
      body: thread.snippet,
      bodyTruncated: false,
      attachments: []
    }]
  };
}

async function openMailboxAssistant(page: Page, threadId: string) {
  const open = page.getByRole('button', { name: 'Open assistant' });
  if (!await open.isVisible()) {
    const thread = page.getByTestId(`assistant-thread-${threadId}`);
    if (await thread.isVisible()) await thread.click();
  }
  await open.click();
  await expect(page.getByLabel('Mailbox assistant')).toBeVisible();
}

async function selectMailbox(page: Page, id: string, accessibleName: RegExp) {
  const button = page.getByRole('button', { name: accessibleName });
  if (await button.isVisible()) await button.click();
  else await page.getByLabel('Connected mailbox').selectOption(id);
}

test('personal assistant summarises mail, preserves an editable draft, and cites selected Experience evidence', async ({ page }, testInfo) => {
  let runs: any[] = [];
  let savedDraftBody = '';
  const overview = {
    configured: true,
    callbackUrl: 'http://127.0.0.1:5412/api/integrations/nylas/callback',
    connections: [{ id: connectionId, email: 'michael@example.com', displayName: 'Michael Egbo', provider: 'google', status: 'connected', scopes: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'], lastHealthAt: now }],
    worker: { running: true, active: 0, queued: 0, concurrency: 4 },
    terra: { ready: true, providerLabel: 'Terra (Experience managed)' }
  };
  const thread = {
    id: 'thread-board-review', subject: 'Board pack review', snippet: 'Please confirm the revised customer-risk section by Friday.',
    participants: [{ name: 'Ada Okafor', email: 'ada@example.com' }], messageCount: 3, lastMessageAt: now
  };
  const sources = [{ ref: 'survey-insight:customer-risk', type: 'survey', title: 'Customer risk review', kind: 'insights', createdAt: now, preview: 'Customers report delayed issue resolution.' }];

  await page.route(/\/api\/assistant\/overview(?:\?.*)?$/, (route) => json(route, overview));
  await page.route(/\/api\/assistant\/mailbox\/threads(?:\?.*)?$/, (route) =>
    json(route, { items: [thread], nextCursor: null }));
  await page.route(/\/api\/assistant\/mailbox\/threads\/[^?]+(?:\?.*)?$/, (route) =>
    json(route, threadDetail(thread)));
  await page.route(/\/api\/intelligence\/sources(?:\?.*)?$/, (route) => json(route, sources));
  await page.route(/\/api\/knowledge-bases(?:\?.*)?$/, (route) => json(route, { knowledgeBases: [] }));
  await page.route(/\/api\/assistant\/runs(?:\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return json(route, runs);
  });
  await page.route(/\/api\/assistant\/runs\/email-summary$/, async (route) => {
    const request = await route.request().postDataJSON();
    expect(request.connectionId).toBe(connectionId); expect(request.threadId).toBe(thread.id);
    const run = {
      id: summaryRunId, jobId: summaryJobId, kind: 'assistant.email_summary', state: 'completed', stage: 'completed', progress: 100,
      connectionId, subjectRef: thread.id,
      output: { summary: request.instructions ? 'The revised customer-risk section needs a reply by Friday.' : 'Ada needs confirmation of the revised customer-risk section by Friday.', keyPoints: ['The board pack is awaiting review.'], actionItems: [{ action: 'Confirm the revised section.', owner: 'Michael', dueDate: 'Friday', sourceMessageId: 'message-3' }], openQuestions: ['Which timezone applies to Friday?'] },
      runtime: { provider: 'terra', model: 'gpt-5.6-terra', usage: { totalTokens: 412 }, latencyMs: 920 }, error: null,
      createdAt: now, completedAt: now, updatedAt: now
    };
    runs = [run, ...runs];
    return json(route, { run, jobId: run.jobId, state: run.state, statusUrl: `/api/assistant/runs/${run.id}` }, 202);
  });
  await page.route(/\/api\/assistant\/runs\/email-draft$/, async (route) => {
    const request = await route.request().postDataJSON();
    expect(request.connectionId).toBe(connectionId); expect(request.threadId).toBe(thread.id);
    const run = {
      id: draftRunId, jobId: draftJobId, kind: 'assistant.email_draft', state: 'completed', stage: 'completed', progress: 100,
      connectionId, subjectRef: thread.id,
      output: { subject: 'Re: Board pack review', body: 'Hi Ada,\n\nI will review the revised section and confirm by Friday.\n\nRegards,\nMichael', rationale: 'Answers the request without adding an unsupported commitment.', safetyFlags: [] },
      draft: { subject: 'Re: Board pack review', body: 'Hi Ada,\n\nI will review the revised section and confirm by Friday.\n\nRegards,\nMichael', revision: 1, updatedAt: now },
      runtime: { provider: 'terra', model: 'gpt-5.6-terra', usage: { totalTokens: 355 }, latencyMs: 810 }, error: null,
      createdAt: now, completedAt: now, updatedAt: now
    };
    runs = [run, ...runs];
    return json(route, { run, jobId: run.jobId, state: run.state, statusUrl: `/api/assistant/runs/${run.id}` }, 202);
  });
  await page.route(`**/api/assistant/runs/${draftRunId}/draft`, async (route) => {
    const body = await route.request().postDataJSON();
    savedDraftBody = body.body;
    const run = runs.find((item) => item.id === draftRunId);
    run.draft = { ...run.draft, subject: body.subject, body: body.body, revision: 2, updatedAt: now };
    return json(route, run);
  });
  await page.route(`**/api/assistant/mailbox/threads/${thread.id}/reply`, async (route) => {
    const body = await route.request().postDataJSON();
    expect(body).toEqual({ connectionId, runId: draftRunId, revision: 2, mode: 'reply', confirmation: 'send' });
    const run = runs.find((item) => item.id === draftRunId);
    run.externalDispatched = true;
    run.delivery = { sentAt: now, messageId: 'sent-message-1', recipients: ['ada@example.com'], mode: 'reply' };
    return json(route, { run, delivery: run.delivery, idempotent: false }, 201);
  });
  await page.route(/\/api\/assistant\/runs\/knowledge-answer$/, async (route) => {
    const request = await route.request().postDataJSON();
    expect(request.sourceRefs).toEqual(['survey-insight:customer-risk']);
    expect(request.knowledgeBaseIds).toEqual([]);
    const run = {
      id: knowledgeRunId, jobId: knowledgeJobId, kind: 'assistant.knowledge_answer', state: 'completed', stage: 'completed', progress: 100,
      sourceRefs: request.sourceRefs, output: { answer: 'Delayed issue resolution is the strongest supported risk.', citations: [{ sourceRef: sources[0].ref, excerpt: 'Customers report delayed issue resolution.' }] },
      runtime: { provider: 'terra', model: 'gpt-5.6-terra', usage: { totalTokens: 288 }, latencyMs: 730 }, error: null,
      createdAt: now, completedAt: now, updatedAt: now
    };
    runs = [run, ...runs];
    return json(route, { run, jobId: run.jobId, state: run.state, statusUrl: `/api/assistant/runs/${run.id}` }, 202);
  });

  await signIn(page);
  await openAssistant(page);
  await expect(page.getByLabel('Connected mailbox')).toHaveValue(connectionId);
  await expect(page.getByTestId(`assistant-thread-${thread.id}`)).toHaveAttribute('aria-pressed', 'true');
  await openMailboxAssistant(page, thread.id);

  await page.getByLabel('Ask about this thread').fill('What needs a reply?');
  await page.getByRole('button', { name: 'Ask Terra', exact: true }).click();
  await expect(page.getByText('The revised customer-risk section needs a reply by Friday.')).toBeVisible();
  await expect(page.getByText('412 tokens')).toBeVisible();

  await page.getByRole('tab', { name: 'Reply' }).click();
  await page.getByRole('button', { name: 'Draft reply' }).click();
  await expect(
    page.getByTestId('assistant-run-detail').getByText('Review required', { exact: true }),
  ).toBeVisible();
  const draft = page.getByLabel('Reply', { exact: true });
  if (process.env.CAPTURE_VISUALS) {
    await draft.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('assistant-rich-reply-editor.png'), fullPage: false });
  }
  await draft.fill('Hi Ada,\n\nI have reviewed the section and will send my comments by Friday.\n\nRegards,\nMichael');
  await expect(page.getByRole('toolbar', { name: 'Reply formatting' })).toBeVisible();
  await draft.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.getByRole('button', { name: 'Bold', exact: true }).click();
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect.poll(() => savedDraftBody).toContain('send my comments by Friday');
  expect(savedDraftBody).toContain('<strong>');
  await page.mouse.move(0, 0);
  await expect(page.getByText('Draft saved. Nothing was sent.')).toBeHidden({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Review and send' }).click();
  await expect(page.getByRole('heading', { name: 'Send this reply?' })).toBeVisible();
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(page.getByTestId('assistant-run-detail').getByText('Reply sent', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close assistant' }).click();
  await expect(page.getByRole('button', { name: 'Open assistant' })).toBeVisible();
  await page.getByRole('button', { name: 'Open assistant' }).click();
  await expect(page.getByLabel('Mailbox assistant')).toBeVisible();
  await page.getByRole('button', { name: 'Close assistant' }).click();

  await page.getByRole('tab', { name: 'Workspace knowledge' }).click();
  await page.getByRole('button', { name: /Customer risk review/ }).click();
  await page.getByRole('button', { name: 'Ask from evidence' }).click();
  await expect(page.getByText('Delayed issue resolution is the strongest supported risk.')).toBeVisible();
  await expect(page.getByTestId('assistant-run-detail').getByText('“Customers report delayed issue resolution.”')).toBeVisible();

  await page.getByRole('tab', { name: /History/ }).click();
  await expect(page.getByRole('button', { name: /Knowledge answer/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test('mailbox switching rejects late thread data and retries with the same idempotency key', async ({ page }) => {
  const secondConnectionId = '88888888-8888-4888-8888-888888888888';
  let releaseFirst!: () => void;
  let markFirstStarted!: () => void;
  const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
  const firstReleased = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const firstThread = { id: 'thread-first', subject: 'First mailbox thread', snippet: 'This response should be ignored.', participants: [{ email: 'first@example.com' }], messageCount: 1, lastMessageAt: now };
  const secondThread = { id: 'thread-second', subject: 'Second mailbox thread', snippet: 'This is the selected mailbox.', participants: [{ email: 'second@example.com' }], messageCount: 1, lastMessageAt: now };
  const idempotencyKeys: string[] = [];

  await page.route(/\/api\/assistant\/overview(?:\?.*)?$/, (route) => json(route, {
    configured: true, callbackUrl: 'http://127.0.0.1:5412/api/integrations/nylas/callback',
    connections: [
      { id: connectionId, email: 'first@example.com', displayName: 'First mailbox', provider: 'google', status: 'connected' },
      { id: secondConnectionId, email: 'second@example.com', displayName: 'Second mailbox', provider: 'microsoft', status: 'connected' }
    ],
    worker: { running: true, active: 0, queued: 0, concurrency: 1 }, terra: { ready: true, providerLabel: 'Terra' }
  }));
  await page.route(/\/api\/assistant\/runs(?:\?.*)?$/, (route) => json(route, []));
  await page.route(/\/api\/intelligence\/sources(?:\?.*)?$/, (route) => json(route, []));
  await page.route(/\/api\/assistant\/mailbox\/threads(?:\?.*)?$/, async (route) => {
    const requested = new URL(route.request().url()).searchParams.get('connectionId');
    if (requested === connectionId) {
      markFirstStarted();
      await firstReleased;
      return json(route, { items: [firstThread], nextCursor: null });
    }
    return json(route, { items: [secondThread], nextCursor: null });
  });
  await page.route(/\/api\/assistant\/mailbox\/threads\/[^?]+(?:\?.*)?$/, (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1) || '');
    return json(route, threadDetail(id === secondThread.id ? secondThread : firstThread));
  });
  await page.route(/\/api\/assistant\/runs\/email-summary$/, async (route) => {
    idempotencyKeys.push(route.request().headers()['idempotency-key']);
    if (idempotencyKeys.length === 1) return route.abort('connectionreset');
    const body = await route.request().postDataJSON();
    expect(body).toEqual({ connectionId: secondConnectionId, threadId: secondThread.id });
    return json(route, { jobId: summaryJobId, state: 'queued', statusUrl: `/api/assistant/runs/${summaryRunId}` }, 202);
  });

  await signIn(page);
  await openAssistant(page);
  await firstStarted;
  await selectMailbox(page, secondConnectionId, /Second mailbox/);
  await expect(page.getByTestId(`assistant-thread-${secondThread.id}`)).toBeVisible();
  releaseFirst();
  await expect(page.getByTestId(`assistant-thread-${firstThread.id}`)).toHaveCount(0);
  await openMailboxAssistant(page, secondThread.id);
  await page.getByRole('button', { name: 'Summarise' }).click();
  await expect(page.getByText(/Assistant work could not be queued|Failed to fetch/)).toBeVisible();
  await page.getByRole('button', { name: 'Summarise' }).click();
  await expect.poll(() => idempotencyKeys.length).toBe(2);
  expect(idempotencyKeys[0]).toBeTruthy();
  expect(idempotencyKeys[1]).toBe(idempotencyKeys[0]);
});

test('revoked mailbox history cannot remain selected or retain actionable thread state', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Account revocation controls live in the desktop mailbox rail; mobile mailbox navigation is covered separately.');
  let revoked = false;
  const thread = {
    id: 'thread-before-revoke', subject: 'Thread that must be cleared', snippet: 'This thread is no longer available after disconnect.',
    participants: [{ email: 'sender@example.com' }], messageCount: 2, lastMessageAt: now
  };
  await page.route(/\/api\/assistant\/overview(?:\?.*)?$/, (route) => json(route, {
    configured: true,
    callbackUrl: 'http://127.0.0.1:5412/api/integrations/nylas/callback',
    connections: [{
      id: connectionId, email: 'revoked@example.com', displayName: 'Revoked mailbox', provider: 'google',
      status: revoked ? 'revoked' : 'connected'
    }],
    worker: { running: true, active: 0, queued: 0, concurrency: 1 },
    terra: { ready: true, providerLabel: 'Terra' }
  }));
  await page.route(/\/api\/assistant\/runs(?:\?.*)?$/, (route) => json(route, []));
  await page.route(/\/api\/intelligence\/sources(?:\?.*)?$/, (route) => json(route, []));
  await page.route(/\/api\/assistant\/mailbox\/threads(?:\?.*)?$/, (route) =>
    json(route, { items: [thread], nextCursor: null }));
  await page.route(/\/api\/assistant\/mailbox\/threads\/[^?]+(?:\?.*)?$/, (route) =>
    json(route, threadDetail(thread)));
  await page.route(`**/api/assistant/nylas/connections/${connectionId}`, async (route) => {
    expect(route.request().method()).toBe('DELETE');
    revoked = true;
    await route.fulfill({ status: 204, body: '' });
  });

  await signIn(page);
  await openAssistant(page);
  await expect(page.getByTestId(`assistant-thread-${thread.id}`)).toBeVisible();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByLabel('Mailbox accounts').click();
  await page.getByRole('button', { name: 'Disconnect current', exact: true }).click();

  const mailbox = page.getByRole('button', { name: /Revoked mailbox.*revoked@example\.com/i });
  await expect(mailbox).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Connect your mailbox' })).toBeVisible();
  await expect(page.getByTestId(`assistant-thread-${thread.id}`)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open assistant' })).toHaveCount(0);
});

test('personal assistant explains missing Nylas setup without exposing a doomed mailbox action', async ({ page }) => {
  await page.route(/\/api\/assistant\/overview(?:\?.*)?$/, (route) => json(route, {
    configured: false,
    callbackUrl: 'https://experience.aiinnigeria.com/api/integrations/nylas/callback',
    configurationError: 'Nylas application credentials are unavailable.',
    connections: [], worker: { running: true, active: 0, queued: 0, concurrency: 4 },
    terra: { ready: true, providerLabel: 'Terra (Experience managed)' }
  }));
  await page.route(/\/api\/assistant\/runs(?:\?.*)?$/, (route) => json(route, []));
  await page.route(/\/api\/intelligence\/sources(?:\?.*)?$/, (route) => json(route, []));

  await signIn(page);
  await openAssistant(page);
  await expect(page.getByRole('heading', { name: 'Mailbox setup needs attention' })).toBeVisible();
  await expect(page.getByText('https://experience.aiinnigeria.com/api/integrations/nylas/callback')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect Google' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Connect Microsoft' })).toBeDisabled();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByLabel('Mailbox conversations')).toHaveCount(0);
});
