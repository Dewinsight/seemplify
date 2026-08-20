const { normalizeDependent, publicDependent, synchronizeDependentSummary } = require('../DependentService');

describe('DependentService', () => {
  test('validates and normalizes a dependent', () => {
    const value = normalizeDependent({ name: ' Jane Example ', relationship: 'child', dateOfBirth: '2016-05-10', taxDependent: true });
    expect(value.name).toBe('Jane Example');
    expect(value.dateOfBirth).toBeInstanceOf(Date);
  });

  test('returns field-specific errors', () => {
    expect(() => normalizeDependent({ name: '1', relationship: 'invalid', dateOfBirth: '2099-01-01' })).toThrow(expect.objectContaining({
      statusCode: 422,
      details: { fieldErrors: expect.objectContaining({ name: expect.any(String), relationship: expect.any(String), dateOfBirth: expect.any(String) }) },
    }));
  });

  test('synchronizes the tax-dependent count and declaration', () => {
    const profile = { dependents: [{ taxDependent: true }, { taxDependent: false }], taxConfig: {}, dependentsDeclaration: {} };
    synchronizeDependentSummary(profile, new Date('2026-08-20T00:00:00Z'));
    expect(profile.taxConfig.dependents).toBe(1);
    expect(profile.dependentsDeclaration.status).toBe('provided');
  });

  test('returns a public dependent projection', () => {
    expect(publicDependent({ name: 'Jane', relationship: 'child' })).toEqual({ name: 'Jane', relationship: 'child' });
  });
});
