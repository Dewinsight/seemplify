function normalizeCurrencyCode(currency = 'USD') {
  const normalized = String(currency || 'USD').trim().toUpperCase();
  return normalized || 'USD';
}

export function formatPayrollMoney(amount: number | string | null | undefined, currency = 'USD') {
  const value = Number(amount || 0);
  const resolvedCurrency = normalizeCurrencyCode(currency);

  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: resolvedCurrency,
      currencyDisplay: 'code',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
      .format(value)
      .replace(/\u00A0/g, ' ');
  } catch (error) {
    return `${resolvedCurrency} ${value.toLocaleString('en-GB', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
}

export function formatPayrollNumber(amount: number | string | null | undefined, minimumFractionDigits = 2, maximumFractionDigits = 2) {
  return Number(amount || 0).toLocaleString('en-GB', {
    minimumFractionDigits,
    maximumFractionDigits,
  });
}
