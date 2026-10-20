'use strict';
const crypto = require('crypto');
const { Types } = require('mongoose');
const Operation = require('../models/CompetencyOperation');
const FeedbackRequest = require('../models/FeedbackRequest');
const ACTION = 'feedback.request.create';
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const failure = (status, code, message) => Object.assign(new Error(message), { status, code });

async function beginBatch({ organizationId, actorId, key, payload }) {
  if (key === undefined) return null;
  if (typeof key !== 'string' || !/^[a-zA-Z0-9_.:-]{8,150}$/.test(key)) {
    throw failure(400, 'INVALID_REQUEST_KEY', 'Retry this request using its original form.');
  }
  const scopeHash = digest([ACTION, organizationId, actorId, key]);
  const scope = { _id: new Types.ObjectId(scopeHash.slice(0, 24)), organizationId, actorId, action: ACTION, key: scopeHash };
  const requestHash = digest(payload);
  let entry;
  try {
    entry = await Operation.findOneAndUpdate({ _id: scope._id }, { $setOnInsert: {
      ...scope, requestHash, status: 'pending', result: { cohortId: crypto.randomUUID(), requestIds: [] }
    } }, { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true });
  } catch (error) {
    if (error.code !== 11000) throw error;
    entry = await Operation.findById(scope._id);
  }
  // The built-in unique _id, not an asynchronously created secondary index,
  // arbitrates concurrent creates. Feedback keys do not expire: otherwise a
  // reused key could lose its changed-payload conflict after ledger retention.
  if (!entry || entry.organizationId !== organizationId || entry.actorId !== actorId || entry.action !== ACTION || entry.key !== scopeHash || entry.requestHash !== requestHash) {
    throw failure(409, 'REQUEST_KEY_CONFLICT', 'This request key was already used for different changes.');
  }
  return entry;
}

function invitationId(batch, reviewerId) {
  return new Types.ObjectId(digest([String(batch._id), reviewerId]).slice(0, 24));
}

async function completedBatch(batch) {
  if (!batch || batch.status !== 'complete') return null;
  const ids = batch.result?.requestIds || [];
  const records = await FeedbackRequest.find({ _id: { $in: ids }, organizationId: batch.organizationId, requesterId: batch.actorId });
  if (!ids.length || records.length !== ids.length) {
    throw failure(409, 'REQUEST_RECOVERY_REQUIRED', 'This request changed. Check its existing invitations before starting another request.');
  }
  const byId = new Map(records.map(record => [String(record._id), record]));
  return ids.map(id => byId.get(String(id)));
}

async function finishBatch(batch, records) {
  if (!batch) return;
  await Operation.updateOne({ _id: batch._id, organizationId: batch.organizationId, actorId: batch.actorId, requestHash: batch.requestHash },
    { $set: { status: 'complete', 'result.requestIds': records.map(record => String(record._id)) } });
}

module.exports = { beginBatch, invitationId, completedBatch, finishBatch };
