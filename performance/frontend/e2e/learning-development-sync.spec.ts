import { expect, test } from '@playwright/test';

test('synchronized Learning activity can be added to a development plan', async ({ page }) => {
  const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
  const learningRecord = {
    _id: 'record-1',
    subjectId: 'user-1',
    enrollmentId: 'enrollment-1',
    courseId: 'course-1',
    courseTitle: 'Leading effective teams',
    courseUrl: 'https://learning.seemplifyai.com/simple-lms/learn/enrollment-1',
    status: 'in_progress',
    progressPercent: 42,
    lastActivityAt: '2026-08-12T09:00:00.000Z',
  };
  const teamLearningRecord = {
    ...learningRecord,
    _id: 'record-2',
    subjectId: 'member-1',
    enrollmentId: 'enrollment-2',
    courseId: 'course-2',
    courseTitle: 'Coaching fundamentals',
    progressPercent: 75,
  };
  const plan = {
    _id: 'plan-1',
    userId: 'user-1',
    managerId: 'manager-1',
    organizationId: 'org-1',
    title: 'Leadership development',
    description: 'Prepare for broader team leadership.',
    startDate: '2026-01-01T00:00:00.000Z',
    targetDate: '2026-12-31T00:00:00.000Z',
    status: 'active',
    overallProgress: 0,
    careerGoals: [],
    skillDevelopment: [],
    learningActivities: [] as Array<Record<string, unknown>>,
    checkIns: [],
  };

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
        user: { id: 'user-1', sub: 'user-1', email: 'alex@example.com', profile: { displayName: 'Alex Morgan' } },
        currentOrganizationId: 'org-1',
        currentOrganization: { id: 'org-1', name: 'Acme Ltd', role: 'employee' },
      });
    }
    if (method === 'GET' && path === '/user/context') {
      return fulfill({
        success: true,
        data: {
          user: { id: 'user-1', sub: 'user-1', email: 'alex@example.com' },
          role: { name: 'line_manager', displayName: 'Line Manager', isManager: true, isHRAdmin: false, isTeamLead: true },
          organization: { id: 'org-1', name: 'Acme Ltd' },
          teams: [{ id: 'team-1', name: 'Customer Success', role: 'line_manager', isManager: true }],
          features: { continuousPerformance: true },
        },
      });
    }
    if (method === 'GET' && path === '/user/current-team') {
      const team = { id: 'team-1', name: 'Customer Success', role: 'line_manager' };
      return fulfill({ success: true, data: { currentTeam: team, availableTeams: [team] } });
    }
    if (method === 'GET' && path === '/user/my-team-members') {
      return fulfill({
        success: true,
        data: {
          isManager: true,
          teams: [{ id: 'team-1', name: 'Customer Success' }],
          directReports: [{ userId: 'member-1', name: 'Jordan Lee', email: 'jordan@example.com' }],
          totalDirectReports: 1,
        },
      });
    }
    if (method === 'GET' && path === '/development-plans') {
      return fulfill({ success: true, data: [plan] });
    }
    if (method === 'GET' && path === '/learning/records') {
      const record = url.searchParams.get('employeeId') === 'member-1' ? teamLearningRecord : learningRecord;
      return fulfill({
        success: true,
        data: {
          records: [record],
          summary: { total: 1, assigned: 0, inProgress: 1, completed: 0, overdue: 0 },
          learningUrl: 'https://learning.seemplifyai.com',
        },
      });
    }
    if (method === 'GET' && path === '/learning/team') {
      return fulfill({
        success: true,
        data: {
          learners: [{
            employeeId: 'member-1',
            identifiers: ['member-1'],
            name: 'Jordan Lee',
            email: 'jordan@example.com',
            total: 1,
            assigned: 0,
            inProgress: 1,
            completed: 0,
            overdue: 0,
          }],
          totalLearners: 1,
        },
      });
    }
    if (method === 'POST' && path === '/learning/records/record-1/link-plan') {
      const body = request.postDataJSON() as Record<string, unknown>;
      posts.push({ path, body });
      plan.learningActivities = [{
        title: learningRecord.courseTitle,
        type: 'course',
        status: 'in_progress',
        source: 'seemplify_learning',
        progressPercent: 42,
        learningEnrollmentId: 'enrollment-1',
      }];
      return fulfill({ success: true, data: plan, alreadyLinked: false });
    }
    return fulfill({ success: true, data: [] });
  });

  await page.goto('/development');
  await expect(page.getByRole('heading', { name: 'Seemplify Learning record' })).toBeVisible();
  await expect(page.getByText('Leading effective teams')).toBeVisible();
  await expect(page.getByText('In progress · 42%')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open Learning' })).toHaveAttribute('href', 'https://learning.seemplifyai.com');

  await page.getByRole('button', { name: 'Add to plan' }).click();
  await expect(page.getByRole('dialog', { name: 'Add course to a development plan' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Add to plan' }).click();
  await expect(page.getByText('Course added to the development plan. Its progress will stay synchronized.')).toBeVisible();
  expect(posts).toEqual([{ path: '/learning/records/record-1/link-plan', body: { planId: 'plan-1' } }]);

  await page.getByRole('button', { name: 'View Details' }).click();
  await page.getByText('Learning Activities (0/1)').click();
  await expect(page.getByText('Synced from Seemplify Learning · 42% complete')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark complete' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close' }).click();

  await page.getByLabel('Learning record').click();
  await page.getByRole('option', { name: 'Jordan Lee' }).click();
  await expect(page.getByRole('heading', { name: "Jordan Lee's Learning record" })).toBeVisible();
  await expect(page.getByText('Coaching fundamentals')).toBeVisible();
  await expect(page.getByText('In progress · 75%')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: "Jordan Lee's Learning record" })).toBeVisible();
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(horizontalOverflow).toBeLessThanOrEqual(1);
});
