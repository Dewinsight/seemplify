const AttendanceException = require('../models/AttendanceException');
const {
    DEFAULT_ROLES,
    PERMISSIONS,
    effectiveAccessFromPolicy,
} = require('../services/attendanceAccessService');
const { normalizeRequestedChanges } = require('../services/attendanceCorrectionService');

const policy = (roles = DEFAULT_ROLES, assignments = []) => ({ roles, assignments });
const user = (role, teamRole) => ({
    id: `${role}-user`,
    currentOrganization: { id: 'org-1', role },
    organizations: [{ id: 'org-1', role }],
    teams: teamRole ? [{ organizationId: 'org-1', role: teamRole }] : [],
});

test('seeded attendance roles separate employee, manager, HR and admin access', () => {
    const employee = effectiveAccessFromPolicy(policy(), user('employee'), 'org-1');
    const manager = effectiveAccessFromPolicy(policy(), user('employee', 'line_manager'), 'org-1');
    const hr = effectiveAccessFromPolicy(policy(), user('hr_manager'), 'org-1');
    const admin = effectiveAccessFromPolicy(policy(), user('admin'), 'org-1');

    expect(employee.permissions).toEqual(expect.arrayContaining([PERMISSIONS.EMPLOYEE_VIEW, PERMISSIONS.CORRECTIONS_REQUEST]));
    expect(employee.canAccessManagement).toBe(false);
    expect(manager.scopes[PERMISSIONS.CORRECTIONS_REVIEW]).toBe('reports');
    expect(hr.scopes[PERMISSIONS.CORRECTIONS_REVIEW]).toBe('organization');
    expect(admin.canManageAccess).toBe(true);
});

test('configured role permissions and audited person assignments determine effective access', () => {
    const roles = DEFAULT_ROLES.map(role => role.key === 'hr_manager'
        ? { ...role, permissions: role.permissions.filter(permission => permission !== PERMISSIONS.CORRECTIONS_REVIEW) }
        : role);
    const withoutReview = effectiveAccessFromPolicy(policy(roles), user('hr_manager'), 'org-1');
    expect(withoutReview.permissions).not.toContain(PERMISSIONS.CORRECTIONS_REVIEW);

    const assigned = effectiveAccessFromPolicy(
        policy(roles, [{ userId: 'employee-user', roleKeys: ['line_manager'] }]),
        user('employee'),
        'org-1'
    );
    expect(assigned.permissions).toContain(PERMISSIONS.CORRECTIONS_REVIEW);
    expect(assigned.scopes[PERMISSIONS.CORRECTIONS_REVIEW]).toBe('reports');
});

test('proposed work times must be complete, ordered and inside the timesheet period', () => {
    const timesheet = {
        startDate: new Date('2026-08-03T00:00:00.000Z'),
        endDate: new Date('2026-08-09T23:59:59.999Z'),
        policySnapshot: { timezone: 'Europe/London' },
    };
    expect(normalizeRequestedChanges({ workDate: '2026-08-04', clockIn: '2026-08-04T17:00:00.000Z', clockOut: '2026-08-04T09:00:00.000Z' }, timesheet).error).toMatch(/after clock-in/);
    expect(normalizeRequestedChanges({ workDate: '2026-08-11', clockIn: '2026-08-11T09:00:00.000Z', clockOut: '2026-08-11T17:00:00.000Z' }, timesheet).error).toMatch(/inside this timesheet period/);
    expect(normalizeRequestedChanges({
        workDate: '2026-08-04',
        clockIn: '2026-08-04T09:00:00.000Z',
        clockOut: '2026-08-04T17:00:00.000Z',
        breakStart: '2026-08-04T13:00:00.000Z',
        breakEnd: '2026-08-04T13:30:00.000Z',
    }, timesheet).value).toEqual(expect.objectContaining({ workDate: '2026-08-04', timezone: 'Europe/London' }));
});

test('correction audit contract records routing, proposed times and applied entries', () => {
    const exception = new AttendanceException({
        organizationId: 'org-1',
        userId: 'employee-1',
        timesheetId: '6895fd26d4e1c42068317a01',
        timesheetVersion: 1,
        occurrenceDate: new Date('2026-08-04T00:00:00.000Z'),
        type: 'absence',
        ruleKey: 'attendance.absence',
        fingerprint: 'correction-audit-contract',
        status: 'resolved',
        correctionRequest: {
            explanation: 'The device did not record my shift.',
            requestedAt: new Date(),
            requestedBy: { userId: 'employee-1', userName: 'Alex Morgan' },
            requestedChanges: { workDate: '2026-08-04', clockIn: new Date('2026-08-04T09:00:00.000Z'), clockOut: new Date('2026-08-04T17:00:00.000Z') },
            reviewRouting: { fallbackLabel: 'Morgan Manager (Line manager)', recipients: [{ userId: 'manager-1', userName: 'Morgan Manager', roleLabel: 'Line manager' }] },
            decision: 'accepted',
            reviewedBy: 'manager-1',
            reviewedByName: 'Morgan Manager',
            appliedAt: new Date(),
            appliedTimesheetId: '6895fd26d4e1c42068317a01',
            replacementEntryIds: ['6895fd26d4e1c42068317a02', '6895fd26d4e1c42068317a03'],
        },
    });
    const validation = exception.validateSync();
    expect(validation).toBeUndefined();
    expect(exception.correctionRequest.reviewRouting.recipients[0].roleLabel).toBe('Line manager');
    expect(exception.correctionRequest.replacementEntryIds).toHaveLength(2);
});
