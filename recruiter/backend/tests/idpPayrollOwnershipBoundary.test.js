const assert = require('node:assert/strict');
const test = require('node:test');

const { buildIdentityProfileSync } = require('../services/idpMembershipLifecycleService');

test('Recruiter sends identity details to IDP without payroll-owned banking or dependents', () => {
  const identitySync = buildIdentityProfileSync({
    source: 'recruiter_people_transition',
    approvedAt: '2026-08-20T00:00:00.000Z',
    submissionId: 'submission-1',
    name: 'Example Employee',
    personalInfo: { dateOfBirth: '1990-01-01' },
    taxInfo: { taxId: 'TAX-1' },
    banking: { accounts: [{ accountNumber: '1234567890' }] },
    dependentsDeclaration: { status: 'provided', count: 2 },
  });

  assert.deepEqual(Object.keys(identitySync).sort(), [
    'approvedAt',
    'name',
    'personalInfo',
    'source',
    'submissionId',
    'taxInfo',
  ]);
  assert.equal(Object.hasOwn(identitySync, 'banking'), false);
  assert.equal(Object.hasOwn(identitySync, 'dependentsDeclaration'), false);
});
