import { expect, test, type Page, type Route } from '@playwright/test';

const now = '2026-07-31T09:30:00.000Z';
const connectionId = '10111111-1111-4111-8111-111111111111';
const knowledgeBaseId = '20222222-2222-4222-8222-222222222222';
const sourceRef = 'survey:quarterly-experience';
const actionId = '30333333-3333-4333-8333-333333333333';
const reminderId = '40444444-4444-4444-8444-444444444444';
const secondActionId = '50555555-5555-4555-8555-555555555555';
const secondReminderId = '60666666-6666-4666-8666-666666666666';
const calendarId = 'executive-calendar';
const calendarEventId = 'quarterly-risk-committee';

const requiredDocumentTypes = [
  ['memo', 'Memo'],
  ['board_paper', 'Board paper'],
  ['meeting_pack', 'Meeting pack'],
  ['meeting_minutes', 'Meeting minutes'],
  ['policy_lookup', 'Policy lookup'],
  ['cross_document_summary', 'Cross-document summary']
] as const;

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

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

function workProductRun(index: number, body: Record<string, any>) {
  const suffix = String(index + 10).padStart(2, '0');
  const id = `${suffix.repeat(4)}-${suffix.repeat(2)}-4${suffix.slice(1).repeat(3)}-8${suffix.slice(1).repeat(3)}-${suffix.repeat(6)}`;
  const jobId = `${suffix.repeat(4)}-${suffix.repeat(2)}-4${suffix.slice(1).repeat(3)}-9${suffix.slice(1).repeat(3)}-${suffix.repeat(6)}`;
  return {
    id,
    jobId,
    kind: 'assistant.work_product',
    state: 'completed',
    stage: 'completed',
    progress: 100,
    connectionId: body.threadConnectionId || body.calendarConnectionId || null,
    subjectRef: body.threadId || body.calendarEventId || null,
    sourceRefs: body.sourceRefs,
    knowledgeBaseIds: body.knowledgeBaseIds,
    documentType: body.documentType,
    title: body.title,
    output: {
      title: body.title,
      executiveSummary: `${body.title} is ready for executive review.`,
      body: `Grounded ${body.documentType} body based on the selected evidence.`,
      decisions: ['Approve the remediation sequence.'],
      actionItems: [{
        action: `Confirm the owner for ${body.title}`,
        owner: 'Risk office',
        dueDate: '2026-08-05',
        sourceRef: body.sourceRefs[0] || 'calendar:event'
      }],
      citations: [{
        sourceRef: body.sourceRefs[0] || 'calendar:event',
        excerpt: 'Evidence retained with the generated work product.'
      }],
      limitations: ['Human review is required before circulation.']
    },
    generatedDraft: {
      subject: body.title,
      body: `Grounded ${body.documentType} body based on the selected evidence.`
    },
    draft: {
      subject: body.title,
      body: `Grounded ${body.documentType} body based on the selected evidence.`,
      revision: 1,
      updatedAt: now
    },
    runtime: { provider: 'terra', model: 'gpt-5.6-terra', usage: { totalTokens: 720 } },
    advisoryOnly: true,
    externalDispatched: false,
    error: null,
    createdAt: now,
    completedAt: now,
    updatedAt: now
  };
}

