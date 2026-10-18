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
  return { connected: Boolean(user.nylasGrantId && !['revoked', 'expired', 'invalid', 'stopped'].includes(user.nylasGrantStatus)), email: user.email, authority: 'recruiter', connectUrl: `${process.env.FRONTEND_URL || 'https://app.seemplifyai.com'}/settings/calendar` };
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
  if (!user.nylasGrantId || ['revoked', 'expired', 'invalid', 'stopped'].includes(user.nylasGrantStatus)) throw failure('Connect your own calendar in Recruiter first. Your colleague’s calendar cannot be used.', 'CALENDAR_CONNECTION_REQUIRED');
  const start = new Date(input.scheduledDate); const duration = Number(input.duration);
  if (!Number.isFinite(+start) || +start <= Date.now() || !Number.isInteger(duration) || duration < 15 || duration > 480) throw failure('Choose a future time and a duration from 15 to 480 minutes.', 'MEETING_DATE_INVALID', 400);
  const link = meetingUrl(input.meetingLink);
  const participants = Array.isArray(input.participants) ? input.participants : [];
  if (participants.length < 1 || participants.length > 2 || participants.some(p => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(p.email || '')))) throw failure('Choose the appraisal participants.', 'MEETING_PARTICIPANTS_INVALID', 400);
  const accountCredentials = await credentials(user.nylasAccountId);
  const client = nylas.getNylasInstance(accountCredentials);
  const grant = await client.grants.find({ grantId: user.nylasGrantId });
  const provider = grant.data?.provider;
  const calendars = await nylas.getCalendars(user.nylasGrantId, accountCredentials);
  const calendar = calendars.find(c => c.isPrimary && !c.readOnly) || calendars.find(c => !c.readOnly);
  if (!calendar) throw failure('Your calendar has no writable calendar.', 'WRITABLE_CALENDAR_REQUIRED');
  let record;
  try { record = await PerformanceMeeting.create({ ...query, grantId: user.nylasGrantId, accountId: user.nylasAccountId, calendarId: calendar.id, scheduledDate: start, duration }); }
  catch (error) { if (error.code === 11000) throw failure('This meeting is already being scheduled.', 'MEETING_IN_PROGRESS'); throw error; }
  try {
    const event = await client.events.create({ identifier: record.grantId, queryParams: { calendarId: calendar.id, notifyParticipants: true }, requestBody: {
      title: String(input.title || 'Performance one-on-one').slice(0, 300),
      description: `Performance review one-on-one. ${input.record ? 'A visible Seemplify notetaker will request to join to record and transcribe this call. Please inform all participants and obtain their consent before admitting it.' : 'Recording is off.'}${link ? `\nJoin: ${link}` : ''}`,
      when: { startTime: Math.floor(+start / 1000), endTime: Math.floor(+start / 1000) + duration * 60 },
      participants: participants.map(p => ({ email: p.email, name: String(p.name || p.email).slice(0, 160) })),
      metadata: { seemplify_performance_meeting: record.externalId },
      ...(link ? { location: link } : { conferencing: { provider: provider === 'microsoft' ? 'Microsoft Teams' : 'Google Meet', autocreate: {} } })
    } });
    record.eventId = event.data.id;
    record.conferenceUrl = meetingUrl(link || event.data.conferencing?.details?.url || event.data.conferencing?.details?.meetingUrl);
    record.state = 'scheduled'; record.recordingState = input.record ? 'scheduling' : 'not_requested';
    await record.save();
  } catch { record.state = 'uncertain'; await record.save(); throw failure('The calendar provider did not confirm creation. Check your calendar before trying again.', 'CALENDAR_CREATION_UNCERTAIN', 502); }
  if (input.record && record.conferenceUrl) {
    try {
      const bot = await nylas.createStandaloneNotetaker(record.conferenceUrl, { name: 'Seemplify meeting notes', audioRecording: true, videoRecording: true, transcription: true, summary: false }, start, accountCredentials);
      record.notetakerId = bot.notetakerId; record.recordingState = 'scheduled';
    } catch { record.recordingState = 'failed'; }
  } else if (input.record) record.recordingState = 'meeting_link_required';
  await record.save();
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
  if (!record.notetakerId) return publicMeeting(record);
  const accountCredentials = await credentials(record.accountId);
  const status = await nylas.getStandaloneNotetakerStatus(record.notetakerId, accountCredentials);
  const state = String(status.data?.state || status.state || status.status || 'processing');
  let media;
  try { media = await nylas.getStandaloneNotetakerMedia(record.notetakerId, accountCredentials); } catch { /* Media is unavailable while a call is in progress. */ }
  const transcript = media?.transcript?.url ? await boundedTranscript(media.transcript.url) : undefined;
  record.recordingState = transcript ? 'ready' : state; await record.save();
  return { ...publicMeeting(record), ...(transcript ? { transcript } : {}), recordingUrl: media?.recording?.url || media?.video?.url || media?.audio?.url || null };
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

module.exports = { connection, create, sync, cancel, meetingUrl, boundedTranscript };
