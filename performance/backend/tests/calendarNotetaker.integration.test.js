'use strict';
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const OneOnOne = require('../models/OneOnOne');
const service = require('../services/calendarNotetakerService');
const shared = require('../services/sharedAIAccountService');
let mongo;
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); });
beforeEach(async () => { await mongoose.connection.db.dropDatabase(); jest.spyOn(shared, 'request').mockResolvedValue({ recordingState: 'scheduled' }); });
afterEach(() => jest.restoreAllMocks());
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });
async function fixture(extra = {}) {
  return OneOnOne.create({ organizationId: 'org-a', managerId: 'manager', employeeId: 'employee', scheduledDate: new Date(Date.now() + 3600000), duration: 30, title: 'Synthetic notetaker',
    nylas: { eventId: 'event', conferenceUrl: 'https://meet.google.com/aaa-bbbb-ccc' }, appraisalMeeting: { source: 'one_on_one', mode: 'calendar', recordingRequested: true, recordingPolicyVersion: service.POLICY, recordingState: 'awaiting_start', ownerIdentity: { sub: 'manager', email: 'manager@example.test', organizationId: 'org-a' } }, ...extra });
}
test.each(['manager', 'employee'])('%s starts a notetaker without either participant acknowledgement', async actor => {
  const meeting = await fixture();
  expect(service.status(meeting, actor).canStart).toBe(true);
  const saved = await service.start(meeting, actor);
  expect(saved.appraisalMeeting.recordingConsent).toBeUndefined();
  expect(saved.appraisalMeeting.recordingAuthorization).toMatchObject({ policyVersion: service.POLICY, requestedBy: actor });
  expect(shared.request.mock.calls[0][2]).not.toHaveProperty('recordingConsent');
  expect(shared.request.mock.calls[0][1].sub).toBe('manager');
  await service.start(saved, actor);
  expect(shared.request).toHaveBeenCalledTimes(1);
});
test('new calendar invitations enable recording without the former notice or permission flow', async () => {
  const meeting = await fixture({ nylas: {} });
  shared.request.mockResolvedValue({ eventId: 'event', conferenceUrl: 'https://meet.google.com/aaa-bbbb-ccc', recordingState: 'scheduled', state: 'scheduled' });
  const saved = await require('../services/meetingCallService').createCalendar(meeting);
  expect(shared.request.mock.calls[0][2]).toMatchObject({ record: true, recordingPolicyVersion: service.POLICY, participantSubjects: ['manager', 'employee'] });
  expect(saved.appraisalMeeting.recordingAuthorization.policyVersion).toBe(service.POLICY);
  expect(saved.appraisalMeeting.recordingConsent).toBeUndefined();
});
test('pending old calls can be scheduled without manufacturing historical consent', async () => {
  const meeting = await fixture();
  await OneOnOne.updateOne({ _id: meeting._id }, { $set: { 'appraisalMeeting.recordingPolicyVersion': 'calendar-recording-v1', 'appraisalMeeting.recordingState': 'awaiting_consent' } });
  const saved = await service.start(meeting, 'employee');
  expect(saved.appraisalMeeting.recordingPolicyVersion).toBe(service.POLICY);
  expect(saved.appraisalMeeting.calendarConsent).toBeUndefined();
  expect(saved.appraisalMeeting.recordingConsent).toBeUndefined();
});
test('unrelated users, closed windows, recording-off calls and explicit stops cannot schedule a bot', async () => {
  const meeting = await fixture();
  await expect(service.start(meeting, 'outsider')).rejects.toMatchObject({ statusCode: 403 });
  await expect(service.start(meeting, 'manager', { joinNow: true })).rejects.toMatchObject({ code: 'RECORDING_NOT_AVAILABLE' });
  await OneOnOne.updateOne({ _id: meeting._id }, { $set: { 'appraisalMeeting.recordingRequested': false } });
  await expect(service.start(meeting, 'manager')).rejects.toMatchObject({ code: 'RECORDING_NOT_AVAILABLE' });
  await OneOnOne.updateOne({ _id: meeting._id }, { $set: { 'appraisalMeeting.recordingRequested': true, status: 'completed' } });
  await expect(service.start(meeting, 'manager')).rejects.toMatchObject({ code: 'RECORDING_WINDOW_CLOSED' });
  await OneOnOne.updateOne({ _id: meeting._id }, { $set: { status: 'scheduled', 'appraisalMeeting.recordingState': 'revoked' } });
  await expect(service.start(meeting, 'manager')).rejects.toMatchObject({ code: 'RECORDING_STOPPED' });
  expect(shared.request).not.toHaveBeenCalled();
});
test('a stop during provider creation prevents publishing a recording and cancels the late bot', async () => {
  const meeting = await fixture();
  shared.request.mockImplementation(async operation => {
    if (operation === 'meetings/startRecording') await service.stop(meeting, 'employee');
    return { recordingState: operation === 'meetings/stopRecording' ? 'revoked' : 'scheduled' };
  });
  await expect(service.start(meeting, 'manager')).rejects.toMatchObject({ code: 'RECORDING_STOPPED' });
  expect((await service.current(meeting)).appraisalMeeting.recordingState).toBe('revoked');
  expect(shared.request.mock.calls.filter(([operation]) => operation === 'meetings/stopRecording')).toHaveLength(2);
});
test('active calls dispatch now and stopped sources cannot be analysed', async () => {
  const meeting = await fixture({ scheduledDate: new Date(Date.now() - 60000) });
  const saved = await service.start(meeting, 'employee', { joinNow: true });
  expect(shared.request.mock.calls[0][2].joinNow).toBe(true);
  await require('../services/appraisalMeetingMediaService').assertSourceAuthority(saved);
  await service.stop(saved, 'manager');
  await expect(require('../services/appraisalMeetingMediaService').assertSourceAuthority(saved)).rejects.toMatchObject({ code: 'SOURCE_CONSENT_UNVERIFIED' });
});
