import { expect, test as base, type Page, type Route } from '@playwright/test';

const NOW = '2026-08-09T09:00:00.000Z';
const TOMORROW = '2026-08-10T09:00:00.000Z';
const TOMORROW_END = '2026-08-10T17:00:00.000Z';

type MockState = {
    calls: string[];
    unhandled: string[];
    browserErrors: string[];
    clockedIn: boolean;
    onBreak: boolean;
    lockedClockOut: boolean;
    notificationRead: boolean;
    exceptionStatus: string;
    shiftAcknowledged: boolean;
    rulePacks: any[];
};

const organization = { id: 'org-1', name: 'Seemplify Test Org', role: 'admin' };
const user = {
    id: 'employee-1',
    email: 'alex@example.com',
    name: 'Alex Morgan',
    organizations: [organization],
    teams: [{ id: 'team-1', name: 'Operations', organizationId: 'org-1', role: 'line_manager' }],
};

const timesheet = {
    _id: 'timesheet-1',
    userId: 'employee-1',
    userName: 'Alex Morgan',
    weekNumber: 32,
    year: 2026,
    startDate: '2026-08-03T00:00:00.000Z',
    endDate: '2026-08-09T23:59:59.999Z',
    status: 'draft',
    totalHours: 37.5,
    daysWorked: 5,
    overtimeHours: 0,
    entries: [],
    dailyEntries: [],
    summary: { totalHours: 37.5, daysWorked: 5, overtimeHours: 0 },
    approvalWorkflow: { currentLevel: 0, levels: [] },
};

const policy = {
    workSchedule: {
        workDays: [1, 2, 3, 4, 5],
        timezone: 'Europe/London',
        defaultShift: { name: 'Standard shift', startTime: '09:00', endTime: '17:00', breakDuration: 60 },
    },
    overtime: { enabled: true, dailyThreshold: 8, weeklyThreshold: 40, requireApproval: true },
    timesheetSettings: {
        periodType: 'weekly', autoSubmit: false, autoApprove: false, submissionDeadline: 2, approvalDeadline: 3,
        approvalLevels: [{ name: 'Line manager', approverType: 'line_manager' }],
    },
    notifications: { managerReports: { enabled: true, frequency: 'weekly', sendHourUtc: 9, includeExcel: true } },
    presence: { enabled: true, rawEventRetentionDays: 90, dailySummaryRetentionDays: 730 },
    geofencing: { enabled: true, enforceGeofence: true, requireLocation: true, locations: [] },
};

const rulePack = {
    _id: 'rule-pack-1', key: 'ng-default', name: 'Nigeria default', version: 1, status: 'published',
    effectiveFrom: '2026-01-01T00:00:00.000Z', description: 'Reviewed implementation template.',
    jurisdiction: { countryCode: 'NG' }, scope: {}, rules: { overtime: { weeklyThresholdMinutes: 2400 } },
    sources: [{ title: 'Implementation source', url: 'https://example.com/source', note: 'Review before production use.' }],
};

