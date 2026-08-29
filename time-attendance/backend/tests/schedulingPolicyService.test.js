const {
    defaultSchedulingSettings,
    normalizeSchedulingSettings,
    requestPolicy,
} = require('../services/schedulingPolicyService');

describe('scheduling policy defaults', () => {
    test('seeds safe defaults for cover, release, and swap', () => {
        const settings = defaultSchedulingSettings();
        expect(settings).toMatchObject({
            usePublishedShiftsAsAttendanceSchedule: true,
            enforceAvailability: true,
            enforceMinimumRest: true,
            enforceMaximumWeeklyHours: true,
            requestPolicies: {
                cover: { approvalRequired: true, approvalMode: 'single' },
                release: { approvalRequired: true, approvalMode: 'single' },
                swap: { approvalRequired: true, approvalMode: 'single' },
            },
        });
    });

    test('preserves an explicit no-approval cover policy while normalizing levels', () => {
        const settings = normalizeSchedulingSettings({
            requestPolicies: { cover: { approvalRequired: false, approvalMode: 'multi', approvalLevels: [] } },
        });
        expect(requestPolicy({ schedulingSettings: settings }, 'cover')).toMatchObject({
            approvalRequired: false,
            approvalMode: 'multi',
        });
        expect(settings.requestPolicies.cover.approvalLevels).toHaveLength(2);
        expect(settings.requestPolicies.release.approvalRequired).toBe(true);
    });
});
