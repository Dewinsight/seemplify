import { expect, test as base, type APIRequestContext, type Page } from '@playwright/test';

const API_ORIGIN = process.env.LIVE_API_ORIGIN || 'http://127.0.0.1:5110';
const TOKEN = 'live-e2e-token';

type BrowserDiagnostics = {
    errors: string[];
};

const test = base.extend<{ diagnostics: BrowserDiagnostics }>({
    diagnostics: async ({ page }, use) => {
        const diagnostics = { errors: [] as string[] };
        page.on('pageerror', error => diagnostics.errors.push(`pageerror: ${error.message}`));
        page.on('console', message => {
            if (message.type() === 'error') diagnostics.errors.push(`console: ${message.text()}`);
        });
        await use(diagnostics);
        expect(diagnostics.errors, 'The live application must not emit browser runtime errors').toEqual([]);
    },
});

test.describe.configure({ mode: 'serial' });

function apiHeaders() {
    return { Authorization: `Bearer ${TOKEN}` };
}

async function authenticate(page: Page) {
    await page.addInitScript(token => localStorage.setItem('access_token', token), TOKEN);
}

async function getTimesheets(request: APIRequestContext) {
    const response = await request.get(`${API_ORIGIN}/api/timesheets`, { headers: apiHeaders() });
    expect(response.ok(), await response.text()).toBeTruthy();
    return (await response.json()).timesheets as any[];
}

test.beforeAll(async ({ request }) => {
    const [health, auth] = await Promise.all([
        request.get(`${API_ORIGIN}/health`),
        request.get(`${API_ORIGIN}/api/auth/me`, { headers: apiHeaders() }),
    ]);
    expect(health.ok(), 'The real Time & Attendance backend must be running').toBeTruthy();
    expect(auth.ok(), await auth.text()).toBeTruthy();
});

test('routes an unauthenticated browser through the real application auth boundary', async ({ page, diagnostics: _diagnostics }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('desktop'), 'Desktop live-flow coverage');
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/127\.0\.0\.1:5119\/authorize/);
    await expect(page.getByRole('heading', { name: 'Live identity test sign-in' })).toBeVisible();
});

test('runs the complete clock, break and clock-out lifecycle against MongoDB', async ({ page, request, diagnostics: _diagnostics }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('desktop'), 'Desktop live-flow coverage');
    await authenticate(page);
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: /Good .*Alex\./ })).toBeVisible();

    const clockInResponse = page.waitForResponse(response => response.url().endsWith('/api/clock/in') && response.request().method() === 'POST');
    await page.getByRole('button', { name: /Clock in/i }).click();
    expect((await clockInResponse).status()).toBe(200);
    await expect(page.getByRole('button', { name: /Clock out/i })).toBeVisible();

    const breakStartResponse = page.waitForResponse(response => response.url().endsWith('/api/clock/break/start'));
    await page.getByRole('button', { name: /Take break/i }).click();
    expect((await breakStartResponse).status()).toBe(200);
    await expect(page.getByRole('button', { name: /Resume/i })).toBeVisible();

    const breakEndResponse = page.waitForResponse(response => response.url().endsWith('/api/clock/break/end'));
    await page.getByRole('button', { name: /Resume/i }).click();
    expect((await breakEndResponse).status()).toBe(200);
    await expect(page.getByRole('button', { name: /Take break/i })).toBeVisible();

    const clockOutResponse = page.waitForResponse(response => response.url().endsWith('/api/clock/out'));
    await page.getByRole('button', { name: /Clock out/i }).click();
    expect((await clockOutResponse).status()).toBe(200);
    await expect(page.getByRole('button', { name: /Clock in/i })).toBeVisible();

    const entriesResponse = await request.get(`${API_ORIGIN}/api/clock/entries`, { headers: apiHeaders() });
    expect(entriesResponse.ok(), await entriesResponse.text()).toBeTruthy();
    const entries = (await entriesResponse.json()).entries as any[];
    const ownSequence = entries
        .filter(entry => entry.userId === 'employee-live-1')
        .slice(0, 4)
        .reverse()
        .map(entry => entry.entryType);
    expect(ownSequence).toEqual(['clock_in', 'break_start', 'break_end', 'clock_out']);
});

