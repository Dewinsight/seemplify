import { expect, test, type Page, type Route } from '@playwright/test';

test.describe.configure({ retries: 0 });

const password = 'Playwright-Test-Password-2026!';
const now = '2026-08-05T10:00:00.000Z';
const sessionUserId = 'qa-persona-user';

type SpaceRole = 'owner' | 'admin' | 'member';
type ReviewState = 'draft' | 'in_review' | 'changes_requested' | 'approved';

type PersonaRecord = {
  id: string; name: string; summary: string; lifecycleState: 'draft' | 'in_review' | 'active' | 'retired';
  ownerUserId: string | null; source: 'workspace'; attributes: Record<string, string>; goals: string[];
  behaviours: string[]; needs: string[]; barriers: string[]; reviewAt: string | null; revision: number;
  createdAt: string; updatedAt: string; linkedJourneyCount: number; evidenceState: string;
};

type PersonaVersion = ReturnType<typeof makeVersion>;

async function enablePersonas(page: Page, role: SpaceRole) {
  await page.route('**/api/auth/session', async (route) => {
    const response = await route.fetch();
    const session = await response.json();
    if (session.authenticated) {
      session.user = { ...session.user, id: sessionUserId };
      session.activeSpace = { ...session.activeSpace, role };
      session.subscription = {
        ...(session.subscription || {
          planCode: 'enterprise', planName: 'Enterprise', limits: {}, status: 'active', source: 'managed_fallback'
        }),
        features: { ...(session.subscription?.features || {}), journeyDesign: true, journeyPersonas: true, journeyEvidence: true }
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

function makePersona(id: string, name: string): PersonaRecord {
  return {
    id, name, summary: 'Coordinates onboarding research and turns findings into decisions.',
    lifecycleState: 'draft', ownerUserId: null, source: 'workspace', attributes: { Region: 'West Africa' },
    goals: ['Reduce onboarding uncertainty'], behaviours: ['Validates decisions with interviews'],
    needs: ['Current customer evidence'], barriers: ['Fragmented research'], reviewAt: '2026-09-01T00:00:00.000Z',
    revision: 1, createdAt: now, updatedAt: now, linkedJourneyCount: 2, evidenceState: 'supported'
  };
}

function makeVersion(persona: PersonaRecord, versionNumber: number, authorId: string, reviewState: ReviewState) {
  const id = `${persona.id}-version-${versionNumber}`;
  const claims = [
    { type: 'summary' as const, label: '', value: persona.summary },
    ...persona.goals.map((value, index) => ({ type: 'goal' as const, label: `Goal ${index + 1}`, value }))
  ].map((claim, ordinal) => ({
    id: `${id}-claim-${ordinal}`, personaVersionId: id, ...claim, ordinal,
    checksum: `${ordinal + 1}`.repeat(64).slice(0, 64), evidence: [] as Array<Record<string, unknown>>
  }));
  return {
    id, personaId: persona.id, spaceId: 'qa-space', versionNumber, name: persona.name, summary: persona.summary,
    lifecycleState: persona.lifecycleState, ownerUserId: persona.ownerUserId, source: persona.source,
    attributes: persona.attributes, goals: persona.goals, behaviours: persona.behaviours, needs: persona.needs,
    barriers: persona.barriers, reviewAt: persona.reviewAt, checksum: String(versionNumber).repeat(64).slice(0, 64),
    createdByUserId: authorId, createdAt: now, reviewState, claims,
    reviewEvents: reviewState === 'in_review' ? [{
      id: `${id}-review-1`, sequence: 1, action: 'submitted' as const, actorUserId: authorId,
      comment: 'Ready for an independent review.', createdAt: now
    }] : [],
    evidenceCoverage: { claimCount: claims.length, evidencedClaimCount: 0, currentSupportingLinks: 0, changedLinks: 0, invalidatedLinks: 0 }
  };
}

function personaFixtures(page: Page, options: { authorId?: string; reviewState?: ReviewState; withEvidence?: boolean } = {}) {
  const seeded = makePersona('persona-seeded', 'Research operations lead');
  const firstVersion = makeVersion(seeded, 1, options.authorId || sessionUserId, options.reviewState || 'draft');
  if (options.reviewState === 'in_review') seeded.revision = 3;
  const personas: PersonaRecord[] = [seeded];
  const versions = new Map<string, PersonaVersion[]>([[seeded.id, [firstVersion]]]);
  const evidence = new Map<string, Array<Record<string, unknown>>>();
  const calls = { create: 0, edit: 0, evidence: 0, bind: 0, submit: 0, approve: 0 };

  function addEvidence(personaId: string, version = versions.get(personaId)?.[0]) {
    const rootEvidence = {
      id: `${personaId}-evidence-1`, sourceType: 'survey_response', sourceLabel: 'Onboarding interviews',
      assessment: 'supports', sourceAccess: 'available', refreshStatus: 'current', invalidatedAt: null
    };
    evidence.set(personaId, [rootEvidence]);
    if (version && options.withEvidence) {
      version.claims[0]!.evidence = [{
        id: `${version.id}-claim-evidence-1`, evidenceLinkId: rootEvidence.id, assessmentAtLink: 'supports',
        pinnedFingerprint: 'a'.repeat(64), currentFingerprint: 'a'.repeat(64), state: 'current',
        createdByUserId: options.authorId || sessionUserId, createdAt: now
      }];
      version.evidenceCoverage = {
        ...version.evidenceCoverage, evidencedClaimCount: 1, currentSupportingLinks: 1
      };
    }
    return rootEvidence;
  }
  if (options.withEvidence) addEvidence(seeded.id, firstVersion);

  function updateFromInput(persona: PersonaRecord, input: Record<string, unknown>) {
    for (const key of ['name', 'summary', 'lifecycleState', 'attributes', 'goals', 'behaviours', 'needs', 'barriers', 'reviewAt'] as const) {
      if (input[key] !== undefined) (persona as unknown as Record<string, unknown>)[key] = input[key];
    }
    persona.revision += 1; persona.updatedAt = now;
  }

  void page.route(/\/api\/journey-evidence\/sources(?:\?.*)?$/u, async (route) => {
    await route.fulfill({ json: {
      sources: [{ sourceType: 'survey_response', sourceRef: 'response-onboarding-42', sourceId: 'response-onboarding-42',
        label: 'Onboarding interviews', excerpt: 'Customers need a clearer approval path.', collectedAt: now,
        sampleSize: 24, population: 'New customers', windowStart: null, windowEnd: null, state: 'available',
        updatedAt: now, path: '/surveys/onboarding', metadata: {} }],
      supportedSourceTypes: ['survey_response'], limit: 20
    } });
  });

  void page.route(/\/api\/journey-evidence(?:\?.*)?$/u, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fulfill({ status: 404, json: { error: 'Unexpected evidence fixture request.' } }); return;
    }
    const input = route.request().postDataJSON() as { targetId: string };
    calls.evidence += 1;
    const rootEvidence = addEvidence(input.targetId);
    await route.fulfill({ status: 201, json: rootEvidence });
  });

  void page.route(/\/api\/journey-personas(?:\/.*)?(?:\?.*)?$/u, async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const relative = path.slice('/api/journey-personas'.length);
    const segments = relative.split('/').filter(Boolean);
    const method = request.method();

    if (segments.length === 0 && method === 'GET') {
      await route.fulfill({ json: { personas } }); return;
    }
    if (segments.length === 0 && method === 'POST') {
      const input = request.postDataJSON() as Record<string, unknown>;
      const created = makePersona('persona-created', String(input.name));
      updateFromInput(created, input); created.revision = 1;
      personas.push(created); versions.set(created.id, [makeVersion(created, 1, sessionUserId, 'draft')]);
      calls.create += 1;
      await route.fulfill({ status: 201, json: created }); return;
    }

    const persona = personas.find((item) => item.id === segments[0]);
    if (!persona) { await route.fulfill({ status: 404, json: { error: 'Persona fixture not found.' } }); return; }
    const history = versions.get(persona.id) || [];

    if (segments.length === 1 && method === 'GET') {
      await route.fulfill({ json: { persona, evidence: evidence.get(persona.id) || [] } }); return;
    }
    if (segments.length === 1 && method === 'PATCH') {
      const input = request.postDataJSON() as Record<string, unknown>;
      updateFromInput(persona, input);
      history.unshift(makeVersion(persona, (history[0]?.versionNumber || 0) + 1, sessionUserId, 'draft'));
      calls.edit += 1;
      await route.fulfill({ json: persona }); return;
    }
    if (segments[1] === 'versions' && segments.length === 2 && method === 'GET') {
      await route.fulfill({ json: { versions: history } }); return;
    }
    if (segments[1] === 'versions' && segments.length === 3 && method === 'GET') {
      const version = history.find((item) => item.id === segments[2]);
      await route.fulfill({ json: { version, sourceAccess: Object.fromEntries((evidence.get(persona.id) || [])
        .map((item) => [String(item.id), 'available'])) } }); return;
    }
    if (segments[1] === 'usage' && segments.length === 2 && method === 'GET') {
      const pinned = history.at(-1)!;
      await route.fulfill({ json: {
        workingJourneys: [{ definitionId: 'journey-working', name: 'Onboarding improvement', ordinal: 0 }],
        publishedSnapshots: [{ definitionId: 'journey-published', name: 'Published onboarding journey',
          mapVersionId: 'journey-map-version-3', mapVersionNumber: 3, personaVersionId: pinned.id,
          reviewState: pinned.reviewState, pinnedAt: now }]
      } }); return;
    }
    if (segments[1] === 'versions' && segments[3] === 'claims' && segments[5] === 'evidence' && method === 'POST') {
      const version = history.find((item) => item.id === segments[2])!;
      const claim = version.claims.find((item) => item.id === segments[4])!;
      const input = request.postDataJSON() as { evidenceLinkId: string };
      claim.evidence.push({ id: `${claim.id}-evidence`, evidenceLinkId: input.evidenceLinkId,
        assessmentAtLink: 'supports', pinnedFingerprint: 'b'.repeat(64), currentFingerprint: 'b'.repeat(64),
        state: 'current', createdByUserId: sessionUserId, createdAt: now });
      version.evidenceCoverage = { ...version.evidenceCoverage, evidencedClaimCount: 1, currentSupportingLinks: 1 };
      persona.revision += 1; calls.bind += 1;
      await route.fulfill({ status: 201, json: version }); return;
    }
    if (segments[1] === 'versions' && segments[3] === 'submit' && method === 'POST') {
      const version = history.find((item) => item.id === segments[2])!;
      const input = request.postDataJSON() as { comment: string };
      version.reviewState = 'in_review'; version.reviewEvents.push({ id: `${version.id}-review-${version.reviewEvents.length + 1}`,
        sequence: version.reviewEvents.length + 1, action: 'submitted', actorUserId: sessionUserId,
        comment: input.comment, createdAt: now });
      persona.revision += 1; persona.lifecycleState = 'in_review'; calls.submit += 1;
      await route.fulfill({ json: version }); return;
    }
    if (segments[1] === 'versions' && segments[3] === 'review' && method === 'POST') {
      const version = history.find((item) => item.id === segments[2])!;
      const input = request.postDataJSON() as { comment: string; decision: ReviewState };
      version.reviewState = input.decision; version.reviewEvents.push({ id: `${version.id}-review-${version.reviewEvents.length + 1}`,
        sequence: version.reviewEvents.length + 1, action: input.decision === 'approved' ? 'approved' : 'changes_requested',
        actorUserId: sessionUserId, comment: input.comment, createdAt: now });
      persona.revision += 1; persona.lifecycleState = input.decision === 'approved' ? 'active' : 'draft';
      if (input.decision === 'approved') calls.approve += 1;
      await route.fulfill({ json: version }); return;
    }
    await route.fulfill({ status: 404, json: { error: `Unexpected persona fixture route ${method} ${relative}` } });
  });

  return calls;
}

test('owner creates, versions, evidences and submits a reusable persona while published maps keep their pin', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'The full authoring path is covered on desktop.');
  await enablePersonas(page, 'owner');
  const calls = personaFixtures(page);
  await signIn(page);
  await page.goto('/journey-personas');
  await expect(page.getByTestId('journey-persona-library')).toBeVisible();

  await page.getByRole('button', { name: 'Create persona' }).click();
  const editor = page.getByTestId('persona-editor-dialog');
  await editor.getByLabel('Name').fill('Customer insight lead');
  await editor.getByLabel('Summary').fill('Turns onboarding evidence into prioritised decisions.');
  await editor.getByLabel('Goals').fill('Reduce onboarding uncertainty');
  await editor.getByRole('button', { name: 'Create persona' }).click();
  await expect(page.getByRole('heading', { name: 'Customer insight lead' })).toBeVisible();

  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByTestId('persona-editor-dialog').getByLabel('Summary')
    .fill('Turns current onboarding evidence into prioritised decisions.');
  await page.getByTestId('persona-editor-dialog').getByRole('button', { name: 'Save version' }).click();
  await expect(page.getByText('Version 2')).toBeVisible();

  await page.getByRole('button', { name: 'Add source evidence' }).click();
  const picker = page.getByTestId('persona-evidence-picker');
  await expect(picker.getByText('Onboarding interviews')).toBeVisible();
  await picker.getByRole('radio').check();
  await picker.getByRole('button', { name: 'Add evidence' }).click();

  const summaryClaim = page.locator('[data-testid^="persona-claim-"]').filter({ hasText: 'Summary' }).first();
  await summaryClaim.getByRole('combobox').selectOption('persona-created-evidence-1');
  await summaryClaim.getByRole('button', { name: 'Bind to claim' }).click();
  await expect(summaryClaim).toContainText('1 source');

  await page.getByLabel('Review comment').fill('Evidence is current and this version is ready.');
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByText('Another space owner or administrator must approve it.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeDisabled();
  await expect(page.getByText(/Map v3/u)).toBeVisible();
  await expect(page.getByText(/persona v1/u)).toBeVisible();
  expect(calls).toMatchObject({ create: 1, edit: 1, evidence: 1, bind: 1, submit: 1 });
});

test('a different administrator can approve the submitted persona', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Independent approval is covered on desktop.');
  await enablePersonas(page, 'admin');
  const calls = personaFixtures(page, { authorId: 'persona-author-other', reviewState: 'in_review', withEvidence: true });
  await signIn(page);
  await page.goto('/journey-personas');
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeEnabled();
  await page.getByLabel('Review comment').fill('Independent review confirms the evidence.');
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText('Approved').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
  expect(calls.approve).toBe(1);
});

test('a member gets responsive read-only persona governance on mobile', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'The read-only path is covered on mobile.');
  await enablePersonas(page, 'member');
  personaFixtures(page, { withEvidence: true });
  await signIn(page);
  await page.goto('/journey-personas');
  await expect(page.getByText('You have read-only access to persona governance.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create persona' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add source evidence' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Submit for review' })).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
