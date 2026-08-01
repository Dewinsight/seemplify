import test from 'node:test';
import assert from 'node:assert/strict';
import { emailDraftPlainText, normalizeEmailDraftHtml } from '../src/emailDraftHtml.js';

test('normalizes plain-text replies into email-safe HTML', () => {
  const html = normalizeEmailDraftHtml('Hello Ada,\n\nThank you for the update.\nI will review it.');
  assert.equal(html, '<p>Hello Ada,</p><p>Thank you for the update.<br />I will review it.</p>');
  assert.equal(emailDraftPlainText(html), 'Hello Ada,\nThank you for the update.\nI will review it.');
});

test('keeps supported formatting and removes unsafe email markup', () => {
  const html = normalizeEmailDraftHtml('<p>Hello <strong>Ada</strong></p><script>alert(1)</script><p><a href="javascript:alert(2)" onclick="alert(3)">Open</a> <a href="https://example.com">Safe</a></p>');
  assert.doesNotMatch(html, /script|javascript|onclick/iu);
  assert.match(html, /<strong>Ada<\/strong>/u);
  assert.match(html, /href="https:\/\/example\.com"/u);
  assert.match(html, /rel="noopener noreferrer"/u);
});
