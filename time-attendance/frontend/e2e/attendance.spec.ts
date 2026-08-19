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
    onLeave: boolean;
    notificationRead: boolean;
    exceptionStatus: string;
    shiftAcknowledged: boolean;
    rosterSynced: boolean;
    rosterSyncCount: number;
    coverRequested: boolean;
    requestReviewed: boolean;
    approvalConflict: boolean;
    timesheetStatus: string;
    timesheetPayrollState: string;
    timesheetCorrectionRequested: boolean;
    managerExceptionFlagged: boolean;
    rulePacks: any[];
    locationEnabled: boolean;
    clockBodies: any[];
    shiftBodies: any[];
    policyBodies: any[];
    rulePackBodies: any[];
    rulePackAssignmentBodies: any[];
};

const organization = { id: 'org-1', name: 'Seemplify Test Org', role: 'admin' };
const user = {
    id: 'employee-1',
    email: 'alex@example.com',
    name: 'Alex Morgan',
    organizations: [organization],
    teams: [{ id: 'team-1', name: 'Operations', organizationId: 'org-1', role: 'line_manager' }],
};
const attendanceAccess = {
    roleKeys: ['employee', 'line_manager', 'attendance_admin'],
    roleNames: ['Employee', 'Line Manager', 'Attendance Admin'],
    permissions: ['employee.view', 'corrections.request', 'management.view', 'team.view', 'timesheets.approve', 'corrections.review', 'reports.view', 'policy.view', 'policy.manage', 'access.manage'],
    scopes: { 'corrections.review': 'organization', 'timesheets.approve': 'organization' },
    canAccessManagement: true,
    canManageAccess: true,
};
const attendanceRoles = [
    { key: 'employee', name: 'Employee', scope: 'self', permissions: ['employee.view', 'corrections.request'], locked: true },
    { key: 'line_manager', name: 'Line Manager', scope: 'reports', permissions: ['management.view', 'team.view', 'timesheets.approve', 'corrections.review'], locked: false },
    { key: 'hr_manager', name: 'HR Manager', scope: 'organization', permissions: ['management.view', 'team.view', 'timesheets.approve', 'corrections.review', 'reports.view', 'policy.view'], locked: false },
    { key: 'attendance_admin', name: 'Attendance Admin', scope: 'organization', permissions: attendanceAccess.permissions, locked: true },
];

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
    dailyEntries: [
        {
            date: '2026-08-03T00:00:00.000Z', status: 'present', totalHours: 7.5, breakDuration: 30,
            clockIn: '2026-08-03T08:00:00.000Z', clockOut: '2026-08-03T16:00:00.000Z',
            clockInLocation: { latitude: 51.5074, longitude: -0.1278, accuracy: 18, verified: true, address: 'London office, Westminster' },
            clockOutLocation: { latitude: 51.5074, longitude: -0.1278, accuracy: 22, verified: true, address: 'London office, Westminster' },
            exceptions: [],
        },
        {
            date: '2026-08-04T00:00:00.000Z', status: 'leave', totalHours: 0, breakDuration: 0,
            clockIn: null, clockOut: null, exceptions: [],
        },
        {
            date: '2026-08-05T00:00:00.000Z', status: 'present', totalHours: 8, breakDuration: 0,
            clockIn: '2026-08-05T08:00:00.000Z', clockOut: '2026-08-05T16:00:00.000Z', exceptions: [],
        },
    ],
    summary: { totalHours: 37.5, daysWorked: 5, daysOnLeave: 1, overtimeHours: 0 },
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
        approvalMode: 'single',
        approvalLevels: [{ name: 'Line manager', approverType: 'line_manager' }],
    },
    notifications: { managerReports: { enabled: true, frequency: 'weekly', sendHourUtc: 9, includeExcel: true } },
    presence: { enabled: true, rawEventRetentionDays: 90, dailySummaryRetentionDays: 730 },
    geofencing: { enabled: false, enforced: false, locations: [] },
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
        if (method === 'GET' && path === '/api/auth/me') {
            const authenticatedUser = state.approvalConflict ? { ...user, id: 'manager-1', email: 'manager@example.com', name: 'Morgan Manager' } : user;
            return json(route, { user: authenticatedUser, currentOrganization: organization, attendanceAccess });
        }
        if (method === 'POST' && path === '/api/auth/logout') return json(route, { success: true });

        if (method === 'POST' && path === '/api/v1/presence/sessions') return json(route, { session: { _id: 'presence-session-1' } });
        if (method === 'POST' && /^\/api\/v1\/presence\/sessions\/[^/]+\/(heartbeat|activity|end)$/.test(path)) return json(route, { success: true });

        if (method === 'GET' && path === '/api/attendance/dashboard') {
            return json(route, {
                clock: { isClockedIn: state.clockedIn, isOnBreak: state.onBreak, clockInTime: state.clockedIn ? NOW : null },
                today: { timeWorked: { hours: 2, minutes: 120 }, formatted: '02:00', breakMinutes: 15 },
                week: { totalHours: 37.5, daysWorked: 5, averageHoursPerDay: 7.5 },
                currentTimesheet: { _id: 'timesheet-1', weekNumber: 32, status: 'draft' },
                attendanceStatus: state.onLeave ? (state.clockedIn ? 'working_on_leave' : 'on_leave') : (state.clockedIn ? 'working' : 'off_clock'),
                leave: state.onLeave ? { type: 'annual', typeName: 'Annual Leave', startAt: '2026-08-09T00:00:00.000Z', endAt: '2026-08-11T00:00:00.000Z', allDay: true } : null,
                pendingApprovals: 1,
            });
        }
        if (method === 'GET' && path === '/api/clock/status') {
            return json(route, {
                isClockedIn: state.clockedIn, isOnBreak: state.onBreak,
                lastClockEntry: state.clockedIn ? { timestamp: NOW } : null,
                timeWorked: { hours: 2, minutes: 120 },
                policy: { locationEnabled: state.locationEnabled, locationRequired: state.locationEnabled, maximumLocationAccuracyMeters: 250 },
            });
        }
        if (method === 'GET' && path === '/api/clock/events') return route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'event: ready\ndata: {"connected":true}\n\n' });
        if (method === 'POST' && path === '/api/clock/in') { state.clockBodies.push(request.postDataJSON()); state.clockedIn = true; return json(route, { success: true }); }
        if (method === 'POST' && path === '/api/clock/out') {
            state.clockBodies.push(request.postDataJSON());
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
        if (method === 'GET' && path === '/api/timesheets/timesheet-1') return json(route, { timesheet: {
            ...timesheet,
            status: state.approvalConflict ? 'submitted' : state.timesheetStatus,
            payrollIntegration: { state: state.timesheetPayrollState, exported: false },
            summary: { ...timesheet.summary, incompleteEntries: state.approvalConflict ? 2 : 0 },
        } });
        if (method === 'POST' && /^\/api\/timesheets\/timesheet-1\/(submit|recall)$/.test(path)) {
            state.timesheetStatus = path.endsWith('/submit') ? 'submitted' : 'draft';
            state.timesheetPayrollState = 'not_ready';
            return json(route, { timesheet: { ...timesheet, status: state.timesheetStatus } });
        }
        if (method === 'GET' && path === '/api/timesheets/timesheet-1/export') return route.fulfill({ status: 200, headers: { ...corsHeaders(route), 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': 'attachment; filename="timesheet-1.xlsx"' }, body: 'mock workbook' });

        if (method === 'GET' && path === '/api/approvals') return json(route, { timesheets: [{
            ...timesheet,
            summary: { ...timesheet.summary, incompleteEntries: state.approvalConflict ? 2 : 0 },
        }] });
        if (method === 'GET' && path === '/api/approvals/history') return json(route, { timesheets: [{ ...timesheet, status: 'approved' }] });
        if (method === 'POST' && path === '/api/approvals/timesheet-1/approve' && state.approvalConflict) {
            return json(route, { error: 'Incomplete or unpaired attendance entries must be corrected before approval', code: 'INCOMPLETE_ATTENDANCE', incompleteEntries: 2 }, 409);
        }
        if (/^\/api\/approvals\/timesheet-1\/(approve|reject|revert|request-revision)$/.test(path)) return json(route, { success: true });
        if (method === 'DELETE' && path === '/api/approvals/timesheet-1') return json(route, { success: true });

        if (method === 'GET' && path === '/api/attendance/team') {
            return json(route, {
                team: [
                    { userId: 'employee-2', userName: 'Jamie Lee', userEmail: 'jamie@example.com', teamName: 'Operations', status: 'working', clockInAt: NOW, clockInLocation: { address: 'London office' }, workedMinutesToday: 120, lastActivity: NOW, lastActivityType: 'clock_in' },
                    { userId: 'employee-3', userName: 'Morgan Reed', userEmail: 'morgan@example.com', teamName: 'Operations', status: 'clocked_out', clockInAt: NOW, clockOutAt: TOMORROW, clockInLocation: { address: 'Client site' }, clockOutLocation: { address: 'Client site' }, workedMinutesToday: 480, lastActivity: TOMORROW, lastActivityType: 'clock_out' },
                    { userId: 'employee-4', userName: 'Taylor Kim', userEmail: 'taylor@example.com', teamName: 'Operations', status: 'not_clocked_in', workedMinutesToday: 0 },
                    { userId: 'employee-5', userName: 'Casey Patel', userEmail: 'casey@example.com', teamName: 'Operations', status: 'on_leave', leave: { startAt: '2026-08-09T00:00:00.000Z', endAt: '2026-08-11T00:00:00.000Z', allDay: true }, workedMinutesToday: 0 },
                ],
                summary: { total: 4, working: 1, onBreak: 0, onLeave: 1, clockedOut: 2, notClockedIn: 1, leaveConflicts: 0 },
            });
        }
        if (method === 'POST' && path === '/api/attendance/team/employee-2/notify-clock-out') return json(route, { message: 'Reminder sent to Jamie Lee.' });
        if (method === 'GET' && path === '/api/attendance/team/export') return route.fulfill({ status: 200, headers: { ...corsHeaders(route), 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, body: 'mock workbook' });

        const roster = () => ({
            source: 'idp_sync',
            teams: state.rosterSynced ? [{ teamId: 'team-1', name: 'Operations' }, { teamId: 'team-2', name: 'Finance' }] : [],
            members: state.rosterSynced ? [
                { userId: 'employee-2', employeeId: 'EMP-002', name: 'Jamie Lee', email: 'jamie@example.com', teamIds: ['team-1'] },
                { userId: 'employee-3', employeeId: 'EMP-003', name: 'Morgan Reed', email: 'morgan@example.com', teamIds: ['team-2'] },
            ] : [],
            synchronization: { state: state.rosterSynced ? 'ready' : 'empty', lastReconciledAt: state.rosterSynced ? NOW : null },
        });
        if (method === 'GET' && path === '/api/v1/scheduling/templates') return json(route, { templates: [{ _id: 'template-1', name: 'Day shift', startTime: '09:00', endTime: '17:00', breakMinutes: 30, workMode: 'remote' }] });
        if (method === 'GET' && path === '/api/v1/scheduling/roster') return json(route, roster());
        if (method === 'POST' && path === '/api/v1/scheduling/roster/reconcile') {
            state.rosterSynced = true;
            state.rosterSyncCount += 1;
            return json(route, { ...roster(), synchronization: { state: 'reconciled', reconciledAt: NOW, applied: 2 } });
        }
        if (method === 'GET' && path === '/api/v1/scheduling/shifts') {
            if (url.searchParams.get('open') === 'true') return json(route, { shifts: [{ _id: 'shift-open', userId: null, startAt: TOMORROW, endAt: TOMORROW_END, workMode: 'office', status: 'published' }] });
            return json(route, { shifts: [{ _id: 'shift-1', userId: 'employee-1', startAt: TOMORROW, endAt: TOMORROW_END, workMode: 'remote', status: 'published', acknowledgement: { status: state.shiftAcknowledged ? 'accepted' : 'pending' } }] });
        }
        if (method === 'GET' && path === '/api/v1/scheduling/requests') return json(route, { requests: [{ _id: 'request-1', type: 'cover', status: 'pending' }] });
        if (method === 'POST' && path === '/api/v1/scheduling/publish') return json(route, { publishedCount: 2 });
        if (method === 'POST' && path === '/api/v1/scheduling/shifts/shift-1/acknowledge') { state.shiftAcknowledged = true; return json(route, { success: true }); }
        if (method === 'POST' && path === '/api/v1/scheduling/shifts') { state.shiftBodies.push(request.postDataJSON()); return json(route, { shift: { _id: 'shift-new' } }); }
        if (method === 'POST' && path === '/api/v1/scheduling/requests') { state.coverRequested = true; return json(route, { request: { _id: 'request-new' } }); }
        if (method === 'POST' && path === '/api/v1/scheduling/requests/request-1/review') { state.requestReviewed = true; return json(route, { success: true }); }

        if (method === 'GET' && path === '/api/v1/exceptions') {
            const period = {
                timesheetId: 'timesheet-1', userId: 'employee-1', userName: 'Alex Morgan', userEmail: 'alex@example.com', teamName: 'Operations',
                weekNumber: 32, year: 2026, startDate: timesheet.startDate, endDate: timesheet.endDate, timezone: 'UTC', status: state.approvalConflict ? 'submitted' : 'draft',
            };
            return json(route, {
                disclaimer: 'Exceptions are review flags only and never automatic decisions.',
                context: url.searchParams.get('timesheetId') ? period : null,
                exceptions: [
                    { _id: 'exception-1', userId: 'employee-1', userName: 'Alex Morgan', userEmail: 'alex@example.com', timesheetId: 'timesheet-1', employee: { userId: 'employee-1', name: 'Alex Morgan', email: 'alex@example.com', teamName: 'Operations' }, period, type: 'late_arrival', severity: 'medium', occurrenceDate: NOW, status: state.exceptionStatus, rule: { code: 'LATE-01' }, explanation: { message: 'Arrival was outside the configured grace period.' }, correctionRequest: state.exceptionStatus === 'correction_requested' ? { explanation: 'Train cancellation delayed arrival.', decision: 'pending' } : undefined },
                    { _id: 'exception-2', userId: 'employee-1', userName: 'Alex Morgan', userEmail: 'alex@example.com', timesheetId: 'timesheet-1', employee: { userId: 'employee-1', name: 'Alex Morgan', email: 'alex@example.com', teamName: 'Operations' }, period, type: 'insufficient_rest', severity: 'high', occurrenceDate: NOW, status: 'resolved', rule: { code: 'REST-01' }, explanation: { message: 'Rest between work sessions was below the configured minimum.' } },
                    { _id: 'exception-3', userId: 'employee-1', userName: 'Alex Morgan', userEmail: 'alex@example.com', timesheetId: 'timesheet-1', employee: { userId: 'employee-1', name: 'Alex Morgan', email: 'alex@example.com', teamName: 'Operations' }, period, type: 'absence', severity: 'medium', occurrenceDate: '2026-08-08T09:00:00.000Z', status: 'correction_requested', approvalBlocking: true, rule: { code: 'ABSENCE-01' }, explanation: { message: 'No attendance or approved leave was recorded.' }, correctionRequest: { explanation: 'Approved leave was not synced yet.', decision: 'pending' } },
                ],
            });
        }
        if (method === 'GET' && path === '/api/v1/exceptions/timesheets/timesheet-1/correction-route') return json(route, { routing: { fallbackLabel: 'Morgan Manager (Line manager)', reason: 'Employee line manager', recipients: [{ userId: 'manager-1', userName: 'Morgan Manager', roleLabel: 'Line manager' }] } });
        if (method === 'POST' && path === '/api/v1/exceptions/exception-1/correction-requests') { state.exceptionStatus = 'correction_requested'; return json(route, { routing: { fallbackLabel: 'Morgan Manager (Line manager)' } }); }
        if (method === 'POST' && path === '/api/v1/exceptions/exception-1/resolve') { state.exceptionStatus = 'resolved'; return json(route, { exception: { _id: 'exception-1', status: 'resolved' } }); }
        if (method === 'POST' && path === '/api/v1/exceptions/exception-1/review') return json(route, { applied: { timesheetId: 'timesheet-1', version: 1, createdAdjustment: false } });
        if (method === 'POST' && path === '/api/v1/exceptions/exception-3/review') return json(route, { applied: { timesheetId: 'timesheet-1', version: 1, createdAdjustment: false } });
        if (method === 'POST' && path === '/api/v1/exceptions/timesheets/timesheet-1/correction-requests') { state.timesheetCorrectionRequested = true; return json(route, { routing: { fallbackLabel: 'Morgan Manager (Line manager)' } }); }
        if (method === 'POST' && path === '/api/v1/exceptions/timesheets/timesheet-1/flags') { state.managerExceptionFlagged = true; return json(route, { success: true }); }

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
        if (method === 'PUT' && path === '/api/admin/attendance-policy') { state.policyBodies.push(request.postDataJSON()); return json(route, { policy: request.postDataJSON() }); }
        if (method === 'GET' && path === '/api/admin/access-policy') return json(route, { policy: { roles: attendanceRoles, assignments: [] }, editablePermissions: ['management.view', 'team.view', 'timesheets.approve', 'corrections.review', 'reports.view', 'policy.view', 'policy.manage'] });
        if (method === 'PUT' && path === '/api/admin/access-policy') return json(route, { policy: { roles: attendanceRoles, assignments: [] } });
        if (method === 'GET' && path === '/api/admin/access-policy/people') return json(route, { people: [{ userId: 'employee-2', name: 'Jamie Lee', email: 'jamie@example.com', roleKeys: [] }] });
        if (method === 'PUT' && path === '/api/admin/access-policy/people/employee-2') return json(route, { assignment: { userId: 'employee-2', roleKeys: request.postDataJSON().roleKeys } });
        if (path.startsWith('/api/admin/geofence-locations')) return json(route, { policy });

        if (method === 'GET' && path === '/api/v1/rule-packs') return json(route, { packs: state.rulePacks });
        if (method === 'GET' && path === '/api/v1/rule-packs/assignment-options') return json(route, {
            people: [
                { userId: 'employee-2', name: 'Jamie Lee', email: 'jamie@example.com', teamIds: ['team-1'], jurisdiction: { countryCode: 'AU' } },
                { userId: 'employee-3', name: 'Morgan Reed', email: 'morgan@example.com', teamIds: ['team-2'], jurisdiction: { countryCode: 'MX' } },
            ],
            teams: [{ id: 'team-1', name: 'Operations' }, { id: 'team-2', name: 'Finance' }],
        });
        if (method === 'GET' && path === '/api/v1/rule-packs/coverage') return json(route, { coverage: [
            { userId: 'employee-2', name: 'Jamie Lee', email: 'jamie@example.com', jurisdiction: {}, fallbackJurisdiction: 'NG', effectiveRulePack: { id: 'rule-pack-1', key: 'ng-default', version: 1 }, assignment: state.rulePackAssignmentBodies.length ? { rulePackId: 'rule-pack-1' } : null },
        ] });
        if (method === 'POST' && path === '/api/v1/rule-packs/bulk-assign') {
            const body = request.postDataJSON();
            state.rulePackAssignmentBodies.push(body);
            return json(route, { assigned: body.userIds.length, matched: body.userIds.length, rulePack: { id: 'rule-pack-1', key: 'ng-default', name: 'Nigeria default', version: 1 } });
        }
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
        if (method === 'PATCH' && requestedRulePack) {
            const body = request.postDataJSON();
            state.rulePackBodies.push(body);
            Object.assign(requestedRulePack, body);
            return json(route, { pack: requestedRulePack, validation: { valid: true, errors: [] } });
        }
        if (method === 'POST' && path === '/api/v1/rule-packs/rule-pack-1/simulate') return json(route, { result: { totals: { regularHours: 8, overtimeHours: 0, exceptionCount: 0 }, dailyEntries: [] } });
        if (method === 'POST' && path === '/api/v1/rule-packs/rule-pack-1/clone') {
            const pack = { ...rulePack, _id: 'rule-pack-org', name: 'Nigeria default — organization copy', status: 'draft', scope: { organizationId: 'org-1' } };
            state.rulePacks.push(pack);
            return json(route, { pack });
        }

        if (method === 'GET' && path === '/api/reports/exceptions') return json(route, {
            summary: { totalExceptions: 1, affectedPeople: 1, affectedDays: 1 },
            rows: [{ userId: 'employee-2', date: '2026-08-18', userName: 'Jamie Lee', userEmail: 'jamie@example.com', teamName: 'Operations', workMinutes: 300, exceptions: [{ type: 'early_departure' }], sources: ['web'] }],
        });
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
            lockedClockOut: false, onLeave: false,
            notificationRead: false, exceptionStatus: 'open', shiftAcknowledged: false, rulePacks: [rulePack],
            rosterSynced: false, rosterSyncCount: 0, coverRequested: false, requestReviewed: false,
            approvalConflict: false,
            timesheetStatus: 'draft', timesheetPayrollState: 'not_ready',
            timesheetCorrectionRequested: false, managerExceptionFlagged: false,
            locationEnabled: false, clockBodies: [], shiftBodies: [], policyBodies: [], rulePackBodies: [], rulePackAssignmentBodies: [],
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
    expect(mockState.clockBodies[0].location).toMatchObject({ latitude: 51.5074, longitude: -0.1278 });
});

test('continues collecting location when geofencing is enabled', async ({ page, mockState }) => {
    mockState.locationEnabled = true;
    await authenticate(page);
    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'Clock In' }).click();
    await expect(page.getByRole('button', { name: 'Clock Out' })).toBeVisible();
    expect(mockState.clockBodies[0].location).toMatchObject({ latitude: 51.5074, longitude: -0.1278 });
});

test('records a clock-out location when geofencing is disabled', async ({ page, mockState }) => {
    mockState.clockedIn = true;
    await authenticate(page);
    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'Clock Out' }).click();
    await expect(page.getByRole('button', { name: 'Clock In' })).toBeVisible();
    expect(mockState.clockBodies[0].location).toMatchObject({ latitude: 51.5074, longitude: -0.1278 });
});

