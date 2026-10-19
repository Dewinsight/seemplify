import { expect, test, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
test.use({ launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] } });
const backend = createRequire(path.resolve(process.cwd(), '../backend/package.json'));
const mongoose = backend('mongoose'), express = backend('express');
const { MongoMemoryServer } = backend('mongodb-memory-server');
const OneOnOne = backend('./models/OneOnOne'), User = backend('./models/User');
const shared = backend('./services/sharedAIAccountService'), ai = backend('./services/aiGatewayService');
let mongo: { stop: () => Promise<void> }, server: import('node:http').Server, apiURL: string;
let connected = true, calendarFailure = false;
const requests: Array<{ operation: string; input: { externalId?: string } }> = [];
const originalRequest = shared.request, originalCompletions = ai.getChatCompletions;
const organization = { id: 'standalone-browser-org', name: 'Local call QA', role: 'staff', appAccess: { mode: 'all', appIds: [] } };
function actor(name: string) { return { id: name, sub: name, email: `${name}@example.test`, name: name === 'manager' ? 'Morgan Manager' : 'Emery Employee', organizations: [organization], currentOrganization: organization,
  idpTeams: [{ id: 'team', name: 'Product', organizationId: organization.id, role: name === 'manager' ? 'line_manager' : 'member', directReports: name === 'manager' ? ['employee'] : [] }] }; }
test.beforeAll(async () => {
  mongo = await MongoMemoryServer.create(); await mongoose.connect((mongo as unknown as { getUri: () => string }).getUri()); await OneOnOne.createIndexes();
  for (const name of ['manager', 'employee']) await User.create({ idpSub: name, email: `${name}@example.test`, profile: { displayName: actor(name).name }, currentOrganizationId: organization.id, idpTeams: actor(name).idpTeams });
  shared.request = async (operation: string, _identity: unknown, input: { externalId?: string } = {}) => {
    requests.push({ operation, input });
    if (operation === 'meetings/connection') return { connected, email: 'manager@example.test', connectUrl: 'http://localhost:4000/' };
    if (operation === 'meetings/create') { if (calendarFailure) throw Object.assign(new Error('Synthetic calendar outage. Retry this saved meeting.'), { statusCode: 503 }); return { eventId: 'event-one', calendarId: 'calendar-one', conferenceUrl: 'https://meet.google.com/fixture-call', state: 'scheduled', recordingState: 'awaiting_consent' }; }
    if (operation === 'meetings/startRecording') return { recordingState: 'scheduled' };
    if (operation === 'meetings/stopRecording') return { recordingState: 'revoked' };
    if (operation === 'meetings/transcribe') return { transcript: 'Synthetic transcript fixture: Emery will document the release.', provider: 'test-fixture', model: 'test-fixture' };
    return { state: 'cancelled' };
  };
  ai.getChatCompletions = async () => ({ model: 'test-fixture-terra', choices: [{ message: { content: 'Synthetic notes fixture: Emery will document the release.' } }] });
  const app = express(); app.use(express.json());
  app.use((req: { session: unknown; get: (name: string) => string }, _res: unknown, next: () => void) => { req.session = { user: actor(req.get('x-call-actor') || 'manager'), currentOrganizationId: organization.id }; next(); });
  app.use('/api/one-on-ones', backend('./routes/oneOnOnes'));
  server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  apiURL = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
});
test.beforeEach(async () => { connected = true; calendarFailure = false; requests.length = 0; await OneOnOne.deleteMany({}); });
test.afterAll(async () => {
  shared.request = originalRequest; ai.getChatCompletions = originalCompletions;
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await mongoose.disconnect(); if (mongo) await mongo.stop();
});
async function setup(page: Page, who: string) {
  const user = actor(who);
  await page.addInitScript(() => localStorage.setItem('accessToken', 'isolated-standalone-call-qa'));
  await page.route('**/__mock-api/**', async route => {
    const url = new URL(route.request().url()); const endpoint = url.pathname.slice('/__mock-api'.length);
    if (endpoint.startsWith('/one-on-ones')) { const response = await route.fetch({ url: `${apiURL}/api${endpoint}${url.search}`, headers: { ...route.request().headers(), 'x-call-actor': who } }); await route.fulfill({ response }); return; }
    let response: unknown = { success: true, data: [] };
    if (endpoint === '/auth/me') response = { success: true, user, currentOrganization: organization, currentOrganizationId: organization.id };
    if (endpoint === '/user/context') response = { success: true, data: { user, organization, role: { name: who === 'manager' ? 'line_manager' : 'employee', isManager: who === 'manager', isHRAdmin: false }, teams: user.idpTeams, features: {}, stats: {} } };
    if (endpoint === '/user/my-team-members') response = { success: true, data: { isManager: who === 'manager', directReports: [{ userId: 'employee', id: 'employee', name: 'Emery Employee' }], teams: user.idpTeams } };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) });
  });
}

