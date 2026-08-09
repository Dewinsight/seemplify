const express = require('express');
const { requireAuth, requireOrganization, requireHRAdmin } = require('../middleware/auth');
const { CorrectionRun } = require('../models');
const { enqueueJob } = require('../services/backgroundJobService');

const router = express.Router();
router.use(requireAuth, requireOrganization, requireHRAdmin);

router.get('/', async (req, res) => {
    const runs = await CorrectionRun.find({ organizationId: req.organizationId }).sort({ createdAt: -1 }).limit(100);
    res.json({ runs });
});

router.post('/', async (req, res) => {
    const type = ['rule_change', 'leave_change', 'manual'].includes(req.body.type) ? req.body.type : 'manual';
    const start = new Date(req.body.periodStart); const end = new Date(req.body.periodEnd);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return res.status(400).json({ error: 'Valid periodStart and periodEnd are required' });
    if (String(req.body.reason || '').trim().length < 10) return res.status(400).json({ error: 'A correction reason of at least 10 characters is required' });
    const run = await CorrectionRun.create({ organizationId: req.organizationId, type, reason: String(req.body.reason).trim(), periodStart: start, periodEnd: end, rulePackId: req.body.rulePackId, initiatedBy: { userId: req.user.id, userName: req.user.name } });
    await enqueueJob('correction_run', { correctionRunId: run._id.toString() }, { idempotencyKey: `correction-run:${run._id}` });
    res.status(202).json({ run, message: 'Correction run queued. Approved source versions remain immutable.' });
});

module.exports = router;