test('persists a manager-entered punch through the Punch Log UI', async ({ page, request, diagnostics: _diagnostics }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('desktop'), 'Desktop live-flow coverage');
    await authenticate(page);
    await page.goto('/entries');
    await expect(page.getByRole('heading', { name: 'Punch Log' })).toBeVisible();
    await page.getByRole('button', { name: 'Add Manual Entry' }).click();
    await expect(page.getByRole('heading', { name: 'Add Manual Entry' })).toBeVisible();

    const yesterday = new Date(Date.now() - (24 * 60 * 60 * 1000)).toISOString().slice(0, 10);
    await page.locator('input[type="date"]').fill(yesterday);
    await page.locator('input[type="time"]').fill('12:00');
    await page.getByPlaceholder('Explain why this manual entry is needed...').fill('Live browser verification entry.');
    const createResponse = page.waitForResponse(response => response.url().endsWith('/api/clock/manual'));
    await page.getByRole('button', { name: 'Add Entry' }).click();
    expect((await createResponse).status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Add Manual Entry' })).toHaveCount(0);

    const entriesResponse = await request.get(`${API_ORIGIN}/api/clock/entries`, { headers: apiHeaders() });
    const entries = (await entriesResponse.json()).entries as any[];
    expect(entries.some(entry => entry.isManualEntry && entry.note === 'Live browser verification entry.')).toBe(true);
});

test('protects an open timesheet from partial submission and submits a closed period safely', async ({ page, request, diagnostics: _diagnostics }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('desktop'), 'Desktop live-flow coverage');
    const timesheets = await getTimesheets(request);
    const openTimesheet = timesheets.find(sheet => new Date(sheet.endDate) >= new Date());
    const closedTimesheet = timesheets.find(sheet => sheet.periodKey === 'live-e2e-previous');
    expect(openTimesheet).toBeTruthy();
    expect(closedTimesheet).toBeTruthy();

    const rejected = await request.post(`${API_ORIGIN}/api/timesheets/${openTimesheet._id}/submit`, {
        headers: apiHeaders(),
        data: {},
    });
    expect(rejected.status()).toBe(409);
    expect((await rejected.json()).code).toBe('PERIOD_STILL_OPEN');
    const openAfterResponse = await request.get(`${API_ORIGIN}/api/timesheets/${openTimesheet._id}`, { headers: apiHeaders() });
    expect((await openAfterResponse.json()).timesheet.status).toBe('draft');

    await authenticate(page);
    await page.goto('/timesheets');
    await expect(page.getByRole('heading', { name: 'My Timesheets' })).toBeVisible();
    await expect(page.locator(`a[href="/timesheets/${closedTimesheet._id}"]`)).toBeVisible();
    await page.goto(`/timesheets/${closedTimesheet._id}`);
    await expect(page.getByRole('heading', { name: new RegExp(`Week ${closedTimesheet.weekNumber}`) })).toBeVisible();
    page.once('dialog', dialog => dialog.accept());
    const submitResponse = page.waitForResponse(response => response.url().endsWith(`/api/timesheets/${closedTimesheet._id}/submit`));
    await page.getByRole('button', { name: 'Submit for Approval' }).click();
    expect((await submitResponse).status()).toBe(200);
    await expect(page.getByRole('button', { name: 'Recall' })).toBeVisible();

    page.once('dialog', dialog => dialog.accept());
    const recallResponse = page.waitForResponse(response => response.url().endsWith(`/api/timesheets/${closedTimesheet._id}/recall`));
    await page.getByRole('button', { name: 'Recall' }).click();
    expect((await recallResponse).status()).toBe(200);
    await expect(page.getByRole('button', { name: 'Submit for Approval' })).toBeVisible();
});

test('acknowledges a published shift, reviews cover and publishes draft schedule data', async ({ page, request, diagnostics: _diagnostics }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('desktop'), 'Desktop live-flow coverage');
    await authenticate(page);
    await page.goto('/schedule');
    await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();

    const acknowledgeResponse = page.waitForResponse(response => /\/api\/v1\/scheduling\/shifts\/[^/]+\/acknowledge$/.test(response.url()));
    await page.getByRole('button', { name: 'Acknowledge' }).click();
    expect((await acknowledgeResponse).status()).toBe(200);
    await expect(page.getByRole('button', { name: 'Acknowledge' })).toHaveCount(0);

    const reviewResponse = page.waitForResponse(response => /\/api\/v1\/scheduling\/requests\/[^/]+\/review$/.test(response.url()));
    await page.getByRole('button', { name: 'Approve' }).click();
    expect((await reviewResponse).status()).toBe(200);

    const publishResponse = page.waitForResponse(response => response.url().endsWith('/api/v1/scheduling/publish'));
    await page.getByRole('button', { name: 'Publish drafts' }).click();
    expect((await publishResponse).status()).toBe(200);
    await expect(page.getByText(/1 shift published\./)).toBeVisible();

    const shiftsResponse = await request.get(`${API_ORIGIN}/api/v1/scheduling/shifts`, { headers: apiHeaders() });
    const shifts = (await shiftsResponse.json()).shifts as any[];
    expect(shifts.some(shift => shift.userId === 'employee-live-2' && shift.status === 'published')).toBe(true);
});

