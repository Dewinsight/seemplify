const assert = require('node:assert/strict');
const test = require('node:test');
const {
  getPresenceReporterBaseUrl,
  LOCAL_PRESENCE_URL,
  PRODUCTION_PRESENCE_URL,
} = require('../config/presenceReporterConfig');

test('uses the public time-attendance presence service in production', () => {
  assert.equal(getPresenceReporterBaseUrl({ NODE_ENV: 'production' }), PRODUCTION_PRESENCE_URL);
});

test('uses the local service during development', () => {
  assert.equal(getPresenceReporterBaseUrl({ NODE_ENV: 'development' }), LOCAL_PRESENCE_URL);
});

test('honours and normalizes an explicit presence service URL', () => {
  assert.equal(
    getPresenceReporterBaseUrl({
      NODE_ENV: 'production',
      TIME_ATTENDANCE_PRESENCE_URL: 'https://presence.example.test/internal/',
    }),
    'https://presence.example.test/internal',
  );
});
