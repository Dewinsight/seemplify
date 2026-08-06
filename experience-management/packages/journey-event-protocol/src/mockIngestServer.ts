import crypto from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import {
  journeyEventLimits, JOURNEY_EVENT_PROTOCOL_VERSION
} from './constants.js';
import type {
  BatchIngestResult, EventIngestResult, JourneyProtocolError, JsonValue, ProtocolValidationIssue
} from './types.js';
import { validateEventBatch, validateEventEnvelope } from './validate.js';

export const MOCK_INGEST_DEFAULT_WRITE_KEY = 'jpk_dev.replace_me.00000000000000000000000000000000' as const;
export const MOCK_INGEST_HEADER = 'x-seemplify-mock-ingest' as const;

export interface MockIngestServerOptions {
  /** Test-only bearer key. It is never a real tracking key. */
  writeKey?: string;
  /** Fixed time makes SDK golden responses reproducible. */
  receivedAt?: string;
}

export interface MockIngestSnapshot {
  acceptedEventIds: string[];
  requestCount: number;
}

export interface MockIngestServer {
  /** Explicit signals for test harnesses and accidental-use guards. */
  readonly isDurable: false;
  readonly productionSafe: false;
  readonly server: http.Server;
  listen(): Promise<string>;
  close(): Promise<void>;
  reset(): void;
  snapshot(): MockIngestSnapshot;
}

type ReadBody = { ok: true; raw: string } | { ok: false; tooLarge: true };

function requestId(method: string, pathname: string, raw: string) {
  return `mock_${crypto.createHash('sha256').update(`${method}\n${pathname}\n${raw}`).digest('hex').slice(0, 20)}`;
}

function protocolError(code: string, message: string, retryable: boolean, requestIdValue: string, details?: JsonValue): JourneyProtocolError {
  return {
    protocolVersion: JOURNEY_EVENT_PROTOCOL_VERSION,
    error: {
      code,
      message,
      retryable,
      requestId: requestIdValue,
      ...(details === undefined ? {} : { details })
    }
  };
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  const encoded = JSON.stringify(body);
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('content-length', String(Buffer.byteLength(encoded)));
  response.setHeader('cache-control', 'no-store');
  response.setHeader(MOCK_INGEST_HEADER, 'non-durable-test-helper');
  response.end(encoded);
}

async function readBody(request: IncomingMessage): Promise<ReadBody> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const value of request) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
    bytes += chunk.length;
    if (bytes > journeyEventLimits.batchBytes) return { ok: false, tooLarge: true };
    chunks.push(chunk);
  }
  return { ok: true, raw: Buffer.concat(chunks).toString('utf8') };
}

function errorDetails(errors: ProtocolValidationIssue[]): JsonValue {
  return errors.map((entry) => ({ path: entry.path, code: entry.code, message: entry.message }));
}

/**
 * Creates a loopback-only SDK conformance server.
 *
 * It is intentionally non-durable, has no tenant/source resolution, performs no
 * identity or journey processing, and must never be used as an ingestion API.
 */
