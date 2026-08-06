import { apiRequest } from './apiConfig';

export interface Currency {
  _id: string;
  code: string;
  symbol: string;
  name: string;
  locale?: string;
  isSystem: boolean;
  organization?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CurrencyCreateData {
  code: string;
  symbol: string;
  name: string;
  locale?: string;
}

export interface CurrencyUpdateData {
  symbol?: string;
  name?: string;
  locale?: string;
}

export interface CurrenciesResponse {
  success: boolean;
  currencies: Currency[];
  defaultCurrency: string;
  count: number;
}

export interface CurrencyUsageResponse {
  success: boolean;
  code: string;
  usage: {
    active: number;
    archived: number;
    total: number;
  };
}

// Get all currencies for organization
export const getCurrencies = async (): Promise<CurrenciesResponse> => {
  try {
    const response = await apiRequest('/api/currencies');
    const data = await response.json(); // ✅ FIXED: Parse JSON response
    return data;
  } catch (error: any) {
    throw new Error(error.message || 'Failed to fetch currencies');
  }
};

// Get single currency by ID
export const getCurrency = async (id: string): Promise<Currency> => {
  try {
    const response = await apiRequest(`/api/currencies/${id}`);
    const data = await response.json(); // ✅ FIXED: Parse JSON response
    return data.currency;
  } catch (error: any) {
    throw new Error(error.message || 'Failed to fetch currency');
  }
};

// Create new currency
export const createCurrency = async (data: CurrencyCreateData): Promise<Currency> => {
  try {
    const response = await apiRequest('/api/currencies', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    const result = await response.json(); // ✅ FIXED: Parse JSON response
    return result.currency;
  } catch (error: any) {
    throw new Error(error.message || 'Failed to create currency');
  }
};

// Update currency
export const updateCurrency = async (id: string, data: CurrencyUpdateData): Promise<Currency> => {
  try {
    const response = await apiRequest(`/api/currencies/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    const result = await response.json(); // ✅ FIXED: Parse JSON response
    return result.currency;
  } catch (error: any) {
    throw new Error(error.message || 'Failed to update currency');
  }
};

// Delete currency
export const deleteCurrency = async (id: string): Promise<void> => {
  try {
    const response = await apiRequest(`/api/currencies/${id}`, {
      method: 'DELETE',
    });
    await response.json(); // ✅ FIXED: Parse JSON response (even if not used)
  } catch (error: any) {
    throw new Error(error.message || 'Failed to delete currency');
  }
};

// Get currency usage stats
export const getCurrencyUsage = async (code: string): Promise<CurrencyUsageResponse> => {
  try {
    const response = await apiRequest(`/api/currencies/${code}/usage`);
    const data = await response.json(); // ✅ FIXED: Parse JSON response
    return data;
  } catch (error: any) {
    throw new Error(error.message || 'Failed to fetch currency usage');
  }
};

// Set organization default currency
export const setDefaultCurrency = async (currencyCode: string): Promise<void> => {
  try {
    const response = await apiRequest('/api/currencies/default', {
      method: 'PUT',
      body: JSON.stringify({ currencyCode }),
    });
    await response.json(); // ✅ FIXED: Parse JSON response (even if not used)
  } catch (error: any) {
    throw new Error(error.message || 'Failed to set default currency');
  }
};
