'use strict';
const Meeting = require('../models/PerformanceMeeting');
const Observation = require('../models/PerformanceNotetakerObservation');
const Account = require('../models/NylasAccount');
const shared = require('./aiRuntime/sharedIdentityService');
const nylas = require('./nylasV3Service');
const normalize = require('./performanceNotetakerState');
const fail = (message, statusCode = 503) => Object.assign(new Error(message), { statusCode });
async function status(rawIdentity, input = {}) {
  const { identity } = await shared.resolveSharedPrincipal(rawIdentity);
  if (!identity.organizationId || !/^[a-f0-9]{24}$/i.test(String(input.externalId || ''))) throw fail('A valid meeting is required.', 400);
  const key = { organizationId: identity.organizationId, ownerSubject: identity.sub, externalId: input.externalId };
  const meeting = await Meeting.findOne(key);
  if (!meeting) throw fail('Meeting not found.', 404);
  const prior = await Observation.findOne(key).lean();
  const result = { realtimeTranscript: false, state: meeting.recordingState || 'not_requested', meetingState: null, checkedAt: null, events: prior?.events || [], transcriptState: 'not_available', recordingAvailable: false, calendarEmail: null, calendarProvider: null };
  if (meeting.state === 'cancelled' || meeting.recordingState === 'revoked') return { ...result, state: 'revoked' };
  const account = await Account.findOne({ _id: meeting.accountId, active: true }).select('+apiKey');
  if (!account) throw fail('The meeting calendar application is unavailable.');
  const credentials = { apiKey: account.apiKey, apiUri: account.apiUri, clientId: account.clientId, region: account.region };
  try {
    const grant = (await nylas.getNylasInstance(credentials).grants.find({ grantId: meeting.grantId })).data;
    result.calendarEmail = grant?.email || null; result.calendarProvider = grant?.provider || null;
  } catch { /* A revoked calendar must not hide an independent notetaker's state. */ }
  if (!meeting.notetakerId) return result;
  const response = await nylas.getStandaloneNotetakerStatus(meeting.notetakerId, credentials);
  const data = response.data || response;
  const { state, meetingState: directReason } = normalize.normalize(data);
  let providerEvents = prior?.providerEvents || [], historyCheckedAt = prior?.historyCheckedAt;
  if (!historyCheckedAt || prior?.state !== state || Date.now() - +historyCheckedAt >= 30000) {
    try { providerEvents = normalize.history(await nylas.getStandaloneNotetakerHistory(meeting.notetakerId, credentials)); historyCheckedAt = new Date(); }
    catch { /* Keep available status and cached history when history is temporarily unavailable. */ }
  }
  const mediaPhase = ['available', 'processing', 'media_error', 'media_deleted', 'complete', 'completed'].includes(state);
  const historyReason = [...providerEvents].reverse().find(event => (event.state === state || (mediaPhase && event.state === 'disconnected')) && !['unknown', 'worker_finished'].includes(event.meetingState));
  const meetingState = directReason !== 'unknown' ? directReason : historyReason?.meetingState || 'unknown';
  // A stop/cancel racing provider I/O must not republish recording information.
  if (!await Meeting.exists({ ...key, recordingState: { $ne: 'revoked' }, state: { $ne: 'cancelled' } })) return { ...result, state: 'revoked', events: [] };
  const now = new Date();
  let current;
  try { current = await Observation.findOneAndUpdate(key, { $setOnInsert: { events: [] } }, { upsert: true, new: true }); }
  catch (error) { if (error.code !== 11000) throw error; current = await Observation.findOne(key); }
  const changed = await Observation.findOneAndUpdate({ ...key, $or: [{ state: { $ne: state } }, { meetingState: { $ne: meetingState } }] }, { $set: { state, meetingState, lastCheckedAt: now }, $push: { events: { $each: [{ state, meetingState, observedAt: now }], $slice: -30 } } }, { new: true });
  if (changed) current = changed;
  else await Observation.updateOne(key, { $set: { lastCheckedAt: now } });
  if (historyCheckedAt) await Observation.updateOne(key, { $set: { providerEvents, historyCheckedAt } });
  let media;
  const mediaExpected = meetingState === 'meeting_ended' || ['disconnected', 'complete', 'completed', 'processing', 'available'].includes(state);
  if (mediaExpected) {
    try { media = await nylas.getStandaloneNotetakerMedia(meeting.notetakerId, credentials); } catch { /* Still processing. */ }
  }
  if (!await Meeting.exists({ ...key, recordingState: { $ne: 'revoked' }, state: { $ne: 'cancelled' } })) return { ...result, state: 'revoked', events: [] };
  const events = providerEvents.length ? [...providerEvents, ...(providerEvents.at(-1).state !== state ? [{ state, meetingState, observedAt: now }] : [])] : current.events;
  return { ...result, state, meetingState, checkedAt: now, events,
    transcriptState: media?.transcript?.url ? 'available' : state === 'media_deleted' ? 'expired' : state === 'media_error' ? 'failed' : mediaExpected ? 'processing' : 'after_call',
    recordingAvailable: Boolean(media?.recording?.url || media?.video?.url || media?.audio?.url) };
}
async function retry(rawIdentity, input = {}) {
  const { identity } = await shared.resolveSharedPrincipal(rawIdentity);
  if (!identity.organizationId || !/^[a-f0-9]{24}$/i.test(String(input.externalId || ''))) throw fail('A valid meeting is required.', 400);
  const key = { organizationId: identity.organizationId, ownerSubject: identity.sub, externalId: input.externalId };
  const record = await Meeting.findOne(key);
  if (!record) throw fail('Meeting not found.', 404);
  if (!['calendar-recording-v1', 'calendar-notetaker-v2'].includes(record.recordingPolicyVersion) || record.state !== 'scheduled' || record.recordingState === 'revoked' || !record.notetakerId || +record.scheduledDate > Date.now() || +record.scheduledDate + record.duration * 60000 <= Date.now()) throw fail('This call cannot accept another notetaker.', 409);
  const authorization = input.recordingAuthorization;
  if (authorization?.policyVersion !== 'calendar-notetaker-v2' || !record.participantSubjects.includes(authorization.requestedBy) || !Number.isFinite(+new Date(authorization.requestedAt)) || +new Date(authorization.requestedAt) > Date.now()) throw fail('Only a meeting participant can retry the notetaker.', 403);
  const account = await Account.findOne({ _id: record.accountId, active: true }).select('+apiKey');
  if (!account) throw fail('The meeting calendar application is unavailable.');
  const live = await nylas.getStandaloneNotetakerStatus(record.notetakerId, { apiKey: account.apiKey, apiUri: account.apiUri, region: account.region });
  // Only a provider-confirmed entry failure permits replacement. Never create a
  // second bot when the first is joining, attending, processing or unconfirmed.
  if ((live.data?.state || live.state || live.status) !== 'failed_entry') throw fail('The provider has not confirmed an entry failure. Refresh the notetaker status.', 409);
  const claimed = await Meeting.findOneAndUpdate({ ...key, state: 'scheduled', recordingState: { $ne: 'revoked' }, notetakerId: record.notetakerId }, { $unset: { notetakerId: 1 }, $set: { recordingState: 'awaiting_start' } }, { new: true });
  if (!claimed) throw fail('The notetaker is already being updated. Refresh its status.', 409);
  return require('./performanceMeetingService').startRecording(rawIdentity, { externalId: input.externalId, recordingAuthorization: authorization, joinNow: true });
}
module.exports = { status, retry };
