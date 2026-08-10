import { expect, test, type Page, type Route } from '@playwright/test';

const password = 'Playwright-Test-Password-2026!';
const now = '2026-08-07T12:00:00.000Z';
const nodes = [
  { definitionId: 'macro', spaceId: 'space', name: 'Enterprise onboarding', ownerUserId: null, stageKeys: ['onboarding'], taxonomyTermIds: [] as string[] },
  { definitionId: 'signup', spaceId: 'space', name: 'Signup', ownerUserId: null, stageKeys: ['create-account'], taxonomyTermIds: [] as string[] },
  { definitionId: 'verification', spaceId: 'space', name: 'Verification', ownerUserId: null, stageKeys: ['verify'], taxonomyTermIds: [] as string[] },
  { definitionId: 'implementation', spaceId: 'space', name: 'Implementation', ownerUserId: null, stageKeys: ['configure'], taxonomyTermIds: [] as string[] },
  { definitionId: 'support', spaceId: 'space', name: 'Support', ownerUserId: null, stageKeys: ['resolve'], taxonomyTermIds: [] as string[] }
];
const link = (id: string, fromDefinitionId: string, toDefinitionId: string, type = 'parent_child') => ({
  id, spaceId: 'space', type, fromDefinitionId, toDefinitionId, fromVersionId: null, toVersionId: null,
  fromStageKey: null, toStageKey: null, variantDimension: null, variantValueId: null,
  handoffOwnerUserId: null, handoffOwnerTeamId: null, reviewState: 'draft', reviewedByUserId: null,
  reviewedAt: null, lifecycle: 'active', revision: 1, createdAt: now, updatedAt: now
});
let links = [link('macro-signup', 'macro', 'signup'), link('macro-verification', 'macro', 'verification'),
  link('implementation-verification', 'implementation', 'verification')];
let terms = [{ id: 'regulated', kind: 'tag', name: 'Regulated', parentTermId: null, lifecycle: 'active', revision: 1, createdAt: now, updatedAt: now }];
let settings = { enabled: true, hierarchyEnabled: true, blueprintsEnabled: true, maximumDepth: 12, maximumLinks: 2000,
  revision: 1, updatedAt: now };
const hash = 'a'.repeat(64);
let policies: any[] = [];
let snapshots: any[] = [];
let workspaceViews: any[] = [];
let workspacePreferenceRevision = 0;

async function mockWorkspaceViews(page: Page) {
  await page.route(/\/api\/journey-workspace-saved-views(?:\/.*)?(?:\?.*)?$/u, async (route) => {
    const request = route.request(); const url = new URL(request.url()); const method = request.method();
    if (url.pathname === '/api/journey-workspace-saved-views' && method === 'GET') return route.fulfill({ json: {
      views: workspaceViews, defaultViewId: workspaceViews[0]?.id || null, preferenceRevision: workspacePreferenceRevision
    } });
    if (url.pathname === '/api/journey-workspace-saved-views' && method === 'POST') {
      const body = request.postDataJSON(); const view = { id: 'hierarchy-view-1', surface: 'hierarchy', audience: body.audience,
        name: body.name, state: 'active', revision: 1, versionId: 'hierarchy-view-version-1', versionNumber: 1,
        configuration: body.configuration, configurationSha256: hash, createdAt: now, updatedAt: now };
      workspaceViews = [view]; return route.fulfill({ status: 201, json: { viewId: view.id, replayed: false } });
    }
    return route.fulfill({ status: 404, json: { error: `Unexpected saved-view fixture ${method} ${url.pathname}` } });
  });
}

function hierarchy() {
  return { nodes, links, validation: { spaceId: 'space', roots: ['implementation', 'macro', 'support'],
    topologicalOrder: ['implementation', 'macro', 'signup', 'support', 'verification'], maximumDepth: 1,
    childIdsByParent: { implementation: ['verification'], macro: ['signup', 'verification'] },
    childEntries: [{ parentDefinitionId: 'implementation', childDefinitionIds: ['verification'] },
      { parentDefinitionId: 'macro', childDefinitionIds: ['signup', 'verification'] }] },
  settings };
}

function snapshot(id = 'snapshot-1') {
  const rules = { version: 'strict-v1', ownWeight: 0.5, missingChild: 'unknown', healthyAt: 80, watchAt: 60 };
  return { id, definitionId: 'macro', definitionRevision: 1, score: null, status: 'unknown',
    explanation: 'Health is unknown because the policy requires every direct child to have a score.',
    components: [{ kind: 'policy', configuration: rules },
      { kind: 'child', definitionId: 'signup', score: null, effectiveWeight: 0 },
      { kind: 'child', definitionId: 'verification', score: 82, effectiveWeight: 0 }],
    children: [{ kind: 'child', definitionId: 'signup', score: null, effectiveWeight: 0 },
      { kind: 'child', definitionId: 'verification', score: 82, effectiveWeight: 0 }], own: null,
    childLineage: ['verification@manual-1'], policy: { id: policies[0]?.id || 'policy-1', version: 'strict-v1',
      revision: 1, configurationSha256: hash, rules }, calculatedAt: now };
}

