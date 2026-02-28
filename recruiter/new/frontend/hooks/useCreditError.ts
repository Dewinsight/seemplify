"use client"

import { useState, useCallback } from 'react';
import { CreditError, extractCreditError } from '@/utils/creditErrorHandler';

export function useCreditError() {
  const [creditError, setCreditError] = useState<CreditError | null>(null);
  const [showCreditDialog, setShowCreditDialog] = useState(false);
  
  const handleError = useCallback((error: any) => {
    const extractedError = extractCreditError(error);
    
    if (extractedError) {
      // Toast is already shown by the API interceptor
      // Just set state for the dialog
      setCreditError(extractedError);
      setShowCreditDialog(true);
      return true; // Indicates credit error was handled
    }
    
    return false; // Not a credit error
  }, []);
  
  const clearError = useCallback(() => {
    setCreditError(null);
    setShowCreditDialog(false);
  }, []);
  
  return {
    creditError,
    showCreditDialog,
    setShowCreditDialog,
    handleError,
    clearError
  };
}
