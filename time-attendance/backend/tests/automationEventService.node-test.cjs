const assert = require('node:assert/strict');
const test = require('node:test');
const { buildTimesheetEvent } = require('../services/automationEventService');

test('timesheet events are tenant-scoped, revision-bound Workspace envelopes', () => {
    const event = buildTimesheetEvent({
        _id: 'timesheet-1',
        organizationId: 'org-1',
        userId: 'employee-1',
        userName: 'Mina',
        version: 4,
        status: 'submitted',
        startDate: new Date('2026-08-10T00:00:00.000Z'),
        endDate: new Date('2026-08-16T23:59:59.000Z'),
        assignedApprover: { userId: 'manager-1' },
        summary: { totalHours: 40 },
    }, 'time.timesheet_submitted.v1', 'employee-1');

    assert.equal(event.id, 'time:timesheet-1:time.timesheet_submitted.v1:v4');
    assert.equal(event.organizationId, 'org-1');
    assert.equal(event.actorId, 'employee-1');
    assert.deepEqual(event.payload.approverIds, ['manager-1']);
    assert.equal(event.payload.revision, '4');
    assert.equal(event.payload.summary.totalHours, 40);
});
