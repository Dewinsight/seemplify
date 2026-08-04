import { expect, test, type Page, type Route } from '@playwright/test';

const rootPermissions = [
  'users.read', 'users.create', 'users.manage', 'roles.read', 'roles.manage',
  'spaces.read', 'spaces.manage', 'subscriptions.read', 'subscriptions.manage',
  'analytics.read', 'ai_defaults.read', 'ai_defaults.manage', 'jobs.read',
  'activity.read', 'audit.read'
];

const permissionCatalog = rootPermissions.map((id) => ({
  id,
  label: id.split('.').map((part) => part.replaceAll('_', ' ')).join(' '),
  description: `Deterministic ${id} permission fixture.`
}));

const seededRoles = [
  {
    id: 'admin', name: 'Admin', description: 'Full control-plane administration.', builtIn: true, version: 1,
    permissions: rootPermissions, createdAt: '2026-08-04T00:00:00.000Z', updatedAt: '2026-08-04T00:00:00.000Z'
  },
  {
    id: 'editor', name: 'Editor', description: 'Operational management without role administration.', builtIn: true, version: 1,
    permissions: rootPermissions.filter((permission) => !['roles.manage', 'subscriptions.manage'].includes(permission)),
    createdAt: '2026-08-04T00:00:00.000Z', updatedAt: '2026-08-04T00:00:00.000Z'
  },
  {
    id: 'viewer', name: 'Viewer', description: 'Read-only platform access.', builtIn: true, version: 1,
    permissions: rootPermissions.filter((permission) => permission.endsWith('.read')),
    createdAt: '2026-08-04T00:00:00.000Z', updatedAt: '2026-08-04T00:00:00.000Z'
  }
];

const codexModels = [
  {
    id: 'gpt-5.6-sol', displayName: 'GPT-5.6 Sol', isDefault: true, defaultReasoningEffort: 'low',
    supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']
      .map((reasoningEffort) => ({ reasoningEffort }))
  },
  {
    id: 'gpt-5.6-luna', displayName: 'GPT-5.6 Luna', isDefault: false, defaultReasoningEffort: 'medium',
    supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max']
      .map((reasoningEffort) => ({ reasoningEffort }))
  }
];

const codexActions = [
  {
    id: 'analyst.chat', group: 'Analysis', label: 'Analyst chat',
    description: 'Answer an analyst question.', defaultReasoningEffort: 'high'
  },
  {
    id: 'report.generate', group: 'Reports', label: 'Generate report',
    description: 'Generate an experience report.', defaultReasoningEffort: 'high'
  }
];

type Defaults = {
  codexModel: string | null;
  codexReasoningEffort: string | null;
  codexActionOverrides: Record<string, { model: string | null; reasoningEffort: string | null }>;
  updatedAt: string | null;
};

async function json(route: Route, value: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
}

async function loginRoot(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password', { exact: true }).fill('Playwright-Test-Password-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();
}

