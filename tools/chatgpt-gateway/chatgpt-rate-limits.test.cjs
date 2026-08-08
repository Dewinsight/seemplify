'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  extractRateLimits,
  normalizeRateLimitWindow,
  usageLimitFromMessage
} = require('./chatgpt-session-manager.cjs');

test('a usage window is read whichever spelling the CLI used', () => {
  const camel = normalizeRateLimitWindow({ usedPercent: 73.4, windowMinutes: 300, resetsAt: '2026-08-13T17:26:00Z' });
  const snake = normalizeRateLimitWindow({ used_percent: 73.4, window_minutes: 300, resets_at: '2026-08-13T17:26:00Z' });
  assert.deepEqual(camel, snake, 'the two spellings must not disagree');
  assert.equal(camel.usedPercent, 73.4);
  assert.equal(camel.windowMinutes, 300);
  assert.equal(camel.resetsAt, '2026-08-13T17:26:00.000Z');
});

test('a relative reset becomes an absolute time the UI can render', () => {
  const window = normalizeRateLimitWindow({ usedPercent: 100, resets_in_seconds: 3600 });
  const resetsAt = new Date(window.resetsAt).getTime();
  const expected = Date.now() + 3600_000;
  assert.ok(Math.abs(resetsAt - expected) < 5000, 'within a few seconds of an hour from now');
});

test('a percentage is clamped rather than shown as impossible', () => {
  assert.equal(normalizeRateLimitWindow({ usedPercent: 140 }).usedPercent, 100);
  assert.equal(normalizeRateLimitWindow({ usedPercent: -3 }).usedPercent, 0);
});

test('a payload with nothing usable is ignored, never guessed at', () => {
  // Showing a wrong allowance would be worse than showing none.
  assert.equal(normalizeRateLimitWindow(null), null);
  assert.equal(normalizeRateLimitWindow({}), null);
  assert.equal(normalizeRateLimitWindow({ somethingElse: 5 }), null);
});

test('limits are found wherever the notification carried them', () => {
  const direct = extractRateLimits({
    method: 'account/rateLimits',
    params: { rateLimits: { primary: { usedPercent: 10, windowMinutes: 300 } } }
  });
  assert.equal(direct.primary.usedPercent, 10);
  assert.equal(direct.secondary, null);

  const onTurn = extractRateLimits({
    method: 'turn/completed',
    params: { turn: { usage: { rate_limits: { weekly: { used_percent: 91, window_minutes: 10080 } } } } }
  });
  assert.equal(onTurn.secondary.usedPercent, 91, 'the weekly window is the secondary one');
  assert.ok(onTurn.capturedAt, 'the reading is timestamped so staleness is visible');
});

test('an unrelated notification yields no limits', () => {
  assert.equal(extractRateLimits({ method: 'item/started', params: {} }), null);
  assert.equal(extractRateLimits({}), null);
});

test('a limit refusal is recognised and quoted intact', () => {
  const limit = usageLimitFromMessage(
    "You've hit your usage limit. Upgrade to Pro or try again at Aug 13th, 2026 5:26 PM."
  );
  assert.match(limit.message, /Aug 13th, 2026 5:26 PM/, 'the reset time must survive verbatim');
  assert.ok(limit.at);
  assert.equal(usageLimitFromMessage('The model returned no output'), null);
  assert.equal(usageLimitFromMessage(''), null);
});
