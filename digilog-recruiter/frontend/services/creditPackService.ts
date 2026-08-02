import { apiRequest } from './apiConfig';
import { getAuthToken } from './authService';

export interface CreditPack {
  _id: string;
  name: string;
  code: string;
  credits: number;
  bonusCredits: number;
  totalCredits: number;
  price: number;
  currency: string;
  description?: string;
  isPopular: boolean;
  isActive: boolean;
  displayOrder: number;
  features: string[];
  pricePerCredit: string;
}

export interface CreditPurchaseRequest {
  _id: string;
  organization: string;
  requestedBy: any;
  creditPack: CreditPack;
  packDetails: {
    name: string;
    code: string;
    credits: number;
    bonusCredits: number;
    totalCredits: number;
    price: number;
    currency: string;
  };
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  notes?: string;
  reviewedBy?: any;
  reviewedAt?: string;
  reviewNotes?: string;
  creditsGranted: boolean;
  grantedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreditPackResponse {
  success: boolean;
  message?: string;
  creditPacks?: CreditPack[];
  creditPack?: CreditPack;
}

export interface PurchaseRequestResponse {
  success: boolean;
  message?: string;
  msg?: string;
  request?: CreditPurchaseRequest;
  requests?: CreditPurchaseRequest[];
}

/**
 * Get all active credit packs
 */
export const getCreditPacks = async (): Promise<CreditPackResponse> => {
  try {
    const token = getAuthToken();
    const response = await apiRequest('/api/credit-packs', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    return await response.json();
  } catch (error) {
    console.error('Error fetching credit packs:', error);
    return {
      success: false,
      message: 'Failed to fetch credit packs'
    };
  }
};

/**
 * Get a specific credit pack by ID or code
 */
export const getCreditPackById = async (identifier: string): Promise<CreditPackResponse> => {
  try {
    const token = getAuthToken();
    const response = await apiRequest(`/api/credit-packs/${identifier}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    return await response.json();
  } catch (error) {
    console.error('Error fetching credit pack:', error);
    return {
      success: false,
      message: 'Failed to fetch credit pack'
    };
  }
};

/**
 * Create a credit purchase request
 */
export const createPurchaseRequest = async (
  creditPackId: string,
  notes?: string
): Promise<PurchaseRequestResponse> => {
  try {
    const token = getAuthToken();
    const response = await apiRequest('/api/credit-packs/purchase-request', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ creditPackId, notes })
    });

    return await response.json();
  } catch (error: any) {
    console.error('Error creating purchase request:', error);
    return {
      success: false,
      message: error.message || 'Failed to create purchase request'
    };
  }
};

/**
 * Get purchase requests for current organization
 */
export const getOrganizationPurchaseRequests = async (): Promise<PurchaseRequestResponse> => {
  try {
    const token = getAuthToken();
    const response = await apiRequest('/api/credit-packs/purchase-requests/organization', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    return await response.json();
  } catch (error) {
    console.error('Error fetching purchase requests:', error);
    return {
      success: false,
      message: 'Failed to fetch purchase requests'
    };
  }
};

/**
 * Cancel a purchase request
 */
export const cancelPurchaseRequest = async (requestId: string): Promise<PurchaseRequestResponse> => {
  try {
    const token = getAuthToken();
    const response = await apiRequest(`/api/credit-packs/purchase-requests/${requestId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    return await response.json();
  } catch (error) {
    console.error('Error cancelling purchase request:', error);
    return {
      success: false,
      message: 'Failed to cancel purchase request'
    };
  }
};

export default {
  getCreditPacks,
  getCreditPackById,
  createPurchaseRequest,
  getOrganizationPurchaseRequests,
  cancelPurchaseRequest
};

