import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { attachEventStream, publishEvent } from '../src/events.js';

class EventStreamResponse extends EventEmitter {
  headers = new Map<string, string>();
  writes: string[] = [];
  destroyed = false;
  writableEnded = false;
  ended = false;
  flushed = false;
  setHeader(name: string, value: string) { this.headers.set(name.toLowerCase(), value); }
  flushHeaders() { this.flushed = true; }
  write(value: string) { this.writes.push(value); return true; }
  end() { this.ended = true; this.writableEnded = true; this.emit('close'); }
}

test('opens an Express event stream, publishes updates and removes closed listeners', () => {
  const response = new EventStreamResponse();
  attachEventStream({} as any, response as any, 'space-1');
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  assert.equal(response.headers.get('cache-control'), 'no-cache, no-transform');
  assert.equal(response.headers.get('x-accel-buffering'), 'no');
  assert.equal(response.flushed, true);
  assert.match(response.writes[0], /^event: connected\ndata: /);

  publishEvent('campaign', { campaignId: 'campaign-1' }, 'space-1');
  assert.match(response.writes.at(-1) || '', /event: campaign/);
  assert.match(response.writes.at(-1) || '', /campaign-1/);

  const writesBeforeForeignEvent = response.writes.length;
  publishEvent('campaign', { campaignId: 'foreign-campaign' }, 'space-2');
  assert.equal(response.writes.length, writesBeforeForeignEvent);

  response.emit('close');
  const writesAfterClose = response.writes.length;
  publishEvent('campaign', { campaignId: 'campaign-2' }, 'space-1');
  assert.equal(response.writes.length, writesAfterClose);
});

test('closes an existing event stream as soon as its space membership is revoked', () => {
  const response = new EventStreamResponse();
  let authorized = true;
  attachEventStream({} as any, response as any, 'space-revoked', () => authorized);
  authorized = false;
  publishEvent('survey', { surveyId: 'private-survey' }, 'space-revoked');
  assert.match(response.writes.at(-1) || '', /event: access-revoked/);
  assert.doesNotMatch(response.writes.join(''), /private-survey/);
  assert.equal(response.ended, true);

  const count = response.writes.length;
  publishEvent('survey', { surveyId: 'later-private-survey' }, 'space-revoked');
  assert.equal(response.writes.length, count);
});