test('work products cover the executive document set, promote explicit actions, and persist action and reminder edits', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop exercises the dense work-product and action management workspace.');

  let runs: any[] = [];
  let actions: any[] = [];
  let reminders: any[] = [];
  const workProductRequests: Array<Record<string, any>> = [];
  const knowledgeAnswerRequests: Array<Record<string, any>> = [];
  const promotedRequests: Array<Record<string, any>> = [];
  const actionUpdates: Array<Record<string, any>> = [];
  const reminderCreates: Array<Record<string, any>> = [];
  const reminderUpdates: Array<Record<string, any>> = [];

  await page.route(/\/api\/assistant\/overview(?:\?.*)?$/, (route) => json(route, {
    configured: true,
    callbackUrl: 'http://127.0.0.1:5412/api/integrations/nylas/callback',
    connections: [{
      id: connectionId,
      email: 'michael@example.test',
      displayName: 'Executive mailbox',
      provider: 'google',
      status: 'connected',
      scopes: ['email.read_only']
    }],
    worker: { running: true, active: 0, queued: 0, concurrency: 4 },
    terra: { ready: true, providerLabel: 'Terra (Experience managed)' }
  }));
  await page.route(/\/api\/assistant\/runs(?:\?.*)?$/, (route) => json(route, runs));
  await page.route(/\/api\/assistant\/mailbox\/threads(?:\?.*)?$/, (route) =>
    json(route, { items: [], nextCursor: null }));
  await page.route(/\/api\/intelligence\/sources(?:\?.*)?$/, (route) => json(route, [{
    ref: sourceRef,
    type: 'survey',
    title: 'Quarterly experience findings',
    kind: 'executive_report',
    createdAt: now,
    preview: 'Service recovery ownership and board escalation evidence.'
  }]));
  await page.route(/\/api\/knowledge-bases(?:\?.*)?$/, (route) => json(route, {
    knowledgeBases: [{
      id: knowledgeBaseId,
      name: 'Operating policy library',
      description: 'Current approved policies',
      privacy: 'space',
      terraContextEnabled: true,
      state: 'ready',
      documentCount: 3,
      readyDocumentCount: 3,
      chunkCount: 18,
      entityCount: 11,
      relationshipCount: 9,
      storageBytes: 24_000,
      createdAt: now,
      updatedAt: now,
      lastIndexedAt: now
    }]
  }));
  await page.route(/\/api\/assistant\/audit(?:\?.*)?$/, (route) => json(route, {
    items: [
      {
        id: 'audit-action',
        action: 'assistant.action.updated',
        targetType: 'action',
        targetId: actionId,
        detail: { status: 'in_progress' },
        createdAt: now
      },
      {
        id: 'audit-reminder',
        action: 'assistant.reminder.updated',
        targetType: 'reminder',
        targetId: reminderId,
        detail: { state: 'scheduled' },
        createdAt: now
      }
    ]
  }));
  await page.route(/\/api\/assistant\/actions(?:\?.*)?$/, async (route) => {
    const method = route.request().method();
    if (method === 'GET') return json(route, { items: actions });
    if (method === 'PATCH') {
      const input = await route.request().postDataJSON();
      actionUpdates.push(input);
      const current = actions.find((item) => item.id === input.id);
      expect(current).toBeTruthy();
      expect(input.revision).toBe(current.revision);
      const action = {
        ...current,
        ...input,
        revision: current.revision + 1,
        updatedAt: now
      };
      actions = actions.map((item) => item.id === action.id ? action : item);
      return json(route, { action });
    }
    return json(route, { error: 'Unexpected action operation' }, 405);
  });
  await page.route(/\/api\/assistant\/actions\/from-run$/, async (route) => {
    const input = await route.request().postDataJSON();
    promotedRequests.push(input);
    const run = runs.find((item) => item.id === input.runId);
    expect(run).toBeTruthy();
    const proposed = run.output.actionItems[input.actionIndex];
    const action = {
      id: actionId,
      sourceRunId: run.id,
      sourceItemIndex: input.actionIndex,
      title: proposed.action,
      description: `Promoted from ${run.title}`,
      owner: input.owner || proposed.owner,
      status: 'open',
      priority: input.priority || 'normal',
      dueAt: input.dueAt || '2026-08-05T17:00:00.000Z',
      revision: 1,
      completedAt: null,
      createdAt: now,
      updatedAt: now
    };
    const created = !actions.some((item) => item.id === action.id);
    if (created) actions = [action, ...actions];
    return json(route, { action, created }, created ? 201 : 200);
  });
  await page.route(new RegExp(`/api/assistant/actions/${actionId}/reminders$`), async (route) => {
    if (route.request().method() === 'GET') return json(route, { items: reminders });
    const input = await route.request().postDataJSON();
    reminderCreates.push(input);
    const reminder = {
      id: reminderId,
      actionId,
      remindAt: input.remindAt,
      note: input.note,
      state: 'scheduled',
      revision: 1,
      deliveredAt: null,
      createdAt: now,
      updatedAt: now
    };
    reminders = [reminder];
    return json(route, { reminder }, 201);
  });
  await page.route(new RegExp(`/api/assistant/actions/${actionId}/reminders/${reminderId}$`), async (route) => {
    const input = await route.request().postDataJSON();
    reminderUpdates.push(input);
    expect(input.revision).toBe(reminders[0].revision);
    const reminder = {
      ...reminders[0],
      ...input,
      revision: reminders[0].revision + 1,
      updatedAt: now
    };
    reminders = [reminder];
    return json(route, { reminder });
  });
  await page.route(/\/api\/assistant\/runs\/work-product$/, async (route) => {
    const input = await route.request().postDataJSON();
    workProductRequests.push(input);
    const run = workProductRun(workProductRequests.length, input);
    runs = [run, ...runs];
    return json(route, {
      run,
      jobId: run.jobId,
      state: run.state,
      statusUrl: `/api/assistant/runs/${run.id}`
    }, 202);
  });
  await page.route(/\/api\/assistant\/runs\/knowledge-answer$/, async (route) => {
    const input = await route.request().postDataJSON();
    knowledgeAnswerRequests.push(input);
    const run = {
      id: '71717171-7171-4717-8171-717171717171',
      jobId: '72727272-7272-4727-8272-727272727272',
      kind: 'assistant.knowledge_answer',
      state: 'completed',
      stage: 'completed',
      progress: 100,
      connectionId: null,
      subjectRef: null,
      sourceRefs: ['knowledge:operating-policy'],
      knowledgeBaseIds: input.knowledgeBaseIds,
      output: {
        answer: 'The approved operating policy requires human review [knowledge:operating-policy].',
        citations: [{
          sourceRef: 'knowledge:operating-policy',
          excerpt: 'The approved operating policy requires human review.'
        }]
      },
      runtime: { provider: 'terra', model: 'gpt-5.6-terra', usage: { totalTokens: 320 } },
      advisoryOnly: true,
      externalDispatched: false,
      error: null,
      createdAt: now,
      completedAt: now,
      updatedAt: now
    };
    runs = [run, ...runs];
    return json(route, {
      run,
      jobId: run.jobId,
      state: run.state,
      statusUrl: `/api/assistant/runs/${run.id}`
    }, 202);
  });

  await signIn(page);
  await openAssistant(page);
  await page.getByRole('tab', { name: 'Work products' }).click();

  const typeSelect = page.getByLabel('Work product type');
  await expect(typeSelect).toBeVisible();
  const optionValues = await typeSelect.locator('option').evaluateAll((options) =>
    options.map((option) => ({ value: (option as HTMLOptionElement).value, label: option.textContent?.trim() })));
  for (const [value, label] of requiredDocumentTypes) {
    expect(optionValues).toContainEqual({ value, label });
  }

  await page.getByRole('button', { name: /Quarterly experience findings/ }).click();
  for (const [documentType, label] of requiredDocumentTypes) {
    const title = `${label} acceptance output`;
    await typeSelect.selectOption(documentType);
    await page.getByLabel('Work product title').fill(title);
    await page.getByLabel('Objective').fill(`Prepare the ${label.toLowerCase()} for management review.`);
    if (documentType === 'board_paper') {
      await page.getByLabel('Editable work product').fill('Unsaved edits to the first work product.');
      let discardGuardSeen = false;
      await Promise.all([
        page.waitForEvent('dialog').then(async (dialog) => {
          discardGuardSeen = true;
          expect(dialog.message()).toContain('Discard the unsaved changes');
          await dialog.dismiss();
        }),
        page.getByRole('button', { name: 'Generate work product' }).click()
      ]);
      await expect.poll(() => discardGuardSeen).toBe(true);
      expect(workProductRequests).toHaveLength(1);
      await expect(page.getByLabel('Editable work product')).toHaveValue('Unsaved edits to the first work product.');
      await Promise.all([
        page.waitForEvent('dialog').then((dialog) => dialog.accept()),
        page.getByRole('button', { name: 'Generate work product' }).click()
      ]);
    } else {
      await page.getByRole('button', { name: 'Generate work product' }).click();
    }
    await expect(page.getByTestId('assistant-work-product-detail')).toContainText(title);
  }

  expect(workProductRequests.map((input) => input.documentType)).toEqual(
    requiredDocumentTypes.map(([value]) => value)
  );
  for (const input of workProductRequests) {
    expect(input.sourceRefs).toEqual([sourceRef]);
    expect(input.knowledgeBaseIds).toEqual([]);
  }
  await expect(page.getByRole('button', { name: /^Send$/ })).toHaveCount(0);

  await page.getByRole('tab', { name: 'Workspace knowledge' }).click();
  await page.getByRole('button', { name: /Operating policy library/ }).click();
  await page.getByLabel('Question').fill('What does the approved operating policy require?');
  await page.getByRole('button', { name: 'Ask from evidence' }).click();
  await expect.poll(() => knowledgeAnswerRequests.length).toBe(1);
  expect(knowledgeAnswerRequests[0]).toEqual({
    question: 'What does the approved operating policy require?',
    sourceRefs: [],
    knowledgeBaseIds: [knowledgeBaseId]
  });
  await expect(page.getByTestId('assistant-run-detail')).toContainText('The approved operating policy requires human review');

  await page.getByRole('tab', { name: 'Work products' }).click();
  await expect(page.getByTestId('assistant-work-product-detail')).toContainText('Cross-document summary acceptance output');
  await page.getByRole('button', { name: 'Add to actions' }).click();
  await expect.poll(() => promotedRequests.length).toBe(1);
  const promotedWorkProduct = runs.find((run) => run.kind === 'assistant.work_product');
  expect(promotedWorkProduct).toBeTruthy();
  expect(promotedRequests[0]).toEqual(expect.objectContaining({
    runId: promotedWorkProduct!.id,
    actionIndex: 0,
    owner: 'Risk office'
  }));

  await page.getByRole('tab', { name: /Actions/ }).click();
  const actionCard = page.getByTestId(`assistant-action-${actionId}`);
  await expect(actionCard).toBeVisible();
  await actionCard.getByLabel('Action status').selectOption('in_progress');
  await actionCard.getByLabel('Owner').fill('Chief operating officer');
  await actionCard.getByLabel('Priority').selectOption('high');
  await actionCard.getByLabel('Due date').fill('2026-08-07T16:30');
  await actionCard.getByRole('button', { name: 'Save action' }).click();

  await expect.poll(() => actionUpdates.length).toBe(1);
  expect(actionUpdates[0]).toEqual(expect.objectContaining({
    id: actionId,
    revision: 1,
    status: 'in_progress',
    owner: 'Chief operating officer',
    priority: 'high'
  }));
  // Wait for the saved action to replace the revision-keyed editor before
  // entering reminder values; otherwise the in-flight remount can discard them.
  await expect(actionCard).toContainText('Revision 2');

  await actionCard.getByLabel('Reminder date and time').fill('2026-08-06T09:15');
  await actionCard.getByLabel('Reminder note').fill('Escalate at the morning operations review.');
  const addReminderButton = actionCard.getByRole('button', { name: 'Add reminder' });
  await expect(addReminderButton).toBeEnabled();
  await addReminderButton.click();
  await expect.poll(() => reminderCreates.length).toBe(1);
  expect(reminderCreates[0].note).toBe('Escalate at the morning operations review.');
  expect(new Date(reminderCreates[0].remindAt).toISOString()).toBe(reminderCreates[0].remindAt);

  const reminderCard = page.getByTestId(`assistant-reminder-${reminderId}`);
  await expect(reminderCard).toBeVisible();
  await reminderCard.getByLabel('Reminder note').fill('Review the escalation before the executive meeting.');
  await reminderCard.getByRole('button', { name: 'Save reminder' }).click();
  await expect.poll(() => reminderUpdates.length).toBe(1);
  expect(reminderUpdates[0]).toEqual(expect.objectContaining({
    revision: 1,
    note: 'Review the escalation before the executive meeting.',
    state: 'scheduled'
  }));

  await page.getByRole('tab', { name: 'Audit' }).click();
  await expect(page.getByText('assistant.action.updated')).toBeVisible();
  await expect(page.getByText('assistant.reminder.updated')).toBeVisible();
});

