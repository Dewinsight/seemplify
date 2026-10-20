'use strict';
const states = new Set(['scheduled', 'pending', 'connecting', 'joining', 'attending', 'in_progress', 'disconnected', 'failed_entry', 'complete', 'completed', 'processing', 'available', 'media_error', 'media_deleted', 'cancelled', 'error', 'failed']);
const reasons = new Set(['waiting_for_entry', 'dispatched', 'worker_finished', 'entry_denied', 'admission_timeout', 'sign_in_required', 'meeting_capacity_reached', 'bad_meeting_code', 'bad_meeting_link', 'cannot_join', 'recording_active', 'meeting_ended', 'no_participants', 'no_activity', 'kicked', 'api_request', 'cancelled', 'network_error', 'no_response', 'error', 'internal_error', 'unknown']);
function normalize(payload = {}) {
  const raw = payload.state || payload.status;
  const value = ({ media_available: 'available', media_processing: 'processing', worker_finished: 'processing', waiting_for_entry: 'connecting' })[raw] || raw;
  const reason = payload.meeting_state || payload.meetingState || (raw === 'waiting_for_entry' ? raw : 'unknown');
  return { state: states.has(value) ? value : 'unknown', meetingState: reasons.has(reason) ? reason : 'unknown' };
}
function history(events) {
  const unique = new Map();
  for (const event of (Array.isArray(events) ? events : []).slice(0, 100)) {
    const timestamp = Number(event.created_at) * 1000;
    if (!Number.isFinite(timestamp) || timestamp < 946684800000 || timestamp > Date.now() + 60000) continue;
    const data = normalize(event.data);
    if (data.state === 'unknown' && data.meetingState === 'unknown') continue;
    // Never retain meeting links, signed media URLs, names, or raw payloads.
    unique.set(`${timestamp}:${data.state}:${data.meetingState}`, { ...data, observedAt: new Date(timestamp), source: 'provider' });
  }
  return [...unique.values()].sort((a, b) => a.observedAt - b.observedAt).slice(-30);
}
module.exports = { normalize, history };
