'use strict';

const PerformanceMeeting = require('../models/PerformanceMeeting');
const NylasAccount = require('../models/NylasAccount');
const nylas = require('./nylasV3Service');
const sharedIdentity = require('./aiRuntime/sharedIdentityService');

function failure(message, code, statusCode = 409) { return Object.assign(new Error(message), { code, statusCode }); }
function meetingUrl(value) {
  if (!value) return null;
  let url;
  try { url = new URL(value); } catch { throw failure('Enter a valid meeting link.', 'MEETING_LINK_INVALID', 400); }
  if (url.protocol !== 'https:' || url.username || url.password || !['meet.google.com', 'teams.microsoft.com', 'teams.live.com', 'zoom.us'].some(host => url.hostname === host || (host === 'zoom.us' && url.hostname.endsWith('.zoom.us')))) throw failure('Use a Google Meet, Teams or Zoom meeting link.', 'MEETING_LINK_INVALID', 400);
  return url.href;
}
async function principal(rawIdentity) {
  const context = await sharedIdentity.resolveSharedPrincipal(rawIdentity);
  if (!context.identity.organizationId) throw failure('Choose an organization.', 'ORGANIZATION_REQUIRED', 400);
  return context;
}
async function credentials(accountId) {
  if (!accountId) return null;
  const account = await NylasAccount.findOne({ _id: accountId, active: true }).select('+apiKey');
  if (!account) throw failure('The calendar application is unavailable. Contact your administrator.', 'CALENDAR_APPLICATION_UNAVAILABLE', 503);
  return { apiKey: account.apiKey, apiUri: account.apiUri, region: account.region, clientId: account.clientId };
}
async function connection(identity) {
  const { user } = await principal(identity);
  const result = { connected: false, email: null, provider: null, disconnectPending: user.nylasGrantStatus === 'stopped' && Boolean(user.nylasGrantId), authority: 'recruiter', connectUrl: `${process.env.FRONTEND_URL || 'https://app.seemplifyai.com'}/settings/calendar` };
  if (!user.nylasGrantId || ['revoked', 'expired', 'invalid', 'stopped', 'reauth_pending'].includes(user.nylasGrantStatus)) return result;
  try {
    const grant = (await nylas.getNylasInstance(await credentials(user.nylasAccountId)).grants.find({ grantId: user.nylasGrantId })).data;
    return { ...result, connected: Boolean(grant?.email && ['valid', 'active'].includes(grant.grantStatus || grant.grant_status)), email: grant?.email || null, provider: grant?.provider || null };
  } catch (error) {
    if ([401, 404].includes(error.statusCode || error.status)) return result;
    throw failure('Your calendar connection could not be verified. Please retry.', 'CALENDAR_VERIFICATION_UNAVAILABLE', 503);
  }
}
function key(identity, input) {
  if (!/^[a-f0-9]{24}$/i.test(String(input.externalId || ''))) throw failure('A valid meeting reference is required.', 'MEETING_REFERENCE_INVALID', 400);
  return { organizationId: identity.organizationId, ownerSubject: identity.sub, externalId: input.externalId };
}
function publicMeeting(record) {
  return { eventId: record.eventId, calendarId: record.calendarId, conferenceUrl: record.conferenceUrl, recordingState: record.recordingState || 'not_requested', state: record.state };
}
async function create(rawIdentity, input) {
  const { user, identity } = await principal(rawIdentity);
  const query = key(identity, input);
  const existing = await PerformanceMeeting.findOne(query);
  if (existing?.eventId) return publicMeeting(existing);
  if (existing) throw failure('Calendar creation is awaiting reconciliation. It will not be repeated, to avoid duplicate invitations.', 'CALENDAR_CREATION_UNCERTAIN');
  if (!user.nylasGrantId || ['revoked', 'expired', 'invalid', 'stopped'].includes(user.nylasGrantStatus)) throw failure('Connect your own calendar in Performance first. Your colleague’s calendar cannot be used.', 'CALENDAR_CONNECTION_REQUIRED');
  const start = new Date(input.scheduledDate); const duration = Number(input.duration);
  if (!Number.isFinite(+start) || +start <= Date.now() || !Number.isInteger(duration) || duration < 15 || duration > 480) throw failure('Choose a future time and a duration from 15 to 480 minutes.', 'MEETING_DATE_INVALID', 400);
  const link = meetingUrl(input.meetingLink);
  const participants = Array.isArray(input.participants) ? input.participants : [];
  if (participants.length < 1 || participants.length > 2 || participants.some(p => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(p.email || '')))) throw failure('Choose the appraisal participants.', 'MEETING_PARTICIPANTS_INVALID', 400);
  const automatic = input.recordingPolicyVersion === 'calendar-notetaker-v2' && input.record === true;
  const deferred = input.recordingPolicyVersion === 'calendar-recording-v1' || automatic;
  const subjects = Array.isArray(input.participantSubjects) ? input.participantSubjects.map(String) : [];
  if (deferred && ((!automatic && input.record) || subjects.length !== 2 || new Set(subjects).size !== 2 || subjects.some(s => !s || s.length > 240))) throw failure('Two distinct recording participants are required.', 'RECORDING_PARTICIPANTS_INVALID', 400);
  if (automatic && !subjects.includes(identity.sub)) throw failure('The calendar owner must be a meeting participant.', 'RECORDING_PARTICIPANTS_INVALID', 400);
  const accountCredentials = await credentials(user.nylasAccountId);
  const client = nylas.getNylasInstance(accountCredentials);
  const grant = await client.grants.find({ grantId: user.nylasGrantId });
  const provider = grant.data?.provider;
  const calendars = await nylas.getCalendars(user.nylasGrantId, accountCredentials);
  const calendar = calendars.find(c => c.isPrimary && !c.readOnly) || calendars.find(c => !c.readOnly);
  if (!calendar) throw failure('Your calendar has no writable calendar.', 'WRITABLE_CALENDAR_REQUIRED');
  let record;
  try { record = await PerformanceMeeting.create({ ...query, grantId: user.nylasGrantId, accountId: user.nylasAccountId, calendarId: calendar.id, scheduledDate: start, duration, ...(deferred ? { recordingPolicyVersion: input.recordingPolicyVersion, participantSubjects: subjects } : {}) }); }
  catch (error) { if (error.code === 11000) throw failure('This meeting is already being scheduled.', 'MEETING_IN_PROGRESS'); throw error; }
  try {
    const event = await client.events.create({ identifier: record.grantId, queryParams: { calendarId: calendar.id, notifyParticipants: true }, requestBody: {
      title: String(input.title || 'Performance one-on-one').slice(0, 300),
      description: `Performance review one-on-one. ${automatic ? 'A visible Seemplify notetaker will join to record and transcribe this call for its meeting record.' : deferred ? 'Recording is requested but remains off until both participants agree in Seemplify before the call starts. A visible Seemplify notetaker will then request to join.' : input.record ? 'A visible Seemplify notetaker will request to join to record and transcribe this call. Please inform all participants and obtain their consent before admitting it.' : 'Recording is off.'}${link ? `\nJoin: ${link}` : ''}`,
      when: { startTime: Math.floor(+start / 1000), endTime: Math.floor(+start / 1000) + duration * 60 },
      participants: participants.map(p => ({ email: p.email, name: String(p.name || p.email).slice(0, 160) })),
      metadata: { seemplify_performance_meeting: record.externalId },
      ...(link ? { location: link } : { conferencing: { provider: provider === 'microsoft' ? 'Microsoft Teams' : 'Google Meet', autocreate: {} } })
    } });
    record.eventId = event.data.id;
    record.conferenceUrl = meetingUrl(link || event.data.conferencing?.details?.url || event.data.conferencing?.details?.meetingUrl);
    record.state = 'scheduled'; record.recordingState = automatic ? 'awaiting_start' : deferred ? 'awaiting_consent' : input.record ? 'scheduling' : 'not_requested';
    await record.save();
  } catch { record.state = 'uncertain'; await record.save(); throw failure('The calendar provider did not confirm creation. Check your calendar before trying again.', 'CALENDAR_CREATION_UNCERTAIN', 502); }
  if (automatic) {
    try { return await startRecording(rawIdentity, { externalId: record.externalId, recordingAuthorization: { policyVersion: 'calendar-notetaker-v2', requestedBy: identity.sub, requestedAt: new Date() } }); }
    catch { return publicMeeting(await PerformanceMeeting.findById(record._id)); }
  }
  if (input.record && record.conferenceUrl) {
    try {
      const bot = await nylas.createStandaloneNotetaker(record.conferenceUrl, { name: 'Seemplify meeting notes', audioRecording: true, videoRecording: true, transcription: true, summary: false }, start, accountCredentials);
      record.notetakerId = bot.notetakerId; record.recordingState = 'scheduled';
    } catch { record.recordingState = 'failed'; }
  } else if (input.record) record.recordingState = 'meeting_link_required';
  await record.save();
  return publicMeeting(record);
}

