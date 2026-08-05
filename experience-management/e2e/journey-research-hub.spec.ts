import { expect, test, type Page, type Route } from '@playwright/test';

const password = 'Playwright-Test-Password-2026!';
const now = '2026-08-04T12:00:00.000Z';
const sourceRef = 'survey-analysis:research-fixture';

async function enableResearch(page: Page, role: 'owner' | 'member') {
  await page.route('**/api/auth/session', async (route) => {
    const response = await route.fetch();
    const session = await response.json();
    if (session.authenticated) {
      session.activeSpace = { ...session.activeSpace, role };
      session.subscription = {
        ...(session.subscription || {
          planCode: 'enterprise', planName: 'Enterprise', limits: {}, status: 'active', source: 'managed_fallback'
        }),
        features: { ...(session.subscription?.features || {}), journeyDesign: true, journeyEvidence: true, knowledgeBases: true }
      };
    }
    await route.fulfill({ response, json: session });
  });
}

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();
}

function journeyFixtures(page: Page) {
  const summary = {
    id: 'journey-research-map', legacyJourneyId: null, name: 'Activation journey', purpose: '',
    experienceType: 'customer', mapType: 'current_state', mode: 'evidence_backed', status: 'draft',
    currentVersionId: 'journey-research-version', publishedVersionId: null, revision: 2,
    stageCount: 1, cardCount: 1, evidenceLinkCount: 0, personaCount: 1, createdAt: now, updatedAt: now
  };
  const map = {
    definition: summary,
    version: { id: 'journey-research-version', versionNumber: 1, schemaVersion: 2, state: 'draft',
      publishedAt: null, createdAt: now, mapType: 'current_state', mode: 'evidence_backed', experienceType: 'customer',
      objective: '', industry: '', summary: '', legacyAudience: '' },
    stages: [{ id: 'stage-research', stageKey: 's01-discover', name: 'Discover', goal: '', description: '', ordinal: 0 }],
    lanes: [{ id: 'lane-research', laneType: 'stage_goal', title: 'Stage goal', description: '', ordinal: 0, visible: true }],
    cards: [{ id: 'card-research', stageKey: 's01-discover', laneType: 'stage_goal', kind: 'stage_goal', title: 'Understand value',
      content: '', ordinal: 0, personaId: null, status: 'active', origin: 'workspace',
      evidence: { state: 'hypothesis', reason: 'no_evidence' }, evidenceLinkCount: 0 }],
    personas: [{ id: 'persona-research', name: 'New customer', summary: '', lifecycleState: 'draft', ownerUserId: null,
      source: 'workspace', attributes: {}, goals: [], behaviours: [], needs: [], barriers: [], reviewAt: null,
      revision: 1, createdAt: now, updatedAt: now }],
    versions: [{ id: 'journey-research-version', versionNumber: 1, state: 'draft', publishedAt: null, createdAt: now }],
    researchGaps: [], evidenceSummary: { hypothesis: 1 }
  };
  void page.route(/\/api\/journey-maps(?:\/[^?]+)?(?:\?.*)?$/u, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/journey-maps') {
      await route.fulfill({ json: { journeyMaps: [summary], personas: map.personas, limits: {
        stages: 50, lanes: 20, cards: 500, cardsPerCell: 100, titleChars: 240, contentChars: 20_000
      }, catalog: { mapTypes: ['current_state'], experienceTypes: ['customer'], laneTypes: ['stage_goal'],
        cardKinds: ['stage_goal'], evidenceSourceTypes: ['survey_analysis'], evidenceAssessments: ['supports'],
        personaLifecycleStates: ['draft'] } } }); return;
    }
    await route.fulfill({ json: map });
  });
  void page.route('**/api/knowledge-bases', async (route) => route.fulfill({ json: { knowledgeBases: [{
    id: 'knowledge-research', name: 'Research library', description: '', privacy: 'space', status: 'ready',
    documentCount: 2, readyDocumentCount: 2, chunkCount: 5, createdAt: now, updatedAt: now
  }] } }));
}

