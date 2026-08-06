import { expect, test, type Page, type Route } from '@playwright/test';

async function json(route: Route, value: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
}

function templateVersion(reviewedByUserId: string) {
  return {
    id: 'version-3', templateId: 'template-governed', scope: 'system', spaceId: null,
    versionNumber: 3, schemaVersion: 1, state: 'in_review', name: 'Account recovery',
    description: 'A reviewed recovery journey.', industry: 'Software', useCase: 'Account recovery',
    experienceType: 'customer', mapType: 'current_state',
    lanes: [{ laneType: 'customer_actions', title: 'Customer actions', description: '', ordinal: 0, blueprintOnly: false }],
    stages: [{ key: 'request-help', name: 'Request help', goal: 'Regain account access', cards: [] }],
    contentChecksum: 'abc123def4567890', revision: 7, createdByUserId: 'author-1',
    reviewedByUserId, reviewedAt: '2026-08-04T11:00:00.000Z', publishedByUserId: null,
    publishedAt: null, retiredByUserId: null, retiredAt: null,
    createdAt: '2026-08-04T10:00:00.000Z', updatedAt: '2026-08-04T11:00:00.000Z'
  };
}

async function installGovernanceMocks(page: Page, adminId: string, reviewedByUserId: string) {
  let version = templateVersion(reviewedByUserId);
  let templateRevision = 4;
  let rejectedBody: Record<string, unknown> | null = null;
  const events = [{
    id: 'audit-review', templateId: 'template-governed', templateVersionId: 'version-3', spaceId: null,
    actorUserId: reviewedByUserId, action: 'submitted_for_review', reason: 'Ready for independent approval',
    before: { state: 'draft' }, after: { state: 'in_review' }, createdAt: '2026-08-04T11:00:00.000Z'
  }];
  const currentTemplate = () => ({
    id: 'template-governed', scope: 'system', spaceId: null, key: 'account-recovery', status: 'active',
    currentVersionId: 'version-3', publishedVersionId: null, revision: templateRevision,
    createdByUserId: 'author-1', createdAt: '2026-08-04T10:00:00.000Z',
    updatedAt: '2026-08-04T11:00:00.000Z', versions: [version]
  });

  await page.route('**/api/auth/session', (route) => json(route, {
    authenticated: true, email: 'template-admin@example.test',
    user: { id: adminId, email: 'template-admin@example.test', name: 'Template admin', role: 'admin' },
    emailVerified: true, onboardingRequired: false, profile: null,
    permissions: { platformAdmin: true, rootPlatformAdmin: false, platformRoles: ['analyst'] },
    spaces: [], activeSpace: null, pendingSpaceInvitations: [], subscription: null
  }));
  await page.route(/\/api\/platform-admin\/me(?:\?.*)?$/u, (route) => json(route, {
    user: { id: adminId, name: 'Template admin', email: 'template-admin@example.test' },
    roles: ['template-admin'], permissions: ['journey_templates.read', 'journey_templates.manage'],
    root: false, capabilities: { readJourneyTemplates: true, manageJourneyTemplates: true }
  }));
  await page.route(/\/api\/platform-admin\/journey-templates$/u,
    (route) => json(route, { templates: [currentTemplate()] }));
  await page.route(/\/api\/platform-admin\/journey-templates\/template-governed\/audit(?:\?.*)?$/u,
    (route) => json(route, { events, nextBefore: '2026-08-01T00:00:00.000Z' }));
  await page.route(/\/api\/platform-admin\/journey-templates\/template-governed\/versions\/version-3\/reject$/u,
    async (route) => {
      rejectedBody = route.request().postDataJSON();
      templateRevision += 1;
      version = {
        ...version, state: 'draft', revision: version.revision + 1, reviewedByUserId: null,
        reviewedAt: null, updatedAt: '2026-08-04T12:00:00.000Z'
      };
      events.unshift({
        id: 'audit-reject', templateId: 'template-governed', templateVersionId: 'version-3', spaceId: null,
        actorUserId: adminId, action: 'review_rejected', reason: String(rejectedBody?.reason || ''),
        before: { state: 'in_review' }, after: { state: 'draft' }, createdAt: '2026-08-04T12:00:00.000Z'
      });
      return json(route, version);
    });

  return { rejectedBody: () => rejectedBody };
}

test('review submitter cannot self-publish, can reject with a reason, and sees the audit trail', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Template approval governance is covered on one desktop browser.');
  const mocks = await installGovernanceMocks(page, 'reviewer-1', 'reviewer-1');
  await page.goto('/admin/journey-templates');

  const governance = page.getByTestId('system-journey-template-governance');
  await expect(governance).toBeVisible();
  await expect(governance.getByTestId('template-two-person-status')).toContainText('A different administrator must publish it');
  await expect(governance.getByTestId('publish-reviewed-template')).toBeDisabled();
  await expect(governance.getByTestId('system-template-audit')).toContainText('Submitted for review');
  await expect(governance.getByTestId('system-template-audit')).toContainText('Ready for independent approval');
  await expect(governance.getByTestId('system-template-audit')).toContainText('Latest 20 events');

  const reason = governance.getByLabel('Change reason');
  await reason.fill('No');
  await expect(governance.getByTestId('reject-reviewed-template')).toBeDisabled();
  await reason.fill('Clarify the account ownership handoff');
  await expect(governance.getByTestId('publish-reviewed-template')).toBeDisabled();
  await expect(governance.getByTestId('reject-reviewed-template')).toBeEnabled();
  await governance.getByTestId('reject-reviewed-template').click();

  await expect(governance.getByText('Draft', { exact: true }).first()).toBeVisible();
  expect(mocks.rejectedBody()).toMatchObject({ reason: 'Clarify the account ownership handoff' });
  await expect(governance.getByTestId('system-template-audit')).toContainText('Review rejected');
  await expect(governance.getByTestId('system-template-audit')).toContainText('Clarify the account ownership handoff');
});

test('a second administrator receives the independent publish affordance', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Template approval governance is covered on one desktop browser.');
  await installGovernanceMocks(page, 'publisher-2', 'reviewer-1');
  await page.goto('/admin/journey-templates');

  const governance = page.getByTestId('system-journey-template-governance');
  await expect(governance.getByTestId('template-two-person-status')).toContainText('reviewed by a different administrator');
  const publish = governance.getByTestId('publish-reviewed-template');
  await expect(publish).toBeDisabled();
  await governance.getByLabel('Change reason').fill('Independent approval for customer use');
  await expect(publish).toBeEnabled();
});