// The service-authenticated Performance application supplies acknowledgements
// for legacy calls. Current calls use an explicit system-policy authorization.
async function startRecording(rawIdentity, input) {
  const { identity } = await principal(rawIdentity);
  const query = key(identity, input);
  const record = await PerformanceMeeting.findOne(query);
  if (!record) throw failure('Meeting not found.', 'MEETING_NOT_FOUND', 404);
  const authorization = input.recordingAuthorization;
  const automatic = authorization?.policyVersion === 'calendar-notetaker-v2';
  if (!automatic && record.recordingPolicyVersion !== 'calendar-recording-v1') throw failure('Older meetings cannot acquire retrospective recording consent. Schedule a new call.', 'LEGACY_RECORDING_UNVERIFIED');
  const active = +record.scheduledDate <= Date.now();
  if (record.state !== 'scheduled' || +record.scheduledDate + record.duration * 60000 <= Date.now()) throw failure('The scheduled recording window has ended. Schedule a new call.', 'RECORDING_WINDOW_CLOSED');
  if (input.joinNow && !active) throw failure('The notetaker can join now once the scheduled call starts.', 'RECORDING_WINDOW_CLOSED');
  const consent = input.recordingConsent;
  const accepted = [consent?.manager, consent?.employee];
  if (!automatic && (consent?.noticeVersion !== record.recordingPolicyVersion || accepted.some(p => !p?.userId || p.recording !== true || p.transcription !== true || !p.acceptedAt || p.revokedAt || !Number.isFinite(+new Date(p.acceptedAt)) || +new Date(p.acceptedAt) > Date.now()) || new Set(accepted.map(p => p.userId)).size !== 2 || accepted.some((p, index) => record.participantSubjects[index] !== p.userId))) throw failure('Both participants must consent to recording and transcription.', 'RECORDING_CONSENT_REQUIRED');
  if (automatic && (!['calendar-recording-v1', 'calendar-notetaker-v2'].includes(record.recordingPolicyVersion) || record.participantSubjects.length !== 2 || !record.participantSubjects.includes(authorization.requestedBy) || !Number.isFinite(+new Date(authorization.requestedAt)) || +new Date(authorization.requestedAt) > Date.now())) throw failure('A valid meeting recording request is required.', 'RECORDING_AUTHORIZATION_INVALID', 400);
  if (record.recordingState === 'revoked') throw failure('Recording permission was withdrawn.', 'RECORDING_CONSENT_REVOKED');
  if (record.notetakerId) {
    if (!input.joinNow || record.recordingState !== 'scheduled') return publicMeeting(record);
    const accountCredentials = await credentials(record.accountId);
    const status = await nylas.getStandaloneNotetakerStatus(record.notetakerId, accountCredentials);
    const state = String(status.data?.state || status.state || status.status || '');
    if (!['scheduled', 'pending'].includes(state)) throw failure('The existing notetaker has already started or finished. Refresh recording and transcript to check its status.', 'RECORDING_ALREADY_DISPATCHED');
    const dispatch = await PerformanceMeeting.findOneAndUpdate({ ...query, recordingState: 'scheduled', notetakerId: record.notetakerId }, { $set: { recordingState: 'dispatching' } }, { new: true });
    if (!dispatch) throw failure('The notetaker is already being updated. Refresh its status.', 'RECORDING_IN_PROGRESS');
    try {
      await nylas.dispatchStandaloneNotetakerNow(record.notetakerId, accountCredentials, { name: 'Seemplify meeting notes' });
      const saved = await PerformanceMeeting.findOneAndUpdate({ ...query, recordingState: 'dispatching' }, { $set: { recordingState: 'joining' } }, { new: true });
      if (!saved) { await stopRecording(rawIdentity, input); throw failure('Recording permission was withdrawn.', 'RECORDING_CONSENT_REVOKED'); }
      return publicMeeting(saved);
    } catch (error) {
      await PerformanceMeeting.updateOne({ ...query, recordingState: 'dispatching' }, { $set: { recordingState: 'uncertain' } });
      throw failure('The existing notetaker could not be confirmed. Refresh recording status before trying again.', 'RECORDING_DISPATCH_UNCERTAIN', 502);
    }
  }
  const lease = await PerformanceMeeting.findOneAndUpdate({ ...query, state: 'scheduled', recordingState: { $in: ['awaiting_consent', 'awaiting_start'] }, notetakerId: { $exists: false } }, { $set: { recordingState: 'scheduling', ...(automatic ? { recordingPolicyVersion: 'calendar-notetaker-v2', recordingAuthorization: authorization } : {}) } }, { new: true });
  if (!lease) throw failure('Recording creation is awaiting confirmation. It will not be repeated automatically.', 'RECORDING_CREATION_UNCERTAIN');
  try {
    const bot = await nylas.createStandaloneNotetaker(record.conferenceUrl, { name: 'Seemplify meeting notes', audioRecording: true, videoRecording: true, transcription: true, summary: false }, active ? null : record.scheduledDate, await credentials(record.accountId));
    if (!bot.notetakerId) throw new Error('Recording provider did not confirm a reference');
    const saved = await PerformanceMeeting.findOneAndUpdate({ ...query, recordingState: 'scheduling' }, { $set: { notetakerId: bot.notetakerId, recordingState: 'scheduled' } }, { new: true });
    // A withdrawal can arrive while the external provider is responding.
    if (!saved) {
      await PerformanceMeeting.updateOne(query, { $set: { notetakerId: bot.notetakerId } });
      await stopRecording(rawIdentity, input);
      throw failure('Recording consent was withdrawn.', 'RECORDING_CONSENT_REVOKED');
    }
    return publicMeeting(saved);
  } catch (error) {
    await PerformanceMeeting.updateOne({ ...query, recordingState: 'scheduling' }, { $set: { recordingState: 'uncertain' } });
    throw error.code ? error : failure('The recording provider did not confirm creation. Do not schedule another bot; ask an administrator to reconcile this meeting.', 'RECORDING_CREATION_UNCERTAIN', 502);
  }
}
async function stopRecording(rawIdentity, input) {
  const { identity } = await principal(rawIdentity);
  const query = key(identity, input);
  const record = await PerformanceMeeting.findOneAndUpdate(query, { $set: { recordingState: 'revoked' } }, { new: false });
  if (!record) throw failure('Meeting not found.', 'MEETING_NOT_FOUND', 404);
  if (!record.notetakerId && (record.recordingCancellationUncertain || ['scheduling', 'uncertain'].includes(record.recordingState))) {
    await PerformanceMeeting.updateOne(query, { $set: { recordingCancellationUncertain: true } });
    throw failure('Consent is withdrawn but the recording reference is uncertain. Do not admit the notetaker; an administrator must reconcile it.', 'RECORDING_CANCELLATION_PENDING', 502);
  }
  if (record.notetakerId) {
    try { await nylas.cancelStandaloneNotetaker(record.notetakerId, await credentials(record.accountId)); }
    catch (error) {
      if (error.statusCode !== 404 && error.status !== 404) {
        try { await nylas.leaveStandaloneNotetaker(record.notetakerId, await credentials(record.accountId)); }
        catch { throw failure('Consent is withdrawn. Provider cancellation is awaiting confirmation; do not admit the notetaker.', 'RECORDING_CANCELLATION_PENDING', 502); }
      }
    }
    await PerformanceMeeting.updateOne(query, { $set: { recordingCancellationUncertain: false } });
  }
  record.recordingState = 'revoked';
  return publicMeeting(record);
}