function researchFixtures(page: Page, initiallyCatalogued = false) {
  let catalogued = initiallyCatalogued;
  let linked = false;
  let intakes: any[] = [];
  let monitors: any[] = [];
  let runs: any[] = [];
  const notifications = [{ id: 'notification-research', sourceId: 'research-source', refreshRunId: null,
    kind: 'source_changed', state: 'unread', detail: { changedFields: ['sample_size'] }, revision: 1,
    createdAt: now, readAt: null }];

  void page.route(/\/api\/journey-research(?:\/.*)?(?:\?.*)?$/u, async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const relative = url.pathname.replace('/api/journey-research', '') || '/';
    const method = request.method();
    const source = { id: 'research-source', sourceType: 'survey_analysis', state: 'active', revision: 1,
      ownerUserId: 'qa-user', lastResolvedAt: now, errorCode: null, createdAt: now, updatedAt: now };
    const snapshot = { id: 'research-snapshot', sourceId: source.id, version: 1, fingerprint: 'a'.repeat(64),
      accessState: 'available', sourceLabel: 'Onboarding NPS analysis', excerpt: 'Customers need clearer setup guidance.',
      population: 'New customers', sampleSize: 84, collectedAt: now, windowStart: '2026-07-01T00:00:00.000Z',
      windowEnd: now, sourceUpdatedAt: now, metadata: {}, createdByUserId: 'qa-user', createdAt: now,
      retentionExpiresAt: '2027-08-04T00:00:00.000Z' };

    if (method === 'GET' && relative === '/catalogue') {
      await route.fulfill({ json: { items: [{ sourceType: 'survey_analysis', sourceRef,
        sourceId: 'survey-analysis-fixture', label: 'Survey analysis', state: 'available', sampleSize: 84,
        collectedAt: now, updatedAt: now, existingEvidenceLinkCount: linked ? 1 : 0,
        researchSourceId: catalogued ? source.id : null, researchSourceState: catalogued ? 'active' : null,
        researchSourceRevision: catalogued ? 1 : null }], nextCursor: null } }); return;
    }
    if (method === 'POST' && relative === '/sources') {
      catalogued = true;
      await route.fulfill({ status: 201, json: { source, snapshot, created: true, replayed: false } }); return;
    }
    if (method === 'GET' && relative === `/sources/${source.id}`) {
      await route.fulfill({ json: { source, current: { sourceLabel: snapshot.sourceLabel,
        excerpt: 'Current source confirms that setup guidance remains unclear.', population: snapshot.population },
        latestSnapshot: snapshot } }); return;
    }
    if (method === 'GET' && relative === '/links') {
      await route.fulfill({ json: { links: linked ? [{ id: 'research-link', sourceId: source.id,
        snapshotId: snapshot.id, targetType: 'definition', targetId: 'journey-research-map', state: 'active', revision: 1,
        access: 'available', relationship: null, classification: null, confidence: null, freshnessDays: null,
        isContradictory: false, isStale: false, createdAt: now, updatedAt: now }] : [] } }); return;
    }
    if (method === 'POST' && relative === '/links') {
      linked = true;
      const body = request.postDataJSON();
      await route.fulfill({ status: 201, json: { link: { id: 'research-link', sourceId: source.id,
        snapshotId: snapshot.id, targetType: body.targetType, targetId: body.targetId, state: 'active', revision: 1,
        access: 'available', relationship: null, classification: null, confidence: null, freshnessDays: null,
        isContradictory: false, isStale: false, createdAt: now, updatedAt: now }, replayed: false } }); return;
    }
    if (method === 'GET' && relative === '/inbox') {
      await route.fulfill({ json: { items: [{ itemKind: 'notification', ...notifications[0] }], nextOffset: null } }); return;
    }
    if (method === 'GET' && relative === '/gaps') { await route.fulfill({ json: { gaps: [] } }); return; }
    if (method === 'POST' && relative === '/gaps') { await route.fulfill({ status: 201, json: { gap: {}, replayed: false } }); return; }
    if (method === 'GET' && relative === '/intakes') { await route.fulfill({ json: { intakes } }); return; }
    if (method === 'POST' && relative === '/intakes') {
      const body = request.postDataJSON();
      const intake = { id: 'research-intake', sourceId: source.id, knowledgeBaseId: body.knowledgeBaseId,
        knowledgeDocumentId: 'knowledge-document-research', kind: body.kind, method: body.method,
        conductedAt: null, population: body.population, tags: body.tags, consentBasis: body.consentBasis,
        researcherUserId: 'qa-user', retentionExpiresAt: body.retentionExpiresAt, createdAt: now };
      intakes = [intake]; await route.fulfill({ status: 201, json: { intake, replayed: false } }); return;
    }
    if (method === 'GET' && relative === '/monitors') { await route.fulfill({ json: { monitors } }); return; }
    if (method === 'POST' && relative === '/monitors') {
      const body = request.postDataJSON();
      const monitor = { id: 'research-monitor', sourceId: body.sourceId, ownerUserId: 'qa-user', state: 'active',
        intervalSeconds: body.intervalSeconds, nextRunAt: '2026-08-05T12:00:00.000Z', lastRunAt: null,
        revision: 1, createdAt: now, updatedAt: now };
      monitors = [monitor]; await route.fulfill({ status: 201, json: { monitor, replayed: false } }); return;
    }
    if (method === 'GET' && relative === '/refresh-runs') { await route.fulfill({ json: { runs } }); return; }
    if (method === 'POST' && relative === '/refresh-runs') {
      const body = request.postDataJSON();
      const run = { id: 'research-run', sourceId: body.sourceId, monitorId: null, trigger: 'manual', state: 'queued',
        revision: 1, availableAt: now, attemptCount: 0, maxAttempts: 5, beforeSnapshotId: snapshot.id,
        afterSnapshotId: null, changedFields: [], errorCode: null, createdAt: now, updatedAt: now, completedAt: null };
      runs = [run]; await route.fulfill({ status: 202, json: { run, replayed: false } }); return;
    }
    if (method === 'GET' && relative === '/notifications') { await route.fulfill({ json: { notifications } }); return; }
    if (method === 'PATCH' && relative === `/notifications/${notifications[0]!.id}`) {
      notifications[0]!.state = request.postDataJSON().state; notifications[0]!.revision += 1;
      await route.fulfill({ json: { notification: notifications[0] } }); return;
    }
    if (method === 'GET' && relative === '/audit') {
      await route.fulfill({ json: { events: [{ id: 'research-audit', actorUserId: 'qa-user', action: 'source.catalogued',
        targetType: 'research_source', targetId: source.id, detail: {}, createdAt: now }] } }); return;
    }
    await route.fulfill({ status: 404, json: { error: `Unexpected Research Hub fixture route ${method} ${relative}` } });
  });
  return { linked: () => linked, intakeCount: () => intakes.length, monitorCount: () => monitors.length };
}

