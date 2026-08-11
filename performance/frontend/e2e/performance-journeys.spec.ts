import { expect, test, type Locator, type Page, type Request } from '@playwright/test';

interface GoalRecord {
  _id: string;
  title: string;
  type: 'individual' | 'team' | 'department' | 'organization';
  ownerId: string;
  period: string;
  periodId: string;
  teamId?: string;
  teamHierarchy?: { teamId?: string; teamName?: string; departmentId?: string; departmentName?: string };
  status: string;
  approvalStatus: string;
  lifecycle: { state: string };
  scoring: { status: string; progress: number | null; ratedKeyResults: number; totalKeyResults: number };
  objectives: Array<{
    _id?: string;
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
  updatedGoalBodies: Array<{ id: string; body: Record<string, unknown> }>;
  createdCheckInBodies: Array<Record<string, unknown>>;
  createdCycleBodies: Array<Record<string, unknown>>;
  updatedCycleBodies: Array<Record<string, unknown>>;
  createdTemplateBodies: Array<Record<string, unknown>>;
  customResponseBodies: Array<Record<string, unknown>>;
  managerReviewBodies: Array<Record<string, unknown>>;
  scoringRequestCount: number;
  analyticsRequestPaths: string[];
  appraisalEvidenceBodies: Array<Record<string, unknown>>;
  notificationPreferenceBodies: Array<Record<string, unknown>>;
  aiRuntimePreferenceBodies: Array<Record<string, unknown>>;
  conversationContextCalls: number;
  readNotificationIds: string[];
  chatGptAccount: {
    status: 'disconnected' | 'pending' | 'connected';
    connectedEmail: string | null;
    planType: string | null;
    connectedAt: string | null;
    lastVerifiedAt: string | null;
    dataSharingAcknowledgedAt: string | null;
    routable: boolean;
    lastError: string | null;
  };
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
  hrAdminMode: boolean;
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
          okrWeight: 40,
        },
        goalSnapshots: [{
          _id: 'snapshot-1',
          sourceGoalId: 'future-goal-1',
          sourceVersion: 2,
          scope: 'individual',
          period: { label: futurePeriod.name },
          definition: {
            title: 'Build launch readiness',
            objectives: [{
              title: 'Prepare the launch',
              description: 'Make the release ready for customers.',
              keyResults: [{
                title: 'Complete launch checklist',
                metricType: 'milestone',
                currentValue: 75,
                targetValue: 100,
              }],
            }],
          },
          achievement: { rated: true, score: 75 },
          capturedAt: '2026-08-01T00:00:00.000Z',
          cutoffAt: '2026-12-31T23:59:59.999Z',
        }],
        goalEvidenceSummary: { rated: true, score: 75, ratedGoals: 1, totalGoals: 1, okrWeight: 40 },
      },
    ],
    createdGoalBodies: [],
    updatedGoalBodies: [],
    createdCheckInBodies: [],
    createdCycleBodies: [],
    updatedCycleBodies: [],
    createdTemplateBodies: [],
    customResponseBodies: [],
    managerReviewBodies: [],
    scoringRequestCount: 0,
    analyticsRequestPaths: [],
    appraisalEvidenceBodies: [],
    notificationPreferenceBodies: [],
    aiRuntimePreferenceBodies: [],
    conversationContextCalls: 0,
    readNotificationIds: [],
    chatGptAccount: {
      status: 'disconnected',
      connectedEmail: null,
      planType: null,
      connectedAt: null,
      lastVerifiedAt: null,
      dataSharingAcknowledgedAt: null,
      routable: false,
      lastError: null,
    },
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
    hrAdminMode: false,
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

