'use strict';
const mongoose = require('mongoose');
const fs = require('node:fs/promises');
const { createWriteStream } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const OneOnOne = require('../models/OneOnOne');
const shared = require('./sharedAIAccountService');
async function process(meeting) {
  if (!meeting.appraisalMeeting?.recordingFileId) return meeting;
  if (meeting.transcript?.status === 'ready') {
    if (meeting.transcript.content && meeting.appraisalMeeting.summaryState !== 'ready') return require('./appraisalMeetingMediaService').summarize(meeting, meeting.appraisalMeeting.ownerIdentity);
    return meeting;
  }
  const claimed = await OneOnOne.findOneAndUpdate({ _id: meeting._id, $or: [{ 'appraisalMeeting.transcriptionLeaseUntil': { $exists: false } }, { 'appraisalMeeting.transcriptionLeaseUntil': { $lt: new Date() } }] }, { $set: { 'appraisalMeeting.transcriptionState': 'processing', 'appraisalMeeting.transcriptionLeaseUntil': new Date(Date.now() + 7200000) }, $inc: { 'appraisalMeeting.transcriptionAttempts': 1 } }, { new: true });
  if (!claimed) return meeting;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'appraisal-media-'));
  try {
    const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'appraisalRecordings' });
    const input = path.join(dir, 'recording');
    await pipeline(bucket.openDownloadStream(new mongoose.Types.ObjectId(claimed.appraisalMeeting.recordingFileId)), createWriteStream(input, { mode: 0o600 }));
    await promisify(execFile)('ffmpeg', ['-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-f', claimed.appraisalMeeting.recordingMime?.includes('mp4') ? 'mov' : 'matroska', '-i', input, '-t', '1801', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-f', 'segment', '-segment_time', '30', path.join(dir, 'part-%03d.wav')], { timeout: 120000, maxBuffer: 65536 });
    const files = (await fs.readdir(dir)).filter(name => /^part-\d+.wav$/.test(name)).sort();
    if (!files.length || files.length > 60) throw new Error('No supported audio track was found.');
    const parts = [...(claimed.appraisalMeeting.transcriptionParts || [])];
    for (let index = parts.length; index < files.length; index++) {
      const audio = await fs.readFile(path.join(dir, files[index]));
      const result = await shared.request('meetings/transcribe', claimed.appraisalMeeting.ownerIdentity, { audio: audio.toString('base64') }, { timeoutMs: 180000 });
      parts.push(String(result.transcript || '').slice(0, 10000));
      await OneOnOne.updateOne({ _id: meeting._id }, { $set: { 'appraisalMeeting.transcriptionParts': parts, 'appraisalMeeting.transcriptionProvider': result.provider, 'appraisalMeeting.transcriptionModel': result.model } });
    }
    const content = parts.filter(Boolean).join('\n');
    await OneOnOne.updateOne({ _id: meeting._id }, { $set: { transcript: { content, source: 'auto', status: 'ready', processedAt: new Date() }, 'appraisalMeeting.transcriptionState': content ? 'ready' : 'no_speech' }, $unset: { 'appraisalMeeting.transcriptionLeaseUntil': 1 } });
  } catch (error) {
    await OneOnOne.updateOne({ _id: meeting._id }, { $set: { 'appraisalMeeting.transcriptionState': 'failed' }, $unset: { 'appraisalMeeting.transcriptionLeaseUntil': 1 } });
    // Provider diagnostics can contain signed media URLs; keep them out of logs.
    throw Object.assign(new Error('Transcription could not finish. The recording is saved; retry processing.'), { statusCode: 503, code: 'CALL_TRANSCRIPTION_FAILED' });
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
  const updated = await OneOnOne.findById(meeting._id);
  if (updated.transcript?.content) {
    try { return await require('./appraisalMeetingMediaService').summarize(updated, updated.appraisalMeeting.ownerIdentity); } catch { /* Personal connection or consent can be restored and retried in the UI. */ }
  }
  return updated;
}
async function processDue() {
  const meetings = await OneOnOne.find({ 'appraisalMeeting.mode': 'in_app', 'appraisalMeeting.recordingFileId': { $exists: true }, 'appraisalMeeting.transcriptionState': { $in: ['pending', 'failed', 'processing'] }, $or: [{ 'appraisalMeeting.transcriptionAttempts': { $exists: false } }, { 'appraisalMeeting.transcriptionAttempts': { $lt: 3 } }] }).limit(3);
  for (const meeting of meetings) { try { if (await require('../models/Appraisal').exists({ _id: meeting.appraisalId, organizationId: meeting.organizationId, status: { $ne: 'cancelled' } })) await process(meeting); } catch { /* Bounded retries; manual refresh remains available. */ } }
  const notes = await OneOnOne.find({ 'appraisalMeeting.mode': 'in_app', 'transcript.status': 'ready', 'transcript.content': { $gt: '' }, 'appraisalMeeting.summaryState': { $ne: 'ready' }, $or: [{ 'appraisalMeeting.summaryAttempts': { $exists: false } }, { 'appraisalMeeting.summaryAttempts': { $lt: 3 } }] }).limit(3);
  for (const meeting of notes) { try { if (await require('../models/Appraisal').exists({ _id: meeting.appraisalId, organizationId: meeting.organizationId, status: { $ne: 'cancelled' } })) await process(meeting); } catch { /* Personal AI consent failures remain visible on the meeting. */ } }
}
module.exports = { process, processDue };
