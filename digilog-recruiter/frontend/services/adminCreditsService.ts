import { apiRequest } from './apiConfig';

export interface OrganizationCreditSummary {
  organizationId: string;
  organizationName: string;
  totalCredits: number;
  usedCredits: number;
  remainingCredits: number;
  percentageUsed: number;
  cycleEnd: string;
  transactions: number;
}

export interface CreditUsageReport {
  summary: {
    totalOrganizations: number;
    totalCreditsAllocated: number;
    totalCreditsUsed: number;
    averageUtilization: number;
    lowCreditWarningCount: number;
  };
  organizationsSummary: OrganizationCreditSummary[];
  actionBreakdown: {
    [action: string]: {
      count: number;
      totalCredits: number;
      averageCreditsPerUse: number;
    }
  };
}

/**
 * Get a credit usage report across all organizations
 */
export const getCreditUsageReport = async (): Promise<{ success: boolean; report: CreditUsageReport }> => {
  const token = localStorage.getItem('adminToken');
  if (!token) {
    throw new Error('Authentication required');
  }

  const response = await apiRequest('/api/admin/credits/reports', {
    headers: {
      'x-admin-auth-token': token
    }
  });
  
  if (!response.ok) {
    throw new Error('Failed to fetch credit usage report');
  }
  
  return await response.json();
};

/**
 * Get credit usage for a specific organization
 */
export const getOrganizationCreditUsage = async (organizationId: string): Promise<{ success: boolean; credits: any }> => {
  const token = localStorage.getItem('adminToken');
  if (!token) {
    throw new Error('Authentication required');
  }

  const response = await apiRequest(`/api/credits/admin/${organizationId}/status`, {
    headers: {
      'x-admin-auth-token': token
    }
  });
  
  if (!response.ok) {
    throw new Error('Failed to fetch organization credit usage');
  }
  
  return await response.json();
};

/**
 * Get credit transaction history for a specific organization
 */
export const getOrganizationTransactions = async (
  organizationId: string, 
  filters: { action?: string; startDate?: string; endDate?: string; limit?: number } = {}
): Promise<{ success: boolean; transactions: any[] }> => {
  const token = localStorage.getItem('adminToken');
  if (!token) {
    throw new Error('Authentication required');
  }
  
  const params = new URLSearchParams();
  if (filters.action) params.append('action', filters.action);
  if (filters.startDate) params.append('startDate', filters.startDate);
  if (filters.endDate) params.append('endDate', filters.endDate);
  if (filters.limit) params.append('limit', filters.limit.toString());
  
  const response = await apiRequest(`/api/credits/admin/${organizationId}/transactions?${params.toString()}`, {
    headers: {
      'x-admin-auth-token': token
    }
  });
  
  if (!response.ok) {
    throw new Error('Failed to fetch organization transactions');
  }
  
  return await response.json();
};

/**
 * Add credits to an organization
 */
export const addOrganizationCredits = async (
  organizationId: string, 
  credits: number, 
  reason: string
): Promise<{ success: boolean; message?: string }> => {
  const token = localStorage.getItem('adminToken');
  if (!token) {
    throw new Error('Authentication required');
  }

  const response = await apiRequest(
    `/api/credits/admin/${organizationId}/adjust`, 
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-auth-token': token
      },
      body: JSON.stringify({ credits, reason })
    }
  );
  
  if (!response.ok) {
    throw new Error('Failed to add credits to organization');
  }
  
  return await response.json();
};

/**
 * Reset an organization's credit cycle
 */
export const resetOrganizationCycle = async (organizationId: string): Promise<{ success: boolean; message?: string }> => {
  const token = localStorage.getItem('adminToken');
  if (!token) {
    throw new Error('Authentication required');
  }

  const response = await apiRequest(
    `/api/credits/admin/${organizationId}/reset`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-auth-token': token
      },
      body: JSON.stringify({})
    }
  );
  
  if (!response.ok) {
    throw new Error('Failed to reset organization credit cycle');
  }
  
  return await response.json();
};

export default {
  getCreditUsageReport,
  getOrganizationCreditUsage,
  getOrganizationTransactions,
  addOrganizationCredits,
  resetOrganizationCycle
};