test('calendar connection, failed invitation retry and cancelled-call history use the real API', async ({ page, browser }, testInfo) => {
  test.setTimeout(90000);
  await setup(page, 'manager'); await page.goto('/one-on-ones');
  await page.getByRole('button', { name: 'Schedule 1:1', exact: true }).click();
  await page.getByRole('combobox', { name: 'Team member', exact: true }).click(); await page.getByRole('option', { name: 'Emery Employee' }).click();
  connected = false; await page.getByRole('radio', { name: /^Calendar meeting/ }).check();
  await expect(page.getByRole('button', { name: 'Create calendar invitation' })).toBeDisabled();
  await expect(page.getByText('Connect your calendar, then return here and check again.')).toBeVisible();
  connected = true; await page.getByRole('button', { name: 'Check again', exact: true }).click();
  await expect(page.getByText('Invitation will be sent from: manager@example.test')).toBeVisible();
  await page.getByRole('checkbox', { name: /I will tell the other participant to review recording permissions/ }).check();
  calendarFailure = true; await page.getByRole('button', { name: 'Create calendar invitation' }).click();
  await page.getByRole('link', { name: 'Open saved meeting to retry' }).click();
  await expect(page.getByText('Invitation needs attention', { exact: true })).toBeVisible();
  calendarFailure = false; await page.getByRole('button', { name: 'Retry calendar invitation' }).click();
  await expect(page.getByRole('link', { name: 'Join call', exact: true })).toHaveAttribute('href', 'https://meet.google.com/fixture-call');
  expect(await OneOnOne.countDocuments()).toBe(1);
  expect(new Set(requests.filter(item => item.operation === 'meetings/create').map(item => item.input.externalId)).size).toBe(1);
  expect(requests.find(item => item.operation === 'meetings/create')?.input).toMatchObject({ record: false, recordingPolicyVersion: 'calendar-recording-v1' });
  expect(requests.filter(item => item.operation === 'meetings/startRecording')).toHaveLength(0);
  await page.getByRole('checkbox', { name: 'I agree to this call being recorded', exact: true }).check();
  await page.getByRole('checkbox', { name: 'I agree to transcription of this call', exact: true }).check();
  await page.getByRole('button', { name: 'Save my recording permission', exact: true }).click();
  await expect(page.getByText('Reviewer: Agreed', { exact: true })).toBeVisible();
  expect(requests.filter(item => item.operation === 'meetings/startRecording')).toHaveLength(0);
  const employeeContext = await browser.newContext();
  try {
    const employee = await employeeContext.newPage(); await setup(employee, 'employee');
    await employee.goto(page.url());
    await employee.getByRole('checkbox', { name: 'I agree to this call being recorded', exact: true }).check();
    await employee.getByRole('checkbox', { name: 'I agree to transcription of this call', exact: true }).check();
    await employee.getByRole('button', { name: 'Save my recording permission', exact: true }).click();
    await expect(employee.getByText('Both participants agreed. The notetaker is scheduled.', { exact: true })).toBeVisible();
    expect(requests.filter(item => item.operation === 'meetings/startRecording')).toHaveLength(1);
  } finally { await employeeContext.close(); }
  await page.screenshot({ path: testInfo.outputPath('calendar-call-ready.png'), fullPage: true });
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Cancel meeting', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Join call', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Back to 1:1 meetings' }).click();
  await expect(page.getByRole('tab', { name: /Past calls & history/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('link', { name: 'View call, transcript & notes' })).toBeVisible();
});

test('standalone native peers record real browser media, play it, process notes and revisit history on mobile', async ({ browser }, testInfo) => {
  test.setTimeout(150000);
  // This is a real browser recording/codec test. Only STT and AI are fixtures;
  // the same ffmpeg executable used by the product must be installed on CI.
  try {
    const version = execFileSync('ffmpeg', ['-version'], { timeout: 10000, encoding: 'utf8', maxBuffer: 65536 }).split(/\r?\n/)[0];
    expect(version).toMatch(/^ffmpeg version /); console.info(`[native-media preflight] ${version}`);
  } catch { throw new Error('Native media acceptance requires ffmpeg on PATH. Install the product media dependency before running browser tests.'); }
  const contexts = await Promise.all([browser.newContext({ viewport: { width: 1440, height: 1100 } }), browser.newContext({ viewport: { width: 390, height: 844 } })]);
  try {
    const pages = await Promise.all(contexts.map(context => context.newPage()));
    await setup(pages[0], 'manager'); await pages[0].goto('/one-on-ones');
    await pages[0].getByRole('button', { name: 'Schedule 1:1', exact: true }).click();
    await pages[0].getByRole('combobox', { name: 'Team member', exact: true }).click(); await pages[0].getByRole('option', { name: 'Emery Employee' }).click();
    await expect(pages[0].getByRole('button', { name: 'Schedule in-app call', exact: true })).toBeDisabled();
    await pages[0].getByRole('checkbox', { name: /I will ask both participants/ }).check();
    const scheduled = pages[0].waitForResponse(response => new URL(response.url()).pathname.endsWith('/one-on-ones') && response.request().method() === 'POST');
    await pages[0].getByRole('button', { name: 'Schedule in-app call', exact: true }).click();
    expect((await scheduled).status()).toBe(201);
    await expect(pages[0]).toHaveURL(/\/one-on-ones\/[a-f0-9]{24}$/, { timeout: 20000 });
    const id = String((await OneOnOne.findOne())._id);
    for (const [index, page] of pages.entries()) {
      await setup(page, index ? 'employee' : 'manager'); await page.goto(`/one-on-ones/${id}`);
      await page.getByRole('checkbox', { name: /I agree to this call being recorded/ }).check();
      await page.getByRole('button', { name: 'Join in-app call', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Leave call', exact: true })).toBeVisible({ timeout: 20000 });
    }
    for (const page of pages) {
      await expect.poll(() => page.getByLabel('Other participant', { exact: true }).evaluate((video: HTMLVideoElement) => video.readyState), { timeout: 35000 }).toBeGreaterThanOrEqual(2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await pages[0].getByRole('button', { name: 'Start agreed recording', exact: true }).click();
    await expect(pages[1].getByText('Recording is in progress. Both participants’ audio and video may be captured.')).toBeVisible({ timeout: 10000 });
    await expect.poll(() => pages[0].getByLabel('Other participant', { exact: true }).evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(4);
    await pages[1].screenshot({ path: testInfo.outputPath('mobile-native-call.png'), fullPage: true });
    await pages[0].getByRole('button', { name: 'Stop and save recording', exact: true }).click();
    await expect(pages[0].getByText(/Recording saved. Transcription/)).toBeVisible({ timeout: 20000 });
    await pages[0].getByRole('button', { name: 'Play saved recording', exact: true }).click();
    const playback = pages[0].getByLabel('Saved call recording', { exact: true });
    await playback.evaluate((video: HTMLVideoElement) => video.play());
    await expect.poll(() => playback.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0);
    const saved = await OneOnOne.findById(id);
    const file = await mongoose.connection.db.collection('appraisalRecordings.files').findOne({ _id: new mongoose.Types.ObjectId(saved.appraisalMeeting.recordingFileId) }); expect(file.length).toBeGreaterThan(1000);
    await backend('./services/appraisalNativeMediaService').process(saved);
    for (const page of pages) { await page.getByRole('button', { name: 'Leave call', exact: true }).click(); await expect(page.getByText('You left the call.', { exact: true })).toBeVisible(); }
    await OneOnOne.updateOne({ _id: id }, { $set: { scheduledDate: new Date(Date.now() - 60000) } });
    await pages[0].reload();
    await expect(pages[0].getByText('Synthetic notes fixture: Emery will document the release.')).toBeVisible();
    await pages[0].getByRole('textbox', { name: 'Agreed meeting notes' }).fill('Agreed: document the release.');
    await pages[0].getByRole('button', { name: 'Complete meeting', exact: true }).click();
    await expect.poll(async () => (await OneOnOne.findById(id)).status).toBe('completed');
    await pages[1].goto('/one-on-ones?tab=history');
    await pages[1].getByRole('link', { name: 'View call, transcript & notes' }).click();
    await expect(pages[1].getByRole('button', { name: 'Join in-app call', exact: true })).toHaveCount(0);
    await expect(pages[1].getByRole('button', { name: 'Play saved recording', exact: true })).toBeVisible();
    await pages[1].getByRole('button', { name: 'Transcript', exact: true }).click();
    await expect(pages[1].getByText('Synthetic transcript fixture: Emery will document the release.')).toBeVisible();
    await pages[1].screenshot({ path: testInfo.outputPath('past-call-transcript-notes.png'), fullPage: true });
  } finally { await Promise.all(contexts.map(context => context.close())); }
});
