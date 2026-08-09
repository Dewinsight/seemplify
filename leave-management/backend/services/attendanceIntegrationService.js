const crypto = require('crypto');
const { IntegrationDelivery } = require('../models');

const PERFORMANCE_EVENTS = new Set(['leave.approved', 'leave.updated', 'leave.cancelled']);
const DEFAULT_TIME_ATTENDANCE_URL = 'http://localhost:5010/api/webhooks/leave';
const DEFAULT_PERFORMANCE_URL = 'http://localhost:5004/api/webhooks/suite';

function validWebhookUrl(value, fallback) {
  const candidate = String(value || fallback).trim();
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch (error) {
    throw new Error('Integration webhook URL is invalid.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('Integration webhook URL must be an HTTP(S) URL without embedded credentials.');
  }
  return parsed.toString();
}

function isoDate(value, label) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} must be a valid date.`);
  return date.toISOString();
}

function requiredString(value, label) {
  const normalized = String(value == null ? '' : value).trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function buildLeaveData(request) {
  return {
    leaveId: request._id.toString(),
    organizationId: request.organizationId,
    userId: request.userId,
    leaveType: request.leaveType,
    startAt: request.startDate,
    endAt: request.endDate,
    allDay: true,
    timezone: request.timezone,
    status: request.status,
    updatedAt: request.updatedAt,
  };
}

/** Performance receives scheduling context only, never leave reasons or names. */
function buildPerformanceLeaveData(data) {
  return {
    leaveId: requiredString(data.leaveId, 'Leave ID'),
    organizationId: requiredString(data.organizationId, 'Organization ID'),
    userId: requiredString(data.userId, 'User ID'),
    startAt: isoDate(data.startAt, 'Leave start'),
    endAt: isoDate(data.endAt, 'Leave end'),
    status: requiredString(data.status, 'Leave status'),
    updatedAt: isoDate(data.updatedAt, 'Leave update time'),
  };
}

function attendanceEnvelope(event, data, eventId) {
  return {
    schemaVersion: '1.0', eventId, event, organizationId: data.organizationId,
    subjectId: data.userId, occurredAt: new Date().toISOString(), correlationId: eventId, idempotencyKey: eventId, data,
  };
}

function performanceEnvelope(event, data, eventKey) {
  if (!PERFORMANCE_EVENTS.has(event)) throw new Error('Unsupported Performance leave event.');
  const safeData = buildPerformanceLeaveData(data);
  const eventId = `performance:${eventKey}`;
  return {
    schemaVersion: '1.0',
    eventId,
    event,
    organizationId: safeData.organizationId,
    subjectId: safeData.userId,
    occurredAt: safeData.updatedAt,
    correlationId: eventKey,
    idempotencyKey: eventId,
    data: safeData,
  };
}

function performanceSecret(environment = process.env) {
  return String(
    environment.PERFORMANCE_MANAGEMENT_WEBHOOK_SECRET
      || environment.INTERNAL_SERVICE_SECRET
      || environment.IDP_PERFORMANCE_SERVICE_SECRET
      || ''
  ).trim();
}

function performanceRequestHeaders(serializedBody, now = new Date(), environment = process.env) {
  const headers = {
    'content-type': 'application/json',
    'x-service-id': 'leave-management',
  };
  const secret = performanceSecret(environment);
  if (!secret) {
    if (String(environment.NODE_ENV || '').toLowerCase() === 'production') {
      throw new Error('PERFORMANCE_MANAGEMENT_WEBHOOK_SECRET is not configured.');
    }
    // Mirrors Performance's explicit local-development fallback. Production
    // always fails closed above when no shared secret is configured.
    headers['x-internal-request'] = 'true';
    return headers;
  }
  const timestamp = now.toISOString();
  headers['x-service-timestamp'] = timestamp;
  headers['x-service-signature'] = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${serializedBody}`)
    .digest('hex');
  return headers;
}