async function signIn(page: Page) {
  await page.goto('/login'); await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password', { exact: true }).fill(password); await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/');
}

async function enableHierarchyFeature(page: Page, readOnly = false) {
  await page.route('**/api/auth/session', async (route) => {
    const response = await route.fetch(); const body = await response.json();
    if (body?.subscription?.features) { body.subscription.features.journeyHierarchy = true; body.subscription.features.journeyExports = true; }
    if (readOnly && body?.activeSpace) body.activeSpace.role = 'member';
    await route.fulfill({ response, json: body });
  });
}

async function mockHierarchy(page: Page) {
  await page.route(/\/api\/journey-hierarchy(?:\/.*)?(?:\?.*)?$/u, async (route: Route) => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname; const method = request.method();
    if (path === '/api/journey-hierarchy' && method === 'GET') return route.fulfill({ json: hierarchy() });
    if (path === '/api/journey-hierarchy/export.json' && method === 'GET') return route.fulfill({
      status: 200, contentType: 'application/json; charset=utf-8',
      headers: { 'Content-Disposition': 'attachment; filename="journey-hierarchy.json"',
        'X-Content-SHA256': hash }, body: JSON.stringify({ schemaVersion: 'journey-hierarchy-export/v1', hierarchy: hierarchy() })
    });
    if (path === '/api/journey-hierarchy/settings' && method === 'GET') return route.fulfill({ json: { settings } });
    if (path === '/api/journey-hierarchy/settings' && method === 'PATCH') { const body = request.postDataJSON();
      const { expectedRevision: _expectedRevision, ...changes } = body; settings = { ...settings, ...changes,
        enabled: changes.hierarchyEnabled ?? settings.enabled, revision: settings.revision + 1, updatedAt: now };
      return route.fulfill({ json: { settings } }); }
    if (path === '/api/journey-hierarchy/health/policies' && method === 'GET') return route.fulfill({ json: { policies } });
    if (path === '/api/journey-hierarchy/health/policies' && method === 'POST') { const body = request.postDataJSON();
      const policy = { id: `policy-${policies.length + 1}`, name: body.name, lifecycle: body.lifecycle || 'active', ...body.policy,
        revision: 1, configurationSha256: hash, createdAt: now, updatedAt: now }; policies = [...policies, policy];
      return route.fulfill({ status: 201, json: { policy } }); }
    const policyMatch = path.match(/^\/api\/journey-hierarchy\/health\/policies\/([^/]+)$/u);
    if (policyMatch && method === 'PATCH') { const body = request.postDataJSON(); const current = policies.find((item) => item.id === policyMatch[1]);
      const { expectedRevision: _expectedRevision, policy: policyChanges, ...changes } = body;
      const updated = { ...current, ...changes, ...(policyChanges || {}), revision: current.revision + 1, updatedAt: now };
      policies = policies.map((item) => item.id === updated.id ? updated : item); return route.fulfill({ json: { policy: updated } }); }
    if (path === '/api/journey-hierarchy/health/snapshots' && method === 'GET') return route.fulfill({ json: { snapshots } });
    if (path === '/api/journey-hierarchy/health/snapshots' && method === 'POST') { snapshots = [snapshot(`snapshot-${snapshots.length + 1}`), ...snapshots];
      return route.fulfill({ status: 201, json: { snapshots: [snapshots[0]] } }); }
    const snapshotMatch = path.match(/^\/api\/journey-hierarchy\/health\/snapshots\/([^/]+)$/u);
    if (snapshotMatch && method === 'GET') return route.fulfill({ json: { snapshot: snapshots.find((item) => item.id === snapshotMatch[1]) } });
    if (path === '/api/journey-hierarchy/taxonomy' && method === 'GET') return route.fulfill({ json: { terms } });
    if (path === '/api/journey-hierarchy/links' && method === 'POST') {
      const body = request.postDataJSON(); const created = { ...link(`link-${links.length + 1}`, body.fromDefinitionId, body.toDefinitionId, body.type),
        fromStageKey: body.fromStageKey || null, variantDimension: body.variantDimension || null, variantValueId: body.variantValueId || null };
      links = [...links, created]; return route.fulfill({ status: 201, json: { link: created } });
    }
    const linkMatch = path.match(/^\/api\/journey-hierarchy\/links\/([^/]+)$/u);
    if (linkMatch && method === 'PATCH') { const body = request.postDataJSON(); const current = links.find((item) => item.id === linkMatch[1])!;
      const { expectedRevision: _expectedRevision, ...changes } = body;
      const updated = { ...current, ...changes, revision: current.revision + 1, reviewedByUserId: body.reviewState === 'draft' ? null : 'qa-user', reviewedAt: body.reviewState === 'draft' ? null : now };
      links = links.map((item) => item.id === updated.id ? updated : item); return route.fulfill({ json: { link: updated } }); }
    const traversalMatch = path.match(/^\/api\/journey-hierarchy\/traversal\/([^/]+)$/u);
    if (traversalMatch) return route.fulfill({ json: { traversal: { startDefinitionId: traversalMatch[1], direction: url.searchParams.get('direction') || 'both', definitionIds: ['implementation', 'macro', 'signup', 'verification'], linkIds: links.slice(0, 3).map((item) => item.id), inaccessibleLinkCount: 1, truncated: false } } });
    const breadcrumbMatch = path.match(/^\/api\/journey-hierarchy\/breadcrumbs\/([^/]+)$/u);
    if (breadcrumbMatch) return route.fulfill({ json: { breadcrumbs: { targetDefinitionId: breadcrumbMatch[1], trails: breadcrumbMatch[1] === 'verification' ? [{ definitionIds: ['implementation', 'verification'], hasInaccessibleAncestor: false }, { definitionIds: ['macro', 'verification'], hasInaccessibleAncestor: false }] : [{ definitionIds: [breadcrumbMatch[1]], hasInaccessibleAncestor: false }], truncated: false, inaccessibleParentCount: 0 } } });
    if (path === '/api/journey-hierarchy/taxonomy' && method === 'POST') { const body = request.postDataJSON(); const term = { id: `term-${terms.length + 1}`, kind: body.kind, name: body.name, parentTermId: body.parentTermId || null, lifecycle: 'active', revision: 1, createdAt: now, updatedAt: now }; terms = [...terms, term]; return route.fulfill({ status: 201, json: { term } }); }
    const taxonomyMatch = path.match(/^\/api\/journey-hierarchy\/taxonomy\/([^/]+)$/u);
    if (taxonomyMatch && method === 'PATCH') { const body = request.postDataJSON(); const current = terms.find((item) => item.id === taxonomyMatch[1])!;
      const { expectedRevision: _expectedRevision, ...changes } = body; const updated = { ...current, ...changes,
        revision: current.revision + 1, updatedAt: now }; terms = terms.map((item) => item.id === updated.id ? updated : item);
      return route.fulfill({ json: { term: updated } }); }
    const assignment = path.match(/^\/api\/journey-hierarchy\/journeys\/([^/]+)\/taxonomy\/([^/]+)$/u);
    if (assignment && method === 'PUT') { const node = nodes.find((item) => item.definitionId === assignment[1])!; node.taxonomyTermIds = [...new Set([...node.taxonomyTermIds, assignment[2]])]; return route.fulfill({ json: { assigned: true, definitionId: assignment[1], termId: assignment[2] } }); }
    if (assignment && method === 'DELETE') { const node = nodes.find((item) => item.definitionId === assignment[1])!; node.taxonomyTermIds = node.taxonomyTermIds.filter((id) => id !== assignment[2]); return route.fulfill({ json: { removed: true, definitionId: assignment[1], termId: assignment[2] } }); }
    return route.fulfill({ status: 404, json: { error: `Unexpected fixture route ${method} ${path}` } });
  });
}

