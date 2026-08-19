const assert = require('node:assert/strict');
const test = require('node:test');

const { encryptValue } = require('../services/onboardingSecurityService');
const { mapApprovedPayrollSync } = require('../services/approvedPayrollSyncService');

test('maps approved Recruiter onboarding values into the canonical payroll profile payload', () => {
  const submission = {
    _id: { toString: () => 'submission-1' },
    status: 'approved',
    reviewedAt: new Date('2026-08-19T10:00:00.000Z'),
    values: [
      { key: 'legalName', type: 'text', value: 'Ada Example' },
      { key: 'phone', type: 'phone', value: '+2348000000000' },
      { key: 'dateOfBirth', type: 'date', sensitive: true, encryptedValue: encryptValue('1990-01-02') },
      { key: 'address', type: 'address', value: { street: '1 Main Road', city: 'Lagos', country: 'Nigeria' } },
      { key: 'emergencyContactName', type: 'text', value: 'Grace Example' },
      { key: 'emergencyContactRelationship', type: 'text', value: 'Sibling' },
      { key: 'emergencyContactPhone', type: 'phone', value: '+2348000000001' },
      { key: 'bankCountry', type: 'select', value: 'Nigeria' },
      { key: 'bankName', type: 'text', sensitive: true, encryptedValue: encryptValue('Example Bank') },
      { key: 'bankAccountName', type: 'text', sensitive: true, encryptedValue: encryptValue('Ada Example') },
      { key: 'bankIdentifier', type: 'routing_number', sensitive: true, encryptedValue: encryptValue('999') },
      { key: 'bankAccountNumber', type: 'bank_account', sensitive: true, encryptedValue: encryptValue('0123456789') },
      { key: 'taxId', type: 'tax_id', sensitive: true, encryptedValue: encryptValue('TAX-123') },
      { key: 'dependentsStatus', type: 'select', value: 'provided' },
      { key: 'dependentsCount', type: 'number', value: 2 },
    ],
  };

  const payload = mapApprovedPayrollSync({
    _id: 'transition-1',
    subject: { name: 'Ada Example' },
  }, submission);

  assert.equal(payload.name, 'Ada Example');
  assert.equal(payload.personalInfo.dateOfBirth, '1990-01-02');
  assert.equal(payload.personalInfo.emergencyContact.relationship, 'Sibling');
  assert.equal(payload.banking.country, 'Nigeria');
  assert.equal(payload.banking.accounts[0].bankCode, '999');
  assert.equal(payload.banking.accounts[0].accountNumber, '0123456789');
  assert.equal(payload.taxInfo.taxId, 'TAX-123');
  assert.deepEqual(payload.dependentsDeclaration.status, 'provided');
  assert.equal(payload.dependentsDeclaration.count, 2);
});
