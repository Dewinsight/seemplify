const crypto = require('crypto');
const express = require('express');
const { LeaveRequest, LeavePolicy } = require('../models');
const { buildLeaveData } = require('../services/attendanceIntegrationService');

const router = express.Router();

router.use((req, res, next) => {
  const secret = process.env.INTERNAL_SERVICE_SECRET || process.env.TIME_ATTENDANCE_LEAVE_SECRET || '';
  if (!secret) {
    if (process.env.NODE_ENV === 'production') return res.status(503).json({ error: 'Leave reconciliation authentication is not configured' });
    return next();
  }
  const timestamp = String(req.get('x-service-timestamp') || '');
  const received = String(req.get('x-service-signature') || '').replace(/^sha256=/, '');
  if (!Number.isFinite(Date.parse(timestamp)) || Math.abs(Date.now() - Date.parse(timestamp)) > 300000) return res.status(401).json({ error: 'Expired service request' });
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${JSON.stringify(req.body || {})}`).digest('hex');
  if (!/^[a-f0-9]{64}$/i.test(received) || !crypto.timingSafeEqual(Buffer.from(received, 'hex'), Buffer.from(expected, 'hex'))) return res.status(401).json({ error: 'Invalid service signature' });
  next();
});

router.post('/reconcile', async (req, res) => {
  const organizationId = req.body?.organizationId;
  if (!organizationId) return res.status(400).json({ error: 'organizationId is required' });
  const [requests, policy] = await Promise.all([
    LeaveRequest.find({ organizationId, status: { $in: ['approved', 'cancelled'] } }).lean(),
    LeavePolicy.findOne({ organizationId }).lean(),
  ]);
  res.json({
    schemaVersion: '1.0', organizationId, generatedAt: new Date(),
    leaves: requests.map(request => buildLeaveData(request)),
    holidays: (policy?.holidays || []).map(holiday => ({ holidayId: holiday._id, name: holiday.name, date: holiday.date, isRecurring: holiday.isRecurring })),
  });
});

module.exports = router;