test('calendar evidence carries both calendar and event identifiers into a meeting pack', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop verifies the calendar-to-work-product handoff.');

  let runs: any[] = [];
  const requests: Array<Record<string, any>> = [];
  await page.route(/\/api\/assistant\/overview(?:\?.*)?$/, (route) => json(route, {
    configured: true,
    connections: [{
      id: connectionId,
      email: 'michael@example.test',
      displayName: 'Executive mailbox',
      provider: 'google',
      status: 'connected'
    }],
    worker: { running: true, active: 0, queued: 0, concurrency: 4 },
    terra: { ready: true, providerLabel: 'Terra (Experience managed)' }
  }));
  await page.route(/\/api\/assistant\/runs(?:\?.*)?$/, (route) => json(route, runs));
  await page.route(/\/api\/assistant\/mailbox\/threads(?:\?.*)?$/, (route) =>
    json(route, { items: [], nextCursor: null }));
  await page.route(/\/api\/intelligence\/sources(?:\?.*)?$/, (route) => json(route, []));
  await page.route(/\/api\/knowledge-bases(?:\?.*)?$/, (route) => json(route, { knowledgeBases: [] }));
  await page.route(/\/api\/assistant\/actions(?:\?.*)?$/, (route) => json(route, { items: [] }));
  await page.route(/\/api\/assistant\/audit(?:\?.*)?$/, (route) => json(route, { items: [] }));
  await page.route(/\/api\/assistant\/calendar\/calendars(?:\?.*)?$/, (route) => {
    expect(new URL(route.request().url()).searchParams.get('connectionId')).toBe(connectionId);
    return json(route, { items: [{
      id: calendarId,
      name: 'Executive calendar',
      description: 'Leadership events',
      readOnly: true,
      primary: true,
      timezone: 'Europe/London'
    }] });
  });
  await page.route(/\/api\/assistant\/calendar\/events(?:\?.*)?$/, (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get('connectionId')).toBe(connectionId);
    expect(url.searchParams.get('calendarId')).toBe(calendarId);
    return json(route, { items: [{
      id: calendarEventId,
      calendarId,
      title: 'Quarterly risk committee',
      description: 'Review operating risk and remediation.',
      location: 'Boardroom',
      startAt: '2026-08-12T09:00:00.000Z',
      endAt: '2026-08-12T10:00:00.000Z',
      status: 'confirmed',
      busy: true,
      participants: [{ name: 'Ada Okafor', email: 'ada@example.test' }]
    }], nextCursor: null });
  });
  await page.route(/\/api\/assistant\/runs\/work-product$/, async (route) => {
    const input = await route.request().postDataJSON();
    requests.push(input);
    const run = workProductRun(30, input);
    runs = [run];
    return json(route, {
      run,
      jobId: run.jobId,
      state: run.state,
      statusUrl: `/api/assistant/runs/${run.id}`
    }, 202);
  });

  await signIn(page);
  await openAssistant(page);
  await page.getByRole('tab', { name: 'Calendar' }).click();
  await expect(page.getByText('Quarterly risk committee')).toBeVisible();
  await page.getByRole('button', { name: /Use.*meeting pack/i }).click();

  await expect(page.getByLabel('Work product type')).toHaveValue('meeting_pack');
  await page.getByRole('button', { name: 'Generate work product' }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toEqual(expect.objectContaining({
    documentType: 'meeting_pack',
    calendarConnectionId: connectionId,
    calendarId,
    calendarEventId,
    sourceRefs: [],
    knowledgeBaseIds: []
  }));
  await expect(page.getByTestId('assistant-work-product-detail')).toContainText('Quarterly risk committee');
});

