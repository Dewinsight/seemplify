import { expect, test, type Page } from '@playwright/test';

async function mockAuthenticatedShell(page: Page) {
  const space = {
    id: 'comparison-space', name: 'Comparison space', slug: 'comparison-space', role: 'owner', isPersonal: false,
    createdAt: '2026-08-01T10:00:00.000Z', updatedAt: '2026-08-04T12:00:00.000Z'
  };
  await page.route('**/api/auth/session', (route) => route.fulfill({ json: {
    authenticated: true, email: 'qa@seemplify.local',
    user: { id: 'qa-user', email: 'qa@seemplify.local', name: 'QA User', role: 'user' },
    emailVerified: true, onboardingRequired: false, profile: null, spaces: [space], activeSpace: space,
    pendingSpaceInvitations: [],
    subscription: {
      planCode: 'team', planName: 'Test plan', limits: {}, status: 'active', source: 'managed',
      features: {
        journeyDesign: true, journeyTemplates: true, journeyPersonas: false, journeyEvidence: false,
        journeyExports: false, terra: true
      }
    }
  } }));
  await page.route('**/api/runtime', (route) => route.fulfill({ json: {
    ai: { preference: { provider: 'codex', effectiveProvider: 'codex' } }
  } }));
  await page.route('**/api/ai-provider', (route) => route.fulfill({ json: {
    preference: {
      provider: 'codex', effectiveProvider: 'codex', runtimeChoice: 'chatgpt', codexModel: null,
      codexReasoningEffort: null, codexActionOverrides: {}, codexDataSharingAcknowledgedAt: null, updatedAt: null
    },
    runtimePolicy: { chatgptEnabled: true, defaultRuntime: 'chatgpt', effectiveProvider: 'codex' },
    codex: { available: true, account: { connected: false, email: null, planType: null, pendingLogin: false,
      loginError: null }, models: [], actions: [], selectedModel: null, error: null }
  } }));
  await page.route('**/api/tutorials/progress', (route) => route.fulfill({ json: { progress: [] } }));
}

const evidence = (state: 'hypothesis' | 'supported' = 'hypothesis') => ({
  state, supporting: state === 'supported' ? 2 : 0, contradicting: 0, neutral: 0, stale: 0,
  inaccessible: 0, reason: state === 'supported' ? 'multiple_supporting_sources' : 'no_evidence'
});

const versionSummary = (id: string, versionNumber: number, state: 'published' | 'superseded') => ({
  id, versionNumber, state, publishedAt: state === 'published' ? '2026-08-04T12:00:00.000Z' : null,
  createdAt: `2026-08-0${versionNumber}T10:00:00.000Z`
});