async function persistAttendanceEvent(event, data, eventId) {
  const payload = attendanceEnvelope(event, data, eventId);
  const secret = process.env.LEAVE_WEBHOOK_SECRET || 'your-leave-webhook-secret-key';
  const signature = crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
  return IntegrationDelivery.findOneAndUpdate(
    { eventId },
    {
      $setOnInsert: {
        eventId,
        event,
        target: 'time_attendance',
        endpoint: validWebhookUrl(process.env.TIME_ATTENDANCE_LEAVE_WEBHOOK_URL, DEFAULT_TIME_ATTENDANCE_URL),
        payload,
        signature,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function persistPerformanceEvent(event, data, eventKey) {
  const payload = performanceEnvelope(event, data, eventKey);
  return IntegrationDelivery.findOneAndUpdate(
    { eventId: payload.eventId },
    {
      $setOnInsert: {
        eventId: payload.eventId,
        event,
        target: 'performance',
        endpoint: validWebhookUrl(
          process.env.PERFORMANCE_MANAGEMENT_WEBHOOK_URL,
          DEFAULT_PERFORMANCE_URL
        ),
        payload,
        signature: '',
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

function kickDeliveryWorker() {
  deliverPendingAttendanceEvents().catch(error => console.error('Leave event delivery error:', error));
}

async function queueAttendanceEvent(event, data, eventKey) {
  const eventId = eventKey || `${event}:${data.organizationId}:${data.leaveId || data.holidayId}:${new Date(data.updatedAt || Date.now()).toISOString()}`;
  const delivery = await persistAttendanceEvent(event, data, eventId);
  kickDeliveryWorker();
  return delivery;
}

async function queueLeaveEvent(request, event) {
  const data = buildLeaveData(request);
  const eventKey = `${event}:${request._id}:${request.updatedAt.toISOString()}`;
  const [attendance] = await Promise.all([
    persistAttendanceEvent(event, data, eventKey),
    persistPerformanceEvent(event, data, eventKey),
  ]);
  kickDeliveryWorker();
  // Keep the legacy return contract (the Time Attendance delivery document).
  // The second durable record is independently observable in the delivery
  // ledger and does not make existing callers understand a new return shape.
  return attendance;
}

let delivering = false;
async function deliverPendingAttendanceEvents(limit = 25) {
  if (delivering) return { skipped: true };
  delivering = true;
  let processed = 0;
  try {
    for (; processed < limit; processed += 1) {
      const now = new Date();
      const delivery = await IntegrationDelivery.findOneAndUpdate(
        {
          status: { $in: ['pending', 'failed', 'delivering'] },
          nextAttemptAt: { $lte: now },
          $or: [
            { leaseUntil: null },
            { leaseUntil: { $exists: false } },
            { leaseUntil: { $lte: now } },
          ],
        },
        { $set: { status: 'delivering', leaseUntil: new Date(now.getTime() + 60000) }, $inc: { attempts: 1 } },
        { sort: { nextAttemptAt: 1 }, new: true }
      );
      if (!delivery) break;
      try {
        const serializedBody = JSON.stringify(delivery.payload);
        const isPerformance = delivery.target === 'performance';
        const headers = isPerformance
          ? performanceRequestHeaders(serializedBody)
          : {
            'content-type': 'application/json',
            'x-leave-signature': delivery.signature,
            'x-leave-event': delivery.event,
          };
        const response = await fetch(delivery.endpoint, {
          method: 'POST',
          headers,
          body: serializedBody,
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        delivery.status = 'delivered';
        delivery.responseStatus = response.status;
        delivery.deliveredAt = new Date();
        delivery.lastError = '';
      } catch (error) {
        delivery.status = delivery.attempts >= delivery.maxAttempts ? 'dead' : 'failed';
        delivery.lastError = String(error.message || error).slice(0, 4000);
        delivery.nextAttemptAt = new Date(Date.now() + Math.min(60 * 60 * 1000, 15000 * (2 ** Math.max(0, delivery.attempts - 1))));
      }
      delivery.leaseUntil = undefined;
      await delivery.save();
    }
    return { processed };
  } finally {
    delivering = false;
  }
}

let worker;
function startAttendanceIntegrationWorker() {
  if (worker) return;
  worker = setInterval(() => deliverPendingAttendanceEvents().catch(error => console.error('Leave integration worker error:', error)), 15000);
  worker.unref?.();
  deliverPendingAttendanceEvents().catch(error => console.error('Leave integration startup error:', error));
}

module.exports = {
  DEFAULT_PERFORMANCE_URL,
  DEFAULT_TIME_ATTENDANCE_URL,
  buildLeaveData,
  buildPerformanceLeaveData,
  deliverPendingAttendanceEvents,
  performanceEnvelope,
  performanceRequestHeaders,
  queueAttendanceEvent,
  queueLeaveEvent,
  startAttendanceIntegrationWorker,
};
