import { apiRequest, getCurrentApiBaseUrl } from './apiConfig';
import { getAuthToken } from '@/services/authService';

export interface InvoiceResponse {
  success: boolean;
  message: string;
  invoiceUrl?: string;
  invoiceNumber?: string;
}

export interface SubscriptionRequest {
  _id?: string;
  requestType: 'user' | 'organization';
  userId?: string;
  organizationId?: string;
  currentPlan?: string;
  requestedPlan: string;
  status: 'pending' | 'approved' | 'rejected' | 'invoiced';
  notes?: string;
  adminNotes?: string;
  invoiceDetails?: {
    invoiceNumber?: string;
    amount?: number;
    currency?: string;
    dueDate?: Date;
    paid?: boolean;
  };
  approvedBy?: string;
  approvalDate?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export const createUpgradeRequest = async (requestData: {
  requestType: 'user' | 'organization';
  organizationId?: string;
  requestedPlan: string;
  notes?: string;
}): Promise<{success: boolean; message: string; requestId?: string; request?: SubscriptionRequest}> => {
  try {
    const token = getAuthToken();
    const response = await apiRequest(`/api/subscription/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(requestData)
    });

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error creating upgrade request:', error);
    return {
      success: false,
      message: 'Failed to create upgrade request. Please try again.'
    };
  }
};

export const getUserRequests = async (): Promise<{
  success: boolean;
  count?: number;
  requests?: SubscriptionRequest[];
  message?: string;
}> => {
  try {
    const token = getAuthToken();
    const response = await apiRequest(`/api/subscription/user-requests`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching user subscription requests:', error);
    return {
      success: false,
      message: 'Failed to fetch subscription requests.'
    };
  }
};

export const getOrganizationRequests = async (organizationId: string): Promise<{
  success: boolean;
  count?: number;
  requests?: SubscriptionRequest[];
  message?: string;
}> => {
  try {
    const token = getAuthToken();
    const response = await apiRequest(`/api/subscription/org-requests/${organizationId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching organization subscription requests:', error);
    return {
      success: false,
      message: 'Failed to fetch organization subscription requests.'
    };
  }
};

export const cancelRequest = async (requestId: string): Promise<{
  success: boolean;
  message: string;
}> => {
  try {
    const token = getAuthToken();
    const response = await apiRequest(`/api/subscription/cancel/${requestId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error cancelling subscription request:', error);
    return {
      success: false,
      message: 'Failed to cancel subscription request.'
    };
  }
};

// Generate invoice for a subscription request
export const generateInvoice = async (requestId: string): Promise<InvoiceResponse> => {
  try {
    const token = getAuthToken();
    const response = await apiRequest(`/api/subscription/invoice/${requestId}/generate`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error generating invoice:', error);
    return {
      success: false,
      message: 'Failed to generate invoice.'
    };
  }
};

// Send invoice email
export const sendInvoiceEmail = async (requestId: string): Promise<InvoiceResponse> => {
  try {
    const token = getAuthToken();
    const response = await apiRequest(`/api/subscription/invoice/${requestId}/email`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error sending invoice email:', error);
    return {
      success: false,
      message: 'Failed to send invoice email.'
    };
  }
};

// Get invoice PDF URL
export const getInvoicePdfUrl = (requestId: string): string => {
  // Check if we should use fallback directly (Sterling deployment)
  const shouldUseFallback = typeof window !== 'undefined' && window.location.href.includes('sterling');
  
  if (shouldUseFallback) {
    return `https://seemplify-eqh4hvgbcag3bug3.uksouth-01.azurewebsites.net/api/subscription/invoice/${requestId}/pdf`;
  }
  
  return `${getCurrentApiBaseUrl()}/api/subscription/invoice/${requestId}/pdf`;
};