test('reminder and calendar loaders ignore late responses from superseded selections', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop exercises concurrent action and calendar selection panes.');

  let releaseFirstReminders!: () => void;
  let markFirstRemindersStarted!: () => void;
  const firstRemindersStarted = new Promise<void>((resolve) => { markFirstRemindersStarted = resolve; });
  const firstRemindersReleased = new Promise<void>((resolve) => { releaseFirstReminders = resolve; });
  let releaseFirstCalendars!: () => void;
  let markFirstCalendarsStarted!: () => void;
  const firstCalendarsStarted = new Promise<void>((resolve) => { markFirstCalendarsStarted = resolve; });
  const firstCalendarsReleased = new Promise<void>((resolve) => { releaseFirstCalendars = resolve; });
  let releasePrimaryEvents!: () => void;
  let markPrimaryEventsStarted!: () => void;
  const primaryEventsStarted = new Promise<void>((resolve) => { markPrimaryEventsStarted = resolve; });
  const primaryEventsReleased = new Promise<void>((resolve) => { releasePrimaryEvents = resolve; });

  const secondConnectionId = '70777777-7777-4777-8777-777777777777';
  const actions = [
    {
      id: actionId,
      sourceRunId: null,
      sourceItemIndex: null,
      title: 'First account follow-up',
      description: '',
      owner: 'Risk office',
      status: 'open',
      priority: 'normal',
      dueAt: null,
      revision: 1,
      createdAt: now,
      updatedAt: now
    },
    {
      id: secondActionId,
      sourceRunId: null,
      sourceItemIndex: null,
      title: 'Current account follow-up',
      description: '',
      owner: 'Operations',
      status: 'open',
      priority: 'high',
      dueAt: null,
      revision: 1,
      createdAt: now,
      updatedAt: now
    }
  ];
  const staleReminder = {
    id: reminderId,
    actionId,
    remindAt: '2026-08-05T09:00:00.000Z',
    note: 'Stale first-action reminder',
    state: 'scheduled',
    revision: 1,
    createdAt: now,
    updatedAt: now
  };
  const currentReminder = {
    id: secondReminderId,
    actionId: secondActionId,
    remindAt: '2026-08-06T09:00:00.000Z',
    note: 'Current second-action reminder',
    state: 'scheduled',
    revision: 1,
    createdAt: now,
    updatedAt: now
  };

  await page.route(/\/api\/assistant\/overview(?:\?.*)?$/, (route) => json(route, {
    configured: true,
    connections: [
      { id: connectionId, email: 'first@example.test', displayName: 'First mailbox', provider: 'google', status: 'connected' },
      { id: secondConnectionId, email: 'second@example.test', displayName: 'Second mailbox', provider: 'microsoft', status: 'connected' }
    ],
    worker: { running: true, active: 0, queued: 0, concurrency: 4 },
    terra: { ready: true, providerLabel: 'Terra (Experience managed)' }
  }));
  await page.route(/\/api\/assistant\/runs(?:\?.*)?$/, (route) => json(route, []));
  await page.route(/\/api\/assistant\/mailbox\/threads(?:\?.*)?$/, (route) => json(route, { items: [], nextCursor: null }));
  await page.route(/\/api\/intelligence\/sources(?:\?.*)?$/, (route) => json(route, []));
  await page.route(/\/api\/knowledge-bases(?:\?.*)?$/, (route) => json(route, { knowledgeBases: [] }));
  await page.route(/\/api\/assistant\/actions(?:\?.*)?$/, (route) => json(route, { items: actions }));
  await page.route(/\/api\/assistant\/audit(?:\?.*)?$/, (route) => json(route, { items: [] }));
  await page.route(/\/api\/assistant\/actions\/[^/]+\/reminders$/, async (route) => {
    const action = new URL(route.request().url()).pathname.split('/').at(-2);
    if (action === actionId) {
      markFirstRemindersStarted();
      await firstRemindersReleased;
      return json(route, { items: [staleReminder] });
    }
    return json(route, { items: [currentReminder] });
  });
  await page.route(/\/api\/assistant\/calendar\/calendars(?:\?.*)?$/, async (route) => {
    const selectedConnection = new URL(route.request().url()).searchParams.get('connectionId');
    if (selectedConnection === connectionId) {
      markFirstCalendarsStarted();
      await firstCalendarsReleased;
      return json(route, { items: [{
        id: 'stale-calendar',
        name: 'Stale first calendar',
        description: '',
        readOnly: true,
        primary: true,
        timezone: 'Europe/London'
      }] });
    }
    return json(route, { items: [
      {
        id: 'current-primary',
        name: 'Current primary calendar',
        description: '',
        readOnly: true,
        primary: true,
        timezone: 'Europe/London'
      },
      {
        id: 'current-secondary',
        name: 'Current secondary calendar',
        description: '',
        readOnly: true,
        primary: false,
        timezone: 'Europe/London'
      }
    ] });
  });
  await page.route(/\/api\/assistant\/calendar\/events(?:\?.*)?$/, async (route) => {
    const selectedCalendar = new URL(route.request().url()).searchParams.get('calendarId');
    if (selectedCalendar === 'current-primary') {
      markPrimaryEventsStarted();
      await primaryEventsReleased;
      return json(route, { items: [{
        id: 'stale-primary-event',
        calendarId: 'current-primary',
        title: 'Stale primary-calendar event',
        description: '',
        location: '',
        startAt: '2026-08-10T09:00:00.000Z',
        endAt: '2026-08-10T10:00:00.000Z',
        status: 'confirmed',
        busy: true,
        participants: []
      }], nextCursor: null });
    }
    return json(route, { items: [{
      id: 'current-secondary-event',
      calendarId: 'current-secondary',
      title: 'Current secondary-calendar event',
      description: '',
      location: '',
      startAt: '2026-08-11T09:00:00.000Z',
      endAt: '2026-08-11T10:00:00.000Z',
      status: 'confirmed',
      busy: true,
      participants: []
    }], nextCursor: null });
  });

  await signIn(page);
  await openAssistant(page);
  await firstRemindersStarted;
  await page.getByRole('tab', { name: /Actions/ }).click();
  await page.getByRole('button', { name: /Current account follow-up/ }).click();
  await expect(page.getByTestId(`assistant-reminder-${secondReminderId}`).getByLabel('Reminder note'))
    .toHaveValue('Current second-action reminder');
  releaseFirstReminders();
  await expect(page.getByTestId(`assistant-reminder-${reminderId}`)).toHaveCount(0);
  await expect(page.getByTestId(`assistant-reminder-${secondReminderId}`)).toBeVisible();

  await page.getByRole('tab', { name: 'Calendar' }).click();
  await firstCalendarsStarted;
  await page.getByLabel('Calendar mailbox').selectOption(secondConnectionId);
  const calendarSelect = page.locator('#assistant-calendar-id');
  await expect(calendarSelect.locator('option')).toContainText(['Current primary calendar (primary)', 'Current secondary calendar']);
  releaseFirstCalendars();
  await expect(calendarSelect.locator('option', { hasText: 'Stale first calendar' })).toHaveCount(0);

  await primaryEventsStarted;
  await calendarSelect.selectOption('current-secondary');
  await expect(page.getByText('Current secondary-calendar event')).toBeVisible();
  releasePrimaryEvents();
  await expect(page.getByText('Stale primary-calendar event')).toHaveCount(0);
  await expect(page.getByText('Current secondary-calendar event')).toBeVisible();
});

