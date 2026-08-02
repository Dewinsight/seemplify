const test = require('node:test');
const assert = require('node:assert/strict');
const emailService = require('../services/emailService');
const {
  DEFAULT_ORGANIZATION_BRAND,
  ORGANIZATION_EMAIL_CONTEXT_ERROR,
  requireOrganizationBrand,
  resolveOrganizationBrand
} = require('../utils/organizationBrand');

test('generic product branding ignores the legacy Mega environment value', () => {
  const keys = [
    'DEFAULT_ORGANIZATION_NAME',
    'ORGANIZATION_NAME',
    'BREVO_SENDER_NAME'
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

  process.env.DEFAULT_ORGANIZATION_NAME = 'Mega';
  delete process.env.ORGANIZATION_NAME;
  delete process.env.BREVO_SENDER_NAME;

  try {
    assert.equal(resolveOrganizationBrand('Mega'), DEFAULT_ORGANIZATION_BRAND);
    assert.equal(resolveOrganizationBrand('Acme Ltd'), 'Acme Ltd');
    assert.equal(
      emailService.applyOrganizationBrand('Sent by Mega', 'Acme Ltd'),
      'Sent by Acme Ltd'
    );
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test('organization-scoped emails reject missing and placeholder brands', async () => {
  assert.equal(requireOrganizationBrand(' Acme Ltd '), 'Acme Ltd');
  assert.throws(
    () => requireOrganizationBrand('Mega'),
    new RegExp(ORGANIZATION_EMAIL_CONTEXT_ERROR)
  );
  await assert.rejects(
    emailService.sendUserNotification(
      'candidate@example.com',
      'Interview update',
      'Your interview has been updated.',
      { senderName: 'Mega' }
    ),
    new RegExp(ORGANIZATION_EMAIL_CONTEXT_ERROR)
  );
});
