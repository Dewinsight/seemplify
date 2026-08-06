const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');

const originalEnvironment = {
  MAIL_API_BASE_URL: process.env.MAIL_API_BASE_URL,
  MAIL_API_TOKEN: process.env.MAIL_API_TOKEN,
  MAIL_FROM_EMAIL: process.env.MAIL_FROM_EMAIL,
  MAIL_FROM_NAME: process.env.MAIL_FROM_NAME
};
const originalFetch = globalThis.fetch;

before(() => {
  process.env.MAIL_API_BASE_URL = 'https://mail-control.seemplifyai.com';
  process.env.MAIL_API_TOKEN = 'recruiter.test-secret';
  process.env.MAIL_FROM_EMAIL = 'no-reply@seemplifyai.com';
  process.env.MAIL_FROM_NAME = 'Seemplify';
});

after(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('legacy Brevo-shaped senders cannot override the authenticated Seemplify sender', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
    return {
      ok: true,
      status: 202,
      json: async () => ({ status: 'accepted', messageId: 'adapter-test' })
    };
  };

  // Load after the test environment is installed because EmailService records
  // its diagnostic base URL at construction time.
  delete require.cache[require.resolve('../services/emailService')];
  const emailService = require('../services/emailService');
  const response = await emailService.deliverProviderPayload({
    body: JSON.stringify({
      sender: { email: 'no-reply@aiinnigeria.com', name: 'Example Organization' },
      to: [{ email: 'candidate@example.test' }],
      subject: 'Onboarding ready',
      textContent: 'Open the candidate portal.'
    })
  });

  assert.equal(response.status, 202);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://mail-control.seemplifyai.com/v1/messages');
  assert.equal(calls[0].body.from, 'no-reply@seemplifyai.com');
  assert.equal(calls[0].body.fromName, 'Example Organization');
  assert.equal(calls[0].headers.Authorization, 'Bearer recruiter.test-secret');
});
