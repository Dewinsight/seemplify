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
let failUpload = true, failDelete = false, signed = 0;
const uploaded: { options: Record<string, string>; bytes: Buffer }[] = [];
const organization = { id: 'private-attachment-browser', name: 'Synthetic attachment QA', role: 'staff', appAccess: { mode: 'all', appIds: [] } };
const user = { id: 'employee', sub: 'employee', name: 'Synthetic Employee', email: 'employee@example.test', organizations: [organization], currentOrganization: organization };
const reviewer = { ...user, id: 'reviewer', sub: 'reviewer', name: 'Synthetic Reviewer', email: 'reviewer@example.test',
  idpTeams: [{ id: 'attachment-team', organizationId: organization.id, role: 'line_manager', directReports: ['employee'] }] };

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
  cloudinary.uploader.destroy = async () => { if (failDelete) throw new Error('Explicit synthetic Cloudinary delete failure'); return { result: 'ok' }; };
  cloudinary.utils.private_download_url = (...args: unknown[]) => { signed++; return originals.sign(...args); };
  gateway.policy = async () => ({ chatgptEnabled: true });
  account.readAccount = async () => ({ isRoutable: () => true });
  ai.incorporateDocumentIntoConversation = async () => ({ message: 'Synthetic attachment received for human review.', insights: {} });
  mongo = await MongoMemoryServer.create(); await mongoose.connect((mongo as unknown as { getUri: () => string }).getUri());
  const app = express(); app.use(express.json());
  app.use((req: { session: unknown; get: (key: string) => string }, _res: unknown, next: () => void) => {
    const who = req.get('x-attachment-actor') || 'employee';
    req.session = { user: who === 'reviewer' ? reviewer : who === 'outsider' ? { ...user, id: 'outsider', sub: 'outsider', email: 'outsider@example.test' } : user, currentOrganizationId: organization.id }; next();
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

test('manual required-evidence assessment uploads retries downloads and removes a private document without ChatGPT', async ({ page, request }, info) => {
  failUpload = true; uploaded.length = 0; signed = 0;
  const design = { version: 1, sections: [{ id: 'delivery-proof', title: 'Delivery proof', type: 'custom', respondent: 'employee',
    required: true, evidenceRequired: true, questions: [{ id: 'impact', prompt: 'Describe the documented delivery.', responseType: 'long_text', required: true }] }] };
  const cycle = await Cycle.create({ organizationId: organization.id, name: 'Synthetic manual evidence review', status: 'active',
    periodStart: '2026-01-01', periodEnd: '2026-12-31', createdBy: { userId: 'reviewer' }, settings: { enableAiAssist: true, requireOkrAlignment: false } });
  const appraisal = await Appraisal.create({ organizationId: organization.id, cycleId: cycle._id,
    employee: { userId: user.id, name: user.name, email: user.email }, manager: { userId: 'reviewer', name: 'Synthetic Reviewer', email: 'reviewer@example.test' },
    status: 'self_assessment_in_progress', cycleConfigurationSnapshot: { settings: { enableAiAssist: true }, workflowDefinition: design } });
  await page.addInitScript(() => localStorage.setItem('accessToken', 'synthetic-manual-attachment-browser'));
  const writes: { path: string; mode?: string }[] = [];
  const aiRequests: string[] = [];
  page.on('request', req => { if (/\/appraisals\/[^/]+\/(?:conversation|ai-)/.test(req.url())) aiRequests.push(req.url()); });
  // A document download opens a new tab; context routes include its initial
  // navigation, which page.route intentionally does not intercept.
  await page.context().route('**/__mock-api/**', async route => {
    const url = new URL(route.request().url()), endpoint = url.pathname.slice('/__mock-api'.length);
    if (endpoint.startsWith('/appraisals/')) {
      const response = await route.fetch({ url: `${apiURL}/api${endpoint}${url.search}`, maxRedirects: 0 });
      if (route.request().method() !== 'GET') writes.push({ path: endpoint, mode: route.request().postData()?.includes('name="assessmentMode"\r\n\r\nform') ? 'form' : undefined });
      if (endpoint.endsWith('/content') && response.status() === 302) {
        const source = await Document.findOne({ appraisalId: appraisal._id, status: { $ne: 'deleted' } });
        const signedUrl = new URL(response.headers().location);
        expect(signedUrl.searchParams.get('public_id')).toBe(source.storageKey);
        expect(signedUrl.searchParams.get('type')).toBe('authenticated');
        expect(signedUrl.searchParams.get('signature')).toMatch(/^[a-f0-9]+$/);
        return route.fulfill({ status: 200, headers: { 'content-type': 'text/plain', 'content-disposition': 'attachment; filename="manual-private-evidence.txt"' }, body: uploaded.at(-1)!.bytes });
      }
      return route.fulfill({ response });
    }
    let response: unknown = { success: true, data: [] };
    if (endpoint === '/auth/me') response = { success: true, user, currentOrganization: organization, currentOrganizationId: organization.id };
    if (endpoint === '/user/context') response = { success: true, data: { user, organization, role: { name: 'employee', isManager: false, isHRAdmin: false }, teams: [], features: {}, stats: {} } };
    if (endpoint === '/ai-account') response = { success: true, data: { account: { status: 'disconnected', routable: false }, policy: { chatgptEnabled: true } } };
    return route.fulfill({ json: response });
  });
  await page.goto(`/appraisals/${appraisal._id}/self-assessment`);
  await page.getByRole('dialog', { name: 'ChatGPT is required', exact: true }).getByRole('button', { name: 'Use manual form', exact: true }).click();
  const reflection = { 'Key Achievements': 'Delivered a measured synthetic project outcome.', 'Challenges Faced': 'Resolved a planned delivery dependency.',
    'Key Learnings': 'Used an evidence checklist.', 'Goals for Next Period': 'Measure the next synthetic milestone.' };
  for (const [label, value] of Object.entries(reflection)) await page.getByRole('textbox', { name: label, exact: true }).fill(value);
  await page.getByRole('textbox', { name: /Describe the documented delivery/ }).fill('A documented synthetic delivery with a supporting file.');
  await page.getByRole('radio', { name: '4 Stars', exact: true }).first().press('Space');
  await page.getByRole('button', { name: 'Submit Self-Assessment', exact: true }).click();
  await expect(page.getByText(/Delivery proof: attach supporting evidence/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose document', exact: true })).toBeVisible();
  const file = { name: 'manual-private-evidence.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic supporting delivery evidence. '.repeat(8)) };
  await page.locator('input[type="file"]').setInputFiles(file);
  await page.getByRole('button', { name: 'Upload document', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Failed to upload document' })).toBeVisible();
  await expect(page.getByText(file.name, { exact: true })).toBeVisible();
  failUpload = false;
  await page.getByRole('button', { name: 'Retry upload', exact: true }).click();
  const row = page.getByRole('group', { name: file.name, exact: true });
  await expect(row).toBeVisible();
  expect(uploaded).toHaveLength(1); expect(uploaded[0].bytes).toEqual(file.buffer);
  expect(writes.filter(write => write.path.endsWith('/documents')).every(write => write.mode === 'form')).toBe(true);
  const source = await Document.findOne({ appraisalId: appraisal._id });
  expect(source.storageDeliveryType).toBe('authenticated'); expect(source.aiAnalysis.status).toBe('skipped');
  for (const [label, value] of Object.entries(reflection)) await expect(page.getByRole('textbox', { name: label, exact: true })).toHaveValue(value);
  await expect(page.getByRole('textbox', { name: /Describe the documented delivery/ })).toHaveValue('A documented synthetic delivery with a supporting file.');
  await page.getByRole('button', { name: 'Save Draft', exact: true }).click();
  await page.reload();
  await page.getByRole('dialog', { name: 'ChatGPT is required', exact: true }).getByRole('button', { name: 'Use manual form', exact: true }).click();
  await expect(row).toBeVisible();
  await request.get(`${apiURL}/api/appraisals/${appraisal._id}/documents/${source._id}/content`, { headers: { 'x-attachment-actor': 'outsider' }, maxRedirects: 0 }).then(response => expect(response.status()).toBe(403));
  expect(signed).toBe(0);
  const downloadEvent = page.waitForEvent('download');
  await row.getByRole('button', { name: 'Download document', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe(file.name);
  expect(await readFile((await download.path())!)).toEqual(file.buffer); expect(signed).toBe(1);
  await page.screenshot({ path: info.outputPath('manual-required-evidence-uploaded.png'), fullPage: true });
  await row.getByRole('button', { name: 'Remove document', exact: true }).click();
  const removal = page.getByRole('dialog', { name: 'Remove document', exact: true });
  failDelete = true;
  await removal.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(removal.getByRole('alert')).toHaveText('Failed to delete document');
  expect((await Document.findById(source._id)).status).not.toBe('deleted');
  failDelete = false;
  await removal.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(row).toHaveCount(0);
  expect((await Document.findById(source._id)).status).toBe('deleted');
  await page.getByRole('button', { name: 'Submit Self-Assessment', exact: true }).click();
  await expect(page.getByText(/Delivery proof: attach supporting evidence/)).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(file);
  await page.getByRole('button', { name: 'Upload document', exact: true }).click();
  await expect(row).toBeVisible();
  await page.getByRole('button', { name: 'Submit Self-Assessment', exact: true }).click();
  await expect(page).toHaveURL(/\/appraisals\?/);
  expect((await Appraisal.findById(appraisal._id)).selfAssessment.submittedAt).toBeTruthy();
  expect(aiRequests).toEqual([]);
});

test('assigned reviewer attaches required manual evidence and submits without AI or a new document permission', async ({ page }, info) => {
  failUpload = false; failDelete = false; uploaded.length = 0;
  const design = { version: 1, sections: [{ id: 'reviewer-proof', title: 'Reviewer proof', type: 'custom', respondent: 'manager',
    required: true, evidenceRequired: true, questions: [{ id: 'judgment', prompt: 'Explain the documented reviewer judgment.', responseType: 'long_text', required: true }] }] };
  const cycle = await Cycle.create({ organizationId: organization.id, name: 'Synthetic reviewer evidence review', status: 'active',
    periodStart: '2026-01-01', periodEnd: '2026-12-31', createdBy: { userId: 'reviewer' }, settings: { enableAiAssist: true, requireOkrAlignment: false } });
  const appraisal = await Appraisal.create({ organizationId: organization.id, cycleId: cycle._id,
    employee: { userId: user.id, name: user.name, email: user.email }, manager: { userId: reviewer.id, name: reviewer.name, email: reviewer.email },
    status: 'manager_review_pending', selfAssessment: { submittedAt: new Date(), overallSelfRating: 4 },
    cycleConfigurationSnapshot: { settings: { enableAiAssist: true }, workflowDefinition: design } });
  await page.addInitScript(() => localStorage.setItem('accessToken', 'synthetic-reviewer-attachment-browser'));
  const aiRequests: string[] = [];
  page.on('request', req => { if (/\/appraisals\/[^/]+\/(?:check-bias|ai-)/.test(req.url())) aiRequests.push(req.url()); });
  await page.context().route('**/__mock-api/**', async route => {
    const url = new URL(route.request().url()), endpoint = url.pathname.slice('/__mock-api'.length);
    if (endpoint.startsWith('/appraisals/')) {
      const response = await route.fetch({ url: `${apiURL}/api${endpoint}${url.search}`, headers: { ...route.request().headers(), 'x-attachment-actor': 'reviewer' }, maxRedirects: 0 });
      return route.fulfill({ response });
    }
    let response: unknown = { success: true, data: [] };
    if (endpoint === '/auth/me') response = { success: true, user: reviewer, currentOrganization: organization, currentOrganizationId: organization.id };
    if (endpoint === '/user/context') response = { success: true, data: { user: reviewer, organization, role: { name: 'line_manager', isManager: true, isHRAdmin: false }, teams: [], features: {}, stats: {} } };
    if (endpoint === '/ai-account') response = { success: true, data: { account: { status: 'disconnected', routable: false }, policy: { chatgptEnabled: true } } };
    return route.fulfill({ json: response });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/appraisals/${appraisal._id}/manager-review`);
  for (let step = 0; step < 3; step++) await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Overall Assessment', exact: true })).toBeVisible();
  await page.getByRole('radio', { name: '4 Stars', exact: true }).first().press('Space');
  await page.getByRole('textbox', { name: /Explain the documented reviewer judgment/ }).fill('The delivery record supports this documented human judgment.');
  await page.getByRole('textbox', { name: 'Key Achievements Observed', exact: true }).fill('Observed a measured synthetic project outcome.');
  await page.getByRole('button', { name: 'Submit Review', exact: true }).click();
  await expect(page.getByText(/Reviewer proof: attach supporting evidence/)).toBeVisible();
  const file = { name: 'reviewer-required-proof.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic reviewer evidence. '.repeat(8)) };
  await page.locator('input[type="file"]').setInputFiles(file);
  await page.getByRole('button', { name: 'Upload document', exact: true }).click();
  await expect(page.getByRole('group', { name: file.name, exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Key Achievements Observed', exact: true })).toHaveValue('Observed a measured synthetic project outcome.');
  await expect(page.getByRole('textbox', { name: /Explain the documented reviewer judgment/ })).toHaveValue('The delivery record supports this documented human judgment.');
  const source = await Document.findOne({ appraisalId: appraisal._id });
  expect(source.uploadedBy.userId).toBe('reviewer'); expect(source.visibility).toBe('employee_manager'); expect(source.aiAnalysis.status).toBe('skipped');
  expect(uploaded[0].bytes).toEqual(file.buffer);
  await page.getByRole('group', { name: file.name, exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('reviewer-required-evidence-mobile.png') });
  const submitted = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/appraisals/${appraisal._id}/manager-review`) && response.request().postDataJSON()?.submit === true);
  await page.getByRole('button', { name: 'Submit Review', exact: true }).click();
  expect((await submitted).status()).toBe(200);
  expect((await Appraisal.findById(appraisal._id)).managerReview.submittedAt).toBeTruthy();
  expect(aiRequests).toEqual([]);
  await page.reload();
  await expect(page.getByText('Review Already Submitted', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose document', exact: true })).toHaveCount(0);
});
