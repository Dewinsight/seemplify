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
  idpTeams: [{ id: 'team', name: 'Product', organizationId: organization.id, role: 'line_manager' }] };

test.beforeAll(async () => {
  activePrincipal = principal;
  mongo = await MongoMemoryServer.create();
  await mongoose.connect((mongo as unknown as { getUri: () => string }).getUri());
  await Appraisal.createIndexes(); await AppraisalCycle.createIndexes();
  await User.create({ idpSub: 'leader', email: 'leader@example.test', profile: { displayName: 'Alex Team Leader' }, currentOrganizationId: organization.id,
    idpTeams: [{ id: 'team', name: 'Product', organizationId: organization.id, role: 'line_manager' }] });
  await ensureQuarterlyCycles(organization.id);
  // Manual workflows and calls are tested without goal setup in this synthetic organization.
  await AppraisalCycle.updateMany({ organizationId: organization.id }, { $set: { 'settings.requireOkrAlignment': false } });
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
  const contexts = await Promise.all(['member', 'leader'].map((_, index) => browser.newContext({ permissions: ['camera', 'microphone'], viewport: index ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, colorScheme: index ? 'dark' : 'light' })));
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  const captureCall = async (page: typeof pages[number], filename: string) => {
    const viewport = page.viewportSize()!;
    if (viewport.width < 600) await page.setViewportSize({ ...viewport, height: 1600 });
    const call = page.getByRole('region', { name: 'In-app one-on-one', exact: true });
    await call.evaluate(element => element.scrollIntoView({ block: 'center' }));
    await call.screenshot({ path: testInfo.outputPath(filename) });
    if (viewport.width < 600) await page.setViewportSize(viewport);
  };
  for (const [index, page] of pages.entries()) {
    const who = index ? 'leader' : 'member'; const user = { ...principal, id: who, sub: who, email: `${who}@example.test` };
    await page.addInitScript(() => localStorage.setItem('accessToken', 'isolated-native-call-qa'));
    await page.route('**/__mock-api/**', async route => {
      const url = new URL(route.request().url()); const endpoint = url.pathname.slice('/__mock-api'.length);
      if (endpoint.startsWith('/appraisals/')) { const response = await route.fetch({ url: `${apiURL}/api${endpoint}${url.search}`, headers: { ...route.request().headers(), 'x-native-qa-actor': who } }); await route.fulfill({ response }); return; }
      const response = endpoint === '/auth/me' ? { success: true, user, currentOrganization: organization, currentOrganizationId: organization.id } : endpoint === '/user/context' ? { success: true, data: { user, role: { name: 'line_manager', isManager: true, isHRAdmin: false }, organization, teams: principal.idpTeams, features: {}, stats: {} } } : { success: true, data: [] };
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) });
    });
    await page.goto(`/appraisals/${appraisal._id}`);
    await expect(page.getByRole('tab', { name: 'Self-Assessment', exact: true })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Manager Review', exact: true })).toHaveCount(0);
    await expect(page.getByText(/Self-Assessment Due:/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Join in-app call', exact: true })).toBeDisabled();
    const call = page.getByRole('region', { name: 'In-app one-on-one', exact: true });
    await expect(call.getByText('Private call', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await captureCall(page, index ? 'mobile-dark-before-join.png' : 'desktop-light-before-join.png');
    if (index === 1) await page.getByRole('checkbox', { name: 'Join with camera on', exact: true }).uncheck();
    await page.getByRole('checkbox', { name: /I agree to this call being recorded/ }).check();
    if (index === 0) {
      // Exercise the permission failure, then retry with actual browser media.
      await page.evaluate(() => {
        const getMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = async constraints => { navigator.mediaDevices.getUserMedia = getMedia; throw new DOMException('Synthetic permission denial', 'NotAllowedError'); };
      });
      await page.getByRole('button', { name: 'Join in-app call', exact: true }).click();
      await expect(call.getByRole('alert')).toContainText('Allow access in your browser’s site settings');
      await expect(page.getByRole('button', { name: 'Join in-app call', exact: true })).toBeEnabled();
    }
    await page.getByRole('button', { name: 'Join in-app call', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Leave call', exact: true })).toBeVisible({ timeout: 20000 });
  }
  await expect(pages[0].getByRole('button', { name: 'Start agreed recording', exact: true })).toBeEnabled({ timeout: 35000 });
  await expect(pages[1].getByRole('button', { name: 'Start agreed recording', exact: true })).toHaveCount(0);
  for (const page of pages) {
    const call = page.getByRole('region', { name: 'In-app one-on-one', exact: true });
    await expect(call.getByText('Connected', { exact: true })).toBeVisible();
    await expect(call.getByText('Camera off', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const mute = page.getByRole('button', { name: 'Mute microphone', exact: true });
    expect((await mute.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await mute.click();
    await expect(page.getByRole('button', { name: 'Unmute microphone', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Unmute microphone', exact: true }).click();
  }
  await pages[0].getByRole('button', { name: 'Start agreed recording', exact: true }).click();
  await expect(pages[1].getByText('Recording is in progress. Both participants’ audio and video may be captured.')).toBeVisible({ timeout: 10000 });
  await expect(pages[0].getByRole('button', { name: 'Leave call', exact: true })).toBeDisabled();
  await pages[0].screenshot({ path: testInfo.outputPath('in-app-recording.png'), fullPage: true });
  await captureCall(pages[0], 'desktop-light-connected.png');
  await captureCall(pages[1], 'mobile-dark-connected.png');
  // A failed upload must retain the real recording and allow a safe retry.
  await pages[0].route('**/native/upload?*', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic temporary upload outage.' }) }), { times: 1 });
  await pages[0].getByRole('button', { name: 'Stop and save recording', exact: true }).click();
  await expect(pages[0].getByRole('button', { name: 'Retry saving recording', exact: true })).toBeVisible();
  await expect(pages[0].getByRole('button', { name: 'Leave call', exact: true })).toBeDisabled();
  const downloaded = pages[0].waitForEvent('download');
  await pages[0].getByRole('button', { name: 'Download unsaved copy', exact: true }).click();
  await (await downloaded).saveAs(testInfo.outputPath('unsaved-call-recovery.webm'));
  await expect(pages[0].getByRole('button', { name: 'Leave with downloaded copy', exact: true })).toBeEnabled();
  await pages[0].getByRole('button', { name: 'Retry saving recording', exact: true }).click();
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
  for (const page of pages) {
    await page.getByRole('button', { name: 'Leave call', exact: true }).click();
    await expect(page.getByText('You left the call.', { exact: true })).toBeVisible();
    await expect(page.getByText('Recording is in progress. Both participants’ audio and video may be captured.')).toHaveCount(0);
  }
  await Promise.all(contexts.map(context => context.close()));
});
test.afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await mongoose.disconnect(); if (mongo) await mongo.stop();
});


for (const mobile of [false, true]) test(`manual assessment and visual call workflow persists through real APIs (${mobile ? 'mobile' : 'desktop'})`, async ({ page }, testInfo) => {
  if (mobile) { await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme: 'dark' }); }
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
    if (endpoint === '/user/context') response = { success: true, data: { user: activePrincipal, role: { name: 'line_manager', isManager: true, isHRAdmin: false }, organization, teams: principal.idpTeams, features: {}, stats: {} } };
    if (endpoint === '/user/current-team') response = { success: true, data: { currentTeam: principal.idpTeams[0], availableTeams: principal.idpTeams } };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) });
  });

  await page.goto('/appraisals/start');
  await page.getByRole('checkbox', { name: /Alex Team Leader/ }).check();
  await page.getByRole('combobox', { name: /Reviewer for Alex Team Leader/ }).click(); await page.getByRole('option', { name: /Taylor Member/ }).click();
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
  await expect(page.getByText('The one-on-one call is the next step.', { exact: true })).toBeVisible();
  await expect(page.getByText('The employee completes their self-assessment next.', { exact: true })).toHaveCount(0);
  const appraisal = await Appraisal.findOne();
  expect(appraisal.status).toBe('meeting_pending');
  expect(appraisal.cycleConfigurationSnapshot.appraisalFlow.assessmentMode).toBe('form');
  expect(appraisal.cycleConfigurationSnapshot.appraisalFlow.steps.map((step: { type: string }) => step.type)).toEqual(['oneOnOne', 'selfAssessment', 'managerReview', 'finalReview', 'acknowledgement']);
  await page.goto(`/appraisals/${appraisal._id}`);
  await expect(page.getByRole('heading', { name: 'Appraisal calls and notes' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Schedule a call', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Schedule a call', exact: true }).click();
  const form = page.getByRole('form', { name: 'Schedule an appraisal call' });
  const nativeOption = form.getByRole('radio', { name: /^In-app call/ });
  const calendarOption = form.getByRole('radio', { name: /^Calendar meeting/ });
  await expect(nativeOption).toBeChecked();
  const date = form.getByRole('textbox', { name: 'Call starts (your local time)', exact: true });
  await expect(nativeOption).toBeFocused();
  const choiceContrast = await form.locator('#appraisal-call-type').evaluate(label => {
    const luminance = (color: string) => { const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(channel => { const value = channel / 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; }); return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722; };
    const foreground = luminance(getComputedStyle(label).color);
    const background = luminance(getComputedStyle(label.closest('.MuiPaper-root')!).backgroundColor);
    return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
  });
  expect(choiceContrast).toBeGreaterThanOrEqual(4.5);
  await expect(form.getByText(/Time zone:/)).toBeVisible();
  await expect(form.getByRole('button', { name: 'Schedule in-app call', exact: true })).toBeDisabled();
  await page.route('**/meetings/connection', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic calendar outage' }) }));
  await nativeOption.focus();
  await page.keyboard.press('ArrowRight');
  await expect(calendarOption).toBeChecked();
  await expect(form.getByText(/We could not check your calendar/)).toBeVisible();
  await expect(form.getByRole('button', { name: 'Create calendar invitation', exact: true })).toBeDisabled();
  await calendarOption.press('ArrowLeft');
  await expect(nativeOption).toBeChecked();
  await expect(form.getByText(/We could not check your calendar/)).toHaveCount(0);
  await date.fill('2000-01-01T10:00');
  await form.getByRole('checkbox', { name: 'Record and transcribe this call', exact: true }).uncheck();
  await form.getByRole('button', { name: 'Schedule in-app call', exact: true }).click();
  expect(await date.evaluate((input: HTMLInputElement) => input.validity.rangeUnderflow)).toBe(true);
  expect(await backend('./models/OneOnOne').countDocuments({ appraisalId: appraisal._id })).toBe(0);
  await form.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Schedule a call', exact: true }).click();
  expect(await date.inputValue()).not.toBe('2000-01-01T10:00');
  expect(new Date(await date.inputValue()).getTime()).toBeGreaterThan(Date.now());
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('simple-call-scheduling.png'), fullPage: true });
  await form.getByRole('button', { name: 'Schedule in-app call', exact: true }).click();
  await expect(form).toHaveCount(0);
  const scheduled = await backend('./models/OneOnOne').findOne({ appraisalId: appraisal._id });
  expect(scheduled.appraisalMeeting.mode).toBe('in_app');
  expect(scheduled.appraisalMeeting.recordingRequested).toBe(false);
  await expect(page.getByText(/You can complete this step after the scheduled start time/)).toBeVisible();
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