test('shows location accuracy controls only when geofencing is enabled', async ({ page, mockState: _mockState }) => {
    await authenticate(page);
    await page.goto('/admin/settings');

    const accuracyInput = page.getByLabel('Maximum location uncertainty (metres)');
    await expect(accuracyInput).toBeHidden();
    await page.getByRole('button', { name: 'Enable geofencing' }).click();
    await expect(accuracyInput).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enforce geofencing' })).toHaveAttribute('aria-pressed', 'false');
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

test('surfaces approved leave across the employee, team and timesheet experience', async ({ page, mockState }) => {
    mockState.onLeave = true;
    await authenticate(page);

    await page.goto('/dashboard');
    await expect(page.getByText('You are on approved leave today')).toBeVisible();
    await expect(page.getByText(/You will not be marked absent/)).toBeVisible();

    await page.goto('/team');
    const leaveRow = page.locator('tbody tr').filter({ hasText: 'Casey Patel' });
    await expect(leaveRow).toContainText('On Leave');
    await expect(leaveRow).toContainText('Approved leave');

    await page.goto('/timesheets/timesheet-1');
    await expect(page.getByText('Leave days').locator('..')).toContainText('1');
    const leaveDay = page.locator('[data-day-status="leave"]');
    await expect(leaveDay).toContainText('On leave');
    await expect(leaveDay).toContainText('No clock entry is required');
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
    await page.addInitScript(() => localStorage.setItem('seemplify-theme', 'light'));
    await authenticate(page);
    await page.goto('/exceptions');

    await expect(page.getByRole('tab', { name: 'All 3' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '9 August 2026' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '8 August 2026' })).toBeVisible();
    await page.getByPlaceholder('Search employee or exception').fill('rest');
    await expect(page.getByRole('heading', { name: 'Insufficient Rest' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Late Arrival' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Clear search' }).click();

    await page.getByRole('button', { name: 'Request correction', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('Sent to Morgan Manager (Line manager)');
    await page.getByLabel('Clock in').fill('09:15');
    await page.getByLabel('Clock out').fill('17:15');
    await page.getByLabel('Why should this be corrected?').fill('Train cancellation delayed my arrival.');
    await page.getByRole('button', { name: 'Send correction request' }).click();
    await expect(page.getByText('Correction request sent to Morgan Manager (Line manager).')).toBeVisible();
    await expect(page.getByText(/Employee correction request · Awaiting review/).first()).toBeVisible();
    const explanation = page.getByTestId('employee-explanation').filter({ hasText: 'Train cancellation delayed arrival.' });
    await expect(explanation).toBeVisible();
    const hasReadableContrast = await explanation.evaluate(element => {
        const parse = (value: string) => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
        const luminance = (rgb: number[]) => {
            const channels = rgb.map(value => {
                const normalized = value / 255;
                return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
        };
        const paragraph = element.querySelector('p');
        if (!paragraph) return false;
        const foreground = luminance(parse(getComputedStyle(paragraph).color));
        const background = luminance(parse(getComputedStyle(element).backgroundColor));
        return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05) >= 4.5;
    });
    expect(hasReadableContrast).toBe(true);
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

test('switches between populated report payloads without rendering the previous response shape', async ({ page, mockState: _mockState }) => {
    await authenticate(page);
    await page.goto('/reports');

    await expect(page.getByText('Jamie Lee')).toBeVisible();
    await page.getByRole('button', { name: 'Attendance', exact: true }).click();
    await expect(page.getByText('Alex Morgan')).toBeVisible();
});

test('separates employee and management workspaces and exposes seeded attendance roles', async ({ page, mockState }) => {
    await authenticate(page);
    await page.goto('/dashboard');

    await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening), Alex/ })).toBeVisible();
    const desktopManagementToggle = page.getByRole('button', { name: 'Management', exact: true });
    if (await desktopManagementToggle.isVisible()) await desktopManagementToggle.click();
    else {
        await page.getByRole('button', { name: 'Open navigation' }).click();
        await page.getByRole('button', { name: 'Management view' }).click();
    }
    await expect(page.getByRole('heading', { name: 'Management dashboard' })).toBeVisible();
    await expect(page.getByText('Correction requests')).toBeVisible();

    await page.goto('/admin/settings');
    await expect(page.getByRole('heading', { name: 'Attendance roles and permissions' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Line Manager/ })).toBeVisible();
    await page.getByPlaceholder('Search organization employees').fill('Jamie');
    await expect(page.getByText('Jamie Lee')).toBeVisible();
    const lineManagerAssignment = page.getByRole('checkbox', { name: 'Line Manager', exact: true });
    await lineManagerAssignment.click();
    await expect(lineManagerAssignment).toBeChecked();
    expect(mockState.calls).toContain('PUT /api/admin/access-policy/people/employee-2');
});

test('defaults to one line-manager approval and makes multiple stages optional', async ({ page, mockState }) => {
    await authenticate(page);
    await page.goto('/admin/settings');

    const approvalProcess = page.getByLabel('Approval process');
    await expect(approvalProcess).toHaveValue('single');
    await expect(page.getByText("The employee's line manager approves once.")).toBeVisible();
    await expect(page.getByText(/not an additional required stage/)).toBeVisible();

    await approvalProcess.selectOption('multi');
    await expect(page.getByLabel('Approval stage 1', { exact: true })).toHaveValue('line_manager');
    await expect(page.getByLabel('Approval stage 2', { exact: true })).toHaveValue('hr');
    await page.getByRole('button', { name: 'Add stage' }).click();
    await expect(page.getByLabel('Approval stage 3', { exact: true })).toHaveValue('hr');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Save Changes' }).click();

    expect(mockState.policyBodies.at(-1)?.timesheetSettings).toMatchObject({
        approvalMode: 'multi',
        approvalLevels: [
            { approverType: 'line_manager' },
            { approverType: 'hr' },
            { approverType: 'hr' },
        ],
    });
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

test('creates a draft shift from the synchronized IDP team roster', async ({ page, mockState }) => {
    await authenticate(page);
    await page.goto('/schedule');
    await page.getByRole('button', { name: 'New shift' }).click();
    await expect(page.getByText('People and teams come from the active IDP organization roster.')).toBeVisible();
    await expect(page.getByText('2 members · 2 teams')).toBeVisible();
    expect(mockState.rosterSyncCount).toBe(1);
    expect(mockState.calls).toContain('POST /api/v1/scheduling/roster/reconcile');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);

    await page.getByLabel('Team').selectOption('team-1');
    await expect(page.getByLabel('Assign to').getByRole('option', { name: /Jamie Lee/ })).toHaveCount(1);
    await expect(page.getByLabel('Assign to').getByRole('option', { name: /Morgan Reed/ })).toHaveCount(0);
    await page.getByLabel('Find a member').fill('EMP-002');
    await page.getByLabel('Assign to').selectOption('employee-2');
    await page.getByLabel('Shift template').selectOption('template-1');
    await expect(page.getByLabel('Shift starts')).toHaveValue(/T09:00$/);
    await expect(page.getByLabel('Shift ends')).toHaveValue(/T17:00$/);
    await expect(page.getByLabel('Work mode')).toHaveValue('remote');
    await page.getByRole('button', { name: 'Create draft' }).click();

    await expect(page.getByText('Draft shift created.')).toBeVisible();
    expect(mockState.shiftBodies).toHaveLength(1);
    expect(mockState.shiftBodies[0]).toMatchObject({ userId: 'employee-2', teamId: 'team-1', templateId: 'template-1', workMode: 'remote', breakMinutes: 30, openShift: false });
});

test('validates open shifts, cover requests and manager review actions', async ({ page, mockState }) => {
    await authenticate(page);
    await page.goto('/schedule');
    await expect(page.getByRole('button', { name: 'Request cover' })).toBeVisible();
    await page.getByRole('button', { name: 'Request cover' }).click();
    await expect(page.getByText('Cover request sent for manager approval.')).toBeVisible();
    expect(mockState.coverRequested).toBe(true);

    await page.getByRole('button', { name: 'Approve' }).click();
    expect(mockState.requestReviewed).toBe(true);

    await page.getByRole('button', { name: 'New shift' }).click();
    await expect(page.getByText('2 members · 2 teams')).toBeVisible();
    await page.getByLabel('Shift ends').fill('2026-08-10T08:00');
    await page.getByLabel('Shift starts').fill('2026-08-10T09:00');
    await expect(page.getByText('Shift end must be after shift start.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create draft' })).toBeDisabled();

    await page.getByLabel('Open shift').check();
    await page.getByLabel('Shift ends').fill('2026-08-10T17:00');
    await expect(page.getByLabel('Assign to')).toBeDisabled();
    await page.getByRole('button', { name: 'Create draft' }).click();
    await expect(page.getByText('Draft shift created.')).toBeVisible();
    expect(mockState.shiftBodies.at(-1)).toMatchObject({ userId: null, openShift: true });
});

test('keeps timesheet detail and approval history compact in light mode', async ({ page, mockState: _mockState }) => {
    await authenticate(page);
    await page.addInitScript(() => localStorage.setItem('seemplify-theme', 'light'));
    await page.setViewportSize({ width: 1573, height: 900 });

    await page.goto('/timesheets/timesheet-1');
    await expect(page.getByRole('button', { name: 'Submit for Approval' })).toBeVisible();
    await expect(page.getByText('Total worked')).toBeVisible();
    await expect(page.locator('.timesheet-day').first()).toContainText(/In:\s*\d{2}:\d{2}/);
    await expect(page.locator('.timesheet-day').first()).toContainText(/Out:\s*\d{2}:\d{2}/);
    await expect(page.getByText('London office, Westminster').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'View map' }).first()).toBeVisible();
    await expect(page.getByText('Not recorded')).toHaveCount(2);
    const dayBackground = await page.locator('.timesheet-day').first().evaluate(element => getComputedStyle(element).backgroundColor);
    expect(dayBackground).not.toBe('rgb(228, 225, 218)');

    await page.goto('/approvals');
    await page.getByRole('tab', { name: 'History' }).click();
    await expect(page.getByText('Decision', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reopen' })).toBeVisible();

    const pageWidth = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
    expect(pageWidth.document).toBeLessThanOrEqual(pageWidth.viewport);
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

test('explains an incomplete-attendance approval conflict without losing the request', async ({ page, mockState }) => {
    mockState.approvalConflict = true;
    await page.addInitScript(() => localStorage.setItem('attendance-workspace:org-1', 'management'));
    await authenticate(page);
    await page.goto('/approvals');

    await expect(page.getByText('Approval blocked')).toBeVisible();
    await expect(page.getByText(/2 incomplete or unpaired attendance entries/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Review timesheet' })).toHaveAttribute('href', '/timesheets/timesheet-1?review=1');
    await expect(page.getByRole('link', { name: 'View exceptions' })).toHaveAttribute('href', /userId=employee-1.*timesheetId=timesheet-1.*start=.*end=.*returnTo=/);
    await expect(page.getByRole('button', { name: 'Approve' })).toBeDisabled();
    await expect(page.getByText('Alex Morgan')).toBeVisible();
    expect(mockState.calls).not.toContain('POST /api/approvals/timesheet-1/approve');
});

test('keeps employee and period context through timesheet review and exception decisions', async ({ page, mockState }) => {
    mockState.approvalConflict = true;
    await page.addInitScript(() => localStorage.setItem('attendance-workspace:org-1', 'management'));
    await authenticate(page);
    await page.goto('/approvals');

    await page.getByRole('link', { name: 'Review timesheet' }).click();
    await expect(page).toHaveURL(/\/timesheets\/timesheet-1\?review=1/);
    await expect(page.getByRole('heading', { name: /Review Alex Morgan’s Week 32 timesheet/ })).toBeVisible();
    await expect(page.getByText('What is blocking approval')).toBeVisible();
    await expect(page.getByText(/2 incomplete or unpaired attendance entries/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve timesheet' })).toBeDisabled();

    await page.getByRole('button', { name: 'Flag an issue for this day' }).first().click();
    await page.getByLabel('Issue type').selectOption('late_arrival');
    await page.getByLabel('Reason and required action').fill('Please confirm the delayed arrival and correct the start time.');
    await page.getByRole('button', { name: 'Flag issue' }).click();
    await expect(page.getByText('The issue was flagged for this employee and added to the audit history.')).toBeVisible();
    expect(mockState.managerExceptionFlagged).toBe(true);

    await page.goto('/approvals');
    await page.getByRole('link', { name: 'View exceptions' }).click();
    await expect(page.getByLabel('Selected timesheet context')).toContainText('Alex Morgan · Week 32');
    await expect(page.getByLabel('Selected timesheet context')).toContainText('3 Aug 2026 – 9 Aug 2026');
    await expect(page.getByTestId('exception-row').first()).toContainText('Alex Morgan');
    await expect(page.getByTestId('exception-row').first()).toContainText('alex@example.com');
    await expect(page.getByTestId('exception-row').first()).toContainText('Week 32');

    const correction = page.getByTestId('exception-row').filter({ hasText: 'Approved leave was not synced yet.' });
    await correction.getByRole('button', { name: 'Approve and apply', exact: true }).click();
    await page.getByLabel('Decision reason').fill('Approved leave evidence was verified for this date.');
    await page.getByRole('dialog').getByRole('button', { name: 'Approve and apply', exact: true }).click();
    await expect(page.getByText('The correction was approved and applied to timesheet version 1.')).toBeVisible();
    expect(mockState.calls).toContain('POST /api/v1/exceptions/exception-3/review');
});

test('management mode never falls back to employee timesheet controls without a review query', async ({ page, mockState }) => {
    mockState.approvalConflict = true;
    await page.addInitScript(() => localStorage.setItem('attendance-workspace:org-1', 'management'));
    await authenticate(page);
    await page.goto('/timesheets/timesheet-1');

    await expect(page.getByRole('heading', { name: /Review Alex Morgan’s Week 32 timesheet/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve timesheet' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Submit for Approval' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Request a correction for this day' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Flag an issue for this day' }).first()).toBeVisible();
});

test('explains why an admin cannot approve their own attendance record', async ({ page, mockState: _mockState }) => {
    await page.addInitScript(() => localStorage.setItem('attendance-workspace:org-1', 'management'));
    await authenticate(page);
    await page.goto('/timesheets/timesheet-1');

    await expect(page.getByRole('heading', { name: 'Your timesheet in Management view' })).toBeVisible();
    await expect(page.getByText(/Admins cannot approve their own timesheet or attendance corrections/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Submit for Approval' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Approve timesheet' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Switch to Employee view' })).toBeVisible();

    await page.goto('/exceptions');
    await expect(page.getByText('You cannot approve your own attendance exceptions')).toBeVisible();
    await expect(page.getByText(/Admin access does not bypass this audit control/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve and apply' })).toHaveCount(0);
});

test('lets a manager accept an open exception without changing worked time', async ({ page, mockState }) => {
    mockState.approvalConflict = true;
    await page.addInitScript(() => localStorage.setItem('attendance-workspace:org-1', 'management'));
    await authenticate(page);
    await page.goto('/exceptions');

    const openException = page.getByTestId('exception-row').filter({ hasText: 'Arrival was outside the configured grace period.' });
    await openException.getByRole('button', { name: 'Accept exception' }).click();
    await expect(page.getByRole('dialog')).toContainText('It does not create attendance, add hours or change clock times.');
    await page.getByLabel('Decision reason').fill('The documented late arrival was reviewed and accepted.');
    await page.getByRole('dialog').getByRole('button', { name: 'Accept exception' }).click();
    await expect(page.getByText('The exception was accepted as reviewed. No worked time was added or changed.')).toBeVisible();
    expect(mockState.calls).toContain('POST /api/v1/exceptions/exception-1/resolve');
});

test('lets an employee request a correction from the exact timesheet day', async ({ page, mockState }) => {
    await authenticate(page);
    await page.goto('/timesheets/timesheet-1');

    await page.getByRole('button', { name: 'Request a correction for this day' }).first().click();
    await expect(page.getByRole('dialog')).toContainText('Sent to Morgan Manager (Line manager)');
    await page.getByLabel('Clock in').fill('07:50');
    await page.getByLabel('Clock out').fill('16:00');
    await page.getByLabel('Why should this be corrected?').fill('My clock-in was recorded ten minutes later than the actual arrival.');
    await page.getByRole('button', { name: 'Send correction request' }).click();
    await expect(page.getByText('Your proposed times were sent to Morgan Manager (Line manager).')).toBeVisible();
    expect(mockState.timesheetCorrectionRequested).toBe(true);
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

test('lets an employee recall and redo an approved timesheet before payroll accepts attendance', async ({ page, mockState }) => {
    mockState.timesheetStatus = 'payroll_pending';
    mockState.timesheetPayrollState = 'failed';
    await authenticate(page);
    await page.goto('/timesheets/timesheet-1');

    await expect(page.getByRole('button', { name: 'Recall' })).toBeVisible();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Recall' }).click();

    await expect(page.getByRole('button', { name: 'Submit for Approval' })).toBeVisible();
    expect(mockState.calls).toContain('POST /api/timesheets/timesheet-1/recall');
});

test('assigns a structured rule pack to a specific employee without exposing JSON by default', async ({ page, mockState }) => {
    await authenticate(page);
    await page.goto('/admin/rule-packs');

    await expect(page.getByRole('heading', { name: 'Working schedule' })).toBeVisible();
    await expect(page.getByLabel('Advanced rules JSON')).toBeHidden();
    await page.getByRole('button', { name: 'Clone to edit' }).click();
    await expect(page.getByRole('heading', { name: 'Nigeria default — organization copy' })).toBeVisible();

    await page.getByLabel('Applies to').selectOption('employee');
    await page.getByLabel('Employee').selectOption('employee-2');
    await page.getByLabel('Hours per day').fill('7.5');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByRole('status')).toContainText('Draft saved');
    expect(mockState.rulePackBodies.at(-1)).toEqual(expect.objectContaining({
        scope: { organizationId: 'org-1', userId: 'employee-2' },
        rules: expect.objectContaining({ work: expect.objectContaining({ standardHoursPerDay: 7.5 }) }),
    }));

    await page.getByRole('button', { name: 'Assign employees' }).click();
    await expect(page.getByRole('heading', { name: 'Employee rule assignments' })).toBeVisible();
    expect(mockState.calls).toContain('GET /api/v1/rule-packs/coverage?reconcile=true');
    await expect(page.getByText('1 active employee synchronized from Seemplify Identity')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Jamie Lee jamie@example.com' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'NG (default)' })).toBeVisible();
    await page.getByLabel('Select Jamie Lee').check();
    await page.getByRole('button', { name: 'Assign 1' }).click();
    await expect(page.getByRole('status')).toContainText('1 employee assigned to Nigeria default');
    expect(mockState.rulePackAssignmentBodies).toContainEqual({ userIds: ['employee-2'], rulePackId: 'rule-pack-1' });
});

test('publishes and repairs the baseline catalogue from the studio', async ({ page, mockState }) => {
    await authenticate(page);
    await page.goto('/admin/rule-packs');

    await page.getByRole('button', { name: 'Publish baseline catalogue' }).click();
    await expect(page.getByRole('status')).toContainText('31 baseline rule packs are configured and published');
    expect(mockState.calls.filter(call => call === 'POST /api/v1/rule-packs/seed-defaults')).toHaveLength(1);
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
    await page.addInitScript(() => localStorage.setItem('attendance-workspace:org-1', 'management'));
    await authenticate(page);
    await page.goto('/dashboard');

    const moreButton = page.getByRole('button', { name: 'Manage pages' });
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
