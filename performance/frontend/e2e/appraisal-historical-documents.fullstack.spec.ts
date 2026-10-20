import { expect, test as baseTest } from '@playwright/test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

// Real routes/Mongo/SDK signing; only IdP context and external provider transport
// are synthetic. A dedicated worker keeps the captured storage resolver isolated.
const test = baseTest.extend<Record<never, never>, { historyStorageWorker: void }>({
  historyStorageWorker: [async ({ browserName }, use) => { void browserName; await use(); }, { scope: 'worker', auto: true }],
});
const backend = createRequire(path.resolve(process.cwd(), '../backend/package.json'));
const mongoose = backend('mongoose'), express = backend('express');
const { MongoMemoryServer } = backend('mongodb-memory-server');
const Appraisal = backend('./models/Appraisal'), Cycle = backend('./models/AppraisalCycle'), Document = backend('./models/AppraisalDocument');
const platform = backend('./services/platformConfigurationClient'), cloudinary = backend('cloudinary').v2;
const originalConfiguration = platform.resolveStoragePlatformConfiguration, originalSign = cloudinary.utils.private_download_url;
let mongo: { stop: () => Promise<void> }, server: import('node:http').Server, apiURL: string, signed = 0;
const organization = { id: 'historical-evidence-qa', name: 'Synthetic history QA', role: 'staff', appAccess: { mode: 'all', appIds: [] } };
const employee = { id: 'history-employee', sub: 'history-employee', name: 'Synthetic Employee', email: 'history-employee@example.test', organizations: [organization], currentOrganization: organization };
const actors: Record<string, typeof employee & { idpTeams?: object[] }> = {
  employee,
  reviewer: { ...employee, id: 'history-reviewer', sub: 'history-reviewer', name: 'Synthetic Reviewer', email: 'reviewer@example.test',
    idpTeams: [{ id: 'history-team', organizationId: organization.id, role: 'line_manager', directReports: [employee.id] }] },
  hr: { ...employee, id: 'history-hr', sub: 'history-hr', email: 'hr@example.test', organizations: [{ ...organization, role: 'hr_manager' }], currentOrganization: { ...organization, role: 'hr_manager' } },
  outsider: { ...employee, id: 'history-outsider', sub: 'history-outsider', email: 'outsider@example.test' },
  foreign: { ...employee, id: 'history-foreign', sub: 'history-foreign', email: 'foreign@example.test', organizations: [{ ...organization, id: 'foreign-history-qa', role: 'owner' }], currentOrganization: { ...organization, id: 'foreign-history-qa', role: 'owner' } },
};

test.beforeAll(async () => {
  platform.resolveStoragePlatformConfiguration = async () => ({ configured: true, defaultProvider: 'cloudinary', providers: { cloudinary: {
    configured: true, cloudName: 'synthetic-history-cloud', apiKey: 'synthetic-key', apiSecret: 'synthetic-secret'
  } } });
  cloudinary.utils.private_download_url = (...args: unknown[]) => { signed++; return originalSign(...args); };
  mongo = await MongoMemoryServer.create(); await mongoose.connect((mongo as unknown as { getUri: () => string }).getUri());
  const app = express(); app.use(express.json());
  app.use((req: { session: unknown; get: (key: string) => string }, _res: unknown, next: () => void) => {
    const user = actors[req.get('x-history-actor') || 'employee'];
    req.session = { user, currentOrganizationId: user.currentOrganization.id }; next();
  });
  app.use('/api/appraisals', backend('./routes/appraisals'));
  server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  apiURL = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
});
test.afterAll(async () => {
  platform.resolveStoragePlatformConfiguration = originalConfiguration; cloudinary.utils.private_download_url = originalSign;
  if (server) await new Promise<void>(resolve => server.close(() => resolve())); await mongoose.disconnect(); if (mongo) await mongo.stop();
});

