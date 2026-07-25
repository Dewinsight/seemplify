const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const cors = require('cors');
const express = require('express');
const { corsOptions } = require('../config/corsOptions');
const { LiveSnapshotBroadcaster } = require('../services/aiRuntime/liveSnapshotBroadcaster');

const productionOrigin = 'https://app.seemplifyai.com';
const streamPath = '/api/admin/ai-runtime/local/queue/stream';

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function close(server) {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

async function readFirstSseFrame(url, headers) {
  const response = await fetch(url, { headers });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /^text\/event-stream/);
  assert.equal(response.headers.get('access-control-allow-origin'), productionOrigin);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let body = '';
  try {
    while (!body.includes('\n\n')) {
      const next = await reader.read();
      if (next.done) break;
      body += decoder.decode(next.value, { stream: true });
    }
  } finally {
    await reader.cancel();
  }
  const frame = body.slice(0, body.indexOf('\n\n') + 2);
  const eventId = frame.match(/^id: (.+)$/m)?.[1];
  assert.ok(eventId, `SSE frame did not contain an id: ${frame}`);
  return { eventId, frame };
}

test('production CORS permits authenticated SSE preflight and Last-Event-ID reconnects', {
  timeout: 10_000
}, async () => {
  let sequence = 0;
  const receivedEventIds = [];
  const broadcaster = new LiveSnapshotBroadcaster({
    intervalMs: 60_000,
    sampler: async () => ({
      sampledAt: new Date(Date.UTC(2026, 6, 24, 10, 0, sequence++)).toISOString(),
      sequence
    })
  });
  const app = express();
  app.use(cors(corsOptions));
  app.get(streamPath, (request, response) => {
    assert.equal(request.get('Authorization'), 'Bearer production-test-token');
    receivedEventIds.push(request.get('Last-Event-ID') || null);
    broadcaster.subscribe(request, response);
  });
  const server = http.createServer(app);

  try {
    const port = await listen(server);
    const url = `http://127.0.0.1:${port}${streamPath}`;
    const first = await readFirstSseFrame(url, {
      Origin: productionOrigin,
      Authorization: 'Bearer production-test-token'
    });

    const preflight = await fetch(url, {
      method: 'OPTIONS',
      headers: {
        Origin: productionOrigin,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization,last-event-id'
      }
    });
    assert.equal(preflight.status, 200);
    assert.equal(preflight.headers.get('access-control-allow-origin'), productionOrigin);
    assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
    const allowedHeaders = new Set(
      String(preflight.headers.get('access-control-allow-headers') || '')
        .split(',')
        .map((header) => header.trim().toLowerCase())
    );
    assert.equal(allowedHeaders.has('authorization'), true);
    assert.equal(allowedHeaders.has('last-event-id'), true);

    const reconnected = await readFirstSseFrame(url, {
      Origin: productionOrigin,
      Authorization: 'Bearer production-test-token',
      'Last-Event-ID': first.eventId
    });
    assert.notEqual(reconnected.eventId, first.eventId);
    assert.deepEqual(receivedEventIds, [null, first.eventId]);
  } finally {
    broadcaster.stop();
    await close(server);
  }
});