async function switchPerformanceWorkspace(page: Page, workspace: 'Personal' | 'Manager' | 'Admin') {
  if ((page.viewportSize()?.width || 0) >= 1900) {
    const wideButton = page.getByRole('button', { name: workspace, exact: true });
    await expect(wideButton).toBeVisible();
    await wideButton.click();
    return;
  }

  const wideButton = page.getByRole('button', { name: workspace, exact: true });
  if (await wideButton.count() > 0 && await wideButton.first().isVisible()) {
    await wideButton.first().click();
    return;
  }

  await page.getByRole('button', { name: /^(Personal|Manager|Admin)$/ }).click();
  await page.getByRole('menuitemradio', { name: new RegExp(`^${workspace}`) }).click();
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
      const role = state.hrAdminMode
        ? { name: 'hr_admin', displayName: 'HR Administrator', isManager: true, isHRAdmin: true, isTeamLead: true }
        : state.managerMode
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
          managerData: state.managerMode ? { directReportCount: 1, pendingReviews: 2 } : null,
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
    if (method === 'GET' && path === '/dashboard/summary') {
      return fulfill({
        okrProgress: 35,
        totalOkrs: state.goals.length,
        completedOkrs: 0,
        upcomingDeadlines: 1,
        pendingReviews: 0,
        recentFeedback: state.feedbackItems.length,
      });
    }
    if (method === 'GET' && path === '/appraisals/notifications/manager') {
      return fulfill({ success: true, data: { notifications: [] } });
    }
    if (method === 'GET' && path === '/ai-account') {
      return fulfill({
        success: true,
        data: {
          account: state.chatGptAccount,
          policy: { localEnabled: true, chatgptEnabled: true, defaultRuntime: 'local' },
        },
      });
    }
    if (method === 'POST' && path === '/ai-account/login') {
      state.chatGptAccount.status = 'pending';
      return fulfill({
        success: true,
        data: {
          account: state.chatGptAccount,
          login: { userCode: 'ABCD-EFGH', verificationUrl: 'https://chatgpt.com/device' },
        },
      });
    }
    if (method === 'POST' && path === '/ai-account/consent') {
      state.chatGptAccount.dataSharingAcknowledgedAt = new Date().toISOString();
      state.chatGptAccount.routable = true;
      return fulfill({ success: true, data: { account: state.chatGptAccount } });
    }
    if (method === 'POST' && path === '/ai-account/login/reset') {
      state.chatGptAccount.status = 'disconnected';
      return fulfill({ success: true, data: { account: state.chatGptAccount } });
    }
    if (method === 'DELETE' && path === '/ai-account') {
      state.chatGptAccount.status = 'disconnected';
      state.chatGptAccount.routable = false;
      state.chatGptAccount.dataSharingAcknowledgedAt = null;
      return fulfill({ success: true, data: { account: state.chatGptAccount } });
    }
    if (method === 'PUT' && path === '/ai-runtime/preference') {
      const body = await jsonBody(request);
      state.aiRuntimePreferenceBodies.push(body);
      return fulfill({ success: true, runtimePreference: body.runtimePreference });
    }
    if (method === 'GET' && (path === '/user/employees-for-appraisal' || path === '/user/all-employees')) {
      const employees = [{
          userId: 'member-1',
          name: 'Jordan Lee',
          email: 'jordan@example.com',
          teamId: 'team-1',
          teamIds: ['team-1'],
          teamName: 'Customer Success',
          managerId: currentUser.id,
          managerName: currentUser.name,
          managerEmail: currentUser.email,
          isSelectableForAppraisal: true,
        }];
      return fulfill({ success: true, data: path === '/user/employees-for-appraisal' ? { employees } : employees });
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
    if (method === 'GET' && /^\/okrs\/[^/]+$/.test(path)) {
      const goal = state.goals.find((item) => item._id === path.split('/')[2]);
      return goal
        ? fulfill({ success: true, data: goal })
        : fulfill({ success: false, error: 'Goal not found' }, 404);
    }
    if (method === 'PUT' && /^\/okrs\/[^/]+$/.test(path)) {
      const id = path.split('/')[2];
      const body = await jsonBody(request);
      state.updatedGoalBodies.push({ id, body });
      const goal = state.goals.find((item) => item._id === id);
      if (!goal) return fulfill({ success: false, error: 'Goal not found' }, 404);
      goal.title = String(body.title || goal.title);
      goal.period = String(body.period || goal.period);
      goal.periodId = String(body.periodId || goal.periodId);
      goal.objectives = body.objectives as GoalRecord['objectives'];
      return fulfill({ success: true, data: goal, message: 'Goal updated successfully' });
    }
    if (method === 'GET' && path === '/feedback') {
      return fulfill({ success: true, data: state.feedbackItems, count: state.feedbackItems.length });
    }
    if (method === 'GET' && path === '/feedback/requests') {
      return fulfill({ success: true, data: [] });
    }
    if (method === 'GET' && path === '/appraisals/cycles') {
      return fulfill({
        success: true,
        data: [{
          _id: 'cycle-1',
          name: '2026 Annual Review',
          cycleType: 'annual',
          periodStart: '2026-01-01T00:00:00.000Z',
          periodEnd: '2026-12-31T23:59:59.999Z',
          currentPhase: 'selfAssessment',
          status: 'active',
          phases: {},
        }],
      });
    }
    if (method === 'GET' && path === '/appraisals/cycle-templates') {
      return fulfill({
        success: true,
        data: [{
          id: 'balanced_performance',
          name: 'Balanced performance review',
          description: 'Goals, competencies, learning, and development.',
          category: 'annual',
          version: 1,
          system: true,
          design: {
            version: 1,
            scoring: { goalsWeight: 40, competenciesWeight: 60 },
            stages: {
              goalSetting: { enabled: true }, selfAssessment: { enabled: true }, managerReview: { enabled: true },
              discussion: { enabled: true }, calibration: { enabled: false }, finalReview: { enabled: true }, acknowledgement: { enabled: true },
            },
            sections: [
              { id: 'goals', title: 'Goals and outcomes', description: 'Review approved goal evidence.', type: 'goals', respondent: 'both', required: true, scored: true, weight: 40, evidenceRequired: false, questions: [] },
              { id: 'competencies', title: 'Competencies', description: 'Assess expected behaviours.', type: 'competencies', respondent: 'both', required: true, scored: true, weight: 60, evidenceRequired: false, questions: [] },
              { id: 'learning', title: 'Learning and application', description: 'Reflect on learning and application.', type: 'learning', respondent: 'employee', required: true, scored: false, weight: 0, evidenceRequired: false, questions: [{ id: 'learning_applied', prompt: 'What did you learn and apply?', helpText: '', responseType: 'long_text', required: true, options: [], ratingMin: 1, ratingMax: 5 }] },
            ],
          },
        }],
      });
    }
    if (method === 'POST' && path === '/appraisals/cycle-templates') {
      const body = await jsonBody(request);
      state.createdTemplateBodies.push(body);
      return fulfill({ success: true, data: { _id: 'template-created', version: 1, ...body } }, 201);
    }
    if (method === 'POST' && path === '/appraisals/cycles') {
      const body = await jsonBody(request);
      state.createdCycleBodies.push(body);
      return fulfill({ success: true, data: { cycle: { _id: 'created-cycle', ...body }, launchSummary: { launched: 1, replayed: 0, errors: 0 } } }, 201);
    }
    if (method === 'PUT' && path === '/appraisals/cycles/cycle-1') {
      const body = await jsonBody(request);
      state.updatedCycleBodies.push(body);
      return fulfill({ success: true, data: { _id: 'cycle-1', ...body } });
    }
    if (method === 'GET' && path === '/appraisals/cycles/cycle-1') {
      return fulfill({
        success: true,
        data: {
          _id: 'cycle-1', name: '2026 Annual Review', description: 'Annual review', cycleType: 'annual',
          periodStart: '2026-01-01T00:00:00.000Z', periodEnd: '2026-12-31T23:59:59.999Z',
          status: 'active', currentPhase: 'selfAssessment', phases: {}, okrWeight: 40,
          sourceTemplate: { id: 'balanced_performance', name: 'Balanced performance review', version: 1 },
          workflowDefinition: {
            version: 1,
            scoring: { goalsWeight: 40, competenciesWeight: 60 },
            stages: { goalSetting: { enabled: true }, selfAssessment: { enabled: true }, managerReview: { enabled: true }, discussion: { enabled: true }, calibration: { enabled: false }, finalReview: { enabled: true }, acknowledgement: { enabled: true } },
            sections: [
              { id: 'goals', title: 'Goals and outcomes', description: 'Review goal evidence.', type: 'goals', respondent: 'both', required: true, scored: true, weight: 40, evidenceRequired: false, questions: [] },
              { id: 'competencies', title: 'Competencies', description: 'Assess role behaviours.', type: 'competencies', respondent: 'both', required: true, scored: true, weight: 60, evidenceRequired: false, questions: [] },
              { id: 'learning', title: 'Learning and application', description: 'Reflect on learning.', type: 'learning', respondent: 'employee', required: true, scored: false, weight: 0, evidenceRequired: false, questions: [{ id: 'learning_applied', prompt: 'What did you learn and apply?', helpText: '', responseType: 'long_text', required: true, options: [], ratingMin: 1, ratingMax: 5 }] },
            ],
          },
          settings: { enableAiAssist: false, requireSignOff: true }, scope: { type: 'organization', targetIds: [] },
        },
      });
    }
    if (method === 'GET' && path === '/appraisals/team') {
      return fulfill({ success: true, data: [] });
    }
    if (method === 'GET' && path === '/appraisals/my') {
      return fulfill({ success: true, data: state.appraisals });
    }
    if (method === 'GET' && /^\/appraisals\/[^/]+$/.test(path)) {
      const id = path.split('/')[2];
      const appraisal = state.appraisals.find((item) => item._id === id);
      return appraisal
        ? fulfill({ success: true, data: appraisal })
        : fulfill({ success: false, error: 'Appraisal not found' }, 404);
    }
    if (method === 'PUT' && /^\/appraisals\/[^/]+\/custom-responses$/.test(path)) {
      const body = await jsonBody(request);
      state.customResponseBodies.push(body);
      return fulfill({ success: true, data: { customResponses: body.responses } });
    }
    if (method === 'POST' && /^\/appraisals\/[^/]+\/manager-review\/start$/.test(path)) {
      return fulfill({ success: true });
    }
    if (method === 'POST' && /^\/appraisals\/[^/]+\/manager-review$/.test(path)) {
      const body = await jsonBody(request);
      state.managerReviewBodies.push(body);
      return fulfill({ success: true, data: { saved: true } });
    }
    if (method === 'GET' && /^\/appraisals\/[^/]+\/scoring$/.test(path)) {
      state.scoringRequestCount += 1;
      const managerResponses = [...state.customResponseBodies].reverse().find((body) => body.respondentRole === 'manager');
      const responses = Array.isArray(managerResponses?.responses) ? managerResponses.responses as Array<Record<string, unknown>> : [];
      const customRating = Number(responses.find((response) => response.questionId === 'growth_rating')?.value);
      const hasCustomRating = Number.isFinite(customRating) && customRating > 0;
      return fulfill({
        success: true,
        data: {
          okrScore: 3.5,
          competencyScore: 3,
          compositeScore: hasCustomRating ? 3.7 : 3.2,
          ratingLabel: hasCustomRating ? 'Exceeds Expectations' : 'Meets Expectations',
          breakdown: {
            okrWeight: hasCustomRating ? 32 : 40,
            okrContribution: hasCustomRating ? 1.12 : 1.4,
            competencyWeight: hasCustomRating ? 48 : 60,
            competencyContribution: hasCustomRating ? 1.44 : 1.8,
            customSections: hasCustomRating ? [{ sectionId: 'growth_readiness', title: 'Growth readiness', score: customRating, weight: 20, contribution: customRating * 0.2 }] : [],
          },
        },
      });
    }
    if (method === 'GET' && path === '/feedback/direct-reports') {
      return fulfill({ success: true, data: {} });
    }
    if (method === 'GET' && path === '/analytics/performance') {
      state.analyticsRequestPaths.push(`${path}${url.search}`);
      const teamFiltered = url.searchParams.get('teamId') === 'team-1';
      return fulfill({
        success: true,
        data: {
          scope: { organization: true, teamId: teamFiltered ? 'team-1' : null, department: null },
          filters: {
            cycles: [{ id: 'cycle-1', name: '2026 Annual Review' }],
            teams: [{ id: 'team-1', name: 'Customer Success' }, { id: 'team-2', name: 'Product' }],
            departments: ['Customer Success', 'Product'],
          },
          summary: { participants: teamFiltered ? 4 : 12, completed: teamFiltered ? 3 : 9, completionRate: 75, selfAssessmentRate: 92, managerReviewRate: 83, rated: teamFiltered ? 3 : 9, averageRating: 4.2, overrideRate: 11.1, highRatingGaps: 1 },
          distribution: [{ rating: 1, count: 0 }, { rating: 2, count: 1 }, { rating: 3, count: 2 }, { rating: 4, count: 4 }, { rating: 5, count: 2 }],
          topPerformers: [{ rank: 1, appraisalId: 'appraisal-top-1', employeeId: 'member-1', employeeName: 'Jordan Lee', jobTitle: 'Customer Success Manager', department: 'Customer Success', teamId: 'team-1', teamName: 'Customer Success', cycleId: 'cycle-1', cycleName: '2026 Annual Review', finalRating: 5, ratingLabel: 'Outstanding', goalAchievement: 96 }],
          teams: [{ id: 'team-1', name: 'Customer Success', participants: 4, completed: 3, completionRate: 75, rated: 3, averageRating: 4.5, averageGoalAchievement: 88 }, { id: 'team-2', name: 'Product', participants: 8, completed: 6, completionRate: 75, rated: 6, averageRating: 4, averageGoalAchievement: 81 }],
          departments: [{ id: 'Customer Success', name: 'Customer Success', participants: 4, completionRate: 75, averageRating: 4.5 }, { id: 'Product', name: 'Product', participants: 8, completionRate: 75, averageRating: 4 }],
          sectionInsights: [{ sectionId: 'learning', title: 'Learning and application', type: 'learning', responseRate: 91.7, averageManagerScore: null }],
          trends: [{ cycleId: 'cycle-1', cycleName: '2026 Annual Review', periodEnd: '2026-12-31T00:00:00.000Z', participants: 12, completionRate: 75, averageRating: 4.2 }],
          definitions: { topPerformers: 'Completed canonical appraisals ranked by final rating, then goal achievement.', completionRate: 'Completed appraisals divided by all appraisals.', averageRating: 'Mean finalized rating.', responseRate: 'Completed configured sections.' },
          refreshedAt: '2026-08-11T00:00:00.000Z',
        },
      });
    }
    if (method === 'GET' && /^\/appraisals\/[^/]+\/conversation\/context$/.test(path)) {
      state.conversationContextCalls += 1;
      return fulfill({
        success: true,
        data: {
          cycle: { settings: { allowSelfRating: true } },
          conversationState: null,
          chatThread: [],
          okrs: [],
        },
      });
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

test('lets an authorised manager edit a team goal without losing recorded progress', async ({ page }) => {
  const state = createState();
  state.managerMode = true;
  state.goals = [{
    _id: 'team-goal-1',
    title: 'Reduce customer response time',
    type: 'team',
    ownerId: currentUser.id,
    period: state.futurePeriod.name,
    periodId: state.futurePeriod._id,
    teamId: 'team-1',
    teamHierarchy: { teamId: 'team-1', teamName: 'Customer Success' },
    status: 'active',
    approvalStatus: 'not_required',
    lifecycle: { state: 'active' },
    scoring: { status: 'partially_rated', progress: 35, ratedKeyResults: 1, totalKeyResults: 1 },
    objectives: [{
      _id: 'objective-1',
      title: 'Respond faster',
      weight: 100,
      keyResults: [{
        _id: 'team-kr-1',
        title: 'Average response time',
        metricType: 'number',
        startValue: 100,
        targetValue: 60,
        currentValue: 75,
        direction: 'decrease',
        health: 'on_track',
      }],
    }],
    permissions: { view: true, edit: true, submit: false, decide: false, acknowledge: false, requestChange: false, checkIn: true, align: true },
  }];
  await installMockApi(page, state);

  await page.goto('/dashboard');
  await switchPerformanceWorkspace(page, 'Manager');
  await page.getByRole('link', { name: 'Team OKRs', exact: true }).click();
  await page.getByRole('tab', { name: 'Upcoming' }).click();
  await page.getByRole('tab', { name: /Team & Department Goals/ }).click();
  await expect(page.getByText('Reduce customer response time')).toBeVisible();
  await page.getByRole('button', { name: 'Edit goal' }).click();

  const dialog = page.getByRole('dialog', { name: 'Edit goal' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Goal title')).toHaveValue('Reduce customer response time');
  await expect(muiSelect(dialog, 'Scope')).toBeDisabled();
  await dialog.getByLabel('Goal title').fill('Reduce first response time');
  await dialog.getByLabel('Target').fill('55');
  await dialog.getByLabel('Reason for edit').fill('Updated after the quarterly planning review');
  await dialog.getByRole('button', { name: 'Save changes' }).click();

  await expect(page.getByText('Goal updated.')).toBeVisible();
  await expect(page.getByText('Reduce first response time')).toBeVisible();
  expect(state.updatedGoalBodies).toHaveLength(1);
  const update = state.updatedGoalBodies[0];
  expect(update.id).toBe('team-goal-1');
  expect(update.body).toMatchObject({
    title: 'Reduce first response time',
    editReason: 'Updated after the quarterly planning review',
  });
  const updatedObjectives = update.body.objectives as Array<{ _id: string; keyResults: Array<Record<string, unknown>> }>;
  expect(updatedObjectives[0]._id).toBe('objective-1');
  expect(updatedObjectives[0].keyResults[0]).toMatchObject({
    _id: 'team-kr-1',
    targetValue: 55,
    currentValue: 75,
    direction: 'decrease',
    health: 'on_track',
  });
});

test('initializes canonical goal periods for a manager when a new organization has none', async ({ page }) => {
  const state = createState();
  state.managerMode = true;
  state.goals = [];
  state.goalPeriods = [];
  await installMockApi(page, state);

  await page.goto('/dashboard');
  await switchPerformanceWorkspace(page, 'Manager');
  await page.getByRole('link', { name: 'Team OKRs', exact: true }).click();
  await page.getByRole('tab', { name: 'Upcoming' }).click();
  await expect(page.getByText(state.futurePeriod.name).first()).toBeVisible();
  expect(state.generatedGoalPeriodCalls).toBe(1);

  await page.getByRole('button', { name: 'Create goal' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Create goal' });
  await expect(muiSelect(dialog, 'Period')).toHaveText(state.futurePeriod.name);
});

test('customizes an appraisal cycle flow, adds a question, selects people, and launches the frozen design', async ({ page }) => {
  const state = createState();
  state.managerMode = true;
  await installMockApi(page, state);

  const currentYear = new Date().getUTCFullYear();
  await page.goto('/admin/appraisal-cycles/new');

  await expect(page.getByLabel('Period Start')).toHaveValue(`${currentYear}-01-01`);
  await expect(page.getByLabel('Period End')).toHaveValue(`${currentYear}-12-31`);
  await page.getByLabel('Cycle Name').fill('Annual employee review');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Review design', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add section' }).click();
  await page.getByLabel('Section title').last().fill('Client learning evidence');
  await page.getByLabel('Question 1').last().fill('How did you apply your most important learning?');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Choose Participants' })).toBeVisible();
  await page.getByText('Jordan Lee', { exact: true }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Confirm and launch' })).toBeVisible();
  await page.getByRole('button', { name: 'Launch Review Cycle' }).click();
  await expect.poll(() => state.createdCycleBodies.length).toBe(1);
  const body = state.createdCycleBodies[0] as {
    launchNow: boolean;
    employees: unknown[];
    workflowDefinition: { sections: Array<{ title: string; respondent: string; questions: Array<{ prompt: string }> }> };
  };
  expect(body.launchNow).toBe(true);
  expect(body.employees).toHaveLength(1);
  expect(body.workflowDefinition.sections).toEqual(expect.arrayContaining([
    expect.objectContaining({ title: 'Client learning evidence', respondent: 'employee' }),
  ]));
  expect(body.workflowDefinition.sections.find((section) => section.title === 'Client learning evidence')?.questions[0].prompt)
    .toBe('How did you apply your most important learning?');
});

test('validates a scored custom design, saves it as a template, and launches the exact configuration', async ({ page }) => {
  const state = createState();
  state.hrAdminMode = true;
  state.managerMode = true;
  await installMockApi(page, state);

  await page.goto('/admin/appraisal-cycles/new');
  await expect(page.getByText(/confirm the launch in four steps/i)).toBeVisible();
  await page.getByLabel('Cycle Name').fill('Custom client review');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  await expect(page.getByRole('checkbox', { name: 'Employee assessment enabled' })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: 'Manager assessment enabled' })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: 'Final result enabled' })).toBeDisabled();

  await page.getByRole('button', { name: 'Add section', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Every question in New section needs prompt text.').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Review design', exact: true })).toBeVisible();

  await page.getByLabel('Section title').last().fill('Growth readiness');
  await page.getByLabel('Question 1').last().fill('How ready is this employee for broader responsibility?');
  await page.getByRole('checkbox', { name: 'Contributes to rating' }).last().check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Growth readiness needs a manager rating question.').first()).toBeVisible();

  await page.getByRole('combobox', { name: 'Who responds' }).last().click();
  await page.getByRole('option', { name: 'Manager', exact: true }).click();
  await page.getByRole('combobox', { name: 'Answer type' }).last().click();
  await page.getByRole('option', { name: 'Rating', exact: true }).click();

  const weights = page.getByRole('spinbutton', { name: 'Weight %' });
  await weights.nth(0).fill('30');
  await weights.nth(1).fill('50');
  await weights.nth(2).fill('20');
  await page.getByRole('checkbox', { name: 'Calibration enabled' }).check();
  await expect(page.getByText('Scored weight 100%')).toBeVisible();

  await page.getByRole('button', { name: 'Save as reusable template' }).click();
  const templateDialog = page.getByRole('dialog', { name: 'Save reusable cycle template' });
  await templateDialog.getByLabel('Template name').fill('Client leadership review');
  await templateDialog.getByLabel('Description').fill('Reusable leadership and growth review.');
  await templateDialog.getByRole('button', { name: 'Save template', exact: true }).click();
  await expect.poll(() => state.createdTemplateBodies.length).toBe(1);

  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByText('Jordan Lee', { exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Launch Review Cycle' }).click();
  await expect.poll(() => state.createdCycleBodies.length).toBe(1);

  const body = state.createdCycleBodies[0] as {
    workflowDefinition: { stages: Record<string, { enabled: boolean }>; sections: Array<{ title: string; respondent: string; scored: boolean; weight: number; questions: Array<{ responseType: string }> }> };
  };
  expect(body.workflowDefinition.stages.calibration.enabled).toBe(true);
  expect(body.workflowDefinition.sections).toEqual(expect.arrayContaining([
    expect.objectContaining({
      title: 'Growth readiness', respondent: 'manager', scored: true, weight: 20,
      questions: [expect.objectContaining({ responseType: 'rating' })],
    }),
  ]));
});

test('keeps a launched cycle design frozen while allowing safe non-design updates', async ({ page }) => {
  const state = createState();
  state.hrAdminMode = true;
  await installMockApi(page, state);

  await page.goto('/admin/appraisal-cycles/cycle-1/edit');
  await expect(page.getByText('This design is frozen because the cycle has launched.')).toBeVisible();
  await expect(page.getByLabel('Section title').first()).toBeDisabled();
  await expect.poll(() => page.getByLabel('Section title').first().evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(240);
  await expect(page.getByText('Rating Configuration')).toHaveCount(0);

  await page.getByRole('switch', { name: 'Allow Self Rating' }).check();
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect.poll(() => state.updatedCycleBodies.length).toBe(1);
  expect(state.updatedCycleBodies[0]).not.toHaveProperty('workflowDefinition');
  expect(state.updatedCycleBodies[0]).not.toHaveProperty('sourceTemplate');
  expect(state.updatedCycleBodies[0]).not.toHaveProperty('okrWeight');
});

test('refreshes manager scoring after a custom rating autosaves and submits the manager response', async ({ page }) => {
  const state = createState();
  state.managerMode = true;
  Object.assign(state.appraisals[0], {
    status: 'manager_review_pending',
    employee: { userId: 'member-1', name: 'Jordan Lee', email: 'jordan@example.com', jobTitle: 'Customer Success Manager', teamId: 'team-1', teamName: 'Customer Success' },
    manager: { userId: currentUser.id, name: currentUser.name, email: currentUser.email },
    cycleId: {
      _id: 'cycle-1', name: '2026 Annual Review', settings: { enableAiAssist: false, allowSelfRating: true },
      competencies: [{ id: 'customer_focus', name: 'Customer focus', description: 'Makes sound customer decisions.', weight: 100 }],
    },
    cycleConfigurationSnapshot: {
      workflowDefinition: {
        version: 1,
        scoring: { goalsWeight: 32, competenciesWeight: 48 },
        stages: { selfAssessment: { enabled: true }, managerReview: { enabled: true }, discussion: { enabled: true }, finalReview: { enabled: true } },
        sections: [
          { id: 'goals', title: 'Goals', description: '', type: 'goals', respondent: 'both', required: true, scored: true, weight: 32, evidenceRequired: false, questions: [] },
          { id: 'competencies', title: 'Competencies', description: '', type: 'competencies', respondent: 'both', required: true, scored: true, weight: 48, evidenceRequired: false, questions: [] },
          { id: 'learning', title: 'Learning and application', description: '', type: 'learning', respondent: 'employee', required: true, scored: false, weight: 0, evidenceRequired: false, questions: [{ id: 'learning_applied', prompt: 'What did you apply?', helpText: '', responseType: 'long_text', required: true, options: [], ratingMin: 1, ratingMax: 5 }] },
          { id: 'growth_readiness', title: 'Growth readiness', description: 'Manager assessment of readiness.', type: 'custom', respondent: 'manager', required: true, scored: true, weight: 20, evidenceRequired: false, questions: [{ id: 'growth_rating', prompt: 'How ready is the employee?', helpText: '', responseType: 'rating', required: true, options: [], ratingMin: 1, ratingMax: 5 }] },
        ],
      },
    },
    customResponses: [{ sectionId: 'learning', questionId: 'learning_applied', respondentRole: 'employee', value: 'Applied structured customer discovery.' }],
    selfAssessment: {
      submittedAt: '2026-08-10T10:00:00.000Z',
      overallSummary: { achievements: 'Improved response quality.', challenges: 'Complex launches.', learnings: 'Customer discovery.', improvements: 'Delegation.', goals: 'Scale the playbook.' },
      competencyRatings: [{ competencyId: 'customer_focus', competencyName: 'Customer focus', selfRating: 4, selfComments: 'Used customer evidence.' }],
      okrAssessment: [{ okrId: 'goal-1', okrTitle: 'Improve response quality', completionPercentage: 80, selfComments: 'Quality improved.' }],
      overallSelfRating: 4,
    },
    managerReview: {},
  });
  await installMockApi(page, state);

  await page.goto('/appraisals/507f1f77bcf86cd799439011/manager-review');
  await expect(page.getByRole('heading', { name: 'Manager Review: Jordan Lee' })).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Cycle-specific questions' })).toBeVisible();

  await page.getByRole('combobox', { name: 'Rating' }).click();
  await page.getByRole('option', { name: '5 / 5' }).click();
  await expect.poll(() => state.customResponseBodies.filter((body) => body.respondentRole === 'manager').length).toBeGreaterThan(0);
  await expect(page.getByText('Growth readiness (20% weight)')).toBeVisible();
  await expect(page.getByText('5.0/5')).toBeVisible();
  expect(state.scoringRequestCount).toBeGreaterThan(1);

  await page.getByRole('button', { name: 'Submit Review' }).click();
  await expect.poll(() => state.managerReviewBodies.some((body) => body.submit === true)).toBe(true);
  expect(state.customResponseBodies.some((body) => body.respondentRole === 'manager' && body.submit === true)).toBe(true);
});

test('keeps analytics and the cycle builder usable on a narrow mobile viewport', async ({ page }, testInfo) => {
  const state = createState();
  state.managerMode = true;
  state.hrAdminMode = true;
  await page.setViewportSize({ width: 390, height: 844 });
  await installMockApi(page, state);

  await page.goto('/analytics');
  await expect(page.getByRole('heading', { name: 'Performance analytics' })).toBeVisible();
  await page.getByRole('tab', { name: /Top performers/ }).click();
  await expect(page.getByTestId('top-performers-table')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(await page.getByTestId('top-performers-table').evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('analytics-mobile.png'), fullPage: true });

  await page.getByRole('tab', { name: 'Teams and departments' }).click();
  await page.getByRole('button', { name: 'Product', exact: true }).click();
  await expect.poll(() => state.analyticsRequestPaths.some((path) => path.includes('department=Product'))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  await page.goto('/admin/appraisal-cycles/new');
  await page.getByLabel('Cycle Name').fill('Mobile review');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review design', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('cycle-builder-mobile.png'), fullPage: true });
});

test('renders frozen cycle questions in the employee appraisal and autosaves the response', async ({ page }) => {
  const state = createState();
  state.chatGptAccount = {
    status: 'connected', connectedEmail: 'alex@example.com', planType: 'plus', connectedAt: '2026-08-11T00:00:00.000Z',
    lastVerifiedAt: '2026-08-11T00:00:00.000Z', dataSharingAcknowledgedAt: '2026-08-11T00:00:00.000Z', routable: true, lastError: null,
  };
  Object.assign(state.appraisals[0], {
    customResponses: [],
    cycleConfigurationSnapshot: {
      workflowDefinition: {
        version: 1,
        scoring: { goalsWeight: 40, competenciesWeight: 60 },
        stages: { selfAssessment: { enabled: true }, managerReview: { enabled: true }, finalReview: { enabled: true } },
        sections: [{
          id: 'learning', title: 'Learning and application', description: 'Capture learning from training, projects, mentoring, or work.',
          type: 'learning', respondent: 'employee', required: true, scored: false, weight: 0, evidenceRequired: false,
          questions: [{ id: 'learning_applied', prompt: 'How did you apply your most important learning?', helpText: '', responseType: 'long_text', required: true, options: [], ratingMin: 1, ratingMax: 5 }],
        }],
      },
    },
  });
  await installMockApi(page, state);

  await page.goto('/appraisals/507f1f77bcf86cd799439011/self-assessment');
  await expect(page.getByRole('heading', { name: 'Cycle-specific questions' })).toBeVisible();
  await page.getByPlaceholder('Enter your response').fill('I applied discovery interviewing to improve the launch decision.');
  await expect.poll(() => state.customResponseBodies.length, { timeout: 5000 }).toBeGreaterThan(0);
  const saved = state.customResponseBodies.at(-1) as { respondentRole: string; responses: Array<Record<string, unknown>> };
  expect(saved.respondentRole).toBe('employee');
  expect(saved.responses).toEqual(expect.arrayContaining([
    expect.objectContaining({ sectionId: 'learning', questionId: 'learning_applied', value: 'I applied discovery interviewing to improve the launch decision.' }),
  ]));
});

test('drills from organization analytics into top performers and a selected team', async ({ page }) => {
  const state = createState();
  state.hrAdminMode = true;
  await installMockApi(page, state);

  await page.goto('/analytics');
  await expect(page.getByRole('heading', { name: 'Performance analytics' })).toBeVisible();
  await expect(page.getByText('4.2/5')).toBeVisible();
  await page.getByRole('tab', { name: /Top performers/ }).click();
  await expect(page.getByText('Jordan Lee', { exact: true })).toBeVisible();
  await expect(page.getByText('96%')).toBeVisible();

  await page.getByRole('tab', { name: 'Teams and departments' }).click();
  await page.getByRole('button', { name: 'Drill down' }).first().click();
  await expect.poll(() => state.analyticsRequestPaths.some((path) => path.includes('teamId=team-1'))).toBe(true);
  await expect(page.getByText('4', { exact: true }).first()).toBeVisible();
});

test('shows immutable appraisal goals with no save step and continues to self-assessment', async ({ page }) => {
  const state = createState();
  await installMockApi(page, state);

  await page.goto('/appraisals/507f1f77bcf86cd799439011/goal-setting');

  await expect(page.getByRole('heading', { name: 'Goals in this appraisal' })).toBeVisible();
  await expect(page.getByText('No save is needed.')).toBeVisible();
  await expect(page.getByText('Build launch readiness')).toBeVisible();
  await expect(page.getByText('Version 2')).toBeVisible();
  await expect(page.getByText('75%').first()).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Submit OKRs/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Continue self-assessment' }).click();
  await expect(page).toHaveURL(/\/appraisals\/507f1f77bcf86cd799439011\/self-assessment$/);
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

test('keeps an employee in a personal-only performance workspace', async ({ page }) => {
  const state = createState();
  await installMockApi(page, state);

  await page.goto('/dashboard');

  await expect(page.getByRole('heading', { name: 'Your performance work, in one place.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'My OKRs', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Manager', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Admin', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Team', exact: true })).toHaveCount(0);
});

test('lets a line manager switch between personal and manager work without exposing admin tools', async ({ page }) => {
  const state = createState();
  state.managerMode = true;
  await installMockApi(page, state);

  await page.goto('/dashboard');
  await expect(page.getByRole('button', { name: 'Personal', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Admin', exact: true })).toHaveCount(0);

  await switchPerformanceWorkspace(page, 'Manager');
  await expect(page.getByRole('heading', { name: 'Keep your team’s performance work moving.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Team', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Team OKRs', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Team Appraisals', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'My OKRs', exact: true })).toHaveCount(0);
  expect(await page.getByRole('navigation').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

  await page.reload();
  await expect(page.getByRole('button', { name: 'Manager', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Keep your team’s performance work moving.' })).toBeVisible();

  await page.getByRole('link', { name: 'Team Appraisals', exact: true }).click();
  await expect(page.getByText('Manager appraisal queue')).toBeVisible();
  await expect(page.getByText('Only direct-report appraisals and manager actions are shown in this workspace.')).toBeVisible();

  await switchPerformanceWorkspace(page, 'Personal');
  await page.getByRole('link', { name: 'My Appraisals', exact: true }).click();
  await expect(page.getByText('Personal appraisals')).toBeVisible();
  await expect(page.getByText('Only appraisals where you are the employee are shown in this workspace.')).toBeVisible();
});

test('shows admin separately and includes manager only when the HR admin also manages people', async ({ page }) => {
  const adminState = createState();
  adminState.hrAdminMode = true;
  await installMockApi(page, adminState);

  await page.goto('/dashboard');
  await expect(page.getByRole('button', { name: 'Personal', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Personal', exact: true }).click();
  await expect(page.getByRole('menuitemradio', { name: /^Admin/ })).toBeVisible();
  await expect(page.getByRole('menuitemradio', { name: /^Manager/ })).toHaveCount(0);
  await page.getByRole('menuitemradio', { name: /^Admin/ }).click();
  await expect(page.getByRole('heading', { name: 'Run a clear and consistent performance process.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Cycles', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Calibration', exact: true })).toBeVisible();

  const combinedState = createState();
  combinedState.hrAdminMode = true;
  combinedState.managerMode = true;
  const combinedPage = await page.context().newPage();
  await installMockApi(combinedPage, combinedState);
  await combinedPage.goto('/dashboard');
  await expect(combinedPage.getByRole('button', { name: 'Admin', exact: true })).toBeVisible();
  await combinedPage.getByRole('button', { name: 'Admin', exact: true }).click();
  await expect(combinedPage.getByRole('menuitemradio', { name: /^Personal/ })).toBeVisible();
  await expect(combinedPage.getByRole('menuitemradio', { name: /^Manager/ })).toBeVisible();
  await expect(combinedPage.getByRole('menuitemradio', { name: /^Admin/ })).toBeVisible();
  await combinedPage.close();
});

test('keeps the HR navigation on one line and renders page help as a compact utility row', async ({ page }) => {
  const state = createState();
  state.hrAdminMode = true;
  await page.setViewportSize({ width: 1796, height: 768 });
  await installMockApi(page, state);

  await page.goto('/dashboard');
  await switchPerformanceWorkspace(page, 'Admin');

  const header = page.getByRole('navigation');
  const guide = page.getByTestId('page-guide-banner');
  const dashboardHeader = page.locator('.suite-dashboard-header');
  await expect(header).toBeVisible();
  await expect(page.getByRole('link', { name: 'Overview', exact: true })).toBeVisible();
  await expect(guide).toBeVisible();
  await expect(dashboardHeader).toBeVisible();

  const headerBox = await header.boundingBox();
  const guideBox = await guide.boundingBox();
  const dashboardHeaderBox = await dashboardHeader.boundingBox();
  expect(headerBox?.height).toBeLessThanOrEqual(65);
  expect(guideBox?.height).toBeLessThanOrEqual(58);
  expect(dashboardHeaderBox!.y).toBeGreaterThanOrEqual(guideBox!.y + guideBox!.height);
  expect(await header.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

  for (const name of ['Dashboard', 'Overview', 'Cycles', 'Calibration', 'Reports', 'Analytics']) {
    const item = page.getByRole('link', { name, exact: true });
    await expect(item).toBeVisible();
    expect(await item.evaluate((element) => getComputedStyle(element).whiteSpace)).toBe('nowrap');
    expect((await item.boundingBox())?.height).toBeLessThanOrEqual(42);
  }
});

test('keeps manager navigation and workspace controls separated at common desktop widths', async ({ page }) => {
  const state = createState();
  state.hrAdminMode = true;
  state.managerMode = true;
  await page.setViewportSize({ width: 1694, height: 768 });
  await installMockApi(page, state);

  await page.goto('/dashboard');
  await switchPerformanceWorkspace(page, 'Manager');

  const primary = page.getByTestId('desktop-primary-navigation');
  const actions = page.getByTestId('desktop-header-actions');
  await expect(primary).toBeVisible();
  await expect(actions).toBeVisible();
  await expect(page.getByRole('link', { name: 'Coaching', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Manager', exact: true })).toBeVisible();

  const primaryBox = await primary.boundingBox();
  const actionsBox = await actions.boundingBox();
  expect(primaryBox!.x + primaryBox!.width).toBeLessThanOrEqual(actionsBox!.x);
  expect(await page.getByRole('navigation').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test('connects an employee ChatGPT account and records explicit consent before routing AI work', async ({ page }) => {
  const state = createState();
  await installMockApi(page, state);

  await page.goto('/ai-account');
  await expect(page.getByRole('heading', { level: 1, name: 'ChatGPT account' })).toBeVisible();
  await expect(page.getByText('No ChatGPT credentials are stored in Performance Management.')).toBeVisible();
  await page.getByRole('button', { name: 'Connect ChatGPT' }).click();
  await expect(page.getByText('ABCD-EFGH')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open OpenAI' })).toHaveAttribute('href', 'https://chatgpt.com/device');

  state.chatGptAccount.status = 'connected';
  state.chatGptAccount.connectedEmail = 'alex@example.com';
  state.chatGptAccount.planType = 'Plus';
  state.chatGptAccount.connectedAt = new Date().toISOString();
  await expect(page.getByRole('button', { name: 'Consent and use ChatGPT' })).toBeVisible({ timeout: 5000 });
  await page.getByRole('button', { name: 'Consent and use ChatGPT' }).click();

  await expect(page.getByText('ChatGPT is now the AI runtime for your Performance Management work.')).toBeVisible();
  await expect(page.getByText('Ready')).toBeVisible();
  expect(state.chatGptAccount.routable).toBe(true);
  expect(state.aiRuntimePreferenceBodies).toEqual([{ runtimePreference: 'chatgpt' }]);
});

test('locks conversational self-assessment until ChatGPT is connected', async ({ page }) => {
  const state = createState();
  await installMockApi(page, state);

  await page.goto('/appraisals/507f1f77bcf86cd799439011/self-assessment');

  const dialog = page.getByRole('dialog', { name: 'ChatGPT is required' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('The conversation cannot begin or continue without it.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Go back' })).toBeVisible();
  await expect(page.getByText('Start Your Self-Assessment')).toHaveCount(0);
  expect(state.conversationContextCalls).toBe(0);

  await dialog.getByRole('button', { name: 'Connect ChatGPT' }).click();
  await expect(page).toHaveURL(/\/ai-account\?connect=1&returnTo=/);
  await expect(page.getByText('ABCD-EFGH')).toBeVisible();
});

test('opens conversational self-assessment only for a routable ChatGPT account', async ({ page }) => {
  const state = createState();
  state.chatGptAccount = {
    status: 'connected',
    connectedEmail: 'alex@example.com',
    planType: 'Plus',
    connectedAt: new Date().toISOString(),
    lastVerifiedAt: new Date().toISOString(),
    dataSharingAcknowledgedAt: new Date().toISOString(),
    routable: true,
    lastError: null,
  };
  await installMockApi(page, state);

  await page.goto('/appraisals/507f1f77bcf86cd799439011/self-assessment');

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Start Your Self-Assessment' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Begin Conversation' })).toBeVisible();
  expect(state.conversationContextCalls).toBeGreaterThanOrEqual(1);
});
