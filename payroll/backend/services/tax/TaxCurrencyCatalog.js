'use strict';

// Keep the organization currency policy aligned with every currency referenced
// by the built-in tax jurisdiction catalogue. A catalogue version lets existing
// organizations receive newly-supported tax currencies once without undoing
// deliberate policy changes on every read.
const TAX_CURRENCY_CATALOG_VERSION = 1;

const TAX_JURISDICTION_CURRENCIES = Object.freeze([
  Object.freeze({ countryCode: 'CA', countryName: 'Canada', currencyCode: 'CAD', bankCountry: 'Canada', aliases: ['CAN', 'CANADA'] }),
  Object.freeze({ countryCode: 'CM', countryName: 'Cameroon', currencyCode: 'XAF', bankCountry: 'Cameroon', aliases: ['CMR', 'CAMEROON'] }),
  Object.freeze({ countryCode: 'EU', countryName: 'European Union', currencyCode: 'EUR', bankCountry: 'EU', aliases: ['EUROPEAN UNION'] }),
  Object.freeze({ countryCode: 'GB', countryName: 'United Kingdom', currencyCode: 'GBP', bankCountry: 'UK', aliases: ['GBR', 'UK', 'UNITED KINGDOM', 'ENGLAND', 'SCOTLAND', 'WALES', 'NORTHERN IRELAND'] }),
  Object.freeze({ countryCode: 'GH', countryName: 'Ghana', currencyCode: 'GHS', bankCountry: 'Ghana', aliases: ['GHA', 'GHANA'] }),
  Object.freeze({ countryCode: 'KE', countryName: 'Kenya', currencyCode: 'KES', bankCountry: 'Kenya', aliases: ['KEN', 'KENYA'] }),
  Object.freeze({ countryCode: 'MZ', countryName: 'Mozambique', currencyCode: 'MZN', bankCountry: 'Mozambique', aliases: ['MOZ', 'MOZAMBIQUE'] }),
  Object.freeze({ countryCode: 'NG', countryName: 'Nigeria', currencyCode: 'NGN', bankCountry: 'Nigeria', aliases: ['NGA', 'NIGERIA'] }),
  Object.freeze({ countryCode: 'US', countryName: 'United States', currencyCode: 'USD', bankCountry: 'USA', aliases: ['USA', 'UNITED STATES', 'UNITED STATES OF AMERICA'] }),
  Object.freeze({ countryCode: 'ZA', countryName: 'South Africa', currencyCode: 'ZAR', bankCountry: 'South Africa', aliases: ['ZAF', 'SOUTH AFRICA'] }),
]);

const TAX_CURRENCY_CODES = Object.freeze(
  [...new Set(TAX_JURISDICTION_CURRENCIES.map((entry) => entry.currencyCode))].sort()
);

function normalizeTaxCountry(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) return null;
  return TAX_JURISDICTION_CURRENCIES.find((entry) => (
    entry.countryCode === normalized
    || entry.countryName.toUpperCase() === normalized
    || entry.bankCountry.toUpperCase() === normalized
    || entry.aliases.includes(normalized)
  )) || null;
}

module.exports = Object.freeze({
  TAX_CURRENCY_CATALOG_VERSION,
  TAX_JURISDICTION_CURRENCIES,
  TAX_CURRENCY_CODES,
  normalizeTaxCountry,
});
