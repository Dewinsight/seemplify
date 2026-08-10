import test from 'node:test'
import assert from 'node:assert/strict'

import {
  PAYROLL_BANK_JURISDICTIONS,
  getPayrollCountryDefaults,
  normalizePayrollBankCountry,
} from '../src/config/payrollBankJurisdictions.js'

test('tax-enabled payroll countries expose their currency and bank requirements', () => {
  const expected = {
    US: 'USD',
    GB: 'GBP',
    EU: 'EUR',
    NG: 'NGN',
    GH: 'GHS',
    KE: 'KES',
    ZA: 'ZAR',
    CA: 'CAD',
    CM: 'XAF',
    MZ: 'MZN',
  }

  for (const [countryCode, currency] of Object.entries(expected)) {
    const country = PAYROLL_BANK_JURISDICTIONS.find((item) => item.code === countryCode)
    assert.ok(country, `${countryCode} should be available for payroll setup`)
    assert.equal(country.currency, currency)
    assert.ok(country.accountTypes.length > 0)
  }
})

test('country names and ISO codes resolve to the same automatic defaults', () => {
  assert.equal(normalizePayrollBankCountry('NG'), 'Nigeria')
  assert.equal(normalizePayrollBankCountry('United Kingdom'), 'UK')
  assert.equal(getPayrollCountryDefaults('CA').currency, 'CAD')
  assert.equal(getPayrollCountryDefaults('Cameroon').currency, 'XAF')
  assert.equal(getPayrollCountryDefaults('not-configured').value, 'Other')
})
