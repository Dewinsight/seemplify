import { expect, test, type Locator, type Page, type Request } from '@playwright/test';

interface GoalRecord {
  _id: string;
  title: string;
  type: 'individual';
  ownerId: string;
  period: string;
  periodId: string;
  status: string;
  approvalStatus: string;
  lifecycle: { state: string };
  scoring: { status: string; progress: number | null; ratedKeyResults: number; totalKeyResults: number };
  objectives: Array<{
    title: string;
    weight: number;
    keyResults: Array<Record<string, unknown>>;
  }>;
  permissions: Record<string, boolean>;
}

interface CheckInRecord {
  _id: string;
  employeeId: string;
  cadence: 'weekly' | 'fortnightly' | 'ad_hoc';
  periodStart: string;
  periodEnd: string;
  wins: string[];
  priorities: string[];
  blockers: string[];
  supportNeeded: string[];
  pulse: number;
  visibility: 'employee_manager' | 'employee_only';
  status: 'draft' | 'submitted';
  submittedAt?: string;
}

interface MockApiState {
  futurePeriod: { _id: string; name: string; code: string; startDate: string; endDate: string; status: string };
  goalPeriods: Array<{ _id: string; name: string; code: string; startDate: string; endDate: string; status: string }>;
  generatedGoalPeriodCalls: number;
  goals: GoalRecord[];
  checkIns: CheckInRecord[];
  feedbackItems: Array<Record<string, unknown>>;
  appraisals: Array<Record<string, unknown>>;
  createdGoalBodies: Array<Record<string, unknown>>;
  createdCheckInBodies: Array<Record<string, unknown>>;
  appraisalEvidenceBodies: Array<Record<string, unknown>>;
  notificationPreferenceBodies: Array<Record<string, unknown>>;
  readNotificationIds: string[];
  notificationPreferences: {
    channels: { inApp: true; email: boolean; chat: boolean };
    digest: { frequency: 'immediate' | 'daily' | 'weekly' | 'off'; time: string; dayOfWeek: number };
    quietHours: { enabled: boolean; start: string; end: string };
    timezone: string;
  };
  rolloutFeatures: {
    canonicalAppraisals: boolean;
    goalPeriods: boolean;
    notifications: boolean;
    continuousPerformance: boolean;
  };
  managerMode: boolean;
}

function nextQuarter() {
  const now = new Date();
  let year = now.getFullYear();
  let quarter = Math.floor(now.getMonth() / 3) + 2;
  if (quarter === 5) {
    quarter = 1;
    year += 1;
  }
  const start = new Date(year, (quarter - 1) * 3, 1);
  const end = new Date(year, quarter * 3, 0, 23, 59, 59, 999);
  const name = `Q${quarter} ${year}`;
  return {
    _id: 'future-period',
    name,
    code: name,
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    status: 'upcoming',
  };
}

