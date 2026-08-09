const crypto = require('crypto');
const express = require('express');
const { ALLOWED_APPLICATIONS, AttendancePolicy, PresenceSession } = require('../models');
const { appendEvent, hashIp, userAgentFamily } = require('../services/presenceService');

const router = express.Router();

function verify(req, res, next) {
    const secret = process.env.INTERNAL_SERVICE_SECRET || process.env.PRESENCE_REPORTER_SERVICE_SECRET || '';
    if (!secret) {
        if (process.env.NODE_ENV === 'production') return res.status(503).json({ error: 'Presence reporter authentication is not configured' });
        return next();
    }
    const timestamp = String(req.get('x-service-timestamp') || '');
    const signature = String(req.get('x-service-signature') || '').replace(/^sha256=/, '');
    if (!Number.isFinite(Date.parse(timestamp)) || Math.abs(Date.now() - Date.parse(timestamp)) > 300000) return res.status(401).json({ error: 'Expired service request' });
    const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${JSON.stringify(req.body || {})}`).digest('hex');
    if (!/^[a-f0-9]{64}$/i.test(signature) || !crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))) return res.status(401).json({ error: 'Invalid service signature' });
    req.serviceId = String(req.get('x-service-id') || 'unknown');
    next();
}

function validClientSessionId(value) {
    const normalized = String(value || '').trim();
    return /^[a-zA-Z0-9_-]{12,128}$/.test(normalized) ? normalized : null;
}

function validFeatureCode(value) {
    const normalized = String(value || '').trim();
    return /^[a-zA-Z0-9._:-]{1,80}$/.test(normalized) ? normalized : null;
}

const SERVICE_APPLICATIONS = Object.freeze({
    idp: 'idp',
    payroll: 'payroll',
    performance: 'performance',
    'leave-management': 'leave-management',
    recruiter: 'recruiter',
});

router.use(verify);
router.use((req, res, next) => {
    if (!SERVICE_APPLICATIONS[req.serviceId] || SERVICE_APPLICATIONS[req.serviceId] !== String(req.body?.appId || '')) {
        return res.status(403).json({ error: 'Reporter cannot submit evidence for another application' });
    }
    return next();
});

router.post('/sessions', async (req, res) => {
    const { organizationId, userId } = req.body;
    const appId = String(req.body.appId || '');
    const clientSessionId = validClientSessionId(req.body.clientSessionId);
    if (!organizationId || !userId || !clientSessionId || !ALLOWED_APPLICATIONS.includes(appId)) return res.status(400).json({ error: 'Valid organizationId, userId, appId and clientSessionId are required' });
    const policy = await AttendancePolicy.findOne({ organizationId }).select('presence.enabled').lean();
    if (policy?.presence?.enabled === false) return res.status(403).json({ error: 'Presence reporting is disabled for this organization' });
    const now = new Date();
    const session = await PresenceSession.findOneAndUpdate(
        { organizationId, userId, appId, clientSessionId },
        {
            $setOnInsert: { startedAt: now, ipHash: hashIp(req.ip), userAgentFamily: userAgentFamily(req.get('user-agent')) },
            $set: { lastHeartbeatAt: now, visible: req.body.visible !== false, status: 'active', appVersion: String(req.body.appVersion || '').slice(0, 80) },
            $unset: { endedAt: 1, endReason: 1 },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    await appendEvent(session, 'started');
    res.status(201).json({ sessionId: session._id, heartbeatIntervalSeconds: 120, staleAfterSeconds: 300 });
});

async function scopedSession(req, res) {
    const session = await PresenceSession.findOne({ _id: req.params.id, organizationId: req.body.organizationId, userId: req.body.userId, appId: req.body.appId });
    if (!session) res.status(404).json({ error: 'Presence session not found' });
    return session;
}

router.post('/sessions/:id/heartbeat', async (req, res) => {
    const session = await scopedSession(req, res); if (!session) return;
    session.visible = req.body.visible !== false; session.lastHeartbeatAt = new Date(); session.status = 'active'; await session.save();
    await appendEvent(session, session.visible ? 'heartbeat' : 'hidden'); res.json({ accepted: true });
});

router.post('/sessions/:id/activity', async (req, res) => {
    const session = await scopedSession(req, res); if (!session) return;
    const featureCode = validFeatureCode(req.body.featureCode);
    if (!featureCode || !['navigation', 'action'].includes(req.body.activityKind)) return res.status(400).json({ error: 'Safe activityKind and featureCode are required' });
    session.lastActivityAt = new Date(); session.lastHeartbeatAt = new Date(); session.status = 'active'; await session.save();
    await appendEvent(session, 'activity', { activityKind: req.body.activityKind, featureCode }); res.json({ accepted: true });
});

router.post('/sessions/:id/end', async (req, res) => {
    const session = await scopedSession(req, res); if (!session) return;
    session.endedAt = new Date(); session.status = 'ended'; session.endReason = String(req.body.reason || 'client_end').slice(0, 80); await session.save();
    await appendEvent(session, 'ended'); res.json({ accepted: true });
});

module.exports = router;
