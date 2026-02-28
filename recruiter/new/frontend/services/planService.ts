import { apiRequest } from './apiConfig';
import { getAuthToken } from './authService';

export interface PlanLimit {
  memberLimit: number | string;
  storageLimit: number | string;
  apiCallsLimit: number | string;
}

export interface PlanFeature {
  name: string;
  description?: string;
  included: boolean;
}

export interface Plan {
  _id?: string;
  name: string;
  code: string;
  price: number;
  currency: string;
  billingCycle: string;
  features: PlanFeature[];
  limits: PlanLimit;
  trialDays: number;
  isPublished: boolean;
  displayOrder: number;
  isDefault?: boolean;
  isCustom?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface PlanResponse {
  success: boolean;
  message?: string;
  plans?: Plan[];
  plan?: Plan;
  count?: number;
}

// Get all published plans (available to all users)
export const getPublishedPlans = async (): Promise<PlanResponse> => {
  try {
    const response = await apiRequest(`/api/plans/published`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    return await response.json();
  } catch (error) {
    console.error('Error fetching published plans:', error);
    return { 
      success: false, 
      message: 'Failed to fetch subscription plans' 
    };
  }
};

// Get a plan by code
export const getPlanByCode = async (code: string): Promise<PlanResponse> => {
  try {
    const response = await apiRequest(`/api/plans/code/${code}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    return await response.json();
  } catch (error) {
    console.error('Error fetching plan by code:', error);
    return { 
      success: false, 
      message: 'Failed to fetch subscription plan' 
    };
  }
};

// Get all plans (admin only)
export const getAllPlans = async (): Promise<PlanResponse> => {
  try {
    const token = getAuthToken();
    const response = await apiRequest(`/api/plans`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    return await response.json();
  } catch (error) {
    console.error('Error fetching all plans:', error);
    return { 
      success: false, 
      message: 'Failed to fetch subscription plans' 
    };
  }
};