async function installControlPlaneMocks(page: Page) {
  let plans = [{
    code: 'starter', name: 'Starter', description: 'Core experience management for a small team.', requestable: true,
    features: { surveys: true, campaigns: true, agreements: true, serviceRecovery: true, socialListening: false, knowledgeBases: false, terra: true },
    limits: { seats: 3, activeSurveys: 10, monthlyAiActions: 100, knowledgeStorageBytes: 0 },
    displayOrder: 10, version: 1, activeSubscriptions: 4, pendingRequests: 0,
    createdAt: '2026-08-04T00:00:00.000Z', updatedAt: '2026-08-04T00:00:00.000Z'
  }];
  const planWrites: unknown[] = [];
  let defaults: Defaults = {
    codexModel: null,
    codexReasoningEffort: null,
    codexActionOverrides: {},
    updatedAt: null
  };
  const writes: Defaults[] = [];
  const unhandled: string[] = [];
  const defaultsState = () => ({
    defaults,
    codex: {
      available: true,
      account: {
        connected: true, email: 'qa@seemplify.local', planType: 'pro', authMode: 'chatgpt',
        pendingLogin: false, loginError: null
      },
      models: codexModels,
      actions: codexActions,
      error: null
    }
  });

  await page.route(/\/api\/platform-admin(?:\/|$)/, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (path === '/api/platform-admin/me' && method === 'GET') {
      return json(route, {
        user: { id: 'root-user', name: 'Workspace admin', email: 'qa@seemplify.local' },
        roles: ['superadmin'], adminRoles: [], permissions: rootPermissions, root: true,
        capabilities: {
          readPlatform: true, readUsers: true, createUsers: true, manageAccounts: true,
          readRoles: true, manageRoles: true, readSpaces: true, manageSpaces: true,
          readSubscriptions: true, manageSubscriptions: true, decideSubscriptions: true,
          readAnalytics: true, readAiDefaults: true, manageAiDefaults: true,
          readJobs: true, readActivity: true, readAudit: true
        }
      });
    }
    if (path === '/api/platform-admin/overview' && method === 'GET') {
      return json(route, {
        generatedAt: '2026-08-04T01:00:00.000Z',
        accounts: { total: 18, active: 16, restricted: 1, unverified: 1, new30d: 4 },
        spaces: { total: 12, active: 11, restricted: 1 },
        subscriptions: { active: 9, suspended: 1, cancelled: 2, pendingRequests: 0 },
        product: {
          surveys: 24, responses: 312, campaigns: 7, agreements: 5,
          aiJobs: 41, aiFailures: 2, openTickets: 1, knowledgeBases: 8
        },
        aiQueue: { queued: 1, processing: 2, completed: 36, failed: 2 }
      });
    }
    if (path === '/api/platform-admin/subscription-requests' && method === 'GET') {
      return json(route, { items: [], requests: [], total: 0,
        pagination: { limit: 1, offset: 0, total: 0, hasMore: false } });
    }
    if (path === '/api/platform-admin/plans' && method === 'GET') return json(route, { plans });
    if (path === '/api/platform-admin/plans/starter' && method === 'PUT') {
      const input = request.postDataJSON();
      planWrites.push(structuredClone(input));
      plans = [{ ...plans[0], ...input, version: plans[0].version + 1, updatedAt: '2026-08-04T01:30:00.000Z' }];
      return json(route, { plan: plans[0] });
    }
    if (path === '/api/platform-admin/rbac' && method === 'GET') {
      return json(route, { permissions: permissionCatalog, roles: seededRoles });
    }
    if (path === '/api/platform-admin/jobs' && method === 'GET') {
      const jobs = [{
        id: 'job-control-plane-1', kind: 'analyst.chat', state: 'failed', stage: 'provider error',
        progress: 100, attempt: 2,
        requester: { id: 'requester-1', name: 'Research Operator', email: 'operator@example.test' },
        space: { id: 'space-enterprise', name: 'Enterprise Research' },
        runtime: {
          source: 'job_snapshot', status: 'planned', provider: 'codex', providerLabel: 'ChatGPT / Codex', model: 'gpt-5.6-sol',
          reasoningEffort: 'max', actionId: 'analyst.chat'
        },
        retryAt: null,
        error: {
          code: 'AI_JOB_FAILED',
          message: 'The AI job failed. Use the job ID to inspect protected service logs.'
        },
        createdAt: '2026-08-04T00:30:00.000Z',
        startedAt: '2026-08-04T00:31:00.000Z', completedAt: '2026-08-04T00:32:00.000Z',
        updatedAt: '2026-08-04T00:32:00.000Z'
      }];
      return json(route, {
        items: jobs, jobs, total: 1, pagination: { limit: 50, offset: 0, total: 1, hasMore: false },
        summary: { total: 41, active: 3, failed: 2, byState: { queued: 1, processing: 2, completed: 36, failed: 2 } }
      });
    }
    if (path === '/api/platform-admin/activity' && method === 'GET') {
      const activity = [{
        id: 'survey.created:survey-control-plane-1', type: 'survey.created', entityType: 'survey',
        entityId: 'survey-control-plane-1', status: 'active', kind: null,
        actor: { id: 'requester-1', name: 'Research Operator', email: 'operator@example.test' },
        space: { id: 'space-enterprise', name: 'Enterprise Research' },
        occurredAt: '2026-08-04T00:20:00.000Z'
      }];
      return json(route, { items: activity, activity, total: 1,
        pagination: { limit: 50, offset: 0, total: 1, hasMore: false } });
    }
    if (path === '/api/platform-admin/ai-defaults' && method === 'GET') return json(route, defaultsState());
    if (path === '/api/platform-admin/ai-defaults' && method === 'PUT') {
      const input = request.postDataJSON() as Omit<Defaults, 'updatedAt'>;
      defaults = { ...input, updatedAt: '2026-08-04T01:15:00.000Z' };
      writes.push(structuredClone(defaults));
      return json(route, defaultsState());
    }
    if (path === '/api/platform-admin/ai-defaults' && method === 'DELETE') {
      defaults = { codexModel: null, codexReasoningEffort: null, codexActionOverrides: {}, updatedAt: '2026-08-04T01:20:00.000Z' };
      return json(route, { defaults });
    }
    unhandled.push(`${method} ${path}`);
    return json(route, { error: `Unhandled deterministic control-plane route: ${method} ${path}` }, 501);
  });
  return { writes, planWrites, unhandled };
}