function createState(): MockApiState {
  const futurePeriod = nextQuarter();
  return {
    futurePeriod,
    goalPeriods: [futurePeriod],
    generatedGoalPeriodCalls: 0,
    goals: [
      {
        _id: 'future-goal-1',
        title: 'Build launch readiness',
        type: 'individual',
        ownerId: 'user-1',
        period: futurePeriod.name,
        periodId: futurePeriod._id,
        status: 'active',
        approvalStatus: 'not_required',
        lifecycle: { state: 'active' },
        scoring: { status: 'unrated', progress: null, ratedKeyResults: 0, totalKeyResults: 1 },
        objectives: [
          {
            title: 'Prepare the launch',
            weight: 100,
            keyResults: [
              {
                _id: 'future-kr-1',
                title: 'Complete launch checklist',
                metricType: 'milestone',
                startValue: 0,
                targetValue: 100,
              },
            ],
          },
        ],
        permissions: {
          view: true,
          edit: true,
          submit: false,
          decide: false,
          acknowledge: false,
          requestChange: true,
          checkIn: true,
          align: true,
        },
      },
    ],
    checkIns: [
      {
        _id: 'check-in-1',
        employeeId: 'user-1',
        cadence: 'weekly',
        periodStart: '2026-08-03T00:00:00.000Z',
        periodEnd: '2026-08-09T23:59:59.999Z',
        wins: ['Shipped manager dashboard'],
        priorities: ['Prepare the next release'],
        blockers: [],
        supportNeeded: [],
        pulse: 4,
        visibility: 'employee_manager',
        status: 'submitted',
        submittedAt: '2026-08-09T10:00:00.000Z',
      },
    ],
    feedbackItems: [
      {
        _id: 'feedback-named',
        sender: 'Taylor Reed',
        senderId: 'sender-1',
        receiver: 'Alex Morgan',
        receiverId: 'user-1',
        type: 'Positive',
        message: 'You kept the launch decision clear and well supported.',
        visibility: 'private',
        contextType: 'project',
        contextLabel: 'Customer launch',
        appraisalEvidence: { included: false, appraisalId: null },
        date: '2026-08-08T10:00:00.000Z',
      },
      {
        _id: 'feedback-anonymous',
        sender: 'Anonymous',
        senderId: null,
        receiver: 'Alex Morgan',
        receiverId: 'user-1',
        type: 'General',
        message: 'Anonymous cohort feedback remains private.',
        visibility: 'private',
        contextType: '360',
        appraisalEvidence: { included: false, appraisalId: null },
        date: '2026-08-07T10:00:00.000Z',
      },
    ],
    appraisals: [
      {
        _id: '507f1f77bcf86cd799439011',
        organizationId: 'org-1',
        status: 'self_assessment_in_progress',
        cycleId: {
          _id: 'cycle-1',
          name: '2026 Annual Review',
          periodStart: '2026-01-01T00:00:00.000Z',
          periodEnd: '2026-12-31T23:59:59.999Z',
        },
      },
    ],
    createdGoalBodies: [],
    createdCheckInBodies: [],
    appraisalEvidenceBodies: [],
    notificationPreferenceBodies: [],
    readNotificationIds: [],
    notificationPreferences: {
      channels: { inApp: true, email: false, chat: false },
      digest: { frequency: 'immediate', time: '09:00', dayOfWeek: 1 },
      quietHours: { enabled: false, start: '22:00', end: '07:00' },
      timezone: 'UTC',
    },
    rolloutFeatures: {
      canonicalAppraisals: true,
      goalPeriods: true,
      notifications: true,
      continuousPerformance: true,
    },
    managerMode: false,
  };
}

const currentUser = {
  id: 'user-1',
  sub: 'user-1',
  email: 'alex@example.com',
  name: 'Alex Morgan',
};

async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  return request.postDataJSON() as Record<string, unknown>;
}

function muiSelect(scope: Locator, label: string) {
  return scope.locator('label').filter({ hasText: label }).first().locator('..').getByRole('combobox');
}

