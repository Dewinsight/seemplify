const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const controllerSource = fs.readFileSync(
  path.join(__dirname, '..', 'controllers', 'aiInterviewController.js'),
  'utf8'
);

const startHandlerStart = controllerSource.indexOf('exports.startPublicInterview =');
const startHandlerEnd = controllerSource.indexOf('exports.sendPublicMessage =');

test('a valid public interview link is not blocked by operational session status', () => {
  assert.ok(startHandlerStart >= 0, 'startPublicInterview handler should exist');
  assert.ok(startHandlerEnd > startHandlerStart, 'sendPublicMessage should follow startPublicInterview');

  const startHandler = controllerSource.slice(startHandlerStart, startHandlerEnd);

  assert.doesNotMatch(startHandler, /NOT_READY/);
  assert.doesNotMatch(startHandler, /pending_send|sending|sent|opened|email_failed|credit_blocked|credit_error/);
  assert.match(startHandler, /TERMINAL_SESSION_STATUSES\.has\(session\.status\)/);
});
