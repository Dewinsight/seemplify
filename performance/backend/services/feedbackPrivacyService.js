'use strict';
const Feedback = require('../models/Feedback');

function formatType(type) {
  return ({ praise: 'Positive', coaching: 'Constructive', general: 'General' })[type] || 'General';
}

async function filterReportableAnonymous(items, organizationId) {
  const cohortIds = [...new Set(items
    .filter((item) => item.anonymity === 'anonymous' && item.cohortId)
    .map((item) => String(item.cohortId)))];
  if (cohortIds.length === 0) return items.filter((item) => item.anonymity !== 'anonymous');
  const counts = await Feedback.aggregate([
    {
      $match: {
        organizationId: String(organizationId),
        anonymity: 'anonymous',
        senderId: { $type: 'string', $regex: /\S/ },
        cohortId: { $in: cohortIds },
        deletedAt: null
      }
    },
    { $group: { _id: { cohortId: '$cohortId', receiverId: '$receiverId', senderId: '$senderId' } } },
    { $group: { _id: { cohortId: '$_id.cohortId', receiverId: '$_id.receiverId' }, count: { $sum: 1 } } }
  ]);
  const countByCohort = new Map(counts.map((row) => [JSON.stringify([row._id.cohortId, row._id.receiverId]), row.count]));
  return items.filter((item) => (
    item.anonymity !== 'anonymous'
      || (item.cohortId && (countByCohort.get(JSON.stringify([item.cohortId, item.receiverId])) || 0) >= Math.max(5, Number(item.minimumCohortSize) || 5))
  ));
}

async function anonymousFeedbackIsReportable(item) {
  if (item.anonymity !== 'anonymous') return true;
  if (!item.cohortId) return false;
  const authors = await Feedback.distinct('senderId', {
    organizationId: item.organizationId,
    receiverId: item.receiverId,
    anonymity: 'anonymous',
    senderId: { $type: 'string', $regex: /\S/ },
    cohortId: item.cohortId,
    deletedAt: null
  });
  return authors.length >= Math.max(5, Number(item.minimumCohortSize) || 5);
}

function serializeFeedback(item, viewerId, role) {
  const hideSender = feedbackHidesSender(item, viewerId, role);
  return {
    _id: item._id,
    sender: hideSender ? 'Anonymous' : item.senderInfo?.name || item.senderInfo?.email || 'Unknown',
    senderId: hideSender ? null : item.senderId,
    receiver: item.receiverInfo?.name || item.receiverInfo?.email || 'Unknown',
    receiverId: item.receiverId,
    type: formatType(item.type),
    message: item.content,
    visibility: item.visibility,
    contextType: item.contextType,
    contextLabel: item.contextLabel,
    relatedOkrId: item.relatedOkrId,
    projectId: item.projectId,
    ...(!hideSender ? { requestId: item.requestId } : {}),
    appraisalEvidence: item.appraisalEvidence,
    acknowledgedAt: item.acknowledgedAt,
    ...(!hideSender ? { date: item.createdAt } : {})
  };
}

function feedbackHidesSender(item, viewerId, role) {
  const authorIsViewer = String(item.senderId) === String(viewerId);
  return !authorIsViewer && (item.anonymity === 'anonymous' ||
    (item.anonymity === 'confidential' && String(item.receiverId) === String(viewerId) && role !== 'hr_admin'));
}

async function reportableFeedbackIds(query) {
  if (typeof query.organizationId !== 'string' || !query.organizationId) throw new TypeError('A single organization is required for feedback privacy.');
  const items = await Feedback.find(query).select('_id anonymity cohortId receiverId minimumCohortSize').lean();
  return (await filterReportableAnonymous(items, query.organizationId)).map(item => item._id);
}

async function countReportableFeedback(query) {
  return (await reportableFeedbackIds(query)).length;
}

async function reportableFeedbackFilter(query) {
  return { $and: [query, { _id: { $in: await reportableFeedbackIds(query) } }] };
}

module.exports = { filterReportableAnonymous, anonymousFeedbackIsReportable, serializeFeedback,
  feedbackHidesSender, countReportableFeedback, reportableFeedbackFilter };