test.describe('platform administrator control plane', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'The focused control-plane flow runs once at desktop width.');
    await loginRoot(page);
  });

  test('root navigation exposes the complete control plane', async ({ page }) => {
    const mock = await installControlPlaneMocks(page);
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Platform overview' })).toBeVisible();
    for (const link of ['Users', 'Roles & permissions', 'Plans', 'AI queue', 'Activity', 'AI defaults', 'Audit log']) {
      await expect(page.getByRole('link', { name: link, exact: true })).toBeVisible();
    }
    await expect(page.getByText('18', { exact: true }).first()).toBeVisible();
    expect(mock.unhandled).toEqual([]);
  });

  test('subscription plans expose live feature and quota management', async ({ page }) => {
    const mock = await installControlPlaneMocks(page);
    await page.goto('/admin/plans');
    await expect(page.getByRole('heading', { name: 'Plans' })).toBeVisible();
    const starter = page.getByRole('row').filter({ hasText: 'Starter' });
    await expect(starter).toContainText('100');
    await starter.getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Plan name').fill('Starter Plus');
    await page.getByLabel('Social Listening').check();
    await page.getByLabel('AI actions per month').fill('250');
    await page.getByLabel('Reason for this change').fill('Expand the Starter plan for the new workspace rollout.');
    await page.getByRole('button', { name: 'Save plan' }).click();
    await expect(page.getByText('Starter Plus plan saved.')).toBeVisible();
    expect(mock.planWrites).toHaveLength(1);
    expect(mock.planWrites[0]).toMatchObject({
      name: 'Starter Plus',
      features: { socialListening: true },
      limits: { monthlyAiActions: 250 },
      expectedVersion: 1
    });
    expect(mock.unhandled).toEqual([]);
  });

  test('seeded administrator roles render with their permission catalog', async ({ page }) => {
    const mock = await installControlPlaneMocks(page);
    await page.goto('/admin/roles');
    const roles = page.getByTestId('platform-admin-roles');
    await expect(roles.getByRole('heading', { name: 'Roles & permissions' })).toBeVisible();
    for (const name of ['Admin', 'Editor', 'Viewer']) {
      await expect(roles.getByRole('button', { name: new RegExp(`^${name}\\b`) })).toBeVisible();
    }
    await expect(roles.getByText('Built in')).toHaveCount(3);
    await expect(roles.getByText('Version 1', { exact: false })).toBeVisible();
    expect(mock.unhandled).toEqual([]);
  });

  test('global AI queue and activity pages render operational records', async ({ page }) => {
    const mock = await installControlPlaneMocks(page);
    await page.goto('/admin/jobs');
    await expect(page.getByRole('heading', { name: 'AI queue' })).toBeVisible();
    const job = page.getByTestId('admin-job-row-job-control-plane-1');
    await expect(job).toContainText('analyst chat');
    await expect(job).toContainText('Enterprise Research');
    await expect(job).toContainText('gpt-5.6-sol');
    await expect(job).toContainText('max');
    await expect(page.getByText('41', { exact: true }).first()).toBeVisible();

    await page.getByRole('link', { name: 'Activity', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible();
    const activity = page.getByTestId('admin-activity-row-survey.created:survey-control-plane-1');
    await expect(activity).toContainText('survey created');
    await expect(activity).toContainText('Research Operator');
    await expect(activity).toContainText('Enterprise Research');
    expect(mock.unhandled).toEqual([]);
  });

  test('admin AI defaults save and clear without a real ChatGPT request', async ({ page }) => {
    const mock = await installControlPlaneMocks(page);
    await page.goto('/admin/ai-defaults');
    await expect(page.getByRole('heading', { name: 'AI defaults' })).toBeVisible();
    await page.getByLabel('Default Codex model').selectOption('gpt-5.6-sol');
    await page.getByLabel('Default reasoning effort').selectOption('max');
    await page.getByLabel('Model for Analyst chat').selectOption('gpt-5.6-luna');
    await page.getByLabel('Effort for Analyst chat').selectOption('xhigh');
    await page.getByRole('button', { name: 'Save defaults' }).click();
    await expect(page.getByText('Platform Codex defaults saved.')).toBeVisible();
    expect(mock.writes).toHaveLength(1);
    expect(mock.writes[0]).toMatchObject({
      codexModel: 'gpt-5.6-sol',
      codexReasoningEffort: 'max',
      codexActionOverrides: {
        'analyst.chat': { model: 'gpt-5.6-luna', reasoningEffort: 'xhigh' }
      }
    });

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Clear defaults' }).click();
    await expect(page.getByText('Platform Codex defaults cleared.')).toBeVisible();
    await expect(page.getByLabel('Default Codex model')).toHaveValue('');
    await expect(page.getByLabel('Default reasoning effort')).toHaveValue('');
    expect(mock.unhandled).toEqual([]);
  });
});
