'use client';

import { createContext, useContext } from 'react';

export type PayrollViewMode = 'personal' | 'admin';

type PayrollViewModeContextValue = {
  viewMode: PayrollViewMode;
  isHRAdmin: boolean;
  setViewMode: (mode: PayrollViewMode) => void;
};

const defaultValue: PayrollViewModeContextValue = {
  viewMode: 'personal',
  isHRAdmin: false,
  setViewMode: () => {}
};

const PayrollViewModeContext = createContext<PayrollViewModeContextValue>(defaultValue);

export function PayrollViewModeProvider({
  value,
  children
}: {
  value: PayrollViewModeContextValue;
  children: React.ReactNode;
}) {
  return (
    <PayrollViewModeContext.Provider value={value}>
      {children}
    </PayrollViewModeContext.Provider>
  );
}

export function usePayrollViewMode() {
  return useContext(PayrollViewModeContext);
}

