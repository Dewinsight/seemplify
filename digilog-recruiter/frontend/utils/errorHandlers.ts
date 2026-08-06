// Centralized error handling utilities
import { handleCreditError, extractCreditError, isCreditError } from './creditErrorHandler';

export interface ApiError {
  msg?: string;
  message?: string;
  error?: any;
  requiresOrganizationSetup?: boolean;
  details?: any;
}

// Unified error handler for all API errors
export const handleApiError = (error: ApiError | any) => {
  // Check if it's a credit error first
  const creditError = extractCreditError(error);
  if (creditError) {
    handleCreditError(creditError);
    throw new Error(`Insufficient credits: ${creditError.message}`);
  }
  
  // Handle organization setup required
  if (error.requiresOrganizationSetup) {
    // Don't redirect - let the AppShell handle showing the organization setup modal
    // This prevents infinite redirect loops
    throw new Error('Organization setup required. Please set up your organization to continue.');
  }
  
  // Handle other specific error types
  if (error.error === 'ORGANIZATION_REQUIRED') {
    throw new Error(error.message || 'Organization context is required');
  }
  
  if (error.error === 'CREDIT_CHECK_FAILED') {
    throw new Error(error.message || 'Unable to verify credits. Please try again.');
  }
  
  // Default error handling
  throw new Error(error.msg || error.message || 'An error occurred');
};

// Legacy function name for compatibility
export const handleOrganizationError = handleApiError;