test('comparison reads exact versions, reports deterministic structure, and redacts disabled subfeatures', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Journey comparison is covered on one desktop browser.');
  await mockAuthenticatedShell(page);

  const currentVersions = [
    versionSummary('current-v1', 1, 'superseded'),
    versionSummary('current-v3', 3, 'published')
  ];
  const currentDefinition = {
    id: 'current-map', legacyJourneyId: null, name: 'Account recovery', purpose: '',
    experienceType: 'customer', mapType: 'current_state', mode: 'evidence_backed', status: 'published',
    currentVersionId: 'current-v3', publishedVersionId: 'current-v3', revision: 8,
    stageCount: 3, cardCount: 3, evidenceLinkCount: 2, personaCount: 1,
    createdAt: '2026-08-01T10:00:00.000Z', updatedAt: '2026-08-04T12:00:00.000Z'
  };
  const futureDefinition = {
    id: 'future-map', legacyJourneyId: null, name: 'Recovery target', purpose: '',
    experienceType: 'customer', mapType: 'future_state', mode: 'connected', status: 'published',
    currentVersionId: 'future-v1', publishedVersionId: 'future-v1', revision: 2,
    stageCount: 2, cardCount: 1, evidenceLinkCount: 1, personaCount: 0,
    createdAt: '2026-08-02T10:00:00.000Z', updatedAt: '2026-08-04T12:00:00.000Z'
  };
  const common = {
    lanes: [
      { id: 'lane-actions', laneType: 'customer_actions', title: 'Customer actions', description: '', ordinal: 0, visible: true },
      { id: 'lane-pain', laneType: 'pain_points', title: 'Pain points', description: '', ordinal: 1, visible: true },
      { id: 'lane-outcomes', laneType: 'outcomes', title: 'Outcomes', description: '', ordinal: 2, visible: true },
      { id: 'lane-thoughts', laneType: 'thoughts', title: 'Thoughts', description: '', ordinal: 3, visible: true }
    ],
    personas: [{ id: 'persona-private', name: 'Private persona' }], researchGaps: [], evidenceSummary: {}
  };
  const oldMap = {
    ...common, definition: currentDefinition,
    version: {
      ...currentVersions[0], schemaVersion: 1, mapType: 'current_state', mode: 'designed', experienceType: 'customer',
      objective: '', industry: '', summary: '', legacyAudience: ''
    },
    versions: currentVersions,
    stages: [
      { id: 'old-discover', stageKey: 'discover', name: 'Discover', goal: 'Understand options', description: '', ordinal: 0 },
      { id: 'old-resolve', stageKey: 'resolve', name: 'Resolve', goal: 'Regain access', description: '', ordinal: 1 },
      { id: 'old-wait', stageKey: 'wait', name: 'Wait', goal: 'Receive an update', description: '', ordinal: 2 }
    ],
    cards: [
      { id: 'old-action', stageKey: 'discover', laneType: 'customer_actions', kind: 'action', title: 'Contact support',
        content: 'Use the recovery channel.', ordinal: 0, personaId: 'persona-private', status: 'active', origin: 'workspace',
        evidenceLinkCount: 0, evidence: evidence() },
      { id: 'old-pain', stageKey: 'resolve', laneType: 'pain_points', kind: 'pain_point', title: 'Repeated verification',
        content: 'Identity is checked twice.', ordinal: 0, personaId: null, status: 'active', origin: 'workspace',
        evidenceLinkCount: 0, evidence: evidence() },
      { id: 'removed-card', stageKey: 'wait', laneType: 'thoughts', kind: 'note', title: 'Wait for update',
        content: 'There is no visible status.', ordinal: 0, personaId: null, status: 'active', origin: 'workspace',
        evidenceLinkCount: 0, evidence: evidence() }
    ]
  };
  const currentMap = {
    ...common, definition: currentDefinition,
    version: {
      ...currentVersions[1], schemaVersion: 1, mapType: 'current_state', mode: 'evidence_backed', experienceType: 'customer',
      objective: '', industry: '', summary: '', legacyAudience: ''
    },
    versions: currentVersions,
    stages: [
      { id: 'new-resolve', stageKey: 'resolve', name: 'Resolve', goal: 'Regain access securely', description: '', ordinal: 0 },
      { id: 'new-discover', stageKey: 'discover', name: 'Discover', goal: 'Understand options', description: '', ordinal: 1 },
      { id: 'new-confirm', stageKey: 'confirm', name: 'Confirm', goal: 'Verify recovery', description: '', ordinal: 2 }
    ],
    cards: [
      { id: 'new-action', stageKey: 'resolve', laneType: 'customer_actions', kind: 'action', title: 'Contact support',
        content: 'Use the recovery channel.', ordinal: 0, personaId: null, status: 'active', origin: 'workspace',
        evidenceLinkCount: 2, evidence: evidence('supported') },
      { id: 'new-pain', stageKey: 'resolve', laneType: 'pain_points', kind: 'pain_point', title: 'Identity check delay',
        content: 'The check is now visible.', ordinal: 0, personaId: null, status: 'active', origin: 'workspace',
        evidenceLinkCount: 1, evidence: evidence('supported') },
      { id: 'added-card', stageKey: 'confirm', laneType: 'outcomes', kind: 'note', title: 'Recovery confirmed',
        content: 'The customer sees a confirmation.', ordinal: 0, personaId: null, status: 'active', origin: 'workspace',
        evidenceLinkCount: 0, evidence: evidence() }
    ]
  };
  const futureMap = {
    ...common, definition: futureDefinition,
    version: {
      ...versionSummary('future-v1', 1, 'published'), schemaVersion: 1, mapType: 'future_state', mode: 'connected',
      experienceType: 'customer', objective: '', industry: '', summary: '', legacyAudience: ''
    },
    versions: [versionSummary('future-v1', 1, 'published')],
    stages: [
      { id: 'future-start', stageKey: 'start', name: 'Start recovery', goal: 'Begin safely', description: '', ordinal: 0 },
      { id: 'future-complete', stageKey: 'complete', name: 'Complete', goal: 'Restore access', description: '', ordinal: 1 }
    ],
    cards: [{ id: 'future-card', stageKey: 'complete', laneType: 'outcomes', kind: 'note', title: 'Access restored',
      content: 'The customer returns to the product.', ordinal: 0, personaId: null, status: 'active', origin: 'workspace',
      evidenceLinkCount: 1, evidence: evidence('supported') }]
  };
  const index = {
    journeyMaps: [currentDefinition, futureDefinition], personas: [],
    limits: { stages: 20, lanes: 20, cards: 500, cardsPerCell: 50, titleChars: 200, contentChars: 10000 },
    catalog: { mapTypes: ['current_state', 'future_state'], experienceTypes: ['customer'],
      laneTypes: ['customer_actions', 'pain_points', 'outcomes', 'thoughts'], cardKinds: ['action', 'pain_point', 'note'],
      evidenceSourceTypes: [], evidenceAssessments: [], personaLifecycleStates: [] }
  };

  const exactReads: string[] = [];
  await page.route(/\/api\/journey-maps(?:\?.*)?$/u, (route) => route.fulfill({ json: index }));
  await page.route(/\/api\/journey-maps\/(current-map|future-map)(?:\?.*)?$/u, async (route) => {
    const url = new URL(route.request().url());
    const versionId = url.searchParams.get('versionId');
    if (versionId) exactReads.push(`${url.pathname}:${versionId}`);
    if (url.pathname.endsWith('/future-map')) return route.fulfill({ json: futureMap });
    if (versionId === 'current-v1') return route.fulfill({ json: oldMap });
    return route.fulfill({ json: currentMap });
  });

  await page.goto('/journey-maps');
  await expect(page.getByTestId('journey-workspace')).toBeVisible();
  await page.getByTestId('tab-compare').click();

  const comparison = page.getByTestId('journey-map-comparison');
  const fromTruth = comparison.getByTestId('compare-from-truth');
  const toTruth = comparison.getByTestId('compare-to-truth');
  await expect(fromTruth).toContainText('current-v1');
  await expect(fromTruth).toContainText('v1 · superseded');
  await expect(fromTruth).toContainText('Designed');
  await expect(toTruth).toContainText('current-v3');
  await expect(toTruth).toContainText('v3 · published');
  await expect(toTruth).toContainText('Evidence-backed');
  await expect(comparison.getByText('Added', { exact: true }).first()).toBeVisible();
  await expect(comparison.getByText('Removed', { exact: true }).first()).toBeVisible();
  await expect(comparison.getByText('Changed', { exact: true }).first()).toBeVisible();
  await expect(comparison.getByText('Reordered', { exact: true }).first()).toBeVisible();
  await expect(comparison.getByText('Unique exact content', { exact: true })).toBeVisible();
  await expect(comparison.getByText('Exact structural slot; identity unavailable', { exact: true })).toBeVisible();
  await expect(comparison.getByRole('columnheader', { name: 'Persona' })).toHaveCount(0);
  await expect(comparison.getByRole('columnheader', { name: 'Evidence' })).toHaveCount(0);
  await expect(comparison).not.toContainText('saved view');
  expect(exactReads).toEqual(expect.arrayContaining([
    '/api/journey-maps/current-map:current-v1', '/api/journey-maps/current-map:current-v3'
  ]));

  await comparison.getByTestId('compare-scope-maps').click();
  await expect(fromTruth).toContainText('current-v3');
  await expect(toTruth).toContainText('future-v1');
  await expect(toTruth).toContainText('Future state');
  await expect(toTruth).toContainText('Connected');
  expect(exactReads).toEqual(expect.arrayContaining([
    '/api/journey-maps/current-map:current-v3', '/api/journey-maps/future-map:future-v1'
  ]));
});

