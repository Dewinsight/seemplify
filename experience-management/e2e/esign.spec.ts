import fs from 'node:fs';
import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

type EnvelopeDetail = {
  envelope: { id: string; status: string };
  documents: Array<{ id: string; pageCount: number }>;
  recipients: Array<{ id: string; name: string; email: string; status: string; routingOrder: number }>;
  fields: Array<{ id: string; recipientId: string; page: number; type: string }>;
  artifacts: Array<{ id: string; kind: string; name: string; sha256: string; certificateId?: string }>;
  audit: Array<{ action: string }>;
};

type OutboxItem = {
  recipientId: string;
  recipientEmail: string;
  kind: string;
  state: string;
  signerUrl: string | null;
};

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('qa@seemplify.local');
  await page.getByLabel('Password').fill('Playwright-Test-Password-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Experience overview' })).toBeVisible();
}

async function syntheticPdf(path: string, title: string, pages = 3) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (let index = 0; index < pages; index += 1) {
    const page = pdf.addPage([612, 792]);
    page.drawText(title, { x: 48, y: 730, size: 19, font: bold, color: rgb(0.08, 0.15, 0.12) });
    page.drawText(`Synthetic acceptance fixture - page ${index + 1} of ${pages}`, { x: 48, y: 696, size: 11, font: regular });
    page.drawText('Only non-sensitive test data is contained in this document.', { x: 48, y: 666, size: 10, font: regular });
  }
  fs.writeFileSync(path, Buffer.from(await pdf.save()));
}

async function envelopeDetail(page: Page, envelopeId: string) {
  return page.evaluate(async (id) => {
    const response = await fetch(`/api/esign/envelopes/${id}`);
    if (!response.ok) throw new Error(`Envelope read failed with ${response.status}`);
    return response.json();
  }, envelopeId) as Promise<EnvelopeDetail>;
}

