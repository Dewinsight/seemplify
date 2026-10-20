'use strict';
const { publishDomainEvent } = require('./outboxService');
const failure = (message, statusCode) => Object.assign(new Error(message), { statusCode });

async function queue(meeting, actorId) {
  if (!['scheduled', 'in_progress'].includes(meeting.status) || +meeting.scheduledDate + Number(meeting.duration) * 60000 <= Date.now()) throw failure('This call has ended or was closed. Schedule a new call to send an invitation.', 409);
  const recipients = [[meeting.managerId, meeting.managerInfo], [meeting.employeeId, meeting.employeeInfo]].map(([userId, info]) => ({ userId: String(userId), name: info?.name, email: info?.email, channels: ['in_app', 'email'] }));
  if (recipients.some(person => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person.email || ''))) throw failure('Both participants need a valid email address before sending a reminder.', 409);
  const slot = Math.floor(Date.now() / 300000);
  await publishDomainEvent({
    eventId: `call-reminder:${meeting._id}:${actorId}:${slot}`, eventType: 'one_on_one.call_reminder', organizationId: meeting.organizationId,
    aggregate: { type: 'one_on_one', id: String(meeting._id) }, actor: { userId: actorId }, recipients,
    notification: { category: 'one_on_one', title: 'Review call reminder',
      message: `Your review call starts at ${new Date(meeting.scheduledDate).toISOString()} (UTC), for ${meeting.duration} minutes. Open the meeting to join and check recording permissions.`,
      deepLink: meeting.appraisalId ? `/appraisals/${meeting.appraisalId}` : `/one-on-ones/${meeting._id}`,
      priority: 'normal', isAction: false, action: { kind: 'view', label: 'Open meeting' } }
  });
  return { queued: true, message: 'Reminder queued for both participants. Repeated clicks within the current five-minute window reuse this reminder.' };
}
module.exports = { queue };
