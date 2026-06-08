import { getCurrencies as getCurrenciesAPI } from '@/services/currencyService';

export interface Currency {
  code: string;
  symbol: string;
  name: string;
  locale?: string;
}

// Fallback currencies (in case API fails)
export const CURRENCIES: Currency[] = [
  // Major Global Currencies
  { code: 'USD', symbol: '$', name: 'US Dollar', locale: 'en-US' },
  { code: 'EUR', symbol: '€', name: 'Euro', locale: 'de-DE' },
  { code: 'GBP', symbol: '£', name: 'British Pound', locale: 'en-GB' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen', locale: 'ja-JP' },
  { code: 'CNY', symbol: '¥', name: 'Chinese Yuan', locale: 'zh-CN' },
  
  // African Currencies (Expanded)
  { code: 'NGN', symbol: '₦', name: 'Nigerian Naira', locale: 'en-NG' },
  { code: 'ZAR', symbol: 'R', name: 'South African Rand', locale: 'en-ZA' },
  { code: 'KES', symbol: 'KSh', name: 'Kenyan Shilling', locale: 'en-KE' },
  { code: 'GHS', symbol: '₵', name: 'Ghanaian Cedi', locale: 'en-GH' },
  { code: 'EGP', symbol: '£', name: 'Egyptian Pound', locale: 'ar-EG' },
  { code: 'MAD', symbol: 'د.م.', name: 'Moroccan Dirham', locale: 'ar-MA' },
  { code: 'TND', symbol: 'د.ت', name: 'Tunisian Dinar', locale: 'ar-TN' },
  { code: 'ETB', symbol: 'Br', name: 'Ethiopian Birr', locale: 'am-ET' },
  { code: 'UGX', symbol: 'USh', name: 'Ugandan Shilling', locale: 'en-UG' },
  { code: 'TZS', symbol: 'TSh', name: 'Tanzanian Shilling', locale: 'sw-TZ' },
  { code: 'XOF', symbol: 'CFA', name: 'West African CFA Franc', locale: 'fr-SN' },
  { code: 'XAF', symbol: 'FCFA', name: 'Central African CFA Franc', locale: 'fr-CM' },
  { code: 'BWP', symbol: 'P', name: 'Botswana Pula', locale: 'en-BW' },
  { code: 'ZMW', symbol: 'K', name: 'Zambian Kwacha', locale: 'en-ZM' },
  { code: 'MWK', symbol: 'MK', name: 'Malawian Kwacha', locale: 'en-MW' },
  
  // Other Regional Currencies
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar', locale: 'en-CA' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar', locale: 'en-AU' },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee', locale: 'en-IN' },
  { code: 'BRL', symbol: 'R$', name: 'Brazilian Real', locale: 'pt-BR' },
  { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham', locale: 'ar-AE' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar', locale: 'en-SG' },
  { code: 'HKD', symbol: 'HK$', name: 'Hong Kong Dollar', locale: 'zh-HK' },
  { code: 'MXN', symbol: 'Mex$', name: 'Mexican Peso', locale: 'es-MX' }
];

export const DEFAULT_CURRENCY = 'USD';

// Cache for API currencies
let currencyCache: Currency[] | null = null;

// Get currencies from API with fallback
export async function getCurrencies(): Promise<Currency[]> {
  if (currencyCache) {
    return currencyCache;
  }

  try {
    const data = await getCurrenciesAPI();
    currencyCache = data.currencies.map(c => ({
      code: c.code,
      symbol: c.symbol,
      name: c.name,
      locale: c.locale
    }));
    return currencyCache;
  } catch (error) {
    console.warn('Failed to fetch currencies from API, using fallback', error);
    return CURRENCIES;
  }
}

export function getCurrencyByCode(code: string): Currency | undefined {
  // Try cache first
  if (currencyCache) {
    return currencyCache.find(currency => currency.code === code);
  }
  // Fallback to static currencies
  return CURRENCIES.find(currency => currency.code === code);
}

export function formatCurrency(amount: number, currencyCode: string): string {
  const currency = getCurrencyByCode(currencyCode);
  if (!currency) return `${amount}`;
  
  try {
    return new Intl.NumberFormat(currency.locale, {
      style: 'currency',
      currency: currency.code,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  } catch {
    // Fallback if locale formatting fails
    return `${currency.symbol}${amount.toLocaleString()}`;
  }
}

export function getCurrencySymbol(currencyCode: string): string {
  const currency = getCurrencyByCode(currencyCode);
  return currency?.symbol || currencyCode;
}