test('owner can catalogue, inspect, link, monitor, refresh and intake evidence', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'The full owner workflow is covered on the reference desktop browser.');
  await enableResearch(page, 'owner');
  journeyFixtures(page);
  const fixture = researchFixtures(page);
  await signIn(page);
  await page.goto('/journey-research');
  await expect(page.getByTestId('journey-research-hub-page')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Journey Research Hub' })).toBeVisible();

  await page.getByRole('button', { name: 'Catalogue' }).click();
  await expect(page.getByRole('heading', { name: 'Authorised source viewer' })).toBeVisible();
  await expect(page.getByText('Current source confirms that setup guidance remains unclear.')).toBeVisible();
  await expect(page.getByText('Customers need clearer setup guidance.')).toBeVisible();
  await page.getByRole('button', { name: 'Link evidence' }).click();
  await expect.poll(fixture.linked).toBe(true);
  await page.getByRole('button', { name: 'Monitor daily' }).click();
  await expect.poll(fixture.monitorCount).toBe(1);
  await page.getByRole('button', { name: 'Refresh now' }).click();

  await page.getByRole('tab', { name: 'Research intake' }).click();
  await page.getByLabel('Method').fill('Moderated interview');
  await page.getByLabel('Population').fill('New customers');
  await page.getByLabel('Research content').fill('Participants could not tell whether setup had completed.');
  await page.getByRole('button', { name: 'Add to knowledge and research' }).click();
  await expect.poll(fixture.intakeCount).toBe(1);
  await expect(page.getByRole('cell', { name: 'Moderated interview' })).toBeVisible();

  await page.getByRole('tab', { name: 'Monitoring and audit' }).click();
  await expect(page.getByRole('cell', { name: 'Active' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Queued' })).toBeVisible();
  await expect(page.getByText('Source catalogued')).toBeVisible();
});

test('member gets a responsive read-only Research Hub with no mutation controls', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'The narrow read-only alternative is covered on the mobile project.');
  await enableResearch(page, 'member');
  journeyFixtures(page);
  researchFixtures(page, true);
  await signIn(page);
  await page.goto('/journey-research');
  await expect(page.getByText(/You have viewer access/u)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Catalogue' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Inspect' }).click();
  await expect(page.getByText('Current source confirms that setup guidance remains unclear.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Link evidence' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Monitor daily' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Research intake' }).click();
  await expect(page.getByRole('button', { name: 'Add to knowledge and research' })).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
