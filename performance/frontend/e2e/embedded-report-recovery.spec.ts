import { expect, test, type Page } from '@playwright/test';

// UI recovery contracts. Authentication, feature and report transport are synthetic;
// these cases do not certify backend permissions, persistence or the live incident cause.
const parentId = 'embedded-recovery-parent';
const ordinaryNarrative = 'Synthetic ordinary reviewer feedback remains available.';
const unavailable = 'Could not check the linked competency report. Your appraisal result is still available.';
const roleRegion = (page: Page) => page.getByRole('region', { name: 'Competency assessment report', exact: true });
async function setup(page: Page, options: { bootstrapFailures?: number; holdInitial?: boolean; holdRetry?: boolean; disabled?: boolean; ordinaryFailures?: number } = {}) {
  const user = { id: 'synthetic-owner', sub: 'synthetic-owner', name: 'Synthetic Owner', email: 'owner@example.test' };
  const organization = { id: 'synthetic-recovery-org', name: 'Synthetic recovery audit', role: 'owner' };
  let bootstrapReads = 0, ordinaryReads = 0, linkedReads = 0;
  const domainRequests: { method: string; path: string }[] = [];
  const pageErrors: string[] = [];
  let releaseInitial!: () => void, releaseRetry!: () => void;
  const initialGate = new Promise<void>(resolve => { releaseInitial = resolve; });
  const retryGate = new Promise<void>(resolve => { releaseRetry = resolve; });
  await page.addInitScript(() => localStorage.setItem('accessToken', 'synthetic-embedded-report-recovery'));
  page.on('pageerror', error => pageErrors.push(error.name));
  await page.route('**/__mock-api/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname.replace('/__mock-api', '');
    const method = route.request().method();
    if (path.startsWith('/appraisals/') || path.startsWith('/competency/')) domainRequests.push({ method, path });
    if (path === '/auth/me') { await route.fulfill({ json: { success: true, user: { ...user, organizations: [organization] }, currentOrganization: organization, currentOrganizationId: organization.id } }); return; }
    let data: unknown = [];
    if (path === '/user/context') data = { user, organization, role: { name: 'owner', isManager: true, isHRAdmin: true }, teams: [], features: { canonicalAppraisals: true }, stats: {} };
    if (path === '/user/current-team') data = { currentTeam: null, availableTeams: [] };
    if (path === '/competency/bootstrap') {
      bootstrapReads++;
      if (options.holdInitial && bootstrapReads === 1) await initialGate;
      if (options.holdRetry && bootstrapReads === 2) await retryGate;
      if (bootstrapReads <= (options.bootstrapFailures || 0)) { await route.fulfill({ status: 503, json: { error: { code: 'DIRECTORY_UNAVAILABLE', message: 'Synthetic temporary directory outage.' } } }); return; }
      data = { enabled: !options.disabled, capabilities: {}, people: [], settings: {} };
    }
    if (path === `/appraisals/${parentId}/report`) {
      ordinaryReads++;
      if (ordinaryReads <= (options.ordinaryFailures || 0)) { await route.fulfill({ status: 503, json: { error: 'Synthetic ordinary report temporarily unavailable.' } }); return; }
      data = { id: parentId, status: 'employee_acknowledged', employee: { name: 'Synthetic Participant' }, manager: { name: 'Synthetic Manager' }, cycle: { name: 'Synthetic completed appraisal', periodStart: '2026-07-01', periodEnd: '2026-09-30' }, ratingScale: { max: 5 }, finalRating: { overall: 4, finalizedAt: '2026-10-18T12:00:00Z' }, acknowledgedAt: '2026-10-19T12:00:00Z', managerSummary: { strengths: ordinaryNarrative }, goals: [], competencies: [], answers: [] };
    }
    if (path === `/competency/appraisal-links/${parentId}`) { linkedReads++; data = { assessments: [{ assessmentId: 'synthetic-linked-result' }] }; }
    if (path === '/competency/assessments/synthetic-linked-result') data = { id: 'synthetic-linked-result', allowedActions: ['competency.report.view'], result: { number: 1 }, resultVersions: [{ number: 1, status: 'current' }] };
    if (path === '/competency/assessments/synthetic-linked-result/report') data = { number: 1, participant: { name: 'Synthetic Participant' }, role: { name: 'Synthetic frozen role', version: 2 }, reportHash: 'a'.repeat(64), criteria: [], findings: [], score: { overallScore: 75, coverage: { selected: 1, assessed: 1 }, sourceScores: [] }, finalClassification: { label: 'Synthetic human classification', finalisedAt: '2026-10-19T12:00:00Z' }, evidenceReferences: [], managerFeedback: [], oralFindings: [], dates: {}, visibilityScope: 'organization' };
    await route.fulfill({ json: { success: true, data } });
  });
  return { releaseInitial, releaseRetry, counts: () => ({ bootstrapReads, ordinaryReads, linkedReads }), assertReadOnly: () => { expect(domainRequests.every(request => request.method === 'GET')).toBe(true); expect(pageErrors).toEqual([]); } };
}
async function capture(page: Page, path: string) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({ path, fullPage: true, animations: 'disabled' });
}
async function ordinaryVisible(page: Page) {
  await expect(page.getByRole('heading', { name: 'Appraisal result report', exact: true })).toBeVisible();
  await expect(page.getByText(ordinaryNarrative, { exact: true })).toBeVisible();
  await expect(page.getByText('4 / 5', { exact: false })).toBeVisible();
}

