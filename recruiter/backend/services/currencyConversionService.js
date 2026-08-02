const https = require('https');

const ALLOWED_CURRENCIES = {
  USD: { code: 'USD', name: 'US Dollar', symbol: '$', locale: 'en-US' },
  NGN: { code: 'NGN', name: 'Nigerian Naira', symbol: 'NGN', locale: 'en-NG' },
  GBP: { code: 'GBP', name: 'British Pound', symbol: '£', locale: 'en-GB' },
  EUR: { code: 'EUR', name: 'Euro', symbol: '€', locale: 'de-DE' },
  CAD: { code: 'CAD', name: 'Canadian Dollar', symbol: 'CA$', locale: 'en-CA' },
  GHS: { code: 'GHS', name: 'Ghanaian Cedi', symbol: 'GH₵', locale: 'en-GH' },
  KES: { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh', locale: 'en-KE' },
  ZAR: { code: 'ZAR', name: 'South African Rand', symbol: 'R', locale: 'en-ZA' }
};

const FALLBACK_RATES = {
  USD: 1,
  NGN: 1530,
  GBP: 0.79,
  EUR: 0.92,
  CAD: 1.37,
  GHS: 14.7,
  KES: 129,
  ZAR: 18.4
};

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let cachedRates = null;
let cachedAt = 0;

function normalizeCurrencyCode(value) {
  const code = String(value || 'USD').trim().toUpperCase();
  return ALLOWED_CURRENCIES[code] ? code : 'USD';
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, { method: 'GET', timeout: 5000 }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Currency rate request failed (${response.statusCode})`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });

    request.on('timeout', () => {
      request.destroy(new Error('Currency rate request timed out'));
    });
    request.on('error', reject);
    request.end();
  });
}

function filterRates(rates) {
  return Object.keys(ALLOWED_CURRENCIES).reduce((acc, code) => {
    const rate = Number(rates?.[code]);
    acc[code] = Number.isFinite(rate) && rate > 0 ? rate : FALLBACK_RATES[code];
    return acc;
  }, {});
}

async function getRates() {
  const now = Date.now();
  if (cachedRates && now - cachedAt < CACHE_TTL_MS) {
    return cachedRates;
  }

  try {
    const data = await requestJson('https://open.er-api.com/v6/latest/USD');
    const rates = filterRates(data?.rates || {});
    cachedRates = {
      base: 'USD',
      rates,
      source: 'open.er-api.com',
      asOf: data?.time_last_update_utc || new Date().toISOString()
    };
    cachedAt = now;
    return cachedRates;
  } catch (error) {
    cachedRates = {
      base: 'USD',
      rates: { ...FALLBACK_RATES },
      source: 'fallback',
      asOf: new Date().toISOString(),
      error: error.message
    };
    cachedAt = now;
    return cachedRates;
  }
}

async function convertUsd(amountUsd, targetCurrency = 'USD') {
  const currency = normalizeCurrencyCode(targetCurrency);
  const rates = await getRates();
  const amount = Number(amountUsd) || 0;
  const rate = Number(rates.rates[currency] || 1);
  return {
    amount: amount * rate,
    currency,
    rate,
    source: rates.source,
    asOf: rates.asOf,
    metadata: ALLOWED_CURRENCIES[currency]
  };
}

function getSupportedCurrencies() {
  return Object.values(ALLOWED_CURRENCIES);
}

module.exports = {
  ALLOWED_CURRENCIES,
  normalizeCurrencyCode,
  getRates,
  convertUsd,
  getSupportedCurrencies
};
