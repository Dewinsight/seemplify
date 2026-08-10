const ACTIVE_JOIN_STATUSES = new Set(['joining', 'joined', 'recording', 'processing', 'completed']);
const REUSABLE_JOIN_STATUSES = new Set(['pending', 'scheduled', 'enabled']);
const REPLACEABLE_JOIN_STATUSES = new Set(['failed', 'cancelled', 'deleted', 'stopped']);

function mapNylasNotetakerStatus(meetingState = 'unknown', state = 'unknown') {
  if (state === 'scheduled' || state === 'created') return 'scheduled';
  if (state === 'connected' || meetingState === 'in_call') return 'recording';
  if (meetingState === 'failed_entry' || state === 'failed_entry') return 'failed';
  if (meetingState === 'api_request' && state === 'disconnected') return 'stopped';
  if (meetingState === 'ended' || state === 'disconnected') return 'processing';
  if (state === 'enabled') return 'enabled';
  if (state === 'completed') return 'completed';
  if (state === 'cancelled') return 'cancelled';
  if (state === 'joined') return 'joined';
  if (
    state === 'connecting' ||
    state === 'joining' ||
    meetingState === 'dispatched' ||
    meetingState === 'connecting' ||
    meetingState === 'waiting_for_entry' ||
    meetingState === 'joining'
  ) {
    return 'joining';
  }
  if (state === 'recording' || meetingState === 'recording') return 'recording';
  if (
    state === 'processing' ||
    state === 'media_available' ||
    meetingState === 'processing'
  ) {
    return 'processing';
  }

  return 'pending';
}

function getNotetakerJoinAction(notetakerId, status) {
  if (!notetakerId) {
    return 'create';
  }

  if (ACTIVE_JOIN_STATUSES.has(status)) {
    return 'already-active';
  }

  if (REUSABLE_JOIN_STATUSES.has(status)) {
    return 'dispatch-existing';
  }

  if (REPLACEABLE_JOIN_STATUSES.has(status)) {
    return 'replace-failed';
  }

  return 'blocked';
}

module.exports = {
  ACTIVE_JOIN_STATUSES,
  REUSABLE_JOIN_STATUSES,
  REPLACEABLE_JOIN_STATUSES,
  mapNylasNotetakerStatus,
  getNotetakerJoinAction
};
