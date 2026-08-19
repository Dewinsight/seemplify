const crypto = require('crypto');
const fs = require('fs');
const AutomationEventOutbox = require('../models/AutomationEventOutbox');
const PayrollRun = require('../models/PayrollRun');
const { revision, totalsHash } = require('./payrollAutomationContract');

function hubUrl() { return String(process.env.WORKSPACE_AUTOMATION_API_URL || process.env.AUTOMATION_HUB_API_URL || '').replace(/\/$/, ''); }
function signingSecret() {
  const file = String(process.env.WORKSPACE_AUTOMATION_HMAC_SECRET_FILE || process.env.AUTOMATION_HUB_HMAC_SECRET_FILE || '').trim();
  if (file) return fs.readFileSync(file, 'utf8').trim();
  return String(process.env.WORKSPACE_AUTOMATION_HMAC_SECRET || process.env.AUTOMATION_HUB_HMAC_SECRET || '').trim();
}

async function queuePayrollReadyEvent(run, actorId) {
  if (!hubUrl()) return null;
  const eventId = `payroll-ready:${String(run.organizationId)}:${String(run._id)}:${revision(run)}`;
  const envelope = {
    id: eventId, name: 'payroll.run_ready_for_review.v1', schemaVersion: 1,
    organizationId: String(run.organizationId), actorId: String(actorId), subjectType: 'payroll_run',
    subjectId: String(run._id), subjectRevision: revision(run), occurredAt: new Date().toISOString(), correlationId: eventId,
    dataClass: 'restricted',
    payload: {
      runId: String(run._id), runRevision: revision(run), totalsHash: totalsHash(run),
      period: `${run.payPeriod?.year}-${String(run.payPeriod?.month || '').padStart(2, '0')}`,
      currency: String(run.summary?.currency || ''), total: Number(run.summary?.totalNetPayroll || 0), reviewerId: '',
    },
  };
  await AutomationEventOutbox.updateOne(
    { eventId },
    { $setOnInsert: { eventId, organizationId: run.organizationId, envelope } },
    { upsert: true }
  );
  return eventId;
}

async function reconcilePendingPayrollEvents(limit = 100) {
  if (!hubUrl()) return 0;
  const runs = await PayrollRun.find({ status: 'pending_approval' }).sort({ updatedAt: 1 }).limit(limit);
  for (const run of runs) {
    const submitted = [...(run.approvals || [])].reverse().find(item => item.status === 'submitted');
    await queuePayrollReadyEvent(run, String(submitted?.actionBy || run.createdBy || 'payroll'));
  }
  return runs.length;
}

let delivering = false;
async function deliverPending(limit = 20) {
  if (delivering || !hubUrl()) return { processed: 0 };
  delivering = true; let processed = 0;
  try {
    for (; processed < limit; processed += 1) {
      const current = new Date();
      const delivery = await AutomationEventOutbox.findOneAndUpdate({ status: { $in: ['pending', 'failed', 'delivering'] }, nextAttemptAt: { $lte: current }, $or: [{ leaseUntil: null }, { leaseUntil: { $exists: false } }, { leaseUntil: { $lte: current } }] }, { $set: { status: 'delivering', leaseUntil: new Date(current.getTime() + 60000) }, $inc: { attempts: 1 } }, { sort: { nextAttemptAt: 1 }, new: true });
      if (!delivery) break;
      try {
        const body = JSON.stringify(delivery.envelope); const timestamp = String(Date.now());
        const signature = crypto.createHmac('sha256', signingSecret()).update(`${timestamp}.POST./api/internal/events.${body}`).digest('hex');
        const response = await fetch(`${hubUrl()}/api/internal/events`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-seemplify-organization': delivery.organizationId, 'x-seemplify-automation-timestamp': timestamp, 'x-seemplify-automation-signature': `sha256=${signature}` }, body, signal: AbortSignal.timeout(10000) });
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
  worker = setInterval(() => reconcilePendingPayrollEvents().then(() => deliverPending()).catch(error => console.error('Payroll automation event delivery failed:', error.message)), 15000);
  worker.unref?.();
  reconcilePendingPayrollEvents().then(() => deliverPending()).catch(error => console.error('Payroll automation event startup delivery failed:', error.message));
}

module.exports = { deliverPending, queuePayrollReadyEvent, reconcilePendingPayrollEvents, startAutomationEventWorker };
