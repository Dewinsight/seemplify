import { expect, test } from '@playwright/test';
import { createRequire } from 'node:module';
import path from 'node:path';

const backend = createRequire(path.resolve(process.cwd(), '../backend/package.json'));
const express = backend('express');
const mongoose = backend('mongoose');
const { MongoMemoryServer } = backend('mongodb-memory-server');
const User = backend('./models/User');
const Appraisal = backend('./models/Appraisal');
const AppraisalCycle = backend('./models/AppraisalCycle');
const { ensureQuarterlyCycles } = backend('./services/quarterlyAppraisalService');
let mongo: { stop: () => Promise<void> };
let server: import('node:http').Server;
let apiURL: string;
const organization = { id: 'review-browser-org', name: 'Browser review QA', role: 'employee', appAccess: { mode: 'all', appIds: [] } };
const principal = { id: 'member', sub: 'member', name: 'Taylor Member', email: 'member@example.test', organizations: [organization], currentOrganization: organization,
  idpTeams: [{ id: 'team', name: 'Product', organizationId: organization.id, role: 'member' }] };

test.beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect((mongo as unknown as { getUri: () => string }).getUri());
  await Appraisal.createIndexes(); await AppraisalCycle.createIndexes();
  await User.create({ idpSub: 'leader', email: 'leader@example.test', profile: { displayName: 'Alex Team Leader' }, currentOrganizationId: organization.id,
    idpTeams: [{ id: 'team', name: 'Product', organizationId: organization.id, role: 'line_manager' }] });
  await ensureQuarterlyCycles(organization.id);
  const app = express(); app.use(express.json());
  // Authentication fixture supplies signed-in identity only. Appraisal endpoints
  // below use the real Express routes, authorization service and MongoDB.
  app.use((req: { session: unknown }, _res: unknown, next: () => void) => { req.session = { user: structuredClone(principal), currentOrganizationId: organization.id }; next(); });
  app.use('/api/appraisals', backend('./routes/appraisals'));
  server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  apiURL = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
});
test.afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await mongoose.disconnect(); if (mongo) await mongo.stop();
});

for (const mobile of [false, true]) test(`ordinary member launches and conducts an upward review using real APIs (${mobile ? 'mobile' : 'desktop'})`, async ({ page }, testInfo) => {
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  await Appraisal.deleteMany({});
  await page.addInitScript(() => { localStorage.setItem('accessToken', 'isolated-review-qa'); });
  await page.route('**/__mock-api/**', async route => {
    const url = new URL(route.request().url());
    const endpoint = url.pathname.slice('/__mock-api'.length);
    if (endpoint.startsWith('/appraisals/')) {
      const response = await route.fetch({ url: `${apiURL}/api${endpoint}${url.search}` });
      await route.fulfill({ response }); return;
    }
    let response: unknown = { success: true, data: [] };
    if (endpoint === '/auth/me') response = { success: true, user: principal, currentOrganization: organization, currentOrganizationId: organization.id };
    if (endpoint === '/user/context') response = { success: true, data: { user: principal, role: { name: 'employee', isManager: false, isHRAdmin: false }, organization, teams: principal.idpTeams, features: {}, stats: {} } };
    if (endpoint === '/user/current-team') response = { success: true, data: { currentTeam: principal.idpTeams[0], availableTeams: principal.idpTeams } };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) });
  });
  await page.goto('/appraisals/start');
  await page.getByRole('checkbox', { name: /Alex Team Leader/ }).check();
  await expect(page.getByText(/Reviewer: you/)).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Review cycle' })).toContainText('performance review');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Alex Team Leader · Reviewer: you')).toBeVisible();
  const quarter = await AppraisalCycle.findOne({ organizationId: organization.id, periodEnd: { $lt: new Date() } }).sort({ periodEnd: -1 });
  const expectedEnd = quarter.periodEnd.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  await expect(page.getByText(`Assessment period:`, { exact: false })).toContainText(expectedEnd);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('quarterly-review-confirm.png'), fullPage: true });
  await page.getByRole('button', { name: 'Start appraisals', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Appraisal launch results' })).toBeVisible();
  await expect(page.getByText('1 started · 0 already in progress · 0 blocked')).toBeVisible();
  const review = await Appraisal.findOne();
  expect(review.manager.userId).toBe('member'); expect(review.employee.userId).toBe('leader');
  // Simulate the employee having finished their response, then conduct the
  // review through the normal browser. No external provider or email is used.
  await Appraisal.updateOne({ _id: review._id }, { $set: { status: 'self_assessment_submitted', 'selfAssessment.submittedAt': new Date(), 'selfAssessment.overallSelfRating': 4 } });
  await page.goto(`/appraisals/${review._id}/manager-review`);
  await expect(page.getByText('Only the assigned reviewer or HR can complete this review')).toHaveCount(0);
  await expect.poll(async () => (await Appraisal.findById(review._id)).status).toBe('manager_review_in_progress');
  await page.getByRole('button', { name: 'Save Progress', exact: true }).click();
  await expect.poll(async () => !!(await Appraisal.findById(review._id)).managerReview?.lastSavedAt).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto('/appraisals?section=conducting');
  await expect(page.getByText('Alex Team Leader', { exact: true }).first()).toBeVisible();
});