test('submits an exception correction request with an audit trail', async ({ page, request, diagnostics: _diagnostics }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('desktop'), 'Desktop live-flow coverage');
    await authenticate(page);
    await page.goto('/exceptions');
    await page.getByRole('button', { name: 'Request correction' }).first().click();
    await page.getByRole('textbox').fill('Train cancellation delayed my arrival during the live test.');
    const correctionResponse = page.waitForResponse(response => /\/api\/v1\/exceptions\/[^/]+\/correction-requests$/.test(response.url()));
    await page.getByRole('button', { name: 'Submit request' }).click();
    expect((await correctionResponse).status()).toBe(201);
    await expect(page.getByText('Correction request submitted with a full audit trail.')).toBeVisible();

    const listResponse = await request.get(`${API_ORIGIN}/api/v1/exceptions`, { headers: apiHeaders() });
    const items = (await listResponse.json()).exceptions as any[];
    const corrected = items.find(item => item.correctionRequest?.explanation?.includes('Train cancellation'));
    expect(corrected?.status).toBe('correction_requested');
});

test('stores notification read state and delivery preferences', async ({ page, request, diagnostics: _diagnostics }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('desktop'), 'Desktop live-flow coverage');
    await authenticate(page);
    await page.goto('/notifications');
    await expect(page.getByText('Timesheet due')).toBeVisible();
    await page.getByRole('button', { name: 'Mark all read' }).click();
    await page.getByRole('button', { name: 'Save preferences' }).click();
    await expect(page.getByText('Preferences saved.')).toBeVisible();

    const notificationsResponse = await request.get(`${API_ORIGIN}/api/v1/notifications`, { headers: apiHeaders() });
    const notifications = (await notificationsResponse.json()).notifications as any[];
    expect(notifications.every(item => item.readAt)).toBe(true);
});

test('records transparent presence evidence and a privacy request', async ({ page, request, diagnostics: _diagnostics }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('desktop'), 'Desktop live-flow coverage');
    await authenticate(page);
    await page.goto('/presence');
    await expect(page.getByRole('heading', { name: 'My application presence' })).toBeVisible();
    await expect(page.getByText(/keystrokes.*field values.*screenshots/)).toBeVisible();
    await expect(page.getByText('time-attendance').first()).toBeVisible();

    page.once('dialog', dialog => dialog.accept('I need a copy for my records.'));
    const privacyResponse = page.waitForResponse(response => response.url().endsWith('/api/v1/presence/privacy-requests') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'access' }).click();
    expect((await privacyResponse).status()).toBe(201);
    await expect(page.getByText('Your request was submitted to HR.')).toBeVisible();

    const evidenceResponse = await request.get(`${API_ORIGIN}/api/v1/presence/me`, { headers: apiHeaders() });
    const evidence = await evidenceResponse.json();
    expect(evidence.sessions.some((session: any) => session.appId === 'time-attendance')).toBe(true);
});

test('loads team status and approves a persisted employee timesheet', async ({ page, request, diagnostics: _diagnostics }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('desktop'), 'Desktop live-flow coverage');
    await authenticate(page);
    await page.goto('/team');
    await expect(page.getByRole('heading', { name: 'Team Attendance' })).toBeVisible();
    await expect(page.getByText('Jamie Live')).toBeVisible();
    await page.getByRole('button', { name: 'View' }).click();
    await expect(page.getByRole('heading', { name: 'Jamie Live' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Today Activity Timeline' })).toBeVisible();

    await page.goto('/approvals');
    await expect(page.getByText('Jamie Live')).toBeVisible();
    const approveResponse = page.waitForResponse(response => /\/api\/approvals\/[^/]+\/approve$/.test(response.url()));
    await page.getByRole('button', { name: 'Approve' }).click();
    expect((await approveResponse).status()).toBe(200);
    await expect(page.getByText('All caught up!')).toBeVisible();

    const historyResponse = await request.get(`${API_ORIGIN}/api/approvals/history`, { headers: apiHeaders() });
    const history = (await historyResponse.json()).timesheets as any[];
    expect(history.some(item => item.userId === 'employee-live-2' && ['approved', 'payroll_pending'].includes(item.status))).toBe(true);
});

test('runs reports, real Excel exports, rule simulation and policy persistence', async ({ page, request, diagnostics: _diagnostics }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('desktop'), 'Desktop live-flow coverage');
    await authenticate(page);

    await page.goto('/reports');
    await expect(page.getByRole('heading', { name: 'Reports & Analytics' })).toBeVisible();
    await expect(page.getByText('Alex Live').first()).toBeVisible();
    const reportDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export/i }).first().click();
    const downloadedReport = await reportDownload;
    expect(downloadedReport.suggestedFilename()).toMatch(/attendance.*\.xlsx$/i);

    await page.goto('/admin/rule-packs');
    await expect(page.getByRole('heading', { name: 'Rule Pack Studio' })).toBeVisible();
    await page.getByRole('button', { name: 'Run simulation' }).click();
    await expect(page.getByText('Regular: 0h')).toBeVisible();

    await page.goto('/admin/settings');
    await expect(page.getByRole('heading', { name: 'Attendance Settings' })).toBeVisible();
    const saveResponse = page.waitForResponse(response => response.url().endsWith('/api/admin/attendance-policy') && response.request().method() === 'PUT');
    await page.getByRole('button', { name: /Save/i }).click();
    expect((await saveResponse).status()).toBe(200);

    const policyResponse = await request.get(`${API_ORIGIN}/api/admin/attendance-policy`, { headers: apiHeaders() });
    const policy = (await policyResponse.json()).policy;
    expect(policy.timezone).toBe('Europe/London');
    expect(policy.timesheetSettings.periodType).toBe('weekly');
});

