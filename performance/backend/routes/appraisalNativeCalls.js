'use strict';
const express = require('express');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const mongoose = require('mongoose');
const multer = require('multer');
const Call = require('../models/AppraisalCall');
const Appraisal = require('../models/Appraisal');
const OneOnOne = require('../models/OneOnOne');
const shared = require('../services/sharedAIAccountService');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024, files: 1, fields: 1 } }).single('recording');
const bucket = () => new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'appraisalRecordings' });
const live = peer => peer?.id && +peer.seenAt > Date.now() - 30000;
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
module.exports = function nativeCalls(publicMeeting) {
  const router = express.Router({ mergeParams: true });
  router.use((req, res, next) => {
    if (req.meeting.appraisalMeeting?.mode !== 'in_app') return res.status(409).json({ error: 'This is a calendar call.' });
    const sub = shared.identityFromRequest(req).sub;
    req.callRole = String(req.meeting.managerId) === sub ? 'manager' : String(req.meeting.employeeId) === sub ? 'employee' : null;
    // HR can read the appraisal, but cannot silently join a participant's call.
    if (!req.callRole && req.path !== '/recording') return res.status(403).json({ error: 'Only the assigned reviewer and employee can join this call.' });
    return next();
  });
  router.post('/join', wrap(async (req, res) => {
    if (['cancelled', 'completed', 'no_show'].includes(req.meeting.status) || ['cancelled', 'completed', 'employee_acknowledged'].includes(req.appraisal?.status)) return res.status(409).json({ error: 'This call is closed.' });
    if (req.meeting.appraisalMeeting.recordingRequested && req.body.consent !== true) return res.status(400).json({ error: 'Agree to recording and transcription before joining, or ask the reviewer to schedule an unrecorded call.' });
    const id = String(req.body.peerId || '');
    if (!/^[a-f0-9-]{36}$/i.test(id)) return res.status(400).json({ error: 'Invalid call session.' });
    await Call.init();
    await Call.updateOne({ meetingId: req.meeting._id }, { $setOnInsert: { expiresAt: new Date(Date.now() + 86400000) } }, { upsert: true });
    const role = req.callRole;
    const call = await Call.findOneAndUpdate({ meetingId: req.meeting._id, $or: [{ [`${role}.id`]: id }, { [`${role}.seenAt`]: { $lt: new Date(Date.now() - 30000) } }, { [role]: { $exists: false } }] }, { $set: { [role]: { id, seenAt: new Date(), consentAt: req.body.consent ? new Date() : null } } }, { new: true });
    if (!call) return res.status(409).json({ error: 'You are already in this call in another tab. Leave that tab, or wait 30 seconds after it closes.' });
    if (req.appraisal) {
      // The lease exists before this parent fence: cancellation either sees a
      // live participant or loses its optimistic save. If cancellation won,
      // release only this caller's lease before disclosing relay credentials.
      const open = await Appraisal.updateOne({ _id: req.appraisal._id, organizationId: req.appraisal.organizationId, status: { $nin: ['cancelled', 'completed', 'employee_acknowledged'] } }, { $inc: { __v: 1 } });
      if (!open.matchedCount) {
        await Call.updateOne({ _id: call._id, [`${role}.id`]: id }, { $unset: { [role]: 1 } });
        return res.status(409).json({ error: 'This appraisal call is closed.' });
      }
    }
    const response = await fetch('https://turn.seemplifyai.com/api/turn-credentials', { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('The call relay is unavailable. Please retry.');
    const turn = await response.json();
    if (!Array.isArray(turn.urls) || !turn.username || !turn.credential) throw new Error('The call relay is unavailable.');
    await OneOnOne.updateOne({ _id: req.meeting._id, status: { $in: ['scheduled', 'rescheduled'] } }, { $set: { status: 'in_progress', actualStartTime: new Date() } });
    return res.json({ role, peerId: id, recordingRequested: Boolean(req.meeting.appraisalMeeting.recordingRequested), iceServers: [{ urls: 'stun:turn.seemplifyai.com:3478' }, { urls: turn.urls, username: turn.username, credential: turn.credential }] });
  }));
  router.use(wrap(async (req, res) => {
    // Recording playback is authorized by the parent appraisal router, without a live-call lease.
    if (req.method === 'GET' && req.path === '/recording') {
      const id = req.meeting.appraisalMeeting.recordingFileId;
      if (!id) return res.status(404).json({ error: 'Recording is not ready.' });
      res.set({ 'Content-Type': req.meeting.appraisalMeeting.recordingMime || 'video/webm', 'Cache-Control': 'private, no-store', 'Content-Disposition': 'inline; filename="appraisal-call.webm"' });
      await pipeline(bucket().openDownloadStream(new mongoose.Types.ObjectId(id)), res); return;
    }
    const role = req.callRole; const other = role === 'manager' ? 'employee' : 'manager';
    const id = String(req.body?.peerId || req.query.peerId || '');
    const call = await Call.findOneAndUpdate({ meetingId: req.meeting._id, [`${role}.id`]: id, [`${role}.seenAt`]: { $gt: new Date(Date.now() - 30000) } }, { $set: { [`${role}.seenAt`]: new Date() } }, { new: true });
    if (!call) return res.status(409).json({ error: 'Your call session ended. Rejoin the call.' });
    if (req.method === 'GET' && req.path === '/state') return res.json({ peer: live(call[other]) ? call[other].id : null, offer: call.offer, answer: call.answer, recording: Boolean(call.recordingActive && live(call.manager) && call.recordingPeer === call.manager.id && +call.recordingUntil > Date.now()) });
    if (req.method === 'POST' && req.path === '/signal') {
      const type = role === 'manager' ? 'offer' : 'answer';
      const sdp = req.body.description;
      if (sdp?.type !== type || typeof sdp.sdp !== 'string' || sdp.sdp.length > 32000 || !live(call[other]) || req.body.target !== call[other].id) return res.status(400).json({ error: 'Invalid call negotiation.' });
      await Call.updateOne({ _id: call._id, [`${role}.id`]: id }, { $set: { [type]: { sender: id, target: call[other].id, description: { type, sdp: sdp.sdp } } } });
      return res.json({ success: true });
    }
    if (req.method === 'POST' && req.path === '/leave') {
      await Call.updateOne({ _id: call._id, [`${role}.id`]: id }, { $unset: { [role]: 1 } });
      if (!req.appraisal) {
        const remaining = await Call.findById(call._id);
        if (!live(remaining?.manager) && !live(remaining?.employee)) await OneOnOne.updateOne({ _id: req.meeting._id, status: 'in_progress' }, { $set: { status: 'scheduled' } });
      }
      return res.json({ success: true });
    }
    if (req.method === 'POST' && req.path === '/record') {
      if (role !== 'manager' || !req.meeting.appraisalMeeting.recordingRequested) return res.status(403).json({ error: 'Only the reviewer can start the agreed recording.' });
      if (!live(call[other]) || !call[other].consentAt || !call[role].consentAt) return res.status(409).json({ error: 'Both participants must join and agree to recording first.' });
      const claimed = await Call.findOneAndUpdate({ _id: call._id, $or: [{ recordingUntil: { $lt: new Date() } }, { recordingPeer: { $exists: false } }] }, { $set: { recordingPeer: id, recordingActive: true, recordingUntil: new Date(Date.now() + 35 * 60000) } }, { new: true });
      if (!claimed || req.meeting.appraisalMeeting.recordingFileId) return res.status(409).json({ error: 'This call already has a recording. Review it before scheduling another call step.' });
      await OneOnOne.updateOne({ _id: req.meeting._id }, { $set: { 'appraisalMeeting.recordingState': 'recording', 'appraisalMeeting.recordingConsent': { manager: { userId: req.meeting.managerId, acceptedAt: call.manager.consentAt }, employee: { userId: req.meeting.employeeId, acceptedAt: call.employee.consentAt }, startedAt: new Date(), noticeVersion: 'appraisal-recording-v1' } } });
      return res.json({ success: true });
    }
    if (req.method === 'POST' && req.path === '/stop') {
      if (call.recordingPeer !== id) return res.status(403).json({ error: 'Only the recording host can stop this recording.' });
      await Call.updateOne({ _id: call._id, recordingPeer: id }, { $set: { recordingActive: false } });
      await OneOnOne.updateOne({ _id: req.meeting._id, 'appraisalMeeting.recordingFileId': { $exists: false } }, { $set: { 'appraisalMeeting.recordingState': 'awaiting_upload' } });
      return res.json({ success: true });
    }
    if (req.method === 'POST' && req.path === '/upload') {
      if (role !== 'manager') return res.status(403).json({ error: 'Only the recording host can save this recording.' });
      if (req.meeting.appraisalMeeting.recordingFileId) return res.json({ success: true, data: publicMeeting(req.meeting) });
      if (call.recordingPeer !== id || +call.recordingUntil < Date.now()) return res.status(403).json({ error: 'Start an agreed recording before uploading.' });
      await new Promise((resolve, reject) => upload(req, res, error => error ? reject(error) : resolve()));
      const file = req.file;
      if (!file || !['video/webm', 'audio/webm', 'video/mp4', 'audio/mp4'].includes(file.mimetype) || file.size < 32) return res.status(400).json({ error: 'Upload a browser call recording in WebM or MP4 format (up to 50 MB).' });
      const stream = bucket().openUploadStream(`call-${req.meeting._id}-${crypto.randomUUID()}`, { metadata: { meetingId: req.meeting._id }, contentType: file.mimetype });
      await pipeline(Readable.from(file.buffer), stream);
      const saved = await OneOnOne.findOneAndUpdate({ _id: req.meeting._id, 'appraisalMeeting.recordingFileId': { $exists: false } }, { $set: { 'appraisalMeeting.recordingFileId': String(stream.id), 'appraisalMeeting.recordingMime': file.mimetype, 'appraisalMeeting.recordingState': 'ready', 'appraisalMeeting.transcriptionState': 'pending', actualEndTime: new Date() } }, { new: true });
      if (!saved) await bucket().delete(stream.id);
      await Call.updateOne({ _id: call._id }, { $unset: { recordingPeer: 1, recordingUntil: 1 } });
      return res.status(201).json({ success: true, data: publicMeeting(saved || await OneOnOne.findById(req.meeting._id)) });
    }
    return res.status(404).json({ error: 'Call action not found.' });
  }));
  router.use((error, req, res, next) => { if (res.headersSent) return next(error); return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : Number(error.statusCode) || 503).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Recording exceeds 50 MB. Download it and schedule a shorter call.' : error.message || 'Call request failed.' }); });
  return router;
};
