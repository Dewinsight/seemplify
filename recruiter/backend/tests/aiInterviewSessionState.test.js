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

test('question display remains canonical while speech uses a private rendition', () => {
  assert.match(controllerSource, /content: firstQuestion\.question,[\s\S]{0,120}speechContent/);
  assert.match(controllerSource, /content: nextQuestion\.question,[\s\S]{0,120}speechContent/);
  assert.match(controllerSource, /message\.speechContent \|\| message\.content/);

  const publicStateStart = controllerSource.indexOf('function buildPublicState');
  const publicStateEnd = controllerSource.indexOf('async function syncInterviewStats');
  const publicStateSource = controllerSource.slice(publicStateStart, publicStateEnd);
  assert.match(publicStateSource, /messages: \(session\.messages \|\| \[\]\)\.map\(\(message\) => toPublicMessage\(message, interview\)\)/);
  assert.match(controllerSource, /canonicalQuestion \|\| message\.content/);
  assert.doesNotMatch(publicStateSource, /speechContent:/);
});
