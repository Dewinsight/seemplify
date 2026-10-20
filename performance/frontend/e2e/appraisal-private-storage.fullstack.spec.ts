import { expect, test as baseTest } from '@playwright/test';
import { createRequire } from 'node:module';
import { Writable } from 'node:stream';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

// The backend route captures its storage resolver when first required. Keep
// these provider substitutes in a dedicated worker rather than inheriting a
// route loaded by another fullstack file in the shared worker's module cache.
const test = baseTest.extend<Record<never, never>, { privateStorageWorker: void }>({
  privateStorageWorker: [async ({ browserName }, use) => {
    void browserName;
    await use();
  }, { scope: 'worker', auto: true }],
});

// Real UI, FormData, appraisal routes/authorization, Mongo and SDK signing.
// Cloudinary transport and shared-AI account/incorporation are named substitutes.
// Actual provider privacy/expiry acceptance is a separate release probe.
const backend = createRequire(path.resolve(process.cwd(), '../backend/package.json'));
const mongoose = backend('mongoose'), express = backend('express');
const { MongoMemoryServer } = backend('mongodb-memory-server');
const Appraisal = backend('./models/Appraisal'), Cycle = backend('./models/AppraisalCycle'), Document = backend('./models/AppraisalDocument');
const platform = backend('./services/platformConfigurationClient'), cloudinary = backend('cloudinary').v2;
const gateway = backend('./services/aiGatewayService'), account = backend('./services/chatGptAccountService'), ai = backend('./services/appraisalAIService');
const originals = { configuration: platform.resolveStoragePlatformConfiguration, upload: cloudinary.uploader.upload_stream,
  remove: cloudinary.uploader.destroy, sign: cloudinary.utils.private_download_url, policy: gateway.policy,
  account: account.readAccount, incorporate: ai.incorporateDocumentIntoConversation };
let mongo: { stop: () => Promise<void> }, server: import('node:http').Server, apiURL: string;
let failUpload = true, signed = 0;
const uploaded: { options: Record<string, string>; bytes: Buffer }[] = [];
const organization = { id: 'private-attachment-browser', name: 'Synthetic attachment QA', role: 'staff', appAccess: { mode: 'all', appIds: [] } };
const user = { id: 'employee', sub: 'employee', name: 'Synthetic Employee', email: 'employee@example.test', organizations: [organization], currentOrganization: organization };

test.beforeAll(async () => {
  platform.resolveStoragePlatformConfiguration = async () => ({ configured: true, defaultProvider: 'cloudinary', providers: { cloudinary: {
    configured: true, cloudName: 'synthetic-browser-cloud', apiKey: 'synthetic-key', apiSecret: 'synthetic-secret'
  } } });
  cloudinary.uploader.upload_stream = (options: Record<string, string>, callback: (error: Error | null, result?: object) => void) => {
    const parts: Buffer[] = [];
    return new Writable({ write(chunk, _encoding, done) { parts.push(chunk); done(); }, final(done) {
      if (failUpload) callback(new Error('Explicit synthetic Cloudinary transport failure'));
      else { const bytes = Buffer.concat(parts); uploaded.push({ options, bytes }); callback(null, {
        public_id: options.public_id, resource_type: 'raw', type: 'authenticated', bytes: bytes.length,
        secure_url: 'https://res.cloudinary.com/synthetic/raw/authenticated/s--not-persisted--/file.txt'
      }); } done();
    } });
  };
  cloudinary.uploader.destroy = async () => ({ result: 'ok' });
  cloudinary.utils.private_download_url = (...args: unknown[]) => { signed++; return originals.sign(...args); };
  gateway.policy = async () => ({ chatgptEnabled: true });
  account.readAccount = async () => ({ isRoutable: () => true });
  ai.incorporateDocumentIntoConversation = async () => ({ message: 'Synthetic attachment received for human review.', insights: {} });
  mongo = await MongoMemoryServer.create(); await mongoose.connect((mongo as unknown as { getUri: () => string }).getUri());
  const app = express(); app.use(express.json());
  app.use((req: { session: unknown; get: (key: string) => string }, _res: unknown, next: () => void) => {
    const who = req.get('x-attachment-actor') || 'employee';
    req.session = { user: who === 'outsider' ? { ...user, id: 'outsider', sub: 'outsider', email: 'outsider@example.test' } : user, currentOrganizationId: organization.id }; next();
  });
  app.use('/api/appraisals', backend('./routes/appraisals'));
  server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  apiURL = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
});
test.afterAll(async () => {
  platform.resolveStoragePlatformConfiguration = originals.configuration; cloudinary.uploader.upload_stream = originals.upload;
  cloudinary.uploader.destroy = originals.remove; cloudinary.utils.private_download_url = originals.sign;
  gateway.policy = originals.policy; account.readAccount = originals.account; ai.incorporateDocumentIntoConversation = originals.incorporate;
  if (server) await new Promise<void>(resolve => server.close(() => resolve())); await mongoose.disconnect(); if (mongo) await mongo.stop();
});

