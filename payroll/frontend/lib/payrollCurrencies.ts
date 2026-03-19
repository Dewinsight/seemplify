export interface PayrollCurrencyOption {
  code: string;
  label: string;
}

export const payrollCurrencies: PayrollCurrencyOption[] = [
  { code: 'USD', label: 'USD ($)' },
  { code: 'EUR', label: 'EUR (EUR)' },
  { code: 'GBP', label: 'GBP (GBP)' },
  { code: 'NGN', label: 'NGN (Naira)' },
  { code: 'KES', label: 'KES (Kenyan Shilling)' },
  { code: 'ZAR', label: 'ZAR (South African Rand)' },
  { code: 'INR', label: 'INR (Indian Rupee)' },
  { code: 'GHS', label: 'GHS (Ghanaian Cedi)' },
  { code: 'TZS', label: 'TZS (Tanzanian Shilling)' },
  { code: 'UGX', label: 'UGX (Ugandan Shilling)' },
  { code: 'AED', label: 'AED (UAE Dirham)' },
  { code: 'CAD', label: 'CAD (Canadian Dollar)' },
  { code: 'AUD', label: 'AUD (Australian Dollar)' },
];