test('acknowledged report retains authorized historical downloads, safe CSV and immutable results', async ({ page, context, request }, info) => {
  const cycle = await Cycle.create({ organizationId: organization.id, name: 'Synthetic acknowledged history', status: 'active',
    periodStart: '2026-01-01', periodEnd: '2026-10-19', createdBy: { userId: actors.reviewer.id } });
  const appraisal = await Appraisal.create({ organizationId: organization.id, cycleId: cycle._id,
    employee: { userId: employee.id, name: employee.name, email: employee.email },
    manager: { userId: actors.reviewer.id, name: actors.reviewer.name, email: 'reviewer@example.test' },
    status: 'employee_acknowledged', finalRating: { overall: 3, finalizedAt: new Date('2026-10-20T09:15:00Z'), justification: 'Human calibrated outcome.' },
    discussion: { employeeAcknowledgedAt: new Date('2026-10-20T09:16:00Z') } });
  const bytes = Buffer.from('Synthetic historical evidence. No real employee data.\n');
  const documents: Record<string, { _id: string; storageKey: string }> = {};
  for (const [key, visibility, status] of [['shared', 'employee_manager', 'active'], ['employee', 'employee_only', 'active'], ['hr', 'hr_only', 'active'], ['deleted', 'employee_manager', 'deleted']]) {
    documents[key] = await Document.create({ appraisalId: appraisal._id, organizationId: organization.id,
      fileName: `${key}-history.txt`, originalName: `${key}-history.txt`, fileType: 'txt', fileSize: bytes.length, category: 'achievement_evidence',
      status, visibility, storageProvider: 'cloudinary', storageKey: `appraisals/${appraisal._id}/${key}-history.txt`,
      storageResourceType: 'raw', storageDeliveryType: 'authenticated', storageFormat: 'txt', uploadedBy: { userId: employee.id, role: 'employee' },
      textExtraction: { status: 'completed', extractedText: 'Private extraction must not leak in reports.' }, aiAnalysis: { status: 'skipped' } });
  }
  appraisal.documents = Object.values(documents).map(document => document._id); await appraisal.save();
  const originalParent = JSON.stringify(await Appraisal.findById(appraisal._id));
  for (const [actor, visible] of [['employee', ['employee-history.txt', 'shared-history.txt']], ['reviewer', ['shared-history.txt']], ['hr', ['hr-history.txt', 'shared-history.txt']]] as const) {
    const response = await request.get(`${apiURL}/api/appraisals/${appraisal._id}/report`, { headers: { 'x-history-actor': actor } });
    expect(response.status()).toBe(200); const result = (await response.json()).data;
    expect(result.documents.map((document: { originalName: string }) => document.originalName).sort()).toEqual([...visible].sort());
    for (const document of result.documents) expect(Object.keys(document).every(key => ['_id', 'originalName', 'fileType', 'fileSize', 'category', 'status'].includes(key))).toBe(true);
    expect(JSON.stringify(result.documents)).not.toMatch(/storageKey|textExtraction|aiAnalysis|https:/);
  }
  for (const [actor, key, expected] of [['reviewer', 'employee', 403], ['employee', 'hr', 403], ['hr', 'employee', 403], ['outsider', 'shared', 403], ['foreign', 'shared', 404]] as const) {
    expect((await request.get(`${apiURL}/api/appraisals/${appraisal._id}/documents/${documents[key]._id}/content`, { headers: { 'x-history-actor': actor }, maxRedirects: 0 })).status()).toBe(expected);
  }
  for (const [actor, expected] of [['outsider', 403], ['foreign', 404]] as const) expect((await request.get(`${apiURL}/api/appraisals/${appraisal._id}/report`, { headers: { 'x-history-actor': actor } })).status()).toBe(expected);
  expect(signed).toBe(0);
  expect((await request.delete(`${apiURL}/api/appraisals/${appraisal._id}/documents/${documents.shared._id}`, { headers: { 'x-history-actor': 'employee' } })).status()).toBe(409);
  let actor = 'employee', failMetadata = true;
  const productMethods: string[] = [];
  await page.addInitScript(() => localStorage.setItem('accessToken', 'synthetic-history-only'));
  await context.route('**/__mock-api/**', async route => {
    const url = new URL(route.request().url()), endpoint = url.pathname.slice('/__mock-api'.length);
    if (endpoint.startsWith('/appraisals/')) {
      productMethods.push(route.request().method());
      if (endpoint === `/appraisals/${appraisal._id}/documents/${documents.shared._id}` && failMetadata) {
        failMetadata = false; return route.fulfill({ status: 503, json: { error: 'Synthetic metadata outage. Try again.' } });
      }
      const response = await route.fetch({ url: `${apiURL}/api${endpoint}${url.search}`, headers: { ...route.request().headers(), 'x-history-actor': actor }, maxRedirects: 0 });
      if (endpoint.endsWith('/content') && response.status() === 302) {
        const location = new URL(response.headers().location);
        expect(location.searchParams.get('type')).toBe('authenticated'); expect(location.searchParams.get('public_id')).toBe(documents.shared.storageKey);
        expect(location.searchParams.get('signature')).toMatch(/^[a-f0-9]+$/);
        const expiry = Number(location.searchParams.get('expires_at')) - Math.floor(Date.now() / 1000);
        expect(expiry).toBeGreaterThan(0); expect(expiry).toBeLessThanOrEqual(300);
        return route.fulfill({ status: 200, headers: { 'content-type': 'text/plain', 'content-disposition': 'attachment; filename="shared-history.txt"' }, body: bytes });
      }
      return route.fulfill({ response });
    }
    const user = actors[actor]; let data: unknown = { success: true, data: [] };
    if (endpoint === '/auth/me') data = { success: true, user, currentOrganization: user.currentOrganization, currentOrganizationId: user.currentOrganization.id };
    if (endpoint === '/user/context') data = { success: true, data: { user, organization: user.currentOrganization, role: { name: actor === 'reviewer' ? 'manager' : 'employee', isManager: actor === 'reviewer', isHRAdmin: false }, teams: [], features: {}, stats: {} } };
    if (endpoint === '/competency/bootstrap') data = { success: true, data: { enabled: false } };
    return route.fulfill({ json: data });
  });
  await page.goto(`/appraisals/${appraisal._id}/report`);
  const shared = page.getByRole('group', { name: 'shared-history.txt', exact: true });
  await expect(shared).toBeVisible(); await expect(page.getByRole('group', { name: 'employee-history.txt', exact: true })).toBeVisible();
  await expect(page.getByText('hr-history.txt', { exact: true })).toHaveCount(0); await expect(page.getByText('deleted-history.txt', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Choose document|Upload document|Remove document/ })).toHaveCount(0);
  await shared.getByRole('button', { name: 'Download document', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Synthetic metadata outage' })).toBeVisible(); expect(signed).toBe(0);
  const downloadEvent = page.waitForEvent('download'); await shared.getByRole('button', { name: 'Download document', exact: true }).click();
  const download = await downloadEvent; expect(await readFile((await download.path())!)).toEqual(bytes); expect(signed).toBe(1);
  const csvEvent = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download CSV', exact: true }).click();
  const csv = (await readFile((await (await csvEvent).path())!)).toString('utf8');
  expect(csv).toContain('"Acknowledgement","Recorded"'); expect(csv).toContain('"Acknowledged at","Oct 20, 2026"');
  expect(csv).toContain('shared-history.txt'); expect(csv).toContain('employee-history.txt'); expect(csv).not.toMatch(/hr-history|deleted-history|https:/);
  await page.reload(); await expect(shared).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: info.outputPath('historical-documents-mobile.png'), fullPage: true });
  actor = 'reviewer'; await page.reload(); await expect(shared).toBeVisible(); await expect(page.getByText('employee-history.txt', { exact: true })).toHaveCount(0);
  expect(productMethods.every(method => method === 'GET')).toBe(true);
  expect(JSON.stringify(await Appraisal.findById(appraisal._id))).toBe(originalParent); expect(await Document.countDocuments()).toBe(4);
});