test.beforeEach(() => { links = [link('macro-signup', 'macro', 'signup'), link('macro-verification', 'macro', 'verification'), link('implementation-verification', 'implementation', 'verification')]; terms = [{ id: 'regulated', kind: 'tag', name: 'Regulated', parentTermId: null, lifecycle: 'active', revision: 1, createdAt: now, updatedAt: now }]; settings = { enabled: true, hierarchyEnabled: true, blueprintsEnabled: true, maximumDepth: 12, maximumLinks: 2000, revision: 1, updatedAt: now }; policies = []; snapshots = []; workspaceViews = []; workspacePreferenceRevision = 0; nodes.forEach((node) => { node.taxonomyTermIds = []; }); });

test('journey hierarchy exposes shared paths, impact, governance and taxonomy', async ({ page }) => {
  await enableHierarchyFeature(page); await signIn(page);
  const session = await page.evaluate(() => fetch('/api/auth/session').then((response) => response.json()));
  if (!session?.subscription?.features?.journeyHierarchy) throw new Error(`Hierarchy feature fixture failed: ${JSON.stringify(session?.subscription)}`);
  await mockHierarchy(page); await mockWorkspaceViews(page); await page.goto('/journey-hierarchy');
  await expect(page.getByRole('heading', { name: 'Journey hierarchy' })).toBeVisible();
  await page.getByLabel('Name', { exact: true }).first().fill('Verification impact');
  await page.getByRole('button', { name: 'Save view' }).click();
  await expect(page.getByTestId('hierarchy-saved-views')).toContainText('Revision 1 · version 1');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'JSON' }).click()]);
  expect(download.suggestedFilename()).toBe('journey-hierarchy.json');
  await expect(page.getByTestId('journey-hierarchy-tree')).toContainText('Shared by 2 parents');
  await page.getByRole('button', { name: /Verification Shared by 2 parents/u }).first().click();
  await expect(page.getByTestId('journey-hierarchy-impact')).toContainText('Enterprise onboarding');
  await expect(page.getByTestId('journey-hierarchy-impact')).toContainText('Implementation');
  await expect(page.getByTestId('journey-hierarchy-impact')).toContainText('1 inaccessible relationship omitted');

  await page.getByRole('tab', { name: 'Relationships' }).click();
  await page.getByLabel('Relationship', { exact: true }).selectOption('related');
  await page.getByLabel('From journey').selectOption('signup'); await page.getByLabel('To journey').selectOption('support');
  await page.getByRole('button', { name: 'Add relationship' }).click();
  await expect(page.getByTestId('journey-hierarchy-relationship-table')).toContainText('Related journey');
  await page.getByLabel('Review Signup to Support').selectOption('in_review');
  await expect(page.getByLabel('Review Signup to Support')).toHaveValue('in_review');

  await page.getByRole('tab', { name: 'Hierarchy' }).click(); await page.getByRole('button', { name: 'Enterprise onboarding' }).first().click();
  await page.getByRole('tab', { name: 'Taxonomy' }).click(); await page.getByRole('button', { name: 'Assign' }).press('Enter');
  await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible();
  const taxonomyForm = page.getByRole('form', { name: 'Create taxonomy term' });
  await taxonomyForm.getByLabel('Name', { exact: true }).fill('High value'); await taxonomyForm.getByRole('button', { name: 'Create term' }).click();
  await expect(page.getByRole('cell', { name: 'High value' })).toBeVisible();
  await page.getByLabel('Term', { exact: true }).selectOption('regulated'); await page.getByLabel('Corrected name').fill('Regulated journey');
  await page.getByRole('button', { name: 'Save correction' }).click();
  await expect(page.getByRole('cell', { name: 'Regulated journey' })).toBeVisible();

  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByLabel('Maximum depth').fill('10'); await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByTestId('journey-hierarchy-settings')).toContainText('Revision 2');

  await page.getByRole('tab', { name: 'Health' }).click(); await page.getByLabel('Policy name').fill('Strict health');
  await page.getByRole('button', { name: 'Create policy' }).click();
  await page.getByLabel('Health score Verification').fill('82'); await page.getByRole('button', { name: 'Calculate snapshots' }).click();
  await expect(page.getByTestId('journey-hierarchy-health')).toContainText('Unknown · no score');
  await page.getByRole('button', { name: 'Inspect' }).first().click();
  const detail = page.getByRole('region', { name: 'Snapshot detail' });
  await expect(detail.getByRole('heading', { name: 'Snapshot detail' })).toBeVisible();
  await expect(detail.getByText('Missing child rule')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Snapshot child values and rules' }).getByText('Unknown', { exact: true })).toBeVisible();
});

test('journey hierarchy keeps members read-only while preserving transparent health reads', async ({ page }) => {
  await enableHierarchyFeature(page, true); await signIn(page); policies = [{ id: 'policy-1', name: 'Strict health',
    lifecycle: 'active', version: 'strict-v1', ownWeight: 0.5, missingChild: 'unknown', healthyAt: 80, watchAt: 60,
    revision: 1, configurationSha256: hash, createdAt: now, updatedAt: now }]; snapshots = [snapshot()];
  await mockHierarchy(page); await mockWorkspaceViews(page); await page.goto('/journey-hierarchy');
  await expect(page.getByText('You have read-only access')).toBeVisible();
  await expect(page.getByTestId('hierarchy-saved-views')).toBeVisible();
  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(page.getByLabel('Maximum depth')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save settings' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Taxonomy' }).click();
  await expect(page.getByRole('button', { name: 'Create term' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Health' }).click();
  await expect(page.getByRole('button', { name: 'Create policy' })).toHaveCount(0);
  await expect(page.getByText('Unknown · no score')).toBeVisible();
  await page.getByRole('button', { name: 'Inspect' }).click();
  await expect(page.getByRole('region', { name: 'Snapshot detail' })).toContainText('Missing child rule');
});