async function installMockApi(page: Page, state: MockApiState) {
  await page.addInitScript(() => {
    localStorage.setItem('accessToken', 'playwright-access-token');
    const NativeWebSocket = window.WebSocket;

    class StableWebSocket {
      static OPEN = 1;
      readyState = StableWebSocket.OPEN;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onclose: ((event: CloseEvent) => void) | null = null;

      constructor() {
        window.setTimeout(() => this.onopen?.(new Event('open')), 0);
      }

      send() {}
      close() {}
    }

    const RoutedWebSocket = new Proxy(NativeWebSocket, {
      construct(Target, args) {
        if (String(args[0]).includes('/__mock-ws')) return new StableWebSocket();
        return Reflect.construct(Target, args);
      },
    });

    Object.defineProperty(window, 'WebSocket', { configurable: true, value: RoutedWebSocket });
  });

  await page.route('**/__mock-api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.slice('/__mock-api'.length);
    const method = request.method();
    const fulfill = (payload: unknown, status = 200) => route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });

    if (method === 'GET' && path === '/auth/me') {
      return fulfill({
        success: true,
        user: {
          ...currentUser,
          idpOrganizations: [{ id: 'org-1', name: 'Acme Ltd', role: 'employee' }],
          organizations: [{ id: 'org-1', name: 'Acme Ltd', role: 'employee' }],
          teams: [],
          idpTeams: [],
        },
        currentOrganizationId: 'org-1',
        currentOrganization: { id: 'org-1', name: 'Acme Ltd', role: 'employee' },
      });
    }
    if (method === 'GET' && path === '/user/context') {
      const role = state.managerMode
        ? { name: 'line_manager', displayName: 'Line Manager', isManager: true, isHRAdmin: false, isTeamLead: true }
        : { name: 'employee', displayName: 'Employee', isManager: false, isHRAdmin: false, isTeamLead: false };
      return fulfill({
        success: true,
        data: {
          user: currentUser,
          role,
          organization: { id: 'org-1', name: 'Acme Ltd' },
          teams: state.managerMode ? [{ id: 'team-1', name: 'Customer Success', role: 'line_manager', isManager: true, organizationId: 'org-1' }] : [],
          currentTeam: state.managerMode ? { id: 'team-1', name: 'Customer Success' } : null,
          stats: { myOkrs: state.goals.length, myReviews: 0, feedbackReceived: 0 },
          features: state.rolloutFeatures,
        },
      });
    }
    if (method === 'GET' && path === '/user/current-team') {
      const team = { id: 'team-1', name: 'Customer Success', role: 'line_manager', organizationId: 'org-1' };
      return fulfill({ success: true, data: { currentTeam: state.managerMode ? team : null, availableTeams: state.managerMode ? [team] : [] } });
    }
    if (method === 'GET' && path === '/user/my-team-members') {
      const directReports = state.managerMode ? [{ userId: 'member-1', name: 'Jordan Lee', email: 'jordan@example.com', title: 'Customer Success Manager', teamName: 'Customer Success' }] : [];
      return fulfill({
        success: true,
        data: {
          isManager: state.managerMode,
          teams: state.managerMode ? [{ id: 'team-1', name: 'Customer Success' }] : [],
          directReports,
          totalDirectReports: directReports.length,
        },
      });
    }
    if (method === 'GET' && path === '/user/member-1/stats') {
      return fulfill({
        success: true,
        data: { okrProgress: 62, pendingAppraisals: 1, last1on1Date: '2026-08-01T09:00:00.000Z', averageScore: 4.1, feedbackCount: 3, hasActiveAppraisal: true, moodTrend: 'up' },
      });
    }
    if (method === 'GET' && path === '/user/member-1/profile') {
      return fulfill({
        success: true,
        data: { userId: 'member-1', name: 'Jordan Lee', email: 'jordan@example.com', title: 'Customer Success Manager', department: 'Customer Success' },
      });
    }
    if (method === 'GET' && path === '/user/member-1/performance-summary') {
      return fulfill({
        success: true,
        data: {
          currentAppraisal: null,
          historicalRatings: [],
          okrs: [{ title: 'Improve customer response time', progress: 62, status: 'active' }],
          feedbackReceived: [],
          oneOnOnes: [],
          developmentPlan: null,
          achievements: [],
        },
      });
    }
    if (method === 'GET' && path === '/goal-periods') {
      return fulfill({ success: true, data: state.goalPeriods });
    }
    if (method === 'POST' && path === '/goal-periods/generate-fiscal') {
      state.generatedGoalPeriodCalls += 1;
      if (state.goalPeriods.length === 0) state.goalPeriods = [state.futurePeriod];
      return fulfill({ success: true, data: state.goalPeriods }, 201);
    }
    if (method === 'GET' && path === '/okrs') {
      return fulfill({ success: true, data: state.goals, count: state.goals.length });
    }
    if (method === 'POST' && path === '/okrs') {
      const body = await jsonBody(request);
      state.createdGoalBodies.push(body);
      const created: GoalRecord = {
        _id: `goal-created-${state.createdGoalBodies.length}`,
        title: String(body.title),
        type: 'individual',
        ownerId: String(body.ownerId || currentUser.id),
        period: String(body.period),
        periodId: String(body.periodId),
        status: 'draft',
        approvalStatus: 'draft',
        lifecycle: { state: 'draft' },
        scoring: { status: 'unrated', progress: null, ratedKeyResults: 0, totalKeyResults: 1 },
        objectives: body.objectives as GoalRecord['objectives'],
        permissions: { view: true, edit: true, submit: true, checkIn: false },
      };
      state.goals.unshift(created);
      return fulfill({ success: true, data: created, message: 'Goal created successfully' }, 201);
    }
    if (method === 'GET' && path === '/okrs/alignable/list') {
      return fulfill({ success: true, data: [] });
    }
    if (method === 'GET' && path === '/feedback') {
      return fulfill({ success: true, data: state.feedbackItems, count: state.feedbackItems.length });
    }
    if (method === 'GET' && path === '/feedback/requests') {
      return fulfill({ success: true, data: [] });
    }
    if (method === 'GET' && path === '/appraisals/my') {
      return fulfill({ success: true, data: state.appraisals });
    }
    if (method === 'POST' && /^\/feedback\/[^/]+\/appraisal-evidence$/.test(path)) {
      const body = await jsonBody(request);
      state.appraisalEvidenceBodies.push(body);
      const id = path.split('/')[2];
      const item = state.feedbackItems.find((feedback) => feedback._id === id);
      if (item) {
        item.appraisalEvidence = {
          included: Boolean(body.included),
          appraisalId: body.included ? body.appraisalId : null,
        };
      }
      return fulfill({ success: true, data: item });
    }
    if (method === 'GET' && path === '/actions') {
      return fulfill({ success: true, data: { items: [], nextCursor: null }, count: 0 });
    }
    if (method === 'GET' && path === '/actions/counts') {
      return fulfill({ success: true, data: { open: 0, unread: 0, overdue: 0, dueSoon: 0, snoozed: 0 } });
    }
    if (method === 'GET' && path === '/notifications') {
      return fulfill({
        success: true,
        data: {
          items: [{
            _id: 'notification-1',
            eventId: 'goal-reminder-1',
            eventType: 'goal.check_in_due',
            category: 'goals',
            priority: 'high',
            title: 'Quarterly goal needs an update',
            message: 'Add progress before your next one-to-one.',
            deepLink: '/okrs?goal=future-goal-1',
            target: { type: 'okr', id: 'future-goal-1' },
            isAction: true,
            action: { kind: 'review', label: 'Review goal' },
            actionStatus: 'open',
            createdAt: new Date().toISOString(),
          }],
          nextCursor: null,
        },
        count: 1,
      });
    }
    if (method === 'GET' && path === '/notifications/counts') {
      return fulfill({ success: true, data: { unread: state.readNotificationIds.length ? 0 : 1, total: 1 } });
    }
    if (method === 'GET' && path === '/notifications/preferences') {
      return fulfill({ success: true, data: state.notificationPreferences });
    }
    if (method === 'PATCH' && path === '/notifications/preferences') {
      const body = await jsonBody(request);
      state.notificationPreferenceBodies.push(body);
      state.notificationPreferences = body as MockApiState['notificationPreferences'];
      return fulfill({ success: true, data: state.notificationPreferences });
    }
    if (method === 'PATCH' && /^\/notifications\/[^/]+\/read$/.test(path)) {
      state.readNotificationIds.push(path.split('/')[2]);
      return fulfill({ success: true });
    }
    if (method === 'PATCH' && path === '/notifications/read-all') {
      state.readNotificationIds.push('all');
      return fulfill({ success: true });
    }
    if (method === 'GET' && path === '/check-ins') {
      return fulfill({ success: true, data: state.checkIns });
    }
    if (method === 'POST' && path === '/check-ins') {
      const body = await jsonBody(request);
      state.createdCheckInBodies.push(body);
      const created: CheckInRecord = {
        _id: `check-in-created-${state.createdCheckInBodies.length}`,
        employeeId: String(body.employeeId),
        cadence: body.cadence as CheckInRecord['cadence'],
        periodStart: String(body.periodStart),
        periodEnd: String(body.periodEnd),
        wins: body.wins as string[],
        priorities: body.priorities as string[],
        blockers: body.blockers as string[],
        supportNeeded: body.supportNeeded as string[],
        pulse: Number(body.pulse),
        visibility: body.visibility as CheckInRecord['visibility'],
        status: 'draft',
      };
      state.checkIns.unshift(created);
      return fulfill({ success: true, data: created }, 201);
    }
    if (method === 'POST' && /^\/check-ins\/[^/]+\/submit$/.test(path)) {
      const id = path.split('/')[2];
      const item = state.checkIns.find((checkIn) => checkIn._id === id);
      if (item) {
        item.status = 'submitted';
        item.submittedAt = new Date().toISOString();
      }
      return fulfill({ success: true, data: item });
    }
    if (method === 'POST' && path === '/presence/sessions') {
      return fulfill({ success: true, sessionId: 'presence-session' }, 201);
    }
    if (method === 'POST' && path.startsWith('/presence/sessions/')) {
      return fulfill({ success: true });
    }

    return fulfill({ success: false, error: `No browser-test mock for ${method} ${path}` }, 501);
  });
}

