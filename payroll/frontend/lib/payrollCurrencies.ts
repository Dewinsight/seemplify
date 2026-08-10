export interface PayrollCurrencyOption {
  code: string;
  name: string;
  symbol: string;
  decimals: number;
  label: string;
  kind?: 'iso' | 'custom';
  enabled?: boolean;
  paymentEnabled?: boolean;
  statutoryEligible?: boolean;
  payrollCalculationReady?: boolean;
}

const FALLBACK_CURRENCY_CODES = [
  'USD', 'EUR', 'GBP', 'NGN', 'KES', 'ZAR', 'GHS', 'UGX', 'TZS', 'INR',
  'AED', 'SAR', 'QAR', 'BHD', 'CAD', 'AUD', 'NZD', 'CHF', 'CNY', 'JPY',
  'HKD', 'SGD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'TRY', 'EGP', 'MAD',
  'XOF', 'XAF', 'BRL', 'MXN', 'ARS', 'CLP', 'COP', 'PEN', 'PKR', 'BDT',
  'MYR', 'THB', 'PHP', 'IDR', 'KRW',
];

function buildCurrencyOption(code: string): PayrollCurrencyOption {
  const normalizedCode = String(code || '').trim().toUpperCase();

  let name = normalizedCode;
  let symbol = normalizedCode;
  let decimals = 2;

  try {
    name = new Intl.DisplayNames(['en'], { type: 'currency' }).of(normalizedCode) || normalizedCode;
  } catch {
    name = normalizedCode;
  }

  try {
    const formatter = new Intl.NumberFormat('en', {
      style: 'currency',
      currency: normalizedCode,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
    const currencyPart = formatter.formatToParts(0).find((part) => part.type === 'currency');
    symbol = currencyPart?.value || normalizedCode;
    const resolvedDecimals = new Intl.NumberFormat('en', {
      style: 'currency',
      currency: normalizedCode,
    }).resolvedOptions().maximumFractionDigits;
    decimals = typeof resolvedDecimals === 'number' ? resolvedDecimals : 2;
  } catch {
    symbol = normalizedCode;
    decimals = 2;
  }

  return {
    code: normalizedCode,
    name,
    symbol,
    decimals,
    label: `${normalizedCode} - ${name}`,
    kind: 'iso',
    enabled: true,
    paymentEnabled: decimals === 2,
    statutoryEligible: true,
    payrollCalculationReady: decimals === 2,
  };
}

export function normalizePayrollCurrencies(currencies: any[]): PayrollCurrencyOption[] {
  if (!Array.isArray(currencies) || currencies.length === 0) {
    return payrollCurrencies;
  }

  return currencies
    .map((currency) => ({
      code: String(currency?.code || '').trim().toUpperCase(),
      name: String(currency?.name || '').trim(),
      symbol: String(currency?.symbol || '').trim(),
      decimals: Number.isFinite(Number(currency?.decimals)) ? Number(currency.decimals) : 2,
      label: String(currency?.label || '').trim(),
      kind: currency?.kind === 'custom' ? 'custom' as const : 'iso' as const,
      enabled: currency?.enabled !== false,
      paymentEnabled: currency?.paymentEnabled !== false,
      statutoryEligible: currency?.statutoryEligible !== false,
      payrollCalculationReady: currency?.payrollCalculationReady !== false,
    }))
    .filter((currency) => currency.code.length === 3)
    .map((currency) => ({
      ...currency,
      name: currency.name || buildCurrencyOption(currency.code).name,
      symbol: currency.symbol || buildCurrencyOption(currency.code).symbol,
      label: currency.label || `${currency.code} - ${currency.name || buildCurrencyOption(currency.code).name}`,
    }));
}

export const payrollCurrencies: PayrollCurrencyOption[] = FALLBACK_CURRENCY_CODES.map(buildCurrencyOption);
