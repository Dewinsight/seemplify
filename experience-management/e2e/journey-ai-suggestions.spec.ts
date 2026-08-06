import { expect, test, type Page } from '@playwright/test';

const password = 'Playwright-Test-Password-2026!';
const runId = '10000000-0000-4000-8000-000000000001';
const evidenceLinkId = '10000000-0000-4000-8000-000000000002';
const changeIds = [
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000004'
];
const now = '2026-08-04T12:00:00.000Z';

test.describe.configure({ retries: 0 });

async function useSpaceRole(page: Page, role: 'owner' | 'member') {
  await page.route('**/api/auth/session', async (route) => {
    const response = await route.fetch();
    const session = await response.json();
    if (session.authenticated && session.activeSpace) {
      session.activeSpace = { ...session.activeSpace, role };
      session.spaces = (session.spaces || []).map((space: { id: string }) =>
        space.id === session.activeSpace.id ? { ...space, role } : space);
      const subscription = session.subscription || {
        planCode: 'team', planName: 'Test plan', limits: {}, status: 'active', source: 'managed'
      };
      session.subscription = {
        ...subscription,
        features: {
          ...(subscription.features || {}), journeyDesign: true, journeyAi: true, journeyEvidence: true
        }
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

function suggestionDetail(state: 'review' | 'ready_to_apply' = 'review') {
  const detail: any = {
    run: {
      id: runId, spaceId: '10000000-0000-4000-8000-000000000010',
      definitionId: '10000000-0000-4000-8000-000000000011',
      baseVersionId: '10000000-0000-4000-8000-000000000012', baseDefinitionRevision: 3,
      baseMapChecksum: 'a'.repeat(64), requestedByUserId: '10000000-0000-4000-8000-000000000013',
      aiJobId: '10000000-0000-4000-8000-000000000014', state,
      focus: 'Reduce onboarding effort', summary: 'Clarify the first stage and add one evidence-backed action.',
      warningCodes: [], promptContractVersion: 'journey-suggestion/v1', changeSchemaVersion: 1,
      selectedEvidenceChecksum: 'b'.repeat(64), selectedEvidenceCount: 1,
      revision: state === 'ready_to_apply' ? 4 : 2, appliedVersionId: null, failureCode: null,
      createdAt: now, generationStartedAt: now, completedAt: now, appliedAt: null, updatedAt: now
    },
    evidence: [{
      id: '10000000-0000-4000-8000-000000000015', linkId: evidenceLinkId,
      targetType: 'stage', targetId: '10000000-0000-4000-8000-000000000016',
      sourceType: 'knowledge_document', sourceRef: 'knowledge-document:onboarding-study',
      sourceLabel: 'Onboarding research', excerpt: 'Customers need a clear first step.',
      population: 'New customers', sampleSize: 24, collectedAt: now, windowStart: null, windowEnd: null,
      assessment: 'supports', promptInjectionSuspected: false, currentAccess: 'available',
      currentFingerprint: 'c'.repeat(64)
    }],
    changes: [{
      id: changeIds[0], ordinal: 0, operation: 'stage.update', targetType: 'stage', targetRef: 'stage:discover',
      before: { stageKey: 'discover', name: 'Discover', goal: 'Understand the product' },
      after: { stageKey: 'discover', name: 'Get started', goal: 'Find a clear first step' },
      rationale: 'The selected research supports a clearer entry stage.',
      evidenceRefs: ['knowledge-document:onboarding-study'], warningCodes: [],
      changeChecksum: 'd'.repeat(64), decision: null, createdAt: now
    }, {
      id: changeIds[1], ordinal: 1, operation: 'card.add', targetType: 'card', targetRef: 'card:new-guidance',
      before: null,
      after: {
        cardRef: 'new-guidance', stageKey: 'discover', laneKey: 'opportunities', ordinal: 0,
        title: 'Show one recommended next step', content: 'Guide customers to the next action.'
      },
      rationale: 'A single recommended action reduces decision effort.', evidenceRefs: [],
      warningCodes: ['ungrounded_change'], changeChecksum: 'e'.repeat(64), decision: null, createdAt: now
    }]
  };
  if (state === 'ready_to_apply') {
    detail.changes.forEach((change: any, index: number) => {
      change.decision = {
        id: `10000000-0000-4000-8000-00000000002${index}`, sequence: 1,
        decision: index === 0 ? 'accepted' : 'rejected', actorUserId: '10000000-0000-4000-8000-000000000013',
        reason: index === 0 ? 'Supported by the attached study.' : 'Keep this action out of the current draft.', createdAt: now
      };
    });
  }
  return detail;
}

test('owner generates, reviews, and atomically applies a typed journey suggestion', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'The complete authoring flow is covered on desktop.');
  await useSpaceRole(page, 'owner');
  const detail = suggestionDetail();
  const createBodies: unknown[] = [];
  const decisionBodies: unknown[] = [];
  const applyBodies: unknown[] = [];

  await page.route(/\/api\/journey-maps\/[^/]+\/ai-suggestions(?:\/evidence)?(?:\?.*)?$/u, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/evidence')) {
      const definitionId = url.pathname.split('/').at(-3) || detail.run.definitionId;
      await route.fulfill({ json: { evidence: [{
        linkId: evidenceLinkId, targetType: 'definition', targetId: definitionId,
        sourceType: 'knowledge_document', sourceRef: 'knowledge-document:onboarding-study',
        sourceLabel: 'Onboarding research', excerpt: 'Customers need a clear first step.',
        assessment: 'supports', promptInjectionSuspected: false
      }] } });
      return;
    }
    createBodies.push(route.request().postDataJSON());
    detail.run.definitionId = url.pathname.split('/').at(-2) || detail.run.definitionId;
    await route.fulfill({ status: 202, json: {
      suggestion: detail, created: true, jobId: detail.run.aiJobId,
      statusUrl: `/api/ai/jobs/${detail.run.aiJobId}`
    } });
  });
  await page.route(/\/api\/journey-suggestions(?:\?.*)?$/u, async (route) => {
    await route.fulfill({ json: { suggestions: [] } });
  });
  await page.route(/\/api\/journey-suggestions\/[0-9a-f-]+(?:\/.*)?$/u, async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() === 'GET') {
      await route.fulfill({ json: detail });
      return;
    }
    if (pathname.endsWith('/decision')) {
      const body = request.postDataJSON();
      decisionBodies.push(body);
      const changeId = pathname.split('/').at(-2) || '';
      const change = detail.changes.find((item: any) => item.id === changeId);
      change.decision = {
        id: `10000000-0000-4000-8000-00000000003${decisionBodies.length}`,
        sequence: 1, decision: body.decision, actorUserId: detail.run.requestedByUserId,
        reason: body.reason, createdAt: now
      };
      detail.run.revision += 1;
      if (detail.changes.every((item: any) => item.decision)) detail.run.state = 'ready_to_apply';
      await route.fulfill({ json: detail });
      return;
    }
    if (pathname.endsWith('/apply')) {
      applyBodies.push(request.postDataJSON());
      detail.run.state = 'applied';
      detail.run.appliedVersionId = '10000000-0000-4000-8000-000000000040';
      detail.run.appliedAt = now;
      await route.fulfill({ json: { outcome: 'applied', suggestion: detail, map: null } });
      return;
    }
    await route.abort();
  });

  await signIn(page);
  await page.goto('/journey-maps');
  await expect(page.getByTestId('journey-maps-page')).toBeVisible();
  await page.getByTestId('new-map-name').fill(`AI review journey ${Date.now()}`);
  await page.getByTestId('create-map').click();
  await expect(page.getByTestId('journey-workspace')).toBeVisible();

  await page.getByTestId('journey-ai-suggestions').click();
  const launch = page.getByTestId('journey-ai-suggestion-dialog');
  await expect(launch).toBeVisible();
  await launch.getByTestId('journey-suggestion-focus').fill('Reduce onboarding effort');
  await launch.getByRole('checkbox', { name: /Onboarding research/ }).check();
  await launch.getByTestId('generate-journey-suggestions').click();
  await expect(page).toHaveURL(new RegExp(`/journey-maps/suggestions/${runId}$`));
  await expect(page.getByRole('heading', { name: 'Review AI journey suggestions' })).toBeVisible();
  expect(createBodies).toEqual([{
    focus: 'Reduce onboarding effort', evidenceLinkIds: [evidenceLinkId]
  }]);

  const first = page.getByTestId('suggestion-change-0');
  await first.getByRole('button', { name: 'Accept' }).click();
  await first.getByLabel('Decision reason').fill('Supported by the attached study.');
  await first.getByRole('button', { name: 'Save decision' }).click();
  await expect(first.getByText('Accepted', { exact: true })).toBeVisible();

  const second = page.getByTestId('suggestion-change-1');
  await second.getByRole('button', { name: 'Reject' }).click();
  await second.getByLabel('Decision reason').fill('Keep this action out of the current draft.');
  await second.getByRole('button', { name: 'Save decision' }).click();
  await expect(page.getByText('Every proposed change has a decision.')).toBeVisible();
  expect(decisionBodies).toEqual([{
    expectedRunRevision: 2, decision: 'accepted', reason: 'Supported by the attached study.'
  }, {
    expectedRunRevision: 3, decision: 'rejected', reason: 'Keep this action out of the current draft.'
  }]);

  await page.getByRole('button', { name: 'Apply reviewed changes' }).click();
  await expect(page).toHaveURL(/\/journey-maps$/u);
  expect(applyBodies).toEqual([{ expectedRunRevision: 4, expectedDefinitionRevision: 3 }]);
});

test('member suggestion review is read-only and does not overflow a mobile viewport', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'Read-only responsive review is covered on mobile.');
  await useSpaceRole(page, 'member');
  const detail = suggestionDetail('ready_to_apply');
  const mutationRequests: string[] = [];
  await page.route(/\/api\/journey-suggestions\/[0-9a-f-]+(?:\/.*)?$/u, async (route) => {
    if (route.request().method() !== 'GET') {
      mutationRequests.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
      await route.fulfill({ status: 403, json: { error: 'Read-only' } });
      return;
    }
    await route.fulfill({ json: detail });
  });

  await signIn(page);
  await page.goto(`/journey-maps/suggestions/${runId}`);
  await expect(page.getByRole('heading', { name: 'Review AI journey suggestions' })).toBeVisible();
  await expect(page.getByTestId('journey-suggestion-read-only')).toBeVisible();
  for (const button of await page.getByRole('button', { name: /^(Accept|Reject|Save decision)$/u }).all()) {
    await expect(button).toBeDisabled();
  }
  for (const reason of await page.getByLabel('Decision reason').all()) await expect(reason).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Apply reviewed changes' })).toBeDisabled();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(mutationRequests).toEqual([]);
});