async function boundedTranscript(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !['nylas.com', 'amazonaws.com', 'storage.googleapis.com'].some(host => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))) throw failure('The transcript storage provider is unsupported.', 'TRANSCRIPT_STORAGE_UNSUPPORTED', 502);
  const response = await fetch(parsed, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw failure('The transcript is not available yet.', 'TRANSCRIPT_UNAVAILABLE', 502);
  const chunks = []; let bytes = 0;
  for await (const chunk of response.body) { bytes += chunk.length; if (bytes > 2_000_000) { throw failure('The transcript exceeds the supported size.', 'TRANSCRIPT_TOO_LARGE', 413); } chunks.push(Buffer.from(chunk)); }
  return Buffer.concat(chunks).toString('utf8');
}
async function sync(rawIdentity, input) {
  const { identity } = await principal(rawIdentity);
  const record = await PerformanceMeeting.findOne(key(identity, input));
  if (!record) throw failure('Meeting not found.', 'MEETING_NOT_FOUND', 404);
  if (record.recordingState === 'revoked') return publicMeeting(record);
  if (!record.notetakerId) return publicMeeting(record);
  const accountCredentials = await credentials(record.accountId);
  const status = await nylas.getStandaloneNotetakerStatus(record.notetakerId, accountCredentials);
  const state = require('./performanceNotetakerState').normalize(status.data || status).state;
  const stillOpen = () => PerformanceMeeting.exists({ _id: record._id, state: { $ne: 'cancelled' }, recordingState: { $ne: 'revoked' } });
  if (!await stillOpen()) return publicMeeting(await PerformanceMeeting.findById(record._id));
  let media;
  try { media = await nylas.getStandaloneNotetakerMedia(record.notetakerId, accountCredentials); } catch { /* Media is unavailable while a call is in progress. */ }
  if (!await stillOpen()) return publicMeeting(await PerformanceMeeting.findById(record._id));
  const transcript = media?.transcript?.url ? await boundedTranscript(media.transcript.url) : undefined;
  const saved = await PerformanceMeeting.findOneAndUpdate({ _id: record._id, ...key(identity, input), state: { $ne: 'cancelled' }, recordingState: { $ne: 'revoked' } }, { $set: { recordingState: transcript ? 'ready' : state } }, { new: true });
  if (!saved) return publicMeeting(await PerformanceMeeting.findById(record._id));
  return { ...publicMeeting(saved), ...(transcript ? { transcript } : {}), recordingUrl: media?.recording?.url || media?.video?.url || media?.audio?.url || null };
}

