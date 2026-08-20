const {
  accountFingerprint,
  accountSummary,
  approvalAccount,
  normalizeAccount,
  publicAccount,
} = require('../BankAccountChangeService');

describe('Bank account change service', () => {
  test('normalizes and validates a Nigerian salary account', () => {
    const account = normalizeAccount({
      country: 'Nigeria',
      bankName: 'Access Bank',
      accountHolderName: 'Ada Okafor',
      accountNumber: '1234 567 890',
      bankCode: '044',
      accountType: 'current',
    });

    expect(account).toMatchObject({
      country: 'Nigeria',
      countryCode: 'NG',
      bankName: 'Access Bank',
      accountName: 'Ada Okafor',
      accountNumber: '1234567890',
      branchCode: '044',
      isPrimary: true,
      splitPercentage: 100,
    });
  });

  test('rejects invalid country-specific payment details', () => {
    expect(() => normalizeAccount({
      country: 'United States',
      bankName: 'Example Bank',
      accountName: 'Taylor Smith',
      accountNumber: '12345678',
      routingNumber: '021000022',
    })).toThrow(expect.objectContaining({ code: 'PAYROLL_BANK_DETAILS_INVALID' }));
  });

  test('uses a stable fingerprint without exposing it in the public account', () => {
    const first = normalizeAccount({
      country: 'UK', bankName: 'Example Bank', accountName: 'Ava Stone',
      accountNumber: '12345678', sortCode: '12-34-56', accountType: 'current',
    });
    const second = { ...first, accountNumber: '1234 5678', branchCode: '123456' };

    expect(accountFingerprint(first)).toBe(accountFingerprint(second));
    expect(accountFingerprint(first)).toHaveLength(64);
    expect(publicAccount(first)).not.toHaveProperty('fingerprint');
    expect(accountSummary(first)).toEqual({
      bankName: 'Example Bank', countryCode: 'GB', accountLast4: '5678', accountType: 'current',
    });
  });

  test('marks only an approved account as verified', () => {
    const account = normalizeAccount({
      country: 'Nigeria', bankName: 'Access Bank', accountName: 'Ada Okafor',
      accountNumber: '1234567890', bankCode: '044', accountType: 'current',
    });
    const reviewedAt = new Date('2026-08-20T10:00:00.000Z');

    expect(approvalAccount(account, { reviewedAt })).toMatchObject({
      isVerified: true,
      verifiedAt: reviewedAt,
      splitPercentage: 100,
    });
  });
});
