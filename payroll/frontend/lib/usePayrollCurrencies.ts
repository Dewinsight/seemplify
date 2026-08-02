import { useEffect, useState } from 'react';

import api from '@/lib/api';
import { normalizePayrollCurrencies, payrollCurrencies, PayrollCurrencyOption } from '@/lib/payrollCurrencies';

export function usePayrollCurrencies() {
  const [currencies, setCurrencies] = useState<PayrollCurrencyOption[]>(payrollCurrencies);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const loadCurrencies = async () => {
      try {
        const response = await api.get('/payroll/currencies');
        if (!cancelled) {
          setCurrencies(normalizePayrollCurrencies(response.data?.currencies || []));
        }
      } catch (error) {
        console.error('Failed to load payroll currencies:', error);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadCurrencies();

    return () => {
      cancelled = true;
    };
  }, []);

  return {
    currencies,
    loading,
  };
}
