import { expect, test, type Page } from '@playwright/test';
const id = '507f1f77bcf86cd799439011';

async function setup(page: Page, failure: 'provider' | 'malformed') {
  const user = { id: 'reviewer', sub: 'reviewer', name: 'Synthetic Reviewer', email: 'reviewer@example.test' };
  const organization = { id: 'ai-recovery', name: 'Synthetic AI recovery', role: 'owner' };
  let attempts = 0;
  const writes: string[] = [];
  await page.addInitScript(() => localStorage.setItem('accessToken', 'synthetic-ai-recovery'));
  await page.route('**/__mock-api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname.replace('/__mock-api', '');
    const finish = (data: unknown) => route.fulfill({ json: { success: true, data } });
    if (path === '/auth/me') return route.fulfill({ json: { success: true, user: { ...user, organizations: [organization] }, currentOrganization: organization } });
    if (path === '/user/context') return finish({ user, organization, role: { name: 'owner', isManager: true, isHRAdmin: true }, teams: [], features: {}, stats: {} });
    if (path === '/user/current-team') return finish({ currentTeam: null, availableTeams: [] });
    if (path === '/competency/bootstrap') return finish({ enabled: false });
    if (path === `/appraisals/${id}`) return finish({ _id: id, status: 'manager_review_in_progress', employee: { userId: 'employee', name: 'Synthetic Participant' }, manager: { userId: user.id, name: user.name }, cycleId: { name: 'Synthetic competency cycle', competencies: [], settings: { enableAiAssist: true } }, cycleConfigurationSnapshot: { assessmentSections: [], appraisalFlow: { version: 1, steps: [{ id: 'review', type: 'managerReview', label: 'Reviewer assessment' }, { id: 'final', type: 'finalReview', label: 'Final outcome' }] } }, managerReview: { overallManagerRating: 3 }, documents: [], deadlines: {}, viewerCapabilities: { canManage: true, isEmployee: false } });
    if (path.endsWith('/scoring')) return finish({ okrScore: null, competencyScore: null, compositeScore: null, breakdown: { okrWeight: 0, competencyWeight: 0 } });
    if (path.endsWith('/ai-rating-suggestion')) {
      attempts++;
      if (attempts === 1) return route.fulfill({ status: failure === 'provider' ? 502 : 200, json: failure === 'provider' ? { success: false, code: 'AI_RESPONSE_INVALID', error: 'The AI rating recommendation was incomplete.' } : { success: true, data: { aiSuggestion: { suggestedRating: null } } } });
      return finish({ aiSuggestion: { suggestedRating: 4, ratingJustification: 'Synthetic advisory recommendation using the configured evidence.' } });
    }
    if (request.method() === 'POST' && path.startsWith('/appraisals/')) writes.push(path);
    return finish([]);
  });
  await page.goto(`/appraisals/${id}`);
  return { writes, attempts: () => attempts };
}

for (const failure of ['provider', 'malformed'] as const) {
  test(`${failure} rating advice shows recovery and never replaces the human rating`, async ({ page }, info) => {
    const state = await setup(page, failure);
    const request = page.getByRole('button', { name: 'Get AI Suggestion', exact: true });
    await request.click();
    await expect(page.getByText(/You can retry with Get AI Suggestion or submit your own review/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Review AI settings', exact: true })).toHaveAttribute('href', '/settings/ai');
    await expect(page.getByRole('radio', { name: '3 Stars', exact: true })).toBeChecked();
    await expect(page.getByRole('button', { name: 'Submit Review', exact: true })).toBeEnabled();
    await request.click();
    await expect(page.getByText('Synthetic advisory recommendation using the configured evidence.')).toBeVisible();
    await expect(page.getByText(/You can retry with Get AI Suggestion or submit your own review/)).toHaveCount(0);
    await expect(page.getByRole('radio', { name: '3 Stars', exact: true })).toBeChecked();
    expect(state.attempts()).toBe(2);
    expect(state.writes.filter(path => !path.endsWith('/manager-review/start'))).toEqual([]);
    if (failure === 'provider') await page.screenshot({ path: info.outputPath('manager-ai-recovered.png'), fullPage: true });
  });
}
