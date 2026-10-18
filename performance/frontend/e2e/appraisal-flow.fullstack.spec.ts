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
let activePrincipal: typeof principal;
const organization = { id: 'review-browser-org', name: 'Browser review QA', role: 'employee', appAccess: { mode: 'all', appIds: [] } };
const principal = { id: 'member', sub: 'member', name: 'Taylor Member', email: 'member@example.test', organizations: [organization], currentOrganization: organization,
  idpTeams: [{ id: 'team', name: 'Product', organizationId: organization.id, role: 'member' }] };

test.beforeAll(async () => {
  activePrincipal = principal;
  mongo = await MongoMemoryServer.create();
  await mongoose.connect((mongo as unknown as { getUri: () => string }).getUri());
  await Appraisal.createIndexes(); await AppraisalCycle.createIndexes();
  await User.create({ idpSub: 'leader', email: 'leader@example.test', profile: { displayName: 'Alex Team Leader' }, currentOrganizationId: organization.id,
    idpTeams: [{ id: 'team', name: 'Product', organizationId: organization.id, role: 'line_manager' }] });
  await ensureQuarterlyCycles(organization.id);
  const app = express(); app.use(express.json());
  // Authentication fixture supplies signed-in identity only. Appraisal endpoints
  // below use the real Express routes, authorization service and MongoDB.
  app.use((req: { session: unknown }, _res: unknown, next: () => void) => { req.session = { user: structuredClone(activePrincipal), currentOrganizationId: organization.id }; next(); });
  app.use('/api/appraisals', backend('./routes/appraisals'));
  server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  apiURL = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
});
test.afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await mongoose.disconnect(); if (mongo) await mongo.stop();
});


for (const mobile of [false, true]) test(`manual assessment and visual call workflow persists through real APIs (${mobile ? 'mobile' : 'desktop'})`, async ({ page }, testInfo) => {
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  activePrincipal = principal;
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
    if (endpoint === '/auth/me') response = { success: true, user: activePrincipal, currentOrganization: organization, currentOrganizationId: organization.id };
    if (endpoint === '/user/context') response = { success: true, data: { user: activePrincipal, role: { name: 'employee', isManager: false, isHRAdmin: false }, organization, teams: principal.idpTeams, features: {}, stats: {} } };
    if (endpoint === '/user/current-team') response = { success: true, data: { currentTeam: principal.idpTeams[0], availableTeams: principal.idpTeams } };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) });
  });

  await page.goto('/appraisals/start');
  await page.getByRole('checkbox', { name: /Alex Team Leader/ }).check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const editor = page.getByRole('region', { name: 'Appraisal steps', exact: true });
  await expect(editor.getByRole('switch', { name: 'AI conversation for employee assessment' })).toBeChecked();
  await editor.getByRole('switch', { name: 'AI conversation for employee assessment' }).uncheck();
  await expect(editor.getByText(/No AI interview or ChatGPT connection is required/)).toBeVisible();
  await editor.getByRole('button', { name: 'Remove Performance discussion', exact: true }).click();
  await editor.getByRole('combobox', { name: 'Add a step', exact: true }).click();
  await page.getByRole('option', { name: 'One-on-one meeting', exact: true }).click();
  await editor.getByRole('button', { name: 'Move One-on-one meeting earlier', exact: true }).click();
  await editor.getByRole('button', { name: 'Move One-on-one meeting earlier', exact: true }).click();
  // Temporarily invalid ordering must keep the user in setup, without writes.
  await editor.getByRole('button', { name: 'Move Final outcome earlier', exact: true }).click();
  await expect(editor.getByRole('status')).toContainText('Place all review work before the final outcome.');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review details', exact: true })).toBeVisible();
  expect(await Appraisal.countDocuments()).toBe(0);
  await editor.getByRole('button', { name: 'Move Final outcome later', exact: true }).click();
  await expect(editor.getByRole('status')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('visual-appraisal-flow.png'), fullPage: true });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Employee assessment: Manual form', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start appraisals', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Appraisal launch results' })).toBeVisible();
  const appraisal = await Appraisal.findOne();
  expect(appraisal.status).toBe('meeting_pending');
  expect(appraisal.cycleConfigurationSnapshot.appraisalFlow.assessmentMode).toBe('form');
  expect(appraisal.cycleConfigurationSnapshot.appraisalFlow.steps.map((step: { type: string }) => step.type)).toEqual(['oneOnOne', 'selfAssessment', 'managerReview', 'finalReview', 'acknowledgement']);
  await page.goto(`/appraisals/${appraisal._id}`);
  await expect(page.getByRole('heading', { name: 'Appraisal calls and notes' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Schedule a call', exact: true })).toBeVisible();
  // Finish the call in the fixture, then verify the employee is taken directly to the manual form.
  await Appraisal.updateOne({ _id: appraisal._id }, { $set: { completedMeetingSteps: [appraisal.cycleConfigurationSnapshot.appraisalFlow.steps[0].id], status: 'self_assessment_pending' } });
  activePrincipal = { ...principal, id: 'leader', sub: 'leader', email: 'leader@example.test' };
  await page.goto(`/appraisals/${appraisal._id}/self-assessment`);
  await expect(page.getByText(/This appraisal uses a manual assessment form/)).toBeVisible();
  await expect(page.getByText(/Connect ChatGPT to begin/)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('manual-assessment.png'), fullPage: true });
  activePrincipal = principal;
});
