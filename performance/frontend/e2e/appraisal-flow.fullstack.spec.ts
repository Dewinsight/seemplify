import { expect, test } from '@playwright/test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

test.use({ launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] } });

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
  app.use((req: { session: unknown; get: (name: string) => string }, _res: unknown, next: () => void) => { const who = req.get('x-native-qa-actor'); const user = who ? { ...principal, id: who, sub: who, email: `${who}@example.test` } : activePrincipal; req.session = { user: structuredClone(user), currentOrganizationId: organization.id }; next(); });
  app.use('/api/appraisals', backend('./routes/appraisals'));
  server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  apiURL = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
});

test('two real browser peers connect, obtain consent, record, save and play a private in-app call', async ({ browser }, testInfo) => {
  test.setTimeout(120000);
  await Appraisal.deleteMany({}); await backend('./models/OneOnOne').deleteMany({});
  const cycle = await AppraisalCycle.findOne({});
  const launched = await fetch(`${apiURL}/api/appraisals/cycles/${cycle._id}/launch`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-native-qa-actor': 'member' }, body: JSON.stringify({ employees: [{ userId: 'leader' }], reviewerMode: 'initiator', responseDeadlines: { selfAssessmentDue: '2099-01-01', managerReviewDue: '2099-01-10' }, appraisalFlow: { assessmentMode: 'form', steps: [{ id: 'call_1', type: 'oneOnOne', label: 'Discussion call' }, { id: 'final_2', type: 'finalReview', label: 'Final outcome' }] } }) });
  const result = await launched.json(); expect(launched.ok, JSON.stringify(result)).toBeTruthy(); const appraisal = result.data.appraisals[0];
  const created = await fetch(`${apiURL}/api/appraisals/${appraisal._id}/meetings`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-native-qa-actor': 'member' }, body: JSON.stringify({ mode: 'in_app', stepId: 'call_1', scheduledDate: new Date(Date.now() + 60000), record: true, recordingNoticeAccepted: true }) });
  expect(created.ok).toBeTruthy();
  const contexts = await Promise.all(['member', 'leader'].map(() => browser.newContext({ permissions: ['camera', 'microphone'] })));
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  for (const [index, page] of pages.entries()) {
    const who = index ? 'leader' : 'member'; const user = { ...principal, id: who, sub: who, email: `${who}@example.test` };
    await page.addInitScript(() => localStorage.setItem('accessToken', 'isolated-native-call-qa'));
    await page.route('**/__mock-api/**', async route => {
      const url = new URL(route.request().url()); const endpoint = url.pathname.slice('/__mock-api'.length);
      if (endpoint.startsWith('/appraisals/')) { const response = await route.fetch({ url: `${apiURL}/api${endpoint}${url.search}`, headers: { ...route.request().headers(), 'x-native-qa-actor': who } }); await route.fulfill({ response }); return; }
      const response = endpoint === '/auth/me' ? { success: true, user, currentOrganization: organization, currentOrganizationId: organization.id } : endpoint === '/user/context' ? { success: true, data: { user, role: { name: 'employee', isManager: false, isHRAdmin: false }, organization, teams: principal.idpTeams, features: {}, stats: {} } } : { success: true, data: [] };
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) });
    });
    await page.goto(`/appraisals/${appraisal._id}`);
    await expect(page.getByRole('tab', { name: 'Self-Assessment', exact: true })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Manager Review', exact: true })).toHaveCount(0);
    await expect(page.getByText(/Self-Assessment Due:/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Join in-app call', exact: true })).toBeDisabled();
    await page.getByRole('checkbox', { name: /I agree to this call being recorded/ }).check();
    await page.getByRole('button', { name: 'Join in-app call', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Leave call', exact: true })).toBeVisible({ timeout: 20000 });
  }
  await expect(pages[0].getByRole('button', { name: 'Start agreed recording', exact: true })).toBeEnabled({ timeout: 35000 });
  await expect(pages[1].getByRole('button', { name: 'Start agreed recording', exact: true })).toHaveCount(0);
  await pages[0].getByRole('button', { name: 'Start agreed recording', exact: true }).click();
  await expect(pages[1].getByText('Recording is in progress. Both participants’ audio and video may be captured.')).toBeVisible({ timeout: 10000 });
  await expect(pages[0].getByRole('button', { name: 'Leave call', exact: true })).toBeDisabled();
  await pages[0].screenshot({ path: testInfo.outputPath('in-app-recording.png'), fullPage: true });
  await pages[0].getByRole('button', { name: 'Stop and save recording', exact: true }).click();
  await expect(pages[0].getByText(/Recording saved. Transcription/)).toBeVisible({ timeout: 20000 });
  await pages[0].getByRole('button', { name: 'Play saved recording', exact: true }).click();
  await expect(pages[0].getByLabel('Saved appraisal call recording', { exact: true })).toBeVisible();
  const playback = pages[0].getByLabel('Saved appraisal call recording', { exact: true });
  await playback.evaluate((video: HTMLVideoElement) => video.play());
  await expect.poll(() => playback.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0);
  const meeting = await backend('./models/OneOnOne').findOne({ appraisalId: appraisal._id });
  expect(meeting.appraisalMeeting.recordingFileId).toBeTruthy();
  const file = await mongoose.connection.db.collection('appraisalRecordings.files').findOne({ _id: new mongoose.Types.ObjectId(meeting.appraisalMeeting.recordingFileId) }); expect(file.length).toBeGreaterThan(1000);
  await pipeline(new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'appraisalRecordings' }).openDownloadStream(file._id), createWriteStream(testInfo.outputPath('native-call.webm')));
  for (const page of pages) await page.getByRole('button', { name: 'Leave call', exact: true }).click();
  await Promise.all(contexts.map(context => context.close()));
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
