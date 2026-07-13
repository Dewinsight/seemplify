const test = require('node:test');
const assert = require('node:assert/strict');
const emailService = require('../services/emailService');
const {
  DEFAULT_ORGANIZATION_BRAND,
  resolveOrganizationBrand
} = require('../utils/organizationBrand');

test('rejects Mega as a direct sender brand', () => {
  const keys = [
    'DEFAULT_ORGANIZATION_NAME',
    'ORGANIZATION_NAME',
    'BREVO_SENDER_NAME'
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

  for (const key of keys) delete process.env[key];

  try {
    assert.equal(resolveOrganizationBrand('Mega'), DEFAULT_ORGANIZATION_BRAND);
    assert.equal(resolveOrganizationBrand('Acme Ltd'), 'Acme Ltd');
    assert.equal(
      emailService.applyOrganizationBrand('Sent by Mega', 'Acme Ltd'),
      'Sent by Acme Ltd'
    );
    assert.equal(
      emailService.ensureOrganizationSubject('Mega - Welcome', 'Acme Ltd'),
      'Acme Ltd - Welcome'
    );
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
