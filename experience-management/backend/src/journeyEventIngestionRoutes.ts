import crypto from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import {
  JOURNEY_EVENT_PROTOCOL_VERSION,
  validateEventBatch,
  type EventIngestResult,
  type JourneyProtocolError
} from '@seemplify/journey-event-protocol';
import {
  authenticateJourneyEventCredential,
  ingestJourneyEvent,
  JourneyEventIngestionError,
  recordJourneyEventProtocolRejection,
  syntacticallySafeJourneyEventCorsOrigin
} from './journeyEventIngestionRepository.js';
import { SubscriptionEntitlementError } from './subscriptionEntitlements.js';
import type { JourneyIngestPrincipal } from './journeyEventIngestion.js';

export const journeyEventIngestionRouter = express.Router();

function protocolError(input: {
  code: string;
  message: string;
  retryable?: boolean;
  requestId?: string;
  eventId?: string | null;
  index?: number;
  details?: unknown;
}): JourneyProtocolError {
  return {
    protocolVersion: JOURNEY_EVENT_PROTOCOL_VERSION,
    error: {
      code: input.code,
      message: input.message.slice(0, 500),
      retryable: input.retryable || false,
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(input.eventId ? { eventId: input.eventId } : {}),
      ...(input.index === undefined ? {} : { index: input.index }),
      ...(input.details === undefined ? {} : { details: input.details as never })
    }
  };
}

function requestId(request: Request) {
  const supplied = String(request.get('X-Request-Id') || '');
  return supplied && supplied.length <= 128 && /^[A-Za-z0-9._:-]+$/u.test(supplied) ? supplied : crypto.randomUUID();
}

function bearer(request: Request) {
  const match = /^Bearer ([^\s]{1,512})$/u.exec(String(request.get('Authorization') || ''));
  if (!match) throw new JourneyEventIngestionError('A valid Bearer event credential is required.', 401, 'EVENT_CREDENTIAL_REQUIRED');
  return match[1] as string;
}

function binding(request: Request) {
  return {
    origin: request.get('Origin') || null,
    bundleId: request.get('X-Seemplify-Bundle-Id') || null
  };
}

function setCors(request: Request, response: Response, principal?: JourneyIngestPrincipal) {
  if (principal && principal.kind !== 'public_write') return;
  const origin = syntacticallySafeJourneyEventCorsOrigin(request.get('Origin') || null);
  if (origin) {
    response.setHeader('Access-Control-Allow-Origin', origin);
  }
}

function sendKnownError(response: Response, error: unknown, id: string, index?: number) {
  if (error instanceof JourneyEventIngestionError) {
    return response.status(error.status).json(protocolError({
      code: error.code, message: error.message, retryable: error.retryable,
      requestId: id, eventId: error.eventId, index,
      ...(error.fieldPath ? { details: { path: error.fieldPath } } : {})
    }));
  }
  if (error instanceof SubscriptionEntitlementError) {
    return response.status(error.status).json(protocolError({
      code: error.code, message: error.message, requestId: id, index
    }));
  }
  return response.status(503).json(protocolError({
    code: 'EVENT_INGESTION_UNAVAILABLE', message: 'Event ingestion is temporarily unavailable.', retryable: true, requestId: id, index
  }));
}

journeyEventIngestionRouter.use((_request, response, next) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Vary', 'Origin');
  next();
});

journeyEventIngestionRouter.options(['/events', '/batch'], (request, response) => {
  const origin = syntacticallySafeJourneyEventCorsOrigin(request.get('Origin') || null);
  if (!origin) return response.status(403).json(protocolError({
    code: 'EVENT_CLIENT_BINDING_FORBIDDEN', message: 'The preflight origin is not configured for an active source.'
  }));
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Request-Id, X-Seemplify-Bundle-Id');
  response.setHeader('Access-Control-Max-Age', '600');
  return response.status(204).end();
});

journeyEventIngestionRouter.use(express.json({ limit: '512kb', strict: true, type: 'application/json' }));