function corsHeaders(route: Route) {
    return {
        'access-control-allow-origin': route.request().headers().origin || 'http://127.0.0.1:5011',
        'access-control-allow-credentials': 'true',
        'access-control-allow-headers': 'authorization, content-type',
        'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    };
}

async function json(route: Route, body: unknown, status = 200) {
    await route.fulfill({ status, contentType: 'application/json', headers: corsHeaders(route), body: JSON.stringify(body) });
}

async function installApiMock(page: Page, state: MockState) {
    await page.route('http://localhost:5010/api/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        const path = url.pathname;
        const method = request.method();
        state.calls.push(`${method} ${path}${url.search}`);

        if (method === 'OPTIONS') {
            await route.fulfill({ status: 204, headers: corsHeaders(route), body: '' });
            return;
        }

        if (method === 'GET' && path === '/api/auth/oidc/start') return route.fulfill({ status: 200, contentType: 'text/html', body: '<main><h1>Mock Identity Provider sign-in</h1></main>' });
        if (method === 'GET' && path === '/api/auth/me') return json(route, { user, currentOrganization: organization });
        if (method === 'POST' && path === '/api/auth/logout') return json(route, { success: true });

        if (method === 'POST' && path === '/api/v1/presence/sessions') return json(route, { session: { _id: 'presence-session-1' } });
        if (method === 'POST' && /^\/api\/v1\/presence\/sessions\/[^/]+\/(heartbeat|activity|end)$/.test(path)) return json(route, { success: true });

        if (method === 'GET' && path === '/api/attendance/dashboard') {
            return json(route, {
                clock: { isClockedIn: state.clockedIn, isOnBreak: state.onBreak, clockInTime: state.clockedIn ? NOW : null },
                today: { timeWorked: { hours: 2, minutes: 120 }, formatted: '02:00', breakMinutes: 15 },
                week: { totalHours: 37.5, daysWorked: 5, averageHoursPerDay: 7.5 },
                currentTimesheet: { _id: 'timesheet-1', weekNumber: 32, status: 'draft' },
                pendingApprovals: 1,
            });
        }
        if (method === 'GET' && path === '/api/clock/status') {
            return json(route, {
                isClockedIn: state.clockedIn, isOnBreak: state.onBreak,
                lastClockEntry: state.clockedIn ? { timestamp: NOW } : null,
                timeWorked: { hours: 2, minutes: 120 },
            });
        }
        if (method === 'GET' && path === '/api/clock/events') return route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'event: ready\ndata: {"connected":true}\n\n' });
        if (method === 'POST' && path === '/api/clock/in') { state.clockedIn = true; return json(route, { success: true }); }
        if (method === 'POST' && path === '/api/clock/out') {
            state.clockedIn = false;
            state.onBreak = false;
            return json(route, {
                success: true,
                adjustment: state.lockedClockOut
                    ? { required: true, state: 'version_created', timesheetId: 'timesheet-adjustment-2', version: 2 }
                    : null,
            });
        }
        if (method === 'POST' && path === '/api/clock/break/start') { state.onBreak = true; return json(route, { success: true }); }
        if (method === 'POST' && path === '/api/clock/break/end') { state.onBreak = false; return json(route, { success: true }); }
        if (method === 'GET' && path === '/api/clock/entries') {
            return json(route, { entries: [{ _id: 'entry-1', entryType: 'clock_in', timestamp: NOW, source: 'web', location: { address: 'London office', verified: true } }] });
        }
        if (method === 'POST' && path === '/api/clock/manual') return json(route, { success: true });

        if (method === 'GET' && path === '/api/timesheets') return json(route, { timesheets: [timesheet] });
        if (method === 'GET' && path === '/api/timesheets/current') return json(route, { timesheet });
        if (method === 'GET' && path === '/api/timesheets/timesheet-1') return json(route, { timesheet });
        if (method === 'POST' && /^\/api\/timesheets\/timesheet-1\/(submit|recall)$/.test(path)) return json(route, { timesheet: { ...timesheet, status: path.endsWith('/submit') ? 'submitted' : 'draft' } });
        if (method === 'GET' && path === '/api/timesheets/timesheet-1/export') return route.fulfill({ status: 200, headers: { ...corsHeaders(route), 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': 'attachment; filename="timesheet-1.xlsx"' }, body: 'mock workbook' });

        if (method === 'GET' && path === '/api/approvals') return json(route, { timesheets: [timesheet] });
        if (method === 'GET' && path === '/api/approvals/history') return json(route, { timesheets: [{ ...timesheet, status: 'approved' }] });
        if (/^\/api\/approvals\/timesheet-1\/(approve|reject|revert)$/.test(path)) return json(route, { success: true });
        if (method === 'DELETE' && path === '/api/approvals/timesheet-1') return json(route, { success: true });

        if (method === 'GET' && path === '/api/attendance/team') {
            return json(route, {
                team: [
                    { userId: 'employee-2', userName: 'Jamie Lee', userEmail: 'jamie@example.com', teamName: 'Operations', status: 'working', clockInAt: NOW, clockInLocation: { address: 'London office' }, workedMinutesToday: 120, lastActivity: NOW, lastActivityType: 'clock_in' },
                    { userId: 'employee-3', userName: 'Morgan Reed', userEmail: 'morgan@example.com', teamName: 'Operations', status: 'clocked_out', clockInAt: NOW, clockOutAt: TOMORROW, clockInLocation: { address: 'Client site' }, clockOutLocation: { address: 'Client site' }, workedMinutesToday: 480, lastActivity: TOMORROW, lastActivityType: 'clock_out' },
                    { userId: 'employee-4', userName: 'Casey Patel', userEmail: 'casey@example.com', teamName: 'Operations', status: 'not_clocked_in', workedMinutesToday: 0 },
                ],
                summary: { total: 3, working: 1, onBreak: 0, clockedOut: 2, notClockedIn: 1 },
            });
        }
        if (method === 'POST' && path === '/api/attendance/team/employee-2/notify-clock-out') return json(route, { message: 'Reminder sent to Jamie Lee.' });
        if (method === 'GET' && path === '/api/attendance/team/export') return route.fulfill({ status: 200, headers: { ...corsHeaders(route), 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, body: 'mock workbook' });

        if (method === 'GET' && path === '/api/v1/scheduling/templates') return json(route, { templates: [{ _id: 'template-1', name: 'Day shift' }] });
        if (method === 'GET' && path === '/api/v1/scheduling/shifts') {
            if (url.searchParams.get('open') === 'true') return json(route, { shifts: [{ _id: 'shift-open', userId: null, startAt: TOMORROW, endAt: TOMORROW_END, workMode: 'office', status: 'published' }] });
            return json(route, { shifts: [{ _id: 'shift-1', userId: 'employee-1', startAt: TOMORROW, endAt: TOMORROW_END, workMode: 'remote', status: 'published', acknowledgement: { status: state.shiftAcknowledged ? 'accepted' : 'pending' } }] });
        }
        if (method === 'GET' && path === '/api/v1/scheduling/requests') return json(route, { requests: [{ _id: 'request-1', type: 'cover', status: 'pending' }] });
        if (method === 'POST' && path === '/api/v1/scheduling/publish') return json(route, { publishedCount: 2 });
        if (method === 'POST' && path === '/api/v1/scheduling/shifts/shift-1/acknowledge') { state.shiftAcknowledged = true; return json(route, { success: true }); }
        if (method === 'POST' && path === '/api/v1/scheduling/shifts') return json(route, { shift: { _id: 'shift-new' } });
        if (method === 'POST' && path === '/api/v1/scheduling/requests') return json(route, { request: { _id: 'request-new' } });
        if (method === 'POST' && path === '/api/v1/scheduling/requests/request-1/review') return json(route, { success: true });

        if (method === 'GET' && path === '/api/v1/exceptions') {
            return json(route, { disclaimer: 'Exceptions are review flags only and never automatic decisions.', exceptions: [{ _id: 'exception-1', type: 'late_arrival', severity: 'medium', occurrenceDate: NOW, status: state.exceptionStatus, rule: { code: 'LATE-01' }, explanation: { message: 'Arrival was outside the configured grace period.' }, correctionRequest: state.exceptionStatus === 'correction_requested' ? { explanation: 'Train cancellation delayed arrival.' } : undefined }] });
        }
        if (method === 'POST' && path === '/api/v1/exceptions/exception-1/correction-requests') { state.exceptionStatus = 'correction_requested'; return json(route, { success: true }); }
        if (method === 'POST' && path === '/api/v1/exceptions/exception-1/review') return json(route, { success: true });

        if (method === 'GET' && path === '/api/v1/presence/notice') return json(route, { purpose: 'Shows transparent application-session evidence alongside attendance.', rawRetentionDays: 90, dailySummaryRetentionDays: 365, captured: ['session start and end', 'visible-tab heartbeat'], excluded: ['keystrokes', 'screenshots', 'field values'] });
        if (method === 'GET' && path === '/api/v1/presence/me') return json(route, { comparison: { state: 'matched', sessionsDuringAttendance: 1, appsSeen: ['time-attendance'], missingExpectedApps: [] }, sessions: [{ _id: 'evidence-1', appId: 'time-attendance', startedAt: NOW, status: 'active', lastActivityAt: NOW }] });
        if (method === 'GET' && path === '/api/v1/presence/me/export') return json(route, { sessions: [], summaries: [] });
        if (method === 'GET' && path === '/api/v1/presence/privacy-requests') return json(route, { requests: [] });
        if (method === 'POST' && path === '/api/v1/presence/privacy-requests') return json(route, { request: { _id: 'privacy-1' } });

        if (method === 'GET' && path === '/api/v1/notifications') return json(route, { notifications: [{ _id: 'notification-1', title: 'Timesheet due', message: 'Submit by 17:00.', priority: 'normal', createdAt: NOW, actionUrl: '/timesheets', readAt: state.notificationRead ? NOW : null }] });
        if (method === 'GET' && path === '/api/v1/notifications/preferences/me') return json(route, { preferences: { timezone: 'Europe/London', channels: { inApp: true, email: true, browserPush: false }, quietHours: { enabled: true, start: '22:00', end: '07:00' } }, vapidPublicKey: null });
        if (method === 'POST' && path === '/api/v1/notifications/read-all') { state.notificationRead = true; return json(route, { success: true }); }
        if (method === 'POST' && path === '/api/v1/notifications/notification-1/read') { state.notificationRead = true; return json(route, { success: true }); }
        if (method === 'PUT' && path === '/api/v1/notifications/preferences/me') return json(route, { success: true });

        if (method === 'GET' && path === '/api/admin/attendance-policy') return json(route, { policy });
        if (method === 'PUT' && path === '/api/admin/attendance-policy') return json(route, { policy });
        if (path.startsWith('/api/admin/geofence-locations')) return json(route, { policy });

        if (method === 'GET' && path === '/api/v1/rule-packs') return json(route, { packs: state.rulePacks });
        if (method === 'POST' && path === '/api/v1/rule-packs/seed-defaults') {
            const inserted = state.rulePacks.length ? 0 : 31;
            if (!state.rulePacks.length) state.rulePacks = [rulePack];
            return json(route, { total: 31, inserted, existing: 31 - inserted }, inserted ? 201 : 200);
        }
        if (method === 'POST' && path === '/api/v1/rule-packs') {
            const body = request.postDataJSON();
            const pack = { ...body, _id: 'rule-pack-custom', version: 1, status: 'draft', scope: { organizationId: 'org-1' } };
            state.rulePacks.push(pack);
            return json(route, { pack, validation: { valid: true, errors: [] } }, 201);
        }
        const requestedRulePack = state.rulePacks.find(pack => path === `/api/v1/rule-packs/${pack._id}`);
        if (method === 'GET' && requestedRulePack) return json(route, { pack: requestedRulePack, resolved: { rules: requestedRulePack.rules } });
        if (method === 'POST' && path === '/api/v1/rule-packs/rule-pack-1/simulate') return json(route, { result: { totals: { regularHours: 8, overtimeHours: 0, exceptionCount: 0 }, dailyEntries: [] } });
        if (method === 'POST' && path === '/api/v1/rule-packs/rule-pack-1/clone') return json(route, { pack: { ...rulePack, _id: 'rule-pack-org', name: 'Nigeria default — organization copy', status: 'draft', scope: { organizationId: 'org-1' } } });

        if (method === 'GET' && path === '/api/reports/exceptions') return json(route, { summary: { totalExceptions: 0, affectedPeople: 0, affectedDays: 0 }, rows: [] });
        if (method === 'GET' && path === '/api/reports/attendance') return json(route, { report: [{ userName: 'Alex Morgan', teamName: 'Operations', daysWorked: 5, avgStartTime: '09:00', avgEndTime: '17:00', totalHours: 37.5 }] });
        if (method === 'GET' && path === '/api/reports/overtime') return json(route, { report: [] });
        if (method === 'GET' && path === '/api/reports/lateness') return json(route, { report: [] });
        if (method === 'GET' && path === '/api/reports/geofence-violations') return json(route, { totalViolations: 0, violations: [] });
        if (method === 'GET' && path === '/api/reports/location-accuracy') return json(route, { summary: {}, byUser: [] });
        if (method === 'GET' && path === '/api/reports/analytics') return json(route, { exceptions: [], timesheetAging: [], payrollTransfers: [], presenceEvidenceHealth: [] });
        if (method === 'GET' && path === '/api/reports/capacity-forecast') return json(route, { explanation: 'Forecast uses published schedules and configured overtime thresholds.', thresholdHours: 40, rows: [] });
        if (method === 'GET' && path === '/api/reports/attendance/export') return route.fulfill({ status: 200, headers: { ...corsHeaders(route), 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, body: 'mock workbook' });

        state.unhandled.push(`${method} ${path}${url.search}`);
        return json(route, { error: 'Unhandled Playwright mock route' }, 501);
    });
}

const test = base.extend<{ mockState: MockState }>({
    mockState: async ({ page }, use) => {
        const state: MockState = {
            calls: [], unhandled: [], browserErrors: [], clockedIn: false, onBreak: false,
            lockedClockOut: false,
            notificationRead: false, exceptionStatus: 'open', shiftAcknowledged: false, rulePacks: [rulePack],
        };
        page.on('pageerror', error => state.browserErrors.push(`pageerror: ${error.message}`));
        page.on('console', message => {
            if (message.type() === 'error') state.browserErrors.push(`console: ${message.text()}`);
        });
        await installApiMock(page, state);
        await use(state);
        expect(state.unhandled, 'Every browser API request must have an explicit contract fixture').toEqual([]);
        expect(state.browserErrors, 'The page must not emit browser runtime errors').toEqual([]);
    },
});

async function authenticate(page: Page) {
    await page.addInitScript(() => localStorage.setItem('access_token', 'playwright-test-token'));
}

test('redirects an unauthenticated employee to the login screen', async ({ page, mockState: _mockState }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/api\/auth\/oidc\/start\?returnTo=/);
    await expect(page.getByRole('heading', { name: 'Mock Identity Provider sign-in' })).toBeVisible();
});

test('clocks in from the dashboard and refreshes attendance state', async ({ page, mockState }) => {
    await authenticate(page);
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: /Good .*Alex/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clock In' })).toBeVisible();
    await page.getByRole('button', { name: 'Clock In' }).click();
    await expect(page.getByRole('button', { name: 'Clock Out' })).toBeVisible();
    expect(mockState.calls).toContain('POST /api/clock/in');
});

test('allows an employee to clock out when the current timesheet is protected', async ({ page, mockState }) => {
    mockState.clockedIn = true;
    mockState.lockedClockOut = true;
    await authenticate(page);
    await page.goto('/dashboard');

    await expect(page.getByRole('button', { name: 'Clock Out' })).toBeVisible();
    await page.getByRole('button', { name: 'Clock Out' }).click();
    await expect(page.getByRole('button', { name: 'Clock In' })).toBeVisible();
    expect(mockState.calls).toContain('POST /api/clock/out');
});

test('covers the employee attendance, timesheet, scheduling, exception and presence workspaces', async ({ page, mockState: _mockState }) => {
    await authenticate(page);
    const routes = [
        ['/timesheets', 'My Timesheets'],
        ['/timesheets/timesheet-1', 'Week 32'],
        ['/entries', 'Punch Log'],
        ['/schedule', 'Schedule'],
        ['/exceptions', 'Attendance exceptions'],
        ['/presence', 'My application presence'],
        ['/notifications', 'Notifications'],
    ] as const;
    for (const [path, heading] of routes) {
        await page.goto(path);
        await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    }
});

test('acknowledges a shift and publishes manager schedule changes', async ({ page, mockState }) => {
    await authenticate(page);
    await page.goto('/schedule');
    await page.getByRole('button', { name: 'Acknowledge' }).click();
    await expect(page.getByRole('button', { name: 'Acknowledge' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Publish drafts' }).click();
    await expect(page.getByText('2 shifts published.')).toBeVisible();
    expect(mockState.shiftAcknowledged).toBe(true);
});

test('submits an explainable correction request', async ({ page, mockState }) => {
    await authenticate(page);
    await page.goto('/exceptions');
    await page.getByRole('button', { name: 'Request correction' }).click();
    await page.getByRole('textbox').fill('Train cancellation delayed my arrival.');
    await page.getByRole('button', { name: 'Submit request' }).click();
    await expect(page.getByText('Correction request submitted with a full audit trail.')).toBeVisible();
    expect(mockState.exceptionStatus).toBe('correction_requested');
});

test('updates notification delivery preferences and read state', async ({ page, mockState }) => {
    await authenticate(page);
    await page.goto('/notifications');
    await expect(page.getByText('Timesheet due')).toBeVisible();
    await page.getByRole('button', { name: 'Mark all read' }).click();
    await page.getByRole('button', { name: 'Save preferences' }).click();
    await expect(page.getByText('Preferences saved.')).toBeVisible();
    expect(mockState.notificationRead).toBe(true);
});

test('shows transparent presence evidence and privacy controls', async ({ page, mockState: _mockState }) => {
    await authenticate(page);
    await page.goto('/presence');
    await expect(page.getByText('Expected evidence available')).toBeVisible();
    await expect(page.getByText(/keystrokes.*screenshots.*field values/)).toBeVisible();
    page.once('dialog', dialog => dialog.accept('I need a copy for my records.'));
    await page.getByRole('button', { name: 'access' }).click();
    await expect(page.getByText('Your request was submitted to HR.')).toBeVisible();
});

test('covers manager approvals, team status, reports, rule packs and policy settings', async ({ page, mockState: _mockState }) => {
    await authenticate(page);
    const routes = [
        ['/approvals', 'Approvals'],
        ['/team', 'Team Attendance'],
        ['/reports', 'Reports & Analytics'],
        ['/admin/rule-packs', 'Rule Pack Studio'],
        ['/admin/settings', 'Attendance Settings'],
    ] as const;
    for (const [path, heading] of routes) {
        await page.goto(path);
        await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    }
});

test('keeps the team attendance workspace readable at wide and standard desktop widths', async ({ page, mockState: _mockState }) => {
    await authenticate(page);
    await page.addInitScript(() => localStorage.setItem('seemplify-theme', 'light'));

    for (const viewport of [{ width: 2048, height: 1152 }, { width: 1440, height: 900 }]) {
        await page.setViewportSize(viewport);
        await page.goto('/team');
        await expect(page.getByRole('heading', { name: 'Team Attendance' })).toBeVisible();
        await expect(page.getByText('Clocked Out', { exact: true })).toBeVisible();
        await expect(page.getByText('Not Clocked In', { exact: true })).toBeVisible();

        const tableScroll = page.getByTestId('team-table-scroll');
        const dimensions = await tableScroll.evaluate(element => ({
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
        }));
        expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);

        const statusCells = page.locator('tbody td:nth-child(3) span');
        for (let index = 0; index < await statusCells.count(); index += 1) {
            const metrics = await statusCells.nth(index).evaluate(element => ({
                clientWidth: element.clientWidth,
                scrollWidth: element.scrollWidth,
                height: element.getBoundingClientRect().height,
            }));
            expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
            expect(metrics.height).toBeLessThanOrEqual(28);
        }

        const pageWidth = await page.evaluate(() => ({
            viewport: window.innerWidth,
            document: document.documentElement.scrollWidth,
        }));
        expect(pageWidth.document).toBeLessThanOrEqual(pageWidth.viewport);
    }
});

test('approves a pending timesheet and runs a rule-pack impact preview', async ({ page, mockState }) => {
    await authenticate(page);
    await page.goto('/approvals');
    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText('All caught up!')).toBeVisible();
    expect(mockState.calls).toContain('POST /api/approvals/timesheet-1/approve');

    await page.goto('/admin/rule-packs');
    await page.getByRole('button', { name: 'Run simulation' }).click();
    await expect(page.getByText('Regular: 8h')).toBeVisible();
});

test('recovers an empty rule-pack catalog and creates a custom draft', async ({ page, mockState }) => {
    mockState.rulePacks = [];
    await authenticate(page);
    await page.goto('/admin/rule-packs');

    await expect(page.getByRole('button', { name: 'Nigeria default' })).toBeVisible();
    expect(mockState.calls).toContain('POST /api/v1/rule-packs/seed-defaults');

    await page.getByRole('button', { name: 'New custom pack' }).click();
    await page.getByLabel('Name').fill('London operations rules');
    await page.getByLabel('ISO country code').fill('GB');
    await page.getByLabel('Authoritative source title').fill('Working Time Regulations 1998');
    await page.getByRole('button', { name: 'Create draft' }).click();

    await expect(page.getByRole('heading', { name: 'London operations rules' })).toBeVisible();
    expect(mockState.calls).toContain('POST /api/v1/rule-packs');
});

test('renders navigation and core workflows at a mobile viewport', async ({ page, mockState: _mockState }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Mobile-only responsive coverage');
    await authenticate(page);
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: /Good .*Alex/ })).toBeVisible();
    await page.getByRole('button', { name: /Open navigation/ }).click();
    await expect(page.getByText('Navigation', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Schedule' }).last().click();
    await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
});

test('keeps desktop navigation clear of account controls at the reported viewport', async ({ page, mockState: _mockState }) => {
    await page.setViewportSize({ width: 1573, height: 900 });
    await authenticate(page);
    await page.goto('/dashboard');

    const moreButton = page.getByRole('button', { name: 'More management pages' });
    const headerActions = page.getByTestId('header-actions');
    await expect(moreButton).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open navigation' })).toBeHidden();

    const [moreBox, actionsBox] = await Promise.all([
        moreButton.boundingBox(),
        headerActions.boundingBox(),
    ]);
    expect(moreBox).not.toBeNull();
    expect(actionsBox).not.toBeNull();
    expect(moreBox!.x + moreBox!.width).toBeLessThanOrEqual(actionsBox!.x);

    await moreButton.click();
    await expect(page.getByRole('menuitem', { name: 'Reports' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Rule Packs' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Settings' })).toBeVisible();
});

test('uses the navigation menu before the desktop header becomes crowded', async ({ page, mockState: _mockState }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await authenticate(page);
    await page.goto('/dashboard');

    await expect(page.getByTestId('desktop-navigation')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
});
