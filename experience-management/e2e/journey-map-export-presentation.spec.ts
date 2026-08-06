import { expect, test, type Page, type Route } from '@playwright/test';

const password = 'Playwright-Test-Password-2026!';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();
}

async function binary(route: Route, format: string) {
  const filename = format === 'pdf' ? 'Customer journey.pdf' : `Customer journey.${format}`;
  await route.fulfill({
    status: 200,
    headers: {
      'content-type': format === 'pdf' ? 'application/pdf' : 'application/json',
      'content-disposition': `attachment; filename="fallback.${format}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'cache-control': 'private, no-store'
    },
    body: format === 'pdf' ? '%PDF-1.7 mock journey' : '{"schema":"seemplify.journey-map.export/v1"}'
  });
}

test('enabled journey exports download server-named files and presentation stays truthful and read-only', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Journey export and presentation are covered on one desktop browser.');
  await page.addInitScript(() => {
    window.print = () => { document.body.dataset.printInvoked = 'true'; };
  });
  await page.route('**/api/auth/session', async (route) => {
    const response = await route.fetch();
    const session = await response.json();
    if (session.authenticated) {
      const subscription = session.subscription || {
        planCode: 'team', planName: 'Test plan', limits: {}, status: 'active', source: 'managed'
      };
      session.subscription = {
        ...subscription,
        features: {
          ...(subscription.features || {}), journeyDesign: true, journeyPersonas: true,
          journeyEvidence: true, journeyTemplates: true, journeyExports: true
        }
      };
    }
    await route.fulfill({ response, json: session });
  });
  await signIn(page);

  const version = {
    id: 'version-export-demo', versionNumber: 4, schemaVersion: 1, state: 'published',
    publishedAt: '2026-08-04T12:00:00.000Z', createdAt: '2026-08-04T11:00:00.000Z',
    mapType: 'current_state', mode: 'evidence_backed', experienceType: 'customer',
    objective: 'Restore access without repeat contact', industry: 'Software',
    summary: 'A supported account recovery journey.', legacyAudience: ''
  };
  const definition = {
    id: 'map-export-demo', legacyJourneyId: null, name: 'Account recovery', purpose: '',
    experienceType: 'customer', mapType: 'current_state', mode: 'evidence_backed', status: 'published',
    currentVersionId: version.id, publishedVersionId: version.id, revision: 8,
    stageCount: 1, cardCount: 1, evidenceLinkCount: 2, personaCount: 0,
    createdAt: '2026-08-04T10:00:00.000Z', updatedAt: '2026-08-04T12:00:00.000Z'
  };
  const map = {
    definition, version,
    stages: [{ id: 'stage-request-help', stageKey: 'request-help', name: 'Request help',
      goal: 'Regain access', description: '', ordinal: 0 }],
    lanes: [{ id: 'lane-actions', laneType: 'customer_actions', title: 'Customer actions',
      description: '', ordinal: 0, visible: true }],
    cards: [{
      id: 'card-contact-support', stageKey: 'request-help', laneType: 'customer_actions', kind: 'action',
      title: 'Contact support', content: 'Use the recovery channel.', ordinal: 0, personaId: null,
      status: 'active', origin: 'workspace', evidenceLinkCount: 2,
      evidence: { state: 'supported', supporting: 2, contradicting: 0, neutral: 0, stale: 0,
        inaccessible: 0, reason: 'multiple_supporting_sources' }
    }],
    personas: [], versions: [{ id: version.id, versionNumber: 4, state: 'published',
      publishedAt: version.publishedAt, createdAt: version.createdAt }],
    researchGaps: [], evidenceSummary: { supported: 1 }
  };
  const index = {
    journeyMaps: [definition], personas: [],
    limits: { stages: 20, lanes: 20, cards: 500, cardsPerCell: 50, titleChars: 200, contentChars: 10000 },
    catalog: { mapTypes: ['current_state'], experienceTypes: ['customer'], laneTypes: ['customer_actions'],
      cardKinds: ['action'], evidenceSourceTypes: [], evidenceAssessments: [], personaLifecycleStates: [] }
  };
  await page.route(/\/api\/journey-maps(?:\?.*)?$/u, (route) => route.fulfill({ json: index }));
  await page.route(/\/api\/journey-maps\/map-export-demo(?:\?.*)?$/u, (route) => route.fulfill({ json: map }));

  const exportRequests: Array<{ format: string; key: string | undefined; versionId: string | null }> = [];
  await page.route(/\/api\/journey-maps\/map-export-demo\/export\.(json|pdf)(?:\?.*)?$/u, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const format = url.pathname.endsWith('.pdf') ? 'pdf' : 'json';
    exportRequests.push({ format, key: request.headers()['idempotency-key'], versionId: url.searchParams.get('versionId') });
    await binary(route, format);
  });

  await page.goto('/journey-maps');
  await expect(page.getByTestId('journey-workspace')).toBeVisible();
  const menu = page.getByTestId('journey-export-menu');
  await expect(menu).toBeVisible();

  await menu.locator('summary').click();
  const pdfDownload = page.waitForEvent('download');
  await page.getByTestId('export-journey-pdf').click();
  const pdf = await pdfDownload;
  expect(pdf.suggestedFilename()).toBe('Customer journey.pdf');

  await menu.locator('summary').click();
  const jsonDownload = page.waitForEvent('download');
  await page.getByTestId('export-journey-json').click();
  expect((await jsonDownload).suggestedFilename()).toBe('Customer journey.json');
  expect(exportRequests).toHaveLength(2);
  expect(exportRequests.map((request) => request.versionId)).toEqual([version.id, version.id]);
  expect(exportRequests.every((request) => Boolean(request.key))).toBe(true);
  expect(exportRequests[0].key).not.toBe(exportRequests[1].key);

  const openPresentation = page.getByTestId('open-presentation');
  await openPresentation.click();
  const presentation = page.getByTestId('journey-presentation');
  await expect(presentation).toBeVisible();
  await expect(presentation.getByTestId('presentation-mode')).toHaveText('Evidence-backed');
  await expect(presentation.getByTestId('presentation-version')).toHaveText('v4 · published');
  await expect(presentation.getByTestId('presentation-stage-grid')).toBeVisible();
  await expect(page.getByTestId('publish-map')).toHaveCount(0);
  await expect(page.getByTestId('journey-export-menu')).toHaveCount(0);
  await presentation.getByTestId('presentation-tab-outline').click();
  await expect(presentation.getByTestId('presentation-outline')).toContainText('Contact support');
  await presentation.getByTestId('print-presentation').click();
  await expect(page.locator('body')).toHaveAttribute('data-print-invoked', 'true');
  await page.keyboard.press('Escape');
  await expect(presentation).toHaveCount(0);
  await expect(openPresentation).toBeFocused();
});
