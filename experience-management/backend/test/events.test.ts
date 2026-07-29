import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { attachEventStream, publishEvent } from '../src/events.js';

class EventStreamResponse extends EventEmitter {
  headers = new Map<string, string>();
  writes: string[] = [];
  destroyed = false;
  writableEnded = false;
  flushed = false;
  setHeader(name: string, value: string) { this.headers.set(name.toLowerCase(), value); }
  flushHeaders() { this.flushed = true; }
  write(value: string) { this.writes.push(value); return true; }
}

test('opens an Express event stream, publishes updates and removes closed listeners', () => {
  const response = new EventStreamResponse();
  attachEventStream({} as any, response as any);
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  assert.equal(response.headers.get('cache-control'), 'no-cache, no-transform');
  assert.equal(response.headers.get('x-accel-buffering'), 'no');
  assert.equal(response.flushed, true);
  assert.match(response.writes[0], /^event: connected\ndata: /);

  publishEvent('campaign', { campaignId: 'campaign-1' });
  assert.match(response.writes.at(-1) || '', /event: campaign/);
  assert.match(response.writes.at(-1) || '', /campaign-1/);

  response.emit('close');
  const writesAfterClose = response.writes.length;
  publishEvent('campaign', { campaignId: 'campaign-2' });
  assert.equal(response.writes.length, writesAfterClose);
});
