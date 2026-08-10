jest.mock('../models', () => ({
    AttendancePolicy: { distinct: jest.fn() },
    EmployeeRoster: {
        distinct: jest.fn(),
        find: jest.fn(),
        updateMany: jest.fn(),
    },
}));

jest.mock('../services/lifecycleService', () => ({
    processLifecycleEvent: jest.fn(),
}));

const { EmployeeRoster } = require('../models');
const { processLifecycleEvent } = require('../services/lifecycleService');
const { reconcileOrganization } = require('../services/rosterReconciliationService');

describe('IDP roster reconciliation', () => {
    const originalEnvironment = { ...process.env };

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.IDP_INTERNAL_API_URL = 'https://idp.example.test';
        process.env.INTERNAL_SERVICE_SECRET = 'shared-test-secret';
        process.env.NODE_ENV = 'test';
        EmployeeRoster.updateMany.mockResolvedValue({ modifiedCount: 2 });
        processLifecycleEvent.mockResolvedValue({ duplicate: false });
    });

    afterAll(() => {
        process.env = originalEnvironment;
    });

    test('imports active members and deactivates local members missing from the authoritative snapshot', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                schemaVersion: '1.0',
                generatedAt: '2026-08-10T10:00:00.000Z',
                memberships: [
                    { idpSubject: 'employee-1', status: 'active', name: 'Alex Live', teamIds: ['team-1'] },
                    { idpSubject: 'employee-2', status: 'inactive', name: 'Former Member', teamIds: [] },
                ],
            }),
        });
        EmployeeRoster.find.mockResolvedValue([{ userId: 'employee-missing' }]);

        const result = await reconcileOrganization('org-1');

        expect(result).toEqual({ organizationId: 'org-1', applied: 2, deactivatedMissing: 1 });
        expect(global.fetch).toHaveBeenCalledWith(
            'https://idp.example.test/api/internal/v1/memberships/reconcile',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    'x-service-id': 'time-attendance',
                    'x-service-signature': expect.stringMatching(/^sha256=[a-f0-9]{64}$/),
                }),
                body: JSON.stringify({ organizationId: 'org-1' }),
            }),
        );
        expect(processLifecycleEvent).toHaveBeenCalledWith(
            'idp',
            expect.objectContaining({ event: 'organization.member.updated', data: expect.objectContaining({ userId: 'employee-1' }) }),
            'organization.member.updated',
        );
        expect(processLifecycleEvent).toHaveBeenCalledWith(
            'idp',
            expect.objectContaining({ event: 'organization.member.deactivated', data: expect.objectContaining({ userId: 'employee-missing' }) }),
            'organization.member.deactivated',
        );
        expect(EmployeeRoster.updateMany).toHaveBeenCalledWith(
            { organizationId: 'org-1', userId: { $in: ['employee-1', 'employee-2'] } },
            { $set: { lastReconciledAt: expect.any(Date) } },
        );
    });

    test('fails clearly when IDP does not return a membership list', async () => {
        global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ generatedAt: new Date().toISOString() }) });
        await expect(reconcileOrganization('org-1')).rejects.toThrow('membership list');
        expect(processLifecycleEvent).not.toHaveBeenCalled();
    });
});
