const crypto = require('crypto');
const fs = require('fs');
const AutomationEventOutbox = require('../models/AutomationEventOutbox');
const LeaveRequest = require('../models/LeaveRequest');

function hubUrl() { return String(process.env.WORKSPACE_AUTOMATION_API_URL || process.env.AUTOMATION_HUB_API_URL || '').replace(/\/$/, ''); }
function signingSecret() {
  const file = String(process.env.WORKSPACE_AUTOMATION_HMAC_SECRET_FILE || process.env.AUTOMATION_HUB_HMAC_SECRET_FILE || '').trim();
  return file ? fs.readFileSync(file, 'utf8').trim() : String(process.env.WORKSPACE_AUTOMATION_HMAC_SECRET || process.env.AUTOMATION_HUB_HMAC_SECRET || '').trim();
}

function requestRevision(request) { return String(request.__v ?? 0); }

async function queueLeaveSubmittedEvent(request) {
  if (!hubUrl() || request.status !== 'pending') return null;
  const revision = requestRevision(request);
  const eventId = `leave-submitted:${String(request.organizationId)}:${String(request._id)}:${revision}`;
  const envelope = {
    id: eventId,
    name: 'leave.request_submitted.v1',
    schemaVersion: 1,
    organizationId: String(request.organizationId),
    actorId: String(request.userId),
    subjectType: 'leave_request',
    subjectId: String(request._id),
    subjectRevision: revision,
    occurredAt: new Date(request.createdAt || Date.now()).toISOString(),
    correlationId: eventId,
    dataClass: 'restricted',
    payload: {
      requestId: String(request._id),
      requestRevision: revision,
      employeeId: String(request.userId),
      approverId: String(request.assignedApprover?.userId || ''),
      leaveType: String(request.leaveType),
      startsAt: new Date(request.startDate).toISOString(),
      endsAt: new Date(request.endDate).toISOString(),
      teamChannelId: String(request.teamId || ''),
    },
  };
  await AutomationEventOutbox.updateOne(
    { eventId },
    { $setOnInsert: { eventId, organizationId: request.organizationId, envelope } },
    { upsert: true }
  );
  return eventId;
}

async function reconcilePendingLeaveEvents(limit = 100) {
  if (!hubUrl()) return 0;
  const pending = await LeaveRequest.find({ status: 'pending' }).sort({ createdAt: 1 }).limit(limit);
  for (const request of pending) await queueLeaveSubmittedEvent(request);
  return pending.length;
}

let delivering = false;
async function deliverPending(limit = 20) {
  if (delivering || !hubUrl()) return { processed: 0 };
  delivering = true; let processed = 0;
  try {
    for (; processed < limit; processed += 1) {
      const current = new Date();
      const delivery = await AutomationEventOutbox.findOneAndUpdate(
        { status: { $in: ['pending', 'failed', 'delivering'] }, nextAttemptAt: { $lte: current }, $or: [{ leaseUntil: null }, { leaseUntil: { $exists: false } }, { leaseUntil: { $lte: current } }] },
        { $set: { status: 'delivering', leaseUntil: new Date(current.getTime() + 60000) }, $inc: { attempts: 1 } },
        { sort: { nextAttemptAt: 1 }, new: true }
      );
      if (!delivery) break;
      try {
        const body = JSON.stringify(delivery.envelope); const timestamp = String(Date.now());
        const signature = crypto.createHmac('sha256', signingSecret()).update(`${timestamp}.POST./api/internal/events.${body}`).digest('hex');
        const response = await fetch(`${hubUrl()}/api/internal/events`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-seemplify-organization': delivery.organizationId, 'x-seemplify-automation-timestamp': timestamp, 'x-seemplify-automation-signature': `sha256=${signature}` },
          body,
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
        delivery.status = 'delivered'; delivery.responseStatus = response.status; delivery.deliveredAt = new Date(); delivery.lastError = '';
      } catch (error) {
        delivery.status = delivery.attempts >= delivery.maxAttempts ? 'dead' : 'failed';
        delivery.responseStatus = error.status; delivery.lastError = String(error.message || error).slice(0, 1000);
        delivery.nextAttemptAt = new Date(Date.now() + Math.min(3600000, 15000 * (2 ** Math.max(0, delivery.attempts - 1))));
      }
      delivery.leaseUntil = undefined; await delivery.save();
    }
    return { processed };
  } finally { delivering = false; }
}

let worker;
function startAutomationEventWorker() {
  if (worker || !hubUrl()) return;
  worker = setInterval(async () => {
    await reconcilePendingLeaveEvents();
    await deliverPending();
  }, 15000);
  worker.unref?.();
  reconcilePendingLeaveEvents().then(() => deliverPending()).catch(error => console.error('Leave automation event delivery failed:', error.message));
}

module.exports = { deliverPending, queueLeaveSubmittedEvent, reconcilePendingLeaveEvents, requestRevision, startAutomationEventWorker };