test('lets a worker stop a live session after the current period is protected', async ({ page, diagnostics: _diagnostics }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('desktop'), 'Desktop live-flow coverage');
    const mongoUri = process.env.LIVE_MONGODB_URI || 'mongodb://127.0.0.1:27017/time-attendance-live-e2e';
    expect(mongoUri).toMatch(/live-e2e|ta-e2e/i);

    // This is deliberately a real Mongo transition, not an HTTP mock: it
    // recreates the production failure where a session remains active after
    // its timesheet has already become protected.
    const { TimeEntry, Timesheet } = require('../../backend/models');
    const mongoose = Timesheet.db.base;
    await mongoose.connect(mongoUri);
    const source = await Timesheet.findOne({
        organizationId: 'org-live-e2e',
        userId: 'employee-live-1',
        periodKey: { $ne: 'live-e2e-previous' },
        supersedesTimesheetId: null,
    }).sort({ startDate: -1 });
    expect(source).toBeTruthy();
    const protectedSummary = source.summary.toObject();
    source.status = 'locked';
    source.lockedAt = new Date();
    source.lockedBy = 'live-e2e';
    await source.save();
    const clockIn = await TimeEntry.create({
        userId: 'employee-live-1',
        userEmail: 'alex.live@example.test',
        userName: 'Alex Live',
        organizationId: 'org-live-e2e',
        organizationName: 'Seemplify Live E2E',
        entryType: 'clock_in',
        timestamp: new Date(Date.now() - (30 * 60 * 1000)),
        timezone: 'Europe/London',
        source: 'web',
        workMode: 'remote',
    });
    await mongoose.disconnect();

    await authenticate(page);
    await page.goto('/dashboard');
    await expect(page.getByRole('button', { name: /Clock out/i })).toBeVisible();
    const clockOutResponsePromise = page.waitForResponse(response => response.url().endsWith('/api/clock/out'));
    await page.getByRole('button', { name: /Clock out/i }).click();
    const clockOutResponse = await clockOutResponsePromise;
    expect(clockOutResponse.status(), await clockOutResponse.text()).toBe(200);
    const body = await clockOutResponse.json();
    expect(body.adjustment).toMatchObject({ required: true, state: 'version_created', version: 2 });
    await expect(page.getByRole('button', { name: /Clock in/i })).toBeVisible();

    await mongoose.connect(mongoUri);
    const [protectedAfter, adjustment, clockOut] = await Promise.all([
        Timesheet.findById(source._id).lean(),
        Timesheet.findOne({ supersedesTimesheetId: source._id, status: 'adjusted' }).lean(),
        TimeEntry.findOne({
            userId: 'employee-live-1',
            organizationId: 'org-live-e2e',
            entryType: 'clock_out',
            timestamp: { $gte: clockIn.timestamp },
        }).sort({ timestamp: -1 }).lean(),
    ]);
    expect(protectedAfter.status).toBe('locked');
    expect(protectedAfter.summary).toMatchObject(protectedSummary);
    expect(adjustment).toMatchObject({ status: 'adjusted', version: 2 });
    expect(clockOut.protectedPeriodAdjustment).toMatchObject({
        sourceTimesheetStatus: 'locked',
        state: 'version_created',
    });
    await mongoose.disconnect();
});

test('renders authenticated navigation and core workspaces at a mobile viewport', async ({ page, diagnostics: _diagnostics }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile-only live responsive coverage');
    await authenticate(page);
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: /Good .*Alex\./ })).toBeVisible();
    await page.getByRole('button', { name: /Open navigation/ }).click();
    await expect(page.getByText('Navigation', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Schedule' }).last().click();
    await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
});