journeyEventIngestionRouter.post('/events', (request, response) => {
  const id = requestId(request);
  response.setHeader('X-Request-Id', id);
  try {
    const receivedAt = new Date();
    const principal = authenticateJourneyEventCredential(bearer(request), receivedAt);
    const outcome = ingestJourneyEvent({
      principal, envelope: request.body, binding: binding(request), requestId: id, now: receivedAt
    });
    setCors(request, response, principal);
    return response.status(outcome.httpStatus).json(outcome.result);
  } catch (error) {
    if (error instanceof JourneyEventIngestionError && error.corsOriginAuthorized) setCors(request, response);
    return sendKnownError(response, error, id);
  }
});

journeyEventIngestionRouter.post('/batch', (request, response) => {
  const id = requestId(request);
  response.setHeader('X-Request-Id', id);
  try {
    const receivedAt = new Date();
    const principal = authenticateJourneyEventCredential(bearer(request), receivedAt);
    const candidate = validateEventBatch(request.body);
    if (!candidate.ok) {
      const first = candidate.errors[0];
      const status = (candidate.errors.some((entry) => entry.code === 'MAX_BYTES') ? 413 : 422) as 413 | 422;
      const code = `PROTOCOL_${first?.code || 'INVALID'}`;
      const message = first?.message || 'The event batch is invalid.';
      const batchId = request.body && typeof request.body === 'object' && typeof request.body.batchId === 'string'
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(request.body.batchId)
        ? request.body.batchId : null;
      recordJourneyEventProtocolRejection({
        principal, payload: request.body, binding: binding(request), batchId, code, message,
        fieldPath: first?.path || '$', status, requestId: id, now: receivedAt
      });
      setCors(request, response, principal);
      return response.status(status).json(protocolError({
        code, message,
        requestId: id, details: { path: first?.path || '$' }
      }));
    }
    const results: EventIngestResult[] = [];
    const statuses: number[] = [];
    for (let index = 0; index < candidate.value.events.length; index += 1) {
      const event = candidate.value.events[index];
      try {
        const outcome = ingestJourneyEvent({
          principal, envelope: event, binding: binding(request), batchId: candidate.value.batchId,
          requestId: id, now: receivedAt
        });
        results.push({ ...outcome.result, index });
        statuses.push(outcome.httpStatus);
      } catch (error) {
        if (error instanceof JourneyEventIngestionError
          && ['EVENT_CREDENTIAL_INVALID', 'EVENT_CREDENTIAL_REQUIRED', 'EVENT_CLIENT_BINDING_REQUIRED',
            'EVENT_CLIENT_BINDING_FORBIDDEN'].includes(error.code)) {
          return sendKnownError(response, error, id, index);
        }
        if (error instanceof SubscriptionEntitlementError) return sendKnownError(response, error, id, index);
        const known = error instanceof JourneyEventIngestionError ? error : new JourneyEventIngestionError(
          'Event ingestion is temporarily unavailable.', 503, 'EVENT_INGESTION_UNAVAILABLE', true,
          event.eventId
        );
        results.push({
          eventId: event.eventId, index, status: 'rejected', duplicate: false,
          retryable: known.retryable, receivedAt: new Date().toISOString(), code: known.code,
          message: known.message.slice(0, 500)
        });
        statuses.push(known.status);
      }
    }
    const httpStatus = statuses.every((status) => status === 202) ? 202
      : statuses.every((status) => status === 200) ? 200 : 207;
    setCors(request, response, principal);
    return response.status(httpStatus).json({
      protocolVersion: JOURNEY_EVENT_PROTOCOL_VERSION,
      batchId: candidate.value.batchId,
      results
    });
  } catch (error) {
    return sendKnownError(response, error, id);
  }
});

journeyEventIngestionRouter.use((error: unknown, request: Request, response: Response, _next: NextFunction) => {
  const id = requestId(request);
  response.setHeader('X-Request-Id', id);
  const syntax = error instanceof SyntaxError;
  const tooLarge = Boolean(error && typeof error === 'object' && (error as { type?: string }).type === 'entity.too.large');
  return response.status(tooLarge ? 413 : 400).json(protocolError({
    code: tooLarge ? 'PROTOCOL_MAX_BYTES' : syntax ? 'PROTOCOL_INVALID_JSON' : 'PROTOCOL_BODY_INVALID',
    message: tooLarge ? 'The request body exceeds the ingestion byte limit.' : 'The request body must be valid JSON.',
    requestId: id
  }));
});