test('private attachment recovers upload failure, persists through reload and downloads only after authorization', async ({ page, request }, info) => {
  const cycle = await Cycle.create({ organizationId: organization.id, name: 'Synthetic private attachment review', status: 'active',
    periodStart: '2026-01-01', periodEnd: '2026-12-31', createdBy: { userId: 'reviewer' }, settings: { enableAiAssist: true, requireOkrAlignment: false } });
  const appraisal = await Appraisal.create({ organizationId: organization.id, cycleId: cycle._id,
    employee: { userId: user.id, name: user.name, email: user.email }, manager: { userId: 'reviewer', name: 'Synthetic Reviewer', email: 'reviewer@example.test' },
    status: 'self_assessment_in_progress', conversationAssessment: { mode: 'conversation', currentPhase: 'achievements', startedAt: new Date() },
    chatThread: [{ sender: { userId: 'ai', name: 'Synthetic Assistant', role: 'ai' }, message: 'Describe your synthetic work evidence.', messageType: 'text', createdAt: new Date() }] });
  await page.addInitScript(() => localStorage.setItem('accessToken', 'synthetic-private-attachment-browser'));
  const uploads: { contentType: string; response: Record<string, unknown> }[] = [];
  let delivered = false, expectedKey = '';
  await page.route('**/__mock-api/**', async route => {
    const url = new URL(route.request().url()), endpoint = url.pathname.slice('/__mock-api'.length);
    if (endpoint.startsWith('/appraisals/')) {
      const response = await route.fetch({ url: `${apiURL}/api${endpoint}${url.search}`, maxRedirects: 0 });
      if (endpoint.endsWith('/conversation/upload')) uploads.push({ contentType: route.request().headers()['content-type'], response: await response.json() });
      if (endpoint.endsWith('/content') && response.status() === 302) {
        // Replace provider download transport at the redirect boundary. Browser
        // routing need not follow an external synthetic redirect to validate
        // real authorization, actual SDK signing and attachment byte delivery.
        const signedUrl = new URL(response.headers().location);
        expect(signedUrl.pathname).toBe('/v1_1/synthetic-browser-cloud/raw/download');
        expect(signedUrl.searchParams.get('type')).toBe('authenticated');
        expect(signedUrl.searchParams.get('public_id')).toBe(expectedKey);
        expect(signedUrl.searchParams.get('signature')).toMatch(/^[a-f0-9]+$/);
        const remaining = Number(signedUrl.searchParams.get('expires_at')) - Math.floor(Date.now() / 1000);
        expect(remaining).toBeGreaterThan(0); expect(remaining).toBeLessThanOrEqual(300);
        delivered = true;
        await route.fulfill({ status: 200, headers: { 'content-type': 'text/plain',
          'content-disposition': 'attachment; filename="synthetic-private-evidence.txt"' }, body: uploaded[0].bytes }); return;
      }
      await route.fulfill({ response }); return;
    }
    let response: unknown = { success: true, data: [] };
    if (endpoint === '/auth/me') response = { success: true, user, currentOrganization: organization, currentOrganizationId: organization.id };
    if (endpoint === '/user/context') response = { success: true, data: { user, organization, role: { name: 'employee', isManager: false, isHRAdmin: false }, teams: [], features: {}, stats: {} } };
    if (endpoint === '/ai-account') response = { success: true, data: { account: { status: 'connected', routable: true, lastError: null }, policy: { chatgptEnabled: true } } };
    await route.fulfill({ json: response });
  });
  await page.goto(`/appraisals/${appraisal._id}/self-assessment`);
  await expect(page.getByRole('button', { name: 'Attach a document to this self-assessment', exact: true })).toBeVisible();
  const draft = page.getByRole('textbox').last();
  const typed = 'My synthetic evidence explanation remains available when upload fails.';
  await draft.fill(typed);
  const file = { name: 'synthetic-private-evidence.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic attachment bytes. No real employee data.\n') };
  await page.locator('input[type="file"]').setInputFiles(file);
  await expect(page.getByRole('alert').filter({ hasText: 'Failed to upload document' }).first()).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Attach a document to this self-assessment', exact: true })).toBeEnabled();
  await expect(draft).toHaveValue(typed); expect(await Document.countDocuments()).toBe(0); expect(uploaded).toHaveLength(0);
  await expect(page.getByText(/uploaded and analyzed/)).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('private-attachment-failed.png'), fullPage: true });
  failUpload = false;
  await page.locator('input[type="file"]').setInputFiles(file);
  await expect(page.getByText(`Document "${file.name}" uploaded and analyzed`, { exact: true })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Failed to upload document' })).toHaveCount(0);
  await expect(page.getByText(`Document uploaded: ${file.name}`, { exact: true })).toBeVisible();
  expect(uploads).toHaveLength(2); expect(uploads.every(upload => /multipart\/form-data; boundary=/.test(upload.contentType))).toBe(true);
  expect(uploaded).toHaveLength(1); expect(uploaded[0].bytes).toEqual(file.buffer);
  expect(uploaded[0].options.type).toBe('authenticated'); expect(uploaded[0].options.resource_type).toBe('raw');
  const source = await Document.findOne({ appraisalId: appraisal._id });
  expect(source.storageDeliveryType).toBe('authenticated'); expect(source.storageUrl).toBeUndefined();
  expect(JSON.stringify(uploads[1].response)).not.toContain(source.storageKey);
  await page.reload(); await expect(page.getByText(`Document uploaded: ${file.name}`, { exact: true })).toBeVisible();
  expect((await Appraisal.findById(appraisal._id)).documents.map(String)).toContain(String(source._id));
  expect(signed).toBe(0);
  await request.get(`${apiURL}/api/appraisals/${appraisal._id}/documents/${source._id}/content`, { headers: { 'x-attachment-actor': 'outsider' }, maxRedirects: 0 }).then(response => expect(response.status()).toBe(403));
  expect(signed).toBe(0);
  expectedKey = source.storageKey;
  // The product currently exposes attachment upload in chat; exercise its
  // authorized content endpoint as a browser download without inventing a UI.
  const downloadEvent = page.waitForEvent('download');
  await page.evaluate(url => { const link = document.createElement('a'); link.href = url; document.body.appendChild(link); link.click(); link.remove(); },
    `/__mock-api/appraisals/${appraisal._id}/documents/${source._id}/content`);
  const download = await downloadEvent; const downloadedPath = await download.path(); expect(downloadedPath).not.toBeNull();
  expect(await readFile(downloadedPath!)).toEqual(file.buffer); expect(delivered).toBe(true); expect(signed).toBe(1);
  await page.screenshot({ path: info.outputPath('private-attachment-reloaded.png'), fullPage: true });
});
