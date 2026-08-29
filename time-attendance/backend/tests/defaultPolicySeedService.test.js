const { AttendancePolicy, EmployeeRoster } = require('../models');
const { seedDefaultAttendancePolicies } = require('../services/defaultPolicySeedService');

afterEach(() => jest.restoreAllMocks());

describe('attendance default policy seeding', () => {
    test('creates missing tenant policies and persists scheduling defaults on legacy policies', async () => {
        jest.spyOn(AttendancePolicy, 'distinct').mockResolvedValue(['org-existing']);
        jest.spyOn(EmployeeRoster, 'distinct').mockResolvedValue(['org-existing', 'org-new']);
        jest.spyOn(AttendancePolicy, 'findOne').mockImplementation(({ organizationId }) => ({
            select: () => ({
                lean: async () => organizationId === 'org-existing' ? { _id: 'policy-1' } : null,
            }),
        }));
        const update = jest.spyOn(AttendancePolicy, 'updateOne').mockResolvedValue({ modifiedCount: 1 });
        const create = jest.spyOn(AttendancePolicy, 'getOrCreateDefault').mockResolvedValue({ organizationId: 'org-new' });

        await expect(seedDefaultAttendancePolicies()).resolves.toEqual({ organizations: 2, created: 1, updated: 1 });
        expect(update).toHaveBeenCalledWith(
            { organizationId: 'org-existing' },
            expect.objectContaining({ $set: expect.objectContaining({ schedulingSettings: expect.any(Object), 'workSchedule.maximumHoursPerWeek': 48 }) })
        );
        expect(create).toHaveBeenCalledWith('org-new', '', 'system:default-policy-seed');
    });
});
