const schedulingRouter = require('../routes/scheduling');

const { rosterMemberIsEligible } = schedulingRouter;

describe('scheduling roster eligibility', () => {
    const shiftStart = new Date('2026-08-11T09:00:00.000Z');

    test('requires a synchronized IDP roster member', () => {
        expect(rosterMemberIsEligible(null, shiftStart)).toBe(false);
    });

    test('rejects inactive members', () => {
        expect(rosterMemberIsEligible({ status: 'inactive' }, shiftStart)).toBe(false);
    });

    test('rejects members who do not have Time & Attendance app access', () => {
        const roster = { status: 'active', appAccess: { mode: 'selected', appIds: ['payroll'] } };
        expect(rosterMemberIsEligible(roster, shiftStart)).toBe(false);
    });

    test('allows active members and future scheduled leavers before their exit', () => {
        expect(rosterMemberIsEligible({ status: 'active' }, shiftStart)).toBe(true);
        expect(rosterMemberIsEligible({ status: 'scheduled_exit', effectiveExitAt: '2026-08-12T17:00:00.000Z' }, shiftStart)).toBe(true);
    });

    test('rejects a shift at or after the effective exit time', () => {
        const roster = { status: 'scheduled_exit', effectiveExitAt: '2026-08-11T09:00:00.000Z' };
        expect(rosterMemberIsEligible(roster, shiftStart)).toBe(false);
        expect(rosterMemberIsEligible(roster, new Date('2026-08-11T10:00:00.000Z'))).toBe(false);
    });
});