test('work products submit mailbox and calendar account identifiers explicitly', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'Desktop verifies the mailbox/calendar evidence composer.');

  const calendarConnectionId = '80888888-8888-4888-8888-888888888888';
  const mailboxThread = {
    id: 'first-mailbox-thread',
    subject: 'Executive remediation review',
    snippet: 'Current remediation evidence.',
    participants: [{ name: 'Ada Okafor', email: 'ada@example.test' }],
    messageCount: 1,
    lastMessageAt: now,
    unread: false,
    starred: false,
    hasAttachments: false,
    attachmentCount: 0,
    labels: ['inbox']
  };
  let runs: any[] = [];
  const requests: Array<Record<string, any>> = [];

  await page.route(/\/api\/assistant\/overview(?:\?.*)?$/, (route) => json(route, {
    configured: true,
    connections: [
      { id: connectionId, email: 'mail@example.test', displayName: 'Mail account', provider: 'google', status: 'connected' },
      { id: calendarConnectionId, email: 'calendar@example.test', displayName: 'Calendar account', provider: 'microsoft', status: 'connected' }
    ],
    worker: { running: true, active: 0, queued: 0, concurrency: 4 },
    terra: { ready: true, providerLabel: 'Terra (Experience managed)' }
  }));
  await page.route(/\/api\/assistant\/runs(?:\?.*)?$/, (route) => json(route, runs));
  await page.route(/\/api\/assistant\/mailbox\/threads(?:\?.*)?$/, (route) =>
    json(route, { items: [mailboxThread], nextCursor: null }));
  await page.route(/\/api\/assistant\/mailbox\/threads\/first-mailbox-thread(?:\?.*)?$/, (route) => json(route, {
    thread: mailboxThread,
    loadedMessageCount: 1,
    totalMessageCount: 1,
    messagesTruncated: false,
    bytesTruncated: false,
    loadedMessageBytes: 2_048,
    messageBodyByteLimit: 12 * 1024,
    threadByteLimit: 96 * 1024,
    messages: [{
      id: 'mailbox-message',
      subject: mailboxThread.subject,
      from: mailboxThread.participants,
      to: [{ name: 'Michael Egbo', email: 'michael@example.test' }],
      cc: [],
      sentAt: now,
      body: 'Grounded mailbox evidence.',
      bodyTruncated: false,
      attachments: []
    }]
  }));
  await page.route(/\/api\/intelligence\/sources(?:\?.*)?$/, (route) => json(route, []));
  await page.route(/\/api\/knowledge-bases(?:\?.*)?$/, (route) => json(route, { knowledgeBases: [] }));
  await page.route(/\/api\/assistant\/actions(?:\?.*)?$/, (route) => json(route, { items: [] }));
  await page.route(/\/api\/assistant\/audit(?:\?.*)?$/, (route) => json(route, { items: [] }));
  await page.route(/\/api\/assistant\/calendar\/calendars(?:\?.*)?$/, (route) => {
    const selectedConnection = new URL(route.request().url()).searchParams.get('connectionId');
    return json(route, { items: [{
      id: selectedConnection === calendarConnectionId ? 'calendar-account-calendar' : 'mail-account-calendar',
      name: selectedConnection === calendarConnectionId ? 'Calendar account calendar' : 'Mail account calendar',
      description: '',
      readOnly: true,
      primary: true,
      timezone: 'Europe/London'
    }] });
  });
  await page.route(/\/api\/assistant\/calendar\/events(?:\?.*)?$/, (route) => json(route, { items: [{
    id: 'calendar-account-event',
    calendarId: 'calendar-account-calendar',
    title: 'Cross-account committee',
    description: 'Calendar evidence from the second account.',
    location: '',
    startAt: '2026-08-13T09:00:00.000Z',
    endAt: '2026-08-13T10:00:00.000Z',
    status: 'confirmed',
    busy: true,
    participants: []
  }], nextCursor: null }));
  await page.route(/\/api\/assistant\/runs\/work-product$/, async (route) => {
    const input = await route.request().postDataJSON();
    requests.push(input);
    const run = workProductRun(45, input);
    runs = [run];
    return json(route, {
      run,
      jobId: run.jobId,
      state: run.state,
      statusUrl: `/api/assistant/runs/${run.id}`
    }, 202);
  });

  await signIn(page);
  await openAssistant(page);
  await expect(page.getByTestId('assistant-conversation-reader')).toContainText(mailboxThread.subject);
  await page.getByRole('tab', { name: 'Calendar' }).click();
  await page.getByLabel('Calendar mailbox').selectOption(calendarConnectionId);
  await expect(page.getByText('Cross-account committee')).toBeVisible();
  await page.getByRole('button', { name: /Use.*meeting pack/i }).click();
  await page.getByRole('checkbox', { name: /Include selected mailbox conversation/ }).check();
  await page.getByRole('button', { name: 'Generate work product' }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toEqual(expect.objectContaining({
    threadConnectionId: connectionId,
    threadId: mailboxThread.id,
    calendarConnectionId,
    calendarId: 'calendar-account-calendar',
    calendarEventId: 'calendar-account-event'
  }));
  await expect(page.getByTestId('assistant-work-product-detail')).toContainText('Cross-account committee');
});
