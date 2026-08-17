const express = require('express');
const LeaveSnapshot = require('../models/LeaveSnapshot');
const { createVerifier } = require('../services/automationHubSecurity');

const router = express.Router();
router.use(createVerifier());

router.post('/time.block_expected_absence', async (req, res) => {
    try {
        const organizationId = String(req.body?.organizationId || '');
        const actorId = String(req.body?.actorId || '');
        const subjectId = String(req.body?.subjectId || '');
        const input = req.body?.input || {};
        const role = String(req.body?.authorizationContext?.role || '');
        if (!organizationId || !actorId || subjectId !== String(input.leaveRequestId || '') || !['manager', 'admin', 'owner'].includes(role)) {
            return res.status(403).json({ error: 'The expected-absence action is not authorized.', code: 'TIME_AUTOMATION_DENIED' });
        }
        if (String(input.decisionOutcomeId || '') !== `leave:${subjectId}:approved`) {
            return res.status(409).json({ error: 'Leave has not returned an authoritative approved outcome.', code: 'LEAVE_APPROVAL_OUTCOME_REQUIRED' });
        }
        const startsAt = new Date(input.startsAt); const endsAt = new Date(input.endsAt);
        if (!input.employeeId || Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || startsAt > endsAt) {
            return res.status(400).json({ error: 'Expected-absence dates or employee are invalid.', code: 'TIME_AUTOMATION_INPUT_INVALID' });
        }
        const snapshot = await LeaveSnapshot.findOneAndUpdate(
            { organizationId, externalLeaveId: subjectId },
            { $set: { userId: String(input.employeeId), status: 'approved', startAt: startsAt, endAt: endsAt, allDay: true, sourceUpdatedAt: new Date(), lastSyncedAt: new Date() }, $setOnInsert: { type: 'leave', typeName: 'Approved leave' } },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        return res.json({ outcomeId: `time-leave:${snapshot._id}`, state: 'blocked', idempotencyKey: String(req.get('idempotency-key') || '') });
    } catch (error) {
        console.error('Time automation action failed:', error.message);
        return res.status(500).json({ error: error.message, code: 'TIME_AUTOMATION_FAILED', retryable: false });
    }
});

module.exports = router;