export function createMockIngestServer(options: MockIngestServerOptions = {}): MockIngestServer {
  const writeKey = options.writeKey || MOCK_INGEST_DEFAULT_WRITE_KEY;
  const receivedAt = options.receivedAt || '2000-01-01T00:00:00.000Z';
  const acceptedEventIds = new Set<string>();
  let requests = 0;

  const server = http.createServer(async (request, response) => {
    requests += 1;
    const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
    const method = request.method || 'GET';
    const emptyRequestId = requestId(method, pathname, '');

    if (pathname !== '/v1/events' && pathname !== '/v1/batch') {
      return sendJson(response, 404, protocolError('MOCK_ROUTE_NOT_FOUND', 'Mock route not found.', false, emptyRequestId));
    }
    if (method !== 'POST') {
      response.setHeader('allow', 'POST');
      return sendJson(response, 405, protocolError('METHOD_NOT_ALLOWED', 'Use POST for this mock route.', false, emptyRequestId));
    }
    if (request.headers.authorization !== `Bearer ${writeKey}`) {
      return sendJson(response, 401, protocolError('INVALID_TEST_WRITE_KEY', 'Use the configured mock test write key.', false, emptyRequestId));
    }
    if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
      return sendJson(response, 415, protocolError('CONTENT_TYPE_REQUIRED', 'Content-Type must be application/json.', false, emptyRequestId));
    }

    let body: ReadBody;
    try { body = await readBody(request); }
    catch {
      return sendJson(response, 400, protocolError('REQUEST_BODY_FAILED', 'The mock could not read the request body.', false, emptyRequestId));
    }
    if (!body.ok) {
      return sendJson(response, 413, protocolError('PAYLOAD_TOO_LARGE', 'The request exceeds the protocol batch-byte limit.', false, emptyRequestId));
    }
    const stableRequestId = requestId(method, pathname, body.raw);
    let parsed: unknown;
    try { parsed = JSON.parse(body.raw); }
    catch {
      return sendJson(response, 400, protocolError('MALFORMED_JSON', 'The request body is not valid JSON.', false, stableRequestId));
    }

    if (pathname === '/v1/events') {
      const checked = validateEventEnvelope(parsed);
      if (!checked.ok) {
        return sendJson(response, 422, protocolError('PROTOCOL_VALIDATION_FAILED',
          'The event does not conform to protocol 1.0.', false, stableRequestId, errorDetails(checked.errors)));
      }
      const duplicate = acceptedEventIds.has(checked.value.eventId);
      if (!duplicate) acceptedEventIds.add(checked.value.eventId);
      const result: EventIngestResult = {
        eventId: checked.value.eventId,
        status: duplicate ? 'duplicate' : 'accepted',
        duplicate,
        retryable: false,
        receivedAt
      };
      return sendJson(response, duplicate ? 200 : 202, result);
    }

    const checked = validateEventBatch(parsed);
    if (!checked.ok) {
      return sendJson(response, 422, protocolError('PROTOCOL_VALIDATION_FAILED',
        'The batch does not conform to protocol 1.0.', false, stableRequestId, errorDetails(checked.errors)));
    }
    const results: EventIngestResult[] = checked.value.events.map((event, index) => {
      const duplicate = acceptedEventIds.has(event.eventId);
      if (!duplicate) acceptedEventIds.add(event.eventId);
      return {
        eventId: event.eventId,
        index,
        status: duplicate ? 'duplicate' : 'accepted',
        duplicate,
        retryable: false,
        receivedAt
      };
    });
    const statuses = new Set(results.map((result) => result.status));
    const result: BatchIngestResult = {
      protocolVersion: JOURNEY_EVENT_PROTOCOL_VERSION,
      batchId: checked.value.batchId,
      results
    };
    return sendJson(response, statuses.size > 1 ? 207 : statuses.has('duplicate') ? 200 : 202, result);
  });

  return {
    isDurable: false,
    productionSafe: false,
    server,
    listen: () => new Promise<string>((resolve, reject) => {
      if (server.listening) {
        const address = server.address();
        if (address && typeof address !== 'string') return resolve(`http://127.0.0.1:${address.port}`);
      }
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        const address = server.address();
        if (!address || typeof address === 'string') return reject(new Error('Mock ingest did not receive a loopback port.'));
        resolve(`http://127.0.0.1:${address.port}`);
      });
    }),
    close: () => new Promise<void>((resolve, reject) => {
      if (!server.listening) return resolve();
      server.close((error) => error ? reject(error) : resolve());
    }),
    reset: () => { acceptedEventIds.clear(); requests = 0; },
    snapshot: () => ({ acceptedEventIds: [...acceptedEventIds].sort(), requestCount: requests })
  };
}
