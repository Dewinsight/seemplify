'use strict';
const OneOnOne = require('../models/OneOnOne');
const { assertNoLiveCall, failure } = require('./meetingCallService');
const shared = require('./sharedAIAccountService');
const reminders = require('./reminderScheduler');
const CLOSED = ['completed', 'employee_acknowledged'];
const actor = req => ({ userId: String(req.session.user.sub || req.session.user.id), name: req.session.user.name || req.session.user.email });

async function ensureCallsEnded(appraisal) {
  const meetings = await OneOnOne.find({ appraisalId: appraisal._id, organizationId: appraisal.organizationId });
  for (const meeting of meetings) await assertNoLiveCall(meeting);
  return meetings;
}

async function stopRelatedWork(appraisal) {
  let pending = false;
  const closeReminders = async (targetType, targetId) => {
    try { await reminders.cancelRemindersForTarget({ organizationId: appraisal.organizationId, targetType, targetId: String(targetId), reason: 'appraisal_cancelled_or_removed' }); }
    catch { pending = true; }
  };
  for (const type of ['appraisal', 'appraisal_self_assessment', 'appraisal_manager_review', 'appraisal_discussion', 'appraisal_acknowledgement']) await closeReminders(type, appraisal._id);
  const meetings = await OneOnOne.find({ appraisalId: appraisal._id, organizationId: appraisal.organizationId });
  for (const meeting of meetings) {
    if (!['completed', 'no_show'].includes(meeting.status)) {
      const call = meeting.appraisalMeeting;
      // Close local access first. Provider outages never leave a cancelled review joinable.
      await OneOnOne.updateOne({ _id: meeting._id, organizationId: appraisal.organizationId }, { $set: { status: 'cancelled' } });
      if (call?.mode !== 'in_app' && call?.ownerIdentity && call?.calendarState !== 'cancelled') {
        try {
          await shared.request('meetings/cancel', call.ownerIdentity, { externalId: String(meeting._id) });
          await OneOnOne.updateOne({ _id: meeting._id }, { $set: { 'appraisalMeeting.calendarState': 'cancelled' } });
        } catch {
          pending = true;
          await OneOnOne.updateOne({ _id: meeting._id }, { $set: { 'appraisalMeeting.calendarState': 'cancellation_pending' } });
        }
      }
    }
    await closeReminders('one_on_one', meeting._id);
    for (const item of meeting.actionItems || []) await closeReminders('one_on_one_action_item', `${meeting._id}:${item._id}`);
  }
  appraisal.lifecycle.cleanupPending = pending;
  await appraisal.save();
  return pending;
}

async function cancel(appraisal, req) {
  if (CLOSED.includes(appraisal.status) || appraisal.finalRating?.finalizedAt) throw failure('Completed appraisals cannot be cancelled. HR can remove them from the lists while keeping their records.');
  await ensureCallsEnded(appraisal);
  if (appraisal.status !== 'cancelled') {
    const previousStatus = appraisal.status;
    appraisal.status = 'cancelled';
    appraisal.lifecycle = { ...appraisal.lifecycle?.toObject?.() || appraisal.lifecycle, cancelledAt: new Date(), cancelledBy: actor(req), reason: String(req.body.reason || '').trim().slice(0, 1000), cleanupPending: true };
    appraisal.flags.isOverdue = false; appraisal.flags.needsAttention = false;
    for (const notification of appraisal.notifications || []) notification.readAt ||= new Date();
    appraisal.addAuditLog('appraisal_cancelled', { ...req.session.user, id: actor(req).userId }, { previousStatus, reason: appraisal.lifecycle.reason });
    await appraisal.save();
  }
  await stopRelatedWork(appraisal);
  return appraisal;
}

async function remove(appraisal, req, isHr) {
  if (appraisal.removedAt) return appraisal;
  if ((CLOSED.includes(appraisal.status) || appraisal.finalRating?.finalizedAt) && !isHr) throw failure('Only HR or an organization administrator can remove a completed appraisal.', 403);
  if (!CLOSED.includes(appraisal.status) && !appraisal.finalRating?.finalizedAt) await cancel(appraisal, req);
  else { await ensureCallsEnded(appraisal); await stopRelatedWork(appraisal); }
  if (appraisal.lifecycle.cleanupPending) throw failure('The appraisal is closed, but some invitations or reminders still need cancellation. Retry cancellation before removing it.', 503);
  appraisal.removedAt = new Date();
  appraisal.lifecycle.removedBy = actor(req);
  appraisal.addAuditLog('appraisal_removed', { ...req.session.user, id: actor(req).userId }, { reason: String(req.body.reason || '').trim().slice(0, 1000) });
  await appraisal.save();
  return appraisal;
}

async function restore(appraisal, req) {
  if (!appraisal.removedAt) return appraisal;
  appraisal.removedAt = null; appraisal.lifecycle.restoredAt = new Date();
  appraisal.addAuditLog('appraisal_restored', { ...req.session.user, id: actor(req).userId }, { status: appraisal.status });
  await appraisal.save();
  return appraisal;
}
async function retry(appraisal) {
  if (!['cancelled', ...CLOSED].includes(appraisal.status) && !appraisal.finalRating?.finalizedAt) throw failure('Cancel this appraisal before retrying outstanding cancellations.');
  await ensureCallsEnded(appraisal);
  await stopRelatedWork(appraisal);
  return appraisal;
}
module.exports = { CLOSED, cancel, remove, restore, retry };