test('shows an upcoming unrated goal and creates a milestone without fabricated progress', async ({ page }) => {
  const state = createState();
  await installMockApi(page, state);

  await page.goto('/okrs');
  await expect(page.getByRole('heading', { name: 'Goals', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Upcoming' }).click();
  await expect(page.getByText(state.futurePeriod.name).first()).toBeVisible();
  await expect(page.getByText('Build launch readiness')).toBeVisible();
  await expect(page.getByText('Not rated').first()).toBeVisible();

  await page.getByRole('button', { name: 'Create goal' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create goal' });
  await expect(dialog).toBeVisible();
  await expect(muiSelect(dialog, 'Period')).toHaveText(state.futurePeriod.name);
  await dialog.getByLabel('Goal title').fill('Complete customer launch plan');
  await dialog.getByLabel('Objective').fill('Ready the launch team');
  await dialog.getByLabel('Key result 1').fill('Approve the go-live checklist');
  await muiSelect(dialog, 'Metric').click();
  await page.getByRole('option', { name: 'Milestone' }).click();
  await dialog.getByRole('button', { name: 'Create goal' }).click();

  await expect(page.getByText('Goal created.')).toBeVisible();
  await expect(page.getByText('Complete customer launch plan')).toBeVisible();
  expect(state.createdGoalBodies).toHaveLength(1);
  const objectives = state.createdGoalBodies[0].objectives as Array<{ keyResults: Array<Record<string, unknown>> }>;
  expect(objectives[0].keyResults[0]).toMatchObject({ metricType: 'milestone' });
  expect(objectives[0].keyResults[0]).not.toHaveProperty('currentValue');
});

test('initializes canonical goal periods for a manager when a new organization has none', async ({ page }) => {
  const state = createState();
  state.managerMode = true;
  state.goals = [];
  state.goalPeriods = [];
  await installMockApi(page, state);

  await page.goto('/okrs');
  await page.getByRole('tab', { name: 'Upcoming' }).click();
  await expect(page.getByText(state.futurePeriod.name).first()).toBeVisible();
  expect(state.generatedGoalPeriodCalls).toBe(1);

  await page.getByRole('button', { name: 'Create goal' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Create goal' });
  await expect(muiSelect(dialog, 'Period')).toHaveText(state.futurePeriod.name);
});

test('opens an unread Action Centre notification at its goal deep link', async ({ page }) => {
  const state = createState();
  await installMockApi(page, state);

  await page.goto('/action-centre');
  await expect(page.getByRole('heading', { name: 'Action centre' })).toBeVisible();
  await page.getByRole('tab', { name: /Notifications/ }).click();
  await expect(page.getByText('Quarterly goal needs an update')).toBeVisible();
  await page.getByRole('button', { name: 'Review goal' }).click();

  await expect(page).toHaveURL(/\/okrs\?goal=future-goal-1$/);
  await expect(page.getByText('Build launch readiness')).toBeVisible();
  expect(state.readNotificationIds).toContain('notification-1');
});

test('lists check-ins and creates then submits a fortnightly update', async ({ page }) => {
  const state = createState();
  await installMockApi(page, state);

  await page.goto('/check-ins');
  await expect(page.getByRole('heading', { name: 'Performance check-ins' })).toBeVisible();
  await expect(page.getByText('Weekly check-in')).toBeVisible();
  await expect(page.getByText('Shipped manager dashboard')).toBeVisible();

  await page.getByRole('button', { name: 'New check-in' }).click();
  const dialog = page.getByRole('dialog', { name: 'New performance check-in' });
  await muiSelect(dialog, 'Cadence').click();
  await page.getByRole('option', { name: 'Fortnightly' }).click();
  await dialog.getByLabel('Wins').fill('Closed launch blockers');
  await dialog.getByLabel('Next priorities').fill('Run customer readiness review');
  await dialog.getByRole('button', { name: 'Save and submit' }).click();

  await expect(page.getByText('Check-in submitted.')).toBeVisible();
  await expect(page.getByText('Fortnightly check-in')).toBeVisible();
  await expect(page.getByText('Closed launch blockers')).toBeVisible();
  expect(state.createdCheckInBodies).toHaveLength(1);
  expect(state.createdCheckInBodies[0]).toMatchObject({
    cadence: 'fortnightly',
    wins: ['Closed launch blockers'],
    priorities: ['Run customer readiness review'],
  });
  expect(state.checkIns[0].status).toBe('submitted');
});

test('uses named feedback as optional appraisal evidence and hides the action for anonymous feedback', async ({ page }) => {
  const state = createState();
  await installMockApi(page, state);

  await page.goto('/feedback');
  await expect(page.getByRole('heading', { level: 1, name: 'Feedback', exact: true })).toBeVisible();
  await expect(page.getByText('You kept the launch decision clear and well supported.')).toBeVisible();
  await expect(page.getByText('Anonymous cohort feedback remains private.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use in appraisal' })).toHaveCount(1);

  await page.getByRole('button', { name: 'Use in appraisal' }).click();
  const dialog = page.getByRole('dialog', { name: 'Use feedback in an appraisal' });
  await expect(muiSelect(dialog, 'Appraisal')).toContainText('2026 Annual Review');
  await dialog.getByRole('button', { name: 'Add to appraisal' }).click();

  await expect(page.getByText('Feedback added to your appraisal evidence.')).toBeVisible();
  await expect(page.getByText('Appraisal evidence', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove from appraisal' })).toHaveCount(1);
  expect(state.appraisalEvidenceBodies).toEqual([{
    included: true,
    appraisalId: '507f1f77bcf86cd799439011',
  }]);
});

test('opens a team member OKR tab and accepts wrapped profile, stats, and summary responses', async ({ page }) => {
  const state = createState();
  state.managerMode = true;
  await installMockApi(page, state);

  await page.goto('/team');
  await expect(page.getByText('Jordan Lee')).toBeVisible();
  await page.getByRole('button', { name: 'More actions for Jordan Lee' }).evaluate((button: HTMLButtonElement) => button.click());
  await page.getByRole('menuitem', { name: 'View OKRs' }).click();

  await expect(page).toHaveURL(/\/team\/member-1\?tab=okrs$/);
  await expect(page.getByRole('tab', { name: 'OKRs' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Improve customer response time')).toBeVisible();
});

test('loads and saves email, digest, timezone, and quiet-hour preferences', async ({ page }) => {
  const state = createState();
  await installMockApi(page, state);

  await page.goto('/action-centre');
  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1, name: 'Action centre' })).toBeVisible();
  const preferencesTab = page.getByRole('tab', { name: 'Preferences' });
  await preferencesTab.focus();
  await expect(preferencesTab).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(preferencesTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Notification preferences' })).toBeVisible();
  await expect(page.getByText(/In-app notifications remain on for required work/)).toBeVisible();
  await expect(page.getByText(/sensitive performance information stays in Seemplify/i)).toBeVisible();

  await page.getByRole('switch', { name: /Email notifications/ }).check();
  const chatNotifications = page.getByRole('switch', { name: /Chat notifications/ });
  await expect(chatNotifications).not.toBeChecked();
  await chatNotifications.check();
  await muiSelect(page.locator('main'), 'Digest').click();
  await page.getByRole('option', { name: 'Daily' }).click();
  await page.getByLabel('Timezone').fill('Europe/London');
  await page.getByRole('switch', { name: 'Use quiet hours' }).check();
  await page.getByLabel('Quiet hours start').fill('21:30');
  await page.getByLabel('Quiet hours end').fill('07:30');
  await page.getByRole('button', { name: 'Save preferences' }).click();

  await expect(page.getByText('Notification preferences saved.')).toBeVisible();
  expect(state.notificationPreferenceBodies).toHaveLength(1);
  expect(state.notificationPreferenceBodies[0]).toMatchObject({
    channels: { inApp: true, email: true, chat: true },
    digest: { frequency: 'daily' },
    quietHours: { enabled: true, start: '21:30', end: '07:30' },
    timezone: 'Europe/London',
  });
});

test('hides organization features that are explicitly disabled', async ({ page }) => {
  const state = createState();
  state.rolloutFeatures = {
    canonicalAppraisals: false,
    goalPeriods: true,
    notifications: false,
    continuousPerformance: false,
  };
  await installMockApi(page, state);

  await page.goto('/dashboard');
  await expect(page.getByRole('link', { name: 'My OKRs' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Appraisals' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Growth' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /unread notifications/ })).toHaveCount(0);
});