async function cancel(rawIdentity, input) {
  const { identity } = await principal(rawIdentity);
  const record = await PerformanceMeeting.findOne(key(identity, input));
  if (!record) throw failure('Meeting not found.', 'MEETING_NOT_FOUND', 404);
  if (record.state === 'cancelled') return publicMeeting(record);
  const accountCredentials = await credentials(record.accountId);
  if (record.notetakerId) {
    try { await nylas.cancelStandaloneNotetaker(record.notetakerId, accountCredentials); }
    catch (error) { if (error.statusCode !== 404 && error.status !== 404) throw failure('The recording provider has not confirmed cancellation. Please retry.', 'RECORDING_CANCELLATION_PENDING', 502); }
  }
  if (record.eventId) {
    try { await nylas.getNylasInstance(accountCredentials).events.destroy({ identifier: record.grantId, eventId: record.eventId, queryParams: { calendarId: record.calendarId, notifyParticipants: true } }); }
    catch (error) { if (error.statusCode !== 404 && error.status !== 404) throw failure('The calendar provider has not confirmed cancellation. Please retry.', 'CALENDAR_CANCELLATION_PENDING', 502); }
  }
  record.state = 'cancelled'; record.recordingState = 'cancelled'; await record.save();
  return publicMeeting(record);
}

module.exports = { connection, connectCalendar: (...args) => require('./performanceCalendarConnectionService').connect(...args), disconnectCalendar: (...args) => require('./performanceCalendarConnectionService').disconnect(...args), retryNotetaker: (...args) => require('./performanceNotetakerStatusService').retry(...args), notetakerStatus: (...args) => require('./performanceNotetakerStatusService').status(...args), create, sync, cancel, startRecording, stopRecording, meetingUrl, boundedTranscript };