test('keeps the ordinary result readable while the competency check is pending', async ({ page }) => {
  const state = await setup(page, { holdInitial: true });
  try {
    await page.goto(`/appraisals/${parentId}/report`); await ordinaryVisible(page);
    await expect(page.getByRole('status').filter({ hasText: 'Checking linked competency report' })).toBeVisible();
    await expect(roleRegion(page)).toHaveCount(0);
    state.releaseInitial();
    await expect(roleRegion(page)).toBeVisible(); await ordinaryVisible(page);
    expect(state.counts()).toEqual({ bootstrapReads: 1, ordinaryReads: 1, linkedReads: 1 }); state.assertReadOnly();
  } finally { state.releaseInitial(); }
});

test('recovers a transient competency failure through Retry without reloading the ordinary report', async ({ page }, info) => {
  const state = await setup(page, { bootstrapFailures: 1 });
  await page.goto(`/appraisals/${parentId}/report`); await ordinaryVisible(page);
  const warning = page.getByRole('alert').filter({ hasText: unavailable });
  await expect(warning).toBeVisible(); await expect(roleRegion(page)).toHaveCount(0);
  await capture(page, info.outputPath('linked-report-retry-warning.png'));
  await warning.getByRole('button', { name: 'Retry competency report', exact: true }).click();
  await expect(roleRegion(page)).toBeVisible(); await expect(roleRegion(page)).toContainText('Synthetic frozen role');
  await expect(roleRegion(page)).toContainText('75.00 / 100'); await expect(warning).toHaveCount(0);
  await ordinaryVisible(page); expect(state.counts()).toEqual({ bootstrapReads: 2, ordinaryReads: 1, linkedReads: 1 }); state.assertReadOnly();
  await capture(page, info.outputPath('linked-report-recovered.png'));
});

test('repeated failures retain recovery and disable the pending Retry on mobile', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await setup(page, { bootstrapFailures: 2, holdRetry: true });
  try {
    await page.goto(`/appraisals/${parentId}/report`); await ordinaryVisible(page);
    const warning = page.getByRole('alert').filter({ hasText: unavailable }); await expect(warning).toBeVisible();
    await warning.getByRole('button', { name: 'Retry competency report', exact: true }).click();
    await expect(warning.getByRole('button', { name: 'Retrying…', exact: true })).toBeDisabled();
    await ordinaryVisible(page); state.releaseRetry();
    await expect(warning.getByRole('button', { name: 'Retry competency report', exact: true })).toBeEnabled();
    const messageBounds = await warning.getByText(unavailable, { exact: true }).boundingBox();
    const retryBounds = await warning.getByRole('button', { name: 'Retry competency report', exact: true }).boundingBox();
    expect(messageBounds).not.toBeNull(); expect(retryBounds).not.toBeNull();
    expect(retryBounds!.y).toBeGreaterThanOrEqual(messageBounds!.y + messageBounds!.height);
    expect(retryBounds!.height).toBeGreaterThanOrEqual(44);
    await capture(page, info.outputPath('mobile-repeated-failure.png'));
    await warning.getByRole('button', { name: 'Retry competency report', exact: true }).click();
    await expect(roleRegion(page)).toBeVisible(); await expect(warning).toHaveCount(0);
    expect(state.counts()).toEqual({ bootstrapReads: 3, ordinaryReads: 1, linkedReads: 1 }); state.assertReadOnly();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally { state.releaseRetry(); }
});

test('a successfully disabled competency module stays quiet and does not request linked reports', async ({ page }) => {
  const state = await setup(page, { disabled: true }); await page.goto(`/appraisals/${parentId}/report`); await ordinaryVisible(page);
  await expect.poll(() => state.counts().bootstrapReads).toBe(1);
  await expect(page.getByRole('status').filter({ hasText: 'Checking linked competency report' })).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: unavailable })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry competency report', exact: true })).toHaveCount(0);
  await expect(roleRegion(page)).toHaveCount(0); expect(state.counts().linkedReads).toBe(0); state.assertReadOnly();
});

test('ordinary report Retry remains independent of the healthy competency check', async ({ page }) => {
  const state = await setup(page, { ordinaryFailures: 1 }); await page.goto(`/appraisals/${parentId}/report`);
  const warning = page.getByRole('alert').filter({ hasText: 'Synthetic ordinary report temporarily unavailable.' });
  await expect(warning).toBeVisible(); await warning.getByRole('button', { name: 'Retry', exact: true }).click();
  await ordinaryVisible(page); await expect(roleRegion(page)).toBeVisible();
  expect(state.counts()).toEqual({ bootstrapReads: 1, ordinaryReads: 2, linkedReads: 1 }); state.assertReadOnly();
});
