const crypto = require('crypto');
const express = require('express');
const TimeAttendanceImport = require('../models/TimeAttendanceImport');

const router = express.Router();

function verifyServiceRequest(req, res, next) {
  const secret = process.env.INTERNAL_SERVICE_SECRET || process.env.TIME_ATTENDANCE_PAYROLL_SECRET || '';
  if (!secret) {
    if (process.env.NODE_ENV === 'production') return res.status(503).json({ error: 'Payroll integration authentication is not configured' });
    return next();
  }
  const timestamp = String(req.get('x-service-timestamp') || '');
  const received = String(req.get('x-service-signature') || '').replace(/^sha256=/, '');
  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) return res.status(401).json({ error: 'Expired service request' });
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${JSON.stringify(req.body || {})}`).digest('hex');
  if (!/^[a-f0-9]{64}$/i.test(received) || !crypto.timingSafeEqual(Buffer.from(received, 'hex'), Buffer.from(expected, 'hex'))) return res.status(401).json({ error: 'Invalid service signature' });
  next();
}

router.use(verifyServiceRequest);

router.post('/timesheets', async (req, res) => {
  try {
    const idempotencyKey = String(req.get('idempotency-key') || req.body.idempotencyKey || '').trim();
    if (!idempotencyKey) return res.status(400).json({ error: 'Idempotency-Key is required' });
    const existing = await TimeAttendanceImport.findOne({ idempotencyKey });
    if (existing) return res.json({ status: existing.status, transferId: existing._id, idempotentReplay: true });
    const required = [
      'schemaVersion', 'eventId', 'organizationId', 'subjectId', 'occurredAt',
      'correlationId', 'idempotencyKey', 'userId', 'sourceTimesheetId', 'sourceVersion', 'period',
    ];
    const missing = required.filter(field => req.body[field] === undefined || req.body[field] === null);
    if (missing.length) return res.status(400).json({ error: `Missing fields: ${missing.join(', ')}` });
    if (req.body.schemaVersion !== '1.0' || Number.isNaN(Date.parse(req.body.occurredAt))) return res.status(400).json({ error: 'Unsupported schemaVersion or invalid occurredAt' });
    if (String(req.body.subjectId) !== String(req.body.userId)) return res.status(400).json({ error: 'subjectId must match userId' });
    if (String(req.body.idempotencyKey) !== idempotencyKey) return res.status(400).json({ error: 'Body and header idempotency keys must match' });
    if (!Array.isArray(req.body.payCodeLines)) return res.status(400).json({ error: 'payCodeLines must be an array' });
    if (req.body.payCodeLines.some(line => !line.payCode || !Number.isFinite(Number(line.quantity)))) return res.status(400).json({ error: 'Every pay-code line requires a payCode and numeric quantity' });
    const sourcePayloadHash = crypto.createHash('sha256').update(JSON.stringify(req.body)).digest('hex');
    let supersedesImportId;
    if (req.body.eventType === 'adjustment') {
      const previous = await TimeAttendanceImport.findOne({ organizationId: req.body.organizationId, sourceTimesheetId: req.body.supersedesTimesheetId || req.body.sourceTimesheetId }).sort({ sourceVersion: -1 });
      supersedesImportId = previous?._id;
    }
    const noData = req.body.payCodeLines.length === 0;
    const imported = await TimeAttendanceImport.create({
      ...req.body,
      idempotencyKey,
      sourcePayloadHash,
      supersedesImportId,
      status: noData ? 'no_data' : 'accepted',
    });
    if (!noData && supersedesImportId) await TimeAttendanceImport.updateOne({ _id: supersedesImportId }, { $set: { status: 'superseded' } });
    return res.status(202).json({ status: imported.status, transferId: imported._id, acceptedAt: imported.acceptedAt });
  } catch (error) {
    if (error.code === 11000) {
      const existing = await TimeAttendanceImport.findOne({ $or: [{ idempotencyKey: req.get('idempotency-key') }, { organizationId: req.body.organizationId, sourceTimesheetId: req.body.sourceTimesheetId, sourceVersion: req.body.sourceVersion }] });
      return res.json({ status: existing?.status || 'accepted', transferId: existing?._id, idempotentReplay: true });
    }
    console.error('T&A payroll import failed:', error);
    return res.status(500).json({ error: 'Payroll could not accept the timesheet' });
  }
});

router.get('/timesheets/:sourceTimesheetId/status', async (req, res) => {
  const imported = await TimeAttendanceImport.findOne({ organizationId: req.query.organizationId, sourceTimesheetId: req.params.sourceTimesheetId }).sort({ sourceVersion: -1 });
  if (!imported) return res.status(404).json({ error: 'Transfer not found' });
  res.json({ status: imported.status, transferId: imported._id, sourceVersion: imported.sourceVersion, acceptedAt: imported.acceptedAt, appliedPayrollRunId: imported.appliedPayrollRunId });
});

module.exports = router;