async function outbox(page: Page, envelopeId: string) {
  return page.evaluate(async (id) => {
    const response = await fetch(`/api/esign/outbox?envelopeId=${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error(`Outbox read failed with ${response.status}`);
    return response.json();
  }, envelopeId) as Promise<OutboxItem[]>;
}

async function waitForInvitation(page: Page, envelopeId: string, email: string) {
  let result: OutboxItem | undefined;
  await expect.poll(async () => {
    result = (await outbox(page, envelopeId)).find((item) => item.recipientEmail === email && item.kind === 'invitation' && item.state === 'sent' && item.signerUrl);
    return Boolean(result);
  }, { timeout: 15_000, message: `Invitation for ${email} was not delivered` }).toBe(true);
  return result!;
}

async function waitForMail(page: Page, envelopeId: string, email: string, kind: string) {
  let result: OutboxItem | undefined;
  await expect.poll(async () => {
    result = (await outbox(page, envelopeId)).find((item) => item.recipientEmail === email && item.kind === kind && item.state === 'sent' && item.signerUrl);
    return Boolean(result);
  }, { timeout: 15_000, message: `${kind} mail for ${email} was not delivered` }).toBe(true);
  return result!;
}

async function consent(page: Page) {
  await expect(page.getByRole('heading', { name: 'Review and consent' })).toBeVisible();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Agree and review' }).click();
  await expect(page.getByText(/Signing as /)).toBeVisible();
}

async function applyTypedSignature(page: Page, name: string, options: { save?: boolean; label?: string } = {}) {
  await page.getByRole('button', { name: /Signature, required/i }).click();
  await expect(page.getByRole('heading', { name: 'Choose your signature' })).toBeVisible();
  await page.getByLabel('Full name').fill(name);
  if (options.label) await page.getByLabel('Saved signature label').fill(options.label);
  await page.getByRole('button', { name: options.save ? 'Save and apply' : 'Apply once', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}

async function applyDrawnSignature(page: Page) {
  await page.getByRole('button', { name: /Signature, required/i }).click();
  await page.getByRole('tab', { name: 'Draw' }).click();
  const canvas = page.getByLabel('Draw signature');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Draw-signature canvas was not visible.');
  await page.mouse.move(box.x + 24, box.y + box.height * 0.65);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.35, { steps: 6 });
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.7, { steps: 6 });
  await page.mouse.move(box.x + box.width - 30, box.y + box.height * 0.3, { steps: 6 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Apply once', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}

async function applyUploadedSignature(page: Page) {
  // Small valid PNG; the API verifies both the data URL declaration and image bytes.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR42mNkYGD4z8DAwMgABYwMDAwAAB0AAf6dBq8AAAAASUVORK5CYII=', 'base64');
  await page.getByRole('button', { name: /Signature, required/i }).click();
  await page.getByRole('tab', { name: 'Upload' }).click();
  await page.locator('input[type=file][accept*="image/png"]').setInputFiles({ name: 'synthetic-signature.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByRole('img', { name: 'Uploaded signature preview' })).toBeVisible();
  await page.getByRole('button', { name: 'Apply once', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}

async function finishSigner(page: Page) {
  await expect(page.getByText('0 required remaining')).toBeVisible();
  await page.getByRole('button', { name: 'Finish', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Signing complete' })).toBeVisible({ timeout: 20_000 });
}

async function openSigner(browser: Browser, signerUrl: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(signerUrl);
  return { context, page };
}

test('creates, prepares and completes a protected three-signer agreement with ordered parallel routing', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Desktop exercises precise field placement and all signature modes.');
  test.skip(Boolean(process.env.PLAYWRIGHT_EXTERNAL_URL), 'The deterministic signing mailbox exists only in local log mode.');
  await login(page);

  const suffix = `${Date.now()}`;
  const title = `Routed acceptance agreement ${suffix}`;
  const accessCode = 'Access-Only-93!X';
  const pdfPath = testInfo.outputPath(`routed-agreement-${suffix}.pdf`);
  await syntheticPdf(pdfPath, title, 3);

  await page.getByRole('link', { name: 'Agreements' }).click();
  await page.getByRole('banner').getByRole('link', { name: 'New agreement' }).click();
  await page.getByLabel('Agreement name').fill(title);
  await page.getByLabel('Email subject').fill(`Signature requested: ${title}`);
  await page.getByLabel('Email message').fill('Please review and sign this synthetic acceptance agreement.');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  const envelopeId = new URL(page.url()).pathname.split('/').at(-1)!;
  const preparation = page.getByRole('tablist', { name: 'Agreement preparation' });
  const headerReview = page.getByRole('button', { name: 'Review and send', exact: true });
  await expect(preparation).toBeVisible();
  await expect(headerReview).toBeDisabled();
  await expect(preparation.getByRole('tab', { name: /3.*Fields.*Needs attention/i })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next: Recipients' })).toBeDisabled();

  await page.locator('input[type=file][accept*="pdf"]').setInputFiles(pdfPath);
  await expect(page.getByText(`routed-agreement-${suffix}.pdf`)).toBeVisible();
  await expect.poll(async () => (await envelopeDetail(page, envelopeId)).documents[0]?.pageCount).toBe(3);
  await expect(page.getByRole('button', { name: 'Next: Recipients' })).toBeEnabled();
  await page.getByRole('button', { name: 'Next: Recipients' }).click();
  await expect(page.getByRole('heading', { name: 'Recipients and signing order' })).toBeFocused();

  await page.getByRole('button', { name: 'Add recipient' }).click();
  await page.getByRole('button', { name: 'Add recipient' }).click();
  await page.getByRole('button', { name: 'Add recipient' }).click();
  const names = page.getByLabel('Name');
  const emails = page.getByLabel('Email');
  const orders = page.getByLabel('Order');
  const codes = page.getByLabel('Access code');
  await names.nth(0).fill('Ada First'); await emails.nth(0).fill(`ada-${suffix}@example.com`); await orders.nth(0).fill('1'); await codes.nth(0).fill(accessCode);
  await names.nth(1).fill('Ben Parallel'); await emails.nth(1).fill(`ben-${suffix}@example.com`); await orders.nth(1).fill('2');
  await names.nth(2).fill('Chi Parallel'); await emails.nth(2).fill(`chi-${suffix}@example.com`); await orders.nth(2).fill('2');
  await expect(page.getByRole('button', { name: 'Next: Fields' })).toBeDisabled();
  await expect(headerReview).toBeDisabled();
  await page.getByRole('button', { name: 'Save recipients' }).click();
  await expect(page.getByText('Recipients saved')).toBeVisible();

  let detail = await envelopeDetail(page, envelopeId);
  expect(detail.recipients).toHaveLength(3);
  await expect(page.getByRole('button', { name: 'Next: Fields' })).toBeEnabled();
  await page.getByRole('button', { name: 'Next: Fields' }).click();
  await expect(page.getByRole('heading', { name: 'Place signing fields' })).toBeFocused();
  await expect(page.getByLabel('Document page 3')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('link', { name: /Open field editor/i })).toHaveCount(0);
  const assignee = page.getByLabel('Assign new fields to');
  const placeField = async (recipientName: string, fieldLabel: string, pageNumber: number, position: { x: number; y: number }) => {
    const optionValue = await assignee.locator('option').filter({ hasText: recipientName }).getAttribute('value');
    if (!optionValue) throw new Error(`Field recipient option was not found for ${recipientName}.`);
    await assignee.selectOption(optionValue);
    await page.getByRole('button', { name: fieldLabel, exact: true }).click();
    await page.locator(`[data-page-number="${pageNumber}"]`).click({ position });
  };
  await placeField('Ada First', 'Signature', 1, { x: 120, y: 560 });
  await placeField('Ada First', 'Text', 1, { x: 120, y: 465 });
  await placeField('Ada First', 'Checkbox', 1, { x: 120, y: 405 });
  await placeField('Ada First', 'Radio group', 1, { x: 120, y: 345 });
  await placeField('Ada First', 'Dropdown', 1, { x: 120, y: 280 });
  await placeField('Ben Parallel', 'Signature', 2, { x: 120, y: 560 });
  await placeField('Chi Parallel', 'Signature', 3, { x: 120, y: 560 });
  await expect(page.getByRole('button', { name: 'Next: Message' })).toBeDisabled();
  await page.getByRole('button', { name: 'Save fields' }).click();
  await expect(page.getByRole('button', { name: 'Fields saved' })).toBeVisible();
  await expect(page.getByText('Every required step is complete.')).toBeVisible();
  await expect(headerReview).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Next: Message' })).toBeEnabled();
  await page.getByRole('button', { name: 'Next: Message' }).click();
  await expect(page.getByRole('heading', { name: 'Email and delivery' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Next: Review' })).toBeEnabled();
  await page.getByRole('button', { name: 'Next: Review' }).click();
  await expect(page.getByRole('heading', { name: 'Review and send' })).toBeFocused();
  await page.getByRole('button', { name: 'Send for signature' }).click();
  await expect(page.getByText('Sent', { exact: true })).toBeVisible();

  detail = await envelopeDetail(page, envelopeId);
  const [ada, ben, chi] = detail.recipients;
  const adaInvite = await waitForInvitation(page, envelopeId, ada.email);
  const initialMail = await outbox(page, envelopeId);
  expect(initialMail.filter((item) => item.kind === 'invitation').map((item) => item.recipientId)).toEqual([ada.id]);
  // The protected code must never be returned by any sender or mailbox API response.
  expect(JSON.stringify({ detail, initialMail })).not.toContain(accessCode);
  expect((await outbox(page, envelopeId)).some((item) => item.recipientId === ben.id || item.recipientId === chi.id)).toBe(false);

  const adaSigner = await openSigner(browser, adaInvite.signerUrl!);
  await expect(adaSigner.page.getByRole('heading', { name: 'Enter your access code' })).toBeVisible();
  const documentId = detail.documents[0].id;
  expect(await adaSigner.page.evaluate(async (id) => (await fetch(`/api/public/esign/documents/${id}/content`)).status, documentId)).toBe(401);
  await adaSigner.page.getByLabel('Access code').fill('wrong-code');
  await adaSigner.page.getByRole('button', { name: 'Continue' }).click();
  await expect(adaSigner.page.getByText(/incorrect/i)).toBeVisible();
  await adaSigner.page.getByLabel('Access code').fill(accessCode);
  await adaSigner.page.getByRole('button', { name: 'Continue' }).click();
  await expect(adaSigner.page.getByRole('heading', { name: 'Review and consent' })).toBeVisible();
  expect(await adaSigner.page.evaluate(async (id) => (await fetch(`/api/public/esign/documents/${id}/content`)).status, documentId)).toBe(409);
  await consent(adaSigner.page);
  const adaSignatureText = `Ada First ${suffix}`;
  const adaSignatureLabel = `Ada reusable signature ${suffix}`;
  const adaSignatureField = detail.fields.find((field) => field.recipientId === ada.id && field.type === 'signature');
  expect(adaSignatureField).toBeTruthy();
  const adaSignatureOnDocument = adaSigner.page.locator(`[data-sign-field-id="${adaSignatureField!.id}"]`);
  await applyTypedSignature(adaSigner.page, adaSignatureText, { save: true, label: adaSignatureLabel });
  await expect(adaSignatureOnDocument).toContainText(adaSignatureText);
  await adaSigner.page.getByLabel('Text, required').fill('Accepted after careful review.');
  await adaSigner.page.getByRole('checkbox', { name: /Checkbox, required/ }).check();
  await adaSigner.page.getByRole('radio', { name: 'Option 1' }).check();
  await adaSigner.page.getByLabel('Dropdown, required').selectOption('Option 2');
  await expect(adaSigner.page.getByText('0 required remaining')).toBeVisible();
  // Reload proves a saved signature remains complete in a resumed ceremony.
  await adaSigner.page.reload();
  await expect(adaSigner.page.getByText('0 required remaining')).toBeVisible({ timeout: 20_000 });
  await expect(adaSigner.page.locator(`[data-sign-field-id="${adaSignatureField!.id}"]`)).toContainText(adaSignatureText);

  const reusable = await createSentEnvelope(page, testInfo, 'Signature reuse', { name: 'Ada First', email: ada.email });
  const reusableDetail = await envelopeDetail(page, reusable.envelopeId);
  const reusableSignatureField = reusableDetail.fields.find((field) => field.type === 'signature');
  expect(reusableSignatureField).toBeTruthy();
  const reusableInvite = await waitForInvitation(page, reusable.envelopeId, ada.email);
  const reusableSigner = await openSigner(browser, reusableInvite.signerUrl!);
  await consent(reusableSigner.page);
  await reusableSigner.page.getByRole('button', { name: /Signature, required/i }).click();
  const reusableDialog = reusableSigner.page.getByRole('dialog');
  const savedSignatureCard = reusableDialog.locator('article').filter({ hasText: adaSignatureLabel });
  await expect(savedSignatureCard).toContainText(adaSignatureText);
  await savedSignatureCard.getByRole('button', { name: 'Use', exact: true }).click();
  const reusableSignatureOnDocument = reusableSigner.page.locator(`[data-sign-field-id="${reusableSignatureField!.id}"]`);
  await expect(reusableSignatureOnDocument).toContainText(adaSignatureText);
  await reusableSigner.page.reload();
  await expect(reusableSigner.page.locator(`[data-sign-field-id="${reusableSignatureField!.id}"]`)).toContainText(adaSignatureText);
  await finishSigner(reusableSigner.page);
  await reusableSigner.context.close();

  await finishSigner(adaSigner.page);
  const waitingState = adaSigner.page.locator('section[aria-labelledby="document-state-heading"]');
  await expect(waitingState.getByText('Waiting for other recipients', { exact: true })).toBeVisible();
  const waitingActivity = adaSigner.page.locator('section[aria-labelledby="signing-activity-heading"]');
  await expect(waitingActivity.getByText('1/3 complete', { exact: true })).toBeVisible();
  await expect(waitingActivity.getByText('Ada First (you)', { exact: true })).toBeVisible();

  const [benInvite, chiInvite] = await Promise.all([
    waitForInvitation(page, envelopeId, ben.email),
    waitForInvitation(page, envelopeId, chi.email)
  ]);
  const secondWave = await outbox(page, envelopeId);
  expect(secondWave.filter((item) => item.kind === 'invitation' && [ben.id, chi.id].includes(item.recipientId))).toHaveLength(2);
  const benSigner = await openSigner(browser, benInvite.signerUrl!);
  const chiSigner = await openSigner(browser, chiInvite.signerUrl!);
  await Promise.all([consent(benSigner.page), consent(chiSigner.page)]);
  await expect(benSigner.page.getByText(adaSignatureText, { exact: true })).toHaveCount(0);
  await benSigner.page.getByRole('button', { name: /Signature, required/i }).click();
  const benSignatureDialog = benSigner.page.getByRole('dialog');
  await expect(benSignatureDialog.getByRole('heading', { name: 'Saved signatures' })).toBeVisible();
  await expect(benSignatureDialog.getByText(adaSignatureText, { exact: true })).toHaveCount(0);
  await expect(benSignatureDialog.getByText('No saved signatures yet. Create one below and choose Save and apply.')).toBeVisible();
  await benSigner.page.keyboard.press('Escape');
  await Promise.all([applyDrawnSignature(benSigner.page), applyUploadedSignature(chiSigner.page)]);
  await Promise.all([finishSigner(benSigner.page), finishSigner(chiSigner.page)]);

  await expect.poll(async () => (await envelopeDetail(page, envelopeId)).envelope.status, { timeout: 20_000 }).toBe('completed');
  detail = await envelopeDetail(page, envelopeId);
  expect(detail.recipients.every((recipient) => recipient.status === 'completed')).toBe(true);
  expect(detail.artifacts.map((artifact) => artifact.kind).sort()).toEqual(['completed_pdf', 'completion_certificate']);
  expect(detail.audit.filter((event) => event.action === 'recipient.completed')).toHaveLength(3);
  expect(detail.audit.some((event) => event.action === 'envelope.completed')).toBe(true);

  const completedArtifact = detail.artifacts.find((artifact) => artifact.kind === 'completed_pdf')!;
  const certificateArtifact = detail.artifacts.find((artifact) => artifact.kind === 'completion_certificate')!;
  for (const artifact of [completedArtifact, certificateArtifact]) {
    const response = await page.request.get(`/api/esign/envelopes/${envelopeId}/artifacts/${artifact.id}/content`);
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toContain('application/pdf');
    expect(response.headers().etag).toBe(`"${artifact.sha256}"`);
    const bytes = await response.body();
    fs.writeFileSync(testInfo.outputPath(artifact.kind === 'completed_pdf' ? 'completed-agreement.pdf' : 'completion-certificate.pdf'), bytes);
    const pdf = await PDFDocument.load(bytes);
    if (artifact.kind === 'completed_pdf') expect(pdf.getPageCount()).toBe(3);
    else expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
  }
  expect(certificateArtifact.certificateId).toBeTruthy();
  const verification = await page.request.get(`/api/public/esign/certificates/${certificateArtifact.certificateId}`);
  expect(verification.ok()).toBe(true);
  const verificationBody = await verification.json();
  expect(verificationBody.valid).toBe(true);
  expect(verificationBody.documentHash).toBe(completedArtifact.sha256);
  expect(JSON.stringify(verificationBody)).not.toContain('ada-');

  await page.reload();
  await page.getByRole('button', { name: 'Activity' }).click();
  await expect(page.getByRole('heading', { name: 'Signing history' })).toBeVisible();
  await expect(page.getByRole('link', { name: /completed\.pdf/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /certificate\.pdf/i })).toBeVisible();
  if (process.env.CAPTURE_VISUALS) await page.screenshot({ path: testInfo.outputPath('completed-agreement.png'), fullPage: true });

  await adaSigner.page.reload();
  await expect(adaSigner.page.getByRole('heading', { name: 'Signing complete' })).toBeVisible();
  await expect(adaSigner.page.locator('section[aria-labelledby="document-state-heading"]').getByText('Completed', { exact: true })).toBeVisible();
  const completedActivity = adaSigner.page.locator('section[aria-labelledby="signing-activity-heading"]');
  await expect(completedActivity.getByText('3/3 complete', { exact: true })).toBeVisible();
  for (const participant of ['Ada First (you)', 'Ben Parallel', 'Chi Parallel']) {
    await expect(completedActivity.getByText(participant, { exact: true })).toBeVisible();
  }
  await expect(adaSigner.page.getByRole('heading', { name: 'Keep your signed documents together' })).toBeVisible();
  await expect(adaSigner.page.getByText('An account is not required')).toBeVisible();
  await expect(adaSigner.page.getByRole('link', { name: /completed\.pdf/i })).toBeVisible();
  await adaSigner.page.getByRole('link', { name: 'Create optional account' }).click();
  await expect(adaSigner.page.getByRole('heading', { name: 'Keep your signed documents' })).toBeVisible();
  await expect(adaSigner.page.getByLabel('Recipient email')).toHaveValue(ada.email);
  await expect(adaSigner.page.getByLabel('Recipient email')).toHaveAttribute('readonly', '');
  await adaSigner.page.getByRole('button', { name: 'Continue' }).click();
  const portalPassword = 'Ada-Portal-2026!';
  await adaSigner.page.getByLabel('Password', { exact: true }).fill(portalPassword);
  await adaSigner.page.getByLabel('Confirm password', { exact: true }).fill(portalPassword);
  await adaSigner.page.getByRole('button', { name: 'Create account and verify email' }).click();
  await expect(adaSigner.page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  const verificationRequestId = new URL(adaSigner.page.url()).searchParams.get('request');
  expect(verificationRequestId).toBeTruthy();
  const tokenResponse = await adaSigner.page.request.post('/__e2e__/auth/verification-token', { data: { email: ada.email, requestId: verificationRequestId } });
  expect(tokenResponse.ok()).toBe(true);
  const verificationToken = (await tokenResponse.json() as { token: string }).token;
  await adaSigner.page.goto(`/verify-email?token=${encodeURIComponent(verificationToken)}&returnTo=%2Fmy-documents`);
  await adaSigner.page.getByRole('button', { name: 'Confirm email address' }).click();
  await expect(adaSigner.page.getByRole('heading', { name: 'Email verified' })).toBeVisible();
  let activityRequests = 0;
  adaSigner.page.on('request', (request) => {
    if (new URL(request.url()).pathname === `/api/recipient-documents/envelopes/${envelopeId}/activity`) activityRequests += 1;
  });
  await adaSigner.page.getByRole('link', { name: 'Open My documents' }).click();
  await expect(adaSigner.page.getByRole('heading', { name: 'My documents' })).toBeVisible();
  await expect(adaSigner.page.getByRole('heading', { name: title })).toBeVisible();
  const documentRow = adaSigner.page.getByTestId('recipient-document-row').filter({ hasText: title });
  await expect(documentRow.getByRole('link', { name: 'Completed document' })).toBeVisible();
  await expect(documentRow.getByRole('link', { name: 'Completion certificate' })).toBeVisible();
  const activityDisclosure = documentRow.getByText('Activity and document status', { exact: true });
  expect(activityRequests).toBe(0);
  await activityDisclosure.click();
  await expect.poll(() => activityRequests).toBe(1);
  await expect(documentRow.getByText('Completed · Files ready', { exact: true })).toBeVisible();
  await expect(documentRow.getByText('Signature saved for reuse', { exact: true })).toBeVisible();
  await expect(documentRow.getByText('Signing completed', { exact: true })).toBeVisible();
  await expect(documentRow.getByText(adaSignatureText, { exact: true })).toHaveCount(0);
  await activityDisclosure.click();
  await activityDisclosure.click();
  await expect.poll(() => activityRequests).toBe(1);
  const [portalDownload] = await Promise.all([
    adaSigner.page.waitForEvent('download'),
    documentRow.getByRole('link', { name: 'Completed document' }).click()
  ]);
  expect(await portalDownload.suggestedFilename()).toContain('completed.pdf');
  await adaSigner.page.getByRole('button', { name: 'Sign out' }).click();
  await expect(adaSigner.page).toHaveURL(/\/login\?returnTo=%2Fmy-documents$/);
  await adaSigner.page.getByLabel('Email').fill(ada.email);
  await adaSigner.page.getByLabel('Password').fill(portalPassword);
  await adaSigner.page.getByRole('button', { name: 'Sign in' }).click();
  await expect(adaSigner.page.getByRole('heading', { name: 'My documents' })).toBeVisible();
  await expect(adaSigner.page.getByRole('heading', { name: title })).toBeVisible();

  await Promise.all([adaSigner.context.close(), benSigner.context.close(), chiSigner.context.close()]);
});

async function createSentEnvelope(page: Page, testInfo: TestInfo, label: string, recipient?: { name: string; email: string }) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const pdfPath = testInfo.outputPath(`${label}-${suffix}.pdf`);
  await syntheticPdf(pdfPath, `${label} ${suffix}`, 1);
  const fileBytes = fs.readFileSync(pdfPath).toString('base64');
  const setup = await page.evaluate(async ({ suffix, label, fileBytes, recipient: recipientInput }) => {
    const json = (method: string, body: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    let response = await fetch('/api/esign/envelopes', json('POST', { title: `${label} ${suffix}`, subject: label, message: 'Review this test agreement.', routingMode: 'sequential' }));
    const created = await response.json(); const envelopeId = created.envelope.id;
    const bytes = Uint8Array.from(atob(fileBytes), (character) => character.charCodeAt(0));
    const form = new FormData(); form.append('file', new File([bytes], `${label}.pdf`, { type: 'application/pdf' }));
    response = await fetch(`/api/esign/envelopes/${envelopeId}/documents`, { method: 'POST', body: form });
    const uploaded = await response.json(); const documentId = uploaded.documents[0].id;
    const email = recipientInput?.email || `${label.toLowerCase().replace(/[^a-z]+/g, '-')}-${suffix}@example.com`;
    response = await fetch(`/api/esign/envelopes/${envelopeId}/recipients`, json('PUT', { recipients: [{ name: recipientInput?.name || `${label} Signer`, email, role: 'signer', routingOrder: 1 }] }));
    const recipient = (await response.json()).recipients[0];
    await fetch(`/api/esign/envelopes/${envelopeId}/fields`, json('PUT', { fields: [{ documentId, recipientId: recipient.id, type: 'signature', page: 1, x: 0.1, y: 0.72, width: 0.34, height: 0.08, required: true, label: 'Signature' }] }));
    response = await fetch(`/api/esign/envelopes/${envelopeId}/send`, json('POST', {}));
    if (!response.ok) throw new Error(`Could not send ${label} fixture: ${response.status}`);
    return { envelopeId, email };
  }, { suffix, label, fileBytes, recipient });
  return setup;
}

test('decline and sender void are irreversible and revoke outstanding signing links', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'One browser project exercises terminal ceremonies.');
  test.skip(Boolean(process.env.PLAYWRIGHT_EXTERNAL_URL), 'The deterministic signing mailbox exists only in local log mode.');
  await login(page);

  const declining = await createSentEnvelope(page, testInfo, 'Decline');
  const declineInvite = await waitForInvitation(page, declining.envelopeId, declining.email);
  const declineSigner = await openSigner(browser, declineInvite.signerUrl!);
  await consent(declineSigner.page);
  await declineSigner.page.getByRole('button', { name: 'Decline' }).click();
  await declineSigner.page.getByLabel('Reason').fill('I do not agree to these synthetic terms.');
  await declineSigner.page.getByRole('button', { name: 'Decline agreement' }).click();
  await expect(declineSigner.page.getByRole('heading', { name: 'Agreement declined' })).toBeVisible();
  await expect.poll(async () => (await envelopeDetail(page, declining.envelopeId)).envelope.status).toBe('declined');
  await declineSigner.context.close();
  const declinedReplay = await openSigner(browser, declineInvite.signerUrl!);
  await expect(declinedReplay.page.getByRole('heading', { name: 'Signing link unavailable' })).toBeVisible();
  await declinedReplay.context.close();

  const voiding = await createSentEnvelope(page, testInfo, 'Void');
  const voidInvite = await waitForInvitation(page, voiding.envelopeId, voiding.email);
  await page.goto(`/agreements/${voiding.envelopeId}`);
  await page.getByRole('button', { name: 'Void' }).click();
  await page.getByLabel('Reason').fill('Sender cancelled this synthetic agreement.');
  await page.getByRole('button', { name: 'Void agreement' }).click();
  await expect(page.getByText('Voided', { exact: true })).toBeVisible();
  const voidedSigner = await openSigner(browser, voidInvite.signerUrl!);
  await expect(voidedSigner.page.getByRole('heading', { name: 'Signing link unavailable' })).toBeVisible();
  await voidedSigner.context.close();
  expect((await envelopeDetail(page, voiding.envelopeId)).audit.some((event) => event.action === 'envelope.voided')).toBe(true);
});

test('copy recipients receive completed documents without being asked to sign or consent', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'One browser project verifies completed-copy delivery.');
  test.skip(Boolean(process.env.PLAYWRIGHT_EXTERNAL_URL), 'The deterministic signing mailbox exists only in local log mode.');
  await login(page);
  const suffix = `${Date.now()}`;
  const pdfPath = testInfo.outputPath(`copy-recipient-${suffix}.pdf`);
  await syntheticPdf(pdfPath, `Copy recipient agreement ${suffix}`, 1);
  const fileBytes = fs.readFileSync(pdfPath).toString('base64');
  const setup = await page.evaluate(async ({ suffix, fileBytes }) => {
    const json = (method: string, body: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    let response = await fetch('/api/esign/envelopes', json('POST', { title: `Copy recipient agreement ${suffix}`, subject: 'Copy delivery test', message: 'Please review.', routingMode: 'sequential' }));
    const created = await response.json(); const envelopeId = created.envelope.id;
    const bytes = Uint8Array.from(atob(fileBytes), (character) => character.charCodeAt(0));
    const form = new FormData(); form.append('file', new File([bytes], `copy-recipient-${suffix}.pdf`, { type: 'application/pdf' }));
    response = await fetch(`/api/esign/envelopes/${envelopeId}/documents`, { method: 'POST', body: form });
    const documentId = (await response.json()).documents[0].id;
    const signerEmail = `signer-${suffix}@example.com`; const copyEmail = `copy-${suffix}@example.com`;
    response = await fetch(`/api/esign/envelopes/${envelopeId}/recipients`, json('PUT', { recipients: [
      { name: 'Action Signer', email: signerEmail, role: 'signer', routingOrder: 1 },
      { name: 'Copy Recipient', email: copyEmail, role: 'cc', routingOrder: 2 }
    ] }));
    const recipients = (await response.json()).recipients;
    await fetch(`/api/esign/envelopes/${envelopeId}/fields`, json('PUT', { fields: [{ documentId, recipientId: recipients[0].id, type: 'signature', page: 1, x: 0.1, y: 0.72, width: 0.34, height: 0.08, required: true, label: 'Signature' }] }));
    response = await fetch(`/api/esign/envelopes/${envelopeId}/send`, json('POST', {}));
    if (!response.ok) throw new Error(`Could not send copy fixture: ${response.status}`);
    return { envelopeId, signerEmail, copyEmail };
  }, { suffix, fileBytes });

  const signerInvite = await waitForInvitation(page, setup.envelopeId, setup.signerEmail);
  const signer = await openSigner(browser, signerInvite.signerUrl!);
  await consent(signer.page);
  await applyTypedSignature(signer.page, 'Action Signer');
  await finishSigner(signer.page);
  await signer.context.close();
  await expect.poll(async () => (await envelopeDetail(page, setup.envelopeId)).envelope.status, { timeout: 20_000 }).toBe('completed');
  const copyMail = await waitForMail(page, setup.envelopeId, setup.copyEmail, 'completed');
  const copy = await openSigner(browser, copyMail.signerUrl!);
  await expect(copy.page.getByRole('heading', { name: 'Agreement complete' })).toBeVisible();
  await expect(copy.page.getByRole('heading', { name: 'Review and consent' })).toHaveCount(0);
  await expect(copy.page.getByRole('link', { name: /completed\.pdf/i })).toBeVisible();
  await expect(copy.page.getByRole('link', { name: /certificate\.pdf/i })).toBeVisible();
  await copy.context.close();
  const completed = await envelopeDetail(page, setup.envelopeId);
  expect(completed.recipients.find((recipient) => recipient.email === setup.copyEmail)?.status).toBe('notified');
});

test('mobile agreement preparation embeds the PDF editor and retains an unsaved field draft', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'Mobile project verifies the responsive sender workflow.');
  test.skip(Boolean(process.env.PLAYWRIGHT_EXTERNAL_URL), 'The local API is used to create an isolated preparation fixture.');
  await login(page);
  const suffix = `${Date.now()}`;
  const pdfPath = testInfo.outputPath(`mobile-preparation-${suffix}.pdf`);
  await syntheticPdf(pdfPath, `Mobile preparation ${suffix}`, 1);
  const fileBytes = fs.readFileSync(pdfPath).toString('base64');
  const envelopeId = await page.evaluate(async ({ suffix, fileBytes }) => {
    const json = (method: string, body: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const created = await fetch('/api/esign/envelopes', json('POST', {
      title: `Mobile preparation ${suffix}`,
      subject: 'Please sign the mobile fixture',
      message: 'Review and sign this test agreement.',
      routingMode: 'sequential'
    })).then((response) => response.json());
    const bytes = Uint8Array.from(atob(fileBytes), (character) => character.charCodeAt(0));
    const form = new FormData();
    form.append('file', new File([bytes], `mobile-preparation-${suffix}.pdf`, { type: 'application/pdf' }));
    await fetch(`/api/esign/envelopes/${created.envelope.id}/documents`, { method: 'POST', body: form });
    await fetch(`/api/esign/envelopes/${created.envelope.id}/recipients`, json('PUT', {
      recipients: [{ name: 'Mobile Workflow Signer', email: `mobile-workflow-${suffix}@example.com`, role: 'signer', routingOrder: 1 }]
    }));
    return created.envelope.id as string;
  }, { suffix, fileBytes });

  await page.goto(`/agreements/${envelopeId}/prepare`);
  await expect(page).toHaveURL(new RegExp(`/agreements/${envelopeId}\\?step=fields$`));
  await expect(page.getByRole('tablist', { name: 'Agreement preparation' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Place signing fields' })).toBeVisible();
  await expect(page.getByLabel('Assign new fields to')).toBeVisible();
  await expect(page.getByLabel('Document page 1')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('link', { name: /Open field editor/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Review and send', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Next: Message' })).toBeDisabled();

  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.locator('[data-page-number="1"]').click({ position: { x: 120, y: 220 } });
  await expect(page.getByRole('button', { name: 'Save fields' })).toBeVisible();
  await page.getByRole('tab', { name: /4.*Message/i }).click();
  await page.getByRole('tab', { name: /3.*Fields/i }).click();
  await expect(page.getByRole('button', { name: 'Save fields' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);

  let leaveWarning = '';
  page.once('dialog', async (dialog) => {
    leaveWarning = dialog.message();
    await dialog.dismiss();
  });
  await page.getByRole('link', { name: 'All agreements' }).click();
  expect(leaveWarning).toMatch(/discard your unsaved changes/i);
  await expect(page).toHaveURL(new RegExp(`/agreements/${envelopeId}\\?step=fields$`));
});

test('mobile signer completes a multi-page agreement without horizontal overflow', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'Mobile project verifies the compact signing ceremony.');
  test.skip(Boolean(process.env.PLAYWRIGHT_EXTERNAL_URL), 'The deterministic signing mailbox exists only in local log mode.');
  await login(page);
  const suffix = `${Date.now()}`;
  const pdfPath = testInfo.outputPath(`mobile-agreement-${suffix}.pdf`);
  await syntheticPdf(pdfPath, `Mobile agreement ${suffix}`, 2);

  const setup = await page.evaluate(async ({ suffix }) => {
    const json = (method: string, body: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const created = await fetch('/api/esign/envelopes', json('POST', { title: `Mobile agreement ${suffix}`, subject: 'Mobile signing test', message: 'Review and sign.', routingMode: 'sequential' })).then((response) => response.json());
    return { envelopeId: created.envelope.id };
  }, { suffix });
  const fileBytes = fs.readFileSync(pdfPath).toString('base64');
  const detail = await page.evaluate(async ({ envelopeId, fileBytes, suffix }) => {
    const bytes = Uint8Array.from(atob(fileBytes), (character) => character.charCodeAt(0));
    const form = new FormData(); form.append('file', new File([bytes], `mobile-${suffix}.pdf`, { type: 'application/pdf' }));
    let response = await fetch(`/api/esign/envelopes/${envelopeId}/documents`, { method: 'POST', body: form });
    const uploaded = await response.json(); const documentId = uploaded.documents[0].id;
    response = await fetch(`/api/esign/envelopes/${envelopeId}/recipients`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ recipients: [{ name: 'Mobile Signer', email: `mobile-${suffix}@example.com`, role: 'signer', routingOrder: 1 }] }) });
    const recipient = (await response.json()).recipients[0];
    response = await fetch(`/api/esign/envelopes/${envelopeId}/fields`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fields: [{ documentId, recipientId: recipient.id, type: 'signature', page: 2, x: 0.1, y: 0.72, width: 0.34, height: 0.08, required: true, label: 'Signature' }] }) });
    await response.json();
    await fetch(`/api/esign/envelopes/${envelopeId}/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    return { documentId, recipient };
  }, { envelopeId: setup.envelopeId, fileBytes, suffix });

  const invitation = await waitForInvitation(page, setup.envelopeId, detail.recipient.email);
  await page.goto(invitation.signerUrl!);
  await consent(page);
  await expect(page.getByLabel('Agreement page 2')).toBeVisible({ timeout: 20_000 });
  await applyTypedSignature(page, 'Mobile Signer');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await finishSigner(page);
  await expect.poll(async () => (await envelopeDetail(page, setup.envelopeId)).envelope.status, { timeout: 20_000 }).toBe('completed');
});