test('publish uses the map revision returned by the immediately preceding structural mutation', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Journey revision sequencing is covered on one desktop browser.');
  await mockAuthenticatedShell(page);

  const definition = {
    id: 'race-map', legacyJourneyId: null, name: 'Revision sequencing', purpose: '',
    experienceType: 'customer', mapType: 'current_state', mode: 'designed', status: 'draft',
    currentVersionId: 'race-v1', publishedVersionId: null, revision: 1,
    stageCount: 0, cardCount: 0, evidenceLinkCount: 0, personaCount: 0,
    createdAt: '2026-08-04T10:00:00.000Z', updatedAt: '2026-08-04T10:00:00.000Z'
  };
  const draftVersion = {
    id: 'race-v1', versionNumber: 1, schemaVersion: 1, state: 'draft', publishedAt: null,
    createdAt: '2026-08-04T10:00:00.000Z', mapType: 'current_state', mode: 'designed',
    experienceType: 'customer', objective: '', industry: '', summary: '', legacyAudience: ''
  };
  const baseMap = {
    definition, version: draftVersion, stages: [], lanes: [], cards: [], personas: [],
    versions: [{ id: 'race-v1', versionNumber: 1, state: 'draft', publishedAt: null,
      createdAt: '2026-08-04T10:00:00.000Z' }], researchGaps: [], evidenceSummary: {}
  };
  const afterStage = {
    ...baseMap,
    definition: { ...definition, revision: 2, stageCount: 1, updatedAt: '2026-08-04T10:01:00.000Z' },
    stages: [{ id: 'created-stage-id', stageKey: 'created-stage', name: 'Created stage', goal: '', description: '', ordinal: 0 }]
  };
  const afterPublish = {
    ...afterStage,
    definition: { ...afterStage.definition, revision: 3, currentVersionId: 'race-v2', publishedVersionId: 'race-v1',
      status: 'published', updatedAt: '2026-08-04T10:02:00.000Z' },
    version: { ...draftVersion, id: 'race-v2', versionNumber: 2, createdAt: '2026-08-04T10:02:00.000Z' },
    versions: [
      { id: 'race-v1', versionNumber: 1, state: 'published', publishedAt: '2026-08-04T10:02:00.000Z',
        createdAt: '2026-08-04T10:00:00.000Z' },
      { id: 'race-v2', versionNumber: 2, state: 'draft', publishedAt: null, createdAt: '2026-08-04T10:02:00.000Z' }
    ]
  };
  const index = {
    journeyMaps: [definition], personas: [],
    limits: { stages: 20, lanes: 20, cards: 500, cardsPerCell: 50, titleChars: 200, contentChars: 10000 },
    catalog: { mapTypes: ['current_state'], experienceTypes: ['customer'], laneTypes: [], cardKinds: [],
      evidenceSourceTypes: [], evidenceAssessments: [], personaLifecycleStates: [] }
  };
  const publishRevisions: number[] = [];
  await page.route(/\/api\/journey-maps(?:\?.*)?$/u, (route) => route.fulfill({ json: index }));
  await page.route(/\/api\/journey-maps\/race-map(?:\?.*)?$/u, (route) => route.fulfill({ json: baseMap }));
  await page.route('**/api/journey-maps/race-map/stages', async (route) => {
    expect((await route.request().postDataJSON()).expectedRevision).toBe(1);
    await route.fulfill({ json: afterStage });
  });
  await page.route('**/api/journey-maps/race-map/publish', async (route) => {
    publishRevisions.push((await route.request().postDataJSON()).expectedRevision);
    await route.fulfill({ json: { publishedVersionId: 'race-v1', draftVersionId: 'race-v2', journeyMap: afterPublish } });
  });

  await page.goto('/journey-maps');
  await expect(page.getByTestId('journey-workspace')).toBeVisible();
  await page.getByTestId('new-stage-name').fill('Created stage');
  await page.getByTestId('add-stage').click();
  await expect(page.getByTestId('stage-header-created-stage')).toBeVisible();
  await page.getByTestId('publish-map').click();
  await expect.poll(() => publishRevisions).toEqual([2]);
});
